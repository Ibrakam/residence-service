import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require('/Users/ibragimkadamzanov/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.dirname(fileURLToPath(import.meta.url)),version='20261122-1';
const manifest=JSON.parse(fs.readFileSync(path.join(root,'releases',version,'manifest.json')));
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><meta charset="utf-8"><p id="sample">Квартиры O‘zbekiston Ўзбекистон ҒҚҲ</p>');}
 if(!/^\/(?:assets|releases\/20261122-1\/assets)\/[a-zA-Z0-9_.-]+\.(?:woff2|css)$/.test(pathname)){res.writeHead(404);return res.end();}
 const file=path.join(root,pathname);if(!fs.existsSync(file)){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',file.endsWith('.woff2')?'font/woff2':'text/css');res.end(fs.readFileSync(file));
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:'/Users/ibragimkadamzanov/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});
try{
 const context=await browser.newContext(),page=await context.newPage();const fontRequests=[];
 page.on('request',r=>{if(r.url().endsWith('.woff2'))fontRequests.push(new URL(r.url()).pathname)});
 await page.goto(origin);await page.addStyleTag({url:`${origin}/releases/${version}/assets/site-fonts.css`});
 await page.evaluate(async()=>{await document.fonts.load('500 24px "TenCorp Montserrat"','Квартиры O‘zbekiston Ўзбекистон ҒҚҲ');await document.fonts.load('400 16px "TenCorp Helvetica Neue"','Описание O‘zbekiston Ўзбекистон ҒҚҲ');await document.fonts.load('700 16px "TenCorp Helvetica Neue"','Описание');});
 assert(fontRequests.filter(p=>p.includes('-common-')).length>=3);
 assert(!fontRequests.some(p=>/\/(?:montserrat|helvetica-neue-(?:400|700))\.woff2$/.test(p)),JSON.stringify(fontRequests));
 // Rare characters resolve through the unchanged complete original face.
 const beforeGreek=fontRequests.length;
 await page.evaluate(async()=>{await document.fonts.load('400 20px "TenCorp Helvetica Neue"','Ω');});
 assert(fontRequests.slice(beforeGreek).some(p=>p.endsWith('/helvetica-neue-400.woff2')));
 const matches=await page.evaluate(async({fonts,version})=>{
 const texts=['Квартира для жизни — 62,35 м²','O‘zbekiston, Toshkent, 100% UZS','Ўзбекистон ҒҚҲ € $ ₽ © № ↗','АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'];let checks=0;
 for(const [index,font] of fonts.entries()){
  if(!font.common)continue;const variable=font.original==='montserrat.woff2';
  const descriptors={weight:variable?'100 900':font.original.includes('-700')?'700':font.original.includes('-500')?'500':'400'};
  const oldFace=new FontFace('original'+index,`url(/assets/${font.original})`,descriptors),newFace=new FontFace('common'+index,`url(/releases/${version}/assets/${font.common})`,descriptors);
  await oldFace.load();await newFace.load();document.fonts.add(oldFace);document.fonts.add(newFace);
  const c=document.createElement('canvas').getContext('2d');
  for(const w of variable?[100,400,500,700,900]:[Number(descriptors.weight)])for(const text of texts){c.font=`${w} 24px original${index}`;const a=c.measureText(text).width;c.font=`${w} 24px common${index}`;const b=c.measureText(text).width;if(Math.abs(a-b)>0.001)throw Error(`Changed width ${font.original} ${w}: ${a} != ${b}`);checks++;}
 }
 return checks;
 },{fonts:manifest.fonts,version});
 console.log(JSON.stringify({verified:true,browserKerningMetricChecks:matches,commonLanguageUsesOnlySmallFiles:true,completeFallbackLoadedForGreek:true}));
 await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
