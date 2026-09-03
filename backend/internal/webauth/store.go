package webauth

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrLoginTransactionNotFound = errors.New("login transaction not found")
	ErrSessionNotFound          = errors.New("session not found")
	ErrUserBlocked              = errors.New("user is blocked")
)

type authStore interface {
	Ping(context.Context) error
	CreateLoginTransaction(context.Context, LoginTransaction, time.Time) error
	ConsumeLoginTransaction(context.Context, [32]byte, [32]byte, time.Time) (LoginTransaction, error)
	CreateSession(context.Context, TelegramIdentity, [32]byte, time.Time, time.Time) (User, error)
	Session(context.Context, [32]byte, time.Time) (User, error)
	DeleteSession(context.Context, [32]byte) error
	DeleteAllUserSessions(context.Context, int64) error
}

type Store struct{ pool *pgxpool.Pool }

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

func (store *Store) Ping(ctx context.Context) error { return store.pool.Ping(ctx) }

func (store *Store) CreateLoginTransaction(ctx context.Context, item LoginTransaction, now time.Time) error {
	if _, err := store.pool.Exec(ctx, `
		WITH expired AS (
			SELECT state_hash FROM web_auth_login_transactions
			WHERE expires_at <= $1
			ORDER BY expires_at
			LIMIT 1000
		)
		DELETE FROM web_auth_login_transactions AS transactions
		USING expired
		WHERE transactions.state_hash = expired.state_hash`, now); err != nil {
		return err
	}
	_, err := store.pool.Exec(ctx, `
		INSERT INTO web_auth_login_transactions
			(state_hash, browser_binding_hash, nonce, code_verifier, return_to, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		item.StateHash[:], item.BindingHash[:], item.Nonce, item.CodeVerifier, item.ReturnTo, now, item.ExpiresAt)
	return err
}

func (store *Store) ConsumeLoginTransaction(ctx context.Context, stateHash, bindingHash [32]byte, now time.Time) (LoginTransaction, error) {
	var item LoginTransaction
	var storedState, storedBinding []byte
	err := store.pool.QueryRow(ctx, `
		DELETE FROM web_auth_login_transactions
		WHERE state_hash = $1 AND browser_binding_hash = $2 AND expires_at > $3
		RETURNING state_hash, browser_binding_hash, nonce, code_verifier, return_to, expires_at`,
		stateHash[:], bindingHash[:], now).Scan(&storedState, &storedBinding, &item.Nonce, &item.CodeVerifier, &item.ReturnTo, &item.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return LoginTransaction{}, ErrLoginTransactionNotFound
	}
	if err != nil {
		return LoginTransaction{}, err
	}
	if len(storedState) != 32 || len(storedBinding) != 32 {
		return LoginTransaction{}, errors.New("invalid login transaction hashes")
	}
	copy(item.StateHash[:], storedState)
	copy(item.BindingHash[:], storedBinding)
	return item, nil
}

func (store *Store) CreateSession(ctx context.Context, identity TelegramIdentity, sessionHash [32]byte, createdAt, expiresAt time.Time) (User, error) {
	// Keep retention work out of the serializable identity/session transaction.
	// The bounded delete needs only the runtime role's SELECT and DELETE grants;
	// SELECT ... FOR UPDATE would additionally and unnecessarily require UPDATE.
	if _, err := store.pool.Exec(ctx, `
		WITH expired AS (
			SELECT token_hash FROM web_auth_sessions
			WHERE expires_at <= $1
			ORDER BY expires_at
			LIMIT 1000
		)
		DELETE FROM web_auth_sessions AS sessions
		USING expired
		WHERE sessions.token_hash = expired.token_hash`, createdAt); err != nil {
		return User{}, err
	}
	var lastError error
	for attempt := 0; attempt < 3; attempt++ {
		user, err := store.createSessionTransaction(ctx, identity, sessionHash, createdAt, expiresAt)
		if err == nil {
			return user, nil
		}
		lastError = err
		if !retryableTransactionError(err) {
			return User{}, err
		}
	}
	return User{}, lastError
}

func (store *Store) createSessionTransaction(ctx context.Context, identity TelegramIdentity, sessionHash [32]byte, createdAt, expiresAt time.Time) (User, error) {
	tx, err := store.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return User{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var user User
	var status string
	err = tx.QueryRow(ctx, `
		INSERT INTO web_auth_users
			(issuer, subject, telegram_user_id, display_name, given_name, family_name,
			 username, picture_url, phone_number, phone_number_verified, last_login_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (issuer, subject) DO UPDATE SET
			telegram_user_id = $3,
			display_name = $4,
			given_name = $5,
			family_name = $6,
			username = $7,
			picture_url = $8,
			phone_number = $9,
			phone_number_verified = $10,
			last_login_at = $11,
			updated_at = now()
		RETURNING id, telegram_user_id, display_name, given_name, family_name,
			username, status`,
		identity.Issuer, identity.Subject, identity.TelegramID, identity.Name,
		identity.GivenName, identity.FamilyName, identity.Username, identity.PictureURL,
		identity.PhoneNumber, identity.PhoneNumberVerified, createdAt).Scan(
		&user.ID, &user.TelegramID, &user.Name, &user.GivenName, &user.FamilyName,
		&user.Username, &status)
	if err != nil {
		return User{}, err
	}
	if status != "active" {
		return User{}, ErrUserBlocked
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO web_auth_sessions (token_hash, user_id, created_at, expires_at)
		VALUES ($1, $2, $3, $4)`, sessionHash[:], user.ID, createdAt, expiresAt)
	if err != nil {
		return User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return User{}, err
	}
	user.ExpiresAt = expiresAt
	return user, nil
}

func retryableTransactionError(err error) bool {
	var postgresError *pgconn.PgError
	if !errors.As(err, &postgresError) {
		return false
	}
	return postgresError.Code == "40001" || postgresError.Code == "40P01"
}

func (store *Store) Session(ctx context.Context, sessionHash [32]byte, now time.Time) (User, error) {
	var user User
	err := store.pool.QueryRow(ctx, `
		SELECT users.id, users.telegram_user_id, users.display_name, users.given_name,
			users.family_name, users.username, sessions.expires_at
		FROM web_auth_sessions AS sessions
		JOIN web_auth_users AS users ON users.id = sessions.user_id
		WHERE sessions.token_hash = $1 AND sessions.expires_at > $2
			AND sessions.revoked_at IS NULL AND users.status = 'active'`,
		sessionHash[:], now).Scan(&user.ID, &user.TelegramID, &user.Name, &user.GivenName,
		&user.FamilyName, &user.Username, &user.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrSessionNotFound
	}
	return user, err
}

func (store *Store) DeleteSession(ctx context.Context, sessionHash [32]byte) error {
	_, err := store.pool.Exec(ctx, `DELETE FROM web_auth_sessions WHERE token_hash = $1`, sessionHash[:])
	return err
}

func (store *Store) DeleteAllUserSessions(ctx context.Context, userID int64) error {
	_, err := store.pool.Exec(ctx, `DELETE FROM web_auth_sessions WHERE user_id = $1`, userID)
	return err
}
