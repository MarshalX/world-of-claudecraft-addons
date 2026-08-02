// Resolving one addon's `companions` list against what is actually installed.
//
// The whole reason the field exists is the state, so every case here is a state
// a description could not have carried: installed but switched off, installed
// from somewhere else, offered but not taken, and named by nobody.

import { describe, expect, it } from 'vitest';
import type { CompanionContext } from '../loader/src/runtime/ui/manager/companions.ts';
import { companionNotes } from '../loader/src/runtime/ui/manager/companions.ts';

function ctx(overrides: Partial<CompanionContext> = {}): CompanionContext {
  return {
    market: 'official',
    installed: new Map(),
    offered: new Set(),
    ...overrides,
  };
}

function stateOf(ids: readonly string[], context: CompanionContext): string[] {
  return companionNotes(ids, context).map((note) => note.state);
}

describe('companionNotes', () => {
  it('is empty for an addon that names none, which is the ordinary case', () => {
    expect(companionNotes(undefined, ctx())).toEqual([]);
  });

  it('keeps the order the manifest listed them in', () => {
    const context = ctx({ offered: new Set(['zulu', 'alpha']) });

    expect(companionNotes(['zulu', 'alpha'], context).map((note) => note.id)).toEqual([
      'zulu',
      'alpha',
    ]);
  });

  it('reads an installed and running companion as enabled', () => {
    const context = ctx({ installed: new Map([['official/lorebind', true]]) });

    expect(stateOf(['lorebind'], context)).toEqual(['enabled']);
  });

  // The one sentence this whole field exists for. Absent and switched off look
  // identical to an addon and are two different things for a player to do.
  it('reads an installed and disabled companion as disabled, not as absent', () => {
    const context = ctx({
      installed: new Map([['official/lorebind', false]]),
      offered: new Set(['lorebind']),
    });

    expect(stateOf(['lorebind'], context)).toEqual(['disabled']);
  });

  // A bare id rather than an fqid is the point: the same addon installed from a
  // fork is a different fqid and is still the companion the author meant.
  it('resolves a companion installed from a different marketplace', () => {
    const context = ctx({ installed: new Map([['gh:someone/forks/lorebind', true]]) });

    expect(stateOf(['lorebind'], context)).toEqual(['enabled']);
  });

  // Two installations, and the naming addon's own source is the one that speaks
  // for it: that is the copy an author testing against their own marketplace has.
  it('prefers the naming addon own source when two sources both offer it', () => {
    const context = ctx({
      market: 'official',
      installed: new Map([
        ['gh:someone/forks/lorebind', false],
        ['official/lorebind', true],
      ]),
    });

    expect(stateOf(['lorebind'], context)).toEqual(['enabled']);
  });

  it('reads a companion nobody has installed but a source offers as offered', () => {
    const context = ctx({ offered: new Set(['lorebind']) });

    expect(stateOf(['lorebind'], context)).toEqual(['offered']);
  });

  // An id no source in the player's list carries is not an error and must not
  // read as one: a companion may live on a marketplace they have never added.
  it('reads an id no source offers as unknown rather than failing', () => {
    expect(stateOf(['lorebind'], ctx())).toEqual(['unknown']);
  });
});
