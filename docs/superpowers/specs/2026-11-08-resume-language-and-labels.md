# Resume Language and Editable Section Labels

## Intent

Restore Reactive Resume's per-resume language control and make printed section headings editable in Local Resume Studio.

## Requirements

- The setting is the resume's output locale, not the Studio interface language.
- Offer the pinned locale set with human-readable language names. Exclude development pseudo-locales.
- Explain that locale affects default section headings, date words, and text direction; it does not translate authored content.
- Keep the locale stored in `metadata.page.locale` and preserve the existing v6.1.0 JSON shape.
- Resolve default headings through the pinned PDF section-title catalog so Write, Design, and PDF output agree.
- Let users edit section headings for summary and sections exposed by the native Write panel. Clearing a custom heading restores the locale's default.
- Locale changes must preserve authored content, custom headings, unknown fields, and all unrelated metadata.
- Keep headings editable as ordinary resume content and retain standard ATS-friendly defaults.

## Non-goals

- Translating resume content.
- Changing the Studio interface language.
- Adding or migrating resume schema fields.
- Adding a new runtime dependency or copying the upstream web app.

## Verification

- Cover locale choices and persistence, localized fallback headings, custom heading edits, reset-to-default, and preservation of unrelated resume data.
- Run repository gates and use Codex UI verification on a synthetic resume with a temporary data root.
