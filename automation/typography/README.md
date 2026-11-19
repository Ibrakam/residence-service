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
