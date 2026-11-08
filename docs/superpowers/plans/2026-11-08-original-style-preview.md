# Original-style template preview Implementation Plan

> **For agentic workers:** This work is delegated to OpenCode per the user's existing instruction. Codex reviews the diff and runs the UI verification loop.

**Goal:** Restore the template gallery and preview interactions that make Reactive Resume templates easy to compare, while preserving the local studio's draft and export behavior.

**Architecture:** Implement a local template gallery backed by the pinned PDF renderer, with bundled JPG fallbacks and lazily rendered previews from the user's current draft. Keep temporary preview selection in editor UI state, and enhance the local PDF canvas with staged replacement plus zoom/fit controls.

**Tech Stack:** React, TypeScript, Vite, the existing `@reactive-resume/pdf/browser` renderer, PDF.js, Vitest/Testing Library, and Playwright.

**Spec:** `docs/superpowers/specs/2026-11-08-original-style-preview-design.md`

## Global Constraints

- Do not add runtime dependencies or copy the full upstream `apps/web` tree.
- Do not write resume files while a template is only hovered or focused.
- Keep bundled JPGs as immediate fallbacks; do not fetch remote thumbnails.
- Keep download/export data bound to the applied draft while a temporary preview is active.
- Preserve Check issue overlays, safe-render warnings, and missing-font reporting.
- Use synthetic fixtures and temporary data roots for automated tests.

## Review Focus

- Rapid hover/focus changes can leave a stale thumbnail or PDF visible; test that aborted work is cleaned up and the latest selection wins.
- A temporary preview must not mark the draft dirty or replace the applied export Blob; test the callback and E2E draft value.
- Thumbnail generation must not overwhelm PDF rendering; test serialized/lazy requests and fallback behavior.
- Switching templates with multiple pages must keep old pages until the replacement is drawable and must retain Check overlays.
- Zoom must not crop the page or break narrow/mobile layouts; verify fit/reset and scroll behavior at desktop and mobile widths.

---

### Task 1: Template gallery and per-resume thumbnails

**Files:**
- Modify: `apps/studio/src/features/design/design-panel.tsx`
- Modify: `apps/studio/src/features/design/design-controls.test.tsx`
- Create: `apps/studio/src/features/design/template-thumbnail.ts`
- Create: `apps/studio/src/features/design/template-thumbnail.test.ts`

**Interfaces:**
- Consumes: `ResumeData`, the pinned `Template` IDs and `templateLayouts`, the existing `renderResumePdf` and `LoadPdfDocument` interfaces.
- Produces: a gallery with all 18 templates, `all`/`one`/`two`/`ats` filters, selected state, and `onPreviewTemplate(template | null)` plus existing `onEdit({ type: "update-template", template })` behavior.
- Produces: `renderTemplateThumbnail(data, template, dependencies?) -> Promise<Blob>` that renders only page one from a render-only copy and supports abort/cleanup.

- [ ] Add failing component tests for all template cards and filter counts, selected-template state, hover/focus preview, Escape/pointer-leave clearing, and click-to-apply.
- [ ] Add failing helper tests for rendering the requested template without mutating input, aborting and cleaning up PDF.js resources, and preserving the sample JPG fallback after render failure.
- [ ] Implement bundled JPG fallback URLs and lazy, serialized thumbnail rendering from the current resume data; skip generated thumbnails when the resume has no meaningful content.
- [ ] Run `pnpm exec vitest run apps/studio/src/features/design/design-controls.test.tsx apps/studio/src/features/design/template-thumbnail.test.ts` and confirm it passes.

### Task 2: Temporary preview wiring in the editor shell

**Files:**
- Modify: `apps/studio/src/components/editor-shell.tsx`
- Modify: `apps/studio/src/features/design/design-panel.tsx` (props only if Task 1 did not finish them)
- Create or modify: focused component tests under `apps/studio/src/components/`

**Interfaces:**
- Consumes: the gallery's `onPreviewTemplate` and applied `state.data`.
- Produces: the main canvas receives a copy of the current data with only `metadata.template` overridden during temporary preview. Clicking a template continues to dispatch the current edit and clears temporary preview.

- [ ] Add a failing test proving hover/focus preview changes the `PdfPreview` template input but does not invoke `onEdit` or replace the applied `onPdfRendered` result.
- [ ] Add a failing test proving Escape/pointer leave restores the applied template and click applies it to the draft.
- [ ] Implement temporary template state and a visible `Previewing <name> · click to apply` status. Keep download enabled only for the applied draft and do not forward temporary render results to the export callback.
- [ ] Run the focused Vitest component tests and confirm they pass.

### Task 3: Staged PDF canvas and zoom controls

**Files:**
- Modify: `apps/studio/src/features/preview/pdf-preview.tsx`
- Modify: `apps/studio/src/features/preview/pdf-preview.test.tsx`
- Modify: `apps/studio/src/components/editor-shell.tsx` only for preview toolbar placement if needed

**Interfaces:**
- Consumes: the current PDF render/load adapters, page map, selected Check target, and the `onRendered` callback.
- Produces: a page view that keeps the last completed PDF visible until replacement pages draw, plus accessible zoom-in, zoom-out, and fit controls. `onRendered` continues to report only the active applied PDF.

- [ ] Add failing tests for retaining the active document while another PDF is pending, promoting a fully drawn replacement, preserving selected issue overlays, and zoom/fit bounds.
- [ ] Implement staged page/document state with cancellation and cleanup for superseded renders, then add the zoom toolbar without changing generated PDF bytes.
- [ ] Run `pnpm exec vitest run apps/studio/src/features/preview/pdf-preview.test.tsx` and confirm it passes.

### Task 4: Browser-level verification

**Files:**
- Modify: `tests/e2e/studio.spec.ts`

**Interfaces:**
- Consumes: the completed gallery and preview controls.
- Produces: an E2E check that temporary previewing does not change the selected draft, clicking applies the template, and the applied template still downloads a valid archived PDF.

- [ ] Add an E2E scenario using only `tests/e2e/fixtures/resume-v6.1.0.json` and the E2E temporary data root.
- [ ] Run the focused browser check with `E2E_TEST_MATCH=studio.spec.ts pnpm e2e` (or the repository's supported focused invocation) and verify the preview, applied draft, and PDF download behaviors.
- [ ] Run repository gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm e2e`.
- [ ] Review the full diff, confirm no personal resume data or remote dependencies were added, and report verification evidence. Do not commit from OpenCode.
