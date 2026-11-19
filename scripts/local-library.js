// ============================================================================
// local-library.js — Base project + remembered placements, kept in this browser
// ============================================================================
// Local edition. Both of these used to live on a Supabase account so they could
// follow a user between machines. There are no accounts any more, so each lives
// in the browser profile that saved it:
//
//   Base project         → IndexedDB. A .flow blob can run to many megabytes, far
//                          past the localStorage ceiling, so it shares the
//                          `adflow-autosave` database (same store as autosave)
//                          under its own fixed key. Its EXISTENCE is the switch:
//                          New Project offers "Base project" whenever one is saved.
//   Placement library    → localStorage. Small JSON, and reads must be SYNCHRONOUS
//                          because the auto-resize engine resolves geometry inside
//                          a tight per-element loop.
//
// The function names are the ones the rest of the app already calls (app-boot.js,
// project-dialogs.js, auto-resize-engine.js), so nothing else had to change shape
// when the cloud went away. Loaded right after autosave.js so `_idbOpen`,
// `_idbGet`, `_idbPut` and `AUTOSAVE_STORE` exist by the time anything here runs.
// Everything is call-time only — no top-level work, no network.
// ============================================================================

// ---------------------------------------------------------------------------
// Base project — the snapshot that replaces the empty board for new projects,
// set from Settings ▸ Startup ▸ Base project.
// ---------------------------------------------------------------------------
const DEFAULT_STARTUP_IDB_KEY = 'default-startup';
// Synchronous hint (name, timestamp, size, shape) so the New Project dialog can
// paint its "Base project" row without an async IndexedDB round-trip first. The
// IndexedDB record is the authority; getDefaultStartupInfo() corrects the hint.
const DEFAULT_STARTUP_META_KEY = 'adflow-default-startup-meta';

// Third value for the `adflow-startup-mode` preference, alongside 'fresh' and a
// startup-template filename. It must never be treated as a filename — nothing
// lives at Startup/<this>.
const STARTUP_MODE_DEFAULT_PROJECT = 'default-project';

function readDefaultStartupMeta() {
  try { return JSON.parse(localStorage.getItem(DEFAULT_STARTUP_META_KEY) || 'null'); }
  catch (e) { return null; }
}

function _writeDefaultStartupMeta(meta) {
  try {
    if (meta) localStorage.setItem(DEFAULT_STARTUP_META_KEY, JSON.stringify(meta));
    else localStorage.removeItem(DEFAULT_STARTUP_META_KEY);
  } catch (e) { /* hint only */ }
}

