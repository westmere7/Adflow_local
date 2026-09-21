# RMIT Adflow — Technical App Breakdown (Local edition — updated v0.61.0, Engine v3.0)

This document is the official context dump for agents (Claude, Codex, etc.) picking up the codebase cold. It covers the current architecture, state schema, core engines (Auto-Resize, Masking, Link Sync, Dynamic Data), the animation sequencer, the three page surfaces (editor + two portals), browser-side persistence, the three delivery targets (desktop app / Docker / static hosting), and workflow rules. **Read this in full before making non-trivial changes.**

> Animation model (July 2026): the app is **frame-based** — discrete `frames[]` plus per-element IN/OUT/FX presets and per-frame transitions. There is still **no continuous scrubber or keyframe editor**. What *does* exist, since v0.25.0, is `scripts/sequencer.js`: a PowerPoint-style **Timeline panel** that visualises the active canvas+frame's existing IN/OUT/FX timings as draggable bars. It is a *view over the element model*, not a second model — it commits every edit through the properties panel's own `updateProp` closure. Do not mistake it for the abandoned continuous-timeline prototype.

> **Local edition (September 2026, v0.60.0):** this branch has **no cloud**. The Supabase auth / Cloud Projects / Team Spaces / Share Preview stack (`auth-ui.js`, `share-preview.js`) was removed; the app is a static site with no backend, no accounts and no third-party requests. The cloud-connected build lives on `main`. Anything below that mentions the cloud is history, not current behaviour.
>
> **Desktop app (September 2026, `electron-app` branch):** the same files also ship as an Electron application for Windows and macOS — see §8. **Nothing** in `scripts/`, `styles.css` or the three HTML pages was changed to make it work, and that is a constraint, not an accident: the desktop and hosted builds must stay byte-identical below `electron/`. Do not add a desktop-only code path to the app itself.
>
> **Themes (September 2026, v0.61.0):** there are exactly **two** — `default` (the bare `:root` palette) and `light` (`body.theme-light`). The other eleven palettes were removed. `normalizeTheme()` in `canvas-render.js` folds any unrecognised id from an old `.flow` back to `default`.

---

## 1. Core Architecture & Tech Stack

Adflow is a vanilla-JS single-page application — no framework, no bundler, no build step for the app. Edit the files directly, refresh the browser. The whole app is:

- **Structure**: `index.html` (~800 lines) — shell markup + sequential `<script>` loading.
- **Styling**: `styles.css` (~6700 lines, CSS variables drive 2 named themes — see §7). Linked by **all three** pages.
- **Logic**: **25 app JS files** in `scripts/`, loaded in sequential order via classic `<script>` tags that share one global lexical scope (declarations in earlier files are visible to later files at execution time) — **the tag order *is* the dependency graph**. Three **Node build scripts** also live in `scripts/` but are not loaded by the browser (`build-asset-manifest.js`, `build-startup-registry.js`, `build-docs-screenshots.mjs`).
- **Embedded Fonts**: brand fonts in `data/fonts/` (6 `.woff2` served + the 6 `.otf` sources), subset and embedded at export time by `scripts/font-subset.js` via HarfBuzz (`lib/hb-subset.wasm`).
- **Persistence**: IndexedDB (`adflow-autosave` DB) for autosaves; `.flow` ZIP archives (JSZip) for project export/import. Both portals also keep their own IndexedDB list of recently opened files.
- **No backend**: no accounts, no database, no uploads. The two cross-project preferences that used to live on the account — the base project and remembered placements — are in the browser (`scripts/local-library.js`: IndexedDB + localStorage). Legacy `.flow` files may still carry cloud/share fields; `stripLegacyCloudFields()` in `project-io.js` drops them on every load.
- **No CDN deps**: JSZip 3.10.1 and `@jaames/iro` 5.5.2 are vendored in `lib/` (the export Web Worker imports the same JSZip via an absolute same-origin URL). The portals' Inter/Outfit UI fonts are self-hosted in `data/fonts/ui/` with `ui-fonts.css`.
- **Three page surfaces**, all loading the same version-pinned `scripts/` engine files plus their own inline page code:
  - `index.html` — the editor.
  - `preview.html` (~2460 lines) — **Preview Portal**: standalone review page and third-party HTML5 ad player. (It was also the share-link viewer until v0.60.0; that path is gone.)
  - `batch.html` (~2400 lines) — **Batch Operation Portal**: template → data sheet → export ZIP, for non-designer teams.
- **Deployment**: three targets, one codebase. **Static** — `Dockerfile` (node:20-alpine build stage runs the two generators → `nginxinc/nginx-unprivileged` on 8080, `/healthz`, `docker/nginx.conf` for MIME + cache policy) with `docker-compose.yml`, and `vercel.json` for a separate Vercel project; `DEPLOYMENT.md` is the operator guide. **Desktop** — `electron/` + electron-builder, see §8 and `ELECTRON.md`. The web app itself still has no runtime dependencies; `package.json` exists for the Electron tooling only and is not needed to run or develop the app.

### Script load order (from `index.html`, all version-pinned `?v=`)

Vendored libs first (`lib/jszip.min.js`, `lib/iro.min.js`), then:

```
numeric-wheel.js   →  render-runtime.js      →  auto-resize-engine.js   →
auto-arrange-config.js → docs-content.js     →  data-merge.js           →
font-subset.js     →  export-pipeline.js     →  video-export.js         →
color-picker.js    →  core-state.js          →  autosave.js             →
local-library.js   →  link-system.js         →  canvas-render.js        →
interactions.js    →  canvases-panel.js      →  layers-assets.js        →
props-panel.js     →  sequencer.js           →  toolbar-import.js       →
project-io.js      →  project-dialogs.js     →  modals.js               →
app-boot.js
```

Approximate sizes (LOC): `props-panel.js` 4928 · `export-pipeline.js` 4795 · `docs-content.js` 3422 · `project-dialogs.js` 3415 · `canvas-render.js` 3176 · `app-boot.js` 2477 · `auto-resize-engine.js` 2407 · `interactions.js` 1810 · `toolbar-import.js` 1790 · `data-merge.js` 1556 · `render-runtime.js` 1412 · `modals.js` 1404 · `sequencer.js` 1390 · `layers-assets.js` 1355 · `video-export.js` 1225 · `link-system.js` 1202 · `canvases-panel.js` 1103 · `project-io.js` 942 · `color-picker.js` 751 · `core-state.js` 536 · `autosave.js` 348 · `auto-arrange-config.js` 294 · `local-library.js` 263 · `font-subset.js` 215 · `numeric-wheel.js` 89.

