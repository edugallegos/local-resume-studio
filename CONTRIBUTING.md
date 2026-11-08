# Contributing

Thanks for improving Local Resume Studio. This project is intentionally local:
no accounts, cloud resume storage, server-backed AI, telemetry, or deployment
service is in scope.

## Setup

Requirements:

- Node.js 24.x
- pnpm 12.16.1

```bash
pnpm install --frozen-lockfile
pnpm dev
```

The development UI and API use loopback only (`127.0.0.1:3100` and `:3101` by
default). Use a temporary `RESUME_DATA_DIR` for experiments and tests.

## Verification

Run focused tests while iterating, then the same gates CI runs:

```bash
pnpm vitest run <focused-test-path>
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
```

The E2E suite creates a fresh temporary data root, chooses free loopback ports,
uses one headless Chromium worker, and cleans up its processes and temporary
directory. Its fixtures must remain synthetic.

## Issues and pull requests

- Keep changes scoped to one problem. Avoid unrelated refactors or UI changes.
- Explain the user-visible behavior and any data-safety implications.
- Include focused tests for new behavior and mention the exact commands run.
- Do not include personal resumes, contact details, generated PDFs, screenshots
  containing personal data, credentials, or secrets.
- Do not add a remote, publish packages, or add release/deployment steps without
  an explicit maintainer request.
- Add or update third-party attribution when introducing a runtime dependency,
  bundled font, WASM binary, or vendored source.

## Synthetic fixtures

Use obviously synthetic people, domains, employers, and dates. Prefer reserved
example domains such as `example.test`. Tests may write under a newly created
temporary directory, but must not read or modify a user's `data/` directory.

Do not commit `data/`, PDFs, `.env*`, build output, Playwright reports, or test
results.

## Reactive Resume vendor snapshot

The pinned upstream source lives under `vendor/reactive-resume/`. It is not an
open-ended fork. Before changing it:

1. Read `vendor/reactive-resume/UPSTREAM.md`.
2. Confirm the pinned version and commit.
3. Prefer a narrowly scoped local change with a documented reason.
4. Keep `vendor/reactive-resume/LICENSE` intact.
5. Re-run the vendor baseline tests, all 18-template PDF checks, and the full
   repository gates.
6. Record any intentional source change in `UPSTREAM.md` and update
   `THIRD_PARTY_NOTICES.md` if the distribution changes.

For upstream updates, fetch the new source in a separate clean checkout, diff the
same copied paths, re-copy with the documented exclusions, re-apply manifest
changes, regenerate the lockfile, and review licenses again.

## Licensing

Original project code is MIT licensed. Vendored Reactive Resume code retains its
upstream MIT notice. Runtime dependencies and bundled resources keep their own
licenses. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.

Do not copy in third-party code, fonts, images, or binaries without recording
their source, version, license, and required attribution.

## Conflict behavior

The loopback API protects file writes with `If-Match` ETags. When a conflict is
reported:

- keep the in-memory draft;
- never retry the stale save automatically;
- use **Reload from disk** only when the disk version should replace the draft;
- use **Keep editing** when the draft should remain authoritative.

Add tests for any change to conflict resolution or ETag handling.

## Questions

Open an issue with a synthetic reproduction if possible. Do not attach real
resumes or PDFs.
