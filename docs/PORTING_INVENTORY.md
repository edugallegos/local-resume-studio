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

- `apps/studio/src/**`: the app shell and tabs, Write editor, Design controls, Check workflow, local resume library, preview layout, and download interaction/state.
- `apps/studio/src/features/export/safe-render-copy.ts`: a render-only copy that removes active rich-text markup and suppresses non-embedded image URLs before handing data to the vendored renderer. It leaves the saved JSON unchanged; embedded image data URLs are kept.
- `apps/studio/src/features/export/render-resume-pdf.ts` and `apps/studio/src/features/preview/pdf-preview.tsx`: integration between the vendor renderer, PDF.js, page-map Check overlays, and the local canvas preview.
- `apps/studio/server/**`: the loopback HTTP API and static-file server.
- `packages/local-store/src/**`: local JSON resume storage and PDF export archive storage.
- `scripts/**`: development, production, CLI, and end-to-end process helpers.
- The local test suite, Playwright configuration, and project documentation and contributor setup.

Local Check UI and issue presentation are also app code. They use vendored resume/ATS and PDF analysis functions where applicable, but the local panels, issue models, and interactions are not the original web app's Check screens.

## What was intentionally left out

The original `apps/web` builder and its routes/components were not copied. The snapshot also omits `apps/server`, `apps/mobile`, authentication, database and cloud APIs, AI and email services, import/DOCX/ODT features, MCP and Cloudflare integrations, application tracking, test fixtures, and the upstream template PDF samples. The exact exclusion list is in the [vendor ledger](../vendor/reactive-resume/UPSTREAM.md#deliberate-exclusions).

In particular, the original web app's template gallery, its dynamic thumbnail hook, its page-canvas shell, and its PDF preview components are not part of the vendor snapshot. Local Resume Studio has its own Design panel and preview component.

## Why changing templates feels different

### Template selection

The local [`DesignPanel`](../apps/studio/src/features/design/design-panel.tsx) presents templates in a native dropdown. Choosing one immediately changes `metadata.template` in the draft and starts a new local PDF preview. The 18 upstream JPGs are present in the vendor folder, but the current Design dropdown does not display them.

The upstream [`TemplateGroup`](https://github.com/reactive-resume/reactive-resume/blob/77f5580a67d1e4379978e80410e0cd02ea3fd446/apps/web/src/features/resume/editor/design/template-group.tsx) is a gallery of cards. It has one-column, two-column, and ATS-safe filters, selected-template styling, and temporary previews on hover or keyboard focus (or a long press on touch); clicking applies a choice. Its [`useTemplateThumbnail`](https://github.com/reactive-resume/reactive-resume/blob/77f5580a67d1e4379978e80410e0cd02ea3fd446/apps/web/src/features/resume/editor/design/thumbnails.ts) renders the user's own resume into each card when there is enough content, falling back to the sample image while that render is unavailable. This dynamic, content-specific gallery is not implemented locally.

### Page preview

Both apps ultimately render a PDF with `@reactive-resume/pdf/browser` and use PDF.js to draw PDF pages. The upstream builder routes rendering through its worker wrapper and has a richer preview shell: it stages new pages before replacing the current ones, adjusts page scale to the available canvas, supports zoom, and provides page captions and editor overlays. Its template hover preview temporarily renders another template without applying it to the saved draft.

The local app calls the same vendored PDF browser renderer directly and draws its pages with the local [`PdfPreview`](../apps/studio/src/features/preview/pdf-preview.tsx). It has a simpler page stack and does not currently reproduce the upstream zoom/fit chrome, dynamic template gallery, staged page transition, or the original builder's hover-preview state. It adds its own selected-issue overlay for Check.

There are also two intentional local render differences to account for when comparing actual page output:

1. Local rendering passes a sanitized copy to the renderer. Non-embedded portrait URLs and non-embedded images or active markup in rich text are removed to keep rendering local and predictable. The upstream builder's normal preview path does not use this local sanitizer.
2. Local rendering explicitly permits a missing font and continues with Forme's fallback. Upstream's default PDF browser renderer fails its font assertion unless that option is enabled.

The renderer and all 18 template implementations are reused, but the picker and preview experience are new. The code inventory explains why the interface looks different; it does not establish the cause of a specific page-layout mismatch. No screenshot or pixel-by-pixel comparison was performed for this report. For a definitive output comparison, render the same resume JSON with the same template, page settings, and available fonts in both apps, then compare the generated PDFs and record any local sanitizer or missing-font notices.

## Useful source references

- Upstream inventory and adaptation notes: [`vendor/reactive-resume/UPSTREAM.md`](../vendor/reactive-resume/UPSTREAM.md)
- Local template and typography controls: [`apps/studio/src/features/design/design-panel.tsx`](../apps/studio/src/features/design/design-panel.tsx)
- Local safe render copy: [`apps/studio/src/features/export/safe-render-copy.ts`](../apps/studio/src/features/export/safe-render-copy.ts)
- Local renderer integration: [`apps/studio/src/features/export/render-resume-pdf.ts`](../apps/studio/src/features/export/render-resume-pdf.ts)
- Local page preview: [`apps/studio/src/features/preview/pdf-preview.tsx`](../apps/studio/src/features/preview/pdf-preview.tsx)
- Upstream preview implementation at the pinned commit: [`preview.browser.tsx`](https://github.com/reactive-resume/reactive-resume/blob/77f5580a67d1e4379978e80410e0cd02ea3fd446/apps/web/src/features/resume/preview/preview.browser.tsx), [`pdf-canvas.tsx`](https://github.com/reactive-resume/reactive-resume/blob/77f5580a67d1e4379978e80410e0cd02ea3fd446/apps/web/src/features/resume/preview/pdf-canvas.tsx), and [`page-canvas.tsx`](https://github.com/reactive-resume/reactive-resume/blob/77f5580a67d1e4379978e80410e0cd02ea3fd446/apps/web/src/routes/builder/$resumeId/-components/page-canvas.tsx)
