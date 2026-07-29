// Composes the loader's own UI: the root, both injection points, and the manager.
//
// The three ways in are deliberately independent. The game menu entry and the
// rail button both live in game DOM and can be taken away by a game update; the
// userscript popup command is host-side and cannot. Wiring all three to one
// manager here means a route that stops working costs a route rather than the
// manager.
//
// The root and the manager come up as soon as the document is parsed, so the
// manager is reachable from the start screen. The two in-game routes wait for
// the HUD, which does not exist until world entry: see ui/hud-mount.ts.
//
// Whether either in-game route found its anchor is not reported from here.
// Diagnostics resolves the anchor table live, which answers the same question
// without a boolean that was true once at mount and has been stale since.

import { diagError } from '../../shared/diag.ts';
import type { DiagnosticsReading } from '../diagnostics.ts';
import { ANCHORS, ANCHORS_REQUIRED_IN_GAME } from './anchors.ts';
import { mountMenuEntry } from './esc-inject.ts';
import { whenHudMounts } from './hud-mount.ts';
import type { GeometryStorage } from './manager/geometry-store.ts';
import { type InstalledRegistry, type Manager, mountManager } from './manager/index.tsx';
import { mountMicroButton } from './micro-button.ts';
import { mountRoot } from './root.ts';

/** The one label both in-game entry points carry. */
const LABEL = 'Addons';

/**
 * Report any anchor that should be there and is not.
 *
 * Without this a game update that renames a selector costs the player a button
 * and says nothing: the injection declines quietly by design, so the only trace
 * is a Diagnostics pane nobody has a reason to open. Written once per attach,
 * not per attempt.
 */
function reportMissingAnchors(doc: Document): void {
  const missing = ANCHORS_REQUIRED_IN_GAME.filter(
    (key) => doc.querySelector(ANCHORS[key]) === null,
  );
  if (missing.length === 0) {
    return;
  }
  diagError(
    'the game HUD is up but these anchors did not resolve, so the loader has lost a way in',
    missing.map((key) => `${key} (${ANCHORS[key]})`),
  );
}

export interface UiDeps {
  doc: Document;
  /** The loader stylesheet, bundled as text. */
  css: string;
  /** Null when the bridge never connected. */
  registry: InstalledRegistry | null;
  /** Null when the bridge never connected. Only the window position uses it. */
  storage: GeometryStorage | null;
  channel: string;
  readDiagnostics: () => DiagnosticsReading;
}

export interface MountedUi {
  manager: Manager;
  dispose: () => void;
}

export function mountUi(deps: UiDeps): MountedUi {
  const root = mountRoot({ doc: deps.doc, css: deps.css });
  const manager = mountManager({
    doc: deps.doc,
    root: root.el,
    registry: deps.registry,
    storage: deps.storage,
    channel: deps.channel,
    readDiagnostics: deps.readDiagnostics,
  });

  const onOpen = (): void => {
    manager.toggle();
  };

  let inGame: Array<{ dispose: () => void }> = [];
  const detach = (): void => {
    for (const mounted of inGame) {
      mounted.dispose();
    }
    inGame = [];
  };

  const hud = whenHudMounts({
    doc: deps.doc,
    detach,
    attach: () => {
      reportMissingAnchors(deps.doc);
      inGame = [
        mountMenuEntry({ doc: deps.doc, label: LABEL, onOpen }),
        mountMicroButton({ doc: deps.doc, label: LABEL, onOpen }),
      ];
    },
  });

  return {
    manager,
    dispose: () => {
      hud.cancel();
      detach();
      manager.dispose();
      root.dispose();
    },
  };
}
