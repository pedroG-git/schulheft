// Der Notiz-Editor (CodeMirror) mit farbigen Markierungen
import { EditorState, EditorSelection, RangeSetBuilder, StateField } from '@codemirror/state';
import { lessonBits } from './render.js';
import { keys } from './platform.js';
import {
  EditorView, keymap, Decoration, ViewPlugin, WidgetType, drawSelection, highlightActiveLine,
  dropCursor, placeholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const mdStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.6em', fontWeight: '700', color: 'var(--h1)' },
  { tag: t.heading2, fontSize: '1.35em', fontWeight: '700', color: 'var(--h2)' },
  { tag: t.heading3, fontSize: '1.15em', fontWeight: '650', color: 'var(--h3)' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '650', color: 'var(--h3)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--muted)' },
  { tag: t.monospace, fontFamily: 'var(--mono)', color: 'var(--code)' },
  { tag: t.quote, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--faint)' },
]);

const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+|<[^>]+>)\)/g;
const URL_RE = /https?:\/\/[^\s)>\]]+/g;

// Zeilen mit Markern einfärben, ==markieren== und !!rot!! im Text
const LINE_RULES = [
  [/^\s*(?:[-*+]\s+)?!!/, 'cm-imp'],
  [/^\s*(?:[-*+]\s+)?(EXAM:|TEST:)/, 'cm-exam'],
  [/^\s*(?:[-*+]\s+)?DEF:/, 'cm-def'],
  [/^\s*(?:[-*+]\s+)?\?\?/, 'cm-ask'],
  [/^\s*[-*+] \[ \]/, 'cm-todo'],
  [/^\s*[-*+] \[[xX]\]/, 'cm-done'],
];
const lineDeco = Object.fromEntries(LINE_RULES.map(([, c]) => [c, Decoration.line({ class: c })]));
const markDeco = Decoration.mark({ class: 'cm-hl' });
const redDeco = Decoration.mark({ class: 'cm-red' });
const linkDeco = Decoration.mark({ class: 'cm-linkmark', attributes: { title: keys('Klick: öffnen · ⌥+Klick: Link bearbeiten') } });

const frontDeco = Decoration.line({ class: 'cm-front' });

// Ende des Kopfs (--- … ---) am Anfang der Notiz, als Zeilennummer (0 = kein Kopf)
function frontEnd(doc) {
  if (doc.lines < 2 || doc.line(1).text !== '---') return 0;
  for (let n = 2; n <= Math.min(doc.lines, 30); n++) if (doc.line(n).text === '---') return n;
  return 0;
}

function buildDecos(view) {
  const b = new RangeSetBuilder();
  const fe = frontEnd(view.state.doc);
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      if (line.number <= fe) { b.add(line.from, line.from, frontDeco); pos = line.to + 1; continue; }
      const rule = LINE_RULES.find(([re]) => re.test(line.text));
      if (rule) b.add(line.from, line.from, lineDeco[rule[1]]);
      const inl = [];
      for (const m of line.text.matchAll(/==[^=\n]+==/g)) inl.push([m.index, m.index + m[0].length, markDeco]);
      for (const m of line.text.matchAll(/!![^!\n]+!!/g)) inl.push([m.index, m.index + m[0].length, redDeco]);
      for (const m of line.text.matchAll(LINK_RE)) inl.push([m.index, m.index + m[0].length, linkDeco]);
      for (const m of line.text.matchAll(URL_RE)) if (!inl.some(([a, e, d]) => d === linkDeco && m.index >= a && m.index < e)) inl.push([m.index, m.index + m[0].length, linkDeco]);
      inl.sort((a, c) => a[0] - c[0]).forEach(([s, e, d]) => b.add(line.from + s, line.from + e, d));
      pos = line.to + 1;
    }
  }
  return b.finish();
}
const markers = ViewPlugin.fromClass(class {
  constructor(v) { this.decorations = buildDecos(v); }
  update(u) { if (u.docChanged || u.viewportChanged) this.decorations = buildDecos(u.view); }
}, { decorations: v => v.decorations });

// Link unter der Position finden: [text](ziel) oder https://…
export function linkAt(state, pos) {
  const line = state.doc.lineAt(pos), off = pos - line.from;
  for (const m of line.text.matchAll(LINK_RE))
    if (off >= m.index && off < m.index + m[0].length) return m[1].replace(/^<|>$/g, '');
  for (const m of line.text.matchAll(URL_RE))
    if (off >= m.index && off < m.index + m[0].length) return m[0];
  return null;
}

