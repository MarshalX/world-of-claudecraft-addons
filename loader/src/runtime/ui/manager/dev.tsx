// The Dev pane: the two switches that decide whether the local source exists,
// plus the freeze.
//
// Pure render over dev-store.ts. This is the surface that makes an addon
// editable without a publish step: turn the server on, install it from Browse
// once, and from then on a save is a reload.
//
// The freeze is the one control here backed by neither the store nor the host.
// It belongs on this pane rather than on its own because it is a tool for the
// person WRITING an addon, which is what everything else here is for, and it is
// the only tab a player has no reason to be on.
//
// It used to list what the server offered, with an Install on each row. That was
// right while it was the only way to install anything, and it is duplication now
// that Browse exists: dev mode merges the local source into the marketplace
// list, so Browse already shows those rows, with the same install confirmation
// and the same source badge as everything else. Two lists of one thing go out of
// step, and the one with fewer eyes on it is the one that rots. What is left
// here is what nothing else owns.

import { useState } from 'preact/hooks';
import type { FreezeControl } from '../../freeze.ts';
import type { DevPaneState, DevStore } from './dev-store.ts';
import { ErrorNote } from './error-note.tsx';
import { UI_TEXT } from './strings.ts';

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}

function Toggle(props: ToggleProps) {
  return (
    <label className="woc-toggle">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => {
          props.onChange((event.currentTarget as HTMLInputElement).checked);
        }}
      />
      <span>{props.label}</span>
    </label>
  );
}

/**
 * The freeze switch, which is the one control here that is not a dev setting.
 *
 * It keeps its own copy of the state because the module in `runtime/freeze.ts` is
 * the authority and DELIBERATELY has nothing to repaint the manager with: the
 * switch never reaches the host, never reaches a store, and is never persisted,
 * so a reload is what unfreezes. The two copies cannot drift, since this is the
 * only thing that writes it.
 *
 * In the Dev tab rather than on a frame's own title bar because it freezes every
 * addon at once, and the button that stills the window it lives on has no honest
 * place to report that it also stilled three others.
 */
function FreezeToggle(props: { freeze: FreezeControl }) {
  const [frozen, setFrozen] = useState(props.freeze.frozen());
  return (
    <>
      <Toggle
        label={UI_TEXT.devFreeze}
        checked={frozen}
        onChange={(on) => {
          props.freeze.set(on);
          setFrozen(on);
        }}
      />
      <p className="woc-note">{UI_TEXT.devFreezeNote}</p>
    </>
  );
}

/** The last index read, or a plain note that there has not been one. */
function lastRead(polledAt: number | null, format: (at: number) => string): string {
  if (polledAt === null) {
    return UI_TEXT.devNever;
  }
  return format(polledAt);
}

function Readout(props: { state: DevPaneState; format: (at: number) => string }) {
  const { dev } = props.state;
  if (dev === null) {
    return null;
  }
  return (
    <dl className="woc-kv-list">
      <div className="woc-kv">
        <dt>{UI_TEXT.devOrigin}</dt>
        <dd>{dev.origin}</dd>
      </div>
      <div className="woc-kv">
        <dt>{UI_TEXT.devLastRead}</dt>
        <dd>{lastRead(dev.polledAt, props.format)}</dd>
      </div>
    </dl>
  );
}

/** Where the addons this server offers actually are, now that they are in Browse. */
function WhereToInstall(props: { enabled: boolean }) {
  if (props.enabled) {
    return <p className="woc-note">{UI_TEXT.devInBrowse}</p>;
  }
  return <p className="woc-note">{UI_TEXT.devOff}</p>;
}

interface LocalServerProps {
  state: DevPaneState;
  store: DevStore;
  /** Re-evaluate every running addon, whatever its source. */
  onReloadAll: () => void;
  format: (at: number) => string;
}

/** Everything that needs the bridge, which is everything except the freeze. */
function LocalServer(props: LocalServerProps) {
  const { state, store } = props;

  if (state.status === 'failed' && state.dev === null) {
    return <p className="woc-note woc-note-bad">{UI_TEXT.devUnreachable}</p>;
  }

  // `dev` is non-null in this branch: the failed-with-nothing-read case returned
  // above, and every other state carries a reading.
  const { dev } = state;
  const enabled = dev?.enabled === true;

  return (
    <>
      <p className="woc-note">{UI_TEXT.devIntro}</p>

      <Toggle label={UI_TEXT.devEnabled} checked={enabled} onChange={store.setEnabled} />
      <Toggle
        label={UI_TEXT.devHotReload}
        checked={dev?.hotReload === true}
        onChange={store.setHotReload}
      />
      <p className="woc-note">{UI_TEXT.devHotReloadNote}</p>

      <Readout state={state} format={props.format} />
      <ErrorNote error={state.error} />

      <div className="woc-row-actions">
        <button type="button" className="woc-btn" disabled={!enabled} onClick={store.refresh}>
          {UI_TEXT.devRefresh}
        </button>
        <button type="button" className="woc-btn" onClick={props.onReloadAll}>
          {UI_TEXT.devReloadAll}
        </button>
      </div>

      <WhereToInstall enabled={enabled} />
    </>
  );
}

interface DevPaneProps extends LocalServerProps {
  freeze: FreezeControl;
}

/**
 * The freeze is OUTSIDE the local server's own branch, deliberately.
 *
 * Everything above it needs the bridge and says so when there is none; freezing
 * is pure runtime and works with no host at all. A loader whose handshake failed
 * is one of the times a still window is most worth having, so the switch is not
 * behind the note that says dev mode is unavailable.
 */
export function DevPane(props: DevPaneProps) {
  return (
    <section className="woc-dev">
      <LocalServer
        state={props.state}
        store={props.store}
        onReloadAll={props.onReloadAll}
        format={props.format}
      />
      <FreezeToggle freeze={props.freeze} />
    </section>
  );
}
