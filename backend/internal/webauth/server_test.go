package webauth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

type memoryStore struct {
	mu               sync.Mutex
	pingErr          error
	createLoginErr   error
	consumeLoginErr  error
	createSessionErr error
	deleteSessionErr error
	deleteAllErr     error
	sessionErr       error
	transactions     map[[32]byte]LoginTransaction
	sessions         map[[32]byte]User
	deletedAll       int64
	blocked          bool
}

func newMemoryStore() *memoryStore {
	return &memoryStore{transactions: make(map[[32]byte]LoginTransaction), sessions: make(map[[32]byte]User)}
}

func (store *memoryStore) Ping(context.Context) error { return store.pingErr }

func (store *memoryStore) CreateLoginTransaction(_ context.Context, item LoginTransaction, _ time.Time) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.createLoginErr != nil {
		return store.createLoginErr
	}
	store.transactions[item.StateHash] = item
	return nil
}

func (store *memoryStore) ConsumeLoginTransaction(_ context.Context, state, binding [32]byte, now time.Time) (LoginTransaction, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.consumeLoginErr != nil {
		return LoginTransaction{}, store.consumeLoginErr
	}
	item, ok := store.transactions[state]
	if !ok || item.BindingHash != binding || !item.ExpiresAt.After(now) {
		return LoginTransaction{}, ErrLoginTransactionNotFound
	}
	delete(store.transactions, state)
	return item, nil
}

func (store *memoryStore) CreateSession(_ context.Context, identity TelegramIdentity, hash [32]byte, _, expires time.Time) (User, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.createSessionErr != nil {
		return User{}, store.createSessionErr
	}
	if store.blocked {
		return User{}, ErrUserBlocked
	}
	user := User{ID: 77, TelegramID: identity.TelegramID, Name: identity.Name, Username: identity.Username, PictureURL: identity.PictureURL, PhoneNumber: identity.PhoneNumber, ExpiresAt: expires}
	store.sessions[hash] = user
	return user, nil
}

func (store *memoryStore) Session(_ context.Context, hash [32]byte, now time.Time) (User, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.sessionErr != nil {
		return User{}, store.sessionErr
	}
	user, ok := store.sessions[hash]
	if !ok || !user.ExpiresAt.After(now) {
		return User{}, ErrSessionNotFound
	}
	return user, nil
}

func (store *memoryStore) DeleteSession(_ context.Context, hash [32]byte) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.deleteSessionErr != nil {
		return store.deleteSessionErr
	}
	delete(store.sessions, hash)
	return nil
}

func (store *memoryStore) DeleteAllUserSessions(_ context.Context, userID int64) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.deleteAllErr != nil {
		return store.deleteAllErr
	}
	store.deletedAll = userID
	clear(store.sessions)
	return nil
}

type stubProvider struct {
	identity          TelegramIdentity
	exchangeErr       error
	verifier          string
	nonce             string
	authorizationArgs [3]string
}

func (provider *stubProvider) AuthorizationURL(state, nonce, challenge string) string {
	provider.authorizationArgs = [3]string{state, nonce, challenge}
	query := make(url.Values)
	query.Set("state", state)
	query.Set("nonce", nonce)
	query.Set("code_challenge", challenge)
	return "https://oauth.telegram.org/auth?" + query.Encode()
}

func (provider *stubProvider) Exchange(_ context.Context, _, verifier, nonce string) (TelegramIdentity, error) {
	provider.verifier, provider.nonce = verifier, nonce
	return provider.identity, provider.exchangeErr
}

func testConfig() Config {
	return Config{
		Address: "127.0.0.1:4340", DatabaseURL: "postgres://unused", MigrationsDir: "./migrations",
		PublicOrigin: "https://form.tencorp.uz", OIDCIssuer: TelegramIssuer,
		OIDCClientID: "123456", OIDCClientSecret: "0123456789abcdef",
		SessionTTL: 24 * time.Hour, TransactionTTL: 10 * time.Minute,
		ShutdownTimeout: 5 * time.Second, HTTPTimeout: 5 * time.Second,
	}
}

