// The stage page: pick one addon, mount it over its scenario, screenshot it.
//
// `start()` is called by an entry module `loader/build-stage.mjs` generates,
// which is what carries the scenario registry. Generated rather than committed
// because the registry is one import per `addons/*/stage.ts` and esbuild has no
// glob: a committed list would be a file every new addon has to remember to edit,
// and forgetting would look exactly like a scenario that does not work.
//
// The addon SOURCE is fetched over http rather than bundled, over the same
// marketplace path `tools/serve-core.ts` already serves. So editing `main.js` and
// reloading is the whole loop, with no rebuild, which is what makes this usable
// for working on an addon rather than only for photographing a finished one.

import { LOADER_CSS } from '../../loader/src/runtime/ui/styles/index.ts';
import { type AddonChoice, BARE_CLASS, createPicker, type Selection } from './picker.ts';
import { type MountedStage, mountScenario, type ScenarioRegistry } from './stage.ts';

/** What the dev server answers with the addon list. Matches serve-core's index. */
const INDEX_PATH = '/index.json';
const STYLE_ID = 'woc-addons-style';

/**
 * The attribute `pnpm shots` waits on, written on the root element.
 *
 * A capture has to wait for a FACT rather than for a timeout. Scenarios are
 * async and take genuinely different amounts of time: `combat-meter` waits out a
 * real 500ms repaint interval, `cooldown-bars` is done in a microtask. A capture
 * tool sleeping long enough for the slowest would still be guessing, and the way
 * guessing fails here is a photograph of a half-drawn panel that looks plausible.
 *
 * `failed` is written as well as `ready`, and that half matters more: without it
 * a scenario that threw would leave the attribute at `loading` forever and the
 * tool would report a timeout, which sends someone looking at the browser rather
 * than at the stack the page already has.
 */
const STAGE_STATE = 'stage';

interface IndexRow {
  id: string;
  name: string;
  entry: string;
  path: string;
}

/**
 * Inject the loader's own stylesheet.
 *
 * The real `ui/root.ts` does this in the game and is not used here: it also
 * builds the root, which `createSharedServices` builds for itself, and two
 * elements carrying `#woc-addons` would leave the addon drawing into whichever
 * one it happened to be handed. The sheet is the same string either way, so what
 * is on screen is what a player sees.
 */
function injectLoaderCss(doc: Document): void {
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = LOADER_CSS;
  doc.head.append(style);
}

/** The addon list the local marketplace is serving right now. */
async function readIndex(): Promise<IndexRow[]> {
  const response = await fetch(INDEX_PATH);
  if (!response.ok) {
    throw new Error(`${INDEX_PATH} answered ${String(response.status)}`);
  }
  const index = (await response.json()) as { addons?: IndexRow[] };
  return index.addons ?? [];
}

