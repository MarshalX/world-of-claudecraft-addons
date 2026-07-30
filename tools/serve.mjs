// Serve addons/ and the built userscript over http on :5180.
//
// Two roles on one socket: the loader's local dev marketplace, and the place a
// userscript manager installs the loader itself from. They are one server
// because they are one session: `pnpm dev` is somebody testing a loader change
// against real addons, and needing a second port for the half that changes least
// often is the kind of friction that ends in a stale userscript being debugged.
//
// The socket. Everything it decides lives in serve-core.ts, which a Vitest suite
// drives directly.
//
// Every response carries a strong ETag over its own bytes. That is what the
// loader's conditional GET polls: an unchanged addon body answers 304 with no
// payload, which is what makes a two-second hot-reload poll cost nothing. The
// userscript is served the same way, so a manager's update check on an unchanged
// build is a 304 rather than half a megabyte.

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { ROOT } from './manifests.ts';
import {
  buildIndex,
  contentType,
  etagFor,
  HOST,
  LOADER_PATH,
  PORT,
  resolveFile,
  resolveLoader,
} from './serve-core.ts';

const NOT_FOUND = 404;
const NOT_MODIFIED = 304;
const OK = 200;
const BAD_REQUEST = 400;
const NO_CONTENT = 204;

const JSON_TYPE = 'application/json; charset=utf-8';

/** Reply with a body the loader may cache, or 304 if it already has this one. */
function sendCacheable(req, res, body, type) {
  const etag = etagFor(body);
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(NOT_MODIFIED, { etag });
    res.end();
    return;
  }
  res.writeHead(OK, {
    etag,
    'content-type': type,
    'content-length': Buffer.byteLength(body),
    // The loader fetches through GM_xmlhttpRequest, which is not subject to
    // CORS. This is here for a browser tab opened straight at the server, which
    // is the ordinary way to check what it is serving.
    'access-control-allow-origin': '*',
    // The ETag is the whole freshness mechanism, so an intermediary caching by
    // age would hide exactly the change this server exists to publish.
    'cache-control': 'no-cache',
  });
  res.end(body);
}

/** One file, or the reason it is not there. */
async function sendFile(req, res, file, missing) {
  try {
    sendCacheable(req, res, await readFile(file), contentType(file));
  } catch {
    res.writeHead(NOT_FOUND).end(missing);
  }
}

function sendIndex(req, res) {
  const index = buildIndex((dir) => {
    console.warn(`serve: skipping ${dir}, its manifest is invalid (run "pnpm validate")`);
  });
  sendCacheable(req, res, `${JSON.stringify(index, null, 2)}\n`, JSON_TYPE);
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(NO_CONTENT, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'if-none-match',
    });
    res.end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(BAD_REQUEST).end('only GET is served\n');
    return;
  }

  const { pathname } = new URL(req.url, `http://${HOST}:${PORT}`);

  if (pathname === '/marketplace.json' || pathname === '/') {
    sendIndex(req, res);
    return;
  }

  const loader = resolveLoader(pathname);
  if (loader !== null) {
    // A named cause rather than a bare 404: the userscript is a build output, so
    // the ordinary way to reach this is a working tree that has never run the
    // build, and "not found" would send someone looking at the route instead.
    await sendFile(req, res, loader, 'the loader is not built yet: run "pnpm build"\n');
    return;
  }

  const file = resolveFile(pathname);
  if (file === null) {
    res
      .writeHead(NOT_FOUND)
      .end(`only /marketplace.json, ${LOADER_PATH} and addons/** are served\n`);
    return;
  }

  await sendFile(req, res, file, `no such file: ${pathname}\n`);
}

function main() {
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('serve: request failed', err);
      res.writeHead(NOT_FOUND).end();
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`serve: install the loader from http://localhost:${PORT}${LOADER_PATH}`);
    console.log(`serve: http://localhost:${PORT}/marketplace.json  (addons/ from ${ROOT})`);
    console.log('serve: turn the dev server on in the Addons manager Dev tab to install from it');
  });

  server.on('error', (err) => {
    console.error(`serve: could not listen on ${HOST}:${PORT}`, err.message);
    process.exit(1);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
