package webauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

var (
	ErrOIDCExchange       = errors.New("oidc code exchange failed")
	ErrOIDCToken          = errors.New("oidc token validation failed")
	ErrPhoneNotShared     = errors.New("verified phone number is required")
	ErrInvalidOIDCProfile = errors.New("oidc profile is invalid")

	errOIDCTokenType    = fmt.Errorf("%w: token_type", ErrOIDCToken)
	errOIDCIDToken      = fmt.Errorf("%w: id_token", ErrOIDCToken)
	errOIDCVerification = fmt.Errorf("%w: verification", ErrOIDCToken)
	errOIDCMetadata     = fmt.Errorf("%w: metadata", ErrOIDCToken)
	errOIDCClaims       = fmt.Errorf("%w: claims", ErrOIDCToken)
	errOIDCNonce        = fmt.Errorf("%w: nonce", ErrOIDCToken)
	errOIDCIssuedAt     = fmt.Errorf("%w: issued_at", ErrOIDCToken)
)

type identityProvider interface {
	AuthorizationURL(state, nonce, codeChallenge string) string
	Exchange(context.Context, string, string, string) (TelegramIdentity, error)
}

type TelegramOIDC struct {
	issuer     string
	clientID   string
	oauth      oauth2.Config
	verifier   *oidc.IDTokenVerifier
	httpClient *http.Client
}

func NewTelegramOIDC(ctx context.Context, cfg Config) (*TelegramOIDC, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	client := directHTTPClient(cfg.HTTPTimeout)
	// Telegram documents stable endpoints. Avoid discovery at startup so a
	// temporary Telegram outage never prevents validation of existing local
	// sessions. The remote key set is fetched lazily only during a callback.
	endpoint := oauth2.Endpoint{
		AuthURL: cfg.OIDCIssuer + "/auth", TokenURL: cfg.OIDCIssuer + "/token",
		AuthStyle: oauth2.AuthStyleInHeader,
	}
	keySet := oidc.NewRemoteKeySet(oidc.ClientContext(ctx, client), cfg.OIDCIssuer+"/.well-known/jwks.json")
	return &TelegramOIDC{
		issuer:   cfg.OIDCIssuer,
		clientID: cfg.OIDCClientID,
		oauth: oauth2.Config{
			ClientID: cfg.OIDCClientID, ClientSecret: cfg.OIDCClientSecret,
			Endpoint: endpoint, RedirectURL: cfg.CallbackURL(),
			Scopes: []string{oidc.ScopeOpenID, "profile", "phone"},
		},
		verifier: oidc.NewVerifier(cfg.OIDCIssuer, keySet, &oidc.Config{
			ClientID:             cfg.OIDCClientID,
			SupportedSigningAlgs: []string{oidc.RS256},
		}),
		httpClient: client,
	}, nil
}

func (provider *TelegramOIDC) AuthorizationURL(state, nonce, codeChallenge string) string {
	return provider.oauth.AuthCodeURL(state,
		oauth2.SetAuthURLParam("nonce", nonce),
		oauth2.SetAuthURLParam("code_challenge", codeChallenge),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
	)
}

