// The Installed pane: every addon the registry holds, with its enable toggle. Pure render; the
// state is loaded by manager/store.ts.

import type { InstalledAddon } from '../../../shared/protocol.ts';
import type { AddonStatus } from '../../supervisor.ts';
import type { AddonShot, OfferedAddon } from './catalog.ts';
import type { CompanionContext } from './companions.ts';
import { Companions } from './companions.tsx';
import { EnableToggle } from './enable-toggle.tsx';
import { ErrorNote } from './error-note.tsx';
import { Preview } from './preview.tsx';
import { statusView } from './status.ts';
import type { InstalledState } from './store.ts';
import { UI_TEXT } from './strings.ts';

interface RowProps {
  addon: InstalledAddon;
  statuses: readonly AddonStatus[];
  /** This addon's screenshot, or null when the catalog cannot place it. */
  shot: AddonShot | null;
  /** Whether any row on this list has one, so the rows line up. */
  shots: boolean;
  /** The installed set and what is on offer, for the companion note. */
  companions: Omit<CompanionContext, 'market'>;
  onToggle: (fqid: string, on: boolean) => void;
  onOpen: (fqid: string) => void;
  /** Take the player to Browse, searching for a companion this pane cannot install. */
  onFind: (name: string) => void;
}

/** The run state. The toggle shows what the player asked for; this shows what happened. */
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
      <Preview shot={props.shot} size="thumb" placeholder={props.shots} />
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
          reasons={addon.manifest.companionReasons}
          ctx={{ ...props.companions, market: addon.marketplace }}
          // Enable is this pane's toggle pointed at another row; a missing companion jumps to
          // Browse, which owns install.
          actions={{
            onEnable: (note) => {
              if (note.fqid !== null) {
                props.onToggle(note.fqid, true);
              }
            },
            onFind: (note) => {
              props.onFind(note.name);
            },
          }}
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
 * The arrange mode switch, at the top of the pane because it outlines every addon frame at once.
 * Shown even with nothing installed.
 */
function UnlockRow(props: { unlocked: boolean; onUnlock: (on: boolean) => void }) {
  return (
    // Not a `.woc-row`: that class means an installed addon, and selectors (tests included) count
    // it as one.
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
   * Every addon any source offers, so a missing companion can say whether Browse has it. Empty
   * while the catalog loads, which reads as `unknown` for one paint.
   */
  offered: ReadonlyMap<string, OfferedAddon>;
  /**
   * Each offered addon's screenshot by fqid. From the catalog because the registry does not keep
   * an addon's repository directory, so it cannot say where the picture is.
   */
  shots: ReadonlyMap<string, AddonShot>;
  onToggle: (fqid: string, on: boolean) => void;
  onOpen: (fqid: string) => void;
  /** Take the player to Browse, searching for a companion this pane cannot install. */
  onFind: (name: string) => void;
  unlocked: boolean;
  onUnlock: (on: boolean) => void;
}

/** The installed set the companion note reads. */
function companionsOf(props: InstalledPaneProps): Omit<CompanionContext, 'market'> {
  return {
    installed: new Map(props.state.rows.map((row) => [row.fqid, row.enabled])),
    // From the registry, so an installed companion is named even after its source is removed.
    names: new Map(props.state.rows.map((row) => [row.fqid, row.manifest.name])),
    offered: props.offered,
  };
}

export function InstalledPane(props: InstalledPaneProps) {
  const { state } = props;
  const companions = companionsOf(props);
  // Asked of the installed rows only, so an uninstalled addon's picture reserves no column here.
  const shots = state.rows.some((row) => props.shots.has(row.fqid));
  const unlock = <UnlockRow unlocked={props.unlocked} onUnlock={props.onUnlock} />;

  if (state.status === 'idle' || state.status === 'loading') {
    return <p className="woc-note">{UI_TEXT.installedLoading}</p>;
  }
  // A failure with no message is the unreachable store: nothing was tried.
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
            shot={props.shots.get(addon.fqid) ?? null}
            shots={shots}
            companions={companions}
            onToggle={props.onToggle}
            onOpen={props.onOpen}
            onFind={props.onFind}
          />
        ))}
      </ul>
    </>
  );
}
