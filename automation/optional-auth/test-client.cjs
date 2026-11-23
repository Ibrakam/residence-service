/* Real DOM regression tests; no CRM requests or submitted applications. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const code = fs.readFileSync(path.join(__dirname,'client.js'),'utf8');
(async () => {
  const browser = await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {})});
  try {
    async function setup(route='/dormon-hills', {ready=true, legacy=false, mode=true}={}) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const requests=[];
      await context.route('https://optional.test/**', async request => {
        const url=new URL(request.request().url());requests.push(url.pathname);
        if(url.pathname==='/__auth/me') return request.fulfill({status:401,json:{error:'guest'}});
        return request.fulfill({contentType:'text/html',body:`<html><head>${mode?'<meta name="tencorp-auth-mode" content="optional">':''}</head><body><button ${legacy?'class="header-request"':'data-tencorp-auto-lead'}>Получить консультацию</button><script>window.clicks=0;document.querySelector('button').onclick=()=>{window.clicks++;const d=document.createElement('div');d.setAttribute('role','dialog');d.className='lead-modal';d.innerHTML='<label>Имя<input name="name"></label><label>Телефон<input type="tel"></label><button onclick="this.parentElement.remove()">Закрыть</button>';document.body.append(d)};</script></body></html>`});
      });
      await page.goto('https://optional.test'+route);
      await page.clock.install();
      await page.evaluate(value=>window.__tencorpOptionalConsumerReady=value,ready);
      await page.addScriptTag({content:code});
      await page.clock.runFor(50);
      return {page,context,requests};
    }
    {
      const {page,context,requests}=await setup();
      await page.clock.runFor(4900);assert.equal(await page.evaluate(()=>clicks),0);
      await page.clock.runFor(200);assert.equal(await page.evaluate(()=>clicks),1);
      assert.equal(await page.locator('[role=dialog] input[type=tel]').count(),1);
      assert.equal(await page.locator('.tencorp-optional-signin').getAttribute('href'),'/__auth/login?return_to=%2Fdormon-hills');
      await page.locator('[role=dialog] button').click();await page.clock.runFor(10000);assert.equal(await page.evaluate(()=>clicks),1);
      await page.reload();await page.evaluate(()=>window.__tencorpOptionalConsumerReady=true);await page.addScriptTag({content:code});await page.clock.runFor(6000);assert.equal(await page.evaluate(()=>clicks),0,'dismissed prompt must not reopen in same tab/project');
      assert.ok(requests.every(value=>!value.includes('leads')&&!value.includes('submit')));
      await context.close();
    }
    {
      const {page,context}=await setup();await page.clock.runFor(1000);await page.locator('button[data-tencorp-auto-lead]').click();await page.clock.runFor(50);await page.locator('[role=dialog] button').click();await page.clock.runFor(10000);assert.equal(await page.evaluate(()=>clicks),1,'manual enquiry suppresses timed prompt');await context.close();
    }
    {
      const {page,context}=await setup();await page.clock.runFor(2000);
      await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
      await page.clock.runFor(20000);assert.equal(await page.evaluate(()=>clicks),0);
      await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
      await page.clock.runFor(2500);assert.equal(await page.evaluate(()=>clicks),0);await page.clock.runFor(1000);assert.equal(await page.evaluate(()=>clicks),1);await context.close();
    }
    {
      const {page,context}=await setup('/4u',{ready:false});await page.clock.runFor(6000);assert.equal(await page.evaluate(()=>clicks),0);assert.equal(await page.locator('.tencorp-optional-signin').count(),0);
      await page.evaluate(()=>{window.__tencorpOptionalConsumerReady=true;window.dispatchEvent(new Event('tencorp:consumer-ready'));const d=document.createElement('div');d.id='other';d.setAttribute('role','dialog');d.textContent='Меню';document.body.append(d);});
      await page.clock.runFor(1000);assert.equal(await page.evaluate(()=>clicks),0);await page.locator('#other').evaluate(element=>element.remove());await page.clock.runFor(500);assert.equal(await page.evaluate(()=>clicks),1);await context.close();
    }
    for(const route of ['/','/tencorp/','/privacy','/analytics','/__auth/account']) {
      const {page,context}=await setup(route);await page.clock.runFor(6000);assert.equal(await page.evaluate(()=>clicks),0);assert.equal(await page.locator('.tencorp-optional-signin').count(),0);await context.close();
    }
    {
      const {page,context}=await setup('/maftun-makon');await page.locator('button[data-tencorp-auto-lead]').evaluate(element=>element.style.opacity='0');await page.clock.runFor(6000);assert.equal(await page.evaluate(()=>clicks),1,'scroll-reveal CTA still uses its existing handler');await context.close();
    }
    {
      const {page,context}=await setup('/dormon-hills',{mode:false});await page.clock.runFor(6000);assert.equal(await page.evaluate(()=>clicks),0);await context.close();
    }
    {
      const {page,context}=await setup('/sanat/flats',{ready:false,legacy:true});await page.clock.runFor(6000);assert.equal(await page.evaluate(()=>clicks),1);await context.close();
    }
    console.log('Optional enquiry bootstrap real DOM timing, visibility, dialogs, session deduplication, legacy and excluded paths: PASS');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
