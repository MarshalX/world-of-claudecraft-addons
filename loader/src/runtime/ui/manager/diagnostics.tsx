// The Diagnostics pane: what the loader can currently see.
//
// Read fresh on every render rather than held in state. The reading is cheap,
// and a stale diagnostics pane is worse than none: it is consulted precisely
// when something has changed underneath it.

import type { DiagnosticsReading } from '../../diagnostics.ts';
import type { GameVersion } from '../../game-version.ts';
import type { NetState } from '../../net/state.ts';
import type { GameProbe } from '../../probe.ts';
import { UI_TEXT } from './strings.ts';

function probeLabel(probe: GameProbe | null): string {
  if (probe === null) {
    return UI_TEXT.probeUnread;
  }
  const summary = `${probe.present.length} members present, ${probe.missing.length} missing`;
  if (probe.added.length === 0) {
    return summary;
  }
  return `${summary}, ${probe.added.length} new`;
}

function gameLabel(game: GameVersion | null): string {
  if (game === null) {
    return UI_TEXT.gameUnreadable;
  }
  return `${game.version} build ${game.build ?? UI_TEXT.unknown}`;
}

function socketLabel(net: NetState): string {
  if (!net.connected) {
    return UI_TEXT.socketClosed;
  }
  return `realm ${net.realm ?? UI_TEXT.unknown}`;
}

function latencyLabel(net: NetState): string {
  if (net.latencyMs === null) {
    return UI_TEXT.latencyUnmeasured;
  }
  return `${Math.round(net.latencyMs)} ms`;
}

function bridgeLabel(bridged: boolean): string {
  if (bridged) {
    return UI_TEXT.bridgeConnected;
  }
  return UI_TEXT.bridgeMissing;
}

function anchorLabel(found: boolean): string {
  if (found) {
    return UI_TEXT.anchorFound;
  }
  return UI_TEXT.anchorMissing;
}

function anchorClass(found: boolean): string {
  if (found) {
    return 'woc-anchor-ok';
  }
  return 'woc-anchor-missing';
}

function Row(props: { label: string; value: string }) {
  return (
    <div className="woc-kv">
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  );
}

function Anchors(props: { reading: DiagnosticsReading }) {
  return (
    <ul className="woc-anchors">
      {props.reading.anchors.map((anchor) => (
        <li key={anchor.key} className={anchorClass(anchor.found)}>
          <code>{anchor.selector}</code>
          <span>{anchorLabel(anchor.found)}</span>
        </li>
      ))}
    </ul>
  );
}

function Missing(props: { probe: GameProbe | null }) {
  const { probe } = props;
  if (probe === null || probe.missing.length === 0) {
    return null;
  }
  return (
    <p className="woc-note woc-note-bad">
      {UI_TEXT.probeMissingPrefix}
      {probe.missing.join(', ')}
    </p>
  );
}

export function DiagnosticsPane(props: { read: () => DiagnosticsReading }) {
  const reading = props.read();
  const { net } = reading;

  return (
    <div className="woc-diagnostics">
      <dl className="woc-kv-list">
        <Row label={UI_TEXT.channel} value={reading.channel} />
        <Row label={UI_TEXT.origin} value={reading.origin} />
        <Row label={UI_TEXT.loader} value={reading.loaderVersion} />
        <Row label={UI_TEXT.game} value={gameLabel(reading.game)} />
        <Row label={UI_TEXT.bridge} value={bridgeLabel(reading.bridged)} />
        <Row label={UI_TEXT.probe} value={probeLabel(reading.probe)} />
        <Row label={UI_TEXT.socket} value={socketLabel(net)} />
        <Row label={UI_TEXT.tick} value={`${net.tick} at ${net.tickHz} Hz`} />
        <Row label={UI_TEXT.latency} value={latencyLabel(net)} />
        <Row label={UI_TEXT.reconnects} value={String(net.reconnects)} />
      </dl>

      <h3 className="woc-subhead">{UI_TEXT.anchorsHeading}</h3>
      <p className="woc-note">{UI_TEXT.anchorsNote}</p>
      <Anchors reading={reading} />
      <Missing probe={reading.probe} />
    </div>
  );
}
