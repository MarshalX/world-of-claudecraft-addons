// Polling the dev server for a body that moved.
//
// The mechanism is the conditional GET, so the test is about which requests are
// issued and what is emitted, not about timers: the poll is driven directly and
// the timer is checked separately. What must never happen is a reload emitted
// for a file nobody touched, because that is a running addon being torn down and
// rebuilt several times a second.

import { describe, expect, it, vi } from 'vitest';
import { createDevWatch } from '../loader/src/host/dev-watch.ts';
import { createFetcher } from '../loader/src/host/fetcher.ts';
import type { MarketService } from '../loader/src/host/marketplace.ts';
import { LOCAL, OFFICIAL } from '../loader/src/shared/marketplace.ts';
import type { HostEvent, InstalledAddon, MarketplaceEntry } from '../loader/src/shared/protocol.ts';
import { createFakeHttp, createFakeValues } from './fakes/http.ts';

const LOCAL_FQID = 'local/dev-harness';
const OFFICIAL_FQID = 'official/dps-meter';
const LOCAL_URL = 'http://localhost:5180/addons/dev-harness/main.js';
const OFFICIAL_URL =
  'https://raw.githubusercontent.com/MarshalX/world-of-claudecraft-addons/HEAD/addons/dps-meter/main.js';

const MANIFEST = {
  id: 'dev-harness',
  name: 'Dev Harness',
  version: '1.0.0',
  apiVersion: 1,
  author: 'MarshalX',
  description: 'Checks the API.',
  entry: 'main.js',
};

function row(fqid: string, enabled = true): InstalledAddon {
  return {
    fqid,
    marketplace: fqid.split('/')[0] as string,
    manifest: MANIFEST,
    enabled,
    pin: null,
  };
}

function indexRow(dir: string): MarketplaceEntry {
  return { ...MANIFEST, id: dir, path: `addons/${dir}` };
}

interface Options {
  rows?: InstalledAddon[];
  files?: Record<string, string>;
  dev?: { enabled: boolean; hotReload: boolean };
}

