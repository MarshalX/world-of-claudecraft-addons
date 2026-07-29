// The one line every pane draws when its last write failed.
//
// Its own module because three panes need it and each of them renders it from a
// nullable field, so inlining it costs each one a conditional in the middle of
// its markup. A rejected edit that showed nothing would look to a player exactly
// like an edit that was accepted.

function ErrorNote(props: { error: string | null }) {
  if (props.error === null) {
    return null;
  }
  return <p className="woc-note woc-note-bad">{props.error}</p>;
}

export { ErrorNote };