### Vendored libraries (`lib/`, no build step, no npm)

| File | Size | Purpose |
|---|---|---|
| `hb-subset.wasm` | 578 KB | HarfBuzz font subsetting (`font-subset.js`) |
| `mediabunny.min.mjs` | 620 KB | MP4/WebM muxing + WebCodecs wrappers for video export (MPL-2.0, v1.52.2) |
| `gifenc.esm.min.js` | 9 KB | GIF quantise + LZW encode (MIT, v1.0.3) |

Both media libs are **lazily `import()`ed** by `video-export.js` only when an export starts, so they cost nothing at boot. They are committed rather than fetched from a CDN — exports must work offline.

---

## 2. File-Routing Table

When looking for specific features or bugs, refer to this table:

| Feature Area | File | Notable Globals / APIs |
| :--- | :--- | :--- |
| **Shared render helpers** (used by both editor and preview portal) | `scripts/render-runtime.js` | render/animation helpers shared to avoid editor↔portal drift |
| **Auto-size fitter + line height** (one copy for editor, batch and preview portals) | `scripts/render-runtime.js` | `calculateAutoSize`, `measureTextFits`, `getMeasureDiv`, `DEFAULT_WRAP_MIN`, `getResolvedLineHeight`, `isLineHeightAuto` — moved out of `core-state.js` in v0.50.1; the export builder bakes the result as `data-fit-size` (`bakedAutoSize` in `export-pipeline.js`) and the in-ad `adjustAutoSizes()` applies it verbatim instead of re-measuring |
| **Auto-resize engine** (rules, placement, settings, picker) | `scripts/auto-resize-engine.js` | `ENGINE_VERSION`, `ROLE_IDS`, `runRuleBasedAutoResize`, `autoAssignRole`, `openAutoResizeModal` |
| **Auto-arrange configurations** (coordinates, safezones, font sizes per format) | `scripts/auto-arrange-config.js` | `AUTO_ARRANGE_CONFIG` |
| **In-app documentation** (Help modal) | `scripts/docs-content.js` | `DOCS_SECTIONS`, `openDocumentation`, `renderDocsPanel` |
| **Changelog data & modal** | `scripts/docs-content.js` | `CHANGELOG_DATA`, `openChangelogModal` |
| **Base project & remembered placements** (browser storage) | `scripts/local-library.js` | `getDefaultStartupInfo`, `saveDefaultStartupProject`, `fetchDefaultStartupBlob`, `clearDefaultStartupProject`, `getGlobalPlacement`, `savePlacementsToLibrary`, `forgetPlacementsFromLibrary`, `describePlacementLibrary` |
| **Live Data slots & CSV** | `scripts/data-merge.js` | `dm*` helpers, `openDataPanel`, `dmRenderPanel` |
| **ZIP/PNG Export & Validation** | `scripts/export-pipeline.js` | `exportCanvasAsZip`, `exportCanvasAsPng`, `generateExportHTML`, `openExportModal`, `inlineFontsIntoHtml`, `prepareSnapshotHtml`, `buildAdSnapshotSvg` |
| **Video / GIF export** (virtual clock, capture pump, preview panel) | `scripts/video-export.js` | `VIRTUAL_CLOCK_SRC`, `captureCanvasFrames`, `captureCanvasVideo`, `captureCanvasGif`, `exportSelectedVideos`, `openVideoExportSettingsPopup`, `prepareCanvasBundle`, `buildVideoSettingsHTML`/`wireVideoSettings`/`readVideoSettings` |
| **Shift+scroll on numeric inputs** (app-wide, delegated) | `scripts/numeric-wheel.js` | single capture-phase `wheel` listener; opt-out via `data-wheel-plain` |
| **Font subsetting/embedding** | `scripts/font-subset.js` | HarfBuzz wasm subsetting on export |
| **Color & Gradient Picker** | `scripts/color-picker.js` | `openColorPicker`, `syncColorPickerWithSelection` |
| **Legacy cloud/share field hygiene** | `scripts/project-io.js` | `LEGACY_CLOUD_FIELDS`, `stripLegacyCloudFields` (runs on load, template, new project, base project) |
| **Animation Timeline (sequencer)** | `scripts/sequencer.js` | `renderSequencer`, `seqBars`, `seqBarMouseDown`, `seqComputeBarPairs`, `seqFxEditId`, `seqTogglePlayback` |
| **Shared animation-preset registry** | `scripts/render-runtime.js` | `ANIM_IN_PRESETS`, `ANIM_OUT_PRESETS`, `ANIM_FX_PRESETS`, `getInAnimPresets`, `animInEnabled`/`animOutEnabled`/`animFxEnabled` |
| **Preview Portal + third-party ad player** | `preview.html` (inline) | `portalMode`/`applyPortalMode`, `EXT_MAX`, `externalAds`, `parseExternalAd`, `loadExternalAds`, `renderExternalAds`, `mountExternalIframe` |
| **Batch Operation Portal** | `batch.html` (inline) | template certification gate (`isTemplate`), sheet download/import, `attachRmitAssets`, IDB recents |
| **Core state / history** | `scripts/core-state.js` | `state`, `history`, `pushHistory`/`undo`/`redo` |
| **Render loop** | `scripts/canvas-render.js` | `render` |
| **Workspace interactions** (drag, marquee, pan, nudge) | `scripts/interactions.js` | pointer/keyboard handlers |
| **Element property editor** | `scripts/props-panel.js` | properties panel (largest module) |
| **Layers & Assets panels** | `scripts/layers-assets.js` | layer tree, asset library |
| **Project IO** (`.flow` import/export, autosave glue) | `scripts/project-io.js`, `scripts/autosave.js` | |
| **Project/Settings dialogs, version check** | `scripts/project-dialogs.js` | `checkVersionUpdate()`, Settings modal |
| **Modals & boot/splash** | `scripts/modals.js`, `scripts/app-boot.js` | `openModal`, splash version badge (`verEl.textContent`) |
| **Theme registry & application** | `scripts/canvas-render.js`, `scripts/project-dialogs.js` | `VALID_THEMES`, `normalizeTheme`, `themeBodyClass`, `LIGHT_BG_THEMES`, `syncAdflowLogos`; `THEMES` (Settings grid) — see §7 |
| **Desktop shell** (not loaded by the browser) | `electron/main.js`, `electron/static-server.js`, `electron/preload.js` | `PREFERRED_PORT` (47823), `startStaticServer`, `window.adflowDesktop` — see §8 |
| **Node build scripts** (not loaded by the browser) | `scripts/build-asset-manifest.js`, `scripts/build-startup-registry.js`, `scripts/build-docs-screenshots.mjs` | run manually or via `npm run prebuild`; the third drives Chrome over raw CDP to regenerate `data/docs/*.png` |

