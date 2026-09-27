// The game's keybind profile as a CLASS whose methods read `this`, as the real `Keybinds` does: a
// fake closing over local Maps hides a loader that calls a matcher detached from its instance.
// `heldActionForCode` ignores modifiers; `edgeActionForCombo` matches the whole chord.

type Bindings = ReadonlyArray<readonly [string, string]>;

class FakeKeybinds {
  // Entry pairs, because the keys are the game's KeyboardEvent codes, not ours to camelCase.
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
