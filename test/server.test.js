// Server mit leeren Temp-Ordnern starten: erster Start, Ordner wählen, normale API –
// und dabei darf im Programmordner nichts geschrieben werden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Alle Dateien im Programmordner (ohne node_modules/.git) mit Größe und Änderungszeit
async function snapshot(dir = APP, out = new Map()) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (dir === APP && (e.name === 'node_modules' || e.name === '.git')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { out.set(p + path.sep, 'dir'); await snapshot(p, out); }
    else { const st = await fs.stat(p); out.set(p, `${st.size}:${st.mtimeMs}`); }
  }
  return out;
}

const freePort = () => new Promise((ok, no) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }).on('error', no); });

async function start(env) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(APP, 'server.js')], { env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 100 && !log.includes('läuft'); i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(log.includes('läuft'), 'Server startet nicht: ' + log);
  const base = `http://127.0.0.1:${port}`;
  const req = async (method, url, body, headers = { 'X-Schulheft': '1' }) => {
    const res = await fetch(base + url, { method, headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const stop = () => new Promise(r => { child.once('exit', r); child.kill(); });
  return { req, stop, base };
}

test('erster Start, Ordner wählen, normale API – nichts im Programmordner geschrieben', async () => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'schulheft-srv-')));
  const conf = path.join(tmp, 'conf'), cache = path.join(tmp, 'cache'), home = path.join(tmp, 'home'), data = path.join(tmp, 'daten', 'Schulheft');
  await fs.mkdir(home);
  const env = { ...process.env, SCHULHEFT_CONFIG_DIR: conf, SCHULHEFT_CACHE_DIR: cache, HOME: home, USERPROFILE: home };
  delete env.SCHULHEFT_ROOT;
  const before = await snapshot();

  let s = await start(env);
  try {
    // Erster Start: kein Ordner
    let r = await s.req('GET', '/api/info');
    assert.equal(r.status, 200);
    assert.equal(r.data.root, null);
    assert.equal(r.data.suggested, path.join(home, 'Documents', 'Schulheft'));
    assert.equal((await s.req('GET', '/api/tree?kind=notes')).status, 409);
    assert.equal((await s.req('GET', '/api/raw?p=x')).status, 409);
    // ohne X-Schulheft-Header: gesperrt
    assert.equal((await s.req('POST', '/api/setup', { root: data }, {})).status, 403);
    // ungültige Ordner
    for (const bad of [APP, path.join(APP, 'daten'), path.dirname(APP), home, path.parse(tmp).root, 'relativ'])
      assert.equal((await s.req('POST', '/api/setup', { root: bad })).status, 400, bad);
    assert.equal(existsSync(path.join(conf, 'config.json')), false);

    // Ordner wählen: wird angelegt und gemerkt
    r = await s.req('POST', '/api/setup', { root: data });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.root, data);
    assert.match(r.data.rootId, /^[0-9a-f]{12}$/);
    assert.ok(existsSync(data));
    const cfg = JSON.parse(await fs.readFile(path.join(conf, 'config.json'), 'utf8'));
    assert.deepEqual(cfg, { configVersion: 1, dataRoot: data });

    // normale API (leerer Ordner → Anleitung „Erste Schritte“ liegt darin)
    assert.deepEqual((await s.req('GET', '/api/tree?kind=notes')).data.map(n => n.path), ['Erste Schritte.md']);
    r = await s.req('POST', '/api/new', { dir: 'Mathe', name: 'Erste Notiz', type: 'note' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(existsSync(path.join(data, 'Mathe', 'Erste Notiz.md')));
    assert.equal((await s.req('GET', '/api/text?p=' + encodeURIComponent('../../conf/config.json'))).status, 403);

    // PDF → Text landet im Cache-Ordner
    const pdf = await PDFDocument.create(), page = pdf.addPage();
    page.drawText('Photosynthese und Zellatmung', { font: await pdf.embedFont(StandardFonts.Helvetica), x: 50, y: 700 });
    await fs.writeFile(path.join(data, 'Skript.pdf'), await pdf.save());
    r = await s.req('GET', '/api/tree?kind=docs');
    assert.deepEqual(r.data.filter(n => !n.dir).map(n => n.path), ['Skript.pdf']);
    r = await s.req('GET', '/api/search?q=photosynthese');
    assert.equal(r.data.doclines[0]?.path, 'Skript.pdf', JSON.stringify(r.data));
    assert.equal((await fs.readdir(path.join(cache, 'text'))).length, 1);
  } finally { await s.stop(); }

  // Neustart: Ordner aus config.json
  s = await start(env);
  try {
    const r = await s.req('GET', '/api/info');
    assert.equal(r.data.root, data);
    assert.equal(r.data.rootFrom, 'config');
  } finally { await s.stop(); }

  // Ordner verschwunden (z. B. USB-Stick): wieder Auswahl, mit Hinweis
  await fs.rename(data, data + '-weg');
  s = await start(env);
  try {
    const r = await s.req('GET', '/api/info');
    assert.equal(r.data.root, null);
    assert.equal(r.data.suggested, data);
    assert.ok(r.data.problem);
  } finally { await s.stop(); }

  assert.deepEqual([...(await snapshot())], [...before], 'Programmordner wurde verändert');
  await fs.rm(tmp, { recursive: true, force: true });
});

