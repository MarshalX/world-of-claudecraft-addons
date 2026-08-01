// @vitest-environment happy-dom

// Which addons are actually running.
//
// The registry says what the player wants; this says what happened. They are not
// the same set, and the whole value of the module is that the difference is a
// state with a reason rather than an addon that is silently absent.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupervisor, incompatibility } from '../loader/src/runtime/supervisor.ts';
import type { InstalledAddon } from '../loader/src/shared/protocol.ts';
import type { AddonManifest } from '../loader/src/shared/schema.ts';
import { createSharedServices } from './fakes/shared-services.ts';

const FQID = 'official/combat-meter';
const OTHER = 'official/cooldowns';

function manifest(overrides: Partial<AddonManifest> = {}): AddonManifest {
  return {
    id: 'combat-meter',
    name: 'Combat Meter',
    version: '1.2.0',
    apiVersion: 1,
    // Present by default so the case that DROPS it is testing something.
    apiMinor: 1,
    author: 'MarshalX',
    description: 'Rolling damage per second.',
    entry: 'main.js',
    keybinds: [{ id: 'toggle', label: 'Toggle', default: 'Alt+KeyD' }],
    ...overrides,
  };
}

function row(overrides: Partial<InstalledAddon> = {}): InstalledAddon {
  return {
    fqid: FQID,
    marketplace: 'official',
    manifest: manifest(),
    enabled: true,
    pin: null,
    ...overrides,
  };
}

const teardown: Array<() => void> = [];

afterEach(() => {
  for (const stop of teardown.splice(0)) {
    stop();
  }
  document.body.innerHTML = '';
});

interface Options {
  rows?: InstalledAddon[];
  sources?: Record<string, string>;
  channel?: 'live' | 'pbe' | 'pbe2';
  bridged?: boolean;
}

/** Absent means bridged; only an explicit false stands for a failed handshake. */
function registryFor<T>(options: Options, registry: T): T | null {
  if (options.bridged === false) {
    return null;
  }
  return registry;
}

function open(options: Options = {}) {
  const state = { rows: options.rows ?? [row()] };
  const sources = options.sources ?? { [FQID]: 'woc.ui.window({ id: "meter" });' };
  const harness = createSharedServices(document);
  teardown.push(harness.dispose);

  const registry = {
    list: () => Promise.resolve(state.rows),
    source: (fqid: string) => {
      const body = sources[fqid];
      if (body === undefined) {
        return Promise.reject(new Error(`no cached source for ${fqid}`));
      }
      return Promise.resolve(body);
    },
  };

  const onChange = vi.fn();
  const supervisor = createSupervisor({
    shared: harness.shared,
    registry: registryFor(options, registry),
    channel: options.channel ?? 'pbe',
    onChange,
  });
  teardown.push(supervisor.dispose);

  const status = (fqid = FQID) => supervisor.statuses().find((entry) => entry.fqid === fqid);
  return { supervisor, harness, state, sources, onChange, status };
}

