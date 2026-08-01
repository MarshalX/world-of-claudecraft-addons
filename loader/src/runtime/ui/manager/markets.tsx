// The Marketplaces pane: where addons come from, and what that costs in trust.
//
// Pure render over catalog-store.ts. The official source renders first with no
// remove control and no ref field, because both of those come from the loader
// build: the list here is presentation of a rule the host enforces, not the rule
// itself. canRemoveMarketplace is called in MarketApi.remove, so a hand-crafted
// call from the page realm fails the same way a missing button does.
//
// The local dev source is built in too, and for a different reason: it is never
// persisted, so there is nothing to remove and the Dev tab's switch is what takes
// it away. Both read as "ships with the loader" on this pane, which is true of
// each for its own reason and is the part a player needs.

import { useState } from 'preact/hooks';
import { type MarketplaceRef, OFFICIAL_ID } from '../../../shared/marketplace.ts';
import type { MarketplaceState } from '../../../shared/protocol.ts';
import { FIELD_CLASS } from '../kit/field-shape.ts';
import type { CatalogState, CatalogStore } from './catalog-store.ts';
import { ErrorNote } from './error-note.tsx';
import { UI_TEXT } from './strings.ts';

/** The branch, tag, or commit a source reads from, or null for the dev server. */
function refOf(ref: MarketplaceRef): string | null {
  if (ref.source.kind === 'local') {
    return null;
  }
  return ref.source.ref;
}

/**
 * Where a source's files come from: its ref, or the dev server's origin.
 *
 * The dev server has no ref because it reads a directory, but the row still has
 * to say where it is pointing, or the local source would be the one entry in
 * this list with nothing under its name.
 */
function locationOf(ref: MarketplaceRef): { label: string; value: string } {
  if (ref.source.kind === 'local') {
    return { label: UI_TEXT.devOrigin, value: ref.source.origin };
  }
  return { label: UI_TEXT.marketsRef, value: ref.source.ref };
}

function lastRead(at: number | null, format: (at: number) => string): string {
  if (at === null) {
    return UI_TEXT.marketsNever;
  }
  return format(at);
}

/** Where this source reads from, labelled for the kind of source it is. */
function LocationRow(props: { market: MarketplaceRef }) {
  const location = locationOf(props.market);
  return (
    <div className="woc-kv">
      <dt>{location.label}</dt>
      <dd>{location.value}</dd>
    </div>
  );
}

function Readout(props: { state: MarketplaceState; format: (at: number) => string }) {
  const { state } = props;
  return (
    <dl className="woc-kv-list">
      <LocationRow market={state.ref} />
      <div className="woc-kv">
        <dt>{UI_TEXT.marketsAddons}</dt>
        <dd>{String(state.addons.length)}</dd>
      </div>
      <div className="woc-kv">
        <dt>{UI_TEXT.marketsLastRead}</dt>
        <dd>{lastRead(state.fetchedAt, props.format)}</dd>
      </div>
    </dl>
  );
}

/** The ref field and Pin button, for a user-added source only. */
function PinControl(props: { current: string; busy: boolean; onPin: (ref: string) => void }) {
  const [draft, setDraft] = useState(props.current);
  return (
    <>
      <input
        type="text"
        className={`${FIELD_CLASS.control} woc-combo`}
        value={draft}
        placeholder={UI_TEXT.marketsPinPlaceholder}
        aria-label={UI_TEXT.marketsPin}
        onInput={(event) => {
          setDraft((event.currentTarget as HTMLInputElement).value);
        }}
      />
      <button
        type="button"
        className="woc-btn"
        disabled={props.busy || draft.trim() === props.current}
        onClick={() => {
          props.onPin(draft);
        }}
      >
        {UI_TEXT.marketsPin}
      </button>
    </>
  );
}

/**
 * What a built-in source is, and for the official one what "official" means.
 *
 * Official to this loader, not to the game: the game is a separate project under
 * a different owner and does not endorse this. That sentence goes on the pane
 * rather than only in the README, because this list is where a player forms the
 * impression it corrects.
 */
function BuiltinNote(props: { state: MarketplaceState }) {
  if (!props.state.builtin) {
    return null;
  }
  if (props.state.ref.id !== OFFICIAL_ID) {
    return <p className="woc-note">{UI_TEXT.marketsBuiltin}</p>;
  }
  return (
    <>
      <p className="woc-note">{UI_TEXT.marketsBuiltin}</p>
      <p className="woc-note">{UI_TEXT.marketsOfficialNote}</p>
    </>
  );
}

/** The warning for a source read by enumerating the repository. */
function DegradedNote(props: { degraded: boolean }) {
  if (!props.degraded) {
    return null;
  }
  return <p className="woc-note woc-note-warn">{UI_TEXT.marketsDegraded}</p>;
}

