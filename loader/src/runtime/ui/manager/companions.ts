// What one addon's `companions` list means right now: whether each named addon is here and
// switched on, and what the manifest's `companionReasons` says it adds.
//
// A companion is a bare addon id, never an fqid: the same addon from a fork is still the one the
// author meant, so resolution prefers the naming addon's own marketplace, then any source.
//
// It gates NOTHING. No install control, toggle or supervisor reads this; a note's fqid is only a
// target the panes point an existing control at.

import { fqid as makeFqid, splitFqid } from '../../../shared/marketplace.ts';
import type { OfferedAddon } from './catalog.ts';

/** What a player would have to do about one companion. `enabled` is drawn as a state too. */
type CompanionState = 'enabled' | 'disabled' | 'offered' | 'unknown';

interface CompanionNote {
  /** The bare id the manifest named. */
  id: string;
  /** The display name, or the bare id for an addon nobody offers or has installed. */
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
 * The installed addon's name from the registry, which keeps its own copy of the manifest and so
 * still answers after the source has left the list.
 */
function nameFor(ctx: CompanionContext, installed: string | null): string | null {
  if (installed === null) {
    return null;
  }
  return ctx.names.get(installed) ?? null;
}

/**
 * One companion, resolved. The installed record answers first for both name and target, because an
 * addon a player HAS is the one they mean; what is on offer answers second.
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
