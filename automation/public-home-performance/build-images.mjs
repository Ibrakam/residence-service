// Loss-restricted photo recompression; originals and source releases stay unchanged.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { ssim } from 'ssim.js';
const require = createRequire(new URL('../../website/package.json', import.meta.url));
const sharp = require('sharp');
const [input, output] = process.argv.slice(2);
if (!input || !output || process.argv.length !== 4) throw new Error('Usage: node build-images.mjs INPUT_IMAGES OUTPUT_PATCH');
const sourceRoot = path.resolve(input), targetRoot = path.resolve(output);
if (sourceRoot === targetRoot || targetRoot.startsWith(sourceRoot + path.sep) || sourceRoot.startsWith(targetRoot + path.sep) || targetRoot === path.parse(targetRoot).root) throw new Error('Output must be outside the source directory');
const names = ['hero.jpeg', 'agent-artur-optimized.jpg', 'agent-artem-optimized.jpg', 'bayterak.jpg', 'team.jpg', 'boulevard.webp', 'mirabad.webp', 'nrg-oybek.webp', 'nrg.webp', 'project.webp'];
const digest = data => createHash('sha256').update(data).digest('hex');
const threshold = .97;
const raw = async buffer => {const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });return { data: new Uint8ClampedArray(data), width: info.width, height: info.height };};
const files = [];
await mkdir(path.join(targetRoot, 'images'), { recursive: true });
sharp.concurrency(2);
for (const name of names) {
 const original = await readFile(path.join(sourceRoot, name));
 const metadata = await sharp(original).metadata();
 const jpeg = /\.jpe?g$/.test(name);
 if (!metadata.width || !metadata.height || !['jpeg','webp'].includes(metadata.format) || (metadata.orientation && metadata.orientation !== 1)) throw new Error('Photo needs an explicit orientation review: '+name);
 const baseline = await raw(original);
 let best;
 for (const quality of [80,82,85,88,90,93,96]) {
  const pipeline = sharp(original);
  const candidate = await (jpeg ? pipeline.jpeg({ quality, mozjpeg:true, progressive:true, chromaSubsampling:'4:2:0' }) : pipeline.webp({ quality, effort:6 })).toBuffer();
  if (candidate.length >= original.length * .95) continue;
  const rendered = await raw(candidate);
  if (rendered.width !== baseline.width || rendered.height !== baseline.height) throw new Error('Changed photo geometry');
  const similarity = ssim(baseline, rendered, { downsample: false }).mssim;
  if (similarity >= threshold) {best = {bytes:candidate,quality,ssim:similarity};break;}
 }
 if (best) await writeFile(path.join(targetRoot,'images',name),best.bytes);
 else await rm(path.join(targetRoot,'images',name),{force:true});
 files.push({ path:'images/'+name, sourceSha256:digest(original), sourceBytes:original.length, width:metadata.width,height:metadata.height,format:metadata.format, changed:!!best, outputSha256:best?digest(best.bytes):digest(original),outputBytes:best?.bytes.length??original.length,quality:best?.quality??null,ssim:best?.ssim??1 });
 console.log(JSON.stringify(files.at(-1)));
}
const manifest = { schemaVersion:1,buildTool:{sharp:sharp.versions.sharp,ssim:'3.5.0'},ssimThreshold:threshold,sourceBytes:files.reduce((a,f)=>a+f.sourceBytes,0),outputBytes:files.reduce((a,f)=>a+f.outputBytes,0),files };
await writeFile(path.join(targetRoot,'images-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({sourceBytes:manifest.sourceBytes,outputBytes:manifest.outputBytes,changed:files.filter(f=>f.changed).length}));
