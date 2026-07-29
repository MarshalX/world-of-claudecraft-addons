// One addon's own page: settings, keybinds, and its log tail.
//
// Reached from a row in the Installed pane and reachable for a DISABLED addon,
// which is the case that matters. An addon that misbehaves is one a player
// turns off first and reconfigures second, and a settings screen that needed
// the addon running would be unavailable exactly then.
//
// The stores this writes to are the same ones a running addon reads, so an edit
// here reaches a live addon through the store's change event. Nothing in this
// file knows whether the addon is running.

import { useState } from 'preact/hooks';
import type { InstalledAddon } from '../../../shared/protocol.ts';
import type { LogEntry } from '../../log/buffer.ts';
import type { SettingValue } from '../../settings/values.ts';
import type { AddonConfig, ConflictReading } from './config.ts';
import { TAIL_LINES } from './fields.ts';
import { KeybindEditor } from './keybind-editor.tsx';
import { SettingsForm } from './settings-form.tsx';
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
  // Newest last, matching a console, so a player reading top to bottom follows
  // the order things happened.
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

/**
 * The three edits this page makes, bound to one addon's loaded stores.
 *
 * Built only from inside the branch that already has the stores, which is what
 * lets each of them be written without a null arm: the controls that call them
 * do not render until the stores are there.
 */
function editActions(deps: EditDeps): EditActions {
  const { config } = deps;
  return {
    onCapture: (id) => {
      deps.setCapturing(id);
      deps
        .capture()
        .then(async (combo) => {
          deps.setCapturing(null);
          // Null is a cancelled prompt, which is not a failure and must not
          // clear a binding.
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

/**
 * The editable half of the page: settings and keybinds over the loaded stores.
 *
 * Which key is waiting for a press, and the last write that failed, live here
 * rather than a level up because both belong to these two forms and to nothing
 * else on the page.
 */
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
  onBack: () => void;
}

export function DetailPane(props: DetailPaneProps) {
  const { addon } = props;

  return (
    <section className="woc-detail">
      <button type="button" className="woc-btn woc-back" onClick={props.onBack}>
        {UI_TEXT.back}
      </button>

      <h3 className="woc-subhead">{addon.manifest.name}</h3>
      <p className="woc-note">
        {addon.manifest.version} {UI_TEXT.by} {addon.manifest.author}
      </p>

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
