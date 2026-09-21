// ============================================================================
// electron/preload.js — the only bridge between the app and Electron.
// ============================================================================
// Deliberately almost empty. Adflow is an ordinary web app: it needs no Node
// APIs, no file-system access beyond what Chromium already gives it, and no IPC.
// Exposing anything more would widen the attack surface for no gain.
//
// The one thing published is a read-only marker, so page code can tell it is
// running inside the desktop build if it ever needs to (for example to word a
// message differently). Nothing in the app reads it today.
// ============================================================================

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('adflowDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,          // 'win32' | 'darwin' | 'linux'
  electronVersion: process.versions.electron
}));
