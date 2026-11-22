const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const source=fs.readFileSync(path.join(__dirname,'projects-map-loader.js'),'utf8');
const cases=new Map();
const privateModule=`window.__privateStarts=(window.__privateStarts||0)+1;const map=document.createElement('section');map.id='map';map.className='projects-map';map.innerHTML='<h2>Test private map</h2><button id="zoom">Zoom</button>';document.querySelector('#project').insertAdjacentElement('afterend',map);map.querySelector('button').onclick=()=>map.append(document.createElement('i'));`;
const server=http.createServer((req,res)=>{
 const key=req.headers['x-test-case']||'base', state=cases.get(key);
 const pathname=new URL(req.url,'http://test').pathname;
 if(pathname==='/__auth/me'){
  state.authRequests++;
  if(state.revoked||state.guest){res.writeHead(401,{'Content-Type':'application/json'});res.end('{}');return;}
  if(state.authError){res.writeHead(503,{'Content-Type':'application/json'});res.end('{}');return;}
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({phoneNumberVerified:true,sessionExpiresAt:new Date(state.expiresAt||Date.now()+60000).toISOString()}));return;
 }
 if(pathname==='/tencorp/assets/projects-map.js'){
  state.privateRequests++;
  res.writeHead(state.moduleDenied?401:200,{'Content-Type':'application/javascript'});res.end(state.moduleDenied?'':privateModule);return;
 }
 if(pathname==='/loader.js'){res.writeHead(200,{'Content-Type':'application/javascript'});res.end(source);return;}
 state.documents++;
 res.writeHead(200,{'Content-Type':'text/html'});res.end(`<!doctype html><html><head><meta charset="UTF-8"><script defer src="/loader.js"></script><style>body{margin:0}#project{margin-top:5000px;height:400px}section{min-height:400px}a{display:block}.intro-lock{overflow:hidden}</style></head><body>${state.bodyLock ? '<script>document.body.classList.add("intro-lock");setTimeout(()=>document.body.classList.remove("intro-lock"),1800)</script>' : ''}<a href="#map" id="direct-map-link">Open map</a><a class="service-card" href="/old"><h3>Новостройки</h3></a><section id="project">Public project</section></body></html>`);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 const results=[];
 async function run(name,config,action){
  const state={authRequests:0,sdkRequests:0,privateRequests:0,documents:0,...config};cases.set(name,state);
  const context=await browser.newContext({viewport:{width:390,height:850},extraHTTPHeaders:{'X-Test-Case':name}});
  if(state.noIO)await context.addInitScript(()=>{delete window.IntersectionObserver});
  await context.route('https://api-maps.yandex.ru/2.1/**',async route=>{state.sdkRequests++;if(state.sdkError&&state.sdkRequests===1){await route.abort();return;}await route.fulfill({status:200,contentType:'application/javascript',body:state.sdkTimeout?'window.ymaps={ready(){}};':'window.ymaps={ready(callback){callback()}};'});});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(state.returnQuery?origin+'/?section=map&utm_source=fixture':origin+(state.hash?'#map':''),{waitUntil:'networkidle'});await page.locator('[data-tencorp-map-placeholder],.projects-map').waitFor();
  await action(page,state,context);
  assert.equal(errors.length,0,JSON.stringify(errors));results.push({name,authRequests:state.authRequests,sdkRequests:state.sdkRequests,privateRequests:state.privateRequests,documents:state.documents,errors});await context.close();
 }
 await run('authorized-cold-and-keyboard',{},async(p,s)=>{
  assert.equal(s.authRequests,1);assert.equal(s.sdkRequests,0);assert.equal(s.privateRequests,0);
  assert.equal(await p.locator('a.service-card').getAttribute('href'),'#map');
  await p.locator('#direct-map-link').focus();await p.keyboard.press('Enter');await p.locator('.projects-map:not(.projects-map--locked)').waitFor();
  assert.equal(s.sdkRequests,1);assert.equal(s.privateRequests,1);assert.equal(s.authRequests,2);
  await p.locator('#zoom').click({clickCount:3});await p.evaluate(()=>{window.dispatchEvent(new Event('resize'));window.dispatchEvent(new HashChangeEvent('hashchange'));});await p.waitForTimeout(200);
  await p.addScriptTag({content:source});assert.equal(s.sdkRequests,1);assert.equal(s.privateRequests,1);assert.equal(await p.evaluate(()=>window.__privateStarts),1);
 });
 await run('guest',{guest:true},async(p,s)=>{await p.locator('.projects-map--locked').waitFor();await p.locator('#direct-map-link').click();await p.waitForTimeout(100);assert.equal(s.sdkRequests,0);assert.equal(s.privateRequests,0);assert.match(await p.locator('.projects-map--locked a').getAttribute('href'),/^\/__auth\/login/);});
 await run('direct-map-hash',{hash:true},async(p,s)=>{await p.locator('.projects-map:not(.projects-map--locked)').waitFor();assert.equal(s.sdkRequests,1);assert.equal(s.privateRequests,1);assert.equal(s.authRequests,2);});
 await run('login-return-map-query',{returnQuery:true},async(p,s)=>{await p.locator('.projects-map:not(.projects-map--locked)').waitFor();assert.equal(s.privateRequests,1);const url=new URL(p.url());assert.equal(url.hash,'#map');assert.equal(url.searchParams.get('utm_source'),'fixture');assert.equal(url.searchParams.has('section'),false);});
 await run('direct-map-during-introduction',{hash:true,bodyLock:true},async(p,s)=>{await p.locator('.projects-map:not(.projects-map--locked)').waitFor();assert.equal(await p.evaluate(()=>window.scrollY),0);await p.waitForFunction(()=>window.scrollY>4000);assert.equal(s.sdkRequests,1);assert.equal(s.privateRequests,1);});
 await run('scroll-no-intersection-observer',{noIO:true},async(p,s)=>{assert.equal(s.sdkRequests,0);await p.locator('[data-tencorp-map-placeholder]').scrollIntoViewIfNeeded();await p.locator('.projects-map:not(.projects-map--locked)').waitFor();assert.equal(s.sdkRequests,1);assert.equal(s.privateRequests,1);});
 await run('revoked-before-scroll',{},async(p,s)=>{s.revoked=true;await p.locator('[data-tencorp-map-placeholder]').scrollIntoViewIfNeeded();await p.locator('.projects-map--locked').waitFor();assert.equal(s.sdkRequests,0);assert.equal(s.privateRequests,0);});
 await run('guest-reauthorized-near-map',{guest:true},async(p,s)=>{await p.locator('[data-tencorp-map-placeholder]').scrollIntoViewIfNeeded();s.guest=false;await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.locator('.projects-map:not(.projects-map--locked)').waitFor();assert.equal(s.sdkRequests,1);assert.equal(s.privateRequests,1);});
 await run('auth-service-error',{authError:true},async(p,s)=>{assert.equal(s.sdkRequests,0);assert.equal(s.privateRequests,0);assert.match(await p.locator('.projects-map--locked').textContent(),/временно/);});
 await run('sdk-error-explicit-retry',{hash:true,sdkError:true},async(p,s)=>{await p.getByText('Повторить загрузку').click();await p.locator('.projects-map:not(.projects-map--locked)').waitFor();assert.equal(s.documents,2);assert.equal(s.privateRequests,1);assert.equal(s.sdkRequests,2);});
 await run('private-module-denied',{hash:true,moduleDenied:true},async(p,s)=>{await p.getByText('Повторить загрузку').waitFor();assert.equal(await p.locator('.projects-map:not(.projects-map--locked)').count(),0);assert.equal(s.privateRequests,1);});
 await run('expiry-after-ready',{hash:true,expiresAt:Date.now()+1800},async(p,s)=>{await p.locator('.projects-map:not(.projects-map--locked)').waitFor();await p.locator('.projects-map--locked').waitFor();assert.equal(await p.locator('.projects-map:not(.projects-map--locked)').count(),0);assert.equal(s.privateRequests,1);});
 await run('sdk-bounded-timeout',{hash:true,sdkTimeout:true},async(p,s)=>{await p.getByText('Повторить загрузку').waitFor({timeout:14000});assert.equal(s.privateRequests,0);});
 await browser.close();await new Promise(r=>server.close(r));
 const out=process.env.TENCORP_LOADER_TEST_RESULT;if(out)fs.writeFileSync(out,JSON.stringify(results,null,2));console.log(JSON.stringify({passed:true,cases:results},null,2));
})().catch(e=>{console.error(e);server.close();process.exit(1)});
