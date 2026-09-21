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
