package tickets

import (
	"testing"
	"time"
)

func TestParseTelegramUpdateBuildsAlbumTicketAndStripsFix(t *testing.T) {
	now := time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC)
	smallSize := int64(10)
	largeSize := int64(20)
	update := TelegramUpdate{UpdateID: 91, Message: &TelegramMessage{
		MessageID: 17, Chat: TelegramChat{ID: -123}, From: &TelegramUser{ID: 5},
		Date: now.Unix(), MediaGroupID: "album-1", Caption: "/fix Сломана кнопка",
		Photo: []TelegramPhoto{
			{FileID: "small", Width: 10, Height: 10, FileSize: &smallSize},
			{FileID: "large", FileUniqueID: "unique", Width: 20, Height: 20, FileSize: &largeSize},
		},
	}}
	parsed := ParseTelegramUpdate(update, -123, TelegramUserIDSet{5: {}}, 2*time.Second, now)
	if !parsed.Input.Accept || parsed.Input.Body != "Сломана кнопка" {
		t.Fatalf("parsed input = %#v", parsed.Input)
	}
	if !parsed.Input.ExplicitFix {
		t.Fatal("explicit /fix marker was lost")
	}
	if parsed.Input.ProjectKey != ProjectResidence {
		t.Fatalf("project key = %q", parsed.Input.ProjectKey)
	}
	if got := parsed.Input.ReadyAfter; !got.Equal(now.Add(2 * time.Second)) {
		t.Fatalf("readyAfter = %s", got)
	}
	if len(parsed.Input.Attachments) != 1 || parsed.Input.Attachments[0].FileID != "large" {
		t.Fatalf("attachments = %#v", parsed.Input.Attachments)
	}
}

func TestParseTelegramUpdateRequiresFixForTopLevelTicket(t *testing.T) {
	base := TelegramMessage{MessageID: 1, Chat: TelegramChat{ID: -123}, From: &TelegramUser{ID: 5}}
	base.Text = "Сломана кнопка"
	parsed := ParseTelegramUpdate(TelegramUpdate{UpdateID: 10, Message: &base}, -123, TelegramUserIDSet{5: {}}, time.Second, time.Now())
	if parsed.Input.Accept {
		t.Fatalf("top-level message without /fix accepted: %#v", parsed)
	}

	base.Text = "/fix Сломана кнопка"
	parsed = ParseTelegramUpdate(TelegramUpdate{UpdateID: 11, Message: &base}, -123, TelegramUserIDSet{5: {}}, time.Second, time.Now())
	if !parsed.Input.Accept || !parsed.Input.ExplicitFix || parsed.Input.Body != "Сломана кнопка" {
		t.Fatalf("explicit ticket rejected: %#v", parsed)
	}
}

func TestParseTelegramUpdateRoutesMarketMapURLAndDescendants(t *testing.T) {
	tests := []struct {
		name    string
		text    string
		project string
	}{
		{name: "exact", text: "/fix https://form.tencorp.uz/market-map", project: ProjectMarketMap},
		{name: "scheme omitted", text: "/fix form.tencorp.uz/market-map", project: ProjectMarketMap},
		{name: "trailing slash and query", text: "/fix смотри https://form.tencorp.uz/market-map/?selected=7", project: ProjectMarketMap},
		{name: "markdown", text: "/fix [карта](https://form.tencorp.uz/market-map)", project: ProjectMarketMap},
		{name: "explicit command", text: "/fix_map поправь выбранный маркер", project: ProjectMarketMap},
		{name: "ordinary fix", text: "/fix поправь форму", project: ProjectResidence},
		{name: "child path", text: "/fix https://form.tencorp.uz/market-map/admin", project: ProjectMarketMap},
		{name: "text stuck to trailing slash", text: "/fix https://form.tencorp.uz/market-map/Разметка районов", project: ProjectMarketMap},
		{name: "lookalike host", text: "/fix https://evil.form.tencorp.uz/market-map", project: ProjectResidence},
		{name: "lookalike path", text: "/fix https://form.tencorp.uz/market-mapper", project: ProjectResidence},
		{name: "insecure scheme", text: "/fix http://form.tencorp.uz/market-map", project: ProjectResidence},
		{name: "userinfo host confusion", text: "/fix https://form.tencorp.uz@evil.example/market-map", project: ProjectResidence},
		{name: "custom port", text: "/fix https://form.tencorp.uz:8443/market-map", project: ProjectResidence},
	}
	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			parsed := ParseTelegramUpdate(TelegramUpdate{UpdateID: int64(100 + index), Message: &TelegramMessage{
				MessageID: int64(100 + index), Chat: TelegramChat{ID: -123}, From: &TelegramUser{ID: 5}, Text: test.text,
			}}, -123, TelegramUserIDSet{5: {}}, time.Second, time.Now())
			if !parsed.Input.Accept || !parsed.Input.ExplicitFix || parsed.Input.ProjectKey != test.project {
				t.Fatalf("parsed = %#v", parsed)
			}
		})
	}
}

