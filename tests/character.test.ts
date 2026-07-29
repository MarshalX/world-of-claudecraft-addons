// Which character per-character UI state is keyed on.
//
// The obvious candidate, the pid from the `hello` frame, is wrong: it is the
// sim's entity id for one session and is reissued on the next, so a frame
// position keyed on it would scatter across a new set of storage keys every
// login and look to the player like nothing was ever saved.

import { describe, expect, it } from 'vitest';
import { characterId, OFFLINE_REALM } from '../loader/src/runtime/character.ts';
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
