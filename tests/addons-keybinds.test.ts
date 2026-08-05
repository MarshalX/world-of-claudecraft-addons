// No two things the loader can register at once claim the same combo.
//
// A repository-policy check like tests/addons-suites.test.ts, and it exists
// because the dispatcher does not pick a winner: handleKeyDown fires EVERY
// registration whose combo matches, so two addons defaulting to the same key is
// not one of them losing, it is both of them acting on one press. Ledgerline and
// Longwatch both shipped on Alt+KeyL in v1.2.0 and pressing it toggled both
// panels at once, which is the failure this guards.
//
// It covers the loader's own binds too, since those are registered whether or
// not any addon is installed, and it compares CANONICAL combos rather than the
// strings on the manifests: 'Shift+Alt+KeyE' and 'Alt+Shift+KeyE' are one key to
// a player and would otherwise read as two distinct binds here.
//
// It reads the filesystem through tools/manifests.ts rather than directly,
// because `noNodejsModules` is not exempt under `tests/**`.

import { describe, expect, it } from 'vitest';
import { LOADER_BIND_DECLS, LOADER_OWNER } from '../loader/src/runtime/keys/loader-binds.ts';
import { normalizeCombo } from '../loader/src/shared/combo.ts';
import { addonDirs, readAddon } from '../tools/manifests.ts';

interface Claim {
  /** '<addon id>:<bind id>', which is what the dispatcher keys a registration by. */
  key: string;
  combo: string;
}

/**
 * Every bind the loader could have registered at once, canonicalised.
 *
 * A manifest that does not validate is not this suite's failure to report, so it
 * contributes nothing and `pnpm validate` says what is wrong with it. A combo
 * that does not normalise is left as written, so it shows up in the failure
 * message as itself rather than disappearing out of the comparison.
 */
function claims(): Claim[] {
  const out: Claim[] = LOADER_BIND_DECLS.map((decl) => ({
    key: `${LOADER_OWNER}:${decl.id}`,
    combo: normalizeCombo(decl.default) ?? decl.default,
  }));
  for (const dir of addonDirs()) {
    const result = readAddon(dir);
    if (result.ok) {
      for (const bind of result.manifest.keybinds ?? []) {
        out.push({
          key: `${result.manifest.id}:${bind.id}`,
          combo: normalizeCombo(bind.default) ?? bind.default,
        });
      }
    }
  }
  return out;
}

/** Combo to the keys claiming it, for the combos claimed more than once. */
function collisions(): Record<string, string[]> {
  const byCombo = new Map<string, string[]>();
  for (const claim of claims()) {
    byCombo.set(claim.combo, [...(byCombo.get(claim.combo) ?? []), claim.key]);
  }
  const out: Record<string, string[]> = {};
  for (const [combo, keys] of byCombo) {
    if (keys.length > 1) {
      out[combo] = keys;
    }
  }
  return out;
}

describe('the marketplace keybinds', () => {
  // Across addons AND within one, since a single addon binding two of its own
  // commands to one key fires both of them the same way.
  it('are claimed by exactly one command each', () => {
    expect(collisions()).toEqual({});
  });

  // The guard on the guard: an empty claim list would make the check above pass
  // while proving nothing, which is how a broken reader hides.
  it('are actually being looked at', () => {
    expect(claims().length).toBeGreaterThan(LOADER_BIND_DECLS.length);
  });
});