async function _idbDelete(key) {
  const db = await _idbOpen();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(AUTOSAVE_STORE, 'readwrite');
      tx.objectStore(AUTOSAVE_STORE).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

// { blob, meta } or null. Throws only on a genuine IndexedDB failure.
async function _readDefaultStartupRecord() {
  const rec = await _idbGet(DEFAULT_STARTUP_IDB_KEY);
  return (rec && rec.blob instanceof Blob) ? rec : null;
}

// Save whatever is open now as the base project. buildFlowBlob's
// forDefaultStartup pass strips identity (name, share/cloud stamps left over from
// older files, data version) so every project created from it starts clean.
async function saveDefaultStartupProject() {
  const sourceName = state.projectName || 'RMIT_ad';
  const { blob } = await buildFlowBlob(true, { forDefaultStartup: true });
  const meta = {
    name: sourceName,
    savedAt: Date.now(),
    sizeBytes: blob.size,
    frames: (state.frames || []).length,
    canvases: (state.canvases || []).map(c => ({ w: c.width, h: c.height }))
  };
  await _idbPut(DEFAULT_STARTUP_IDB_KEY, { blob, meta });
  _writeDefaultStartupMeta(meta);
  return meta;
}

// { exists, updatedAt, sizeBytes, name, frames, canvases, described } — or
// { exists: false, reason: 'none' | 'error' }.
async function getDefaultStartupInfo() {
  let rec;
  try { rec = await _readDefaultStartupRecord(); }
  catch (e) {
    console.warn('Base project probe failed:', e);
    return { exists: false, reason: 'error' };
  }
  if (!rec) {
    // The hint must never outlive the record — a stale hint would paint a
    // "Base project" row that cannot be used.
    if (readDefaultStartupMeta()) _writeDefaultStartupMeta(null);
    return { exists: false, reason: 'none' };
  }
  const m = rec.meta || readDefaultStartupMeta() || {};
  if (rec.meta && !readDefaultStartupMeta()) _writeDefaultStartupMeta(rec.meta);
  return {
    exists: true,
    updatedAt: m.savedAt ? new Date(m.savedAt).toISOString() : null,
    sizeBytes: rec.blob.size || m.sizeBytes || null,
    name: m.name || null,
    frames: (typeof m.frames === 'number') ? m.frames : null,
    canvases: Array.isArray(m.canvases) ? m.canvases : null,
    described: !!rec.meta
  };
}

async function fetchDefaultStartupBlob() {
  const rec = await _readDefaultStartupRecord();
  if (!rec) throw new Error('No base project is saved in this browser.');
  return rec.blob;
}

async function clearDefaultStartupProject() {
  await _idbDelete(DEFAULT_STARTUP_IDB_KEY);
  _writeDefaultStartupMeta(null);
  // A startup preference pointing at something that no longer exists would send
  // every new project down a path that can only fail, so retire it here.
  if (localStorage.getItem('adflow-startup-mode') === STARTUP_MODE_DEFAULT_PROJECT) {
    localStorage.setItem('adflow-startup-mode', 'fresh');
  }
}

// ---------------------------------------------------------------------------
// Placement library — remembered element placements, per canvas SIZE and role,
// belonging to this browser rather than to a project.
//
// `c.layoutOverrides[role]` already pins a role's geometry, but it lives on one
// canvas inside one .flow: get a 300 × 250 laid out the way you want it and the
// next project starts from the built-in rules again. This is the same information
// keyed by `<width>x<height>` → role, kept in the browser, so it survives across
// projects.
//
// Shape: { version: 1, savedAt, sizes: { "300x250": { heading: {x,y,width,height,…} } } }
// ---------------------------------------------------------------------------
const PLACEMENT_LIBRARY_KEY = 'adflow-placement-library';
const PLACEMENT_GEOM_KEYS = Object.freeze([
  'x', 'y', 'width', 'height', 'fontSize', 'maxFontSize', 'textAlign', 'verticalAlign', 'hidden'
]);

// DIMENSIONS ONLY. The canvas name is deliberately not part of this and must never
// be added: a 1080 × 1080 is a 1080 × 1080 whether it arrived as "Instagram Square",
// as a hand-typed custom size, or renamed afterwards. Rounding normalises the odd
// fractional width so 1080 and 1080.0 cannot key apart.
const placementSizeKey = (w, h) => `${Math.round(w)}x${Math.round(h)}`;

// Always on in the local edition — kept because app-boot.js asks before offering
// the "All projects (global)" entries, and the answer used to depend on sign-in.
function placementLibraryAvailable() {
  return true;
}

function readPlacementLibrary() {
  try {
    const lib = JSON.parse(localStorage.getItem(PLACEMENT_LIBRARY_KEY) || 'null');
    return (lib && typeof lib === 'object' && lib.sizes) ? lib : null;
  } catch (e) { return null; }
}

// Throws on a quota failure so the caller can say so; a placement that silently
// failed to save would be indistinguishable from one that was never made.
function _writePlacementLibrary(lib) {
  localStorage.setItem(PLACEMENT_LIBRARY_KEY, JSON.stringify(lib));
}

// The one lookup the engine calls. Deliberately total-failure-tolerant: anything
// odd about the stored JSON returns null and the built-in placement rule runs.
function getGlobalPlacement(width, height, role) {
  if (!role) return null;
  const lib = readPlacementLibrary();
  if (!lib) return null;
  const bucket = lib.sizes[placementSizeKey(width, height)];
  const geom = bucket && bucket[role];
  if (!geom || typeof geom.x !== 'number' || typeof geom.y !== 'number') return null;
  return geom;
}

// Keep only the geometry keys, and only the ones actually present — writing
// `fontSize: undefined` into JSON drops the key anyway, but an explicit null would
// later read as "pinned to nothing" and clobber a real value.
function pickPlacementGeom(el) {
  const out = {};
  PLACEMENT_GEOM_KEYS.forEach(k => { if (el[k] !== undefined && el[k] !== null) out[k] = el[k]; });
  return out;
}

// Kept for callers that used to refresh from the account before describing the
// library. Locally the store IS the cache, so this is just a read.
async function fetchPlacementLibrary() {
  return readPlacementLibrary();
}

// Remember `entries` ({ role: element }) for one canvas size. Merges rather than
// replaces, at the role level, so saving a heading never forgets a button.
async function savePlacementsToLibrary(width, height, entries) {
  const roles = Object.keys(entries || {});
  if (!roles.length) return { saved: 0 };

  const lib = readPlacementLibrary() || { version: 1, sizes: {} };
  const key = placementSizeKey(width, height);
  if (!lib.sizes[key]) lib.sizes[key] = {};
  roles.forEach(role => { lib.sizes[key][role] = pickPlacementGeom(entries[role]); });
  lib.savedAt = Date.now();

  _writePlacementLibrary(lib);
  return { saved: roles.length };
}

// Forget remembered placements for one size. `roles` omitted forgets the whole
// size. Drives Auto-arrange ▸ Clear placement ▸ All projects; "Forget all" below is
// the everything-everywhere version behind Settings.
async function forgetPlacementsFromLibrary(width, height, roles) {
  const lib = readPlacementLibrary();
  if (!lib) return { forgotten: 0 };
  const key = placementSizeKey(width, height);
  const bucket = lib.sizes[key];
  if (!bucket) return { forgotten: 0 };

  let forgotten = 0;
  if (Array.isArray(roles) && roles.length) {
    roles.forEach(r => { if (bucket[r]) { delete bucket[r]; forgotten++; } });
  } else {
    forgotten = Object.keys(bucket).length;
    delete lib.sizes[key];
  }
  if (!forgotten) return { forgotten: 0 };
  // Never leave an empty size bucket behind — it would count as a remembered size
  // in the Settings summary while holding nothing.
  if (lib.sizes[key] && !Object.keys(lib.sizes[key]).length) delete lib.sizes[key];
  lib.savedAt = Date.now();

  _writePlacementLibrary(lib);
  return { forgotten };
}

// Forget every remembered placement, for every size. The library is invisible
// state that changes how auto-resize behaves in projects you have not opened yet,
// so there has to be one switch that puts it all back to the built-in rules.
async function forgetAllPlacements() {
  clearPlacementLibraryCache();
}

function clearPlacementLibraryCache() {
  try { localStorage.removeItem(PLACEMENT_LIBRARY_KEY); } catch (e) {}
}

// Summary for the Settings screen: how many sizes and roles are remembered.
function describePlacementLibrary() {
  const lib = readPlacementLibrary();
  if (!lib) return { sizes: 0, roles: 0 };
  const keys = Object.keys(lib.sizes || {});
  return {
    sizes: keys.length,
    roles: keys.reduce((n, k) => n + Object.keys(lib.sizes[k] || {}).length, 0)
  };
}

// ---------------------------------------------------------------------------
// Settings file — everything above (and the Settings dialog's own values) in one
// JSON file, so a setup can move to another machine, into the desktop app, or
// into another browser. Browser storage belongs to one origin on one machine;
// this is the way across.
//
// Deliberately NOT included: autosave, Open Recent and the last-opened file.
// Those are work, not settings, and Open Recent holds file handles that cannot be
// serialised anyway. Projects travel as .flow files.
//
// Shape: { format: 'adflow-settings', version: 1, appVersion, exportedAt,
//          preferences: { theme, snapEnabled, …, validationSettings },
//          storage:     { '<localStorage key>': '<string value>' },
//          placements:  { version, sizes: { "300x250": { role: geom } } } | null,
//          baseProject: { meta, flowBase64 } | absent }
// ---------------------------------------------------------------------------
const SETTINGS_FILE_FORMAT = 'adflow-settings';
const SETTINGS_FILE_VERSION = 1;

// The Settings dialog's values. They live on `state`, so they ride along with
// autosave; listed here so an import can never write anything else onto state.
const SETTINGS_PREF_FIELDS = Object.freeze({
  theme: 'string', showRulers: 'boolean', cropToCanvas: 'boolean', tempTopDuringDrag: 'boolean',
  zoomStep: 'number', defaultBg: 'string',
  snapEnabled: 'boolean', snapToElements: 'boolean', snapToCanvas: 'boolean',
  snapToGuides: 'boolean', snapCanvases: 'boolean', snapDistance: 'number',
  savedHistoryLimit: 'number', autosaveInterval: 'number', adSizeLimit: 'number'
});
const SETTINGS_VALIDATION_FIELDS = Object.freeze([
  'textSize', 'contrast', 'transitionTiming', 'infiniteMotion', 'cricos', 'logo', 'brandColors', 'brandFonts'
]);

// Remembered choices kept in localStorage. An allow-list, not "everything": an
// imported file must not be able to plant arbitrary keys, and some keys
// (last-seen-version, the base project hint) describe this browser, not the user.
const SETTINGS_STORAGE_KEYS = Object.freeze([
  'adflow-startup-mode', 'favoriteAnimations', 'adflow-ad-server',
  'adflow-download-only-save-notice-off', 'hover-preview-armed',
  'sync-layers-all-frames', 'sync-frames-clear', 'dist-all-canvases',
  'adflow-sequencer-expanded', 'adflow-sequencer-grid', 'adflow-sequencer-showall'
]);
const SETTINGS_STORAGE_PREFIXES = Object.freeze(['panel-collapsed-']);
const _isSettingsStorageKey = (k) => typeof k === 'string'
  && (SETTINGS_STORAGE_KEYS.includes(k) || SETTINGS_STORAGE_PREFIXES.some(p => k.startsWith(p) && k.length <= 80));

function _blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
function _base64ToBlob(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'application/octet-stream' });
}