func TestParseTelegramUpdateAllowsBotReplyCandidateWithoutFix(t *testing.T) {
	replyID := int64(700)
	parsed := ParseTelegramUpdate(TelegramUpdate{UpdateID: 12, Message: &TelegramMessage{
		MessageID: 2, Chat: TelegramChat{ID: -123}, From: &TelegramUser{ID: 5}, Text: "Дополнение",
		ReplyToMessage: &TelegramMessage{MessageID: replyID, From: &TelegramUser{ID: 99, IsBot: true}},
	}}, -123, TelegramUserIDSet{5: {}}, time.Second, time.Now())
	if !parsed.Input.Accept || parsed.Input.ExplicitFix || parsed.Input.ReplyToMessage == nil || *parsed.Input.ReplyToMessage != replyID {
		t.Fatalf("bot reply candidate = %#v", parsed)
	}
	if parsed.Input.ProjectKey != "" {
		t.Fatalf("reply selected a project before parent lookup: %#v", parsed.Input)
	}
}

func TestParseTelegramUpdateTreatsReplyToBotAsExistingTicketNote(t *testing.T) {
	replyID := int64(70)
	update := TelegramUpdate{UpdateID: 92, Message: &TelegramMessage{
		MessageID: 18, Chat: TelegramChat{ID: -123}, From: &TelegramUser{ID: 5}, Text: "Ещё один скриншот",
		ReplyToMessage: &TelegramMessage{MessageID: replyID, From: &TelegramUser{ID: 99, IsBot: true}},
	}}
	parsed := ParseTelegramUpdate(update, -123, TelegramUserIDSet{5: {}}, time.Second, time.Now())
	if parsed.Input.ReplyToMessage == nil || *parsed.Input.ReplyToMessage != replyID {
		t.Fatalf("reply target = %#v", parsed.Input.ReplyToMessage)
	}
}

func TestParseTelegramUpdateKeepsControlCommandsOutOfQueue(t *testing.T) {
	for _, command := range []string{"/help", "/status@ticket_bot", "/cancel"} {
		parsed := ParseTelegramUpdate(TelegramUpdate{UpdateID: 1, Message: &TelegramMessage{
			MessageID: 1, Chat: TelegramChat{ID: -123}, From: &TelegramUser{ID: 5}, Text: command,
		}}, -123, TelegramUserIDSet{5: {}}, time.Second, time.Now())
		if parsed.Command == CommandNone || parsed.Input.Accept {
			t.Fatalf("command %q parsed as ticket: %#v", command, parsed)
		}
	}
}

func TestParseTelegramUpdateIgnoresBotsAndOtherChats(t *testing.T) {
	for _, message := range []*TelegramMessage{
		{MessageID: 1, Chat: TelegramChat{ID: -999}, From: &TelegramUser{ID: 5}, Text: "ticket"},
		{MessageID: 2, Chat: TelegramChat{ID: -123}, From: &TelegramUser{ID: 5, IsBot: true}, Text: "ticket"},
	} {
		parsed := ParseTelegramUpdate(TelegramUpdate{UpdateID: 1, Message: message}, -123, TelegramUserIDSet{5: {}}, time.Second, time.Now())
		if parsed.Input.Accept {
			t.Fatalf("untrusted message accepted: %#v", message)
		}
	}
}

func TestParseTelegramUpdateSilentlyRejectsUnauthorizedUsersAndBots(t *testing.T) {
	for _, from := range []*TelegramUser{
		{ID: 6},
		{ID: 5, IsBot: true},
		nil,
	} {
		update := TelegramUpdate{UpdateID: 77, Message: &TelegramMessage{
			MessageID: 1, Chat: TelegramChat{ID: -123}, From: from, Text: "/help",
		}}
		parsed := ParseTelegramUpdate(update, -123, TelegramUserIDSet{5: {}}, time.Second, time.Now())
		if parsed.Input.UpdateID != 77 || parsed.Input.Accept || parsed.Command != CommandNone || parsed.CommandMessage != nil {
			t.Fatalf("unauthorized update was actionable: %#v", parsed)
		}
	}
}
