// How one addon's run status is drawn, as a pure function of the status list.
//
// Separate from the panes that render it because two of them show it and both
// have to agree: the Installed row and the addon's own page. It is also the
// piece worth a Node test, since the interesting case is the one with no status
// at all, which is what an addon looks like before the supervisor has reached it.

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
 * The view for one addon, or null when there is nothing to say.
 *
 * Null rather than a "stopped" default. Before the supervisor has reconciled,
 * and whenever the bridge never connected, no status exists, and drawing
 * "Stopped" then would assert something the loader has not established. An
 * enabled addon showing no badge for a moment is the honest reading.
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
