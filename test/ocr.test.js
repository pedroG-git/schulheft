// Texterkennung (tesseract.js, Sprachdaten im Programm) und HEIC → JPEG – ohne Netz, ohne Schreiben im Programmordner
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recognize, parseTsv, stopOcr, LANG_PATH } from '../lib/ocr.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = name => fs.readFile(path.join(APP, 'test', 'fixtures', name));
after(stopOcr);

// Programmordner (ohne node_modules/.git): Namen, Größe, Änderungszeit
async function snapshot(dir = APP, out = new Map()) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (dir === APP && (e.name === 'node_modules' || e.name === '.git')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { out.set(p, 'dir'); await snapshot(p, out); } else { const st = await fs.stat(p); out.set(p, `${st.size}:${st.mtimeMs}`); }
  }
  return out;
}

test('Sprachdaten Deutsch + Englisch liegen im Programm', async () => {
  for (const l of ['deu', 'eng']) assert.ok((await fs.stat(path.join(LANG_PATH, `${l}.traineddata.gz`))).size > 100000, l);
});

test('TSV → Zeilen mit Wörtern (Höhe der Zeile, unsichere Wörter raus)', () => {
  const tsv = [
    '1\t1\t0\t0\t0\t0\t0\t0\t800\t600\t-1\t',
    '4\t1\t1\t1\t1\t0\t10\t20\t300\t40\t-1\t',
    '5\t1\t1\t1\t1\t1\t10\t25\t100\t30\t95.5\tHallo',
    '5\t1\t1\t1\t1\t2\t120\t22\t190\t35\t91\tWelt',
    '5\t1\t1\t1\t1\t3\t320\t22\t5\t5\t3\t~',
    '4\t1\t1\t1\t2\t0\t10\t80\t50\t10\t-1\t',
    '5\t1\t1\t1\t2\t1\t10\t80\t50\t10\t5\t|',
  ].join('\n');
  assert.deepEqual(parseTsv(tsv), {
    width: 800, height: 600,
    lines: [{ text: 'Hallo Welt', x: 10, y: 20, w: 300, h: 40, words: [
      { text: 'Hallo', x: 10, y: 20, w: 100, h: 40 }, { text: 'Welt', x: 120, y: 20, w: 190, h: 40 }] }],
  });
});

test('Bild mit bekanntem Text → { width, height, lines[{ text, x, y, w, h, words }] }, nichts im Programmordner geschrieben', async () => {
  const before = await snapshot();
  const r = await recognize(await fixture('ocr-text.png'));
  assert.equal(r.width, 640);
  assert.equal(r.height, 180);
  assert.equal(r.lines.length, 2, JSON.stringify(r));
  const text = r.lines.map(l => l.text).join(' ').toLowerCase();
  for (const w of ['schulheft', 'texterkennung', 'photosynthese']) assert.ok(text.includes(w), `"${w}" nicht in "${text}"`);
  for (const l of r.lines) {
    for (const k of ['x', 'y', 'w', 'h']) assert.equal(typeof l[k], 'number');
    assert.ok(l.x >= 0 && l.y >= 0 && l.x + l.w <= r.width && l.y + l.h <= r.height, 'Zeile im Bild (Pixel, oben links)');
    assert.ok(l.words.length >= 1);
    assert.equal(l.words.map(w => w.text).join(' '), l.text);
  }
  // erste Zeile oben (Text bei y≈30…75 gezeichnet), zweite darunter (y≈100…145)
  assert.ok(r.lines[0].y > 15 && r.lines[0].y < 50 && r.lines[1].y > 85 && r.lines[1].y < 120, JSON.stringify(r.lines.map(l => l.y)));
  assert.deepEqual([...(await snapshot())], [...before], 'Programmordner wurde verändert');
});

test('HEIC (iPhone-Foto) → JPEG ohne Systemprogramme', async () => {
  const { default: convert } = await import('heic-convert');
  const jpg = Buffer.from(await convert({ buffer: await fixture('tiny.heic'), format: 'JPEG', quality: 0.9 }));
  assert.deepEqual([...jpg.subarray(0, 3)], [0xff, 0xd8, 0xff]);   // JPEG-Kennung
  // Größe aus dem JPEG-Kopf (SOF0/SOF2): 64 × 48
  let i = 2;
  while (i < jpg.length && !(jpg[i] === 0xff && (jpg[i + 1] === 0xc0 || jpg[i + 1] === 0xc2))) i += 2 + jpg.readUInt16BE(i + 2);
  assert.deepEqual([jpg.readUInt16BE(i + 7), jpg.readUInt16BE(i + 5)], [64, 48]);
});
