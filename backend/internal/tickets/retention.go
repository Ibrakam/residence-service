package tickets

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func CleanupTerminalAttachments(ctx context.Context, cfg Config, store *Store, dryRun bool, batchSize int, logger *slog.Logger) (RetentionStats, error) {
	var stats RetentionStats
	bytesBefore, filesBefore, err := attachmentDiskUsage(cfg.AttachmentDir)
	if err != nil {
		return stats, err
	}
	stats.BytesBefore, stats.FilesBefore = bytesBefore, filesBefore
	if bytesBefore >= cfg.AttachmentDiskWarnBytes {
		logger.Warn("ticket attachment disk usage exceeds configured warning threshold",
			"bytes", bytesBefore, "thresholdBytes", cfg.AttachmentDiskWarnBytes)
	}
	cutoff := time.Now().UTC().Add(-cfg.AttachmentRetention)
	for {
		items, err := store.RetentionAttachments(ctx, cutoff, batchSize)
		if err != nil {
			return stats, err
		}
		stats.Eligible += int64(len(items))
		if dryRun || len(items) == 0 {
			break
		}
		for _, item := range items {
			removed, err := removeRetentionAttachment(cfg.AttachmentDir, item)
			if err != nil {
				return stats, err
			}
			if err := store.MarkAttachmentPurged(ctx, item, cutoff); err != nil {
				return stats, err
			}
			if removed {
				stats.FilesRemoved++
			}
			stats.RecordsPurged++
		}
		if len(items) < batchSize {
			break
		}
	}
	bytesAfter, filesAfter, err := attachmentDiskUsage(cfg.AttachmentDir)
	if err != nil {
		return stats, err
	}
	stats.BytesAfter, stats.FilesAfter = bytesAfter, filesAfter
	if bytesAfter >= cfg.AttachmentDiskWarnBytes {
		logger.Warn("ticket attachment disk usage remains above configured warning threshold",
			"bytes", bytesAfter, "thresholdBytes", cfg.AttachmentDiskWarnBytes)
	}
	return stats, nil
}

func attachmentDiskUsage(root string) (int64, int64, error) {
	rootInfo, err := os.Lstat(root)
	if err != nil {
		return 0, 0, fmt.Errorf("inspect attachment root: %w", err)
	}
	if !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return 0, 0, errors.New("attachment root must be a real directory")
	}
	var bytes, files int64
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink found in attachment root: %s", path)
		}
		if entry.Type().IsRegular() {
			info, err := entry.Info()
			if err != nil {
				return err
			}
			bytes += info.Size()
			files++
		}
		return nil
	})
	return bytes, files, err
}

func removeRetentionAttachment(root string, item RetentionAttachment) (bool, error) {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return false, errors.New("resolve attachment root")
	}
	fileAbs, err := filepath.Abs(item.LocalPath)
	if err != nil || !filepath.IsAbs(item.LocalPath) {
		return false, errors.New("retention path must be absolute")
	}
	relative, err := filepath.Rel(rootAbs, fileAbs)
	if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return false, errors.New("retention path escapes attachment root")
	}
	parts := strings.Split(relative, string(filepath.Separator))
	if len(parts) != 2 || parts[0] != strconv.FormatInt(item.TicketID, 10) ||
		!strings.HasPrefix(parts[1], strconv.FormatInt(item.ID, 10)+".") {
		return false, errors.New("retention path does not match ticket and attachment identity")
	}
	rootInfo, err := os.Lstat(rootAbs)
	if err != nil || !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return false, errors.New("attachment root must be a real directory")
	}
	ticketDir := filepath.Dir(fileAbs)
	dirInfo, err := os.Lstat(ticketDir)
	if err != nil || !dirInfo.IsDir() || dirInfo.Mode()&os.ModeSymlink != 0 {
		return false, errors.New("ticket attachment directory must be a real directory")
	}
	rootResolved, err := filepath.EvalSymlinks(rootAbs)
	if err != nil {
		return false, errors.New("resolve attachment root symlinks")
	}
	dirResolved, err := filepath.EvalSymlinks(ticketDir)
	if err != nil {
		return false, errors.New("resolve ticket directory symlinks")
	}
	resolvedRelative, err := filepath.Rel(rootResolved, dirResolved)
	if err != nil || resolvedRelative == ".." || strings.HasPrefix(resolvedRelative, ".."+string(filepath.Separator)) {
		return false, errors.New("resolved ticket directory escapes attachment root")
	}
	fileInfo, err := os.Lstat(fileAbs)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, errors.New("inspect retained attachment")
	}
	if !fileInfo.Mode().IsRegular() || fileInfo.Mode()&os.ModeSymlink != 0 {
		return false, errors.New("retained attachment must be a regular non-symlink file")
	}
	if err := os.Remove(fileAbs); err != nil {
		return false, errors.New("remove retained attachment")
	}
	return true, nil
}
