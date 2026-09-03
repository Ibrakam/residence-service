package catalogsync

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCaptureEnvironmentDoesNotForwardApplicationSecrets(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://secret")
	t.Setenv("TELEGRAM_BOT_TOKEN", "secret-token")
	t.Setenv("DISPLAY", ":99")
	t.Setenv("LIVE_SYNC_CDP_KAYAN_URL", "http://127.0.0.1:9222")
	environment := captureEnvironment("kayan", "/tmp/output", "/tmp/work")
	joined := strings.Join(environment, "\n")
	for _, forbidden := range []string{"DATABASE_URL=", "TELEGRAM_BOT_TOKEN=", "secret-token", "postgres://secret"} {
		if strings.Contains(joined, forbidden) {
			t.Fatalf("capture environment contains %q", forbidden)
		}
	}
	for _, required := range []string{"CATALOG_OUTPUT_DIR=/tmp/output", "CATALOG_PROVIDER=kayan", "DISPLAY=:99", "LIVE_SYNC_CDP_KAYAN_URL=http://127.0.0.1:9222", "TMPDIR=/tmp/work"} {
		if !strings.Contains(joined, required) {
			t.Fatalf("capture environment lacks %q", required)
		}
	}
}

func TestCaptureTimeoutKillsProcessGroup(t *testing.T) {
	provider := ProviderConfig{
		Name: "test", Command: []string{"/bin/sh", "-c", "sleep 10"},
		captureTimeout: 50 * time.Millisecond,
	}
	ctx, cancel := context.WithTimeout(context.Background(), provider.captureTimeout)
	defer cancel()
	started := time.Now()
	err := runCaptureCommand(ctx, provider, t.TempDir(), t.TempDir())
	if err == nil {
		t.Fatal("timed out capture succeeded")
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("timed out capture took %s", elapsed)
	}
}

func TestStagingTreeRejectsSymlinks(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "target.json")
	if err := os.WriteFile(target, []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(root, "leak.json")); err != nil {
		t.Fatal(err)
	}
	if err := validateStagingTree(root); err == nil {
		t.Fatal("staging symlink was accepted")
	}
}

func TestWorkDirectoryMustBePrivate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "work")
	if err := os.Mkdir(path, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := ensurePrivateDirectory(path); err == nil {
		t.Fatal("non-private work directory was accepted")
	}
	if err := os.Chmod(path, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := ensurePrivateDirectory(path); err != nil {
		t.Fatalf("private owned work directory was rejected: %v", err)
	}
}

func TestRemoveStagingDirectoryStaysInsideParent(t *testing.T) {
	parent := t.TempDir()
	outside := t.TempDir()
	removeStagingDirectory(parent, outside)
	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("out-of-scope directory was removed: %v", err)
	}
	inside := filepath.Join(parent, ".provider-123")
	if err := os.Mkdir(inside, 0o700); err != nil {
		t.Fatal(err)
	}
	removeStagingDirectory(parent, inside)
	if _, err := os.Stat(inside); !os.IsNotExist(err) {
		t.Fatalf("staging directory still exists: %v", err)
	}
}
