// The manager window: chrome, tab strip, and the pane for the selected tab.
//
// The window carries the game's own `panel` and `panel-title` classes alongside
// ours, so it inherits the game's border, background, and :root tokens rather
// than shipping a copy that a game restyle would leave behind.
//
// It deliberately does NOT carry the game's `window` class. That class is
// `display: none` by default and is positioned for life inside #ui, where the
// HUD's zoom applies; the manager lives at body level, so it takes the look from
// `panel` and supplies its own layout.

import { useEffect, useState } from 'preact/hooks';
import type { InstalledAddon } from '../../../shared/protocol.ts';
import type { DiagnosticsReading } from '../../diagnostics.ts';
import type { LogEntry } from '../../log/buffer.ts';
import type { AddonStatus } from '../../supervisor.ts';
import type { FrameBox } from '../frame/geometry.ts';
import type { AddonConfig, ConflictReading } from './config.ts';
import { DetailPane } from './detail.tsx';
import { DevPane } from './dev.tsx';
import type { DevPaneState, DevStore } from './dev-store.ts';
import { DiagnosticsPane } from './diagnostics.tsx';
import { InstalledPane } from './installed.tsx';
import { statusView } from './status.ts';
import type { InstalledState } from './store.ts';
import { UI_TEXT } from './strings.ts';
import { DEFAULT_TAB, findTab, TABS, type TabId } from './tabs.ts';
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
  formatTime: (at: number) => string;
  readDiagnostics: () => DiagnosticsReading;
  onClose: () => void;
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
 * The Installed tab is two views: the list, and one addon's own page.
 *
 * Which one is showing lives in the manager rather than in component state, so
 * the stores an open page reads can be loaded before it renders and a repaint
 * driven from outside the tree does not reset it to the list.
 */
function InstalledTab(props: { app: ManagerAppProps }) {
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
          // Back to the list first: the page about to be shown belongs to an
          // addon that is on its way out of the registry.
          app.onCloseAddon();
          app.onUninstall(open.fqid);
        }}
      />
    );
  }
  return (
    <InstalledPane
      state={app.installed}
      statuses={app.statuses}
      onToggle={app.onToggle}
      onOpen={app.onOpenAddon}
    />
  );
}

function Pane(props: { tab: TabId; app: ManagerAppProps }) {
  const def = findTab(props.tab);
  if (!def.built) {
    return <p className="woc-note">{def.pending}</p>;
  }
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
      />
    );
  }
  return <InstalledTab app={props.app} />;
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

/**
 * Escape closes the manager and stops there.
 *
 * Captured, so the game's own bubble-phase handler does not also close whatever
 * it has open behind the manager. One key press should close one thing.
 */
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

function ManagerApp(props: ManagerAppProps) {
  const [tab, setTab] = useState<TabId>(DEFAULT_TAB);
  useEscapeToClose(props.onClose);
  const refs = useInteractiveFrame({ box: props.box, onGeometry: props.onGeometry });

  return (
    <section ref={refs.frame} className="woc-window panel" role="dialog" aria-label={UI_TEXT.title}>
      <header ref={refs.handle} className="woc-titlebar panel-title">
        <span className="woc-title">{UI_TEXT.title}</span>
        <button
          type="button"
          className="woc-close x-btn"
          aria-label={UI_TEXT.close}
          onClick={props.onClose}
        >
          {UI_TEXT.closeGlyph}
        </button>
      </header>
      <TabStrip active={tab} onPick={setTab} />
      <div className="woc-pane">
        <Pane tab={tab} app={props} />
      </div>
    </section>
  );
}

export { ManagerApp };