func testServer(t *testing.T) (*Server, *memoryStore, *stubProvider) {
	t.Helper()
	store := newMemoryStore()
	provider := &stubProvider{identity: TelegramIdentity{
		Issuer: TelegramIssuer, Subject: "998877", TelegramID: 998877,
		Name: "Test User", Username: "testuser", PhoneNumber: "+998901234567", PhoneNumberVerified: true,
	}}
	server, err := NewServer(testConfig(), store, provider)
	if err != nil {
		t.Fatal(err)
	}
	server.now = func() time.Time { return time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC) }
	return server, store, provider
}

func TestStartCreatesBoundPKCETransaction(t *testing.T) {
	server, store, provider := testServer(t)
	form := url.Values{"return_to": {"/mirador/apartments?rooms=2"}, "lang": {"ru"}}
	request := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/telegram/start", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Origin", "https://form.tencorp.uz")
	request.Header.Set("Sec-Fetch-Site", "same-origin")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	location, err := url.Parse(response.Header().Get("Location"))
	if err != nil || location.Host != "oauth.telegram.org" {
		t.Fatalf("location = %q, err = %v", location, err)
	}
	state := location.Query().Get("state")
	if !validToken(state) || !validToken(location.Query().Get("nonce")) || location.Query().Get("code_challenge_method") != "" {
		// The stub captures method-independent arguments; the real-provider URL is
		// covered separately. This branch validates high-entropy values here.
		t.Fatalf("invalid authorization parameters: %s", location.RawQuery)
	}
	if provider.authorizationArgs[2] == "" || provider.authorizationArgs[2] == provider.verifier {
		t.Fatal("PKCE challenge was not generated")
	}
	binding := responseCookie(t, response, BindingCookie)
	if !binding.Secure || !binding.HttpOnly || binding.Path != "/" || binding.SameSite != http.SameSiteLaxMode || !validToken(binding.Value) {
		t.Fatalf("binding cookie = %#v", binding)
	}
	item, ok := store.transactions[tokenHash(state)]
	if !ok || item.ReturnTo != "/mirador/apartments?rooms=2" || item.BindingHash != tokenHash(binding.Value) {
		t.Fatalf("transaction = %#v, present = %v", item, ok)
	}
	if item.CodeVerifier == provider.authorizationArgs[2] || pkceChallenge(item.CodeVerifier) != provider.authorizationArgs[2] {
		t.Fatal("stored PKCE verifier does not match the challenge")
	}
}

func TestStartRequiresExactOriginAndBoundedBody(t *testing.T) {
	server, _, _ := testServer(t)
	for name, origin := range map[string]string{"missing": "", "cross-site": "https://evil.example"} {
		t.Run(name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/telegram/start", strings.NewReader("return_to=%2F"))
			request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			request.Header.Set("Origin", origin)
			response := httptest.NewRecorder()
			server.Handler().ServeHTTP(response, request)
			if response.Code != http.StatusForbidden {
				t.Fatalf("status = %d", response.Code)
			}
		})
	}
	duplicateOrigin := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/telegram/start", strings.NewReader("return_to=%2F"))
	duplicateOrigin.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	duplicateOrigin.Header.Add("Origin", "https://form.tencorp.uz")
	duplicateOrigin.Header.Add("Origin", "https://form.tencorp.uz")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, duplicateOrigin)
	if response.Code != http.StatusForbidden {
		t.Fatalf("duplicate-origin status = %d", response.Code)
	}
	request := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/telegram/start", strings.NewReader("return_to=/"+strings.Repeat("a", 5000)))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Origin", "https://form.tencorp.uz")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("large body status = %d", response.Code)
	}
}

