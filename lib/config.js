// Schulheft – Einstellungen in config.json (im Config-Ordner, siehe lib/paths.js)
// { "dataRoot": "<Notizordner>", "configVersion": 1, … } – unbekannte Schlüssel bleiben beim Schreiben erhalten
// (neuere Versionen speichern dort weitere Einstellungen).
import fs from 'node:fs/promises';
import path from 'node:path';

export const CONFIG_VERSION = 1;
export const configFile = dir => path.join(dir, 'config.json');

export async function readConfig(dir) {
  const f = configFile(dir);
  let text;
  try { text = await fs.readFile(f, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
  try {
    const c = JSON.parse(text);
    if (c && typeof c === 'object' && !Array.isArray(c)) return c;
  } catch { /* unten */ }
  // Kaputte Datei nicht stillschweigend überschreiben: zur Seite legen, mit leeren Einstellungen weiter
  const keep = `${f}.kaputt-${Date.now()}`;
  await fs.rename(f, keep).catch(() => {});
  console.error(`Einstellungen unlesbar, gesichert als ${keep}`);
  return {};
}

// Datei schreiben: erst Temp-Datei, dann umbenennen (nie halb geschrieben)
export async function writeAtomic(f, text) {
  const tmp = `${f}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`;
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(tmp, text, 'utf8');
  // Windows: Virenscanner/Indexer halten die Datei manchmal kurz fest → ein paar Mal neu versuchen
  for (let i = 0; ; i++) {
    try { await fs.rename(tmp, f); return; } catch (e) {
      if (i >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) { await fs.rm(tmp, { force: true }); throw e; }
      await new Promise(r => setTimeout(r, 50 * (i + 1)));
    }
  }
}

// Ganze Datei schreiben
export async function saveConfig(dir, cfg) {
  await writeAtomic(configFile(dir), JSON.stringify({ configVersion: CONFIG_VERSION, ...cfg }, null, 2) + '\n');
}

// Einzelne Werte ändern, alles andere bleibt
export async function updateConfig(dir, patch) {
  const cfg = { ...(await readConfig(dir)), ...patch };
  await saveConfig(dir, cfg);
  return cfg;
}

// ── Updates: Migrationen ────────────────────────────────────────
// Ändert eine neue Version das Format der Einstellungen oder der Dateien im Notizordner,
// erhöht sie CONFIG_VERSION und trägt hier eine Migration ein. Beim Start laufen alle fehlenden der Reihe nach,
// danach wird configVersion gespeichert (jede Migration läuft also nur einmal).
// REGEL: Eine Migration, die Dateien der Nutzerin ändert (Notizen, Anmerkungen …), kopiert sie VORHER
// in eine Sicherung (z. B. <Notizordner>/_Sicherung/<Datum>/) – Nutzerdaten nie ohne Kopie umschreiben.
// Bisher gibt es keine Migration.
export const MIGRATIONS = [
  // { to: 2, run: async (cfg, ctx) => { …; return cfg; } },
];

export async function loadConfig(dir, ctx = {}, migrations = MIGRATIONS) {
  let cfg = await readConfig(dir);
  if (!Object.keys(cfg).length) return cfg;   // noch nichts eingerichtet
  const v = cfg.configVersion ?? 1;
  if (v > CONFIG_VERSION) { console.error(`config.json stammt von einer neueren Version (${v}) – wird nur gelesen, nicht umgebaut`); return cfg; }
  for (const m of [...migrations].sort((a, b) => a.to - b.to)) {
    if (m.to <= v) continue;
    cfg = { ...(await m.run(cfg, ctx)), configVersion: m.to };
    await saveConfig(dir, cfg);
  }
  return cfg;
}
