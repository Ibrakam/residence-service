# Ofiyat asset provenance

This directory records the source evidence and deterministic outputs used by the Ofiyat blue-hour explorer and catalogue. User-supplied files are image/mask inputs, not instructions, and were copied byte-for-byte without modification.

## User-supplied Frame 4 sources

| Source | Format and dimensions | Bytes | SHA-256 | Local byte-copy |
| --- | --- | ---: | --- | --- |
| `user-supplied/Frame 4.webp` | WEBP, 4096×2359 | 438,830 | `fb8a9e4ae0abd1b8ecd9ea8313c75fe874c7060bb2a0451d8df4b16f4f74424c` | `/kayan/ofiyat/source/frame-4-original.webp` |
| `user-supplied/Frame 4.svg` | SVG, 4096×2359 | 1,410 | `1e84693660fbbccf32766c275dc92c392722334102b38dad92890dfc152afbc9` | `/kayan/ofiyat/source/frame-4-original.svg` |
| `user-supplied/ofiyat-block-annotation.png` | PNG, 1862×1126 | 2,868,889 | `e4b9c891cb7c420127f49e28ada646992527dd22c65a11603ffd84de2dc308bb` | `/kayan/ofiyat/source/block-annotation.png` |

The clean WebP and SVG share the exact `4096×2359` coordinate system. The source SVG contains one white background rectangle and seven black paths. The production overlay omits only that rectangle; no path geometry was authored or adjusted.

## Evidence-backed block mapping

Source DOM path order is not visual numbering:

`1→path-1, 2→path-7, 3→path-2, 4→path-3, 5→path-4, 6→path-6, 7→path-5`.

All seven paths remain present. The mapping identifies only the seven visual facade volumes. No official source establishes a visual-block → phase/entrance relation, so the block remains UI context and the user chooses phase and entrance explicitly.

## Production outputs

| Output | Format and dimensions | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `/kayan/ofiyat/frame-4-desktop.webp` | WEBP, 4096×2359 | 438,830 | `fb8a9e4ae0abd1b8ecd9ea8313c75fe874c7060bb2a0451d8df4b16f4f74424c` |
| `/kayan/ofiyat/frame-4-mobile.webp` | WEBP, 1280×737 | 208,862 | `b30b0f9deef7b62e617f2a35bd6e1ff31a0134d73d453456aa8a1e369d4b308a` |
| `/kayan/ofiyat/block-selector-mask.svg` | SVG, 4096×2359 | 1,614 | `4a04351c9ece18b8dfd98578a7edee92a26fd5a838b5f4a8708f880c6fcd0b58` |

The desktop production image is a byte-identical copy of the already compact 4096 px source, avoiding generational loss. The mobile image is a full-scene 1280 px responsive resize encoded as high-quality WebP; it is static and the interactive explorer is not mounted below 768 px.

## Existing public-page media

