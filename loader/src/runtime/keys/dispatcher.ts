// The loader's one keydown listener, and what it dispatches to.
//
// Capture phase on window, so the loader sees a key before the game's own
// bubble-phase handler. That ordering is the whole mechanism, and it comes with
// the obligation attached to it: `stopImmediatePropagation` is called ONLY when
// a bind actually matched. An unclaimed key has to reach the game untouched, or
// installing an addon would degrade the controls of a game the player is still
// playing.
//
// The editable-element guard is deliberately WIDER than the game's own, which
// checks only input and textarea. Declining where the game would act costs the
// addon one keystroke; acting where the game declines eats a character out of
// something the player is typing. Only one of those is recoverable.

import { isBindable, isModifierCode, makeCombo, normalizeCombo } from '../../shared/combo.ts';
import { diagError } from '../../shared/diag.ts';
import type { Teardown } from '../disposal.ts';

const EDITABLE_TAGS = new Set(['input', 'textarea', 'select']);

/** The two attribute values that actually make a region editable. */
const CONTENTEDITABLE_VALUES = ['', 'true'];

/** Derived from the tag set rather than written out, so the two cannot drift. */
const EDITABLE_SELECTOR = [
  ...EDITABLE_TAGS,
  ...CONTENTEDITABLE_VALUES.map((value) => `[contenteditable="${value}"]`),
].join(', ');

/**
 * The capture flag, in its OBJECT form rather than the boolean shorthand.
 *
 * Node's EventTarget accepts a boolean on addEventListener and then ignores it
 * on removeEventListener, so the shorthand leaves the listener attached and
 * dispose() silently does nothing. Browsers honour both, which is exactly what
 * makes the shorthand the version that looks fine until it is not.
 */
const CAPTURE = { capture: true } as const;

interface Registration {
  combo: string;
  handler: () => void;
}

interface KeyCapture {
  /**
   * The canonical combo of the next non-modifier key press, or null if the
   * capture was cancelled or superseded.
   *
   * Null rather than a rejection or a never-settling promise: the caller is a
   * "press a key" prompt that the player can close, and both of those leave its
   * await hanging in the one case it most needs to clean up after itself.
   */
  done: Promise<string | null>;
  cancel: () => void;
}

interface KeyDispatcher {
  /**
   * Bind a handler. `key` is '<fqid>:<bindId>' and identifies the registration
   * for rebinding and unbinding. Rejects a combo the loader will not take.
   */
  register: (key: string, combo: string, handler: () => void) => Teardown;
  /** Move an existing registration to another combo. */
  rebind: (key: string, combo: string) => void;
  /** Every live registration, for conflict detection. */
  bindings: () => Readonly<Record<string, string>>;
  /** Swallow the next key press and report it, for the "press a key" UI. */
  capture: () => KeyCapture;
  dispose: () => void;
}

interface DispatcherDeps {
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  doc: Pick<Document, 'activeElement'>;
}

/** The combo for a key press, or null for a bare modifier, which binds nothing. */
function comboFor(event: KeyboardEvent): string | null {
  if (isModifierCode(event.code)) {
    return null;
  }
  return makeCombo({
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    code: event.code,
  });
}

function isEditing(doc: Pick<Document, 'activeElement'>): boolean {
  const el = doc.activeElement;
  if (el === null) {
    return false;
  }
  if (EDITABLE_TAGS.has(el.tagName.toLowerCase())) {
    return true;
  }
  if ((el as Partial<HTMLElement>).isContentEditable === true) {
    return true;
  }
  // A field inside a custom element or a wrapper still has focus on itself, but
  // a contenteditable region focuses its container, so the ancestor walk is what
  // covers a caret sitting in a nested node.
  return el.closest?.(EDITABLE_SELECTOR) !== null;
}

/** The one "press a key" slot. At most one prompt can be waiting. */
interface CaptureSlot {
  /** Hand a press to a waiting prompt. False when none is waiting. */
  claim: (combo: string) => boolean;
  begin: () => KeyCapture;
  /** Release a waiting prompt with no answer, on dispose. */
  clear: () => void;
}