---

## 3. Data Model & State Schema

The active project configuration is a single mutable global object named `state` (declared in `core-state.js`). It is JSON-serializable; the parts that persist to `.flow` vs. the parts that are local preferences are partitioned in the project-IO save path (see `project-io.js`).

```typescript
interface State {
  // ----- Project Identity -----
  projectId?: string;            // short uid assigned on create / first save (older files may carry a UUID from the cloud edition)
  projectName: string;
  adSizeLimit: number;           // KB cap for the ad-weight validator (default: 150)
  spaceId?: string | null;       // Current space context (null = Personal)
  currentVersion?: string;       // Bound row key from dataMerge rows, if any

  // ----- Canvas Content -----
  canvases: Canvas[];
  activeCanvasId: string;
  activeFrameId: number;
  selectedElementId: string | null;
  layerSelection: string[];

  // ----- Frames (discrete, NOT a continuous timeline) -----
  frames: Frame[];

  // ----- Linking -----
  linkGroups: Record<string, LinkGroup>;

  // ----- Assets -----
  assets: Record<string, string>;    // assetId → base64 data URL
  assetNames: Record<string, string>;// assetId → original filename (data-merge image lookup)
  assetLibrary: AssetLibraryItem[];
  assetFolders: AssetFolder[];

  // ----- Dynamic Data / Versions -----
  dataMerge: {
    enabled: boolean;
    columns: string[];                 // header names, in order
    rows: Array<Record<string, string>>;
    keyColumn: string | null;          // column used to name exported zips
    activeVersion: number | null;      // index into rows, or null = template defaults
    locked: boolean;                   // dynamic slots become read-only in editor
    mappings: Record<string, string>;  // 'slotKey::field' -> columnName
    skipHeaders: boolean;
  };

  // ----- LEGACY, cloud edition only. Never written here. -----
  // These may appear in a .flow saved by the cloud build on `main`.
  // LEGACY_CLOUD_FIELDS + stripLegacyCloudFields() (project-io.js) delete them
  // on every load, template save, new project and base-project snapshot, so
  // nothing downstream should ever see them. Listed only so you recognise them.
  // previewSharePath, previewUrl, previewSharedBy, previewSharedAt,
  // previewExpiry, previewShareProjectId, cloudSavedAt, cloudSavedBy,
  // spaceId, cloudId, cloudFolder

  // ----- View & Customizations -----
  theme?: 'default' | 'light';   // v0.61.0: two themes only; unknown ids → 'default'
  showRulers?: boolean;
  showSafezones?: boolean;
  snapEnabled?: boolean; snapToElements?: boolean; snapToCanvas?: boolean; snapToGuides?: boolean;
  snapDistance?: number;
  guides?: any[];
  zoom?: number; zoomStep?: number;
  viewScrollLeft?: number; viewScrollTop?: number;
  loopAd?: boolean; previewCurrentOnly?: boolean;
  outlineMode?: boolean;
  bgApplyAll?: boolean; defaultBg?: string;

  // ----- Preferences -----
  savedHistoryLimit?: number;    // undo depth (default 50)
  autosaveInterval?: number;     // seconds (5-60)
  exportFormat?: 'png' | 'jpeg' | 'webp';
  exportQuality?: number;        // %
  compressFormat?: 'jpeg' | 'webp';  // auto-compression output (jpeg = PNG-for-alpha, ad-server safe)
  defaultCricosCode?: string;        // RMIT compliance code (default '00122A')
  subheadingAutoHide?: boolean;
  favoriteAnimations?: string[];     // persisted to localStorage; filterFavorites toggles the star filter
  filterFavorites?: boolean;

  // ----- Validation & Audit toggles -----
  validationSettings: {
    textSize: boolean; contrast: boolean; transitionTiming: boolean;
    infiniteMotion: boolean; cricos: boolean; logo: boolean;
    brandColors: boolean; brandFonts: boolean;
  };

  // ----- Auto-resize Engine Settings -----
  autoResizeSettings?: {
    rulesEnabled: Record<RoleId, boolean>;
    relations: { r1: boolean };
    behaviour: {
      allowCoverFallback: boolean;
      includeUnassigned:  boolean;
      liveLink: { enabled; syncText; syncFont; syncColor; syncOpacity; syncAnimations: boolean };
    };
  };

  // ----- Auth (transient) -----
  user?: { id: string; email: string } | null;
}

interface Canvas {
  id: string; name: string;
  width: number; height: number;
  elements: Element[];           // z-ordered, last = top
  bgColor?: string;
  fullClickArea?: boolean;       // bypasses CTA click checks if true
}

interface Element {
  id: string;
  type: 'text' | 'image' | 'button' | 'rect' | 'circle' | 'line' | 'pixel';
  customName?: string;
  x: number; y: number; width: number; height: number;
  rotation?: number;
  persistent: 'top' | 'bottom' | false;  // layer-panel section placement
  frameId?: number;              // visible frame index (when persistent === false)
  linkGroupId?: string;

  // Auto-resize Roles
  role?: 'background-image' | 'rmit-logo' | 'cta-button'
       | 'heading' | 'subheading' | 'cricos'
       | 'main-image' | 'rfwn' | 'extra-info' | 'misc';
  roleAuto?: boolean;            // true = auto-detected, false = user-locked

  // Masking
  isMask?: boolean;
  maskTargetId?: string;

  // Type-Specific Attributes
  text?: string; fontFamily?: string; weight?: number;
  fontSize?: number; maxFontSize?: number; autoSize?: boolean; wrapText?: boolean;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  lineHeight?: number | string; lineHeightAuto?: boolean;
  color?: string; bg?: string; background?: boolean;
  paddingLR?: number; paddingTB?: number; bgPadL?: number; bgPadV?: number;
  bgCoverage?: number; bgOpacity?: number;
  radius?: number;
  fill?: string; stroke?: string; strokeWidth?: number; textColor?: string;
  assetId?: string; src?: string;
  fit?: 'contain' | 'cover' | 'fill';
  autoHug?: boolean;             // dynamic button widths
  opacity?: number;

  // Animation — four independent categories (IN / OUT / FX / TRANS). These are
  // exactly the fields the Timeline's IN / OUT / FX bars read and write.
  // NOTE: exitStart is stored RELATIVE to animDelay, so the effective CSS exit
  // delay is (animDelay || 0) + (exitStart || 1.5).
  inEnabled?: boolean;   animType?: string;    animDuration?: number; animDelay?: number;
  exitEnabled?: boolean; exitType?: string;    exitStart?: number;    exitDuration?: number;
  fxEnabled?: boolean;   effectType?: string;  effDuration?: number;  effDelay?: number;

  // Per-preset animation options. Registered in app-boot.js's inAnimProps list
  // (used by the animation copy/paste path) — add new ones there too.
  riseSplit?: 'letter' | 'word' | 'line';  riseDirection?: 'up'|'down'|'left'|'right'; riseFade?: boolean;
  typingUnit?: 'letter' | 'word';          popUnit?: 'word' | 'line';
  cursorSplit?: 'block' | 'line';          cursorCenter?: boolean;  cursorFade?: boolean;
  cursorShow?: boolean;                    // v0.50.0 — undefined/true draws the caret
  cursorColor?: string;
  // "Animate BG": brings a text layer's background in with the text, one bar per
  // visual line. Shared by Typing, Reveal and Pop (see lineBgModeFor). animFadeBg
  // is the toggle (animateBg mirrors it); bgOffset leads/lags the bar in seconds.
  animFadeBg?: boolean;  animateBg?: boolean;  bgOffset?: number;
  // Underline FX (v0.50.0) — the first FX that paints on the layer, not moves it.
  ulColor?: string; ulSize?: number; ulOffset?: number;

  // Dynamic Data opt-ins — a nested map, NOT dmText/dmImage/... flags.
  // dmFieldActive() reads el.dynamic[field]; the merge is inert without it
  // even when a column is mapped to the slot.
  dynamic?: { text?: boolean; color?: boolean; bg?: boolean; image?: boolean; fill?: boolean };

  // States
  hidden?: boolean; locked?: boolean;
}

interface Frame {
  id: number;
  duration: number;              // seconds
  transition: 'none' | 'fade' | 'slide-left' | 'slide-right' | 'zoom-in' | 'zoom-out' | 'push' | 'iris' | 'split';
  transitionDuration: number;
  skip?: boolean;                // excluded from HTML5 exports when flagged (default)
}

interface LinkGroup {
  id: string; name: string;
  category: 'text' | 'image' | 'button' | 'shape' | 'line';
  syncProperties: Record<string, boolean>;  // includes 'OUT Animation' option
  liveLink?: boolean;
}
```