// `prefs` — the values to write for the Settings dialog fields (the dialog passes
// what it is showing, so an export matches the screen even before Save Changes).
// `overrides` — localStorage values the dialog holds unsaved (the startup mode).
async function buildSettingsBundle({ prefs = state, overrides = {}, includeBaseProject = false } = {}) {
  const preferences = {};
  Object.keys(SETTINGS_PREF_FIELDS).forEach(k => {
    if (prefs[k] !== undefined && prefs[k] !== null) preferences[k] = prefs[k];
  });
  // Unset until someone picks one; write what the editor is actually showing.
  if (typeof normalizeTheme === 'function') preferences.theme = normalizeTheme(prefs.theme);
  if (prefs.validationSettings) {
    preferences.validationSettings = {};
    SETTINGS_VALIDATION_FIELDS.forEach(k => { preferences.validationSettings[k] = prefs.validationSettings[k] !== false; });
  }

  const storage = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (_isSettingsStorageKey(k)) storage[k] = localStorage.getItem(k);
  }
  Object.entries(overrides).forEach(([k, v]) => { if (_isSettingsStorageKey(k) && v != null) storage[k] = String(v); });

  const bundle = {
    format: SETTINGS_FILE_FORMAT,
    version: SETTINGS_FILE_VERSION,
    appVersion: (typeof getAppVersion === 'function') ? getAppVersion() : null,
    exportedAt: new Date().toISOString(),
    preferences,
    storage,
    placements: readPlacementLibrary()
  };

  if (includeBaseProject) {
    const rec = await _readDefaultStartupRecord();
    if (rec) bundle.baseProject = { meta: rec.meta || readDefaultStartupMeta() || null, flowBase64: await _blobToBase64(rec.blob) };
  }
  return bundle;
}

