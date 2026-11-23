// ============================================================================
// electron/export-folder.js — export several files straight into a folder.
// ============================================================================
// preload.js publishes three calls (pickExportFolder, writeExportFile,
// finishExportFolder); these are their handlers. An export of several files —
// HTML5 ZIPs for many sizes, PNGs, videos, every data version — lands in a folder
// the user picks, file by file, instead of inside one big zip. Writing file by
// file keeps a large all-versions export out of memory.
//
// Safety: only pages served by the app itself may ask; a write needs the token
// from a folder the user just picked; every path is reduced to clean segments
// joined under that folder and checked to stay inside it. Existing files of the
// same name are replaced, as re-exporting into the same folder expects.
//
// Kept in its own module (dependencies passed in) so it can be exercised with a
// stand-in folder dialog.
// ============================================================================

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function cleanRelPath(rel) {
  const parts = String(rel).split(/[\\/]+/)
    .map(seg => seg.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim())
    .filter(seg => seg && seg !== '.' && seg !== '..');
  if (!parts.length) throw new Error('Empty file name');
  return parts;
}

// deps: { ipcMain, dialog, shell, BrowserWindow, getOrigin }
function registerExportFolderIpc({ ipcMain, dialog, shell, BrowserWindow, getOrigin }) {
  const jobs = new Map();   // token -> { folder, files }

  const fromApp = (event) => {
    const origin = getOrigin();
    const url = (event.senderFrame && event.senderFrame.url) || '';
    return !!(origin && url.startsWith(origin));
  };

  ipcMain.handle('adflow:pick-export-folder', async (event, title) => {
    if (!fromApp(event)) throw new Error('Not allowed');
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showOpenDialog(win, {
      title: title || 'Choose a folder for the exported files',
      buttonLabel: 'Export here',
      properties: ['openDirectory', 'createDirectory', 'promptToCreate']
    });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return null;
    const folder = path.resolve(res.filePaths[0]);
    await fs.promises.mkdir(folder, { recursive: true });
    const token = crypto.randomUUID();
    jobs.set(token, { folder, files: 0 });
    return { token, folder };
  });

  ipcMain.handle('adflow:write-export-file', async (event, token, rel, data) => {
    if (!fromApp(event)) throw new Error('Not allowed');
    const job = jobs.get(token);
    if (!job) throw new Error('This export folder is no longer open');
    const target = path.join(job.folder, ...cleanRelPath(rel));
    if (!target.startsWith(job.folder + path.sep)) throw new Error('File name leaves the export folder');
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data));
    job.files++;
    return true;
  });

  ipcMain.handle('adflow:finish-export-folder', async (event, token, reveal) => {
    if (!fromApp(event)) throw new Error('Not allowed');
    const job = jobs.get(token);
    jobs.delete(token);
    if (!job) return null;
    if (reveal && job.files) shell.openPath(job.folder);
    return { folder: job.folder, files: job.files };
  });
}

module.exports = { registerExportFolderIpc, cleanRelPath };
