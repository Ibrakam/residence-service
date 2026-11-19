import manifest from '@/data/dormon-responsive-media.json';
import { dormonBase } from './dormon-data';

type Format = 'webp' | 'avif';
type Derivative = { src: string; bytes: number };
type Image = { width: number; height: number; variants: Array<{ width: number; height: number; webp: Derivative; avif: Derivative }> };
const images: Record<string, Image> = manifest.images;

export function dormonMediaSources(src: string) {
  const path = dormonBase && src.startsWith(`${dormonBase}/dormon-hills/`) ? src.slice(dormonBase.length) : src;
  const image = images[path];
  if (!image) return undefined;
  const set = (format: Format) => image.variants.map(variant => `${dormonBase}${variant[format].src} ${variant.width}w`).join(', ');
  return { width: image.width, height: image.height, avif: set('avif'), webp: set('webp') };
}

// The mobile overview fits at 1.22 × viewport width. A selected facade uses
// the existing 2.12 × camera zoom; retain its detail and unchanged hit regions.
export function dormonSceneSizes(facade: boolean) {
  return facade
    ? '(max-width: 700px) 260vw, 136vw'
    : '(max-width: 700px) 122vw, (min-aspect-ratio: 16/9) 100vw, 165vh';
}

// Build the same picture candidates as the rendered image. The browser picks
// its supported format and screen/DPR width, including when preloading a scene.
// Keeping the picture as the image's parent also keeps it alive until decode.
export function preloadDormonMedia(src: string, sizes: string): HTMLImageElement {
  const image = new window.Image();
  const media = dormonMediaSources(src);
  image.decoding = 'async';
  image.loading = 'eager';
  if (media) {
    const picture = document.createElement('picture');
    const avif = document.createElement('source');
    avif.type = 'image/avif';
    avif.sizes = sizes;
    avif.srcset = media.avif;
    picture.appendChild(avif);
    picture.appendChild(image);
    image.sizes = sizes;
    image.srcset = media.webp;
  }
  image.src = src;
  return image;
}
