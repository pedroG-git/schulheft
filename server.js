// Schulheft – kleiner lokaler Server für die Browser-App.
// Liest und schreibt normale Dateien (Markdown, PDF, Bilder) im Notizordner.
import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync, createReadStream, constants as fsConst } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { configDir, cacheDir, defaultDataRoot, checkDataRoot, realish, insideRoot, rootId } from './lib/paths.js';
import { loadConfig, updateConfig } from './lib/config.js';
import { readSettings, saveSettings } from './lib/settings.js';
import { trash, reveal, openWithDefaultApp, PlatformError, setPlatformActions } from './lib/platform.js';
import { checkPathLength, renameSafe, isCaseVariant, nfc, readHead } from './lib/files.js';
import { recognize } from './lib/ocr.js';
import {
  parseFront, isLesson, lessonInfo, lessonText, isSection, safeName, folderName, isHiddenDir, planMatch, withDue,
  MATERIAL_DIR, IMAGES_DIR, ISO_RE, INBOX_DIR, materialLinkLine, addMaterialLink, removeMaterialLink,
} from './lib/lesson.js';

// Nur für Tests: „Papierkorb“ = dieser Ordner (sonst landen Testdateien im echten Papierkorb)
if (process.env.SCHULHEFT_TEST_TRASH) {
  const bin = path.resolve(process.env.SCHULHEFT_TEST_TRASH);
  setPlatformActions({ trash: async p => { await fs.mkdir(bin, { recursive: true }); await fs.rename(p, path.join(bin, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${path.basename(p)}`)); } });
}

// Programmordner (HERE) wird zur Laufzeit nur gelesen – Einstellungen, Zwischenspeicher und Notizen liegen pro Nutzer woanders (lib/paths.js)
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = configDir(), CACHE_DIR = cacheDir();
const config = await loadConfig(CONFIG_DIR);
// Notizordner: SCHULHEFT_ROOT (Entwicklung) → config.json → noch keiner (dann fragt die App beim Start).
// Kann sich zur Laufzeit ändern (POST /api/setup) → überall ROOT zur Aufrufzeit lesen, nie zwischenspeichern.
let ROOT = null, ROOT_FROM = null, ROOT_PROBLEM = '';
const PUBLIC = path.join(HERE, 'public');
const PORT = Number(process.env.PORT || 4711);
const PLATFORM = process.platform;

const DOC_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp']);
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
// Ausgeblendet: Dateien mit . am Anfang, Ordner mit _ oder . am Anfang (App/System, z. B. _Original, .schulheft)
const hidden = e => e.name.startsWith('.') || (e.isDirectory() && isHiddenDir(e.name));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.map': 'application/json',
};

// ── Hilfsfunktionen ─────────────────────────────────────────────
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

function abs(rel) {
  if (!ROOT) throw new HttpError(409, 'Noch kein Notizordner gewählt');
  if (typeof rel !== 'string') throw new HttpError(400, 'Pfad fehlt');
  if (PLATFORM === 'win32' && rel.includes(':')) throw new HttpError(400, 'Ungültiger Pfad');   // C:…, Datei.md:Stream
  const p = insideRoot(ROOT, rel);
  if (!p) throw new HttpError(403, 'Pfad außerhalb des Ordners');
  if (p.split(path.sep).includes('_app')) throw new HttpError(403, 'Gesperrt');
  return p;
}
const relOf = p => path.relative(ROOT, p).split(path.sep).join('/');
const hash = buf => crypto.createHash('sha1').update(buf).digest('hex');

function cleanName(name) {
  name = safeName(name);
  if (!name) throw new HttpError(400, 'Name fehlt');
  return name;
}
// Neuer Pfad (Datei oder Ordner): auf Windows nicht zu lang
function newPath(p) {
  try { return checkPathLength(p, PLATFORM); } catch (e) { throw new HttpError(400, e.message); }
}
// Aktion des Betriebssystems (Papierkorb, Explorer/Finder …): Fehler mit verständlichem Text an die App
async function osAction(fn, p) {
  try { await fn(p); } catch (e) {
    if (e instanceof PlatformError) throw new HttpError(500, e.message);
    throw e;
  }
}

async function readBody(req, limit = 200 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, 'Zu groß'); chunks.push(c); }
  return Buffer.concat(chunks);
}
const json = async req => JSON.parse((await readBody(req)).toString('utf8') || '{}');

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function tree(dirAbs, filter, withMeta = false) {
  const out = [];
  let entries = [];
  try { entries = await fs.readdir(dirAbs, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (hidden(e)) continue;
    const p = path.join(dirAbs, e.name);
    if (e.isDirectory()) {
      if (withMeta && (e.name === IMAGES_DIR || e.name === MATERIAL_DIR)) continue;   // Bilder und Material nicht in der Notizliste
      const children = await tree(p, filter, withMeta);
      out.push({ name: e.name, path: relOf(p), dir: true, children, lessons: children.reduce((n, c) => n + (c.dir ? c.lessons : c.lesson ? 1 : 0), 0) });
    } else if (filter(e.name)) {
      const node = { name: e.name, path: relOf(p), dir: false };
      if (withMeta && e.name.endsWith('.md')) { const meta = await lessonMeta(p); if (meta) node.lesson = meta; }
      out.push(node);
    }
  }
  return out.sort((a, b) => (b.dir - a.dir) || coll.compare(a.name, b.name));
}

async function allNotes() {
  const files = [];
  async function walk(d) {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (hidden(e)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith('.md')) files.push(p);
    }
  }
  await walk(ROOT);
  return files;
}

async function allDocs() {
  const files = [];
  async function walk(d) {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (hidden(e)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (DOC_EXT.has(path.extname(e.name).toLowerCase())) files.push(p);
    }
  }
  await walk(ROOT);
  return files;
}

const MARKER = /^\s*(!!|EXAM:|TEST:|DEF:|\?\?)|!![^!]+!!|==[^=]+==/;
const TODO = /^\s*[-*] \[( |x|X)\]/;

// Stunden-Notiz? Dann Kopf (--- … ---) mit Fach/Einheit (notfalls aus dem Pfad), sonst null
async function lessonMeta(fileAbs) {
  try {
    const { meta } = parseFront(await readHead(fileAbs));
    return isLesson(meta) ? { ...meta, ...lessonInfo(meta, relOf(fileAbs)) } : null;
  } catch { return null; }
}
const coll = new Intl.Collator('de', { numeric: true });
const lessonSort = (a, b) => (a.meta.datum || '').localeCompare(b.meta.datum || '') || coll.compare(a.meta.zeit || '', b.meta.zeit || '') || coll.compare(a.path, b.path);

// Sicherung und Anmerkungen eines Dokuments liegen in _Original/ neben der Datei
function docSidecar(fileAbs) {
  const dir = path.join(path.dirname(fileAbs), '_Original');
  const ext = path.extname(fileAbs);
  const stem = path.basename(fileAbs, ext);
  return { dir, ext, stem, annots: path.join(dir, `${stem}${ext}.anmerkungen.json`) };
}

async function readAnnots(fileAbs) {
  try { return JSON.parse(await fs.readFile(docSidecar(fileAbs).annots, 'utf8')); } catch { return null; }
}

const pad = n => String(n).padStart(2, '0');
function stamp() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`; }

// ── API ─────────────────────────────────────────────────────────
const api = {
  'GET /api/info': async () => info(),

  // Notizordner wählen (erster Start) oder ändern: { root: "<Pfad>" } → anlegen, in config.json merken, umschalten
  'POST /api/setup': async req => {
    if (ROOT_FROM === 'env') throw new HttpError(409, 'Der Notizordner ist über SCHULHEFT_ROOT festgelegt.');
    const { root: input } = await json(req);
    let root;
    try { root = validRoot(input); } catch (e) { throw new HttpError(400, e.message); }
    try { await fs.mkdir(root, { recursive: true }); } catch (e) { throw new HttpError(400, `Ordner konnte nicht angelegt werden: ${e.message}`); }
    if (!(await fs.stat(root)).isDirectory()) throw new HttpError(400, 'Das ist eine Datei, kein Ordner.');
    await welcomeNote(root);
    Object.assign(config, await updateConfig(CONFIG_DIR, { dataRoot: root }));
    setRoot(root, 'config');
    return info();
  },

  'GET /api/tree': async (req, url) => {
    if (url.searchParams.get('kind') === 'docs')
      return tree(ROOT, n => DOC_EXT.has(path.extname(n).toLowerCase()));
    return tree(ROOT, n => n.endsWith('.md'), true);
  },

  'GET /api/lessons': async (req, url) => {
    // Alle Stunden (optional nur in einem Ordner und seinen Unterordnern), mit Text für die Übersicht
    const dir = url.searchParams.get('dir');
    const base = dir ? abs(dir) : ROOT;
    const full = url.searchParams.get('full') === '1';
    const out = [];
    for (const f of await allNotes()) {
      if (!nfc(f).startsWith(nfc(base) + path.sep)) continue;
      const meta = await lessonMeta(f);
      if (!meta) continue;
      const item = { path: relOf(f), meta };
      if (full) item.text = await fs.readFile(f, 'utf8');
      out.push(item);
    }
    return out.sort(lessonSort);
  },

  // Unterrichtszeiten und Stundenplan (im Notizordner, .schulheft/einstellungen.json)
  'GET /api/settings': async () => readSettings(ROOT),
  'PUT /api/settings': async req => {
    const { zeiten, stundenplan } = await json(req);
    const patch = {};
    if (Array.isArray(zeiten)) patch.zeiten = zeiten;
    if (Array.isArray(stundenplan)) patch.stundenplan = stundenplan;
    return saveSettings(ROOT, patch);
  },

  'GET /api/text': async (req, url) => {
    const p = abs(url.searchParams.get('p'));
    const [text, st] = await Promise.all([fs.readFile(p, 'utf8'), fs.stat(p)]);
    return { text, mtime: st.mtimeMs };
  },

  'PUT /api/text': async (req, url) => {
    const p = abs(url.searchParams.get('p'));
    if (!p.endsWith('.md')) throw new HttpError(400, 'Nur .md-Dateien');
    const body = await json(req);
    if (body.baseMtime && !body.force && !existsSync(p)) throw new HttpError(410, 'Die Notiz gibt es an diesem Ort nicht mehr.');
    if (body.baseMtime && !body.force && existsSync(p)) {
      const st = await fs.stat(p);
      if (Math.abs(st.mtimeMs - body.baseMtime) > 1) throw new HttpError(409, 'Die Datei wurde inzwischen woanders geändert.');
    }
    await fs.writeFile(p, body.text, 'utf8');
    return { mtime: (await fs.stat(p)).mtimeMs };
  },

  'POST /api/new': async req => {
    const { dir, name, type } = await json(req);
    const d = abs(dir);
    if (type === 'folder') {
      const p = newPath(path.join(d, cleanName(name)));
      if (existsSync(p)) throw new HttpError(409, 'Gibt es schon');
      await fs.mkdir(p, { recursive: true });
      return { path: relOf(p) };
    }
    let base = cleanName(name).replace(/\.md$/i, '');
    const p = newPath(path.join(d, base + '.md'));
    if (existsSync(p)) throw new HttpError(409, 'Eine Notiz mit diesem Namen gibt es schon');
    const now = new Date();
    const when = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    await fs.mkdir(d, { recursive: true });
    await fs.writeFile(p, `# ${base}\n_${when}_\n\n`, { encoding: 'utf8', flag: 'wx' });
    return { path: relOf(p) };
  },

  // Neue Stunde: <Fach>/<Einheit>/<Datum Titel>.md. Fehlende Angaben (Feld nicht mitgeschickt) kommen aus dem Stundenplan.
  'POST /api/lesson': async req => {
    const body = await json(req);
    const { datum } = body;
    if (!ISO_RE.test(datum || '')) throw new HttpError(400, 'Datum fehlt');
    const hit = planMatch(await readSettings(ROOT), datum, body.zeit, body.fach);
    // Zeit aus dem Stundenplan in einheitlicher Form ("08:00–09:30", auch bei Doppelstunden)
    const v = k => String((k === 'zeit' && hit ? hit.zeit : body[k]) ?? (hit ? hit[k] : '') ?? '').trim();
    const fach = folderName(v('fach')), einheit = folderName(v('einheit'));
    if (!fach) throw new HttpError(400, 'Fach fehlt');
    const titel = String(body.thema || '').trim() || v('einheit') || v('fach');
    const d = newPath(abs([fach, einheit].filter(Boolean).join('/')));
    const base = safeName(`${datum} ${titel}`, 100);
    newPath(path.join(d, `${base} (99).md`));   // vor dem Anlegen der Ordner prüfen
    await fs.mkdir(d, { recursive: true });
    const text = lessonText({ datum, zeit: v('zeit'), fach: v('fach'), einheit: v('einheit'), lehrkraft: v('lehrkraft'), raum: v('raum'), titel });
    const p = await writeNew(d, i => `${base}${i > 1 ? ` (${i})` : ''}.md`, text);
    return { path: relOf(p), dir: relOf(d) };
  },

  'POST /api/rename': async req => {
    const { p, name } = await json(req);
    const from = abs(p);
    let n = cleanName(name);
    const st = await fs.stat(from);
    if (!st.isDirectory() && path.extname(from) && !path.extname(n)) n += path.extname(from);
    const to = newPath(path.join(path.dirname(from), n));
    if (to === from) return { path: relOf(to) };
    // notiz.md → Notiz.md: auf Windows/macOS „gibt es schon“ (dieselbe Datei) → trotzdem umbenennen
    if (existsSync(to) && !(await isCaseVariant(from, to))) throw new HttpError(409, 'Gibt es schon');
    try { await renameSafe(from, to); } catch (e) { if (e.code === 'EEXIST') throw new HttpError(409, 'Gibt es schon'); throw e; }
    return { path: relOf(to) };
  },

  'POST /api/move': async req => {
    const { p, dir } = await json(req);
    const from = abs(p), to = path.join(abs(dir), path.basename(from));
    if (to === from) return { path: relOf(to) };
    const key = x => PLATFORM === 'linux' ? x : nfc(x).toLowerCase();   // Windows/macOS: Groß-/Kleinschreibung egal
    if (key(to + path.sep).startsWith(key(from + path.sep))) throw new HttpError(400, 'Ein Ordner kann nicht in sich selbst');
    if (existsSync(to)) throw new HttpError(409, 'Im Zielordner gibt es schon eine Datei mit diesem Namen');
    newPath(to);
    await fs.rename(from, to);
    return { path: relOf(to) };
  },

  'POST /api/trash': async req => {
    const { p } = await json(req);
    const target = abs(p);
    if (target === ROOT) throw new HttpError(403, 'Gesperrt');
    if (!existsSync(target)) throw new HttpError(404, 'Datei nicht gefunden');
    await osAction(trash, target);   // Papierkorb des Systems (wiederherstellbar), nie endgültig löschen
    return { ok: true };
  },

  // Im Explorer/Finder/Dateimanager zeigen
  'POST /api/reveal': async req => {
    const { p } = await json(req);
    const target = abs(p);
    if (!existsSync(target)) throw new HttpError(404, 'Datei nicht gefunden');
    await osAction(reveal, target);
    return { ok: true };
  },

  // Dokument (Word, PowerPoint …) mit dem Standardprogramm öffnen. Nur bekannte Dokument-Typen – nie Programme oder Skripte.
  'POST /api/open': async req => {
    const { p } = await json(req);
    const target = abs(p);
    if (!OPEN_EXT.has(path.extname(target).toLowerCase())) throw new HttpError(400, 'Dieser Dateityp wird nicht geöffnet');
    if (!(await fs.stat(target)).isFile()) throw new HttpError(400, 'Keine Datei');
    await osAction(openWithDefaultApp, target);
    return { ok: true };
  },

  'POST /api/upload': async (req, url) => {
    // Bild in eine Notiz einfügen: landet in <Ordner der Notiz>/bilder/
    const dir = abs(url.searchParams.get('dir'));
    const name = cleanName(url.searchParams.get('name') || `bild-${stamp()}.png`);
    if (!IMG_EXT.has(path.extname(name).toLowerCase())) throw new HttpError(400, 'Nur Bilder');
    const e = path.extname(name);
    const p = await writeNew(dir, i => i > 1 ? `${path.basename(name, e)}-${i}${e}` : name, await readBody(req));
    scheduleIndex(2000);   // neues Bild bald im Hintergrund erkennen (für die Suche)
    return { path: relOf(p) };
  },

  'GET /api/search': async (req, url) => {
    const q = nfc(url.searchParams.get('q') || '').trim().toLowerCase();
    if (!q) return { notes: [], docs: [], lines: [], doclines: [] };
    const notes = await allNotes(), docs = await allDocs();
    const lines = [];
    for (const f of notes) {
      if (lines.length >= 80) break;
      const text = nfc(await fs.readFile(f, 'utf8'));
      // Kopfzeilen (--- fach: … ---) nicht als Treffer zeigen – Fach/Einheit findet man über den Dateinamen
      const { meta, body } = parseFront(text);
      const skip = meta ? text.slice(0, text.length - body.length).split(/\r?\n/).length - 1 : 0;
      text.split(/\r?\n/).forEach((l, i) => {
        if (i >= skip && lines.length < 80 && l.toLowerCase().includes(q)) lines.push({ path: relOf(f), line: i + 1, text: l.trim().slice(0, 200) });
      });
    }
    const hit = f => nfc(path.basename(f)).toLowerCase().includes(q);
    return {
      notes: notes.filter(hit).slice(0, 20).map(relOf),
      docs: docs.filter(hit).slice(0, 20).map(relOf),
      lines,
      doclines: await docLines(q),   // Text in PDFs und erkannter Text in Bildern (siehe Texterkennung unten)
    };
  },

  'GET /api/overview': async () => {
    // Alle markierten Zeilen und Aufgaben aus allen Notizen; Hausaufgaben mit Frist (eigene oder nächste Stunde)
    const marked = [], todos = [], lessons = [];
    const notes = [];
    for (const f of await allNotes()) {
      const rel = relOf(f), text = await fs.readFile(f, 'utf8');
      const lesson = lessonInfo(parseFront(text).meta, rel);   // Stunde: Datum, Zeit, Fach, Einheit, Lehrkraft, Raum
      if (lesson) lessons.push(lesson);
      notes.push({ rel, text, lesson });
    }
    const settings = await readSettings(ROOT), today = isoToday();
    for (const { rel, text, lesson } of notes) {
      let heading = '', section = '', fence = false;
      text.split(/\r?\n/).forEach((l, i, all) => {
        if (/^\s*```/.test(l)) fence = !fence;
        if (fence) return;
        const h = l.match(/^(#{1,6})\s+(.*)/);
        if (h) { heading = h[2]; if (h[1].length <= 3) section = h[2]; }
        if (/^\s*(?:[-*+]\s+)?(?:\[[ xX]\]|!!|EXAM:|TEST:|DEF:|\?\?)\s*$/.test(l.replace(/^\s*[-*+]\s+(?=\[)/, ''))) return;   // leere Platzhalter
        if (TODO.test(l)) todos.push(withDue({ path: rel, line: i + 1, text: l.trim(), done: !/\[ \]/.test(l), heading, section, lesson, homework: !!lesson && isSection(section, 'hausaufgabe') }, settings, lessons, today));
        else if (MARKER.test(l)) marked.push({ path: rel, line: i + 1, text: l.trim(), heading, section, lesson, answered: l.includes('→') || /^\s*(?:[-*+]\s+)?→/.test(all[i + 1] || '') });
      });
    }
    return { marked, todos };
  },

  'GET /api/doc': async (req, url) => {
    // Was soll der Betrachter laden? Bei eigenen Anmerkungen: Originaldatei + bearbeitbare Anmerkungen
    const p = abs(url.searchParams.get('p'));
    const cur = hash(await fs.readFile(p));
    const a = await readAnnots(p);
    if (a && a.savedHash === cur && a.base && existsSync(abs(a.base)))
      return { base: a.base, items: a.items || [], editable: true, hasBackup: true };
    return { base: relOf(p), items: [], editable: false, hasBackup: !!(a && a.firstBackup && existsSync(abs(a.firstBackup))) };
  },

  'POST /api/doc/save': async (req, url) => {
    const p = abs(url.searchParams.get('p'));
    const parsed = await json(req);          // { data: base64, items: [...] }
    const sc = docSidecar(p);
    const cur = await fs.readFile(p);
    let a = await readAnnots(p);
    await fs.mkdir(sc.dir, { recursive: true });
    if (!a || a.savedHash !== hash(cur) || !a.base || !existsSync(abs(a.base))) {
      // Erste Bearbeitung (oder Datei wurde woanders geändert): aktuellen Stand sichern
      let backup = path.join(sc.dir, `${sc.stem}_vor-Bearbeitung${sc.ext}`);
      if (existsSync(backup)) backup = path.join(sc.dir, `${sc.stem}_vor-Bearbeitung-${stamp()}${sc.ext}`);
      newPath(backup); newPath(sc.annots);
      await fs.writeFile(backup, cur);
      a = { base: relOf(backup), firstBackup: a?.firstBackup && existsSync(abs(a.firstBackup)) ? a.firstBackup : relOf(backup) };
    }
    const data = Buffer.from(parsed.data, 'base64');
    await fs.writeFile(p, data);
    a.items = parsed.items;
    a.savedHash = hash(data);
    a.saved = new Date().toISOString();
    await fs.writeFile(sc.annots, JSON.stringify(a, null, 1), 'utf8');
    return { ok: true, base: a.base };
  },

  'POST /api/doc/restore': async (req, url) => {
    const p = abs(url.searchParams.get('p'));
    const a = await readAnnots(p);
    if (!a?.firstBackup || !existsSync(abs(a.firstBackup))) throw new HttpError(404, 'Kein Original gefunden');
    await osAction(trash, docSidecar(p).annots);   // erst die Anmerkungen weg (Papierkorb), dann das Original zurück
    await fs.copyFile(abs(a.firstBackup), p);
    return { ok: true };
  },
};

// ── Texterkennung (OCR) und Text aus Dokumenten ─────────────────
// Bilder und eingescannte PDF-Seiten erkennt tesseract.js (lib/ocr.js, Sprachdaten Deutsch + Englisch liegen im Programm).
// Zwischenspeicher (Cache-Ordner, nicht im Programm): ocr/<sha1>.json (Bild) bzw. <sha1-der-PDF>-s<Seite>.json, text/<sha1>.json (PDF-Text).
// Schlüssel = Inhalt der Datei → gilt für jeden Notizordner. Jede Datei/Seite wird nur einmal gelesen.
const CACHE = CACHE_DIR;
const OCR_IMG = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const SCAN_MIN = 20;   // weniger Zeichen auf einer PDF-Seite = eingescannt (gleiche Grenze wie im Betrachter)

// Ein Auftrag nach dem anderen (ein Worker-Thread, der Server bleibt frei); Anfragen aus dem Betrachter vor Hintergrund-Arbeit
const ocrJobs = { hi: [], lo: [] };
let ocrRunning = false;
function ocrQueue(fn, hi) { return new Promise((ok, no) => { ocrJobs[hi ? 'hi' : 'lo'].push({ fn, ok, no }); ocrPump(); }); }
function ocrPump() {
  if (ocrRunning) return;
  const j = ocrJobs.hi.shift() || ocrJobs.lo.shift();
  if (!j) return;
  ocrRunning = true;
  j.fn().then(j.ok, j.no).finally(() => { ocrRunning = false; ocrPump(); });
}

async function runOcr(file, buf) {
  try { return await recognize(buf || await fs.readFile(file)); }
  catch (e) { throw new HttpError(500, 'Texterkennung fehlgeschlagen: ' + String(e?.message || e).trim()); }
}

// HEIC/HEIF (iPhone-Fotos) → JPEG, ohne Systemprogramme (heic-convert, WebAssembly; erst bei Bedarf geladen)
async function heicToJpeg(data) {
  try {
    const { default: convert } = await import('heic-convert');
    return Buffer.from(await convert({ buffer: data, format: 'JPEG', quality: 0.9 }));
  } catch (e) { throw new HttpError(400, 'HEIC-Foto konnte nicht umgewandelt werden: ' + String(e?.message || e)); }
}

async function cacheGet(kind, key) { try { return JSON.parse(await fs.readFile(path.join(CACHE, kind, key + '.json'), 'utf8')); } catch { return null; } }
async function cachePut(kind, key, val) {
  const d = path.join(CACHE, kind), f = path.join(d, key + '.json'), tmp = `${f}.${process.pid}-${Math.random().toString(36).slice(2)}`;
  await fs.mkdir(d, { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(val));
  await fs.rename(tmp, f);
  return val;
}
// Gleiche Arbeit nicht doppelt starten
const inflight = new Map();
function once(key, fn) { if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key))); return inflight.get(key); }

const hashMemo = new Map();
async function fileHash(p) {
  const st = await fs.stat(p), m = hashMemo.get(p);
  if (m && m.mtime === st.mtimeMs && m.size === st.size) return m.hash;
  const h = hash(await fs.readFile(p));
  hashMemo.set(p, { mtime: st.mtimeMs, size: st.size, hash: h });
  return h;
}
// Bearbeitete Dokumente zeigt der Betrachter als Original + Anmerkungen → Text aus dem Original lesen (wie GET /api/doc)
async function textSource(fileAbs) {
  const a = await readAnnots(fileAbs);
  if (a?.base && a.savedHash) {
    try { const b = abs(a.base); if (existsSync(b) && a.savedHash === await fileHash(fileAbs)) return b; } catch { /* Original fehlt */ }
  }
  return fileAbs;
}

async function ocrImage(fileAbs, hi) {
  const src = await textSource(fileAbs), key = await fileHash(src);
  return (await cacheGet('ocr', key)) || once(key, () => ocrQueue(async () => (await cacheGet('ocr', key)) || cachePut('ocr', key, await runOcr(src)), hi));
}

let pdfjsNode;
async function pdfText(fileAbs) {
  const src = await textSource(fileAbs), key = await fileHash(src);
  const c = await cacheGet('text', key);
  if (c) return { key, pages: c.pages };
  return once('t' + key, async () => {
    pdfjsNode ??= import(new URL('./node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url));
    const pdfjs = await pdfjsNode;
    const task = pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(src)), isEvalSupported: false, verbosity: 0 });
    const doc = await task.promise;
    const pages = [];
    try {
      for (let i = 1; i <= doc.numPages; i++) {
        const tc = await (await doc.getPage(i)).getTextContent();
        pages.push(tc.items.map(it => (it.str || '') + (it.hasEOL ? '\n' : '')).join(''));
      }
    } finally { task.destroy(); }
    await cachePut('text', key, { pages });
    return { key, pages };
  });
}

const ocrText = r => (r.lines || []).map(l => l.text).join('\n');
const isScanText = t => t.replace(/\s/g, '').length < SCAN_MIN;
// Text eines Dokuments, Seite für Seite (Bilder und Scans nur, wenn schon erkannt)
async function docPages(fileAbs) {
  const ext = path.extname(fileAbs).toLowerCase();
  if (OCR_IMG.has(ext)) { const r = await cacheGet('ocr', await fileHash(await textSource(fileAbs))); return r ? [ocrText(r)] : []; }
  if (ext !== '.pdf') return [];
  const { key, pages } = await pdfText(fileAbs);
  return Promise.all(pages.map(async (t, i) => {
    if (!isScanText(t)) return t;
    const r = await cacheGet('ocr', `${key}-s${i + 1}`);
    return r ? ocrText(r) : t;
  }));
}

// Dateien mit Zugangsdaten/Passwörtern nie lesen oder durchsuchen
const PRIVATE_DOC = /zugangsdaten|passw|kennw|login|credential/i;

// Suche: Fundstellen in Dokumenten (eine pro Seite), q schon klein geschrieben
async function docLines(q, max = 40) {
  const out = [];
  for (const f of await allDocs()) {
    if (PRIVATE_DOC.test(path.basename(f))) continue;
    let pages;
    try { pages = await docPages(f); } catch { continue; }
    pages.forEach((t, i) => {
      if (out.length >= max) return;
      const flat = t.replace(/\s+/g, ' '), at = flat.toLowerCase().indexOf(q);
      if (at < 0) return;
      // kurzer Vorlauf, damit das Suchwort in der Liste sichtbar bleibt
      const a = Math.max(0, flat.lastIndexOf(' ', Math.max(0, at - 25)) + 1), b = Math.min(flat.length, at + q.length + 120);
      out.push({ path: relOf(f), page: i + 1, text: (a ? '…' : '') + flat.slice(a, b).trim() + (b < flat.length ? '…' : '') });
    });
    if (out.length >= max) break;
  }
  return out;
}

Object.assign(api, {
  // Bild aus dem Ordner erkennen: ?p=bild.png · PDF-Seite nur aus dem Zwischenspeicher: ?p=datei.pdf&page=3
  'GET /api/ocr': async (req, url) => {
    const p = abs(url.searchParams.get('p')), page = Number(url.searchParams.get('page'));
    if (page) return (await cacheGet('ocr', `${await fileHash(await textSource(p))}-s${page}`)) || { missing: true };
    if (!OCR_IMG.has(path.extname(p).toLowerCase())) throw new HttpError(400, 'Nur Bilder');
    return ocrImage(p, true);
  },
  // Gezeichnete PDF-Seite (PNG im Body) erkennen; mit ?p=…&page=… unter der PDF gemerkt (für Suche und nächstes Öffnen)
  'POST /api/ocr': async (req, url) => {
    const buf = await readBody(req, 60 * 1024 * 1024);
    if (!buf.length) throw new HttpError(400, 'Kein Bild');
    const rel = url.searchParams.get('p'), page = Number(url.searchParams.get('page'));
    const key = rel && page ? `${await fileHash(await textSource(abs(rel)))}-s${page}` : hash(buf);
    return (await cacheGet('ocr', key)) || once(key, () => ocrQueue(async () => cachePut('ocr', key, await runOcr(null, buf)), true));
  },
});

// Beim Start (und nach Ordnerwechsel) im Hintergrund: Text aus PDFs lesen, Bilder erkennen (eins nach dem anderen, der Betrachter hat Vorrang)
let indexTimer;
function scheduleIndex(ms = 5000) { clearTimeout(indexTimer); indexTimer = setTimeout(indexDocs, ms); indexTimer.unref(); }
let indexing = false, indexAgain = false;
async function indexDocs() {
  if (indexing) { indexAgain = true; return; }   // läuft schon → danach noch einmal
  indexing = true;
  try {
    const root = ROOT;
    if (!root) return;
    let files = [];
    try { files = await allDocs(); } catch { return; }
    for (const f of files) {
      if (ROOT !== root) return;   // Ordner gewechselt
      if (PRIVATE_DOC.test(path.basename(f))) continue;
      const ext = path.extname(f).toLowerCase();
      try { if (ext === '.pdf') await pdfText(f); else if (OCR_IMG.has(ext) && ext !== '.gif') await ocrImage(f, false); } catch { /* nächste Datei */ }
    }
  } finally {
    indexing = false;
    if (indexAgain) { indexAgain = false; scheduleIndex(1000); }
  }
}

// ── Organisation: Material zur Stunde ───────────────────────────
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// Mit dem Standardprogramm öffnen: nur Dokumente (keine .exe, .bat, .cmd, .ps1, .lnk, .app, .sh …)
const OPEN_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.heif', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.ods', '.odp', '.txt', '.rtf', '.csv']);
const MAT_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.heif', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.ods', '.odp', '.txt']);
// Hinzufügen / Hereinziehen: nur PDF, Bilder (auch HEIC) und Office-Dateien (gleiche Liste wie ADD_EXT in src/organizer.js)
const ADD_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.heif', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp']);

// Datei schreiben, ohne je etwas zu überschreiben: names(i) liefert den Namen für Versuch i (1, 2, 3 …)
async function writeNew(dir, names, data) {
  newPath(path.join(dir, names(1)));
  await fs.mkdir(dir, { recursive: true });
  for (let i = 1; i < 1000; i++) {
    const p = newPath(path.join(dir, names(i)));
    try { await fs.writeFile(p, data, { flag: 'wx' }); return p; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw new HttpError(409, 'Kein freier Dateiname');
}

// HEIC/HEIF wird als JPEG gespeichert
const storedExt = name => (/\.hei[cf]$/i.test(name) ? '.jpg' : path.extname(name));
// Hereingezogene Datei speichern (Material, Ordner, Eingang): Dateityp prüfen, HEIC → JPEG, nie überschreiben (sonst -2, -3 …),
// danach im Hintergrund PDF-Text lesen bzw. Bild erkennen (für die Suche)
function checkMatExt(name) {
  const ext0 = path.extname(name).toLowerCase();
  if (!ADD_EXT.has(ext0)) throw new HttpError(400, `Dateityp ${ext0 || '?'} geht nicht (nur PDF, Bilder, Word, Excel, PowerPoint)`);
}
async function prepareUpload(orig, data) {
  checkMatExt(orig);
  if (!data.length) throw new HttpError(400, 'Leere Datei');
  return /\.hei[cf]$/i.test(orig) ? heicToJpeg(data) : data;   // iPhone-Foto → JPEG (gespeichert wird nur das JPEG)
}
async function storeFile(dir, orig, data, prepared = false) {
  if (!prepared) data = await prepareUpload(orig, data);
  const ext = storedExt(orig), stem = path.basename(orig, path.extname(orig)) || 'Datei';
  const p = await writeNew(dir, i => `${stem}${i > 1 ? '-' + i : ''}${ext}`, data);
  if (DOC_EXT.has(ext.toLowerCase())) scheduleIndex(2000);
  return p;
}

// Material eines Ordners (Fach oder Einheit): Dateien in allen Material-Ordnern darunter + Links aus den Stunden, nach Einheit
async function materialList(dirRel) {
  const dir = abs(dirRel || '');
  const lessons = [];
  for (const f of await allNotes()) {
    if (!nfc(f).startsWith(nfc(dir) + path.sep)) continue;
    const text = await fs.readFile(f, 'utf8'), info = lessonInfo(parseFront(text).meta, relOf(f));
    if (info) lessons.push({ file: f, info, text });
  }
  const items = new Map();
  // Gruppe = Ordner der Einheit (bei Dateien: Ordner über Material/, bei Links: Ordner der Stunde)
  const add = (p, group) => { if (!items.has(p)) items.set(p, { path: relOf(p), name: path.basename(p), group: relOf(group), from: [], exists: existsSync(p) }); return items.get(p); };
  for (const l of lessons) {
    for (const m of l.text.matchAll(/(?<!!)\[[^\]\n]*\]\(<?([^)>\s]+)>?\)/g)) {   // Links, keine eingebetteten Bilder
      const href = m[1];
      if (/^[a-z]+:/i.test(href) || href.startsWith('#') || /\.md(#.*)?$/i.test(href)) continue;
      let target; try { target = path.resolve(path.dirname(l.file), decodeURI(href.split('#')[0])); } catch { continue; }
      if (!target.startsWith(ROOT + path.sep)) continue;
      const it = add(target, path.dirname(l.file));
      if (!it.from.some(x => x.path === relOf(l.file))) it.from.push({ path: relOf(l.file), datum: l.info.datum, zeit: l.info.zeit });
    }
  }
  const walk = async (d, inMat) => {
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (hidden(e)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p, inMat || (e.name === MATERIAL_DIR ? d : null));
      else if (inMat && MAT_EXT.has(path.extname(e.name).toLowerCase())) add(p, inMat);
    }
  };
  await walk(dir, path.basename(dir) === MATERIAL_DIR ? path.dirname(dir) : null);

  const groups = new Map();
  for (const [p, it] of items) {
    it.date = it.from.map(x => x.datum).sort().pop() || (it.exists ? new Date((await fs.stat(p)).mtimeMs).toISOString().slice(0, 10) : '');
    it.label = it.name.replace(/\.[^.]+$/, '') || it.name;
    const seg = it.group.split('/');
    if (!groups.has(it.group)) groups.set(it.group, { key: it.group, title: path.relative(dir, abs(it.group)).split(path.sep).join(' / ') || path.basename(dir), einheit: seg.length >= 2 ? seg[1] : '', items: [] });
    groups.get(it.group).items.push(it);
  }
  return [...groups.values()]
    .sort((a, b) => coll.compare(a.key, b.key))
    .map(g => ({ ...g, items: g.items.sort((a, b) => b.date.localeCompare(a.date) || coll.compare(a.name, b.name)) }));
}

Object.assign(api, {
  'GET /api/material': async (req, url) => materialList(url.searchParams.get('dir')),

  // Datei auf eine Notiz ziehen. Stunde → <Ordner der Stunde>/Material/ (Originalname, nie überschreiben, sonst -2, -3 …).
  // Andere Notiz → Bilder nach bilder/, alles andere in den Ordner der Notiz.
  'POST /api/material': async (req, url) => {
    const note = abs(url.searchParams.get('note'));
    if (!note.endsWith('.md')) throw new HttpError(400, 'Keine Notiz');
    const orig = cleanName(url.searchParams.get('name'));
    const data = await readBody(req);
    const lesson = !!(await lessonMeta(note));
    const isImg = IMG_EXT.has(storedExt(orig).toLowerCase());
    const dir = lesson ? path.join(path.dirname(note), MATERIAL_DIR) : isImg ? path.join(path.dirname(note), IMAGES_DIR) : path.dirname(note);
    const p = await storeFile(dir, orig, data);
    return { path: relOf(p), lesson, image: isImg };
  },
});

// ── Dateien einsortieren: Ziel wählen, Eingang, Doppelte erkennen, Rückgängig ──
// Ziel (relativ, mit /): Stunde (.md) → deren Ordner Material/ + Link unter „## Material“; Ordner; "_Eingang" (später einsortieren)
async function destOf(dest) {
  dest = String(dest ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const segs = dest ? dest.split('/') : [];
  if (segs.some((x, i) => x === '..' || (isHiddenDir(x) && !(i === 0 && x === INBOX_DIR)))) throw new HttpError(403, 'Dieses Ziel geht nicht');
  const p = abs(dest);
  if (dest.toLowerCase().endsWith('.md')) {
    if (!(await lessonMeta(p))) throw new HttpError(400, 'Das Ziel ist keine Stunde');
    return { dir: path.join(path.dirname(p), MATERIAL_DIR), lesson: p };
  }
  if (segs[0] === INBOX_DIR) return { dir: p, lesson: null, inbox: true };
  const st = await fs.stat(p).catch(() => null);
  if (!st?.isDirectory()) throw new HttpError(404, 'Ordner nicht gefunden');
  return { dir: p, lesson: null };
}
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const sha256File = p => new Promise((ok, no) => {
  const h = crypto.createHash('sha256');
  createReadStream(p).on('error', no).on('data', d => h.update(d)).on('end', () => ok(h.digest('hex')));
});
// Gleiche Datei (Größe + SHA-256) schon im Zielordner? → ihr Pfad, sonst null
async function findDuplicate(dir, size, hashHex, except) {
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!e.isFile() || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (p === except) continue;
    try { if ((await fs.stat(p)).size === size && await sha256File(p) === hashHex) return p; } catch { /* weg */ }
  }
  return null;
}
// Datei verschieben, ohne je etwas zu überschreiben (sonst Name-2, -3 …). Harter Link + Löschen, sonst Kopie + Löschen (FAT/exFAT-Sticks)
async function moveNew(from, dir, name) {
  const e = path.extname(name), stem = path.basename(name, e) || 'Datei';
  newPath(path.join(dir, name));
  await fs.mkdir(dir, { recursive: true });
  for (let i = 1; i < 1000; i++) {
    const to = newPath(path.join(dir, `${stem}${i > 1 ? '-' + i : ''}${e}`));
    try { await fs.link(from, to); }
    catch (err) {
      if (err.code === 'EEXIST') continue;
      try { await fs.copyFile(from, to, fsConst.COPYFILE_EXCL); } catch (err2) { if (err2.code === 'EEXIST') continue; throw err2; }
    }
    await fs.unlink(from);
    return to;
  }
  throw new HttpError(409, 'Kein freier Dateiname');
}
// Link unter „## Material“ der Stunde (nicht doppelt) – merkt sich die Zeile fürs Rückgängigmachen
async function linkIntoLesson(lesson, fileAbs, ops) {
  const md = materialLinkLine(relOf(fileAbs), relOf(lesson));
  const text = await fs.readFile(lesson, 'utf8');
  if (text.split(/\r?\n/).some(l => l.trimEnd() === md)) return;
  await fs.writeFile(lesson, addMaterialLink(text, md), 'utf8');
  ops.push({ type: 'link', note: lesson, md });
}
// Umbenennen beim Einsortieren: Endung bleibt (wer sie weglässt, bekommt sie wieder)
function withExt(name, ext) {
  name = cleanName(name);
  return path.extname(name).toLowerCase() === ext.toLowerCase() ? name : cleanName(name + ext);
}
async function inboxFiles() {
  const out = [], root = path.join(ROOT, INBOX_DIR);
  const walk = async d => {
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.') || SYSTEM_FILES.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) { const st = await fs.stat(p).catch(() => null); if (st) out.push({ path: relOf(p), name: e.name, size: st.size, mtime: st.mtimeMs }); }
    }
  };
  await walk(root);
  return out.sort((a, b) => b.mtime - a.mtime || coll.compare(a.name, b.name));
}
// Was ein Einsortier-Vorgang getan hat (für „Rückgängig“), nur im Speicher und nur die letzten 30
const batches = new Map();
function batchOf(id) {
  if (!/^[\w-]{6,64}$/.test(String(id ?? ''))) throw new HttpError(400, 'Vorgang fehlt');
  if (!batches.has(id)) {
    batches.set(id, { root: ROOT, ops: [] });
    while (batches.size > 30) batches.delete(batches.keys().next().value);
  }
  const b = batches.get(id);
  if (b.root !== ROOT) throw new HttpError(409, 'Der Notizordner wurde gewechselt');
  return b;
}

Object.assign(api, {
  'GET /api/inbox': async () => ({ files: await inboxFiles() }),

  // Vorab: gibt es die Datei im Ziel schon? items: [{ dest, size, sha256 } | { dest, from }] → [{ duplicate }]
  'POST /api/files/check': async req => {
    const { items } = await json(req);
    const out = [];
    for (const it of Array.isArray(items) ? items.slice(0, 500) : []) {
      try {
        const d = await destOf(it.dest);
        let size = Number(it.size), h = String(it.sha256 || ''), from = null;
        if (it.from) { from = abs(it.from); size = (await fs.stat(from)).size; h = await sha256File(from); }
        const dup = await findDuplicate(d.dir, size, h, from);
        out.push({ duplicate: dup ? relOf(dup) : null });
      } catch (e) { out.push({ duplicate: null, error: e.message }); }
    }
    return { items: out };
  },

  // Neue Datei an ein Ziel. Gleiche Datei schon da → nicht speichern (außer dup=keep)
  'POST /api/files/add': async (req, url) => {
    const d = await destOf(url.searchParams.get('dest'));
    const b = batchOf(url.searchParams.get('batch'));
    const orig = cleanName(url.searchParams.get('name'));
    const data = await prepareUpload(orig, await readBody(req));
    if (url.searchParams.get('dup') !== 'keep') {
      const ex = await findDuplicate(d.dir, data.length, sha256(data));
      if (ex) return { status: 'duplicate', existing: relOf(ex) };
    }
    const p = await storeFile(d.dir, orig, data, true);
    b.ops.push({ type: 'added', path: p });
    if (d.lesson) await linkIntoLesson(d.lesson, p, b.ops);
    return { status: 'added', path: relOf(p), lesson: d.lesson ? relOf(d.lesson) : null };
  },

  // Dateien aus dem Eingang einsortieren: items [{ from, dest, name?, dup? }]
  // dup: 'keep' = trotzdem verschieben, 'trash' = gleiche Datei liegt schon im Ziel → Kopie im Eingang in den Papierkorb
  // (der Papierkorb lässt sich nicht per Programm zurückholen – darum kein Rückgängig dafür)
  'POST /api/files/move': async req => {
    const { batch, items } = await json(req);
    const b = batchOf(batch), inbox = path.join(ROOT, INBOX_DIR), results = [];
    for (const it of Array.isArray(items) ? items : []) {
      try {
        const src = abs(it.from);
        if (!src.startsWith(inbox + path.sep)) throw new HttpError(403, 'Nur Dateien aus dem Eingang');
        if (!(await fs.stat(src)).isFile()) throw new HttpError(400, 'Keine Datei');
        const d = await destOf(it.dest);
        if (d.inbox) { results.push({ status: 'unchanged', path: relOf(src) }); continue; }
        const name = it.name ? withExt(it.name, path.extname(src)) : path.basename(src);
        if (it.dup !== 'keep') {
          const ex = await findDuplicate(d.dir, (await fs.stat(src)).size, await sha256File(src));
          if (ex && it.dup === 'trash') { await osAction(trash, src); results.push({ status: 'trashed', existing: relOf(ex), path: relOf(src) }); continue; }
          if (ex) { results.push({ status: 'duplicate', existing: relOf(ex), path: relOf(src) }); continue; }
        }
        const to = await moveNew(src, d.dir, name);
        b.ops.push({ type: 'moved', from: src, to });
        if (d.lesson) await linkIntoLesson(d.lesson, to, b.ops);
        if (DOC_EXT.has(path.extname(to).toLowerCase())) scheduleIndex(2000);
        results.push({ status: 'moved', path: relOf(to), lesson: d.lesson ? relOf(d.lesson) : null });
      } catch (e) { results.push({ status: 'error', error: e.message }); }
    }
    return { results };
  },

  // Rückgängig: Links entfernen, neue Dateien in den Papierkorb, verschobene zurück in den Eingang
  'POST /api/files/undo': async req => {
    const { batch } = await json(req);
    const b = batches.get(String(batch ?? ''));
    if (!b) throw new HttpError(404, 'Das lässt sich nicht mehr rückgängig machen');
    if (b.root !== ROOT) throw new HttpError(409, 'Der Notizordner wurde gewechselt');
    batches.delete(batch);
    let undone = 0; const problems = [];
    for (const op of b.ops.slice().reverse()) {
      try {
        if (op.type === 'link') {
          const text = await fs.readFile(op.note, 'utf8'), next = removeMaterialLink(text, op.md);
          if (next != null) await fs.writeFile(op.note, next, 'utf8');
        } else if (op.type === 'added') {
          if (existsSync(op.path)) { await osAction(trash, op.path); undone++; }
        } else if (op.type === 'moved') {
          if (existsSync(op.to)) { await moveNew(op.to, path.dirname(op.from), path.basename(op.from)); undone++; }
        }
      } catch (e) { problems.push(`${path.basename(op.path || op.to || op.note)}: ${e.message}`); }
    }
    return { undone, problems };
  },
});

// Erster Start: leerer Ordner → kurze Anleitung hineinlegen (nie, wenn schon etwas darin liegt)
const SYSTEM_FILES = new Set(['.DS_Store', 'desktop.ini', 'Thumbs.db', '.localized']);
async function welcomeNote(root) {
  const entries = (await fs.readdir(root)).filter(n => !SYSTEM_FILES.has(n));
  if (entries.length) return;
  const text = ['# Erste Schritte', '',
    'Willkommen im Schulheft! So sind deine Notizen geordnet: **Fach → Einheit → Stunde**.', '',
    '- Beispiel: `Mathe/Bruchrechnung/2026-10-12 Brüche addieren.md`',
    '- **+ Neue Stunde** (links oben) legt die Ordner und die Notiz für dich an.',
    '- Material (PDF, Fotos …) auf eine offene Stunde ziehen – es landet im Ordner `Material` der Einheit. Oder einfach irgendwo ins Fenster ziehen: dann fragt die App, wohin.',
    '- Unter **Einstellungen** trägst du einmal deine Unterrichtszeiten und deinen Stundenplan ein.',
    '- Diese Notiz kannst du danach löschen.', ''].join('\n');
  await fs.writeFile(path.join(root, 'Erste Schritte.md'), text, { encoding: 'utf8', flag: 'wx' }).catch(() => {});
}

// ── Notizordner ─────────────────────────────────────────────────
// Prüfen (auch über Symlinks hinweg): kein Laufwerk, nicht der Benutzerordner, getrennt vom Programmordner
function validRoot(input) {
  const root = checkDataRoot(input, { appDir: HERE });
  checkDataRoot(realish(root), { appDir: realish(HERE), home: realish(os.homedir()) });
  return root;
}
function setRoot(root, from) {
  ROOT = root; ROOT_FROM = from; ROOT_PROBLEM = '';
  hashMemo.clear();
  scheduleIndex();
}
// Für die App: aktueller Ordner (oder null = Auswahl zeigen) und Kennung (gemerkte Tabs gehören zu genau einem Ordner)
const info = () => ({
  root: ROOT, rootName: ROOT && path.basename(ROOT), rootId: ROOT && rootId(ROOT), rootFrom: ROOT_FROM, platform: PLATFORM,
  suggested: config.dataRoot || defaultDataRoot(), problem: ROOT_PROBLEM || null,
});
// Ohne Notizordner geht nur das (alles andere: 409)
const NO_ROOT = new Set(['GET /api/info', 'POST /api/setup']);

if (process.env.SCHULHEFT_ROOT) setRoot(path.resolve(process.env.SCHULHEFT_ROOT), 'env');
else if (config.dataRoot) {
  try {
    const r = validRoot(config.dataRoot);
    if (!existsSync(r) || !(await fs.stat(r)).isDirectory()) throw new Error(`Der Notizordner ${r} wurde nicht gefunden (z. B. USB-Stick nicht eingesteckt?).`);
    setRoot(r, 'config');
  } catch (e) { ROOT_PROBLEM = e.message; console.error('Notizordner:', e.message); }
}

// ── Server ──────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    // Nur von diesem Computer aus erreichbar (Schutz gegen fremde Webseiten)
    const host = (req.headers.host || '').toLowerCase();
    if (host !== `localhost:${PORT}` && host !== `127.0.0.1:${PORT}`) throw new HttpError(403, 'Falscher Host');
    const url = new URL(req.url, `http://${host}`);

    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.headers['x-schulheft'] !== '1') throw new HttpError(403, 'Fehlender Header');
      if (!ROOT && !NO_ROOT.has(`${req.method} ${url.pathname}`)) throw new HttpError(409, 'Noch kein Notizordner gewählt');
      if (url.pathname === '/api/raw') {
        const p = abs(url.searchParams.get('p'));
        const st = await fs.stat(p);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
        return createReadStream(p).pipe(res);
      }
      const fn = api[`${req.method} ${url.pathname}`];
      if (!fn) throw new HttpError(404, 'Unbekannt');
      return send(res, 200, await fn(req, url));
    }

    // Statische Dateien der App
    let p = path.join(PUBLIC, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!p.startsWith(PUBLIC + path.sep) || !existsSync(p)) throw new HttpError(404, 'Nicht gefunden');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(p).pipe(res);
  } catch (e) {
    const code = e.code && Number.isInteger(e.code) ? e.code : (e.code === 'ENOENT' ? 404 : 500);
    if (code === 500) console.error(e);
    send(res, code, { error: code === 404 && e.code === 'ENOENT' ? 'Datei nicht gefunden' : e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`Schulheft läuft: http://localhost:${PORT}` + (ROOT ? '' : ' (noch kein Notizordner gewählt)')));
