#!/usr/bin/env node
// Scans data/assets/ and writes data/assets/manifest.json with every image
// filename it finds. The app reads this manifest to populate the RMIT folder
// in the Assets panel. Runs at deploy time (Dockerfile build stage, vercel.json
// buildCommand, run-server.bat); can also be run locally before committing assets.

const fs = require('fs');
const path = require('path');

const ASSET_DIR = path.join(__dirname, '..', 'data', 'assets');
const MANIFEST = path.join(ASSET_DIR, 'manifest.json');
const EXT = /\.(jpe?g|png|gif|svg|webp)$/i;

let files = [];
try {
  files = fs.readdirSync(ASSET_DIR)
    .filter(name => EXT.test(name))
    .filter(name => {
      try { return fs.statSync(path.join(ASSET_DIR, name)).isFile(); }
      catch { return false; }
    })
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
} catch (err) {
  console.error('[build-asset-manifest] cannot read', ASSET_DIR, '-', err.message);
  process.exit(0);
}

fs.writeFileSync(MANIFEST, JSON.stringify(files, null, 2) + '\n');
console.log(`[build-asset-manifest] wrote ${files.length} file(s) -> ${path.relative(process.cwd(), MANIFEST)}`);
