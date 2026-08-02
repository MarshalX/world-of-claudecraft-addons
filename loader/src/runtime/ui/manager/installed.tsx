// The Installed pane: every addon the registry holds, with its enable toggle.
//
// Pure render. The state it draws is loaded by manager/store.ts, so this file
// has no effects and no fetch of its own.

import type { InstalledAddon } from '../../../shared/protocol.ts';
import type { AddonStatus } from '../../supervisor.ts';
import type { CompanionContext } from './companions.ts';
import { Companions } from './companions.tsx';
import { EnableToggle } from './enable-toggle.tsx';
import { ErrorNote } from './error-note.tsx';
import { statusView } from './status.ts';
import type { InstalledState } from './store.ts';
import { UI_TEXT } from './strings.ts';

interface RowProps {
  addon: InstalledAddon;
  statuses: readonly AddonStatus[];
  /** The installed set and what is on offer, for the companion note. */
  companions: Omit<CompanionContext, 'market'>;
  onToggle: (fqid: string, on: boolean) => void;
  onOpen: (fqid: string) => void;
}

/**
 * The run state, which is not the enable state.
 *
 * An addon can be enabled and not running, and the row has to be able to say so:
 * the toggle reports what the player asked for and this reports what happened.
 */
function StatusBadge(props: { statuses: readonly AddonStatus[]; fqid: string }) {
  const view = statusView(props.statuses, props.fqid);
  if (view === null) {
    return null;
  }
  return (
    <span className={`woc-badge woc-badge-${view.tone}`} title={view.detail ?? undefined}>
      {view.label}
    </span>
  );
}

function AddonRow(props: RowProps) {
  const { addon } = props;
  return (
    <li className="woc-row">
      <div className="woc-row-main">
        <span className="woc-row-name">
          {addon.manifest.name} <StatusBadge statuses={props.statuses} fqid={addon.fqid} />
        </span>
        <span className="woc-row-meta">
          {addon.manifest.version} {UI_TEXT.by} {addon.manifest.author}
        </span>
        <span className="woc-row-desc">{addon.manifest.description}</span>
        <Companions
          ids={addon.manifest.companions}
          ctx={{ ...props.companions, market: addon.marketplace }}
        />
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
        <EnableToggle
          enabled={addon.enabled}
          label={`${UI_TEXT.enabled} ${addon.manifest.name}`}
          onToggle={(on) => {
            props.onToggle(addon.fqid, on);
          }}
        />
      </div>
    </li>
  );
}

/**
 * The arrange-your-UI switch, at the top of the pane rather than beside a row.
 *
 * It belongs to no addon: it outlines EVERY addon frame at once, including ones
 * currently drawing nothing, which is the only way to grab a bare overlay whose
 * content is empty. Putting it on a row would suggest otherwise.
 *
 * Shown even with nothing installed, because a player arriving here to find out
 * why they cannot see an addon's window should find the control that shows them
 * where it is.
 */
function UnlockRow(props: { unlocked: boolean; onUnlock: (on: boolean) => void }) {
  return (
    // Deliberately NOT a `.woc-row`: that class means "an installed addon", and
    // a control that borrowed it would be counted as one by anything selecting
    // rows, this pane's own tests included.
    <div className="woc-unlock-row">
      <div className="woc-row-main">
        <span className="woc-row-name">{UI_TEXT.unlockFrames}</span>
        <span className="woc-row-desc">{UI_TEXT.unlockFramesHint}</span>
      </div>
      <div className="woc-row-actions">
        <EnableToggle
          enabled={props.unlocked}
          label={UI_TEXT.unlockFrames}
          onToggle={props.onUnlock}
        />
      </div>
    </div>
  );
}

interface InstalledPaneProps {
  state: InstalledState;
  statuses: readonly AddonStatus[];
  /**
   * Every addon id any source offers, so a companion nobody has can say whether
   * it is one Browse away or nowhere at all.
   *
   * From the catalog rather than from this pane's own rows, because those are
   * two different questions and this pane only knows the answer to one. Empty
   * while the catalog is still loading, which reads as `unknown` for one paint.
   */
  offered: ReadonlySet<string>;
  onToggle: (fqid: string, on: boolean) => void;
  onOpen: (fqid: string) => void;
  unlocked: boolean;
  onUnlock: (on: boolean) => void;
}

export function InstalledPane(props: InstalledPaneProps) {
  const { state } = props;
  // The enable flags come off these rows directly, which is the reading this
  // pane holds and the catalog store has to be told.
  const companions = {
    installed: new Map(state.rows.map((row) => [row.fqid, row.enabled])),
    offered: props.offered,
  };
  const unlock = <UnlockRow unlocked={props.unlocked} onUnlock={props.onUnlock} />;

  if (state.status === 'idle' || state.status === 'loading') {
    return <p className="woc-note">{UI_TEXT.installedLoading}</p>;
  }
  // A failure with no message is the unreachable-store case, which the store
  // reports without one because there is no error to quote: nothing was tried.
  if (state.status === 'failed' && state.rows.length === 0) {
    return <p className="woc-note woc-note-bad">{state.error ?? UI_TEXT.installedUnreachable}</p>;
  }
  if (state.rows.length === 0) {
    return (
      <>
        {unlock}
        <p className="woc-note">{UI_TEXT.installedEmpty}</p>
      </>
    );
  }

  return (
    <>
      {unlock}
      <ErrorNote error={state.error} />
      <ul className="woc-list">
        {state.rows.map((addon) => (
          <AddonRow
            key={addon.fqid}
            addon={addon}
            statuses={props.statuses}
            companions={companions}
            onToggle={props.onToggle}
            onOpen={props.onOpen}
          />
        ))}
      </ul>
    </>
  );
}
