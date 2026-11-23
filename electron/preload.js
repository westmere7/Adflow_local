// ============================================================================
// electron/preload.js — the only bridge between the app and Electron.
// ============================================================================
// Deliberately small. Adflow is an ordinary web app and needs no Node APIs; the
// page gets no general file-system access from here.
//
// Published:
//   isDesktop / platform / electronVersion — read-only markers, so page code can
//     tell it is in the desktop build (export-pipeline.js reads isDesktop).
//   Export to a folder — three calls that let an export of several files land in
//     a folder directly instead of inside a zip:
//       pickExportFolder(title)            the system folder dialog → { token, folder } | null
//       writeExportFile(token, path, data) one file, into that folder only
//       finishExportFolder(token, reveal)  done; optionally open the folder
//     The main process owns the dialog and the writing (electron/main.js). The page
//     can only write inside a folder the user just picked, by the token it got back,
//     and file names are cleaned there — no absolute paths, no "..".
// ============================================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('adflowDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,          // 'win32' | 'darwin' | 'linux'
  electronVersion: process.versions.electron,
  pickExportFolder: (title) => ipcRenderer.invoke('adflow:pick-export-folder', String(title || '')),
  writeExportFile: (token, relPath, data) => ipcRenderer.invoke('adflow:write-export-file', String(token), String(relPath), data),
  finishExportFolder: (token, reveal) => ipcRenderer.invoke('adflow:finish-export-folder', String(token), !!reveal)
}));
