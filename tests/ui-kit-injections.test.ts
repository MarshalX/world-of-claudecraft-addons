// @vitest-environment happy-dom

// Everything the loader puts inside the game's own HUD, behind one watcher.
//
// The case this exists for is an addon ENABLED WHILE THE PLAYER IS ALREADY IN
// THE WORLD. The HUD mount event has already happened and will not happen
// again, so an injection that only ever attached on that event would be
// permanently missing, silently, exactly as M3's two routes were before the HUD
// template was understood.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InjectorDeps } from '../loader/src/runtime/ui/kit/injections.ts';
import { createGameInjector } from '../loader/src/runtime/ui/kit/injections.ts';
import { enterWorld, mountStartScreen } from './fakes/game-dom.ts';

/** MutationObserver callbacks are microtasks, so a couple of ticks settle them. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const teardown: Array<() => void> = [];

afterEach(() => {
  for (const stop of teardown.splice(0)) {
    stop();
  }
  document.body.innerHTML = '';
});

function open(onHud?: () => void) {
  // exactOptionalPropertyTypes rejects an explicit undefined, so the key is
  // omitted rather than passed when the caller did not supply a callback.
  const deps: InjectorDeps = { doc: document };
  if (onHud !== undefined) {
    deps.onHud = onHud;
  }
  const injector = createGameInjector(deps);
  teardown.push(injector.dispose);
  return injector;
}

function micro(id: string) {
  return { kind: 'micro' as const, id, label: id, onOpen: vi.fn() };
}

describe('waiting for the HUD', () => {
  it('attaches nothing before world entry', () => {
    mountStartScreen(document);
    const injector = open();

    injector.add(micro('woc-a'));

    expect(injector.attached()).toBe(false);
    expect(document.getElementById('woc-a')).toBeNull();
  });

  it('attaches everything registered once the HUD arrives', async () => {
    mountStartScreen(document);
    const injector = open();
    injector.add(micro('woc-a'));
    injector.add(micro('woc-b'));

    enterWorld(document);
    await settle();

    expect(document.getElementById('woc-a')).not.toBeNull();
    expect(document.getElementById('woc-b')).not.toBeNull();
  });

  // An addon enabled mid-session has no HUD mount coming, so registering has to
  // attach immediately or the addon's button never appears.
  it('attaches immediately when the HUD is already up', async () => {
    mountStartScreen(document);
    const injector = open();
    enterWorld(document);
    await settle();

    injector.add(micro('woc-late'));

    expect(document.getElementById('woc-late')).not.toBeNull();
  });

  it('reports the HUD once, before the injections go in', async () => {
    mountStartScreen(document);
    const onHud = vi.fn();
    open(onHud);

    enterWorld(document);
    await settle();

    expect(onHud).toHaveBeenCalledOnce();
  });
});

describe('ordering', () => {
  // The loader's own routes are registered first and must keep their place, so
  // an addon button never wedges between the game's menu button and ours.
  it('attaches in registration order', async () => {
    mountStartScreen(document);
    const injector = open();
    injector.add({ ...micro('woc-addons-micro-button'), label: 'Addons' });
    injector.add(micro('woc-addon-micro-a'));
    injector.add(micro('woc-addon-micro-b'));

    enterWorld(document);
    await settle();

    const rail = [...document.querySelectorAll('#side-buttons-col-b button')].map((el) => el.id);
    expect(rail.slice(-3)).toEqual([
      'woc-addons-micro-button',
      'woc-addon-micro-a',
      'woc-addon-micro-b',
    ]);
  });
});

describe('removing', () => {
  it('takes one injection away and leaves the rest', async () => {
    mountStartScreen(document);
    const injector = open();
    const off = injector.add(micro('woc-a'));
    injector.add(micro('woc-b'));
    enterWorld(document);
    await settle();

    off();

    expect(document.getElementById('woc-a')).toBeNull();
    expect(document.getElementById('woc-b')).not.toBeNull();
  });

  it('does not re-attach something that was removed', async () => {
    mountStartScreen(document);
    const injector = open();
    const off = injector.add(micro('woc-a'));
    enterWorld(document);
    await settle();

    off();
    document.body.innerHTML = '';
    mountStartScreen(document);
    enterWorld(document);
    await settle();

    expect(document.getElementById('woc-a')).toBeNull();
  });

  it('takes everything away on dispose', async () => {
    mountStartScreen(document);
    const injector = open();
    injector.add(micro('woc-a'));
    injector.add({ kind: 'menu', id: 'woc-menu-a', label: 'A', onOpen: vi.fn() });
    enterWorld(document);
    await settle();

    injector.dispose();

    expect(document.getElementById('woc-a')).toBeNull();
    expect(document.getElementById('woc-menu-a')).toBeNull();
  });

  // Two addons could otherwise both claim one element id, and the second would
  // silently replace the first's button.
  it('refuses a duplicate id', () => {
    const injector = open();
    injector.add(micro('woc-a'));

    expect(() => injector.add(micro('woc-a'))).toThrow('already registered');
  });
});
