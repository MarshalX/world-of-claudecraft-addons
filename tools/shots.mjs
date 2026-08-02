// `pnpm shots`: capture every addon's preview.png from its own stage scenario.
//
// Run by hand, like `pnpm cues`, `pnpm icons`, `pnpm items` and `pnpm theme`. The
// output is a committed artifact and CI never regenerates it, which is why this
// drives a browser without apology: nothing about it has to work anywhere but on
// the machine of somebody who is looking at the result.
//
// It retires the sentence in ADDON-ROADMAP.md saying a screenshot is added later,
// by hand, from a real session, because the state worth photographing could not
// be summoned on demand. On the stage it can: a scenario states the world and the
// addon draws it.
//
// THREE THINGS IT REFUSES TO GUESS.
//
// WHICH SCENARIO. Exactly one per addon carries `preview: true`. None or two is
// an error rather than a choice, because the alternative is position deciding,
// and `idle` is first in more than one file.
//
// WHEN THE PANEL IS DONE. It waits for `data-stage="ready"` on the root element,
// which the page writes once the scenario's own `run` has resolved. Scenarios
// take genuinely different times (`combat-meter` waits out a real 500ms repaint
// interval), and a sleep long enough for the slowest is still a guess whose
// failure mode is a plausible photograph of a half-drawn panel.
//
// WHAT THE PICTURE SHOWS. `alt` comes off the scenario and is written into
// `addon.json` verbatim. It is never generated: it is the sentence a screen
// reader reads instead of the image, and inventing one is worse than having none,
// which is why `pnpm validate` only checks a preview somebody declared.

