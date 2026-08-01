// @vitest-environment happy-dom

// The zone reading, which is the one world read whose source is the game's DOM.
//
// Its failure mode is silence: the element ships inside the game's UI template
// and does not exist before world entry, so "not there" and "not in the world
// yet" look identical, and both have to answer null rather than throwing at an
// addon that read it on the login screen.

import { beforeEach, describe, expect, it } from 'vitest';
import { ANCHORS } from '../loader/src/runtime/ui/anchors.ts';
import { createZoneReader } from '../loader/src/runtime/world/zone.ts';

function label(text: string): HTMLElement {
  const el = document.createElement('div');
  el.id = ANCHORS.zoneLabel.slice(1);
  el.textContent = text;
  document.body.appendChild(el);
  return el;
}

describe('createZoneReader', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('answers null before the HUD exists, rather than throwing at an addon', () => {
    expect(createZoneReader(document)()).toBeNull();
  });

  it('reads the label the game is displaying', () => {
    label('Thornpeak Vale');

    expect(createZoneReader(document)()).toBe('Thornpeak Vale');
  });

  // The painter writes this element every frame, so the reader has to follow it
  // rather than answer whatever was there when the addon started.
  it('follows the label as the player moves', () => {
    const el = label('Thornpeak Vale');
    const zone = createZoneReader(document);

    el.textContent = 'Eastbrook';

    expect(zone()).toBe('Eastbrook');
  });

  it('trims what the painter wrote', () => {
    label('  Eastbrook \n');

    expect(createZoneReader(document)()).toBe('Eastbrook');
  });

  // An empty label is the painter having nothing to say, which is the same
  // answer as no HUD rather than a zone whose name is the empty string.
  it('answers null for an empty label', () => {
    label('   ');

    expect(createZoneReader(document)()).toBeNull();
  });
});
