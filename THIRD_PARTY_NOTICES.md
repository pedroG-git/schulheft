# Third-party notices

Schulheft itself is MIT-licensed (see `LICENSE`). It uses the following
third-party components, each under its own license. Their full license texts
are included in the respective packages under `node_modules/` (and will be
shipped with the installer).

| Component | License | Notes |
|---|---|---|
| CodeMirror 6 (`codemirror`, `@codemirror/*`, `@lezer/highlight`) | MIT | editor |
| marked | MIT | Markdown rendering |
| pdf-lib, @pdf-lib/fontkit | MIT | PDF editing and export |
| pdfjs-dist | Apache-2.0 | PDF viewer |
| Liberation Sans (bundled with pdfjs-dist) | SIL Open Font License 1.1 | font for PDF export |
| tesseract.js, tesseract.js-core | Apache-2.0 | text recognition (OCR) |
| tessdata_fast `deu`, `eng` (`vendor/tessdata/`) | Apache-2.0 | OCR language data, see `vendor/tessdata/` |
| heic-convert, heic-decode | ISC | HEIC photo conversion |
| libheif-js | **LGPL-3.0** | HEIC decoder; used unmodified as a separate, replaceable module. Source: https://github.com/catdad-experiments/libheif-js |
| Electron | MIT (Chromium: BSD-style and others) | desktop app; `LICENSE.electron.txt` and `LICENSES.chromium.html` are in the install folder |
| electron-updater | MIT | automatic updates from GitHub Releases |
| esbuild, electron-builder | MIT | build tools only (not shipped) |

HEIC/HEVC decoding may be subject to patents in some countries; this notice
makes no statement about them.
