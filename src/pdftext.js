// Schrift für Text-Anmerkungen beim PDF-Export.
// Bevorzugt Liberation Sans (Unicode, SIL OFL, wie Arial geschnitten; kommt mit pdfjs-dist, liegt in dist/).
// Fehlt die Datei, nimmt sie Helvetica und ersetzt Zeichen, die WinAnsi nicht kennt – der Export bricht nie ab.
import { StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const WINANSI_FIX = { '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '⇐': '<=', '≈': '~', '≤': '<=', '≥': '>=', '≠': '!=', '✓': 'v', '✔': 'v', '✗': 'x', '−': '-', '–': '-', '—': '-', '„': '"', '“': '"', '”': '"', '‚': "'", '‘': "'", '’': "'", '…': '...' };

// fontBytes: ArrayBuffer/Uint8Array einer TTF-Datei oder null
export async function embedTextFont(doc, fontBytes) {
  if (fontBytes) {
    try {
      doc.registerFontkit(fontkit);
      return await doc.embedFont(fontBytes, { subset: true });
    } catch { /* kaputte Schriftdatei → Standardschrift */ }
  }
  return doc.embedFont(StandardFonts.Helvetica);
}

// Text so umbauen, dass die Schrift jedes Zeichen darstellen kann
export function pdfSafe(s, font) {
  const glyphs = font.embedder?.font;   // eingebettete TTF (fontkit) – sonst Standardschrift
  let out = '';
  for (const ch of s) {
    if (glyphs?.hasGlyphForCodePoint) {
      if (glyphs.hasGlyphForCodePoint(ch.codePointAt(0))) out += ch;
      else out += [...(WINANSI_FIX[ch] ?? '?')].every(c => glyphs.hasGlyphForCodePoint(c.codePointAt(0))) ? (WINANSI_FIX[ch] ?? '?') : '?';
      continue;
    }
    for (const c of [ch, WINANSI_FIX[ch], '?']) {
      if (c == null) continue;
      try { font.encodeText(c); out += c; break; } catch { /* nächste Möglichkeit */ }
    }
  }
  return out;
}
