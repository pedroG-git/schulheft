// Schulheft als Desktop-App (Electron): startet den Server (server.js) im selben Prozess auf 127.0.0.1 und zeigt ihn im Fenster.
// Programmordner wird nur gelesen. Einstellungen bleiben in %APPDATA%\Schulheft, Zwischenspeicher in %LOCALAPPDATA%\Schulheft\Cache,
// Daten von Electron/Chromium (localStorage, Browser-Cache) in %LOCALAPPDATA%\Schulheft\Electron. Updates ändern nichts davon.
import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import updaterPkg from 'electron-updater';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOMEPAGE = 'https://github.com/pedroG-git/schulheft';

// Eigener Ordner für Chromium-Daten (nicht mitten in config.json von %APPDATA%\Schulheft); SCHULHEFT_ELECTRON_DIR nur für Tests
app.setPath('userData', process.env.SCHULHEFT_ELECTRON_DIR ? path.resolve(process.env.SCHULHEFT_ELECTRON_DIR) : process.platform === 'win32' && process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Schulheft', 'Electron')
  : path.join(app.getPath('appData'), 'Schulheft', 'Electron'));

if (!app.requestSingleInstanceLock()) app.quit();
else main();

let win = null;

// Gleicher Port wie beim letzten Mal, wenn frei: localStorage (offene Tabs, Design …) hängt am Port der Adresse
const PORT_FILE = () => path.join(app.getPath('userData'), 'port.json');
const portFree = port => new Promise(resolve => {
  const s = net.createServer().once('error', () => resolve(false));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
});
async function pickPort() {
  let last = 0;
  try { last = Number(JSON.parse(fs.readFileSync(PORT_FILE(), 'utf8')).port) || 0; } catch { /* erster Start */ }
  if (last > 1024 && last < 65536 && last !== 4711 && await portFree(last)) return last;
  return 0;   // freien Port vom System
}

// Betriebssystem-Aktionen über Electron. Windows: shell.trashItem löscht auf USB-Sticks/Netzlaufwerken endgültig → vorher prüfen.
async function usePlatformActions() {
  const { setPlatformActions, checkWinTrashDrive, PlatformError } = await import('../lib/platform.js');
  setPlatformActions({
    async trash(p) {
      if (process.platform === 'win32') await checkWinTrashDrive(p);
      try { await shell.trashItem(p); } catch (e) { throw new PlatformError(`Konnte nicht in den Papierkorb gelegt werden (${e.message})`); }
    },
    async reveal(p) { shell.showItemInFolder(p); },
    async openWithDefaultApp(p) {
      const err = await shell.openPath(p);
      if (err) throw new PlatformError(`Konnte die Datei nicht öffnen (${err})`);
    },
  });
}

async function startServer() {
  process.env.PORT = String(await pickPort());
  // Echter Programmordner (nicht …/resources/app.asar): dort darf der Notizordner nicht liegen
  process.env.SCHULHEFT_APP_DIR = app.isPackaged ? path.dirname(process.resourcesPath) : app.getAppPath();
  await usePlatformActions();
  const { ready } = await import('../server.js');
  const port = await ready;
  try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(PORT_FILE(), JSON.stringify({ port })); } catch { /* egal */ }
  return port;
}

