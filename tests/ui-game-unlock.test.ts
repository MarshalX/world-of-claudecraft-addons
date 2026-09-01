// @vitest-environment happy-dom

// Following the game's own HUD edit mode, ONE WAY: the game's mode freezes the
// camera and every world click, so a loader switch that drove it would take the
// game away from the player.

import { afterEach, describe, expect, it } from 'vitest';
import { GAME_UNLOCKED_CLASS } from '../loader/src/runtime/ui/anchors.ts';
import { followGameUnlock } from '../loader/src/runtime/ui/game-unlock.ts';
import { createUnlockMode, UNLOCKED_CLASS } from '../loader/src/runtime/ui/kit/unlock.ts';

function root(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'woc-addons';
  document.body.appendChild(el);
  return el;
}

/** A MutationObserver delivers on a microtask, so a case yields before it reads. */
function settle(): Promise<void> {
  return Promise.resolve();
}

afterEach(() => {
  document.body.className = '';
  document.body.innerHTML = '';
});

describe('following the game HUD edit mode', () => {
  // The loader can start while the mode is already open, and nothing mutates after that.
  it('picks up a mode that was already on when it started', () => {
    document.body.classList.add(GAME_UNLOCKED_CLASS);
    const unlock = createUnlockMode(root());

    const stop = followGameUnlock({ doc: document, unlock });

    expect(unlock.unlocked).toBe(true);
    stop();
  });

  it('starts locked when the class is not there, which is every other case', () => {
    const unlock = createUnlockMode(root());

    const stop = followGameUnlock({ doc: document, unlock });

    expect(unlock.unlocked).toBe(false);
    stop();
  });

  it('follows the game into the mode and back out of it', async () => {
    const el = root();
    const unlock = createUnlockMode(el);
    const stop = followGameUnlock({ doc: document, unlock });

    document.body.classList.add(GAME_UNLOCKED_CLASS);
    await settle();

    expect(unlock.unlocked).toBe(true);
    expect(el.classList.contains(UNLOCKED_CLASS)).toBe(true);

    document.body.classList.remove(GAME_UNLOCKED_CLASS);
    await settle();

    expect(unlock.unlocked).toBe(false);
    expect(el.classList.contains(UNLOCKED_CLASS)).toBe(false);
    stop();
  });

  it('tells the mode subscribers, which is what the manager checkbox follows', async () => {
    const unlock = createUnlockMode(root());
    const seen: boolean[] = [];
    unlock.onChange((on) => seen.push(on));
    const stop = followGameUnlock({ doc: document, unlock });

    document.body.classList.add(GAME_UNLOCKED_CLASS);
    await settle();
    document.body.classList.remove(GAME_UNLOCKED_CLASS);
    await settle();

    expect(seen).toEqual([true, false]);
    stop();
  });

  // A subscriber hearing about an unrelated class would repaint the manager.
  it('says nothing about a class change that is not this mode', async () => {
    const unlock = createUnlockMode(root());
    const seen: boolean[] = [];
    unlock.onChange((on) => seen.push(on));
    const stop = followGameUnlock({ doc: document, unlock });

    document.body.classList.add('mobile-touch');
    await settle();

    expect(seen).toEqual([]);
    stop();
  });

  // The case above starts locked, where re-asserting the reading is a no-op whether
  // or not anything is edge triggered. Body carries game classes that flip in
  // ordinary play (`pad-active`, `src/game/input_hint_mode.ts`, on every controller
  // input), and each would otherwise write false over a player's own switch mid-drag.
  it('leaves the loader mode alone when an unrelated class flips', async () => {
    const unlock = createUnlockMode(root());
    const stop = followGameUnlock({ doc: document, unlock });

    unlock.set(true);
    const seen: boolean[] = [];
    unlock.onChange((on) => seen.push(on));

    document.body.classList.add('pad-active');
    document.body.classList.remove('pad-active');
    document.body.classList.add('mobile-chat-open');
    await settle();

    expect(unlock.unlocked).toBe(true);
    expect(seen).toEqual([]);
    stop();
  });

  // The game's mode early-returns from onMouseDown, so writing this class back
  // would take the camera away.
  it('never writes the game class back when the loader mode is flipped', async () => {
    const unlock = createUnlockMode(root());
    const stop = followGameUnlock({ doc: document, unlock });

    unlock.set(true);
    await settle();

    expect(document.body.classList.contains(GAME_UNLOCKED_CLASS)).toBe(false);
    stop();
  });

  it('stops following once torn down', async () => {
    const unlock = createUnlockMode(root());
    const stop = followGameUnlock({ doc: document, unlock });

    stop();
    document.body.classList.add(GAME_UNLOCKED_CLASS);
    await settle();

    expect(unlock.unlocked).toBe(false);
  });
});
