// The stage's own chrome: pick an addon, pick a scenario, read what went wrong.
//
// Plain DOM, deliberately NOT the loader kit: kit classes here would put a second
// `.woc-window` in every shot and make a kit regression look like furniture.

import type { Scenario } from './stage.ts';

/** One addon the stage can show, and what it can be shown doing. */
interface AddonChoice {
  id: string;
  name: string;
  scenarios: readonly Scenario[];
}

/** What the page is showing, which is also what the URL says. */
interface Selection {
  addon: string;
  scenario: string;
}

interface PickerDeps {
  doc: Document;
  addons: readonly AddonChoice[];
  onChange: (selection: Selection) => void;
  /** Hand the arrange mode to whatever is mounted now. See `arrangeToggle`. */
  onArrange: (on: boolean) => void;
}

interface Picker {
  el: HTMLElement;
  /** Redraw the scenario list and both selected values for a new selection. */
  show: (selection: Selection) => void;
  /** Say what happened. An empty message clears the line. */
  status: (message: string, failed: boolean) => void;
}

const BAR_ID = 'stage-bar';
/** Where a failure is written on EITHER route; `pnpm shots` reads this one selector. */
const STATUS_ID = 'stage-status';
/** On the document while the chrome is hidden, so a shot has only the addon in it. */
const BARE_CLASS = 'stage-bare';

function option(doc: Document, value: string, label: string): HTMLOptionElement {
  const el = doc.createElement('option');
  el.value = value;
  el.textContent = label;
  return el;
}

function select(doc: Document, label: string): [HTMLLabelElement, HTMLSelectElement] {
  const wrap = doc.createElement('label');
  wrap.className = 'stage-field';
  const text = doc.createElement('span');
  text.textContent = label;
  const el = doc.createElement('select');
  wrap.append(text, el);
  return [wrap, el];
}

/** Marks an addon with no scenario yet in the list. */
function scenarioSuffix(choice: AddonChoice): string {
  if (choice.scenarios.length === 0) {
    return ' (no scenario)';
  }
  return '';
}

function fillAddons(doc: Document, el: HTMLSelectElement, addons: readonly AddonChoice[]): void {
  for (const addon of addons) {
    el.append(option(doc, addon.id, `${addon.name}${scenarioSuffix(addon)}`));
  }
}

/** An addon with no scenario gets one disabled entry, since an empty list reads as loading. */
function fillScenarios(doc: Document, el: HTMLSelectElement, choice: AddonChoice | null): void {
  el.replaceChildren();
  if (choice === null || choice.scenarios.length === 0) {
    const none = option(doc, '', 'nothing to show yet');
    none.disabled = true;
    el.append(none);
    return;
  }
  for (const scenario of choice.scenarios) {
    el.append(option(doc, scenario.id, scenario.label));
  }
}

/**
 * Toggle the loader's arrange mode, the only way to move a BARE frame. The keybind for it
 * lives in runtime/boot.ts, which the stage does not run.
 */
function arrangeToggle(doc: Document, deps: PickerDeps): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'stage-btn';
  let on = false;
  const label = (): void => {
    button.textContent = 'Unlock frames';
    if (on) {
      button.textContent = 'Frames unlocked';
    }
    button.setAttribute('aria-pressed', String(on));
  };
  label();
  button.addEventListener('click', () => {
    on = !on;
    deps.onArrange(on);
    label();
  });
  return button;
}

/** Hide the chrome, the state a screenshot is taken in. */
function bareToggle(doc: Document): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'stage-btn';
  button.textContent = 'Hide chrome (b)';
  button.addEventListener('click', () => {
    doc.documentElement.classList.toggle(BARE_CLASS);
  });
  return button;
}

/**
 * Build the control strip. Nothing here may decide a shot's dimensions (viewport, theme,
 * zoom): the browser and `pnpm theme` already own those.
 */
function createPicker(deps: PickerDeps): Picker {
  const { doc } = deps;
  const el = doc.createElement('div');
  el.id = BAR_ID;
  const [addonField, addonEl] = select(doc, 'Addon');
  const [scenarioField, scenarioEl] = select(doc, 'Scenario');
  const statusEl = doc.createElement('span');
  statusEl.id = STATUS_ID;
  el.append(addonField, scenarioField, arrangeToggle(doc, deps), bareToggle(doc), statusEl);
  fillAddons(doc, addonEl, deps.addons);

  const choiceOf = (id: string): AddonChoice | null =>
    deps.addons.find((addon) => addon.id === id) ?? null;
  const announce = (): void => {
    deps.onChange({ addon: addonEl.value, scenario: scenarioEl.value });
  };

  addonEl.addEventListener('change', () => {
    fillScenarios(doc, scenarioEl, choiceOf(addonEl.value));
    announce();
  });
  scenarioEl.addEventListener('change', announce);
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'b' && doc.activeElement === doc.body) {
      doc.documentElement.classList.toggle(BARE_CLASS);
    }
  });

  return {
    el,
    show: (selection) => {
      addonEl.value = selection.addon;
      fillScenarios(doc, scenarioEl, choiceOf(selection.addon));
      scenarioEl.value = selection.scenario;
    },
    status: (message, failed) => {
      statusEl.textContent = message;
      statusEl.classList.toggle('stage-failed', failed);
    },
  };
}

export type { AddonChoice, Picker, Selection };
export { BARE_CLASS, createPicker, STATUS_ID };
