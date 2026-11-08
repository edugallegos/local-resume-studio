# Original-style template preview design

## Intent

Make changing templates feel closer to Reactive Resume by letting people compare templates against their own resume before applying one, and by making the main PDF preview easier to inspect. Keep Local Resume Studio's local files, explicit save flow, Check overlays, and pinned PDF renderer.

## Goals

- Replace the Design template dropdown with a gallery of all 18 templates, including one-column, two-column, and ATS-safe filters.
- Show the template's bundled sample JPG until a lazily generated thumbnail of the current resume is ready.
- Preview a card on the main PDF canvas while it is hovered or focused. Escape and leaving the gallery clear the temporary preview. Clicking a card applies that template to the in-memory draft.
- Keep the applied draft and exported PDF distinct from an uncommitted hover preview.
- Keep the last completed PDF visible while another preview is rendering; provide page zoom controls and a fit-to-width reset.
- Keep Check's selected-issue overlay usable on the applied or temporary template preview.

## Non-goals

- Recreate Reactive Resume's complete editor, stores, routing, history, or undo toast.
- Change the vendored template implementations, the resume JSON schema, local storage, or PDF sanitization/font-fallback policy.
- Claim pixel-perfect parity without comparing the same input PDFs and fonts.

## Approaches

1. Copy the whole upstream web preview and editor integration. This carries its editor stores, route state, query cache, worker wrapper, localization, and proposal/history overlays into a small local app.
2. Keep the current select and improve only the single-PDF canvas. This is the smallest change but leaves template comparison unlike the original gallery.
3. Rebuild the relevant gallery and canvas behavior in the local app, using the pinned Reactive Resume renderer and local state. This preserves the local architecture while restoring the interactions that matter for template comparison. **Selected**, as requested.

## Architecture and behavior

The Design panel owns gallery filtering, card focus/hover state, and apply actions. Temporary template selection is ephemeral UI state in the editor shell; it creates a render-only data copy with `metadata.template` overridden. Only clicking a card dispatches the existing `update-template` edit. Template thumbnails use the same PDF renderer on a safe copy and are rendered lazily with bounded, serialized work; bundled JPGs remain the immediate fallback. The main preview continues to own the PDF.js document lifecycle, page-map overlays, and applied-PDF callback. It retains the previous completed document during a new render and exposes local zoom/fit controls.

If a temporary preview is active, the interface labels it and keeps the download/export callback bound to the applied draft. It must not mark the hover preview as the current downloadable PDF.

## Constraints

- Do not add runtime dependencies or copy the full upstream `apps/web` tree.
- Do not write to resume files while a template is only hovered or focused.
- Use bundled thumbnails as fallbacks, not remote images.
- Reuse existing renderer and PDF.js injection points so tests can supply deterministic implementations.
- Preserve selected Check issue highlighting and existing safe-render warnings.

## Verification

Unit tests cover filters, applying a template, temporary preview/cancel behavior, thumbnail fallback and cancellation, zoom/fit, and retaining the old page during a render. Playwright verifies gallery interaction and that only clicking a template changes the selected draft, then the repository gates and UI suite run against synthetic fixture data.
