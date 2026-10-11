// Schulheft – Stunden, Stundenplan und Fristen. Wird von Server UND Browser benutzt (keine Node-Module hier!).
// Ordnung im Notizordner:  <Fach>/<Einheit>/<JJJJ-MM-TT Titel>.md   (Stunde)
//                          <Fach>/<Einheit>/Material/                (Dateien zur Einheit)
//                          …/bilder/                                 (eingefügte Bilder, neben der Notiz)
// Ordner, die mit _ oder . beginnen, gehören der App bzw. dem System und werden nicht angezeigt.

// ── Namen ───────────────────────────────────────────────────────
export const MATERIAL_DIR = 'Material';
export const IMAGES_DIR = 'bilder';
export const isHiddenDir = name => name.startsWith('.') || name.startsWith('_') || name === 'node_modules';

// Datei-/Ordnername, der auf Windows, macOS und Linux geht (oder '' wenn nichts übrig bleibt):
// ohne <>:"/\|?* und Steuerzeichen, ohne Punkt/Leerzeichen am Anfang und Ende, Unicode in NFC, höchstens max Zeichen,
// keine reservierten Windows-Namen (CON, PRN, AUX, NUL, COM1–9, LPT1–9 – auch mit Endung wie con.txt)
const RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const trimEnds = s => s.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
export function safeName(name, max = 120) {
  let s = trimEnds(String(name ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '-').replace(/\s+/g, ' ').trim());
  if ([...s].length > max) {   // zu lang: vorne kürzen, Endung (.pdf …) behalten; nach Zeichen (nicht UTF-16-Hälften) zählen
    const e = s.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] || '';
    s = trimEnds([...s.slice(0, s.length - e.length)].slice(0, max - e.length).join('')) + e;
  }
  // Windows sieht nur den Teil vor dem ersten Punkt an: "con.txt", "NUL .tar.gz" sind gesperrt
  const dot = s.indexOf('.'), head = dot > 0 ? s.slice(0, dot) : s;
  if (RESERVED.test(head.trim())) s = head.trimEnd() + '_' + s.slice(head.length);
  return s;
}
// Fach/Einheit als Ordnername: zusätzlich ohne führendes _ (das wären App-Ordner)
export const folderName = name => safeName(String(name ?? '').replace(/^[_.\s]+/, ''), 80).replace(/^[-.\s]*$/, '');

// ── Kopf einer Notiz (--- … ---) ────────────────────────────────
// Auch mit Windows-Zeilenenden (\r\n) und BOM
const FRONT_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
export function parseFront(src) {
  src = String(src ?? '');
  const m = src.match(FRONT_RE);
  if (!m) return { meta: null, body: src };
  const meta = {};
  for (const l of m[1].split(/\r?\n/)) {
    const kv = l.match(/^([\wäöüß]+):[ \t]*(.*)$/i);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
  }
  return { meta, body: src.slice(m[0].length) };
}
export const isLesson = meta => !!meta && meta.typ === 'stunde';

// Fach und Einheit: aus dem Kopf, sonst aus dem Pfad (Fach/Einheit/Datei.md)
export function lessonInfo(meta, relPath = '') {
  if (!isLesson(meta)) return null;
  const seg = String(relPath).split('/').filter(Boolean);
  return {
    datum: meta.datum || '', zeit: meta.zeit || '',
    fach: meta.fach || (seg.length >= 2 ? seg[0] : ''),
    einheit: meta.einheit || (seg.length >= 3 && seg[1] !== MATERIAL_DIR ? seg[1] : ''),
    lehrkraft: meta.lehrkraft || '', raum: meta.raum || '',
  };
}

// ── Abschnitte einer Stunde ─────────────────────────────────────
export const SECTIONS = { material: 'Material', mitschrift: 'Mitschrift', fragen: 'Fragen', hausaufgabe: 'Hausaufgabe' };
const SECTION_RE = { material: /^Material\b/i, mitschrift: /^Mitschrift\b/i, fragen: /^Fragen\b/i, hausaufgabe: /^Hausaufgabe/i };
// Überschrift-Text (ohne #) gehört zu diesem Abschnitt?
export const isSection = (title, key) => SECTION_RE[key].test(String(title ?? '').trim());
// Zeile ist "## <Abschnitt>"?
export const isSectionHeading = (line, key) => { const m = String(line).match(/^##\s+(.*)$/); return !!m && isSection(m[1], key); };
// Zeilennummern (0-basiert) eines Abschnitts: [Überschrift, Ende) – oder null
export function sectionRange(lines, key) {
  const start = lines.findIndex(l => isSectionHeading(l, key));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l));
  if (end < 0) end = lines.length;
  return [start, end];
}