async function text(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${String(response.status)}`);
  }
  return await response.text();
}

/** What the URL asks for, which is what a bookmarked shot comes back to. */
function readSelection(choices: readonly AddonChoice[]): Selection {
  const params = new URLSearchParams(globalThis.location.search);
  const [first] = choices;
  const addon = params.get('addon') ?? first?.id ?? '';
  const chosen = choices.find((choice) => choice.id === addon);
  const scenario = params.get('scenario') ?? chosen?.scenarios[0]?.id ?? '';
  return { addon, scenario };
}

/**
 * Put the selection in the URL without adding a history entry.
 *
 * Replace rather than push: flipping through scenarios to find the one worth a
 * picture would otherwise leave a back button that walks the whole session.
 */
function writeSelection(selection: Selection): void {
  const params = new URLSearchParams(globalThis.location.search);
  params.set('addon', selection.addon);
  params.set('scenario', selection.scenario);
  globalThis.history.replaceState(null, '', `?${params.toString()}`);
}

/** Turn the served index and the bundled scenarios into one list. */
function choicesFrom(rows: readonly IndexRow[], registry: ScenarioRegistry): AddonChoice[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    scenarios: registry.get(row.id) ?? [],
  }));
}

function reason(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Mount one selection, replacing whatever was up.
 *
 * The previous stage is disposed FIRST and unconditionally. An addon's disposal
 * bag is what takes its frames off screen, so skipping it on the way to an addon
 * that then fails to load would leave the last one's panels in the shot.
 */
async function swap(
  current: MountedStage | null,
  choice: AddonChoice,
  id: string,
): Promise<MountedStage> {
  current?.dispose();
  const scenario = choice.scenarios.find((one) => one.id === id) ?? choice.scenarios[0];
  if (scenario === undefined) {
    throw new Error(`${choice.id} has no scenario: write addons/${choice.id}/stage.ts`);
  }
  const dir = `/addons/${choice.id}`;
  const manifest = await text(`${dir}/addon.json`);
  const { entry } = JSON.parse(manifest) as { entry: string };
  const source = await text(`${dir}/${entry}`);
  return await mountScenario({ id: choice.id, manifest, source, scenario });
}

/** What the page is holding: the addon on screen, and the swap still landing. */
interface PageState {
  mounted: MountedStage | null;
  pending: Promise<unknown>;
}

/**
 * Show one selection, after whatever is already in flight.
 *
 * Chained onto `pending` rather than awaited from the handler, because a picker
 * is faster than a fetch: choosing two addons quickly would otherwise have two
 * mounts in flight, and whichever finished last would win, which is not always
 * the one that was asked for last.
 *
 * `catch` clears `mounted` rather than leaving the failed stage in it. `swap`
 * disposes the previous one before it can throw, so on this path there is
 * genuinely nothing on screen, and remembering a stage that is gone would mean
 * disposing it twice on the next change.
 */
function applySelection(state: PageState, choice: AddonChoice, selection: Selection): void {
  const doc = globalThis.document;
  doc.documentElement.dataset[STAGE_STATE] = 'loading';
  state.pending = state.pending
    .then(async () => {
      state.mounted = await swap(state.mounted, choice, selection.scenario);
      // After the swap resolves rather than beside it: the scenario's own `run`
      // is awaited inside `mountScenario`, so this is the first moment the panel
      // on screen is the one the scenario describes.
      doc.documentElement.dataset[STAGE_STATE] = 'ready';
      return '';
    })
    .catch((err: unknown) => {
      state.mounted = null;
      doc.documentElement.dataset[STAGE_STATE] = 'failed';
      return reason(err);
    });
}

/**
 * Bring the page up.
 *
 * The first mount is driven by calling the same handler the picker calls, rather
 * than by dispatching a synthetic change at a `<select>`. Faking the event would
 * run the addon-select handler, which resets the scenario list to its first entry
 * and would quietly ignore the `scenario` the URL asked for.
 */
async function start(registry: ScenarioRegistry): Promise<void> {
  const doc = globalThis.document;
  injectLoaderCss(doc);
  const choices = choicesFrom(await readIndex(), registry);
  const state: PageState = { mounted: null, pending: Promise.resolve() };

  function showSelection(selection: Selection): void {
    writeSelection(selection);
    const choice = choices.find((one) => one.id === selection.addon);
    if (choice === undefined) {
      picker.status(`no addon called ${selection.addon}`, true);
      return;
    }
    picker.status(`loading ${choice.id}...`, false);
    applySelection(state, choice, selection);
    state.pending
      .then((message) => {
        picker.status(String(message), String(message).length > 0);
      })
      .catch(() => undefined);
  }

  const picker = createPicker({ doc, addons: choices, onChange: showSelection });
  doc.body.prepend(picker.el);
  // `?bare=1` is what a capture opens with. The key and the button are for a
  // person at the page; a headless run has neither, and navigating to a URL that
  // is already in the right state beats scripting a keystroke to get there.
  if (new URLSearchParams(globalThis.location.search).get('bare') === '1') {
    doc.documentElement.classList.add(BARE_CLASS);
  }
  const initial = readSelection(choices);
  picker.show(initial);
  showSelection(initial);
}

export { start };
