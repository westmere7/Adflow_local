// ============================================================================
// Auto-save (IndexedDB) + save-status indicator
// ============================================================================
// IndexedDB (not localStorage) so large projects with embedded image data URLs
// don't hit the ~5MB localStorage ceiling. A single record holds the latest
// working state; it's overwritten on a debounce after every change.
const AUTOSAVE_DB = 'adflow-autosave';
const AUTOSAVE_STORE = 'state';
const AUTOSAVE_KEY = 'current';

function _idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(AUTOSAVE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(AUTOSAVE_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function _idbPut(key, val) {
  const db = await _idbOpen();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(AUTOSAVE_STORE, 'readwrite');
      tx.objectStore(AUTOSAVE_STORE).put(val, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
async function _idbGet(key) {
  const db = await _idbOpen();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(AUTOSAVE_STORE, 'readonly');
      const r = tx.objectStore(AUTOSAVE_STORE).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally { db.close(); }
}

// Serializable snapshot of the working state — drops transient/edit-only fields and
// records the current scroll so a reload restores the user's exact view.
function buildStateSnapshot() {
  const snap = JSON.parse(JSON.stringify(state));
  // Strip transient/view-mode state so a reload always opens in normal editor mode.
  snap.editingElementId = null;
  snap.activeSmartGuides = null;
  snap.isDragging = false;
  snap.isPreviewMode = false;
  snap.singlePreviewId = null;
  snap.isolatedGroupId = null;
  snap.clipboard = null;
  delete snap.prePreviewZoom;
  delete snap.prePreviewScrollLeft;
  delete snap.prePreviewScrollTop;
  const ca = document.getElementById('canvas-area');
  if (ca) { snap.viewScrollLeft = ca.scrollLeft; snap.viewScrollTop = ca.scrollTop; }
  return snap;
}

let _localSaveStatus = 'saved'; // 'saved' | 'unsaved' | 'saving' | 'error'
let _fileSaveStatus = 'none';   // 'none' | 'saved' | 'unsaved'
let _lastLocalSaveTime = new Date();
let _lastFileSaveTime = null;
let _autosaveTimer = null;
let _autosaveSuspended = true;  // suppressed until the initial restore/render finishes

const localMap = {
  saved: {
    text: 'Saved',
    title: 'Changes saved locally to browser storage',
    class: 'status-saved',
    icon: `<svg class="save-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
             <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
             <path d="m9 13 2 2 4-4"></path>
           </svg>`
  },
  unsaved: {
    text: 'Unsaved',
    title: 'You have unsaved changes',
    class: 'status-unsaved',
    icon: `<svg class="save-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
             <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
             <circle cx="12" cy="13" r="1.5"></circle>
           </svg>`
  },
  saving: {
    text: 'Saving...',
    title: 'Saving changes to local browser storage...',
    class: 'status-saving',
    icon: `<svg class="save-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
             <line x1="12" y1="2" x2="12" y2="6"></line>
             <line x1="12" y1="18" x2="12" y2="22"></line>
             <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
             <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
             <line x1="2" y1="12" x2="6" y2="12"></line>
             <line x1="18" y1="12" x2="22" y2="12"></line>
             <line x1="6.83" y1="17.17" x2="4" y2="20"></line>
             <line x1="20" y1="4" x2="17.17" y2="6.83"></line>
           </svg>`
  },
  error: {
    text: 'Save Error',
    title: 'Failed to auto-save locally',
    class: 'status-error',
    icon: `<svg class="save-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
             <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
             <line x1="12" y1="9" x2="12" y2="13"></line>
             <line x1="12" y1="17" x2="12.01" y2="17"></line>
           </svg>`
  }
};

function _formatSaveTime(date) {
  if (!date) return 'Never';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function updateSaveStatusUI() {
  const barEl = document.getElementById('save-progress-bar');
  if (!barEl) return;

  // 1. Error state (takes priority)
  if (_localSaveStatus === 'error') {
    barEl.className = 'status-error';
  }
  // 2. Saving state
  else if (_localSaveStatus === 'saving') {
    barEl.className = 'status-saving';
  }
  // 3. Saved transition state
  else if (_localSaveStatus === 'saved') {
    if (barEl.classList.contains('status-saving')) {
      barEl.className = 'status-saved';
    } else {
      barEl.className = '';
    }
  }
  // 4. Default / Idle / Unsaved state
  else {
    barEl.className = '';
  }

  // Update the status dot next to the project name
  const dotEl = document.getElementById('project-save-status-dot');
  if (dotEl) {
    if (_localSaveStatus === 'error') {
      dotEl.className = 'status-error';
      dotEl.setAttribute('title', 'Save error');
    } else if (_localSaveStatus === 'saving') {
      dotEl.className = 'status-saving';
      dotEl.setAttribute('title', 'Saving changes...');
    } else if (_localSaveStatus === 'unsaved' || _fileSaveStatus === 'unsaved') {
      dotEl.className = 'status-unsaved';
      dotEl.setAttribute('title', 'Unsaved changes');
    } else {
      dotEl.className = '';
      dotEl.setAttribute('title', 'All changes saved');
    }
  }

  // Update the tooltip on the project-meta-container so the user can inspect detailed status on hover
  const containerEl = document.getElementById('project-meta-container');
  if (containerEl) {
    const localTime = _formatSaveTime(_lastLocalSaveTime);
    const fileTime = _lastFileSaveTime ? _formatSaveTime(_lastFileSaveTime) : 'Never';
    const localConfText = localMap[_localSaveStatus]?.text || 'Saved';
    const fileConfText = _fileSaveStatus === 'saved' ? 'Saved' : (_fileSaveStatus === 'unsaved' ? 'Out of Sync' : 'Not Saved');

    const title = `[Save Status]\n` +
                  `• Browser Auto-save: ${localConfText} (Last: ${localTime})\n` +
                  `• File (.flow): ${fileConfText} (Last: ${fileTime})\n\n` +
                  `Click to open project settings / Double-click to rename`;
    containerEl.setAttribute('title', title);
  }
}

function setLocalSaveStatus(status) {
  _localSaveStatus = status;
  if (status === 'saved') {
    _lastLocalSaveTime = new Date();
  }
  updateSaveStatusUI();
}

function setSaveStatus(status) {
  setLocalSaveStatus(status);
}


async function writeAutosave() {
  try {
    setLocalSaveStatus('saving');
    const limit = state.savedHistoryLimit !== undefined ? state.savedHistoryLimit : 50;
    const capped = getCappedHistory(limit);
    await _idbPut(AUTOSAVE_KEY, {
      savedAt: Date.now(),
      state: buildStateSnapshot(),
      history: capped.history,
      historyIndex: capped.historyIndex
    });
    setLocalSaveStatus('saved');
  } catch (e) {
    console.warn('Auto-save failed:', e);
    setLocalSaveStatus('error');
  }
}

function scheduleAutosave() {
  if (_autosaveSuspended) return;
  if (_localSaveStatus !== 'saving') setLocalSaveStatus('unsaved');

  if (_fileSaveStatus === 'saved') {
    _fileSaveStatus = 'unsaved';
    updateSaveStatusUI();
  }

  if (_autosaveTimer) clearTimeout(_autosaveTimer);
  const intervalSecs = state.autosaveInterval !== undefined ? state.autosaveInterval : 10;
  _autosaveTimer = setTimeout(writeAutosave, intervalSecs * 1000);
}

async function restoreAutosave() {
  try {
    const rec = await _idbGet(AUTOSAVE_KEY);
    if (rec && rec.state && Array.isArray(rec.state.canvases) && rec.state.canvases.length) {
      Object.assign(state, rec.state);
      // Autosaves written by older builds may reference the brand logo with the
      // wrong letter case (see normalizeBrandAssetCase in project-io.js).
      if (typeof normalizeBrandAssetCase === 'function') normalizeBrandAssetCase(state);
      if (!state.projectId) state.projectId = uid('proj_');
      // v0.16.8 migration — default jumped from 10 → 50. Bump projects
      // that were stuck on the old default (or never had the field).
      // User-customised values above 10 are preserved.
      if (state.savedHistoryLimit === undefined || state.savedHistoryLimit <= 10) {
        state.savedHistoryLimit = 50;
      }
      if (state.autosaveInterval === undefined) {
        state.autosaveInterval = 10;
      }
      if (state.zoomStep === undefined) {
        state.zoomStep = 0.1;
      }
      if (state.snapDistance === undefined) {
        state.snapDistance = 5;
      }
      if (state.showCanvasSizes === undefined) {
        state.showCanvasSizes = true;
      }
      if (state.canvasSpacing === undefined) {
        state.canvasSpacing = 60;
      }
      if (state.safezoneStandard === undefined) {
        state.safezoneStandard = 5;
      }
      if (state.safezoneNarrow === undefined) {
        state.safezoneNarrow = 8;
      }
      if (state.nudgeDefault === undefined) {
        state.nudgeDefault = 1;
      }
      if (state.nudgeShift === undefined) {
        state.nudgeShift = 10;
      }
      if (state.exportFormat === undefined) {
        state.exportFormat = 'png';
      }
      if (state.exportQuality === undefined) {
        state.exportQuality = 80;
      }
      if (state.subheadingAutoHide === undefined) {
        state.subheadingAutoHide = true;
      }
      if (state.defaultCricosCode === undefined) {
        state.defaultCricosCode = '00122A';
      }
      // Re-home legacy centre-anchored layouts onto the smaller board. If this
      // moved anything, the autosaved history snapshots still hold the old
      // off-board coords — drop them and re-baseline so undo can't jump back
      // into the void.
      const positionsMigrated = normalizeCanvasPositions();
      if (!positionsMigrated && rec.history && Array.isArray(rec.history) && rec.history.length > 0) {
        history.length = 0;
        history.push(...rec.history);
        historyIndex = rec.historyIndex !== undefined ? rec.historyIndex : history.length - 1;
      } else {
        history.length = 0;
        historyIndex = -1;
        pushHistory();
      }
      return true;
    }
  } catch (e) { console.warn('Auto-save restore failed:', e); }
  return false;
}

function undo() {
  // Commit any pending debounced push (nudges) so Ctrl+Z right after a nudge
  // undoes the nudge itself instead of the action before it.
  flushPendingHistory();
  if (historyIndex > 0) {
    historyIndex--;
    restoreSnapshot(history[historyIndex]);
  }
}

function redo() {
  flushPendingHistory();
  if (historyIndex < history.length - 1) {
    historyIndex++;
    restoreSnapshot(history[historyIndex]);
  }
}

function restoreSnapshot(snapStr) {
  _restoringHistory = true;
  try {
    const snap = JSON.parse(snapStr);
    state.canvases          = snap.canvases;
    state.activeCanvasId    = snap.activeCanvasId;
    state.selectedElementId = snap.selectedElementId;
    state.layerSelection    = snap.layerSelection || [];
    state.guides            = snap.guides         || [];
    state.linkGroups        = snap.linkGroups     || {};
    // Fields added in v0.16.8 — guard with `undefined` checks so older
    // snapshots (still in autosave from v0.16.7 and earlier) don't blank
    // out the live values.
    if (snap.frames        !== undefined) state.frames        = snap.frames;
    if (snap.activeFrameId !== undefined) state.activeFrameId = snap.activeFrameId;
    if (snap.dataMerge     !== undefined) state.dataMerge     = snap.dataMerge;
    if (snap.projectName   !== undefined) state.projectName   = snap.projectName;
    if (snap.clickTag      !== undefined) state.clickTag      = snap.clickTag;
    // NOTE: validationSettings / adSizeLimit are user PREFERENCES, not content.
    // They are no longer snapshotted (v0.20.4) and old snapshots' values are
    // deliberately ignored here — undo must never flip the user's settings.
    state.editingElementId = null;
    render();
    // Undo/redo bypasses pushHistory, so re-queue validation explicitly —
    // otherwise the canvases-list badges keep the pre-undo _valErrors.
    queueSizeUpdate();
  } finally {
    _restoringHistory = false;
  }
}

pushHistory();

