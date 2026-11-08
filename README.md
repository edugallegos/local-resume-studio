# Local Resume Studio

Local Resume Studio is an independent, local-first resume editor built around a
pinned snapshot of Reactive Resume v6.1.0. It is not an upstream Reactive Resume
fork or deployment: it has no accounts, database server, cloud resume storage,
or server-backed AI. Resume files and PDF exports live in directories you choose
on this computer.

The app keeps the pinned Reactive Resume resume schema and its 18 templates, adds
native Write, Design, and Check workflows, renders PDFs locally in the browser,
and archives downloads through a loopback-only API.

## Requirements

- Node.js 24.x
- pnpm 12.16.1 (`packageManager` is pinned in `package.json`)
- A modern browser with WebAssembly support

## Quick start

```bash
pnpm install
pnpm dev
```

The development app uses loopback only:

- UI: <http://127.0.0.1:3100>
- API: <http://127.0.0.1:3101>

For a built local app:

```bash
pnpm build
pnpm start
```

`pnpm start` serves the built UI and API at <http://127.0.0.1:3100>.

`pnpm dev` accepts explicit ports when the defaults are occupied:

```bash
pnpm dev --ui-port 3300 --api-port 3301
```

The UI and API ports must differ.

## Local data

By default:

- Resume JSON: `data/resumes/`
- Archived PDF exports: `data/exports/`

Set `RESUME_DATA_DIR` to move the common parent:

```bash
RESUME_DATA_DIR=/path/to/local-resume-data pnpm dev
```

Resume files are standard Reactive Resume v6.1.0 JSON objects. Local imports and
exports are the app's only resume persistence mechanism. Unknown extension
properties in imported JSON are preserved when the native editor saves.

## Workflow

### Write

Edit basics, summary, profiles, experience, education, projects, skills,
languages, and certifications. The editor keeps unsaved changes in memory until
you choose **Save changes**. Imported HTML is previewed with a formatting-only
allowlist while the saved JSON remains unchanged.

### Design

Choose among all 18 pinned templates, configure body/heading font pairings,
density, entry layout, page size, margins, text size, accent color, and section
order/visibility. Design changes use the same in-memory draft and explicit save
flow.

### Check

Run the deterministic local ATS score, inspect categorized issues, compare a
pasted job description, and explicitly analyze the locally generated PDF. Check
issues can open the relevant Write field or highlight the matching region in the
PDF preview. There is no remote or AI-backed Check service.

### PDF preview, download, and archive

The live preview is rendered from the same PDF Blob used for download. Choosing
**Download PDF** posts those local bytes to `POST /api/resumes/:id/exports`; the
server archives a copy under the data root's `exports/` directory and the browser
downloads the same bytes.

### JSON import and export

Use **Import JSON** in the library to import a standard v6.1.0 resume object.
Use **Export selected JSON** to download the active draft as standard JSON. No
application-specific wrapper is added.

## Command-line resume tools

List local resume JSON files:

```bash
pnpm resume:list
```

Validate one standard resume file with the pinned v6.1.0 parser:

```bash
pnpm resume:validate -- data/resumes/example.json
```

A missing `resumes/` directory is an empty listing. Validation never modifies
the file. Set `RESUME_DATA_DIR` to change the default listing root.

## Codex and local AI-assisted editing

Codex CLI or the Codex app can inspect and edit the requested local resume JSON
directly. Use `AGENTS.md` as the operating contract: preserve unknown fields and
the standard v6.1.0 shape, avoid committing personal data, and validate after
editing.

This repository includes the `local-resume-json-editor` skill in
`.agents/skills/local-resume-json-editor/`. When you open this repository in
Codex, start a new session and invoke it with `$local-resume-json-editor` to
edit the selected JSON directly and use the app only for a read-only PDF
preview. Codex discovers project skills from `.agents/skills/`; a user-level
installation can be made from the public GitHub repository with:

```bash
gh skill install <owner>/<repository> local-resume-json-editor --agent codex --scope user
```

The user-level install makes the skill available across projects. See the
[Codex skill installation guide](https://developers.openai.com/api/reference/cli#use-the-cli-from-a-coding-agent)
for local-checkout and other agent options.

Typical loop:

```bash
RESUME_DATA_DIR=/path/to/local-resume-data pnpm resume:list
RESUME_DATA_DIR=/path/to/local-resume-data pnpm resume:validate -- /path/to/local-resume-data/resumes/example.json
```

Then edit only the requested file, validate again, and the open editor refreshes
its preview automatically when it has no unsaved draft. See
[External edits and hot reload](#external-edits-and-hot-reload).

## External edits and hot reload

While an editor is open, the UI subscribes to a same-origin local event stream
for that resume only. The server watches the local `resumes/` directory with
Node built-ins, re-reads the file after atomic saves, and sends only the resume
ID and content ETag. Resume content and filesystem paths never travel through
the notification.

When the file changes externally and the editor has no unsaved draft, the app
re-reads the latest valid JSON, advances the active ETag, clears stale PDF
state, and lets the existing preview renderer redraw automatically. No page
reload is needed.

When the editor has an unsaved draft, nothing is replaced or saved
automatically. The existing conflict choices appear instead:

- **Reload from disk** replaces the draft only after that click.
- **Keep editing** preserves the draft and performs no retry or write.

Watcher events caused by the app's own save are ignored while the save is in
flight and are de-duplicated by ETag after it completes. Representation
conflicts still use `If-Match` and keep the original ETag protection.

## Save conflicts and ETags

The loopback API enforces `If-Match` with a content ETag. If the JSON file changes
on disk while an unsaved draft is open, saving reports a conflict and keeps the
draft. The UI offers explicit choices:

- **Reload from disk** replaces the draft with the on-disk document only after
  that click.
- **Keep editing** preserves the draft and performs no automatic retry or write.

Later saves still use the original ETag, so the server protects the file. Nothing
is silently merged or overwritten.

## Fonts and network behavior

The PDF renderer may request font files from its configured font provider when a
resume is first rendered. The vendored catalog points primarily to Google Fonts
(including its gstatic mirror) and also to CDN-hosted catalog fonts such as
Computer Modern. These are requests for font resources. Resume contents are not
sent in font requests.

This app does **not** claim zero network traffic. Font availability and network
access can vary. If a font cannot be downloaded, the local preview and export use
Forme's built-in fallback so the editor remains usable, and the app reports the
missing font and any characters that could not be drawn.

The app has no accounts, no cloud resume storage, and no server-backed AI.

## Compatibility baseline

- Reactive Resume version: v6.1.0
- Upstream commit: `77f5580a67d1e4379978e80410e0cd02ea3fd446`
- Templates: all 18 pinned template IDs
- Resume format: standard Reactive Resume v6.1.0 JSON

The pinned source snapshot lives under `vendor/reactive-resume/`. See
`vendor/reactive-resume/UPSTREAM.md` for copied paths, local changes, and future
vendor-update review steps.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
```

Playwright E2E tests use a fresh temporary `RESUME_DATA_DIR`, free loopback ports,
headless Chromium, and synthetic data only.

## Contributing

See `CONTRIBUTING.md` for scope, verification, vendor-update, and test-fixture
rules. Do not submit personal resumes, generated PDFs, secrets, or real personal
data.

## License and third-party notices

Original Local Resume Studio code is MIT licensed; see `LICENSE`. Vendored
Reactive Resume code retains its upstream MIT license at
`vendor/reactive-resume/LICENSE`. Runtime dependency, font, and test-fixture
attributions are recorded in `THIRD_PARTY_NOTICES.md`.