describe('reconciling', () => {
  it('starts an enabled addon', async () => {
    const { supervisor, status } = open();

    await supervisor.sync();

    expect(supervisor.running()).toEqual([FQID]);
    expect(status()).toMatchObject({ state: 'running', error: null });
  });

  it('does not start a disabled one', async () => {
    const { supervisor, status } = open({ rows: [row({ enabled: false })] });

    await supervisor.sync();

    expect(supervisor.running()).toEqual([]);
    expect(status()).toMatchObject({ state: 'stopped' });
  });

  it('stops one the player just disabled', async () => {
    const { supervisor, state } = open();
    await supervisor.sync();

    state.rows = [row({ enabled: false })];
    await supervisor.sync();

    expect(supervisor.running()).toEqual([]);
    expect(document.querySelectorAll('.woc-frame, .woc-window')).toHaveLength(0);
  });

  // Otherwise the second sync would evaluate the file again and the addon would
  // have two windows, two keybinds, and two of every subscription.
  it('leaves a running addon alone on a repeat sync', async () => {
    const { supervisor, sources } = open();
    await supervisor.sync();

    sources[FQID] = 'throw new Error("should not be re-evaluated");';
    await supervisor.sync();

    expect(supervisor.running()).toEqual([FQID]);
  });

  // An update while the addon is running has to restart it, or the player is
  // still running the version they just replaced.
  it('restarts one whose version changed underneath it', async () => {
    const { supervisor, state, sources, harness } = open();
    await supervisor.sync();

    state.rows = [row({ manifest: manifest({ version: '2.0.0' }) })];
    sources[FQID] = 'woc.log("v2");';
    await supervisor.sync();

    expect(supervisor.running()).toEqual([FQID]);
    // Both halves: the new body ran, and the old copy's window went with it
    // rather than being left on screen by a closure nothing holds any more.
    expect(harness.shared.logs.tail(FQID).map((entry) => entry.text)).toContain('v2');
    expect(document.querySelectorAll('.woc-frame, .woc-window')).toHaveLength(0);
  });

  // And a version bump is not what makes a manifest new. A marketplace serves one
  // manifest per REF, so the dev server hands back whatever is on disk and a moved
  // tag hands back another author's edit, both under the version already installed.
  //
  // It matters because the declarations are what `woc.settings` and `woc.keys` are
  // built from, and a value hydrates only for a declared id: an addon left running
  // across this change can never see the setting the change added, which reads to
  // the player as a control that does nothing.
  it('restarts one whose declarations changed under the same version', async () => {
    const { supervisor, state, sources, harness } = open();
    await supervisor.sync();

    state.rows = [
      row({
        manifest: manifest({
          settings: [
            { id: 'layout', type: 'select', label: 'Layout', default: 'bars', options: ['bars'] },
          ],
        }),
      }),
    ];
    sources[FQID] = 'woc.log("relisted");';
    await supervisor.sync();

    expect(harness.shared.logs.tail(FQID).map((entry) => entry.text)).toContain('relisted');
  });

  it('forgets an addon that was uninstalled', async () => {
    const { supervisor, state } = open();
    await supervisor.sync();

    state.rows = [];
    await supervisor.sync();

    expect(supervisor.statuses()).toEqual([]);
  });

  it('runs several addons independently', async () => {
    const { supervisor } = open({
      rows: [row(), row({ fqid: OTHER, manifest: manifest({ id: 'cooldowns' }) })],
      sources: { [FQID]: 'woc.log(1);', [OTHER]: 'woc.log(2);' },
    });

    await supervisor.sync();

    expect([...supervisor.running()].sort()).toEqual([OTHER, FQID].sort());
  });
});

describe('an addon that will not load', () => {
  it('records the failure with the reason', async () => {
    const { supervisor, status } = open({ sources: { [FQID]: 'throw new Error("boom");' } });

    await supervisor.sync();

    expect(status()).toMatchObject({ state: 'failed' });
    expect(status()?.error).toContain('boom');
  });

  // Auto-disabling would throw away what the player asked for to record
  // something the loader already knows, and a failure caused by the game not
  // being ready yet would then need a manual re-enable to recover from.
  it('leaves it enabled in the registry', async () => {
    const { supervisor, state } = open({ sources: { [FQID]: 'throw new Error("boom");' } });

    await supervisor.sync();

    expect(state.rows[0]?.enabled).toBe(true);
  });

  it('writes the reason into the addon own log tail', async () => {
    const { supervisor, harness } = open({ sources: { [FQID]: 'throw new Error("boom");' } });

    await supervisor.sync();

    expect(
      harness.shared.logs
        .tail(FQID)
        .map((entry) => entry.text)
        .join(' '),
    ).toContain('boom');
  });

  it('does not stop the addons around it from starting', async () => {
    const { supervisor } = open({
      rows: [row(), row({ fqid: OTHER, manifest: manifest({ id: 'cooldowns' }) })],
      sources: { [FQID]: 'throw new Error("boom");', [OTHER]: 'woc.log(2);' },
    });

    await supervisor.sync();

    expect(supervisor.running()).toEqual([OTHER]);
  });

  it('reports a missing cached source as a failure rather than silence', async () => {
    const { supervisor, status } = open({ sources: {} });

    await supervisor.sync();

    expect(status()?.error).toContain('no cached source');
  });
});

