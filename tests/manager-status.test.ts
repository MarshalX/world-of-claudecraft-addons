// How an addon's run state is drawn, in both panes that render it.

import { describe, expect, it } from 'vitest';
import type { AddonStatus } from '../loader/src/runtime/supervisor.ts';
import { statusView } from '../loader/src/runtime/ui/manager/status.ts';
import { UI_TEXT } from '../loader/src/runtime/ui/manager/strings.ts';

const FQID = 'official/combat-meter';

function status(overrides: Partial<AddonStatus> = {}): AddonStatus {
  return { fqid: FQID, state: 'running', error: null, ...overrides };
}

describe('with a status', () => {
  it.each([
    ['running', UI_TEXT.statusRunning, 'ok'],
    ['stopped', UI_TEXT.statusStopped, 'muted'],
    ['failed', UI_TEXT.statusFailed, 'bad'],
    ['incompatible', UI_TEXT.statusIncompatible, 'bad'],
  ] as const)('draws %s as %s', (state, label, tone) => {
    expect(statusView([status({ state })], FQID)).toEqual({ label, tone, detail: null });
  });

  it('carries the reason for the states that have one', () => {
    const view = statusView([status({ state: 'failed', error: 'boom' })], FQID);

    expect(view?.detail).toBe('boom');
  });

  it('picks out the right addon from the list', () => {
    const rows = [status({ fqid: 'official/other', state: 'failed' }), status()];

    expect(statusView(rows, FQID)?.tone).toBe('ok');
  });
});

// No status is null, never "stopped": the loader has not established that the addon stopped.
describe('with no status', () => {
  it('answers null for an addon the supervisor has not reached', () => {
    expect(statusView([status({ fqid: 'official/other' })], FQID)).toBeNull();
  });

  it('answers null when nothing has been reported at all', () => {
    expect(statusView([], FQID)).toBeNull();
  });
});
