// The keybind editor, with live conflict warnings.
//
// Rendered from the manifest's `keybinds` declarations, so an addon's full
// keybind list is editable before the addon has ever run. Pressing "Set" hands
// the next key press to the dispatcher's capture mode, which swallows it: that
// is the only way to read a combo without the game also acting on it.
//
// A conflict WARNS and never blocks. Deliberately overriding a game binding is
// legitimate, and a player who wants their addon on the key the game uses for
// something they never do is not making a mistake. The warning does say which
// side the reading came from, because a conflict list read from storage is
// incomplete by construction: see keys/game-bindings.ts.

import { describeCombo, isBindable } from '../../../shared/combo.ts';
import type { KeybindDecl } from '../../../shared/schema.ts';
import type { ConflictReading } from './config.ts';
import { ErrorNote } from './error-note.tsx';
import { UI_TEXT } from './strings.ts';

interface RowProps {
  decl: KeybindDecl;
  combo: string | null;
  overridden: boolean;
  /** Which id is currently waiting for a key press, if any. */
  capturing: string | null;
  conflicts: (combo: string) => ConflictReading;
  onCapture: (id: string) => void;
  onReset: (id: string) => void;
}

/**
 * The whole warning as one string, caveat included.
 *
 * The caveat rides on a reading that came from storage, which is incomplete by
 * construction: a key the player has never changed is not in there at all. See
 * keys/game-bindings.ts.
 */
function conflictText(report: ConflictReading): string {
  const parts = [...report.actions, ...report.addons].join(', ');
  if (report.source === 'stored') {
    return `${UI_TEXT.conflictPrefix} ${parts}. ${UI_TEXT.conflictApproximate}`;
  }
  return `${UI_TEXT.conflictPrefix} ${parts}.`;
}

function Conflicts(props: { combo: string | null; conflicts: RowProps['conflicts'] }) {
  const { combo } = props;
  if (combo === null) {
    return null;
  }
  const report = props.conflicts(combo);
  if (report.actions.length === 0 && report.addons.length === 0) {
    return null;
  }
  return <span className="woc-row-meta woc-note-warn">{conflictText(report)}</span>;
}

/** Shown when a stored combo is one the dispatcher can never fire on, e.g. Escape. */
function Unusable(props: { combo: string | null }) {
  const { combo } = props;
  if (combo === null || isBindable(combo)) {
    return null;
  }
  return <span className="woc-row-meta woc-note-bad">{UI_TEXT.comboUnusable}</span>;
}

/** What the combo button draws: the prompt while it waits, the binding otherwise. */
function comboLabel(waiting: boolean, combo: string | null, fallback: string): string {
  if (waiting) {
    return UI_TEXT.pressAKey;
  }
  return describeCombo(combo ?? fallback);
}

function KeybindRow(props: RowProps) {
  const { decl, combo } = props;
  const waiting = props.capturing === decl.id;

  return (
    <li className="woc-row">
      <div className="woc-row-main">
        <span className="woc-row-name">{decl.label}</span>
        <Conflicts combo={combo} conflicts={props.conflicts} />
        <Unusable combo={combo} />
      </div>
      <div className="woc-row-actions">
        <button
          type="button"
          className="woc-btn woc-combo"
          aria-label={`${UI_TEXT.rebind} ${decl.label}`}
          onClick={() => {
            props.onCapture(decl.id);
          }}
        >
          {comboLabel(waiting, combo, decl.default)}
        </button>
        <button
          type="button"
          className="woc-btn"
          disabled={!props.overridden}
          aria-label={`${UI_TEXT.resetBind} ${decl.label}`}
          onClick={() => {
            props.onReset(decl.id);
          }}
        >
          {UI_TEXT.resetBind}
        </button>
      </div>
    </li>
  );
}

interface KeybindEditorProps {
  decls: readonly KeybindDecl[];
  combo: (id: string) => string | null;
  isOverridden: (id: string) => boolean;
  capturing: string | null;
  conflicts: (combo: string) => ConflictReading;
  onCapture: (id: string) => void;
  onReset: (id: string) => void;
  error: string | null;
}

export function KeybindEditor(props: KeybindEditorProps) {
  if (props.decls.length === 0) {
    return <p className="woc-note">{UI_TEXT.keybindsNone}</p>;
  }
  return (
    <>
      <ErrorNote error={props.error} />
      <ul className="woc-list">
        {props.decls.map((decl) => (
          <KeybindRow
            key={decl.id}
            decl={decl}
            combo={props.combo(decl.id)}
            overridden={props.isOverridden(decl.id)}
            capturing={props.capturing}
            conflicts={props.conflicts}
            onCapture={props.onCapture}
            onReset={props.onReset}
          />
        ))}
      </ul>
    </>
  );
}
