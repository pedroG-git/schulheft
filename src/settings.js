// Einstellungen: Unterrichtszeiten, Stundenplan (Mo–Fr) und Notizordner.
// Zeiten und Stundenplan liegen im Notizordner (.schulheft/einstellungen.json) und werden sofort gespeichert.
import { api } from './api.js';
import { WEEKDAYS, sameName } from '../lib/lesson.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Vorlage für den schnellen Start: 6 Stunden à 45 Minuten mit kurzen Pausen
const TEMPLATE = [['1. Stunde', '08:00', '08:45'], ['2. Stunde', '08:50', '09:35'], ['3. Stunde', '09:55', '10:40'], ['4. Stunde', '10:45', '11:30'], ['5. Stunde', '11:45', '12:30'], ['6. Stunde', '12:35', '13:20']]
  .map(([name, von, bis]) => ({ name, von, bis }));

export async function renderSettings(root, ctx) {
  let s = await api.settings();
  if (!ctx.active('settings')) return;

  const save = async (next, msg = 'Gespeichert ✓') => {
    try { s = await api.saveSettings({ zeiten: next.zeiten, stundenplan: next.stundenplan }); ctx.toast(msg); }
    catch (e) { ctx.toast('Speichern fehlgeschlagen: ' + e.message, true); }
    draw();
  };

  function draw() {
    const info = ctx.info;
    const zeitenHtml = s.zeiten.length ? `<div class="st-times">
        <div class="st-time st-head"><span>Name</span><span>von</span><span>bis</span><span></span></div>
        ${s.zeiten.map((z, i) => `<div class="st-time" data-i="${i}">
          <input name="name" value="${esc(z.name)}" placeholder="z. B. 1. Stunde">
          <input name="von" type="time" value="${esc(z.von)}">
          <input name="bis" type="time" value="${esc(z.bis)}">
          <button class="icon-btn st-del" title="Zeit entfernen">✕</button></div>`).join('')}
      </div>` : `<p class="sub">Noch keine Zeiten. Trag sie selbst ein oder nimm die Vorlage und pass sie an.</p>`;

    const cell = (tag, z) => {
      const e = s.stundenplan.find(x => x.tag === tag && x.zeit === z.name);
      return `<td><button class="st-cell ${e ? 'on' : ''}" data-tag="${tag}" data-zeit="${esc(z.name)}" title="${e ? 'Ändern' : 'Fach eintragen'}">
        ${e ? `<b>${esc(e.fach)}</b>${e.einheit ? `<small>${esc(e.einheit)}</small>` : ''}${e.lehrkraft || e.raum ? `<small>${esc([e.lehrkraft, e.raum].filter(Boolean).join(' · '))}</small>` : ''}` : '<span class="st-plus">+</span>'}</button></td>`;
    };
    const planHtml = s.zeiten.length ? `<div class="st-plan-wrap"><table class="st-plan">
        <thead><tr><th></th>${WEEKDAYS.map(d => `<th>${d}</th>`).join('')}</tr></thead>
        <tbody>${s.zeiten.map(z => `<tr><th><b>${esc(z.name)}</b>${z.von ? `<small>${esc(z.von)}${z.bis ? '–' + esc(z.bis) : ''}</small>` : ''}</th>${WEEKDAYS.map((_, i) => cell(i + 1, z)).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <p class="sub">Feld antippen = Fach eintragen. Gleiches Fach in zwei Stunden hintereinander = Doppelstunde.</p>`
      : '<p class="sub">Zuerst oben die Unterrichtszeiten eintragen.</p>';

    root.innerHTML = `<div class="page-pad settings">
      <div class="view-head"><div><h1>Einstellungen</h1><p class="sub">Einmal eintragen – danach zeigt die Startseite deine Stunden, und neue Stunden sind schnell angelegt.</p></div></div>
      <section class="help-card st-card"><h3>Unterrichtszeiten</h3>
        ${zeitenHtml}
        <p class="st-actions"><button class="btn small" data-act="add-time">+ Zeit hinzufügen</button>${s.zeiten.length ? '' : '<button class="btn small" data-act="template">Vorlage: 6 Stunden à 45 Minuten</button>'}</p>
      </section>
      <section class="help-card st-card"><h3>Stundenplan</h3>${planHtml}</section>
      ${info?.root ? `<section class="help-card st-card"><h3>Notizordner</h3><ul><li>Deine Notizen und Dokumente liegen in:<br><code>${esc(info.root)}</code></li>
        <li>Das Programm liegt getrennt davon – Updates ändern nichts an diesem Ordner.</li>
        <li>Zeiten und Stundenplan werden in diesem Ordner gespeichert (<code>.schulheft</code>) – sie wandern also mit deinen Notizen mit.</li></ul>
        ${info.rootFrom === 'env' ? '<p class="sub">Festgelegt über SCHULHEFT_ROOT.</p>' : '<p><button class="btn small" data-act="change-root">Ordner ändern …</button></p>'}</section>` : ''}
    </div>`;
  }

  // Zeiten: Name ändern → Stundenplan-Einträge mitnehmen; Zeit entfernen → ihre Einträge auch
  root.onchange = e => {
    const row = e.target.closest('.st-time[data-i]');
    if (!row) return;
    const i = +row.dataset.i, z = { ...s.zeiten[i] }, old = z.name;
    z[e.target.name] = e.target.value.trim();
    if (!z.name) { ctx.toast('Die Zeit braucht einen Namen', true); draw(); return; }
    if (z.name !== old && s.zeiten.some((x, k) => k !== i && x.name === z.name)) { ctx.toast('Diesen Namen gibt es schon', true); draw(); return; }
    const zeiten = s.zeiten.map((x, k) => (k === i ? z : x));
    const stundenplan = s.stundenplan.map(x => (x.zeit === old ? { ...x, zeit: z.name } : x));
    save({ zeiten, stundenplan });
  };
  root.onclick = async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'change-root') { ctx.changeRoot(); return; }
    if (act === 'template') { save({ zeiten: TEMPLATE, stundenplan: s.stundenplan }); return; }
    if (act === 'add-time') {
      let n = s.zeiten.length + 1;
      while (s.zeiten.some(z => z.name === `${n}. Stunde`)) n++;
      const last = s.zeiten[s.zeiten.length - 1];
      await save({ zeiten: [...s.zeiten, { name: `${n}. Stunde`, von: last?.bis || '', bis: '' }], stundenplan: s.stundenplan });
      root.querySelector('.st-time[data-i]:last-child input[name=von]')?.focus();
      return;
    }
    const del = e.target.closest('.st-del');
    if (del) {
      const z = s.zeiten[+del.closest('.st-time').dataset.i];
      const used = s.stundenplan.filter(x => x.zeit === z.name).length;
      if (used && await ctx.ask({ title: `„${z.name}“ entfernen?`, text: `Im Stundenplan stehen ${used} Einträge zu dieser Zeit. Sie werden auch entfernt.`, buttons: [{ id: 'yes', label: 'Entfernen', danger: true }, { id: 'no', label: 'Abbrechen' }] }) !== 'yes') return;
      save({ zeiten: s.zeiten.filter(x => x !== z), stundenplan: s.stundenplan.filter(x => x.zeit !== z.name) });
      return;
    }
    const c = e.target.closest('.st-cell');
    if (c) editCell(+c.dataset.tag, c.dataset.zeit);
  };

  // Ein Feld im Stundenplan: kleines Formular
  function editCell(tag, zeit) {
    const cur = s.stundenplan.find(x => x.tag === tag && x.zeit === zeit);
    const faecher = [...new Set([...ctx.tree().filter(n => n.dir).map(n => n.name), ...s.stundenplan.map(x => x.fach)])].sort((a, b) => a.localeCompare(b, 'de'));
    const m = document.getElementById('modal');
    m.innerHTML = `<form class="modal-card lesson-form" autocomplete="off">
      <h3>${esc(WEEKDAYS[tag - 1])} · ${esc(zeit)}</h3>
      <div class="lf-grid">
        <label>Fach<input name="fach" list="st-fach" value="${esc(cur?.fach)}" placeholder="z. B. Mathe"></label>
        <label>Einheit <small>(optional)</small><input name="einheit" value="${esc(cur?.einheit)}" placeholder="z. B. Bruchrechnung"></label>
        <label>Lehrkraft<input name="lehrkraft" value="${esc(cur?.lehrkraft)}"></label>
        <label>Raum<input name="raum" value="${esc(cur?.raum)}"></label>
      </div>
      <datalist id="st-fach">${faecher.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <div class="modal-btns"><button class="btn primary" type="submit">Übernehmen</button>${cur ? '<button class="btn danger" type="button" data-clear>Leeren</button>' : ''}<button class="btn" type="button" data-cancel>Abbrechen</button></div>
    </form>`;
    m.classList.add('show');
    const f = m.querySelector('form');
    const close = () => { m.classList.remove('show'); m.innerHTML = ''; document.removeEventListener('keydown', key, true); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener('keydown', key, true);
    const rest = s.stundenplan.filter(x => x !== cur);
    m.onclick = e => {
      if (e.target === m || e.target.closest('[data-cancel]')) close();
      if (e.target.closest('[data-clear]')) { close(); save({ zeiten: s.zeiten, stundenplan: rest }); }
    };
    // Gleiches Fach schon woanders eingetragen → Lehrkraft und Raum vorschlagen
    f.fach.addEventListener('change', () => {
      const o = s.stundenplan.find(x => sameName(x.fach, f.fach.value));
      if (o && !f.lehrkraft.value) f.lehrkraft.value = o.lehrkraft;
      if (o && !f.raum.value) f.raum.value = o.raum;
    });
    f.addEventListener('submit', e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      close();
      if (!d.fach.trim()) { save({ zeiten: s.zeiten, stundenplan: rest }); return; }
      save({ zeiten: s.zeiten, stundenplan: [...rest, { ...cur, tag, zeit, fach: d.fach, einheit: d.einheit, lehrkraft: d.lehrkraft, raum: d.raum }] });
    });
    setTimeout(() => f.fach.focus(), 0);
  }

  draw();
}