function createWindow(origin) {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 720, minHeight: 480, show: false,
    title: 'Schulheft', backgroundColor: '#f7f5ef',
    icon: path.join(HERE, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(HERE, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  win.once('ready-to-show', () => win.show());
  const own = url => url === origin || url.startsWith(origin + '/');
  // Links nach draußen (http/https/mailto) im Standardbrowser, nie im App-Fenster
  const external = url => { if (/^(https?|mailto):/i.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { if (!own(url)) external(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!own(url)) { e.preventDefault(); external(url); } });
  // Ungespeicherte Änderungen: die Seite meldet das per beforeunload → nachfragen statt still nicht zu schließen
  win.webContents.on('will-prevent-unload', e => {
    const r = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Nicht schließen', 'Ohne Speichern schließen'], defaultId: 0, cancelId: 0,
      title: 'Schulheft', message: 'Es gibt ungespeicherte Änderungen.', detail: 'Wirklich schließen? Nicht gespeicherte Änderungen gehen verloren.',
    });
    if (r === 1) e.preventDefault();   // preventDefault = beforeunload ignorieren → Fenster schließt
  });
  win.on('closed', () => { win = null; });
  win.loadURL(origin + '/');
}

function buildMenu() {
  const mac = process.platform === 'darwin';
  const about = () => dialog.showMessageBox(win, {
    type: 'info', title: 'Über Schulheft', message: `Schulheft ${app.getVersion()}`,
    detail: `Notiz-App für Schüler und Azubis.\nFreie Software (MIT-Lizenz).\n${HOMEPAGE}`,
  });
  const template = [
    ...(mac ? [{ label: 'Schulheft', submenu: [{ label: 'Über Schulheft', click: about }, { type: 'separator' }, { role: 'hide', label: 'Schulheft ausblenden' }, { type: 'separator' }, { role: 'quit', label: 'Schulheft beenden' }] }] : []),
    { label: 'Datei', submenu: [mac ? { role: 'close', label: 'Fenster schließen' } : { role: 'quit', label: 'Beenden' }] },
    // macOS braucht das Bearbeiten-Menü für ⌘C/⌘V; auf Windows gehen die Tasten direkt an die Seite (CodeMirror hat eigenes Rückgängig)
    ...(mac ? [{ label: 'Bearbeiten', submenu: [
      { role: 'undo', label: 'Widerrufen' }, { role: 'redo', label: 'Wiederholen' }, { type: 'separator' },
      { role: 'cut', label: 'Ausschneiden' }, { role: 'copy', label: 'Kopieren' }, { role: 'paste', label: 'Einsetzen' }, { role: 'selectAll', label: 'Alles auswählen' }] }] : []),
    { label: 'Ansicht', submenu: [
      { role: 'zoomIn', label: 'Größer' }, { role: 'zoomOut', label: 'Kleiner' }, { role: 'resetZoom', label: 'Originalgröße' },
      { type: 'separator' }, { role: 'togglefullscreen', label: 'Vollbild' }] },
    { label: 'Hilfe', submenu: [
      { label: 'Webseite von Schulheft', click: () => shell.openExternal(HOMEPAGE) },
      ...(mac ? [] : [{ type: 'separator' }, { label: 'Über Schulheft', click: about }])] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Updates von GitHub Releases (latest.yml): beim Start prüfen, im Hintergrund laden, beim Beenden installieren.
// Nur die installierte Windows-App (NSIS); ohne Internet passiert einfach nichts.
function autoUpdate() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  const { autoUpdater } = updaterPkg;
  autoUpdater.logger = null;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', e => console.error('Update:', e?.message || e));
  autoUpdater.once('update-downloaded', async info => {
    if (!win) return;
    const { response } = await dialog.showMessageBox(win, {
      type: 'info', title: 'Schulheft', buttons: ['Später', 'Jetzt neu starten'], defaultId: 0, cancelId: 0,
      message: 'Update bereit – beim nächsten Start installiert',
      detail: `Version ${info.version} wurde heruntergeladen. Deine Notizen und Einstellungen bleiben, wie sie sind.`,
    });
    if (response === 1) autoUpdater.quitAndInstall();
  });
  autoUpdater.checkForUpdates().catch(e => console.error('Update:', e?.message || e));
}

function main() {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on('window-all-closed', () => app.quit());
  // Ordner wählen für den ersten Start / „Notizordner ändern“ (das Eingabefeld bleibt; das hier füllt es nur)
  ipcMain.handle('schulheft:pick-folder', async (e, current) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Notizordner wählen', buttonLabel: 'Ordner wählen',
      defaultPath: typeof current === 'string' && path.isAbsolute(current) ? current : app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    });
    return r.canceled ? null : r.filePaths[0] || null;
  });
  app.whenReady().then(async () => {
    buildMenu();
    let port;
    try { port = await startServer(); } catch (e) {
      dialog.showErrorBox('Schulheft', `Schulheft konnte nicht starten:\n${e?.message || e}`);
      app.exit(1);
      return;
    }
    createWindow(`http://127.0.0.1:${port}`);
    autoUpdate();
  });
}
