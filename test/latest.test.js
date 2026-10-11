// Suche: Tipp-Pause abwarten, alte Anfragen abbrechen, alte Ergebnisse nie über neue schreiben
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestOnly } from '../src/latest.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('schnelles Tippen → nur eine Anfrage, für die letzte Eingabe', async () => {
  const calls = [];
  const search = latestOnly(async q => { calls.push(q); return `R:${q}`; }, 30);
  const results = await Promise.all(['N', 'Ne', 'Nen'].map(q => search(q)));
  assert.deepEqual(calls, ['Nen']);
  assert.deepEqual(results, [null, null, { value: 'R:Nen' }]);
});

test('langsame alte Antwort überschreibt die neue nicht und wird abgebrochen', async () => {
  const aborted = [];
  const search = latestOnly((q, signal) => new Promise(res => {
    signal.addEventListener('abort', () => aborted.push(q));
    setTimeout(() => res(`R:${q}`), q === 'alt' ? 80 : 5);
  }), 1);
  const first = search('alt');
  await sleep(10);                       // Anfrage „alt“ läuft schon
  const second = search('neu');
  assert.equal(await first, null);
  assert.deepEqual(await second, { value: 'R:neu' });
  assert.deepEqual(aborted, ['alt']);
  await sleep(90);                       // späte Antwort von „alt“ ändert nichts
});

test('Fehler kommen als { error } zurück, cancel liefert null', async () => {
  const search = latestOnly(async () => { throw new Error('kaputt'); }, 1);
  const r = await search('x');
  assert.equal(r.error.message, 'kaputt');
  const p = search('y');
  search.cancel();
  assert.equal(await p, null);
});
