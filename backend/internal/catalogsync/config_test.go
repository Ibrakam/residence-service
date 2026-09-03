package catalogsync

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestLoadConfigAppliesSafeDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	body := `{
  "version": 1,
  "workDirectory": "/var/lib/residence-catalog-sync",
  "providers": [{
    "name": "kayan",
    "command": ["/opt/residence/capture-kayan", "--profile", "/var/lib/residence-crm-sessions/kayan"],
    "workingDirectory": "/opt/residence",
    "projects": {
      "mirador": {"minimumRecords": 100},
      "ofiyat": {"minimumRecords": 300}
    }
  }]
}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	config, err := LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	provider := config.Providers[0]
	if provider.CaptureTimeout() != 10*time.Minute {
		t.Fatalf("capture timeout=%s", provider.CaptureTimeout())
	}
	if provider.FreshnessDuration() != 30*time.Minute {
		t.Fatalf("freshness window=%s", provider.FreshnessDuration())
	}
	if provider.MaximumDropPercent() != 35 {
		t.Fatalf("maximum drop=%v", provider.MaximumDropPercent())
	}
	if got := strings.Join(provider.ProjectSlugs(), ","); got != "mirador,ofiyat" {
		t.Fatalf("sorted project slugs=%q", got)
	}
}

func TestConfigRejectsUnsafeOrAmbiguousOwnership(t *testing.T) {
	valid := Config{
		Version:       1,
		WorkDirectory: "/var/lib/residence-catalog-sync",
		Providers: []ProviderConfig{{
			Name: "kayan", Command: []string{"/opt/capture"},
			Projects: map[string]ProjectPolicy{"mirador": {MinimumRecords: 10}},
		}},
	}
	checks := []struct {
		name   string
		mutate func(*Config)
	}{
		{"filesystem root", func(config *Config) { config.WorkDirectory = "/" }},
		{"relative executable", func(config *Config) { config.Providers[0].Command[0] = "capture" }},
		{"zero minimum", func(config *Config) { config.Providers[0].Projects["mirador"] = ProjectPolicy{} }},
		{"duplicate project owner", func(config *Config) {
			config.Providers = append(config.Providers, ProviderConfig{
				Name: "other", Command: []string{"/opt/other"},
				Projects: map[string]ProjectPolicy{"mirador": {MinimumRecords: 1}},
			})
		}},
	}
	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			config := valid
			config.Providers = append([]ProviderConfig(nil), valid.Providers...)
			config.Providers[0].Command = append([]string(nil), valid.Providers[0].Command...)
			config.Providers[0].Projects = map[string]ProjectPolicy{"mirador": {MinimumRecords: 10}}
			check.mutate(&config)
			if err := config.Validate(); err == nil {
				t.Fatal("unsafe configuration was accepted")
			}
		})
	}
}

func TestLoadConfigRejectsUnknownAndTrailingJSON(t *testing.T) {
	for _, body := range []string{
		`{"version":1,"workDirectory":"/var/lib/sync","providers":[],"secret":"must-not-be-here"}`,
		`{"version":1,"workDirectory":"/var/lib/sync","providers":[]} {}`,
	} {
		path := filepath.Join(t.TempDir(), "config.json")
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := LoadConfig(path); err == nil {
			t.Fatalf("invalid JSON was accepted: %s", body)
		}
	}
}

func TestProductionExampleOwnsAllLiveProjects(t *testing.T) {
	config, err := LoadConfig(filepath.Join("..", "..", "catalog-sync.example.json"))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string][]string{
		"human2human": {"sun"},
		"kayan":       {"mirador", "ofiyat"},
		"mbc":         {"regnum-plaza"},
		"nrg-bi": {
			"4u", "bayterak", "botanika-saroyi", "flagman", "jomiy", "maftun-makon",
			"meros", "sado", "voha", "yangibaxt", "zamon",
		},
		"uysot": {"avalon-residence"},
	}
	got := make(map[string][]string, len(config.Providers))
	for _, provider := range config.Providers {
		got[provider.Name] = provider.ProjectSlugs()
		if provider.WorkingDirectory != "/opt/residence-live-sync" {
			t.Errorf("provider %q workingDirectory=%q", provider.Name, provider.WorkingDirectory)
		}
		if len(provider.Command) != 1 || provider.Command[0] != "/opt/residence-live-sync/bin/capture-"+provider.Name {
			t.Errorf("provider %q command=%q", provider.Name, provider.Command)
		}
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("production ownership=%v, want %v", got, want)
	}
}
