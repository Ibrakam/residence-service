package tickets

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestFormatStatusCoversQueueWorkingAndCompletion(t *testing.T) {
	queued := FormatStatus(StatusView{ID: 12, Source: "operator_test", Status: StatusQueued, QueuePosition: 3})
	if !strings.Contains(queued, "TNC-12 [TEST] — в очереди") || !strings.Contains(queued, "Позиция: 3") {
		t.Fatalf("queued text = %q", queued)
	}
	working := FormatStatus(StatusView{ID: 12, Status: StatusWorking, ProgressSummary: "Проверяю форму"})
	if !strings.Contains(working, "взят в работу") || !strings.Contains(working, "Проверяю форму") {
		t.Fatalf("working text = %q", working)
	}
	market := FormatStatus(StatusView{ID: 13, ProjectKey: ProjectMarketMap, Status: StatusQueued, QueuePosition: 1})
	if !strings.Contains(market, "TNC-13 [MARKET MAP]") {
		t.Fatalf("market status text = %q", market)
	}
	completed := FormatStatus(StatusView{
		ID: 12, Status: StatusCompleted, ResultSummary: "Исправлена кнопка",
		ProductionURL: "https://example.test/4u", CommitSHA: "abc123",
	})
	for _, expected := range []string{"исправлено и опубликовано", "Исправлена кнопка", "https://example.test/4u", "abc123"} {
		if !strings.Contains(completed, expected) {
			t.Fatalf("completion missing %q: %q", expected, completed)
		}
	}
}

type reporterTestStore struct {
	views       map[int64]StatusView
	forSync     []StatusView
	savedTicket []int64
}

func (s *reporterTestStore) StatusView(_ context.Context, ticketID int64) (StatusView, error) {
	view, ok := s.views[ticketID]
	if !ok {
		return StatusView{}, ErrTicketNotFound
	}
	return view, nil
}

func (s *reporterTestStore) QueueStatusViews(context.Context) ([]StatusView, error) {
	return nil, nil
}

func (s *reporterTestStore) StatusViewsForSync(context.Context, int) ([]StatusView, error) {
	return append([]StatusView(nil), s.forSync...), nil
}

func (s *reporterTestStore) SaveStatusMessage(_ context.Context, ticketID, _ int64, _ string, _ time.Time) error {
	s.savedTicket = append(s.savedTicket, ticketID)
	return nil
}

func (s *reporterTestStore) SaveStatusText(_ context.Context, ticketID int64, _ string, _ time.Time) error {
	s.savedTicket = append(s.savedTicket, ticketID)
	return nil
}

type reporterTestMessenger struct {
	sendCalls  []int64
	failTicket int64
}

func (m *reporterTestMessenger) SendMessage(_ context.Context, _ int64, _ *int64, replyTo int64, _ string) (int64, error) {
	m.sendCalls = append(m.sendCalls, replyTo)
	if replyTo == m.failTicket {
		return 0, errors.New("temporary Telegram failure")
	}
	return 1000 + replyTo, nil
}

func (m *reporterTestMessenger) EditMessage(context.Context, int64, int64, string) error {
	return nil
}

func TestReporterSyncAllAttemptsEveryDirtyTicketAfterTelegramFailure(t *testing.T) {
	now := time.Now().UTC()
	views := []StatusView{
		{ID: 1, ChatID: -100, FirstMessageID: 11, Status: StatusQueued, QueuePosition: 1, UpdatedAt: now},
		{ID: 2, ChatID: -100, FirstMessageID: 22, Status: StatusQueued, QueuePosition: 2, UpdatedAt: now},
	}
	store := &reporterTestStore{views: map[int64]StatusView{1: views[0], 2: views[1]}, forSync: views}
	messenger := &reporterTestMessenger{failTicket: 11}
	reporter := NewReporter(store, messenger)

	if err := reporter.SyncAll(t.Context()); err == nil {
		t.Fatal("temporary Telegram failure was not reported")
	}
	if len(messenger.sendCalls) != 2 || len(store.savedTicket) != 1 || store.savedTicket[0] != 2 {
		t.Fatalf("send calls=%v saved=%v", messenger.sendCalls, store.savedTicket)
	}
}

func TestReporterMarksUnchangedStatusAsSyncedWithoutTelegramCall(t *testing.T) {
	now := time.Now().UTC()
	messageID := int64(100)
	view := StatusView{ID: 3, Status: StatusWorking, StatusMessageID: &messageID, UpdatedAt: now}
	view.LastStatusText = FormatStatus(view)
	store := &reporterTestStore{views: map[int64]StatusView{3: view}}
	messenger := &reporterTestMessenger{}
	reporter := NewReporter(store, messenger)

	if err := reporter.SyncTicket(t.Context(), 3); err != nil {
		t.Fatal(err)
	}
	if len(messenger.sendCalls) != 0 || len(store.savedTicket) != 1 || store.savedTicket[0] != 3 {
		t.Fatalf("send calls=%v saved=%v", messenger.sendCalls, store.savedTicket)
	}
}