export function lessonText({ datum, zeit, fach, einheit, lehrkraft, raum, titel }) {
  const one = v => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();
  return ['---', 'typ: stunde', `datum: ${one(datum)}`, `zeit: ${one(zeit)}`, `fach: ${one(fach)}`, `einheit: ${one(einheit)}`,
    `lehrkraft: ${one(lehrkraft)}`, `raum: ${one(raum)}`, '---',
    `# ${one(titel) || one(einheit) || one(fach)}`, '',
    `## ${SECTIONS.material}`, '- ', '',
    `## ${SECTIONS.mitschrift}`, '- ', '',
    `## ${SECTIONS.fragen}`, '?? ', '',
    `## ${SECTIONS.hausaufgabe}`, '- [ ] ', ''].join('\n');
}

// ── Datum ───────────────────────────────────────────────────────
const p2 = n => String(n).padStart(2, '0');
export const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isoOf = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export function addDays(iso, n) { const [y, m, d] = iso.split('-').map(Number); return isoOf(new Date(y, m - 1, d + n)); }
// 1 = Montag … 7 = Sonntag
export function weekday(iso) { const [y, m, d] = iso.split('-').map(Number); const w = new Date(y, m - 1, d).getDay(); return w === 0 ? 7 : w; }
export const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];   // tag 1–5

// ── Einstellungen: Unterrichtszeiten und Stundenplan ─────────────
// { version: 1, zeiten: [{ name, von, bis }], stundenplan: [{ tag: 1–5, zeit: <name>, fach, einheit, lehrkraft, raum }] }
export const SETTINGS_VERSION = 1;
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const str = v => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
const hhmm = v => { const s = str(v); return TIME_RE.test(s) ? s.padStart(5, '0') : ''; };
// Unbekannte Felder bleiben erhalten (neuere Versionen speichern dort vielleicht mehr)
export function normalizeSettings(s) {
  s = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  const zeiten = [], names = new Set();
  for (const z of Array.isArray(s.zeiten) ? s.zeiten : []) {
    if (!z || typeof z !== 'object') continue;
    const name = str(z.name);
    if (!name || names.has(name)) continue;
    names.add(name);
    zeiten.push({ ...z, name, von: hhmm(z.von), bis: hhmm(z.bis) });
  }
  const stundenplan = [], slots = new Set();
  for (const e of Array.isArray(s.stundenplan) ? s.stundenplan : []) {
    if (!e || typeof e !== 'object') continue;
    const tag = Number(e.tag), zeit = str(e.zeit), fach = str(e.fach);
    if (!(tag >= 1 && tag <= 7 && Number.isInteger(tag)) || !zeit || !fach || slots.has(tag + '|' + zeit)) continue;
    slots.add(tag + '|' + zeit);
    stundenplan.push({ ...e, tag, zeit, fach, einheit: str(e.einheit), lehrkraft: str(e.lehrkraft), raum: str(e.raum) });
  }
  return { ...s, version: SETTINGS_VERSION, zeiten, stundenplan };
}

export const zeitLabel = z => (z.von && z.bis ? `${z.von}–${z.bis}` : z.von || z.name || '');
const norm = s => String(s ?? '').trim().toLowerCase();
export const sameName = (a, b) => norm(a) === norm(b);

// Stundenplan eines Tages, nach Zeit sortiert. Direkt aufeinander folgende gleiche Stunden (Doppelstunde) werden zusammengefasst.
// → [{ datum, tag, fach, einheit, lehrkraft, raum, zeiten: [Namen], von, bis, zeit: "08:00–09:30" bzw. Name }]
export function dayPlan(settings, iso) {
  const zeiten = settings?.zeiten || [], tag = weekday(iso);
  const list = (settings?.stundenplan || []).filter(e => e.tag === tag && e.fach).map(e => {
    const i = zeiten.findIndex(z => z.name === e.zeit), z = zeiten[i];
    return { ...e, datum: iso, order: i < 0 ? 999 : i, zeiten: [e.zeit], von: z?.von || '', bis: z?.bis || '' };
  }).sort((a, b) => a.order - b.order);
  const out = [];
  for (const e of list) {
    const last = out[out.length - 1];
    if (last && e.order < 999 && last.lastOrder === e.order - 1 && ['fach', 'einheit', 'lehrkraft', 'raum'].every(k => sameName(last[k], e[k]))) {
      last.zeiten.push(e.zeit); last.lastOrder = e.order; if (e.bis) last.bis = e.bis;
    } else out.push({ ...e, lastOrder: e.order });
  }
  return out.map(({ lastOrder, ...e }) => ({ ...e, zeit: e.von && e.bis ? `${e.von}–${e.bis}` : e.zeiten.join(' + ') }));
}

