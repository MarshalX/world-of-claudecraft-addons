// Which addons are running, and keeping that in step with the registry.
//
// The registry says what a player wants. This says what is actually evaluated,
// and the two are not the same set: an addon can be enabled and still not
// running because it declares an apiVersion this loader does not implement,
// because it is restricted to another channel, or because it threw on its first
// line. Those cases are states with a reason attached rather than a silently
// missing addon, so the manager can say which one happened.
//
// A failure does NOT flip the persisted enable flag. Auto-disabling would throw
// away what the player asked for to record something the loader already knows,
// and a failure that came from the game not being ready yet would then need a
// manual re-enable to recover from. The addon stays enabled and stays stopped,
// and Reload is what tries again.
//
// Every operation runs on one queue. Reconciling, reloading, and a hot-reload
// event arriving mid-reconcile would otherwise interleave two disposals of the
// same bag or two evaluations of the same source.

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

/**
 * Whether this loader implements the addon's API major.
 *
 * Equality rather than "at most", because a major is exactly the thing that gets
 * bumped when something an addon relies on changes shape. When this loader grows
 * a second major it will accept a set, and that set will be a decision, not an
 * inequality that silently included a version nobody tested.
 */
function implementsApi(apiVersion: number): boolean {
  return apiVersion === API_VERSION;
}

/**
 * Whether this loader has grown far enough for what the addon uses.
 *
 * The minor is the opposite comparison to the major, and deliberately so: a
 * bigger one is FINE, because the surface only ever grew. What must be refused is
 * an addon needing more than is here, which before this existed was accepted and
 * run, then threw against an undefined member on whatever frame first reached it.
 * That is the case worth catching, since it never surfaced as a load failure: the
 * addon reported running and broke silently.
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
 * What has to be identical for a running addon to be left alone.
 *
 * The whole manifest, not just its version, and the version alone was wrong. A
 * marketplace serves one manifest per ref rather than per version, so the same
 * version string can carry different declarations: the dev server reads the file
 * from disk on every request, and `MarketApi.setRef` moves a source to another tag
 * whose manifest an author edited without bumping anything.
 *
 * That matters because the manifest is not decoration. The settings and keybind
 * declarations are what the addon's own `woc.settings` and `woc.keys` are BUILT
 * from, and a value is hydrated only for a declared id, so an addon left running
 * across a manifest change can never see a setting that manifest added. It reads
 * as a control that does nothing, which is what was reported.
 *
 * Serialised whole rather than field by field for the reason `declarationsOf` in
 * the manager is: a hand-listed comparison has to be extended every time the schema
 * grows a field, and forgetting is silent. An unchanged manifest serialises
 * identically, so nothing restarts for a reconcile that found no news.
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

/**
 * Drain one addon's bag and take it off the live map.
 *
 * A bag drains its own throwing teardowns, so reaching the catch means disposal
 * itself broke. The addon is off the map before that point either way, which is
 * what stops it being disposed twice.
 */
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

/**
 * What is evaluated right now, and the status the manager reads.
 *
 * Held together because they change together: an addon stops and gains a reason
 * in the same step, and nothing outside should be able to move one without the
 * other.
 */
function createRunningSet(deps: SupervisorDeps) {
  const live: LiveAddons = new Map();
  const { states, setStatus } = createStatusBoard(deps.onChange);
  let disposed = false;

  /**
   * A loader-originated line in the addon's own tail.
   *
   * It goes there rather than to the console because the addon's page in the
   * manager is where someone looks when it did not start, and a failure to load
   * is the one message that addon will never write itself.
   */
  const note = (fqid: string, text: string): void => {
    deps.shared.logs.append(fqid, 'error', deps.shared.wallClock(), text);
  };

  const stop = (fqid: string): void => {
    stopOne(live, fqid, note);
  };

  /**
   * Fetch and evaluate one addon.
   *
   * The disposed check is repeated after each await: a page navigating away
   * mid-fetch must not leave a closure running against DOM the loader has
   * already torn down.
   */
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
 * One queue for every mutation.
 *
 * Reconciling, reloading, and a hot-reload event arriving mid-reconcile would
 * otherwise interleave two disposals of one bag or two evaluations of one file.
 * Rejections are absorbed at the tail so a failed operation cannot poison the
 * chain for the next one.
 */
function createQueue(onFailure: (err: unknown) => void) {
  let queue: Promise<void> = Promise.resolve();
  return (run: () => Promise<void>): Promise<void> => {
    queue = queue.then(run, run).catch(onFailure);
    return queue;
  };
}

type RunningSet = ReturnType<typeof createRunningSet>;

/**
 * Stop everything the registry no longer wants running.
 *
 * Before anything is started, so an addon that was updated releases its keybinds
 * and frames before the new copy claims the same ids.
 */
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
    // In registry order rather than concurrently: the first addon to claim a
    // keybind should be the first one listed, not the first one whose source
    // happened to resolve.
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
      // reconcile is what turns this into a status; reloading an addon that
      // cannot run here should not report it as running.
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
