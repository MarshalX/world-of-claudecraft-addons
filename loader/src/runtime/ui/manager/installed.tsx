// The Installed pane: every addon the registry holds, with its enable toggle.
//
// Pure render. The state it draws is loaded by manager/store.ts, so this file
// has no effects and no fetch of its own.

import type { InstalledAddon } from '../../../shared/protocol.ts';
import { ErrorNote } from './error-note.tsx';
import type { InstalledState } from './store.ts';
import { UI_TEXT } from './strings.ts';

interface RowProps {
  addon: InstalledAddon;
  onToggle: (fqid: string, on: boolean) => void;
  onOpen: (fqid: string) => void;
}

function toggleLabel(enabled: boolean): string {
  if (enabled) {
    return UI_TEXT.enabled;
  }
  return UI_TEXT.disabled;
}

function AddonRow(props: RowProps) {
  const { addon } = props;
  return (
    <li className="woc-row">
      <div className="woc-row-main">
        <span className="woc-row-name">{addon.manifest.name}</span>
        <span className="woc-row-meta">
          {addon.manifest.version} {UI_TEXT.by} {addon.manifest.author}
        </span>
        <span className="woc-row-desc">{addon.manifest.description}</span>
      </div>
      <div className="woc-row-actions">
        <button
          type="button"
          className="woc-btn"
          aria-label={`${UI_TEXT.configure} ${addon.manifest.name}`}
          onClick={() => {
            props.onOpen(addon.fqid);
          }}
        >
          {UI_TEXT.configure}
        </button>
        <label className="woc-toggle">
          <input
            type="checkbox"
            checked={addon.enabled}
            onChange={(event) => {
              props.onToggle(addon.fqid, (event.currentTarget as HTMLInputElement).checked);
            }}
          />
          <span>{toggleLabel(addon.enabled)}</span>
        </label>
      </div>
    </li>
  );
}

interface InstalledPaneProps {
  state: InstalledState;
  onToggle: (fqid: string, on: boolean) => void;
  onOpen: (fqid: string) => void;
}

export function InstalledPane(props: InstalledPaneProps) {
  const { state } = props;

  if (state.status === 'idle' || state.status === 'loading') {
    return <p className="woc-note">{UI_TEXT.installedLoading}</p>;
  }
  // A failure with no message is the unreachable-store case, which the store
  // reports without one because there is no error to quote: nothing was tried.
  if (state.status === 'failed' && state.rows.length === 0) {
    return <p className="woc-note woc-note-bad">{state.error ?? UI_TEXT.installedUnreachable}</p>;
  }
  if (state.rows.length === 0) {
    return <p className="woc-note">{UI_TEXT.installedEmpty}</p>;
  }

  return (
    <>
      <ErrorNote error={state.error} />
      <ul className="woc-list">
        {state.rows.map((addon) => (
          <AddonRow
            key={addon.fqid}
            addon={addon}
            onToggle={props.onToggle}
            onOpen={props.onOpen}
          />
        ))}
      </ul>
    </>
  );
}
