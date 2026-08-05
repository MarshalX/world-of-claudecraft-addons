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
    names: new Map(),
    offered: new Map(),
    ...overrides,
  };
}

/** What `offeredAddons` hands over, for the ids a case wants a source to carry. */
function offering(...ids: readonly string[]): Map<string, { name: string; fqid: string }> {
  return new Map(
    ids.map((id) => [
      id,
      { name: `${id[0]?.toUpperCase() ?? ''}${id.slice(1)}`, fqid: `official/${id}` },
    ]),
  );
}

function stateOf(ids: readonly string[], context: CompanionContext): string[] {
  return companionNotes(ids, context).map((note) => note.state);
}

describe('companionNotes', () => {
  it('is empty for an addon that names none, which is the ordinary case', () => {
    expect(companionNotes(undefined, ctx())).toEqual([]);
  });

  it('keeps the order the manifest listed them in', () => {
    const context = ctx({ offered: offering('zulu', 'alpha') });

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
      offered: offering('lorebind'),
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
    const context = ctx({ offered: offering('lorebind') });

    expect(stateOf(['lorebind'], context)).toEqual(['offered']);
  });

  // An id no source in the player's list carries is not an error and must not
  // read as one: a companion may live on a marketplace they have never added.
  it('reads an id no source offers as unknown rather than failing', () => {
    expect(stateOf(['lorebind'], ctx())).toEqual(['unknown']);
  });
});

// A manifest writes down a bare id and a player is looking for a name. Both are
// available here and neither was reaching the note, which is most of why the
// block read as a footnote about something nobody had heard of.
describe('what a note is called', () => {
  it('names an installed companion from the registry', () => {
    const context = ctx({
      installed: new Map([['official/lorebind', true]]),
      names: new Map([['official/lorebind', 'Lorebind']]),
    });

    expect(companionNotes(['lorebind'], context)[0]?.name).toBe('Lorebind');
  });

  it('names an offered companion from the source that offers it', () => {
    const [note] = companionNotes(['lorebind'], ctx({ offered: offering('lorebind') }));

    expect(note?.name).toBe('Lorebind');
  });

  // The registry over the catalog, because the registry keeps its own copy of the
  // manifest: an addon whose source has since been dropped from the list still has
  // a name, and that name is the one the player installed.
  it('prefers the installed name over the offered one', () => {
    const context = ctx({
      installed: new Map([['official/lorebind', true]]),
      names: new Map([['official/lorebind', 'Lorebind']]),
      offered: new Map([['lorebind', { name: 'Something Else', fqid: 'official/lorebind' }]]),
    });

    expect(companionNotes(['lorebind'], context)[0]?.name).toBe('Lorebind');
  });

  // Not a shrug. Nobody offers it and nobody has it, so the id is genuinely all
  // that is known, and inventing a prettier one would be inventing a fact.
  it('falls back to the bare id for a companion nothing knows', () => {
    expect(companionNotes(['lorebind'], ctx())[0]?.name).toBe('lorebind');
  });
});

// The half that used to have nowhere to live and went into descriptions instead.
describe('why a note is there', () => {
  it('carries the reason its manifest gave for that id', () => {
    const notes = companionNotes(['lorebind'], ctx(), { lorebind: 'publishes item prices' });

    expect(notes[0]?.reason).toBe('publishes item prices');
  });

  it('carries an empty reason for a companion named without one', () => {
    const notes = companionNotes(['lorebind', 'satchel'], ctx(), { lorebind: 'publishes prices' });

    expect(notes.map((note) => note.reason)).toEqual(['publishes prices', '']);
  });
});

// The fqid is a TARGET, not a gate: the panes point an existing control at it,
// and a note with nothing to point at has to say so rather than guess.
describe('what an action would act on', () => {
  it('targets the installation for a companion that is here', () => {
    const context = ctx({
      installed: new Map([['gh:someone/forks/lorebind', false]]),
      offered: offering('lorebind'),
    });

    expect(companionNotes(['lorebind'], context)[0]?.fqid).toBe('gh:someone/forks/lorebind');
  });

  it('targets the offer for one that is not', () => {
    const [note] = companionNotes(['lorebind'], ctx({ offered: offering('lorebind') }));

    expect(note?.fqid).toBe('official/lorebind');
  });

  it('targets nothing at all for one nobody offers', () => {
    expect(companionNotes(['lorebind'], ctx())[0]?.fqid).toBeNull();
  });
});
