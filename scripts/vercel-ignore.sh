#!/usr/bin/env bash
set -euo pipefail

base="${VERCEL_GIT_PREVIOUS_SHA:-}"
head="${VERCEL_GIT_COMMIT_SHA:-HEAD}"

if [[ -z "$base" ]] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  base="HEAD^"
fi

# Build on first deploys or shallow histories where no parent commit is available.
git cat-file -e "$base^{commit}" 2>/dev/null || exit 1

# Vercel skips the build when this command exits 0. `git diff --quiet`
# exits 0 only when no website-affecting paths changed; it exits 1 when
# the preview should be built.
git diff --quiet "$base" "$head" -- \
  vercel.json \
  vite.config.ts \
  tsconfig.web.json \
  package.json \
  bun.lock \
  .env.example \
  supabase \
  eikons \
  packages \
  scripts/web-static.ts \
  scripts/supabase-import-github.ts \
  scripts/supabase-smoke.ts \
  src/web \
  src/registry/supabase \
  src/edge.ts \
  src/browser.ts \
  src/catalog.ts \
  src/contract \
  src/package \
  src/stream \
  src/ui/eikon.ts \
  src/ui/spec.ts \
  src/url-policy.ts