---

## 4. Subsystems Detail

### Auto-Resize Engine (v2.19) & Auto-Arrange Configurations
Deterministic, rule-based layout generator. Takes a source canvas and targets, recalculates relative sizes, crops, and wrapping.
- **Geometries & Parameters**: per-size placement specs, safezones, max font-sizes, and brand-element (Logo, Tagline, CRICOS) quadrant coordinates live in `auto-arrange-config.js` (`AUTO_ARRANGE_CONFIG`).
- **Roles**: priority order (`rmit-logo` → `cta-button` → `heading` → …).
- **Crop Preservation**: the `main-image` ("Fixed shape") role keeps exact aspect ratio, computing normalized crop offsets for small targets.
- **R1 Alignments**: pairs the logo with the "Ready for what's next" tagline dynamically.
- **Adjacency Post-Pass**: `enforceHeadingSubheadAdjacency` clears overlap between side-by-side headings/subheadings.

### Animation System — IN / OUT / FX / TRANS toggles
Four independent header toggles in the Animation panel (replaced the old Static/In/In+Out mode dropdown). Turning a category off **remembers** its settings; turning it back on restores them. New elements start with IN, FX, TRANS on and OUT off.

**Two editing surfaces, one model.** The Animation panel (numeric fields) and the **Timeline** (draggable bars — see below) both read and write the same element fields, and the timeline commits through the panel's own `updateProp` closure. **Preset lists come from one registry** in `render-runtime.js` (`ANIM_IN_PRESETS` / `ANIM_OUT_PRESETS` / `ANIM_FX_PRESETS`, surfaced via `getInAnimPresets(el)` / `getOutAnimPresets()` / `getFxPresets()`), so adding a preset there makes it appear in the panel, the timeline chips, playback, and the export with no further wiring. Current presets — IN: None, Fade In, Slide, Swipe, Zoom, Split, Blur, + text-only Typing, Rise (Reveal), Word Pop and Cursor Slide (text-only entries are dropped for non-text layers and lead the list for text/buttons). OUT: Fade Out, Slide, Swipe, Zoom, Blur, + span-driven Untype/Unreveal (no `none` — off is its own entry). FX: None, Pulse, Float, Flash, Wiggle, Spin, Heartbeat, **Move** (`pan`), Zoom, + text-only **Underline**. `getFxPresets(el)` filters `textOnly` the same way the IN/OUT getters do — call it **with** the element.
- **IN (Entrance)** — `inEnabled` + `animType` (fade/slide/swipe/zoom/blur, with direction/fade where relevant). `animDuration`, `animDelay`. A `None` preset hides the duration/delay fields and emits nothing.
- **OUT (Exit)** — `exitEnabled` + `exitType`. Requires IN to be enabled (OUT toggle is disabled with no entrance). Single "In → Out" time (`exitStart`) = how long the element stays after appearing before leaving; runs independently of frame duration. Not applied to persistent layers. Has its own `None` preset. Synced across linked elements via the link group's "OUT Animation" option, and included in the favorites star filter.
  - **Exit timing**: CSS exit start delay = `(animDelay || 0) + (exitStart || 1.5)`, so the "after X seconds" counts from when the element actually appears, not the frame start.
- **FX (Animation FX)** — `fxEnabled` + `effectType` (float, pulse, pan/Move, type, etc.). Named "Animation FX" everywhere (panel heading, tooltip, dropdown, link-sync option, docs). Most FX resolve a shared `@keyframes eff-<val>` by name through `getElementAnimationCSS`'s generic branch and need nothing else. **Surface effects** are the exception (currently just `underline`): they paint on the layer rather than transform it, so they carry a class (`fxOverlayClass`) placed on the node `fxOverlayTarget` picks — for Underline that's the *text span*, not the layer box, so the rule hugs the type and wrapped copy gets one per line. Their look comes from custom properties (`fxSurfaceVarMap`), and they animate `background-size`/`background-position` rather than transform, because on the timeline the entrance and the effect land on the same node and a transform would drag the type with it. They have no `-inverse` variant (nothing moves, so a masked image has nothing to counter). Keep the CSS in `styles.css` and the export template byte-identical.
- **TRANS (Frame Transition)** — `transition !== 'none'` on the active frame. Available whenever a transition can actually play: a forward frame (`activeIdx > 0`), or **any** frame when Loop is on — including a **single frame** (v0.23.0). Greyed out only for a lone static frame with Loop off. The gate is unified as `state.loopAd || (state.frames.length > 1 && idx > 0)` across the panel (`props-panel.js`) and the export data path.