// Passt eine Zeitangabe ("1. Stunde", "08:00–08:45", "08:00–09:30") zu einem Eintrag?
function zeitMatches(settings, e, zeit) {
  zeit = str(zeit);
  if (!zeit) return false;
  if (zeit === e.zeit || e.zeiten.includes(zeit)) return true;
  const zs = settings?.zeiten || [];
  if (e.zeiten.some(n => { const z = zs.find(x => x.name === n); return z && zeitLabel(z) === zeit; })) return true;
  return !!e.von && zeit.startsWith(e.von);
}
// Eintrag aus dem Stundenplan für Datum + Zeit (und Fach, wenn angegeben); ohne Zeit: erster Eintrag des Fachs an dem Tag
export function planMatch(settings, iso, zeit, fach) {
  if (!ISO_RE.test(iso || '')) return null;
  const list = dayPlan(settings, iso).filter(e => !fach || sameName(e.fach, fach));
  if (str(zeit)) return list.find(e => zeitMatches(settings, e, zeit)) || null;
  return fach ? list[0] || null : null;
}
// Gehört eine Stunden-Notiz (lessonInfo) zu diesem Eintrag? (gleiches Datum und Fach; Zeit passt oder fehlt)
export const noteMatchesEntry = (settings, l, e) => l.datum === e.datum && sameName(l.fach, e.fach) && (!l.zeit || zeitMatches(settings, e, l.zeit));

// ── Fristen ─────────────────────────────────────────────────────
// In einer Aufgabe: "bis Fr 16.10.", "bis 16.10.2026", "Frist: 16.10."
const DUE_RE = /(?:\bbis|\bFrist:?)\s*(?:(?:Mo|Di|Mi|Do|Fr|Sa|So)[a-z]*\.?,?\s*)?(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2}(?!\d))?/i;
export function parseDue(text, baseIso) {
  const m = String(text).match(DUE_RE);
  if (!m || +m[2] < 1 || +m[2] > 12 || +m[1] < 1 || +m[1] > 31) return null;
  const year = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : +baseIso.slice(0, 4);
  let iso = `${year}-${p2(+m[2])}-${p2(+m[1])}`;
  if (!m[3] && Date.parse(baseIso) - Date.parse(iso) > 60 * 864e5) iso = `${year + 1}${iso.slice(4)}`;   // Dezember → Januar
  return iso;
}
// Nächste Stunde derselben Einheit nach der Stunde l: vorhandene Stunden-Notizen oder Stundenplan (bis 6 Wochen voraus)
export function nextLessonDate(settings, lessons, l) {
  if (!l?.fach || !ISO_RE.test(l.datum || '')) return null;
  let best = null;
  for (const x of lessons || [])
    if (x.datum > l.datum && sameName(x.fach, l.fach) && sameName(x.einheit, l.einheit) && (!best || x.datum < best)) best = x.datum;
  for (let i = 1; i <= 42; i++) {
    const d = addDays(l.datum, i);
    if (best && d >= best) break;
    if (dayPlan(settings, d).some(e => sameName(e.fach, l.fach) && (!e.einheit || !l.einheit || sameName(e.einheit, l.einheit)))) { best = d; break; }
  }
  return best;
}
// Aufgabe { text, section, lesson } → due (JJJJ-MM-TT) und dueEstimated ergänzen
export function withDue(t, settings, lessons, today) {
  const d = parseDue(t.text, t.lesson?.datum || today);
  if (d) { t.due = d; t.dueEstimated = false; }
  else if (t.lesson && isSection(t.section, 'hausaufgabe')) {
    const n = nextLessonDate(settings, lessons, t.lesson);
    if (n) { t.due = n; t.dueEstimated = true; }
  }
  return t;
}

