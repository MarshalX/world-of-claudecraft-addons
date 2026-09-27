// What `pnpm shots` decides: the crop, the scale, and the manifest edit. The browser half is
// not faked; the arithmetic around it lives in `tools/shots-core.ts` so it can be tested here.

import { describe, expect, it } from 'vitest';
import {
  CROP_MARGIN,
  cropAround,
  DEFAULT_HOST,
  fillsSlot,
  hostFor,
  largerScale,
  MAX_BYTES,
  MIN_DEVICE_WIDTH,
  onlyFor,
  previewAlt,
  renderManifest,
  SCALES,
  SLOT_MARGIN,
  scaleFor,
  smallerScale,
  withinCap,
  withPreview,
} from '../tools/shots-core.ts';

function rect(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}

/** Read one key off a manifest, by computed access so neither Biome nor TypeScript objects. */
function at(record: Record<string, unknown>, name: string): unknown {
  return record[name];
}

/** A manifest in the shape every shipped one has, with preview after entry. */
function manifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'x', name: 'X', version: '1.0.0', entry: 'main.js', tags: ['combat'], ...over };
}

describe('cropping to what was drawn', () => {
  it('takes the frame plus room for its shadow', () => {
    expect(cropAround([rect(100, 200, 340, 320)])).toEqual({
      x: 100 - CROP_MARGIN,
      y: 200 - CROP_MARGIN,
      width: 340 + CROP_MARGIN * 2,
      height: 320 + CROP_MARGIN * 2,
    });
  });

  it('takes the union of every frame on screen', () => {
    const crop = cropAround([rect(100, 100, 200, 100), rect(400, 300, 100, 200)]);
    expect(crop.x).toBe(100 - CROP_MARGIN);
    expect(crop.width).toBe(400 + 100 - 100 + CROP_MARGIN * 2);
    expect(crop.height).toBe(300 + 200 - 100 + CROP_MARGIN * 2);
  });

  // A browser rejects a negative clip rather than clamping it.
  it('never asks for a crop off the top left of the page', () => {
    const crop = cropAround([rect(4, 2, 200, 100)]);
    expect(crop.x).toBe(0);
    expect(crop.y).toBe(0);
  });

  // A sheet already has a margin per pane, and a second one leaves its panels adrift.
  it('adds no margin when asked for none', () => {
    expect(cropAround([rect(100, 200, 340, 320)], 0)).toEqual(rect(100, 200, 340, 320));
  });

  it('refuses to photograph a scenario that drew nothing', () => {
    expect(() => cropAround([])).toThrow(/drew no frame/);
  });
});

describe('choosing a scale', () => {
  // Measured on the crop width, frame plus both margins, which is what fills the card slot.
  it('picks the smallest that fills the card slot', () => {
    // The combat meter's 340px panel crops to 388, and 2x clears 700.
    expect(scaleFor(340 + CROP_MARGIN * 2)).toBe(2);
    // The cooldown strip's 220px crops to 268, which needs 3x to get there.
    expect(scaleFor(220 + CROP_MARGIN * 2)).toBe(3);
  });

  it('never goes under 2x, however wide the panel', () => {
    expect(scaleFor(4000)).toBe(SCALES[0]);
  });

  // Past its own resolution an upscale is only blurrier.
  it('stops at the largest scale rather than growing without limit', () => {
    expect(scaleFor(1)).toBe(SCALES.at(-1));
    expect(largerScale(SCALES.at(-1) as number)).toBeNull();
  });

  it('steps down for the byte cap and up for the slot', () => {
    expect(smallerScale(3)).toBe(2);
    expect(largerScale(3)).toBe(4);
    expect(smallerScale(2)).toBeNull();
  });

  // `indexOf` answers -1 for an unknown scale, and one past that is the first entry.
  it('refuses to step from a scale it does not know', () => {
    expect(largerScale(2.5)).toBeNull();
    expect(smallerScale(2.5)).toBeNull();
  });

  // The width is verified against the output because a capture can lay out narrower than the
  // 1x prediction: 245 CSS px predicted, 228 captured, 684 device px against a 700 slot.
  it('reads a shortfall the prediction did not see', () => {
    expect(scaleFor(245)).toBe(3);
    expect(fillsSlot(228, 3)).toBe(false);
    expect(fillsSlot(228, largerScale(3) as number)).toBe(true);
  });

  it('sends a capture that only just reaches the slot up a scale', () => {
    expect(fillsSlot(MIN_DEVICE_WIDTH / 2, 2)).toBe(false);
    expect(scaleFor(MIN_DEVICE_WIDTH / 2)).toBe(3);
  });

  it('answers one scale either side of a rasteriser', () => {
    expect(scaleFor(348)).toBe(scaleFor(350));
  });

  it('still drops a scale for a width no rasteriser could account for', () => {
    expect(scaleFor(MIN_DEVICE_WIDTH / 2 + SLOT_MARGIN)).toBe(2);
  });
});