function createCaptureSlot(): CaptureSlot {
  /** Non-null while the "press a key" UI is waiting. It claims every press. */
  let pending: ((combo: string | null) => void) | null = null;

  return {
    claim: (combo) => {
      if (pending === null) {
        return false;
      }
      const resolve = pending;
      pending = null;
      resolve(combo);
      return true;
    },

    begin: () => {
      // A capture already waiting is superseded rather than queued: two "press a
      // key" prompts cannot both be on screen, so a second one means the first
      // was abandoned and its awaiter needs releasing.
      pending?.(null);

      let resolve: (combo: string | null) => void = () => undefined;
      const done = new Promise<string | null>((settle) => {
        resolve = settle;
      });
      pending = resolve;

      return {
        done,
        cancel: () => {
          // Guarded, so cancelling an already-superseded capture does not
          // cancel the one that replaced it.
          if (pending === resolve) {
            pending = null;
            resolve(null);
          }
        },
      };
    },

    clear: () => {
      pending?.(null);
      pending = null;
    },
  };
}

function fire(registration: Registration): void {
  try {
    registration.handler();
  } catch (err) {
    diagError('an addon keybind handler threw', err);
  }
}

function canonical(key: string, combo: string): string {
  const normalized = normalizeCombo(combo);
  if (normalized === null || !isBindable(combo)) {
    throw new Error(`${key}: '${combo}' is not a bindable combo`);
  }
  return normalized;
}

interface KeyDownDeps {
  doc: Pick<Document, 'activeElement'>;
  capture: CaptureSlot;
  registrations: ReadonlyMap<string, Registration>;
}

function handleKeyDown(deps: KeyDownDeps, event: KeyboardEvent): void {
  const combo = comboFor(event);
  if (combo === null) {
    return;
  }

  // Capture claims the press before every other rule, including the editable
  // guard: the manager's own combo field is focused while it waits, so
  // declining there would make the feature unable to read anything.
  if (deps.capture.claim(combo)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  if (isEditing(deps.doc)) {
    return;
  }
  // Auto-repeat would fire a command once per repeat interval while the key is
  // simply held down. Addon binds are all edge actions.
  if (event.repeat) {
    return;
  }

  const matched = [...deps.registrations.values()].filter((entry) => entry.combo === combo);
  if (matched.length === 0) {
    return;
  }

  // Claimed, so the game does not also act on it, and the browser does not
  // either: a player who bound Ctrl+KeyS meant the addon, not a page save.
  event.preventDefault();
  event.stopImmediatePropagation();
  for (const registration of matched) {
    fire(registration);
  }
}

function createKeyDispatcher(deps: DispatcherDeps): KeyDispatcher {
  const registrations = new Map<string, Registration>();
  const capture = createCaptureSlot();

  const onKeyDown = (event: KeyboardEvent): void => {
    handleKeyDown({ doc: deps.doc, capture, registrations }, event);
  };

  deps.target.addEventListener('keydown', onKeyDown as EventListener, CAPTURE);

  return {
    register: (key, combo, handler) => {
      const normalized = canonical(key, combo);
      if (registrations.has(key)) {
        throw new Error(`${key} is already bound`);
      }
      registrations.set(key, { combo: normalized, handler });
      return () => {
        registrations.delete(key);
      };
    },

    rebind: (key, combo) => {
      const existing = registrations.get(key);
      if (existing === undefined) {
        throw new Error(`${key} is not bound`);
      }
      existing.combo = canonical(key, combo);
    },

    bindings: () => {
      const out: Record<string, string> = {};
      for (const [key, registration] of registrations) {
        out[key] = registration.combo;
      }
      return out;
    },

    capture: capture.begin,

    dispose: () => {
      deps.target.removeEventListener('keydown', onKeyDown as EventListener, CAPTURE);
      registrations.clear();
      capture.clear();
    },
  };
}

export type { DispatcherDeps, KeyCapture, KeyDispatcher };
export { createKeyDispatcher, isEditing };
