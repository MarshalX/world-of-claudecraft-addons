// The manager window: chrome, tab strip, and the pane for the selected tab.
//
// It wears the game's `panel` and `panel-title` classes to inherit the game's look. It must NOT
// wear the game's `window` class, which is `display: none` by default and positioned for life
// inside #ui, while the manager lives at body level.

import { useEffect, useState } from 'preact/hooks';
import type { InstalledAddon } from '../../../shared/protocol.ts';
import type { DiagnosticsReading } from '../../diagnostics.ts';
import type { FreezeControl } from '../../freeze.ts';
import type { LogEntry } from '../../log/buffer.ts';
import type { AddonStatus } from '../../supervisor.ts';
import type { FrameBox } from '../frame/geometry.ts';
import { CLOSE_PATH, CLOSE_SIZE, CLOSE_STROKE_WIDTH, CLOSE_VIEWBOX } from '../kit/close-glyph.ts';
import { BrowsePane } from './browse.tsx';
import type { BrowseFilter } from './catalog.ts';
import { catalogShots, NO_FILTER, offeredAddons } from './catalog.ts';
import type { CatalogStore } from './catalog-store.ts';
import type { AddonConfig, ConflictReading } from './config.ts';
import { DetailPane } from './detail.tsx';
import { DevPane } from './dev.tsx';
import type { DevPaneState, DevStore } from './dev-store.ts';
import { DiagnosticsPane } from './diagnostics.tsx';
import { InstalledPane } from './installed.tsx';
import { MarketsPane } from './markets.tsx';
import { statusView } from './status.ts';
import type { InstalledState } from './store.ts';
import { UI_TEXT } from './strings.ts';
import { DEFAULT_TAB, TABS, type TabId } from './tabs.ts';
import { UpdatesPane } from './updates.tsx';
import { useInteractiveFrame } from './use-frame.ts';

interface ManagerAppProps {
  installed: InstalledState;
  statuses: readonly AddonStatus[];
  onToggle: (fqid: string, on: boolean) => void;
  onReload: (fqid: string) => void;
  onUninstall: (fqid: string) => void;
  onReloadAll: () => void;
  dev: DevPaneState;
  devStore: DevStore;
  /** The Dev tab's freeze. Runtime-only: it reaches neither a store nor the host. */
  freeze: FreezeControl;
  /** Passed whole, since three panes read different parts. A repaint makes a read current. */
  catalogStore: CatalogStore;
  formatTime: (at: number) => string;
  readDiagnostics: () => DiagnosticsReading;
  onClose: () => void;
  /** Whether the arrange mode is on. A prop so the render stays pure; the keybind toggles it too. */
  unlocked: boolean;
  onUnlock: (on: boolean) => void;
  /** Null until the player has moved or resized the window. */
  box: FrameBox | null;
  onGeometry: (box: FrameBox) => void;
  /** The addon whose own page is open, or null for the list. */
  openAddon: InstalledAddon | null;
  /** Null while that addon's stores are still hydrating. */
  openConfig: AddonConfig | null;
  onOpenAddon: (fqid: string) => void;
  onCloseAddon: () => void;
  conflicts: (combo: string) => ConflictReading;
  capture: () => Promise<string | null>;
  logs: (fqid: string) => readonly LogEntry[];
}

function tabClass(active: boolean): string {
  if (active) {
    return 'woc-tab woc-tab-active';
  }
  return 'woc-tab';
}

/**
 * The Installed tab: the list, or one addon's page. Which one lives in the manager rather than in
 * component state, so its stores load before it renders and an outside repaint does not reset it.
 */
function InstalledTab(props: { app: ManagerAppProps; onFind: (name: string) => void }) {
  const { app } = props;
  const open = app.openAddon;
  if (open !== null) {
    return (
      <DetailPane
        addon={open}
        config={app.openConfig}
        conflicts={app.conflicts}
        capture={app.capture}
        logs={app.logs(open.fqid)}
        status={statusView(app.statuses, open.fqid)}
        onBack={app.onCloseAddon}
        onToggle={(on) => {
          app.onToggle(open.fqid, on);
        }}
        onReload={() => {
          app.onReload(open.fqid);
        }}
        onUninstall={() => {
          // Back to the list first: this page's addon is leaving the registry.
          app.onCloseAddon();
          app.onUninstall(open.fqid);
        }}
      />
    );
  }
  const catalog = app.catalogStore.state();
  return (
    <InstalledPane
      state={app.installed}
      statuses={app.statuses}
      // Off the catalog: only the source list knows whether a companion is on offer.
      offered={offeredAddons(catalog.markets)}
      // The registry keeps no addon directory, so it cannot say where the picture is.
      shots={catalogShots(catalog.markets)}
      onToggle={app.onToggle}
      onOpen={app.onOpenAddon}
      onFind={props.onFind}
      unlocked={app.unlocked}
      onUnlock={app.onUnlock}
    />
  );
}

