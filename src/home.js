// Startseite „Heute & diese Woche“: Stundenplan + Stunden-Notizen, Hausaufgaben, Fragen an Lehrkräfte
import { api, fmtDate, todayIso, prettyName, dirname, lessonTitle } from './api.js';
import { renderNote } from './render.js';
import { dayPlan, noteMatchesEntry, sameName } from '../lib/lesson.js';
import { keys } from './platform.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inline = (text, dir) => renderNote(text, dir).innerHTML.replace(/^<p>|<\/p>\s*$/g, '');

// ── Datum ────────────────────────────────────────────────────────
const p2 = n => String(n).padStart(2, '0');
const toIso = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return toIso(d); };
const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
function isoWeek(s) {
  const d = parse(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

// ── Fristen (kommen vom Server: due, dueEstimated) ──────────────
export const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.lesson?.datum || '').localeCompare(b.lesson?.datum || '') || a.line - b.line;
export function dueChip(td, today = todayIso()) {
  if (!td.due) return '';
  const n = diffDays(td.due, today);
  const when = n === 0 ? 'heute' : n === 1 ? 'morgen' : fmtDate(td.due, false);
  const label = (n < 0 ? 'überfällig · ' : '') + (td.dueEstimated ? 'nächste Stunde: ' : 'bis ') + when;
  const cls = [n < 0 ? 'over' : n === 0 ? 'today' : n === 1 ? 'soon' : '', td.dueEstimated ? 'est' : ''].join(' ');
  const title = td.dueEstimated ? 'Geschätzt: nächste Stunde dieser Einheit (Stundenplan oder vorhandene Notiz). Eigene Frist: „bis 16.10.“ in die Aufgabe schreiben.' : 'Frist aus der Aufgabe';
  return `<span class="due ${cls}" title="${esc(title)}">${esc(label)}</span>`;
}

// ── Stundenplan + vorhandene Stunden-Notizen eines Tages ────────
const zeitKey = z => (String(z || '').match(/\d{1,2}:\d{2}/) || ['99:99'])[0].padStart(5, '0');
function dayEntries(date, settings, lessons) {
  const notes = lessons.filter(l => l.meta.datum === date), used = new Set();
  const out = dayPlan(settings, date).map(e => {
    // zuerst gleiches Fach UND passende Zeit, dann nur gleiches Fach
    const free = notes.filter(l => !used.has(l));
    const n = free.find(l => noteMatchesEntry(settings, l.meta, e)) || free.find(l => sameName(l.meta.fach, e.fach));
    if (n) used.add(n);
    return { ...e, date, note: n?.path, title: n ? lessonTitle(n.meta, n.path) : '' };
  });
  notes.filter(l => !used.has(l)).forEach(l => out.push({ zeit: l.meta.zeit, fach: l.meta.fach, einheit: l.meta.einheit, lehrkraft: l.meta.lehrkraft, raum: l.meta.raum, date, note: l.path, title: lessonTitle(l.meta, l.path), order: 999 }));
  return out.sort((a, b) => a.order - b.order || zeitKey(a.zeit).localeCompare(zeitKey(b.zeit)));
}
const what = e => [e.fach, e.einheit].filter(Boolean).join(' · ');

let seq = 0;
export async function renderHome(root, ctx) {
  const my = ++seq;
  if (!root.querySelector('.home')) root.innerHTML = '<div class="page-pad home"><p class="sub">Lädt …</p></div>';
  const [settings, lessons, ov] = await Promise.all([
    api.settings().catch(() => ({ zeiten: [], stundenplan: [] })), api.lessons(null, false).catch(() => []), api.overview().catch(() => ({ marked: [], todos: [] })),
  ]);
  const hasPlan = settings.stundenplan.length > 0;
  if (my !== seq || !ctx.active('home')) return;   // inzwischen eine andere Seite
  const today = todayIso();
  const wd = parse(today).getDay();
  const mon = addDays(today, wd === 0 ? 1 : wd === 6 ? 2 : 1 - wd);   // Wochenende → nächste Woche
  const week = [0, 1, 2, 3, 4].map(i => addDays(mon, i));
  const entries = [];   // alle angezeigten Stunden (Index = data-i)
  const reg = e => { entries.push(e); return entries.length - 1; };

  // Heute
  const noPlan = 'Heute keine Stunden.';
  const todayList = dayEntries(today, settings, lessons);
  const todayHtml = todayList.length ? todayList.map(e => `
    <div class="h-lesson ${e.note ? 'has-note' : ''}" data-i="${reg(e)}" title="${e.note ? 'Notiz öffnen' : 'Notiz für diese Stunde anlegen'}">
      <div class="hl-time"><b>${esc(e.zeiten?.join(' + ') || e.zeit || '')}</b><span>${esc(e.von && e.bis ? `${e.von}–${e.bis}` : '')}</span></div>
      <div class="hl-main"><div class="hl-title">${esc(what(e))}</div><div class="hl-sub">${esc([e.title && e.title !== e.einheit && e.title !== e.fach ? e.title : '', e.lehrkraft, e.raum && `Raum ${e.raum}`].filter(Boolean).join(' · '))}</div></div>
      <button class="btn small ${e.note ? '' : 'primary'}">${e.note ? 'Öffnen' : 'Notiz anlegen'}</button>
    </div>`).join('') : `<p class="h-none">${wd === 0 || wd === 6 ? 'Heute ist Wochenende.' : noPlan}</p>`;
  const planHint = hasPlan ? '' : `<div class="h-hint"><p><b>Noch kein Stundenplan.</b> Trag einmal deine Unterrichtszeiten und Fächer ein – dann zeigt diese Seite jeden Tag deine Stunden, und neue Stunden sind mit einem Klick angelegt.</p><button class="btn primary small" data-act="settings">Stundenplan eintragen</button></div>`;

  // Woche (ohne heute); ab Donnerstag auch die nächste Woche
  const nextWeek = wd >= 4 && wd <= 5 ? [0, 1, 2, 3, 4].map(i => addDays(mon, 7 + i)) : [];
  const weekHtml = days => days.filter(d => d !== today).map(d => {
    const list = dayEntries(d, settings, lessons);
    return `<div class="hw-day ${d < today ? 'past' : ''}">
      <div class="hw-name"><b>${esc(fmtDate(d, false).split(' ')[0])}</b><span>${esc(fmtDate(d, false).split(' ')[1])}</span></div>
      <div class="hw-items">${list.length ? list.map(e => `<button class="hw-item" data-i="${reg(e)}" title="${esc(`${what(e)} · ${e.lehrkraft || ''}`)}${e.note ? ' – Notiz öffnen' : ' – Notiz anlegen'}">
        <span class="hw-b">${esc(e.von || (e.zeit || '').slice(0, 10))}</span><span class="hw-what">${esc(what(e))}</span><span class="hw-t">${esc(e.lehrkraft || '')}</span>
        <span class="hw-st ${e.note ? 'on' : ''}">${e.note ? 'Notiz' : '+ Notiz'}</span></button>`).join('') : '<p class="h-none">Keine Stunden.</p>'}</div>
    </div>`;
  }).join('');

  // Hausaufgaben: offene Aufgaben aus „Hausaufgabe“ in Stunden + alle Aufgaben mit Frist
  const todos = ov.todos || [];
  ctx.applyLive(todos);
  const hw = todos.filter(t => (!t.done || t.unsaved) && (t.due || t.homework)).sort(byDue);
  const src = t => t.lesson ? `${fmtDate(t.lesson.datum, false)} · ${what(t.lesson)}` : prettyName(t.path);
  const hwHtml = hw.length ? hw.map(t => `
    <div class="item todo h-task ${t.done ? 'done' : ''}" data-path="${esc(t.path)}" data-line="${t.line}">
      <input type="checkbox" ${t.done ? 'checked' : ''} title="${keys('Abhaken (danach in der Notiz ⌘S)')}">
      <div class="item-text">${inline(t.text.replace(/^[-*+]\s+\[[ xX]\]\s*/, ''), dirname(t.path))}
        <div class="td-meta">${t.done ? `<span class="due unsaved">${keys('abgehakt – noch nicht gespeichert (⌘S)')}</span>` : dueChip(t, today)}<span class="td-src">${esc(src(t))}</span></div></div>
    </div>`).join('') : '';

  // Fragen an Lehrkräfte: offene ??-Zeilen (ohne → Antwort, auch nicht in der Zeile darunter)
  const qs = (ov.marked || [])
    .filter(m => /^(?:[-*+]\s+)?\?\?/.test(m.text) && !m.answered)
    .map(m => ({ ...m, q: m.text.replace(/^(?:[-*+]\s+)?\?\?\s*/, '') })).filter(m => m.q);
  const groups = new Map();
  qs.forEach(m => { const k = m.lesson?.lehrkraft || (m.lesson ? 'Ohne Lehrkraft' : 'Andere Notizen'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); });
  // nächster Unterricht bei dieser Lehrkraft laut Stundenplan (bis 3 Wochen voraus)
  const nextWith = who => Array.from({ length: 21 }, (_, i) => addDays(today, i)).map(d => [d, dayPlan(settings, d).find(e => e.lehrkraft && sameName(e.lehrkraft, who))]).find(x => x[1]);
  const qGroups = [...groups].map(([who, list]) => ({ who, list, next: nextWith(who) }))
    .sort((a, b) => (a.next?.[0] || '9999').localeCompare(b.next?.[0] || '9999') || a.who.localeCompare(b.who, 'de'));
  const qHtml = qGroups.length ? qGroups.map(g => `<div class="hq-group">
      <div class="hq-who"><b>${esc(g.who)}</b>${g.next ? `<span>nächster Unterricht: ${esc(g.next[0] === today ? 'heute' : fmtDate(g.next[0], false))} ${esc(g.next[1].von || g.next[1].zeit)}</span>` : ''}</div>
      ${g.list.map(m => `<div class="item hq-item" data-path="${esc(m.path)}" data-line="${m.line}"><span class="badge k-ask">??</span><div class="item-text">${inline(m.q, dirname(m.path))}<div class="td-meta"><span class="td-src">${esc(m.lesson ? fmtDate(m.lesson.datum, false) + ' · ' + what(m.lesson) : prettyName(m.path))}</span></div></div></div>`).join('')}
    </div>`).join('') : '<p class="h-none">Keine offenen Fragen. Fragen im Unterricht mit <code>??</code> am Zeilenanfang schreiben, Antwort mit <code>→</code> dahinter.</p>';

  const overdue = hw.filter(t => !t.done && t.due && t.due < today).length;
  const weekHas = days => hasPlan || days.some(d => lessons.some(l => l.meta.datum === d));
  root.innerHTML = `<div class="page-pad home">
    <div class="view-head"><div><p class="eyebrow">KW ${isoWeek(today)} · ${esc(fmtDate(today))}</p><h1>Heute &amp; diese Woche</h1></div></div>
    ${planHint}
    ${ctx.inboxCount?.() ? `<div class="h-hint h-inbox"><p><b>📥 Eingang (${ctx.inboxCount()})</b> – ${ctx.inboxCount() === 1 ? 'eine Datei wartet' : `${ctx.inboxCount()} Dateien warten`} darauf, einsortiert zu werden.</p><button class="btn primary small" data-act="inbox">Jetzt einsortieren</button></div>` : ''}
    <section class="home-sec"><h2>Heute <span class="hs-sub">${esc(fmtDate(today, false))}</span></h2><div class="h-lessons">${todayHtml}</div></section>
    <section class="home-sec"><h2>Hausaufgaben <span class="hs-sub">${hw.filter(t => !t.done).length} offen${overdue ? ` · <span class="hs-over">${overdue} überfällig</span>` : ''}</span></h2>${hwHtml ? `<div class="h-box">${hwHtml}</div>` : '<p class="h-none">Keine offenen Hausaufgaben.</p>'}</section>
    <section class="home-sec"><h2>Fragen an Lehrkräfte <span class="hs-sub">${qs.length}</span></h2>${qHtml}</section>
    ${weekHas(week) ? `<section class="home-sec"><h2>${wd === 0 || wd === 6 ? 'Nächste Woche' : 'Diese Woche'} <span class="hs-sub">${esc(fmtDate(week[0], false))} – ${esc(fmtDate(week[4], false))}</span></h2><div class="hw-week">${weekHtml(week)}</div></section>` : ''}
    ${nextWeek.length && weekHas(nextWeek) ? `<section class="home-sec"><h2>Nächste Woche <span class="hs-sub">${esc(fmtDate(nextWeek[0], false))} – ${esc(fmtDate(nextWeek[4], false))}</span></h2><div class="hw-week">${weekHtml(nextWeek)}</div></section>` : ''}
  </div>`;

  let busy = false;
  root.onclick = async e => {
    if (e.target.closest('a')) return;
    if (e.target.closest('[data-act=settings]')) { ctx.showPage('settings'); return; }
    if (e.target.closest('[data-act=inbox]')) { ctx.openInbox(); return; }
    const task = e.target.closest('.h-task');
    if (task && e.target.matches('input[type=checkbox]')) { await ctx.toggleTask(task.dataset.path, +task.dataset.line); return; }
    const les = e.target.closest('[data-i]');
    if (les) {
      const en = entries[+les.dataset.i];
      if (en.note) { ctx.openNote(en.note); return; }
      if (busy) return;
      busy = true;
      try { await createLesson(en, ctx); } finally { busy = false; }
      return;
    }
    const it = e.target.closest('.item[data-path]');
    if (it) ctx.openNote(it.dataset.path, +it.dataset.line);
  };
}

// Ein Klick: Stunden-Notiz mit den Daten aus dem Stundenplan anlegen (Ordner <Fach>/<Einheit> legt der Server an)
async function createLesson(en, ctx) {
  try {
    const r = await api.createLesson({ datum: en.date, zeit: en.zeit || '', fach: en.fach, einheit: en.einheit || '', lehrkraft: en.lehrkraft || '', raum: en.raum || '' });
    await ctx.afterCreate(r.path, r.dir);
    await ctx.openNewLesson(r.path);
    ctx.toast(`Stunde angelegt in ${r.dir}`);
  } catch (err) { ctx.toast(err.message, true); }
}
