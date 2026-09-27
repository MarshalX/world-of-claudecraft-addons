// The one line every pane draws when its last write failed, since a rejected edit that showed
// nothing looks exactly like an accepted one.

function ErrorNote(props: { error: string | null }) {
  if (props.error === null) {
    return null;
  }
  return <p className="woc-note woc-note-bad">{props.error}</p>;
}

export { ErrorNote };
