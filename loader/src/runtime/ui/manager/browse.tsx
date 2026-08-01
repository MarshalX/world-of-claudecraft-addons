// Browse: everything every marketplace offers, in one searchable list.
//
// Pure render over catalog-store.ts and the pure derivation in catalog.ts. What
// this file owns beyond drawing is which addon is waiting for a confirmation,
// and that lives in component state because it is not worth reloading anything
// to change and means nothing once the pane is closed.
//
// Every row carries its source badge, including the official one. Two
// marketplaces may legitimately publish the same addon id, so a name alone does
// not say what would be installed, and a badge that appeared only on the
// duplicates would put the question in front of a player exactly when they had
// no way to tell it was being asked.

import { useState } from 'preact/hooks';
import { FIELD_CLASS } from '../kit/field-shape.ts';
import type { BrowseEmptiness, BrowseFilter, BrowseRow } from './catalog.ts';
import { browseEmptiness, browseRows, catalogTags } from './catalog.ts';
import type { CatalogState, CatalogStore } from './catalog-store.ts';
import { ErrorNote } from './error-note.tsx';
import { InstallConfirm } from './install-confirm.tsx';
import { UI_TEXT } from './strings.ts';

function Tags(props: { tags: readonly string[] | undefined }) {
  const tags = props.tags ?? [];
  if (tags.length === 0) {
    return null;
  }
  return (
    <span className="woc-tags">
      {tags.map((tag) => (
        <span key={tag} className="woc-tag">
          {tag}
        </span>
      ))}
    </span>
  );
}

function Row(props: { row: BrowseRow; busy: boolean; onInstall: (fqid: string) => void }) {
  const { row } = props;
  const { entry } = row;

  return (
    <li className="woc-row">
      <div className="woc-row-main">
        <span className="woc-row-name">
          {entry.name} <span className="woc-badge woc-badge-muted">{row.market.name}</span>
        </span>
        <span className="woc-row-meta">
          {entry.version} {UI_TEXT.by} {entry.author}
        </span>
        <span className="woc-row-desc">{entry.description}</span>
        <Tags tags={entry.tags} />
      </div>
      <div className="woc-row-actions">
        <button
          type="button"
          className="woc-btn woc-btn-primary"
          disabled={row.installed || props.busy}
          title={installHint(row.installed)}
          aria-label={`${UI_TEXT.browseInstall} ${entry.name}`}
          onClick={() => {
            props.onInstall(row.fqid);
          }}
        >
          {installLabel(row.installed)}
        </button>
      </div>
    </li>
  );
}

function installLabel(installed: boolean): string {
  if (installed) {
    return UI_TEXT.browseInstalled;
  }
  return UI_TEXT.browseInstall;
}

/** What the button will do, or why it will not. Always something, never a bare title. */
function installHint(installed: boolean): string {
  if (installed) {
    return UI_TEXT.browseInstalledHint;
  }
  return UI_TEXT.browseInstallHint;
}

/** The empty option means every tag, which the filter says with null. */
function pickedTag(value: string): string | null {
  if (value === '') {
    return null;
  }
  return value;
}

interface FilterProps {
  filter: BrowseFilter;
  tags: readonly string[];
  onChange: (filter: BrowseFilter) => void;
}

/**
 * The two filter controls, named so their labels can point at them.
 *
 * Fixed rather than generated: the manager is one window with one Browse pane, so
 * these exist at most once in the document. The `woc-` prefix is what keeps them
 * out of the game's own id space, which this document is shared with.
 */
const SEARCH_ID = 'woc-browse-search';
const TAG_ID = 'woc-browse-tag';

