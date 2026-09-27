// One addon's own page: settings, keybinds, and its log tail.
//
// Reachable for a DISABLED addon, since a misbehaving addon is turned off before it is
// reconfigured. Edits go to the same stores a running addon reads.

import { useState } from 'preact/hooks';
import type { InstalledAddon } from '../../../shared/protocol.ts';
import type { LogEntry } from '../../log/buffer.ts';
import type { SettingValue } from '../../settings/values.ts';
import type { AddonConfig, ConflictReading } from './config.ts';
import { EnableToggle } from './enable-toggle.tsx';
import { TAIL_LINES } from './fields.ts';
import { KeybindEditor } from './keybind-editor.tsx';
import { SettingsForm } from './settings-form.tsx';
import type { StatusView } from './status.ts';
import { UI_TEXT } from './strings.ts';

function describe(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function LogTail(props: { entries: readonly LogEntry[] }) {
  if (props.entries.length === 0) {
    return <p className="woc-note">{UI_TEXT.logsEmpty}</p>;
  }
  // Newest last, matching a console.
  const shown = props.entries.slice(-TAIL_LINES);
  return (
    <ul className="woc-log">
      {shown.map((entry) => (
        <li key={entry.seq} className={`woc-log-line woc-log-${entry.level}`}>
          {entry.text}
        </li>
      ))}
    </ul>
  );
}

interface EditActions {
  onCapture: (id: string) => void;
  onReset: (id: string) => void;
  onSetting: (id: string, value: SettingValue) => void;
}

interface EditDeps {
  /** Loaded, never hydrating: nothing that calls these is on screen before it is. */
  config: AddonConfig;
  capture: () => Promise<string | null>;
  setCapturing: (id: string | null) => void;
  onFailed: (err: unknown) => void;
}

/** The three edits this page makes, bound to one addon's loaded stores. */
function editActions(deps: EditDeps): EditActions {
  const { config } = deps;
  return {
    onCapture: (id) => {
      deps.setCapturing(id);
      deps
        .capture()
        .then(async (combo) => {
          deps.setCapturing(null);
          // Null is a cancelled prompt and must not clear a binding.
          if (combo !== null) {
            await config.keybinds.set(id, combo);
          }
        })
        .catch((err: unknown) => {
          deps.setCapturing(null);
          deps.onFailed(err);
        });
    },
    onReset: (id) => {
      config.keybinds.reset(id).catch(deps.onFailed);
    },
    onSetting: (id, value) => {
      config.settings.set(id, value).catch(deps.onFailed);
    },
  };
}

interface EditorsProps {
  addon: InstalledAddon;
  /** Null while the stores are still hydrating from storage. */
  config: AddonConfig | null;
  conflicts: (combo: string) => ConflictReading;
  /** Swallow the next key press and report it. */
  capture: () => Promise<string | null>;
}

/** The editable half of the page: settings and keybinds over the loaded stores. */
function AddonEditors(props: EditorsProps) {
  const { addon, config } = props;
  const [capturing, setCapturing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (config === null) {
    return <p className="woc-note">{UI_TEXT.configLoading}</p>;
  }

  const actions = editActions({
    config,
    capture: props.capture,
    setCapturing,
    onFailed: (err) => {
      setError(describe(err));
    },
  });

  return (
    <>
      <h4 className="woc-subhead">{UI_TEXT.settingsHeading}</h4>
      <SettingsForm
        fqid={addon.fqid}
        decls={addon.manifest.settings ?? []}
        values={config.settings.values()}
        onChange={actions.onSetting}
        error={error}
      />

      <h4 className="woc-subhead">{UI_TEXT.keybindsHeading}</h4>
      <KeybindEditor
        decls={addon.manifest.keybinds ?? []}
        combo={config.keybinds.combo}
        isOverridden={config.keybinds.isOverridden}
        capturing={capturing}
        conflicts={props.conflicts}
        onCapture={actions.onCapture}
        onReset={actions.onReset}
        error={null}
      />
    </>
  );
}

interface DetailPaneProps extends EditorsProps {
  logs: readonly LogEntry[];
  /** The run state, from the supervisor. Null before it has reached this addon. */
  status: StatusView | null;
  onBack: () => void;
  onToggle: (on: boolean) => void;
  onReload: () => void;
  onUninstall: () => void;
}

/** The run state, absent until the supervisor has reached this addon. */
function StatusBadge(props: { status: StatusView | null }) {
  const { status } = props;
  if (status === null) {
    return null;
  }
  return <span className={`woc-badge woc-badge-${status.tone}`}>{status.label}</span>;
}

/** Why it is not running, for the two states that carry a reason. */
function StatusReason(props: { status: StatusView | null }) {
  const detail = props.status?.detail;
  if (detail === undefined || detail === null) {
    return null;
  }
  return <p className="woc-note woc-note-bad">{detail}</p>;
}

/** Why Reload is unavailable, or nothing to say when it is available. */
function reloadHint(enabled: boolean): string {
  if (enabled) {
    return UI_TEXT.reloadRunning;
  }
  return UI_TEXT.reloadNeedsEnabled;
}

interface ActionProps {
  /** Whether the player has asked for this addon to run. */
  enabled: boolean;
  onToggle: (on: boolean) => void;
  onReload: () => void;
  onUninstall: () => void;
}

/**
 * The page's controls. The toggle repeats the Installed row's so a STOPPED or FAILED badge has its
 * fix beside it. Reload re-evaluates a RUNNING addon, so it is disabled while stopped rather than
 * answering a click with nothing.
 */
function DetailActions(props: ActionProps) {
  return (
    <div className="woc-row-actions">
      <EnableToggle enabled={props.enabled} onToggle={props.onToggle} />
      <button
        type="button"
        className="woc-btn"
        disabled={!props.enabled}
        title={reloadHint(props.enabled)}
        onClick={props.onReload}
      >
        {UI_TEXT.reload}
      </button>
      <button type="button" className="woc-btn" onClick={props.onUninstall}>
        {UI_TEXT.uninstall}
      </button>
    </div>
  );
}

export function DetailPane(props: DetailPaneProps) {
  const { addon, status } = props;

  return (
    <section className="woc-detail">
      <button type="button" className="woc-btn woc-back" onClick={props.onBack}>
        {UI_TEXT.back}
      </button>

      <h3 className="woc-subhead">
        {addon.manifest.name} <StatusBadge status={status} />
      </h3>
      <p className="woc-note">
        {addon.manifest.version} {UI_TEXT.by} {addon.manifest.author}
      </p>
      <StatusReason status={status} />

      <DetailActions
        enabled={addon.enabled}
        onToggle={props.onToggle}
        onReload={props.onReload}
        onUninstall={props.onUninstall}
      />

      <AddonEditors
        addon={addon}
        config={props.config}
        conflicts={props.conflicts}
        capture={props.capture}
      />

      <h4 className="woc-subhead">{UI_TEXT.logsHeading}</h4>
      <LogTail entries={props.logs} />
    </section>
  );
}
