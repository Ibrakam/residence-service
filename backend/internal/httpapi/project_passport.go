package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	defaultMarketMapURL          = "http://127.0.0.1:8765"
	maxMarketMapPassportResponse = 128 << 10
	maxConstructionPassports     = 50
	constructionPassportFreshTTL = 2 * time.Minute
	constructionPassportStaleTTL = 10 * time.Minute
	constructionPassportRetryMin = 5 * time.Second
	constructionPassportRetryMax = time.Minute
)

var officialPassportPathPattern = regexp.MustCompile(`^/object-info/[1-9][0-9]*$`)

type marketMapPassportPayload struct {
	Project struct {
		Key string `json:"key"`
	} `json:"project"`
	Objects []struct {
		ObjectID        int64  `json:"object_id"`
		Name            string `json:"name"`
		Address         string `json:"address"`
		ProjectLinkedAt string `json:"project_linked_at"`
		Documents       struct {
			OfficialPassport string `json:"official_dshk_passport"`
		} `json:"documents"`
	} `json:"objects"`
	ObjectCount int `json:"object_count"`
}

type constructionPassportLink struct {
	ObjectID int64  `json:"objectId"`
	Name     string `json:"name,omitempty"`
	Address  string `json:"address,omitempty"`
	URL      string `json:"url"`
	LinkedAt string `json:"linkedAt,omitempty"`
}

type constructionPassportsPayload struct {
	ProjectKey  string                     `json:"projectKey"`
	Linked      bool                       `json:"linked"`
	ObjectCount int                        `json:"objectCount"`
	Passports   []constructionPassportLink `json:"passports"`
}

type constructionPassportFetchError struct {
	code    string
	message string
}

func (e *constructionPassportFetchError) Error() string {
	return e.code
}

type constructionPassportCacheEntry struct {
	payload       constructionPassportsPayload
	hasPayload    bool
	fetchedAt     time.Time
	retryAt       time.Time
	retryFailures uint8
	lastError     *constructionPassportFetchError
}

type constructionPassportFetchResult struct {
	payload constructionPassportsPayload
	stale   bool
	err     *constructionPassportFetchError
}

type constructionPassportFlight struct {
	done   chan struct{}
	result constructionPassportFetchResult
}

type constructionPassportCacheState struct {
	mu      sync.Mutex
	entries map[string]constructionPassportCacheEntry
	flights map[string]*constructionPassportFlight
}

var constructionPassportCache = constructionPassportCacheState{
	entries: make(map[string]constructionPassportCacheEntry),
	flights: make(map[string]*constructionPassportFlight),
}

func parseMarketMapURL(raw string) *url.URL {
	if strings.TrimSpace(raw) == "" {
		raw = defaultMarketMapURL
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.RawPath != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil
	}
	host := parsed.Hostname()
	ip := net.ParseIP(host)
	if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return nil
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	return parsed
}

func publicPassportLabel(raw string, maxRunes int) string {
	value := strings.TrimSpace(raw)
	if utf8.RuneCountInString(value) <= maxRunes {
		return value
	}
	return string([]rune(value)[:maxRunes])
}

func passportLinkedTime(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}
	}
	return parsed
}

func officialPassportURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() != "api-nazorat.mc.uz" || parsed.Port() != "" || parsed.User != nil || parsed.RawPath != "" || parsed.RawQuery != "" || parsed.Fragment != "" || !officialPassportPathPattern.MatchString(parsed.Path) {
		return ""
	}
	return parsed.String()
}

func constructionPassportCacheKey(s *Server, projectKey string) string {
	return s.marketMapURL.String() + "\x00" + projectKey
}

func cloneConstructionPassportsPayload(payload constructionPassportsPayload) constructionPassportsPayload {
	cloned := payload
	cloned.Passports = append([]constructionPassportLink(nil), payload.Passports...)
	return cloned
}

func passportFetchError(code, message string) *constructionPassportFetchError {
	return &constructionPassportFetchError{code: code, message: message}
}