/** Absent when no source in the list tags anything, since it would filter nothing. */
function TagFilter(props: FilterProps) {
  const { filter } = props;
  if (props.tags.length === 0) {
    return null;
  }
  return (
    <div className={FIELD_CLASS.row}>
      <label className={FIELD_CLASS.label} htmlFor={TAG_ID}>
        {UI_TEXT.browseTag}
      </label>
      <select
        id={TAG_ID}
        className={FIELD_CLASS.control}
        value={filter.tag ?? ''}
        onChange={(event) => {
          const picked = (event.currentTarget as HTMLSelectElement).value;
          props.onChange({ ...filter, tag: pickedTag(picked) });
        }}
      >
        <option value="">{UI_TEXT.browseAllTags}</option>
        {props.tags.map((tag) => (
          <option key={tag} value={tag}>
            {tag}
          </option>
        ))}
      </select>
    </div>
  );
}

function Filters(props: FilterProps) {
  const { filter } = props;
  return (
    <div className="woc-filters">
      <div className={FIELD_CLASS.row}>
        <label className={FIELD_CLASS.label} htmlFor={SEARCH_ID}>
          {UI_TEXT.browseSearch}
        </label>
        <input
          id={SEARCH_ID}
          type="search"
          className={FIELD_CLASS.control}
          value={filter.query}
          placeholder={UI_TEXT.browseSearchPlaceholder}
          onInput={(event) => {
            props.onChange({ ...filter, query: (event.currentTarget as HTMLInputElement).value });
          }}
        />
      </div>
      <TagFilter tags={props.tags} filter={filter} onChange={props.onChange} />
    </div>
  );
}

interface ResultsProps {
  rows: readonly BrowseRow[];
  /** Whether any source offers anything at all, which is a different emptiness. */
  anyOffered: boolean;
  /** Why nothing is offered, when nothing is. */
  emptiness: BrowseEmptiness;
  busy: string | null;
  onInstall: (fqid: string) => void;
}

/** Which note an empty list gets, once the search has been ruled out. */
function emptyNote(emptiness: BrowseEmptiness): string {
  if (emptiness === 'unread') {
    return UI_TEXT.browseEmpty;
  }
  if (emptiness === 'unreadable') {
    return UI_TEXT.browseUnreadable;
  }
  return UI_TEXT.browseNoAddons;
}

/**
 * The rows, or the right kind of nothing.
 *
 * "Your search matched nothing", "no source has been read yet", "a source could
 * not be read" and "every source is genuinely empty" are one blank list on
 * screen and four different things to do about it, and only the middle two are
 * about Refresh at all.
 */
function Results(props: ResultsProps) {
  if (props.rows.length === 0) {
    if (props.anyOffered) {
      return <p className="woc-note">{UI_TEXT.browseNoMatch}</p>;
    }
    return <p className="woc-note">{emptyNote(props.emptiness)}</p>;
  }
  return (
    <ul className="woc-list">
      {props.rows.map((row) => (
        <Row key={row.fqid} row={row} busy={props.busy === row.fqid} onInstall={props.onInstall} />
      ))}
    </ul>
  );
}

interface BrowsePaneProps {
  state: CatalogState;
  store: CatalogStore;
}

export function BrowsePane(props: BrowsePaneProps) {
  const { state, store } = props;
  const [filter, setFilter] = useState<BrowseFilter>({ query: '', tag: null });
  const [confirming, setConfirming] = useState<string | null>(null);

  if (state.status === 'failed' && state.markets.length === 0) {
    return <p className="woc-note woc-note-bad">{state.error ?? UI_TEXT.catalogUnreachable}</p>;
  }

  const rows = browseRows(state.markets, state.installed, filter);
  const pending = rows.find((row) => row.fqid === confirming);
  if (pending !== undefined) {
    return (
      <InstallConfirm
        row={pending}
        busy={state.busy === pending.fqid}
        onConfirm={() => {
          store.install(pending.fqid);
          setConfirming(null);
        }}
        onCancel={() => {
          setConfirming(null);
        }}
      />
    );
  }

  return (
    <section className="woc-browse">
      <Filters filter={filter} tags={catalogTags(state.markets)} onChange={setFilter} />
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
      </div>
      <ErrorNote error={state.error} />
      <Results
        rows={rows}
        anyOffered={state.markets.some((market) => market.addons.length > 0)}
        emptiness={browseEmptiness(state.markets)}
        busy={state.busy}
        onInstall={setConfirming}
      />
    </section>
  );
}