// What a file holds, for the confirmation before importing. Throws on anything
// that is not an Adflow settings file.
function describeSettingsBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || bundle.format !== SETTINGS_FILE_FORMAT) {
    throw new Error('This is not an Adflow settings file.');
  }
  if (typeof bundle.version !== 'number' || bundle.version > SETTINGS_FILE_VERSION) {
    throw new Error('This settings file was made by a newer version of Adflow. Update Adflow, then import it again.');
  }
  const sizes = (bundle.placements && bundle.placements.sizes && typeof bundle.placements.sizes === 'object')
    ? Object.keys(bundle.placements.sizes) : [];
  return {
    appVersion: bundle.appVersion || null,
    exportedAt: bundle.exportedAt || null,
    preferences: Object.keys(bundle.preferences || {}).length,
    storage: Object.keys(bundle.storage || {}).filter(_isSettingsStorageKey).length,
    placementSizes: sizes.length,
    placementRoles: sizes.reduce((n, k) => n + Object.keys(bundle.placements.sizes[k] || {}).length, 0),
    baseProject: !!(bundle.baseProject && typeof bundle.baseProject.flowBase64 === 'string'),
    baseProjectName: (bundle.baseProject && bundle.baseProject.meta && bundle.baseProject.meta.name) || null
  };
}