describe('an addon that cannot run here', () => {
  it('reports an apiVersion this loader does not implement', async () => {
    const { supervisor, status } = open({ rows: [row({ manifest: manifest({ apiVersion: 2 }) })] });

    await supervisor.sync();

    expect(supervisor.running()).toEqual([]);
    expect(status()).toMatchObject({ state: 'incompatible' });
    expect(status()?.error).toContain('loader API version 2');
  });

  it('reports a channel restriction', async () => {
    const { supervisor, status } = open({
      rows: [row({ manifest: manifest({ channels: ['live'] }) })],
      channel: 'pbe',
    });

    await supervisor.sync();

    expect(status()).toMatchObject({ state: 'incompatible' });
    expect(status()?.error).toContain('pbe');
  });

  it('runs one whose channel list includes this host', async () => {
    const { supervisor } = open({
      rows: [row({ manifest: manifest({ channels: ['pbe', 'pbe2'] }) })],
      channel: 'pbe',
    });

    await supervisor.sync();

    expect(supervisor.running()).toEqual([FQID]);
  });

  // Absent means every channel, which is what most manifests will say.
  it('runs one that declares no channels', async () => {
    const { supervisor } = open({ channel: 'live' });

    await supervisor.sync();

    expect(supervisor.running()).toEqual([FQID]);
  });

  // Equality rather than "at most": a major is exactly the thing bumped when
  // something an addon relies on changes shape.
  it.each([0, 2, 99])('refuses apiVersion %i', (apiVersion) => {
    expect(incompatibility(row({ manifest: manifest({ apiVersion }) }), 'pbe')).toContain(
      'loader API version',
    );
  });

  /**
   * The minor is the OPPOSITE comparison to the major, and the asymmetry is the
   * whole design: the surface only grows within a major, so a loader further
   * ahead is fine and one behind is not.
   *
   * What this refusal replaces is the silent case. An addon needing a member this
   * loader lacks used to be accepted, started, and reported running, and then
   * threw against an undefined member on whatever frame first reached it, with
   * nothing badging it because only the LOAD is wrapped.
   */
  it('refuses an addon needing a minor beyond what this loader implements', () => {
    const reason = incompatibility(row({ manifest: manifest({ apiMinor: 99 }) }), 'pbe');

    expect(reason).toContain('needs loader API 1.99');
    expect(reason).toContain('Update the loader');
  });

  it('accepts an addon needing a minor this loader has grown past', () => {
    expect(incompatibility(row({ manifest: manifest({ apiMinor: 0 }) }), 'pbe')).toBeNull();
  });

  // Absent reads as 0. An addon published before the minor existed was written
  // against 1.0, and must not be refused by a field its author never saw.
  it('accepts an addon that declares no minor at all', () => {
    const { apiMinor: _dropped, ...noMinor } = manifest();

    expect(incompatibility(row({ manifest: noMinor }), 'pbe')).toBeNull();
  });
});

