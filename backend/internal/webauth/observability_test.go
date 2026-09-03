package webauth

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestObservabilityEmitsOnlySanitizedEventCodes(t *testing.T) {
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil))
	newServer := func(t *testing.T, options ...ServerOption) (*Server, *memoryStore, *stubProvider) {
		t.Helper()
		store := newMemoryStore()
		provider := &stubProvider{identity: TelegramIdentity{
			Issuer: TelegramIssuer, Subject: "private-subject", TelegramID: 8877665544332211,
			Name: "Sensitive Person", GivenName: "Sensitive", FamilyName: "Person",
			Username: "private_username", PictureURL: "https://private.example/avatar-marker",
			PhoneNumber: "+998909998877", PhoneNumberVerified: true,
		}}
		allOptions := append([]ServerOption{WithLogger(logger)}, options...)
		server, err := NewServer(testConfig(), store, provider, allOptions...)
		if err != nil {
			t.Fatal(err)
		}
		server.now = func() time.Time { return time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC) }
		return server, store, provider
	}
	serveCallback := func(t *testing.T, server *Server, store *memoryStore, code string) (string, string, *httptest.ResponseRecorder) {
		t.Helper()
		state, binding, _ := seedTransaction(t, server, store, "/private-route-marker?value=private-query-marker")
		request := httptest.NewRequest(http.MethodGet, "https://form.tencorp.uz/__auth/telegram/callback?state="+url.QueryEscape(state)+"&code="+url.QueryEscape(code), nil)
		request.AddCookie(&http.Cookie{Name: BindingCookie, Value: binding})
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		return state, binding, response
	}

	server, store, _ := newServer(t)
	store.pingErr = errors.New("database-error-secret")
	server.Handler().ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "http://127.0.0.1/healthz", nil))

	store.pingErr = nil
	form := url.Values{"return_to": {"/private-route-marker?value=private-query-marker"}}
	startRequest := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/telegram/start", strings.NewReader(form.Encode()))
	startRequest.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	startRequest.Header.Set("Origin", "https://form.tencorp.uz")
	startResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(startResponse, startRequest)
	if startResponse.Code != http.StatusSeeOther {
		t.Fatalf("start status = %d", startResponse.Code)
	}
	startLocation, err := url.Parse(startResponse.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	startState := startLocation.Query().Get("state")
	startBinding := responseCookie(t, startResponse, BindingCookie).Value
	callbackCode := "authorization-code-secret"
	callbackRequest := httptest.NewRequest(http.MethodGet, "https://form.tencorp.uz/__auth/telegram/callback?state="+url.QueryEscape(startState)+"&code="+callbackCode, nil)
	callbackRequest.AddCookie(&http.Cookie{Name: BindingCookie, Value: startBinding})
	callbackResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(callbackResponse, callbackRequest)
	if callbackResponse.Code != http.StatusSeeOther {
		t.Fatalf("callback status = %d", callbackResponse.Code)
	}
	sessionToken := responseCookie(t, callbackResponse, SessionCookie).Value
	logSizeBeforeCheck := output.Len()
	internalCheck := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/internal/check", nil)
	internalCheck.AddCookie(&http.Cookie{Name: SessionCookie, Value: sessionToken})
	server.Handler().ServeHTTP(httptest.NewRecorder(), internalCheck)
	if output.Len() != logSizeBeforeCheck {
		t.Fatal("successful internal check emitted a noisy log event")
	}

	expiredServer, _, _ := newServer(t)
	expiredState, _ := randomToken()
	expiredBinding, _ := randomToken()
	expiredRequest := httptest.NewRequest(http.MethodGet, "https://form.tencorp.uz/__auth/telegram/callback?state="+expiredState+"&code=expired-code-secret", nil)
	expiredRequest.AddCookie(&http.Cookie{Name: BindingCookie, Value: expiredBinding})
	expiredServer.Handler().ServeHTTP(httptest.NewRecorder(), expiredRequest)

	phoneServer, phoneStore, phoneProvider := newServer(t)
	phoneProvider.exchangeErr = ErrPhoneNotShared
	phoneState, phoneBinding, phoneResponse := serveCallback(t, phoneServer, phoneStore, "phone-code-secret")
	if phoneResponse.Code != http.StatusForbidden {
		t.Fatalf("phone-required status = %d", phoneResponse.Code)
	}

	providerServer, providerStore, provider := newServer(t)
	provider.exchangeErr = errors.New("provider-error-secret")
	providerState, providerBinding, providerResponse := serveCallback(t, providerServer, providerStore, "provider-code-secret")
	if providerResponse.Code != http.StatusUnauthorized {
		t.Fatalf("provider-failed status = %d", providerResponse.Code)
	}

	for _, failure := range []struct {
		name string
		err  error
	}{
		{name: "exchange", err: ErrOIDCExchange},
		{name: "token", err: ErrOIDCToken},
		{name: "token-type", err: errOIDCTokenType},
		{name: "id-token", err: errOIDCIDToken},
		{name: "verify", err: errOIDCVerification},
		{name: "metadata", err: errOIDCMetadata},
		{name: "claims", err: errOIDCClaims},
		{name: "nonce", err: errOIDCNonce},
		{name: "issued-at", err: errOIDCIssuedAt},
		{name: "profile", err: ErrInvalidOIDCProfile},
	} {
		failureServer, failureStore, failureProvider := newServer(t)
		failureProvider.exchangeErr = failure.err
		_, _, failureResponse := serveCallback(t, failureServer, failureStore, failure.name+"-failure-code-secret")
		if failureResponse.Code != http.StatusUnauthorized {
			t.Fatalf("%s failure status = %d", failure.name, failureResponse.Code)
		}
	}

	blockedServer, blockedStore, _ := newServer(t)
	blockedStore.blocked = true
	blockedState, blockedBinding, blockedResponse := serveCallback(t, blockedServer, blockedStore, "blocked-code-secret")
	if blockedResponse.Code != http.StatusForbidden {
		t.Fatalf("blocked status = %d", blockedResponse.Code)
	}

	storeServer, storeFailure, _ := newServer(t)
	storeFailure.createSessionErr = errors.New("session-store-error-secret")
	storeState, storeBinding, storeResponse := serveCallback(t, storeServer, storeFailure, "store-code-secret")
	if storeResponse.Code != http.StatusServiceUnavailable {
		t.Fatalf("session-store status = %d", storeResponse.Code)
	}

	startFailureServer, startFailureStore, _ := newServer(t)
	startFailureStore.createLoginErr = errors.New("transaction-store-error-secret")
	failedStart := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/telegram/start", strings.NewReader("return_to=%2Fprivate-start-marker"))
	failedStart.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	failedStart.Header.Set("Origin", "https://form.tencorp.uz")
	startFailureServer.Handler().ServeHTTP(httptest.NewRecorder(), failedStart)

	metadataRejected := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/telegram/start", strings.NewReader("return_to=%2Fprivate-metadata-marker"))
	metadataRejected.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	metadataRejected.Header.Set("Origin", "https://private-origin-marker.example")
	startFailureServer.Handler().ServeHTTP(httptest.NewRecorder(), metadataRejected)

	csrfRejected := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/telegram/start", strings.NewReader("return_to=%2Fprivate-csrf-marker"))
	csrfRejected.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	csrfRejected.Header.Set("Sec-Fetch-Site", "same-origin")
	startFailureServer.Handler().ServeHTTP(httptest.NewRecorder(), csrfRejected)

	logoutServer, logoutStore, _ := newServer(t)
	logoutToken, _ := randomToken()
	logoutStore.sessions[tokenHash(logoutToken)] = User{ID: 72, ExpiresAt: logoutServer.now().Add(time.Hour)}
	logoutStore.deleteSessionErr = errors.New("logout-store-error-secret")
	logoutRequest := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/logout", nil)
	logoutRequest.Header.Set("Origin", "https://form.tencorp.uz")
	logoutRequest.AddCookie(&http.Cookie{Name: SessionCookie, Value: logoutToken})
	logoutServer.Handler().ServeHTTP(httptest.NewRecorder(), logoutRequest)

	logoutAllServer, logoutAllStore, _ := newServer(t)
	logoutAllToken, _ := randomToken()
	logoutAllStore.sessions[tokenHash(logoutAllToken)] = User{ID: 73, ExpiresAt: logoutAllServer.now().Add(time.Hour)}
	logoutAllStore.deleteAllErr = errors.New("logout-all-store-error-secret")
	logoutAllRequest := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/logout-all", nil)
	logoutAllRequest.Header.Set("Origin", "https://form.tencorp.uz")
	logoutAllRequest.AddCookie(&http.Cookie{Name: SessionCookie, Value: logoutAllToken})
	logoutAllServer.Handler().ServeHTTP(httptest.NewRecorder(), logoutAllRequest)

	botConfig := testConfig()
	botConfig.BotWebhookEnabled = true
	botConfig.BotToken = "123456:abcdefghijklmnopqrstuvwxyz_123456789"
	botConfig.BotWebhookSecret = "observability_webhook_secret_1234"
	bot := &recordingBot{err: errors.New("bot-send-error-secret")}
	botServer, err := NewServer(botConfig, newMemoryStore(), &stubProvider{}, WithLogger(logger), WithTelegramBot(bot))
	if err != nil {
		t.Fatal(err)
	}
	botRequest := webhookRequest(botConfig.BotWebhookSecret, `{"message":{"text":"/start private-message-marker","from":{"is_bot":false,"language_code":"en"},"chat":{"id":8877665544,"type":"private"}}}`)
	botResponse := httptest.NewRecorder()
	botServer.Handler().ServeHTTP(botResponse, botRequest)
	if botResponse.Code != http.StatusBadGateway {
		t.Fatalf("bot failure status = %d", botResponse.Code)
	}

	required := map[string]bool{
		"health/database_unavailable": false, "login_start/success": false,
		"login_start/store_failed": false, "login_start/metadata_rejected": false,
		"login_start/csrf_rejected": false, "login_callback/success": false,
		"login_callback/expired": false, "login_callback/phone_required": false,
		"login_callback/provider_failed": false, "login_callback/account_blocked": false,
		"login_callback/oidc_exchange_failed": false, "login_callback/oidc_token_failed": false,
		"login_callback/oidc_token_type_failed": false, "login_callback/oidc_id_token_failed": false,
		"login_callback/oidc_verify_failed": false, "login_callback/oidc_metadata_failed": false,
		"login_callback/oidc_claims_failed": false, "login_callback/oidc_nonce_failed": false,
		"login_callback/oidc_issued_at_failed": false, "login_callback/oidc_profile_failed": false,
		"login_callback/store_failed": false, "logout/store_failed": false,
		"logout_all/store_failed": false, "bot_webhook/send_failed": false,
	}
	allowedFields := map[string]bool{"time": true, "level": true, "msg": true, "event": true, "outcome": true}
	for lineNumber, line := range strings.Split(strings.TrimSpace(output.String()), "\n") {
		var entry map[string]any
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			t.Fatalf("log line %d is not JSON: %v", lineNumber+1, err)
		}
		for field := range entry {
			if !allowedFields[field] {
				t.Fatalf("unexpected observability field %q in %#v", field, entry)
			}
		}
		key, _ := entry["event"].(string)
		outcome, _ := entry["outcome"].(string)
		if _, expected := required[key+"/"+outcome]; expected {
			required[key+"/"+outcome] = true
		}
	}
	for code, present := range required {
		if !present {
			t.Errorf("missing event/outcome code %s in logs: %s", code, output.String())
		}
	}

	for _, secret := range []string{
		"database-error-secret", "provider-error-secret", "session-store-error-secret",
		"transaction-store-error-secret", "logout-store-error-secret", "logout-all-store-error-secret",
		"bot-send-error-secret", "private-route-marker", "private-query-marker", "private-start-marker",
		"private-metadata-marker", "private-origin-marker", "private-csrf-marker",
		"private-message-marker", "Sensitive Person", "private_username", "+998909998877",
		"8877665544332211", "8877665544", "authorization-code-secret", "phone-code-secret", "provider-code-secret",
		"exchange-failure-code-secret", "token-failure-code-secret", "profile-failure-code-secret",
		"token-type-failure-code-secret", "id-token-failure-code-secret", "verify-failure-code-secret",
		"metadata-failure-code-secret", "claims-failure-code-secret", "nonce-failure-code-secret",
		"issued-at-failure-code-secret",
		"blocked-code-secret", "store-code-secret", "expired-code-secret", testConfig().OIDCClientSecret,
		botConfig.BotToken, botConfig.BotWebhookSecret, startState, startBinding, sessionToken,
		expiredState, expiredBinding, phoneState, phoneBinding, providerState, providerBinding,
		blockedState, blockedBinding, storeState, storeBinding, logoutToken, logoutAllToken,
		"/__auth/", "Origin", "Cookie", "X-Telegram-Bot-Api-Secret-Token",
	} {
		if secret != "" && strings.Contains(output.String(), secret) {
			t.Errorf("observability log leaked sensitive value %q", secret)
		}
	}
}
