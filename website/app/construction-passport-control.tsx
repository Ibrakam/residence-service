'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  constructionPassportLabels,
  parseConstructionPassports,
  projectKeyForLandingPath,
  type ConstructionPassport,
} from './construction-passports';

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const configuredAPI = process.env.NEXT_PUBLIC_CATALOG_API_URL?.trim().replace(/\/+$/, '');
const catalogAPI = configuredAPI || `${appBasePath}/residence-api/catalog`;
const refreshIntervalMs = 30_000;
const requestTimeoutMs = 5_000;
export default function ConstructionPassportControl() {
  const pathname = usePathname();
  const projectKey = projectKeyForLandingPath(pathname, configuredBasePath);
  return projectKey ? <ProjectConstructionPassportControl key={projectKey} projectKey={projectKey} /> : null;
}

function ProjectConstructionPassportControl({ projectKey }: { projectKey: string }) {
  const [passports, setPassports] = useState<ConstructionPassport[]>([]);
  const [language, setLanguage] = useState(() => typeof document === 'undefined' ? 'ru' : document.documentElement.lang || 'ru');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const singleLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const observer = new MutationObserver(() => setLanguage(document.documentElement.lang || 'ru'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    let activeRequest: AbortController | null = null;

    const replacePassports = (next: ConstructionPassport[]) => {
      const closesChooser = next.length < 2 && Boolean(dialogRef.current?.open);
      if (closesChooser) dialogRef.current?.close();
      setPassports(next);
      if (closesChooser && next.length === 1) window.requestAnimationFrame(() => singleLinkRef.current?.focus());
    };

    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      activeRequest?.abort();
      const controller = new AbortController();
      activeRequest = controller;
      const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs);
      const clearCurrent = () => {
        if (!disposed && activeRequest === controller) replacePassports([]);
      };
      try {
        const response = await fetch(`${catalogAPI}/v1/construction-passports/${encodeURIComponent(projectKey)}`, {
          cache: 'no-store',
          credentials: 'include',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) {
          clearCurrent();
          return;
        }
        const passports = parseConstructionPassports(await response.json(), projectKey);
        if (!passports) {
          clearCurrent();
          return;
        }
        if (!disposed && activeRequest === controller) replacePassports(passports);
      } catch {
        clearCurrent();
      } finally {
        window.clearTimeout(timeout);
        if (activeRequest === controller) activeRequest = null;
      }
    };

    const onVisibility = () => { if (document.visibilityState === 'visible') void refresh(); };
    void refresh();
    const interval = window.setInterval(refresh, refreshIntervalMs);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', refresh);
    return () => {
      disposed = true;
      activeRequest?.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', refresh);
    };
  }, [projectKey]);

  const labels = useMemo(() => constructionPassportLabels(language), [language]);
  if (passports.length === 0) return null;

  const icon = (
    <svg aria-hidden="true" focusable="false" width="23" height="23" viewBox="0 0 20.056 20" fill="none">
      <path d="M3.426 3.447V.535H.506v2.912h2.92ZM19.518 3.451V.539h-2.92v2.912h2.92ZM11.994 3.952V0H8.031v3.952h3.963ZM3.963 11.991V8.039H0v3.952h3.963ZM20.055 11.995V8.043h-3.963v3.952h3.963ZM12.009 11.976V8.023H8.046v3.953h3.963ZM3.422 19.494v-2.912H.502v2.912h2.92ZM19.515 19.498v-2.912h-2.92v2.912h2.92ZM11.99 19.999v-3.952H8.027v3.952h3.963ZM17.823 9.999l-7.752-7.696-7.718 7.696-.625-.624 8.343-8.32 8.378 8.32-.626.624ZM17.753 18.354l-7.752-7.696-7.718 7.696-.625-.624 8.343-8.355 8.378 8.355-.626.624Z" fill="#007AFF" />
    </svg>
  );
  if (passports.length === 1) {
    return (
      <a ref={singleLinkRef} className="construction-passport-link construction-passport-link--universal" href={passports[0].url} target="_blank" rel="noopener noreferrer" aria-label={labels.open} title={labels.open}>
        {icon}
      </a>
    );
  }

  const closeDialog = () => dialogRef.current?.close();
  return (
    <>
      <button ref={openerRef} className="construction-passport-link construction-passport-link--universal" type="button" aria-label={labels.choose} title={labels.choose} aria-haspopup="dialog" onClick={() => dialogRef.current?.showModal()}>
        {icon}
      </button>
      <dialog ref={dialogRef} className="construction-passport-dialog" aria-labelledby="construction-passport-title" onClose={() => openerRef.current?.focus()} onMouseDown={(event) => { if (event.target === dialogRef.current) closeDialog(); }}>
        <header>
          <h2 id="construction-passport-title">{labels.heading}</h2>
          <button type="button" onClick={closeDialog} aria-label={labels.close}>×</button>
        </header>
        <div className="construction-passport-dialog__list">
          {passports.map((passport, index) => (
            <a key={passport.url} href={passport.url} target="_blank" rel="noopener noreferrer" aria-label={`${passport.name || `${labels.object} №${passport.objectId}`}. ${labels.open}`}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{passport.name || `${labels.object} №${passport.objectId}`}</strong>
              {passport.address ? <small>{passport.address}</small> : null}
              <b aria-hidden="true">↗</b>
            </a>
          ))}
        </div>
      </dialog>
    </>
  );
}
