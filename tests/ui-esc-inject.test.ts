// @vitest-environment happy-dom

// The game-menu entry, driven through a real MutationObserver against a fake that rebuilds the
// menu the way the game does. A stubbed observer could not prove the entry survives a re-render.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ENTRY_ID,
  menuInsertionPoint,
  mountMenuEntry,
} from '../loader/src/runtime/ui/esc-inject.ts';
import { GAME_OWN_MENU_ENTRY_CLASS, type GameDom, mountGameMenu } from './fakes/game-dom.ts';

const LABEL = 'Addons';
const ENTRY = '#woc-addons-menu-entry';

/** MutationObserver callbacks are delivered as microtasks, so a tick settles them. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function mount(game: GameDom, onOpen = (): undefined => undefined) {
  return mountMenuEntry({ doc: game.doc, id: ENTRY_ID, label: LABEL, onOpen });
}

const teardown: Array<() => void> = [];

afterEach(() => {
  for (const stop of teardown.splice(0)) {
    stop();
  }
  document.body.innerHTML = '';
});

describe('menuInsertionPoint', () => {
  it('takes the button list on the menu root view', () => {
    const game = mountGameMenu(document);
    game.renderMainView();

    expect(menuInsertionPoint(game.menu, ENTRY_ID)?.className).toBe('opt-list');
  });

  // A sub-view is told from the root by its back control, not by lacking a list.
  it('declines a sub-view even when it has a button list', () => {
    const game = mountGameMenu(document);
    game.renderSubView();
    const list = document.createElement('div');
    list.className = 'opt-list';
    game.menu.appendChild(list);

    expect(menuInsertionPoint(game.menu, ENTRY_ID)).toBeNull();
  });

  it('declines a menu that is not rendered at all', () => {
    const game = mountGameMenu(document);

    expect(menuInsertionPoint(game.menu, ENTRY_ID)).toBeNull();
  });

  it('declines once the entry is already there', () => {
    const game = mountGameMenu(document);
    game.renderMainView();
    teardown.push(mount(game).dispose);

    expect(menuInsertionPoint(game.menu, ENTRY_ID)).toBeNull();
  });
});

describe('the game menu entry', () => {
  // Compared against the game's own rows, not a literal: an entry missing a class the game's row
  // rule keys on silently renders in a legacy style.
  it('wears exactly what the game puts on its own menu rows', () => {
    const game = mountGameMenu(document);
    game.renderMainView();
    const theirs = game.menu.querySelector('.opt-list .opt-btn')?.className;
    teardown.push(mount(game).dispose);

    expect(document.querySelector(ENTRY)?.className).toBe(theirs);
    expect(document.querySelector(ENTRY)?.className).toBe(GAME_OWN_MENU_ENTRY_CLASS);
  });

  it('injects into a menu that was already open at mount', () => {
    const game = mountGameMenu(document);
    game.renderMainView();
    teardown.push(mount(game).dispose);

    expect(game.entryLabels().at(-1)).toBe(LABEL);
  });

  // The game wipes #options-menu with innerHTML on every view change.
  it('comes back after the game rebuilds the menu', async () => {
    const game = mountGameMenu(document);
    teardown.push(mount(game).dispose);

    game.renderMainView();
    await settle();
    expect(document.querySelector(ENTRY)).not.toBeNull();

    game.renderSubView();
    await settle();
    expect(document.querySelector(ENTRY)).toBeNull();

    game.renderMainView();
    await settle();
    expect(document.querySelector(ENTRY)).not.toBeNull();
    expect(game.entryLabels().at(-1)).toBe(LABEL);
  });

  // The version line is a sibling of the list, so appending to the list keeps the entry above it.
  it('places the entry above the version line', async () => {
    const game = mountGameMenu(document);
    teardown.push(mount(game).dispose);
    game.renderMainView();
    await settle();

    expect(game.entryPrecedesVersion()).toBe(true);
  });

  // Our own append mutates the watched tree, so a missing guard adds entries without end.
  it('adds exactly one entry however many mutations the render raises', async () => {
    const game = mountGameMenu(document);
    teardown.push(mount(game).dispose);

    game.renderMainView();
    await settle();
    game.menu.appendChild(document.createElement('span'));
    await settle();

    expect(document.querySelectorAll(ENTRY)).toHaveLength(1);
  });

  it('opens the manager when clicked', async () => {
    const onOpen = vi.fn();
    const game = mountGameMenu(document);
    teardown.push(mount(game, onOpen).dispose);
    game.renderMainView();
    await settle();

    document.querySelector<HTMLButtonElement>(ENTRY)?.click();

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('stops reinjecting once disposed', async () => {
    const game = mountGameMenu(document);
    mount(game).dispose();

    game.renderMainView();
    await settle();

    expect(document.querySelector(ENTRY)).toBeNull();
  });

  // A moved #options-menu must cost the entry, not the loader.
  it('is inert when the menu anchor is gone', () => {
    document.body.innerHTML = '<div id="ui"></div>';

    const entry = mountMenuEntry({
      doc: document,
      id: ENTRY_ID,
      label: LABEL,
      onOpen: () => undefined,
    });

    expect(entry.inject()).toBe(false);
    expect(() => {
      entry.dispose();
    }).not.toThrow();
  });
});
