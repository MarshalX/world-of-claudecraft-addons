// @vitest-environment happy-dom

// One shape, two renderers, checked on both sides.
//
// A labelled control exists twice in this loader and has to: the kit builds it as
// plain DOM for addons, the manager builds it as preact, and neither can call the
// other. They were agreeing by accident and had drifted, with Browse and
// Marketplaces writing a wrapping label with no `for` while the settings form
// wrote a label that named its control. The two look identical, because the same
// rules style both, and only one of them gives a control an accessible name.
//
// So this suite asserts the SHAPE rather than any one renderer: whatever a pane
// draws, every field in it names its own control. It is the same guard
// tests/ui-kit-frame.test.ts and tests/manager-render.test.tsx put on the close
// glyph, for the same reason and after the same kind of drift.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticsReading } from '../loader/src/runtime/diagnostics.ts';
import { createGameBindings } from '../loader/src/runtime/keys/game-bindings.ts';
import { createLogBuffer } from '../loader/src/runtime/log/buffer.ts';
import {
  createCheckbox,
  createSelect,
  createSlider,
  createText,
} from '../loader/src/runtime/ui/kit/field.ts';
import { FIELD_CLASS } from '../loader/src/runtime/ui/kit/field-shape.ts';
import { createUnlockMode } from '../loader/src/runtime/ui/kit/unlock.ts';
import { createConfigService } from '../loader/src/runtime/ui/manager/config.ts';
import type { ManagerRegistry } from '../loader/src/runtime/ui/manager/index.tsx';
import { mountManager } from '../loader/src/runtime/ui/manager/index.tsx';
import { OFFICIAL } from '../loader/src/shared/marketplace.ts';
import type { InstalledAddon } from '../loader/src/shared/protocol.ts';
import { fakeMarketApi, marketEntry, marketState } from './fakes/market.ts';
import { createFakeStorage } from './fakes/storage.ts';
import { fakeRegistry, supervisorServices } from './fakes/ui-deps.ts';

const FQID = 'official/combat-meter';

const READING: DiagnosticsReading = {
  origin: 'https://pbe.worldofclaudecraft.com',
  channel: 'pbe',
  loaderVersion: '0.4.1',
  bridged: true,
  game: { version: '0.31.0', build: '1a2b3c4d5e6f' },
  probe: null,
  net: {
    connected: false,
    tick: 0,
    tickHz: 20,
    pid: null,
    realm: null,
    seed: null,
    latencyMs: null,
    reconnects: 0,
  },
  anchors: [],
};

function addon(): InstalledAddon {
  return {
    fqid: FQID,
    marketplace: 'official',
    enabled: false,
    pin: null,
    manifest: {
      id: 'combat-meter',
      name: 'Combat Meter',
      version: '1.2.0',
      apiVersion: 1,
      author: 'MarshalX',
      description: 'Rolling damage per second.',
      entry: 'main.js',
      settings: [
        { id: 'window', type: 'number', label: 'Rolling window', default: 5, min: 1, max: 60 },
        { id: 'show-pet', type: 'boolean', label: 'Include pet damage', default: true },
        { id: 'title', type: 'string', label: 'Window title', default: 'DPS' },
        { id: 'anchor', type: 'select', label: 'Anchor', default: 'top', options: ['top', 'bot'] },
      ],
    },
  };
}

/**
 * Preact batches state into a microtask, and the stores load asynchronously.
 * The turns chain rather than resolve together, because each one releases the
 * continuation the next is waiting on.
 */
async function settle(turns = 8): Promise<void> {
  if (turns > 0) {
    await Promise.resolve();
    await settle(turns - 1);
  }
}

/** Every field on screen, whichever pane drew it. */
function fields(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`.${FIELD_CLASS.row}`)];
}

/** The field's own label element, which for a checkbox is the container itself. */
function labelOf(field: HTMLElement): Element | null {
  if (field.matches('label')) {
    return field;
  }
  return field.querySelector('label');
}

