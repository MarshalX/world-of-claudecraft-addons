// A tab strip, drawn the way the manager's own is.
//
// Not part of the `ui.field` family and deliberately so: a field is a value the
// player is setting and hands back a value; a tab strip is navigation, and what
// it hands back is which pane to show. Grouping them would put "which tab is
// open" in the same bag as "what the player chose", and only one of those is
// worth persisting.
//
// The kit owns the STRIP and not the panes. Which element a tab reveals is the
// addon's own arrangement, and a kit that also owned the panes would have to own
// their lifetime, their scrolling and their focus order, none of which it can do
// better than the addon that filled them.
//
// Buttons in a nav marked with `aria-current`, NOT role="tablist". The tab role
// is a promise of keyboard behaviour: one stop in the tab order and arrow keys
// moving between the tabs, which this does not implement and cannot, since the
// panes are the addon's and there is nothing to point `aria-controls` at. A
// half-kept promise is worse than the plain one, because it tells a screen reader
// user "tab 2 of 3" and then does nothing when they press an arrow. This is also
// what the MANAGER's own strip does, and the two look identical because they are
// styled by the same rules; having them announce differently would have been a
// difference nobody chose.

import type { Teardown } from '../../disposal.ts';

const ACTIVE_CLASS = 'woc-tab-active';

interface Tab {
  /** Returned by `active()` and passed to `onSelect`. Unique within the strip. */
  id: string;
  label: string;
}

interface TabsOpts {
  tabs: readonly Tab[];
  /** Which one starts open. Defaults to the first. */
  active?: string;
  onSelect: (id: string) => void;
}

interface Tabs {
  readonly el: HTMLElement;
  active: () => string;
  /** Move the strip without calling back, e.g. when a keybind changed the pane. */
  select: (id: string) => void;
  destroy: Teardown;
}

/** The first tab, or an empty id for a strip with no tabs in it at all. */
function firstId(tabs: readonly Tab[]): string {
  return tabs[0]?.id ?? '';
}

function initialId(opts: TabsOpts): string {
  const wanted = opts.active;
  if (wanted !== undefined && opts.tabs.some((tab) => tab.id === wanted)) {
    return wanted;
  }
  return firstId(opts.tabs);
}

function createTabs(doc: Document, opts: TabsOpts): Tabs {
  let active = initialId(opts);

  const el = doc.createElement('nav');
  el.className = 'woc-tabs';

  const buttons = new Map<string, HTMLButtonElement>();

  const paint = (): void => {
    for (const [id, button] of buttons) {
      const on = id === active;
      button.classList.toggle(ACTIVE_CLASS, on);
      // The state a screen reader reads, which the class alone does not carry.
      button.setAttribute('aria-current', String(on));
    }
  };

  for (const tab of opts.tabs) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'woc-tab';
    button.textContent = tab.label;
    button.addEventListener('click', () => {
      if (active === tab.id) {
        return;
      }
      active = tab.id;
      paint();
      opts.onSelect(tab.id);
    });
    buttons.set(tab.id, button);
    el.appendChild(button);
  }
  paint();

  return {
    el,
    active: () => active,
    select: (id) => {
      if (!buttons.has(id)) {
        return;
      }
      active = id;
      paint();
    },
    destroy: () => {
      el.remove();
    },
  };
}

export type { Tab, Tabs, TabsOpts };
export { createTabs };
