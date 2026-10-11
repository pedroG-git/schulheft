// Dateien einsortieren: in Ordner, Stunde (Material + Link) und Eingang; Doppelte; Eingang leeren; Rückgängig; Pfade außerhalb
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lessonText } from '../lib/lesson.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const freePort = () => new Promise((ok, no) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }).on('error', no); });

test('Einsortieren: Ordner, Stunde, Eingang, Doppelte, Rückgängig, Pfade außerhalb', async () => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'schulheft-inbox-')));
  const data = path.join(tmp, 'daten'), bin = path.join(tmp, 'papierkorb');
  const lessonRel = 'Mathe/Brüche/2026-10-12 Brüche.md', lessonAbs = path.join(data, lessonRel);
  const original = lessonText({ datum: '2026-10-12', fach: 'Mathe', einheit: 'Brüche' });
  await fs.mkdir(path.dirname(lessonAbs), { recursive: true });
  await fs.mkdir(path.join(data, 'Bio'));
  await fs.writeFile(lessonAbs, original);
  await fs.writeFile(path.join(tmp, 'geheim.pdf'), 'geheim');

  const port = await freePort();
  const env = { ...process.env, PORT: String(port), SCHULHEFT_ROOT: data, SCHULHEFT_CONFIG_DIR: path.join(tmp, 'conf'), SCHULHEFT_CACHE_DIR: path.join(tmp, 'cache'), SCHULHEFT_TEST_TRASH: bin };
  const child = spawn(process.execPath, [path.join(APP, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 100 && !log.includes('läuft'); i++) await new Promise(r => setTimeout(r, 50));
  const base = `http://127.0.0.1:${port}`, H = { 'X-Schulheft': '1' };
  const add = async (dest, name, body, batch = 'batch-1', dup = '') => {
    const res = await fetch(`${base}/api/files/add?dest=${encodeURIComponent(dest)}&name=${encodeURIComponent(name)}&batch=${batch}${dup ? '&dup=' + dup : ''}`, { method: 'POST', headers: H, body });
    return { status: res.status, data: await res.json() };
  };
  const post = async (url, body) => { const res = await fetch(base + url, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, data: await res.json() }; };
  const read = p => fs.readFile(path.join(data, p), 'utf8');
  try {
    // Ordner: neu, gleiche Datei → übersprungen, gleicher Name + anderer Inhalt → -2, dup=keep → trotzdem
    assert.deepEqual((await add('Bio', 'Zelle.pdf', 'A')).data, { status: 'added', path: 'Bio/Zelle.pdf', lesson: null });
    assert.deepEqual((await add('Bio', 'Kopie.pdf', 'A')).data, { status: 'duplicate', existing: 'Bio/Zelle.pdf' });
    assert.equal((await add('Bio', 'Zelle.pdf', 'B')).data.path, 'Bio/Zelle-2.pdf');
    assert.equal((await add('Bio', 'Zelle.pdf', 'A', 'batch-1', 'keep')).data.path, 'Bio/Zelle-3.pdf');
    assert.equal(await read('Bio/Zelle.pdf'), 'A');
    // Vorab-Prüfung (SHA-256 im Browser berechnet)
    const sha = crypto.createHash('sha256').update('B').digest('hex');
    let r = await post('/api/files/check', { items: [{ dest: 'Bio', size: 1, sha256: sha }, { dest: lessonRel, size: 1, sha256: sha }] });
    assert.deepEqual(r.data.items.map(x => x.duplicate), ['Bio/Zelle-2.pdf', null]);

    // Stunde: Material/ + Link unter „## Material“
    r = await add(lessonRel, 'Blatt 1.pdf', 'C', 'batch-2');
    assert.deepEqual(r.data, { status: 'added', path: 'Mathe/Brüche/Material/Blatt 1.pdf', lesson: lessonRel });
    assert.match(await read(lessonRel), /## Material\n- \[Blatt 1\]\(Material\/Blatt%201\.pdf\)\n/);
    assert.equal((await add(lessonRel, 'nochmal.pdf', 'C', 'batch-2')).data.status, 'duplicate');

    // Eingang: hochladen, auflisten, auf die Stunde verschieben (umbenannt, Endung bleibt)
    assert.equal((await add('_Eingang', 'Foto.png', 'D', 'batch-3')).data.path, '_Eingang/Foto.png');
    await fs.writeFile(path.join(data, '_Eingang', '.DS_Store'), 'x');
    let inbox = (await (await fetch(base + '/api/inbox')).json()).files;
    assert.deepEqual(inbox.map(f => [f.path, f.size]), [['_Eingang/Foto.png', 1]]);
    assert.ok(!JSON.stringify(await (await fetch(base + '/api/tree?kind=docs')).json()).includes('_Eingang'));   // im Baum versteckt
    r = await post('/api/files/check', { items: [{ dest: 'Bio', from: '_Eingang/Foto.png' }] });
    assert.equal(r.data.items[0].duplicate, null);
    r = await post('/api/files/move', { batch: 'batch-2', items: [{ from: '_Eingang/Foto.png', dest: lessonRel, name: 'Tafelbild' }, { from: 'Bio/Zelle.pdf', dest: lessonRel }] });
    assert.deepEqual(r.data.results[0], { status: 'moved', path: 'Mathe/Brüche/Material/Tafelbild.png', lesson: lessonRel });
    assert.equal(r.data.results[1].status, 'error');   // nur aus dem Eingang
    assert.ok(existsSync(path.join(data, 'Bio/Zelle.pdf')));
    assert.match(await read(lessonRel), /Blatt%201\.pdf\)\n- \[Tafelbild\]\(Material\/Tafelbild\.png\)\n/);
    assert.equal((await (await fetch(base + '/api/inbox')).json()).files.length, 0);

    // Rückgängig: Links weg (Platzhalter zurück), neue Datei im Papierkorb, verschobene zurück in den Eingang
    r = await post('/api/files/undo', { batch: 'batch-2' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data, { undone: 2, problems: [] });
    assert.equal(await read(lessonRel), original);
    assert.ok(!existsSync(path.join(data, 'Mathe/Brüche/Material/Blatt 1.pdf')));
    assert.ok((await fs.readdir(bin)).some(n => n.endsWith('Blatt 1.pdf')));
    assert.equal(await read('_Eingang/Foto.png'), 'D');
    assert.equal((await post('/api/files/undo', { batch: 'batch-2' })).status, 404);   // nur einmal

    // Pfade außerhalb und gesperrte Ziele
    for (const dest of ['../', '../../tmp', '.schulheft', 'Bio/../../x', '_app', '_Original', 'Mathe/_Original'])
      assert.ok([403, 404].includes((await add(dest, 'x.pdf', 'E')).status), dest);
    assert.equal((await add('Gibtsnicht', 'x.pdf', 'E')).status, 404);
    assert.equal((await add('Bio', 'virus.exe', 'E')).status, 400);
    assert.equal((await add('Bio', 'x.pdf', 'E', '../x')).status, 400);   // Vorgangs-Kennung
    assert.equal((await add('Bio', '../../evil.pdf', 'E')).data.path, 'Bio/-..-evil.pdf');   // Name bleibt im Ordner
    r = await post('/api/files/move', { batch: 'batch-4', items: [{ from: '../geheim.pdf', dest: 'Bio' }, { from: '_Eingang/../../geheim.pdf', dest: 'Bio' }, { from: '_Eingang/Foto.png', dest: '../' }] });
    assert.deepEqual(r.data.results.map(x => x.status), ['error', 'error', 'error']);
    assert.ok(existsSync(path.join(tmp, 'geheim.pdf')) && existsSync(path.join(data, '_Eingang/Foto.png')));
  } finally {
    await new Promise(res => { child.once('exit', res); child.kill(); });
  }
  await fs.rm(tmp, { recursive: true, force: true });
});
