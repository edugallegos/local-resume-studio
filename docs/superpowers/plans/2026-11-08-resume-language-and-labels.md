# Resume Language and Editable Section Labels Implementation Plan

> **For agentic workers:** OpenCode implements the tasks. Codex reviews the diff and performs the UI verification loop.

**Goal:** Restore per-resume output-language selection and let users edit printed section headings.

**Architecture:** Reuse the pinned locale and section-title utilities. Write changes through the existing typed edit reducer and preserve the standard resume JSON shape.

**Tech Stack:** React, TypeScript, pinned Reactive Resume utilities/PDF renderer, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-08-resume-language-and-labels.md`

## Global Constraints

- Do not add runtime dependencies or modify vendored upstream code.
- Keep resume output locale at `metadata.page.locale`; do not translate content or change Studio's interface language.
- Preserve unknown resume fields and only write supported v6.1.0 fields.
- Use synthetic data and a temporary data root for verification.

## Review Focus

- A locale change must update default headings without overwriting authored headings or content.
- Clearing a custom heading must restore the correct localized default in Write, Design, and PDF output.
- Imported or unsupported section data and unknown fields must survive edits unchanged.

---

### Task 1: Resume language picker

**Files:** `apps/studio/src/features/design/advanced-group.tsx`, a focused shared language control under `apps/studio/src/features/`, `apps/studio/src/features/write/write-panel.tsx`, and focused control tests.

**Interfaces:** Read/write `data.metadata.page.locale` through the existing `update-page` edit. Use the pinned `supportedLocales` and `getLanguageName` helpers; use the same picker in Write and Design where practical.

- [x] Replace the raw locale text input with an accessible searchable or select control showing language names and the locale code.
- [x] Explain that headings, dates, and text direction can change but content is not translated.
- [x] Add tests for the supported locale options, selected value, and writing only `metadata.page.locale`.
- [x] Run the focused locale control tests.

### Task 2: Editable localized section headings

**Files:** `apps/studio/src/features/write/resume-edits.ts`, `apps/studio/src/features/write/sections/summary-fields.tsx`, `apps/studio/src/features/write/sections/section-editor.tsx`, `apps/studio/src/features/design/section-labels.ts`, and focused reducer/component tests.

**Interfaces:** Add a typed edit for headings on native Write sections. Use `getResumeSectionTitle` from the pinned PDF package as the single fallback resolver.

- [x] Add a reducer operation for changing a native section title without touching its items or unknown fields.
- [x] Make summary and native section headings editable, with a clear/reset action that stores an empty title to restore the current locale default.
- [x] Use the pinned section-title resolver for Design/preview fallback labels.
- [x] Test localized defaults, authored overrides, reset behavior, reducer preservation, and preview label consistency.
- [x] Run the focused heading, reducer, and design tests.

### Task 3: UI verification and gates

**Files:** Update relevant E2E coverage only if needed; do not add personal resume data.

- [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm e2e`.
- [x] Codex checked language selection, custom heading entry/reset, and rendered PDF labels with a synthetic resume at a desktop viewport.
- [ ] Check the same UI flow at a narrow viewport.
- [x] Inspect the diff for schema changes, locale/content coupling, vendor edits, and user data.
