// `pnpm shots`: capture every addon's preview.png from its own stage scenario. Run by hand; the
// output is a committed artifact CI never regenerates.
//
// It refuses to guess three things. WHICH scenario: the ones marked `preview: true`, never position.
// WHEN the panel is done: `data-stage="ready"`, written once the scenario's `run` resolves, because
// a sleep fails as a plausible photograph of a half-drawn panel. WHAT the picture shows: `alt` is
// copied from the scenario verbatim and never generated.

import { execFile as execFileCb } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
// biome-ignore lint/correctness/noUnresolvedImports: playwright re-exports chromium from playwright-core through an exports map Biome's resolver does not follow; the named import is what the package documents and what runs.
import { chromium } from 'playwright';
import sharp from 'sharp';
import { buildStage } from '../loader/build-stage.mjs';
import { inSeries } from '../loader/src/shared/sequence.ts';
import { ADDONS_DIR, addonDirs, ROOT, readAddon } from './manifests.ts';
import {
  cropAround,
  fillsSlot,
  hostFor,
  largerScale,
  onlyFor,
  previewAlt,
  renderManifest,
  scaleFor,
  smallerScale,
  withinCap,
  withPreview,
} from './shots-core.ts';
import { serveStage } from './stage.mjs';
import { STAGE_HOST, STAGE_PORT } from './stage-core.ts';

const PREVIEW_FILE = 'preview.png';
const MANIFEST_FILE = 'addon.json';
const SCENARIO_FILE = 'stage.ts';
const READY_MS = 15_000;
const BYTES_PER_KB = 1024;

/** How long to look for a failed page's own reason before giving up on it. */
const STATUS_MS = 2000;

/** Where either stage route writes that reason. Matches stage/src/picker.ts. */
const STATUS_ID = 'stage-status';

/** The status at which a response is the server's fault rather than an answer. */
const SERVER_ERROR = 500;

/**
 * The window every capture is taken in: big enough that no default frame is clamped to fit. The
 * width is also a sheet's budget, and a pane past it is cropped at the right edge with no error.
 */
const VIEWPORT = { width: 1440, height: 1000 };

/**
 * Where the whole sheet landed, in CSS pixels. A string because it runs in the PAGE, and as a
 * function it would put `document` in a Node module's scope. Each pane is already cropped to its
 * own frames by `stage/src/sheet.ts`.
 */
const SHEET_RECT = `(() => {
  const el = document.getElementById('stage-sheet');
  if (el === null) { throw new Error('the sheet did not render'); }
  const rect = el.getBoundingClientRect();
  return [{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }];
})()`;

const BASE = `http://${STAGE_HOST}:${String(STAGE_PORT)}`;

const execFile = promisify(execFileCb);

function reason(err) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * The panels an addon is photographed as, left to right. With several, every panel needs a caption
 * to say they are configurations of one addon.
 */
async function previewPanels(dir) {
  const module = await import(join(ADDONS_DIR, dir, SCENARIO_FILE));
  const marked = (module.SCENARIOS ?? []).filter((one) => one.preview === true);
  if (marked.length === 0) {
    throw new Error('has no scenario marked `preview: true`');
  }
  for (const panel of marked) {
    if (typeof panel.alt !== 'string' || panel.alt.trim().length === 0) {
      throw new Error(`scenario "${panel.id}" needs an \`alt\` sentence describing its panel`);
    }
    if (marked.length > 1 && typeof panel.caption !== 'string') {
      throw new Error(`scenario "${panel.id}" needs a \`caption\`, since the preview has panels`);
    }
  }
  return marked;
}

/** Every addon with a scenario file, which is what can be captured at all. */
function capturable(only) {
  return addonDirs().filter((dir) => {
    if (only.length > 0 && !only.includes(dir)) {
      return false;
    }
    return existsSync(join(ADDONS_DIR, dir, SCENARIO_FILE));
  });
}

/**
 * Collect the requests that failed for a reason the GAME did not choose. A 404 is not one: the
 * game ships no art for some abilities and the kit hides that slot honestly. A transport failure or
 * a 5xx looks identical in the picture, so it stops the run.
 */
function watchForBrokenRequests(page) {
  const broken = [];
  page.on('requestfailed', (request) => {
    broken.push(`${request.url()} (${request.failure()?.errorText ?? 'request failed'})`);
  });
  page.on('response', (response) => {
    if (response.status() >= SERVER_ERROR) {
      broken.push(`${response.url()} (${String(response.status())})`);
    }
  });
  return broken;
}

/**
 * Load one addon's preview sheet and hand back where it landed, in CSS pixels. Always the sheet,
 * even for one panel, so there is one page and one crop.
 */
