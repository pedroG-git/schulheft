// Stunden: Übersicht eines Ordners (Fach → Einheit → Stunden) und "Neue Stunde"
import { api, basename, fmtDate, todayIso, prettyName, lessonTitle, shortZeit } from './api.js';
import { renderNote, parseFront } from './render.js';
import { sectionRange, isSection, planMatch, dayPlan, zeitLabel, sameName, MATERIAL_DIR } from '../lib/lesson.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inline = (text, dir) => renderNote(text, dir).innerHTML.replace(/^<p>|<\/p>\s*$/g, '');

// Wichtige Zeilen einer Stunde herausziehen (mit Zeilennummer zum Hinspringen)
const RE = {
  def: /^\s*(?:[-*+]\s+)?DEF:\s*/,
  imp: /^\s*(?:[-*+]\s+)?(!!|EXAM:|TEST:)\s*/,
  ask: /^\s*(?:[-*+]\s+)?\?\?\s*/,
  todo: /^\s*[-*+] \[ \]\s*/,
};
function extract(lesson) {
  const lines = lesson.text.split(/\r?\n/);
  const { body } = parseFront(lesson.text);
  const offset = lines.length - body.split(/\r?\n/).length;
  const out = { def: [], imp: [], ask: [], todo: [], hw: 0, mat: 0 };
  let fence = false, section = '';
  body.split(/\r?\n/).forEach((l, i) => {
    if (/^\s*```/.test(l)) fence = !fence;
    if (fence) return;
    const h = l.match(/^(#{1,6})\s+(.*)/);
    if (h) { if (h[1].length <= 3) section = h[2]; return; }
    for (const k of ['def', 'imp', 'ask', 'todo']) {
      if (!RE[k].test(l)) continue;
      const text = l.replace(RE[k], '').trim();
      if (!text) break;
      const kind = k === 'imp' ? (/EXAM:|TEST:/.test(l) ? 'exam' : 'imp') : k;
      out[k].push({ text, line: offset + i + 1, kind, lesson });
      if (k === 'todo' && isSection(section, 'hausaufgabe')) out.hw++;
      break;
    }
  });
  // Material: Einträge in „## Material“ (ohne leere Platzhalter)
  const r = sectionRange(lines, 'material');
  if (r) out.mat = lines.slice(r[0] + 1, r[1]).filter(l => /^\s*[-*+]\s*\S/.test(l) || /\[[^\]]*\]\(/.test(l)).length;
  return out;
}

let state = { tab: 'lessons', einheit: '' };
// Gruppe einer Stunde: "Fach / Einheit"
const groupOf = l => [l.meta.fach, l.meta.einheit].filter(Boolean).join(' / ') || 'Ohne Fach';

export async function renderOverview(root, dir, ctx) {
  root.innerHTML = '<div class="page-pad"><p class="sub">Lädt …</p></div>';
  const lessons = await api.lessons(dir, true);
  const others = ctx.notesIn(dir).filter(p => !lessons.some(l => l.path === p));
  const groups = [...new Set(lessons.map(groupOf))];
  if (state.einheit && !groups.includes(state.einheit)) state.einheit = '';
  const shown = lessons.filter(l => !state.einheit || groupOf(l) === state.einheit);
  const ex = new Map(shown.map(l => [l, extract(l)]));
  const name = basename(dir) || 'Alle Fächer';
  const range = lessons.length ? `${fmtDate(lessons[0].meta.datum, false)} – ${fmtDate(lessons[lessons.length - 1].meta.datum, false)}` : '';

  const src = it => `<button class="src" data-path="${esc(it.lesson.path)}" data-line="${it.line}" title="Zur Stelle springen">${esc(fmtDate(it.lesson.meta.datum, false))} ${esc(shortZeit(it.lesson.meta.zeit))}</button>`;
  const items = k => [...ex.values()].flatMap(e => e[k]);

  let body = '';
  if (!lessons.length) {
    body = `<div class="empty-box"><p>In diesem Ordner gibt es noch keine Stunden.</p><button class="btn primary" data-act="new">Erste Stunde anlegen</button></div>`;
  } else if (state.tab === 'lessons') {
    const row = l => {
      const e = ex.get(l);
      const chips = [[e.def.length, 'DEF', 'def'], [e.imp.length, 'Wichtig', 'imp'], [e.ask.length, 'Fragen', 'ask'], [e.hw, 'Hausaufgaben offen', 'todo'], [e.todo.length - e.hw, 'Aufgaben offen', 'todo'], [e.mat, 'Material', 'mat']]
        .filter(c => c[0]).map(([n, t, k]) => `<span class="mini-chip k-${k}">${n} ${t}</span>`).join('');
      return `<button class="lesson-row" data-path="${esc(l.path)}">
        <div class="lr-date"><b>${esc(fmtDate(l.meta.datum, false).split(' ')[1] || '')}</b><span>${esc([fmtDate(l.meta.datum, false).split(' ')[0], shortZeit(l.meta.zeit)].filter(Boolean).join(' · '))}</span></div>
        <div class="lr-main"><div class="lr-title">${esc(lessonTitle(l.meta, l.path))}</div><div class="lr-sub">${esc(l.meta.lehrkraft || '')}${chips ? ` <span class="lr-chips">${chips}</span>` : ''}</div></div>
      </button>`;
    };
    // Fach → Einheit: eine Gruppe pro Einheit (in Reihenfolge der ersten Stunde)
    const byGroup = new Map();
    shown.forEach(l => { const g = groupOf(l); if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(l); });
    body = [...byGroup].sort((a, b) => a[0].localeCompare(b[0], 'de', { numeric: true })).map(([g, list]) =>
      `${byGroup.size > 1 || groups.length > 1 ? `<h3 class="ov-h">${esc(g)} <span class="count">${list.length}</span></h3>` : ''}<div class="lesson-list">${list.map(row).join('')}</div>`).join('')
      + (others.length ? `<h3 class="ov-h">Weitere Notizen</h3><div class="lesson-list">${others.map(p => `<button class="lesson-row" data-path="${esc(p)}"><div class="lr-main"><div class="lr-title">${esc(prettyName(p))}</div></div></button>`).join('')}</div>` : '');
  } else if (state.tab === 'summary') {
    const sec = (title, k, cls) => {
      const list = items(k);
      if (!list.length) return '';
      return `<section class="ov-sec ${cls}"><h3>${title} <span class="count">${list.length}</span></h3>
        ${list.map(it => `<div class="ov-item k-${it.kind}"><div class="ov-text">${k === 'todo' ? '☐ ' : ''}${inline(it.text, dir)}</div><div class="ov-src">${src(it)}</div></div>`).join('')}</section>`;
    };
    body = sec('Wichtig und Prüfung', 'imp', 'imp') + sec('Definitionen', 'def', 'def') + sec('Offene Fragen', 'ask', 'ask') + sec('Offene Aufgaben', 'todo', 'todo')
      || '<p class="empty">Noch keine markierten Zeilen (DEF:, !!, EXAM:, ??, - [ ]).</p>';
  } else if (state.tab === 'material') {
    body = await materialHtml(dir);
  } else {
    body = shown.map(l => {
      const box = renderNote(l.text, l.path.split('/').slice(0, -1).join('/'));
      box.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.disabled = true; });
      return `<article class="all-lesson"><div class="al-head"><span>${esc([fmtDate(l.meta.datum), l.meta.zeit, groupOf(l), l.meta.lehrkraft].filter(Boolean).join(' · '))}</span><button class="btn small" data-path="${esc(l.path)}">Öffnen</button></div><div class="markdown">${box.innerHTML}</div></article>`;
    }).join('');
  }

  root.innerHTML = `<div class="page-pad overview">
    <div class="view-head"><div><p class="eyebrow">Übersicht</p><h1>${esc(name)}</h1><p class="sub">${lessons.length} ${lessons.length === 1 ? 'Stunde' : 'Stunden'}${range ? ` · ${range}` : ''} · wird automatisch aus den Stunden zusammengestellt</p></div>
      <div class="head-actions"><button class="btn primary" data-act="new">+ Neue Stunde</button></div></div>
    ${lessons.length ? `<div class="ov-bar">
      <div class="seg">${[['lessons', 'Stunden'], ['summary', 'Zusammenfassung'], ['all', 'Alles lesen'], ['material', 'Material']].map(([k, t]) => `<button class="${state.tab === k ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>
      ${groups.length > 1 && state.tab !== 'material' ? `<select class="ov-select" title="Einheit"><option value="">Alle Einheiten</option>${groups.map(g => `<option ${g === state.einheit ? 'selected' : ''} value="${esc(g)}">${esc(g)}</option>`).join('')}</select>` : ''}
    </div>` : ''}
    ${body}</div>`;

  root.onclick = e => {
    const t = e.target.closest('[data-tab]');
    if (t) { state.tab = t.dataset.tab; renderOverview(root, dir, ctx); return; }
    if (e.target.closest('[data-act=new]')) { lessonForm(ctx, { dir }).then(p => p && ctx.openNewLesson(p)); return; }
    if (e.target.closest('a')) return;
    const d = e.target.closest('[data-doc]');
    if (d) { ctx.openDoc(d.dataset.doc); return; }
    const j = e.target.closest('[data-path]');
    if (j) ctx.openNote(j.dataset.path, j.dataset.line ? +j.dataset.line : undefined);
  };
  root.querySelector('.ov-select')?.addEventListener('change', e => { state.einheit = e.target.value; renderOverview(root, dir, ctx); });
}

// ── Material: Dateien in den Material-Ordnern und alle Links aus den Stunden, nach Einheit ──
async function materialHtml(dir) {
  let groups;
  try { groups = await api.material(dir); } catch (e) { return `<p class="empty">${esc(e.message)}</p>`; }
  if (!groups.length) return `<div class="empty-box"><p>Noch kein Material.</p><p class="sub">PDF, Foto oder Word-Datei auf eine offene Stunde ziehen – sie wird im Ordner <code>${MATERIAL_DIR}</code> der Einheit gespeichert und unter „Material“ verlinkt.</p></div>`;
  const icon = n => /\.pdf$/i.test(n) ? '📄' : /\.(png|jpe?g|gif|webp)$/i.test(n) ? '🖼' : '📎';
  return groups.map(g => `<section class="ov-sec mat"><h3>${esc(g.title)} <span class="count">${g.items.length}</span></h3>
    ${g.items.map(it => `<button class="mat-row ${it.exists ? '' : 'missing'}" ${it.exists ? `data-doc="${esc(it.path)}"` : 'disabled'} title="${esc(it.path)}">
      <span class="mat-ico">${icon(it.name)}</span>
      <span class="mat-main"><span class="mat-name">${esc(it.label)}</span><span class="mat-sub">${esc([it.date && fmtDate(it.date, false), it.path.split('/').slice(0, -1).join('/'), it.exists ? '' : 'Datei fehlt'].filter(Boolean).join(' · '))}</span></span>
      ${it.from.length ? `<span class="mat-from" title="Verlinkt in ${esc(it.from.map(f => fmtDate(f.datum, false) + ' ' + shortZeit(f.zeit)).join(', '))}">in ${it.from.length === 1 ? esc(fmtDate(it.from[0].datum, false)) : it.from.length + ' Stunden'}</span>` : ''}
    </button>`).join('')}</section>`).join('');
}

// ── Neue Stunde ──────────────────────────────────────────────────
// Fächer = Ordner auf oberster Ebene, Einheiten = Unterordner (ohne Material/bilder, die zeigt der Baum nicht)
const subDirs = nodes => nodes.filter(n => n.dir).map(n => n.name);
const nowHHMM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export async function lessonForm(ctx, { dir, date } = {}) {
  date = date || todayIso();
  const tree = ctx.tree();
  const settings = await api.settings().catch(() => ({ zeiten: [], stundenplan: [] }));
  const all = await api.lessons(null, false).catch(() => []);
  const uniq = a => [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y, 'de'));
  const faecher = uniq([...subDirs(tree), ...settings.stundenplan.map(e => e.fach)]);
  const einheitenOf = fach => uniq([...subDirs(tree.find(n => n.dir && sameName(n.name, fach))?.children || []), ...settings.stundenplan.filter(e => sameName(e.fach, fach)).map(e => e.einheit), ...all.filter(l => sameName(l.meta.fach, fach)).map(l => l.meta.einheit)]);
  const teachers = uniq([...all.map(l => l.meta.lehrkraft), ...settings.stundenplan.map(e => e.lehrkraft)]);
  // Aus dem Ordner (Rechtsklick „Neue Stunde hier“): Fach/Einheit vorbelegen
  const seg = (dir || '').split('/').filter(Boolean);
  const start = { fach: seg[0] || '', einheit: seg[1] && seg[1] !== MATERIAL_DIR ? seg[1] : '' };
  // Heute: laufende oder nächste Unterrichtszeit vorschlagen
  let zeit = '';
  if (date === todayIso() && settings.zeiten.length) {
    const now = nowHHMM(), z = settings.zeiten.find(z => z.von && z.bis && z.von <= now && now <= z.bis) || settings.zeiten.find(z => z.von && z.von > now);
    if (z) zeit = zeitLabel(z);
  }

  return new Promise(res => {
    const m = document.getElementById('modal');
    m.innerHTML = `<form class="modal-card lesson-form" autocomplete="off">
      <h3>Neue Stunde</h3>
      <div class="lf-grid lf-date">
        <label>Datum<input type="date" name="datum" value="${esc(date)}" required></label>
        <label>Zeit<input name="zeit" list="lf-zeit" value="${esc(zeit)}" placeholder="z. B. 08:00–09:30"></label>
      </div>
      <div class="sched"></div>
      <div class="lf-grid">
        <label>Fach<input name="fach" list="lf-fach" value="${esc(start.fach)}" placeholder="z. B. Mathe" required></label>
        <label>Einheit <small>(Thema/Kapitel, frei)</small><input name="einheit" list="lf-einheit" value="${esc(start.einheit)}" placeholder="z. B. Bruchrechnung"></label>
        <label class="wide">Titel <small>(optional)</small><input name="thema" placeholder="Worum ging es heute?"></label>
        <label>Lehrkraft<input name="lehrkraft" list="lf-t"></label>
        <label>Raum<input name="raum"></label>
      </div>
      <p class="lf-where"></p>
      <datalist id="lf-zeit">${settings.zeiten.map(z => `<option value="${esc(zeitLabel(z))}">${esc(z.name)}</option>`).join('')}</datalist>
      <datalist id="lf-fach">${faecher.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="lf-einheit"></datalist>
      <datalist id="lf-t">${teachers.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <div class="modal-btns"><button class="btn primary" type="submit">Stunde anlegen</button><button class="btn" type="button" data-cancel>Abbrechen</button></div>
    </form>`;
    m.classList.add('show');
    const f = m.querySelector('form');
    const done = v => { m.classList.remove('show'); m.innerHTML = ''; document.removeEventListener('keydown', key, true); res(v); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
    document.addEventListener('keydown', key, true);
    m.onclick = e => { if (e.target === m || e.target.closest('[data-cancel]')) done(null); };

    // Felder, die der Stundenplan ausgefüllt hat, darf er wieder ändern; selbst getippte nicht
    const auto = new Set();
    const FIELDS = ['fach', 'einheit', 'lehrkraft', 'raum'];
    const fill = (e, force) => {
      for (const k of FIELDS) if (force || !f[k].value.trim() || auto.has(k)) { f[k].value = e?.[k] || (auto.has(k) ? '' : f[k].value); if (e) auto.add(k); }
      if (e && (force || !f.zeit.value.trim() || auto.has('zeit'))) { f.zeit.value = e.zeit; auto.add('zeit'); }
      update();
    };
    FIELDS.concat('zeit').forEach(k => f[k].addEventListener('input', () => auto.delete(k)));
    const update = () => {
      m.querySelector('#lf-einheit').innerHTML = einheitenOf(f.fach.value).map(x => `<option value="${esc(x)}">`).join('');
      const where = [f.fach.value.trim(), f.einheit.value.trim()].filter(Boolean).join(' / ');
      m.querySelector('.lf-where').textContent = where ? `Wird gespeichert in: ${where}` : '';
    };
    // Datum oder Zeit geändert → passenden Eintrag im Stundenplan suchen
    const match = () => { const e = planMatch(settings, f.datum.value, f.zeit.value); if (e) fill(e); };
    f.zeit.addEventListener('change', match);
    f.fach.addEventListener('change', () => {
      const e = planMatch(settings, f.datum.value, f.zeit.value, f.fach.value) || planMatch(settings, f.datum.value, '', f.fach.value);
      if (e) fill({ ...e, fach: f.fach.value }); else update();
      if (!f.lehrkraft.value) f.lehrkraft.value = settings.stundenplan.find(x => sameName(x.fach, f.fach.value) && x.lehrkraft)?.lehrkraft || [...all].reverse().find(l => sameName(l.meta.fach, f.fach.value))?.meta.lehrkraft || '';
    });
    f.einheit.addEventListener('input', update);

    // Stundenplan des Tages als Schnellauswahl
    const showPlan = () => {
      const box = m.querySelector('.sched'), list = dayPlan(settings, f.datum.value || date);
      if (!settings.stundenplan.length) { box.innerHTML = '<p class="sched-h">Tipp: Mit einem Stundenplan (Einstellungen) wird dieses Formular automatisch ausgefüllt.</p>'; return; }
      box.innerHTML = list.length
        ? `<p class="sched-h">Stundenplan ${esc(fmtDate(f.datum.value))} – antippen zum Übernehmen:</p>${list.map((e, i) => `<button type="button" class="sched-btn" data-i="${i}"><b>${esc(e.zeit)}</b> ${esc([e.fach, e.einheit].filter(Boolean).join(' · '))} <span>${esc(e.lehrkraft)}</span></button>`).join('')}`
        : `<p class="sched-h">Laut Stundenplan kein Unterricht am ${esc(fmtDate(f.datum.value))}. Bitte selbst ausfüllen.</p>`;
      box.onclick = e => {
        const b = e.target.closest('.sched-btn');
        if (!b) return;
        fill(list[+b.dataset.i], true);
        box.querySelectorAll('.sched-btn').forEach(x => x.classList.toggle('on', x === b));
      };
    };
    f.datum.addEventListener('change', () => { showPlan(); match(); });
    showPlan();
    if (!start.fach) match(); else update();

    f.addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(f));
      try {
        const r = await api.createLesson(data);
        done(r.path);
        await ctx.afterCreate?.(r.path, r.dir);
      } catch (err) { ctx.toast(err.message, true); }
    });
    setTimeout(() => (f.fach.value ? f.thema : f.fach).focus(), 0);
  });
}
