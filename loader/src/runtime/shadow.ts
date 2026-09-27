// The globals an addon's closure is built with shadowed. A guardrail, not a sandbox:
// `Function('return this')()` reaches the real globals. It makes a habitual `localStorage` fail
// loudly and name the API to use.
//
// `document.cookie` is deliberately NOT shadowed: that needs a proxied `document`, which breaks
// every DOM identity comparison (`el.ownerDocument === document`).

/**
 * Each shadowed global and its alternative. Pairs, not an object literal, because the page owns
 * these names. The order is the generated function's parameter order and must stay stable.
 */
const SHADOW_PAIRS = Object.freeze([
  ['localStorage', 'woc.storage'],
  ['sessionStorage', 'woc.storage'],
  ['indexedDB', 'woc.storage'],
  ['XMLHttpRequest', 'fetch'],
  ['WebSocket', 'woc.net'],
  ['__game', 'woc.world'],
] as const);

const ALTERNATIVES: Record<string, string> = Object.fromEntries(SHADOW_PAIRS);

const SHADOWED = Object.freeze(SHADOW_PAIRS.map(([name]) => name));

function shadowError(name: string): Error {
  const alternative = ALTERNATIVES[name] ?? 'the woc API';
  return new Error(
    `${name} is shadowed inside an addon: use ${alternative} instead. ` +
      'The loader does this so addon storage stays namespaced and addon traffic stays ' +
      'observable, not as a security boundary.',
  );
}

/**
 * A value that throws however it is used. `toString` and `Symbol.toPrimitive` answer instead, so
 * logging one does not throw a second error.
 */
function shadowFor(name: string): unknown {
  const fail = (): never => {
    throw shadowError(name);
  };
  const label = (): string => `[shadowed ${name}]`;

  // A function target, so the apply and construct traps (`new WebSocket(...)`) are legal.
  const target = function shadowed(): string {
    return label();
  };

  return new Proxy(target as unknown as Record<string, unknown>, {
    get: (_target, prop) => {
      if (prop === 'toString' || prop === Symbol.toPrimitive || prop === Symbol.toStringTag) {
        return label;
      }
      return fail();
    },
    set: fail,
    has: fail,
    deleteProperty: fail,
    apply: fail,
    construct: fail,
  });
}

interface Shadows {
  /** Parameter names, in the order the values are passed. */
  names: readonly string[];
  values: readonly unknown[];
}

/** Built per addon, so no proxy object is shared between addons. */
function createShadows(): Shadows {
  return { names: SHADOWED, values: SHADOWED.map(shadowFor) };
}

export type { Shadows };
export { createShadows, SHADOWED, shadowError };
