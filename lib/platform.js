// Schulheft – Aktionen des Betriebssystems: Papierkorb, im Dateimanager zeigen, mit dem Standardprogramm öffnen.
// Immer execFile mit Argumenten (nie eine Shell-Zeile zusammensetzen): Pfade dürfen " $ ` ' und Leerzeichen enthalten.
// Electron ersetzt die Aktionen mit setPlatformActions (shell.trashItem …); auf Windows davor checkWinTrashDrive (siehe electron/main.js)
import { execFile as nodeExecFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export class PlatformError extends Error {}

// PowerShell-Skript für den Windows-Papierkorb. Der Pfad kommt aus der Umgebungsvariable SCHULHEFT_TARGET (nie im Skripttext).
// Laufwerke ohne Papierkorb (USB-Stick, Netzlaufwerk): Windows würde dort endgültig löschen → abbrechen (Exit 3).
export const WIN_TRASH_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'trap { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }',
  '$p = $env:SCHULHEFT_TARGET',
  "if ($p.StartsWith('\\\\')) { exit 3 }",
  '$drive = New-Object System.IO.DriveInfo ([System.IO.Path]::GetPathRoot($p))',
  "if ($drive.DriveType -ne 'Fixed') { exit 3 }",
  'Add-Type -AssemblyName Microsoft.VisualBasic',
  "$ui = [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs",
  "$bin = [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin",
  'if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, $ui, $bin) }',
  'elseif (Test-Path -LiteralPath $p -PathType Leaf) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, $ui, $bin) }',
  'else { exit 2 }',
].join('\n');
// -EncodedCommand erwartet UTF-16LE in Base64
export const encodePowerShell = script => Buffer.from(script, 'utf16le').toString('base64');

// Nur die Laufwerksprüfung (für Electron: shell.trashItem löscht auf USB-Sticks/Netzlaufwerken sonst endgültig)
export const WIN_DRIVE_CHECK_SCRIPT = WIN_TRASH_SCRIPT.split('\n').slice(0, 6).concat('exit 0').join('\n');

const NO_TRASH_BIN = 'Auf diesem Laufwerk gibt es keinen Papierkorb (z. B. USB-Stick oder Netzlaufwerk). Bitte die Datei im Explorer selbst löschen.';

