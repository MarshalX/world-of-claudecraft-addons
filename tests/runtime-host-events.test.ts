// What each host event makes the runtime do.
//
// The case this exists for is `registry.changed`. The registry is the desired
// set and the supervisor is the actual one, so a write to the registry is the
// ONLY thing that starts or stops an addon. Install landing enabled means
// nothing unless that write reaches the resync, and until this suite was written
// the dispatch that connects them was a closure inside boot.ts that nothing
// exercised: install could have gone on writing `enabled: true` into a registry
// nobody re-read, and the addon would have sat there installed and not running
// with no error anywhere.
//
// The second reason is the cross-tab one. The sync hangs off the EVENT rather
// than off the control that caused it, so a toggle in another tab has to reach
// the supervisor here. A handler that instead did the work at the click site
// would pass every test that clicks and fail only on a second tab.

import { describe, expect, it, vi } from 'vitest';
import { createHostEventHandler, type EventTargets } from '../loader/src/runtime/host-events.ts';
import type { HostEvent } from '../loader/src/shared/protocol.ts';

function harness() {
  const calls = {
    open: vi.fn(),
    invalidate: vi.fn(),
    repaint: vi.fn(),
    resync: vi.fn(),
    reload: vi.fn<(fqid: string) => void>(),
    deliverStorage: vi.fn<(ns: string, key: string, value: unknown) => void>(),
  };
  const targets: EventTargets = {
    manager: { open: calls.open, invalidate: calls.invalidate, repaint: calls.repaint },
    resync: calls.resync,
    reload: calls.reload,
    deliverStorage: calls.deliverStorage,
  };
  return { handle: createHostEventHandler(targets), calls };
}

describe('registry.changed', () => {
  // The whole chain behind "an addon you install starts": install writes the row
  // enabled, the host announces the write, and this is what acts on it.
  it('resyncs the running set', () => {
    const { handle, calls } = harness();

    handle({ k: 'registry.changed' });

    expect(calls.resync).toHaveBeenCalledTimes(1);
  });

  it('also re-reads what the manager shows', () => {
    const { handle, calls } = harness();

    handle({ k: 'registry.changed' });

    expect(calls.invalidate).toHaveBeenCalledTimes(1);
  });
});

describe('the other events', () => {
  it('opens the manager for the userscript menu command', () => {
    const { handle, calls } = harness();

    handle({ k: 'ui.open' });

    expect(calls.open).toHaveBeenCalledTimes(1);
  });

  // Distinct from registry.changed because nothing about the installed set
  // moved: the same addon at the same version has a different body.
  it('reloads the one addon whose source changed', () => {
    const { handle, calls } = harness();

    handle({ k: 'addon.reload', fqid: 'local/dev-harness' });

    expect(calls.reload).toHaveBeenCalledWith('local/dev-harness');
    expect(calls.resync).not.toHaveBeenCalled();
  });

  // A market or dev change moves nothing the supervisor owns, so it repaints
  // rather than re-reading the registry and reconciling behind it.
  const repainting: HostEvent[] = [{ k: 'market.changed', id: 'official' }, { k: 'dev.changed' }];

  it.each(repainting)('repaints on $k', (event) => {
    const { handle, calls } = harness();

    handle(event);

    expect(calls.repaint).toHaveBeenCalledTimes(1);
    expect(calls.resync).not.toHaveBeenCalled();
    expect(calls.invalidate).not.toHaveBeenCalled();
  });

  it('hands a storage write to the addons watching that key', () => {
    const { handle, calls } = harness();

    handle({ k: 'storage.changed', ns: 'addon:official/dps-meter', key: 'seen', value: 7 });

    expect(calls.deliverStorage).toHaveBeenCalledWith('addon:official/dps-meter', 'seen', 7);
  });

  // Restarting every addon because one of them wrote a storage key would be a
  // reconcile per write, and addons write on a timer.
  it('does not resync on a storage write', () => {
    const { handle, calls } = harness();

    handle({ k: 'storage.changed', ns: 'addon:x/y', key: 'k', value: 1 });

    expect(calls.resync).not.toHaveBeenCalled();
  });
});
