# Contributing Eikons

Official v1 listing is a GitHub PR contribution to this registry. There is no hosted marketplace account, upload token, browser dashboard, or moderation workflow in this path.

## Preferred path

Use Herm's Eikon Library/Studio Share flow or the `eikon publish` CLI. These paths prepare a generated registry bundle and open a normal GitHub PR.

```sh
eikon publish path/to/name.eikon
```

## Manual path

If you prepare a PR manually, put the source Eikon under `eikons/<name>/` and run the registry generators before opening the PR:

```sh
bun src/cli.tsx lint eikons/<name>/<name>.eikon
bun src/cli.tsx manifest --gzip
bun src/cli.tsx index
bun run verify:artifacts
```

Commit all generated artifacts:

```text
eikons/<name>/<name>.eikon
eikons/<name>/manifest.json
eikons/<name>/<source files, if applicable>
eikons/index.json
packages/liftaris/<name>/1.0.0.json
packages/liftaris/<name>/index.json
packages/liftaris/<name>/blobs/sha256/*
```

Do not hand-edit `eikons/index.json` as the source of truth. The generator derives catalog posters, runtime/package URLs, descriptor sizes, and digests from the Eikon and package files. Submit PRs must not remove existing catalog entries; use the delist flow for removals.

## Source files

Editable source media is optional but recommended when the Eikon should be editable in Studio. If source files are included, reference them from `eikons/<name>/manifest.json` so the generator can add `source.base`, `source.states`, and descriptor entries to the package manifest.

## Safety

Do not include secrets, credentials, private URLs, localhost URLs, local absolute paths, or token-shaped strings in manifests, runtime headers, source text files, or PR descriptions. Hidden files and secret-like extras are skipped by the submit helper by default.
