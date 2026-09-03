package webauth

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tencorp/real-estate-platform/backend/internal/database"
)

func TestRetryableTransactionError(t *testing.T) {
	for _, code := range []string{"40001", "40P01"} {
		if !retryableTransactionError(fmt.Errorf("wrapped: %w", &pgconn.PgError{Code: code})) {
			t.Fatalf("PostgreSQL error %s was not retryable", code)
		}
	}
	if retryableTransactionError(&pgconn.PgError{Code: "23505"}) || retryableTransactionError(errors.New("not PostgreSQL")) {
		t.Fatal("non-transaction error was retryable")
	}
}

func openAuthIntegrationStore(t *testing.T) (*Store, *pgxpool.Pool) {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	pool, err := database.Open(t.Context(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	migrationsDir, err := filepath.Abs(filepath.Join("..", "..", "migrations"))
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Migrate(t.Context(), pool, migrationsDir); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `TRUNCATE web_auth_login_transactions, web_auth_sessions, web_auth_users RESTART IDENTITY CASCADE`); err != nil {
		t.Fatal(err)
	}
	return NewStore(pool), pool
}

func TestAuthStoreTransactionSessionAndBlockingIntegration(t *testing.T) {
	store, pool := openAuthIntegrationStore(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	state, binding, wrongBinding := tokenHash("state"), tokenHash("binding"), tokenHash("wrong-binding")
	transaction := LoginTransaction{
		StateHash: state, BindingHash: binding, Nonce: strings.Repeat("n", 43),
		CodeVerifier: strings.Repeat("v", 43), ReturnTo: "/mirador", ExpiresAt: now.Add(10 * time.Minute),
	}
	if err := store.CreateLoginTransaction(t.Context(), transaction, now); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ConsumeLoginTransaction(t.Context(), state, wrongBinding, now); !errors.Is(err, ErrLoginTransactionNotFound) {
		t.Fatalf("wrong binding error = %v", err)
	}
	consumed, err := store.ConsumeLoginTransaction(t.Context(), state, binding, now)
	if err != nil || consumed.ReturnTo != "/mirador" || consumed.CodeVerifier != transaction.CodeVerifier {
		t.Fatalf("consume = %#v, %v", consumed, err)
	}
	if _, err := store.ConsumeLoginTransaction(t.Context(), state, binding, now); !errors.Is(err, ErrLoginTransactionNotFound) {
		t.Fatalf("replay error = %v", err)
	}

	identity := TelegramIdentity{
		Issuer: TelegramIssuer, Subject: "123456", TelegramID: 123456, Name: "Integration User",
		Username: "integration", PhoneNumber: "+998901234567", PhoneNumberVerified: true,
	}
	sessionHash := tokenHash("session-one")
	user, err := store.CreateSession(t.Context(), identity, sessionHash, now, now.Add(time.Hour))
	if err != nil || user.ID == 0 {
		t.Fatalf("create session = %#v, %v", user, err)
	}
	loaded, err := store.Session(t.Context(), sessionHash, now)
	if err != nil || loaded.ID != user.ID || loaded.TelegramID != identity.TelegramID {
		t.Fatalf("session = %#v, %v", loaded, err)
	}
	if _, err := pool.Exec(t.Context(), `UPDATE web_auth_users SET status='blocked' WHERE id=$1`, user.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Session(t.Context(), sessionHash, now); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("blocked session lookup = %v", err)
	}
	if _, err := store.CreateSession(t.Context(), identity, tokenHash("blocked-session"), now, now.Add(time.Hour)); !errors.Is(err, ErrUserBlocked) {
		t.Fatalf("blocked login = %v", err)
	}
	if err := store.DeleteAllUserSessions(t.Context(), user.ID); err != nil {
		t.Fatal(err)
	}
	var sessions int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM web_auth_sessions WHERE user_id=$1`, user.ID).Scan(&sessions); err != nil || sessions != 0 {
		t.Fatalf("remaining sessions = %d, %v", sessions, err)
	}
}

func TestAuthStoreRemovesExpiredSessionsInBoundedBatchIntegration(t *testing.T) {
	store, pool := openAuthIntegrationStore(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	identity := TelegramIdentity{
		Issuer: TelegramIssuer, Subject: "654321", TelegramID: 654321, Name: "Cleanup User",
		PhoneNumber: "+998909876543", PhoneNumberVerified: true,
	}
	user, err := store.CreateSession(t.Context(), identity, tokenHash("active-session"), now, now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	expiredHash := tokenHash("expired-session")
	if _, err := pool.Exec(t.Context(), `
		INSERT INTO web_auth_sessions (token_hash,user_id,created_at,expires_at)
		VALUES ($1,$2,$3,$4)`, expiredHash[:], user.ID, now.Add(-2*time.Hour), now.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateSession(t.Context(), identity, tokenHash("second-active"), now, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	var expired int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM web_auth_sessions WHERE expires_at <= $1`, now).Scan(&expired); err != nil || expired != 0 {
		t.Fatalf("expired sessions = %d, %v", expired, err)
	}
}
