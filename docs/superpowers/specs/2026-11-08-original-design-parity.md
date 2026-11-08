# Original Design Parity

## Intent

Bring the most useful parts of Reactive Resume v6.1.0's Design workflow into Local Resume Studio so choosing a look, arranging pages, and resolving overflow feel familiar. Keep the independent local app, the pinned PDF renderer, its JSON resume format, and its explicit Save behavior.

## Goals

- Organize Design into Template, Entries, Type, Color, Page, and Advanced groups with quick navigation.
- Make common choices visual and easy to compare: entry-header wireframes, font pairings, density/margin presets, accent swatches, and contrast feedback.
- Expose advanced typography, color/level display, date, locale, page spacing, and visibility settings in a collapsed group, with a safe design-default reset.
- Edit page-by-page section placement, page count/full-width state, and two-column sidebar placement/width using the resume's existing metadata.
- Show when the PDF spills beyond authored pages and offer page addition or a one-step-at-a-time Fit action that tightens spacing, margins, then text size down to 9 pt.
- When the applied PDF spills, move eligible overflow sections onto a new authored page while keeping each section in its current column; explain when no section can move safely.
- Let users select a header, section, or entry in the applied PDF preview to open its matching editable field in Write.
- Keep all changes in the in-memory draft until the user chooses Save. Temporary template previews must remain non-persistent.

## Non-goals

- Copy the upstream app shell, router, account/cloud services, or builder stores.
- Add runtime dependencies for drag-and-drop or remote rendering.
- Change the v6.1.0 JSON schema or discard unknown resume fields.
- Recreate the upstream semantic stylesheet code editor in this pass; preserve existing `styleRules` and optional `stylesheet` data when editing other design fields.

## Approaches

1. Copy the upstream editor and its supporting web app modules. Rejected because it brings app-only dependencies and conflicts with the lightweight local app.
2. Port the Design behaviors into focused local components, writing the same supported metadata fields and using the existing PDF render loop. Selected because it restores the workflow without changing storage or app architecture.
3. Keep the current long form and add isolated controls. Rejected because it would preserve feature coverage gaps and the less scannable experience that prompted this work.

## Architecture and constraints

- `DesignPanel` owns group navigation and composes focused local controls.
- Design writes remain typed `ResumeEdit` operations; layout controls update `metadata.layout` and preserve all unrelated metadata.
- Page-fit measurements use the rendered PDF page count and the authored page count. Fit changes must be undoable as one coherent operation where the current editor state permits it; if a render does not arrive, stop without claiming a fit.
- Use the current renderer and PDF preview callbacks. Do not save as a side effect of editing.
- Use synthetic test data and temporary data roots. Never read personal resume files for these changes.
- Reset only visual defaults. Keep resume content, page/section placement, locale, date format, custom style rules, and optional stylesheet untouched.
- Page-map actions must use the render's exact resume snapshot; stale or temporary template previews must not move sections or select stale targets.

## Verification

- Add behavior tests before implementation and verify the relevant test fails for the missing behavior.
- Run focused design/layout/fit tests during implementation.
- Codex reviews the diff, runs `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm e2e`, and inspects the UI at desktop and narrow/mobile widths.
- Verify export still uses the applied draft and that unsaved edits do not write JSON to disk.
