package webauth

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSessionValidationCacheCachesOnlySuccessfulUnexpiredLookups(t *testing.T) {
	cache := newSessionValidationCache(8)
	hash := tokenHash("valid-session")
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	want := User{ID: 42, TelegramID: 99, Name: "Cached User", ExpiresAt: now.Add(time.Hour)}
	var calls int
	loader := func(context.Context, time.Time) (User, error) {
		calls++
		return want, nil
	}

	for range 2 {
		got, err := cache.load(t.Context(), hash, now, 10*time.Second, loader)
		if err != nil || got.ID != want.ID {
			t.Fatalf("cached lookup = %#v, %v", got, err)
		}
	}
	if calls != 1 {
		t.Fatalf("store calls = %d, want 1", calls)
	}

	now = now.Add(10 * time.Second)
	if _, err := cache.load(t.Context(), hash, now, 10*time.Second, loader); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("store calls after cache expiry = %d, want 2", calls)
	}

	shortHash := tokenHash("short-session")
	shortUser := User{ID: 7, ExpiresAt: now.Add(time.Second)}
	shortCalls := 0
	shortLoader := func(context.Context, time.Time) (User, error) {
		shortCalls++
		return shortUser, nil
	}
	if _, err := cache.load(t.Context(), shortHash, now, 10*time.Second, shortLoader); err != nil {
		t.Fatal(err)
	}
	if _, err := cache.load(t.Context(), shortHash, now.Add(time.Second), 10*time.Second, shortLoader); err != nil {
		t.Fatal(err)
	}
	if shortCalls != 2 {
		t.Fatalf("store calls after session expiry = %d, want 2", shortCalls)
	}
}

func TestSessionValidationCacheNeverCachesMissingOrFailedLookups(t *testing.T) {
	cache := newSessionValidationCache(8)
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		name string
		err  error
	}{
		{name: "missing", err: ErrSessionNotFound},
		{name: "store failure", err: errors.New("database unavailable")},
	} {
		t.Run(test.name, func(t *testing.T) {
			hash := tokenHash(test.name)
			calls := 0
			loader := func(context.Context, time.Time) (User, error) {
				calls++
				return User{}, test.err
			}
			for range 2 {
				if _, err := cache.load(t.Context(), hash, now, 10*time.Second, loader); !errors.Is(err, test.err) {
					t.Fatalf("lookup error = %v, want %v", err, test.err)
				}
			}
			if calls != 2 {
				t.Fatalf("store calls = %d, want 2", calls)
			}
		})
	}
}

func TestSessionValidationCacheCoalescesConcurrentStoreLookups(t *testing.T) {
	cache := newSessionValidationCache(8)
	hash := tokenHash("concurrent-session")
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	want := User{ID: 42, ExpiresAt: now.Add(time.Hour)}
	started := make(chan struct{})
	release := make(chan struct{})
	var startedOnce sync.Once
	var calls atomic.Int32
	loader := func(context.Context, time.Time) (User, error) {
		calls.Add(1)
		startedOnce.Do(func() { close(started) })
		<-release
		return want, nil
	}

	const workers = 32
	results := make(chan error, workers)
	for range workers {
		go func() {
			user, err := cache.load(t.Context(), hash, now, 10*time.Second, loader)
			if err == nil && user.ID != want.ID {
				err = errors.New("unexpected cached user")
			}
			results <- err
		}()
	}
	<-started
	close(release)
	for range workers {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("concurrent store calls = %d, want 1", got)
	}
}

func TestSessionValidationCacheWaiterRejectsAlreadyExpiredSharedResult(t *testing.T) {
	cache := newSessionValidationCache(8)
	hash := tokenHash("expires-during-shared-lookup")
	startedAt := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	expiresAt := startedAt.Add(time.Second)
	started := make(chan struct{})
	release := make(chan struct{})
	firstDone := make(chan error, 1)
	go func() {
		_, err := cache.load(t.Context(), hash, startedAt, 10*time.Second, func(context.Context, time.Time) (User, error) {
			close(started)
			<-release
			return User{ID: 42, ExpiresAt: expiresAt}, nil
		})
		firstDone <- err
	}()
	<-started

	waiterDone := make(chan error, 1)
	go func() {
		_, err := cache.load(t.Context(), hash, expiresAt, 10*time.Second, func(context.Context, time.Time) (User, error) {
			return User{}, ErrSessionNotFound
		})
		waiterDone <- err
	}()
	close(release)
	if err := <-firstDone; err != nil {
		t.Fatal(err)
	}
	if err := <-waiterDone; !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("expired waiter error = %v, want %v", err, ErrSessionNotFound)
	}
}

func TestSessionValidationCacheInvalidationPreventsStaleReinsertion(t *testing.T) {
	cache := newSessionValidationCache(8)
	hash := tokenHash("logout-race")
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	started := make(chan struct{})
	release := make(chan struct{})
	firstDone := make(chan error, 1)
	go func() {
		_, err := cache.load(t.Context(), hash, now, 10*time.Second, func(context.Context, time.Time) (User, error) {
			close(started)
			<-release
			return User{ID: 42, ExpiresAt: now.Add(time.Hour)}, nil
		})
		firstDone <- err
	}()
	<-started
	cache.invalidate(hash)
	close(release)
	if err := <-firstDone; err != nil {
		t.Fatal(err)
	}

	var calls int
	_, err := cache.load(t.Context(), hash, now, 10*time.Second, func(context.Context, time.Time) (User, error) {
		calls++
		return User{}, ErrSessionNotFound
	})
	if !errors.Is(err, ErrSessionNotFound) || calls != 1 {
		t.Fatalf("post-invalidation lookup = calls %d, error %v", calls, err)
	}
}

func TestSessionValidationCacheIsBounded(t *testing.T) {
	cache := newSessionValidationCache(2)
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	for index, raw := range []string{"one", "two", "three"} {
		_, err := cache.load(t.Context(), tokenHash(raw), now, 10*time.Second, func(context.Context, time.Time) (User, error) {
			return User{ID: int64(index + 1), ExpiresAt: now.Add(time.Hour)}, nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	cache.mu.Lock()
	entries := len(cache.entries)
	cache.mu.Unlock()
	if entries != 2 {
		t.Fatalf("cache entries = %d, want 2", entries)
	}
}
