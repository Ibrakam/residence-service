package webauth

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type fakeOIDCServer struct {
	server        *httptest.Server
	privateKey    *rsa.PrivateKey
	clientID      string
	clientSecret  string
	nonce         string
	requests      atomic.Int64
	tokenCalls    atomic.Int64
	jwksCalls     atomic.Int64
	redirectCalls atomic.Int64
}

func newFakeOIDCServer(t *testing.T) *fakeOIDCServer {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	fake := &fakeOIDCServer{privateKey: key, clientID: "998877", clientSecret: "test-client-secret", nonce: "expected-nonce"}
	fake.server = httptest.NewServer(http.HandlerFunc(fake.serveHTTP))
	t.Cleanup(fake.server.Close)
	return fake
}

func (fake *fakeOIDCServer) serveHTTP(response http.ResponseWriter, request *http.Request) {
	fake.requests.Add(1)
	switch request.URL.Path {
	case "/token":
		fake.tokenCalls.Add(1)
		clientID, clientSecret, ok := request.BasicAuth()
		if !ok || clientID != fake.clientID || clientSecret != fake.clientSecret {
			http.Error(response, "unauthorized", http.StatusUnauthorized)
			return
		}
		if err := request.ParseForm(); err != nil || request.Form.Get("grant_type") != "authorization_code" || request.Form.Get("code_verifier") != "test-verifier" || request.Form.Get("client_id") != fake.clientID {
			http.Error(response, "bad token request", http.StatusBadRequest)
			return
		}
		if request.Form.Get("code") == "redirect-token" {
			response.Header().Set("Location", fake.server.URL+"/capture")
			response.WriteHeader(http.StatusTemporaryRedirect)
			return
		}
		claims := fake.claimsForCode(request.Form.Get("code"))
		token, err := fake.sign(claims, request.Form.Get("code") != "wrong-alg")
		if err != nil {
			http.Error(response, "signing failed", http.StatusInternalServerError)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		tokenType := "Bearer"
		if request.Form.Get("code") == "wrong-token-type" {
			tokenType = "MAC"
		}
		_ = json.NewEncoder(response).Encode(map[string]any{
			"access_token": "not-used", "token_type": tokenType, "expires_in": 3600, "id_token": token,
		})
	case "/.well-known/jwks.json":
		fake.jwksCalls.Add(1)
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(map[string]any{"keys": []any{map[string]any{
			"kty": "RSA", "kid": "test-key", "use": "sig", "alg": "RS256",
			"n": base64.RawURLEncoding.EncodeToString(fake.privateKey.PublicKey.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(fake.privateKey.PublicKey.E)).Bytes()),
		}}})
	case "/capture":
		fake.redirectCalls.Add(1)
		response.WriteHeader(http.StatusNoContent)
	default:
		http.NotFound(response, request)
	}
}

func (fake *fakeOIDCServer) claimsForCode(code string) map[string]any {
	now := time.Now()
	claims := map[string]any{
		"iss": fake.server.URL, "aud": fake.clientID, "sub": "telegram-subject",
		"iat": now.Unix(), "exp": now.Add(time.Hour).Unix(), "nonce": fake.nonce,
		"id": int64(556677), "name": "John Doe", "given_name": "John", "family_name": "Doe",
		"preferred_username": "johndoe", "picture": "https://cdn4.telesco.pe/file/photo",
		"phone_number": "998901234567", "phone_number_verified": true,
	}
	switch code {
	case "wrong-issuer":
		claims["iss"] = "https://issuer.example"
	case "wrong-audience":
		claims["aud"] = "attacker-client"
	case "multiple-audiences":
		claims["aud"] = []string{fake.clientID, "another-client"}
	case "expired":
		claims["exp"] = now.Add(-time.Hour).Unix()
	case "missing-expiry":
		delete(claims, "exp")
	case "unverified-phone":
		claims["phone_number_verified"] = false
	case "missing-phone":
		delete(claims, "phone_number")
	case "future-issued":
		claims["iat"] = now.Add(10 * time.Minute).Unix()
	case "invalid-picture":
		claims["picture"] = "http://insecure.example/photo"
	}
	return claims
}

