# Original Design Parity Implementation Plan

> **For agentic workers:** OpenCode implements the coding tasks per the user's instruction. Codex reviews the diff and performs the UI verification loop.

**Goal:** Restore the useful Design organization, visual controls, page layout editing, and overflow recovery from Reactive Resume v6.1.0 in Local Resume Studio.

**Architecture:** Compose focused local Design controls around the existing `ResumeEdit` reducer and resume metadata. Use the existing pinned PDF renderer and preview callbacks to measure page overflow; keep edits in the local draft until Save.

**Tech Stack:** React, TypeScript, Vite, Vitest/Testing Library, Playwright, and the existing pinned Reactive Resume schema/PDF packages.

**Spec:** `docs/superpowers/specs/2026-11-08-original-design-parity.md`

## Global Constraints

- Do not add runtime dependencies or copy the full upstream `apps/web` tree.
- Preserve the v6.1.0 resume JSON shape and all unsupported or unknown fields.
- Keep edits in the in-memory draft until the explicit Save action.
- Use synthetic fixtures and temporary data roots.
- Do not read or copy personal resume files, PDFs, or data-directory contents.

## Review Focus

- Reordering between page/column lists must not duplicate or lose a section ID; test same-column reorder, cross-column transfer, and cross-page transfer.
- Toggling full-width moves sidebar section IDs into the main column without losing them; toggling back preserves that placement; test both directions.
- Fit must stop at the 9 pt minimum and leave the draft unchanged when no steps remain; test the lower bound and timeout/failure path.
- Temporary template preview and failed/stale PDF renders must not affect the applied document or export callback; keep existing preview tests green.
- Importing resumes with custom fonts, colors, pages, or unknown keys must preserve values unless a related control is changed; test untouched metadata round-trips.

---

### Task 1: Design group navigation and visual controls

**Files:**
- Modify: `apps/studio/src/features/design/design-panel.tsx`
- Modify or create: focused controls under `apps/studio/src/features/design/`
- Modify: `apps/studio/src/features/write/resume-edits.ts`
- Test: `apps/studio/src/features/design/design-controls.test.tsx`
- Test: `apps/studio/src/features/write/resume-edits.test.ts`

**Interfaces:**
- Consumes: `DesignPanelProps`, current `ResumeData`, and the typed `ResumeEdit` dispatcher.
- Produces: navigable Template/Entries/Type/Color/Page/Advanced groups; visual entry-header options; readable quick font, density, margin, and accent controls; accessible exact settings for typography, color and level display, locale/date, page spacing, and visibility metadata; a visual-default reset that preserves content and layout choices.

- [x] Add failing tests for group navigation, quick-control edits, valid/invalid custom hex input, advanced settings writing only their supported metadata paths, and reset preserving page/content/style-rule fields.
- [x] Run the focused tests and confirm the new assertions fail for the missing controls.
- [x] Implement the grouped controls with keyboard-accessible navigation and no new runtime dependencies.
- [x] Run the focused design and resume-edit tests and confirm they pass.

### Task 2: Page-by-page layout and sidebar controls

**Files:**
- Create: `apps/studio/src/features/design/page-layout.tsx` (or a focused equivalent)
- Modify: `apps/studio/src/features/design/design-panel.tsx`
- Modify: `apps/studio/src/features/write/resume-edits.ts`
- Test: `apps/studio/src/features/write/resume-edits.test.ts`
- Test: `apps/studio/src/features/design/page-layout.test.tsx`

**Interfaces:**
- Consumes: `ResumeData.metadata.layout.pages`, `templateLayouts`, and the existing edit dispatcher.
- Produces: page/column section controls, add/remove page, full-width toggling, sidebar side/width for two-column templates, and typed edits for page and column moves. Use accessible move controls; preserve section IDs and unrelated page metadata.

- [x] Add failing reducer/component tests for reorder, transfer across columns/pages, add/remove page, full-width recovery, and sidebar width/side.
- [x] Run the focused tests and confirm they fail because the operations are missing.
- [x] Implement page operations with validation that prevents deleting the final page or duplicating/loss of a section.
- [x] Run the focused layout tests and confirm they pass.

### Task 3: Overflow status and content-fit actions

**Files:**
- Create: focused fit logic/tests under `apps/studio/src/features/design/`
- Modify: `apps/studio/src/components/editor-shell.tsx`
- Modify: `apps/studio/src/features/preview/pdf-preview.tsx` only if its existing render result needs to expose page status
- Modify: `apps/studio/src/features/design/design-panel.tsx` for page actions if needed
- Test: focused fit/editor-shell tests

**Interfaces:**
- Consumes: authored page count, current applied-draft PDF page count, `ResumeEdit`, and the editor render callback.
- Produces: visible spill status plus Add page and Fit actions. Fit tightens density first, margins second, and body text by 0.5 pt steps down to 9 pt; it measures each rendered result, stops on timeout or user edits, and never reports success without a completed render.

- [x] Add failing tests for fit step ordering, stopping when authored pages fit, minimum-size behavior, render timeout, and add-page availability.
- [x] Run focused tests and confirm they fail for the missing fit behavior.
- [x] Implement overflow state and actions using the existing PDF rendering lifecycle; keep temporary previews out of fit measurements.
- [x] Run focused fit/editor-shell tests and confirm they pass.

### Task 4: Browser verification and documentation

**Files:**
- Modify: `tests/e2e/studio.spec.ts`
- Modify: `docs/PORTING_INVENTORY.md`

- [x] Add or update an E2E scenario for page layout changes, overflow controls, and saving only after explicit Save, using the synthetic fixture and temporary data root.
- [x] Codex runs the UI flow and checks desktop and narrow/mobile control visibility.
- [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm e2e`.
- [x] Review every changed file and confirm no personal resume data, unnecessary dependencies, cloud calls, or vendor modifications were added.
