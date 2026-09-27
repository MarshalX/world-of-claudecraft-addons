// `pnpm site:dev`: build the site, serve it, rebuild when an input changes. It runs the real
// build with `--offline`, and resolves routes directory-style exactly as GitHub Pages does.

import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'site', 'dist');
const PORT = 5181;
const HOST = '127.0.0.1';

/** Inputs worth rebuilding for. Not site/dist, which is the output. */
const WATCHED = [
  'site/assets',
  'site/content',
  'site/static',
  'tools/site',
  // Outside tools/site, but each changes what a page renders.
  'tools/site.mjs',
  'tools/catalog.ts',
  'tools/featured.ts',
  'screenshots',
  'addons',
];

/** Coalesce the burst of events an editor's save produces into one build. */
const DEBOUNCE_MS = 120;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

const LEADING_SEPARATORS = /^[/\\]+/;

const OK = 200;
const NOT_FOUND = 404;

let building = false;
let queued = false;

/** Run the real generator as a child, so a crash in it cannot take the server down. */
function build() {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  const child = spawn(process.execPath, [join(ROOT, 'tools', 'site.mjs'), '--offline'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  child.on('close', () => {
    building = false;
    if (queued) {
      queued = false;
      build();
    }
  });
}

/**
 * The file a request path maps to, or null if it escapes the output directory. A path with no
 * extension gets `/index.html`, as on Pages.
 */
function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const relative = normalize(decoded).replace(LEADING_SEPARATORS, '');
  const target = join(OUT, relative);
  if (!target.startsWith(OUT)) {
    return null;
  }
  if (extname(target) === '') {
    return join(target, 'index.html');
  }
  return target;
}

function send(response, status, body, type) {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(body);
}

function serve(request, response) {
  const file = resolveFile(request.url ?? '/');
  if (file === null || !existsSync(file) || !statSync(file).isFile()) {
    const notFound = join(OUT, '404.html');
    if (existsSync(notFound)) {
      response.writeHead(NOT_FOUND, {
        'content-type': TYPES['.html'],
        'cache-control': 'no-store',
      });
      createReadStream(notFound).pipe(response);
      return;
    }
    send(response, NOT_FOUND, `not found: ${request.url}\n`, TYPES['.txt']);
    return;
  }
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  response.writeHead(OK, { 'content-type': type, 'cache-control': 'no-store' });
  createReadStream(file).pipe(response);
}

function watchInputs() {
  let timer = null;
  for (const relative of WATCHED.filter((one) => existsSync(join(ROOT, one)))) {
    const dir = join(ROOT, relative);
    watch(dir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(build, DEBOUNCE_MS);
    });
  }
}

build();
watchInputs();
createServer(serve).listen(PORT, HOST, () => {
  console.log(`site:dev  http://${HOST}:${PORT}`);
});
