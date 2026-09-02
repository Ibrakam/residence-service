package tickets

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var ErrTelegramMessageNotModified = errors.New("telegram message is not modified")

type TelegramClient struct {
	token    string
	apiBase  string
	fileBase string
	http     *http.Client
}

func NewTelegramClient(token string, timeout time.Duration) *TelegramClient {
	return &TelegramClient{
		token:    token,
		apiBase:  "https://api.telegram.org",
		fileBase: "https://api.telegram.org",
		http:     &http.Client{Timeout: timeout},
	}
}

type TelegramUpdate struct {
	UpdateID int64            `json:"update_id"`
	Message  *TelegramMessage `json:"message"`
}

type TelegramMessage struct {
	MessageID       int64             `json:"message_id"`
	MessageThreadID *int64            `json:"message_thread_id"`
	From            *TelegramUser     `json:"from"`
	Chat            TelegramChat      `json:"chat"`
	Date            int64             `json:"date"`
	MediaGroupID    string            `json:"media_group_id"`
	Text            string            `json:"text"`
	Caption         string            `json:"caption"`
	Photo           []TelegramPhoto   `json:"photo"`
	Document        *TelegramDocument `json:"document"`
	Video           *TelegramDocument `json:"video"`
	Animation       *TelegramDocument `json:"animation"`
	Audio           *TelegramDocument `json:"audio"`
	Voice           *TelegramDocument `json:"voice"`
	ReplyToMessage  *TelegramMessage  `json:"reply_to_message"`
}

type TelegramUser struct {
	ID    int64 `json:"id"`
	IsBot bool  `json:"is_bot"`
}

type TelegramChat struct {
	ID int64 `json:"id"`
}

