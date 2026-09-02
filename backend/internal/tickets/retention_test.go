package tickets

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRemoveRetentionAttachmentRequiresExactSafePath(t *testing.T) {
	root := t.TempDir()
	ticketDir := filepath.Join(root, "7")
	if err := os.Mkdir(ticketDir, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(ticketDir, "9.png")
	if err := os.WriteFile(path, []byte("image"), 0o600); err != nil {
		t.Fatal(err)
	}
	removed, err := removeRetentionAttachment(root, RetentionAttachment{ID: 9, TicketID: 7, LocalPath: path})
	if err != nil || !removed {
		t.Fatalf("remove safe attachment = %v, %v", removed, err)
	}
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		t.Fatalf("retained file still exists: %v", err)
	}
	removed, err = removeRetentionAttachment(root, RetentionAttachment{ID: 9, TicketID: 7, LocalPath: path})
	if err != nil || removed {
		t.Fatalf("idempotent missing attachment = %v, %v", removed, err)
	}
}

func TestRemoveRetentionAttachmentRejectsEscapeAndSymlink(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "9.png")
	if err := os.WriteFile(outside, []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := removeRetentionAttachment(root, RetentionAttachment{ID: 9, TicketID: 7, LocalPath: outside}); err == nil {
		t.Fatal("path outside attachment root was accepted")
	}

	realDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(realDir, "9.png"), []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(realDir, filepath.Join(root, "7")); err != nil {
		t.Fatal(err)
	}
	symlinkPath := filepath.Join(root, "7", "9.png")
	if _, err := removeRetentionAttachment(root, RetentionAttachment{ID: 9, TicketID: 7, LocalPath: symlinkPath}); err == nil {
		t.Fatal("symlinked ticket directory was accepted")
	}
	if _, err := os.Stat(filepath.Join(realDir, "9.png")); err != nil {
		t.Fatalf("outside file was touched: %v", err)
	}
}

func TestAttachmentDiskUsageFailsClosedOnSymlink(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "regular.bin"), []byte("12345"), 0o600); err != nil {
		t.Fatal(err)
	}
	bytes, files, err := attachmentDiskUsage(root)
	if err != nil || bytes != 5 || files != 1 {
		t.Fatalf("usage bytes=%d files=%d error=%v", bytes, files, err)
	}
	if err := os.Symlink(filepath.Join(root, "regular.bin"), filepath.Join(root, "link.bin")); err != nil {
		t.Fatal(err)
	}
	if _, _, err := attachmentDiskUsage(root); err == nil {
		t.Fatal("disk scan accepted a symlink")
	}
}
