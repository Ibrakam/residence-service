package webauth

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tencorp/real-estate-platform/backend/internal/webauth/ui"
)

const APIVersion = "tencorp-auth/v1"

type Server struct {
	cfg              Config
	store            authStore
	provider         identityProvider
	bot              botMessenger
	botWebhookSecret [32]byte
	logger           *slog.Logger
	now              func() time.Time
	handler          http.Handler
}

func NewServer(cfg Config, store authStore, provider identityProvider, options ...ServerOption) (*Server, error) {
	if store == nil || provider == nil {
		return nil, errors.New("auth store and identity provider are required")
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	runtimeConfig := cfg
	runtimeConfig.DatabaseURL = ""
	runtimeConfig.OIDCClientSecret = ""
	runtimeConfig.BotToken = ""
	runtimeConfig.BotWebhookSecret = ""
	server := &Server{
		cfg: runtimeConfig, store: store, provider: provider,
		logger: slog.New(slog.DiscardHandler), now: func() time.Time { return time.Now().UTC() },
	}
	for _, option := range options {
		option(server)
	}
	if cfg.BotWebhookEnabled && server.bot == nil {
		return nil, errors.New("Telegram bot webhook is enabled without a bot client")
	}
	if cfg.BotWebhookEnabled {
		server.botWebhookSecret = tokenHash(cfg.BotWebhookSecret)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", server.handleHealth)
	mux.HandleFunc("GET /privacy", server.handlePrivacy)
	mux.HandleFunc("GET /__auth/assets/{name}", func(response http.ResponseWriter, request *http.Request) {
		ui.ServeAsset(response, request, request.PathValue("name"))
	})
	mux.HandleFunc("GET /__auth/login", server.handleLogin)
	mux.HandleFunc("POST /__auth/telegram/start", server.handleStart)
	mux.HandleFunc("GET /__auth/telegram/callback", server.handleCallback)
	mux.HandleFunc("GET /__auth/me", server.handleMe)
	mux.HandleFunc("GET /__auth/account", server.handleAccount)
	mux.HandleFunc("POST /__auth/logout", server.handleLogout)
	mux.HandleFunc("POST /__auth/logout-all", server.handleLogoutAll)
	mux.HandleFunc("GET /internal/check", server.handleCheck)
	if cfg.BotWebhookEnabled {
		mux.HandleFunc("POST /__auth/telegram/bot-webhook", server.handleBotWebhook)
	}
	server.handler = authSecurityHeaders(limitRequestHeaders(mux))
	return server, nil
}

type ServerOption func(*Server)

func WithTelegramBot(bot botMessenger) ServerOption {
	return func(server *Server) { server.bot = bot }
}

func WithLogger(logger *slog.Logger) ServerOption {
	return func(server *Server) {
		if logger != nil {
			server.logger = logger
		}
	}
}

func (server *Server) Handler() http.Handler { return server.handler }

func (server *Server) handleHealth(response http.ResponseWriter, request *http.Request) {
	ctx, cancel := context.WithTimeout(request.Context(), 2*time.Second)
	defer cancel()
	if err := server.store.Ping(ctx); err != nil {
		server.logEvent(slog.LevelWarn, eventHealth, outcomeDatabaseUnavailable)
		writeJSON(response, http.StatusServiceUnavailable, map[string]any{"ok": false, "version": APIVersion})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"ok": true, "version": APIVersion})
}

func (server *Server) handlePrivacy(response http.ResponseWriter, request *http.Request) {
	if err := ui.RenderPrivacy(response, ui.PrivacyModel{
		Language: request.URL.Query().Get("lang"), AcceptLanguage: request.Header.Get("Accept-Language"),
		TransactionTTL: server.cfg.TransactionTTL, SessionTTL: server.cfg.SessionTTL,
	}); err != nil {
		http.Error(response, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
	}
}

func (server *Server) handleLogin(response http.ResponseWriter, request *http.Request) {
	rawReturnTo := request.URL.Query().Get("return_to")
	if rawReturnTo == "" {
		rawReturnTo = request.Header.Get("X-Original-URI")
	}
	returnTo := safeReturnTo(rawReturnTo)
	if _, err := server.requestUser(request); err == nil {
		http.Redirect(response, request, returnTo, http.StatusSeeOther)
		return
	} else if !errors.Is(err, ErrSessionNotFound) {
		server.renderError(response, request, http.StatusServiceUnavailable, "temporarily_unavailable")
		return
	}
	csrfToken := server.prepareFormCSRF(response, request)
	errorCode := request.URL.Query().Get("error")
	if errorCode != "session_expired" && errorCode != "phone_required" {
		errorCode = ""
	}
	if err := ui.RenderLogin(response, ui.Model{
		Language: request.URL.Query().Get("lang"), AcceptLanguage: request.Header.Get("Accept-Language"),
		ReturnTo: returnTo, CSRFToken: csrfToken, ErrorCode: errorCode, StatusCode: http.StatusOK,
	}); err != nil {
		server.renderError(response, request, http.StatusInternalServerError, "render_failed")
	}
}

func (server *Server) handleStart(response http.ResponseWriter, request *http.Request) {
	originVerified, metadataOK := server.startPOSTMetadata(request)
	if !metadataOK {
		server.logEvent(slog.LevelWarn, eventLoginStart, outcomeMetadataRejected)
		server.renderError(response, request, http.StatusForbidden, "invalid_request_origin")
		return
	}
	request.Body = http.MaxBytesReader(response, request.Body, 4<<10)
	contentTypes := request.Header.Values("Content-Type")
	if len(contentTypes) != 1 || strings.ToLower(strings.TrimSpace(strings.Split(contentTypes[0], ";")[0])) != "application/x-www-form-urlencoded" {
		server.logEvent(slog.LevelWarn, eventLoginStart, outcomeContentTypeRejected)
		server.renderError(response, request, http.StatusUnsupportedMediaType, "invalid_request")
		return
	}
	if err := request.ParseForm(); err != nil {
		server.logEvent(slog.LevelWarn, eventLoginStart, outcomeFormRejected)
		server.renderError(response, request, http.StatusBadRequest, "invalid_request")
		return
	}
	if !onlyFormKeys(request.PostForm, "return_to", "lang", "csrf_token") || len(request.PostForm["return_to"]) > 1 || len(request.PostForm["lang"]) > 1 || len(request.PostForm["csrf_token"]) > 1 {
		server.logEvent(slog.LevelWarn, eventLoginStart, outcomeFormRejected)
		server.renderError(response, request, http.StatusBadRequest, "invalid_request")
		return
	}
	csrfValues, hasCSRF := request.PostForm["csrf_token"]
	if (!originVerified || hasCSRF) && !validFormCSRF(request, first(csrfValues)) {
		server.logEvent(slog.LevelWarn, eventLoginStart, outcomeCSRFRejected)
		server.renderError(response, request, http.StatusForbidden, "invalid_request_origin")
		return
	}
	returnTo := safeReturnTo(request.PostForm.Get("return_to"))
	if _, err := server.requestUser(request); err == nil {
		http.Redirect(response, request, returnTo, http.StatusSeeOther)
		return
	} else if !errors.Is(err, ErrSessionNotFound) {
		server.renderError(response, request, http.StatusServiceUnavailable, "temporarily_unavailable")
		return
	}
	state, err := randomToken()
	if err != nil {
		server.renderError(response, request, http.StatusInternalServerError, "temporarily_unavailable")
		return
	}
	nonce, err := randomToken()
	if err != nil {
		server.renderError(response, request, http.StatusInternalServerError, "temporarily_unavailable")
		return
	}
	verifier, err := randomToken()
	if err != nil {
		server.renderError(response, request, http.StatusInternalServerError, "temporarily_unavailable")
		return
	}
	binding, err := browserBinding(request)
	if err != nil {
		server.logEvent(slog.LevelWarn, eventLoginStart, outcomeBindingRejected)
		server.renderError(response, request, http.StatusBadRequest, "invalid_request")
		return
	}
	// Refresh even an existing binding: a newly created transaction must never
	// outlive the cookie it is bound to.
	setBindingCookie(response, binding, server.cfg.TransactionTTL)
	now := server.now()
	transaction := LoginTransaction{
		StateHash: tokenHash(state), BindingHash: tokenHash(binding), Nonce: nonce,
		CodeVerifier: verifier, ReturnTo: returnTo, ExpiresAt: now.Add(server.cfg.TransactionTTL),
	}
	if err := server.store.CreateLoginTransaction(request.Context(), transaction, now); err != nil {
		server.logEvent(slog.LevelError, eventLoginStart, outcomeStoreFailed)
		server.renderError(response, request, http.StatusServiceUnavailable, "temporarily_unavailable")
		return
	}
	server.logEvent(slog.LevelInfo, eventLoginStart, outcomeSuccess)
	response.Header().Set("Location", server.provider.AuthorizationURL(state, nonce, pkceChallenge(verifier)))
	response.WriteHeader(http.StatusSeeOther)
}

func (server *Server) handleCallback(response http.ResponseWriter, request *http.Request) {
	query := request.URL.Query()
	state, ok := exactlyOne(query, "state")
	if !ok || !validToken(state) {
		server.renderError(response, request, http.StatusBadRequest, "invalid_login_state")
		return
	}
	binding, err := uniqueCookie(request, BindingCookie)
	if err != nil || !validToken(binding) {
		server.renderError(response, request, http.StatusBadRequest, "invalid_login_state")
		return
	}
	transaction, err := server.store.ConsumeLoginTransaction(request.Context(), tokenHash(state), tokenHash(binding), server.now())
	if errors.Is(err, ErrLoginTransactionNotFound) {
		server.logEvent(slog.LevelInfo, eventLoginCallback, outcomeExpired)
		server.renderError(response, request, http.StatusBadRequest, "expired_login")
		return
	}
	if err != nil {
		server.logEvent(slog.LevelError, eventLoginCallback, outcomeStoreFailed)
		server.renderError(response, request, http.StatusServiceUnavailable, "temporarily_unavailable")
		return
	}
	errorValues, hasError := query["error"]
	codeValues, hasCode := query["code"]
	if hasError {
		oauthError := first(errorValues)
		if len(errorValues) != 1 || hasCode || oauthError == "" || len(oauthError) > 128 {
			server.renderErrorWithReturnTo(response, request, http.StatusBadRequest, "invalid_callback", transaction.ReturnTo)
			return
		}
		server.renderErrorWithReturnTo(response, request, http.StatusUnauthorized, "login_cancelled", transaction.ReturnTo)
		return
	}
	code := first(codeValues)
	if !hasCode || len(codeValues) != 1 || code == "" || len(code) > 4096 || strings.ContainsAny(code, "\r\n\x00") {
		server.renderErrorWithReturnTo(response, request, http.StatusBadRequest, "invalid_callback", transaction.ReturnTo)
		return
	}
	identity, err := server.provider.Exchange(request.Context(), code, transaction.CodeVerifier, transaction.Nonce)
	if errors.Is(err, ErrPhoneNotShared) {
		server.logEvent(slog.LevelInfo, eventLoginCallback, outcomePhoneRequired)
		server.renderErrorWithReturnTo(response, request, http.StatusForbidden, "phone_required", transaction.ReturnTo)
		return
	}
	if err != nil {
		server.logEvent(slog.LevelWarn, eventLoginCallback, providerFailureOutcome(err))
		server.renderErrorWithReturnTo(response, request, http.StatusUnauthorized, "telegram_login_failed", transaction.ReturnTo)
		return
	}
	sessionToken, err := randomToken()
	if err != nil {
		server.renderError(response, request, http.StatusInternalServerError, "temporarily_unavailable")
		return
	}
	now := server.now()
	_, err = server.store.CreateSession(request.Context(), identity, tokenHash(sessionToken), now, now.Add(server.cfg.SessionTTL))
	if errors.Is(err, ErrUserBlocked) {
		server.logEvent(slog.LevelWarn, eventLoginCallback, outcomeAccountBlocked)
		server.renderErrorWithReturnTo(response, request, http.StatusForbidden, "account_blocked", transaction.ReturnTo)
		return
	}
	if err != nil {
		server.logEvent(slog.LevelError, eventLoginCallback, outcomeStoreFailed)
		server.renderErrorWithReturnTo(response, request, http.StatusServiceUnavailable, "temporarily_unavailable", transaction.ReturnTo)
		return
	}
	setSessionCookie(response, sessionToken, now.Add(server.cfg.SessionTTL), server.cfg.SessionTTL)
	server.logEvent(slog.LevelInfo, eventLoginCallback, outcomeSuccess)
	response.Header().Set("Location", safeReturnTo(transaction.ReturnTo))
	response.WriteHeader(http.StatusSeeOther)
}

func (server *Server) handleCheck(response http.ResponseWriter, request *http.Request) {
	user, err := server.requestUser(request)
	if errors.Is(err, ErrSessionNotFound) {
		response.Header().Set("WWW-Authenticate", `Session realm="tencorp"`)
		response.WriteHeader(http.StatusUnauthorized)
		return
	}
	if err != nil {
		response.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	response.Header().Set("X-Auth-User-ID", strconv.FormatInt(user.ID, 10))
	response.Header().Set("X-Auth-Telegram-ID", strconv.FormatInt(user.TelegramID, 10))
	response.WriteHeader(http.StatusNoContent)
}

func (server *Server) handleMe(response http.ResponseWriter, request *http.Request) {
	user, err := server.requestUser(request)
	if errors.Is(err, ErrSessionNotFound) {
		writeJSON(response, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if err != nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "temporarily_unavailable"})
		return
	}
	writeJSON(response, http.StatusOK, publicUser(user))
}

func (server *Server) handleAccount(response http.ResponseWriter, request *http.Request) {
	user, err := server.requestUser(request)
	if errors.Is(err, ErrSessionNotFound) {
		clearSessionCookie(response)
		destination := url.Values{"return_to": {"/__auth/account"}}
		if language := request.URL.Query().Get("lang"); language != "" {
			destination.Set("lang", language)
		}
		response.Header().Set("Location", "/__auth/login?"+destination.Encode())
		response.WriteHeader(http.StatusSeeOther)
		return
	}
	if err != nil {
		server.renderError(response, request, http.StatusServiceUnavailable, "temporarily_unavailable")
		return
	}
	if err := ui.RenderAccount(response, ui.AccountModel{
		Language: request.URL.Query().Get("lang"), AcceptLanguage: request.Header.Get("Accept-Language"),
		Name: user.Name, Username: user.Username, TelegramID: user.TelegramID,
		SessionExpiresAt: user.ExpiresAt,
	}); err != nil {
		server.renderError(response, request, http.StatusInternalServerError, "render_failed")
	}
}

func (server *Server) handleLogout(response http.ResponseWriter, request *http.Request) {
	if !server.sameOriginPOST(request) {
		writeJSON(response, http.StatusForbidden, map[string]string{"error": "invalid_request_origin"})
		return
	}
	token, err := uniqueCookie(request, SessionCookie)
	if err == nil && validToken(token) {
		if err := server.store.DeleteSession(request.Context(), tokenHash(token)); err != nil {
			server.logEvent(slog.LevelError, eventLogout, outcomeStoreFailed)
			if isHTMLNavigation(request) {
				server.renderError(response, request, http.StatusServiceUnavailable, "temporarily_unavailable")
				return
			}
			writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "temporarily_unavailable"})
			return
		}
	}
	clearSessionCookie(response)
	finishLogout(response, request)
}

