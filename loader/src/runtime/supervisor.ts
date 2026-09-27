// Which addons are running, kept in step with the registry. An enabled addon that is not running
// carries a state and a reason, so the manager can say why.
//
// A failure does NOT flip the persisted enable flag: a failure caused by the game not being ready
// would then need a manual re-enable. Reload is what tries again.

import { API_MINOR, API_VERSION } from '../shared/api-version.ts';
import { describeError } from '../shared/diag.ts';
import type { Channel } from '../shared/hosts.ts';
import type { InstalledAddon, RegistryApi } from '../shared/protocol.ts';
import { inSeries } from '../shared/sequence.ts';
import type { SharedServices } from './api/index.ts';
import { type LoadedAddon, loadAddon } from './loader.ts';

type AddonState = 'running' | 'stopped' | 'failed' | 'incompatible';

interface AddonStatus {
  fqid: string;
  state: AddonState;
  /** Why it is not running, for the two states that have a reason. */
  error: string | null;
}

interface SupervisorDeps {
  shared: SharedServices;
  /** Null when the bridge never connected, which stops every addon from loading. */
  registry: Pick<RegistryApi, 'list' | 'source'> | null;
  channel: Channel;
  /** Called whenever a status changed, so the manager can repaint. */
  onChange: () => void;
}

interface Supervisor {
  /** Reconcile the running set against the registry. Safe to call repeatedly. */
  sync: () => Promise<void>;
  /** Stop, re-fetch, and re-evaluate one addon, whatever state it is in. */
  reload: (fqid: string) => Promise<void>;
  reloadAll: () => Promise<void>;
  statuses: () => readonly AddonStatus[];
  running: () => readonly string[];
  dispose: () => void;
}

/** Equality, not "at most": a major is what moves when a surface changes shape. */
function implementsApi(apiVersion: number): boolean {
  return apiVersion === API_VERSION;
}

/**
 * A newer loader minor is fine; an addon needing more than is here is refused, or it would report
 * running and then throw on an undefined member.
 */
function withinMinor(apiMinor: number | undefined): boolean {
  return (apiMinor ?? 0) <= API_MINOR;
}

/** Why this addon cannot run here, or null if nothing stops it. */
function incompatibility(row: InstalledAddon, channel: Channel): string | null {
  const { manifest } = row;
  if (!implementsApi(manifest.apiVersion)) {
    return `needs loader API version ${manifest.apiVersion}, this loader implements ${API_VERSION}`;
  }
  if (!withinMinor(manifest.apiMinor)) {
    return (
      `needs loader API ${manifest.apiVersion}.${manifest.apiMinor}, ` +
      `this loader implements ${API_VERSION}.${API_MINOR}. Update the loader.`
    );
  }
  const { channels } = manifest;
  if (channels !== undefined && !channels.includes(channel)) {
    return `is restricted to ${channels.join(', ')} and this is ${channel}`;
  }
  return null;
}

/**
 * What has to be identical for a running addon to be left alone: the whole manifest, not its
 * version. One version can carry different declarations (the dev server, `MarketApi.setRef`), and
 * `woc.settings` and `woc.keys` are built from them, so a stale addon never sees a new setting.
 * Serialised whole so a new schema field cannot be forgotten.
 */
function signature(row: InstalledAddon): string {
  return `${row.marketplace}@${JSON.stringify(row.manifest)}`;
}

/** What the manager reads, and the one write that changes it. */
function createStatusBoard(onChange: () => void) {
  const states = new Map<string, AddonStatus>();
  return {
    states,
    setStatus: (fqid: string, state: AddonState, error: string | null): void => {
      states.set(fqid, { fqid, state, error });
      onChange();
    },
  };
}

/** The live addon map, keyed by fqid. */
type LiveAddons = Map<string, { addon: LoadedAddon; signature: string }>;

/** Off the map before disposing, so a throwing disposal cannot be disposed twice. */
function stopOne(live: LiveAddons, fqid: string, note: (id: string, text: string) => void): void {
  const entry = live.get(fqid);
  if (entry === undefined) {
    return;
  }
  live.delete(fqid);
  try {
    entry.addon.dispose();
  } catch (err) {
    note(fqid, `disposal failed: ${describeError(err)}`);
  }
}

