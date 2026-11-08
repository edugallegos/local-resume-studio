# Reactive Resume vendor snapshot

This directory contains a curated, read-mostly snapshot of Reactive Resume source used by Local Resume Studio. It is
vendored so the studio app can build and test without the original monorepo checkout, its database, its server, or its
cloud services.

## Pinned source

- Project: Reactive Resume
- Source URL: https://github.com/reactive-resume/reactive-resume
- Version: v6.1.0
- Commit: `77f5580a67d1e4379978e80410e0cd02ea3fd446`
- Snapshot date: 2026-11-07
- License: MIT; the upstream notice is copied verbatim to [`LICENSE`](./LICENSE).

## Copied paths

Source paths are relative to the pinned checkout. Test files, test-only fixtures, and the directories listed under
"Deliberate exclusions" were not copied.

- `packages/schema/src/**` — resume data schemas/defaults, dates, limits, stylesheets, templates, cover-letter schema,
  icons, career fact types, and the minimal application status schema that `career.ts` imports.
- `packages/resume/src/ats/**`, `packages/resume/src/ats-pdf/**`, `packages/resume/src/markdown.ts`,
  `packages/resume/src/export-sections.ts`, `packages/resume/src/proposals.ts`, and the required
  `packages/resume/src/stylesheet/**` modules — ATS lint, PDF ATS analysis/job matching/PDF harvesting, Markdown export,
  proposal helpers used by the PDF page map, and semantic stylesheet support used by the PDF renderer. The three
  declaration files (`ats-pdf/jd/wink-porter2-stemmer.d.ts`, `stylesheet/css-tree.d.ts`, and
  `stylesheet/specificity.d.ts`) are retained because retained runtime files reference them.
- `packages/fonts/src/**` — font catalog, standard fonts, script fallbacks, and `webfontlist.json`.
- `packages/pdf/src/**` — Forme renderer adapter, browser entry point, semantic tree, page map, rich-text handling, and
  all 18 resume templates. The `.wasm?url` and package `#react-pdf-renderer` import declarations are included. The PDF
  package's server, React Native, and HTML web-page adapters were not copied.
- `packages/utils/src/**` — only the utilities imported by the copied schema, resume, and PDF code: color, link,
  locale, region, string, style, timezone, and the region-zone data used by the region schema.
- `packages/ui/src/components/{badge,button,icon,separator,spinner}.tsx` — the only UI primitives used by the Task 1 app
  shell. `button` pulls in `spinner` and `icon`.
- `apps/web/public/templates/jpg/*.jpg` — the 18 template-picker thumbnails.
- `LICENSE` — upstream MIT notice, copied unchanged.

## Deliberate exclusions

- `apps/server`, `apps/web`, and `apps/mobile`.
- Auth, database, API, AI, email, import, DOCX, ODT, MCP, Cloudflare plugin, and native Forme packages.
- Application-tracking features, services, routes, UI, and storage.
- All `*.test.*`, `*.spec.*`, `__fixtures__`, `test/`, and `fixtures/` files, plus the test-only source files
  `resume/src/ats-pdf/test-fixtures.ts`, `pdf/src/semantic/all-templates-fixture.ts`, and `pdf/src/forme/testing.ts`.
- Unused resume helpers that are not reachable from the retained entry points: `contact-details.ts`, `cover-letter.ts`,
  `entries.ts`, `icons.ts`, `move-item.ts`, `patch.ts`, `section-sort.ts`, `section-title.ts`, `sharing.ts`,
  `social-meta.ts`, `spill.ts`, `structural-proposals.ts`, `word-diff.ts`, and the unreferenced
  `stylesheet/registry/index.ts` barrel.
- The template PDF previews under `apps/web/public/templates/pdf`.
- The PDF package's `server.tsx`, `native.tsx`, `forme/images.node.ts`, and `html/` web-page adapters.

The schema files `career.ts`, `ai-usage.ts`, and `applications/data.ts` are retained only because
`packages/resume/src/markdown.ts` imports `FactCategory` and `MAX_RESUME_FACT_CHARACTERS` from `@reactive-resume/schema/career`.
Those files contain schema declarations, not application-tracking behaviour; no application service, route, store, or UI
was copied.

## Local source change: optional missing-font fallback

Exactly one upstream source file is edited in this snapshot: `packages/pdf/src/browser.tsx` (the upstream path relative
to the pinned checkout). Local Resume Studio must keep the editor usable when a font download is unavailable, while the
renderer's own default must stay unchanged for every other caller.

- Added optional `allowMissingFonts` and `onMissingFonts` fields to `CreateResumePdfBlobOptions`.
- When `allowMissingFonts` is omitted or `false`, the existing `assertPdfFonts(result)` call still throws, exactly as
  upstream does, so a resume is never silently printed in other fonts.
