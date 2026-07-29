// The Dev pane: the local dev server, and what it offers.
//
// Pure render over dev-store.ts. This is the surface that makes an addon
// editable without a publish step: turn the server on, install from it once, and
// from then on a save is a reload.
//
// It is deliberately not the Browse pane. Browse is cross-marketplace search
// with permissions and update badges; this is one source, always the same one,
// with the two switches that decide whether it exists at all.

import { LOCAL_ID, fqid as makeFqid } from '../../../shared/marketplace.ts';
import type { MarketplaceEntry } from '../../../shared/protocol.ts';
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

/** Install or Uninstall, from the registry rather than from the index. */
function rowAction(installed: boolean) {
  if (installed) {
    return { label: UI_TEXT.uninstall, className: 'woc-btn' };
  }
  return { label: UI_TEXT.devInstall, className: 'woc-btn woc-btn-primary' };
}

function OfferedRow(props: { entry: MarketplaceEntry; state: DevPaneState; store: DevStore }) {
  const { entry, state } = props;
  const fqid = makeFqid(LOCAL_ID, entry.id);
  const installed = state.installed.has(fqid);
  const busy = state.busy === fqid;
  const action = rowAction(installed);

  return (
    <li className="woc-row">
      <div className="woc-row-main">
        <span className="woc-row-name">{entry.name}</span>
        <span className="woc-row-meta">
          {entry.version} {UI_TEXT.by} {entry.author}
        </span>
        <span className="woc-row-desc">{entry.description}</span>
      </div>
      <div className="woc-row-actions">
        <button
          type="button"
          className={action.className}
          disabled={busy}
          aria-label={`${action.label} ${entry.name}`}
          onClick={() => {
            if (installed) {
              props.store.uninstall(fqid);
            } else {
              props.store.install(entry.id);
            }
          }}
        >
          {action.label}
        </button>
      </div>
    </li>
  );
}

function Offered(props: { state: DevPaneState; store: DevStore }) {
  const { state } = props;
  if (state.dev?.enabled !== true) {
    return <p className="woc-note">{UI_TEXT.devOff}</p>;
  }
  if (state.offered.length === 0) {
    // Only reached with no error, so the server answered and the folder is empty.
    return <p className="woc-note">{UI_TEXT.devEmpty}</p>;
  }
  return (
    <ul className="woc-list">
      {state.offered.map((entry) => (
        <OfferedRow key={entry.id} entry={entry} state={state} store={props.store} />
      ))}
    </ul>
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

interface DevPaneProps {
  state: DevPaneState;
  store: DevStore;
  /** Re-evaluate every running addon, whatever its source. */
  onReloadAll: () => void;
  format: (at: number) => string;
}

export function DevPane(props: DevPaneProps) {
  const { state, store } = props;

  if (state.status === 'failed' && state.dev === null) {
    return <p className="woc-note woc-note-bad">{UI_TEXT.devUnreachable}</p>;
  }

  // `dev` is non-null in this branch: the failed-with-nothing-read case returned
  // above, and every other state carries a reading.
  const { dev } = state;
  const enabled = dev?.enabled === true;

  return (
    <section className="woc-dev">
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

      <h4 className="woc-subhead">{UI_TEXT.devHeading}</h4>
      <Offered state={state} store={store} />
    </section>
  );
}
