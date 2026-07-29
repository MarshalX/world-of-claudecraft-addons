// The manager's tab table.
//
// Kept as data rather than as markup so the shell can say plainly which panes
// are built and which are not. A tab that is not built still renders, with the
// reason: a missing tab reads as a loader that is broken, where an empty one
// with a sentence in it reads as a loader that is not finished, which is the
// truth.

export const TAB_IDS = ['installed', 'browse', 'marketplaces', 'updates', 'diagnostics'] as const;

export type TabId = (typeof TAB_IDS)[number];

export interface TabDef {
  id: TabId;
  label: string;
  /** False while the pane is a placeholder. `pending` says what it is waiting on. */
  built: boolean;
  pending?: string;
}

export const TABS: readonly TabDef[] = [
  { id: 'installed', label: 'Installed', built: true },
  {
    id: 'browse',
    label: 'Browse',
    built: false,
    pending: 'Browsing and installing arrive with the marketplace index.',
  },
  {
    id: 'marketplaces',
    label: 'Marketplaces',
    built: false,
    pending: 'Adding and removing sources arrives with the marketplace index.',
  },
  {
    id: 'updates',
    label: 'Updates',
    built: false,
    pending: 'Update badges need a cached index to compare against.',
  },
  { id: 'diagnostics', label: 'Diagnostics', built: true },
];

export const DEFAULT_TAB: TabId = 'installed';

export function findTab(id: TabId): TabDef {
  const tab = TABS.find((candidate) => candidate.id === id);
  if (tab === undefined) {
    throw new Error(`no such manager tab: ${id}`);
  }
  return tab;
}
