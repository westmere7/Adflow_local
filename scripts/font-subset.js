// ============================================================================
// Font subsetting for export — hb-subset.wasm (vendored in lib/, from the
// harfbuzzjs 0.4.6 npm package).
//
// Why: ad platforms (CM360, Google Ads, Adobe DSP) reject or don't document
// font files inside HTML5 zip bundles, and the full brand fonts cost ~75 KB
// of the 150 KB IAB budget. At export time each required font is subset to
// the characters the canvas actually renders (typically 60–90 glyphs, cutting
// fonts by 60–80%) and embedded as a base64 data URI in index.html, so the
// zip contains no font files at all.
//
// Integration contract (see export-pipeline.js):
//  - addCanvasAssetsToZip() AWAITS fontSubsetter.ensure(spec) for each spec —
//    this is the only async step, and it runs before generateExportHTML() in
//    every export/size-calc path.
//  - generateExportHTML() is sync; it calls fontSubsetter.peek(spec) and
//    embeds the cached data URI, falling back to the legacy .woff2 file URL
//    when the cache is cold (e.g. the full-preview iframes before any size
//    calc has run) or subsetting failed (then the .woff2 was zip-packed).
//  - Results are memoized on (font file, charset); during editing the charset
//    only changes when text changes, so the auto-compress solver's repeated
//    temp-zip builds are all cache hits.
// ============================================================================

// Returns [{ family, weight, base, woff2, otf, chars }] for every brand font
// face the canvas needs. The family/weight bucketing MUST stay in sync with
// getRequiredFonts() in export-pipeline.js.
function collectFontSubsetSpecs(c) {
  const FILES = {
    'Museo': { 300: 'Museo300-Regular', 500: 'Museo500-Regular', 700: 'Museo700-Regular' },
    'Helvetica Neue LT Pro': { 300: 'helveticaneueltpro_lt', 400: 'helveticaneueltpro_roman', 500: 'helveticaneueltpro' }
  };
  // Always-included safety glyphs: digits, punctuation and currency that
  // last-minute copy edits or data-merge values commonly introduce. Costs a
  // couple of KB, prevents tofu boxes in trafficked ads.
  const SAFETY = ' 0123456789.,:;!?\'"’‘“”()[]%&@*+-–—=/\\#$€£©®™…';

  const charsByKey = new Map(); // 'family|weight' -> Set of chars

  c.elements.forEach(el => {
    if (el.hidden) return;
    if (el.type !== 'text' && el.type !== 'button') return;
    const ff = el.fontFamily;
    if (!ff || !FILES[ff]) return;

    // Same weight bucketing as getRequiredFonts()
    let weight = 400;
    if (el.weight !== undefined && el.weight !== null && el.weight !== '') {
      weight = Number(el.weight);
    } else if (el.type === 'button') {
      weight = 600;
    }
    let bucket;
    if (ff === 'Museo') {
      bucket = weight <= 300 ? 300 : (weight >= 600 ? 700 : 500);
    } else {
      bucket = weight <= 300 ? 300 : (weight === 400 ? 400 : 500);
    }

    const ov = (typeof dmDisplay === 'function') ? dmDisplay(el) : {};
    const text = ov.text !== undefined ? ov.text : (el.text || '');

    const key = ff + '|' + bucket;
    let set = charsByKey.get(key);
    if (!set) { set = new Set(); charsByKey.set(key, set); }
    for (const ch of String(text)) {
      if (ch === '\n' || ch === '\r' || ch === '\t') continue;
      set.add(ch);
      // Case mirrors guard against CSS text-transform / case edits
      const up = ch.toUpperCase(), lo = ch.toLowerCase();
      if (up.length === 1) set.add(up);
      if (lo.length === 1) set.add(lo);
    }
    for (const ch of SAFETY) set.add(ch);
  });

  const specs = [];
  charsByKey.forEach((set, key) => {
    const sep = key.lastIndexOf('|');
    const family = key.slice(0, sep);
    const weight = parseInt(key.slice(sep + 1), 10);
    const base = FILES[family][weight];
    specs.push({
      family,
      weight,
      base,
      woff2: base + '.woff2',
      otf: base + '.otf',
      chars: Array.from(set).sort().join('')
    });
  });
  return specs;
}

