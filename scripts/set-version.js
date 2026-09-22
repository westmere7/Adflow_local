#!/usr/bin/env node
/* eslint-disable no-console */
// ============================================================================
// RMIT Adflow — version propagation
// ----------------------------------------------------------------------------
// `data/version.txt` is the single source of truth. The app reads it at runtime
// (app-boot.js polls it; the About box shows it), but several other places carry
// the same number and used to be updated by hand:
//
//   package.json            drives the Electron build's name and exe metadata
//   index/preview/batch     the ?v= pin on every script and stylesheet
//   app-boot.js             APP_VERSION_FALLBACK, and the two placeholders in
//                           index.html shown until the first fetch resolves
//   README.md               the version badge
//
// Hand-updating those is how the number drifts — and a missed ?v= pin is worse
// than cosmetic: nginx caches JS and CSS for an hour, so a Docker deploy can
// serve users new HTML against stale code. The desktop build sends no-store and
// is immune, which is exactly why the drift goes unnoticed until it ships.
//
//   node scripts/set-version.js 0.62.0   set everywhere (also writes version.txt)
//   node scripts/set-version.js          propagate whatever version.txt says
//   node scripts/set-version.js --check  verify only; non-zero exit on drift
//
// --check runs in `npm run prebuild` and in the Docker image build, so neither
// deployment can be produced from an inconsistent tree.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const p = (f) => path.join(ROOT, f);

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const explicit = args.find((a) => !a.startsWith('--'));

// ---- Resolve the target version --------------------------------------------
const versionFile = p('data/version.txt');
let version = explicit || fs.readFileSync(versionFile, 'utf8').trim();
version = version.replace(/^v/, '');

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`[set-version] Not a version: "${version}" (expected X.Y.Z)`);
  process.exit(1);
}
const vTag = 'v' + version;

// ---- The places the number has to reach ------------------------------------
// Each rule finds every occurrence and reports what it expected, so --check can
// name the file and the stale value rather than just failing.
const rules = [
  {
    file: 'data/version.txt',
    // The trailing newline sits outside the match, so a correct file rewrites identically.
    find: /^[^\S\r\n]*v?\d+\.\d+\.\d+[^\S\r\n]*/,
    to: vTag,
    label: 'version.txt',
  },
  {
    file: 'package.json',
    find: /("version"\s*:\s*")\d+\.\d+\.\d+(")/,
    to: `$1${version}$2`,
    label: 'package.json version',
  },
  ...['index.html', 'preview.html', 'batch.html'].map((f) => ({
    file: f,
    find: /\?v=\d+\.\d+\.\d+/g,
    to: `?v=${version}`,
    label: `${f} ?v= pins`,
  })),
  {
    file: 'scripts/app-boot.js',
    find: /(APP_VERSION_FALLBACK\s*=\s*')v\d+\.\d+\.\d+(')/,
    to: `$1${vTag}$2`,
    label: 'runtime fallback',
  },
  // The two literals in index.html are placeholders shown until the first fetch
  // of version.txt resolves. Both patterns are anchored to their own attribute so
  // the historical version numbers in nearby HTML comments are left alone.
  {
    file: 'index.html',
    find: /(class="app-splash-version">)v\d+\.\d+\.\d+(<)/,
    to: `$1${vTag}$2`,
    label: 'splash badge placeholder',
  },
  {
    file: 'index.html',
    find: /(id="app-version-display"[^>]*>)v\d+\.\d+\.\d+(<)/,
    to: `$1${vTag}$2`,
    label: 'footer version placeholder',
  },
  {
    file: 'README.md',
    find: /(badge\/version-)v\d+\.\d+\.\d+/,
    to: `$1${vTag}`,
    label: 'README version badge',
  },
];

let drift = 0;
let changed = 0;

for (const r of rules) {
  const file = p(r.file);
  if (!fs.existsSync(file)) {
    // Not an error: .dockerignore keeps package.json out of the image build,
    // and package.json only governs the desktop build, which checks it in
    // `npm run prebuild`. Absent from this context means not applicable here.
    console.log(`[set-version] skip   ${r.label} — ${r.file} not in this build context`);
    continue;
  }
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(r.find, r.to);

  if (before === after) continue;

  if (checkOnly) {
    drift++;
    // Name the number at the match site. Reading the first version-looking
    // number in the file instead would report an already-corrected one.
    const hit = before.match(r.find);
    const stale = hit ? ((String(hit[0]).match(/[0-9]+.[0-9]+.[0-9]+/) || ['?'])[0]) : '?';
    console.error(`[set-version] DRIFT  ${r.label} (${r.file}) — has ${stale}, expected ${version}`);
  } else {
    // Writing the same string back preserves CRLF; we never normalise.
    fs.writeFileSync(file, after);
    changed++;
    console.log(`[set-version] set    ${r.label} -> ${vTag}`);
  }
}

// ---- Advisory: the changelog is written by a human, so warn, never fail ------
for (const [file, re] of [
  ['data/changelog.txt', /v(\d+\.\d+\.\d+)\s*\(Current\)/],
  ['scripts/docs-content.js', /CHANGELOG_DATA\s*=\s*\[\s*\{\s*version:\s*'v(\d+\.\d+\.\d+)'/],
]) {
  const m = fs.readFileSync(p(file), 'utf8').match(re);
  if (m && m[1] !== version) {
    console.warn(`[set-version] note   ${file} newest entry is v${m[1]}, not ${vTag} — add the release notes by hand.`);
  }
}

if (checkOnly) {
  if (drift) {
    console.error(`\n[set-version] ${drift} file(s) out of sync with data/version.txt (${vTag}).`);
    console.error(`[set-version] Fix with:  node scripts/set-version.js\n`);
    process.exit(1);
  }
  console.log(`[set-version] OK — every version reference matches ${vTag}`);
} else {
  console.log(`[set-version] ${changed === 0 ? 'Already consistent' : changed + ' file(s) updated'} at ${vTag}`);
}
