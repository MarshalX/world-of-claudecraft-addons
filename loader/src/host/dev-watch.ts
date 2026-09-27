// Poll the dev server for addon files that changed, and say which.
//
// Only local-source addons, and only while hot reload is on. It watches BODIES and data files,
// never the index: index polling would emit market.changed every tick and repaint the manager
// continuously. A new addon or edited manifest needs an explicit refresh.

import { describeError, diagError } from '../shared/diag.ts';
import { fileUrl, LOCAL_ID, splitFqid } from '../shared/marketplace.ts';
import type { HostEvent, RegistryApi } from '../shared/protocol.ts';
import { inSeries } from '../shared/sequence.ts';
import type { Fetcher } from './fetcher.ts';
import type { MarketService } from './marketplace.ts';

const DEFAULT_INTERVAL_MS = 2000;

interface DevWatchDeps {
  registry: Pick<RegistryApi, 'list'>;
  market: Pick<MarketService, 'entry' | 'devSettings'>;
  fetcher: Pick<Fetcher, 'get'>;
  emit: (event: HostEvent) => void;
  setTimer: (handler: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
  intervalMs?: number;
}

interface DevWatch {
  /** Re-read the dev settings and start or stop accordingly. Idempotent. */
  sync: () => void;
  /** Run one poll now, whatever the timer is doing. Resolves when it is done. */
  poll: () => Promise<void>;
  isRunning: () => boolean;
  dispose: () => void;
}

function isLocal(fqid: string): boolean {
  return splitFqid(fqid)?.marketplace === LOCAL_ID;
}

/** One addon: has its entry body or any declared data file moved since the last read? */
async function checkOne(deps: DevWatchDeps, fqid: string): Promise<void> {
  const found = await deps.market.entry(fqid);
  if (found === null) {
    return;
  }
  const { market, row } = found;
  const urls = [
    fileUrl(market, `${row.path}/${row.entry}`),
    ...(row.data ?? []).map((file) => fileUrl(market, `${row.path}/${file}`)),
  ];
  // Annotated: noUnnecessaryConditions narrows a `let` or an inferred `{ moved: false }` to
  // the literal and calls the test below always-falsy.
  const seen: { moved: boolean } = { moved: false };
  await inSeries(urls, async (url) => {
    const { changed } = await deps.fetcher.get(url);
    seen.moved = seen.moved || changed;
  });
  if (seen.moved) {
    deps.emit({ k: 'addon.reload', fqid });
  }
}

/** Every enabled addon that came from the dev source. */
async function watched(deps: DevWatchDeps): Promise<string[]> {
  const rows = await deps.registry.list();
  return rows.filter((row) => row.enabled && isLocal(row.fqid)).map((row) => row.fqid);
}

/**
 * A repeating task that reschedules itself after each run finishes. Not `setInterval`: a
 * server that stopped answering would pile up overlapping polls behind a timeout.
 */
function createTicker(deps: DevWatchDeps, run: () => Promise<void>) {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  let timer: number | null = null;
  let stopped = false;

  const stop = (): void => {
    if (timer !== null) {
      deps.clearTimer(timer);
      timer = null;
    }
  };

  const tick = (): void => {
    run()
      .catch(() => undefined)
      .finally(() => {
        if (timer !== null && !stopped) {
          timer = deps.setTimer(tick, intervalMs);
        }
      });
  };

  return {
    isRunning: () => timer !== null,
    stop,
    start: () => {
      if (timer === null && !stopped) {
        timer = deps.setTimer(tick, intervalMs);
      }
    },
    dispose: () => {
      stopped = true;
      stop();
    },
  };
}

function createDevWatch(deps: DevWatchDeps): DevWatch {
  let disposed = false;
  // Guards a manual `poll` overlapping a timed one.
  let polling = false;

  const poll = async (): Promise<void> => {
    if (polling || disposed) {
      return;
    }
    polling = true;
    try {
      // In series: the dev server is one process on loopback, and the poll is meant to be cheap.
      await inSeries(await watched(deps), (fqid) => checkOne(deps, fqid));
    } catch (err) {
      // A dev server that is not running yet fails every tick; that must not stop the timer.
      diagError('the dev-server poll failed', describeError(err));
    } finally {
      polling = false;
    }
  };

  const ticker = createTicker(deps, poll);

  return {
    poll,
    isRunning: ticker.isRunning,

    sync: () => {
      deps.market
        .devSettings()
        .then((settings) => {
          if (settings.enabled && settings.hotReload) {
            ticker.start();
          } else {
            ticker.stop();
          }
        })
        .catch((err: unknown) => {
          diagError('could not read the dev settings, leaving hot reload as it was', err);
        });
    },

    dispose: () => {
      disposed = true;
      ticker.dispose();
    },
  };
}

export type { DevWatch, DevWatchDeps };
export { createDevWatch, DEFAULT_INTERVAL_MS };
