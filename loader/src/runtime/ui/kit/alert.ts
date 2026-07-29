// A modal question, resolving to the id of the button the player pressed.
//
// The promise ALWAYS resolves, including when the modal is dismissed with
// Escape or torn down because the addon was disabled. An addon awaiting an
// answer is usually mid-way through something it has to finish or abandon
// cleanly, and a rejection there means its catch runs at teardown time, which
// is exactly when it can no longer safely create anything. The dismissal value
// is the cancel button's id, or null when there is none.
//
// Escape is captured, so the game does not also close whatever it has open
// behind the modal. One key press closes one thing.

import type { Teardown } from '../../disposal.ts';

interface AlertButton {
  id: string;
  label: string;
  /** Drawn as the affirmative action, and focused when the modal opens. */
  primary?: boolean;
  /** What Escape and a backdrop click resolve to. At most one. */
  cancel?: boolean;
}

interface AlertOpts {
  title?: string;
  message: string;
  /** Defaults to a single dismissing "OK". */
  buttons?: readonly AlertButton[];
}

interface AlertDeps {
  doc: Document;
  /** The #woc-addons root. */
  root: HTMLElement;
}

interface OpenAlert {
  /** Resolves with a button id, or null if dismissed with no cancel button. */
  answer: Promise<string | null>;
  /** Close without an answer. Registered in the addon's disposal bag. */
  close: Teardown;
}

const DEFAULT_BUTTONS: readonly AlertButton[] = [
  { id: 'ok', label: 'OK', primary: true, cancel: true },
];

/**
 * The capture flag, in its OBJECT form rather than the boolean shorthand, so the
 * listener is actually removable. See keys/dispatcher.ts for why that is not the
 * same thing.
 */
const CAPTURE = { capture: true } as const;

function buttonClass(spec: AlertButton): string {
  if (spec.primary === true) {
    return 'woc-btn woc-btn-primary';
  }
  return 'woc-btn';
}

function buildButton(doc: Document, spec: AlertButton, onPick: (id: string) => void): HTMLElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = buttonClass(spec);
  button.textContent = spec.label;
  button.addEventListener('click', () => {
    onPick(spec.id);
  });
  return button;
}

/** The backdrop, the panel inside it, and the empty row the buttons go in. */
interface Modal {
  backdrop: HTMLElement;
  row: HTMLElement;
}

function buildModal(doc: Document, opts: AlertOpts): Modal {
  const backdrop = doc.createElement('div');
  backdrop.className = 'woc-modal-backdrop';

  const panel = doc.createElement('div');
  panel.className = 'woc-modal panel';
  panel.setAttribute('role', 'alertdialog');
  panel.setAttribute('aria-modal', 'true');

  if (opts.title !== undefined) {
    const heading = doc.createElement('h2');
    heading.className = 'woc-modal-title';
    heading.textContent = opts.title;
    panel.appendChild(heading);
    panel.setAttribute('aria-label', opts.title);
  }

  const message = doc.createElement('p');
  message.className = 'woc-modal-message';
  message.textContent = opts.message;
  panel.appendChild(message);

  const row = doc.createElement('div');
  row.className = 'woc-modal-buttons';
  panel.appendChild(row);

  backdrop.appendChild(panel);
  return { backdrop, row };
}

function openAlert(deps: AlertDeps, opts: AlertOpts): OpenAlert {
  const { doc } = deps;
  const buttons = opts.buttons ?? DEFAULT_BUTTONS;
  const cancelId = buttons.find((button) => button.cancel === true)?.id ?? null;
  const { backdrop, row } = buildModal(doc, opts);

  let settle: (id: string | null) => void = () => undefined;
  const answer = new Promise<string | null>((resolve) => {
    settle = resolve;
  });

  let open = true;
  const finish = (id: string | null): void => {
    if (!open) {
      return;
    }
    open = false;
    doc.removeEventListener('keydown', onKey, CAPTURE);
    backdrop.remove();
    settle(id);
  };

  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return;
    }
    event.stopPropagation();
    finish(cancelId);
  }

  for (const spec of buttons) {
    row.appendChild(buildButton(doc, spec, finish));
  }

  // Only the backdrop itself, not a click that bubbled up from the panel.
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) {
      finish(cancelId);
    }
  });
  doc.addEventListener('keydown', onKey, CAPTURE);

  deps.root.appendChild(backdrop);
  // Focused after mounting, so the player can answer from the keyboard without
  // hunting for where focus went.
  const primary = row.querySelector('.woc-btn-primary') ?? row.firstElementChild;
  (primary as HTMLElement | null)?.focus();

  return {
    answer,
    close: () => {
      finish(cancelId);
    },
  };
}

export type { AlertButton, AlertDeps, AlertOpts, OpenAlert };
export { DEFAULT_BUTTONS, openAlert };
