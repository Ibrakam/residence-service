package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	defaultMarketMapURL          = "http://127.0.0.1:8765"
	maxMarketMapPassportResponse = 128 << 10
	maxConstructionPassports     = 50
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

	endpoint := *s.marketMapURL
	endpoint.Path += "/api/project-passports/" + projectKey
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, endpoint.String(), nil)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "project_passport_unavailable", "Project passport service is unavailable")
		return
	}
	request.Header.Set("Accept", "application/json")
	response, err := s.marketMapClient.Do(request)
	if err != nil {
		s.logger.Warn("market map project passport unavailable", "project_key", projectKey, "error_type", fmt.Sprintf("%T", err))
		writeError(w, http.StatusBadGateway, "project_passport_unavailable", "Project passport service is unavailable")
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		writeError(w, http.StatusBadGateway, "project_passport_unavailable", "Project passport service is unavailable")
		return
	}

	body, err := io.ReadAll(io.LimitReader(response.Body, maxMarketMapPassportResponse+1))
	if err != nil || len(body) > maxMarketMapPassportResponse {
		writeError(w, http.StatusBadGateway, "invalid_project_passport", "Project passport response is invalid")
		return
	}
	var upstream marketMapPassportPayload
	if err := json.Unmarshal(body, &upstream); err != nil || upstream.Project.Key != projectKey || upstream.ObjectCount != len(upstream.Objects) {
		writeError(w, http.StatusBadGateway, "invalid_project_passport", "Project passport response is invalid")
		return
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
			writeError(w, http.StatusBadGateway, "invalid_project_passport", "Project passport response is invalid")
			return
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
	writeJSON(w, http.StatusOK, result)
}
