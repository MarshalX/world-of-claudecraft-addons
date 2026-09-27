// The manager's tab table, in strip order.

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
