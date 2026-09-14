package domain

import (
	"encoding/json"
	"testing"
)

func TestUnitCompletionJSONIsOptional(t *testing.T) {
	completion := "2028"
	body, err := json.Marshal(Unit{Completion: &completion})
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["completion"] != completion {
		t.Fatalf("completion=%v, want %q", payload["completion"], completion)
	}

	body, err = json.Marshal(Unit{})
	if err != nil {
		t.Fatal(err)
	}
	payload = nil
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if _, exists := payload["completion"]; exists {
		t.Fatal("missing source completion must be omitted from the API response")
	}
}
