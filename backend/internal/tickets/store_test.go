package tickets

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestNormalizeMessageInputCapsUTF8BodyByOctets(t *testing.T) {
	input := normalizeMessageInput(MessageInput{
		UpdateID: 1, ChatID: -100, MessageID: 10, Body: strings.Repeat("я", 40000), Accept: true, ExplicitFix: true,
	})
	if !input.Accept {
		t.Fatal("bounded message was rejected")
	}
	if len(input.Body) > maxTicketBodyBytes || !utf8.ValidString(input.Body) {
		t.Fatalf("body bytes=%d validUTF8=%v", len(input.Body), utf8.ValidString(input.Body))
	}
	if len(input.Body) != maxTicketBodyBytes {
		t.Fatalf("body cap = %d bytes", len(input.Body))
	}
}

func TestNormalizeMessageInputRejectsInvalidMessageWithoutLosingUpdateIdentity(t *testing.T) {
	input := normalizeMessageInput(MessageInput{
		UpdateID: 42, ChatID: 0, MessageID: 0, Body: "invalid", Accept: true,
	})
	if input.Accept || input.UpdateID != 42 {
		t.Fatalf("normalized invalid input = %#v", input)
	}
}

func TestNormalizeMessageInputRejectsUnknownProject(t *testing.T) {
	input := normalizeMessageInput(MessageInput{
		UpdateID: 43, ChatID: -100, MessageID: 11, Body: "invalid project",
		ProjectKey: "other", Accept: true, ExplicitFix: true,
	})
	if input.Accept {
		t.Fatalf("unknown project accepted: %#v", input)
	}
}

func TestQueuedReplyOverflowRequiresFollowUpTicket(t *testing.T) {
	existing := strings.Repeat("a", maxTicketBodyBytes-2)
	if canAppendTicketBody(existing, "x") {
		t.Fatal("overflowing reply was considered appendable")
	}
	if !canAppendTicketBody(existing[:len(existing)-1], "x") {
		t.Fatal("exactly bounded reply was rejected")
	}
}

func TestFinalizationComparisonsAreConstantShape(t *testing.T) {
	digest := []byte(strings.Repeat("a", sha256Size))
	if !constantTimeBytesEqual(digest, append([]byte(nil), digest...)) {
		t.Fatal("equal hashes did not match")
	}
	if constantTimeBytesEqual(digest, digest[:len(digest)-1]) || constantTimeStringEqual("token", "other") {
		t.Fatal("different finalization credentials matched")
	}
}

const sha256Size = 32