const germanPhrases = EditorState.phrases.of({
  'Find': 'Suchen', 'Replace': 'Ersetzen', 'next': 'weiter', 'previous': 'zurück', 'all': 'alle',
  'match case': 'Groß/klein', 'regexp': 'Regex', 'by word': 'ganzes Wort', 'replace': 'ersetzen',
  'replace all': 'alle ersetzen', 'close': 'schließen', 'Go to line': 'Gehe zu Zeile', 'go': 'los',
});

// ── Links als Chips: [Text](ziel) → 📄 Text (Code nur in der Zeile mit dem Cursor) ──
export function linkIcon(target) {
  if (/^https?:/i.test(target)) return '🔗';
  if (/\.pdf$/i.test(target)) return '📄';
  if (/\.(png|jpe?g|gif|webp|heic)$/i.test(target)) return '🖼';
  if (/\.md$/i.test(target)) return '📝';
  return '📎';
}
class LinkChip extends WidgetType {
  constructor(label, target, open) { super(); this.label = label; this.target = target; this.open = open; }
  eq(o) { return o.label === this.label && o.target === this.target; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-chip';
    el.title = keys('Klick: öffnen · ⌥+Klick: Link bearbeiten');
    el.innerHTML = `<span class="cm-chip-ico"></span><span class="cm-chip-txt"></span>`;
    el.firstChild.textContent = linkIcon(this.target);
    el.lastChild.textContent = this.label || this.target.split('/').pop();
    el.addEventListener('mousedown', e => {
      if (e.button !== 0 || e.altKey) return;   // ⌥+Klick: CodeMirror setzt den Cursor → Code wird sichtbar
      e.preventDefault(); e.stopPropagation(); this.open(this.target);
    });
    return el;
  }
  ignoreEvent(e) { return e.type === 'mousedown' && !e.altKey; }
}
function chipPlugin(open) {
  const build = view => {
    const b = new RangeSetBuilder(), sel = view.state.selection;
    const busy = new Set(sel.ranges.flatMap(r => { const a = view.state.doc.lineAt(r.from).number, z = view.state.doc.lineAt(r.to).number; return Array.from({ length: z - a + 1 }, (_, i) => a + i); }));
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const line = view.state.doc.lineAt(pos);
        if (!busy.has(line.number) || !view.hasFocus) {
          for (const m of line.text.matchAll(LINK_RE)) {
            const label = m[0].match(/^!?\[([^\]]*)\]/)[1].replace(/[*_`]/g, '');
            const target = m[1].replace(/^<|>$/g, '');
            b.add(line.from + m.index, line.from + m.index + m[0].length, Decoration.replace({ widget: new LinkChip(label, target, open) }));
          }
        }
        pos = line.to + 1;
      }
    }
    return b.finish();
  };
  return ViewPlugin.fromClass(class {
    constructor(v) { this.decorations = build(v); }
    update(u) { if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged) this.decorations = build(u.view); }
  }, { decorations: v => v.decorations, provide: p => EditorView.atomicRanges.of(v => v.plugin(p)?.decorations || Decoration.none) });
}

// ── Kopf (--- … ---) als eine ruhige Zeile; Klick zeigt den Code ──
class FrontCard extends WidgetType {
  constructor(meta) { super(); this.meta = meta; }
  eq(o) { return JSON.stringify(o.meta) === JSON.stringify(this.meta); }
  toDOM(view) {
    const el = document.createElement('div');
    el.className = 'cm-front-card';
    el.title = 'Klicken zum Bearbeiten';
    const m = this.meta;
    const bits = m.typ === 'stunde' ? lessonBits(m) : Object.entries(m).map(([k, v]) => `${k}: ${v}`);
    el.innerHTML = `<span class="cm-front-tag">${m.typ === 'stunde' ? 'Stunde' : 'Kopf'}</span>`;
    bits.filter(Boolean).forEach((b, i) => { if (i) el.append(' · '); el.append(b); });
    el.addEventListener('mousedown', e => { e.preventDefault(); view.dispatch({ selection: { anchor: view.state.doc.line(2).from } }); view.focus(); });
    return el;
  }
  ignoreEvent() { return true; }
}
function frontDecos(state) {
  const doc = state.doc, fe = frontEnd(doc);
  if (!fe) return Decoration.none;
  const from = doc.line(1).from, to = doc.line(fe).to;
  if (state.selection.ranges.some(r => r.to >= from && r.from <= to)) return Decoration.none;
  const meta = {};
  for (let n = 2; n < fe; n++) { const kv = doc.line(n).text.match(/^([\wäöüß]+):\s*(.*)$/i); if (kv) meta[kv[1].toLowerCase()] = kv[2].trim(); }
  return Decoration.set([Decoration.replace({ widget: new FrontCard(meta), block: true }).range(from, to)]);
}
const frontField = StateField.define({
  create: frontDecos,
  update: (v, tr) => (tr.docChanged || tr.selection) ? frontDecos(tr.state) : v,
  provide: f => [EditorView.decorations.from(f), EditorView.atomicRanges.of(v => v.state.field(f))],
});

export function createEditor(parent, { doc, onChange, onSave, onOpenLink, onPasteImage }) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: (() => { const d = EditorState.create({ doc }).doc, fe = frontEnd(d); return { anchor: fe && fe < d.lines ? d.line(fe + 1).from : 0 }; })(),
      extensions: [
        history(), drawSelection(), dropCursor(), highlightActiveLine(), highlightSelectionMatches(),
        search({ top: true }), EditorView.lineWrapping, germanPhrases,
        placeholder('Hier schreiben …'),
        markdown({ base: markdownLanguage }), syntaxHighlighting(mdStyle), markers, chipPlugin(t => onOpenLink(t)), frontField,
        keymap.of([
          { key: 'Mod-s', preventDefault: true, run: () => { onSave(); return true; } },
          { key: 'Mod-b', run: v => wrap(v, '**') },
          { key: 'Mod-i', run: v => wrap(v, '*') },
          { key: 'Mod-y', run: redo },
          ...searchKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab,
        ]),
        EditorView.updateListener.of(u => { if (u.docChanged) onChange(); }),
        EditorView.domEventHandlers({
          mousedown(e, v) {
            // Klick auf einen Link öffnet ihn; mit ⌥ (Alt) wird der Cursor gesetzt, um ihn zu bearbeiten
            if (e.button !== 0 || e.altKey || e.shiftKey || e.detail > 1) return false;
            if (!e.target.closest('.cm-linkmark')) return false;
            const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }, false);
            const link = pos != null && linkAt(v.state, pos);
            if (link) { e.preventDefault(); onOpenLink(link); return true; }
            return false;
          },
          paste(e) {
            const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
            if (file) { e.preventDefault(); onPasteImage(file); return true; }
            return false;
          },
        }),
      ],
    }),
  });
  return view;
}

// ── Formatierungs-Befehle für die Werkzeugleiste ─────────────────
export function wrap(view, mark, endMark = mark) {
  const { state } = view;
  view.dispatch(state.changeByRange(r => {
    const text = state.sliceDoc(r.from, r.to);
    if (text.startsWith(mark) && text.endsWith(endMark) && text.length >= mark.length + endMark.length) {
      const inner = text.slice(mark.length, text.length - endMark.length);
      return { changes: { from: r.from, to: r.to, insert: inner }, range: EditorSelection.range(r.from, r.from + inner.length) };
    }
    return {
      changes: [{ from: r.from, insert: mark }, { from: r.to, insert: endMark }],
      range: EditorSelection.range(r.from + mark.length, r.to + mark.length),
    };
  }));
  view.focus();
  return true;
}

// Präfix am Zeilenanfang setzen/entfernen (z. B. "!! ", "- [ ] ", "## ")
export function linePrefix(view, prefix, group = []) {
  const { state } = view;
  const changes = [];
  const seen = new Set();
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to;) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const indent = line.text.match(/^\s*/)[0];
        const body = line.text.slice(indent.length);
        const existing = [prefix, ...group].find(p => body.startsWith(p));
        const from = line.from + indent.length;
        if (existing === prefix) changes.push({ from, to: from + prefix.length, insert: '' });
        else if (existing) changes.push({ from, to: from + existing.length, insert: prefix });
        else changes.push({ from, insert: prefix });
      }
      pos = line.to + 1;
    }
  }
  view.dispatch({ changes });
  view.focus();
}

export function insertText(view, text) {
  view.dispatch(view.state.replaceSelection(text));
  view.focus();
}

export function gotoLine(view, n) {
  const line = view.state.doc.line(Math.max(1, Math.min(n, view.state.doc.lines)));
  view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
  view.focus();
}

export function toggleTaskLine(view, n0) {
  const line = view.state.doc.line(n0 + 1);
  const m = line.text.match(/^(\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])\s+\[)( |x|X)\]/);
  if (!m) return;
  const at = line.from + m[1].length;
  view.dispatch({ changes: { from: at, to: at + 1, insert: m[2] === ' ' ? 'x' : ' ' } });
}

export { undo, redo };
