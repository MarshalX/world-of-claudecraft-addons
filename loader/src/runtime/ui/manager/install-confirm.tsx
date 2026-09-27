// The confirmation an install goes through, showing what the addon declares.
//
// It replaces the browse list instead of floating over it: a modal would give Escape a second
// meaning beside closing the window. Declared permissions are a disclosure, not a sandbox, so the
// trust warning always sits under the list.

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
  /** The addon that recommended this one, empty for a player who found it themselves. */
  from: string;
  /** That addon's reason, empty when it named a companion without saying why. */
  reason: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The recommender, and their sentence when they gave one. */
function saidBy(from: string, reason: string): string {
  if (reason === '') {
    return from;
  }
  return `${from}: ${reason}`;
}

/**
 * Who sent the player here. The one place a companion's reason is shown as text: elsewhere it is a
 * `title`, which a touch screen never shows.
 */
function Recommendation(props: { from: string; reason: string }) {
  if (props.from === '') {
    return null;
  }
  return (
    <p className="woc-note">
      {UI_TEXT.confirmRecommendedBy} {saidBy(props.from, props.reason)}
    </p>
  );
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
      <Recommendation from={props.from} reason={props.reason} />

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