test('Fach → Einheit → Stunde: Einstellungen, Stunde mit Stundenplan, Material, Hausaufgaben, Übersicht', async () => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'schulheft-gen-')));
  const conf = path.join(tmp, 'conf'), home = path.join(tmp, 'home'), full = path.join(tmp, 'voll'), data = path.join(tmp, 'Schulheft');
  await fs.mkdir(home);
  await fs.mkdir(full);
  await fs.writeFile(path.join(full, 'alt.md'), '# schon da\n');
  const env = { ...process.env, SCHULHEFT_CONFIG_DIR: conf, SCHULHEFT_CACHE_DIR: path.join(tmp, 'cache'), HOME: home, USERPROFILE: home };
  delete env.SCHULHEFT_ROOT;
  const s = await start(env);
  try {
    // Ordner mit Inhalt: keine Anleitung hineinschreiben
    assert.equal((await s.req('POST', '/api/setup', { root: full })).status, 200);
    assert.deepEqual(await fs.readdir(full), ['alt.md']);
    // leerer Ordner: Anleitung
    assert.equal((await s.req('POST', '/api/setup', { root: data })).status, 200);
    assert.match(await fs.readFile(path.join(data, 'Erste Schritte.md'), 'utf8'), /Fach → Einheit → Stunde/);

    // Einstellungen: leer → speichern → im Notizordner, unbekannte Schlüssel bleiben
    let r = await s.req('GET', '/api/settings');
    assert.deepEqual(r.data, { version: 1, zeiten: [], stundenplan: [] });
    const file = path.join(data, '.schulheft', 'einstellungen.json');
    await fs.mkdir(path.dirname(file));
    await fs.writeFile(file, JSON.stringify({ version: 1, eigenes: true }));
    r = await s.req('PUT', '/api/settings', {
      zeiten: [{ name: '1. Stunde', von: '08:00', bis: '08:45' }, { name: '2. Stunde', von: '08:45', bis: '09:30' }],
      stundenplan: [
        { tag: 1, zeit: '1. Stunde', fach: 'Mathe', einheit: 'Brüche', lehrkraft: 'Frau A', raum: '12' },
        { tag: 1, zeit: '2. Stunde', fach: 'Mathe', einheit: 'Brüche', lehrkraft: 'Frau A', raum: '12' },
        { tag: 3, zeit: '1. Stunde', fach: 'Mathe', lehrkraft: 'Frau A' },
      ],
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const disk = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(disk.eigenes, true);
    assert.equal(disk.stundenplan.length, 3);

    // Neue Stunde: nur Datum + Zeit → Rest aus dem Stundenplan; Ordner werden angelegt
    r = await s.req('POST', '/api/lesson', { datum: '2026-10-12', zeit: '1. Stunde' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.path, 'Mathe/Brüche/2026-10-12 Brüche.md');
    const lesson = r.data.path;
    const text = await fs.readFile(path.join(data, lesson), 'utf8');
    assert.match(text, /^---\ntyp: stunde\ndatum: 2026-10-12\nzeit: 08:00–09:30\nfach: Mathe\neinheit: Brüche\nlehrkraft: Frau A\nraum: 12\n---\n/);
    for (const h of ['## Material', '## Mitschrift', '## Fragen', '## Hausaufgabe']) assert.ok(text.includes(`\n${h}\n`), h);
    // gleiche Stunde nochmal: neuer Name, nichts überschrieben; ausdrücklich leere Felder bleiben leer
    r = await s.req('POST', '/api/lesson', { datum: '2026-10-12', zeit: '', fach: 'Mathe', einheit: 'Brüche', lehrkraft: '', raum: '', thema: 'Übung' });
    assert.equal(r.data.path, 'Mathe/Brüche/2026-10-12 Übung.md');
    assert.match(await fs.readFile(path.join(data, r.data.path), 'utf8'), /lehrkraft: \nraum: \n/);
    assert.equal((await s.req('POST', '/api/lesson', { datum: '2026-10-12', zeit: '1. Stunde' })).data.path, 'Mathe/Brüche/2026-10-12 Brüche (2).md');
    assert.equal((await s.req('POST', '/api/lesson', { datum: '2026-10-13' })).status, 400);   // kein Fach, kein Stundenplan

    // Hausaufgabe ohne Datum → nächste Mathe-Stunde laut Stundenplan (Mittwoch); CRLF-Notiz wird als Stunde erkannt
    await fs.writeFile(path.join(data, lesson), text.replace('## Hausaufgabe\n- [ ] ', '## Hausaufgabe\n- [ ] Seite 12'));
    await fs.mkdir(path.join(data, 'Bio'));
    await fs.writeFile(path.join(data, 'Bio', 'win.md'), '---\r\ntyp: stunde\r\ndatum: 2026-10-12\r\nfach: Bio\r\n---\r\n# Zellen\r\n## Hausaufgabe\r\n- [ ] Lesen bis 15.10.\r\n');
    r = await s.req('GET', '/api/overview');
    const hw = Object.fromEntries(r.data.todos.map(t => [t.text, t]));
    assert.deepEqual([hw['- [ ] Seite 12'].due, hw['- [ ] Seite 12'].dueEstimated, hw['- [ ] Seite 12'].homework], ['2026-10-14', true, true]);
    assert.equal(hw['- [ ] Seite 12'].lesson.einheit, 'Brüche');
    assert.deepEqual([hw['- [ ] Lesen bis 15.10.'].due, hw['- [ ] Lesen bis 15.10.'].lesson.fach], ['2026-10-15', 'Bio']);
    r = await s.req('GET', '/api/lessons');
    assert.deepEqual(r.data.map(l => l.path).sort(), ['Bio/win.md', 'Mathe/Brüche/2026-10-12 Brüche (2).md', 'Mathe/Brüche/2026-10-12 Brüche.md', 'Mathe/Brüche/2026-10-12 Übung.md']);
    assert.equal((await s.req('GET', '/api/lessons?dir=Mathe')).data.length, 3);   // auch in Unterordnern

    // Material auf die Stunde ziehen → Mathe/Brüche/Material/, Originalname, nie überschreiben
    const drop = async name => {
      const res = await fetch(`${s.base}/api/material?note=${encodeURIComponent(lesson)}&name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'X-Schulheft': '1' }, body: 'inhalt-' + name });
      return { status: res.status, data: await res.json() };
    };
    r = await drop('Arbeitsblatt 1.pdf');
    assert.deepEqual(r.data, { path: 'Mathe/Brüche/Material/Arbeitsblatt 1.pdf', lesson: true, image: false });
    r = await drop('Arbeitsblatt 1.pdf');
    assert.equal(r.data.path, 'Mathe/Brüche/Material/Arbeitsblatt 1-2.pdf');
    assert.equal(await fs.readFile(path.join(data, 'Mathe/Brüche/Material/Arbeitsblatt 1.pdf'), 'utf8'), 'inhalt-Arbeitsblatt 1.pdf');
    assert.equal((await drop('a:b?.pdf')).data.path, 'Mathe/Brüche/Material/a-b-.pdf');
    assert.equal((await drop('virus.exe')).status, 400);

    // Übersicht: Material nach Einheit; Notizbaum ohne Material- und App-Ordner
    r = await s.req('GET', '/api/material?dir=Mathe');
    assert.deepEqual(r.data.map(g => [g.key, g.title, g.einheit, g.items.length]), [['Mathe/Brüche', 'Brüche', 'Brüche', 3]]);
    const tree = (await s.req('GET', '/api/tree?kind=notes')).data;
    const mathe = tree.find(n => n.name === 'Mathe');
    assert.equal(mathe.lessons, 3);
    assert.deepEqual(mathe.children.map(n => n.name), ['Brüche']);
    assert.ok(!mathe.children[0].children.some(n => n.name === 'Material'));
    assert.ok(!tree.some(n => n.name === '.schulheft'));
    const docs = (await s.req('GET', '/api/tree?kind=docs')).data;
    assert.ok(JSON.stringify(docs).includes('Mathe/Brüche/Material/Arbeitsblatt 1.pdf'));
  } finally { await s.stop(); }
  await fs.rm(tmp, { recursive: true, force: true });
});

test('Dateien wie auf Windows: reservierte Namen, nur Groß-/Kleinschreibung umbenennen, CRLF, Unicode, OCR, HEIC', async () => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'schulheft-win-')));
  const home = path.join(tmp, 'home'), data = path.join(tmp, 'Schulheft'), cache = path.join(tmp, 'cache');
  await fs.mkdir(home); await fs.mkdir(data);
  const env = { ...process.env, SCHULHEFT_CONFIG_DIR: path.join(tmp, 'conf'), SCHULHEFT_CACHE_DIR: cache, SCHULHEFT_ROOT: data, HOME: home, USERPROFILE: home };
  const fixture = name => fs.readFile(path.join(APP, 'test', 'fixtures', name));
  const s = await start(env);
  try {
    assert.equal((await s.req('GET', '/api/info')).data.platform, process.platform);

    // reservierter Name → wird angepasst
    let r = await s.req('POST', '/api/new', { dir: '', name: 'CON', type: 'note' });
    assert.equal(r.data.path, 'CON_.md');
    r = await s.req('POST', '/api/new', { dir: '', name: 'aux', type: 'folder' });
    assert.equal(r.data.path, 'aux_');

    // nur Groß-/Kleinschreibung ändern: Datei und Ordner
    await s.req('POST', '/api/new', { dir: 'mathe', name: 'notiz', type: 'note' });
    r = await s.req('POST', '/api/rename', { p: 'mathe/notiz.md', name: 'Notiz' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.path, 'mathe/Notiz.md');
    assert.deepEqual(await fs.readdir(path.join(data, 'mathe')), ['Notiz.md']);
    r = await s.req('POST', '/api/rename', { p: 'mathe', name: 'Mathe' });
    assert.equal(r.data.path, 'Mathe');
    assert.ok((await fs.readdir(data)).includes('Mathe') && !(await fs.readdir(data)).includes('mathe'));
    // andere Datei mit dem Namen → 409, nichts überschrieben
    await s.req('POST', '/api/new', { dir: 'Mathe', name: 'Zweite', type: 'note' });
    assert.equal((await s.req('POST', '/api/rename', { p: 'Mathe/Zweite.md', name: 'Notiz' })).status, 409);

    // CRLF-Notiz: Suche liefert saubere Zeilen; Unicode-Form egal (Ordnername NFD wie von macOS)
    const nfd = 'Brüche';
    await fs.mkdir(path.join(data, nfd));
    await fs.writeFile(path.join(data, nfd, 'win.md'), '---\r\ntyp: stunde\r\ndatum: 2026-10-12\r\nfach: Mathe\r\n---\r\n# Kürzen\r\nZähler und Nenner\r\n');
    r = await s.req('GET', '/api/search?q=' + encodeURIComponent('zähler'));
    assert.deepEqual(r.data.lines.map(l => [l.line, l.text]), [[7, 'Zähler und Nenner']]);
    r = await s.req('GET', '/api/search?q=mathe');   // Kopfzeile „fach: Mathe“ ist kein Texttreffer
    assert.ok(!r.data.lines.some(l => l.path === 'Brüche/win.md'), JSON.stringify(r.data.lines));
    r = await s.req('GET', '/api/lessons?dir=' + encodeURIComponent('Brüche'));
    assert.equal(r.data.length, 1, JSON.stringify(r.data));

    // Bild mit Text einfügen → erkennen → Suche findet den Text (Cache im Cache-Ordner)
    let res = await fetch(`${s.base}/api/upload?dir=Mathe/bilder&name=tafel.png`, { method: 'POST', headers: { 'X-Schulheft': '1' }, body: await fixture('ocr-text.png') });
    assert.equal((await res.json()).path, 'Mathe/bilder/tafel.png');
    r = await s.req('GET', '/api/ocr?p=' + encodeURIComponent('Mathe/bilder/tafel.png'));
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual([r.data.width, r.data.height, r.data.lines.length], [640, 180, 2]);
    assert.ok(r.data.lines[0].words.length >= 2);
    r = await s.req('GET', '/api/search?q=photosynthese');
    assert.equal(r.data.doclines[0]?.path, 'Mathe/bilder/tafel.png', JSON.stringify(r.data));
    assert.equal((await fs.readdir(path.join(cache, 'ocr'))).length, 1);

    // HEIC auf eine Notiz ziehen → nur JPEG gespeichert
    res = await fetch(`${s.base}/api/material?note=${encodeURIComponent('Mathe/Notiz.md')}&name=IMG_0001.HEIC`, { method: 'POST', headers: { 'X-Schulheft': '1' }, body: await fixture('tiny.heic') });
    const drop = await res.json();
    assert.equal(drop.path, 'Mathe/bilder/IMG_0001.jpg', JSON.stringify(drop));
    assert.deepEqual([...(await fs.readFile(path.join(data, drop.path))).subarray(0, 3)], [0xff, 0xd8, 0xff]);

    // Betriebssystem-Aktionen: nur Dokumente öffnen, fehlende Dateien → 404 (hier wird nichts wirklich geöffnet/gelöscht)
    await fs.writeFile(path.join(data, 'tool.exe'), 'x');
    assert.equal((await s.req('POST', '/api/open', { p: 'tool.exe' })).status, 400);
    assert.equal((await s.req('POST', '/api/trash', { p: 'gibtsnicht.md' })).status, 404);
    assert.equal((await s.req('POST', '/api/reveal', { p: 'gibtsnicht.md' })).status, 404);
    assert.equal((await s.req('POST', '/api/trash', { p: '' })).status, 403);   // ganzer Notizordner
  } finally { await s.stop(); }
  await fs.rm(tmp, { recursive: true, force: true });
});