describe('reload', () => {
  it('re-evaluates the current body', async () => {
    const { supervisor, sources, harness } = open({ sources: { [FQID]: 'woc.log("v1");' } });
    await supervisor.sync();

    sources[FQID] = 'woc.log("v2");';
    await supervisor.reload(FQID);

    const text = harness.shared.logs.tail(FQID).map((entry) => entry.text);
    expect(text).toContain('v1');
    expect(text).toContain('v2');
  });

  // The reason a hot reload is a reload rather than a second evaluation: the old
  // closure's window has to go before the new one puts its own up.
  it('disposes the old copy before the new one runs', async () => {
    const { supervisor } = open();
    await supervisor.sync();

    await supervisor.reload(FQID);

    expect(document.querySelectorAll('.woc-frame, .woc-window')).toHaveLength(1);
  });

  it('recovers an addon that failed to load', async () => {
    const { supervisor, sources, status } = open({ sources: { [FQID]: 'throw new Error("x");' } });
    await supervisor.sync();
    expect(status()?.state).toBe('failed');

    sources[FQID] = 'woc.log("fixed");';
    await supervisor.reload(FQID);

    expect(status()).toMatchObject({ state: 'running', error: null });
  });

  it('does nothing for an addon the player has disabled', async () => {
    const { supervisor } = open({ rows: [row({ enabled: false })] });

    await supervisor.reload(FQID);

    expect(supervisor.running()).toEqual([]);
  });

  it('reloads every running addon at once', async () => {
    const { supervisor, harness } = open({
      rows: [row(), row({ fqid: OTHER, manifest: manifest({ id: 'cooldowns' }) })],
      sources: { [FQID]: 'woc.log("a");', [OTHER]: 'woc.log("b");' },
    });
    await supervisor.sync();

    await supervisor.reloadAll();

    expect(harness.shared.logs.tail(FQID)).toHaveLength(2);
    expect(harness.shared.logs.tail(OTHER)).toHaveLength(2);
  });
});

// Reconciling, reloading, and a hot-reload event arriving mid-reconcile would
// otherwise interleave two disposals of one bag or two evaluations of one file.
describe('serialization', () => {
  it('does not start the same addon twice when two syncs overlap', async () => {
    const { supervisor } = open();

    await Promise.all([supervisor.sync(), supervisor.sync(), supervisor.sync()]);

    expect(supervisor.running()).toEqual([FQID]);
    expect(document.querySelectorAll('.woc-frame, .woc-window')).toHaveLength(1);
  });

  it('survives an operation that failed and keeps serving the next', async () => {
    const { supervisor, sources } = open({ sources: { [FQID]: 'throw new Error("boom");' } });

    await supervisor.sync();
    sources[FQID] = 'woc.log("ok");';
    await supervisor.reload(FQID);

    expect(supervisor.running()).toEqual([FQID]);
  });
});

describe('without a bridge', () => {
  // Every addon's source lives behind the registry, so a failed handshake means
  // nothing can load. The manager still comes up, which is how a player finds
  // out.
  it('starts nothing and reports no status', async () => {
    const { supervisor } = open({ bridged: false });

    await supervisor.sync();

    expect(supervisor.running()).toEqual([]);
    expect(supervisor.statuses()).toEqual([]);
  });
});

describe('dispose', () => {
  it('stops everything and takes its DOM with it', async () => {
    const { supervisor } = open();
    await supervisor.sync();

    supervisor.dispose();

    expect(supervisor.running()).toEqual([]);
    expect(document.querySelectorAll('.woc-frame, .woc-window')).toHaveLength(0);
  });

  // A page navigating away mid-fetch must not leave a closure running against
  // DOM the loader has already torn down.
  it('drops an addon whose source landed after disposal', async () => {
    let release = (_body: string): void => undefined;
    const harness = createSharedServices(document);
    teardown.push(harness.dispose);
    const supervisor = createSupervisor({
      shared: harness.shared,
      registry: {
        list: () => Promise.resolve([row()]),
        source: () =>
          new Promise<string>((resolve) => {
            release = resolve;
          }),
      },
      channel: 'pbe',
      onChange: vi.fn(),
    });

    const pending = supervisor.sync();
    supervisor.dispose();
    release('woc.ui.window({ id: "late" });');
    await pending;

    expect(supervisor.running()).toEqual([]);
    expect(document.querySelectorAll('.woc-frame, .woc-window')).toHaveLength(0);
  });
});