import { execFile as execFileCb } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
// biome-ignore lint/correctness/noUnresolvedImports: playwright re-exports chromium from playwright-core through an exports map Biome's resolver does not follow. The named import is what the package documents and what runs: `chromium.launch()` is verified working above.
import { chromium } from 'playwright';
import sharp from 'sharp';
import { inSeries } from '../loader/src/shared/sequence.ts';
import { ADDONS_DIR, addonDirs, ROOT, readAddon } from './manifests.ts';
import {
  cropAround,
  fillsSlot,
  largerScale,
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

/**
 * The window every capture is taken in.
 *
 * Big enough that no addon's default frame is clamped to fit, since a clamped
 * frame is a picture of the viewport rather than of the addon. Nothing about
 * these numbers reaches the output: the crop is taken from the frame.
 */
const VIEWPORT = { width: 1440, height: 1000 };

/**
 * Where every frame the scenario drew sits, in CSS pixels.
 *
 * A string rather than a function, because it runs in the PAGE and this file is
 * a Node module: written as a function it would put `document` in a scope that
 * has no DOM, which reads as a mistake to everything that lints this tree.
 * Zero-width frames are dropped, since a hidden frame is still in the document.
 */
const FRAME_RECTS = `[...document.querySelectorAll('#woc-addons .woc-addon-frame')]
  .map((el) => el.getBoundingClientRect())
  .filter((rect) => rect.width > 0 && rect.height > 0)
  .map((rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }))`;

const BASE = `http://${STAGE_HOST}:${String(STAGE_PORT)}`;

const execFile = promisify(execFileCb);

function reason(err) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/** The scenario an addon is photographed from, or the reason there is not one. */
async function previewScenario(dir) {
  const module = await import(join(ADDONS_DIR, dir, SCENARIO_FILE));
  const marked = (module.SCENARIOS ?? []).filter((one) => one.preview === true);
  if (marked.length !== 1) {
    throw new Error(
      `has ${String(marked.length)} scenarios marked \`preview: true\`, needs exactly 1`,
    );
  }
  const [scenario] = marked;
  if (typeof scenario.alt !== 'string' || scenario.alt.trim().length === 0) {
    throw new Error(`scenario "${scenario.id}" needs an \`alt\` sentence describing the shot`);
  }
  return scenario;
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

/** Load one scenario and hand back where its frames landed, in CSS pixels. */
async function openScenario(page, dir, scenario) {
  await page.goto(`${BASE}/?addon=${dir}&scenario=${scenario.id}&bare=1`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('html[data-stage="ready"], html[data-stage="failed"]', {
    timeout: READY_MS,
  });
  if ((await page.getAttribute('html', 'data-stage')) === 'failed') {
    // The page already holds the reason, in the line the picker writes.
    throw new Error(`scenario failed: ${(await page.textContent('#stage-status')) ?? 'no reason'}`);
  }
  return await page.evaluate(FRAME_RECTS);
}

/**
 * One page at one scale, cropped to the frames and compressed.
 *
 * `job` bundles what every step below needs unchanged (the browser, the addon and
 * its scenario), so the two recursive passes carry one parameter each rather than
 * threading three through calls that only forward them.
 */
async function captureAt(job, scale) {
  const page = await job.browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: scale });
  try {
    const crop = cropAround(await openScenario(page, job.dir, job.scenario));
    const shot = await page.screenshot({ clip: crop, type: 'png' });
    const png = await sharp(shot).png({ compressionLevel: 9, effort: 10 }).toBuffer();
    return { png, scale, crop };
  } finally {
    await page.close();
  }
}

/**
 * Step the scale UP until the shot fills the card slot it will be shown in.
 *
 * Measured from what came back rather than from the 1x probe, because a frame
 * sized by its own content lays out slightly differently at another scale factor
 * and the prediction can undershoot. Stops at the largest scale, which is the
 * honest end of the road: an addon whose panel is genuinely tiny cannot be made
 * to fill a 700px slot without inventing pixels.
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
 * After the width pass, never interleaved with it: growing for width and
 * shrinking for bytes pull opposite ways, and a single loop doing both can
 * oscillate. The byte cap is a hard limit and the slot width is a target, so this
 * one wins where they disagree.
 *
 * Recursive rather than a loop: it steps at most twice, and `noAwaitInLoops` is
 * right that a loop of awaits usually means serialized work that need not be.
 * Downscaling beats quantising, because a palette PNG bands the panel's own
 * gradient, which is the one part of the picture the loader did not draw.
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
 * Write the preview into the manifest, leaving every other key where it was.
 *
 * Validated first and then written from the RAW parsed text, never from what
 * validation returned: a schema applies defaults, so writing the validated object
 * back would add every optional field this manifest chose to leave out.
 *
 * The path is handed back so the caller can format it. `JSON.stringify` puts one
 * array element per line and Biome keeps a short array inline, so writing without
 * that pass turns a one-line alt-text change into a whole-file diff.
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

/**
 * Hand the manifests this run touched to Biome, which is the formatter of record.
 *
 * Once at the end rather than per addon: it is a process launch, and the shape of
 * the file does not depend on which order they were written in.
 */
async function formatManifests(paths) {
  if (paths.length === 0) {
    return;
  }
  const biome = join(ROOT, 'node_modules/.bin/biome');
  await execFile(biome, ['format', '--write', ...paths]);
}

/** One addon, end to end. */
async function capture(browser, dir) {
  const job = { browser, dir, scenario: await previewScenario(dir) };
  // A first pass at 1x only to measure: the scale a capture wants is chosen from
  // the frame's CSS width, and the width is not knowable until it has been drawn.
  const measured = await captureAt(job, 1);
  const taken = await captureWithin(job, await captureWide(job, scaleFor(measured.crop.width)));

  await writeFile(join(ADDONS_DIR, dir, PREVIEW_FILE), taken.png);
  const manifest = await declarePreview(dir, job.scenario.alt);
  const devicePx = String(Math.round(taken.crop.width * taken.scale));
  const kb = String(Math.round(taken.png.length / BYTES_PER_KB));
  console.log(`shots: ${dir}  ${devicePx}px wide at ${String(taken.scale)}x, ${kb} kB`);
  return manifest;
}

async function main() {
  const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const dirs = capturable(only);
  if (dirs.length === 0) {
    throw new Error('no addon has a stage.ts to photograph');
  }

  // Its own server rather than a second terminal. The whole run is one command
  // somebody types a few times a year, and "start the stage first" is a step that
  // fails as a connection refused three layers down inside Playwright.
  const server = await serveStage();
  const browser = await chromium.launch();
  const failures = [];
  const written = [];
  try {
    // In series on purpose: every page reads one dev server over the working
    // tree, and a failure that names the addon it happened on beats a heap.
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
