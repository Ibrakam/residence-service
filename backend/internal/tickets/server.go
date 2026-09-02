package tickets

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const RunnerAPIVersion = "ticket-runner/v1"

type runnerStore interface {
	Health(context.Context) (Health, error)
	Claim(context.Context, string, string, time.Duration) (ClaimResult, error)
	LeaseOwner(context.Context, int64, string) (string, error)
	Heartbeat(context.Context, string, string, time.Duration) (time.Time, error)
	UpdateProgress(context.Context, int64, string, string, string) error
	Complete(context.Context, int64, string, Completion) error
	Fail(context.Context, int64, string, string) error
	AttachmentForWorker(context.Context, int64, int64, string, string) (Attachment, error)
	EnqueueTest(context.Context, int64, string) (int64, error)
}

type WorkerServer struct {
	store         runnerStore
	bearerToken   []byte
	leaseTTL      time.Duration
	chatID        int64
	attachmentDir string
	publicBaseURL *url.URL
	handler       http.Handler
}

func NewWorkerServer(cfg Config, store runnerStore) (*WorkerServer, error) {
	publicBaseURL, err := url.Parse(cfg.PublicWorkerBaseURL)
	if err != nil {
		return nil, errors.New("parse public worker base URL")
	}
	server := &WorkerServer{
		store:       store,
		bearerToken: []byte(cfg.WorkerAPIToken), leaseTTL: cfg.WorkerLeaseTTL,
		chatID: cfg.TelegramChatID, attachmentDir: cfg.AttachmentDir, publicBaseURL: publicBaseURL,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", server.handleLiveness)
	mux.HandleFunc("GET /internal/ticket-runner/health", server.protect(server.handleHealth))
	mux.HandleFunc("POST /internal/ticket-runner/lease", server.protect(server.handleLease))
	mux.HandleFunc("POST /internal/ticket-runner/test-tickets", server.protect(server.handleTestTicket))
	mux.HandleFunc("POST /internal/ticket-runner/tickets/{ticketID}/heartbeat", server.protect(server.handleHeartbeat))
	mux.HandleFunc("POST /internal/ticket-runner/tickets/{ticketID}/progress", server.protect(server.handleProgress))
	mux.HandleFunc("POST /internal/ticket-runner/tickets/{ticketID}/complete", server.protect(server.handleComplete))
	mux.HandleFunc("POST /internal/ticket-runner/tickets/{ticketID}/fail", server.protect(server.handleFail))
	mux.HandleFunc("GET /internal/ticket-runner/tickets/{ticketID}/attachments/{attachmentID}", server.protect(server.handleAttachment))
	server.handler = securityHeaders(mux)
	return server, nil
}

func (s *WorkerServer) Handler() http.Handler { return s.handler }

func (s *WorkerServer) protect(next http.HandlerFunc) http.HandlerFunc {
	return func(response http.ResponseWriter, request *http.Request) {
		provided := strings.TrimPrefix(request.Header.Get("Authorization"), "Bearer ")
		if len(provided) != len(s.bearerToken) || subtle.ConstantTimeCompare([]byte(provided), s.bearerToken) != 1 {
			response.Header().Set("WWW-Authenticate", `Bearer realm="ticket-runner"`)
			writeError(response, http.StatusUnauthorized, "unauthorized")
			return
		}
		next(response, request)
	}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Cache-Control", "no-store")
		response.Header().Set("X-Content-Type-Options", "nosniff")
		response.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(response, request)
	})
}

func (s *WorkerServer) handleLiveness(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{"ok": true, "version": RunnerAPIVersion})
}

func (s *WorkerServer) handleHealth(response http.ResponseWriter, request *http.Request) {
	health, err := s.store.Health(request.Context())
	if err != nil {
		writeError(response, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"ok": true, "version": RunnerAPIVersion,
		"queued": health.Queued, "ready": health.Ready, "working": health.Working,
	})
}

func (s *WorkerServer) handleLease(response http.ResponseWriter, request *http.Request) {
	var input struct {
		WorkerID string `json:"workerId"`
	}
	if request.ContentLength != 0 {
		if err := decodeJSON(response, request, &input); err != nil {
			return
		}
	}
	if input.WorkerID == "" {
		input.WorkerID = "ticket-runner"
	}
	if err := ValidateWorkerID(input.WorkerID); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_worker_id")
		return
	}
	token, err := randomLeaseToken()
	if err != nil {
		writeError(response, http.StatusInternalServerError, "lease_generation_failed")
		return
	}
	claim, err := s.store.Claim(request.Context(), input.WorkerID, token, s.leaseTTL)
	if errors.Is(err, ErrWorkerBusy) {
		writeError(response, http.StatusConflict, "worker_busy")
		return
	}
	if err != nil {
		writeError(response, http.StatusServiceUnavailable, "claim_failed")
		return
	}
	if claim.Ticket == nil {
		response.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(response, http.StatusOK, s.leaseResponse(claim))
}

