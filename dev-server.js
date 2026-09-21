// ============================================================================
// Adflow local dev server — zero dependencies (Node built-ins only).
//
// Why this exists:
//   `python -m http.server` is a dumb static server: no file watching, and it
//   lets the browser cache scripts/*.js so edits appear stale (hence the manual
//   `?v=` bumps in index.html). This server fixes both:
//     1. Serves everything with no-store headers  -> never stale.
//     2. Watches source files and pushes a reload  -> live changes, no manual
//        refresh. Full-page reload (not HMR), which is exactly right for an app
//        built on ordered <script> tags and globals.
//
// No npm install required (works on the Google Drive path where npm fails).
// Run:  node dev-server.js [port]
// ============================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 8123);
const POLL_MS = 400;

// Directories/files to watch for changes (relative to ROOT).
const WATCH_DIRS = ['scripts', 'Startup', 'data', 'lib'];
const WATCH_ROOT_EXTS = new Set(['.html', '.css', '.js']);
const IGNORE_DIRS = new Set(['.git', '.claude', '_temp', 'node_modules']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.otf':  'font/otf',
  '.wasm': 'application/wasm',
  '.mp4':  'video/mp4',
  '.txt':  'text/plain; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
};

// Small client injected into every served HTML page. It opens an SSE stream and
// reloads the page whenever the server reports a file change.
const LIVERELOAD_CLIENT = `
<script>
(function () {
  try {
    var es = new EventSource('/__livereload');
    es.onmessage = function (e) { if (e.data === 'reload') location.reload(); };
    // EventSource auto-reconnects on error, so no manual retry needed.
  } catch (e) { /* live reload unavailable; app still works */ }
})();
</script>
`;

// ---- Live-reload plumbing --------------------------------------------------

const clients = new Set();

function broadcastReload() {
  for (const res of clients) {
    try { res.write('data: reload\n\n'); } catch (e) { /* dropped */ }
  }
}

// Snapshot of watched files -> mtimeMs. Rebuilt each poll so new/deleted files
// are detected too. Polling (not fs.watch) is deliberate: fs.watch is
// unreliable on the Google Drive virtual filesystem; mtime polling is not.
let snapshot = new Map();

function collectFiles() {
  const files = [];

  // Root-level html/css/js.
  for (const name of safeReaddir(ROOT)) {
    const ext = path.extname(name).toLowerCase();
    if (WATCH_ROOT_EXTS.has(ext)) files.push(path.join(ROOT, name));
  }

  // Watched subdirectories (recursive).
  for (const dir of WATCH_DIRS) {
    walk(path.join(ROOT, dir), files);
  }
  return files;
}

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return; }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (IGNORE_DIRS.has(ent.name)) continue;
      walk(path.join(dir, ent.name), out);
    } else {
      out.push(path.join(dir, ent.name));
    }
  }
}

function safeReaddir(dir) {
  try { return fs.readdirSync(dir); } catch (e) { return []; }
}

function takeSnapshot() {
  const map = new Map();
  for (const file of collectFiles()) {
    try { map.set(file, fs.statSync(file).mtimeMs); } catch (e) { /* gone */ }
  }
  return map;
}

function changed(a, b) {
  if (a.size !== b.size) return true;
  for (const [file, mtime] of b) {
    if (a.get(file) !== mtime) return true;
  }
  return false;
}

function startWatching() {
  snapshot = takeSnapshot();
  setInterval(() => {
    const next = takeSnapshot();
    if (changed(snapshot, next)) {
      snapshot = next;
      const stamp = new Date().toLocaleTimeString();
      console.log(`  [${stamp}] change detected -> reloading browser`);
      broadcastReload();
    }
  }, POLL_MS);
}

// ---- Static file server ----------------------------------------------------

const server = http.createServer((req, res) => {
  // Live-reload SSE endpoint.
  if (req.url === '/__livereload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    clients.add(res);
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (e) { /* dropped */ }
    }, 20000);
    req.on('close', () => { clearInterval(heartbeat); clients.delete(res); });
    return;
  }

  // Resolve the pathname (ignoring query string, e.g. the ?v= cache-busters).
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
  } catch (e) {
    res.writeHead(400); res.end('Bad request'); return;
  }
  if (pathname === '/') pathname = '/index.html';

  // Resolve to disk and guard against path traversal outside ROOT.
  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found: ' + pathname);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    // Never cache during dev — the whole point.
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-store, must-revalidate' };

    if (ext === '.html') {
      // Inject the live-reload client before </body> (fallback: append).
      fs.readFile(filePath, 'utf8', (rerr, html) => {
        if (rerr) { res.writeHead(500); res.end('Read error'); return; }
        const out = html.includes('</body>')
          ? html.replace('</body>', LIVERELOAD_CLIENT + '</body>')
          : html + LIVERELOAD_CLIENT;
        res.writeHead(200, headers);
        res.end(out);
      });
    } else {
      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
    }
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ERROR: port ${PORT} is already in use.`);
    console.error('  Another dev server is probably still running in another window.');
    console.error(`  Close it, or start on a different port:  node dev-server.js 8090\n`);
  } else {
    console.error('\n  Server error:', err.message, '\n');
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  RMIT Adflow - local dev server (live reload)');
  console.log(`  http://localhost:${PORT}/`);
  console.log('  Edits to scripts/, styles.css, *.html reload the browser automatically.');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
  startWatching();
});
