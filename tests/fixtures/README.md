# Deterministic PDF test font

`TestSerif.woff` is a local copy of Computer Modern Serif Regular from the `bitmaks/cm-web-fonts`
project (`font/Serif/cmunrm.woff`). It is used only by the PDF renderer tests, which stub network
font and image requests so the 18-template render matrix and the missing-font fallback case stay
deterministic and offline.

Computer Modern is distributed under the SIL Open Font License 1.1. The upstream copyright
attribution includes:

> Copyright (C) Authors of original metafont fonts:
> Donald Ervin Knuth (cm, concrete fonts)
> 1995, 1996, 1997 J"org Knappen, 1990, 1992 Norbert Schwarz (ec fonts)
> 1992-2006 A.Khodulev, O.Lapko, A.Berdnikov, V.Volovich (lh fonts)
> 1997-2005 Claudio Beccari (cb greek fonts)
> 2002 FUKUI Rei (tipa fonts)
> 2003-2005 Han The Thanh (Vietnamese fonts)
> 1996-2005 Walter Schmidt (cmbright fonts)
>
> Copyright (C) 2003-2009, Andrey V. Panov (panov@canopus.iacp.dvo.ru),
> with Reserved Font Family Name "Computer Modern Unicode fonts".

The complete upstream license text is copied verbatim to
[`Computer-Modern-OFL.txt`](./Computer-Modern-OFL.txt) from
<https://github.com/bitmaks/cm-web-fonts/blob/master/LICENSE.txt>.

- Source license URL: <https://raw.githubusercontent.com/bitmaks/cm-web-fonts/master/LICENSE.txt>
- SHA-256: `73273dffdefe2e5f1e138084d4a4b65b1c50df2ab0179f78484f31beefe30d84`

This fixture is not shipped in the application bundle.
