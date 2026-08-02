// Poll the dev server for entry sources that changed, and say which.
//
// This is what makes editing an addon a save rather than a reinstall. It watches
// only addons installed from the local source and only while hot reload is on,
// so a player who never turns dev mode on never issues one of these requests.
//
// It watches BODIES, not the index. A new addon directory or an edited manifest
// still needs an explicit refresh, because index polling would emit a
// market.changed on every tick and repaint the manager continuously to report
// that nothing moved. An edit to running code is the case worth a timer; an edit
// to the set of addons that exist is a thing the author just did on purpose and
// can ask for.
//
// Each tick is scheduled after the previous one finished rather than on an
// interval, so a dev server that has stopped answering cannot accumulate
// overlapping polls behind a timeout.

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

/**
 * One addon: has anything it loads moved since the last read?
 *
 * The entry body and every declared data file. A regenerated table is precisely
 * the edit this watcher exists for, and an addon that reads it once at load has
 * no other way to pick it up. Still not the INDEX: a new addon directory or an
 * edited manifest is a thing the author just did on purpose and can refresh.
 *
 * The conditional GET is the whole mechanism. An unchanged file answers 304 with
 * no body, so the steady state is a handful of empty responses a second against
 * localhost, capped by the schema at eight data files per addon.
 */
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
  // A cell, ANNOTATED: noUnnecessaryConditions reads both a `let` and an
  // inferred `{ moved: false }` as the literal type and calls the test below
  // always-falsy, so the annotation is what makes the check mean anything.
  const seen: { moved: boolean } = { moved: false };
  // One request at a time, like the addons above it: the dev server is a single
  // process on loopback and the point of the poll is to be cheap, not fast.
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
 * A repeating task that reschedules itself after each run finishes.
 *
 * Not `setInterval`: a dev server that has stopped answering would otherwise
 * accumulate overlapping polls behind a timeout.
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
  // A poll in flight when the interval elapses would otherwise start a second
  // one against the same URLs.
  let polling = false;

  const poll = async (): Promise<void> => {
    if (polling || disposed) {
      return;
    }
    polling = true;
    try {
      // One request at a time: the dev server is a single process on loopback
      // and the point of the poll is to be cheap, not fast.
      await inSeries(await watched(deps), (fqid) => checkOne(deps, fqid));
    } catch (err) {
      // One failed tick is the ordinary state of a dev server that is not
      // running yet. It costs a line, never the timer.
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
