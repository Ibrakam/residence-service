package main

import (
	"strings"
	"testing"
)

func TestRunRejectsMissingAndMalformedMarkerBeforeListening(t *testing.T) {
	for _, args := range [][]string{nil, {"bad-marker"}, {strings.Repeat("a", 43), "extra"}} {
		if err := run(args); err == nil {
			t.Fatalf("args %q were accepted", args)
		}
	}
}
