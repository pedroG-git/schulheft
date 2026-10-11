// Betriebssystem-Aktionen je System, mit nachgebautem execFile: richtige Programme, Pfad immer als eigenes Argument (Daten, kein Code)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformActions, WIN_TRASH_SCRIPT, setPlatformActions, trash, reveal, openWithDefaultApp } from '../lib/platform.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Pfade mit Zeichen, die in einer Shell oder in PowerShell Code wären
const NASTY_POSIX = '/tmp/a "b" $(touch x) `id` $HOME \'c\'; rm -rf ~ & d.pdf';
const NASTY_WIN = 'C:\\Users\\Anna\\Schulheft\\a $(Get-Process) `n $env:USERNAME \'b\'; & c.pdf';

// execFile-Ersatz: merkt sich Aufrufe; result(cmd, args) → { code, stderr } (Standard: Erfolg)
function fakeExec(result = () => ({ code: 0 })) {
  const calls = [];
  const execFile = (cmd, args, opts, cb) => {
    calls.push({ cmd, args, opts });
    const r = result(cmd, args, opts);
    setImmediate(() => {
      if (r.enoent) return cb(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }), '', '');
      if (r.code) return cb(Object.assign(new Error('Command failed'), { code: r.code }), '', r.stderr || '');
      cb(null, '', '');
    });
  };
  return { calls, execFile };
}
const noShell = calls => calls.forEach(c => assert.ok(!c.opts?.shell, 'nie über eine Shell'));

test('Windows: Papierkorb über PowerShell, Pfad nur in der Umgebung (nie im Skript)', async () => {
  const { calls, execFile } = fakeExec();
  const a = createPlatformActions({ platform: 'win32', execFile, env: { SystemRoot: 'C:\\Windows' } });
  await a.trash(NASTY_WIN);
  assert.equal(calls.length, 1);
  const { cmd, args, opts } = calls[0];
  assert.equal(cmd, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(args.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']);
  const script = Buffer.from(args[5], 'base64').toString('utf16le');
  assert.equal(script, WIN_TRASH_SCRIPT);
  assert.ok(!args.some(x => x.includes('Anna')), 'Pfad steht nicht in den Argumenten');
  assert.ok(!script.includes('Anna'), 'Pfad steht nicht im Skript');
  assert.equal(opts.env.SCHULHEFT_TARGET, NASTY_WIN);
  assert.match(script, /SendToRecycleBin/);
  assert.match(script, /DeleteDirectory/);   // Ordner
  assert.match(script, /DeleteFile/);        // Dateien
  assert.match(script, /-LiteralPath \$p/);   // keine Platzhalter-Auswertung ([ ] * ?)
  noShell(calls);
});

test('Windows: Laufwerk ohne Papierkorb und Fehler → deutsche Meldung, kein endgültiges Löschen', async () => {
  for (const [code, re] of [[3, /keinen Papierkorb/], [2, /nicht gefunden/], [1, /nicht in den Papierkorb/]]) {
    const { execFile } = fakeExec(() => ({ code, stderr: 'Zugriff verweigert' }));
    const a = createPlatformActions({ platform: 'win32', execFile, env: {} });
    await assert.rejects(a.trash('C:\\x\\y.md'), re);
  }
});

test('Windows: Explorer zeigt/öffnet, Exit-Code 1 gilt als Erfolg', async () => {
  const { calls, execFile } = fakeExec(() => ({ code: 1 }));
  const a = createPlatformActions({ platform: 'win32', execFile, env: { SystemRoot: 'D:\\Win' } });
  await a.reveal(NASTY_WIN);
  await a.openWithDefaultApp(NASTY_WIN);
  assert.deepEqual(calls.map(c => [c.cmd, c.args]), [
    ['D:\\Win\\explorer.exe', ['/select,', NASTY_WIN]],
    ['D:\\Win\\explorer.exe', [NASTY_WIN]],
  ]);
  noShell(calls);
  const bad = createPlatformActions({ platform: 'win32', execFile: fakeExec(() => ({ code: 2 })).execFile, env: {} });
  await assert.rejects(bad.reveal('C:\\a.pdf'), /Explorer/);
});

test('macOS: /usr/bin/trash, sonst Finder per AppleScript mit Pfad als argv; open -R; open', async () => {
  let { calls, execFile } = fakeExec();
  let a = createPlatformActions({ platform: 'darwin', execFile, exists: p => p === '/usr/bin/trash' });
  await a.trash(NASTY_POSIX);
  await a.reveal(NASTY_POSIX);
  await a.openWithDefaultApp(NASTY_POSIX);
  assert.deepEqual(calls.map(c => [c.cmd, c.args]), [
    ['/usr/bin/trash', [NASTY_POSIX]],
    ['/usr/bin/open', ['-R', NASTY_POSIX]],
    ['/usr/bin/open', [NASTY_POSIX]],
  ]);
  noShell(calls);

  ({ calls, execFile } = fakeExec());
  a = createPlatformActions({ platform: 'darwin', execFile, exists: () => false });
  await a.trash(NASTY_POSIX);
  assert.equal(calls[0].cmd, '/usr/bin/osascript');
  assert.equal(calls[0].args.at(-1), NASTY_POSIX);   // als Argument an „on run argv“
  assert.ok(!calls[0].args.slice(0, -1).some(x => x.includes(NASTY_POSIX)), 'Pfad nicht im Skript');

  a = createPlatformActions({ platform: 'darwin', execFile: fakeExec(() => ({ code: 1, stderr: 'nope' })).execFile, exists: () => true });
  await assert.rejects(a.trash('/x/y.md'), /nicht in den Papierkorb gelegt.*nope/);
});

test('Linux: gio trash, xdg-open (Ordner zeigen), fehlendes gio → klare Meldung', async () => {
  const { calls, execFile } = fakeExec();
  const a = createPlatformActions({ platform: 'linux', execFile });
  await a.trash(NASTY_POSIX);
  await a.reveal('/home/anna/Schulheft/Mathe/a $b.pdf');
  await a.openWithDefaultApp(NASTY_POSIX);
  assert.deepEqual(calls.map(c => [c.cmd, c.args]), [
    ['gio', ['trash', '--', NASTY_POSIX]],
    ['xdg-open', ['/home/anna/Schulheft/Mathe']],
    ['xdg-open', [NASTY_POSIX]],
  ]);
  noShell(calls);
  const none = createPlatformActions({ platform: 'linux', execFile: fakeExec(() => ({ enoent: true })).execFile });
  await assert.rejects(none.trash('/x/y'), /gio/);
});

test('setPlatformActions: Electron kann die Aktionen ersetzen; Datei muss danach weg sein', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'schulheft-plat-'));
  const f = path.join(dir, 'weg.txt');
  await fs.writeFile(f, 'x');
  const seen = [];
  try {
    setPlatformActions({ trash: async p => { seen.push(['trash', p]); }, reveal: async p => { seen.push(['reveal', p]); }, openWithDefaultApp: async p => { seen.push(['open', p]); } });
    // Ersatz tut nichts → Datei liegt noch da → Fehler statt „erledigt“
    await assert.rejects(trash(f), /noch am alten Ort/);
    setPlatformActions({ trash: async p => { seen.push(['trash', p]); await fs.rm(p); } });
    await trash(f);
    await reveal(f); await openWithDefaultApp(f);
    assert.deepEqual(seen, [['trash', f], ['trash', f], ['reveal', f], ['open', f]]);
    await assert.rejects(reveal('relativ.txt'), /Pfad/);
  } finally {
    setPlatformActions();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
