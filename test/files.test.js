// Dateinamen und Umbenennen: Windows-Pfadlänge, nur Groß-/Kleinschreibung ändern (echtes Dateisystem), Unicode
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkPathLength, renameSafe, isCaseVariant, sameNameLoosely, WIN_MAX_PATH } from '../lib/files.js';

test('Windows: zu lange Pfade werden mit klarer Meldung abgelehnt', () => {
  const long = 'C:\\Users\\Anna\\Documents\\Schulheft\\' + 'x'.repeat(WIN_MAX_PATH);
  assert.throws(() => checkPathLength(long, 'win32'), /zu lang für Windows \(\d+ Zeichen, höchstens 250\)/);
  assert.equal(checkPathLength('C:\\Users\\Anna\\a.md', 'win32'), 'C:\\Users\\Anna\\a.md');
  assert.equal(checkPathLength('C:\\' + 'x'.repeat(WIN_MAX_PATH - 3), 'win32').length, WIN_MAX_PATH);
  // macOS/Linux: keine Grenze von uns
  assert.equal(checkPathLength('/' + 'x'.repeat(400), 'darwin').length, 401);
  assert.equal(checkPathLength('/' + 'x'.repeat(400), 'linux').length, 401);
});

test('Namen vergleichen: Groß-/Kleinschreibung und Unicode-Form egal', () => {
  assert.ok(sameNameLoosely('notiz.md', 'Notiz.MD'));
  assert.ok(sameNameLoosely('Bru\u0308che.md', 'Brüche.md'));   // NFD (macOS) vs. NFC
  assert.ok(!sameNameLoosely('a.md', 'b.md'));
});

test('Umbenennen: nur Groß-/Kleinschreibung (notiz.md → Notiz.md) klappt auf jedem Dateisystem', async () => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'schulheft-ren-')));
  try {
    const from = path.join(dir, 'notiz.md'), to = path.join(dir, 'Notiz.md');
    await fs.writeFile(from, 'inhalt');
    await renameSafe(from, to);
    assert.deepEqual(await fs.readdir(dir), ['Notiz.md']);
    assert.equal(await fs.readFile(to, 'utf8'), 'inhalt');

    // Ordner ebenso
    await fs.mkdir(path.join(dir, 'mathe'));
    await fs.writeFile(path.join(dir, 'mathe', 'a.md'), 'a');
    await renameSafe(path.join(dir, 'mathe'), path.join(dir, 'Mathe'));
    assert.deepEqual((await fs.readdir(dir)).sort(), ['Mathe', 'Notiz.md']);
    assert.equal(await fs.readFile(path.join(dir, 'Mathe', 'a.md'), 'utf8'), 'a');

    // Ziel ist eine andere Datei → nie überschreiben
    await fs.writeFile(path.join(dir, 'b.md'), 'b');
    await assert.rejects(renameSafe(to, path.join(dir, 'b.md')), e => e.code === 'EEXIST');
    assert.equal(await fs.readFile(path.join(dir, 'b.md'), 'utf8'), 'b');
    assert.equal(await isCaseVariant(to, path.join(dir, 'b.md')), false);

    // keine Zwischendateien übrig
    assert.deepEqual((await fs.readdir(dir)).sort(), ['Mathe', 'Notiz.md', 'b.md']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('Notizkopf über 2 KB wird bis zum schließenden --- gelesen', async () => {
  const { readHead } = await import('../lib/files.js');
  const { parseFront } = await import('../lib/lesson.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'schulheft-head-'));
  try {
    const long = 'x'.repeat(5000);
    const f = path.join(dir, 'a.md');
    await fs.writeFile(f, `---\r\ntyp: stunde\r\nnotiz: ${long}\r\nfach: Mathe\r\n---\r\n# Titel\r\n` + 'Text\n'.repeat(10000));
    const head = await readHead(f, 64 * 1024, 1024);
    assert.ok(head.length < 20000, 'liest nicht die ganze Datei');
    assert.equal(parseFront(head).meta.fach, 'Mathe');
    const plain = path.join(dir, 'b.md');
    await fs.writeFile(plain, '# Ohne Kopf\n' + 'y'.repeat(100000));
    assert.ok((await readHead(plain, 64 * 1024, 1024)).length <= 1024);
    const open = path.join(dir, 'c.md');
    await fs.writeFile(open, '---\ntyp: stunde\n' + 'z'.repeat(200000));
    assert.equal((await readHead(open, 8192, 1024)).length, 8192);
    assert.equal(parseFront(await readHead(open, 8192)).meta, null);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