func TestStartAllowsMissingOriginOnlyWithBoundDoubleSubmitToken(t *testing.T) {
	server, _, _ := testServer(t)

	loginRequest := httptest.NewRequest(http.MethodGet, "https://form.tencorp.uz/__auth/login?lang=en", nil)
	loginResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(loginResponse, loginRequest)
	binding := responseCookie(t, loginResponse, BindingCookie)
	csrfToken := formCSRFToken(binding.Value)
	if !validToken(binding.Value) || csrfToken == binding.Value || !strings.Contains(loginResponse.Body.String(), `name="csrf_token" value="`+csrfToken+`"`) {
		t.Fatalf("login did not render a token bound to its cookie: %#v", binding)
	}

	form := url.Values{"return_to": {"/mirador"}, "lang": {"en"}, "csrf_token": {csrfToken}}
	request := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/telegram/start", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Sec-Fetch-Site", "same-origin")
	request.AddCookie(binding)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusSeeOther {
		t.Fatalf("missing-Origin request with bound token = %d, body = %s", response.Code, response.Body.String())
	}

	nullOriginForm := url.Values{"return_to": {"/mirador"}, "lang": {"en"}, "csrf_token": {csrfToken}}
	nullOriginRequest := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/telegram/start", strings.NewReader(nullOriginForm.Encode()))
	nullOriginRequest.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	nullOriginRequest.Header.Set("Origin", "null")
	nullOriginRequest.Header.Set("Sec-Fetch-Site", "same-origin")
	nullOriginRequest.AddCookie(binding)
	nullOriginResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(nullOriginResponse, nullOriginRequest)
	if nullOriginResponse.Code != http.StatusSeeOther {
		t.Fatalf("null-Origin request with bound token = %d, body = %s", nullOriginResponse.Code, nullOriginResponse.Body.String())
	}

	for name, mutate := range map[string]func(*http.Request, url.Values){
		"missing token": func(_ *http.Request, values url.Values) { values.Del("csrf_token") },
		"mismatched token": func(_ *http.Request, values url.Values) {
			values.Set("csrf_token", strings.Repeat("A", len(csrfToken)))
		},
		"foreign Origin": func(item *http.Request, _ url.Values) { item.Header.Set("Origin", "https://evil.example") },
		"null Origin without token": func(item *http.Request, values url.Values) {
			item.Header.Set("Origin", "null")
			values.Del("csrf_token")
		},
		"cross-site metadata": func(item *http.Request, _ url.Values) { item.Header.Set("Sec-Fetch-Site", "cross-site") },
	} {
		t.Run(name, func(t *testing.T) {
			values := url.Values{"return_to": {"/"}, "csrf_token": {csrfToken}}
			item := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/telegram/start", nil)
			item.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			item.Header.Set("Sec-Fetch-Site", "same-origin")
			item.AddCookie(binding)
			mutate(item, values)
			item.Body = io.NopCloser(strings.NewReader(values.Encode()))
			item.ContentLength = int64(len(values.Encode()))
			result := httptest.NewRecorder()
			server.Handler().ServeHTTP(result, item)
			if result.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want 403", result.Code)
			}
		})
	}
}

func TestStartRefreshesExistingBrowserBindingForFullTransactionTTL(t *testing.T) {
	server, store, _ := testServer(t)
	existing, err := randomToken()
	if err != nil {
		t.Fatal(err)
	}
	form := url.Values{"return_to": {"/avalon"}}
	request := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/telegram/start", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Origin", "https://form.tencorp.uz")
	request.AddCookie(&http.Cookie{Name: BindingCookie, Value: existing})
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusSeeOther {
		t.Fatalf("status = %d", response.Code)
	}
	refreshed := responseCookie(t, response, BindingCookie)
	if refreshed.Value != existing || refreshed.MaxAge != int(server.cfg.TransactionTTL/time.Second) {
		t.Fatalf("refreshed binding = %#v", refreshed)
	}
	for _, transaction := range store.transactions {
		if transaction.BindingHash != tokenHash(existing) || transaction.ExpiresAt != server.now().Add(server.cfg.TransactionTTL) {
			t.Fatalf("transaction = %#v", transaction)
		}
	}
}

