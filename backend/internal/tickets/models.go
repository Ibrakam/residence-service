package tickets

import "time"

const (
	StatusQueued    = "queued"
	StatusWorking   = "working"
	StatusCompleted = "completed"
	StatusFailed    = "failed"
	StatusCancelled = "cancelled"
)

const (
	ProjectResidence = "residence"
	ProjectMarketMap = "market-map"
)

type AttachmentInput struct {
	FileID       string
	FileUniqueID string
	Kind         string
	MIMEType     string
	FileName     string
	DeclaredSize *int64
}

type MessageInput struct {
	UpdateID       int64
	ChatID         int64
	MessageID      int64
	MessageThread  *int64
	ReplyToMessage *int64
	MediaGroupID   string
	Body           string
	ProjectKey     string
	TelegramDate   time.Time
	Attachments    []AttachmentInput
	ReadyAfter     time.Time
	Accept         bool
	ExplicitFix    bool
}

type IngestResult struct {
	Duplicate bool
	Accepted  bool
	Created   bool
	TicketID  int64
}

type Attachment struct {
	ID             int64     `json:"id"`
	TicketID       int64     `json:"ticketId"`
	MessageID      int64     `json:"messageId"`
	FileID         string    `json:"-"`
	FileUniqueID   string    `json:"-"`
	Kind           string    `json:"kind"`
	MIMEType       string    `json:"mimeType,omitempty"`
	FileName       string    `json:"fileName,omitempty"`
	DeclaredSize   *int64    `json:"declaredSize,omitempty"`
	DownloadStatus string    `json:"downloadStatus"`
	LocalPath      string    `json:"-"`
	ByteSize       *int64    `json:"byteSize,omitempty"`
	SHA256         string    `json:"sha256,omitempty"`
	Attempts       int       `json:"-"`
	NextAttemptAt  time.Time `json:"-"`
}

type Ticket struct {
	ID              int64        `json:"id"`
	ChatID          int64        `json:"-"`
	MessageThread   *int64       `json:"-"`
	FirstMessageID  int64        `json:"-"`
	Source          string       `json:"source"`
	ProjectKey      string       `json:"projectKey"`
	Body            string       `json:"body"`
	Status          string       `json:"status"`
	ProgressSummary string       `json:"progressSummary,omitempty"`
	AttemptCount    int          `json:"attemptCount"`
	CreatedAt       time.Time    `json:"createdAt"`
	ClaimedAt       *time.Time   `json:"claimedAt,omitempty"`
	Attachments     []Attachment `json:"attachments"`
}

type ClaimResult struct {
	WorkerID   string    `json:"workerId"`
	LeaseToken string    `json:"leaseToken"`
	ExpiresAt  time.Time `json:"expiresAt"`
	Ticket     *Ticket   `json:"ticket"`
}

type Completion struct {
	Summary       string `json:"summary"`
	CommitSHA     string `json:"commitSha,omitempty"`
	ProductionURL string `json:"productionUrl,omitempty"`
}

type StatusView struct {
	ID              int64
	ChatID          int64
	MessageThread   *int64
	FirstMessageID  int64
	Source          string
	ProjectKey      string
	StatusMessageID *int64
	LastStatusText  string
	Status          string
	QueuePosition   int64
	ProgressSummary string
	ResultSummary   string
	FailureSummary  string
	CommitSHA       string
	ProductionURL   string
	UpdatedAt       time.Time
}

type Health struct {
	Queued  int64 `json:"queued"`
	Ready   int64 `json:"ready"`
	Working int64 `json:"working"`
}

type RetentionAttachment struct {
	ID        int64
	TicketID  int64
	LocalPath string
}

type RetentionStats struct {
	Eligible      int64 `json:"eligible"`
	FilesRemoved  int64 `json:"filesRemoved"`
	RecordsPurged int64 `json:"recordsPurged"`
	BytesBefore   int64 `json:"bytesBefore"`
	BytesAfter    int64 `json:"bytesAfter"`
	FilesBefore   int64 `json:"filesBefore"`
	FilesAfter    int64 `json:"filesAfter"`
}