interface CatalogTabProps {
  tab: TabId;
  app: ManagerAppProps;
  filter: BrowseFilter;
  onFilter: (filter: BrowseFilter) => void;
}

/** Browse, Marketplaces, and Updates: the three views of one catalog reading. */
function CatalogTab(props: CatalogTabProps) {
  const { app } = props;
  const state = app.catalogStore.state();
  if (props.tab === 'browse') {
    return (
      <BrowsePane
        state={state}
        store={app.catalogStore}
        filter={props.filter}
        onFilter={props.onFilter}
      />
    );
  }
  if (props.tab === 'marketplaces') {
    return <MarketsPane state={state} store={app.catalogStore} format={app.formatTime} />;
  }
  return <UpdatesPane state={state} store={app.catalogStore} />;
}

const CATALOG_TABS: readonly TabId[] = ['browse', 'marketplaces', 'updates'];

interface PaneProps extends CatalogTabProps {
  onFind: (name: string) => void;
}

function Pane(props: PaneProps) {
  if (props.tab === 'diagnostics') {
    return <DiagnosticsPane read={props.app.readDiagnostics} />;
  }
  if (props.tab === 'dev') {
    return (
      <DevPane
        state={props.app.dev}
        store={props.app.devStore}
        onReloadAll={props.app.onReloadAll}
        format={props.app.formatTime}
        freeze={props.app.freeze}
      />
    );
  }
  if (CATALOG_TABS.includes(props.tab)) {
    return (
      <CatalogTab tab={props.tab} app={props.app} filter={props.filter} onFilter={props.onFilter} />
    );
  }
  return <InstalledTab app={props.app} onFind={props.onFind} />;
}

function TabStrip(props: { active: TabId; onPick: (id: TabId) => void }) {
  return (
    <nav className="woc-tabs">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={tabClass(tab.id === props.active)}
          aria-current={tab.id === props.active}
          onClick={() => {
            props.onPick(tab.id);
          }}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

/** Escape closes the manager, captured so the game does not also close what is behind it. */
function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    globalThis.addEventListener('keydown', onKey, true);
    return () => {
      globalThis.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);
}

/**
 * The close mark as JSX, the preact renderer over kit/close-glyph.ts. Hidden from assistive tech
 * because the button carries the accessible name.
 */
function CloseGlyph() {
  return (
    <svg viewBox={CLOSE_VIEWBOX} width={CLOSE_SIZE} height={CLOSE_SIZE} aria-hidden="true">
      <path
        d={CLOSE_PATH}
        stroke="currentColor"
        strokeWidth={CLOSE_STROKE_WIDTH}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function ManagerApp(props: ManagerAppProps) {
  const [tab, setTab] = useState<TabId>(DEFAULT_TAB);
  // Browse's search lives here, so a companion's "Find it" can switch tab and fill it. A pane
  // owning its filter would be rebuilt empty by the switch.
  const [filter, setFilter] = useState<BrowseFilter>(NO_FILTER);
  useEscapeToClose(props.onClose);
  const refs = useInteractiveFrame({ box: props.box, onGeometry: props.onGeometry });
  const onFind = (name: string): void => {
    setFilter({ ...NO_FILTER, query: name });
    setTab('browse');
  };

  return (
    <section
      ref={refs.frame}
      className="woc-window panel"
      // Marks the manager's window, since `.woc-window` is every addon frame too. frame.tsx
      // raises it by this on open.
      data-woc-manager=""
      role="dialog"
      aria-label={UI_TEXT.title}
    >
      <header ref={refs.handle} className="woc-titlebar panel-title">
        <span className="woc-title">{UI_TEXT.title}</span>
        <button
          type="button"
          className="woc-close x-btn"
          aria-label={UI_TEXT.close}
          onClick={props.onClose}
        >
          <CloseGlyph />
        </button>
      </header>
      <TabStrip active={tab} onPick={setTab} />
      <div className="woc-pane">
        <Pane tab={tab} app={props} filter={filter} onFilter={setFilter} onFind={onFind} />
      </div>
    </section>
  );
}

export { ManagerApp };