func (s *WorkerServer) leaseResponse(claim ClaimResult) map[string]any {
	ticket := claim.Ticket
	attachments := make([]map[string]any, 0, len(ticket.Attachments))
	for _, item := range ticket.Attachments {
		size := item.DeclaredSize
		if item.ByteSize != nil {
			size = item.ByteSize
		}
		attachmentURL := *s.publicBaseURL
		attachmentURL.Path = joinURLPath(attachmentURL.Path,
			fmt.Sprintf("internal/ticket-runner/tickets/%d/attachments/%d", ticket.ID, item.ID))
		attachments = append(attachments, map[string]any{
			"id": item.ID, "url": attachmentURL.String(), "mimeType": item.MIMEType,
			"fileName": item.FileName, "sizeBytes": size, "sha256": item.SHA256,
		})
	}
	return map[string]any{
		"leaseToken": claim.LeaseToken, "leaseExpiresAt": claim.ExpiresAt,
		"ticket": map[string]any{
			"id": ticket.ID, "attempt": ticket.AttemptCount, "title": ticketTitle(*ticket),
			"body": ticket.Body, "attachments": attachments,
		},
	}
}

func joinURLPath(basePath, suffix string) string {
	return strings.TrimRight(basePath, "/") + "/" + strings.TrimLeft(suffix, "/")
}

func ticketTitle(ticket Ticket) string {
	line := strings.TrimSpace(strings.SplitN(ticket.Body, "\n", 2)[0])
	if line == "" {
		line = fmt.Sprintf("Telegram ticket TNC-%d", ticket.ID)
	}
	if ticket.Source == "operator_test" {
		line = "[TEST] " + line
	}
	return truncateUTF8(line, 160)
}

func (s *WorkerServer) handleHeartbeat(response http.ResponseWriter, request *http.Request) {
	ticketID, token, workerID, ok := s.ticketLease(response, request)
	if !ok {
		return
	}
	expiresAt, err := s.store.Heartbeat(request.Context(), workerID, token, s.leaseTTL)
	if errors.Is(err, ErrLeaseLost) {
		writeError(response, http.StatusConflict, "lease_lost")
		return
	}
	if err != nil {
		writeError(response, http.StatusServiceUnavailable, "heartbeat_failed")
		return
	}
	_ = ticketID
	writeJSON(response, http.StatusOK, map[string]any{"leaseExpiresAt": expiresAt})
}

func (s *WorkerServer) handleProgress(response http.ResponseWriter, request *http.Request) {
	ticketID, token, workerID, ok := s.ticketLease(response, request)
	if !ok {
		return
	}
	var input struct {
		Summary string `json:"summary"`
		Message string `json:"message"`
	}
	if err := decodeJSON(response, request, &input); err != nil {
		return
	}
	if input.Summary == "" {
		input.Summary = input.Message
	}
	if err := ValidateSummary(input.Summary, true); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_summary")
		return
	}
	if err := s.store.UpdateProgress(request.Context(), ticketID, workerID, token, input.Summary); err != nil {
		s.writeLeaseMutationError(response, err, "progress_failed")
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"ok": true})
}

func (s *WorkerServer) handleComplete(response http.ResponseWriter, request *http.Request) {
	ticketID, token, ok := s.ticketToken(response, request)
	if !ok {
		return
	}
	var input Completion
	if err := decodeJSON(response, request, &input); err != nil {
		return
	}
	if err := ValidateSummary(input.Summary, true); err != nil || len(input.CommitSHA) > 128 || len(input.ProductionURL) > 2048 {
		writeError(response, http.StatusBadRequest, "invalid_completion")
		return
	}
	if input.ProductionURL != "" {
		parsed, err := url.Parse(input.ProductionURL)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
			writeError(response, http.StatusBadRequest, "invalid_production_url")
			return
		}
	}
	if err := s.store.Complete(request.Context(), ticketID, token, input); err != nil {
		s.writeLeaseMutationError(response, err, "completion_failed")
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"ok": true})
}

func (s *WorkerServer) handleFail(response http.ResponseWriter, request *http.Request) {
	ticketID, token, ok := s.ticketToken(response, request)
	if !ok {
		return
	}
	var input struct {
		Summary string `json:"summary"`
		Message string `json:"message"`
	}
	if err := decodeJSON(response, request, &input); err != nil {
		return
	}
	if input.Summary == "" {
		input.Summary = input.Message
	}
	if err := ValidateSummary(input.Summary, true); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_summary")
		return
	}
	if err := s.store.Fail(request.Context(), ticketID, token, input.Summary); err != nil {
		s.writeLeaseMutationError(response, err, "failure_update_failed")
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"ok": true})
}

