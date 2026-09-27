// What an addon's declared permissions mean, a sentence each, shown before an install. Word them
// as what the addon can see and do, never as API names. They are a disclosure, not enforcement.

// From shared/permissions.ts, never shared/schema.ts: a value import from a zod module pulls zod
// into the page bundle.
import { PERMISSIONS, type Permission } from '../../../shared/permissions.ts';

const DESCRIPTIONS: Record<Permission, string> = {
  'net.read': 'Read the game traffic this client sends and receives, with your login token blanked',
  'world.read': 'Read the world: your character, your party, your target, and nearby units',
  ui: 'Draw its own windows, buttons, and messages inside the game',
  sound: "Play the game's own sound cues",
  keys: 'Bind keys, and see a key press before the game does',
  storage: 'Keep its own settings and data, under this character',
};

function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * One line per declared permission, in manifest order. An unknown value (from a newer loader) is
 * shown verbatim, never dropped, so the confirmation never understates what is being installed.
 */
function describePermissions(declared: readonly string[] | undefined): string[] {
  return (declared ?? []).map((value) => {
    if (isPermission(value)) {
      return DESCRIPTIONS[value];
    }
    return value;
  });
}

export { describePermissions };
