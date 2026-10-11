// config.json: atomar schreiben, unbekannte Schlüssel behalten, Migrationen
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readConfig, saveConfig, updateConfig, loadConfig, configFile, CONFIG_VERSION } from '../lib/config.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'schulheft-test-'));

test('fehlende Datei = leere Einstellungen, Ordner wird beim Schreiben angelegt', async () => {
  const dir = path.join(await tmp(), 'neu', 'conf');
  assert.deepEqual(await readConfig(dir), {});
  await updateConfig(dir, { dataRoot: '/x/Schulheft' });
  assert.deepEqual(await readConfig(dir), { configVersion: CONFIG_VERSION, dataRoot: '/x/Schulheft' });
});

test('unbekannte Schlüssel bleiben erhalten, keine Temp-Dateien übrig', async () => {
  const dir = await tmp();
  await fs.writeFile(configFile(dir), JSON.stringify({ configVersion: 1, dataRoot: '/a', zukunft: { x: [1, 2] }, theme: 'nacht' }));
  await updateConfig(dir, { dataRoot: '/b' });
  assert.deepEqual(await readConfig(dir), { configVersion: 1, dataRoot: '/b', zukunft: { x: [1, 2] }, theme: 'nacht' });
  assert.deepEqual(await fs.readdir(dir), ['config.json']);
});

test('neuere configVersion wird nicht heruntergesetzt', async () => {
  const dir = await tmp();
  await saveConfig(dir, { configVersion: 7, dataRoot: '/a' });
  await updateConfig(dir, { dataRoot: '/b' });
  assert.equal((await readConfig(dir)).configVersion, 7);
  assert.equal((await loadConfig(dir, {}, [{ to: 8, run: () => assert.fail('darf nicht laufen') }])).configVersion, 7);
});

test('kaputte Datei wird zur Seite gelegt statt überschrieben', async () => {
  const dir = await tmp();
  await fs.writeFile(configFile(dir), '{ kaputt');
  assert.deepEqual(await readConfig(dir), {});
  const files = await fs.readdir(dir);
  assert.ok(files.some(f => f.startsWith('config.json.kaputt-')), files.join());
});

test('Migrationen laufen der Reihe nach und nur einmal', async () => {
  const dir = await tmp(), ran = [];
  await saveConfig(dir, { configVersion: 1, dataRoot: '/a', extra: true });
  const migs = [
    { to: 3, run: cfg => { ran.push(3); return { ...cfg, c: 3 }; } },
    { to: 2, run: cfg => { ran.push(2); return { ...cfg, b: 2 }; } },
  ];
  const cfg = await loadConfig(dir, {}, migs);
  assert.deepEqual(ran, [2, 3]);
  assert.deepEqual(cfg, { configVersion: 3, dataRoot: '/a', extra: true, b: 2, c: 3 });
  assert.deepEqual(await readConfig(dir), cfg);
  await loadConfig(dir, {}, migs);
  assert.deepEqual(ran, [2, 3]);
});

test('ohne Einstellungen: keine Migration, keine Datei', async () => {
  const dir = await tmp();
  assert.deepEqual(await loadConfig(dir, {}, [{ to: 2, run: () => assert.fail() }]), {});
  assert.deepEqual(await fs.readdir(dir), []);
});
