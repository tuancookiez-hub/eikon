## Eikon submission

If this PR submits or updates an Eikon, complete this checklist.

### Source

- [ ] This PR adds or updates exactly one Eikon: `<name>`
- [ ] Editable source media is included when the Eikon should be editable in Studio
- [ ] The bundle contains no secrets, private URLs, local paths, or token-shaped strings

### Generated registry artifacts

Run before opening or updating the PR:

```sh
bun src/cli.tsx lint eikons/<name>/<name>.eikon
bun src/cli.tsx manifest --gzip
EIKON_REGISTRY=1 bun src/cli.tsx index
bun run verify:artifacts
```

Commit the generated files:

- [ ] `eikons/<name>/<name>.eikon`
- [ ] `eikons/<name>/manifest.json`
- [ ] `eikons/<name>/` source files, if applicable
- [ ] `eikons/index.json`
- [ ] `packages/liftaris/<name>/1.0.0.json`
- [ ] `packages/liftaris/<name>/index.json`
- [ ] `packages/liftaris/<name>/blobs/sha256/*`

### Do not

- [ ] Do not hand-edit `eikons/index.json` except by committing generator output
- [ ] Do not remove existing catalog entries in a submit PR; use the delist flow
- [ ] Do not add hosted upload/account/dashboard metadata to runtime, package, or catalog files

## Verification

- [ ] `bun test`
- [ ] `bun run typecheck`
- [ ] `bun run verify:artifacts`
