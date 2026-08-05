// What one addon's `companions` list means right now.
//
// Pure, and separate from catalog.ts because it is a different question: catalog
// merges sources into a browse list, and this answers "is the thing this addon
// says it works with actually here". The answer is STATE, which is half the
// reason the field exists at all: "works better with Lorebind" could be written
// into a description, and "Lorebind is installed but switched off" can only come
// from here.
//
// The other half is WHY, off the same manifest's `companionReasons`. It used to
// have nowhere to live and went into descriptions instead, which is the wrong
// place twice over: a description is read before a player knows the companion
// exists, and it cannot say a word about state.
//
// A companion is a bare addon id, never an fqid. The same addon installed from a
// fork is a different fqid and is still the companion the author meant, so
// resolution prefers the marketplace the naming addon came from and then accepts
// any source in the list.
//
// It gates NOTHING. Nothing here is read by an install control, an enable
// toggle, or the supervisor, and that is the design rather than an omission: a
// hard dependency was weighed and refused, and the bus refuses waiting on
// purpose. A note now carries an fqid, and that is a TARGET rather than a gate:
// the panes point an existing control at it, and nothing in this file decides
// whether that control may be pressed.

import { fqid as makeFqid, splitFqid } from '../../../shared/marketplace.ts';
import type { OfferedAddon } from './catalog.ts';

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
  /**
   * The display name, or the bare id when nothing here knows one.
   *
   * The fallback is not a shrug. An id nobody offers and nobody has installed is
   * an addon this loader has never seen, so the id is genuinely all that is
   * known about it; every other state has a real name to draw.
   */
  name: string;
  state: CompanionState;
  /** What the naming addon says this one adds, or empty when it did not say. */
  reason: string;
  /** What an action would act ON, and null when there is nothing to act on. */
  fqid: string | null;
}

interface CompanionContext {
  /** The marketplace the addon NAMING the companion came from. */
  market: string;
  /** Every installed fqid to whether it is enabled. */
  installed: ReadonlyMap<string, boolean>;
  /** Every installed fqid to its display name. */
  names: ReadonlyMap<string, string>;
  /** Every addon id any source in the list offers. See `offeredAddons`. */
  offered: ReadonlyMap<string, OfferedAddon>;
}

/** The installed fqid for one bare id: the same source first, then any other. */
function installedFqid(ctx: CompanionContext, id: string): string | null {
  const own = makeFqid(ctx.market, id);
  if (ctx.installed.has(own)) {
    return own;
  }
  for (const fqid of ctx.installed.keys()) {
    if (splitFqid(fqid)?.addonId === id) {
      return fqid;
    }
  }
  return null;
}

/** Whether the installation is switched on, or nothing when there is not one. */
function enabledFlag(ctx: CompanionContext, fqid: string | null): boolean | undefined {
  if (fqid === null) {
    return;
  }
  return ctx.installed.get(fqid);
}

function stateFor(ctx: CompanionContext, id: string, fqid: string | null): CompanionState {
  const enabled = enabledFlag(ctx, fqid);
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

/**
 * The registry's name, the offered name, then the bare id.
 *
 * The registry answers first because it keeps its own copy of the manifest: an
 * addon whose source has since left the list still has the name the player
 * installed, and no source is left to say otherwise.
 */
function nameFor(ctx: CompanionContext, installed: string | null): string | null {
  if (installed === null) {
    return null;
  }
  return ctx.names.get(installed) ?? null;
}

/**
 * One companion, resolved.
 *
 * The installed record answers first for both the name and the target, because
 * an addon a player HAS is the one they mean whichever source offers a copy.
 * What is on offer answers second, and neither answering is `unknown`.
 */
function noteFor(ctx: CompanionContext, id: string, reason: string): CompanionNote {
  const installed = installedFqid(ctx, id);
  const offered = ctx.offered.get(id) ?? null;
  return {
    id,
    name: nameFor(ctx, installed) ?? offered?.name ?? id,
    state: stateFor(ctx, id, installed),
    reason,
    fqid: installed ?? offered?.fqid ?? null,
  };
}

/** Every companion one addon names, in the order the manifest listed them. */
function companionNotes(
  ids: readonly string[] | undefined,
  ctx: CompanionContext,
  reasons: Readonly<Record<string, string>> = {},
): CompanionNote[] {
  return (ids ?? []).map((id) => noteFor(ctx, id, reasons[id] ?? ''));
}

export type { CompanionContext, CompanionNote, CompanionState };
export { companionNotes };
