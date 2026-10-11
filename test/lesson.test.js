// Gemeinsame Regeln für Stunden (lib/lesson.js): Kopf, Stundenplan, Fristen, Namen
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFront, lessonInfo, lessonText, sectionRange, isSection, safeName, folderName, normalizeSettings,
  dayPlan, planMatch, parseDue, nextLessonDate, withDue, weekday,
} from '../lib/lesson.js';
import { taskLines } from '../src/render.js';

test('Kopf lesen: LF und CRLF (Windows), BOM, kein Kopf', () => {
  const lf = '---\ntyp: stunde\ndatum: 2026-10-12\nzeit: 08:00–09:30\nfach: Mathe\n---\n# Titel\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  for (const src of [lf, crlf, '﻿' + crlf]) {
    const { meta, body } = parseFront(src);
    assert.deepEqual(meta, { typ: 'stunde', datum: '2026-10-12', zeit: '08:00–09:30', fach: 'Mathe' });
    assert.match(body, /^# Titel\r?\n$/);
  }
  assert.equal(parseFront('# Nur Text\n').meta, null);
  assert.equal(parseFront('---\r\ntyp: stunde\r\n---').meta.typ, 'stunde');
});

test('Fach/Einheit aus dem Kopf, sonst aus dem Pfad', () => {
  assert.deepEqual(lessonInfo({ typ: 'stunde', datum: '2026-10-12' }, 'Mathe/Brüche/2026-10-12 x.md'),
    { datum: '2026-10-12', zeit: '', fach: 'Mathe', einheit: 'Brüche', lehrkraft: '', raum: '' });
  assert.equal(lessonInfo({ typ: 'stunde', fach: 'Bio' }, 'Mathe/x.md').fach, 'Bio');
  assert.equal(lessonInfo({ typ: 'stunde' }, 'x.md').fach, '');
  assert.equal(lessonInfo({ typ: 'notiz' }, 'Mathe/a/x.md'), null);
});