- When it is explicitly `true`, the render continues with Forme's built-in fallback; `onMissingFonts` receives the
  unique font families that could not be downloaded. Lost characters are still reported independently through
  `onLostCharacters`.
- No other source file in this vendor tree is modified. The change is deliberately limited to the browser entry point
  used by Local Resume Studio; the server/native adapters were not copied.

## Local manifest and import changes

Changes within the vendor tree are limited to the six vendored `package.json` manifests, one added stylesheet, and the
single source change documented above. Repository-root manifests pin the test, typecheck, lint, and build toolchain.

- Every vendored package remains `private` and `type: "module"` with its pinned package name. Upstream catalog references
  (`catalog:`) and workspace dev-tooling references (`@reactive-resume/config`, `tsrs`, `vite-plus`) were replaced with
  explicit npm versions or removed. The independent lockfile is generated from these manifests.
- `@reactive-resume/schema` exports only `./career`, `./cover-letter/data`, `./icons`, `./resume/stylesheet`,
  `./resume/*`, and `./templates`, with dependencies `@reactive-resume/utils` and `zod`.
- `@reactive-resume/resume` exports only `./ats`, `./ats-pdf`, `./markdown`, `./proposals`, `./stylesheet`, and
  `./stylesheet/types`. `export-sections.ts` and `ats-pdf/verdict.ts` remain internal files in the closure but have no
  public subpath. Its dependencies are `@bramus/specificity`, `@reactive-resume/schema`, `@reactive-resume/utils`,
  `css-tree`, and `wink-porter2-stemmer`; `fast-json-patch` and `zod` were removed because only the removed patch and
  structural-proposal helpers used them.
- `@reactive-resume/fonts` exports only `.` from `src/index.ts` and depends on `@reactive-resume/utils`.
- `@reactive-resume/pdf` exports `./icons`, `./browser`, `./page-map`, `./semantic-legacy`, `./semantic-tree`,
  `./filtering`, and `./section-title`, and keeps the upstream `#react-pdf-renderer` import map. Its server, native, and
  HTML web-page exports were removed with the uncopied adapters.
- `@reactive-resume/utils` exports only `./color`, `./link`, `./locale`, `./region`, `./string`, `./style`, and
  `./timezone`, with dependencies `@uiw/color-convert`, `cn`, `uuid`, and `zod`.
- `@reactive-resume/ui` exports only `./components/*` for the five copied primitives and `./styles/tokens.css`.
- `packages/ui/src/styles/tokens.css` is a local copy of the design-token portion of upstream
  `packages/ui/src/styles/globals.css`, starting at the `@custom-variant` rule. The stylesheet imports that upstream owns
  (`tailwindcss`, `tw-animate-css`, `shadcn/tailwind.css`, Fontsource faces, Phosphor's web CSS, and `typeset.css`) were
  not copied; the studio app imports Tailwind and the token file directly.
- The repository root pins `@types/node` `24.19.2` to match the Node 24 runtime and applies the same version as a
  workspace override so transitive type packages stay on the Node 24 line. It owns `@types/react-reconciler` for the PDF
  closure and the Biome lint configuration. Biome checks the studio app and repository tests; the vendored tree keeps
  upstream formatting and is covered by typecheck and behaviour tests instead.

## Verification in this workspace

The Task 1 baseline test (`tests/vendor/vendor-baseline.test.ts`) verifies that:

- a synthetic v6.1.0 document parses through `parseResumeData`;
- `templateSchema.options` and `templateLayouts` contain exactly the 18 pinned template IDs; and
- `lintResumeForAts` reports `MISSING_NAME` at `/basics/name` for a resume without a name.

Later tasks add the full 18-template PDF render matrix and format checks.

## Reviewing a future vendor update

1. Fetch the proposed upstream commit in a separate, clean checkout and confirm its version and commit hash.
2. Diff the exact copied paths against `77f5580a67d1e4379978e80410e0cd02ea3fd446`. Pay particular attention to
   `packages/schema/src/resume`, `packages/resume/src/ats*`, `packages/pdf/src/templates`, and `packages/pdf/src/browser.tsx`.
3. Re-copy the same paths with the same test/fixture exclusions. Do not copy the excluded server, auth, database, mobile,
   MCP, or application-tracking code.
4. Re-apply the manifest edits described above and update explicit dependency versions when upstream moves them. Regenerate
   `pnpm-lock.yaml`; do not edit it by hand.
5. Run `pnpm install --frozen-lockfile`, the vendor baseline test, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.
6. Run the all-template PDF render checks from the current task plan across the 18 IDs and inspect representative
   single-column, multi-column, photo, English, and Spanish output.
7. Update the commit hash and version in this file, the baseline test's expected IDs, and any third-party notices. Record
   any intentional local source changes and their reason before accepting the update.
