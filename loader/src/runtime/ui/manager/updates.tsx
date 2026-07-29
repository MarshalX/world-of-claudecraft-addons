// Updates: what the marketplaces now offer that is newer than what is installed.
//
// Pure render over catalog-store.ts. Nothing on this pane happens on its own:
// auto-update is off for every marketplace including the official one, because
// an addon update is a code change and a silent code change on a page that holds
// a live session is not something to do quietly. The pane says so rather than
// leaving the absence to be inferred.
//
// The rows are compared against the indexes as they were last read, so the pane
// also says that, and Refresh is the control that re-reads them. Making the
// badge itself go to the network would put a request per source in front of
// every open of the manager.

import type { UpdateRow } from '../../../shared/protocol.ts';
import { pendingUpdates } from './catalog.ts';
import type { CatalogState, CatalogStore } from './catalog-store.ts';
import { ErrorNote } from './error-note.tsx';
import { UI_TEXT } from './strings.ts';

/** Update, or the two controls a pinned row gets instead. */
function RowActions(props: { row: UpdateRow; busy: boolean; store: CatalogStore }) {
  const { row, store } = props;
  if (row.pin !== null) {
    return (
      <button
        type="button"
        className="woc-btn"
        disabled={props.busy}
        aria-label={`${UI_TEXT.updatesUnpin} ${row.name}`}
        onClick={() => {
          store.setPin(row.fqid, null);
        }}
      >
        {UI_TEXT.updatesUnpin}
      </button>
    );
  }
  return (
    <>
      <button
        type="button"
        className="woc-btn woc-btn-primary"
        disabled={props.busy}
        aria-label={`${UI_TEXT.updatesUpdate} ${row.name}`}
        onClick={() => {
          store.update(row.fqid);
        }}
      >
        {UI_TEXT.updatesUpdate}
      </button>
      <button
        type="button"
        className="woc-btn"
        disabled={props.busy}
        title={UI_TEXT.updatesPinHint}
        aria-label={`${UI_TEXT.updatesPin} ${row.name}`}
        onClick={() => {
          store.setPin(row.fqid, row.installed);
        }}
      >
        {UI_TEXT.updatesPin}
      </button>
    </>
  );
}

function PinnedBadge(props: { pin: string | null }) {
  if (props.pin === null) {
    return null;
  }
  return <span className="woc-badge woc-badge-muted">{UI_TEXT.updatesPinned}</span>;
}

function Row(props: { row: UpdateRow; busy: boolean; store: CatalogStore }) {
  const { row } = props;
  return (
    <li className="woc-row">
      <div className="woc-row-main">
        <span className="woc-row-name">
          {row.name} <PinnedBadge pin={row.pin} />
        </span>
        <span className="woc-row-meta">
          {row.installed} {UI_TEXT.updatesArrow} {row.available}
        </span>
        <span className="woc-row-desc">{row.marketplace}</span>
      </div>
      <div className="woc-row-actions">
        <RowActions row={row} busy={props.busy} store={props.store} />
      </div>
    </li>
  );
}

/** Every row that moved, pinned ones included, or the note that none did. */
function Rows(props: { state: CatalogState; store: CatalogStore }) {
  const { updates } = props.state;
  if (updates.length === 0) {
    return <p className="woc-note">{UI_TEXT.updatesNone}</p>;
  }
  return (
    <ul className="woc-list">
      {updates.map((row) => (
        <Row key={row.fqid} row={row} busy={props.state.busy === row.fqid} store={props.store} />
      ))}
    </ul>
  );
}

interface UpdatesPaneProps {
  state: CatalogState;
  store: CatalogStore;
}

export function UpdatesPane(props: UpdatesPaneProps) {
  const { state, store } = props;

  if (state.status === 'failed' && state.markets.length === 0) {
    return <p className="woc-note woc-note-bad">{state.error ?? UI_TEXT.catalogUnreachable}</p>;
  }

  const pending = pendingUpdates(state.updates);
  return (
    <section className="woc-updates">
      <p className="woc-note">{UI_TEXT.updatesAuto}</p>
      <p className="woc-note">{UI_TEXT.updatesStale}</p>

      <div className="woc-row-actions">
        <button
          type="button"
          className="woc-btn"
          disabled={state.status === 'loading'}
          onClick={() => {
            store.refresh();
          }}
        >
          {UI_TEXT.refresh}
        </button>
        <button
          type="button"
          className="woc-btn woc-btn-primary"
          disabled={pending.length === 0 || state.busy !== null}
          onClick={() => {
            store.updateAll(pending.map((row) => row.fqid));
          }}
        >
          {UI_TEXT.updatesUpdateAll}
        </button>
      </div>

      <ErrorNote error={state.error} />
      <Rows state={state} store={store} />
    </section>
  );
}
