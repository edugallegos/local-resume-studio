# Third-Party Notices

Local Resume Studio is MIT licensed. This file records upstream source and
runtime third-party components relevant to the distributable application. It is
not legal advice; review the linked license text before redistributing.

## Reactive Resume vendor snapshot

- Project: Reactive Resume
- Source: <https://github.com/reactive-resume/reactive-resume>
- Version: v6.1.0
- Commit: `77f5580a67d1e4379978e80410e0cd02ea3fd446`
- License: MIT
- Upstream notice retained at: `vendor/reactive-resume/LICENSE`

Copied workspace packages:

- `@reactive-resume/schema`
- `@reactive-resume/resume`
- `@reactive-resume/fonts`
- `@reactive-resume/pdf`
- `@reactive-resume/utils`
- `@reactive-resume/ui` (selected components and design tokens)

The snapshot also includes selected upstream template preview images under
`vendor/reactive-resume/templates/jpg/`, copied from the same pinned MIT source.
Copied-path details and local changes are documented in
`vendor/reactive-resume/UPSTREAM.md`.

### Upstream MIT notice

```text
MIT License

Copyright (c) 2026 Amruth Pillai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Production dependency tree

The tables below reconcile the complete non-development production dependency
closure for `@local-resume/studio`, checked with:

```bash
pnpm --filter @local-resume/studio list --prod --depth Infinity
```

Each package version and SPDX license below was verified from its installed
`package.json`; source links use the package repository/homepage metadata.
Workspace packages, third-party packages, and browser-bundled transitive packages
are separated for readability. Optional Node-only and type-only entries are scoped
after the browser runtime tables.

This inventory deliberately scopes to `@local-resume/studio` production
dependencies. Root development/typecheck dependencies such as `@types/react` and
`csstype` are outside that filtered production inventory; they are not browser
assets and are not implied to be entries in the production tables below.

### Workspace packages

| Package | Version | License | Source |
| --- | --- | --- | --- |
| `@local-resume/store` | workspace | MIT | This repository |
| `@reactive-resume/pdf` | pinned v6.1.0 | MIT | <https://github.com/reactive-resume/reactive-resume> |
| `@reactive-resume/schema` | pinned v6.1.0 | MIT | <https://github.com/reactive-resume/reactive-resume> |
| `@reactive-resume/resume` | pinned v6.1.0 | MIT | <https://github.com/reactive-resume/reactive-resume> |
| `@reactive-resume/fonts` | pinned v6.1.0 | MIT | <https://github.com/reactive-resume/reactive-resume> |
| `@reactive-resume/utils` | pinned v6.1.0 | MIT | <https://github.com/reactive-resume/reactive-resume> |
| `@reactive-resume/ui` | pinned v6.1.0 | MIT | <https://github.com/reactive-resume/reactive-resume> |

### Third-party runtime packages

These are declared direct dependencies of the app or vendored workspace packages
and are part of the production closure.

| Package | Version | License | Source / license |
| --- | --- | --- | --- |
| `react` | 19.3.1 | MIT | <https://github.com/facebook/react> |
| `react-dom` | 19.3.1 | MIT | <https://github.com/facebook/react> |
| `react-reconciler` | 0.34.0 | MIT | <https://github.com/facebook/react> |
| `immer` | 11.2.9 | MIT | <https://github.com/immerjs/immer> |
| `dompurify` | 3.4.17 | MPL-2.0 OR Apache-2.0 | <https://github.com/cure53/DOMPurify> |
| `pdfjs-dist` | 4.10.38 | Apache-2.0 | <https://github.com/mozilla/pdf.js> |
| `@formepdf/core` | 0.30.0 | MIT | <https://github.com/formepdf/forme> |
| `@formepdf/react` | 0.30.0 | MIT | <https://github.com/formepdf/forme> |
| `fast-png` | 8.0.0 | MIT | <https://github.com/image-js/fast-png> |
| `fflate` | 0.8.3 | MIT | <https://github.com/101arrowz/fflate> |
| `harfbuzzjs` | 1.6.4 | MIT | <https://github.com/harfbuzz/harfbuzzjs> |
| `node-html-parser` | 9.0.7 | MIT | <https://github.com/taoqf/node-fast-html-parser> |
| `zod` | 4.6.7 | MIT | <https://github.com/colinhacks/zod> |
| `@base-ui/react` | 1.9.0 | MIT | <https://github.com/mui/base-ui> |
| `class-variance-authority` | 0.7.1 | Apache-2.0 | <https://github.com/joe-bell/cva> |
| `@phosphor-icons/react` | 2.1.10 | MIT | <https://github.com/phosphor-icons/react> |
| `@uiw/color-convert` | 2.10.3 | MIT | <https://github.com/uiwjs/react-color> |
| `cn` | 0.5.2 | MIT | <https://github.com/shadcn-ui/cn> |
| `uuid` | 14.0.3 | MIT | <https://github.com/uuidjs/uuid> |
| `css-tree` | 3.2.1 | MIT | <https://github.com/csstree/csstree> |
| `@bramus/specificity` | 2.4.3 | MIT | <https://github.com/bramus/specificity> |
| `wink-porter2-stemmer` | 2.0.1 | MIT | <https://github.com/winkjs/wink-porter2-stemmer> |

### Browser-bundled transitive packages

These packages are reachable from the production dependency tree and may be
bundled into the browser build.

| Package | Version(s) | License | Source / license |
| --- | --- | --- | --- |
| `@formepdf/shared` | 0.30.0 | MIT | <https://github.com/formepdf/forme> |
| `@babel/runtime` | 8.1.0 | MIT | <https://github.com/babel/babel> |
| `@base-ui/utils` | 0.5.0 | MIT | <https://github.com/mui/base-ui> |
| `@floating-ui/core` | 1.8.0 | MIT | <https://github.com/floating-ui/floating-ui> |
| `@floating-ui/dom` | 1.8.0 | MIT | <https://github.com/floating-ui/floating-ui> |
| `@floating-ui/react-dom` | 2.1.9 | MIT | <https://github.com/floating-ui/floating-ui> |
| `@floating-ui/utils` | 0.2.12 | MIT | <https://github.com/floating-ui/floating-ui> |
| `boolbase` | 1.0.0 | ISC | <https://github.com/fb55/boolbase> |
| `clsx` | 2.1.1 | MIT | <https://github.com/lukeed/clsx> |
| `css-select` | 5.2.2 | BSD-2-Clause | <https://github.com/fb55/css-select> |
| `css-what` | 6.2.2 | BSD-2-Clause | <https://github.com/fb55/css-what> |
| `dom-serializer` | 2.0.0 | MIT | <https://github.com/cheeriojs/dom-serializer> |
| `domelementtype` | 2.3.0 | BSD-2-Clause | <https://github.com/fb55/domelementtype> |
| `domhandler` | 5.0.3 | BSD-2-Clause | <https://github.com/fb55/domhandler> |
| `domutils` | 3.2.2 | BSD-2-Clause | <https://github.com/fb55/domutils> |
| `entities` | 4.5.0, 6.0.1, 8.1.0 | BSD-2-Clause | <https://github.com/fb55/entities> |
| `iobuffer` | 6.0.1 | MIT | <https://github.com/image-js/iobuffer> |
| `mdn-data` | 2.27.1 | CC0-1.0 | <https://github.com/mdn/data> |
| `nth-check` | 2.1.1 | BSD-2-Clause | <https://github.com/fb55/nth-check> |
| `parse5` | 7.3.0 | MIT | <https://github.com/inikulin/parse5> |
| `reselect` | 5.3.0 | MIT | <https://github.com/reduxjs/reselect> |
| `scheduler` | 0.28.0 | MIT | <https://github.com/facebook/react> |
| `source-map-js` | 1.2.2 | BSD-3-Clause | <https://github.com/7rulnik/source-map-js> |
| `use-sync-external-store` | 1.7.0 | MIT | <https://github.com/facebook/react> |

### Type-only and optional Node-only packages

- `@types/trusted-types@2.0.7` — MIT. This is a type-only production dependency
  of DOMPurify; it provides declarations and is not included in browser assets.
  Source: <https://github.com/DefinitelyTyped/DefinitelyTyped>.
- `pdfjs-dist` declares `@napi-rs/canvas@0.1.100` under `optionalDependencies`.
  Its platform packages are `@napi-rs/canvas-android-arm64`,
  `@napi-rs/canvas-darwin-arm64`, `@napi-rs/canvas-darwin-x64`,
  `@napi-rs/canvas-linux-arm-gnueabihf`, `@napi-rs/canvas-linux-arm64-gnu`,
  `@napi-rs/canvas-linux-arm64-musl`, `@napi-rs/canvas-linux-riscv64-gnu`,
  `@napi-rs/canvas-linux-x64-gnu`, `@napi-rs/canvas-linux-x64-musl`,
  `@napi-rs/canvas-win32-arm64-msvc`, and `@napi-rs/canvas-win32-x64-msvc`
  (all 0.1.100, MIT; <https://github.com/Brooooooklyn/canvas>). These are
  optional Node-only native canvas dependencies. The Studio browser build does
  not include these native packages or native assets; browser PDF rendering uses
  browser canvas APIs.

### License-file review exceptions

License metadata was inspected from every installed package manifest and its
installed license files.

- The local `@local-resume/store` workspace is covered by the root project
  `LICENSE`.
- The vendored `@reactive-resume/*` workspace packages are covered by
  `vendor/reactive-resume/LICENSE`.
- The installed tarballs for `@formepdf/core`, `@formepdf/react`,
  `@formepdf/shared`, `@uiw/color-convert`, and `boolbase` did not include a
  separate license file in this install. Their package metadata declares MIT,
  MIT, MIT, MIT, and ISC respectively; use the linked source repositories for the
  full text.
- All remaining third-party npm packages in the third-party runtime and
  browser-transitive tables have a license file in their installed package
  tarballs, including Apache-2.0, BSD, ISC, and CC0 packages.

This reconciliation covers every non-workspace, non-optional package in the
production dependency tree; optional native and type-only packages are scoped
above rather than presented as browser assets.

## Bundled binaries and generated assets

- Forme WebAssembly (`@formepdf/core`) — MIT.
- HarfBuzz subset WebAssembly (`harfbuzzjs`) — MIT.
- PDF.js worker and related assets (`pdfjs-dist`) — Apache-2.0.
- Generated PDFs may embed fonts selected by the author. Those font files remain
  subject to their own licenses.

## Fonts and font requests

No application font binaries are redistributed in the source tree. The vendored
Reactive Resume font catalog contains URLs to web fonts, primarily Google Fonts
and its configured mirror, plus CDN-hosted catalog fonts such as Computer Modern
on jsDelivr. On first render, the PDF renderer may request those font files from
the provider. The requests contain font resource URLs, not resume text.

Each font remains under the license published by its provider. If a font cannot
be downloaded, the renderer uses its built-in fallback and reports missing font
faces and lost characters locally.

### Test font fixture

- File: `tests/fixtures/TestSerif.woff`
- Source font: Computer Modern Serif from
  <https://github.com/bitmaks/cm-web-fonts>
- Copyright attribution from the upstream license:
  - Copyright (C) Authors of original metafont fonts, including Donald Ervin
    Knuth (cm, concrete fonts); J"org Knappen and Norbert Schwarz (ec fonts);
    A. Khodulev, O. Lapko, A. Berdnikov, and V. Volovich (lh fonts); Claudio
    Beccari (cb greek fonts); FUKUI Rei (tipa fonts); Han The Thanh (Vietnamese
    fonts); and Walter Schmidt (cmbright fonts).
  - Copyright (C) 2003-2009, Andrey V. Panov (panov@canopus.iacp.dvo.ru), with
    Reserved Font Family Name "Computer Modern Unicode fonts".
- License: SIL Open Font License 1.1.
- Full license text: [`tests/fixtures/Computer-Modern-OFL.txt`](tests/fixtures/Computer-Modern-OFL.txt),
  copied verbatim from
  <https://github.com/bitmaks/cm-web-fonts/blob/master/LICENSE.txt>.
- Source license URL:
  <https://raw.githubusercontent.com/bitmaks/cm-web-fonts/master/LICENSE.txt>
- SHA-256 of the copied license text:
  `73273dffdefe2e5f1e138084d4a4b65b1c50df2ab0179f78484f31beefe30d84`.
- Scope: test-only, deterministic PDF renderer tests; not included in the
  application bundle.

See `tests/fixtures/README.md` for the fixture note.

## Preserving notices

Keep `vendor/reactive-resume/LICENSE`, this file, and the linked upstream notices
when redistributing the application. If a runtime dependency, bundled binary,
font, or template asset changes, inspect its installed license metadata and
update this file before release.
