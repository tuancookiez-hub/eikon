# Supabase Registry

Eikon's hosted marketplace uses Supabase for mutable platform state and
artifact serving while keeping the launch contract split intact:

- `.eikon` runtime streams remain standalone playback artifacts.
- `eikon.package` manifests remain immutable install/source metadata.
- catalog entries remain cheap public discovery rows.
- Supabase owns auth, uploads, authorship, likes, shares, downloads, delist
  audit, and GitHub mirror state.

## Local ports

This repo uses an isolated Supabase port range so it can run beside other
local Supabase projects:

- API / functions: `http://127.0.0.1:55321`
- Postgres: `127.0.0.1:55322`
- Studio: `http://127.0.0.1:55323`
- Mailpit/Inbucket: `http://127.0.0.1:55324`

## Local setup

```sh
supabase start
supabase db reset --local
supabase db lint --local --fail-on error
supabase test db supabase/tests/database --local
supabase functions serve --no-verify-jwt
```

In another shell, mirror checked-in GitHub/static registry artifacts into the
local Supabase registry:

```sh
bun scripts/supabase-import-github.ts
```

Smoke the full local platform path:

```sh
bun scripts/supabase-smoke.ts
```

The smoke imports the current static registry, fetches catalog/package/runtime
artifacts through the Edge registry function, records a download event, creates a
local Auth user, likes an entry, publishes a generated Eikon through the
publish/finalize function, and delists it.

## Public read API

The registry Edge Function serves the same shapes existing clients already use:

```text
GET /functions/v1/registry/eikons/index.json
GET /functions/v1/registry/packages/<namespace>/<name>/index.json
GET /functions/v1/registry/packages/<namespace>/<name>/<version>.json
GET /functions/v1/registry/packages/<namespace>/<name>/blobs/sha256/<digest>
GET /functions/v1/registry/platform?ids=<sourceKey>,...
```

Set `EIKON_REGISTRY_PUBLIC_URL` in deployed functions when the public path is
proxied through `https://eikon.liftaris.dev`. Local development defaults to
`http://127.0.0.1:55321/functions/v1/registry`.

Digest-addressed runtime blobs are returned as raw stored bytes. Do not set
HTTP `Content-Encoding: gzip` on gzip-stored `.eikon` blobs; clients verify
stored-byte `size`/`digest` before decoding.

## Write APIs

```text
POST /functions/v1/publish/init
POST /functions/v1/publish/finalize
POST /functions/v1/events/download
POST /functions/v1/events/share
POST /functions/v1/likes/<sourceKey-or-id>
POST /functions/v1/delist/<sourceKey-or-id>
```

Uploads require Supabase Auth and publish immutable package artifacts into the
private `eikon-artifacts` bucket. Browser uploads use prepared package files;
CLI/agent flows may use `previewSubmitBundle` and `supabaseSubmitBackend`.

Delist requires package ownership or a verified GitHub provider identity matching
the imported original submitter. User-editable profile text is not enough.
Delisted packages disappear from the active catalog and direct package/blob
reads return the configured non-active status.

## Production gate

Do not switch production `/eikons/**` or `/packages/**` from checked-in static
artifacts to Supabase-backed functions until preview/production smoke proves:

- `/eikons/index.json` returns valid catalog entries
- package manifests are installable by Eikon/Herm
- runtime blobs preserve byte identity and omit `Content-Encoding`
- CORS/cache/security headers are correct
- Auth redirect URLs are configured
- delist hides catalog rows and direct package/blob URLs as intended
- Herm marketplace consumer proof has passed

Only public Vite variables belong in Vercel browser env:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

Service role keys, database URLs, JWT secrets, GitHub tokens, and Supabase secret
keys belong only in Supabase Edge Function secrets or local untracked files.