func TestCallbackCreatesOpaqueSessionAndIsOneTime(t *testing.T) {
	server, store, provider := testServer(t)
	state, binding, transaction := seedTransaction(t, server, store, "/avalon?building=2")
	request := httptest.NewRequest(http.MethodGet, "https://form.tencorp.uz/__auth/telegram/callback?state="+url.QueryEscape(state)+"&code=one-time-code", nil)
	request.AddCookie(&http.Cookie{Name: BindingCookie, Value: binding})
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusSeeOther || response.Header().Get("Location") != "/avalon?building=2" {
		t.Fatalf("status = %d, location = %q, body = %s", response.Code, response.Header().Get("Location"), response.Body.String())
	}
	if got := response.Header().Get("Referrer-Policy"); got != "no-referrer" {
		t.Fatalf("callback Referrer-Policy = %q", got)
	}
	if provider.verifier != transaction.CodeVerifier || provider.nonce != transaction.Nonce {
		t.Fatal("callback did not use transaction verifier and nonce")
	}
	session := responseCookie(t, response, SessionCookie)
	if !validToken(session.Value) || !session.Secure || !session.HttpOnly || session.Path != "/" || session.SameSite != http.SameSiteLaxMode {
		t.Fatalf("session cookie = %#v", session)
	}
	if _, ok := store.sessions[tokenHash(session.Value)]; !ok {
		t.Fatal("store did not receive the session token hash")
	}
	if strings.Contains(response.Body.String(), "one-time-code") || strings.Contains(response.Body.String(), session.Value) {
		t.Fatal("callback response leaked a credential")
	}
	replay := httptest.NewRecorder()
	server.Handler().ServeHTTP(replay, request.Clone(context.Background()))
	if replay.Code != http.StatusBadRequest {
		t.Fatalf("replay status = %d", replay.Code)
	}
}

func TestCallbackRequiresBindingAndVerifiedPhone(t *testing.T) {
	server, store, provider := testServer(t)
	state, binding, _ := seedTransaction(t, server, store, "/sanat")
	missingBinding := httptest.NewRequest(http.MethodGet, "https://form.tencorp.uz/__auth/telegram/callback?state="+state+"&code=x", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, missingBinding)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("missing binding status = %d", response.Code)
	}
	if got := response.Header().Get("Referrer-Policy"); got != "no-referrer" {
		t.Fatalf("rejected callback Referrer-Policy = %q", got)
	}
	provider.exchangeErr = ErrPhoneNotShared
	withBinding := httptest.NewRequest(http.MethodGet, "https://form.tencorp.uz/__auth/telegram/callback?state="+state+"&code=x", nil)
	withBinding.AddCookie(&http.Cookie{Name: BindingCookie, Value: binding})
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, withBinding)
	if response.Code != http.StatusForbidden || len(store.sessions) != 0 {
		t.Fatalf("phone rejection status = %d, sessions = %d", response.Code, len(store.sessions))
	}
}

func TestCallbackRejectsExpiredTransactionAndBlockedUser(t *testing.T) {
	server, store, provider := testServer(t)
	state, binding, transaction := seedTransaction(t, server, store, "/sanat")
	transaction.ExpiresAt = server.now().Add(-time.Second)
	store.transactions[tokenHash(state)] = transaction
	request := httptest.NewRequest(http.MethodGet, "https://form.tencorp.uz/__auth/telegram/callback?state="+state+"&code=x", nil)
	request.AddCookie(&http.Cookie{Name: BindingCookie, Value: binding})
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest || provider.verifier != "" {
		t.Fatalf("expired callback status=%d provider-called=%v", response.Code, provider.verifier != "")
	}

	server, store, _ = testServer(t)
	store.blocked = true
	state, binding, _ = seedTransaction(t, server, store, "/sanat")
	request = httptest.NewRequest(http.MethodGet, "https://form.tencorp.uz/__auth/telegram/callback?state="+state+"&code=x", nil)
	request.AddCookie(&http.Cookie{Name: BindingCookie, Value: binding})
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || len(store.sessions) != 0 {
		t.Fatalf("blocked callback status=%d sessions=%d", response.Code, len(store.sessions))
	}
}

func TestCallbackRejectsDuplicateAndConflictingParameters(t *testing.T) {
	tests := []string{
		"&code=one&code=two",
		"&error=access_denied&error=server_error",
		"&code=one&error=access_denied",
	}
	for _, suffix := range tests {
		t.Run(url.QueryEscape(suffix), func(t *testing.T) {
			server, store, provider := testServer(t)
			state, binding, _ := seedTransaction(t, server, store, "/mirador")
			request := httptest.NewRequest(http.MethodGet, "https://form.tencorp.uz/__auth/telegram/callback?state="+state+suffix, nil)
			request.AddCookie(&http.Cookie{Name: BindingCookie, Value: binding})
			response := httptest.NewRecorder()
			server.Handler().ServeHTTP(response, request)
			if response.Code != http.StatusBadRequest || provider.verifier != "" {
				t.Fatalf("status = %d, provider called = %v", response.Code, provider.verifier != "")
			}
		})
	}
	server, store, _ := testServer(t)
	state, binding, _ := seedTransaction(t, server, store, "/mirador")
	request := httptest.NewRequest(http.MethodGet, "https://form.tencorp.uz/__auth/telegram/callback?state="+state+"&state="+state+"&code=one", nil)
	request.AddCookie(&http.Cookie{Name: BindingCookie, Value: binding})
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("duplicate state status = %d", response.Code)
	}
}