func (server *Server) handleLogoutAll(response http.ResponseWriter, request *http.Request) {
	if !server.sameOriginPOST(request) {
		writeJSON(response, http.StatusForbidden, map[string]string{"error": "invalid_request_origin"})
		return
	}
	user, err := server.requestUser(request)
	if errors.Is(err, ErrSessionNotFound) {
		clearSessionCookie(response)
		if isHTMLNavigation(request) {
			response.Header().Set("Location", "/__auth/login?error=session_expired")
			response.WriteHeader(http.StatusSeeOther)
			return
		}
		writeJSON(response, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if err != nil {
		server.logEvent(slog.LevelError, eventLogoutAll, outcomeStoreFailed)
		if isHTMLNavigation(request) {
			server.renderError(response, request, http.StatusServiceUnavailable, "temporarily_unavailable")
			return
		}
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "temporarily_unavailable"})
		return
	}
	if err := server.store.DeleteAllUserSessions(request.Context(), user.ID); err != nil {
		server.logEvent(slog.LevelError, eventLogoutAll, outcomeStoreFailed)
		if isHTMLNavigation(request) {
			server.renderError(response, request, http.StatusServiceUnavailable, "temporarily_unavailable")
			return
		}
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "temporarily_unavailable"})
		return
	}
	clearSessionCookie(response)
	finishLogout(response, request)
}

