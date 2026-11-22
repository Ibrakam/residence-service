import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/ibragimkadamzanov/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] ?? 'preview';
const output = process.env.FONT_REPORT_DIR ?? '/tmp/tencorp-fonts-20261122/browser';
const version = '20261122-1';
const assetRoot = path.join(root,'releases',version,'assets');
mkdirSync(output, { recursive: true });
// Credential is held in memory only and never logged or saved to storageState.
const session = execFileSync('/usr/bin/ssh', ['-F', '/dev/null', '-i',
  '/Users/ibragimkadamzanov/.ssh/id_ed25519', '-o', 'BatchMode=yes', '-o',
  'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', 'root@46.62.227.229',
  'cat /etc/tencorp-auth-gateway/deploy-smoke-session'], { encoding:'utf8' }).trim();
const browser = await chromium.launch({headless:true, executablePath:
  '/Users/ibragimkadamzanov/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});
const context = await browser.newContext({ reducedMotion:'reduce' });
await context.addCookies([{name:'__Host-tencorp_session',value:session,
  url:'https://form.tencorp.uz',secure:true,httpOnly:true,sameSite:'Lax'}]);
if (mode === 'preview') {
  await context.route(`**/site-typography/${version}/*`, async route => {
    const file = path.basename(new URL(route.request().url()).pathname);
    await route.fulfill({body:readFileSync(path.join(assetRoot,file)),
      contentType:file.endsWith('woff2')?'font/woff2':'text/css'});
  });
}
const projects = ['avalon','4u','bayterak','botanika-saroyi','c1','flagman','jomiy',
  'maftun-makon','meros','mirador','ofiyat','regnum-plaza','saadiyat','sado',
  'sarbon','soy-boyi','sun','voha','yangibaxt','zamon','pushkin'];
const selected = process.env.FONT_PATHS?.split(',');
const routes = selected ?? (mode === 'baseline' ? ['/dormon-hills','/dormon-hills/apartments'] :
  ['/','/tencorp/','/tencrop/','/sanat/','/sanat/flats',...projects.flatMap(p=>p==='avalon'?['/avalon']:['/'+p,'/'+p+'/apartments']),'/dormon-hills','/dormon-hills/apartments']);
const previousReport=path.join(output,mode+'.json');
const results = process.env.FONT_RESUME==='1'&&existsSync(previousReport)?JSON.parse(readFileSync(previousReport,'utf8')).filter(r=>r.status===200&&!r.error):[];
const failures=[];
const jobs=[1440,390].flatMap(width=>routes.map(url=>({width,url}))).filter(j=>!results.some(r=>r.width===j.width&&r.path===j.url));
try {
  await Promise.all(Array.from({length:Number(process.env.FONT_CONCURRENCY??3)},async()=>{
    while(jobs.length) {
      const {width,url}=jobs.shift();
      const page = await context.newPage();
      await page.setViewportSize({width,height:1000});
      const errors=[];
      page.on('pageerror', e=>errors.push(e.message));
      // Data refreshes, images and third-party map APIs are not part of a
      // typography check. Avoid needless download of every full-size render.
      // Leave the real production HTTP cache enabled during the final pass.
      // Registering any Playwright route disables that cache for the page.
      if(mode!=='live') await page.route('**/*', route => {
        const type=route.request().resourceType();
        return ['image','media'].includes(type) && process.env.FONT_IMAGES!=='1' ? route.abort() : route.fallback();
      });
      try {
        let response;
        for(let attempt=0;attempt<2;attempt++){
          try { response=await page.goto('https://form.tencorp.uz'+url,{waitUntil:'commit',timeout:30000});break; }
          catch(error){if(attempt||!error.message.includes('ERR_NETWORK_IO_SUSPENDED'))throw error;}
        }
        // Third-party map SDKs can delay DOMContentLoaded independently of
        // typography. Wait for the rendered title and all linked styles.
        await page.waitForSelector('h1',{state:'attached',timeout:25000});
        await page.waitForFunction(()=>[...document.querySelectorAll('link[rel~="stylesheet"]')].every(link=>link.sheet),undefined,{timeout:25000});
        if (mode==='preview' && !url.includes('dormon-hills'))
          await page.addStyleTag({url:`https://form.tencorp.uz/site-typography/${version}/site-fonts.css`});
        if(mode==='live'&&!url.includes('dormon-hills')) await page.waitForFunction(()=>[...document.fonts].some(f=>f.family.includes('TenCorp Montserrat')),undefined,{timeout:20000});
        if(mode!=='baseline'&&!url.includes('dormon-hills')) await page.evaluate(async()=>{
          await Promise.all([document.fonts.load('500 20px "TenCorp Montserrat"','Квартира'),
            document.fonts.load('400 16px "TenCorp Helvetica Neue"','Описание')]);
        });
        // Requested faces were explicitly loaded above. Old, now-unused font
        // preloads must not stall every production page check.
        if(mode==='baseline') await page.evaluate(()=>Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,10000))]));
        await page.waitForTimeout(450);
        const metrics=await page.evaluate(()=>{
          const visible=e=>{const r=e.getBoundingClientRect(); const s=getComputedStyle(e); return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
          const get=e=>{const s=getComputedStyle(e);const r=e.getBoundingClientRect();let clipped=false;for(let p=e.parentElement;p&&p!==document.body;p=p.parentElement){const cs=getComputedStyle(p);if(['hidden','clip','scroll','auto'].includes(cs.overflowX)){const pr=p.getBoundingClientRect();if(r.left<pr.left-3||r.right>pr.right+3){clipped=true;break;}}}return{text:e.textContent.trim().slice(0,90),tag:e.tagName,class:e.className,font:s.fontFamily,size:s.fontSize,weight:s.fontWeight,line:s.lineHeight,tracking:s.letterSpacing,x:Math.round(r.x),width:Math.round(r.width),height:Math.round(r.height),scroll:e.scrollWidth,client:e.clientWidth,clipped};};
          const headings=[...document.querySelectorAll('h1,h2,h3')].filter(visible).map(get);
          const paragraphs=[...document.querySelectorAll('p')].filter(visible).slice(0,8).map(get);
          return {title:document.title,url:location.pathname,bodyFont:getComputedStyle(document.body).fontFamily,
            headingFontLoaded:document.fonts.check('500 20px "TenCorp Montserrat"','Квартира'),
            copyFontLoaded:document.fonts.check('400 16px "TenCorp Helvetica Neue"','Описание'),
            fontFaces:[...document.fonts].filter(f=>/TenCorp/.test(f.family)).map(f=>({family:f.family,style:f.style,weight:f.weight,status:f.status})),
            pageWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,
            injected:!!document.querySelector('link[href*="site-typography"]'),headings,paragraphs,
            overflow:headings.filter(h=>h.scroll>h.client+3||!h.clipped&&(h.x+h.width>innerWidth+5||h.x< -5))};
        });
        const result={path:url,width,status:response.status(),...metrics,errors};
        results.push(result);
        if(mode!=='baseline'){
          if(result.status!==200) failures.push({path:url,width,reason:'HTTP '+result.status});
          if(!url.includes('dormon-hills')){
            for(const family of ['TenCorp Montserrat','TenCorp Helvetica Neue'])
              if(!metrics.fontFaces.some(f=>f.family.replaceAll('"','')===family&&f.status==='loaded')) failures.push({path:url,width,reason:'Font not loaded: '+family});
            if(metrics.headings.some(h=>!h.font.includes('TenCorp Montserrat'))) failures.push({path:url,width,reason:'Heading family mismatch'});
            if(metrics.paragraphs.some(p=>!p.font.includes('TenCorp Helvetica Neue'))) failures.push({path:url,width,reason:'Copy family mismatch'});
            if(metrics.overflow.length||metrics.scrollWidth>width+3)failures.push({path:url,width,reason:'Overflow',headings:metrics.overflow});
          }else if(metrics.injected||metrics.headings.some(h=>h.font.includes('TenCorp'))) failures.push({path:url,width,reason:'Do‘rmon changed'});
        }
        if (process.env.FONT_SCREENSHOTS==='1') {
          await page.screenshot({path:path.join(output,mode+'-'+(url.replaceAll('/','_')||'home')+'-'+width+'.png')});
        }
        console.log(JSON.stringify({path:url,width,status:result.status,h1:metrics.headings.find(x=>x.tag==='H1')?.font,overflow:metrics.overflow.length,pageOverflow:metrics.scrollWidth>width+3,errors:errors.length}));
      } catch(e) { results.push({path:url,width,error:e.message}); failures.push({path:url,width,reason:e.message});console.log(JSON.stringify({path:url,width,error:e.message})); }
      finally { await page.close(); }
      writeFileSync(path.join(output,mode+'.json'),JSON.stringify(results,null,2));
    }
  }));
} finally { await context.close(); await browser.close(); }
writeFileSync(path.join(output,mode+'-failures.json'),JSON.stringify(failures,null,2));
if(failures.length&&mode!=='baseline'){console.error(JSON.stringify({failures:failures.length}));process.exitCode=1;}
