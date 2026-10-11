// Schulheft – Texterkennung (OCR) mit tesseract.js (WebAssembly, läuft auf Windows, macOS und Linux).
// Sprachdaten Deutsch + Englisch liegen im Programm (vendor/tessdata, „fast“-Modelle) → kein Download, geht auch offline.
// Ein einziger Worker-Thread (blockiert den Server nicht); Aufrufer reihen die Aufträge nacheinander ein.
// Ergebnis wie früher bei Apple Vision: { width, height, lines: [{ text, x, y, w, h, words: [{ text, x, y, w, h }] }] }
// Koordinaten in Pixeln des (aufrecht gedrehten) Bildes, Ursprung oben links.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LANG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'tessdata');
const LANGS = ['deu', 'eng'];
const MIN_CONF = 20;          // Wörter mit weniger Sicherheit (0–100) sind fast immer Rauschen
const IDLE_MS = 120000;       // Worker nach 2 Minuten ohne Arbeit beenden (gibt Speicher frei)

let workerP = null, idleTimer = null;

async function getWorker() {
  workerP ??= (async () => {
    const { createWorker, OEM, PSM } = (await import('tesseract.js')).default;
    const w = await createWorker(LANGS, OEM.LSTM_ONLY, {
      langPath: LANG_PATH, gzip: true,
      cacheMethod: 'none',     // nichts in den Programmordner (oder sonstwohin) schreiben
      logger: () => {},
      errorHandler: () => {},  // Fehler kommen über recognize() zurück
    });
    await w.setParameters({ tessedit_pageseg_mode: PSM.AUTO, debug_file: '/dev/null' });   // /dev/null im WebAssembly-Dateisystem: keine Meldungen auf der Konsole
    return w;
  })().catch(e => { workerP = null; throw e; });
  return workerP;
}

export async function stopOcr() {
  clearTimeout(idleTimer);
  const p = workerP; workerP = null;
  if (p) await p.then(w => w.terminate(), () => {});
}

// TSV von Tesseract → Zeilen mit Wörtern. Spalten: level page block par line word left top width height conf text
export function parseTsv(tsv) {
  let width = 0, height = 0;
  const lines = new Map();
  for (const row of String(tsv || '').split('\n')) {
    const c = row.split('\t');
    if (c.length < 12 || !/^\d+$/.test(c[0])) continue;
    const [level, , block, par, line, , x, y, w, h, conf] = c.slice(0, 11).map(Number);
    const text = c.slice(11).join('\t').trim();
    const key = `${block}.${par}.${line}`;
    if (level === 1) { width = Math.max(width, x + w); height = Math.max(height, y + h); }
    else if (level === 4) lines.set(key, { text: '', x, y, w, h, words: [] });
    else if (level === 5 && text && conf >= MIN_CONF && lines.has(key)) lines.get(key).words.push({ text, x, y, w, h });
  }
  const out = [];
  for (const l of lines.values()) {
    if (!l.words.length) continue;
    // Wörter bekommen Höhe und Oberkante der Zeile (wie bei Apple Vision) → gleichmäßige Textebene im Betrachter
    const words = l.words.map(wd => ({ ...wd, y: l.y, h: l.h }));
    out.push({ text: words.map(wd => wd.text).join(' '), x: l.x, y: l.y, w: l.w, h: l.h, words });
  }
  return { width, height, lines: out };
}

// Bild (Buffer mit PNG/JPEG/WebP …) erkennen. Bricht nach timeout ms ab (Worker wird dann neu gestartet).
export async function recognize(buf, { timeout = 180000 } = {}) {
  clearTimeout(idleTimer);
  const w = await getWorker();
  let timer;
  try {
    const res = await Promise.race([
      w.recognize(buf, {}, { text: false, tsv: true }),
      new Promise((_, no) => { timer = setTimeout(() => no(new Error('Zeitüberschreitung')), timeout); }),
    ]);
    return parseTsv(res.data.tsv);
  } catch (e) {
    await stopOcr();   // nach Fehler oder Zeitüberschreitung frisch anfangen
    throw e;
  } finally {
    clearTimeout(timer);
    if (workerP) { idleTimer = setTimeout(stopOcr, IDLE_MS); idleTimer.unref(); }
  }
}