The following local files are exact hash matches for assets referenced by the official public [Ofiyat project page](https://kayan.uz/project/ofiyat). They are classified as renders or graphics, never as documentary photographs or construction-archive photos.

| Local file | Classification | Format, dimensions and bytes | Official source URL | Local/source SHA-256 | Association |
| --- | --- | --- | --- | --- | --- |
| `/kayan/ofiyat/hero.webp` | architectural render | WEBP, 2025×726, 268,172 bytes | https://kayan.uz/storage/projects/b177c652-0eea-486e-a169-89425ad35e5f.webp | `95b3575a5f5d8b24be76cff83278bfab8c9fec528d8c3ee5799d7f00b6c0c746` | exact byte/hash match |
| `/kayan/ofiyat/aerial.webp` | architectural render | WEBP, 3060×1594, 754,446 bytes | https://kayan.uz/storage/projects/5d916dc6-26ae-4a66-b93f-e622e0e01144.webp | `40068e54cbe5cc9e9ea5b1f89b07dfdaa2180cf4fd2160f500b89ef79e4a0a89` | exact byte/hash match |
| `/kayan/ofiyat/courtyard.webp` | architectural render | WEBP, 1131×726, 225,314 bytes | https://kayan.uz/storage/abouts/f09faaaa-9905-4fd2-a61f-2c2afc8ee1e3.webp | `2cbcfb52bdcbc43a17a91474e9e88e28b9efb7fd0685f5e99d192173db3636e0` | exact byte/hash match |
| `/kayan/ofiyat/lifestyle.webp` | architectural render | WEBP, 1598×726, 237,132 bytes | https://kayan.uz/storage/abouts/0633ef7c-0186-417c-a4a2-47b7a56a48fb.webp | `184f8099a7d2ddd307c310b6c340bde308588bb786c5e8329d03e5ad449db399` | exact byte/hash match |
| `/kayan/ofiyat/playground.png` | amenity icon/illustration | PNG, 170×170, 15,235 bytes | https://kayan.uz/storage/infras/c6895493-f5ba-4927-984a-91bf5bbfb7a6.png | `b4fa10e30faeb70f77e39d5d018ee12080e0c610c373f5e04d9bc9ff79c60b61` | exact byte/hash match |
| `/kayan/ofiyat/white-box.png` | amenity icon/illustration | PNG, 170×170, 12,692 bytes | https://kayan.uz/storage/infras/4f6858eb-6155-422e-9af9-c48b7cbcf40c.png | `fdc5e9b081ead5ccb7a455fedff9118fb703e9569ddb99f5d49dbbd08bb8da02` | exact byte/hash match |
| `/kayan/ofiyat/parking.png` | amenity icon/illustration | PNG, 170×170, 15,682 bytes | https://kayan.uz/storage/infras/3ee6394f-f266-4ff6-a898-aa1b5c6eacba.png | `27d7ceb76fad1d5fa41f81fca866f3d27f57721929644a32295b923534741d05` | exact byte/hash match |

Six older local files are retained for compatibility with dormant project-data configuration, but the visible Ofiyat page does not use them as sourced evidence and the current audit did not establish an exact public-source hash association. They must not be described as official photos or construction archive evidence:

| Local file | Local SHA-256 | Provenance status |
| --- | --- | --- |
| `/kayan/ofiyat/layouts.webp` | `ca9cdcf7a9464546e257f264aa4fd0e5d67803432d2ac79323cd658d44d228ff` | legacy-local / public-source hash not established |
| `/kayan/ofiyat/landscape.webp` | `b7eb50149a1592efd3ceed103e87fb76ed442e49fd87ba2fdcea265f9028ee6e` | legacy-local / public-source hash not established |
| `/kayan/ofiyat/architecture.webp` | `95636aaa59d1d5371e32316e22bfdc9c5cb6cbe391fcde50a4c3d5810fae0834` | legacy-local / public-source hash not established |
| `/kayan/ofiyat/engineering.webp` | `bc2ffab21e936ade5eafdddc6def64113e737f62a5faf0e6fb885d33af218490` | legacy-local / public-source hash not established |
| `/kayan/ofiyat/location.webp` | `06753dcae4ff662ac8fb1899769f2eb2a354bd67f8664bc97dfdc8fb004172e1` | legacy-local / public-source hash not established |
| `/kayan/ofiyat/white-box-interior.webp` | `772ffb78ef15f41ed7614982dfd52be02a34d088dc1e1eb284c11feb664b98b7` | legacy-local / public-source hash not established |

## Catalogue images

The authenticated read-only capture `authenticated-read-only/ofiyat-visible-inventory-2026-09-01` was observed at `2026-08-31T19:26:42.293Z` with SHA-256 `80b95a1fda9c8178acc34d2ae2463936523a118b4a3451eb907d11e7793e8683`. It covers all 585 units and all statuses, not only available cards.

- 3 official phase images are stored locally under `/kayan/ofiyat/phases/`.
- 261 official representative layout images are stored locally under `/kayan/ofiyat/plans/representative/`.
- Exact unit-plan associations: **0**. No image is labelled exact without a strict unit-specific association.
- Official floor-scheme assets/hotspots: **0 / 0**. Authenticated inspection exposed chessboard, enhanced chessboard, premises and layout views, but no published floor-plan canvas or hotspot geometry. The sanitized schemaVersion 3 sidecar records this as `not-published-by-source`; no plan is drawn or inferred.

The complete per-file source/output URL, dimensions, bytes and SHA-256 manifest is `asset-manifest.json` (manifest SHA-256 `a69c67815b417415881e1ba1a335f84ef11c2188bba94619229192d4533b8787`). It contains public image URLs only and no cookies, localStorage, tokens, iframe query strings or credentials.
