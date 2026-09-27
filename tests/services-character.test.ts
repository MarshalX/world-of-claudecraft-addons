// @vitest-environment happy-dom

// The loader's per-character storage and `world.characterKey` must share one derivation. Driven
// through the real services, since the shared fake supplies `character` directly.

import { afterEach, describe, expect, it } from 'vitest';
import { createStorage } from '../loader/src/runtime/api/storage.ts';
import { createWorld } from '../loader/src/runtime/api/world.ts';
import { DisposalBag } from '../loader/src/runtime/disposal.ts';
import { createNetHub } from '../loader/src/runtime/net/hub.ts';
import { createRuntimeServices } from '../loader/src/runtime/services.ts';
import type { GameSurfaces } from '../loader/src/runtime/surfaces.ts';
import { createWorldHub } from '../loader/src/runtime/world/hub.ts';
import { characterNamespace, perCharacterKey } from '../loader/src/shared/storage-keys.ts';
import { PLAYER_ENTITY } from './fakes/frames.ts';
import { createFakeStorage } from './fakes/storage.ts';

const FQID = 'official/combat-meter';
const REALM = 'Claudemoon';

const teardown: Array<() => void> = [];

afterEach(() => {
  for (const stop of teardown.splice(0)) {
    stop();
  }
});

/** The two surfaces the character key is derived from; the realm is stated, never fed a frame. */
function surfaces(realm: string | null, name: string): GameSurfaces {
  const net = createNetHub({ now: () => 0, install: () => () => undefined });
  const world = createWorldHub({
    game: Promise.resolve({ world: { player: { ...PLAYER_ENTITY, name }, entities: new Map() } }),
    schedule: () => 0,
    cancel: () => undefined,
    lastDamageAt: () => null,
    now: () => 0,
    zoneName: () => null,
    simNow: () => null,
    realm: () => realm,
  });
  return {
    net,
    world,
    dispose: () => {
      world.dispose();
      net.dispose();
    },
  };
}

async function open(realm: string | null = REALM, name = 'Marshal') {
  const game = surfaces(realm, name);
  const services = createRuntimeServices({
    scope: globalThis as unknown as Window,
    surfaces: game,
    channel: 'pbe',
    storage: null,
    registry: null,
  });
  teardown.push(services.dispose, game.dispose);
  await game.world.ready;
  return { services, game };
}

describe('who the loader thinks is playing', () => {
  it('is the same reading on the world surface and in the shared services', async () => {
    const { services, game } = await open();
    const bag = new DisposalBag();
    teardown.push(() => {
      bag.dispose();
    });

    const world = createWorld(game.world, bag);
    // `character` does not read the UI kit, so a stand-in is enough.
    const shared = services.withKit({} as never);

    expect(world.characterKey).toBe('Claudemoon/Marshal');
    expect(shared.character()).toBe(world.characterKey);
  });

  it('is the character woc.storage.character files its keys under', async () => {
    const { game } = await open();
    const hub = createFakeStorage();
    const world = createWorld(game.world, new DisposalBag());

    const storage = createStorage({
      hub,
      fqid: FQID,
      channel: 'pbe',
      character: () => game.world.backend()?.characterKey ?? null,
      known: () => Promise.resolve(),
    });
    await storage.character.set('layout', { x: 1 });

    const key = perCharacterKey('pbe', world.characterKey ?? '', 'layout');
    expect(hub.dump()).toEqual({ [`${characterNamespace(FQID)}/${key}`]: { x: 1 } });
  });

  it('follows the realm, so two realms are two characters', async () => {
    const other = await open('Auchenai');

    expect(other.game.world.backend()?.characterKey).toBe('Auchenai/Marshal');
  });
});