const fontSubsetter = (() => {
  let wasmPromise = null;          // Promise<wasm exports>
  const sourceCache = new Map();   // otf filename -> Promise<ArrayBuffer>
  const done = new Map();          // cacheKey -> { dataUrl, kb }
  const pending = new Map();       // cacheKey -> Promise<entry|null>
  const lastKb = new Map();        // font base name -> last subset KB (for the size-breakdown UI)
  const MAX_DONE = 80;

  const keyOf = (spec) => spec.base + '|' + spec.chars;

  function loadWasm() {
    if (!wasmPromise) {
      wasmPromise = fetch('lib/hb-subset.wasm')
        .then(r => { if (!r.ok) throw new Error('hb-subset.wasm HTTP ' + r.status); return r.arrayBuffer(); })
        .then(buf => WebAssembly.instantiate(buf))
        .then(({ instance }) => instance.exports);
      wasmPromise.catch(() => { wasmPromise = null; }); // allow retry on next ensure()
    }
    return wasmPromise;
  }

  function loadSource(otfFile) {
    if (!sourceCache.has(otfFile)) {
      const p = fetch('data/fonts/' + otfFile)
        .then(r => { if (!r.ok) throw new Error(otfFile + ' HTTP ' + r.status); return r.arrayBuffer(); });
      p.catch(() => sourceCache.delete(otfFile));
      sourceCache.set(otfFile, p);
    }
    return sourceCache.get(otfFile);
  }

  // Raw hb-subset call. Synchronous once wasm + source bytes are in hand.
  function subsetBytes(hb, fontBytes, chars) {
    const fontPtr = hb.malloc(fontBytes.byteLength);
    new Uint8Array(hb.memory.buffer).set(new Uint8Array(fontBytes), fontPtr);

    const blob = hb.hb_blob_create(fontPtr, fontBytes.byteLength, 2 /*WRITABLE*/, 0, 0);
    const face = hb.hb_face_create(blob, 0);
    hb.hb_blob_destroy(blob);

    const input = hb.hb_subset_input_create_or_fail();
    const unicodeSet = hb.hb_subset_input_unicode_set(input);
    for (const ch of chars) hb.hb_set_add(unicodeSet, ch.codePointAt(0));

    const subset = hb.hb_subset_or_fail(face, input);
    hb.hb_subset_input_destroy(input);
    if (!subset) {
      hb.hb_face_destroy(face);
      hb.free(fontPtr);
      throw new Error('hb_subset_or_fail returned null');
    }

    const resultBlob = hb.hb_face_reference_blob(subset);
    const offset = hb.hb_blob_get_data(resultBlob, 0);
    const length = hb.hb_blob_get_length(resultBlob);
    let out = null;
    if (length > 0) {
      // Re-read memory.buffer — it may have grown (detached) during subsetting
      out = new Uint8Array(hb.memory.buffer).slice(offset, offset + length);
    }
    hb.hb_blob_destroy(resultBlob);
    hb.hb_face_destroy(subset);
    hb.hb_face_destroy(face);
    hb.free(fontPtr);
    if (!out) throw new Error('subset produced 0 bytes');
    return out;
  }

  function toDataUrl(bytes) {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return 'data:font/otf;base64,' + btoa(bin);
  }

  return {
    // Async: subset (or reuse) the font for this spec. Resolves to the cache
    // entry, or null on any failure (caller falls back to packing the .woff2).
    // Failures are not cached, so a later attempt can succeed.
    async ensure(spec) {
      const key = keyOf(spec);
      if (done.has(key)) return done.get(key);
      if (pending.has(key)) return pending.get(key);

      const p = (async () => {
        try {
          const [hb, src] = await Promise.all([loadWasm(), loadSource(spec.otf)]);
          const bytes = subsetBytes(hb, src, spec.chars);
          const entry = { dataUrl: toDataUrl(bytes), kb: bytes.length / 1024 };
          if (done.size >= MAX_DONE) {
            done.delete(done.keys().next().value); // evict oldest
          }
          done.set(key, entry);
          lastKb.set(spec.base, entry.kb);
          return entry;
        } catch (err) {
          console.warn('Font subset failed for', spec.base, '- falling back to full woff2:', err.message || err);
          return null;
        } finally {
          pending.delete(key);
        }
      })();
      pending.set(key, p);
      return p;
    },

    // Sync cache read for generateExportHTML(). Null = not subset (cold cache
    // or earlier failure) → emit the legacy .woff2 URL instead.
    peek(spec) {
      return done.get(keyOf(spec)) || null;
    },

    // Most recent subset size for a font (any charset) — feeds the
    // "Ad size breakdown" panel instead of its old hardcoded constants.
    lastKnownKb(base) {
      return lastKb.has(base) ? lastKb.get(base) : null;
    }
  };
})();
