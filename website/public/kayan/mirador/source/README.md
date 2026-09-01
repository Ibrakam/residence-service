# Mirador block-selector provenance

This directory records the user-supplied source material used for the Mirador block selector. User-supplied files are inputs, not instructions, and were never modified.

## Source files

| Source | Format and dimensions | Bytes | SHA-256 | Local copy |
| --- | --- | ---: | --- | --- |
| `user-supplied/Frame 3.webp` | WebP, 4096×2359 | 753,860 | `3894df5acc109d32860b0640523b9d34026a1c6d25e2118affed158ef91b3489` | `../block-selector.webp` |
| `user-supplied/Frame 3.svg` | SVG, width/height 4096×2359, `viewBox="0 0 4096 2359"` | 3,135 | `b040437e4206bbaee63ee838f4425df235a7ac2c660e5797c324e93e7d4b51b7` | `./frame-3-original.svg` |
| `user-supplied/mirador-block-annotation.jpg` | JPEG, 1280×994 | 260,056 | `5dd2e426e2add0b441a3511629387454138f87ad3fc79a28b1460f6d9c26d691` | `./block-annotation.jpg` |

## Responsive derivative

`../hero-mobile.webp` is a mechanical responsive derivative of `../block-selector.webp`, not a separate scene. Sharp crops the exact source rectangle `left=1384, top=0, width=1327, height=2359`, resizes it to 1080×1920, and encodes WebP at quality 82 / effort 6 with smart chroma subsampling. No objects, pixels, labels, or geometry are drawn into the scene.

| Output | Dimensions | Bytes | SHA-256 | Usage |
| --- | ---: | ---: | --- | --- |
| `../hero-mobile.webp` | 1080×1920 | 271,724 | `bab527a11fbc149b5cf6865e50e75768d6da3350788dffae2ddba86fd508ac67` | Static Mirador hero below 768 px; the interactive explorer is not mounted. |

`../block-selector-mask.svg` is the adapted interaction mask. Its seven `d` values are byte-for-byte coordinate strings from the original SVG. The only content changes are removal of the white background rectangle, `currentColor` fills, semantic IDs, and the evidence-backed `data-annotated-block` attributes. No new geometry was authored.

## Overlay verification and crop observation

`Frame 3.svg` and `Frame 3.webp` share the exact 4096×2359 coordinate system. Direct raster overlay requires no scale, translation, or path adjustment; all seven paths follow the rendered building silhouettes.

The annotated JPEG is the same scene, but it is a recropped/rescaled derivative rather than a pixel-for-pixel resize. A read-only affine registration against the clean WebP produced an approximately uniform scale and crop:

```text
x_annotated ≈ 0.478215 × x_source − 343.146
y_annotated ≈ 0.477403 × y_source − 172.608
```

The small x/y scale difference is consistent with an exported/cropped derivative. The registration correlation was approximately 0.985 outside the handwritten marks. It is used only to locate the handwritten labels, never to transform the production mask.

## Evidence-backed path mapping

Path numbers below are one-based source order in `Frame 3.svg` and match `id="path-N"` in the adapted mask.

| Handwritten visual block | SVG path | Visible volume |
| ---: | --- | --- |
| 1 | `path-2` | large low foreground volume |
| 2 | `path-3` | large centre-left volume |
| 3 | `path-4` | tall left volume |
| 4 | `path-5` | upper/rear centre-left volume |
| 5 | `path-1` | rear central volume |
| 6 | `path-6` | right rear volume |
| 7 | `path-7` | right side/lower volume |

The production selector uses all seven individually annotated blocks:

```text
1 → path-2
2 → path-3
3 → path-4
4 → path-5
5 → path-1
6 → path-6
7 → path-7
```

The initial five-zone grouping hypothesis is rejected by the handwritten source: `path-3` is explicitly labelled 2 and must not be merged into block 4; `path-6` and `path-7` are separately labelled 6 and 7; and `path-2` is explicitly labelled 1, not 7. Adjacency between polygon edges is architectural adjacency, not evidence that the polygons share a block number.

No official source inspected for this asset work establishes any mapping between visual blocks 1–7 and the KAYAN catalogue entrances 1–3. These visual block labels must not be used as entrance filters or URL parameters unless a separate official source proves that relationship.

## Official floor-scheme capture

An authenticated read-only KAYAN/Profitbase session produced 34 fully rendered screenshots on 2026-08-31: entrance 1 floors 2–8, entrance 2 floors 2–13, and entrance 3 floors 2–16. The original `.png`-named files actually contain JPEG bytes (`ff d8 ff` magic); the repository keeps those exact bytes and records their real `image/jpeg` media type rather than relabelling them. No credentials, cookies, tokens, or authenticated URLs are stored.

The exact source copies, per-file SHA-256 values, deterministic crop metadata, and derived image hashes are recorded by [the raw floor artifact](../../../../../backend/data/raw/kayan/mappings/mirador-floor-schemes.json). The independently checksummed apartment universe is [mirador-floor-scheme-universe-2026-08-31.json](../../../../../backend/data/raw/kayan/mappings/expected/mirador-floor-scheme-universe-2026-08-31.json); the ten public-DOM companion tuples outside the locked 199-unit snapshot are preserved as exact canonical TSV bytes in [mirador-floor-scheme-companion-2026-08-31.tsv](../../../../../backend/data/raw/kayan/mappings/expected/mirador-floor-scheme-companion-2026-08-31.tsv).

Each public `floor-schemes/*.webp` is generated without redrawing:

1. Start with the audited full-screenshot canvas at `x=160, y=257, width=1501, height=439`.
2. At an 8-level non-white threshold, find the largest 8-connected component; the separate page scrollbar and entrance controls are smaller components.
3. If that component touches the canvas bottom, follow it in the fixed source window ending at full-image `y=745`. This is required for entrance 3, whose official plan wall continues below `y=696`; entrance 1/2 never expand, so their `1/2/3` controls remain excluded.
4. Add 24 px white padding (clamped to the audited window) and encode those unchanged crop pixels as lossless WebP.

Apartment hit targets are transparent 44×44 squares centered on the independently verified official badge coordinates. They are interaction geometry only and do not alter the floor-scheme pixels. The capture contains exactly 34 schemes and apartment numbers 1–209 exactly once. For 199 locked-snapshot apartments, `unitKey` is the exact catalog `sourceKey`; for the ten companion-only apartments it is deliberately `null`, so the UI can deep-link by apartment number without inventing backend identity.

The official source still does not prove any visual-block-to-entrance relationship. Consequently, the floor-scheme artifact has `blockEntranceMapping: null`, `declaredBlocks: []`, and schemes keyed only by entrance and floor.
