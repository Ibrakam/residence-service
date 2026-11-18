/* TenCorp first-party activity collection. No form values or third-party calls. */
(function () {
  'use strict';
  if (navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
  if (window.__tencorpWebAnalytics || !window.crypto || !window.fetch) return;
  if (/^\/(?:analytics|api)(?:\/|$)|^\/(?:auth|oauth)\/(?:callback|logout)/.test(location.pathname)) return;
  window.__tencorpWebAnalytics = true;

  var projects = ['avalon-residence','4u','bayterak','botanika-saroyi','c1','dormon-hills','flagman','jomiy','maftun-makon','meros','mirador','ofiyat','pushkin','regnum-plaza','saadiyat','sado','sanat','sarbon','soy-boyi','sun','voha','yangibaxt','zamon'];
  var queue = [], inFlight = false, retries = 0, scheduled = 0;
  var pageId, routeKey = '', currentPath = '', active = 0, authViewSent = false;
  var lastTick = performance.now(), lastActivity = lastTick, wasVisible = document.visibilityState === 'visible';
  var sectionEntries = new Map(), sectionSeen = new Set(), observed = new WeakSet(), dialogs = new WeakSet();
  var actions = new Map();
  var observer;
  var initialQuery = new URLSearchParams(location.search);
  var qa = navigator.webdriver === true || window.__TENCORP_ANALYTICS_QA__ === true || initialQuery.get('analytics_qa') === '1' || initialQuery.get('utm_source') === 'tencorp-integration-check';

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.from(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  }
  function canonical() {
    var parts = location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    var first = parts[0], slug = first === 'avalon' || first === 'tencrop' ? 'avalon-residence' : first;
    var portal = !parts.length || (parts.length === 1 && first === 'tencorp');
    if (!portal && projects.indexOf(slug) < 0) return null;
    if (!portal && parts.length > 1 && !(first === 'sanat' && parts.length === 2 && parts[1] === 'flats') &&
        (parts[1] !== 'apartments' || parts.length > 3 || (parts.length === 3 && parts[2] !== 'available'))) return null;
    var path = portal ? (parts.length ? '/tencorp/' : '/') : '/'+parts.join('/')+(first === 'sanat' && parts.length === 1 ? '/' : '');
    var raw = new URLSearchParams(location.search), query = new URLSearchParams();
    var validations = {
      lang: /^(ru|uz|en)$/, rooms: /^(?:[0-8]|studio)$/, floor: /^(?:[1-9]|[1-9]\d|100)$/,
      block: /^(?:[A-Za-zА-Яа-я][1-9]?|[1-9]\d?|I{1,3}|IV|V)$/, view: /^(?:cards|chess|list)$/, mode: /^(?:cards|chess|list)$/,
      entrance: /^(?:[1-9]|[1-9]\d|100)$/,
      minArea: /^\d{1,3}(?:\.\d{1,2})?$/, maxArea: /^\d{1,3}(?:\.\d{1,2})?$/
    };
    Object.keys(validations).forEach(function (key) { var value = raw.get(key); if (value && validations[key].test(value)) query.set(key,value); });
    return path+(query.size?'?'+query.toString():'');
  }
  function channel() {
    if (!document.referrer) return 'direct';
    try {
      var host = new URL(document.referrer).hostname.toLowerCase();
      if (host === location.hostname) return 'internal';
      if (/(^|\.)(?:google\.[a-z.]+|bing\.com|yandex\.[a-z.]+|duckduckgo\.com)$/.test(host)) return 'search';
      if (/(^|\.)(?:t\.me|telegram\.org|facebook\.com|instagram\.com|youtube\.com|tiktok\.com|vk\.com|x\.com)$/.test(host)) return 'social';
      return 'referral';
    } catch (_) { return 'direct'; }
  }
  var source = channel();
  function scrollDepth() {
    var root = document.documentElement;
    var height = Math.max(0,root.scrollHeight-innerHeight);
    return height ? Math.min(100,Math.max(0,Math.round((scrollY/height)*100))) : 100;
  }
  function formTarget() {var path=currentPath.split('?')[0];return path === '/' || path === '/tencorp/' ? 'form:agency' : 'form:consultation';}
  function emit(name,target,duration) {
    if (!currentPath || !pageId) return;
    var event = {id:uuid(),pageId:pageId,name:name,path:currentPath,scroll:scrollDepth(),at:Date.now()};
    if (target) event.target = target;
    if (duration) event.activeMs = Math.min(15000,duration);
    queue.push(event);
    if (queue.length>100) queue.splice(1,queue.length-100);
  }
  function action(name,target) {
    var key = pageId+':'+name+':'+(target||'');
    var now = Date.now();
    if (now-(actions.get(key)||0)<2000) return;
    actions.set(key,now);
    if (actions.size>200) actions.delete(actions.keys().next().value);
    emit(name,target);
    schedule();
  }
  function accrue() {
    var now = performance.now(), end = Math.min(now,lastActivity+60000);
    if (wasVisible && end>lastTick) active = Math.min(30000,active+Math.min(15000,end-lastTick));
    lastTick = now;
    wasVisible = document.visibilityState === 'visible';
  }
  function sectionTarget() {
    var selected = null, area = 0;
    sectionEntries.forEach(function (entry,target) {
      if (!target.isConnected || !entry.isIntersecting) return;
      var rect = target.getBoundingClientRect(), visible = Math.max(0,Math.min(innerHeight,rect.bottom)-Math.max(0,rect.top));
      if (visible>area) {area=visible;selected=entry.sectionId;}
    });
    return selected ? 'section:'+selected : null;
  }
  function heartbeat() {
    accrue();
    if (active>=1000 && currentPath) {var duration=Math.min(15000,Math.floor(active));active-=duration;emit('engagement',sectionTarget(),duration);}
  }
  function schedule(delay) {
    if (!scheduled) scheduled=setTimeout(function () {scheduled=0;flush(false);},delay||500);
  }
  function flush(unloading) {
    heartbeat();
    queue=queue.filter(function (event) {return Date.now()-event.at<540000;});
    if (!queue.length || inFlight) return;
    var events=queue.slice(0,20), body=JSON.stringify({events:events,source:source,qa:qa});
    while (new Blob([body]).size>15000 && events.length>1) {events.pop();body=JSON.stringify({events:events,source:source,qa:qa});}
    if (unloading && navigator.sendBeacon && navigator.sendBeacon('/api/web-events',new Blob([body],{type:'application/json'}))) {
      removeSent(events);return;
    }
    if (inFlight) return;
    inFlight=true;
    fetch('/api/web-events',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body,keepalive:true}).then(function (response) {
      if (response.ok || (response.status>=400 && response.status<500)) {removeSent(events);retries=0;}
      else retries++;
    }).catch(function () {retries++;}).finally(function () {
      inFlight=false;
      if (retries>2) {removeSent(events);retries=0;}
      if (queue.length) schedule(retries?3000:100);
    });
  }
  function removeSent(events) {
    var ids=new Set(events.map(function (event) {return event.id;}));
    queue=queue.filter(function (event) {return !ids.has(event.id);});
  }
  function publicId(value,fallback) {
    return typeof value==='string' && /^[a-z][a-z0-9_-]{0,47}$/.test(value) && !/\d{9}/.test(value) ? value : fallback;
  }
  function refreshDom() {
    if (!currentPath) return;
    sectionEntries.forEach(function (_,section) {if (!section.isConnected) {sectionEntries.delete(section);observed.delete(section);if(observer)observer.unobserve(section);}});
    if (observer) document.querySelectorAll('main section,section[id]').forEach(function (section,index) {
      if (observed.has(section)) return;
      observed.add(section);
      var id=publicId(section.getAttribute('id'),'section-'+(index+1));
      sectionEntries.set(section,{sectionId:id,isIntersecting:false});
      observer.observe(section);
    });
    document.querySelectorAll('dialog[open],[role="dialog"][aria-modal="true"],.lead-modal').forEach(function (dialog) {
      if (dialogs.has(dialog) || dialog.getAttribute('aria-hidden')==='true' || !dialog.getClientRects().length) return;
      dialogs.add(dialog);
      if (dialog.querySelector('form')) action('form_open',formTarget());
      else if (dialog.matches('.apartment-catalog-lightbox,.dh-plan-dialog,[data-plan-dialog]')) action('plan_view','plan:catalog');
    });
    if (!authViewSent && document.querySelector('[data-auth-required],a[href^="/auth/login"],a[href^="/auth/start"]')) {authViewSent=true;action('auth_view','auth:required');}
  }
  function navigate() {
    var next=canonical(), key=location.pathname.replace(/\/+$/,'')||'/';
    if (key!==routeKey) {
      heartbeat();
      routeKey=key;currentPath=next||'';pageId=uuid();active=0;
      sectionSeen.clear();sectionEntries.clear();observed=new WeakSet();dialogs=new WeakSet();authViewSent=false;
      if (observer) observer.disconnect();
      emit('page_view');
    } else if (next && next!==currentPath) {currentPath=next;if (/\/(?:apartments|flats)(?:[/?]|$)/.test(next)) action('catalog_filter','catalog:filter');}
    refreshDom();schedule();
  }
  if ('IntersectionObserver' in window) observer=new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var saved=sectionEntries.get(entry.target);
      if (!saved) return;
      saved.isIntersecting=entry.isIntersecting;
      if (entry.isIntersecting && entry.intersectionRect.height>=Math.min(innerHeight,entry.boundingClientRect.height)*0.25 && !sectionSeen.has(saved.sectionId)) {
        sectionSeen.add(saved.sectionId);action('section_view','section:'+saved.sectionId);
      }
    });
  },{threshold:[0,0.1,0.25,0.5,0.75,1]});
  ['pointerdown','pointermove','keydown','scroll','touchstart'].forEach(function (name) {
    addEventListener(name,function () {accrue();lastActivity=performance.now();},{passive:true,capture:true});
  });
  document.addEventListener('click',function (event) {
    if (!(event.target instanceof Element)) return;
    var target=event.target, project=target.closest('[data-project]');
    if (project && projects.indexOf(project.getAttribute('data-project'))>=0) action('map_select','map:'+project.getAttribute('data-project'));
    var link=target.closest('a[href]'), href=link&&link.getAttribute('href');
    if (href) {
      if (/^tel:/i.test(href)) action('contact_click','contact:phone');
      else if (/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\//i.test(href)) action('contact_click','contact:telegram');
      else if (/^(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com)\//i.test(href)) action('contact_click','contact:whatsapp');
      else if (/^mailto:/i.test(href)) action('contact_click','contact:email');
      else if (/^\/(?:auth\/login|auth\/start)/.test(href)) action('auth_click','auth:login');
    }
    if (target.closest('.apartment-catalog-card__select,.apartment-catalog__plan-preview,.apartment-catalog-chess__units button,.dh-plan-card-image,[data-plan-id],[data-layout-id]')) action('plan_view','plan:catalog');
    if (target.closest('.pushkin-gallery-grid button,.flagman-photo,.dormon-gallery-controls button,[data-gallery]')) action('gallery_view','gallery:project');
    if (target.closest('[data-lead-trigger],.apartment-catalog__primary,.dh-plan-text-action')) action('form_open',formTarget());
  },true);
  document.addEventListener('submit',function (event) {
    if (event.target instanceof HTMLFormElement && !event.target.closest('[data-auth-form]') && event.target.querySelector('input[type="tel"],input[name="phone"]')) action('form_submit',formTarget());
  },true);
  document.addEventListener('change',function (event) {
    if (event.target instanceof HTMLSelectElement && /\/(?:apartments|flats)(?:[/?]|$)/.test(currentPath)) action('catalog_filter','catalog:filter');
  },true);
  addEventListener('tencorp:analytics',function (event) {
    var detail=event.detail;
    if (!detail || typeof detail.name!=='string') return;
    var names=['form_open','form_submit','form_success','plan_view','map_select','auth_view','auth_click','catalog_filter','gallery_view'];
    if (names.indexOf(detail.name)<0) return;
    var target=detail.target;
    if (/^form_/.test(detail.name)) target=formTarget();
    else if (detail.name==='map_select') target=projects.indexOf(target)>=0?'map:'+target:target;
    else if (detail.name==='plan_view') target='plan:catalog';
    else if (detail.name==='catalog_filter') target='catalog:filter';
    else if (detail.name==='gallery_view') target='gallery:project';
    else target=detail.name==='auth_view'?'auth:required':'auth:login';
    if (detail.name==='map_select' && (typeof target!=='string'||target.indexOf('map:')!==0||projects.indexOf(target.slice(4))<0)) return;
    action(detail.name,target);
  });
  ['pushState','replaceState'].forEach(function (name) {var original=history[name];history[name]=function () {var result=original.apply(this,arguments);queueMicrotask(navigate);return result;};});
  addEventListener('popstate',navigate);
  addEventListener('pageshow',function () {lastTick=performance.now();wasVisible=document.visibilityState==='visible';navigate();});
  addEventListener('pagehide',function () {flush(true);});
  document.addEventListener('visibilitychange',function () {accrue();if (document.visibilityState==='hidden') flush(true);});
  var mutationScheduled=false;
  new MutationObserver(function () {
    if (mutationScheduled) return;
    mutationScheduled=true;
    setTimeout(function () {mutationScheduled=false;refreshDom();},300);
  }).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['open','aria-hidden','aria-modal']});
  setInterval(function () {flush(false);},15000);
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',navigate,{once:true});else navigate();
}());