test('Vorlage einer Stunde: Kopf und die vier Abschnitte', () => {
  const t = lessonText({ datum: '2026-10-12', zeit: '08:00–08:45', fach: 'Mathe', einheit: 'Brüche', lehrkraft: 'Frau A\nB', raum: '12' });
  const { meta } = parseFront(t);
  assert.deepEqual(meta, { typ: 'stunde', datum: '2026-10-12', zeit: '08:00–08:45', fach: 'Mathe', einheit: 'Brüche', lehrkraft: 'Frau A B', raum: '12' });
  const lines = t.split('\n');
  for (const k of ['material', 'mitschrift', 'fragen', 'hausaufgabe']) assert.ok(sectionRange(lines, k), k);
  assert.match(t, /^# Brüche$/m);
  assert.ok(isSection('Hausaufgaben', 'hausaufgabe'));
  assert.ok(!isSection('Mitschrift', 'hausaufgabe'));
});

test('Namen: sicher für Windows/macOS/Linux', () => {
  assert.equal(safeName('a/b\\c:d*e?"f<g>h|i.pdf'), 'a-b-c-d-e-f-g-h-i.pdf');
  assert.equal(safeName('..versteckt'), 'versteckt');
  assert.equal(safeName('Ende. . '), 'Ende');
  assert.equal(safeName('CON.txt'), 'CON_.txt');
  assert.equal(safeName('x'.repeat(200) + '.pdf').endsWith('.pdf'), true);
  assert.equal(safeName('x'.repeat(200) + '.pdf').length, 120);
  assert.equal(folderName('_Eingang'), 'Eingang');
  assert.equal(folderName('../..'), '');
});

test('Namen: reservierte Windows-Namen, Steuerzeichen, Unicode, Länge', () => {
  for (const [a, b] of [['con', 'con_'], ['CON.txt', 'CON_.txt'], ['nul.tar.gz', 'nul_.tar.gz'], ['Aux .md', 'Aux_.md'], ['PRN', 'PRN_'],
    ['com1.pdf', 'com1_.pdf'], ['LPT9', 'LPT9_'], ['COM¹.md', 'COM¹_.md'], ['conin$', 'conin$_']])
    assert.equal(safeName(a), b, a);
  for (const ok of ['console.txt', 'Konto.md', 'com10.md', 'auxiliar.pdf', 'Nullstellen.md']) assert.equal(safeName(ok), ok);
  assert.equal(safeName('a\u0000b\u001fc\u007fd'), 'a-b-c-d');
  assert.equal(safeName('Bru\u0308che'), 'Brüche');   // NFD → NFC
  assert.equal(safeName('Brüche'.normalize('NFD')).length, 6);
  const emoji = safeName('😀'.repeat(200) + '.pdf');
  assert.equal([...emoji].length, 120);
  assert.ok(emoji.endsWith('.pdf') && !emoji.includes('\ufffd'));
  assert.equal(safeName('Titel' + ' .'.repeat(100) + 'x.pdf', 20), 'Titel.pdf');   // gekürzt, ohne Punkte/Leerzeichen am Ende
});

test('Windows-Zeilenenden (CRLF): Aufgaben im Lesemodus an der richtigen Zeile', () => {
  const lf = '---\ntyp: stunde\n---\n# T\n- [ ] eins\n```\n- [ ] kein\n```\n- [x] zwei\n';
  assert.deepEqual(taskLines(lf.replace(/\n/g, '\r\n')), taskLines(lf));
  assert.deepEqual(taskLines(lf), [4, 8]);
  assert.deepEqual(parseFront(lf.replace(/\n/g, '\r\n')).meta, { typ: 'stunde' });
});

const settings = normalizeSettings({
  zeiten: [{ name: '1. Stunde', von: '08:00', bis: '08:45' }, { name: '2. Stunde', von: '8:45', bis: '09:30' }, { name: '3. Stunde', von: '09:50', bis: '10:35' }],
  stundenplan: [
    { tag: 1, zeit: '1. Stunde', fach: 'Mathe', einheit: 'Brüche', lehrkraft: 'Frau A', raum: '12' },
    { tag: 1, zeit: '2. Stunde', fach: 'Mathe', einheit: 'Brüche', lehrkraft: 'Frau A', raum: '12' },
    { tag: 1, zeit: '3. Stunde', fach: 'Bio', lehrkraft: 'Herr B' },
    { tag: 3, zeit: '3. Stunde', fach: 'Mathe', lehrkraft: 'Frau A' },
  ],
});

test('Einstellungen säubern: ungültige Einträge raus, unbekannte Felder bleiben', () => {
  const s = normalizeSettings({ extra: 1, zeiten: [{ name: 'A', von: '7:5' }, { name: 'A' }, { name: '' }, { name: 'B', von: '7:05', farbe: 'rot' }],
    stundenplan: [{ tag: 9, zeit: 'A', fach: 'X' }, { tag: 1, zeit: 'A', fach: '' }, { tag: 1, zeit: 'A', fach: 'Mathe', notiz: 'n' }, { tag: 1, zeit: 'A', fach: 'Doppelt' }] });
  assert.equal(s.extra, 1);
  assert.equal(s.version, 1);
  assert.deepEqual(s.zeiten, [{ name: 'A', von: '', bis: '' }, { name: 'B', von: '07:05', bis: '', farbe: 'rot' }]);
  assert.deepEqual(s.stundenplan, [{ tag: 1, zeit: 'A', fach: 'Mathe', einheit: '', lehrkraft: '', raum: '', notiz: 'n' }]);
  assert.deepEqual(normalizeSettings(null), { version: 1, zeiten: [], stundenplan: [] });
});

test('Stundenplan eines Tages: sortiert, Doppelstunde zusammengefasst', () => {
  assert.equal(weekday('2026-10-12'), 1);   // Montag
  const mo = dayPlan(settings, '2026-10-12');
  assert.deepEqual(mo.map(e => [e.fach, e.zeit, e.zeiten]), [['Mathe', '08:00–09:30', ['1. Stunde', '2. Stunde']], ['Bio', '09:50–10:35', ['3. Stunde']]]);
  assert.deepEqual(dayPlan(settings, '2026-10-13'), []);
  assert.deepEqual(dayPlan(normalizeSettings({}), '2026-10-12'), []);
});

test('Passender Eintrag für Datum + Zeit (Name, Uhrzeit oder Doppelstunde)', () => {
  for (const z of ['1. Stunde', '2. Stunde', '08:00–08:45', '08:00–09:30', '08:00'])
    assert.equal(planMatch(settings, '2026-10-12', z)?.lehrkraft, 'Frau A', z);
  assert.equal(planMatch(settings, '2026-10-12', '3. Stunde').fach, 'Bio');
  assert.equal(planMatch(settings, '2026-10-12', '', 'bio').lehrkraft, 'Herr B');
  assert.equal(planMatch(settings, '2026-10-12', ''), null);
  assert.equal(planMatch(settings, '2026-10-13', '1. Stunde'), null);
  assert.equal(planMatch(settings, 'kein Datum', '1. Stunde'), null);
});

test('Fristen: Datum in der Aufgabe oder nächste Stunde derselben Einheit', () => {
  assert.equal(parseDue('- [ ] Blatt 3 bis Fr 16.10.', '2026-10-12'), '2026-10-16');
  assert.equal(parseDue('Frist: 5.1.', '2026-12-20'), '2027-01-05');
  assert.equal(parseDue('bis 16.10.27', '2026-10-12'), '2027-10-16');
  assert.equal(parseDue('ohne Frist', '2026-10-12'), null);

  const mathe = { datum: '2026-10-12', fach: 'Mathe', einheit: 'Brüche' };
  // Stundenplan: Mathe wieder am Mittwoch (Eintrag ohne Einheit passt zu jeder Einheit)
  assert.equal(nextLessonDate(settings, [], mathe), '2026-10-14');
  // eine schon angelegte Stunde derselben Einheit früher als der Stundenplan
  assert.equal(nextLessonDate(settings, [{ datum: '2026-10-13', fach: 'mathe', einheit: 'brüche' }], mathe), '2026-10-13');
  // andere Einheit zählt nicht
  assert.equal(nextLessonDate(normalizeSettings({}), [{ datum: '2026-10-13', fach: 'Mathe', einheit: 'Geometrie' }], mathe), null);
  // ohne Stundenplan: nur vorhandene Stunden
  assert.equal(nextLessonDate(normalizeSettings({}), [{ datum: '2026-10-20', fach: 'Mathe', einheit: 'Brüche' }], mathe), '2026-10-20');
  assert.equal(nextLessonDate(settings, [], { datum: '2026-10-12', fach: 'Kunst' }), null);

  const hw = withDue({ text: '- [ ] Seite 12', section: 'Hausaufgabe', lesson: mathe }, settings, [], '2026-10-12');
  assert.deepEqual([hw.due, hw.dueEstimated], ['2026-10-14', true]);
  const own = withDue({ text: '- [ ] Seite 12 bis 20.10.', section: 'Hausaufgabe', lesson: mathe }, settings, [], '2026-10-12');
  assert.deepEqual([own.due, own.dueEstimated], ['2026-10-20', false]);
  assert.equal(withDue({ text: '- [ ] x', section: 'Mitschrift', lesson: mathe }, settings, [], '2026-10-12').due, undefined);
});

test('Material-Link: Platzhalter ersetzen, anhängen, Abschnitt anlegen, CRLF, wieder entfernen', async () => {
  const { materialLinkLine, addMaterialLink, removeMaterialLink } = await import('../lib/lesson.js');
  const md = materialLinkLine('Mathe/Brüche/Material/Blatt (1).pdf', 'Mathe/Brüche/2026-10-12 x.md');
  assert.equal(md, '- [Blatt (1)](Material/Blatt%20%281%29.pdf)');
  const t = lessonText({ datum: '2026-10-12', fach: 'Mathe' });
  const one = addMaterialLink(t, md);
  assert.match(one, /## Material\n- \[Blatt \(1\)\]\(Material\/Blatt%20%281%29\.pdf\)\n\n## Mitschrift/);
  const two = addMaterialLink(one, '- [b](Material/b.pdf)');
  assert.match(two, /\.pdf\)\n- \[b\]\(Material\/b\.pdf\)\n\n## Mitschrift/);
  assert.equal(removeMaterialLink(removeMaterialLink(two, '- [b](Material/b.pdf)'), md), t);   // Platzhalter wieder da
  assert.equal(removeMaterialLink(t, md), null);
  assert.match(addMaterialLink('# T\n\n## Mitschrift\n- a\n', md), /^# T\n\n## Material\n- \[Blatt/);
  const crlf = addMaterialLink(t.replace(/\n/g, '\r\n'), md);
  assert.ok(crlf.includes('## Material\r\n- [Blatt (1)]') && !/[^\r]\n/.test(crlf));
});

test('Vorschlag für neue Dateien: laufende Stunde laut Stundenplan, sonst letzte Stunde', async () => {
  const { suggestLesson } = await import('../lib/lesson.js');
  const settings = normalizeSettings({ zeiten: [{ name: '1', von: '08:00', bis: '08:45' }, { name: '2', von: '09:00', bis: '09:45' }],
    stundenplan: [{ tag: 1, zeit: '1', fach: 'Mathe' }, { tag: 1, zeit: '2', fach: 'Bio' }] });
  const L = (path, datum, fach, zeit = '') => ({ path, meta: { typ: 'stunde', datum, fach, zeit } });
  const lessons = [L('m.md', '2026-10-12', 'Mathe', '08:00–08:45'), L('b.md', '2026-10-12', 'Bio', '09:00–09:45'), L('alt.md', '2026-10-05', 'Bio'), L('neu.md', '2026-10-20', 'Bio')];
  assert.equal(suggestLesson(settings, lessons, new Date(2026, 9, 12, 8, 30)), 'm.md');   // Montag, Mathe läuft
  assert.equal(suggestLesson(settings, lessons, new Date(2026, 9, 12, 11, 0)), 'b.md');   // Bio zuletzt angefangen
  assert.equal(suggestLesson(settings, lessons, new Date(2026, 9, 12, 7, 0)), 'alt.md');  // vor Schulbeginn: letzte Stunde
  assert.equal(suggestLesson({}, lessons, new Date(2026, 9, 15, 7, 0)), 'b.md');
  assert.equal(suggestLesson({}, [L('neu.md', '2026-10-20', 'Bio')], new Date(2026, 9, 15)), 'neu.md');
  assert.equal(suggestLesson({}, [], new Date()), null);
});