func (fake *fakeOIDCServer) sign(claims map[string]any, validAlgorithm bool) (string, error) {
	algorithm := "RS256"
	if !validAlgorithm {
		algorithm = "HS256"
	}
	header, _ := json.Marshal(map[string]any{"alg": algorithm, "kid": "test-key", "typ": "JWT"})
	payload, _ := json.Marshal(claims)
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	digest := sha256.Sum256([]byte(unsigned))
	signature, err := rsa.SignPKCS1v15(rand.Reader, fake.privateKey, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func newOIDCClientForFake(t *testing.T, fake *fakeOIDCServer) *TelegramOIDC {
	t.Helper()
	cfg := testConfig()
	cfg.PublicOrigin = "http://127.0.0.1:9090"
	cfg.OIDCIssuer = fake.server.URL
	cfg.OIDCClientID = fake.clientID
	cfg.OIDCClientSecret = fake.clientSecret
	provider, err := NewTelegramOIDC(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	return provider
}

func TestOIDCConstructionIsOfflineAndAuthorizationUsesPKCEPhoneScope(t *testing.T) {
	fake := newFakeOIDCServer(t)
	provider := newOIDCClientForFake(t, fake)
	if fake.requests.Load() != 0 {
		t.Fatalf("constructor made %d provider requests", fake.requests.Load())
	}
	authorizationURL, err := url.Parse(provider.AuthorizationURL("state", "nonce", "challenge"))
	if err != nil {
		t.Fatal(err)
	}
	query := authorizationURL.Query()
	if authorizationURL.Path != "/auth" || query.Get("response_type") != "code" || query.Get("scope") != "openid profile phone" || query.Get("state") != "state" || query.Get("nonce") != "nonce" || query.Get("code_challenge") != "challenge" || query.Get("code_challenge_method") != "S256" {
		t.Fatalf("authorization URL = %s", authorizationURL)
	}
}

func TestOIDCExchangeValidatesTokenAndNormalizesPhone(t *testing.T) {
	fake := newFakeOIDCServer(t)
	provider := newOIDCClientForFake(t, fake)
	identity, err := provider.Exchange(context.Background(), "valid", "test-verifier", fake.nonce)
	if err != nil {
		t.Fatal(err)
	}
	if identity.Issuer != fake.server.URL || identity.Subject != "telegram-subject" || identity.TelegramID != 556677 || identity.PhoneNumber != "+998901234567" || !identity.PhoneNumberVerified {
		t.Fatalf("identity = %#v", identity)
	}
	if fake.tokenCalls.Load() != 1 || fake.jwksCalls.Load() != 1 {
		t.Fatalf("provider calls token=%d jwks=%d", fake.tokenCalls.Load(), fake.jwksCalls.Load())
	}
}

func TestOIDCExchangeRejectsInvalidSecurityClaims(t *testing.T) {
	tests := []struct {
		code          string
		nonce         string
		expectedError error
	}{
		{"wrong-audience", "expected-nonce", ErrOIDCToken},
		{"wrong-issuer", "expected-nonce", ErrOIDCToken},
		{"multiple-audiences", "expected-nonce", ErrOIDCToken},
		{"expired", "expected-nonce", ErrOIDCToken},
		{"missing-expiry", "expected-nonce", ErrOIDCToken},
		{"valid", "wrong-nonce", ErrOIDCToken},
		{"future-issued", "expected-nonce", ErrOIDCToken},
		{"wrong-alg", "expected-nonce", ErrOIDCToken},
		{"wrong-token-type", "expected-nonce", ErrOIDCToken},
		{"unverified-phone", "expected-nonce", ErrPhoneNotShared},
		{"missing-phone", "expected-nonce", ErrPhoneNotShared},
		{"invalid-picture", "expected-nonce", ErrInvalidOIDCProfile},
	}
	for _, item := range tests {
		t.Run(item.code+"-"+item.nonce, func(t *testing.T) {
			fake := newFakeOIDCServer(t)
			provider := newOIDCClientForFake(t, fake)
			_, err := provider.Exchange(context.Background(), item.code, "test-verifier", item.nonce)
			if !errors.Is(err, item.expectedError) {
				t.Fatalf("error = %v, want %v", err, item.expectedError)
			}
		})
	}
}

func TestOIDCExchangeErrorsAreSanitized(t *testing.T) {
	fake := newFakeOIDCServer(t)
	provider := newOIDCClientForFake(t, fake)
	_, err := provider.Exchange(context.Background(), "", "wrong-verifier", fake.nonce)
	if !errors.Is(err, ErrOIDCExchange) || strings.Contains(fmt.Sprint(err), "wrong-verifier") {
		t.Fatalf("exchange error = %q", err)
	}
}

func TestOIDCClientDoesNotFollowTokenEndpointRedirects(t *testing.T) {
	fake := newFakeOIDCServer(t)
	provider := newOIDCClientForFake(t, fake)
	_, err := provider.Exchange(context.Background(), "redirect-token", "test-verifier", fake.nonce)
	if !errors.Is(err, ErrOIDCExchange) || fake.redirectCalls.Load() != 0 {
		t.Fatalf("exchange error=%v redirected requests=%d", err, fake.redirectCalls.Load())
	}
}

func TestNormalizePhone(t *testing.T) {
	for input, expected := range map[string]string{"998901234567": "+998901234567", "+14155552671": "+14155552671"} {
		actual, ok := normalizePhone(input)
		if !ok || actual != expected {
			t.Errorf("normalizePhone(%q) = %q, %v", input, actual, ok)
		}
	}
	for _, input := range []string{"", "+012345678", "+123", "+123 456789", strings.Repeat("1", 16)} {
		if actual, ok := normalizePhone(input); ok {
			t.Errorf("normalizePhone(%q) accepted as %q", input, actual)
		}
	}
}

func TestJWKSExponentEncodingFixture(t *testing.T) {
	// Guard the small conversion used by the fake JWKS server itself.
	if got := base64.RawURLEncoding.EncodeToString(big.NewInt(65537).Bytes()); got != "AQAB" {
		t.Fatalf("exponent = %s (%s)", got, strconv.Itoa(65537))
	}
}
