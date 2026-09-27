// The Dev pane: the two switches that decide whether the local source exists, plus the freeze.
// Installing from the local source goes through Browse, so this pane lists no addons.

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
 * The freeze switch. It keeps its own copy of the state because `runtime/freeze.ts` has nothing to
 * repaint the manager with; this is the only writer, so the copies cannot drift. Never persisted,
 * so a reload unfreezes.
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

  // `dev` is still null while the first read is in flight.
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
 * The freeze sits OUTSIDE the local server's branch: it needs no bridge, and a failed handshake is
 * when a still window is most useful.
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
