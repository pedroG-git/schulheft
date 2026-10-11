import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { embedTextFont, pdfSafe } from '../src/pdftext.js';

const FONT = new URL('../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf', import.meta.url);
const SAMPLE = '→ ä ö ü ß € ✓ 漢';

async function draw(fontBytes) {
  const doc = await PDFDocument.create();
  const font = await embedTextFont(doc, fontBytes);
  const text = pdfSafe(SAMPLE, font);
  doc.addPage().drawText(text, { x: 20, y: 20, size: 12, font });
  const bytes = await doc.save();
  assert.ok(bytes.length > 500);
  return text;
}

test('PDF-Export mit Unicode-Schrift: Umlaute, ß, €, → bleiben erhalten', async () => {
  const text = await draw(readFileSync(FONT));
  assert.match(text, /^→ ä ö ü ß €/);
  assert.ok(text.endsWith('?'), 'Zeichen ohne Glyphe wird ersetzt statt abzubrechen');
});

test('PDF-Export ohne Schriftdatei: Helvetica mit Ersatzzeichen, kein Fehler', async () => {
  const text = await draw(null);
  assert.match(text, /^-> ä ö ü ß €/);
});

test('PDF-Export mit kaputter Schriftdatei fällt auf Helvetica zurück', async () => {
  const text = await draw(new Uint8Array([1, 2, 3, 4]));
  assert.match(text, /^-> /);
});
