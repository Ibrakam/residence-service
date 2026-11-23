/* Optional sign-in and one existing enquiry form after five visible seconds. */
(() => {
  'use strict';
  if (window.__tencorpOptionalAuthLoaded) return;
  window.__tencorpOptionalAuthLoaded = true;
  const roots = new Set(['avalon','4u','bayterak','botanika-saroyi','c1','dormon-hills','flagman','jomiy','maftun-makon','meros','mirador','ofiyat','pushkin','regnum-plaza','saadiyat','sarbon','sado','soy-boyi','sun','voha','yangibaxt','zamon','sanat','tencrop']);
  const legacy = new Set(['sanat','tencrop']);
  const delay = 5000;
  const memorySeen = new Set();
  let project = '', elapsed = 0, visibleSince = null, timer, retry, observer, queued = false;
  let signin, lastAttempt = 0, identityLoaded = false, authenticated = false;
  const currentRoot = () => location.pathname.split('/').filter(Boolean)[0] || '';
  const optional = () => document.querySelector('meta[name="tencorp-auth-mode"]')?.content === 'optional';
  const ready = () => legacy.has(project) || window.__tencorpOptionalConsumerReady === true;
  const key = () => 'tencorp-enquiry-prompt-v1:' + (project === 'tencrop' ? 'avalon' : project);
  const seen = () => {
    if (memorySeen.has(key())) return true;
    try { return sessionStorage.getItem(key()) === '1'; } catch { return false; }
  };
  const markSeen = () => {
    if (!project) return;
    memorySeen.add(key());
    try { sessionStorage.setItem(key(), '1'); } catch { /* Memory still prevents repeats. */ }
    clearTimeout(timer); clearTimeout(retry);
  };
  const rendered = element => {
    if (!element?.isConnected || element.closest('[inert],[hidden],[aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  };
  const displayed = element => rendered(element) && Number(getComputedStyle(element).opacity) > 0;
  const dialogs = () => Array.from(document.querySelectorAll('[aria-modal="true"],[role="dialog"],dialog[open]')).filter(displayed);
  const leadOpen = () => dialogs().some(element => element.classList.contains('lead-modal') || element.querySelector('input[type="tel"],input[name="phone"]'));
  const busy = () => {
    if (dialogs().length) return true;
    const body = getComputedStyle(document.body);
    if ((body.overflowY === 'hidden' || body.position === 'fixed') && /(?:intro|loading|loader|menu)/i.test(document.body.className)) return true;
    return Array.from(document.querySelectorAll('[class*="-loader"],[class*="-intro"]')).some(element => displayed(element) && getComputedStyle(element).position === 'fixed');
  };
  function trigger() {
    const candidates = Array.from(document.querySelectorAll('button[data-tencorp-auto-lead]'));
    if (project === 'sanat') {
      candidates.push(...document.querySelectorAll('button.header-request'));
      candidates.push(...Array.from(document.querySelectorAll('button')).filter(button => /^(?:подобрать квартиру|оставить заявку|получить консультацию)$/iu.test(button.textContent.trim().replace(/\s+/g,' '))));
    } else if (project === 'tencrop') {
      candidates.push(...Array.from(document.querySelectorAll('button')).filter(button => /консультац|consultation|maslahat/iu.test(button.textContent)));
    }
    // Scroll-reveal CTAs can have opacity:0 below the fold. Their reviewed
    // handler is still usable without scrolling or changing the page design.
    return candidates.find(button => !button.disabled && rendered(button));
  }
  function check() {
    if (!project || seen()) return;
    if (leadOpen()) { markSeen(); return; }
    if (document.visibilityState !== 'visible') return;
    if (!ready() || busy()) { retry = setTimeout(check, 250); return; }
    const spent = elapsed + (visibleSince !== null ? performance.now() - visibleSince : 0);
    if (spent < delay) { schedule(); return; }
    const target = trigger();
    if (target && performance.now() - lastAttempt >= 1000) {
      lastAttempt = performance.now();
      // Invoke the page's existing handler, preserving project, apartment,
      // validation, consent, analytics and the original amoCRM lead contract.
      target.click();
    }
    retry = setTimeout(check, 300);
  }
  function schedule() {
    clearTimeout(timer); clearTimeout(retry);
    if (!project || seen() || document.visibilityState !== 'visible') return;
    const spent = elapsed + (visibleSince !== null ? performance.now() - visibleSince : 0);
    timer = setTimeout(check, Math.max(0, delay - spent));
  }
  function mountSignin() {
    if (!project || !ready()) return;
    if (!signin?.isConnected) {
      if (!document.querySelector('style[data-tencorp-optional-signin]')) {
        const style = document.createElement('style');
        style.dataset.tencorpOptionalSignin = '';
        style.textContent = '.tencorp-optional-signin{position:fixed;left:16px;bottom:16px;z-index:70;display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border:1px solid #b8b6ac;border-radius:999px;background:#fff;color:#142024;font-family:inherit;font-weight:500;font-size:12px;line-height:1.25;text-decoration:none;box-shadow:0 3px 14px #00000012}.tencorp-optional-signin:focus-visible{outline:2px solid currentColor;outline-offset:4px}';
        document.head.append(style);
      }
      signin = document.createElement('a'); signin.className = 'tencorp-optional-signin';
      signin.textContent = 'Войти'; signin.setAttribute('aria-label','Войти через Telegram — необязательно');
      document.body.append(signin);
    }
    const returnTo = location.pathname + location.search;
    signin.href = authenticated ? '/__auth/account' : '/__auth/login?' + new URLSearchParams({return_to:returnTo});
    const label = authenticated ? 'Аккаунт' : 'Войти';
    if (signin.textContent !== label) signin.textContent = label;
    if (!identityLoaded) {
      identityLoaded = true;
      const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 6000);
      fetch('/__auth/me',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal})
        .then(response => { if (response.ok) { authenticated=true;if(signin?.isConnected){signin.href='/__auth/account';signin.textContent='Аккаунт';signin.setAttribute('aria-label','Открыть аккаунт Telegram');} } })
        .catch(() => { /* Browsing stays available during a login-service outage. */ })
        .finally(() => clearTimeout(deadline));
    }
  }
  function sync() {
    queued = false;
    const root = currentRoot();
    const next = optional() && roots.has(root) ? root : '';
    if (next !== project) {
      project = next; elapsed = 0; visibleSince = document.visibilityState === 'visible' ? performance.now() : null;
      lastAttempt = 0; clearTimeout(timer);clearTimeout(retry);
      if (!project) { signin?.remove();return; }
      schedule();
    }
    if (!project) return;
    mountSignin();
    if (leadOpen()) markSeen();
  }
  const queueSync = () => { if (!queued) { queued = true;requestAnimationFrame(sync); } };
  function init() {
    sync();
    observer = new MutationObserver(queueSync);
    observer.observe(document.body,{childList:true,subtree:true});
    window.addEventListener('tencorp:consumer-ready',queueSync);
    window.addEventListener('popstate',queueSync);
    window.addEventListener('pageshow',queueSync);
    document.addEventListener('visibilitychange',() => {
      if (document.visibilityState === 'hidden') {
        if (visibleSince !== null) elapsed += performance.now() - visibleSince;
        visibleSince = null;clearTimeout(timer);clearTimeout(retry);
      } else { visibleSince = performance.now();schedule();queueSync(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
