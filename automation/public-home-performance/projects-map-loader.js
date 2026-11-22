/* Public gate only: project data stays in the separately authenticated module. */
(() => {
  'use strict';
  if (window.__tencorpLazyMapLoader) return;
  window.__tencorpLazyMapLoader = true;
  // The login gateway deliberately rejects fragments in return_to. Convert its
  // safe same-origin query destination back to the visible map anchor.
  const returned = new URL(location.href);
  if (returned.searchParams.get('section') === 'map') {
    returned.searchParams.delete('section'); returned.hash = 'map';
    history.replaceState(history.state,'',returned.pathname + returned.search + returned.hash);
  }
  const SDK_URL = 'https://api-maps.yandex.ru/2.1/?apikey=be00464c-a56b-4da3-9048-141f5f90c4da&lang=ru_RU';
  const PRIVATE_MODULE = '/tencorp/assets/projects-map.js?v=20261122-lazy-map-1';
  const RESOURCE_TIMEOUT = 12000;
  let access = 'checking', phase = 'idle', expiresAt = 0;
  let checking, sdkPromise, privateRequested = false, explicitIntent = location.hash === '#map';
  let placeholder, placeholderKind, intersection, mutationQueued = false, scrollQueued = false;
  let expiryTimer, authTimer, renderTimer;
  const actualMap = () => document.querySelector('.projects-map:not(.projects-map--locked)');
  const wanted = () => location.hash === '#map' || explicitIntent;
  function queueSync() {
    if (mutationQueued) return;
    mutationQueued = true;
    requestAnimationFrame(() => { mutationQueued = false; sync(); });
  }
  function bindPortfolioLink() {
    const card = Array.from(document.querySelectorAll('a.service-card')).find(a => a.querySelector('h3')?.textContent?.trim().toLowerCase() === 'новостройки');
    if (card && card.getAttribute('href') !== '#map') card.href = '#map';
  }
  function markup(kind) {
    const guest = kind === 'guest', error = kind === 'error';
    const title = guest ? 'Откройте карту<br>после авторизации.' : error ? 'Карта временно<br>недоступна.' : 'Карта жилых<br>комплексов.';
    const copy = guest ? 'Войдите через Telegram, чтобы увидеть расположение всех жилых комплексов и перейти к актуальным предложениям.' : error ? 'Не удалось загрузить карту или проверить вход. Попробуйте ещё раз — остальные разделы сайта доступны.' : phase === 'loading' ? 'Загружаем интерактивную карту жилых комплексов.' : 'Посмотрите расположение жилых комплексов и выберите подходящий проект.';
    return `<div class="projects-map__meta"><span>Portfolio map</span><span>Карта жилых комплексов</span><span>Tashkent · private access</span></div>
      <div class="projects-map__head"><h2>Проекты,<br><em>которые мы знаем.</em></h2><div><p>Интерактивная карта и подборка жилых комплексов доступны после безопасного входа.</p></div></div>
      <div class="projects-map-auth"><div class="projects-map-auth__visual" aria-hidden="true"><i></i><i></i><i></i><span><b></b></span></div><div class="projects-map-auth__content">
        <small>TENCORP · PRIVATE MAP</small><h3 id="locked-map-title">${title}</h3><p>${copy}</p>
        <a href="${guest ? '/__auth/login?return_to=%2F%3Fsection%3Dmap' : '#map'}"${guest ? '' : ' data-map-load'}><span>${guest ? 'Авторизоваться' : error ? 'Повторить загрузку' : 'Открыть карту'}</span><b aria-hidden="true">↗</b></a>
        <em>${guest ? 'Безопасный вход через Telegram' : error ? 'Ваши данные и настройки входа не изменены' : 'TENCORP · карта проектов'}</em>
      </div></div>`;
  }
  function scrollMap() {
    if (!wanted()) return;
    const target = actualMap() || placeholder;
    if (!target) return;
    // The existing introduction can briefly lock body scroll. Retry once it ends.
    const deadline = performance.now() + 6000;
    const go = () => {
      const style = getComputedStyle(document.body);
      const locked = style.position === 'fixed' || ((document.body.classList.contains('intro-lock') || document.body.classList.contains('menu-lock')) && style.overflowY === 'hidden');
      if (locked && performance.now() < deadline) { setTimeout(go,100); return; }
      (actualMap() || placeholder)?.scrollIntoView({block:'start'});
    };
    go();
  }
  function onReady() {
    const map = actualMap();
    if (!map) return false;
    if (access !== 'authorized' || expiresAt <= Date.now()) { map.remove(); return false; }
    clearTimeout(renderTimer);
    phase = 'ready';
    intersection?.disconnect();
    placeholder?.remove(); placeholder = undefined; placeholderKind = undefined;
    if (explicitIntent) { map.tabIndex = -1; map.focus({preventScroll:true}); scrollMap(); explicitIntent = false; }
    return true;
  }
  function sync() {
    bindPortfolioLink();
    if (onReady()) return;
    const anchor = document.querySelector('#project');
    if (!anchor || access === 'checking') return;
    const kind = access === 'guest' ? 'guest' : access === 'error' || phase === 'error' ? 'error' : 'pending';
    if (!placeholder?.isConnected || placeholderKind !== kind) {
      placeholder?.remove(); intersection?.disconnect();
      placeholder = document.createElement('section');
      placeholder.id = 'map'; placeholder.dataset.tencorpMapPlaceholder = '';
      // It deliberately lacks .projects-map: the protected module owns that class
      // and must be able to insert its single real map before this shell is removed.
      placeholder.className = kind === 'pending' ? 'projects-map-pending section-pad is-visible' : 'projects-map projects-map--locked section-pad is-visible';
      if (kind === 'pending') placeholder.style.cssText = `--map-ink:#07111d;--map-gold:#c99c5e;--map-gold-light:#e3bd83;background:#07111d;color:#fff;padding-top:${innerWidth <= 700 ? 72 : 110}px;padding-bottom:${innerWidth <= 700 ? 80 : 125}px;scroll-margin-top:72px;position:relative;overflow:hidden`;
      placeholder.setAttribute('aria-labelledby','locked-map-title');
      placeholder.setAttribute('aria-busy',String(phase === 'loading'));
      placeholder.innerHTML = markup(kind); placeholderKind = kind;
      anchor.insertAdjacentElement('afterend',placeholder);
      placeholder.querySelector('[data-map-load]')?.addEventListener('click',event => {
        event.preventDefault(); event.stopPropagation(); explicitIntent = true;
        if (location.hash !== '#map') history.pushState(null,'','#map');
        if (kind === 'error') { location.reload(); return; }
        start(true); scrollMap();
      });
      if (kind === 'pending' && phase !== 'loading') observe();
      if (wanted()) { start(false); scrollMap(); }
    }
  }
  function near() {
    if (!placeholder?.isConnected) return false;
    const box = placeholder.getBoundingClientRect();
    return box.top < innerHeight + 300 && box.bottom > -300;
  }
  function observe() {
    if (!placeholder || access !== 'authorized') return;
    if (typeof IntersectionObserver === 'function') {
      intersection = new IntersectionObserver(entries => {if(entries.some(entry=>entry.isIntersecting))start(false);},{rootMargin:'300px 0px'});
      intersection.observe(placeholder);
    } else if (near()) start(false);
  }
  function timeout(promise,ms) {
    return new Promise((resolve,reject) => { const timer=setTimeout(()=>reject(new Error('Map resource timeout')),ms);promise.then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);}); });
  }
  function sdk() {
    if (sdkPromise) return sdkPromise;
    sdkPromise = timeout(new Promise((resolve,reject) => {
      const ready = () => {try {if (!window.ymaps || typeof window.ymaps.ready !== 'function') throw new Error('Map SDK unavailable');window.ymaps.ready(resolve,reject);} catch(e){reject(e);}};
      if (window.ymaps && typeof window.ymaps.ready === 'function') {ready();return;}
      let script=document.getElementById('tencorp-yandex-maps-sdk');
      if (!script) {script=document.createElement('script');script.id='tencorp-yandex-maps-sdk';script.async=true;script.src=SDK_URL;script.addEventListener('load',ready,{once:true});script.addEventListener('error',()=>reject(new Error('Map SDK failed')),{once:true});document.head.append(script);}
      else {script.addEventListener('load',ready,{once:true});script.addEventListener('error',()=>reject(new Error('Map SDK failed')),{once:true});}
    }),RESOURCE_TIMEOUT);
    return sdkPromise;
  }
  function privateModule() {
    if (privateRequested) return Promise.resolve();
    privateRequested=true;
    return timeout(new Promise((resolve,reject) => {
      const script=document.createElement('script');script.type='module';script.src=PRIVATE_MODULE;script.crossOrigin='anonymous';
      script.addEventListener('load',resolve,{once:true});script.addEventListener('error',()=>reject(new Error('Private map unavailable')),{once:true});document.head.append(script);
    }),RESOURCE_TIMEOUT);
  }
  async function check() {
    if (checking) return checking;
    checking=(async()=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
      try {
        const response=await fetch('/__auth/me',{credentials:'include',headers:{Accept:'application/json'},cache:'no-store',signal:controller.signal});
        if(response.status===401){access='guest';expiresAt=0;return false;}
        if(!response.ok)throw new Error('Session unavailable');
        const profile=await response.json(),deadline=Date.parse(profile.sessionExpiresAt);
        if(profile.phoneNumberVerified!==true||!Number.isFinite(deadline)||deadline<=Date.now())throw new Error('Invalid session');
        access='authorized';expiresAt=deadline;
        if(privateRequested && phase==='ready' && !actualMap()) phase='error';
        clearTimeout(expiryTimer);
        expiryTimer=setTimeout(()=>{if(expiresAt<=Date.now()){access='guest';actualMap()?.remove();sync();}else check();},Math.min(deadline-Date.now()+20,2147000000));
        return true;
      } catch {access='error';expiresAt=0;return false;}
      finally {clearTimeout(timer);checking=undefined;if(access!=='authorized'){clearTimeout(expiryTimer);actualMap()?.remove();}sync();}
    })();
    return checking;
  }
  async function start(retry) {
    if(phase==='loading'||phase==='ready'||(phase==='error'&&!retry))return;
    phase='loading';intersection?.disconnect();
    if(placeholder){placeholder.setAttribute('aria-busy','true');const copy=placeholder.querySelector('.projects-map-auth__content p');if(copy)copy.textContent='Загружаем интерактивную карту жилых комплексов.';}
    try {
      if(!await check()){phase='idle';sync();return;}
      // A fresh check, not just the initial page's lease, gates both resources.
      await sdk();
      if(access!=='authorized'||expiresAt<=Date.now())throw new Error('Session expired');
      await privateModule();
      if(!onReady())renderTimer=setTimeout(()=>{if(!onReady()){phase='error';placeholderKind=undefined;sync();}},RESOURCE_TIMEOUT);
      clearInterval(authTimer);authTimer=setInterval(()=>{if(!document.hidden)check();},30000);
    } catch {phase='error';placeholderKind=undefined;sync();}
  }
  document.addEventListener('click',event=>{
    if(event.defaultPrevented)return;
    const link=event.target.closest?.('a[href="#map"]');
    if(link){explicitIntent=true;if(access==='authorized')start(true);setTimeout(scrollMap,0);}
  });
  window.addEventListener('hashchange',()=>{if(location.hash==='#map'){explicitIntent=true;if(access==='authorized')start(true);scrollMap();}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&(privateRequested||wanted()||near()))check();});
  const scroll=()=>{if(scrollQueued)return;scrollQueued=true;requestAnimationFrame(()=>{scrollQueued=false;if(placeholderKind==='pending'&&placeholder){placeholder.style.paddingTop=(innerWidth<=700?72:110)+'px';placeholder.style.paddingBottom=(innerWidth<=700?80:125)+'px';}if(access==='authorized'&&near())start(false);});};
  window.addEventListener('scroll',scroll,{passive:true});window.addEventListener('resize',scroll,{passive:true});
  if(typeof MutationObserver==='function')new MutationObserver(queueSync).observe(document.documentElement,{childList:true,subtree:true});
  else {const timer=setInterval(sync,100);setTimeout(()=>clearInterval(timer),10000);}
  check();
})();
