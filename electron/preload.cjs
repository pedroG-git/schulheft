// Schulheft Desktop: kleine, feste Brücke zur Seite (kein Node im Fenster)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('schulheftDesktop', {
  // Öffnet den Ordner-Dialog des Systems; liefert den Pfad oder null (abgebrochen)
  pickFolder: current => ipcRenderer.invoke('schulheft:pick-folder', current),
});
