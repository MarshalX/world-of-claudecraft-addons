// The loader's one keydown listener, capture phase on window so it runs before the game's handler.
// It calls `stopImmediatePropagation` ONLY when a bind matched; an unclaimed key reaches the game.
//
// The editable guard is deliberately WIDER than the game's (input and textarea): declining costs
// one keystroke, acting eats a character the player is typing.

import { isBindable, isModifierCode, makeCombo, normalizeCombo } from '../../shared/combo.ts';
import { diagError } from '../../shared/diag.ts';
import type { Teardown } from '../disposal.ts';

const EDITABLE_TAGS = new Set(['input', 'textarea', 'select']);

const CONTENTEDITABLE_VALUES = ['', 'true'];

const EDITABLE_SELECTOR = [
  ...EDITABLE_TAGS,
  ...CONTENTEDITABLE_VALUES.map((value) => `[contenteditable="${value}"]`),
].join(', ');

/** The object form: Node's EventTarget ignores a boolean on remove, so dispose would do nothing. */
const CAPTURE = { capture: true } as const;

interface Registration {
  combo: string;
  handler: () => void;
}

interface KeyCapture {
  /** The next non-modifier combo, or null when cancelled or superseded, so a prompt can close. */
  done: Promise<string | null>;
  cancel: () => void;
}

interface KeyDispatcher {
  /** `key` is '<fqid>:<bindId>'. Throws on a combo the loader will not take. */
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
  // A contenteditable region focuses its container, so walk up for a caret in a nested node.
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
      // Superseded, not queued: a second prompt means the first was abandoned.
      pending?.(null);

      let resolve: (combo: string | null) => void = () => undefined;
      const done = new Promise<string | null>((settle) => {
        resolve = settle;
      });
      pending = resolve;

      return {
        done,
        cancel: () => {
          // Guarded, so cancelling a superseded capture spares its replacement.
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

  // Before the editable guard: the manager's combo field is focused while it waits.
  if (deps.capture.claim(combo)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  if (isEditing(deps.doc)) {
    return;
  }
  // Addon binds are edge actions, so auto-repeat is ignored.
  if (event.repeat) {
    return;
  }

  const matched = [...deps.registrations.values()].filter((entry) => entry.combo === combo);
  if (matched.length === 0) {
    return;
  }

  // Neither the game nor the browser acts: Ctrl+KeyS bound here means the addon, not a save.
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
