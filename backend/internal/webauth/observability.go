package webauth

import (
	"context"
	"errors"
	"log/slog"
)

type eventCode string
type outcomeCode string

const (
	eventHealth        eventCode = "health"
	eventLoginStart    eventCode = "login_start"
	eventLoginCallback eventCode = "login_callback"
	eventLogout        eventCode = "logout"
	eventLogoutAll     eventCode = "logout_all"
	eventBotWebhook    eventCode = "bot_webhook"

	outcomeSuccess             outcomeCode = "success"
	outcomeDatabaseUnavailable outcomeCode = "database_unavailable"
	outcomeStoreFailed         outcomeCode = "store_failed"
	outcomeExpired             outcomeCode = "expired"
	outcomePhoneRequired       outcomeCode = "phone_required"
	outcomeProviderFailed      outcomeCode = "provider_failed"
	outcomeOIDCExchangeFailed  outcomeCode = "oidc_exchange_failed"
	outcomeOIDCTokenFailed     outcomeCode = "oidc_token_failed"
	outcomeOIDCTokenTypeFailed outcomeCode = "oidc_token_type_failed"
	outcomeOIDCIDTokenFailed   outcomeCode = "oidc_id_token_failed"
	outcomeOIDCVerifyFailed    outcomeCode = "oidc_verify_failed"
	outcomeOIDCMetadataFailed  outcomeCode = "oidc_metadata_failed"
	outcomeOIDCClaimsFailed    outcomeCode = "oidc_claims_failed"
	outcomeOIDCNonceFailed     outcomeCode = "oidc_nonce_failed"
	outcomeOIDCIssuedAtFailed  outcomeCode = "oidc_issued_at_failed"
	outcomeOIDCProfileFailed   outcomeCode = "oidc_profile_failed"
	outcomeAccountBlocked      outcomeCode = "account_blocked"
	outcomeSendFailed          outcomeCode = "send_failed"
	outcomeMetadataRejected    outcomeCode = "metadata_rejected"
	outcomeContentTypeRejected outcomeCode = "content_type_rejected"
	outcomeFormRejected        outcomeCode = "form_rejected"
	outcomeCSRFRejected        outcomeCode = "csrf_rejected"
	outcomeBindingRejected     outcomeCode = "binding_rejected"
)

func providerFailureOutcome(err error) outcomeCode {
	switch {
	case errors.Is(err, ErrOIDCExchange):
		return outcomeOIDCExchangeFailed
	case errors.Is(err, errOIDCTokenType):
		return outcomeOIDCTokenTypeFailed
	case errors.Is(err, errOIDCIDToken):
		return outcomeOIDCIDTokenFailed
	case errors.Is(err, errOIDCVerification):
		return outcomeOIDCVerifyFailed
	case errors.Is(err, errOIDCMetadata):
		return outcomeOIDCMetadataFailed
	case errors.Is(err, errOIDCClaims):
		return outcomeOIDCClaimsFailed
	case errors.Is(err, errOIDCNonce):
		return outcomeOIDCNonceFailed
	case errors.Is(err, errOIDCIssuedAt):
		return outcomeOIDCIssuedAtFailed
	case errors.Is(err, ErrOIDCToken):
		return outcomeOIDCTokenFailed
	case errors.Is(err, ErrInvalidOIDCProfile):
		return outcomeOIDCProfileFailed
	default:
		return outcomeProviderFailed
	}
}

// logEvent deliberately accepts only closed code types and emits no request
// context or dynamic error text. This keeps credentials and user PII outside
// authentication logs even if a handler receives hostile input.
func (server *Server) logEvent(level slog.Level, event eventCode, outcome outcomeCode) {
	server.logger.LogAttrs(context.Background(), level, "web_auth_event",
		slog.String("event", string(event)),
		slog.String("outcome", string(outcome)),
	)
}
