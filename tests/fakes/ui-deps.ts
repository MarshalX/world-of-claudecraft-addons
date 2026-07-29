// The services mountUi and mountManager need beyond what they are being tested
// for.
//
// Collected here so a suite about HUD injection does not have to construct a
// keybind dispatcher and a log buffer to say what it is actually about, and so
// adding a dependency to the UI is one edit rather than one per suite.

import { createKeyDispatcher } from '../../loader/src/runtime/keys/dispatcher.ts';
import { createGameBindings } from '../../loader/src/runtime/keys/game-bindings.ts';
import { createLogBuffer } from '../../loader/src/runtime/log/buffer.ts';
import { createConfigService } from '../../loader/src/runtime/ui/manager/config.ts';
import type { ManagerDeps } from '../../loader/src/runtime/ui/manager/index.tsx';
import type { UiDeps } from '../../loader/src/runtime/ui/mount.ts';
import { createFakeStorage, type FakeStorage } from './storage.ts';

const VIEWPORT = { w: 1280, h: 800 };

interface UiHarness {
  storage: FakeStorage;
  dispatcher: ReturnType<typeof createKeyDispatcher>;
  logs: ReturnType<typeof createLogBuffer>;
  gameBindings: ReturnType<typeof createGameBindings>;
}

function createUiHarness(doc: Document): UiHarness {
  return {
    storage: createFakeStorage(),
    dispatcher: createKeyDispatcher({ target: new EventTarget(), doc }),
    logs: createLogBuffer(),
    // No live game and no localStorage, so every combo reads as unbound, which
    // is what a suite that is not about conflicts wants.
    gameBindings: createGameBindings({ game: () => null, storage: () => null }),
  };
}

/** The extra half of UiDeps, for a suite that supplies the half it cares about. */
function uiServices(
  doc: Document,
  harness = createUiHarness(doc),
): Pick<
  UiDeps,
  'setTimer' | 'clearTimer' | 'viewport' | 'storageHub' | 'gameBindings' | 'dispatcher' | 'logs'
> {
  return {
    setTimer: (handler, ms) => globalThis.setTimeout(handler, ms) as unknown as number,
    clearTimer: (id) => {
      globalThis.clearTimeout(id);
    },
    viewport: () => VIEWPORT,
    storageHub: harness.storage,
    gameBindings: harness.gameBindings,
    dispatcher: harness.dispatcher,
    logs: harness.logs,
  };
}

/** The extra half of ManagerDeps, likewise. */
function managerServices(
  doc: Document,
  harness = createUiHarness(doc),
): Pick<ManagerDeps, 'config' | 'capture' | 'logs'> {
  return {
    config: createConfigService({
      hub: harness.storage,
      game: harness.gameBindings,
      addonBindings: harness.dispatcher.bindings,
      onChange: () => undefined,
    }),
    capture: () => harness.dispatcher.capture().done,
    logs: harness.logs,
  };
}

export type { UiHarness };
export { createUiHarness, managerServices, uiServices, VIEWPORT };