describe('describing a sheet of panels', () => {
  it('leaves a single panel to speak for itself', () => {
    expect(previewAlt([{ alt: 'the Cooldowns overlay, five bars.' }])).toBe(
      'the Cooldowns overlay, five bars.',
    );
  });

  // Positional, because "on the left" locates a panel and "the first one" does not.
  it('places two panels left and right, by caption', () => {
    expect(
      previewAlt([
        { caption: 'Bars', alt: 'five draining bars.' },
        { caption: 'Icon strip', alt: 'the same five as icons.' },
      ]),
    ).toBe(
      'On the left, Bars, five draining bars. On the right, Icon strip, the same five as icons.',
    );
  });

  // Past two, nothing in English usefully names the third of four, so it counts.
  it('numbers panels past a pair', () => {
    const alt = previewAlt([
      { caption: 'A', alt: 'one.' },
      { caption: 'B', alt: 'two.' },
      { caption: 'C', alt: 'three.' },
    ]);
    expect(alt).toContain('Panel 1 of 3, A, one.');
    expect(alt).toContain('Panel 3 of 3, C, three.');
  });

  it('leaves the title out of a panel that has no caption', () => {
    expect(previewAlt([{ alt: 'one.' }, { alt: 'two.' }])).toBe(
      'On the left, one. On the right, two.',
    );
  });
});

describe('which game a capture is a picture of', () => {
  // A preview pictures what a player reads in Browse, and players are on live, so the default
  // must not follow the stage's pbe.
  it('defaults to live rather than to the stage host', () => {
    expect(hostFor(['node', 'shots.mjs'])).toBe(DEFAULT_HOST);
    expect(DEFAULT_HOST).not.toContain('pbe');
  });

  it('takes an explicit host and drops a trailing slash', () => {
    const argv = ['node', 'shots.mjs', '--host', 'https://pbe.worldofclaudecraft.com/'];
    expect(hostFor(argv)).toBe('https://pbe.worldofclaudecraft.com');
  });

  it('refuses a --host with nothing after it', () => {
    expect(() => hostFor(['node', 'shots.mjs', '--host'])).toThrow(/needs a value/);
  });

  // Left in, the host would narrow the run to an addon directory that cannot exist.
  it('keeps the host value out of the addon ids', () => {
    const argv = ['node', 'shots.mjs', '--host', 'https://example.com', 'cadence'];
    expect(onlyFor(argv)).toEqual(['cadence']);
  });

  it('reads the flag after the ids as well as before them', () => {
    const argv = ['node', 'shots.mjs', 'cadence', '--host', 'https://example.com'];
    expect(hostFor(argv)).toBe('https://example.com');
    expect(onlyFor(argv)).toEqual(['cadence']);
  });

  it('captures every addon when no id is named', () => {
    expect(onlyFor(['node', 'shots.mjs'])).toEqual([]);
    expect(onlyFor(['node', 'shots.mjs', '--host', 'https://example.com'])).toEqual([]);
  });
});

describe('the byte cap', () => {
  // Equal is allowed because that is what `pnpm validate` accepts.
  it('allows exactly the cap and refuses one byte more', () => {
    expect(withinCap(MAX_BYTES)).toBe(true);
    expect(withinCap(MAX_BYTES + 1)).toBe(false);
  });
});

describe('declaring the preview in the manifest', () => {
  // Every shipped manifest carries preview directly after entry.
  it('inserts it directly after entry when there is none', () => {
    const built = withPreview(manifest(), 'a description', 'preview.png');
    expect(Object.keys(built)).toEqual(['id', 'name', 'version', 'entry', 'preview', 'tags']);
  });

  it('replaces one in place, keeping its position', () => {
    const before = manifest({ preview: { file: 'preview.png', alt: 'old' } });
    const built = withPreview(before, 'new', 'preview.png');
    expect(Object.keys(built)).toEqual(Object.keys(before));
    expect(at(built, 'preview')).toEqual({ file: 'preview.png', alt: 'new' });
  });

  it('writes the alt verbatim', () => {
    const built = withPreview(manifest(), 'Two rows, 4.4s and 5.8s.', 'preview.png');
    expect(at(built, 'preview')).toEqual({ file: 'preview.png', alt: 'Two rows, 4.4s and 5.8s.' });
  });

  it('leaves every other key untouched', () => {
    const before = manifest({ permissions: ['ui'], keybinds: [{ id: 'toggle' }] });
    const built = withPreview(before, 'a', 'preview.png');
    expect(at(built, 'permissions')).toBe(at(before, 'permissions'));
    expect(at(built, 'keybinds')).toBe(at(before, 'keybinds'));
  });

  it('ends the file with a newline, as every manifest in the tree does', () => {
    expect(renderManifest(manifest())).toMatch(/\}\n$/);
  });
});
