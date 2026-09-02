package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestEnqueueTestReadsStdinAndAuthenticates(t *testing.T) {
	token := strings.Repeat("t", 32)
	var received struct {
		Text string `json:"text"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/internal/ticket-runner/test-tickets" {
			t.Errorf("path = %q", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer "+token {
			t.Errorf("authorization was not forwarded")
		}
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Errorf("decode request: %v", err)
		}
		response.Header().Set("Content-Type", "application/json")
		response.WriteHeader(http.StatusCreated)
		_, _ = response.Write([]byte(`{"id":17,"status":"queued"}`))
	}))
	defer server.Close()
	parsedURL, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("TICKET_BOT_ADDR", parsedURL.Host)
	t.Setenv("TICKET_WORKER_API_TOKEN", token)
	var output bytes.Buffer
	if err := enqueueTest(nil, strings.NewReader("small synthetic task\n"), &output); err != nil {
		t.Fatal(err)
	}
	if received.Text != "small synthetic task" {
		t.Fatalf("received text = %q", received.Text)
	}
	if !strings.Contains(output.String(), `"id":17`) {
		t.Fatalf("output = %q", output.String())
	}
}

func TestCleanupAttachmentsRejectsUnsafeLimitsBeforeLoadingSecrets(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := cleanupAttachments([]string{"--batch-size=0"}, io.Discard, logger); err == nil {
		t.Fatal("unsafe cleanup batch size was accepted")
	}
}
