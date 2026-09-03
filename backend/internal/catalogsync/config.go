package catalogsync

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	ConfigVersion          = 1
	defaultCaptureTimeout  = 10 * time.Minute
	maximumCaptureTimeout  = time.Hour
	defaultMaximumDropRate = 35.0
	defaultFreshnessWindow = 30 * time.Minute
)

var safeNamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

type Config struct {
	Version       int              `json:"version"`
	WorkDirectory string           `json:"workDirectory"`
	Providers     []ProviderConfig `json:"providers"`
}

type ProviderConfig struct {
	Name                     string                   `json:"name"`
	Command                  []string                 `json:"command"`
	WorkingDirectory         string                   `json:"workingDirectory,omitempty"`
	Timeout                  string                   `json:"timeout,omitempty"`
	FreshnessWindow          string                   `json:"freshnessWindow,omitempty"`
	MaximumRecordDropPercent *float64                 `json:"maximumRecordDropPercent,omitempty"`
	Projects                 map[string]ProjectPolicy `json:"projects"`

	captureTimeout  time.Duration
	freshnessWindow time.Duration
	maximumDrop     float64
}

type ProjectPolicy struct {
	MinimumRecords int `json:"minimumRecords"`
}

func LoadConfig(path string) (Config, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("read catalog sync config: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	var config Config
	if err := decoder.Decode(&config); err != nil {
		return Config{}, fmt.Errorf("decode catalog sync config: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return Config{}, errors.New("decode catalog sync config: trailing JSON value")
		}
		return Config{}, fmt.Errorf("decode catalog sync config: %w", err)
	}
	if err := config.Validate(); err != nil {
		return Config{}, err
	}
	return config, nil
}

func (config *Config) Validate() error {
	if config.Version != ConfigVersion {
		return fmt.Errorf("catalog sync config version must be %d", ConfigVersion)
	}
	if !filepath.IsAbs(config.WorkDirectory) {
		return errors.New("catalog sync workDirectory must be absolute")
	}
	cleanWorkDirectory := filepath.Clean(config.WorkDirectory)
	if cleanWorkDirectory == string(filepath.Separator) {
		return errors.New("catalog sync workDirectory cannot be the filesystem root")
	}
	config.WorkDirectory = cleanWorkDirectory
	if len(config.Providers) == 0 {
		return errors.New("catalog sync config has no providers")
	}

	providers := make(map[string]struct{}, len(config.Providers))
	projectOwners := make(map[string]string)
	for index := range config.Providers {
		provider := &config.Providers[index]
		if !safeNamePattern.MatchString(provider.Name) {
			return fmt.Errorf("provider %d has an invalid name", index+1)
		}
		if _, duplicate := providers[provider.Name]; duplicate {
			return fmt.Errorf("provider %q is configured more than once", provider.Name)
		}
		providers[provider.Name] = struct{}{}
		if len(provider.Command) == 0 || !filepath.IsAbs(provider.Command[0]) {
			return fmt.Errorf("provider %q command must start with an absolute executable path", provider.Name)
		}
		for _, argument := range provider.Command {
			if strings.ContainsRune(argument, '\x00') {
				return fmt.Errorf("provider %q command contains an invalid argument", provider.Name)
			}
		}
		if provider.WorkingDirectory != "" {
			if !filepath.IsAbs(provider.WorkingDirectory) {
				return fmt.Errorf("provider %q workingDirectory must be absolute", provider.Name)
			}
			provider.WorkingDirectory = filepath.Clean(provider.WorkingDirectory)
		}

		provider.captureTimeout = defaultCaptureTimeout
		if provider.Timeout != "" {
			parsed, err := time.ParseDuration(provider.Timeout)
			if err != nil || parsed < 10*time.Second || parsed > maximumCaptureTimeout {
				return fmt.Errorf("provider %q timeout must be between 10s and 1h", provider.Name)
			}
			provider.captureTimeout = parsed
		}
		provider.freshnessWindow = defaultFreshnessWindow
		if provider.FreshnessWindow != "" {
			parsed, err := time.ParseDuration(provider.FreshnessWindow)
			if err != nil || parsed < time.Minute || parsed > 24*time.Hour {
				return fmt.Errorf("provider %q freshnessWindow must be between 1m and 24h", provider.Name)
			}
			provider.freshnessWindow = parsed
		}
		provider.maximumDrop = defaultMaximumDropRate
		if provider.MaximumRecordDropPercent != nil {
			if *provider.MaximumRecordDropPercent < 0 || *provider.MaximumRecordDropPercent > 90 {
				return fmt.Errorf("provider %q maximumRecordDropPercent must be between 0 and 90", provider.Name)
			}
			provider.maximumDrop = *provider.MaximumRecordDropPercent
		}

		if len(provider.Projects) == 0 {
			return fmt.Errorf("provider %q has no projects", provider.Name)
		}
		for slug, policy := range provider.Projects {
			if !safeNamePattern.MatchString(slug) {
				return fmt.Errorf("provider %q has an invalid project slug", provider.Name)
			}
			if policy.MinimumRecords <= 0 {
				return fmt.Errorf("provider %q project %q minimumRecords must be positive", provider.Name, slug)
			}
			if owner, duplicate := projectOwners[slug]; duplicate {
				return fmt.Errorf("project %q is owned by both %q and %q", slug, owner, provider.Name)
			}
			projectOwners[slug] = provider.Name
		}
	}
	return nil
}

func (provider ProviderConfig) CaptureTimeout() time.Duration {
	return provider.captureTimeout
}

func (provider ProviderConfig) MaximumDropPercent() float64 {
	return provider.maximumDrop
}

func (provider ProviderConfig) FreshnessDuration() time.Duration {
	return provider.freshnessWindow
}

func (provider ProviderConfig) ProjectSlugs() []string {
	result := make([]string, 0, len(provider.Projects))
	for slug := range provider.Projects {
		result = append(result, slug)
	}
	sort.Strings(result)
	return result
}
