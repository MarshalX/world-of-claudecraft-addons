// The companion note, drawn the same way in Browse and in Installed.
//
// It used to be a note and nothing else, on the reasoning that a second install
// path would be a second thing to keep honest against the confirmation step.
// That reasoning still holds and the conclusion did not: what it produced on
// screen was a bare lower-case id and a state phrase in 11px grey, so the one
// state a player can act on ("installed but switched off") had nothing to press,
// and the state worth the most to them ("available in Browse") was the quietest
// thing on the row.
//
// So there are actions now, and NONE of them is a new path. Enable calls the
// same toggle the companion's own row calls; Get opens the same install
// confirmation Browse opens; Find it moves the player to Browse and searches.
// Each pane passes only the routes it already owns, which is why the callbacks
// are optional and why `actionFor` can decide from the state alone.
//
// One component for both panes because the two would otherwise drift into
// saying the same thing differently, which is exactly the failure a shared
// strings table exists to prevent.

import type { CompanionContext, CompanionNote } from './companions.ts';
import { companionNotes } from './companions.ts';
import { COMPANION_TEXT, UI_TEXT } from './strings.ts';

/**
 * The routes a pane owns, offered to the note.
 *
 * Each takes the whole resolved note rather than the one field it acts on: an
 * fqid is what Enable and Get need, a name is what Find searches for, and the
 * reason is what the confirmation shows, so a signature per callback would be
 * three shapes for one thing and a fourth the day a route wants a second field.
 */
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

/**
 * The one action a companion offers, or none.
 *
 * A state at a time rather than a button per route, because two buttons on one
 * line is a choice the player did not ask to be given: an addon that is
 * installed and switched off wants switching on, and one that is not here wants
 * getting. `enabled` and `unknown` have nothing to offer at all, the first
 * because everything is already as the author hoped and the second because no
 * source in the player's list has ever heard of it.
 */
function actionFor(note: CompanionNote, actions: CompanionActions): CompanionAction | null {
  if (note.state === 'disabled' && note.fqid !== null && actions.onEnable !== undefined) {
    return act(UI_TEXT.companionEnable, UI_TEXT.companionEnableHint, note, actions.onEnable);
  }
  if (note.state === 'offered') {
    return offeredAction(note, actions);
  }
  return null;
}

/**
 * What the author said this companion adds, or the general case when they did
 * not say. Never empty, because an empty `title` is a tooltip that opens on
 * hover to say nothing.
 */
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