func (s *WorkerServer) handleTestTicket(response http.ResponseWriter, request *http.Request) {
	var input struct {
		Text string `json:"text"`
	}
	if err := decodeJSON(response, request, &input); err != nil {
		return
	}
	input.Text = strings.TrimSpace(input.Text)
	if input.Text == "" || len(input.Text) > 12000 {
		writeError(response, http.StatusBadRequest, "invalid_test_text")
		return
	}
	ticketID, err := s.store.EnqueueTest(request.Context(), s.chatID, input.Text)
	if err != nil {
		writeError(response, http.StatusServiceUnavailable, "enqueue_failed")
		return
	}
	writeJSON(response, http.StatusCreated, map[string]any{"id": ticketID, "status": StatusQueued})
}

func (s *WorkerServer) handleAttachment(response http.ResponseWriter, request *http.Request) {
	ticketID, token, workerID, ok := s.ticketLease(response, request)
	if !ok {
		return
	}
	attachmentID, err := strconv.ParseInt(request.PathValue("attachmentID"), 10, 64)
	if err != nil || attachmentID <= 0 {
		writeError(response, http.StatusBadRequest, "invalid_attachment_id")
		return
	}
	attachment, err := s.store.AttachmentForWorker(request.Context(), ticketID, attachmentID, workerID, token)
	if errors.Is(err, ErrAttachmentAbsent) {
		writeError(response, http.StatusNotFound, "attachment_not_found")
		return
	}
	if err != nil {
		writeError(response, http.StatusServiceUnavailable, "attachment_lookup_failed")
		return
	}
	file, info, err := secureOpen(s.attachmentDir, attachment.LocalPath)
	if err != nil {
		writeError(response, http.StatusNotFound, "attachment_not_found")
		return
	}
	defer file.Close()
	contentType := attachment.MIMEType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	response.Header().Set("Content-Type", contentType)
	fileName := attachment.FileName
	if fileName == "" {
		fileName = filepath.Base(attachment.LocalPath)
	}
	if disposition := mime.FormatMediaType("attachment", map[string]string{"filename": fileName}); disposition != "" {
		response.Header().Set("Content-Disposition", disposition)
	}
	http.ServeContent(response, request, fileName, info.ModTime(), file)
}

func (s *WorkerServer) ticketLease(response http.ResponseWriter, request *http.Request) (int64, string, string, bool) {
	ticketID, token, ok := s.ticketToken(response, request)
	if !ok {
		return 0, "", "", false
	}
	workerID, err := s.store.LeaseOwner(request.Context(), ticketID, token)
	if errors.Is(err, ErrLeaseLost) {
		writeError(response, http.StatusConflict, "lease_lost")
		return 0, "", "", false
	}
	if err != nil {
		writeError(response, http.StatusServiceUnavailable, "lease_lookup_failed")
		return 0, "", "", false
	}
	return ticketID, token, workerID, true
}

func (s *WorkerServer) ticketToken(response http.ResponseWriter, request *http.Request) (int64, string, bool) {
	ticketID, err := strconv.ParseInt(request.PathValue("ticketID"), 10, 64)
	if err != nil || ticketID <= 0 {
		writeError(response, http.StatusBadRequest, "invalid_ticket_id")
		return 0, "", false
	}
	token := request.Header.Get("X-Ticket-Lease")
	if token == "" || len(token) > 512 {
		writeError(response, http.StatusUnauthorized, "missing_ticket_lease")
		return 0, "", false
	}
	return ticketID, token, true
}

func (s *WorkerServer) writeLeaseMutationError(response http.ResponseWriter, err error, fallback string) {
	if errors.Is(err, ErrLeaseLost) {
		writeError(response, http.StatusConflict, "lease_lost")
		return
	}
	writeError(response, http.StatusServiceUnavailable, fallback)
}

func randomLeaseToken() (string, error) {
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func decodeJSON(response http.ResponseWriter, request *http.Request, destination any) error {
	request.Body = http.MaxBytesReader(response, request.Body, 32<<10)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_json")
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(response, http.StatusBadRequest, "invalid_json")
		return errors.New("multiple JSON values")
	}
	return nil
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func writeError(response http.ResponseWriter, status int, code string) {
	writeJSON(response, status, map[string]string{"error": code})
}

func secureOpen(root, path string) (*os.File, os.FileInfo, error) {
	rootPath, err := filepath.Abs(root)
	if err != nil {
		return nil, nil, err
	}
	filePath, err := filepath.Abs(path)
	if err != nil {
		return nil, nil, err
	}
	relative, err := filepath.Rel(rootPath, filePath)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return nil, nil, errors.New("attachment path escapes root")
	}
	info, err := os.Lstat(filePath)
	if err != nil || !info.Mode().IsRegular() {
		return nil, nil, errors.New("attachment is not a regular file")
	}
	file, err := os.Open(filePath)
	if err != nil {
		return nil, nil, err
	}
	openedInfo, err := file.Stat()
	if err != nil || !openedInfo.Mode().IsRegular() || !os.SameFile(info, openedInfo) {
		_ = file.Close()
		return nil, nil, errors.New("opened attachment is not regular")
	}
	return file, openedInfo, nil
}
