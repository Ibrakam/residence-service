/* Same-origin lead protection. Content remains available without a challenge. */
(() => {
  'use strict';
  if (window.__tencorpLeadGuard) return;
  window.__tencorpLeadGuard = true;

  const nativeFetch = window.fetch.bind(window);
  const endpoints = new Set(['/v1/agency-leads', '/v1/leads', '/tencrop/v1/leads', '/api/submit']);
  const texts = {
    ru: { title: 'Проверка перед отправкой', wait: 'Пожалуйста, пройдите короткую проверку.', cancel: 'Отмена', error: 'Не удалось выполнить проверку. Попробуйте отправить заявку ещё раз.', busy: 'Заявка уже отправляется. Подождите немного.' },
    uz: { title: 'Yuborishdan oldin tekshirish', wait: 'Iltimos, qisqa tekshiruvdan o‘ting.', cancel: 'Bekor qilish', error: 'Tekshiruvni bajarib bo‘lmadi. Arizani qayta yuborib ko‘ring.', busy: 'Ariza yuborilmoqda. Biroz kuting.' },
    en: { title: 'Verification before sending', wait: 'Please complete this quick check.', cancel: 'Cancel', error: 'Verification could not be completed. Please try sending your enquiry again.', busy: 'Your enquiry is being sent. Please wait.' },
  };
  let warmed = null;
  let issuance = Promise.resolve();
  let submitting = false;
  let turnstileLoader = null;

  function copy() {
    const language = new URLSearchParams(location.search).get('lang') || document.documentElement.lang;
    return texts[language] || texts.ru;
  }

  function failure(status, error, message) {
    return new Response(JSON.stringify({ success: false, error, message }), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  function aborted(signal) {
    if (signal && signal.aborted) throw new Error('aborted');
  }

  function delay(milliseconds, signal) {
    return new Promise((resolve, reject) => {
      aborted(signal);
      const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
      const cancel = () => { clearTimeout(timer); cleanup(); reject(new Error('aborted')); };
      const cleanup = () => signal && signal.removeEventListener('abort', cancel);
      if (signal) signal.addEventListener('abort', cancel, { once: true });
    });
  }

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (turnstileLoader) return turnstileLoader;
    turnstileLoader = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => { script.remove(); reject(new Error('verification_unavailable')); }, 15000);
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = () => {
        clearTimeout(timer);
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error('verification_unavailable'));
      };
      script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('verification_unavailable')); };
      document.head.append(script);
    }).catch(error => { turnstileLoader = null; throw error; });
    return turnstileLoader;
  }

  // Issue only one challenge at a time: concurrent responses must not replace
  // the browser cookie underneath a challenge already being submitted.
  function prepare() {
    const page = location.pathname + location.search;
    if (warmed && warmed.page === page && Date.now() - warmed.started < 10 * 60 * 1000) return warmed.promise;
    const entry = { page, started: Date.now(), promise: null };
    entry.promise = issuance.then(async () => {
      const response = await nativeFetch('/lead-security/challenge?page=' + encodeURIComponent(page), {
        credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('verification_unavailable');
      const challenge = await response.json();
      if (typeof challenge.token !== 'string' || !challenge.token) throw new Error('verification_unavailable');
      if (challenge.sitekey) loadTurnstile().catch(() => {});
      return { ...challenge, received: Date.now() };
    });
    issuance = entry.promise.catch(() => {});
    warmed = entry;
    entry.promise.catch(() => { if (warmed === entry) warmed = null; });
    return entry.promise;
  }

  async function verify(sitekey, signal) {
    if (!sitekey) return '';
    aborted(signal);
    const api = await loadTurnstile();
    aborted(signal);
    return new Promise((resolve, reject) => {
      const previousFocus = document.activeElement;
      const t = copy();
      const dialog = document.createElement('dialog');
      dialog.setAttribute('aria-labelledby', 'tc-security-title');
      dialog.style.cssText = 'box-sizing:border-box;max-width:min(440px,calc(100vw - 32px));width:440px;padding:28px;border:1px solid #c9b78e;border-radius:12px;background:#faf8f1;color:#17251e;font:16px/1.5 system-ui,sans-serif;box-shadow:0 24px 100px #0005;';
      const title = document.createElement('h2');
      title.id = 'tc-security-title';
      title.textContent = t.title;
      title.style.cssText = 'margin:0 0 10px;font-size:21px;font-weight:500;';
      const description = document.createElement('p');
      description.textContent = t.wait;
      description.style.cssText = 'margin:0 0 18px;';
      description.setAttribute('role', 'status');
      const container = document.createElement('div');
      container.style.minHeight = '65px';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = t.cancel;
      cancel.style.cssText = 'margin-top:18px;min-height:44px;padding:8px 20px;border:1px solid #526255;border-radius:4px;background:transparent;color:inherit;font:inherit;cursor:pointer;';
      dialog.append(title, description, container, cancel);
      // The widget can finish non-interactively without opening the dialog.
      // Keep it attached so that Cloudflare can measure its environment.
      document.body.append(dialog);
      dialog.showModal();
      let widget;
      let finished = false;
      const timeout = setTimeout(() => finish(new Error('verification_timeout')), 90000);
      function show() { if (!finished && !dialog.open) dialog.showModal(); }
      function finish(error, token) {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        if (signal) signal.removeEventListener('abort', onAbort);
        if (widget !== undefined) api.remove(widget);
        if (dialog.open) dialog.close();
        dialog.remove();
        if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus({ preventScroll: true });
        if (error) reject(error); else resolve(token);
      }
      const onAbort = () => finish(new Error('aborted'));
      cancel.addEventListener('click', () => finish(new Error('verification_cancelled')));
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(new Error('verification_cancelled')); });
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      try {
        widget = api.render(container, {
          sitekey, action: 'lead_submit', appearance: 'interaction-only', size: 'flexible',
          language: texts[document.documentElement.lang] ? document.documentElement.lang : 'auto',
          callback: token => finish(null, token),
          'before-interactive-callback': show,
          'error-callback': () => { finish(new Error('verification_failed')); return true; },
          'expired-callback': () => finish(new Error('verification_expired')),
          'timeout-callback': () => finish(new Error('verification_timeout')),
        });
      } catch (error) { finish(error); }
    });
  }

  function installHoneypots() {
    document.querySelectorAll('form').forEach(form => {
      if (form.querySelector('[data-tc-honeypot]')) return;
      const field = document.createElement('input');
      field.type = 'text';
      field.name = 'website';
      field.autocomplete = 'off';
      field.tabIndex = -1;
      field.setAttribute('aria-hidden', 'true');
      field.setAttribute('data-tc-honeypot', '');
      field.style.cssText = 'position:absolute!important;left:-10000px!important;top:auto!important;width:1px!important;height:1px!important;overflow:hidden!important;pointer-events:none!important;';
      form.append(field);
    });
  }

  window.fetch = async function guardedFetch(input, init) {
    let url;
    try { url = new URL(input instanceof Request ? input.url : String(input), location.href); }
    catch { return nativeFetch(input, init); }
    const method = (init && init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.origin !== location.origin || !endpoints.has(url.pathname) || method !== 'POST') return nativeFetch(input, init);
    const headers = new Headers(init && init.headers !== undefined
      ? init.headers : input instanceof Request ? input.headers : undefined);
    if ((headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') return nativeFetch(input, init);
    if (submitting) return failure(409, 'lead_in_progress', copy().busy);
    submitting = true;
    const signal = init && init.signal || (input instanceof Request ? input.signal : undefined);
    try {
      aborted(signal);
      const challenge = await prepare();
      warmed = null;
      const turnstile = await verify(challenge.sitekey, signal);
      await delay(Math.max(0, 1100 - (Date.now() - challenge.received)), signal);
      const honeypot = Array.from(document.querySelectorAll('[data-tc-honeypot]')).find(field => field.value);
      headers.set('X-Lead-Token', challenge.token);
      headers.set('X-Lead-Honeypot', honeypot ? honeypot.value.slice(0, 256) : '');
      if (turnstile) headers.set('X-Turnstile-Token', turnstile);
      return await nativeFetch(input, { ...init, headers });
    } catch (error) {
      warmed = null;
      return failure(503, 'lead_verification_failed', copy().error);
    } finally { submitting = false; }
  };

  function warmForForm(event) {
    if (submitting || !(event.target instanceof Element) || !event.target.closest('form')) return;
    prepare().catch(() => {});
  }
  document.addEventListener('focusin', warmForForm, { passive: true });
  document.addEventListener('pointerdown', warmForForm, { passive: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installHoneypots, { once: true });
  else installHoneypots();
  new MutationObserver(installHoneypots).observe(document.documentElement, { childList: true, subtree: true });
})();
