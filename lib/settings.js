// Schulheft – Einstellungen, die zu den Notizen gehören (Unterrichtszeiten, Stundenplan).
// Liegen IM Notizordner: <Notizordner>/.schulheft/einstellungen.json → wandern mit den Notizen mit und bleiben bei Updates erhalten.
// Format siehe normalizeSettings in lib/lesson.js. Unbekannte Schlüssel bleiben beim Schreiben erhalten.
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeAtomic } from './config.js';
import { normalizeSettings } from './lesson.js';

export const settingsFile = root => path.join(root, '.schulheft', 'einstellungen.json');

export async function readSettings(root) {
  const f = settingsFile(root);
  let text;
  try { text = await fs.readFile(f, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return normalizeSettings({}); throw e; }
  try {
    const s = JSON.parse(text.replace(/^﻿/, ''));
    if (s && typeof s === 'object' && !Array.isArray(s)) return normalizeSettings(s);
  } catch { /* unten */ }
  // Kaputte Datei nicht überschreiben: zur Seite legen, mit leeren Einstellungen weiter
  const keep = `${f}.kaputt-${Date.now()}`;
  await fs.rename(f, keep).catch(() => {});
  console.error(`Einstellungen im Notizordner unlesbar, gesichert als ${keep}`);
  return normalizeSettings({});
}

// patch: nur die angegebenen Schlüssel ersetzen (z. B. { zeiten, stundenplan }), alles andere bleibt
export async function saveSettings(root, patch) {
  const cur = await readSettings(root);
  const next = normalizeSettings({ ...cur, ...patch });
  await writeAtomic(settingsFile(root), JSON.stringify(next, null, 2) + '\n');
  return next;
}