func finishLogout(response http.ResponseWriter, request *http.Request) {
	if isHTMLNavigation(request) {
		response.Header().Set("Location", "/__auth/login")
		response.WriteHeader(http.StatusSeeOther)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func isHTMLNavigation(request *http.Request) bool {
	mode, destination := request.Header.Get("Sec-Fetch-Mode"), request.Header.Get("Sec-Fetch-Dest")
	return (mode == "" || mode == "navigate") && (destination == "" || destination == "document") &&
		strings.Contains(strings.ToLower(request.Header.Get("Accept")), "text/html")
}

func (server *Server) requestUser(request *http.Request) (User, error) {
	token, err := uniqueCookie(request, SessionCookie)
	if err != nil || !validToken(token) {
		return User{}, ErrSessionNotFound
	}
	return server.store.Session(request.Context(), tokenHash(token), server.now())
}

func (server *Server) sameOriginPOST(request *http.Request) bool {
	origins := request.Header.Values("Origin")
	if request.Method != http.MethodPost || len(origins) != 1 || origins[0] != server.cfg.PublicOrigin {
		return false
	}
	fetchSites := request.Header.Values("Sec-Fetch-Site")
	return len(fetchSites) == 0 || len(fetchSites) == 1 && fetchSites[0] == "same-origin"
}

// startPOSTMetadata distinguishes an explicitly trusted Origin from browsers
// that omit Origin on a same-origin HTML form navigation. Explicitly foreign
// or ambiguous Origin/Fetch Metadata is always rejected. A missing Origin is
// accepted by handleStart only after validating the double-submit form token.
func (server *Server) startPOSTMetadata(request *http.Request) (originVerified, ok bool) {
	if request.Method != http.MethodPost {
		return false, false
	}
	fetchSites := request.Header.Values("Sec-Fetch-Site")
	if len(fetchSites) > 1 || len(fetchSites) == 1 && fetchSites[0] != "same-origin" {
		return false, false
	}
	origins := request.Header.Values("Origin")
	if len(origins) > 1 {
		return false, false
	}
	// Referrer-Policy: no-referrer causes browsers to serialize the Origin of
	// a navigation POST as the literal value "null". Treat that value like an
	// omitted Origin, never as a verified origin: handleStart will still require
	// the form token derived from the HttpOnly browser-binding cookie.
	if len(origins) == 0 || origins[0] == "null" {
		return false, true
	}
	if origins[0] != server.cfg.PublicOrigin {
		return false, false
	}
	return true, true
}

func (server *Server) renderError(response http.ResponseWriter, request *http.Request, status int, code string) {
	server.renderErrorWithReturnTo(response, request, status, code, "/")
}

func (server *Server) renderErrorWithReturnTo(response http.ResponseWriter, request *http.Request, status int, code, returnTo string) {
	if err := ui.RenderError(response, ui.Model{
		Language: request.URL.Query().Get("lang"), AcceptLanguage: request.Header.Get("Accept-Language"),
		ReturnTo: safeReturnTo(returnTo), CSRFToken: server.prepareFormCSRF(response, request), ErrorCode: code, StatusCode: status,
		NoReferrer: request.URL.Path == "/__auth/telegram/callback",
	}); err != nil {
		http.Error(response, http.StatusText(status), status)
	}
}

func exactlyOne(values url.Values, key string) (string, bool) {
	items, ok := values[key]
	return first(items), ok && len(items) == 1
}

func first(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func onlyFormKeys(values url.Values, allowed ...string) bool {
	allowlist := make(map[string]struct{}, len(allowed))
	for _, key := range allowed {
		allowlist[key] = struct{}{}
	}
	for key := range values {
		if _, ok := allowlist[key]; !ok {
			return false
		}
	}
	return true
}

func safeReturnTo(raw string) string {
	if raw == "" || len(raw) > 4096 {
		return "/"
	}
	decoded := raw
	for depth := 0; depth < 8; depth++ {
		if unsafeReturnToLayer(decoded) {
			return "/"
		}
		next, err := url.PathUnescape(decoded)
		if err != nil {
			return "/"
		}
		if next == decoded {
			return raw
		}
		decoded = next
	}
	next, err := url.PathUnescape(decoded)
	if err != nil || next != decoded {
		return "/"
	}
	return raw
}

func unsafeReturnToLayer(value string) bool {
	if !utf8.ValidString(value) || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") || strings.ContainsAny(value, "\\#") {
		return true
	}
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return true
		}
	}
	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || parsed.User != nil || parsed.Path == "" || parsed.Fragment != "" || parsed.Opaque != "" {
		return true
	}
	normalizedPath := path.Clean(parsed.Path)
	if normalizedPath == "/__auth/account" {
		return false
	}
	return normalizedPath == "/__auth" || strings.HasPrefix(normalizedPath, "/__auth/") || normalizedPath == "/internal" || strings.HasPrefix(normalizedPath, "/internal/")
}