func (provider *TelegramOIDC) Exchange(ctx context.Context, code, verifier, expectedNonce string) (TelegramIdentity, error) {
	ctx = oidc.ClientContext(ctx, provider.httpClient)
	token, err := provider.oauth.Exchange(ctx, code,
		oauth2.VerifierOption(verifier),
		oauth2.SetAuthURLParam("client_id", provider.clientID),
	)
	if err != nil {
		return TelegramIdentity{}, ErrOIDCExchange
	}
	if !strings.EqualFold(token.TokenType, "Bearer") {
		return TelegramIdentity{}, errOIDCTokenType
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok || len(rawIDToken) < 128 || len(rawIDToken) > 32<<10 {
		return TelegramIdentity{}, errOIDCIDToken
	}
	idToken, err := provider.verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return TelegramIdentity{}, errOIDCVerification
	}
	if idToken.Issuer != provider.issuer || len(idToken.Audience) != 1 || idToken.Audience[0] != provider.clientID || idToken.Expiry.IsZero() {
		return TelegramIdentity{}, errOIDCMetadata
	}
	// The cryptographic verifier above has already validated and decoded the
	// standard OIDC claims. Keep provider-specific values raw here so harmless
	// serializer differences in optional Telegram profile fields cannot reject
	// an otherwise valid login.
	var claims struct {
		TelegramID          json.RawMessage `json:"id"`
		Name                json.RawMessage `json:"name"`
		GivenName           json.RawMessage `json:"given_name"`
		FamilyName          json.RawMessage `json:"family_name"`
		Username            json.RawMessage `json:"preferred_username"`
		PictureURL          json.RawMessage `json:"picture"`
		PhoneNumber         json.RawMessage `json:"phone_number"`
		PhoneNumberVerified json.RawMessage `json:"phone_number_verified"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return TelegramIdentity{}, errOIDCClaims
	}
	// Telegram's authorization-code documentation and discovery metadata do not
	// advertise or guarantee a nonce claim. The callback is still bound by
	// state, the browser cookie, a one-time transaction, and S256 PKCE. If
	// Telegram does return a nonce, require it to match the transaction exactly.
	if idToken.Nonce != "" && idToken.Nonce != expectedNonce {
		return TelegramIdentity{}, errOIDCNonce
	}
	now := time.Now()
	if idToken.IssuedAt.Unix() <= 0 || idToken.IssuedAt.After(now.Add(2*time.Minute)) {
		return TelegramIdentity{}, errOIDCIssuedAt
	}
	telegramID, ok := positiveDecimalClaim(claims.TelegramID)
	if !ok {
		return TelegramIdentity{}, ErrInvalidOIDCProfile
	}
	phoneValue, ok := phoneClaim(claims.PhoneNumber)
	if !verifiedClaim(claims.PhoneNumberVerified) || !ok {
		return TelegramIdentity{}, ErrPhoneNotShared
	}
	phone, ok := normalizePhone(phoneValue)
	if !ok {
		return TelegramIdentity{}, ErrPhoneNotShared
	}
	name, _ := optionalStringClaim(claims.Name)
	givenName, _ := optionalStringClaim(claims.GivenName)
	familyName, _ := optionalStringClaim(claims.FamilyName)
	username, _ := optionalStringClaim(claims.Username)
	pictureURL, _ := optionalStringClaim(claims.PictureURL)
	if idToken.Subject == "" || !validProfileText(idToken.Subject, 255) || !validProfileText(name, 255) || !validProfileText(givenName, 255) || !validProfileText(familyName, 255) || !validProfileText(username, 64) {
		return TelegramIdentity{}, ErrInvalidOIDCProfile
	}
	if name == "" {
		name = strings.TrimSpace(strings.Join([]string{givenName, familyName}, " "))
	}
	if name == "" {
		name = "Telegram user " + strconv.FormatInt(telegramID, 10)
	}
	if pictureURL != "" {
		picture, err := url.Parse(pictureURL)
		if err != nil || picture.Scheme != "https" || picture.Hostname() == "" || picture.User != nil || len(pictureURL) > 2048 {
			return TelegramIdentity{}, ErrInvalidOIDCProfile
		}
	}
	return TelegramIdentity{
		Issuer: provider.issuer, Subject: idToken.Subject, TelegramID: telegramID,
		Name: name, GivenName: givenName, FamilyName: familyName,
		Username: username, PictureURL: pictureURL,
		PhoneNumber: phone, PhoneNumberVerified: true,
	}, nil
}

func optionalStringClaim(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", false
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false
	}
	return value, true
}

func positiveDecimalClaim(raw json.RawMessage) (int64, bool) {
	value, quoted := optionalStringClaim(raw)
	if !quoted {
		value = string(raw)
	}
	if value == "" || len(value) > 19 {
		return 0, false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return 0, false
		}
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	return parsed, err == nil && parsed > 0
}

func phoneClaim(raw json.RawMessage) (string, bool) {
	if value, ok := optionalStringClaim(raw); ok {
		return value, true
	}
	value := string(raw)
	if value == "" {
		return "", false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return "", false
		}
	}
	return value, true
}

func verifiedClaim(raw json.RawMessage) bool {
	switch string(raw) {
	case "true", "1":
		return true
	}
	value, ok := optionalStringClaim(raw)
	return ok && (value == "true" || value == "1")
}

func normalizePhone(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, "+") {
		value = value[1:]
	}
	if len(value) < 8 || len(value) > 15 || value[0] == '0' {
		return "", false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return "", false
		}
	}
	return "+" + value, true
}

func validProfileText(value string, max int) bool {
	if len(value) > max || !utf8.ValidString(value) {
		return false
	}
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return false
		}
	}
	return true
}
