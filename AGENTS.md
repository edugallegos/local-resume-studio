# AGENTS.md

Instructions for Codex CLI/App and other local coding agents working in Local
Resume Studio.

## Scope

- Edit only the local resume JSON file the user explicitly names. Do not scan,
  rewrite, or export unrelated resumes.
- Treat files under `data/` or `RESUME_DATA_DIR` as user data. Never copy personal
  resumes, contact details, PDFs, or secrets into source, fixtures, tests,
  screenshots, issues, or commit messages.
- Preserve the standard Reactive Resume v6.1.0 JSON shape. Keep unknown fields,
  including synthetic `x-...` extension properties, unless the user explicitly
  asks to remove them.
- Do not invent schema fields or migrate a file to a different format.

## Safe local workflow

List the resume files visible to the local app:

```bash
RESUME_DATA_DIR=/path/to/local-resume-data pnpm resume:list
```

Inspect and edit only the requested file. After editing, validate it with the
pinned parser:

```bash
RESUME_DATA_DIR=/path/to/local-resume-data pnpm resume:validate -- /path/to/local-resume-data/resumes/example.json
```

Validation is read-only. If it reports a schema or JSON error, fix only the
reported path and validate again.

Use synthetic data in tests and examples. Do not include real names, emails,
phone numbers, addresses, employer-confidential details, or personal PDFs.

## Save conflicts and ETags

The app uses content ETags and sends `If-Match` on saves. A conflict means the
file changed on disk after the draft was opened.

- Ask for **Reload from disk** only when the on-disk version should replace the
  in-memory draft.
- Choose **Keep editing** when the user's draft should remain authoritative. It
  performs no automatic retry or write.
- Never silently advance the ETag, auto-merge documents, or retry a stale save.
- After reload, re-read or re-inspect the file before further edits.

## Development rules

- Keep changes scoped to the requested task. Do not add accounts, telemetry,
  cloud storage, remote AI, or application tracking.
- Use synthetic fixtures and temporary data roots in automated tests.
- Run focused tests while iterating, then the repository gates:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
```

- Do not commit staged or generated data. Do not add a remote, publish packages,
  or deploy unless the user explicitly requests it.
- Preserve `vendor/reactive-resume/LICENSE` and third-party notices. Review
  `vendor/reactive-resume/UPSTREAM.md` before changing pinned vendor code.

## Practical examples

Validate before and after a small content edit:

```bash
pnpm resume:validate -- data/resumes/example.json
# Edit only the named JSON file.
pnpm resume:validate -- data/resumes/example.json
```

Use a separate temporary data root for experiments:

```bash
RESUME_DATA_DIR="$(mktemp -d)" pnpm dev
```

Do not run the app pointed at a personal `data/` directory for tests or
screenshots.
