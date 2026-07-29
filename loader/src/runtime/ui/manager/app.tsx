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
import type { DiagnosticsReading } from '../../diagnostics.ts';
import type { FrameBox } from '../frame/geometry.ts';
import { DiagnosticsPane } from './diagnostics.tsx';
import { InstalledPane } from './installed.tsx';
import type { InstalledState } from './store.ts';
import { UI_TEXT } from './strings.ts';
import { DEFAULT_TAB, findTab, TABS, type TabId } from './tabs.ts';
import { useInteractiveFrame } from './use-frame.ts';

interface ManagerAppProps {
  installed: InstalledState;
  onToggle: (fqid: string, on: boolean) => void;
  readDiagnostics: () => DiagnosticsReading;
  onClose: () => void;
  /** Null until the player has moved or resized the window. */
  box: FrameBox | null;
  onGeometry: (box: FrameBox) => void;
}

function tabClass(active: boolean): string {
  if (active) {
    return 'woc-tab woc-tab-active';
  }
  return 'woc-tab';
}

function Pane(props: { tab: TabId; app: ManagerAppProps }) {
  const def = findTab(props.tab);
  if (!def.built) {
    return <p className="woc-note">{def.pending}</p>;
  }
  if (props.tab === 'diagnostics') {
    return <DiagnosticsPane read={props.app.readDiagnostics} />;
  }
  return <InstalledPane state={props.app.installed} onToggle={props.app.onToggle} />;
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