/** Pin and Remove, which a built-in source does not get. */
function UserActions(props: { state: MarketplaceState; busy: boolean; store: CatalogStore }) {
  const { state, store } = props;
  if (state.builtin) {
    return null;
  }
  const { id } = state.ref;
  return (
    <>
      <PinControl
        current={refOf(state.ref) ?? ''}
        busy={props.busy}
        onPin={(ref) => {
          store.setMarketRef(id, ref);
        }}
      />
      <button
        type="button"
        className="woc-btn"
        disabled={props.busy}
        aria-label={`${UI_TEXT.marketsRemove} ${state.ref.name}`}
        onClick={() => {
          store.removeMarket(id);
        }}
      >
        {UI_TEXT.marketsRemove}
      </button>
    </>
  );
}

interface RowProps {
  state: MarketplaceState;
  busy: boolean;
  store: CatalogStore;
  format: (at: number) => string;
}

function MarketRow(props: RowProps) {
  const { state, store } = props;
  const { id } = state.ref;

  return (
    <li className="woc-market">
      <div className="woc-row-main">
        <span className="woc-row-name">{state.ref.name}</span>
        <Readout state={state} format={props.format} />
        <BuiltinNote state={state} />
        <DegradedNote degraded={state.degraded} />
        <ErrorNote error={state.error} />
      </div>
      <div className="woc-row-actions">
        <button
          type="button"
          className="woc-btn"
          disabled={props.busy}
          aria-label={`${UI_TEXT.refresh} ${state.ref.name}`}
          onClick={() => {
            store.refresh(id);
          }}
        >
          {UI_TEXT.refresh}
        </button>
        <UserActions state={state} busy={props.busy} store={store} />
      </div>
    </li>
  );
}

/**
 * The add form, with the trust warning above the fields rather than after them.
 *
 * Adding a source is the friction-carrying act in this design: everything it
 * publishes becomes code the player has chosen to run, with the page's globals
 * in scope. The warning is what that friction is, so it comes before the input
 * and not as a footnote under the button.
 */
/**
 * The add form's two controls, named so their labels can point at them.
 *
 * Fixed for the reason Browse's are: one manager window, one Marketplaces pane.
 */
const URL_ID = 'woc-market-url';
const REF_ID = 'woc-market-ref';

function AddForm(props: { busy: boolean; onAdd: (url: string, ref: string) => void }) {
  const [url, setUrl] = useState('');
  const [ref, setRef] = useState('');

  return (
    <section className={FIELD_CLASS.form}>
      <h4 className="woc-subhead">{UI_TEXT.marketsAddHeading}</h4>
      <p className="woc-note woc-note-warn">{UI_TEXT.marketsAddWarning}</p>
      <div className={FIELD_CLASS.row}>
        <label className={FIELD_CLASS.label} htmlFor={URL_ID}>
          {UI_TEXT.marketsAddUrl}
        </label>
        <input
          id={URL_ID}
          type="text"
          className={FIELD_CLASS.control}
          value={url}
          placeholder={UI_TEXT.marketsAddUrlPlaceholder}
          onInput={(event) => {
            setUrl((event.currentTarget as HTMLInputElement).value);
          }}
        />
      </div>
      <div className={FIELD_CLASS.row}>
        <label className={FIELD_CLASS.label} htmlFor={REF_ID}>
          {UI_TEXT.marketsAddRef}
        </label>
        <input
          id={REF_ID}
          type="text"
          className={FIELD_CLASS.control}
          value={ref}
          placeholder={UI_TEXT.marketsPinPlaceholder}
          onInput={(event) => {
            setRef((event.currentTarget as HTMLInputElement).value);
          }}
        />
      </div>
      <div className="woc-row-actions">
        <button
          type="button"
          className="woc-btn woc-btn-primary"
          disabled={props.busy || url.trim() === ''}
          onClick={() => {
            props.onAdd(url, ref);
            setUrl('');
            setRef('');
          }}
        >
          {UI_TEXT.marketsAdd}
        </button>
      </div>
    </section>
  );
}

interface MarketsPaneProps {
  state: CatalogState;
  store: CatalogStore;
  format: (at: number) => string;
}

export function MarketsPane(props: MarketsPaneProps) {
  const { state, store } = props;

  if (state.status === 'failed' && state.markets.length === 0) {
    return <p className="woc-note woc-note-bad">{state.error ?? UI_TEXT.catalogUnreachable}</p>;
  }

  return (
    <section className="woc-markets">
      <ErrorNote error={state.error} />
      <ul className="woc-list">
        {state.markets.map((market) => (
          <MarketRow
            key={market.ref.id}
            state={market}
            busy={state.busy === market.ref.id}
            store={store}
            format={props.format}
          />
        ))}
      </ul>
      <AddForm
        busy={state.status === 'loading'}
        onAdd={(url, ref) => {
          store.addMarket(url, ref);
        }}
      />
    </section>
  );
}