func TestInternalCheckAndLogoutLifecycle(t *testing.T) {
	server, store, _ := testServer(t)
	token, err := randomToken()
	if err != nil {
		t.Fatal(err)
	}
	store.sessions[tokenHash(token)] = User{ID: 42, TelegramID: 99, PhoneNumber: "+998901111111", ExpiresAt: server.now().Add(time.Hour)}
	check := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/internal/check", nil)
	check.AddCookie(&http.Cookie{Name: SessionCookie, Value: token})
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, check)
	if response.Code != http.StatusNoContent || response.Header().Get("X-Auth-User-ID") != "42" || response.Header().Get("X-Auth-Telegram-ID") != "99" {
		t.Fatalf("check status/headers = %d %#v", response.Code, response.Header())
	}
	if response.Header().Get("X-Auth-Phone") != "" {
		t.Fatal("internal auth check exposed phone PII")
	}
	logout := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/logout", nil)
	logout.Header.Set("Origin", "https://form.tencorp.uz")
	logout.AddCookie(&http.Cookie{Name: SessionCookie, Value: token})
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, logout)
	if response.Code != http.StatusNoContent || len(store.sessions) != 0 || responseCookie(t, response, SessionCookie).MaxAge >= 0 {
		t.Fatalf("logout result = %d, sessions = %d", response.Code, len(store.sessions))
	}
}

func TestMeOmitsInternalUserID(t *testing.T) {
	server, store, _ := testServer(t)
	token, _ := randomToken()
	store.sessions[tokenHash(token)] = User{
		ID: 424242, TelegramID: 99, Name: "API User", GivenName: "API",
		FamilyName: "User", Username: "apiuser", PictureURL: "https://example.test/avatar.jpg",
		PhoneNumber: "+998901234567", ExpiresAt: server.now().Add(time.Hour),
	}
	request := httptest.NewRequest(http.MethodGet, "https://form.tencorp.uz/__auth/me", nil)
	request.AddCookie(&http.Cookie{Name: SessionCookie, Value: token})
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("me status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"id", "phoneNumber", "pictureUrl"} {
		if _, present := payload[forbidden]; present {
			t.Fatalf("public /me exposed %s: %s", forbidden, response.Body.String())
		}
	}
	if payload["telegramId"] != float64(99) || payload["phoneNumberVerified"] != true || payload["name"] != "API User" {
		t.Fatalf("unexpected /me payload: %#v", payload)
	}
}

func TestAccountRequiresSessionAndDoesNotExposePhoneOrInternalID(t *testing.T) {
	server, store, _ := testServer(t)
	unauthenticated := httptest.NewRequest(http.MethodGet, "https://form.tencorp.uz/__auth/account?lang=uz", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, unauthenticated)
	if response.Code != http.StatusSeeOther || response.Header().Get("Location") != "/__auth/login?lang=uz&return_to=%2F__auth%2Faccount" {
		t.Fatalf("unauthenticated account = %d %q", response.Code, response.Header().Get("Location"))
	}
	token, _ := randomToken()
	store.sessions[tokenHash(token)] = User{
		ID: 424242, TelegramID: 99, Name: "Account User", Username: "accountuser",
		PhoneNumber: "+998901234567", ExpiresAt: server.now().Add(time.Hour),
	}
	request := httptest.NewRequest(http.MethodGet, "https://form.tencorp.uz/__auth/account?lang=en", nil)
	request.AddCookie(&http.Cookie{Name: SessionCookie, Value: token})
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	body := response.Body.String()
	if response.Code != http.StatusOK || !strings.Contains(body, "Account User") || !strings.Contains(body, "accountuser") || !strings.Contains(body, `action="/__auth/logout"`) || !strings.Contains(body, `action="/__auth/logout-all"`) {
		t.Fatalf("account response = %d %s", response.Code, body)
	}
	if strings.Contains(body, "+998901234567") || strings.Contains(body, "424242") {
		t.Fatal("account page exposed phone or internal user ID")
	}
}