/** What is evaluated and its status, held together because they change in one step. */
function createRunningSet(deps: SupervisorDeps) {
  const live: LiveAddons = new Map();
  const { states, setStatus } = createStatusBoard(deps.onChange);
  let disposed = false;

  /** A loader line in the addon's own log, where someone looks when it did not start. */
  const note = (fqid: string, text: string): void => {
    deps.shared.logs.append(fqid, 'error', deps.shared.wallClock(), text);
  };

  const stop = (fqid: string): void => {
    stopOne(live, fqid, note);
  };

  /** The disposed check repeats after each await, for a page navigating away mid-fetch. */
  const start = async (row: InstalledAddon): Promise<void> => {
    const { registry } = deps;
    if (registry === null) {
      setStatus(row.fqid, 'failed', 'the loader is not connected to its storage');
      return;
    }
    try {
      const source = await registry.source(row.fqid);
      if (disposed) {
        return;
      }
      const addon = await loadAddon({ shared: deps.shared, row, source });
      if (disposed) {
        addon.dispose();
        return;
      }
      live.set(row.fqid, { addon, signature: signature(row) });
      setStatus(row.fqid, 'running', null);
    } catch (err) {
      const message = describeError(err);
      note(row.fqid, message);
      setStatus(row.fqid, 'failed', message);
    }
  };

  return {
    live,
    states,
    note,
    setStatus,
    stop,
    start,
    isDisposed: () => disposed,
    dispose: () => {
      disposed = true;
      for (const fqid of [...live.keys()]) {
        stop(fqid);
      }
      states.clear();
    },
  };
}

/**
 * One queue for every mutation, or a hot reload mid-reconcile interleaves two disposals of one
 * bag. Rejections are absorbed so one failure cannot poison the chain.
 */
function createQueue(onFailure: (err: unknown) => void) {
  let queue: Promise<void> = Promise.resolve();
  return (run: () => Promise<void>): Promise<void> => {
    queue = queue.then(run, run).catch(onFailure);
    return queue;
  };
}

type RunningSet = ReturnType<typeof createRunningSet>;

/** Runs before any start, so an updated addon releases its keybinds and frames first. */
function stopStale(set: RunningSet, byFqid: ReadonlyMap<string, InstalledAddon>): void {
  for (const [fqid, entry] of [...set.live]) {
    const row = byFqid.get(fqid);
    const wanted = row?.enabled === true && entry.signature === signature(row);
    if (!wanted) {
      set.stop(fqid);
      if (row === undefined) {
        set.states.delete(fqid);
      } else if (!row.enabled) {
        set.setStatus(fqid, 'stopped', null);
      }
    }
  }
}

/** What one registry row should be, given that nothing is running for it. */
async function settle(deps: SupervisorDeps, set: RunningSet, row: InstalledAddon): Promise<void> {
  if (!row.enabled) {
    if (!set.states.has(row.fqid)) {
      set.setStatus(row.fqid, 'stopped', null);
    }
    return;
  }
  const blocked = incompatibility(row, deps.channel);
  if (blocked !== null) {
    set.stop(row.fqid);
    set.setStatus(row.fqid, 'incompatible', `${row.manifest.name} ${blocked}`);
    return;
  }
  if (!set.live.has(row.fqid)) {
    await set.start(row);
  }
}

function createSupervisor(deps: SupervisorDeps): Supervisor {
  const set = createRunningSet(deps);
  const { live, states, note, stop, start } = set;

  /** Reconcile once. Called only from the queue. */
  const reconcile = async (): Promise<void> => {
    const { registry } = deps;
    if (registry === null || set.isDisposed()) {
      return;
    }
    const rows = await registry.list();
    stopStale(set, new Map(rows.map((row) => [row.fqid, row])));
    // In series, so the first addon to claim a keybind is the first listed, not the first fetched.
    await inSeries(rows, (row) => settle(deps, set, row));
    deps.onChange();
  };

  const enqueue = createQueue((err) => {
    note('loader', `a supervisor operation failed: ${describeError(err)}`);
  });

  const reloadOne = async (fqid: string): Promise<void> => {
    const { registry } = deps;
    if (registry === null || set.isDisposed()) {
      return;
    }
    stop(fqid);
    const row = (await registry.list()).find((candidate) => candidate.fqid === fqid);
    if (row === undefined || !row.enabled) {
      return;
    }
    if (incompatibility(row, deps.channel) !== null) {
      // reconcile turns this into a status rather than reporting it running.
      await reconcile();
      return;
    }
    await start(row);
  };

  return {
    sync: () => enqueue(reconcile),
    reload: (fqid) => enqueue(() => reloadOne(fqid)),

    reloadAll: () =>
      enqueue(async () => {
        for (const fqid of [...live.keys()]) {
          stop(fqid);
        }
        await reconcile();
      }),

    statuses: () => [...states.values()],
    running: () => [...live.keys()],

    dispose: set.dispose,
  };
}

export type { AddonState, AddonStatus, Supervisor, SupervisorDeps };
export { createSupervisor, implementsApi, incompatibility };
