# Public homepage cold-loading patch

This directory contains public photo patches and the lazy map gate. It does not
contain the protected project module, CRM data or server credentials. The map SDK
key in the loader is the existing browser-visible, host-restricted Yandex key.

## Reproduce photo optimization

Use Node 22 and the repository's installed Sharp dependency. This tool only reads
the ten reviewed marketing photographs. It preserves their dimensions, file
format, orientation and visible content. Technical apartment/floor plans and SVG
logos are excluded. A photo is changed only if it saves at least 5% and passes
full-resolution SSIM >= .97. Already optimized WebP photos are retained when
re-encoding would not improve that combination.

```
npm ci --ignore-scripts --prefix automation/public-home-performance
node automation/public-home-performance/build-images.mjs ORIGINAL_IMAGES OUTPUT_PATCH
node automation/public-home-performance/verify-images.mjs ORIGINAL_IMAGES OUTPUT_PATCH
```

`ORIGINAL_IMAGES` is an operator-reviewed copy of the active public homepage's
images directory. Output and input directories must be disjoint. Source images
are not committed here; the manifest records their exact SHA-256 values. The
committed `patch/images-manifest.json` records source/output hashes, dimensions,
chosen quality, byte sizes and measured SSIM for each file. Only files with
`changed:true` exist in `patch/images/`.

Do not copy build dependencies into production. A production staging installer
must validate the active source against these hashes, clone the source release,
atomically replace changed files (never write through shared hardlinks), update
the loader's URL version in index.html and switch the current symlink only after
checks. Leave the protected `projects-map.js` and other project data untouched.
The original release remains the rollback target.

## Map gate

The public loader checks the existing session immediately, so guests see their
normal locked map panel. An authorized session does not trigger Yandex or the
protected module until the map approaches the viewport or the visitor explicitly
uses a map anchor/button. It checks authorization again at activation. Both
resource requests have bounded timeouts. A retry after a resource error is an
explicit full page reload; it preserves account cookies and avoids duplicate map
initialization after a late/failed module response.

The login link uses a safe `/?section=map` return path; the loader converts it
back to `#map` while preserving attribution parameters. The auth gateway's
existing prohibition on return-path fragments remains intact.

The real map is initialized once per document. Zooming and resizing do not reload
it. Session expiry/revocation hides the private map and restores a locked panel.
The loader neither changes server authorization nor clears browser caches.

```
# Use the installed matching Playwright browser, or set this to an existing
# Chromium executable to avoid downloading another browser binary.
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome npm test --prefix automation/public-home-performance
```

The synthetic browser cases cover cold authorized/guest states, direct #map,
keyboard navigation, scrolling without IntersectionObserver, revocation before
scroll, expiry after initialization, unavailable auth, resource failure/retry and
bounded SDK timeout. They use synthetic data and no real CRM or map project
module. Production cold/warm performance must be measured separately after the
safe staging/symlink rollout.
