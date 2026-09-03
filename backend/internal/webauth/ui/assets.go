package ui

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"net/http"
	"strconv"
)

// The authorization surface ships its own reduced copy of the TENCORP Hub
// artwork and fonts. Login therefore keeps the same visual identity even when
// the main application is unavailable or protected by the auth gate.

//go:embed assets/tencorp-city.webp
var tencorpCity []byte

//go:embed assets/manrope-cyrillic.woff2
var manropeCyrillic []byte

//go:embed assets/cormorant-normal.woff2
var cormorantNormal []byte

//go:embed assets/cormorant-italic.woff2
var cormorantItalic []byte

type embeddedAsset struct {
	contentType string
	content     []byte
}

var embeddedAssets = map[string]embeddedAsset{
	"brand-city-v1.webp":                 {contentType: "image/webp", content: tencorpCity},
	"manrope-cyrillic-v1.woff2":          {contentType: "font/woff2", content: manropeCyrillic},
	"cormorant-cyrillic-v1.woff2":        {contentType: "font/woff2", content: cormorantNormal},
	"cormorant-italic-cyrillic-v1.woff2": {contentType: "font/woff2", content: cormorantItalic},
}

// ServeAsset writes one fixed, versioned authorization asset. Unknown names
// remain ordinary 404s; the caller never maps a filesystem path.
func ServeAsset(response http.ResponseWriter, request *http.Request, name string) {
	asset, ok := embeddedAssets[name]
	if !ok {
		http.NotFound(response, request)
		return
	}
	digest := sha256.Sum256(asset.content)
	etag := `"` + hex.EncodeToString(digest[:]) + `"`
	response.Header().Set("Content-Type", asset.contentType)
	response.Header().Set("Content-Length", strconv.Itoa(len(asset.content)))
	response.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	response.Header().Set("ETag", etag)
	if request.Header.Get("If-None-Match") == etag {
		response.WriteHeader(http.StatusNotModified)
		return
	}
	if request.Method == http.MethodHead {
		response.WriteHeader(http.StatusOK)
		return
	}
	response.WriteHeader(http.StatusOK)
	_, _ = response.Write(asset.content)
}