/**
 * The control a field's label names, resolved the way a browser resolves it.
 *
 * Null when the label points at nothing, which is the failure this is for: a
 * label with no `for` reads out with no control attached to it, and a label
 * pointing at an id that is not there is worse, because it looks correct.
 */
function controlOf(field: HTMLElement): Element | null {
  // A checkbox's container IS its label, which is the one exception the shape
  // allows and therefore the one this has to look for rather than trip over.
  const label = labelOf(field);
  const wants = label?.getAttribute('for') ?? '';
  if (wants === '') {
    return null;
  }
  return document.getElementById(wants);
}

function openManager() {
  const root = document.createElement('div');
  root.id = 'woc-addons';
  document.body.appendChild(root);
  const registry: ManagerRegistry = fakeRegistry({ list: async () => [addon()] });
  const manager = mountManager({
    doc: document,
    root,
    registry,
    storage: null,
    channel: 'pbe',
    readDiagnostics: () => READING,
    config: createConfigService({
      hub: createFakeStorage(),
      game: createGameBindings({ game: () => null, storage: () => null }),
      addonBindings: () => ({}),
      onChange: () => undefined,
    }),
    capture: () => Promise.resolve(null),
    logs: createLogBuffer(),
    // A real catalog behind the two panes that drew nothing without one: an
    // unreachable pane has no fields, and a guard that passed on an empty pane
    // would be checking that the manager renders no forms.
    market: fakeMarketApi({
      list: () => Promise.resolve([marketState(OFFICIAL, [marketEntry()])]),
    }),
    dev: null,
    unlock: createUnlockMode(document.createElement('div')),
    ...supervisorServices(),
  });
  manager.open();
  return manager;
}

/** Open the tab whose label this is, and let the pane settle. */
async function tab(label: string): Promise<void> {
  const found = [...document.querySelectorAll<HTMLButtonElement>('.woc-tab')].find(
    (button) => button.textContent === label,
  );
  found?.click();
  await settle();
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the kit renderer', () => {
  it.each([
    ['checkbox', () => createCheckbox(document, { label: 'A', value: true, onChange: vi.fn() })],
    ['text', () => createText(document, { label: 'A', value: '', onChange: vi.fn() })],
    [
      'select',
      () => createSelect(document, { label: 'A', value: 'x', options: ['x'], onChange: vi.fn() }),
    ],
    [
      'slider',
      () => createSlider(document, { label: 'A', value: 1, min: 0, max: 2, onChange: vi.fn() }),
    ],
  ])('gives its %s label the control to name', (_kind, build) => {
    const field = build();
    document.body.appendChild(field.el);

    expect(controlOf(field.el)).not.toBeNull();
  });

  it('takes its classes from the shared shape rather than writing its own', () => {
    const field = createText(document, { label: 'A', value: '', onChange: vi.fn() });

    expect(field.el.className).toBe(FIELD_CLASS.row);
    expect(field.el.querySelector('label')?.className).toBe(FIELD_CLASS.label);
    expect(field.el.querySelector('input')?.className).toBe(FIELD_CLASS.control);
  });
});

// The renderer that drifted. Each pane is opened and every field it drew is held
// to the same rule, so a new pane written the old way fails here rather than
// being noticed by whoever tries to use the loader with a screen reader.
describe('the manager renderer', () => {
  it('names a control from every field on an addon page', async () => {
    openManager();
    await settle();
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.getAttribute('aria-label')?.startsWith('Configure') === true)
      ?.click();
    await settle();

    expect(fields().length).toBeGreaterThan(0);
    for (const field of fields()) {
      expect(controlOf(field)).not.toBeNull();
    }
  });

  it.each(['Browse', 'Marketplaces'])('names a control from every field on %s', async (label) => {
    openManager();
    await settle();

    await tab(label);

    expect(fields().length).toBeGreaterThan(0);
    for (const field of fields()) {
      expect(controlOf(field)).not.toBeNull();
    }
  });
});
