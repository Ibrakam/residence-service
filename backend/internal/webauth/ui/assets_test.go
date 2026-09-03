package ui

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestServeAssetContract(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/__auth/assets/brand-city-v1.webp", nil)
	response := httptest.NewRecorder()
	ServeAsset(response, request, "brand-city-v1.webp")

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	if got := response.Header().Get("Content-Type"); got != "image/webp" {
		t.Fatalf("Content-Type = %q", got)
	}
	if got := response.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("Cache-Control = %q", got)
	}
	if response.Body.Len() == 0 || response.Header().Get("ETag") == "" {
		t.Fatal("asset response must include content and an ETag")
	}

	etag := response.Header().Get("ETag")
	notModifiedRequest := httptest.NewRequest(http.MethodGet, "/__auth/assets/brand-city-v1.webp", nil)
	notModifiedRequest.Header.Set("If-None-Match", etag)
	notModifiedResponse := httptest.NewRecorder()
	ServeAsset(notModifiedResponse, notModifiedRequest, "brand-city-v1.webp")
	if notModifiedResponse.Code != http.StatusNotModified || notModifiedResponse.Body.Len() != 0 {
		t.Fatalf("conditional response = %d with %d bytes", notModifiedResponse.Code, notModifiedResponse.Body.Len())
	}
}

func TestServeAssetSupportsHEADFontsAndRejectsUnknownNames(t *testing.T) {
	headRequest := httptest.NewRequest(http.MethodHead, "/__auth/assets/manrope-cyrillic-v1.woff2", nil)
	headResponse := httptest.NewRecorder()
	ServeAsset(headResponse, headRequest, "manrope-cyrillic-v1.woff2")
	if headResponse.Code != http.StatusOK || headResponse.Body.Len() != 0 {
		t.Fatalf("HEAD response = %d with %d bytes", headResponse.Code, headResponse.Body.Len())
	}
	if got := headResponse.Header().Get("Content-Type"); got != "font/woff2" {
		t.Fatalf("font Content-Type = %q", got)
	}

	unknownRequest := httptest.NewRequest(http.MethodGet, "/__auth/assets/missing.svg", nil)
	unknownResponse := httptest.NewRecorder()
	ServeAsset(unknownResponse, unknownRequest, "missing.svg")
	if unknownResponse.Code != http.StatusNotFound || !strings.Contains(unknownResponse.Body.String(), "404") {
		t.Fatalf("unknown response = %d %q", unknownResponse.Code, unknownResponse.Body.String())
	}
}