func (s *Server) fetchConstructionPassports(projectKey string) (constructionPassportsPayload, *constructionPassportFetchError) {
	endpoint := *s.marketMapURL
	endpoint.Path += "/api/project-passports/" + projectKey
	request, err := http.NewRequest(http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return constructionPassportsPayload{}, passportFetchError("project_passport_unavailable", "Project passport service is unavailable")
	}
	request.Header.Set("Accept", "application/json")
	response, err := s.marketMapClient.Do(request)
	if err != nil {
		s.logger.Warn("market map project passport unavailable", "project_key", projectKey, "error_type", fmt.Sprintf("%T", err))
		return constructionPassportsPayload{}, passportFetchError("project_passport_unavailable", "Project passport service is unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return constructionPassportsPayload{}, passportFetchError("project_passport_unavailable", "Project passport service is unavailable")
	}

	body, err := io.ReadAll(io.LimitReader(response.Body, maxMarketMapPassportResponse+1))
	if err != nil || len(body) > maxMarketMapPassportResponse {
		return constructionPassportsPayload{}, passportFetchError("invalid_project_passport", "Project passport response is invalid")
	}
	var upstream marketMapPassportPayload
	if err := json.Unmarshal(body, &upstream); err != nil || upstream.Project.Key != projectKey || upstream.ObjectCount != len(upstream.Objects) {
		return constructionPassportsPayload{}, passportFetchError("invalid_project_passport", "Project passport response is invalid")
	}

	result := constructionPassportsPayload{
		ProjectKey:  projectKey,
		Linked:      len(upstream.Objects) > 0,
		ObjectCount: len(upstream.Objects),
		Passports:   []constructionPassportLink{},
	}
	seenURLs := make(map[string]struct{})
	for _, object := range upstream.Objects {
		if object.ObjectID <= 0 {
			continue
		}
		candidate := officialPassportURL(object.Documents.OfficialPassport)
		if candidate == "" {
			continue
		}
		if _, duplicate := seenURLs[candidate]; duplicate {
			continue
		}
		if len(result.Passports) >= maxConstructionPassports {
			return constructionPassportsPayload{}, passportFetchError("invalid_project_passport", "Project passport response is invalid")
		}
		seenURLs[candidate] = struct{}{}
		linkedAt := publicPassportLabel(object.ProjectLinkedAt, 64)
		if passportLinkedTime(linkedAt).IsZero() {
			linkedAt = ""
		}
		result.Passports = append(result.Passports, constructionPassportLink{
			ObjectID: object.ObjectID,
			Name:     publicPassportLabel(object.Name, 180),
			Address:  publicPassportLabel(object.Address, 240),
			URL:      candidate,
			LinkedAt: linkedAt,
		})
	}
	sort.Slice(result.Passports, func(left, right int) bool {
		leftTime := passportLinkedTime(result.Passports[left].LinkedAt)
		rightTime := passportLinkedTime(result.Passports[right].LinkedAt)
		if !leftTime.Equal(rightTime) {
			return leftTime.After(rightTime)
		}
		return result.Passports[left].ObjectID < result.Passports[right].ObjectID
	})
	return result, nil
}

func (s *Server) cachedConstructionPassports(ctx context.Context, projectKey string) constructionPassportFetchResult {
	now := time.Now()
	cacheKey := constructionPassportCacheKey(s, projectKey)

	constructionPassportCache.mu.Lock()
	if entry, ok := constructionPassportCache.entries[cacheKey]; ok {
		if entry.hasPayload {
			age := now.Sub(entry.fetchedAt)
			if age < constructionPassportFreshTTL {
				constructionPassportCache.mu.Unlock()
				return constructionPassportFetchResult{payload: cloneConstructionPassportsPayload(entry.payload)}
			}
			if age < constructionPassportStaleTTL && now.Before(entry.retryAt) {
				constructionPassportCache.mu.Unlock()
				return constructionPassportFetchResult{payload: cloneConstructionPassportsPayload(entry.payload), stale: true}
			}
		}
		if entry.lastError != nil && now.Before(entry.retryAt) {
			constructionPassportCache.mu.Unlock()
			return constructionPassportFetchResult{err: entry.lastError}
		}
	}
	if flight, ok := constructionPassportCache.flights[cacheKey]; ok {
		constructionPassportCache.mu.Unlock()
		select {
		case <-flight.done:
			result := flight.result
			result.payload = cloneConstructionPassportsPayload(result.payload)
			return result
		case <-ctx.Done():
			return constructionPassportFetchResult{err: passportFetchError("project_passport_unavailable", "Project passport service is unavailable")}
		}
	}
	flight := &constructionPassportFlight{done: make(chan struct{})}
	constructionPassportCache.flights[cacheKey] = flight
	constructionPassportCache.mu.Unlock()

	payload, fetchErr := s.fetchConstructionPassports(projectKey)
	result := constructionPassportFetchResult{payload: payload, err: fetchErr}
	completedAt := time.Now()

	constructionPassportCache.mu.Lock()
	if fetchErr == nil {
		constructionPassportCache.entries[cacheKey] = constructionPassportCacheEntry{
			payload:    cloneConstructionPassportsPayload(payload),
			hasPayload: true,
			fetchedAt:  completedAt,
		}
	} else {
		entry := constructionPassportCache.entries[cacheKey]
		if entry.retryFailures < 5 {
			entry.retryFailures++
		}
		retryDelay := constructionPassportRetryMin * time.Duration(1<<(entry.retryFailures-1))
		if retryDelay > constructionPassportRetryMax {
			retryDelay = constructionPassportRetryMax
		}
		entry.retryAt = completedAt.Add(retryDelay)
		entry.lastError = fetchErr
		constructionPassportCache.entries[cacheKey] = entry
		if entry.hasPayload && completedAt.Sub(entry.fetchedAt) < constructionPassportStaleTTL {
			result = constructionPassportFetchResult{payload: cloneConstructionPassportsPayload(entry.payload), stale: true}
		}
	}
	flight.result = result
	delete(constructionPassportCache.flights, cacheKey)
	close(flight.done)
	constructionPassportCache.mu.Unlock()

	result.payload = cloneConstructionPassportsPayload(result.payload)
	return result
}

func (s *Server) getConstructionPassports(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	projectKey := strings.TrimSpace(r.PathValue("projectKey"))
	if len(projectKey) > 80 || !projectSlugPattern.MatchString(projectKey) {
		writeError(w, http.StatusBadRequest, "invalid_project_key", "projectKey must be a valid published project key")
		return
	}
	if _, published := publishedSalesSiteRoutes[projectKey]; !published {
		writeError(w, http.StatusNotFound, "project_not_published", "Published project was not found")
		return
	}
	if s.marketMapURL == nil || s.marketMapClient == nil {
		writeError(w, http.StatusServiceUnavailable, "project_passport_unavailable", "Project passport service is unavailable")
		return
	}

	result := s.cachedConstructionPassports(r.Context(), projectKey)
	if result.err != nil {
		writeError(w, http.StatusBadGateway, result.err.code, result.err.message)
		return
	}
	if result.stale {
		w.Header().Set("Warning", `110 - "Response is stale"`)
	}
	writeJSON(w, http.StatusOK, result.payload)
}
