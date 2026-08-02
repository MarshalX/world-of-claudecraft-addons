// `pnpm stage`: serve the addon stage on :5182.
//
// One addon, mounted in a real browser through the real loader over a scripted
// fake world, so a preview screenshot does not need the state it pictures to be
// reachable by playing. See stage/src/stage.ts for why that is the hard part.
//
// The socket only. Everything it decides lives in stage-core.ts.
//
// Run `node loader/build-stage.mjs --watch` beside it (which `pnpm stage` does)
// and editing a scenario or a loader module rebuilds. Editing an addon's own
// `main.js` needs no rebuild at all, since the page fetches it. A NEW
// `addons/<id>/stage.ts` does need a restart, for the same reason the dev
// watcher polls bodies and not the index: discovering files on a timer is a
// rebuild per tick to report that nothing moved.

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { ROOT } from './manifests.ts';
import { buildIndex, contentType, resolveFile } from './serve-core.ts';
import {
  DEFAULT_GAME_HOST,
  INDEX_PATH,
  PROXY_PREFIXES,
  proxyTarget,
  resolveStage,
  STAGE_HOST,
  STAGE_PORT,
} from './stage-core.ts';

const NOT_FOUND = 404;
const BAD_GATEWAY = 502;
const OK = 200;
const JSON_TYPE = 'application/json; charset=utf-8';
const TRAILING_SLASH = /\/$/;

function gameHost() {
  const at = process.argv.indexOf('--host');
  if (at === -1) {
    return DEFAULT_GAME_HOST;
  }
  const given = process.argv[at + 1];
  if (given === undefined) {
    throw new Error('--host needs a value, e.g. --host https://worldofclaudecraft.com');
  }
  return given.replace(TRAILING_SLASH, '');
}

/**
 * No caching anywhere on this server.
 *
 * The opposite of serve.mjs, which is ETag-driven because the loader polls it.
 * Nothing polls this: every request is a person reloading to see a change they
 * just made, and a 304 there is the change appearing not to have happened.
 */
function send(res, body, type) {
  res.writeHead(OK, {
    'content-type': type,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function sendFile(res, file, type, missing) {
  try {
    send(res, await readFile(file), type);
  } catch {
    res.writeHead(NOT_FOUND).end(missing);
  }
}

/**
 * Hand back what the deployed game answers, headers stripped to the one that
 * matters.
 *
 * The upstream body is passed through verbatim; only the content type follows
 * it. Copying the rest would carry caching and security headers that describe a
 * response served from another origin under another policy.
 */
async function proxy(res, target) {
  const upstream = await fetch(target);
  if (!upstream.ok) {
    res.writeHead(upstream.status).end(`${target} answered ${String(upstream.status)}\n`);
    return;
  }
  const type = upstream.headers.get('content-type') ?? 'application/octet-stream';
  send(res, Buffer.from(await upstream.arrayBuffer()), type);
}

async function handle(req, res, host) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(NOT_FOUND).end('only GET is served\n');
    return;
  }
  const { pathname } = new URL(req.url, `http://${STAGE_HOST}:${String(STAGE_PORT)}`);

  if (pathname === INDEX_PATH) {
    send(res, `${JSON.stringify(buildIndex(), null, 2)}\n`, JSON_TYPE);
    return;
  }

  const stageFile = resolveStage(pathname);
  if (stageFile !== null) {
    const missing = 'the stage is not built: run "node loader/build-stage.mjs"\n';
    await sendFile(res, join(ROOT, stageFile.file), stageFile.type, missing);
    return;
  }

  const target = proxyTarget(pathname, host);
  if (target !== null) {
    await proxy(res, target);
    return;
  }

  const addonFile = resolveFile(pathname);
  if (addonFile === null) {
    res.writeHead(NOT_FOUND).end(`not served: ${pathname}\n`);
    return;
  }
  await sendFile(res, addonFile, contentType(addonFile), `no such file: ${pathname}\n`);
}

function main() {
  const host = gameHost();
  const server = createServer((req, res) => {
    handle(req, res, host).catch((err) => {
      console.error('stage: request failed', err);
      res.writeHead(BAD_GATEWAY).end();
    });
  });

  server.listen(STAGE_PORT, STAGE_HOST, () => {
    console.log(`stage: http://localhost:${String(STAGE_PORT)}/`);
    console.log(`stage: ${PROXY_PREFIXES.join(' and ')} proxied to ${host} for art and cues`);
    console.log('stage: press b on the page to hide the chrome before screenshotting');
  });

  server.on('error', (err) => {
    console.error(`stage: could not listen on ${STAGE_HOST}:${String(STAGE_PORT)}`, err.message);
    process.exit(1);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
