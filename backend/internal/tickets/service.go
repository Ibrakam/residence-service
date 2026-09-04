package tickets

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var errAttachmentTooLarge = errors.New("attachment exceeds configured size limit")

type Service struct {
	cfg      Config
	store    *Store
	telegram *TelegramClient
	reporter *Reporter
	logger   *slog.Logger
}

func NewService(cfg Config, store *Store, telegram *TelegramClient, reporter *Reporter, logger *slog.Logger) *Service {
	return &Service{cfg: cfg, store: store, telegram: telegram, reporter: reporter, logger: logger}
}

func (s *Service) Run(ctx context.Context) error {
	lastUpdateID, found, err := s.store.LastUpdateID(ctx, s.cfg.Consumer)
	if err != nil {
		return err
	}
	offset := int64(0)
	if found {
		offset = lastUpdateID + 1
	}
	attachmentTicker := time.NewTicker(3 * time.Second)
	defer attachmentTicker.Stop()
	go s.runStatusReporter(ctx)

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-attachmentTicker.C:
			s.processPendingAttachments(ctx)
		default:
		}

		updates, err := s.telegram.GetUpdates(ctx, offset, s.cfg.LongPollTimeout)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			s.logger.Warn("telegram long poll failed")
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(2 * time.Second):
			}
			continue
		}
		for _, update := range updates {
			if err := s.handleUpdate(ctx, update); err != nil {
				s.logger.Error("telegram update processing failed", "updateId", update.UpdateID)
				break
			}
			offset = update.UpdateID + 1
		}
		s.processPendingAttachments(ctx)
	}
}

func (s *Service) handleUpdate(ctx context.Context, update TelegramUpdate) error {
	parsed := ParseTelegramUpdate(update, s.cfg.TelegramChatID, s.cfg.TelegramAllowedUserIDs, s.cfg.MediaGroupDelay, time.Now().UTC())
	result, err := s.store.ApplyUpdate(ctx, s.cfg.Consumer, parsed.Input)
	if err != nil || result.Duplicate {
		return err
	}
	if parsed.Command != CommandNone {
		return s.handleCommand(ctx, parsed.Command, parsed.CommandMessage)
	}
	if !result.Accepted {
		return nil
	}
	return nil
}

func (s *Service) handleCommand(ctx context.Context, command Command, message *TelegramMessage) error {
	if message == nil {
		return nil
	}
	switch command {
	case CommandHelp:
		_, err := s.telegram.SendMessage(ctx, message.Chat.ID, message.MessageThreadID, message.MessageID,
			"Новый тикет: начните сообщение или подпись к альбому с /fix. Ссылка form.tencorp.uz/market-map автоматически направит задачу в Market Map; также можно использовать /fix_map. Ответ на статус TNC наследует проект и станет заметкой или follow-up. /status — очередь, /cancel — отменить queued-тикет ответом на его статус.")
		return err
	case CommandStatus:
		health, err := s.store.Health(ctx)
		if err != nil {
			return err
		}
		text := fmt.Sprintf("Очередь: %d\nГотовы к работе: %d\nВ работе: %d", health.Queued, health.Ready, health.Working)
		_, err = s.telegram.SendMessage(ctx, message.Chat.ID, message.MessageThreadID, message.MessageID, text)
		return err
	case CommandCancel:
		reply := message.ReplyToMessage
		if reply == nil || reply.From == nil || !reply.From.IsBot {
			_, err := s.telegram.SendMessage(ctx, message.Chat.ID, message.MessageThreadID, message.MessageID,
				"Чтобы отменить тикет в очереди, ответьте /cancel на его статусное сообщение.")
			return err
		}
		_, err := s.store.CancelByStatusMessage(ctx, message.Chat.ID, reply.MessageID)
		if errors.Is(err, ErrCannotCancel) {
			_, sendErr := s.telegram.SendMessage(ctx, message.Chat.ID, message.MessageThreadID, message.MessageID,
				"Этот тикет уже взят в работу, завершён или не найден.")
			return sendErr
		}
		if err != nil {
			return err
		}
		return nil
	default:
		return nil
	}
}

func (s *Service) processPendingAttachments(ctx context.Context) {
	items, err := s.store.PendingAttachments(ctx, 8)
	if err != nil {
		s.logger.Warn("pending attachment lookup failed")
		return
	}
	for _, item := range items {
		if ctx.Err() != nil {
			return
		}
		err := s.downloadAttachment(ctx, item)
		if err == nil {
			continue
		}
		terminal := errors.Is(err, errAttachmentTooLarge) || item.Attempts >= 4
		_, markErr := s.store.MarkAttachmentFailure(ctx, item.ID, time.Now().UTC().Add(30*time.Second), terminal)
		if markErr != nil {
			s.logger.Warn("attachment failure persistence failed", "attachmentId", item.ID)
			continue
		}
		s.logger.Warn("attachment download failed", "attachmentId", item.ID, "terminal", terminal)
	}
}

func (s *Service) runStatusReporter(ctx context.Context) {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.reporter.SyncAll(ctx); err != nil && ctx.Err() == nil {
				s.logger.Warn("ticket status sync failed")
			}
		}
	}
}

func (s *Service) downloadAttachment(ctx context.Context, item Attachment) error {
	if item.DeclaredSize != nil && *item.DeclaredSize > s.cfg.MaxAttachmentBytes {
		return errAttachmentTooLarge
	}
	filePath, err := s.telegram.GetFilePath(ctx, item.FileID)
	if err != nil {
		return err
	}
	ticketDir := filepath.Join(s.cfg.AttachmentDir, fmt.Sprintf("%d", item.TicketID))
	if err := os.MkdirAll(ticketDir, 0o700); err != nil {
		return errors.New("create attachment directory")
	}
	temporary, err := os.CreateTemp(ticketDir, ".download-*")
	if err != nil {
		return errors.New("create temporary attachment")
	}
	temporaryPath := temporary.Name()
	committed := false
	defer func() {
		_ = temporary.Close()
		if !committed {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(0o600); err != nil {
		return errors.New("secure temporary attachment")
	}
	hash := sha256.New()
	byteSize, err := s.telegram.DownloadFile(ctx, filePath, io.MultiWriter(temporary, hash), s.cfg.MaxAttachmentBytes)
	if err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return errors.New("sync attachment")
	}
	if err := temporary.Close(); err != nil {
		return errors.New("close attachment")
	}
	finalPath := filepath.Join(ticketDir, fmt.Sprintf("%d%s", item.ID, safeExtension(item, filePath)))
	if err := os.Rename(temporaryPath, finalPath); err != nil {
		return errors.New("commit attachment")
	}
	committed = true
	return s.store.MarkAttachmentReady(ctx, item.ID, finalPath, byteSize, hex.EncodeToString(hash.Sum(nil)))
}

func safeExtension(item Attachment, telegramPath string) string {
	candidates := []string{filepath.Ext(item.FileName), filepath.Ext(telegramPath)}
	if extensions, _ := mime.ExtensionsByType(item.MIMEType); len(extensions) > 0 {
		candidates = append(candidates, extensions[0])
	}
	for _, candidate := range candidates {
		candidate = strings.ToLower(candidate)
		if len(candidate) >= 2 && len(candidate) <= 10 {
			valid := true
			for _, character := range candidate[1:] {
				if character < 'a' || character > 'z' {
					if character < '0' || character > '9' {
						valid = false
					}
				}
			}
			if valid {
				return candidate
			}
		}
	}
	return ".bin"
}
