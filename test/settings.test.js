// Einstellungen im Notizordner: .schulheft/einstellungen.json
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readSettings, saveSettings, settingsFile } from '../lib/settings.js';

test('Einstellungen lesen/schreiben: Vorgabe leer, unbekannte Schlüssel bleiben, atomar', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schulheft-set-'));
  try {
    assert.deepEqual(await readSettings(root), { version: 1, zeiten: [], stundenplan: [] });
    // Datei einer neueren Version mit eigenen Schlüsseln
    await fs.mkdir(path.dirname(settingsFile(root)), { recursive: true });
    await fs.writeFile(settingsFile(root), JSON.stringify({ version: 1, ferien: ['2026-12-24'], zeiten: [{ name: '1. Stunde', von: '08:00', bis: '08:45', farbe: 'blau' }] }));
    const s = await saveSettings(root, { stundenplan: [{ tag: 2, zeit: '1. Stunde', fach: 'Mathe', lehrkraft: 'Frau A' }] });
    assert.deepEqual(s.ferien, ['2026-12-24']);
    assert.equal(s.zeiten[0].farbe, 'blau');
    const disk = JSON.parse(await fs.readFile(settingsFile(root), 'utf8'));
    assert.deepEqual(disk, s);
    assert.deepEqual(disk.stundenplan, [{ tag: 2, zeit: '1. Stunde', fach: 'Mathe', einheit: '', lehrkraft: 'Frau A', raum: '' }]);
    // keine Temp-Dateien übrig
    assert.deepEqual(await fs.readdir(path.dirname(settingsFile(root))), ['einstellungen.json']);
    // kaputte Datei: wird beiseitegelegt, nicht überschrieben
    await fs.writeFile(settingsFile(root), '{ kaputt');
    assert.deepEqual((await readSettings(root)).zeiten, []);
    assert.ok((await fs.readdir(path.dirname(settingsFile(root)))).some(n => n.startsWith('einstellungen.json.kaputt-')));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
