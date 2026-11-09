# Local ATS Reader View

## Intent

Restore the original editor's ability to inspect what a PDF text parser reads from the generated resume.

## Requirements

- In Check mode, let users switch the preview between the rendered PDF and a parser text view.
- Build parser text from the exact locally generated PDF using the existing vendored ATS harvesting and reading-order extraction.
- Group extracted lines by page and display their geometric reading order, preserving page boundaries.
- Show the fields the local parser recognizes, including contact details, links, section headings, and dates.
- Connect current ATS issues to recognized fields and highlight extracted lines when issue evidence matches.
- Make analysis explicit and local; do not upload the PDF or send resume text to a service.
- Clear or mark parsed output stale when the draft changes. Never show text from an older draft as current.
- Explain that the view reports this local parser's extraction and does not guarantee how every ATS product behaves.
- Report empty text, failed page text reads, and page truncation honestly.

## Non-goals

- Predicting hiring outcomes or vendor-specific ATS decisions.
- Adding another PDF parser, network service, telemetry, or vendor source changes.
- Changing the existing scoring rules or job-match behavior.

## Verification

- Test page grouping, reading order, empty/truncated extraction states, state invalidation after edits, and toggle accessibility.
- Run repository gates and use Codex UI verification on a synthetic resume with a temporary data root.
