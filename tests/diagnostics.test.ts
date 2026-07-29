// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { type DiagnosticsDeps, readDiagnostics } from '../loader/src/runtime/diagnostics.ts';
import type { NetState } from '../loader/src/runtime/net/state.ts';
import { ANCHOR_KEYS, ANCHORS } from '../loader/src/runtime/ui/anchors.ts';
import { mountGameMenu, mountGameVersion } from './fakes/game-dom.ts';

const CLOSED: NetState = {
  connected: false,
  tick: 0,
  tickHz: 20,
  pid: null,
  realm: null,
  seed: null,
  latencyMs: null,
  reconnects: 0,
};

function read(overrides: Partial<DiagnosticsDeps> = {}) {
  return readDiagnostics({
    doc: document,
    origin: 'https://pbe.worldofclaudecraft.com',
    channel: 'pbe',
    loaderVersion: '0.4.1',
    bridged: true,
    net: CLOSED,
    probe: null,
    ...overrides,
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the diagnostics reading', () => {
  it('carries the host facts it was handed', () => {
    const reading = read();

    expect(reading.channel).toBe('pbe');
    expect(reading.origin).toBe('https://pbe.worldofclaudecraft.com');
    expect(reading.loaderVersion).toBe('0.4.1');
    expect(reading.bridged).toBe(true);
  });

  it('reads the game version off the page', () => {
    mountGameVersion(document, 'v0.31 build 1a2b3c4d5e6f');

    expect(read().game).toEqual({ version: '0.31.0', build: '1a2b3c4d5e6f' });
  });

  // Before world entry there is nothing to read, and that is an ordinary state
  // rather than a fault the pane should shout about.
  it('answers a null game version when the footer is absent', () => {
    expect(read().game).toBeNull();
  });

  // The point of the anchor table is that drift is visible. A report that
  // silently skipped an anchor would hide exactly the thing it exists to show.
  it('reports every anchor, resolved or not', () => {
    const reading = read();

    expect(reading.anchors.map((anchor) => anchor.key)).toEqual(ANCHOR_KEYS);
    expect(reading.anchors.every((anchor) => !anchor.found)).toBe(true);
  });

  it('marks an anchor found once its element is there', () => {
    mountGameMenu(document);

    const reading = read();
    const byKey = new Map(reading.anchors.map((anchor) => [anchor.key, anchor]));

    expect(byKey.get('optionsMenu')).toEqual({
      key: 'optionsMenu',
      selector: ANCHORS.optionsMenu,
      found: true,
    });
    expect(byKey.get('hudRoot')?.found).toBe(true);
    // The rail is not part of the menu fixture, so this one is genuinely absent.
    expect(byKey.get('microColumn')?.found).toBe(false);
  });

  it('passes the socket state through untouched', () => {
    const live: NetState = { ...CLOSED, connected: true, realm: 'Claudemoon', latencyMs: 42.4 };

    expect(read({ net: live }).net).toEqual(live);
  });
});
