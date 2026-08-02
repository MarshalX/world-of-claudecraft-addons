// The companion note, drawn the same way in Browse and in Installed.
//
// A NOTE and never a control. There is deliberately no install button, no
// enable toggle and no link here, and nothing in this file is read by the
// install control beside it: the whole point of the field is to say what the
// state IS, so a player who cares can act on it in the pane that already does
// that. A second install path here would be a second thing to keep honest
// against the confirmation step.
//
// One component for both panes because the two would otherwise drift into
// saying the same thing differently, which is exactly the failure a shared
// strings table exists to prevent.

import type { CompanionContext, CompanionNote } from './companions.ts';
import { companionNotes } from './companions.ts';
import { COMPANION_TEXT, UI_TEXT } from './strings.ts';

function Companion(props: { note: CompanionNote }) {
  const { note } = props;
  return (
    <span className={`woc-companion woc-companion-${note.state}`}>
      {note.id} <span className="woc-companion-state">{COMPANION_TEXT[note.state]}</span>
    </span>
  );
}

interface CompanionsProps {
  /** The `companions` list off the manifest, which most addons do not carry. */
  ids: readonly string[] | undefined;
  ctx: CompanionContext;
}

/** Absent entirely when an addon names none, which is the ordinary case. */
export function Companions(props: CompanionsProps) {
  const notes = companionNotes(props.ids, props.ctx);
  if (notes.length === 0) {
    return null;
  }
  return (
    <span className="woc-companions">
      <span className="woc-companions-label">{UI_TEXT.companions}</span>
      {notes.map((note) => (
        <Companion key={note.id} note={note} />
      ))}
    </span>
  );
}
