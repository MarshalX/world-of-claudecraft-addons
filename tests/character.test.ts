// Which character per-character UI state is keyed on.
//
// The obvious candidate, the pid from the `hello` frame, is wrong: it is the
// sim's entity id for one session and is reissued on the next, so a frame
// position keyed on it would scatter across a new set of storage keys every
// login and look to the player like nothing was ever saved.

import { describe, expect, it } from 'vitest';
import { characterId, OFFLINE_REALM } from '../loader/src/runtime/character.ts';
import { readCharacterKey } from '../loader/src/runtime/world/character-key.ts';
import { characterScope } from '../loader/src/shared/hosts.ts';

describe('characterId', () => {
  it('is realm and name, which survive a reconnect', () => {
    expect(characterId('Claudemoon', 'Marshal')).toBe('Claudemoon/Marshal');
  });

  it('falls back to an offline literal when there is no realm', () => {
    expect(characterId(null, 'Marshal')).toBe(`${OFFLINE_REALM}/Marshal`);
  });

  // Null, never a placeholder. A placeholder would be one shared key that every
  // character wrote its window layout into.
  it.each([
    ['no player yet', undefined],
    ['a nameless entity', ''],
    ['a name that is not a string', 7],
    ['a null name', null],
  ])('answers null for %s', (_case, name) => {
    expect(characterId('Claudemoon', name)).toBeNull();
  });

  // Character ids are issued per deployment, so the same name on two channels is
  // two different characters and must not share a saved layout.
  it('produces a scope that separates the same name across channels', () => {
    const id = characterId('Claudemoon', 'Marshal') as string;

    expect(characterScope('pbe', id)).not.toBe(characterScope('live', id));
  });
});

// The read over the live world, as opposed to the string arithmetic above.
//
// The case that matters is a SPECTATE, because it is the one moment the game
// hands over a player entity that is not the person at the keyboard.
describe('readCharacterKey', () => {
  it('is the live player when nobody is being spectated', () => {
    expect(readCharacterKey('Claudemoon', { player: { name: 'Marshal' }, spectating: null })).toBe(
      'Claudemoon/Marshal',
    );
  });

  // A moderator spectate repoints the client's own playerId at the WATCHED
  // character (src/net/online.ts applySnapshot), so `world.player` stops being
  // the session owner while it runs. Keyed off that name, this addon's storage,
  // the loader's frame state and the `characterKey` watchers would all quietly
  // move to somebody else's file, and move back when the spectate ended.
  it('refuses to answer with the watched character while spectating', () => {
    expect(
      readCharacterKey('Claudemoon', { player: { name: 'Someone' }, spectating: 'Someone' }),
    ).toBeNull();
  });

  // Offline carries the field as an explicit null, so a world that has it and a
  // world too old to have it must read the same.
  it('is unaffected by a world that carries no spectating field', () => {
    expect(readCharacterKey('Claudemoon', { player: { name: 'Marshal' } })).toBe(
      'Claudemoon/Marshal',
    );
  });
});
