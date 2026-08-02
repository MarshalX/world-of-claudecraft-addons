// The confirmation an install goes through, showing what the addon declares.
//
// It replaces the browse list rather than floating over it. A modal would need
// its own focus trap and its own escape handling, and the manager already binds
// Escape to closing the window: two overlapping meanings for one key is the
// thing to avoid on a screen that is asking a trust question.
//
// The declared permissions are a DISCLOSURE, not a boundary. Addon code runs in
// the page realm with the page's globals in scope, so a manifest that declares
// nothing is not thereby prevented from doing anything. The warning under the
// list says exactly that, because a list of permissions with nothing beside it
// reads as a sandbox, and there is not one. The wording of each line is in
// permissions.ts.

import { type BrowseRow, shotOf } from './catalog.ts';
import { describePermissions } from './permissions.ts';
import { Preview } from './preview.tsx';
import { UI_TEXT } from './strings.ts';

function Declared(props: { permissions: readonly string[] | undefined }) {
  const lines = describePermissions(props.permissions);
  if (lines.length === 0) {
    return <p className="woc-note">{UI_TEXT.confirmNoPermissions}</p>;
  }
  return (
    <>
      <p className="woc-note">{UI_TEXT.confirmPermissions}</p>
      <ul className="woc-perms">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </>
  );
}

interface InstallConfirmProps {
  row: BrowseRow;
  /** True while the install is in flight, so the button cannot be pressed twice. */
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function InstallConfirm(props: InstallConfirmProps) {
  const { entry, market } = props.row;

  return (
    <section className="woc-confirm">
      <h4 className="woc-subhead">
        {UI_TEXT.confirmHeading} {entry.name}
      </h4>
      <p className="woc-note">
        {entry.version} {UI_TEXT.by} {entry.author}
      </p>
      <Preview shot={shotOf(props.row)} size="full" />
      <p className="woc-row-desc">{entry.description}</p>
      <p className="woc-note">
        {UI_TEXT.confirmFrom} {market.name}
      </p>

      <Declared permissions={entry.permissions} />
      <p className="woc-note woc-note-warn">{UI_TEXT.confirmTrust}</p>

      <div className="woc-row-actions">
        <button
          type="button"
          className="woc-btn woc-btn-primary"
          disabled={props.busy}
          onClick={props.onConfirm}
        >
          {UI_TEXT.confirmInstall}
        </button>
        <button type="button" className="woc-btn" onClick={props.onCancel}>
          {UI_TEXT.confirmCancel}
        </button>
      </div>
    </section>
  );
}
