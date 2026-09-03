package webauth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
)

func randomToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", errors.New("read cryptographic random source")
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func validToken(value string) bool {
	raw, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(raw) == 32
}

func tokenHash(value string) [32]byte { return sha256.Sum256([]byte(value)) }

func pkceChallenge(verifier string) string {
	digest := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}
