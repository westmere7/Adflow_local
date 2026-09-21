// ============================================================================
// electron/static-server.js — the tiny HTTP server the desktop app runs inside
// itself, so the pages load from a real http:// origin.
// ============================================================================
// WHY THIS EXISTS AT ALL
//   Electron can load pages from file://, but Adflow cannot run that way. Every
//   ad preview is an <iframe srcdoc> sandbox (8 files build them), and the
//   export path fetches assets and spawns a blob: Worker that importScripts()
//   the vendored JSZip. Under file:// those get opaque origins and the browser
//   blocks them — which is why export-pipeline.js already refuses to export PNGs
//   on file:// with an explanatory alert.
//
//   Serving the same files over http://127.0.0.1 gives the renderer exactly the
//   environment the app was written and tested against, so nothing has to be
//   rewritten for the desktop build. Chromium also treats 127.0.0.1 as a secure
//   context, which is what keeps showSaveFilePicker() and WebCodecs available.
//
// WHY THE PORT IS FIXED
//   IndexedDB and localStorage are keyed to the origin, and the origin includes
//   the port. A random port each launch would hand the user an empty workspace
//   every time — autosave, recents, the base project and remembered placements
//   all gone. So the port is pinned, and a fallback is reported loudly rather
//   than silently losing someone's work.
//
// This is a read-only file server bound to loopback: no directory listing, no
// writes, no upload, and nothing outside ROOT can be reached.
// ============================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');

// Arbitrary, deliberately uncommon, and well clear of the 8080 the Docker build
// uses so both can run side by side.
const PREFERRED_PORT = 47823;
const FALLBACK_ATTEMPTS = 8;

// Exactly the app's web surface, and nothing else. Without this the server would
// happily hand out package.json, electron/main.js and the whole of node_modules
// simply because they sit under the same root. Loopback-only makes that low risk
// rather than no risk, and an allow-list is easier to reason about than a
// deny-list that has to be remembered every time a file is added.
//
// Deliberately the same set as the `files` array in package.json's build config.
const SERVABLE_ROOTS = new Set([
  'index.html', 'preview.html', 'batch.html', 'styles.css',
  'scripts', 'lib', 'data', 'Startup'
]);

function isServable(relPath) {
  // relPath is already normalised and known to be inside ROOT.
  const top = relPath.split(path.sep)[0];
  return SERVABLE_ROOTS.has(top);
}

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
  '.flow': 'application/octet-stream',
  '.map':  'application/json; charset=utf-8'
};

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({
    'Content-Type': 'text/plain; charset=utf-8',
    // Nothing is cached: the files are on local disk, so there is no load to
    // save, and a stale cache after an app update is a real support problem.
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }, headers || {}));
  res.end(body);
}

function createStaticServer(root) {
  return http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    } catch (e) {
      return send(res, 400, 'Bad request');
    }
    if (pathname === '/') pathname = '/index.html';

    // Resolve, then confirm the result is still inside ROOT. This is what stops
    // `..` segments and absolute paths from escaping the app folder.
    const filePath = path.resolve(root, '.' + pathname);
    const rel = path.relative(root, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !isServable(rel)) {
      return send(res, 403, 'Forbidden');
    }

    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, 'Not found');

      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': st.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      const stream = fs.createReadStream(filePath);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    });
  });
}

// Resolves { port, usedFallback }. Binds to 127.0.0.1 only, so the app is never
// reachable from the network even by accident.
function startStaticServer(root) {
  const server = createStaticServer(root);

  return new Promise((resolve, reject) => {
    let attempt = 0;

    const tryPort = (port) => {
      const onError = (err) => {
        if (err && err.code === 'EADDRINUSE' && attempt < FALLBACK_ATTEMPTS) {
          attempt++;
          server.removeListener('error', onError);
          tryPort(PREFERRED_PORT + attempt);
          return;
        }
        reject(err);
      };
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        resolve({
          server,
          port: server.address().port,
          usedFallback: port !== PREFERRED_PORT
        });
      });
    };

    tryPort(PREFERRED_PORT);
  });
}

module.exports = { startStaticServer, PREFERRED_PORT };
