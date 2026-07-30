// What an addon's declared permissions mean, in a sentence each.
//
// Shown before an install is confirmed. The wording is deliberately about what
// the addon can SEE and DO rather than about the API it calls, because the
// player reading it has no reason to know what `net.read` names.
//
// These are a disclosure, not an enforcement. Addon source runs in the page
// realm with the page's globals in scope, so a manifest that declares nothing
// is not thereby prevented from doing anything: what the list says is what the
// author says their addon is for. The pane states that alongside it rather than
// letting the list imply a boundary the loader does not have.
// site/content/docs/manifest.md says the same thing to the author writing the
// list, so neither side of it can read as a sandbox.

// From shared/permissions.ts, never from shared/schema.ts: this is a value
// import, and one out of a zod module would pull the library into the page.
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
 * One line per declared permission, in the order the manifest lists them.
 *
 * A value this loader does not know is kept and shown verbatim rather than
 * dropped. It means the addon was written against a newer loader, and hiding
 * the one entry that could not be explained would understate what is being
 * installed at exactly the moment the player is deciding.
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
