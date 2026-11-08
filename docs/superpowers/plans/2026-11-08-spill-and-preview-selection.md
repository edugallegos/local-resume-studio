# Overflow Recovery and PDF Selection Plan

> **For implementation:** OpenCode implements the coding tasks per the user's instruction. Codex reviews the diff and runs the verification loop.

**Goal:** Make the Design Add page action move rendered overflow sections to a new authored page, and let users click a semantic region in the PDF preview to reach its matching Write control.

**Architecture:** Reuse the current PDF page map and resume reducer. Port only the small section-spill decision needed by the app; do not modify vendored files. Associate each completed preview render with its exact resume snapshot so stale or temporary template renders cannot drive edits or selection.

**Spec:** `docs/superpowers/specs/2026-11-08-original-design-parity.md`

## Constraints

- Preserve Reactive Resume v6.1 JSON, section IDs, unknown fields, column placement, and explicit Save behavior.
- Use synthetic data and the existing temporary test data roots.
- Do not add dependencies, alter the vendor snapshot, or use personal resume content.
- Keep temporary template previews non-interactive and do not let them affect the applied render.

## Task 1: Move actual overflow sections when adding a page

**Files:**
- Create or modify: `apps/studio/src/features/design/spill.ts`
- Modify: `apps/studio/src/features/design/design-panel.tsx`
- Modify: `apps/studio/src/features/write/resume-edits.ts`
- Modify: `apps/studio/src/components/editor-shell.tsx`
- Modify: `apps/studio/src/features/preview/pdf-preview.tsx` only to associate a completed result with its input snapshot
- Test: spill utility, reducer, Design controls, and EditorShell tests
- Test: `tests/e2e/studio.spec.ts`

**Behavior:** Match the pinned upstream spill rule: move last-page sections that start beyond the authored page count; otherwise, if a section crosses the boundary, move the last spilling section in a column only when that column has another section to keep. Keep main/sidebar placement and the last page's full-width state. If the applied render is stale, wait for it; if only an indivisible section crosses the page break, explain that automatic movement is unavailable. Preserve a blank-page action when there is no overflow.

- [x] Add failing tests for rendered-section spill selection, crossing-section fallback, no movable section, and atomic reducer movement that preserves column and unknown page metadata.
- [x] Run the focused tests and confirm the new assertions fail.
- [x] Implement the local spill selector and reducer edit; bind Add page to it only when a current applied render identifies movable sections.
- [x] Verify a completed render cannot move sections using a stale resume snapshot, and a temporary template preview cannot drive the action.
- [x] Run focused utility, reducer, design, and shell tests and confirm they pass.

## Task 2: Click PDF regions to focus the matching Write control

**Files:**
- Modify: `apps/studio/src/features/preview/pdf-preview.tsx`
- Modify: `apps/studio/src/components/editor-shell.tsx`
- Modify: `apps/studio/src/App.tsx`
- Modify: `apps/studio/src/features/write/sections/item-editor.tsx` or a focused Write helper for stable item-field IDs
- Test: PDF preview, editor shell, App, and `tests/e2e/studio.spec.ts`

**Behavior:** Make active applied page-map regions keyboard-accessible controls with labels for header, section, or entry. Header selection focuses the name field, summary selection focuses summary content, section selection focuses its heading, and item selection focuses that entry's first editable field. Preview selection also highlights the region. Temporary template previews stay non-interactive.

- [x] Add failing tests for accessible target controls and callback payloads; add focus-mapping tests for header, summary, section, and item targets.
- [x] Run the focused tests and confirm the new assertions fail.
- [x] Implement clickable/focusable page-map targets with overlap ordering so item controls remain clickable over section regions.
- [x] Wire target selection through EditorShell and App to switch to Write, focus and scroll the matching control, and highlight the selected target without saving.
- [x] Add a Playwright flow that clicks a PDF entry and confirms its matching Write control receives focus.
- [x] Run focused preview, editor, and App tests and confirm they pass.

## Task 3: Full verification and review

- [x] Run `pnpm lint`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm test`.
- [x] Run `pnpm build`.
- [x] Run `pnpm e2e`; all 7 flows passed. New Add page and preview selection flows loaded at desktop width and exercised their interactions at 390×844.
- [x] Review the complete diff for stale-render races, correct page/column preservation, keyboard access, draft-only edits, and absence of vendor/dependency/personal-data changes.
- [x] Commit after Codex confirmed the gates and UI flow.
