// The Installed pane: every addon the registry holds, with its enable toggle.
//
// Pure render. The state it draws is loaded by manager/store.ts, so this file
// has no effects and no fetch of its own.

import type { InstalledAddon } from '../../../shared/protocol.ts';
import type { InstalledState } from './store.ts';
import { UI_TEXT } from './strings.ts';

interface RowProps {
  addon: InstalledAddon;
  onToggle: (fqid: string, on: boolean) => void;
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
    </li>
  );
}

function Problem(props: { error: string | null }) {
  if (props.error === null) {
    return null;
  }
  return <p className="woc-note woc-note-bad">{props.error}</p>;
}

interface InstalledPaneProps {
  state: InstalledState;
  onToggle: (fqid: string, on: boolean) => void;
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
      <Problem error={state.error} />
      <ul className="woc-list">
        {state.rows.map((addon) => (
          <AddonRow key={addon.fqid} addon={addon} onToggle={props.onToggle} />
        ))}
      </ul>
    </>
  );
}
