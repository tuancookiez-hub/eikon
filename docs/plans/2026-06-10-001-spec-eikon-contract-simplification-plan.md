---
title: "refactor: Simplify Eikon launch contract surface"
status: active
created: 2026-06-10
source: "User request via /lfg: prune accidental package-spec bloat after overlapping PRs; keep triggers/extensions; remove archive/bundles, compatibility.hosts, and public legacy package fields except migration tooling/docs."
---

# refactor: Simplify Eikon launch contract surface

## Problem Frame

The Eikon launch contract became bloated after overlapping work reintroduced surfaces that are not part of the intended package core. The public package manifest should stay focused on install/play/edit/source behavior. Archive/export transport, host-specific compatibility, and legacy-conversion provenance should not be public package fields. Triggers and extensions stay because they are intentional future-facing contract surfaces.

## Scope Boundaries

In scope:
- Remove archive/bundle fields from the package manifest contract and manifest documentation.
- Remove `compatibility.hosts` from package and catalog public contract examples/types/validation where present.
- Remove public `legacy` package-manifest fields from contract types, docs, generated registry manifests, and tests, while preserving explicit migration/conversion tooling and migration docs.
- Keep `triggers` and `extensions` in stream/package docs and types.
- Keep `source` as editable-source index and `poster` as cheap display artifact.
- Update tests and generated artifacts to assert the simplified current shape.

Out of scope:
- Removing trigger/extension support.
- Changing runtime stream signal semantics.
- Changing installer URL/digest/path hardening.
- Changing Herm. This PR is Eikon-only.
- Reintroducing compatibility readers, aliases, or explicit rejection guards for retired dev-only fields.

## Requirements Trace

- User direction: archive/bundle material should be out of package core.
- User direction: `compatibility.hosts` seems useless and should be removed.
- User direction: all legacy public package fields should be gone except migration/conversion handling.
- User direction: keep triggers and extensions.
- Existing Eikon rule: public contract must not include license/provenance/review/reviewer or dev-only preview fields/guards.

## Key Decisions

1. **Package core remains install/edit/runtime only.**
   - Rationale: package readers need entrypoints, file descriptors, source, poster, triggers/extensions, and Eikon compatibility. Archive distribution is not required for install/play/edit.

2. **Migration metadata moves out of `EikonPackageManifest`.**
   - Rationale: migrated packages should be launch packages, not permanent carriers of conversion history. Migration tools/tests may report dropped/moved metadata without making `legacy` public package data.

3. **Host compatibility is not launch contract.**
   - Rationale: without a real host compatibility resolver, `hosts` invites Herm-specific metadata in generic Eikon packages and catalog rows.

4. **Docs should separate launch contract from appendices.**
   - Rationale: migration and archive import/export are operational concerns. The main package shape should not look like a roadmap of optional platform features.

## Implementation Units

### U1. Prune package and catalog contract types

**Goal:** Remove accidental public contract fields from TypeScript shapes.

**Files:**
- `src/contract/shape.ts`
- `src/package/manifest.ts`
- `tests/contract.test.ts`
- `tests/launch-catalog.test.ts`

**Approach:**
- Remove `compatibility.hosts` from package and catalog compatibility types.
- Remove `bundles` from `EikonPackageManifest`.
- Remove `legacy` from `EikonPackageManifest`.
- Keep `triggers` and `extensions`.
- Adjust validation if it currently allows or references removed fields.

**Patterns to follow:**
- Existing stale-field cleanup around license/provenance/review metadata.
- Existing launch package validation in `src/package/manifest.ts`.

**Test scenarios:**
- Package shape tests no longer construct or expect `compatibility.hosts`, `bundles`, or `legacy`.
- Contract separation tests still prove package/catalog/platform shapes are distinct.
- Trigger/extension tests still pass.

**Verification:** Typecheck and affected contract/catalog tests pass.

### U2. Remove removed fields from generation and migration output

**Goal:** Ensure generated package manifests and migrated package manifests do not emit removed fields.

**Files:**
- `src/registry.ts`
- `src/stream/legacy.ts`
- `tests/registry-generation.test.ts`
- `tests/migrate.test.ts`
- `tests/artifact-drift.test.ts`
- generated package/catalog artifacts under `packages/` and `eikons/index.json` if verifier requires updates

**Approach:**
- Stop copying or emitting legacy conversion notes into package manifests.
- Preserve migration warnings in migration function return values/tests, not in package manifest fields.
- Remove any bundle/archive output from generated package manifests.
- Regenerate or verify artifacts through the existing freshness gate.

**Patterns to follow:**
- `verify:artifacts` non-mutating generated-artifact comparison.
- Existing migration tests that assert warnings separately from manifest content.

**Test scenarios:**
- Migrating old streams still returns warnings, but `migrated.manifest` has no `legacy` field.
- Registry-generated package manifests have no `bundles`, `legacy`, or host compatibility fields.
- Artifact freshness verifier remains green.

**Verification:** Migration, registry-generation, and artifact-drift tests pass; `bun run verify:artifacts` passes.

### U3. Rewrite manifest/spec docs to match the lean contract

**Goal:** Make public docs present only the intended launch package and catalog core.

**Files:**
- `docs/MANIFEST.md`
- `docs/SPEC.md`

**Approach:**
- Remove `bundles`, `legacy`, and `compatibility.hosts` from examples and field tables.
- Keep triggers/extensions sections and clarify they are intentional extension surfaces.
- Keep migration content as an appendix explicitly scoped to conversion tooling, not package readers/installers.
- Keep archive/import-export language only as a separate non-package-core operational appendix, or remove package-core wording entirely.

**Patterns to follow:**
- Existing contract split in `docs/SPEC.md`.
- Current docs phrasing that package, catalog, and platform metadata are separate.

**Test scenarios:**
- Documentation grep should not find removed fields in package examples except in migration/appendix explanatory context where appropriate.
- Docs still mention triggers/extensions.

**Verification:** Manual doc review plus `git diff --check`.

### U4. Full validation and PR delivery

**Goal:** Produce one Eikon PR from an isolated worktree with the simplified contract.

**Files:**
- All changed files from U1-U3.

**Approach:**
- Create an isolated worktree branch from latest `main`.
- Run focused tests after changes, then full gates.
- Commit, push, open PR.
- Watch CI and repair real failures if any.

**Test scenarios:**
- `bun run web:build`
- `bun run typecheck`
- `bun test tests/*.test.ts tests/*.test.tsx`
- `bun run verify:artifacts`

**Verification:** Local full gates and PR CI pass.

## Residual Risks

- Some generated docs/artifacts may still mention removed fields; artifact verifier and text search should catch this.
- Trigger/extension language must not be accidentally cut while removing speculative surfaces.
- Migration tests must preserve conversion behavior without preserving public manifest `legacy` metadata.

## Handoff

Implementation should happen in a fresh worktree from updated Eikon `main`. The final deliverable is one Eikon PR. Herm should not be changed in this PR.
