// Schulheft – wo was liegt. Programm, Einstellungen, Zwischenspeicher und Notizen sind getrennt:
//   Programmordner: wird nur gelesen (ein Update ersetzt ihn komplett)
//   Einstellungen:  config.json im Config-Ordner (pro Nutzer)
//   Zwischenspeicher (OCR, PDF-Text): Cache-Ordner (pro Nutzer, darf jederzeit gelöscht werden)
//   Notizen: frei wählbarer Notizordner (steht in config.json)
// platform/env/home lassen sich übergeben (Tests, Electron); sonst gilt das echte System.
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';

export const APP = 'Schulheft';

const sys = (o = {}) => ({ platform: o.platform || process.platform, env: o.env || process.env, home: o.home || os.homedir() });
// path-Variante zur Plattform (so lässt sich Windows auch auf dem Mac prüfen)
export const pathFor = platform => (platform === 'win32' ? path.win32 : path.posix);
const xdg = (v, P) => (v && P.isAbsolute(v) ? v : null);   // relative XDG-Pfade gelten laut Spezifikation nicht

// Windows: %APPDATA%\Schulheft · macOS: ~/Library/Application Support/Schulheft · Linux: $XDG_CONFIG_HOME/schulheft
export function configDir(o) {
  const { platform, env, home } = sys(o), P = pathFor(platform);
  if (env.SCHULHEFT_CONFIG_DIR) return P.resolve(env.SCHULHEFT_CONFIG_DIR);
  if (platform === 'win32') return P.join(env.APPDATA || P.join(home, 'AppData', 'Roaming'), APP);
  if (platform === 'darwin') return P.join(home, 'Library', 'Application Support', APP);
  return P.join(xdg(env.XDG_CONFIG_HOME, P) || P.join(home, '.config'), 'schulheft');
}

// Windows: %LOCALAPPDATA%\Schulheft\Cache · macOS: ~/Library/Caches/Schulheft · Linux: $XDG_CACHE_HOME/schulheft
export function cacheDir(o) {
  const { platform, env, home } = sys(o), P = pathFor(platform);
  if (env.SCHULHEFT_CACHE_DIR) return P.resolve(env.SCHULHEFT_CACHE_DIR);
  if (platform === 'win32') return P.join(env.LOCALAPPDATA || P.join(home, 'AppData', 'Local'), APP, 'Cache');
  if (platform === 'darwin') return P.join(home, 'Library', 'Caches', APP);
  return P.join(xdg(env.XDG_CACHE_HOME, P) || P.join(home, '.cache'), 'schulheft');
}

// Vorschlag beim ersten Start: <Dokumente>/Schulheft (auf Windows ebenfalls ~/Documents)
export function defaultDataRoot(o) {
  const { platform, home } = sys(o);
  return pathFor(platform).join(home, 'Documents', APP);
}

// Ist der Ordner als Notizordner erlaubt? Gibt den vollständigen Pfad zurück oder wirft einen Fehler (Text für die Nutzerin).
// Nicht erlaubt: ganzes Laufwerk, der Benutzerordner selbst, Notizordner im Programmordner oder umgekehrt.
export function checkDataRoot(input, o = {}) {
  const { platform, home } = sys(o), P = pathFor(platform);
  let s = String(input ?? '').trim();
  if (!s) throw new Error('Bitte einen Ordner angeben.');
  if (s === '~' || /^~[\\/]/.test(s)) s = P.join(home, s.slice(1));
  if (!P.isAbsolute(s)) throw new Error(`Bitte den vollständigen Pfad angeben, z. B. ${defaultDataRoot(o)}`);
  const root = P.resolve(s);
  // Windows und macOS unterscheiden Groß-/Kleinschreibung im Dateisystem meist nicht
  const key = x => { x = P.resolve(x); return platform === 'win32' || platform === 'darwin' ? x.toLowerCase() : x; };
  const within = (a, b) => a === b || a.startsWith(b.endsWith(P.sep) ? b : b + P.sep);
  if (P.parse(root).root === root) throw new Error('Ein ganzes Laufwerk geht nicht – bitte einen Unterordner wählen.');
  if (key(root) === key(home)) throw new Error('Der Benutzerordner selbst geht nicht – bitte einen Unterordner wählen, z. B. Documents/Schulheft.');
  if (o.appDir) {
    const r = key(root), a = key(o.appDir);
    if (within(r, a) || within(a, r)) throw new Error('Notizordner und Programmordner müssen getrennt sein (ein Update ersetzt den Programmordner).');
  }
  return root;
}

// Wirklicher Pfad (Symlinks aufgelöst), auch wenn der Ordner noch nicht existiert: nächsten vorhandenen Elternordner auflösen
export function realish(p) {
  const rest = [];
  for (let cur = path.resolve(p); ; cur = path.dirname(cur)) {
    try { return path.join(fs.realpathSync.native(cur), ...rest.reverse()); } catch { /* weiter nach oben */ }
    if (path.dirname(cur) === cur) return path.resolve(p);
    rest.push(path.basename(cur));
  }
}

// Pfad aus der App (relativ zum Notizordner, mit /) → absoluter Pfad, nur wenn er im Notizordner bleibt (sonst null)
export function insideRoot(root, rel, P = path) {
  const p = P.resolve(root, String(rel).replace(/^[\\/]+/, ''));
  return p === root || p.startsWith(root.endsWith(P.sep) ? root : root + P.sep) ? p : null;
}

// Kennung des Notizordners für den Browser (gemerkte Tabs gehören zu genau einem Ordner)
export const rootId = root => crypto.createHash('sha1').update(String(root)).digest('hex').slice(0, 12);
