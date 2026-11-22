import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {ssim} from 'ssim.js';
const require=createRequire(new URL('../../website/package.json',import.meta.url));
const sharp=require('sharp');
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node verify-images.mjs INPUT_IMAGES OUTPUT_PATCH');
const manifest=JSON.parse(await readFile(path.join(output,'images-manifest.json'),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const pixels=async b=>{const {data,info}=await sharp(b).ensureAlpha().raw().toBuffer({resolveWithObject:true});return {data:new Uint8ClampedArray(data),width:info.width,height:info.height}};
assert.equal(manifest.schemaVersion,1);
assert.equal(manifest.files.length,10);
const expected=[];
for(const item of manifest.files){
 assert.match(item.path,/^images\/[a-z0-9-]+\.(?:jpe?g|webp)$/);
 const original=await readFile(path.join(input,path.basename(item.path)));
 assert.equal(hash(original),item.sourceSha256);
 assert.equal(original.length,item.sourceBytes);
 if(!item.changed){assert.equal(item.outputSha256,item.sourceSha256);assert.equal(item.outputBytes,item.sourceBytes);continue;}
 expected.push(path.basename(item.path));
 const candidate=await readFile(path.join(output,item.path));
 assert.equal(hash(candidate),item.outputSha256);assert.equal(candidate.length,item.outputBytes);
 assert.ok(candidate.length<original.length*.95);
 const a=await pixels(original),b=await pixels(candidate);
 assert.equal(a.width,b.width);assert.equal(a.height,b.height);
 assert.equal(a.width,item.width);assert.equal(a.height,item.height);
 const score=ssim(a,b,{downsample:false}).mssim;
 assert.ok(score>=manifest.ssimThreshold);
 assert.ok(Math.abs(score-item.ssim)<1e-10);
}
assert.deepEqual((await readdir(path.join(output,'images'))).sort(),expected.sort());
console.log(JSON.stringify({verified:true,photos:manifest.files.length,changed:expected.length,sourceBytes:manifest.sourceBytes,outputBytes:manifest.outputBytes,minimumSSIM:Math.min(...manifest.files.map(f=>f.ssim))}));
