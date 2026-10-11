// Beschriftungen je nach System: Tasten (⌘ ⌥ ⇧ auf dem Mac, Strg/Alt/Umschalt sonst) und Wörter für Dateimanager/Papierkorb.
// Tasten richten sich nach diesem Computer (Browser), Dateimanager-Wörter nach dem Computer mit den Dateien (Server, /api/info).
const uaPlatform = (typeof navigator !== 'undefined' && (navigator.userAgentData?.platform || navigator.platform)) || '';
export const IS_MAC = /mac|iphone|ipad|ipod/i.test(uaPlatform);

// Text mit Mac-Tastenzeichen → passend für dieses System ("⌘⇧Z" → "Strg+Umschalt+Z", "⌥+Klick" → "Alt+Klick")
export const keys = s => (IS_MAC ? String(s) : String(s).replace(/⌘/g, 'Strg+').replace(/⇧/g, 'Umschalt+').replace(/⌥/g, 'Alt'));

// Feste Beschriftungen im HTML (title-Attribute und Text) einmal anpassen
export function localizeKeys(root = document.body) {
  if (IS_MAC || !root) return;
  for (const el of root.querySelectorAll('[title]')) if (/[⌘⌥⇧]/.test(el.title)) el.title = keys(el.title);
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (/[⌘⌥⇧]/.test(n.nodeValue)) n.nodeValue = keys(n.nodeValue);
}

let serverPlatform = '';
export const setServerPlatform = p => { serverPlatform = p || ''; };
export const revealLabel = () => (serverPlatform === 'win32' ? 'Im Explorer zeigen' : serverPlatform === 'darwin' ? 'Im Finder zeigen' : 'Im Dateimanager zeigen');
export const restoreHint = () => (serverPlatform === 'darwin'
  ? 'Im Finder kannst du es mit „Zurücklegen“ wiederherstellen.'
  : 'Du kannst es aus dem Papierkorb wiederherstellen.');
