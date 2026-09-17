'use client';

import { useEffect, useRef } from 'react';

const sessionCheckIntervalMs = 15_000;

function loginURL() {
  const returnTo = `${window.location.pathname}${window.location.search}`;
  const query = new URLSearchParams({ error: 'session_expired', return_to: returnTo });
  return `/__auth/login?${query.toString()}`;
}

export default function SessionRevocationGuard() {
  const activeRequest = useRef<AbortController | null>(null);
  const redirecting = useRef(false);

  useEffect(() => {
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
        if (response.status !== 401 || redirecting.current) return;
        redirecting.current = true;
        window.location.replace(loginURL());
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // A temporary network/auth-service failure must not sign the user out.
      } finally {
        if (activeRequest.current === controller) activeRequest.current = null;
      }
    };

    const refreshVisibleSession = () => {
      if (document.visibilityState === 'visible') void verifySession();
    };
    const onPageShow = () => { void verifySession(); };

    void verifySession();
    const interval = window.setInterval(refreshVisibleSession, sessionCheckIntervalMs);
    window.addEventListener('focus', refreshVisibleSession);
    window.addEventListener('online', refreshVisibleSession);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', refreshVisibleSession);
    return () => {
      activeRequest.current?.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshVisibleSession);
      window.removeEventListener('online', refreshVisibleSession);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', refreshVisibleSession);
    };
  }, []);

  return null;
}
