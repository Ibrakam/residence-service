package webauth

import (
	"context"
	"errors"
	"sync"
	"time"
)

// maxSessionCacheEntries bounds memory even if many legitimate sessions touch
// the gateway once and never return. Unknown and rejected tokens are never
// inserted, so unauthenticated traffic cannot fill this cache.
const maxSessionCacheEntries = 16_384

type sessionCacheEntry struct {
	user       User
	validUntil time.Time
}

type sessionCacheLoad struct {
	done       chan struct{}
	generation uint64
	user       User
	err        error
}

// sessionValidationCache stores only successful session validation decisions.
// Keys are irreversible SHA-256 token hashes; raw browser tokens are never
// retained. A generation separates requests that began before and after a
// local logout, preventing an older in-flight database lookup from repopulating
// the cache after invalidation.
type sessionValidationCache struct {
	mu         sync.Mutex
	entries    map[[32]byte]sessionCacheEntry
	inFlight   map[[32]byte]*sessionCacheLoad
	generation uint64
	maxEntries int
}

func newSessionValidationCache(maxEntries int) *sessionValidationCache {
	return &sessionValidationCache{
		entries:    make(map[[32]byte]sessionCacheEntry),
		inFlight:   make(map[[32]byte]*sessionCacheLoad),
		maxEntries: maxEntries,
	}
}

func (cache *sessionValidationCache) load(
	ctx context.Context,
	hash [32]byte,
	now time.Time,
	ttl time.Duration,
	loader func(context.Context, time.Time) (User, error),
) (User, error) {
	for {
		cache.mu.Lock()
		if entry, ok := cache.entries[hash]; ok {
			if entry.validUntil.After(now) && entry.user.ExpiresAt.After(now) {
				cache.mu.Unlock()
				return entry.user, nil
			}
			delete(cache.entries, hash)
		}

		generation := cache.generation
		if pending := cache.inFlight[hash]; pending != nil && pending.generation == generation {
			done := pending.done
			cache.mu.Unlock()
			select {
			case <-done:
				// A request cancelled while it owned the shared lookup must not
				// force unrelated live requests to fail. One of them retries and
				// becomes the next owner; genuine store failures are returned.
				if ctx.Err() == nil && (errors.Is(pending.err, context.Canceled) || errors.Is(pending.err, context.DeadlineExceeded)) {
					continue
				}
				// The shared lookup may have begun before this waiter's request. Do
				// not authorize it with a session that was already expired at the
				// waiter's own validation time.
				if pending.err == nil && !pending.user.ExpiresAt.After(now) {
					continue
				}
				return pending.user, pending.err
			case <-ctx.Done():
				return User{}, ctx.Err()
			}
		}

		pending := &sessionCacheLoad{done: make(chan struct{}), generation: generation}
		cache.inFlight[hash] = pending
		cache.mu.Unlock()

		user, err := loader(ctx, now)

		cache.mu.Lock()
		pending.user, pending.err = user, err
		if cache.inFlight[hash] == pending {
			delete(cache.inFlight, hash)
		}
		// Do not cache missing, revoked, blocked, expired, or failed lookups.
		// A local logout increments generation before deleting from the store,
		// so a lookup that raced with it cannot reinsert a stale decision.
		if err == nil && user.ExpiresAt.After(now) && pending.generation == cache.generation {
			validUntil := now.Add(ttl)
			if user.ExpiresAt.Before(validUntil) {
				validUntil = user.ExpiresAt
			}
			cache.insert(hash, sessionCacheEntry{user: user, validUntil: validUntil}, now)
		}
		close(pending.done)
		cache.mu.Unlock()
		return user, err
	}
}

// insert is called with cache.mu held.
func (cache *sessionValidationCache) insert(hash [32]byte, entry sessionCacheEntry, now time.Time) {
	if _, exists := cache.entries[hash]; !exists && len(cache.entries) >= cache.maxEntries {
		for key, cached := range cache.entries {
			if !cached.validUntil.After(now) || !cached.user.ExpiresAt.After(now) {
				delete(cache.entries, key)
			}
		}
		if len(cache.entries) >= cache.maxEntries {
			return
		}
	}
	cache.entries[hash] = entry
}

func (cache *sessionValidationCache) invalidate(hash [32]byte) {
	cache.mu.Lock()
	cache.generation++
	delete(cache.entries, hash)
	cache.mu.Unlock()
}

func (cache *sessionValidationCache) invalidateUser(userID int64) {
	cache.mu.Lock()
	// The generation is process-wide because an in-flight lookup does not reveal
	// its user ID until after it returns. This rare logout-all path safely avoids
	// stale reinsertion at the cost of dropping only concurrent cache fills.
	cache.generation++
	for hash, entry := range cache.entries {
		if entry.user.ID == userID {
			delete(cache.entries, hash)
		}
	}
	cache.mu.Unlock()
}
