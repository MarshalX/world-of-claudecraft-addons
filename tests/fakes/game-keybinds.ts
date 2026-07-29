// The game's keybind profile, as a CLASS whose methods read `this`.
//
// The shape is load-bearing, not incidental. The real profile is a `Keybinds`
// instance and both matchers are methods over `this.map`, so a caller that pulls
// one off the instance and invokes it on anything else throws on an undefined
// `this`.
//
// An earlier version of this fake used arrow functions closing over local Maps,
// which have no `this` to lose. The suite passed while the loader threw on the
// first real conflict lookup, and because the manager reads conflicts during
// render, the throw unmounted the settings pane and left a blank window. A live
// session is what found it. Every fake standing in for a game object should be
// the same KIND of thing the game hands over, not merely the same shape.
//
// `heldActionForCode` ignores modifiers, because held actions are polled per
// frame against the physical code; `edgeActionForCombo` matches the whole chord.

type Bindings = ReadonlyArray<readonly [string, string]>;

class FakeKeybinds {
  // Entry pairs rather than object literals: the keys are the game's own
  // KeyboardEvent codes, which are not ours to rename into camelCase.
  private readonly held: Map<string, string>;
  private readonly edge: Map<string, string>;

  constructor(held: Bindings, edge: Bindings) {
    this.held = new Map(held);
    this.edge = new Map(edge);
  }

  heldActionForCode(code: string): string | null {
    return this.held.get(code) ?? null;
  }

  edgeActionForCombo(combo: string): string | null {
    return this.edge.get(combo) ?? null;
  }
}

/** A stand-in for `__game`, carrying the profile where the loader looks for it. */
function liveGame(options: { held?: Bindings; edge?: Bindings } = {}): unknown {
  return { input: { keybinds: new FakeKeybinds(options.held ?? [], options.edge ?? []) } };
}

export type { Bindings };
export { FakeKeybinds, liveGame };