**Single-frame self-restart loop (v0.23.0):** with exactly one frame and Loop on, `nextFrame()` still bails (it needs ≥2 frames), so the export runtime instead schedules `restartSingleFrame()` (in `export-pipeline.js`, emitted into every export). Each cycle it hides → forces reflow → re-shows the frame (the same `display:none→block` trigger that restarts every child IN animation, mirroring `adflowPlayFrom`), replays the frame's transition-in if one is set, then re-schedules itself after the frame's `duration`. This makes looping single-frame ads (e.g. animated email signatures) re-animate. An unset transition still resolves to `'none'` on frame 0 (same as multi-frame loop-back), so IN-animation replay works with no transition; pick a transition explicitly to layer one on each restart.

### Animation Timeline / Sequencer (`sequencer.js`, v0.25.0+)
A collapsible PowerPoint-style panel along the bottom of the workspace, listing the **active canvas + frame**'s animations as draggable bars. It is a *view over the element model* — never a parallel one.

**Design contract (read before touching it):**
- **Every interaction selects first.** A bar grab calls `seqSelectElement(id)` so `renderProps()` binds the props panel's closures (`activeUpdatePropFn` + the start/stop preview fns) to that element. The sequencer then commits through `activeUpdatePropFn` — the exact path the panel uses — which runs `render(true)` and therefore `applyLinkSync`. **Zero duplicated sync logic.**
- **`renderSequencer()` is called from `render()`** (in `canvas-render.js`) on every pass, guarded by `seqSignature()` so it only rebuilds when displayed data changed. Props edits, undo/redo, frame/canvas switches all flow through `render()`, so it cannot go stale.
- **Geometry** comes from `seqBars(el)`, reproducing the runtime's own timing math (OUT start = `animDelay + exitStart`). Commits go back via `seqComputeBarPairs()`. A multi-layer drag writes each member's own values directly — `updateProp`'s multi-select fan-out would force one shared value — then issues a single `render(true)`.
- **Rows**: only elements with an animation by default (`seqHasAnimation`); `seqShowAll` (⚙ → *Show all elements*, persisted) lists everything. Row drag-reorder is **display-only** (`seqApplyRowReorder`), never the layer stack.
- **Grid**: `seqGridStep` 0.1–0.5s, persisted. Moving to a coarser step calls `seqResnapVisible()` — destructive, so it confirms first.
- **Frame duration coupling**: `seqSyncFrameDuration()` extends the active frame to fit an overrunning animation and shrinks it back toward a runtime-only remembered pre-extension value. Mutates `frame.duration` without its own history push, riding the caller's commit.
- **Playback** (`seqStartPlayback`): replays the current frame in place using the **same shared builders the exporter uses** (`buildElementKeyframesCSS`, `getElementAnimationCSS`, `buildTextEntranceHTML`, `setupRiseLines`), so a new preset animates identically with no extra wiring. Deliberately does **not** advance frames. Bound to the header `▶ Play` button and a `Space` **tap** (hold = pan).

**FX veil + isolation (the subtle part).** The FX bar must stay hit-testable *below* IN/OUT so those remain draggable where they overlap — but an outline under a solid bar of identical geometry is invisible. So FX visuals (outline + animated white diagonal stripes, full row height) are painted by `.seq-fx-veil`, a **pointer-transparent** layer on top (z-index 3), whose only pointer-active child is a 7px `.seq-fx-grip` strip along the bottom. Both forward `mousedown` to the real FX bar via `seqBarMouseDown`.
- `seqFxEditId` holds the isolated element. Entry: a **click** (`d.maxPx < 4`) on the FX bar of a layer that was *already* the sole selection — `wasSelected` is captured in `seqBarMouseDown` *before* selection changes, which is what makes click-to-isolate and drag-to-retime coexist.
- While isolated, `.seq-track.seq-fx-edit` dims IN/OUT to `opacity:.2; pointer-events:none` and the whole veil becomes pointer-active with its own resize handles.
- Exit: `Esc` (`seqExitFxEdit`), or a document-level `mousedown` outside every bar — chips, row labels and the preset popover are exempt so they stay usable.
- **Self-healing**: the render pass clears `seqFxEditId` unless that element is still the sole selection *and* still present on the frame, so the state can't outlive what it isolated.
- **Infinite FX veils** are anchored `right: 0` rather than given a width, so dragging only has to move `left`.
- A non-isolated FX drag that starts inside an overlapping IN/OUT bar **promotes** to that bar (`d.overlapBar`), so those stay fully draggable.

**Preset chips**: `seqOpenPresetPopover` reads the shared registry via `getInAnimPresets`/`getOutAnimPresets`/`getFxPresets`, with the same hover-preview fns as the panel. Picking a real preset also flips the category's enable flag on. OUT is gated on `animInEnabled`.

### Shareable Preview System (removed in the local edition)
- Share links, cloud snapshots, `share-preview.js`, the `?url=` loader in `preview.html`, the *Update Preview* button and the *Shared on … / Updated …* line were all removed in v0.60.0 along with the Supabase backend. The portal is a local-file tool only (drop / Open).
- The `previewShare*` / `cloudSaved*` / `spaceId` fields can still appear in `.flow` files saved by the cloud edition. `stripLegacyCloudFields()` (`project-io.js`) removes them on load, on template save, on new project and on base-project snapshot, so they never propagate.
- **No drift**: shared render helpers live in `render-runtime.js` (consumed by the editor and both portals); portal engine scripts are version-pinned `?v=` so reviewers never pair stale engine code with new portal code.

### Standalone Portals — Preview & Batch (v0.34.5)
Both are opened from the editor's **File** menu (`#menu-file-preview`, `#menu-file-batch`, `window.open(...)`), link the app's own `styles.css`, and run fully client-side.

**Preview Portal (`preview.html`)** — now opens standalone with nothing loaded (`bootPortal()` shows `#pv-empty`). Two ways in: an Adflow `.flow`, or a zipped standalone HTML5 ad. Local-file tool only. `portalMode` (`'adflow' | 'external' | null`) plus `applyPortalMode()` swap the control set; the two modes never mix.

