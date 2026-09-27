// What each host event makes the runtime do. A registry write is the only thing that starts or
// stops an addon, and it acts from the event so a toggle in another tab reaches it too.

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
  // Install writes the row enabled, the host announces it, and this starts the addon.
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

  // The installed set did not move: the same addon at the same version has a new body.
  it('reloads the one addon whose source changed', () => {
    const { handle, calls } = harness();

    handle({ k: 'addon.reload', fqid: 'local/dev-harness' });

    expect(calls.reload).toHaveBeenCalledWith('local/dev-harness');
    expect(calls.resync).not.toHaveBeenCalled();
  });

  // A market or dev change moves nothing the supervisor owns, so it only repaints.
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

    handle({ k: 'storage.changed', ns: 'addon:official/combat-meter', key: 'seen', value: 7 });

    expect(calls.deliverStorage).toHaveBeenCalledWith('addon:official/combat-meter', 'seen', 7);
  });

  // Addons write on a timer, so a resync per write would be a reconcile per tick.
  it('does not resync on a storage write', () => {
    const { handle, calls } = harness();

    handle({ k: 'storage.changed', ns: 'addon:x/y', key: 'k', value: 1 });

    expect(calls.resync).not.toHaveBeenCalled();
  });
});
