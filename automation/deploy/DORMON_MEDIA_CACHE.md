# Do‘rmon photo delivery

The dedicated image regex must precede the general residence-project regex.
It permits browser storage with `private, no-cache, must-revalidate` only for
WebP/AVIF files in Do‘rmon's editorial, facades, media and showroom directories.
Pages, JSON, live plan endpoints and the shared authentication snippets retain
`private, no-store`.

Every request, including `If-None-Match`, runs `auth_request` before the content
handler. Vinext returns a bodyless 304 for unchanged, authorized files. Missing
or invalid sessions use the existing JSON401 handler with `private, no-store`.
No rewrite-phase conditional return, shared proxy cache, public caching, or
freshness TTL is permitted for these images. A browser must revalidate each
reuse; a cached file cannot satisfy a new unauthenticated request.

Install the configurator and its three `nginx/` files together, then run
`python3 configure-dormon-media-cache.py` as root. It backs up exact previous
files under `/root/tencorp-dormon-media-backups/`, validates Nginx and reloads.
Failure restores those files. To revert later, restore numbered files using
the saved `paths.json`, remove snippets absent from the backup, validate and
reload Nginx. Existing application releases are not changed by this step.

Run `smoke-dormon-media-cache.py` on the server to verify 200→304, conditional
HEAD, a mismatched validator→200, and missing/invalid sessions→401. The private
deployment fixture stays in server memory and is never revoked by this test.
The existing auth suite covers session revocation. A browser check should also
remove its cookie and prove that its stored image revalidates and receives401.

Do not include the shared API protection snippet and append a second cache
header: that creates conflicting `no-store`/`no-cache` policies. Do not weaken
shared page, catalogue, or framework-asset policies to speed up media.
