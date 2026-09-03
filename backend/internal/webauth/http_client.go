package webauth

import (
	"net/http"
	"time"
)

func directHTTPClient(timeout time.Duration) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	// OIDC codes, PKCE verifiers, client credentials, and Bot API tokens must
	// not be routed through an ambient process proxy configuration.
	transport.Proxy = nil
	return &http.Client{
		Transport: transport,
		Timeout:   timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}
