// Schulheft – Dateien anlegen und umbenennen, so dass es auf Windows, macOS und Linux gleich funktioniert.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Windows: Pfade über 260 Zeichen machen vielen Programmen (Explorer, Word, Papierkorb) Probleme → vorher ablehnen
export const WIN_MAX_PATH = 250;
export function checkPathLength(absPath, platform = process.platform) {
  if (platform === 'win32' && absPath.length > WIN_MAX_PATH)
    throw new Error(`Der Pfad wäre zu lang für Windows (${absPath.length} Zeichen, höchstens ${WIN_MAX_PATH}). Bitte einen kürzeren Namen wählen oder weniger Unterordner verwenden.`);
  return absPath;
}

export const nfc = s => String(s ?? '').normalize('NFC');
// Gleicher Name bis auf Groß-/Kleinschreibung oder Unicode-Form (é als ein oder zwei Zeichen)?
export const sameNameLoosely = (a, b) => nfc(a).toLowerCase() === nfc(b).toLowerCase();

// Zeigen zwei Pfade auf dieselbe Datei? (Windows und macOS unterscheiden Groß-/Kleinschreibung meist nicht)
export async function sameFile(a, b) {
  try {
    const [x, y] = await Promise.all([fs.stat(a, { bigint: true }), fs.stat(b, { bigint: true })]);
    if (x.ino !== 0n && x.dev === y.dev && x.ino === y.ino) return true;
    const [ra, rb] = await Promise.all([fs.realpath(a), fs.realpath(b)]);
    return ra === rb;
  } catch { return false; }
}

// Ist "to" nur eine andere Schreibweise von "from" (notiz.md → Notiz.md) und dieselbe Datei auf der Platte?
export async function isCaseVariant(from, to) {
  return from !== to && path.dirname(from) === path.dirname(to) && sameNameLoosely(path.basename(from), path.basename(to)) && sameFile(from, to);
}

// Umbenennen, ohne etwas zu überschreiben. Nur Groß-/Kleinschreibung geändert: über einen Zwischennamen (geht überall).
// Wirft { code: 'EEXIST' }, wenn es das Ziel (als andere Datei) schon gibt.
export async function renameSafe(from, to) {
  if (from === to) return to;
  const exists = await fs.lstat(to).then(() => true, () => false);
  if (exists && !(await isCaseVariant(from, to))) throw Object.assign(new Error('Gibt es schon'), { code: 'EEXIST' });
  if (!exists) { await fs.rename(from, to); return to; }
  const tmp = path.join(path.dirname(from), `.schulheft-umbenennen-${crypto.randomBytes(4).toString('hex')}`);
  await fs.rename(from, tmp);
  try { await fs.rename(tmp, to); }
  catch (e) { await fs.rename(tmp, from).catch(() => {}); throw e; }
  return to;
}

// Anfang einer Notiz bis zum schließenden --- des Kopfes lesen (nicht die ganze Datei).
// Liest in Stücken weiter, bis der Kopf zu ist; höchstens `cap` Bytes (sonst ist es kein sinnvoller Kopf).
const FRONT_START = /^﻿?---\r?\n/, FRONT_CLOSE = /\r?\n---[ \t]*(?:\r?\n|$)/;
export async function readHead(fileAbs, cap = 64 * 1024, chunk = 4096) {
  const fh = await fs.open(fileAbs);
  try {
    let buf = Buffer.alloc(0);
    while (buf.length < cap) {
      const { buffer, bytesRead } = await fh.read(Buffer.alloc(Math.min(chunk, cap - buf.length)), 0, Math.min(chunk, cap - buf.length), buf.length);
      if (!bytesRead) break;
      buf = Buffer.concat([buf, buffer.subarray(0, bytesRead)]);
      const text = buf.toString('utf8');
      if (text.length >= 4 && !FRONT_START.test(text)) break;               // kein Kopf
      const start = text.match(FRONT_START);
      if (start && FRONT_CLOSE.test(text.slice(start[0].length - 1))) break;  // Kopf zu
    }
    return buf.toString('utf8');
  } finally { await fh.close(); }
}
