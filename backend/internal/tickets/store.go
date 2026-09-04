package tickets

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrWorkerBusy       = errors.New("another worker holds the lease")
	ErrLeaseLost        = errors.New("worker lease is invalid or expired")
	ErrTicketNotFound   = errors.New("ticket not found")
	ErrAttachmentAbsent = errors.New("attachment not found")
	ErrCannotCancel     = errors.New("ticket cannot be cancelled")
	ErrStatusChanged    = errors.New("ticket status changed while notification was being sent")
)

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *Store) LastUpdateID(ctx context.Context, consumer string) (int64, bool, error) {
	var updateID int64
	err := s.pool.QueryRow(ctx, `
		SELECT last_update_id
		FROM ticket_automation_offsets
		WHERE consumer=$1`, consumer).Scan(&updateID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	return updateID, err == nil, err
}

func (s *Store) ApplyUpdate(ctx context.Context, consumer string, input MessageInput) (IngestResult, error) {
	input = normalizeMessageInput(input)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return IngestResult{}, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	var updateID int64
	err = tx.QueryRow(ctx, `
		INSERT INTO ticket_automation_updates (consumer, update_id, accepted)
		VALUES ($1, $2, $3)
		ON CONFLICT DO NOTHING
		RETURNING update_id`, consumer, input.UpdateID, input.Accept).Scan(&updateID)
	if errors.Is(err, pgx.ErrNoRows) {
		return IngestResult{Duplicate: true}, nil
	}
	if err != nil {
		return IngestResult{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO ticket_automation_offsets (consumer, last_update_id)
		VALUES ($1, $2)
		ON CONFLICT (consumer) DO UPDATE SET
			last_update_id=GREATEST(ticket_automation_offsets.last_update_id, EXCLUDED.last_update_id),
			updated_at=now()`, consumer, input.UpdateID); err != nil {
		return IngestResult{}, err
	}
	if !input.Accept {
		if err := tx.Commit(ctx); err != nil {
			return IngestResult{}, err
		}
		return IngestResult{}, nil
	}

	var existingTicketID int64
	err = tx.QueryRow(ctx, `
		SELECT ticket_id
		FROM ticket_messages
		WHERE chat_id=$1 AND message_id=$2`, input.ChatID, input.MessageID).Scan(&existingTicketID)
	if err == nil {
		if err := tx.Commit(ctx); err != nil {
			return IngestResult{}, err
		}
		return IngestResult{Duplicate: true, Accepted: true, TicketID: existingTicketID}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return IngestResult{}, err
	}

	ticketID, created, err := s.resolveTicketForMessage(ctx, tx, input)
	if err != nil {
		return IngestResult{}, err
	}
	if ticketID == 0 {
		if _, err := tx.Exec(ctx, `
			UPDATE ticket_automation_updates SET accepted=false
			WHERE consumer=$1 AND update_id=$2`, consumer, input.UpdateID); err != nil {
			return IngestResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return IngestResult{}, err
		}
		return IngestResult{}, nil
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO ticket_messages (
			ticket_id, update_id, chat_id, message_id, message_thread_id,
			reply_to_message_id, body, telegram_created_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		ticketID, input.UpdateID, input.ChatID, input.MessageID, input.MessageThread,
		input.ReplyToMessage, input.Body, nullableTime(input.TelegramDate)); err != nil {
		return IngestResult{}, err
	}
	for _, attachment := range input.Attachments {
		if _, err := tx.Exec(ctx, `
			INSERT INTO ticket_attachments (
				ticket_id, message_id, telegram_file_id, telegram_file_unique_id,
				kind, mime_type, original_file_name, declared_size
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
			ON CONFLICT (ticket_id, message_id, telegram_file_id) DO NOTHING`,
			ticketID, input.MessageID, attachment.FileID, attachment.FileUniqueID,
			attachment.Kind, attachment.MIMEType, attachment.FileName, attachment.DeclaredSize); err != nil {
			return IngestResult{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return IngestResult{}, err
	}
	return IngestResult{Accepted: true, Created: created, TicketID: ticketID}, nil
}

func (s *Store) resolveTicketForMessage(ctx context.Context, tx pgx.Tx, input MessageInput) (int64, bool, error) {
	if input.ReplyToMessage != nil {
		var ticketID int64
		var status, body, projectKey string
		err := tx.QueryRow(ctx, `
			SELECT id,status,body,project_key FROM tickets
			WHERE chat_id=$1 AND status_message_id=$2
			FOR UPDATE`, input.ChatID, *input.ReplyToMessage).Scan(&ticketID, &status, &body, &projectKey)
		if err == nil {
			if status == StatusQueued {
				if !canAppendTicketBody(body, input.Body) {
					return s.insertTicket(ctx, tx, input, projectKey)
				}
				_, err = tx.Exec(ctx, `
					UPDATE tickets SET body=$2,ready_after=GREATEST(ready_after,$3),updated_at=now()
					WHERE id=$1 AND status='queued'`, ticketID, appendTicketBody(body, input.Body), input.ReadyAfter)
				return ticketID, false, err
			}
			// A worker has already received a working ticket's immutable body. Preserve
			// the reply as a new queued follow-up instead of silently appending it.
			return s.insertTicket(ctx, tx, input, projectKey)
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return 0, false, err
		}
		if !input.ExplicitFix {
			return 0, false, nil
		}
	}
	if input.MediaGroupID != "" {
		var existingProjectKey string
		err := tx.QueryRow(ctx, `
			SELECT project_key FROM tickets
			WHERE chat_id=$1 AND media_group_id=$2`, input.ChatID, input.MediaGroupID).Scan(&existingProjectKey)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return 0, false, err
		}
		if errors.Is(err, pgx.ErrNoRows) && !input.ExplicitFix {
			return 0, false, nil
		}
		projectKey := existingProjectKey
		if projectKey == "" {
			projectKey = projectKeyOrDefault(input.ProjectKey)
		}
		var ticketID int64
		var created bool
		err = tx.QueryRow(ctx, `
			INSERT INTO tickets (
				chat_id, message_thread_id, first_message_id, media_group_id, body, ready_after, project_key
			) VALUES ($1,$2,$3,$4,$5,$6,$7)
			ON CONFLICT (chat_id, media_group_id) WHERE media_group_id IS NOT NULL DO UPDATE SET
				body=ticket_cap_body(tickets.body,EXCLUDED.body),
				ready_after=GREATEST(tickets.ready_after,EXCLUDED.ready_after),
				updated_at=now()
			WHERE tickets.status='queued'
			RETURNING id, (xmax=0)`, input.ChatID, input.MessageThread, input.MessageID,
			input.MediaGroupID, input.Body, input.ReadyAfter, projectKey).Scan(&ticketID, &created)
		if errors.Is(err, pgx.ErrNoRows) {
			// The original album is already immutable for its worker (or terminal).
			// The unique Telegram media_group_id stays on that original ticket; this
			// delayed part is preserved as a separate queued follow-up.
			return s.insertTicket(ctx, tx, input, projectKey)
		}
		return ticketID, created, err
	}
	return s.insertTicket(ctx, tx, input, input.ProjectKey)
}

func (s *Store) insertTicket(ctx context.Context, tx pgx.Tx, input MessageInput, projectKey string) (int64, bool, error) {
	var ticketID int64
	err := tx.QueryRow(ctx, `
		INSERT INTO tickets (chat_id, message_thread_id, first_message_id, body, ready_after, project_key)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id`, input.ChatID, input.MessageThread, input.MessageID, input.Body, input.ReadyAfter,
		projectKeyOrDefault(projectKey)).Scan(&ticketID)
	return ticketID, err == nil, err
}

const maxTicketBodyBytes = 65536

func normalizeMessageInput(input MessageInput) MessageInput {
	input.Body = truncateUTF8Bytes(strings.ToValidUTF8(input.Body, "�"), maxTicketBodyBytes)
	input.ProjectKey = strings.TrimSpace(input.ProjectKey)
	if input.Accept && !validAcceptedMessageInput(input) {
		input.Accept = false
	}
	return input
}

func validAcceptedMessageInput(input MessageInput) bool {
	if input.UpdateID < 0 || input.ChatID == 0 || input.MessageID <= 0 {
		return false
	}
	if input.MessageThread != nil && *input.MessageThread <= 0 {
		return false
	}
	if input.ReplyToMessage != nil && *input.ReplyToMessage <= 0 {
		return false
	}
	if len(input.MediaGroupID) > 255 || !utf8.ValidString(input.MediaGroupID) {
		return false
	}
	if input.Body == "" && len(input.Attachments) == 0 {
		return false
	}
	if input.ProjectKey != "" && ValidateProjectKey(input.ProjectKey) != nil {
		return false
	}
	if !input.ExplicitFix && input.ReplyToMessage == nil && input.MediaGroupID == "" {
		return false
	}
	validKinds := map[string]struct{}{
		"photo": {}, "document": {}, "video": {}, "animation": {}, "audio": {}, "voice": {},
	}
	for _, attachment := range input.Attachments {
		if attachment.FileID == "" || len(attachment.FileID) > 2048 || !utf8.ValidString(attachment.FileID) {
			return false
		}
		if _, ok := validKinds[attachment.Kind]; !ok {
			return false
		}
		if len(attachment.FileUniqueID) > 512 || len(attachment.MIMEType) > 255 || len(attachment.FileName) > 1024 ||
			!utf8.ValidString(attachment.FileUniqueID) || !utf8.ValidString(attachment.MIMEType) || !utf8.ValidString(attachment.FileName) {
			return false
		}
		if attachment.DeclaredSize != nil && *attachment.DeclaredSize < 0 {
			return false
		}
	}
	return true
}

func appendTicketBody(existing, incoming string) string {
	existing = truncateUTF8Bytes(strings.ToValidUTF8(existing, "�"), maxTicketBodyBytes)
	incoming = truncateUTF8Bytes(strings.ToValidUTF8(incoming, "�"), maxTicketBodyBytes)
	if existing == "" {
		return incoming
	}
	if incoming == "" {
		return existing
	}
	return truncateUTF8Bytes(existing+"\n\n"+incoming, maxTicketBodyBytes)
}

func canAppendTicketBody(existing, incoming string) bool {
	separatorBytes := 0
	if existing != "" && incoming != "" {
		separatorBytes = 2
	}
	return len(existing)+separatorBytes+len(incoming) <= maxTicketBodyBytes
}

func truncateUTF8Bytes(value string, maxBytes int) string {
	if maxBytes <= 0 {
		return ""
	}
	if len(value) <= maxBytes {
		return value
	}
	cut := maxBytes
	for cut > 0 && !utf8.ValidString(value[:cut]) {
		cut--
	}
	return value[:cut]
}

func (s *Store) EnqueueTest(ctx context.Context, chatID int64, body, projectKey string) (int64, error) {
	if err := ValidateProjectKey(projectKey); err != nil {
		return 0, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	var ticketID int64
	err = tx.QueryRow(ctx, `
		INSERT INTO tickets (chat_id, first_message_id, source, body, ready_after, project_key)
		VALUES ($1,0,'operator_test',$2,now(),$3)
		RETURNING id`, chatID, body, projectKey).Scan(&ticketID)
	if err != nil {
		return 0, err
	}
	messageID := -ticketID
	if _, err := tx.Exec(ctx, `UPDATE tickets SET first_message_id=$2 WHERE id=$1`, ticketID, messageID); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO ticket_messages (ticket_id,update_id,chat_id,message_id,body)
		VALUES ($1,0,$2,$3,$4)`, ticketID, chatID, messageID, body); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return ticketID, nil
}

func (s *Store) Health(ctx context.Context) (Health, error) {
	var health Health
	err := s.pool.QueryRow(ctx, `
		SELECT
			count(*) FILTER (WHERE status='queued'),
			count(*) FILTER (WHERE status='queued' AND ready_after <= now()),
			count(*) FILTER (WHERE status='working')
		FROM tickets`).Scan(&health.Queued, &health.Ready, &health.Working)
	return health, err
}

func (s *Store) Claim(ctx context.Context, workerID, proposedToken string, ttl time.Duration) (ClaimResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ClaimResult{}, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	now := time.Now().UTC()
	expiresAt := now.Add(ttl)

	if _, err := tx.Exec(ctx, `
		INSERT INTO ticket_worker_lease (lease_key) VALUES (true)
		ON CONFLICT (lease_key) DO NOTHING`); err != nil {
		return ClaimResult{}, err
	}
	var owner, leaseToken sql.NullString
	var currentTicketID sql.NullInt64
	var currentExpiry sql.NullTime
	if err := tx.QueryRow(ctx, `
		SELECT owner,lease_token,current_ticket_id,expires_at
		FROM ticket_worker_lease WHERE lease_key=true FOR UPDATE`).Scan(
		&owner, &leaseToken, &currentTicketID, &currentExpiry,
	); err != nil {
		return ClaimResult{}, err
	}
	active := owner.Valid && currentExpiry.Valid && currentExpiry.Time.After(now)
	if active && owner.String != workerID {
		return ClaimResult{}, ErrWorkerBusy
	}
	if _, err := tx.Exec(ctx, `
		UPDATE tickets SET
			status='queued', lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL,
			progress_summary='', updated_at=now()
		WHERE status='working' AND lease_expires_at <= $1`, now); err != nil {
		return ClaimResult{}, err
	}
	if active && currentTicketID.Valid {
		ticket, err := loadClaimedTicket(ctx, tx, currentTicketID.Int64, workerID, leaseToken.String, expiresAt)
		if err == nil {
			if _, err := tx.Exec(ctx, `
				UPDATE ticket_worker_lease SET heartbeat_at=$1,expires_at=$2
				WHERE lease_key=true`, now, expiresAt); err != nil {
				return ClaimResult{}, err
			}
			if err := tx.Commit(ctx); err != nil {
				return ClaimResult{}, err
			}
			return ClaimResult{WorkerID: workerID, LeaseToken: leaseToken.String, ExpiresAt: expiresAt, Ticket: ticket}, nil
		}
		if !errors.Is(err, ErrTicketNotFound) {
			return ClaimResult{}, err
		}
	}
	if !active {
		leaseToken.String = proposedToken
		leaseToken.Valid = true
	}

	var ticketID int64
	err = tx.QueryRow(ctx, `
		SELECT t.id
		FROM tickets t
		WHERE t.status='queued'
		  AND t.ready_after <= $1
		  AND NOT EXISTS (
			SELECT 1 FROM ticket_attachments a
			WHERE a.ticket_id=t.id AND a.download_status <> 'ready'
		  )
		ORDER BY t.created_at,t.id
		FOR UPDATE SKIP LOCKED
		LIMIT 1`, now).Scan(&ticketID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return ClaimResult{}, err
	}
	var ticket *Ticket
	if err == nil {
		if _, err := tx.Exec(ctx, `
			UPDATE tickets SET
				status='working',lease_owner=$2,lease_token=$3,lease_expires_at=$4,
				claimed_at=COALESCE(claimed_at,$1),attempt_count=attempt_count+1,updated_at=$1
			WHERE id=$5`, now, workerID, leaseToken.String, expiresAt, ticketID); err != nil {
			return ClaimResult{}, err
		}
		ticket, err = loadTicket(ctx, tx, ticketID)
		if err != nil {
			return ClaimResult{}, err
		}
	}
	if _, err := tx.Exec(ctx, `
		UPDATE ticket_worker_lease SET
			owner=$1,lease_token=$2,current_ticket_id=$3,
			acquired_at=CASE WHEN owner IS DISTINCT FROM $1 OR expires_at <= $4 THEN $4 ELSE acquired_at END,
			heartbeat_at=$4,expires_at=$5
		WHERE lease_key=true`, workerID, leaseToken.String, nullableTicketID(ticket), now, expiresAt); err != nil {
		return ClaimResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ClaimResult{}, err
	}
	return ClaimResult{WorkerID: workerID, LeaseToken: leaseToken.String, ExpiresAt: expiresAt, Ticket: ticket}, nil
}

func loadClaimedTicket(ctx context.Context, tx pgx.Tx, ticketID int64, workerID, token string, expiresAt time.Time) (*Ticket, error) {
	command, err := tx.Exec(ctx, `
		UPDATE tickets SET lease_expires_at=$4,updated_at=now()
		WHERE id=$1 AND status='working' AND lease_owner=$2 AND lease_token=$3`, ticketID, workerID, token, expiresAt)
	if err != nil {
		return nil, err
	}
	if command.RowsAffected() != 1 {
		return nil, ErrTicketNotFound
	}
	return loadTicket(ctx, tx, ticketID)
}

func loadTicket(ctx context.Context, tx pgx.Tx, ticketID int64) (*Ticket, error) {
	var ticket Ticket
	err := tx.QueryRow(ctx, `
		SELECT id,chat_id,message_thread_id,first_message_id,source,project_key,body,status,
			progress_summary,attempt_count,created_at,claimed_at
		FROM tickets WHERE id=$1`, ticketID).Scan(
		&ticket.ID, &ticket.ChatID, &ticket.MessageThread, &ticket.FirstMessageID, &ticket.Source,
		&ticket.ProjectKey, &ticket.Body, &ticket.Status, &ticket.ProgressSummary, &ticket.AttemptCount,
		&ticket.CreatedAt, &ticket.ClaimedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrTicketNotFound
	}
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `
		SELECT id,ticket_id,message_id,telegram_file_id,telegram_file_unique_id,kind,
			mime_type,original_file_name,declared_size,download_status,local_path,
			byte_size,sha256,download_attempts,next_attempt_at
		FROM ticket_attachments WHERE ticket_id=$1 ORDER BY id`, ticketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ticket.Attachments = make([]Attachment, 0)
	for rows.Next() {
		var attachment Attachment
		if err := rows.Scan(
			&attachment.ID, &attachment.TicketID, &attachment.MessageID,
			&attachment.FileID, &attachment.FileUniqueID, &attachment.Kind,
			&attachment.MIMEType, &attachment.FileName, &attachment.DeclaredSize,
			&attachment.DownloadStatus, &attachment.LocalPath, &attachment.ByteSize,
			&attachment.SHA256, &attachment.Attempts, &attachment.NextAttemptAt,
		); err != nil {
			return nil, err
		}
		ticket.Attachments = append(ticket.Attachments, attachment)
	}
	return &ticket, rows.Err()
}

func nullableTicketID(ticket *Ticket) any {
	if ticket == nil {
		return nil
	}
	return ticket.ID
}

func (s *Store) Heartbeat(ctx context.Context, workerID, token string, ttl time.Duration) (time.Time, error) {
	expiresAt := time.Now().UTC().Add(ttl)
	command, err := s.pool.Exec(ctx, `
		WITH renewed AS (
			UPDATE ticket_worker_lease SET heartbeat_at=now(),expires_at=$3
			WHERE lease_key=true AND owner=$1 AND lease_token=$2 AND expires_at > now()
			RETURNING current_ticket_id
		)
		UPDATE tickets SET lease_expires_at=$3,updated_at=now()
		WHERE id=(SELECT current_ticket_id FROM renewed) AND status='working'
		RETURNING id`, workerID, token, expiresAt)
	if err != nil {
		return time.Time{}, err
	}
	if command.RowsAffected() == 0 {
		var leaseValid bool
		err := s.pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM ticket_worker_lease
				WHERE lease_key=true AND owner=$1 AND lease_token=$2 AND expires_at=$3
			)`, workerID, token, expiresAt).Scan(&leaseValid)
		if err != nil || !leaseValid {
			return time.Time{}, ErrLeaseLost
		}
	}
	return expiresAt, nil
}

func (s *Store) LeaseOwner(ctx context.Context, ticketID int64, token string) (string, error) {
	var workerID string
	err := s.pool.QueryRow(ctx, `
		SELECT lease_owner FROM tickets
		WHERE id=$1 AND status='working' AND lease_token=$2 AND lease_expires_at > now()`,
		ticketID, token).Scan(&workerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrLeaseLost
	}
	return workerID, err
}

func (s *Store) UpdateProgress(ctx context.Context, ticketID int64, workerID, token, summary string) error {
	command, err := s.pool.Exec(ctx, `
		UPDATE tickets SET progress_summary=$4,updated_at=now()
		WHERE id=$1 AND status='working' AND lease_owner=$2 AND lease_token=$3
		  AND lease_expires_at > now()`, ticketID, workerID, token, summary)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return ErrLeaseLost
	}
	return nil
}

func (s *Store) Complete(ctx context.Context, ticketID int64, token string, completion Completion) error {
	return s.finish(ctx, ticketID, token, StatusCompleted, completion.Summary, completion.CommitSHA, completion.ProductionURL)
}

func (s *Store) Fail(ctx context.Context, ticketID int64, token, summary string) error {
	return s.finish(ctx, ticketID, token, StatusFailed, summary, "", "")
}

func (s *Store) finish(ctx context.Context, ticketID int64, token, status, summary, commitSHA, productionURL string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	var leaseGuard bool
	if err := tx.QueryRow(ctx, `
		SELECT lease_key FROM ticket_worker_lease
		WHERE lease_key=true FOR UPDATE`).Scan(&leaseGuard); err != nil {
		return err
	}

	var currentStatus, resultSummary, failureSummary, storedCommitSHA, storedProductionURL string
	var leaseOwner, leaseToken sql.NullString
	var leaseExpiry sql.NullTime
	var finalizationTokenHash []byte
	err = tx.QueryRow(ctx, `
		SELECT status,lease_owner,lease_token,lease_expires_at,finalization_token_hash,
			result_summary,failure_summary,commit_sha,production_url
		FROM tickets WHERE id=$1 FOR UPDATE`, ticketID).Scan(
		&currentStatus, &leaseOwner, &leaseToken, &leaseExpiry, &finalizationTokenHash,
		&resultSummary, &failureSummary, &storedCommitSHA, &storedProductionURL,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrLeaseLost
	}
	if err != nil {
		return err
	}
	digest := sha256.Sum256([]byte(token))
	if currentStatus == status && constantTimeBytesEqual(finalizationTokenHash, digest[:]) {
		matches := status == StatusCompleted && resultSummary == summary && storedCommitSHA == commitSHA && storedProductionURL == productionURL
		if status == StatusFailed {
			matches = failureSummary == summary
		}
		if matches {
			return tx.Commit(ctx)
		}
		return ErrLeaseLost
	}
	if currentStatus != StatusWorking || !leaseOwner.Valid || !leaseToken.Valid || !leaseExpiry.Valid ||
		!leaseExpiry.Time.After(time.Now().UTC()) || !constantTimeStringEqual(leaseToken.String, token) {
		return ErrLeaseLost
	}
	workerID := leaseOwner.String

	var command pgconnCommandTag
	if status == StatusCompleted {
		command, err = tx.Exec(ctx, `
			UPDATE tickets SET status='completed',result_summary=$4,commit_sha=$5,production_url=$6,
				finalization_token_hash=$7,
				lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,completed_at=now(),updated_at=now()
			WHERE id=$1 AND status='working' AND lease_owner=$2 AND lease_token=$3
			  AND lease_expires_at > now()`, ticketID, workerID, token, summary, commitSHA, productionURL, digest[:])
	} else {
		command, err = tx.Exec(ctx, `
			UPDATE tickets SET status='failed',failure_summary=$4,finalization_token_hash=$5,
				lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,completed_at=now(),updated_at=now()
			WHERE id=$1 AND status='working' AND lease_owner=$2 AND lease_token=$3
			  AND lease_expires_at > now()`, ticketID, workerID, token, summary, digest[:])
	}
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return ErrLeaseLost
	}
	if _, err := tx.Exec(ctx, `
		UPDATE ticket_worker_lease SET owner=NULL,lease_token=NULL,current_ticket_id=NULL,
			heartbeat_at=now(),expires_at=NULL
		WHERE lease_key=true AND owner=$1 AND lease_token=$2`, workerID, token); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func constantTimeStringEqual(left, right string) bool {
	return len(left) == len(right) && subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}

func constantTimeBytesEqual(left, right []byte) bool {
	return len(left) == len(right) && subtle.ConstantTimeCompare(left, right) == 1
}

type pgconnCommandTag interface {
	RowsAffected() int64
}

func (s *Store) CancelByStatusMessage(ctx context.Context, chatID, statusMessageID int64) (int64, error) {
	var ticketID int64
	err := s.pool.QueryRow(ctx, `
		UPDATE tickets SET status='cancelled',updated_at=now(),completed_at=now()
		WHERE chat_id=$1 AND status_message_id=$2 AND status='queued'
		RETURNING id`, chatID, statusMessageID).Scan(&ticketID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrCannotCancel
	}
	return ticketID, err
}

func (s *Store) StatusView(ctx context.Context, ticketID int64) (StatusView, error) {
	return scanStatusView(s.pool.QueryRow(ctx, statusViewSQL+` WHERE t.id=$1`, ticketID))
}

func (s *Store) QueueStatusViews(ctx context.Context) ([]StatusView, error) {
	rows, err := s.pool.Query(ctx, statusViewSQL+` WHERE t.status='queued' ORDER BY t.created_at,t.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	views := make([]StatusView, 0)
	for rows.Next() {
		view, err := scanStatusView(rows)
		if err != nil {
			return nil, err
		}
		views = append(views, view)
	}
	return views, rows.Err()
}

func (s *Store) StatusViewsForSync(ctx context.Context, limit int) ([]StatusView, error) {
	if limit < 1 || limit > 2000 {
		return nil, errors.New("status sync limit must be between 1 and 2000")
	}
	rows, err := s.pool.Query(ctx, statusViewSQL+`
		WHERE t.status='queued'
		   OR t.status_message_id IS NULL
		   OR t.status_synced_at IS NULL
		   OR t.status_synced_at < t.updated_at
		   OR t.updated_at >= now() - interval '5 minutes'
		ORDER BY
			CASE WHEN t.status_synced_at IS NULL OR t.status_synced_at < t.updated_at THEN 0 ELSE 1 END,
			t.updated_at,t.id
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	views := make([]StatusView, 0)
	for rows.Next() {
		view, err := scanStatusView(rows)
		if err != nil {
			return nil, err
		}
		views = append(views, view)
	}
	return views, rows.Err()
}

const statusViewSQL = `
	SELECT t.id,t.chat_id,t.message_thread_id,t.first_message_id,t.source,t.project_key,
		t.status_message_id,t.last_status_text,t.status,
		CASE WHEN t.status='queued' THEN (
			SELECT count(*) FROM tickets q
			WHERE q.status='queued'
			  AND (q.created_at < t.created_at OR (q.created_at=t.created_at AND q.id <= t.id))
		) ELSE 0 END,
		t.progress_summary,t.result_summary,t.failure_summary,t.commit_sha,t.production_url,t.updated_at
	FROM tickets t`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanStatusView(row rowScanner) (StatusView, error) {
	var view StatusView
	err := row.Scan(
		&view.ID, &view.ChatID, &view.MessageThread, &view.FirstMessageID, &view.Source,
		&view.ProjectKey, &view.StatusMessageID, &view.LastStatusText, &view.Status, &view.QueuePosition,
		&view.ProgressSummary, &view.ResultSummary, &view.FailureSummary,
		&view.CommitSHA, &view.ProductionURL, &view.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return StatusView{}, ErrTicketNotFound
	}
	return view, err
}

func (s *Store) SaveStatusMessage(ctx context.Context, ticketID, messageID int64, text string, expectedUpdatedAt time.Time) error {
	var current bool
	err := s.pool.QueryRow(ctx, `
		UPDATE tickets SET
			status_message_id=COALESCE(status_message_id,$2),
			last_status_text=CASE WHEN updated_at=$4 THEN $3 ELSE last_status_text END,
			status_synced_at=CASE WHEN updated_at=$4 THEN now() ELSE status_synced_at END
		WHERE id=$1
		RETURNING updated_at=$4`, ticketID, messageID, text, expectedUpdatedAt).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrTicketNotFound
	}
	if err != nil {
		return err
	}
	if !current {
		return ErrStatusChanged
	}
	return nil
}

func (s *Store) SaveStatusText(ctx context.Context, ticketID int64, text string, expectedUpdatedAt time.Time) error {
	command, err := s.pool.Exec(ctx, `
		UPDATE tickets SET last_status_text=$2,status_synced_at=now()
		WHERE id=$1 AND status_message_id IS NOT NULL AND updated_at=$3`, ticketID, text, expectedUpdatedAt)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return ErrStatusChanged
	}
	return nil
}

func (s *Store) PendingAttachments(ctx context.Context, limit int) ([]Attachment, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id,ticket_id,message_id,telegram_file_id,telegram_file_unique_id,kind,
			mime_type,original_file_name,declared_size,download_status,local_path,
			byte_size,sha256,download_attempts,next_attempt_at
		FROM ticket_attachments
		WHERE download_status='pending' AND next_attempt_at <= now() AND download_attempts < 5
		ORDER BY next_attempt_at,id LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Attachment, 0)
	for rows.Next() {
		var item Attachment
		if err := rows.Scan(
			&item.ID, &item.TicketID, &item.MessageID, &item.FileID, &item.FileUniqueID,
			&item.Kind, &item.MIMEType, &item.FileName, &item.DeclaredSize,
			&item.DownloadStatus, &item.LocalPath, &item.ByteSize, &item.SHA256,
			&item.Attempts, &item.NextAttemptAt,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) MarkAttachmentReady(ctx context.Context, attachmentID int64, localPath string, byteSize int64, sha256 string) error {
	command, err := s.pool.Exec(ctx, `
		UPDATE ticket_attachments SET download_status='ready',local_path=$2,byte_size=$3,
			sha256=$4,download_attempts=download_attempts+1,downloaded_at=now()
		WHERE id=$1 AND download_status='pending'`, attachmentID, localPath, byteSize, sha256)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return ErrAttachmentAbsent
	}
	return nil
}

func (s *Store) MarkAttachmentFailure(ctx context.Context, attachmentID int64, retryAt time.Time, terminal bool) (int64, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	status := "pending"
	if terminal {
		status = "failed"
	}
	var ticketID int64
	err = tx.QueryRow(ctx, `
		UPDATE ticket_attachments SET download_status=$2,download_attempts=download_attempts+1,
			next_attempt_at=$3
		WHERE id=$1 AND download_status='pending'
		RETURNING ticket_id`, attachmentID, status, retryAt).Scan(&ticketID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrAttachmentAbsent
	}
	if err != nil {
		return 0, err
	}
	if terminal {
		if _, err := tx.Exec(ctx, `
			UPDATE tickets SET status='failed',failure_summary='Не удалось безопасно сохранить вложение.',
				completed_at=now(),updated_at=now()
			WHERE id=$1 AND status='queued'`, ticketID); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return ticketID, nil
}

func (s *Store) RetentionAttachments(ctx context.Context, cutoff time.Time, limit int) ([]RetentionAttachment, error) {
	if limit < 1 || limit > 2000 {
		return nil, errors.New("retention limit must be between 1 and 2000")
	}
	rows, err := s.pool.Query(ctx, `
		SELECT a.id,a.ticket_id,a.local_path
		FROM ticket_attachments a
		JOIN tickets t ON t.id=a.ticket_id
		WHERE a.download_status='ready' AND a.local_path<>''
		  AND t.status IN ('completed','failed','cancelled')
		  AND t.completed_at IS NOT NULL AND t.completed_at < $1
		ORDER BY t.completed_at,a.id
		LIMIT $2`, cutoff, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]RetentionAttachment, 0)
	for rows.Next() {
		var item RetentionAttachment
		if err := rows.Scan(&item.ID, &item.TicketID, &item.LocalPath); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) MarkAttachmentPurged(ctx context.Context, item RetentionAttachment, cutoff time.Time) error {
	command, err := s.pool.Exec(ctx, `
		UPDATE ticket_attachments a SET
			download_status='purged',local_path='',byte_size=NULL,sha256='',purged_at=now()
		FROM tickets t
		WHERE a.id=$1 AND a.ticket_id=$2 AND a.local_path=$3
		  AND a.download_status='ready' AND t.id=a.ticket_id
		  AND t.status IN ('completed','failed','cancelled')
		  AND t.completed_at IS NOT NULL AND t.completed_at < $4`,
		item.ID, item.TicketID, item.LocalPath, cutoff)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return ErrAttachmentAbsent
	}
	return nil
}

func (s *Store) AttachmentForWorker(ctx context.Context, ticketID, attachmentID int64, workerID, token string) (Attachment, error) {
	var item Attachment
	err := s.pool.QueryRow(ctx, `
		SELECT a.id,a.ticket_id,a.message_id,a.telegram_file_id,a.telegram_file_unique_id,
			a.kind,a.mime_type,a.original_file_name,a.declared_size,a.download_status,
			a.local_path,a.byte_size,a.sha256,a.download_attempts,a.next_attempt_at
		FROM ticket_attachments a
		JOIN tickets t ON t.id=a.ticket_id
		WHERE a.id=$1 AND a.ticket_id=$2 AND a.download_status='ready'
		  AND t.status='working' AND t.lease_owner=$3 AND t.lease_token=$4
		  AND t.lease_expires_at > now()`, attachmentID, ticketID, workerID, token).Scan(
		&item.ID, &item.TicketID, &item.MessageID, &item.FileID, &item.FileUniqueID,
		&item.Kind, &item.MIMEType, &item.FileName, &item.DeclaredSize,
		&item.DownloadStatus, &item.LocalPath, &item.ByteSize, &item.SHA256,
		&item.Attempts, &item.NextAttemptAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Attachment{}, ErrAttachmentAbsent
	}
	return item, err
}

func nullableTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value
}

func ValidateWorkerID(value string) error {
	if len(value) < 1 || len(value) > 128 {
		return errors.New("workerId must contain 1..128 characters")
	}
	for _, character := range value {
		if character < 0x21 || character > 0x7e {
			return errors.New("workerId contains unsupported characters")
		}
	}
	return nil
}

func ValidateSummary(value string, required bool) error {
	if required && value == "" {
		return errors.New("summary is required")
	}
	if len(value) > 12000 {
		return errors.New("summary is too long")
	}
	return nil
}

func ValidateTicketID(value int64) error {
	if value <= 0 {
		return fmt.Errorf("invalid ticket id")
	}
	return nil
}

func ValidateProjectKey(value string) error {
	switch value {
	case ProjectResidence, ProjectMarketMap:
		return nil
	default:
		return errors.New("unsupported project key")
	}
}

func projectKeyOrDefault(value string) string {
	if value == "" {
		return ProjectResidence
	}
	return value
}
