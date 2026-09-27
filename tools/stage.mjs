// `pnpm run stage`: serve the addon stage on :5182. The `run` is required, since pnpm owns `stage`
// as a subcommand of its own. This is the socket only; everything it decides is in stage-core.ts.
//
// It bundles once AFTER binding the port, so the bind is what makes two stage runs exclusive over
// the one shared `stage/stage.js`. Run `pnpm build:stage --watch` beside it to rebuild; an addon's
// `main.js` needs no rebuild since the page fetches it, and a NEW `stage.ts` needs a restart.

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildStage } from '../loader/build-stage.mjs';
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

/** No caching: every request is a person reloading to see a change they just made. */
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
 * Hand back what the deployed game answers, with only its content type: the other headers describe
 * a response from another origin under another policy.
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

/**
 * Start the server and resolve once it is accepting connections. Exported for `pnpm shots`, which
 * runs it in-process; it rejects rather than exiting so that caller can still close its browser.
 */
function serveStage(host = gameHost()) {
  const server = createServer((req, res) => {
    handle(req, res, host).catch((err) => {
      console.error('stage: request failed', err);
      res.writeHead(BAD_GATEWAY).end();
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      // The likely cause is the second run this bind exists to refuse, so name it.
      reject(
        new Error(
          `could not listen on ${STAGE_HOST}:${String(STAGE_PORT)}: ${err.message}. ` +
            'Another `pnpm run stage` or `pnpm shots` is probably already running.',
        ),
      );
    });
    server.listen(STAGE_PORT, STAGE_HOST, () => {
      resolve(server);
    });
  });
}

async function main() {
  const host = gameHost();
  const server = await serveStage(host);
  try {
    await buildStage();
  } catch (err) {
    server.close();
    throw err;
  }
  console.log(`stage: http://localhost:${String(STAGE_PORT)}/`);
  console.log(`stage: ${PROXY_PREFIXES.join(' and ')} proxied to ${host} for art and cues`);
  console.log('stage: press b on the page to hide the chrome before screenshotting');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`stage: ${err.message}`);
    process.exit(1);
  });
}

export { serveStage };
