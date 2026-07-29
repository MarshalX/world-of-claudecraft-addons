// The manager's tab table.
//
// Kept as data rather than as markup so the strip is one list to read and the
// order is one line to change.
//
// It carried a `built` flag and a `pending` sentence while the panes were being
// written, so an unfinished tab could say what it was waiting for: a missing tab
// reads as a loader that is broken, where an empty one with a sentence in it
// reads as one that is not finished. Every tab is built now, and a flag with no
// false case is a branch nothing takes, so both are gone.

export const TAB_IDS = [
  'installed',
  'browse',
  'marketplaces',
  'updates',
  'dev',
  'diagnostics',
] as const;

export type TabId = (typeof TAB_IDS)[number];

export interface TabDef {
  id: TabId;
  label: string;
}

export const TABS: readonly TabDef[] = [
  { id: 'installed', label: 'Installed' },
  { id: 'browse', label: 'Browse' },
  { id: 'marketplaces', label: 'Marketplaces' },
  { id: 'updates', label: 'Updates' },
  { id: 'dev', label: 'Dev' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

export const DEFAULT_TAB: TabId = 'installed';