// Standard-Umsetzung je Betriebssystem. platform/execFile/exists/env lassen sich übergeben (Tests).
export function createPlatformActions(o = {}) {
  const platform = o.platform || process.platform;
  const execFile = o.execFile || nodeExecFile;
  const exists = o.exists || existsSync;
  const env = o.env || process.env;
  const P = platform === 'win32' ? path.win32 : path.posix;

  // Befehl ausführen; ok(code) entscheidet, welche Exit-Codes als Erfolg gelten
  const run = (cmd, args, opts = {}, ok = code => code === 0) => new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 60000, windowsHide: true, ...opts }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : null) : 0;
      if (!err || (code !== null && ok(code))) resolve({ code, stdout });
      else reject(Object.assign(new PlatformError(String(stderr || err.message).trim()), { exitCode: code, cause: err }));
    });
  });
  const fail = (msg, e) => { throw new PlatformError(msg + (e?.message ? ` (${e.message})` : '')); };

  if (platform === 'win32') {
    const sysRoot = env.SystemRoot || env.windir || 'C:\\Windows';
    const powershell = P.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const explorer = P.join(sysRoot, 'explorer.exe');
    // explorer.exe meldet auch bei Erfolg oft Exit-Code 1
    const explorerOk = code => code === 0 || code === 1;
    return {
      async trash(p) {
        try {
          await run(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(WIN_TRASH_SCRIPT)],
            { env: { ...env, SCHULHEFT_TARGET: p } });
        } catch (e) {
          if (e.exitCode === 3) throw new PlatformError(NO_TRASH_BIN);
          if (e.exitCode === 2) throw new PlatformError('Die Datei wurde nicht gefunden.');
          fail('Konnte nicht in den Papierkorb gelegt werden', e);
        }
      },
      async reveal(p) {
        // "/select," und der Pfad als eigene Argumente: explorer.exe /select, "C:\…\Datei.pdf"
        try { await run(explorer, ['/select,', p], {}, explorerOk); } catch (e) { fail('Konnte den Explorer nicht öffnen', e); }
      },
      async openWithDefaultApp(p) {
        try { await run(explorer, [p], {}, explorerOk); } catch (e) { fail('Konnte die Datei nicht öffnen', e); }
      },
    };
  }

  if (platform === 'darwin') {
    return {
      async trash(p) {
        try {
          // macOS 14+: /usr/bin/trash (im Finder geht „Zurücklegen“); sonst der Finder per AppleScript – Pfad als Argument (argv)
          if (exists('/usr/bin/trash')) await run('/usr/bin/trash', [p]);
          else await run('/usr/bin/osascript', ['-e', 'on run argv', '-e', 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)', '-e', 'end run', p]);
        } catch (e) { fail('Konnte nicht in den Papierkorb gelegt werden', e); }
      },
      async reveal(p) {
        try { await run('/usr/bin/open', ['-R', p]); } catch (e) { fail('Konnte den Finder nicht öffnen', e); }
      },
      async openWithDefaultApp(p) {
        try { await run('/usr/bin/open', [p]); } catch (e) { fail('Konnte die Datei nicht öffnen', e); }
      },
    };
  }

  // Linux und andere: GIO (GNOME, KDE, XFCE …) und xdg-open
  return {
    async trash(p) {
      try { await run('gio', ['trash', '--', p]); }
      catch (e) {
        if (e.cause?.code === 'ENOENT') throw new PlatformError('Papierkorb nicht verfügbar: das Programm „gio“ fehlt (Paket libglib2.0-bin bzw. glib2).');
        fail('Konnte nicht in den Papierkorb gelegt werden', e);
      }
    },
    async reveal(p) {
      try { await run('xdg-open', [P.dirname(p)]); } catch (e) { fail('Konnte den Dateimanager nicht öffnen', e); }
    },
    async openWithDefaultApp(p) {
      try { await run('xdg-open', [p]); } catch (e) { fail('Konnte die Datei nicht öffnen', e); }
    },
  };
}

// Windows: wirft PlatformError, wenn das Laufwerk keinen Papierkorb hat (UNC-Pfad, USB-Stick, Netzlaufwerk …)
export async function checkWinTrashDrive(p, o = {}) {
  const execFile = o.execFile || nodeExecFile, env = o.env || process.env;
  if (/^[\\/]{2}/.test(p)) throw new PlatformError(NO_TRASH_BIN);
  const powershell = path.win32.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const code = await new Promise(resolve => execFile(powershell,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(WIN_DRIVE_CHECK_SCRIPT)],
    { timeout: 30000, windowsHide: true, env: { ...env, SCHULHEFT_TARGET: p } },
    err => resolve(err ? (typeof err.code === 'number' ? err.code : -1) : 0)));
  if (code === 3) throw new PlatformError(NO_TRASH_BIN);
  if (code !== 0) throw new PlatformError('Konnte das Laufwerk nicht prüfen – die Datei wurde nicht gelöscht.');
}

let actions = createPlatformActions();
let overrides = {};

// Für Electron (oder Tests): einzelne Aktionen ersetzen; ohne Argument wieder alles auf Standard
export function setPlatformActions(o) { overrides = o ? { ...overrides, ...o } : {}; }
// Nur für Tests: Standard-Umsetzung für ein anderes System bauen
export function resetPlatformActions(o) { actions = createPlatformActions(o); overrides = {}; }

const call = name => async absPath => {
  if (typeof absPath !== 'string' || !path.isAbsolute(absPath)) throw new PlatformError('Pfad fehlt');
  return (overrides[name] || actions[name])(absPath);
};

// In den Papierkorb – nie endgültig löschen. Danach muss die Datei weg sein, sonst Fehler.
export async function trash(absPath) {
  await call('trash')(absPath);
  if (existsSync(absPath)) throw new PlatformError('Die Datei liegt noch am alten Ort – sie wurde nicht in den Papierkorb gelegt.');
}
export const reveal = call('reveal');
export const openWithDefaultApp = call('openWithDefaultApp');
