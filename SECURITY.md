# Adflow — security summary

For RMIT ITS. Covers the **local edition** and its portable desktop app, v0.61.0.
Supporting detail: [DEPENDENCIES.md](DEPENDENCIES.md) and
[lib/THIRD-PARTY-NOTICES.txt](lib/THIRD-PARTY-NOTICES.txt).

---

## What it is

A browser-based tool for building HTML5 display ads. **There is no backend.**
No accounts, no sign-in, no database, no server-side code and no uploads. Earlier
versions had a hosted backend; it was removed entirely in v0.60.0 and that branch
is not deployed.

Two forms, running byte-identical application code:

- **Portable desktop app** — a folder containing the app and an Electron runtime. Nothing is installed; no registry writes, no admin rights, no Program Files. Deleting the folder removes it.
- **Static site** — the same files served by any web server, used for internal hosting where that is wanted.

## Where data lives

| Data | Location |
|---|---|
| Work in progress, recent projects, preferences | The app's own local storage on that machine |
| Projects the user chooses to keep | `.flow` files, wherever the user saves them |
| Exported ads | ZIP, PNG, MP4 or GIF files, wherever the user saves them |

Nothing is transmitted anywhere. There is no telemetry, no analytics, no crash
reporting and no licence check. Clearing the app's data or deleting its folder
removes everything it holds.

## Network behaviour

| Question | Answer |
|---|---|
| Outbound connections at runtime | **None.** The only host contacted is `127.0.0.1`, the app's own internal file server |
| Auto-update channel | None. No updater is built in; updates are a new folder, handed over deliberately |
| Telemetry / analytics | None anywhere in the codebase |
| Listening ports | One, on `127.0.0.1:47823`, bound to loopback only. Verified unreachable from the machine's own LAN address |
| Third-party CDNs | None. Every library and font is committed to the repository and served locally |
| Internet required | No. The app is fully functional with no connectivity |

The internal server is read-only, serves an explicit allow-list of eight paths,
rejects directory traversal, and cannot reach files outside the application
folder. External links in the interface open in the user's normal browser rather
than inside the app.

Two RMIT URLs appear in the source. They are **default values**, not requests:
the default ClickTag written into an exported ad as its click destination, and a
placeholder in a dialog. The application never fetches them.

## Reviewing the code

| Layer | Size | Reviewable |
|---|---|---|
| First-party application code | ~43,000 lines JavaScript, ~12,800 lines HTML/CSS | Fully |
| Third-party libraries (`lib/`) | 5 files, 1.3 MB | By provenance — see below |
| Electron / Chromium runtime | 269 MB | Not line by line |

**There is no build step.** No bundler, transpiler or minifier is applied to
first-party code, so the file in the repository is byte-for-byte the file that
executes. A reviewer does not need to trust a build pipeline or reconstruct
source from a bundle.

The five third-party libraries are published minified by their authors, so
reading them proves less than matching them. DEPENDENCIES.md lists each with its
version, upstream URL and SHA-256 so provenance can be verified against the
official release.

## The Electron runtime

The desktop app bundles Chromium. Of the 288 MB it occupies, 20 MB is Adflow and
269 MB is that runtime. Current version: **Electron 33.4.11**, which carries
Chromium 130.x. (Electron's published release notes are the authoritative
version mapping.)

### Chromium patching

This is the one ongoing obligation and we state it rather than leave it to be
discovered.

A bundled Chromium is **not** patched by Windows Update or by the browser
management ITS already operates. When a Chromium security advisory affects the
bundled version, the fix is to rebuild with a newer Electron and redistribute the
folder. In practice that is a small number of rebuilds a year.

Two things limit the exposure in the meantime: the app loads no remote content of
any kind, and it renders nothing the user has not opened from their own disk. The
usual path to a browser-engine vulnerability, hostile content arriving over the
network, does not exist here.

If that obligation is not acceptable, the same application runs as a static site
inside the browser ITS already manages and patches, with no Chromium to review.

## Known gaps

| Gap | Effect | Status |
|---|---|---|
| Binaries are not code-signed | Windows SmartScreen warns on first launch of a *downloaded* copy. macOS blocks an unsigned app outright | Needs a code-signing certificate and, for macOS, an Apple Developer account |
| Build tooling reports 14 npm vulnerabilities | None reach users. `npm audit --omit=dev` reports zero | Build-machine hygiene; tracked, not user-facing |
| Chromium version is pinned | See above | Rebuild-and-redistribute on advisories |

## Summary for review

The application layer is small, dependency-free at runtime, unobfuscated, and
identical in the repository and in the shipped product. It makes no network
requests and stores nothing outside the user's own machine. The substantive
questions are the bundled Chromium and the absence of code signing, both stated
above with their mitigations.