func TestHTMLFormLogoutRedirectsWhileAPILogoutReturnsNoContent(t *testing.T) {
	server, store, _ := testServer(t)
	formToken, _ := randomToken()
	store.sessions[tokenHash(formToken)] = User{ID: 42, TelegramID: 99, ExpiresAt: server.now().Add(time.Hour)}
	form := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/logout", nil)
	form.Header.Set("Origin", "https://form.tencorp.uz")
	form.Header.Set("Accept", "text/html,application/xhtml+xml")
	form.Header.Set("Sec-Fetch-Mode", "navigate")
	form.Header.Set("Sec-Fetch-Dest", "document")
	form.AddCookie(&http.Cookie{Name: SessionCookie, Value: formToken})
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, form)
	if response.Code != http.StatusSeeOther || response.Header().Get("Location") != "/__auth/login" {
		t.Fatalf("form logout = %d %q", response.Code, response.Header().Get("Location"))
	}
	apiToken, _ := randomToken()
	store.sessions[tokenHash(apiToken)] = User{ID: 42, TelegramID: 99, ExpiresAt: server.now().Add(time.Hour)}
	api := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/logout", nil)
	api.Header.Set("Origin", "https://form.tencorp.uz")
	api.Header.Set("Accept", "application/json")
	api.AddCookie(&http.Cookie{Name: SessionCookie, Value: apiToken})
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, api)
	if response.Code != http.StatusNoContent {
		t.Fatalf("API logout = %d", response.Code)
	}
}

func TestLogoutAllRequiresOriginAndAuthenticatedSession(t *testing.T) {
	server, store, _ := testServer(t)
	token, _ := randomToken()
	store.sessions[tokenHash(token)] = User{ID: 42, TelegramID: 99, ExpiresAt: server.now().Add(time.Hour)}
	crossSite := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/logout-all", nil)
	crossSite.Header.Set("Origin", "https://evil.example")
	crossSite.AddCookie(&http.Cookie{Name: SessionCookie, Value: token})
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, crossSite)
	if response.Code != http.StatusForbidden || len(store.sessions) != 1 {
		t.Fatalf("cross-site logout = %d", response.Code)
	}
	request := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/logout-all", nil)
	request.Header.Set("Origin", "https://form.tencorp.uz")
	request.AddCookie(&http.Cookie{Name: SessionCookie, Value: token})
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusNoContent || store.deletedAll != 42 || len(store.sessions) != 0 {
		t.Fatalf("logout-all = %d, user = %d", response.Code, store.deletedAll)
	}
}

func TestLoginUsesValidatedOriginalURIAndSecurityHeaders(t *testing.T) {
	server, _, _ := testServer(t)
	request := httptest.NewRequest(http.MethodGet, "https://form.tencorp.uz/__auth/login", nil)
	request.Header.Set("X-Original-URI", "/mirador/unit/42?from=ad")
	request.Header.Set("Accept-Language", "en-US,en;q=0.9")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `name="return_to" value="/mirador/unit/42?from=ad"`) {
		t.Fatalf("login response = %d %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `<html lang="ru"`) || !strings.Contains(response.Body.String(), "Войти через Telegram") {
		t.Fatal("login without an explicit language must default to Russian")
	}
	if got := response.Header().Get("Content-Language"); got != "ru" {
		t.Fatalf("Content-Language = %q, want ru", got)
	}
	binding := responseCookie(t, response, BindingCookie)
	csrfToken := formCSRFToken(binding.Value)
	if !validToken(binding.Value) || csrfToken == binding.Value || !strings.Contains(response.Body.String(), `name="csrf_token" value="`+csrfToken+`"`) {
		t.Fatalf("login form token is not bound to cookie: %#v", binding)
	}
	for _, header := range []string{"Cache-Control", "Referrer-Policy", "Content-Security-Policy", "X-Content-Type-Options"} {
		if response.Header().Get(header) == "" {
			t.Fatalf("missing %s", header)
		}
	}
}

