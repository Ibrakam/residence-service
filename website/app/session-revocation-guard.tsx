'use client';

import { useEffect, useRef } from 'react';

const sessionCheckIntervalMs = 15_000;
const sessionCheckJitter = 0.2;
const maximumBackoffMultiplier = 4;

function nextSessionCheckDelay(failures: number) {
  const backoff = Math.min(maximumBackoffMultiplier, 2 ** failures);
  const jitter = 1 - sessionCheckJitter + Math.random() * sessionCheckJitter * 2;
  return Math.round(sessionCheckIntervalMs * backoff * jitter);
}

function loginURL() {
  const returnTo = `${window.location.pathname}${window.location.search}`;
  const query = new URLSearchParams({ error: 'session_expired', return_to: returnTo });
  return `/__auth/login?${query.toString()}`;
}

export default function SessionRevocationGuard() {
  const activeRequest = useRef<AbortController | null>(null);
  const redirecting = useRef(false);

  useEffect(() => {
    let timer: number | null = null;
    let consecutiveFailures = 0;

    const verifySession = async () => {
      if (redirecting.current || document.visibilityState === 'hidden') return;
      activeRequest.current?.abort();
      const controller = new AbortController();
      activeRequest.current = controller;
      try {
        const response = await fetch('/__auth/me', {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (response.status !== 401 || redirecting.current) {
          consecutiveFailures = response.ok ? 0 : Math.min(consecutiveFailures + 1, 2);
          return;
        }
        redirecting.current = true;
        window.location.replace(loginURL());
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // A temporary network/auth-service failure must not sign the user out.
        consecutiveFailures = Math.min(consecutiveFailures + 1, 2);
      } finally {
        if (activeRequest.current === controller) activeRequest.current = null;
      }
    };

    const refreshVisibleSession = () => {
      if (document.visibilityState === 'visible') void verifySession();
    };
    const onPageShow = () => { void verifySession(); };
    const scheduleNextCheck = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await verifySession();
        if (!redirecting.current) scheduleNextCheck();
      }, nextSessionCheckDelay(consecutiveFailures));
    };

    void verifySession();
    scheduleNextCheck();
    window.addEventListener('focus', refreshVisibleSession);
    window.addEventListener('online', refreshVisibleSession);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', refreshVisibleSession);
    return () => {
      activeRequest.current?.abort();
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('focus', refreshVisibleSession);
      window.removeEventListener('online', refreshVisibleSession);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', refreshVisibleSession);
    };
  }, []);

  return null;
}
