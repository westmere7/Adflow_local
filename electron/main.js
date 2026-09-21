// ============================================================================
// electron/main.js — RMIT Adflow desktop shell
// ============================================================================
// The whole desktop build is this file plus a 130-line static server. The web
// app is loaded unmodified: no build step, no bundler, no source changes. That
// is the point — the desktop app and the hosted app are the same code, so they
// cannot drift.
//
// Electron (rather than Tauri or a system-webview wrapper) because Adflow needs
// Chromium specifically: video export goes through WebCodecs `VideoEncoder`
// (video-export.js) and saving uses `showSaveFilePicker` (project-io.js,
// export-pipeline.js). Both are absent or unreliable in WKWebView, which is what
// a system-webview wrapper would give every Mac user — so that route would ship
// a Mac build quietly missing two headline features.
// ============================================================================

const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const { startStaticServer, PREFERRED_PORT } = require('./static-server');

// Packaged with asar disabled (see package.json), so the app files sit on disk
// exactly as they do in the repository and this resolves the same either way.
const APP_ROOT = path.join(__dirname, '..');

let origin = null;          // http://127.0.0.1:<port>
let serverHandle = null;
let usedFallbackPort = false;

// One instance only. Two would race for the same port, and the second would
// either fail to bind or land on a different origin with an empty workspace.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  main();
}

function createWindow(url, opts = {}) {
  const win = new BrowserWindow({
    width: opts.width || 1600,
    height: opts.height || 1000,
    // The app shows a "use a bigger screen" overlay below this, so there is no
    // point letting the window get smaller than the app can use.
    minWidth: 1366,
    minHeight: 768,
    backgroundColor: '#121419',   // matches the splash, so no white flash
    show: false,
    title: 'RMIT Adflow',
    icon: process.platform === 'linux'
      ? path.join(APP_ROOT, 'build', 'icon.png')
      : undefined,               // Windows and macOS take the icon from the package
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(url);

  // The File menu opens the two portals with window.open(). Allow those as real
  // windows; send anything else (rmit.edu.au, nodejs.org, docs links) to the
  // user's own browser rather than trapping the web inside the app.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (origin && target.startsWith(origin)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          backgroundColor: '#121419',
          minWidth: 1100,
          minHeight: 700,
          webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
          }
        }
      };
    }
    shell.openExternal(target);
    return { action: 'deny' };
  });

  // Belt and braces: nothing may navigate the window away from the app itself.
  win.webContents.on('will-navigate', (event, target) => {
    if (!origin || !target.startsWith(origin)) {
      event.preventDefault();
      shell.openExternal(target);
    }
  });

  return win;
}

// Adflow owns almost every modifier shortcut already — Ctrl+S, Ctrl+Z, Ctrl+R
// (rulers), Ctrl+Y, Ctrl+D, Ctrl+G, Ctrl+C/X/V and more. A normal Electron menu
// would bind several of those as accelerators and steal them from the app, so:
//
//   Windows / Linux — no application menu at all.
//   macOS           — the minimum the platform requires. macOS routes clipboard
//                     shortcuts for text fields through the menu, so without an
//                     Edit menu, Cmd+C/V stop working inside inputs entirely.
//                     Safe here because the app's own key handler defers
//                     whenever focus is in an INPUT, TEXTAREA or contentEditable.
//
// Reload is Ctrl/Cmd+Shift+R rather than Ctrl+R, which the app uses for rulers.
function buildMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', accelerator: 'CmdOrCtrl+Shift+R' },
        { role: 'toggleDevTools', accelerator: 'F12' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'minimize' },
        { role: 'zoom' }
      ]
    }
  ]));
}

async function main() {
  app.setName('RMIT Adflow');
  await app.whenReady();

  try {
    const started = await startStaticServer(APP_ROOT);
    serverHandle = started.server;
    usedFallbackPort = started.usedFallback;
    origin = `http://127.0.0.1:${started.port}`;
  } catch (err) {
    dialog.showErrorBox(
      'RMIT Adflow could not start',
      'The app could not open its internal server.\n\n' + (err && err.message ? err.message : String(err))
    );
    app.quit();
    return;
  }

  buildMenu();
  const win = createWindow(origin);

  // Falling back to another port means a different origin, and browser storage
  // is per-origin — so the workspace would look empty even though nothing was
  // lost. Say so plainly instead of letting the user discover it.
  if (usedFallbackPort) {
    win.once('ready-to-show', () => {
      dialog.showMessageBox(win, {
        type: 'warning',
        title: 'Another program is using Adflow’s port',
        message: `Port ${PREFERRED_PORT} was busy, so Adflow started on a different one.`,
        detail: 'Your projects are saved per port, so this window may look empty even though nothing has been lost. '
              + 'Close whatever is using that port and restart Adflow to get your work back.\n\n'
              + 'Projects you saved as .flow files are unaffected and can be opened as usual.',
        buttons: ['Continue']
      });
    });
  }

  // F12 opens DevTools everywhere, including Windows where there is no menu.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(origin);
  });
}

app.on('window-all-closed', () => {
  // macOS convention is to stay alive with no windows; every other platform quits.
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverHandle) {
    try { serverHandle.close(); } catch (e) { /* shutting down anyway */ }
  }
});