async function openSheet(page, dir) {
  await page.goto(`${BASE}/?addon=${dir}&sheet=1&bare=1`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('html[data-stage="ready"], html[data-stage="failed"]', {
    timeout: READY_MS,
  });
  if ((await page.getAttribute('html', 'data-stage')) === 'failed') {
    // Bounded and defaulted: a page that failed before writing its reason would otherwise turn
    // into a locator timeout.
    const said = await page
      .locator(`#${STATUS_ID}`)
      .textContent({ timeout: STATUS_MS })
      .catch(() => null);
    throw new Error(`scenario failed: ${said ?? 'no reason given'}`);
  }
  return await page.evaluate(SHEET_RECT);
}

/** One page at one scale, cropped to the frames and compressed. */
async function captureAt(job, scale) {
  const page = await job.browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: scale });
  const broken = watchForBrokenRequests(page);
  try {
    // No margin: every pane already carries its own.
    const crop = cropAround(await openSheet(page, job.dir), 0);
    // A failed icon leaves a COLLAPSED slot rather than a gap, so a broken preview would not look
    // broken; refuse before anything is written.
    if (broken.length > 0) {
      throw new Error(`could not load ${broken.join(', ')}`);
    }
    const shot = await page.screenshot({ clip: crop, type: 'png' });
    const png = await sharp(shot).png({ compressionLevel: 9, effort: 10 }).toBuffer();
    return { png, scale, crop };
  } finally {
    await page.close();
  }
}

/**
 * Step the scale UP until the shot fills the card slot, measured from what came back since a frame
 * sized by its content lays out differently at another scale. Stops at the largest scale.
 */
async function captureWide(job, scale) {
  const taken = await captureAt(job, scale);
  const larger = largerScale(scale);
  if (fillsSlot(taken.crop.width, scale) || larger === null) {
    return taken;
  }
  return await captureWide(job, larger);
}

/**
 * Step the scale DOWN until the shot fits what the manager will load in game.
 *
 * Runs after the width pass, never interleaved with it: the two pull opposite ways and one loop
 * doing both can oscillate. The byte cap is hard and the slot width a target, so this one wins.
 */
async function captureWithin(job, taken) {
  if (withinCap(taken.png.length)) {
    return taken;
  }
  const smaller = smallerScale(taken.scale);
  if (smaller === null) {
    throw new Error(`is ${String(taken.png.length)} bytes even at the smallest scale`);
  }
  const kb = String(Math.round(taken.png.length / BYTES_PER_KB));
  const next = String(smaller);
  console.warn(`shots: ${job.dir} was ${kb} kB at ${String(taken.scale)}x, retrying at ${next}x`);
  return await captureWithin(job, await captureAt(job, smaller));
}

/**
 * Write the preview into the manifest from the RAW parsed text, since the validated object carries
 * schema defaults. The path is handed back for Biome to format, or `JSON.stringify`'s one element
 * per line turns a one-line change into a whole-file diff.
 */
async function declarePreview(dir, alt) {
  const result = readAddon(dir);
  if (!result.ok) {
    throw new Error(`${MANIFEST_FILE} is invalid: ${JSON.stringify(result.issues)}`);
  }
  const path = join(ADDONS_DIR, dir, MANIFEST_FILE);
  const raw = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, renderManifest(withPreview(raw, alt, PREVIEW_FILE)));
  return path;
}

/** Hand the manifests this run touched to Biome, once at the end. */
async function formatManifests(paths) {
  if (paths.length === 0) {
    return;
  }
  const biome = join(ROOT, 'node_modules/.bin/biome');
  await execFile(biome, ['format', '--write', ...paths]);
}

/** One addon, end to end. */
async function capture(browser, dir) {
  const job = { browser, dir, panels: await previewPanels(dir) };
  // A first pass at 1x only to measure the frame's CSS width, which picks the scale.
  const measured = await captureAt(job, 1);
  const taken = await captureWithin(job, await captureWide(job, scaleFor(measured.crop.width)));

  await writeFile(join(ADDONS_DIR, dir, PREVIEW_FILE), taken.png);
  const manifest = await declarePreview(dir, previewAlt(job.panels));
  const devicePx = String(Math.round(taken.crop.width * taken.scale));
  const kb = String(Math.round(taken.png.length / BYTES_PER_KB));
  console.log(`shots: ${dir}  ${devicePx}px wide at ${String(taken.scale)}x, ${kb} kB`);
  return manifest;
}

async function main() {
  const dirs = capturable(onlyFor(process.argv));
  if (dirs.length === 0) {
    throw new Error('no addon has a stage.ts to photograph');
  }

  // Bind FIRST and bundle second: the bind is what makes two captures exclusive, and a build ahead
  // of it would rewrite the shared `stage/stage.js` under a run already serving it.
  const server = await serveStage(hostFor(process.argv));
  await buildStage();
  const browser = await chromium.launch();
  const failures = [];
  const written = [];
  try {
    // In series: every page reads one server over the working tree, and a failure should name
    // its addon.
    await inSeries(dirs, async (dir) => {
      try {
        written.push(await capture(browser, dir));
      } catch (err) {
        failures.push(`${dir}: ${reason(err)}`);
      }
    });
  } finally {
    await browser.close();
    server.close();
  }
  await formatManifests(written);

  if (failures.length > 0) {
    throw new Error(`${String(failures.length)} addon(s) failed:\n  ${failures.join('\n  ')}`);
  }
  console.log(`shots: wrote ${String(dirs.length)} preview(s)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`shots: ${reason(err)}`);
    process.exit(1);
  });
}
