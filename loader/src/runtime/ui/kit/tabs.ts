// A tab strip, drawn the way the manager's own is.
//
// The kit owns the STRIP and not the panes, which are the addon's.
//
// Buttons in a nav marked with `aria-current`, NOT role="tablist": the tab role promises
// arrow-key navigation and `aria-controls`, which this cannot keep since the panes are the
// addon's. The manager's own strip does the same.

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
