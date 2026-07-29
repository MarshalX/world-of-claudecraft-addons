import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BROADCAST_CHANNEL, createGmAdapter } from '../loader/src/host/gm.ts';
import { FakeChannel, fakeChannelCtor, greasemonkeySource, noop } from './fakes/gm.ts';

/** A manager with no listener API, which is what selects the fallback. */
function broadcastAdapter(): ReturnType<typeof createGmAdapter> {
  return createGmAdapter(greasemonkeySource({ broadcastChannel: fakeChannelCtor }));
}

beforeEach(() => {
  FakeChannel.open = [];
});

describe('broadcast fallback', () => {
  it('delivers a change to another tab', async () => {
    const writer = broadcastAdapter();
    const reader = broadcastAdapter();

    const seen = vi.fn();
    reader.onValueChange('k', seen);
    // The writer only broadcasts for keys it knows are watched.
    writer.onValueChange('k', noop);
    await writer.setValue('k', 'new');

    expect(seen).toHaveBeenCalledOnce();
    expect(seen.mock.calls[0]?.[0]).toMatchObject({ key: 'k', newValue: 'new', remote: true });
  });

  it('does not deliver a change back to the tab that wrote it', async () => {
    const gm = broadcastAdapter();

    const seen = vi.fn();
    gm.onValueChange('k', seen);
    await gm.setValue('k', 'new');

    expect(seen).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', async () => {
    const writer = broadcastAdapter();
    const reader = broadcastAdapter();

    const seen = vi.fn();
    reader.onValueChange('k', seen)();
    writer.onValueChange('k', noop);
    await writer.setValue('k', 'new');

    expect(seen).not.toHaveBeenCalled();
  });

  it('names the channel consistently so tabs meet on it', () => {
    const gm = broadcastAdapter();

    gm.onValueChange('k', noop);

    expect(FakeChannel.open[0]?.name).toBe(BROADCAST_CHANNEL);
  });

  it('writes normally when nothing is watching', async () => {
    const gm = broadcastAdapter();

    await gm.setValue('k', 1);

    expect(await gm.getValue('k', null)).toBe(1);
    expect(FakeChannel.open).toHaveLength(0);
  });

  it('degrades to a no-op subscription with no BroadcastChannel', async () => {
    const gm = createGmAdapter(greasemonkeySource());
    const seen = vi.fn();

    const off = gm.onValueChange('k', seen);
    await gm.setValue('k', 'new');
    off();

    expect(seen).not.toHaveBeenCalled();
  });
});