type TelegramPhoto struct {
	FileID       string `json:"file_id"`
	FileUniqueID string `json:"file_unique_id"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	FileSize     *int64 `json:"file_size"`
}

type TelegramDocument struct {
	FileID       string `json:"file_id"`
	FileUniqueID string `json:"file_unique_id"`
	FileName     string `json:"file_name"`
	MIMEType     string `json:"mime_type"`
	FileSize     *int64 `json:"file_size"`
}

type Command string

const (
	CommandNone   Command = ""
	CommandHelp   Command = "help"
	CommandStatus Command = "status"
	CommandCancel Command = "cancel"
)

type ParsedUpdate struct {
	Input          MessageInput
	Command        Command
	CommandMessage *TelegramMessage
}

func ParseTelegramUpdate(update TelegramUpdate, configuredChatID int64, allowedUserIDs TelegramUserIDSet, mediaDelay time.Duration, now time.Time) ParsedUpdate {
	input := MessageInput{UpdateID: update.UpdateID}
	message := update.Message
	if message == nil || message.Chat.ID != configuredChatID || message.From == nil || message.From.IsBot {
		return ParsedUpdate{Input: input}
	}
	if _, allowed := allowedUserIDs[message.From.ID]; !allowed {
		return ParsedUpdate{Input: input}
	}
	command, isCommand := recognizedCommand(message.Text)
	if isCommand {
		return ParsedUpdate{Input: input, Command: command, CommandMessage: message}
	}
	body := strings.TrimSpace(message.Text)
	if body == "" {
		body = strings.TrimSpace(message.Caption)
	}
	wasFixCommand := hasFixCommand(body)
	body = stripFixCommand(body)
	attachments := telegramAttachments(message)
	replyToBot := message.ReplyToMessage != nil && message.ReplyToMessage.From != nil && message.ReplyToMessage.From.IsBot
	if !wasFixCommand && !replyToBot && message.MediaGroupID == "" {
		return ParsedUpdate{Input: input}
	}
	if body == "" && len(attachments) == 0 && !wasFixCommand {
		return ParsedUpdate{Input: input}
	}
	if body == "" {
		if len(attachments) > 0 {
			body = "См. приложенное вложение."
		} else {
			body = "Описание проблемы не указано."
		}
	}
	readyAfter := now
	if message.MediaGroupID != "" {
		readyAfter = now.Add(mediaDelay)
	}
	input = MessageInput{
		UpdateID:      update.UpdateID,
		ChatID:        message.Chat.ID,
		MessageID:     message.MessageID,
		MessageThread: message.MessageThreadID,
		MediaGroupID:  message.MediaGroupID,
		Body:          body,
		TelegramDate:  time.Unix(message.Date, 0).UTC(),
		Attachments:   attachments,
		ReadyAfter:    readyAfter,
		Accept:        true,
		ExplicitFix:   wasFixCommand,
	}
	if reply := message.ReplyToMessage; replyToBot {
		input.ReplyToMessage = &reply.MessageID
	}
	return ParsedUpdate{Input: input}
}

func recognizedCommand(text string) (Command, bool) {
	fields := strings.Fields(strings.TrimSpace(text))
	if len(fields) == 0 {
		return CommandNone, false
	}
	name := strings.ToLower(strings.SplitN(fields[0], "@", 2)[0])
	switch name {
	case "/help":
		return CommandHelp, true
	case "/status":
		return CommandStatus, true
	case "/cancel":
		return CommandCancel, true
	default:
		return CommandNone, false
	}
}

func stripFixCommand(text string) string {
	fields := strings.Fields(text)
	if len(fields) == 0 {
		return ""
	}
	name := strings.ToLower(strings.SplitN(fields[0], "@", 2)[0])
	if name != "/fix" {
		return text
	}
	return strings.TrimSpace(strings.TrimPrefix(text, fields[0]))
}

func hasFixCommand(text string) bool {
	fields := strings.Fields(text)
	return len(fields) > 0 && strings.ToLower(strings.SplitN(fields[0], "@", 2)[0]) == "/fix"
}

func telegramAttachments(message *TelegramMessage) []AttachmentInput {
	attachments := make([]AttachmentInput, 0, 2)
	if len(message.Photo) > 0 {
		best := message.Photo[0]
		for _, candidate := range message.Photo[1:] {
			bestArea := int64(best.Width) * int64(best.Height)
			candidateArea := int64(candidate.Width) * int64(candidate.Height)
			if candidateArea > bestArea {
				best = candidate
			}
		}
		attachments = append(attachments, AttachmentInput{
			FileID: best.FileID, FileUniqueID: best.FileUniqueID, Kind: "photo",
			MIMEType: "image/jpeg", DeclaredSize: best.FileSize,
		})
	}
	for _, item := range []struct {
		kind string
		file *TelegramDocument
	}{
		{kind: "document", file: message.Document},
		{kind: "video", file: message.Video},
		{kind: "animation", file: message.Animation},
		{kind: "audio", file: message.Audio},
		{kind: "voice", file: message.Voice},
	} {
		if item.file == nil || item.file.FileID == "" {
			continue
		}
		attachments = append(attachments, AttachmentInput{
			FileID: item.file.FileID, FileUniqueID: item.file.FileUniqueID,
			Kind: item.kind, MIMEType: item.file.MIMEType, FileName: item.file.FileName,
			DeclaredSize: item.file.FileSize,
		})
	}
	return attachments
}

func (c *TelegramClient) GetUpdates(ctx context.Context, offset int64, timeout time.Duration) ([]TelegramUpdate, error) {
	payload := map[string]any{
		"offset":          offset,
		"timeout":         int(timeout / time.Second),
		"allowed_updates": []string{"message"},
	}
	var updates []TelegramUpdate
	if err := c.call(ctx, "getUpdates", payload, &updates); err != nil {
		return nil, err
	}
	return updates, nil
}

func (c *TelegramClient) SendMessage(ctx context.Context, chatID int64, threadID *int64, replyTo int64, text string) (int64, error) {
	payload := map[string]any{
		"chat_id":                  chatID,
		"text":                     text,
		"disable_web_page_preview": true,
	}
	if threadID != nil {
		payload["message_thread_id"] = *threadID
	}
	if replyTo > 0 {
		payload["reply_parameters"] = map[string]any{
			"message_id": replyTo, "allow_sending_without_reply": true,
		}
	}
	var message struct {
		MessageID int64 `json:"message_id"`
	}
	if err := c.call(ctx, "sendMessage", payload, &message); err != nil {
		return 0, err
	}
	return message.MessageID, nil
}

func (c *TelegramClient) EditMessage(ctx context.Context, chatID, messageID int64, text string) error {
	payload := map[string]any{
		"chat_id": chatID, "message_id": messageID, "text": text,
		"disable_web_page_preview": true,
	}
	return c.call(ctx, "editMessageText", payload, nil)
}

func (c *TelegramClient) GetFilePath(ctx context.Context, fileID string) (string, error) {
	var file struct {
		FilePath string `json:"file_path"`
	}
	if err := c.call(ctx, "getFile", map[string]any{"file_id": fileID}, &file); err != nil {
		return "", err
	}
	if file.FilePath == "" || strings.Contains(file.FilePath, "..") || strings.ContainsAny(file.FilePath, "\x00\r\n\\") {
		return "", errors.New("telegram returned an unsafe file path")
	}
	return file.FilePath, nil
}

func (c *TelegramClient) DownloadFile(ctx context.Context, filePath string, destination io.Writer, maxBytes int64) (int64, error) {
	segments := strings.Split(filePath, "/")
	for index := range segments {
		segments[index] = url.PathEscape(segments[index])
	}
	endpoint := c.fileBase + "/file/bot" + c.token + "/" + strings.Join(segments, "/")
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, errors.New("create telegram file request")
	}
	response, err := c.http.Do(request)
	if err != nil {
		return 0, errors.New("telegram file request failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return 0, fmt.Errorf("telegram file request returned status %d", response.StatusCode)
	}
	written, err := io.Copy(destination, io.LimitReader(response.Body, maxBytes+1))
	if err != nil {
		return 0, errors.New("read telegram file response")
	}
	if written > maxBytes {
		return written, errAttachmentTooLarge
	}
	return written, nil
}

func (c *TelegramClient) call(ctx context.Context, method string, payload any, result any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return errors.New("encode telegram request")
	}
	endpoint := c.apiBase + "/bot" + c.token + "/" + method
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return errors.New("create telegram request")
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(request)
	if err != nil {
		return errors.New("telegram request failed")
	}
	defer response.Body.Close()
	var envelope struct {
		OK          bool            `json:"ok"`
		Result      json.RawMessage `json:"result"`
		ErrorCode   int             `json:"error_code"`
		Description string          `json:"description"`
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 2<<20))
	if err := decoder.Decode(&envelope); err != nil {
		return errors.New("decode telegram response")
	}
	if !envelope.OK {
		if strings.Contains(strings.ToLower(envelope.Description), "message is not modified") {
			return ErrTelegramMessageNotModified
		}
		return fmt.Errorf("telegram %s failed with code %d", method, envelope.ErrorCode)
	}
	if result != nil && len(envelope.Result) > 0 {
		if err := json.Unmarshal(envelope.Result, result); err != nil {
			return errors.New("decode telegram result")
		}
	}
	return nil
}
