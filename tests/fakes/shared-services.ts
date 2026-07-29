// The SharedServices bundle, built once and shared by every addon.
//
// Three suites need it now (api assembly, the per-addon loader, the supervisor),
// so it lives here rather than being rebuilt in each. Everything is real except
// the four things that would reach outside the process: the socket, the game
// object, the audio sink, and the SFX pack fetch.
//
// It needs a document, so a suite importing this declares happy-dom.

import type { SharedServices } from '../../loader/src/runtime/api/index.ts';
import { createKeyDispatcher } from '../../loader/src/runtime/keys/dispatcher.ts';
import { createGameBindings } from '../../loader/src/runtime/keys/game-bindings.ts';
import { createLogBuffer } from '../../loader/src/runtime/log/buffer.ts';
import { createNetHub } from '../../loader/src/runtime/net/hub.ts';
import { createSoundEngine } from '../../loader/src/runtime/sound/engine.ts';
import { createGameInjector } from '../../loader/src/runtime/ui/kit/injections.ts';
import { createToaster } from '../../loader/src/runtime/ui/kit/toast.ts';
import { createTooltips } from '../../loader/src/runtime/ui/kit/tooltip.ts';
import { createWorldHub } from '../../loader/src/runtime/world/hub.ts';
import { createFakeStorage, type FakeStorage } from './storage.ts';

const VIEWPORT = { w: 800, h: 600 };

/**
 * A pack with cues in it rather than an empty one, in the DEPLOYED shape: a
 * variant is a record with a url, NOT a bare string.
 *
 * `cues()` answering empty is indistinguishable from a pack that failed to load,
 * so a suite checking that an addon can name a cue needs at least one to exist.
 * Built from entry pairs because every cue name here is the GAME's, not this
 * project's: a naming convention for our own identifiers has nothing to say
 * about `ui_ready_check`.
 */
const SOUND_PACK = {
  format: 'woc-sfx-runtime-pack',
  version: 1,
  clips: Object.fromEntries([
    [
      'ui_click',
      {
        variants: [{ id: 'main', url: '/audio/sfx/ui_click.mp3?v=aabbccdd', bytes: 4210 }],
        gain: 1.7579,
        playbackRate: 1,
      },
    ],
    [
      'ui_ready_check',
      {
        variants: [{ id: 'main', url: '/audio/sfx/ui_ready_check.mp3?v=11223344', bytes: 5120 }],
        gain: 1.2,
        playbackRate: 1,
      },
    ],
    // Multi-variant, which is what makes a cue not a file.
    [
      'combat_block',
      {
        variants: [
          { id: '1', url: '/audio/sfx/combat_block_1.mp3?v=1555a71f', bytes: 9447 },
          { id: '2', url: '/audio/sfx/combat_block_2.mp3?v=c09d3045', bytes: 10_074 },
        ],
        gain: 0.9,
        playbackRate: 1,
      },
    ],
  ]),
};
const NOW_MS = 1234;
const WALL_CLOCK_MS = 1_700_000_000_000;

interface SharedHarness {
  shared: SharedServices;
  hub: FakeStorage;
  root: HTMLElement;
  dispose: () => void;
}

/**
 * @param hub the storage hub, so a suite can seed it or assert on it.
 */
function createSharedServices(
  doc: Document,
  hub: FakeStorage = createFakeStorage(),
): SharedHarness {
  const root = doc.createElement('div');
  root.id = 'woc-addons';
  doc.body.appendChild(root);

  const injector = createGameInjector({ doc });
  const toaster = createToaster({ doc, root, setTimer: () => 0, clearTimer: () => undefined });
  const tooltips = createTooltips({ doc, root, viewport: () => VIEWPORT });
  const dispatcher = createKeyDispatcher({ target: new EventTarget(), doc });
  const logs = createLogBuffer();

  const shared: SharedServices = {
    doc,
    window: globalThis as unknown as SharedServices['window'],
    net: createNetHub({ now: () => 0, install: () => () => undefined }),
    world: createWorldHub({
      // Never resolves: an addon has to be usable before world entry, and a
      // suite that waited for this would hang rather than fail.
      game: new Promise(() => undefined),
      schedule: () => 0,
      cancel: () => undefined,
    }),
    storage: hub,
    sound: createSoundEngine({
      sink: {
        running: () => true,
        resume: async () => undefined,
        decode: async () => ({}),
        start: () => undefined,
        close: () => undefined,
      },
      fetchJson: () => Promise.resolve(SOUND_PACK),
      fetchBytes: async () => new ArrayBuffer(8),
      volume: () => 1,
      now: () => 0,
      pick: () => 0,
    }),
    dispatcher,
    gameBindings: createGameBindings({ game: () => null, storage: () => null }),
    logs,
    kit: { root, injector, toaster, tooltips },
    channel: 'pbe',
    host: 'https://pbe.worldofclaudecraft.com',
    gameVersion: () => ({ version: '0.31.0', build: '202607290011' }),
    character: () => 'Claudemoon/Marshal',
    now: () => NOW_MS,
    wallClock: () => WALL_CLOCK_MS,
    viewport: () => VIEWPORT,
    pick: () => 0,
  };

  return {
    shared,
    hub,
    root,
    dispose: () => {
      injector.dispose();
      tooltips.dispose();
      toaster.dispose();
      dispatcher.dispose();
      logs.dispose();
      root.remove();
    },
  };
}

export type { SharedHarness };
export { createSharedServices, NOW_MS, VIEWPORT, WALL_CLOCK_MS };
