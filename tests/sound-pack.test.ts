// Reading the game's SFX runtime pack.
//
// The fixtures are shaped from the real /audio/sfx/runtime-pack.json on pbe,
// including the fact that a cue is not a file: `combat_block` is one cue with
// three variants, which is why the deployed 432 files are 220 cues. A test
// written against a directory listing would have agreed with a loader that
// offered addon authors 212 cue names that do not resolve.

import { describe, expect, it } from 'vitest';
import type { PackResult } from '../loader/src/runtime/sound/pack.ts';
import { fallbackCueUrl, PACK_URL, parseSoundPack } from '../loader/src/runtime/sound/pack.ts';

/** Trimmed from the real pack, keeping one single-variant and one family cue. */
function realisticPack(): unknown {
  return {
    format: 'woc-sfx-runtime-pack',
    version: 1,
    bundleId: '589b200f6d01f494f775ea85fe10a60b49a0e1de3d47930b4dc505de5a9dfa74',
    catalogHash: '6ac7a8dfa12e88c88febb2bb607212d72150c25b540d94457c63e7ed49ef311d',
    // Built from entry pairs: cue names are the game's own and are not ours to
    // rename into camelCase.
    clips: Object.fromEntries([
      [
        'ui_click',
        {
          variants: [{ id: 'main', url: '/audio/sfx/ui_click.mp3?v=aabbccdd', bytes: 4210 }],
          gain: 1.7579,
          playbackRate: 1,
        },
      ],
      [
        'combat_block',
        {
          variants: [
            { id: '1', url: '/audio/sfx/combat_block_1.mp3?v=1555a71f0ba6', bytes: 9447 },
            { id: '2', url: '/audio/sfx/combat_block_2.mp3?v=c09d3045e1e4', bytes: 10_074 },
            { id: '3', url: '/audio/sfx/combat_block_3.mp3?v=fc63d137a8d8', bytes: 12_537 },
          ],
          gain: 1,
          playbackRate: 1,
        },
      ],
    ]),
  };
}

function parse(input: unknown) {
  const result = parseSoundPack(input);
  if (!result.ok) {
    throw new Error(`expected a pack, got: ${result.reason}`);
  }
  return result.pack;
}

/** Only the refusal arm carries a reason, and an accepted pack has none to assert on. */
function refusalReason(result: PackResult): string {
  if (result.ok) {
    return '';
  }
  return result.reason;
}

describe('parseSoundPack', () => {
  it('reads a family cue as one cue with several variants', () => {
    const pack = parse(realisticPack());

    expect([...pack.keys()].sort()).toEqual(['combat_block', 'ui_click']);
    expect(pack.get('combat_block')?.variants).toEqual([
      '/audio/sfx/combat_block_1.mp3?v=1555a71f0ba6',
      '/audio/sfx/combat_block_2.mp3?v=c09d3045e1e4',
      '/audio/sfx/combat_block_3.mp3?v=fc63d137a8d8',
    ]);
  });

  // The pack's whole advantage over a directory listing: an addon cue plays at
  // the loudness the game normalized that clip to.
  it('keeps the per-clip gain the game tuned', () => {
    expect(parse(realisticPack()).get('ui_click')?.gain).toBeCloseTo(1.7579);
  });

  it('keeps the cache-busting query on each URL', () => {
    expect(parse(realisticPack()).get('ui_click')?.variants[0]).toContain('?v=');
  });

  it.each([
    ['a non-object', 42],
    ['null', null],
    ['an array', []],
    ['a pack with no clips', { format: 'woc-sfx-runtime-pack', version: 1 }],
    [
      'a pack whose clips are all unplayable',
      {
        format: 'woc-sfx-runtime-pack',
        version: 1,
        clips: { broken: { variants: [] } },
      },
    ],
  ])('refuses %s', (_case, input) => {
    expect(parseSoundPack(input).ok).toBe(false);
  });

  // Refused rather than read optimistically: the caller then falls back to plain
  // per-cue URLs, which is lossy but correct, where a mis-parse produces 404s.
  it('refuses a format it does not recognize', () => {
    const result = parseSoundPack({ ...(realisticPack() as object), format: 'something-else' });

    expect(result.ok).toBe(false);
    expect(refusalReason(result)).toContain('woc-sfx-runtime-pack');
  });

  it('refuses a schema version newer than it understands', () => {
    const result = parseSoundPack({ ...(realisticPack() as object), version: 2 });

    expect(result.ok).toBe(false);
    expect(refusalReason(result)).toContain('newer');
  });

  // One row the loader cannot read must cost that cue, not all 220 of them.
  it('drops a malformed clip and keeps the rest', () => {
    const pack = parse({
      format: 'woc-sfx-runtime-pack',
      version: 1,
      clips: Object.fromEntries([
        ['ui_click', { variants: [{ url: '/audio/sfx/ui_click.mp3' }], gain: 1, playbackRate: 1 }],
        ['no_variants', { variants: [], gain: 1 }],
        ['variants_not_an_array', { variants: 'nope' }],
        ['variant_without_a_url', { variants: [{ id: 'main', bytes: 10 }] }],
      ]),
    });

    expect([...pack.keys()]).toEqual(['ui_click']);
  });

  // A zero or negative gain would be a silent cue, and a missing one is
  // ordinary, so both resolve to unity rather than to nothing.
  it.each([
    ['missing', undefined, 1],
    ['zero', 0, 1],
    ['negative', -2, 1],
    ['not a number', 'loud', 1],
    ['a real value', 1.5, 1.5],
  ])('reads a %s gain as %s', (_case, gain, expected) => {
    const pack = parse({
      format: 'woc-sfx-runtime-pack',
      version: 1,
      clips: { cue: { variants: [{ url: '/a.mp3' }], gain } },
    });

    expect(pack.get('cue')?.gain).toBe(expected);
  });
});

describe('the fallback URL', () => {
  it('is the cue name as a file, which is all it can be', () => {
    expect(fallbackCueUrl('ui_click')).toBe('/audio/sfx/ui_click.mp3');
  });

  it('points at the path the game actually serves the pack from', () => {
    expect(PACK_URL).toBe('/audio/sfx/runtime-pack.json');
  });
});