func browserBinding(request *http.Request) (string, error) {
	value, err := uniqueCookie(request, BindingCookie)
	if err == nil && validToken(value) {
		return value, nil
	}
	if err != nil && !errors.Is(err, http.ErrNoCookie) {
		return "", err
	}
	value, err = randomToken()
	return value, err
}

func (server *Server) prepareFormCSRF(response http.ResponseWriter, request *http.Request) string {
	binding, err := browserBinding(request)
	if err != nil {
		return ""
	}
	setBindingCookie(response, binding, server.cfg.TransactionTTL)
	return formCSRFToken(binding)
}

func validFormCSRF(request *http.Request, token string) bool {
	if !validToken(token) {
		return false
	}
	binding, err := uniqueCookie(request, BindingCookie)
	if err != nil || !validToken(binding) {
		return false
	}
	expected := formCSRFToken(binding)
	return len(expected) == len(token) && subtle.ConstantTimeCompare([]byte(expected), []byte(token)) == 1
}

func formCSRFToken(binding string) string {
	digest := tokenHash(binding)
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func uniqueCookie(request *http.Request, name string) (string, error) {
	var value string
	found := false
	for _, cookie := range request.Cookies() {
		if cookie.Name != name {
			continue
		}
		if found {
			return "", errors.New("duplicate cookie")
		}
		found, value = true, cookie.Value
	}
	if !found {
		return "", http.ErrNoCookie
	}
	return value, nil
}

func setSessionCookie(response http.ResponseWriter, value string, expires time.Time, ttl time.Duration) {
	http.SetCookie(response, &http.Cookie{
		Name: SessionCookie, Value: value, Path: "/", Expires: expires,
		MaxAge: int(ttl / time.Second), Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode,
	})
}

func clearSessionCookie(response http.ResponseWriter) {
	http.SetCookie(response, &http.Cookie{
		Name: SessionCookie, Path: "/", MaxAge: -1, Expires: time.Unix(1, 0),
		Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode,
	})
}

func setBindingCookie(response http.ResponseWriter, value string, ttl time.Duration) {
	http.SetCookie(response, &http.Cookie{
		Name: BindingCookie, Value: value, Path: "/", MaxAge: int(ttl / time.Second),
		Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode,
	})
}

func authSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		referrerPolicy := "same-origin"
		if request.URL.Path == "/__auth/telegram/callback" {
			// Never forward the authorization code or transaction state from the
			// callback URL, including to the same-origin return destination.
			referrerPolicy = "no-referrer"
		}
		response.Header().Set("Cache-Control", "no-store")
		response.Header().Set("Pragma", "no-cache")
		response.Header().Set("Referrer-Policy", referrerPolicy)
		response.Header().Set("X-Content-Type-Options", "nosniff")
		response.Header().Set("X-Frame-Options", "DENY")
		response.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		response.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		response.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		response.Header().Set("Content-Security-Policy", "default-src 'none'; img-src 'self'; font-src 'self'; form-action 'self' https://oauth.telegram.org; base-uri 'none'; frame-ancestors 'none'")
		next.ServeHTTP(response, request)
	})
}

func limitRequestHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		declaredBodyLimit := int64(16 << 10)
		if request.URL.Path == "/__auth/telegram/bot-webhook" {
			declaredBodyLimit = 64 << 10
		}
		if request.ContentLength > declaredBodyLimit || len(request.URL.RawQuery) > 16<<10 {
			http.Error(response, "request too large", http.StatusRequestEntityTooLarge)
			return
		}
		next.ServeHTTP(response, request)
	})
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}
