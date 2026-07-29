// One reading of everything the manager's Diagnostics pane reports.
//
// Gathered here rather than in the pane so it is a plain value a Node test can
// assert on, and so the pane stays a renderer. Every field is a reading rather
// than a verdict: an anchor that does not resolve, or a game that has not loaded
// yet, are both ordinary states, and presenting them as faults would train a
// player to ignore the pane.

import { type GameVersion, parseGameVersion } from './game-version.ts';
import type { NetState } from './net/state.ts';
import type { GameProbe } from './probe.ts';
import { ANCHORS, type AnchorReport, resolveAnchors } from './ui/anchors.ts';

interface DiagnosticsDeps {
  doc: Pick<Document, 'querySelector'>;
  origin: string;
  channel: string;
  /** The installed userscript's version, carried in from the host at boot. */
  loaderVersion: string;
  /** False when the handshake failed, which it may do permanently. */
  bridged: boolean;
  net: NetState;
  /** Null until the game reaches world entry. */
  probe: GameProbe | null;
}

interface DiagnosticsReading {
  origin: string;
  channel: string;
  loaderVersion: string;
  bridged: boolean;
  game: GameVersion | null;
  probe: GameProbe | null;
  net: NetState;
  anchors: AnchorReport[];
}

function readDiagnostics(deps: DiagnosticsDeps): DiagnosticsReading {
  const versionEl = deps.doc.querySelector(ANCHORS.gameVersion);
  return {
    origin: deps.origin,
    channel: deps.channel,
    loaderVersion: deps.loaderVersion,
    bridged: deps.bridged,
    game: parseGameVersion(versionEl?.textContent),
    probe: deps.probe,
    net: deps.net,
    anchors: resolveAnchors(deps.doc),
  };
}

export type { DiagnosticsDeps, DiagnosticsReading };
export { readDiagnostics };
