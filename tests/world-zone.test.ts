// @vitest-environment happy-dom

// The zone reading, from the game's DOM: the element does not exist before world entry.

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

  it('answers null before the HUD exists', () => {
    expect(createZoneReader(document)()).toBeNull();
  });

  it('reads the label the game is displaying', () => {
    label('Thornpeak Vale');

    expect(createZoneReader(document)()).toBe('Thornpeak Vale');
  });

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

  it('answers null for an empty label', () => {
    label('   ');

    expect(createZoneReader(document)()).toBeNull();
  });
});
