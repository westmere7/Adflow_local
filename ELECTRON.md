# RMIT Adflow — desktop app (Electron)

A prototype desktop wrapper around the **same web app**, for Windows and macOS.
Nothing in `scripts/`, `styles.css` or the three HTML pages was changed to make
this work: the desktop build and the hosted build run identical code, so they
cannot drift apart.

For hosting the web version (Docker, Vercel), see [DEPLOYMENT.md](DEPLOYMENT.md).

For an IT security review, see [SECURITY.md](SECURITY.md) and
[DEPENDENCIES.md](DEPENDENCIES.md).

---

## Why Electron and not Tauri

Tauri produces much smaller apps, but it renders in the operating system's own
webview: Chromium on Windows, **Safari's engine on macOS**. Adflow depends on two
Chromium-only APIs:

| Feature | API | File |
|---|---|---|
| MP4 / WebM export | WebCodecs `VideoEncoder` | `scripts/video-export.js` |
| Native save dialog | `showSaveFilePicker` | `scripts/project-io.js`, `scripts/export-pipeline.js` |

A system-webview wrapper would therefore ship a Mac build quietly missing video
export and the native save dialog — the exact Windows/Mac split the desktop app
is supposed to remove. Electron bundles its own Chromium, so both platforms get
the full feature set, and Mac users stop losing features to Safari.

The cost is download size: roughly 150–200 MB against Tauri's ~10 MB. For an
internal design tool that is not a meaningful trade.

---

## How it works

Three files, about 300 lines total:

| File | Role |
|---|---|
| `electron/main.js` | Window, menu policy, link handling, single-instance lock |
| `electron/static-server.js` | Read-only HTTP server on loopback, serving the app folder |
| `electron/preload.js` | A read-only `window.adflowDesktop` marker and nothing else |

**Why there is a server inside the app.** Electron could load `index.html` over
`file://`, but Adflow cannot run that way. Every ad preview is an `<iframe
srcdoc>` sandbox, and export spawns a `blob:` Worker that `importScripts()` the
vendored JSZip. Under `file://` those get opaque origins and the browser blocks
them — which is why `export-pipeline.js` already refuses to export PNGs on
`file://`. Serving over `http://127.0.0.1` gives the renderer exactly the
environment the app was written against. Chromium also treats loopback as a
secure context, which is what keeps `showSaveFilePicker` and WebCodecs working.

**Why the port is fixed (47823).** Browser storage is keyed to the origin, and
the origin includes the port. A random port each launch would show the user an
empty workspace every time: autosave, recents, the base project and remembered
placements all live in IndexedDB and localStorage. If the port is genuinely
taken by something else, the app falls back and **says so in a dialog** rather
than silently appearing to have lost the user's work.

**Menu policy.** Adflow already owns almost every modifier shortcut, including
`Ctrl+R` for rulers and `Ctrl+Y` for outline mode, so a standard Electron menu
would steal them. Windows and Linux therefore get **no application menu at all**.
macOS gets the minimum the platform requires, because macOS routes clipboard
shortcuts for text fields through the menu — without an Edit menu, `Cmd+C` and
`Cmd+V` stop working inside input fields entirely. That is safe here because the
app's own key handler defers whenever focus is in an `INPUT`, `TEXTAREA` or
`contentEditable`.

---

## Running it

**Windows:** double-click `run-electron.bat`.
**macOS / Linux:** double-click `run-electron.command`.

Either one installs Electron on first run (a couple of minutes, once) and then
launches the app. By hand:

```bash
npm install
npm start
```

Node.js is required for development only. It is **not** required by the built
portable folder — Electron carries its own runtime.

---

## Building the portable app

The desktop app is distributed as a **portable folder**, never an installer.
`dist/win-unpacked/` is the whole product: copy the folder anywhere, double-click
`RMIT Adflow.exe`, done. Nothing is written to the registry or Program Files, and
deleting the folder removes the app. The build configuration has no installer
targets at all, so there is no `Setup.exe` to send out by mistake.

**No terminal needed.** Double-click **`build-app.bat`**. It closes a running
copy if there is one, installs Electron on first use, clears `dist/`, builds the
portable folder, and offers to zip it for sending.