func TestPrivacyPageIsPublicSelfContainedAndLocalized(t *testing.T) {
	server, _, _ := testServer(t)
	request := httptest.NewRequest(http.MethodGet, "https://form.tencorp.uz/privacy?lang=uz", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("privacy status = %d", response.Code)
	}
	body := response.Body.String()
	if !strings.Contains(body, "Shaxsiy ma’lumotlar va kirish.") || strings.Contains(strings.ToLower(body), "<script") {
		t.Fatalf("unexpected privacy body")
	}
	if got := response.Header().Get("Content-Language"); got != "uz" {
		t.Fatalf("Content-Language = %q", got)
	}
}

func TestSafeReturnToRejectsEncodedRedirectAndProtectedPaths(t *testing.T) {
	tests := []string{
		"https://evil.example/", "//evil.example/", "/%2Fevil.example", "/%5c%5cevil",
		"/%00", "/%5F%5Fauth/logout", "/%69nternal/check", "/safe#fragment",
		"/%252Fevil.example", "/%255c%255cevil", "/%255F%255Fauth/logout", "/%2569nternal/check",
		"/projects/../__auth/login", "/projects/%2e%2e/internal/check", "/./__auth/me",
	}
	for _, input := range tests {
		if got := safeReturnTo(input); got != "/" {
			t.Errorf("safeReturnTo(%q) = %q", input, got)
		}
	}
	if got := safeReturnTo("/4u/apartments?rooms=2&sort=price"); got != "/4u/apartments?rooms=2&sort=price" {
		t.Fatalf("valid destination = %q", got)
	}
	if got := safeReturnTo("/__auth/account"); got != "/__auth/account" {
		t.Fatalf("account destination = %q", got)
	}
}

func TestDuplicateSessionCookieIsRejected(t *testing.T) {
	server, store, _ := testServer(t)
	one, _ := randomToken()
	two, _ := randomToken()
	store.sessions[tokenHash(one)] = User{ID: 1, ExpiresAt: server.now().Add(time.Hour)}
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/internal/check", nil)
	request.Header.Add("Cookie", SessionCookie+"="+one+"; "+SessionCookie+"="+two)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("duplicate-cookie status = %d", response.Code)
	}
}

func seedTransaction(t *testing.T, server *Server, store *memoryStore, returnTo string) (string, string, LoginTransaction) {
	t.Helper()
	state, _ := randomToken()
	binding, _ := randomToken()
	nonce, _ := randomToken()
	verifier, _ := randomToken()
	item := LoginTransaction{
		StateHash: tokenHash(state), BindingHash: tokenHash(binding), Nonce: nonce,
		CodeVerifier: verifier, ReturnTo: returnTo, ExpiresAt: server.now().Add(5 * time.Minute),
	}
	if err := store.CreateLoginTransaction(context.Background(), item, server.now()); err != nil {
		t.Fatal(err)
	}
	return state, binding, item
}

func responseCookie(t *testing.T, response *httptest.ResponseRecorder, name string) *http.Cookie {
	t.Helper()
	for _, cookie := range response.Result().Cookies() {
		if cookie.Name == name {
			return cookie
		}
	}
	t.Fatalf("response cookie %s not found in %v", name, response.Header().Values("Set-Cookie"))
	return nil
}

func TestHealthDistinguishesDatabaseFailure(t *testing.T) {
	server, store, _ := testServer(t)
	store.pingErr = errors.New("database unavailable")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://127.0.0.1/healthz", nil))
	if response.Code != http.StatusServiceUnavailable || strings.Contains(response.Body.String(), "database unavailable") {
		t.Fatalf("health response = %d %q", response.Code, response.Body.String())
	}
	if csp := response.Header().Get("Content-Security-Policy"); csp != "default-src 'none'; img-src 'self'; font-src 'self'; form-action 'self' https://oauth.telegram.org; base-uri 'none'; frame-ancestors 'none'" || strings.Contains(csp, "unsafe-inline") || strings.Contains(csp, "form-action https:") {
		t.Fatalf("baseline CSP = %q", csp)
	}
}
