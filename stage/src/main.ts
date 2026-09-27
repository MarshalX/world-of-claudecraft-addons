// The stage page: pick one addon, mount it over its scenario, screenshot it.
//
// `start()` is called by an entry `loader/build-stage.mjs` generates, carrying one
// import per `addons/*/stage.ts` (esbuild has no glob). The addon SOURCE is fetched
// over the dev server's marketplace path, so editing `main.js` needs only a reload.

import { LOADER_CSS } from '../../loader/src/runtime/ui/styles/index.ts';
import { type AddonChoice, BARE_CLASS, createPicker, type Selection, STATUS_ID } from './picker.ts';
import { buildSheet } from './sheet.ts';
import { type MountedStage, mountScenario, type ScenarioRegistry } from './stage.ts';

/** What the dev server answers with the addon list. Matches serve-core's index. */
const INDEX_PATH = '/index.json';
const STYLE_ID = 'woc-addons-style';

/**
 * The attribute `pnpm shots` waits on, written on the root element, so a capture waits
 * for a fact instead of a timeout. Always write `failed` on an error too, or the tool
 * reports a timeout instead of the reason the page already has.
 */
const STAGE_STATE = 'stage';

interface IndexRow {
  id: string;
  name: string;
  entry: string;
  path: string;
}

/**
 * Inject the loader's own stylesheet. Not through `ui/root.ts`, which also builds a root
 * that `createSharedServices` already builds, and two `#woc-addons` elements would split
 * the addon's drawing between them.
 */
function injectLoaderCss(doc: Document): void {
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = LOADER_CSS;
  doc.head.append(style);
}

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

/** The selection the URL asks for, so a bookmarked shot comes back to it. */
function readSelection(choices: readonly AddonChoice[]): Selection {
  const params = new URLSearchParams(globalThis.location.search);
  const [first] = choices;
  const addon = params.get('addon') ?? first?.id ?? '';
  const chosen = choices.find((choice) => choice.id === addon);
  const scenario = params.get('scenario') ?? chosen?.scenarios[0]?.id ?? '';
  return { addon, scenario };
}

/** Replace, not push, so flipping through scenarios does not fill the history. */
function writeSelection(selection: Selection): void {
  const params = new URLSearchParams(globalThis.location.search);
  params.set('addon', selection.addon);
  params.set('scenario', selection.scenario);
  globalThis.history.replaceState(null, '', `?${params.toString()}`);
}

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
 * Mount one selection. The previous stage is disposed FIRST and unconditionally, or a
 * failed load would leave the last addon's panels in the shot.
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

/**
 * Wait for fonts and images already in the document. `run` resolving means the addon was
 * TOLD everything, not that it has painted: icons are usually still loading then, and a
 * capture shows their slots collapsed, which does not look early.
 *
 * `decode`, not `load`, because it resolves when the image can PAINT. An image an addon
 * adds later off its own timer is not waited for.
 */
async function painted(doc: Document): Promise<void> {
  await doc.fonts.ready;
  const images = [...doc.querySelectorAll('#woc-addons img')];
  const decoded = images.map((img) => (img as HTMLImageElement).decode());
  // Every rejection swallowed: an ability the game ships no art for legitimately
  // 404s, and a slot hidden on error is the picture this wants.
  await Promise.all(decoded.map((one) => one.catch(() => undefined)));
}

/** What the page is holding: the addon on screen, and the swap still landing. */
interface PageState {
  mounted: MountedStage | null;
  pending: Promise<unknown>;
  /** The arrange mode, held on the page so every later mount inherits it. */
  arranging: boolean;
}

/**
 * Show one selection after whatever is in flight. Chained onto `pending` so two quick
 * picks cannot race and let the older one win.
 *
 * `catch` clears `mounted`: `swap` already disposed the previous stage, and keeping it
 * would dispose it twice on the next change.
 */
function applySelection(state: PageState, choice: AddonChoice, selection: Selection): void {
  const doc = globalThis.document;
  doc.documentElement.dataset[STAGE_STATE] = 'loading';
  state.pending = state.pending
    .then(async () => {
      state.mounted = await swap(state.mounted, choice, selection.scenario);
      state.mounted.stage.arrange(state.arranging);
      await painted(doc);
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
 * Draw one addon's preview sheet: no chrome and no addon in THIS document, each panel
 * an iframe running the ordinary stage. The loader stylesheet is deliberately not
 * injected, since nothing here is a loader surface.
 */
async function startSheet(doc: Document, registry: ScenarioRegistry, addon: string): Promise<void> {
  const panels = (registry.get(addon) ?? []).filter((scenario) => scenario.preview === true);
  if (panels.length === 0) {
    throw new Error(`${addon} has no scenario marked \`preview: true\``);
  }
  await buildSheet({ doc, addon, panels });
}

/**
 * Put a failure in the status element on either route, creating it on the sheet, which
 * has no chrome. `pnpm shots` reads this one selector whichever page it opened.
 */
function reportFailure(doc: Document, message: string): void {
  const status = doc.getElementById(STATUS_ID) ?? doc.createElement('div');
  status.id = STATUS_ID;
  status.textContent = message;
  if (!status.isConnected) {
    doc.body.append(status);
  }
}

async function run(registry: ScenarioRegistry): Promise<void> {
  const doc = globalThis.document;
  const params = new URLSearchParams(globalThis.location.search);
  if (params.get('sheet') === '1') {
    await startSheet(doc, registry, params.get('addon') ?? '');
    doc.documentElement.dataset[STAGE_STATE] = 'ready';
    return;
  }
  injectLoaderCss(doc);
  const choices = choicesFrom(await readIndex(), registry);
  const state: PageState = { mounted: null, pending: Promise.resolve(), arranging: false };

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

  const picker = createPicker({
    doc,
    addons: choices,
    onChange: showSelection,
    onArrange: (on) => {
      state.arranging = on;
      const { mounted } = state;
      if (mounted !== null) {
        mounted.stage.arrange(on);
      }
    },
  });
  doc.body.prepend(picker.el);
  // `?bare=1` is what a headless capture opens with, instead of scripting the key.
  if (params.get('bare') === '1') {
    doc.documentElement.classList.add(BARE_CLASS);
  }
  const initial = readSelection(choices);
  picker.show(initial);
  // Called directly: a synthetic change on the addon select would reset the scenario
  // to the first one and ignore the URL's.
  showSelection(initial);
}

/**
 * Bring the page up. Every startup failure is reported here, the one place that knows
 * how; a caller must not catch and rewrite `document.body`, which deletes the status.
 */
async function start(registry: ScenarioRegistry): Promise<void> {
  const doc = globalThis.document;
  try {
    await run(registry);
  } catch (err) {
    reportFailure(doc, reason(err));
    doc.documentElement.dataset[STAGE_STATE] = 'failed';
  }
}

export { start };