// ── Material-Links in einer Stunde ──────────────────────────────
export const INBOX_DIR = '_Eingang';   // Eingang: Dateien, die später einsortiert werden
const relPath = (fromDir, to) => {
  const a = fromDir ? fromDir.split('/') : [], b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
};
// Link-Ziel wie im Editor: relativ zur Notiz, Leerzeichen und Klammern kodiert
export const linkHref = (target, fromDir) => relPath(fromDir, target).split('/').map(s => s.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')).join('/');
// "- [Arbeitsblatt](Material/Arbeitsblatt.pdf)" für eine Datei (Pfade relativ zum Notizordner, mit /)
export function materialLinkLine(target, notePath) {
  const base = target.slice(target.lastIndexOf('/') + 1);
  const label = base.replace(/\.[^.]+$/, '').trim() || base;
  const i = notePath.lastIndexOf('/');
  return `- [${label}](${linkHref(target, i < 0 ? '' : notePath.slice(0, i))})`;
}
// Wo kommt die Zeile md unter „## Material“ hin? → { from, to, insert } (Zeichen-Positionen in text, Zeilenende \n)
// Platzhalter "- " wird ersetzt; fehlt der Abschnitt, wird er vor „## Mitschrift“ (sonst nach Überschrift/Kopf) angelegt.
export function materialLinkChange(text, md) {
  const lines = text.split('\n'), starts = [];
  for (let i = 0, pos = 0; i < lines.length; pos += lines[i].length + 1, i++) starts.push(pos);
  const lineFrom = i => starts[i], lineTo = i => starts[i] + lines[i].length;
  const r = sectionRange(lines, 'material');
  if (r) {
    const [start, end] = r;
    const empty = lines.findIndex((l, i) => i > start && i < end && /^\s*[-*+]\s*$/.test(l));
    if (empty >= 0) return { from: lineFrom(empty), to: lineTo(empty), insert: md };
    let last = end - 1; while (last > start && !lines[last].trim()) last--;
    return { from: lineTo(last), to: lineTo(last), insert: '\n' + md };
  }
  const block = `## ${SECTIONS.material}\n${md}`;
  const mit = lines.findIndex(l => isSectionHeading(l, 'mitschrift'));
  const fe = lines[0] === '---' ? lines.indexOf('---', 1) + 1 : 0;
  const h1 = lines.findIndex((l, i) => i >= fe && /^#\s/.test(l));
  const after = h1 >= 0 ? h1 : fe - 1;
  if (mit >= 0) return { from: lineFrom(mit), to: lineFrom(mit), insert: `${block}\n\n` };
  if (after < 0) return { from: 0, to: 0, insert: `${block}\n\n` };
  return { from: lineTo(after), to: lineTo(after), insert: `\n\n${block}` };
}
// Text mit Windows-Zeilenenden bleibt bei Windows-Zeilenenden
const eolOf = text => (/\r\n/.test(text) ? '\r\n' : '\n');
export function addMaterialLink(text, md) {
  const eol = eolOf(text), t = text.replace(/\r\n/g, '\n'), c = materialLinkChange(t, md);
  return (t.slice(0, c.from) + c.insert + t.slice(c.to)).replace(/\n/g, eol);
}
// Rückgängig: die Zeile md (erste genau gleiche, bevorzugt unter „## Material“) wieder entfernen; null, wenn sie fehlt
export function removeMaterialLink(text, md) {
  const eol = eolOf(text), lines = text.replace(/\r\n/g, '\n').split('\n');
  const r = sectionRange(lines, 'material');
  let i = r ? lines.findIndex((l, j) => j > r[0] && j < r[1] && l.trimEnd() === md) : -1;
  if (i < 0) i = lines.findIndex(l => l.trimEnd() === md);
  if (i < 0) return null;
  // war es der einzige Eintrag im Abschnitt: wieder den Platzhalter "- " hinterlassen
  const alone = r && i > r[0] && i < r[1] && !lines.some((l, j) => j > r[0] && j < r[1] && j !== i && /^\s*[-*+]\s/.test(l));
  if (alone) lines[i] = '- '; else lines.splice(i, 1);
  return lines.join(eol);
}

// ── Vorschlag: zu welcher Stunde gehören neue Dateien? ──────────
// lessons: [{ path, meta }]. Zuerst die Stunde, die laut Stundenplan gerade läuft (oder heute zuletzt angefangen hat)
// und als Notiz existiert; sonst die letzte Stunden-Notiz bis jetzt; sonst die nächste.
const zeitKey = z => (String(z || '').match(/\d{1,2}:\d{2}/) || [''])[0].padStart(5, '0');
export function suggestLesson(settings, lessons, now = new Date()) {
  const list = (lessons || []).filter(l => l?.meta && ISO_RE.test(l.meta.datum || ''));
  if (!list.length) return null;
  const today = isoOf(now), hm = `${p2(now.getHours())}:${p2(now.getMinutes())}`;
  const started = dayPlan(settings, today).filter(e => !e.von || e.von <= hm).reverse();
  for (const e of started) {
    const n = list.find(l => noteMatchesEntry(settings, l.meta, e)) || list.find(l => l.meta.datum === today && sameName(l.meta.fach, e.fach));
    if (n) return n.path;
  }
  const key = l => `${l.meta.datum} ${zeitKey(l.meta.zeit) || '00:00'}`;
  const past = list.filter(l => l.meta.datum < today || (l.meta.datum === today && (!zeitKey(l.meta.zeit) || zeitKey(l.meta.zeit) <= hm)));
  const pick = (past.length ? past : list).slice().sort((a, b) => key(a).localeCompare(key(b)));
  return (past.length ? pick[pick.length - 1] : pick[0]).path;
}