**Third-party ad player** (`EXT_MAX = 10`, `externalAds[]`):
- `parseExternalAd(file)` picks the shallowest `index.html` (else shallowest `.html`) as the entry, then **flattens the zip into one document**: `<link>`/`<script src>` replaced with inline `<style>`/`<script>`, every other asset rewritten to a `data:` URL. Path variants tried per asset: `rel`, `./rel`, `/rel`, and the bare basename **when unambiguous** — that last one is what makes references built at runtime by the ad's own JS resolve. Assets are substituted longest-path-first.
- **Every replacement uses the function form of `String.replace`** — ad code and base64 payloads legitimately contain `$&` / `$1`, which a string replacement would expand.
- **Closing tags are built by concatenation** (`'<' + '/script>'`): an HTML parser ends a `<script>` block at the first literal `</script>`, even inside a JS string. This *has* broken the page before. Run `node --check` on extracted inline blocks after editing.
- **Size**: `ad.size` meta tag → `WxH` hint in filename/entry path → 300×250 flagged `'no size found — defaulted, please set it'`. `sizeSource` is surfaced in the UI; per-ad width/height inputs override it (`'manual override'`).
- Controls: `Restart All`, `Loop` + `Replay every N sec` (a plain `setInterval` remount — Adflow can't read a third-party timeline), per-ad `Restart`/`Remove` in both the sidebar row and the card footer.

**Batch Operation Portal (`batch.html`)** — three numbered sidebar steps: **1 · Template**, **2 · Data Sheet**, **3 · Export**.
- **Certification gate**: only files carrying `isTemplate === true` (in `project.json` or `meta.json`) are accepted — i.e. saved via **File ▸ Save ▸ Save template** (`buildFlowBlob(true)`). Ordinary `.flow` projects are rejected by design.
- Deliberately **omits** the frame picker (grid always plays whole ads; `#select-frame` still exists hidden because the playback code reads it) and **all appearance controls** (always the default Adflow theme, so it can't drift).
- Errors are reported **in place** — a message under the empty-prompt heading with the button becoming *Try another file*, or a toast if a template is already open. Never a dedicated error screen: users got stranded on it.

**Portal gotchas (all hard-won):**
- **Token aliases must be declared on `body`, not `:root`** — a `var()` alias resolves against the element it is *declared* on, so `:root` aliases only half-apply under a `body.theme-*` override.
- **Engine stubs**: the portals don't load `core-state.js`, so globals the export path writes to (e.g. `urlSizeCache`) must be stubbed in the page. A missing stub shows up as a silently failed size badge — exports are unaffected.
- **`.btn` overrides must be layout-only and scoped.** `.sidebar .btn` (0,2,0) ties `.btn.primary` (0,2,0) on specificity and wins by source order — a colour declaration there turns every primary button grey. Also: `flex: 1` inside a *column* container makes flex dictate height, defeating explicit `height`; use `flex: none`.
- **Stock assets**: `buildFlowBlob` clears `assetLibrary` for templates, so a template can't carry the RMIT stock library. Both portals register it themselves at boot (`attachRmitAssets`/`preloadRmitAssets`) — otherwise data-sheet rows referencing stock art by filename render broken.
- **Deferred layout**: `packRectangles`/`layoutCards` measure `offsetWidth`, so they must run post-layout (`setTimeout(..., 50)`, matching `renderCanvases`). Called synchronously they measure `0` and stack cards vertically.
- **Writing these files from PowerShell**: `Set-Content -Encoding utf8` double-encodes and adds a BOM (mojibake). Use `[System.IO.File]::WriteAllLines` with `UTF8Encoding($false)`.

### Full Preview Controls (editor)
The editor's full-preview bar has a frame selector (jump-and-play across all sizes), "Replay all", "Download all" (each size as an HTML5 zip), and the total/per-frame runtime readout. These controls live only in the editor — exported files are unchanged.

### Export, Font Subsetting & Validation
- **Formats**: HTML5 ZIP, PNG, **MP4 video**, **animated GIF** — one dropdown in `openExportModal`, and the same four on a canvas's right-click `Export ▸` submenu + the Canvas Settings "Export this canvas" block. Per-version export folders for data-merge ("All versions" is ZIP-only). ZIP is compressed/streamed via a background worker to avoid main-thread lockups.
- **Font subsetting/embedding** (`font-subset.js` + `lib/hb-subset.wasm`): exported ads contain **no font files** — each required brand font is subset to the glyphs actually used and embedded as base64 in `index.html` (ad-server safe for Google Ads / Adobe DSP, keeps text editable/animatable). Graceful fallback to packing full `.woff2` if subsetting is unavailable. All live size readouts measure the subsetted output.
- **Auto-compression** (`compressFormat`): default `jpeg` resolves to PNG when the image has an alpha channel, otherwise JPEG (avoids WebP rejection by CM360 / Google Ads / Adobe DSP). `webp` is opt-in.
- **Validation & Audit** (`validationSettings`): text size, contrast, transition timing, infinite motion, CRICOS, logo, brand colors, brand fonts, ad-weight (KB) limit, and per-active-version clickTag URL validation. Canvas badges update live; clickTag/ad-weight changes participate in undo/redo and re-run validation.

### Video & GIF Export (`video-export.js`, v0.50.0) — the virtual clock

Fully client-side, no server, no plugins. **Read this before touching anything in `video-export.js`** — several of the constraints below were discovered the hard way.

**Why a virtual clock is unavoidable.** Exported bundles are *not* purely CSS-animated: storyboard frame switching is JS `setTimeout(nextFrame, duration*1000)` and the startup chain is `load → fonts.ready → rAF → setTimeout(startAd, 50)`. Seeking WAAPI alone cannot reproduce the timeline. `VIRTUAL_CLOCK_SRC` is injected as the **first `<head>` script** of the bundle inside a hidden iframe and virtualises `setTimeout`/`setInterval`/`rAF`/`performance.now`/`Date.now`. `__vtAdvanceTo(ms)` fires queued timers in chronological order while force-pausing every animation found via `getAnimations({subtree:true})` and driving `currentTime` by hand (CSS animations run on the compositor clock, which cannot be patched). It re-scans for new animations immediately after each timer fires, so animations recreated by a frame flip are birthed at the flipping timer's virtual time. The `#ad.ad-loading` gate (`animation-play-state: paused !important`) is respected: animations are held at 0 and re-birthed until `startAd` lifts it.

**Pipeline.** `captureCanvasFrames()` is the shared pump — boot, advance, freeze, rasterize — and calls back per frame. `captureCanvasVideo()` and `captureCanvasGif()` are thin sinks on top, so clock/freeze/rasterize behaviour cannot drift between formats.

- **Freeze** (`freezeAdClone`): a serialized snapshot re-parses CSS, so animations would restart at 0 inside the SVG. Every animated element's current computed values (keyframe-property union + a fallback allowlist) are inlined on the clone and `animation`/`transition` set to `none`.
- **Rasterize**: the same SVG-`foreignObject` path the PNG export uses (`buildAdSnapshotSvg`, shared out of `export-pipeline.js`).
- **Encode**: mediabunny → WebCodecs for MP4 (`avc`), falling back to VP9/WebM, then a clear error. gifenc for GIF (no WebCodecs involved, so GIF works where video encoding doesn't).
- **Determinism**: verified byte-identical across runs. ~50 ms/frame.

**Traps — do not re-derive:**
1. **Never round-trip the bundle html through `XMLSerializer`.** It XML-escapes inline `<script>` contents (`&&` → `&amp;&amp;`) and the ad never starts. Feed the iframe raw html (fonts string-inlined only) and inline relative `<img>`s in the **live DOM** via `inlineIframeImages`.
2. **Snapshot SVGs must be base64 `data:` URLs, not `blob:`.** Chrome taints a canvas drawn from a blob-URL foreignObject SVG, and `VideoFrame` construction then throws `SecurityError`.
3. **`LEAD_IN = 170ms`** (50 ms startAd chain + 120 ms `ad-visible` reveal) so output t=0 is the first fully-visible frame.
4. **H.264 needs even dimensions** — the canvas is padded up 1px and prefilled with the frame's computed background.
5. **GIF palettes must be sampled across *every* frame**, not one. Sampling a single frame lets artwork that appears late map onto whatever *is* in the palette (typically the flat background or a text slab) — a photograph then comes out visibly colour-cast, not merely posterised. Stride-capped at `GIF_PALETTE_SAMPLE_PX` so quantise time stays flat.
6. **GIF FPS options must divide 100 evenly** (10/20/25) because GIF delays are in hundredths of a second.
7. `gifenc`'s `applyPalette` third argument is a **pixel format**, not a dither mode. `prequantize` (the `GIF_COMPRESSION` map) is the only real size lever; it is kept but **not exposed in the UI** and exports run at `none`.

**Nothing is uploaded.** The blob lives in a closure and a `blob:` URL, never in `state`, so project autosave cannot serialise it. There is no upload path anywhere in the codebase.

**Single-canvas export previews in-panel** (`openVideoExportSettingsPopup`): Render → play at 1:1 in the panel → Download / drag-out / Copy. Layout is neutral until a preview exists, then portrait goes beside the controls (all controls, so panel height ≈ preview height) and landscape stacks. Getting a file out to another app: **`DownloadURL` drag** is the only route that preserves animation — the clipboard cannot (browsers accept only `image/png` and re-encode, and even native Copy Image flattens GIFs because the Windows clipboard has no GIF flavour). `Copy` therefore copies a still and says so.

### CSS `clip-path` Vector Masking
Mask shapes (rect/circle/custom brand SVG) use inline CSS `clip-path` instead of SVG def references. A connector line bridges the mask layer and target image row in the Layers panel. Animation FX apply to the mask wrapper while the child image receives inverse animation, keeping the background photo stationary.

### Spreadsheet Data Merge
Maps columns to dynamic element slots to batch-generate banners. Edit-in-place writes back to the active version row cell unless Data Lock (`locked`) is on. Link-group sync-lock forces `text`/`textColor`/`color`/`image` sync `true` for elements bound to active dynamic slots (checkboxes replaced by a locked bolt icon in the Link Groups panel; enforced in `applyLinkSync` and `dmToggleField`).

### Undo / History
`savedHistoryLimit` (default 50) bounds the stack. Frames (durations/transitions/skip), `activeFrameId`, `projectName`, and arrow-key nudges are undoable (a held nudge = one undo step per burst). **Settings/preferences are intentionally excluded** from undo (theme, auto-resize behaviour, view prefs, zoom/scroll, ad-weight limit, validation toggles) — though changing the ad-weight limit / clickTag still re-runs live validation.

---

## 5. Workflow Conventions

### Commit Workflow
- **Never run `git add` / `git commit` / branch / push.** Save files directly to the local checkout. The user manages commits and branches in GitHub Desktop.

### Changelog Workflow
After user-visible changes, **bump the version and update these 7 locations**. Reliable method: `grep -rn "<old version>"` across `*.js *.html *.txt` and bump every live hit.

1. `data/version.txt` — single-line version string (e.g. `v0.50.0`).
2. `data/changelog.txt` — add entry at the **top** of the file.
3. `scripts/docs-content.js` — insert into the `CHANGELOG_DATA` array.
4. `scripts/project-dialogs.js` — `currentVersion` in `checkVersionUpdate()` + the Settings-modal version label. (Splash-badge version lives in `scripts/app-boot.js`, `verEl.textContent`.)
5. `index.html` — `#app-version-display` footer label, the `.app-splash-version` span, **and every local `<script src="...?v=...">` query string**.
6. `preview.html` — the `?v=` query strings on its engine `<script>` tags and its `styles.css` link.
7. `batch.html` — same as above.

Both portals load the same `scripts/` files as the editor, so a missed `?v=` bump pairs stale engine code with new page code — the failure mode is silent and confusing. Bump all three pages together.

Skip the bump for trivial/internal-only changes (see the project memory on changelog workflow).

### Severity Guide
- **Patch (Z+1)**: bug fixes, UI polish, tuning.
- **Minor (Y+1)**: new features, interface reorganizations, workflow changes.
- **Major (X+1)**: breaking revisions.

---

## 6. Repo Hygiene Notes (August 2026)
Loose/debug artifacts still tracked in the repo that are **not** part of the runtime: `error_logs.txt` (resumable defect log — read it before debugging) and `data/image.jpg` (loose). `Startup/registry.json` and `data/assets/manifest.json` are **build outputs** regenerated by the Node build scripts.

Removed in v0.61.0: `diff_props.txt` (UTF-16 git-diff dump), `workflow-test.txt` (write-workflow probe), `_temp/` (the reverted MP4 prototype's leftovers) and `data/docs/splash-signin.png` — a screenshot of the sign-in gate that v0.60.0 deleted. That last one had also broken `scripts/build-docs-screenshots.mjs`: it waited for a gate that never appears, so the whole docs-screenshot regeneration threw. Fixed at the same time.

`lib/` holds three vendored binaries with **no npm and no build step** — `hb-subset.wasm`, `mediabunny.min.mjs`, `gifenc.esm.min.js`. They are committed on purpose: exports have to work offline, and `npm install` has historically failed in this checkout. Update them by downloading a pinned version from jsdelivr and replacing the file.

The MP4-export CLI prototype (June 2026, `tools/export-mp4/`) was reverted; its virtual-clock design shipped in-app as `scripts/video-export.js` in v0.50.0. Nothing of the prototype remains.

---

## 7. Themes (v0.61.0)

There are **two** themes and no mechanism for more without touching CSS:

| id | body class | Palette source |
|---|---|---|
| `default` | *(none)* | the bare `:root` variable block at the top of `styles.css` |
| `light` | `body.theme-light` | the one override block, ~20 lines |

`default` deliberately maps to **no class at all** — it is the `:root` defaults, so
"switch to Adflow" is "remove the theme class".

**The three places that know about themes:**

1. `THEMES` in `project-dialogs.js` — the Settings grid. Two entries, one row.
2. `normalizeTheme()` / `themeBodyClass()` / `LIGHT_BG_THEMES` in `canvas-render.js`.
3. `body.theme-light { … }` in `styles.css`, plus the ~70 `body.theme-light …`
   overrides scattered through it (layer rows, link-group rows, `#dm-panel`,
   outline mode, the outline legend).

**`normalizeTheme()` is the safety net.** `state.theme` persists into `.flow`
files and autosaves, so a project saved before v0.61.0 can still carry
`obsidian`, `nordic`, `amber`, `amethyst`, `rmit`, `rmit-navy`, `ocean`, `navy`,
`nordic-light`, `amber-light` or `sage-light`. Those classes no longer exist in
the stylesheet. Everything that puts a theme on `<body>` goes through
`themeBodyClass()`, which folds an unrecognised id back to `default` — so an old
project opens on the default palette instead of on an unstyled body with the
Settings grid showing nothing selected. **Do not reintroduce
`state.theme && state.theme !== 'default' ? 'theme-' + state.theme : ''`
inline;** that was the old idiom in four places and it is exactly what skips the
normalisation.

**Adding a theme** (if it ever comes back) is four edits: a `body.theme-<id>`
block in `styles.css`, an entry in `THEMES`, an entry in `VALID_THEMES`, and —
if it is light-backgrounded — an entry in `LIGHT_BG_THEMES` so the Adflow
wordmark swaps to `Adflow_lighttheme.svg`. Also add it to the `lightThemeIds`
set in `openSettings()` if you restore the dark/light grouping in the dialog.

**Why they were removed (v0.61.0):** eleven extra palettes were eleven more sets
of tokens to keep in step with every new panel, dialog and table, and nothing
outside the Settings grid ever read them. The scrollbar block's comment is the
tell — it was written to brag that one `color-mix` rule covered "all twelve
themes", which is work that only existed because the themes did.

The Preview Portal's **Presentation Grid / BG** swatches are the same two themes
applied the same way (`preview.html` sets `body.className` exactly as
`canvas-render.js` does), plus a **checkered** toggle that is *not* a theme — it
is a `body.preview-checkered` class layered over whichever theme is active.

---

## 8. Desktop App — Electron (`electron-app` branch)

The same app, packaged for Windows and macOS. **Three files, ~300 lines**, and
nothing below them was changed to make it work:

| File | Role |
|---|---|
| `electron/main.js` | Window, menu policy, external-link handling, single-instance lock |
| `electron/static-server.js` | Read-only HTTP server on loopback serving the app folder |
| `electron/preload.js` | A read-only `window.adflowDesktop` marker, nothing else |

**The hard constraint:** `scripts/`, `styles.css`, `index.html`, `preview.html`
and `batch.html` are identical in the desktop and hosted builds. Do not add a
desktop-only branch to the app code. If the desktop build needs different
behaviour, it belongs in `electron/`, or the feature is wrong.

**Why there is an HTTP server inside a desktop app.** Electron could load
`index.html` over `file://`, but Adflow cannot run that way: every ad preview is
an `<iframe srcdoc>` sandbox, and export spawns a `blob:` Worker that
`importScripts()` the vendored JSZip. Under `file://` those get opaque origins
and are blocked — `export-pipeline.js` already refuses to export PNGs on
`file://` for this reason. `http://127.0.0.1` gives the renderer the exact
environment the app was written against, and Chromium treats loopback as a
secure context, which is what keeps `showSaveFilePicker` and WebCodecs working.

**Why the port is fixed (`PREFERRED_PORT = 47823`).** IndexedDB and localStorage
are keyed to the origin, and the origin includes the port. A random port each
launch would show an empty workspace every time — autosave, recents, the base
project and remembered placements all keyed to a port that no longer exists. If
the port is genuinely taken, `static-server.js` falls back to `PREFERRED_PORT +
n` and `main.js` **says so in a dialog** rather than silently appearing to have
lost the user's work.

**Why Electron and not Tauri.** Tauri renders in the OS webview — Chromium on
Windows, **Safari's engine on macOS**. Adflow depends on two Chromium-only APIs:
WebCodecs `VideoEncoder` (`video-export.js`) and `showSaveFilePicker`
(`project-io.js`, `export-pipeline.js`). A system-webview wrapper would ship a
Mac build quietly missing video export and the native save dialog — the exact
Windows/Mac split the desktop app exists to remove. The cost is ~150–200 MB
against Tauri's ~10 MB, which for an internal tool is not a real trade.

**Packaging.** `package.json` carries the Electron tooling and an
`electron-builder` config (`appId: au.edu.rmit.adflow`, **`asar: false`** so the
app files sit on disk exactly as they do in the repo). `npm run build:win` /
`build:mac` run the two Node generators via `prebuild`, then build to
`dist/win-unpacked` (`--dir`, unpacked — no installer). Double-click wrappers:
`build-app.bat` / `build-app.command`, and `run-electron.bat` /
`run-electron.command` to run from source.

**`package.json` is for the desktop build only.** The web app still has no
runtime dependencies and needs no `npm install` — that claim in the README is
about the app, not about packaging it.

**Storage does not cross the two editions.** The desktop app's origin is
`http://127.0.0.1:47823`; a hosted copy is whatever URL it is served from.
Autosave, recents, the base project and remembered placements are per-origin, so
work started in one does not appear in the other. `.flow` files are the bridge.
This is worth saying out loud to users — it reads as data loss otherwise.

Not yet verified on macOS: see `ELECTRON.md` for the open items (code signing
and notarisation are the main ones — unsigned apps are blocked by Gatekeeper).
