// The per-addon disposal bag.
//
// Every API factory registers its teardown here, so disabling an addon releases
// everything it created without the addon writing cleanup code.

export type Teardown = () => void;

export class DisposalBag {
  private teardowns: Teardown[] = [];
  // biome-ignore lint/style/noInferrableTypes: the annotation widens this to `boolean`; inferred, it narrows to the literal `false` and every `if (this.disposed)` reads as dead code
  private disposed: boolean = false;

  get isDisposed(): boolean {
    return this.disposed;
  }

  get size(): number {
    return this.teardowns.length;
  }

  /**
   * Register a teardown, returning a function that unregisters it.
   *
   * Adding to an already-disposed bag runs the teardown immediately, so a stray
   * async callback landing after disable cannot leak its resource.
   */
  add(fn: Teardown): Teardown {
    if (this.disposed) {
      fn();
      return () => {
        // Nothing was registered, so there is nothing to unregister.
      };
    }
    this.teardowns.push(fn);
    return () => {
      const at = this.teardowns.indexOf(fn);
      if (at >= 0) {
        this.teardowns.splice(at, 1);
      }
    };
  }

  /**
   * Drain the bag in reverse registration order and return whatever threw.
   *
   * A throwing teardown does not stop the rest from running. Idempotent.
   */
  dispose(): Error[] {
    if (this.disposed) {
      return [];
    }
    this.disposed = true;

    const errors: Error[] = [];
    for (const fn of [...this.teardowns].reverse()) {
      try {
        fn();
      } catch (err) {
        if (err instanceof Error) {
          errors.push(err);
        } else {
          errors.push(new Error(String(err)));
        }
      }
    }
    this.teardowns = [];
    return errors;
  }
}
