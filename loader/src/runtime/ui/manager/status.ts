// How one addon's run status is drawn, shared by the Installed row and the addon's own page.

import type { AddonStatus } from '../../supervisor.ts';
import { UI_TEXT } from './strings.ts';

const LABELS = {
  running: UI_TEXT.statusRunning,
  stopped: UI_TEXT.statusStopped,
  failed: UI_TEXT.statusFailed,
  incompatible: UI_TEXT.statusIncompatible,
} as const;

interface StatusView {
  label: string;
  /** The modifier appended to `woc-badge`. */
  tone: 'ok' | 'muted' | 'bad';
  /** The reason, for the states that carry one. Null otherwise. */
  detail: string | null;
}

const TONES = {
  running: 'ok',
  stopped: 'muted',
  failed: 'bad',
  incompatible: 'bad',
} as const;

/**
 * The view for one addon, or null when no status exists yet (before the supervisor reconciles, or
 * with no bridge). Never default to "Stopped", which would claim something not yet known.
 */
function statusView(statuses: readonly AddonStatus[], fqid: string): StatusView | null {
  const status = statuses.find((candidate) => candidate.fqid === fqid);
  if (status === undefined) {
    return null;
  }
  return { label: LABELS[status.state], tone: TONES[status.state], detail: status.error };
}

export type { StatusView };
export { statusView };
