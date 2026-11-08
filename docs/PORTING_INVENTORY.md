# Porting inventory: Local Resume Studio and Reactive Resume

This report records what Local Resume Studio reuses from Reactive Resume, what it adapts, and what it implements locally. It also compares the two template-preview paths to explain why the Design experience can feel different even though the resume templates come from the same source.

## Source and scope

- Upstream project: [Reactive Resume](https://github.com/reactive-resume/reactive-resume)
- Pinned upstream version: v6.1.0
- Pinned commit: [`77f5580a67d1e4379978e80410e0cd02ea3fd446`](https://github.com/reactive-resume/reactive-resume/tree/77f5580a67d1e4379978e80410e0cd02ea3fd446)
- Local source ledger: [`vendor/reactive-resume/UPSTREAM.md`](../vendor/reactive-resume/UPSTREAM.md)

The counts below are for the 230 files tracked under `vendor/reactive-resume`. The 18 JPEG thumbnails are compared with their original upstream location, `apps/web/public/templates/jpg/`, because Local Resume Studio places them at `vendor/reactive-resume/templates/jpg/`.

| Classification | Count | Details |
| --- | ---: | --- |
| Upstream files retained byte-for-byte | 221 | 203 keep the same relative path; 18 thumbnails were relocated |
| Upstream files adapted | 7 | Six package manifests and the PDF browser entry point |
| Local provenance or derived files | 2 | This vendor ledger and a stylesheet derived from upstream design tokens |

These counts describe the vendored snapshot, not the whole application. The studio app, local server, storage, and tests are additional local code.

## Reused from Reactive Resume

The vendor snapshot keeps the source needed to parse, analyze, and render v6.1.0 resume data without bringing over the original monorepo services:

- `packages/schema/src/**`: resume schemas and defaults, dates, design metadata, template registry, icons, and the minimal schemas required by retained imports.
- Selected `packages/resume/src/**`: ATS checks and PDF analysis, Markdown export, proposals, and stylesheet/semantic support used by rendering.
- `packages/fonts/src/**`: the font catalog and script fallbacks.
- Selected `packages/utils/src/**`: color, link, locale, region, string, style, timezone, and required region data.
- `packages/pdf/src/**`: the browser PDF renderer, Forme adapter, semantic tree, page map, rich text, and all 18 template implementations.
- Five UI primitives: badge, button, icon, separator, and spinner.
- All 18 static template JPGs, copied from the original web app's public template directory.
- The upstream MIT `LICENSE`, unchanged.

The template implementations themselves are vendored upstream code; they were not recreated as local templates. The app calls the vendored PDF browser entry point through [`render-resume-pdf.ts`](../apps/studio/src/features/export/render-resume-pdf.ts).

## Adapted or derived vendor files

- Six vendored `package.json` files were trimmed for this independent workspace. Upstream catalog/workspace references were replaced with explicit dependencies and only the required exports were retained.
- `packages/pdf/src/browser.tsx` has one local source change: callers can explicitly allow missing web fonts and receive a list of missing families. The default remains the upstream behavior and still throws when this option is not enabled.
- `packages/ui/src/styles/tokens.css` is a local extraction of the design-token portion of upstream `packages/ui/src/styles/globals.css`; the original app-wide stylesheet imports were not carried over.
- `vendor/reactive-resume/UPSTREAM.md` is a local provenance and maintenance record.

The local render path opts into the font fallback. This makes the local editor continue rendering when a font cannot be downloaded; the same input may therefore use a fallback font where the upstream builder would report a render failure.

## Implemented locally

The following is application code written for Local Resume Studio rather than copied from `apps/web`:

- `apps/studio/src/**`: the app shell and tabs, Write editor, Design workspace, Check workflow, local resume library, preview layout, and download interaction/state.
- `apps/studio/src/features/design/**`: grouped Template/Entries/Type/Color/Page/Advanced navigation; the restored 18-card template gallery with temporary hover/focus previews; wireframe entry-header choices; local font pairings, density and margin presets; accent swatches with hex validation and contrast guidance; page-by-page main/sidebar placement; sidebar side/width; overflow status and a measured Fit action; and exact typography/color/page controls in Advanced.
- `apps/studio/src/features/export/safe-render-copy.ts`: a render-only copy that removes active rich-text markup and suppresses non-embedded image URLs before handing data to the vendored renderer. It leaves the saved JSON unchanged; embedded image data URLs are kept.
- `apps/studio/src/features/export/render-resume-pdf.ts` and `apps/studio/src/features/preview/pdf-preview.tsx`: integration between the vendor renderer, PDF.js, page-map Check overlays, staged PDF replacement, zoom/fit-to-width controls, and the local canvas preview.
- `apps/studio/src/features/write/resume-edits.ts`: the typed JSON edit reducer, including design/page/sidebar edits, page add/remove/full-width operations, a visual-default reset, and restoration of fit-related metadata.
- `apps/studio/server/**`: the loopback HTTP API and static-file server.
- `packages/local-store/src/**`: local JSON resume storage and PDF export archive storage.
- `scripts/**`: development, production, CLI, and end-to-end process helpers.
- The local test suite, Playwright configuration, and project documentation and contributor setup.

Local Check UI and issue presentation are also app code. They use vendored resume/ATS and PDF analysis functions where applicable, but the local panels, issue models, and interactions are not the original web app's Check screens.

The local Design workflow intentionally does not recreate the upstream semantic stylesheet code editor. `metadata.styleRules` and optional `metadata.stylesheet` data are preserved untouched when other design controls are used or the visual defaults are reset.

## What was intentionally left out

The original `apps/web` builder and its routes/components were not copied. The snapshot also omits `apps/server`, `apps/mobile`, authentication, database and cloud APIs, AI and email services, import/DOCX/ODT features, MCP and Cloudflare integrations, application tracking, test fixtures, and the upstream template PDF samples. The exact exclusion list is in the [vendor ledger](../vendor/reactive-resume/UPSTREAM.md#deliberate-exclusions).

In particular, the original web app's template gallery, its dynamic thumbnail hook, its page-canvas shell, and its PDF preview components are not part of the vendor snapshot. Local Resume Studio has its own Design panel and preview component.

## Why changing templates feels different

### Template selection

The local [`DesignPanel`](../apps/studio/src/features/design/design-panel.tsx) presents all 18 pinned templates in the restored gallery. It keeps the upstream one-column, two-column, and ATS-safe filters, selected-card styling, content-specific thumbnails with a bundled sample fallback, and temporary previews on hover, keyboard focus, or a touch hold. Clicking a card applies it to the in-memory draft; leaving the gallery, pressing Escape, or switching tabs restores the applied template. The upstream gallery's scroll-under-pointer suppression is not replicated.

### Design workspace

The local Design workspace is organized into Template, Entries, Type, Color, Page, and Advanced groups with a keyboard-accessible group nav. The common choices are visual: wireframe entry-header layouts, all nine local font pairings, density and margin presets, eight accent swatches, a validated custom hex field with contrast guidance, and page presets. Advanced exposes exact body/heading families, weights, sizes and line heights; hyphenation; all three design colors; level display; locale, date format, spacing and visibility flags; and a reset that keeps resume content, page/section placement, locale, date format, `styleRules`, and any optional `stylesheet`.

The Page group edits `metadata.layout.pages` directly. Each page lists its main and sidebar sections with buttons for reordering and column/page transfers, plus add page, remove page, full-width, and two-column sidebar side/width controls. Section IDs are preserved and a removed page's sections move to a surviving page rather than being discarded. There is no drag-and-drop dependency.

The same Page group reports authored-page overflow from the last completed applied PDF render, with Add page and Fit actions. Fit tightens density, then margins, then body text in 0.5 pt steps down to 9 pt, waiting for a completed render after every step. It stops on a render timeout or a superseding edit; if no measured step fits, it restores the fit-related metadata. Temporary template previews are excluded from these measurements. The preview's separate Fit to width control remains a viewport zoom action, not a content-fit action.

### Page preview

Both apps ultimately render a PDF with `@reactive-resume/pdf/browser` and use PDF.js to draw PDF pages. The upstream builder routes rendering through its worker wrapper and has a richer preview shell: it stages new pages before replacing the current ones, adjusts page scale to the available canvas, supports zoom, and provides page captions and editor overlays. Its template hover preview temporarily renders another template without applying it to the saved draft.

The local app calls the same vendored PDF browser renderer directly and draws its pages with the local [`PdfPreview`](../apps/studio/src/features/preview/pdf-preview.tsx). It stages a new PDF replacement while the last completed document stays visible, promotes it only after every page draws, exposes zoom and Fit to width controls, and keeps temporary template renders out of the downloadable Blob. It adds its own selected-issue overlay for Check and reports the completed applied render's physical page count to the Design workspace for overflow and Fit.

There are also two intentional local render differences to account for when comparing actual page output:

1. Local rendering passes a sanitized copy to the renderer. Non-embedded portrait URLs and non-embedded images or active markup in rich text are removed to keep rendering local and predictable. The upstream builder's normal preview path does not use this local sanitizer.
2. Local rendering explicitly permits a missing font and continues with Forme's fallback. Upstream's default PDF browser renderer fails its font assertion unless that option is enabled.

The renderer and all 18 template implementations are reused, while the picker and preview experience are local implementations of the upstream workflow rather than copies of its components. The code inventory describes the current parity and the remaining intentional render differences; it does not establish the cause of a specific page-layout mismatch. No screenshot or pixel-by-pixel comparison was performed for this report. For a definitive output comparison, render the same resume JSON with the same template, page settings, and available fonts in both apps, then compare the generated PDFs and record any local sanitizer or missing-font notices.

## Useful source references

- Upstream inventory and adaptation notes: [`vendor/reactive-resume/UPSTREAM.md`](../vendor/reactive-resume/UPSTREAM.md)
- Local Design workspace: [`design-panel.tsx`](../apps/studio/src/features/design/design-panel.tsx), [`advanced-group.tsx`](../apps/studio/src/features/design/advanced-group.tsx), [`page-layout.tsx`](../apps/studio/src/features/design/page-layout.tsx), and [`fit.ts`](../apps/studio/src/features/design/fit.ts)
- Local safe render copy: [`apps/studio/src/features/export/safe-render-copy.ts`](../apps/studio/src/features/export/safe-render-copy.ts)
- Local renderer integration: [`apps/studio/src/features/export/render-resume-pdf.ts`](../apps/studio/src/features/export/render-resume-pdf.ts)
- Local page preview: [`apps/studio/src/features/preview/pdf-preview.tsx`](../apps/studio/src/features/preview/pdf-preview.tsx)
- Upstream preview implementation at the pinned commit: [`preview.browser.tsx`](https://github.com/reactive-resume/reactive-resume/blob/77f5580a67d1e4379978e80410e0cd02ea3fd446/apps/web/src/features/resume/preview/preview.browser.tsx), [`pdf-canvas.tsx`](https://github.com/reactive-resume/reactive-resume/blob/77f5580a67d1e4379978e80410e0cd02ea3fd446/apps/web/src/features/resume/preview/pdf-canvas.tsx), and [`page-canvas.tsx`](https://github.com/reactive-resume/reactive-resume/blob/77f5580a67d1e4379978e80410e0cd02ea3fd446/apps/web/src/routes/builder/$resumeId/-components/page-canvas.tsx)
