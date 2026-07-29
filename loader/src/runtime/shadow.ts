// The globals an addon's closure is built with shadowed.
//
// This is a guardrail, not a sandbox, and the difference is worth stating where
// the code is rather than only in the design doc. Addon source is evaluated in
// the page realm, so `Function('return this')()` reaches the real global object
// in one line and every name below with it. What shadowing buys is that reaching
// for `localStorage` out of habit fails loudly and says which API to use
// instead, rather than quietly working and coupling an addon to the game's own
// storage keys. It stops accident and laziness. It stops nothing deliberate, and
// the manager's docs say so.
//
// `document.cookie` is on the design's list and is deliberately NOT here.
// Shadowing it would mean handing addons a proxied `document`, which breaks
// every identity comparison in the DOM: `el.ownerDocument === document` becomes
// false, and so does anything else that compares node references. A guardrail
// that subtly breaks correct DOM code is worse than the gap it closes.

/**
 * Each shadowed global, paired with what to reach for instead.
 *
 * Entry pairs rather than an object literal because every key here is a name the
 * PAGE owns, not one this project chose: `XMLHttpRequest` and `__game` are
 * spelled the way the platform and the game spell them, and a naming convention
 * for this project's own identifiers has nothing to say about them.
 *
 * The order is the parameter order of the generated function, so it has to be
 * stable and it has to match the values array exactly.
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
 * A value that throws however it is used.
 *
 * The proxy target is a function so the `apply` and `construct` traps are legal,
 * which is what covers `new WebSocket(...)` and `new XMLHttpRequest()` as well
 * as `localStorage.getItem(...)`.
 *
 * `toString` and `Symbol.toPrimitive` are answered rather than thrown, so
 * logging one of these while debugging prints what happened instead of throwing
 * a second error on top of the first.
 */
function shadowFor(name: string): unknown {
  const fail = (): never => {
    throw shadowError(name);
  };
  const label = (): string => `[shadowed ${name}]`;

  // The proxy target is a function so the apply and construct traps are legal,
  // and it returns its own name so a trap that is never reached still describes
  // what it stands for.
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

/**
 * Built once per addon rather than shared.
 *
 * A shared proxy would be one object every addon could reach through the error
 * it throws, and building six proxies costs nothing next to evaluating a file.
 */
function createShadows(): Shadows {
  return { names: SHADOWED, values: SHADOWED.map(shadowFor) };
}

export type { Shadows };
export { createShadows, SHADOWED, shadowError };