function open(options: Options = {}) {
  const http = createFakeHttp(
    options.files ?? { [LOCAL_URL]: 'v1', [OFFICIAL_URL]: 'official v1' },
  );
  const fetcher = createFetcher({ request: http.request, cache: createFakeValues() });
  const events: HostEvent[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;

  const market: Pick<MarketService, 'entry' | 'devSettings'> = {
    entry: (fqid) => {
      const dir = fqid.split('/')[1] as string;
      if (fqid.startsWith('local/')) {
        return Promise.resolve({ market: LOCAL, row: indexRow(dir) });
      }
      return Promise.resolve({ market: OFFICIAL, row: indexRow(dir) });
    },
    devSettings: () => Promise.resolve(options.dev ?? { enabled: true, hotReload: true }),
  };

  const watch = createDevWatch({
    registry: { list: () => Promise.resolve(options.rows ?? [row(LOCAL_FQID)]) },
    market,
    fetcher,
    emit: (event) => events.push(event),
    setTimer: (handler) => {
      const id = nextTimer;
      nextTimer += 1;
      timers.set(id, handler);
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
  });

  const reloads = () => events.filter((event) => event.k === 'addon.reload');
  return { watch, http, events, reloads, timers };
}

describe('polling', () => {
  // The first poll has nothing cached, so every body reads as new. That is the
  // right answer for a page that just loaded: the running copy came from the
  // registry cache and may be older than what is on disk.
  it('reports the first read of a body as a change', async () => {
    const { watch, reloads } = open();

    await watch.poll();

    expect(reloads()).toEqual([{ k: 'addon.reload', fqid: LOCAL_FQID }]);
  });

  // The steady state. A version that failed this would tear down and rebuild
  // every running addon twice a second.
  it('emits nothing for a file nobody touched', async () => {
    const { watch, reloads } = open();
    await watch.poll();

    await watch.poll();
    await watch.poll();

    expect(reloads()).toHaveLength(1);
  });

  it('emits a reload when the body changes', async () => {
    const { watch, http, reloads } = open();
    await watch.poll();

    http.put(LOCAL_URL, 'v2');
    await watch.poll();

    expect(reloads()).toHaveLength(2);
  });

  it('answers an unchanged body with a 304 rather than a body', async () => {
    const { watch, http } = open();
    await watch.poll();

    await watch.poll();

    expect(http.notModified()).toBe(1);
  });
});

describe('what is watched', () => {
  it('leaves addons from other sources alone', async () => {
    const { watch, http } = open({ rows: [row(LOCAL_FQID), row(OFFICIAL_FQID)] });

    await watch.poll();

    expect(http.calls).toEqual([LOCAL_URL]);
  });

  // A disabled addon has no closure to reload, so polling it is pure cost.
  it('leaves a disabled addon alone', async () => {
    const { watch, http } = open({ rows: [row(LOCAL_FQID, false)] });

    await watch.poll();

    expect(http.calls).toEqual([]);
  });

  // Index polling would emit a market.changed on every tick and repaint the
  // manager continuously to report that nothing moved.
  it('polls bodies and never the index', async () => {
    const { watch, http } = open();

    await watch.poll();

    expect(http.calls.every((url) => !url.endsWith('marketplace.json'))).toBe(true);
  });
});

describe('the timer', () => {
  it('runs only when dev mode and hot reload are both on', () => {
    const off = open({ dev: { enabled: true, hotReload: false } });
    off.watch.sync();
    expect(off.watch.isRunning()).toBe(false);

    const disabled = open({ dev: { enabled: false, hotReload: true } });
    disabled.watch.sync();
    expect(disabled.watch.isRunning()).toBe(false);
  });

  it('starts when both are on', async () => {
    const { watch } = open();

    watch.sync();
    await vi.waitFor(() => {
      expect(watch.isRunning()).toBe(true);
    });
  });

  it('stops when the settings change back', async () => {
    const settings = { enabled: true, hotReload: true };
    const { watch } = open({ dev: settings });
    watch.sync();
    await vi.waitFor(() => {
      expect(watch.isRunning()).toBe(true);
    });

    settings.hotReload = false;
    watch.sync();

    await vi.waitFor(() => {
      expect(watch.isRunning()).toBe(false);
    });
  });

  it('is idempotent, so a repeat sync does not stack timers', async () => {
    const { watch, timers } = open();

    watch.sync();
    await vi.waitFor(() => {
      expect(watch.isRunning()).toBe(true);
    });
    watch.sync();
    watch.sync();

    expect(timers.size).toBe(1);
  });

  it('stops on dispose', async () => {
    const { watch } = open();
    watch.sync();
    await vi.waitFor(() => {
      expect(watch.isRunning()).toBe(true);
    });

    watch.dispose();

    expect(watch.isRunning()).toBe(false);
  });

  it('will not start again after dispose', () => {
    const { watch } = open();
    watch.dispose();

    watch.sync();

    expect(watch.isRunning()).toBe(false);
  });
});

describe('a dev server that is not running', () => {
  // The ordinary state before `pnpm serve` is started. One failed tick costs a
  // diagnostic line, never the timer.
  it('emits nothing and keeps polling', async () => {
    const { watch, reloads, http } = open({ files: {} });

    await watch.poll();
    await watch.poll();

    expect(reloads()).toEqual([]);
    expect(http.calls).toHaveLength(2);
  });

  it('picks up again once it comes back', async () => {
    const { watch, reloads, http } = open({ files: {} });
    await watch.poll();

    http.put(LOCAL_URL, 'v1');
    await watch.poll();

    expect(reloads()).toHaveLength(1);
  });
});

describe('overlapping polls', () => {
  // A poll still in flight when the interval elapses must not start a second one
  // against the same URLs, or a slow server produces duplicate reloads.
  it('does not run two at once', async () => {
    const { watch, http } = open();

    await Promise.all([watch.poll(), watch.poll(), watch.poll()]);

    expect(http.calls).toEqual([LOCAL_URL]);
  });
});
