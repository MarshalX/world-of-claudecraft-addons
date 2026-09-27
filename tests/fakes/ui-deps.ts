// The services mountUi and mountManager need beyond what a suite is testing.

import { createKeyDispatcher } from '../../loader/src/runtime/keys/dispatcher.ts';
import { createGameBindings } from '../../loader/src/runtime/keys/game-bindings.ts';
import { createLogBuffer } from '../../loader/src/runtime/log/buffer.ts';
import { createMenus } from '../../loader/src/runtime/ui/kit/menu.ts';
import { createConfigService } from '../../loader/src/runtime/ui/manager/config.ts';
import type { ManagerDeps, ManagerRegistry } from '../../loader/src/runtime/ui/manager/index.tsx';
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
    // No live game and no localStorage, so every combo reads as unbound.
    gameBindings: createGameBindings({ game: () => null, storage: () => null }),
  };
}

/** A registry that answers, for a suite that is not about the registry. */
function fakeRegistry(overrides: Partial<ManagerRegistry> = {}): ManagerRegistry {
  return {
    list: () => Promise.resolve([]),
    setEnabled: () => Promise.resolve(),
    install: () => Promise.resolve(),
    uninstall: () => Promise.resolve(),
    update: () => Promise.resolve(),
    setPin: () => Promise.resolve(),
    updates: () => Promise.resolve([]),
    ...overrides,
  };
}

/** The supervisor's half of ManagerDeps, with nothing running. */
function supervisorServices(): Pick<
  ManagerDeps,
  'statuses' | 'reload' | 'reloadAll' | 'formatTime'
> {
  return {
    statuses: () => [],
    reload: () => Promise.resolve(),
    reloadAll: () => Promise.resolve(),
    // Locale-independent, so rendered text does not depend on the machine.
    formatTime: (at) => `t+${String(at)}`,
  };
}

/**
 * The one menu every manager dropdown opens, built for real. A stub opener puts no menu in the
 * document, which makes every dropdown case pass vacuously.
 */
function menuService(doc: Document, root: HTMLElement): ManagerDeps['openMenu'] {
  return createMenus({ doc, root, viewport: () => VIEWPORT }).open;
}

/** The extra half of UiDeps, for a suite that supplies the half it cares about. */
function uiServices(
  doc: Document,
  harness = createUiHarness(doc),
): Pick<
  UiDeps,
  | 'setTimer'
  | 'clearTimer'
  | 'viewport'
  | 'storageHub'
  | 'gameBindings'
  | 'dispatcher'
  | 'logs'
  | 'market'
  | 'dev'
  | 'statuses'
  | 'reload'
  | 'reloadAll'
  | 'formatTime'
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
    market: null,
    dev: null,
    ...supervisorServices(),
  };
}

/** The extra half of ManagerDeps, likewise. */
function managerServices(
  doc: Document,
  harness = createUiHarness(doc),
): Pick<
  ManagerDeps,
  | 'config'
  | 'capture'
  | 'logs'
  | 'market'
  | 'dev'
  | 'statuses'
  | 'reload'
  | 'reloadAll'
  | 'formatTime'
> {
  return {
    config: createConfigService({
      hub: harness.storage,
      game: harness.gameBindings,
      addonBindings: harness.dispatcher.bindings,
      onChange: () => undefined,
    }),
    capture: () => harness.dispatcher.capture().done,
    logs: harness.logs,
    market: null,
    dev: null,
    ...supervisorServices(),
  };
}

export type { UiHarness };
export {
  createUiHarness,
  fakeRegistry,
  managerServices,
  menuService,
  supervisorServices,
  uiServices,
  VIEWPORT,
};
