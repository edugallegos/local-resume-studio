# Deterministic PDF test font

`TestSerif.woff` is a local copy of Computer Modern Serif Regular from the `bitmaks/cm-web-fonts`
project (`font/Serif/cmunrm.woff`). It is used only by the PDF renderer tests, which stub network
font and image requests so the 18-template render matrix and the missing-font fallback case stay
deterministic and offline.

Computer Modern is distributed under the SIL Open Font License 1.1. This fixture is not shipped in
the application bundle.
