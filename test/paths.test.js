// Pfade pro Plattform, Notizordner-Prüfung und Schutz gegen Pfade außerhalb des Ordners
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { configDir, cacheDir, defaultDataRoot, checkDataRoot, insideRoot } from '../lib/paths.js';

const win = { platform: 'win32', home: 'C:\\Users\\anna', env: { APPDATA: 'C:\\Users\\anna\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\anna\\AppData\\Local' } };
const mac = { platform: 'darwin', home: '/Users/anna', env: {} };
const linux = { platform: 'linux', home: '/home/anna', env: {} };

test('Config- und Cache-Ordner pro Plattform', () => {
  assert.equal(configDir(win), 'C:\\Users\\anna\\AppData\\Roaming\\Schulheft');
  assert.equal(cacheDir(win), 'C:\\Users\\anna\\AppData\\Local\\Schulheft\\Cache');
  assert.equal(configDir(mac), '/Users/anna/Library/Application Support/Schulheft');
  assert.equal(cacheDir(mac), '/Users/anna/Library/Caches/Schulheft');
  assert.equal(configDir(linux), '/home/anna/.config/schulheft');
  assert.equal(cacheDir(linux), '/home/anna/.cache/schulheft');
});

test('Windows ohne APPDATA/LOCALAPPDATA: Standardorte im Benutzerordner', () => {
  const o = { ...win, env: {} };
  assert.equal(configDir(o), 'C:\\Users\\anna\\AppData\\Roaming\\Schulheft');
  assert.equal(cacheDir(o), 'C:\\Users\\anna\\AppData\\Local\\Schulheft\\Cache');
});

test('Linux: XDG-Variablen (nur absolute)', () => {
  assert.equal(configDir({ ...linux, env: { XDG_CONFIG_HOME: '/x/conf' } }), '/x/conf/schulheft');
  assert.equal(cacheDir({ ...linux, env: { XDG_CACHE_HOME: '/x/cache' } }), '/x/cache/schulheft');
  assert.equal(configDir({ ...linux, env: { XDG_CONFIG_HOME: 'relativ' } }), '/home/anna/.config/schulheft');
});

test('Umleiten per SCHULHEFT_CONFIG_DIR / SCHULHEFT_CACHE_DIR', () => {
  const env = { SCHULHEFT_CONFIG_DIR: '/t/conf', SCHULHEFT_CACHE_DIR: '/t/cache' };
  for (const o of [mac, linux]) {
    assert.equal(configDir({ ...o, env }), '/t/conf');
    assert.equal(cacheDir({ ...o, env }), '/t/cache');
  }
  assert.equal(configDir({ ...win, env: { SCHULHEFT_CONFIG_DIR: 'D:\\conf' } }), 'D:\\conf');
});

test('Vorschlag für den Notizordner: Documents/Schulheft', () => {
  assert.equal(defaultDataRoot(win), 'C:\\Users\\anna\\Documents\\Schulheft');
  assert.equal(defaultDataRoot(mac), '/Users/anna/Documents/Schulheft');
});

test('Notizordner-Prüfung (macOS/Linux)', () => {
  const o = { ...mac, appDir: '/Applications/Schulheft/app' };
  assert.equal(checkDataRoot('/Users/anna/Documents/Schulheft', o), '/Users/anna/Documents/Schulheft');
  assert.equal(checkDataRoot('~/Notizen', o), '/Users/anna/Notizen');
  assert.equal(checkDataRoot('/Users/anna/Documents/Schulheft/', o), '/Users/anna/Documents/Schulheft');
  for (const bad of ['', '   ', 'relativ/ordner', '/', '/Users/anna', '/USERS/Anna/', '~',
    '/Applications/Schulheft/app', '/Applications/Schulheft/app/daten', '/Applications/Schulheft', '/Applications'])
    assert.throws(() => checkDataRoot(bad, o), Error, bad);
  // Linux unterscheidet Groß-/Kleinschreibung
  assert.equal(checkDataRoot('/HOME/anna', { ...linux }), '/HOME/anna');
});

test('Notizordner-Prüfung (Windows)', () => {
  const o = { ...win, appDir: 'C:\\Program Files\\Schulheft\\resources\\app' };
  assert.equal(checkDataRoot('D:\\Schule', o), 'D:\\Schule');
  assert.equal(checkDataRoot('C:\\Users\\anna\\Documents\\Schulheft', o), 'C:\\Users\\anna\\Documents\\Schulheft');
  for (const bad of ['C:\\', 'D:\\', 'c:/', 'C:\\Users\\anna', 'c:\\users\\ANNA\\', 'Schule',
    'C:\\Program Files\\Schulheft', 'c:\\program files\\schulheft\\resources\\app\\daten', '\\\\server\\share\\'])
    assert.throws(() => checkDataRoot(bad, o), Error, bad);
});

test('abs()-Schutz: nichts außerhalb des Notizordners (POSIX)', () => {
  const P = path.posix, root = '/data/notes';
  assert.equal(insideRoot(root, 'Mathe/a.md', P), '/data/notes/Mathe/a.md');
  assert.equal(insideRoot(root, '/Mathe/a.md', P), '/data/notes/Mathe/a.md');
  assert.equal(insideRoot(root, '', P), root);
  assert.equal(insideRoot(root, 'a/../b.md', P), '/data/notes/b.md');
  for (const bad of ['..', '../x', 'a/../../x', '../notes2/x', '/../../etc/passwd'])
    assert.equal(insideRoot(root, bad, P), null, bad);
});

test('abs()-Schutz: nichts außerhalb des Notizordners (Windows)', () => {
  const P = path.win32, root = 'C:\\Users\\anna\\Documents\\Schulheft';
  assert.equal(insideRoot(root, 'Mathe/a.md', P), root + '\\Mathe\\a.md');
  assert.equal(insideRoot(root, 'Mathe\\a.md', P), root + '\\Mathe\\a.md');
  for (const bad of ['..\\x', '..\\Schulheft2\\a', 'a\\..\\..\\x', 'C:\\Windows\\win.ini', '/C:/Windows', 'D:x', 'C:..\\x'])
    assert.equal(insideRoot(root, bad, P), null, bad);
  // führende Schrägstriche werden abgeschnitten → UNC-Pfade landen harmlos im Notizordner
  assert.equal(insideRoot(root, '\\\\server\\share\\x', P), root + '\\server\\share\\x');
  assert.equal(insideRoot(root, '//server/share/x', P), root + '\\server\\share\\x');
});
