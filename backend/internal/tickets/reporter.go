package tickets

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

type statusRepository interface {
	StatusView(context.Context, int64) (StatusView, error)
	QueueStatusViews(context.Context) ([]StatusView, error)
	StatusViewsForSync(context.Context, int) ([]StatusView, error)
	SaveStatusMessage(context.Context, int64, int64, string, time.Time) error
	SaveStatusText(context.Context, int64, string, time.Time) error
}

type statusMessenger interface {
	SendMessage(context.Context, int64, *int64, int64, string) (int64, error)
	EditMessage(context.Context, int64, int64, string) error
}

type Reporter struct {
	store     statusRepository
	messenger statusMessenger
}

func NewReporter(store statusRepository, messenger statusMessenger) *Reporter {
	return &Reporter{store: store, messenger: messenger}
}

func (r *Reporter) SyncTicket(ctx context.Context, ticketID int64) error {
	view, err := r.store.StatusView(ctx, ticketID)
	if err != nil {
		return err
	}
	text := FormatStatus(view)
	if text == view.LastStatusText && view.StatusMessageID != nil {
		return ignoreStatusRace(r.store.SaveStatusText(ctx, ticketID, text, view.UpdatedAt))
	}
	if view.StatusMessageID == nil {
		replyTo := view.FirstMessageID
		if view.Source == "operator_test" {
			replyTo = 0
		}
		messageID, err := r.messenger.SendMessage(ctx, view.ChatID, view.MessageThread, replyTo, text)
		if err != nil {
			return err
		}
		return ignoreStatusRace(r.store.SaveStatusMessage(ctx, ticketID, messageID, text, view.UpdatedAt))
	}
	if err := r.messenger.EditMessage(ctx, view.ChatID, *view.StatusMessageID, text); err != nil && !errors.Is(err, ErrTelegramMessageNotModified) {
		return err
	}
	return ignoreStatusRace(r.store.SaveStatusText(ctx, ticketID, text, view.UpdatedAt))
}

func (r *Reporter) SyncAll(ctx context.Context) error {
	views, err := r.store.StatusViewsForSync(ctx, 1000)
	if err != nil {
		return err
	}
	errorsSeen := make([]error, 0)
	for _, view := range views {
		if err := r.SyncTicket(ctx, view.ID); err != nil {
			errorsSeen = append(errorsSeen, err)
		}
	}
	return errors.Join(errorsSeen...)
}

func ignoreStatusRace(err error) error {
	if errors.Is(err, ErrStatusChanged) {
		return nil
	}
	return err
}

func (r *Reporter) SyncQueue(ctx context.Context) error {
	views, err := r.store.QueueStatusViews(ctx)
	if err != nil {
		return err
	}
	for _, view := range views {
		if err := r.SyncTicket(ctx, view.ID); err != nil {
			return err
		}
	}
	return nil
}

func FormatStatus(view StatusView) string {
	prefix := fmt.Sprintf("TNC-%d", view.ID)
	if view.ProjectKey == ProjectMarketMap {
		prefix += " [MARKET MAP]"
	}
	if view.Source == "operator_test" {
		prefix += " [TEST]"
	}
	var text string
	switch view.Status {
	case StatusQueued:
		text = fmt.Sprintf("%s — в очереди\nПозиция: %d", prefix, view.QueuePosition)
	case StatusWorking:
		text = prefix + " — взят в работу"
		if summary := strings.TrimSpace(view.ProgressSummary); summary != "" {
			text += "\n\nСтатус:\n" + summary
		}
	case StatusCompleted:
		if view.ProductionURL != "" {
			text = prefix + " — исправлено и опубликовано"
		} else {
			text = prefix + " — выполнено без публикации"
		}
		if summary := strings.TrimSpace(view.ResultSummary); summary != "" {
			text += "\n\nЧто сделано:\n" + summary
		}
		if view.ProductionURL != "" {
			text += "\n\nПрод: " + view.ProductionURL
		}
		if view.CommitSHA != "" {
			text += "\nКоммит: " + view.CommitSHA
		}
	case StatusFailed:
		text = prefix + " — не удалось завершить"
		if summary := strings.TrimSpace(view.FailureSummary); summary != "" {
			text += "\n\nПричина:\n" + summary
		}
	case StatusCancelled:
		text = prefix + " — отменён"
	default:
		text = prefix + " — статус обновляется"
	}
	return truncateUTF8(text, 4000)
}

func truncateUTF8(value string, maxRunes int) string {
	if utf8.RuneCountInString(value) <= maxRunes {
		return value
	}
	runes := []rune(value)
	return string(runes[:maxRunes-1]) + "…"
}