**Nothing rebuilds automatically.** Changing the app changes nothing in `dist/`
until you run `build-app.bat` or one of these:

| Command | Produces | Use it for |
|---|---|---|
| `npm start` | nothing on disk | Development. Runs from source; edits show on restart |
| `npm run release:win` | empties `dist/`, then builds `dist/win-unpacked/` | **The only command to use before handing a copy to anyone** |
| `npm run build:win` | `dist/win-unpacked/` without clearing first | Quick rebuild while iterating |
| `npm run release:mac` / `build:mac` | `dist/mac*/RMIT Adflow.app` (needs a Mac) | Same, for macOS |

`release:win` clears the folder first so whatever is in `dist/` afterwards is the
build you just made and nothing else. `npm run clean` does the emptying on its own.

> **Why clearing matters.** `dist/` is build output: git never tracks it, so
> switching branches, reverting or discarding changes leaves it exactly as it was.
> A portable folder built from code you have since thrown away will keep running
> that old code, under the version number baked in at build time, until you
> rebuild. If the app ever looks wrong after a revert, run `release:win` before
> assuming the revert failed.

Close the app before building. Windows will not let the build overwrite files that
a running copy has open.

### Handing it out

Zip `dist/win-unpacked/` and send the zip. It is around 290 MB unzipped, so
**do not put it in git**: GitHub refuses any file over 100 MB and the Electron
runtime executable alone is larger than that. The right places are a **GitHub
Release** (repository page → Releases → Draft a new release → attach the zip;
assets can be up to 2 GB) or a shared drive.

Recipients unzip anywhere and double-click the exe. Because the app is unsigned,
the first launch of a *downloaded* copy shows Windows SmartScreen's "Windows
protected your PC" — *More info*, then *Run anyway*, once. A copy built on your
own machine does not trigger it. Signing is what removes that step (see below).

**A Mac build needs a Mac.** A signed, notarized `.app` cannot be produced from
Windows. Use a Mac, or a `macos-latest` runner on GitHub Actions.

`asar` is deliberately **disabled** in `package.json` so the packaged app keeps
its files on disk exactly as the repository has them, which keeps the internal
server's behaviour identical to development.

## Before this goes to staff

Three things stand between this prototype and something you can hand out. None
of them is code.

1. **Code signing.** Unsigned apps are blocked by Gatekeeper on macOS ("cannot be
   opened because the developer cannot be verified") and warned about by
   SmartScreen on Windows. macOS additionally requires notarization. Ask ITS
   first — a university this size very likely already holds both certificates,
   and procurement is the long pole if it does not.
2. **Updates.** The hosted version updates for everyone the moment it is
   rebuilt. A desktop app does not. Either add `electron-updater` with a hosted
   feed, or accept manual reinstalls and a fleet that drifts. This is the
   ongoing cost teams underestimate.
3. **Distribution.** Straightforward if ITS manages devices with Intune or Jamf.

---

## Things to know

- **Work does not migrate automatically.** The desktop app has its own storage,
  separate from the browser's. Anyone moving across should save their projects
  as `.flow` files first and open them in the app.
- **It still needs no network.** Everything is local: no accounts, no uploads,
  no third-party requests. Same as the hosted local edition.
- **It can run alongside Docker.** The desktop app uses port 47823, the
  container uses 8080.
- **The icon is a placeholder** — `build/icon.png`, generated from the square
  RMIT pixel. Replace it with a properly designed 512×512 icon before release.
- **This introduces the repository's first npm dependency.** The web app itself
  still has none and still needs no build step; `node_modules/` and `dist/` are
  git-ignored, and the Electron files are excluded from both the Docker image
  and the Vercel upload.

---

## Verified so far

Tested on Windows: app launches, all three pages load over the internal server,
no console errors, the portals open as their own windows, and external links go
to the system browser.

**Not yet tested on macOS** — no Mac available here. The macOS-specific paths are
the Edit menu's interaction with the app's own `Cmd+C` / `Cmd+V` element
handling, Gatekeeper behaviour, and the `.command` launcher's executable bit.
