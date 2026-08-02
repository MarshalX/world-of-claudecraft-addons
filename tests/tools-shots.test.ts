// What `pnpm shots` decides: the crop, the scale, and the manifest edit.
//
// The browser half is not testable from here and is not worth faking: a
// screenshot either happens or it does not, and a fake Playwright would be a test
// of the fake. What CAN be wrong is the arithmetic around it, and all of it is in
// `tools/shots-core.ts` for that reason.
//
// Two groups carry incidents rather than intentions. The scale pass grew a
// verification step because a prediction made at 1x undershot the real capture,
// and the manifest group exists because writing a file back through
// `JSON.stringify` reformats parts of it nobody asked to change.

import { describe, expect, it } from 'vitest';
import {
  CROP_MARGIN,
  cropAround,
  fillsSlot,
  largerScale,
  MAX_BYTES,
  MIN_DEVICE_WIDTH,
  previewAlt,
  renderManifest,
  SCALES,
  scaleFor,
  smallerScale,
  withinCap,
  withPreview,
} from '../tools/shots-core.ts';

function rect(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}

/**
 * Read one key off a manifest.
 *
 * The computed access STYLE.md prescribes: Biome wants `built.preview` and
 * TypeScript forbids dotting into an index signature, so neither call site
 * carries a literal key.
 */
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

  // An addon may legitimately put up more than one frame, and a crop around the
  // first would cut the others out of their own preview.
  it('takes the union of every frame on screen', () => {
    const crop = cropAround([rect(100, 100, 200, 100), rect(400, 300, 100, 200)]);
    expect(crop.x).toBe(100 - CROP_MARGIN);
    expect(crop.width).toBe(400 + 100 - 100 + CROP_MARGIN * 2);
    expect(crop.height).toBe(300 + 200 - 100 + CROP_MARGIN * 2);
  });

  // A browser rejects a negative clip rather than clamping it, so a frame pushed
  // against the edge would fail the capture instead of losing its margin.
  it('never asks for a crop off the top left of the page', () => {
    const crop = cropAround([rect(4, 2, 200, 100)]);
    expect(crop.x).toBe(0);
    expect(crop.y).toBe(0);
  });

  // A sheet has already had a margin applied per pane, inside the browser.
  // Adding it again out here put a second one around the outside only, which is
  // what left the first sheet with its panels adrift in the middle of the image.
  it('adds no margin when asked for none', () => {
    expect(cropAround([rect(100, 200, 340, 320)], 0)).toEqual(rect(100, 200, 340, 320));
  });

  // The alternative is a zero-byte PNG of nothing, committed, and a Browse row
  // showing an empty box that reads as a picture that failed to load.
  it('refuses to photograph a scenario that drew nothing', () => {
    expect(() => cropAround([])).toThrow(/drew no frame/);
  });
});

describe('choosing a scale', () => {
  // It takes the CROP width, which is the frame plus both margins, because that
  // is what ends up in the file and what the card slot is measured against.
  it('picks the smallest that fills the card slot', () => {
    // The combat meter's 340px panel crops to 388, and 2x clears 700.
    expect(scaleFor(340 + CROP_MARGIN * 2)).toBe(2);
    // The cooldown strip's 220px crops to 268, which needs 3x to get there.
    expect(scaleFor(220 + CROP_MARGIN * 2)).toBe(3);
  });

  it('never goes under 2x, however wide the panel', () => {
    expect(scaleFor(4000)).toBe(SCALES[0]);
  });

  // Capping rather than continuing: an addon whose panel is genuinely tiny cannot
  // be made to fill the slot without inventing pixels, and a preview upscaled
  // past its own resolution is a blurrier picture, not a bigger one.
  it('stops at the largest scale rather than growing without limit', () => {
    expect(scaleFor(1)).toBe(SCALES.at(-1));
    expect(largerScale(SCALES.at(-1) as number)).toBeNull();
  });

  it('steps down for the byte cap and up for the slot', () => {
    expect(smallerScale(3)).toBe(2);
    expect(largerScale(3)).toBe(4);
    expect(smallerScale(2)).toBeNull();
  });

  // `indexOf` answers -1 for a scale that is not in the list, and reading one
  // past that is the FIRST entry. Without the guard an unrecognised scale would
  // read as "step up to 2x", which is a step down dressed as a step up.
  it('refuses to step from a scale it does not know', () => {
    expect(largerScale(2.5)).toBeNull();
    expect(smallerScale(2.5)).toBeNull();
  });

  // The reason the width is verified against the OUTPUT rather than the
  // prediction: cooldown-bars measured 245 CSS px at 1x and captured 228 at 3x,
  // which is 684 device pixels against a 700 slot.
  it('reads a shortfall the prediction did not see', () => {
    expect(scaleFor(245)).toBe(3);
    expect(fillsSlot(228, 3)).toBe(false);
    expect(fillsSlot(228, largerScale(3) as number)).toBe(true);
  });

  it('holds a capture at exactly the slot width', () => {
    expect(fillsSlot(MIN_DEVICE_WIDTH / 2, 2)).toBe(true);
  });
});

describe('describing a sheet of panels', () => {
  // One panel is every preview that existed before sheets, and its own sentence
  // is already a whole description. Wrapping it would be adding words nobody
  // needs to hear before the picture.
  it('leaves a single panel to speak for itself', () => {
    expect(previewAlt([{ alt: 'the Cooldowns overlay, five bars.' }])).toBe(
      'the Cooldowns overlay, five bars.',
    );
  });

  // Positional, because that is what a reader who cannot see the image needs:
  // "on the left" locates a panel and "the first one" does not.
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

describe('the byte cap', () => {
  // The manager loads this INSIDE the running game, over whatever connection the
  // player has, which is what the cap is about. Equal is allowed because that is
  // what `pnpm validate` accepts.
  it('allows exactly the cap and refuses one byte more', () => {
    expect(withinCap(MAX_BYTES)).toBe(true);
    expect(withinCap(MAX_BYTES + 1)).toBe(false);
  });
});

describe('declaring the preview in the manifest', () => {
  // Every shipped manifest carries preview directly after entry. Appending it
  // instead would move it to the end of the file on the first capture and leave
  // the two shipped addons looking different from every addon captured later.
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

  // The alt is the sentence a screen reader reads instead of the image, so it is
  // carried through exactly as written rather than trimmed or sentence-cased.
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
