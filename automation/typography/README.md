# Shared marketing typography

Montserrat headings and Helvetica Neue copy for the existing TenCorp marketing
frontends. Do‘rmon Hills is excluded at Nginx and in the stylesheet. Dashboard,
analytics and authentication pages are outside this change.

Assets are served locally, with no runtime request to a font provider. Montserrat
is the official variable font from google/fonts (OFL included). Helvetica Neue
files are from the exact font.download family requested by the site owner;
their copyright metadata is retained. That source labels the font personal use;
commercial web licensing remains the site owner's responsibility.

`configure-nginx.py` combines the stylesheet with the existing lead-security
injection, preserving that script and all auth/rate-limit configuration. This
layer supports static pages, Next and Vinext without rebuilding or publishing
unrelated Do‘rmon changes. Reapply it if another deploy regenerates Nginx.

Deployment: copy this directory to `/opt/tencorp-typography`, copy
`site-fonts.css` into `assets/site-fonts.css`, ensure public directories/files are
0755/0644 and run `python3 /opt/tencorp-typography/configure-nginx.py`.
Never edit an already cached asset version: bump the version in the CSS,
configurator and asset URL together for subsequent typography releases.

The configurator saves previous files and a path manifest under
`/root/tencorp-typography-backups/<timestamp>/`. To roll back, restore numbered
files to the corresponding paths (remove paths absent from that backup),
validate `nginx -t`, then reload Nginx. Application releases do not change.

Verification must cover computed font families after fonts load, mobile and
desktop heading bounds, catalogue pages, public homepage fonts, guard injection,
and unchanged Do‘rmon font metrics/release hashes. No lead needs to be submitted.

## Version 20261122-1: common-language font downloads

Run `build-common-fonts.py` in a temporary Python environment with
`font-tools-requirements.txt`. It builds common RU/UZ/EN subsets with original
metrics, outlines, hinting and variable-axis coordinates preserved. Complete
original files remain as non-overlapping Unicode fallbacks; italic keeps its
original file. `test-common-fonts.mjs` verifies real browser matching, kerning
metrics and fallback loading. No typeface or layout tokens are changed.

The immutable release is under `releases/20261122-1/`: upload that directory,
`configure-nginx.py` and `verify-production.py` to their matching paths beneath
`/opt/tencorp-typography`. Run the verifier with `--capture-before`, run the
configurator, then run the verifier without arguments. The verifier snapshots
Do‘rmon at the start of this specific operation, not an older application
release. Deploy any independent Do‘rmon application changes afterward.

The configurator retains `/site-typography/20261119-1/` with unchanged files,
adds `/site-typography/20261122-1/`, and updates the HTML stylesheet URL. It never
overwrites the old immutable CSS/fonts. Missing assets use `no-store`. Existing
browser sessions/cookies and shared-cache authentication rules remain intact.
No `Clear-Site-Data` header, storage wipe or global cache purge is used.