// Apply a settings file. Preferences and remembered choices are replaced;
// placements are MERGED (a placement for the same size and role is replaced, the
// rest of this browser's are kept), so importing never silently forgets work; the
// base project, when the file has one, replaces this browser's.
// Returns { preferences, storage, placements, baseProject } counts.
async function applySettingsBundle(bundle) {
  describeSettingsBundle(bundle);   // validates
  const out = { preferences: 0, storage: 0, placements: 0, baseProject: false };

  const p = bundle.preferences || {};
  Object.entries(SETTINGS_PREF_FIELDS).forEach(([k, type]) => {
    if (typeof p[k] !== type) return;
    if (type === 'number' && !isFinite(p[k])) return;
    state[k] = (k === 'theme' && typeof normalizeTheme === 'function') ? normalizeTheme(p[k]) : p[k];
    out.preferences++;
  });
  if (p.validationSettings && typeof p.validationSettings === 'object') {
    if (!state.validationSettings) state.validationSettings = {};
    SETTINGS_VALIDATION_FIELDS.forEach(k => {
      if (typeof p.validationSettings[k] === 'boolean') { state.validationSettings[k] = p.validationSettings[k]; out.preferences++; }
    });
  }

  Object.entries(bundle.storage || {}).forEach(([k, v]) => {
    if (!_isSettingsStorageKey(k) || typeof v !== 'string') return;
    localStorage.setItem(k, v);
    out.storage++;
  });
  if (typeof bundle.storage?.favoriteAnimations === 'string') {
    try {
      const fav = JSON.parse(bundle.storage.favoriteAnimations);
      if (Array.isArray(fav)) state.favoriteAnimations = fav;
    } catch (e) { /* leave the current list */ }
  }

  const sizes = bundle.placements && bundle.placements.sizes;
  if (sizes && typeof sizes === 'object') {
    const lib = readPlacementLibrary() || { version: 1, sizes: {} };
    Object.entries(sizes).forEach(([key, bucket]) => {
      if (!/^\d+x\d+$/.test(key) || !bucket || typeof bucket !== 'object') return;
      Object.entries(bucket).forEach(([role, geom]) => {
        if (!role || !geom || typeof geom.x !== 'number' || typeof geom.y !== 'number') return;
        if (!lib.sizes[key]) lib.sizes[key] = {};
        lib.sizes[key][role] = pickPlacementGeom(geom);
        out.placements++;
      });
    });
    if (out.placements) { lib.savedAt = Date.now(); _writePlacementLibrary(lib); }
  }

  if (bundle.baseProject && typeof bundle.baseProject.flowBase64 === 'string') {
    const blob = _base64ToBlob(bundle.baseProject.flowBase64);
    // A .flow is a zip; refuse anything else rather than store a base project
    // that would fail every New Project.
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    if (head[0] !== 0x50 || head[1] !== 0x4B) throw new Error('The base project in this settings file is damaged.');
    const meta = Object.assign({}, bundle.baseProject.meta || {}, { sizeBytes: blob.size });
    if (!meta.savedAt) meta.savedAt = Date.now();
    await _idbPut(DEFAULT_STARTUP_IDB_KEY, { blob, meta });
    _writeDefaultStartupMeta(meta);
    out.baseProject = true;
  }

  // A startup preference pointing at a base project this browser does not have
  // would send every new project down a path that can only fail.
  if (localStorage.getItem('adflow-startup-mode') === STARTUP_MODE_DEFAULT_PROJECT) {
    const info = await getDefaultStartupInfo();
    if (!info.exists) localStorage.setItem('adflow-startup-mode', 'fresh');
  }
  return out;
}
