// The stage's own chrome: pick an addon, pick a scenario, read what went wrong.
//
// Plain DOM rather than the preact the manager uses. The manager is a real UI
// that ships; this is a control strip on a developer's page, and pulling preact
// into the stage bundle to render two `<select>` elements would be the tail
// wagging the dog.
//
// It is deliberately NOT built from the loader kit either, even though the kit is
// right there. Everything the kit draws is a thing being photographed, so chrome
// wearing the same classes would be a second `.woc-window` in every shot and,
// worse, would make a kit regression look like part of the furniture.

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
/**
 * Where a failure is written, on EITHER route.
 *
 * Declared here because the picker builds one as part of its chrome, and shared
 * because `pnpm shots` reads one selector whichever page it opened.
 */
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

/** Says so in the list, so the 25 addons with no scenario yet are visible as a set. */
function scenarioSuffix(choice: AddonChoice): string {
  if (choice.scenarios.length === 0) {
    return ' (no scenario)';
  }
  return '';
}

/** The addon list, which never changes while the page is up. */
function fillAddons(doc: Document, el: HTMLSelectElement, addons: readonly AddonChoice[]): void {
  for (const addon of addons) {
    el.append(option(doc, addon.id, `${addon.name}${scenarioSuffix(addon)}`));
  }
}

/**
 * The scenario list for one addon.
 *
 * An addon with no scenario file gets one disabled entry saying so, rather than
 * an empty list. An empty `<select>` reads as a page that has not loaded yet,
 * which is the wrong thing to conclude from an addon nobody has written a
 * scenario for.
 */
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
 * Turn the loader's arrange mode on, which is the only way to pick a BARE frame up.
 *
 * The one control here that is not about the picture. A frameless overlay refuses
 * both gestures outside that mode (loader/src/runtime/ui/kit/frame-gestures.ts), and
 * the keybind that flips it lives in runtime/boot.ts, which the stage does not run:
 * without this, half the catalogue cannot be dragged on the stage at all.
 *
 * It survives a scenario change, because the state belongs to the page rather than
 * to the mount: a person arranging a panel and then switching scenario to see the
 * empty state has not asked to be locked out again.
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

/** Hide the chrome, which is the state a screenshot is taken in. */
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
 * Build the control strip.
 *
 * The two `<select>` elements are the whole interface on purpose. Everything else
 * a stage could offer (a viewport size, a theme, a zoom) is a thing the browser
 * window, `pnpm theme` and the browser's own zoom already do, and every one of
 * them would be a second place the shot's dimensions are decided.
 *
 * The two buttons are the exceptions and neither decides anything about the shot:
 * one hides this strip, and the other is the only route to a gesture the loader
 * otherwise refuses. See `arrangeToggle`.
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
