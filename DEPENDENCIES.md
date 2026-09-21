# Dependency manifest

Everything third-party that Adflow contains, at two clearly separate layers:
what **ships to users**, and what only **builds the desktop app**. Licence texts
for the shipped libraries are in [lib/THIRD-PARTY-NOTICES.txt](lib/THIRD-PARTY-NOTICES.txt).

Generated for **v0.61.0**. Regenerate the checksums after changing anything in
`lib/` — see [Verifying](#verifying).

---

## 1. Runtime libraries — these ship

Five files, 1.3 MB, all committed to `lib/` rather than fetched from a CDN, so
the application runs with no internet access and its dependencies cannot change
underneath it.

| Library | Version | File | SHA-256 | Licence |
|---|---|---|---|---|
| [JSZip](https://github.com/Stuk/jszip) | 3.10.1 | `lib/jszip.min.js` | `acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e` | MIT (dual MIT/GPLv3, used under MIT) |
| [iro.js](https://github.com/jaames/iro.js) | 5.5.2 | `lib/iro.min.js` | `5d08eedbac9af7212f5fdf7e336aeb2da87ac47b2364818ad4bbd7fcbdd18d0d` | MPL-2.0 |
| [mediabunny](https://github.com/Vanilagy/mediabunny) | 1.52.2 | `lib/mediabunny.min.mjs` | `675f92b00a9c5879f1525f9d2924520515c713ff56deeaebc1f73477d7d02309` | MPL-2.0 |
| [gifenc](https://github.com/mattdesl/gifenc) | 1.0.3 | `lib/gifenc.esm.min.js` | `450e10427cc857b22e12cfeb46c54a170bf676a86a8059721a7975ac04333ba6` | MIT |
| [harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs) | see note | `lib/hb-subset.wasm` | `b46a2f69d36dc7276344d238bc4b9e170ebda94b236c6c7ce9a85f6b52278c5e` | MIT |

**What each is for**

- **JSZip** — reads and writes `.flow` project files and export ZIPs. Also used inside the export Web Worker.
- **iro.js** — the colour wheel in the colour picker.
- **mediabunny** — MP4/WebM muxing over WebCodecs for video export. Imported only when an export starts.
- **gifenc** — GIF quantisation and encoding. Imported only when a GIF export starts.
- **harfbuzzjs** — a WebAssembly build of HarfBuzz, used to subset fonts at export time so an exported ad carries only the glyphs it uses.

> **Note on the HarfBuzz version.** The `.wasm` binary embeds no version string,
> so the SHA-256 above is its identity. It has not changed since it was added.

**Fonts** in `data/fonts/ui/` are Inter and Outfit, both SIL Open Font License
1.1, self-hosted so the portal pages make no request to Google Fonts. The RMIT
brand fonts in `data/fonts/` are licensed to RMIT and are not third-party
open source.

---

## 2. Build-time only — these do **not** ship

| Package | Version | Purpose |
|---|---|---|
| `electron` | ^33.2.0 | The runtime bundled into the desktop app |
| `electron-builder` | ^25.1.8 | Packages the portable folder |

Those two pull in **293 packages** and 559 MB under `node_modules/`. None of it
reaches a user: the build copies only the file list declared in `package.json`
into the output, and `node_modules` is not in that list. You can confirm it on
any build with:

```bash
ls dist/win-unpacked/resources/app
```

### About `npm audit`

Any scan will report vulnerabilities here, and the distinction matters:

| Scope | Result |
|---|---|
| `npm audit --omit=dev` (what ships) | **0 vulnerabilities** |
| `npm audit` (including build tooling) | 14, of which 1 critical |

All 14 are in `electron-builder`'s dependency tree. They execute on the machine
doing the build and are not present in the shipped application. They are worth
tracking as build-machine hygiene, not as a risk to users.

---

## 3. What the shipped app actually contains

| Part | Size | Reviewable? |
|---|---|---|
| Adflow itself (`resources/app`) | 20 MB | Yes — unminified source, identical to the repository |
| Electron / Chromium runtime | 269 MB | No, not line by line. Same engine as Chrome and Edge |

The application layer has **no build step**: the files in `resources/app` are
byte-for-byte the files in the repository. There is no bundler, transpiler or
minifier applied to first-party code, so a reviewer reads exactly what runs.

The Chromium half carries an ongoing obligation, described in
[SECURITY.md](SECURITY.md#chromium-patching).

---

## Verifying

Confirm the shipped libraries match this manifest:

```bash
sha256sum lib/jszip.min.js lib/iro.min.js lib/mediabunny.min.mjs lib/gifenc.esm.min.js lib/hb-subset.wasm
```

On Windows PowerShell:

```powershell
Get-ChildItem lib\* -Include *.js,*.mjs,*.wasm | Get-FileHash -Algorithm SHA256 | Format-List Path,Hash
```

To check provenance rather than the minified contents, download the same version
from the upstream URL in the table and compare the hash. That is the intended
way to review these files: they are published minified, so reading them line by
line proves less than matching them against the official release.
