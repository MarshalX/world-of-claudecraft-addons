// The companion note, drawn the same way in Browse and in Installed.
//
// Every action reuses a path that already exists: Enable calls the companion row's own toggle, Get
// opens Browse's install confirmation, Find it switches to Browse and searches. Do not add a second
// install path. Each pane passes only the routes it owns, so the callbacks are optional.

import type { CompanionContext, CompanionNote } from './companions.ts';
import { companionNotes } from './companions.ts';
import { COMPANION_TEXT, UI_TEXT } from './strings.ts';

/** The routes a pane owns. Each takes the whole note, since each route reads different fields. */
interface CompanionActions {
  /** Switch a companion that is installed and switched off back on. */
  onEnable?: (note: CompanionNote) => void;
  /** Open the install confirmation for one on offer. Browse only: it owns that view. */
  onGet?: (note: CompanionNote) => void;
  /** Take the player to Browse looking for one, where there is no install here. */
  onFind?: (note: CompanionNote) => void;
}

interface CompanionAction {
  label: string;
  hint: string;
  run: () => void;
}

function act(
  label: string,
  hint: string,
  note: CompanionNote,
  run: (note: CompanionNote) => void,
): CompanionAction {
  return {
    label,
    hint,
    run: () => {
      run(note);
    },
  };
}

/** The two routes to an addon nobody has yet: install it here, or go and find it. */
function offeredAction(note: CompanionNote, actions: CompanionActions): CompanionAction | null {
  if (note.fqid !== null && actions.onGet !== undefined) {
    return act(UI_TEXT.companionGet, UI_TEXT.companionGetHint, note, actions.onGet);
  }
  if (actions.onFind === undefined) {
    return null;
  }
  return act(UI_TEXT.companionFind, UI_TEXT.companionFindHint, note, actions.onFind);
}

/** The one action a companion's state calls for, or none for `enabled` and `unknown`. */
function actionFor(note: CompanionNote, actions: CompanionActions): CompanionAction | null {
  if (note.state === 'disabled' && note.fqid !== null && actions.onEnable !== undefined) {
    return act(UI_TEXT.companionEnable, UI_TEXT.companionEnableHint, note, actions.onEnable);
  }
  if (note.state === 'offered') {
    return offeredAction(note, actions);
  }
  return null;
}

/** What the author said this companion adds. Never empty: an empty `title` opens a blank tooltip. */
function hoverFor(note: CompanionNote): string {
  if (note.reason === '') {
    return UI_TEXT.companionNoReason;
  }
  return `${note.name} ${note.reason}`;
}

function ActionButton(props: { action: CompanionAction; name: string }) {
  const { action } = props;
  return (
    <button
      type="button"
      className="woc-btn woc-companion-action"
      title={action.hint}
      aria-label={`${action.label} ${props.name}`}
      onClick={action.run}
    >
      {action.label}
    </button>
  );
}

/** The button, or nothing at all for a state with nothing to do about it. */
function Action(props: { note: CompanionNote; actions: CompanionActions }) {
  const action = actionFor(props.note, props.actions);
  if (action === null) {
    return null;
  }
  return <ActionButton action={action} name={props.note.name} />;
}

function Companion(props: { note: CompanionNote; actions: CompanionActions }) {
  const { note } = props;
  return (
    <span className={`woc-companion woc-companion-${note.state}`}>
      <span className="woc-companion-name" title={hoverFor(note)}>
        {note.name}
      </span>
      <span className="woc-companion-state">{COMPANION_TEXT[note.state]}</span>
      <Action note={note} actions={props.actions} />
    </span>
  );
}

interface CompanionsProps {
  /** The `companions` list off the manifest, which most addons do not carry. */
  ids: readonly string[] | undefined;
  /** The `companionReasons` map off the SAME manifest, keyed by those ids. */
  reasons?: Readonly<Record<string, string>> | undefined;
  ctx: CompanionContext;
  actions?: CompanionActions;
}

/** Absent entirely when an addon names none, which is the ordinary case. */
export function Companions(props: CompanionsProps) {
  const notes = companionNotes(props.ids, props.ctx, props.reasons);
  if (notes.length === 0) {
    return null;
  }
  return (
    <span className="woc-companions">
      <span className="woc-companions-label">{UI_TEXT.companions}</span>
      {notes.map((note) => (
        <Companion key={note.id} note={note} actions={props.actions ?? {}} />
      ))}
    </span>
  );
}
