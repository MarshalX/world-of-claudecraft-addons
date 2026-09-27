// Which character per-character UI state is keyed on. Never the `hello` pid, which is reissued
// every session and would scatter saved state across new keys on each login.

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

  // A placeholder would be one shared key every character wrote into.
  it.each([
    ['no player yet', undefined],
    ['a nameless entity', ''],
    ['a name that is not a string', 7],
    ['a null name', null],
  ])('answers null for %s', (_case, name) => {
    expect(characterId('Claudemoon', name)).toBeNull();
  });

  // Character ids are issued per deployment, so one name on two channels is two characters.
  it('produces a scope that separates the same name across channels', () => {
    const id = characterId('Claudemoon', 'Marshal') as string;

    expect(characterScope('pbe', id)).not.toBe(characterScope('live', id));
  });
});

// The read over the live world. A spectate is the one time the player entity is not the person at
// the keyboard.
describe('readCharacterKey', () => {
  it('is the live player when nobody is being spectated', () => {
    expect(readCharacterKey('Claudemoon', { player: { name: 'Marshal' }, spectating: null })).toBe(
      'Claudemoon/Marshal',
    );
  });

  // A spectate repoints the client's playerId at the WATCHED character (src/net/online.ts
  // applySnapshot), which would move every per-character store to somebody else's key.
  it('refuses to answer with the watched character while spectating', () => {
    expect(
      readCharacterKey('Claudemoon', { player: { name: 'Someone' }, spectating: 'Someone' }),
    ).toBeNull();
  });

  // Offline carries an explicit null, so a missing field must read the same.
  it('is unaffected by a world that carries no spectating field', () => {
    expect(readCharacterKey('Claudemoon', { player: { name: 'Marshal' } })).toBe(
      'Claudemoon/Marshal',
    );
  });
});
