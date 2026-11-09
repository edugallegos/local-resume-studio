# Local ATS Reader View Implementation Plan

> **For agentic workers:** OpenCode implements the tasks. Codex reviews the diff and performs the UI verification loop.

**Goal:** Let users inspect the locally extracted text and reading order of the current generated resume PDF.

**Architecture:** Extend the current PDF-check path to provide its extracted document and recognized semantics alongside the report, then render a Check-mode preview toggle that uses the exact current draft output and relates findings to parsed fields/lines.

**Tech Stack:** React, TypeScript, the pinned `@reactive-resume/resume/ats-pdf` package, pdfjs-dist, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-08-ats-reader-view.md`

## Global Constraints

- Do not modify `vendor/reactive-resume` or add dependencies.
- Keep extraction local and based on the generated PDF for the current draft.
- Do not claim that one parser view predicts every ATS product.
- Use synthetic data and a temporary data root for verification.

## Review Focus

- Parser text must correspond to the exact draft/PDF currently previewed.
- Reading order and page breaks must use the pinned extractor's output.
- Empty, truncated, or failed text extraction must not appear as a successful blank resume.

---

### Task 1: Expose the extracted document

**Files:** `apps/studio/src/features/check/pdf-check.ts` and focused PDF-check tests.

**Interfaces:** Reuse `harvestPdfDocument`, `buildExtractedDocument`, and `buildResumeSemantics`; keep the existing `checkExportedPdf` report API compatible while making `ExtractedDocument` and `ResumeSemantics` available to the UI.

- [x] Refactor or extend the local PDF check path to return/pass the report and extracted document from one harvest.
- [x] Preserve cancellation, cleanup, progress, and current report behavior.
- [x] Test page grouping/reading order and text-read/truncation metadata using synthetic PDF fixtures or injected documents.
- [x] Run the focused PDF-check tests.

### Task 2: Parser preview toggle

**Files:** `apps/studio/src/components/editor-shell.tsx`, `apps/studio/src/features/check/check-panel.tsx`, a focused parser preview component under `apps/studio/src/features/check/`, and relevant component tests.

**Interfaces:** Keep the current PDF view as default. In Check mode, expose an accessible `PDF` / `What a parser reads` toggle; the parser view consumes the extracted document, recognized semantics, and current `CheckIssue[]`, showing per-page ordered text, recognized fields, issue markers, and honest empty/truncated/read-failure states.

- [x] Connect the Check analysis result to the preview mode without showing stale extracted text after edits.
- [x] Keep the parser toggle scoped to Check mode and retain existing PDF preview/download behavior.
- [x] Test toggle visibility/state, page headings and text, recognized contact/section/date fields, issue markers, empty/truncated states, and invalidation on data changes.
- [x] Run focused Check/editor-shell tests.

### Task 3: UI verification and gates

**Files:** Update relevant E2E coverage only if needed; do not add personal resume data.

- [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm e2e`.
- [x] Codex checked the parser view, reading order, extracted fields, issue highlighting, and stale-analysis invalidation against a synthetic resume at a desktop viewport.
- [ ] Check the same UI flow at a narrow viewport.
- [x] Inspect the diff for stale data, network calls, vendor edits, unnecessary dependencies, and user data.
