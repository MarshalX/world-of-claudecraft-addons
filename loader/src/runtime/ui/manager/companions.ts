// What one addon's `companions` list means right now.
//
// Pure, and separate from catalog.ts because it is a different question: catalog
// merges sources into a browse list, and this answers "is the thing this addon
// says it works with actually here". The answer is STATE, which is the only
// reason the field exists at all: "works better with Lorebind" belongs in a
// description, and "Lorebind is installed but switched off" can only come from
// here.
//
// A companion is a bare addon id, never an fqid. The same addon installed from a
// fork is a different fqid and is still the companion the author meant, so
// resolution prefers the marketplace the naming addon came from and then accepts
// any source in the list.
//
// It gates NOTHING. Nothing here is read by an install control, an enable
// toggle, or the supervisor, and that is the design rather than an omission: a
// hard dependency was weighed and refused, and the bus refuses waiting on
// purpose.

import { fqid as makeFqid, splitFqid } from '../../../shared/marketplace.ts';

/**
 * What a player would have to do about one named companion.
 *
 * `enabled` is deliberately a state and not the absence of one: a row that says
 * nothing when everything is fine is a row nobody learns to read.
 */
type CompanionState = 'enabled' | 'disabled' | 'offered' | 'unknown';

interface CompanionNote {
  /** The bare id the manifest named. */
  id: string;
  state: CompanionState;
}

interface CompanionContext {
  /** The marketplace the addon NAMING the companion came from. */
  market: string;
  /** Every installed fqid to whether it is enabled. */
  installed: ReadonlyMap<string, boolean>;
  /** Every addon id any source in the list offers. */
  offered: ReadonlySet<string>;
}

/** The installed record for one id: the same source first, then any other. */
function installedState(ctx: CompanionContext, id: string): boolean | null {
  const own = ctx.installed.get(makeFqid(ctx.market, id));
  if (own !== undefined) {
    return own;
  }
  for (const [installedFqid, enabled] of ctx.installed) {
    if (splitFqid(installedFqid)?.addonId === id) {
      return enabled;
    }
  }
  return null;
}

function companionState(ctx: CompanionContext, id: string): CompanionState {
  const enabled = installedState(ctx, id);
  if (enabled === true) {
    return 'enabled';
  }
  if (enabled === false) {
    return 'disabled';
  }
  if (ctx.offered.has(id)) {
    return 'offered';
  }
  return 'unknown';
}

/** Every companion one addon names, in the order the manifest listed them. */
function companionNotes(
  ids: readonly string[] | undefined,
  ctx: CompanionContext,
): CompanionNote[] {
  return (ids ?? []).map((id) => ({ id, state: companionState(ctx, id) }));
}

export type { CompanionContext, CompanionNote, CompanionState };
export { companionNotes };
