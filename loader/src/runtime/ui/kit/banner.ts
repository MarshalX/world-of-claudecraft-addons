// The centre-screen warning: the one thing a player must read within a second.
//
// Unlike a toast, it lands mid-screen and carries the assertive `role="alert"`, for a message
// whose value expires in seconds. ONE slot for the whole loader: a new banner replaces
// whatever is up, since a centre stack would cover the fight. It takes no pointer events,
// so it never makes a dead patch over the world.
//
// SIZE IS AN ENUM that moves weight and both lines together; a separate weight would allow
// a huge thin serif, which reads worse than a medium heavy one.

import type { Teardown } from '../../disposal.ts';

const BANNER_ID = 'woc-banner';
const DEFAULT_TIMEOUT_MS = 3000;

const KINDS = Object.freeze(['info', 'warn', 'danger'] as const);

/** How loud. `large` is the "you are about to die" step. */
const SIZES = Object.freeze(['normal', 'large'] as const);

type BannerKind = (typeof KINDS)[number];

type BannerSize = (typeof SIZES)[number];

interface BannerOpts {
  /** Milliseconds on screen. Zero keeps it up until dismissed or replaced. */
  timeout?: number;
  /** Defaults to 'warn', which is what a banner is nearly always for. */
  kind?: BannerKind;
  /** Defaults to 'normal', which is already sized to be read across a fight. */
  size?: BannerSize;
  /** A quieter second line, e.g. who the mechanic is on. */
  detail?: string;
}

interface Banner {
  /** Returns a dismiss function, which is also what a disposal bag holds. */
  show: (text: string, opts?: BannerOpts) => Teardown;
  dispose: () => void;
}

interface BannerDeps {
  doc: Document;
  /** The #woc-addons root. */
  root: HTMLElement;
  setTimer: (handler: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
}

/**
 * A variant class, for a value the caller gave or did not. An absent and an unrecognised
 * value share the fallback, since every variant here is safe to land on.
 */
function variantClass(fallback: string, value: unknown, allowed: readonly string[]): string {
  if (typeof value === 'string' && allowed.includes(value)) {
    return `woc-banner-${value}`;
  }
  return `woc-banner-${fallback}`;
}

function ensureSlot(deps: BannerDeps): HTMLElement {
  const existing = deps.doc.getElementById(BANNER_ID);
  if (existing !== null) {
    return existing;
  }
  const slot = deps.doc.createElement('div');
  slot.id = BANNER_ID;
  // assertive, unlike the toast stack: this exists to interrupt.
  slot.setAttribute('role', 'alert');
  deps.root.appendChild(slot);
  return slot;
}

function buildContent(deps: BannerDeps, text: string, opts: BannerOpts | undefined): HTMLElement {
  const card = deps.doc.createElement('div');
  const kind = variantClass('warn', opts?.kind, KINDS);
  const size = variantClass('normal', opts?.size, SIZES);
  card.className = `woc-banner-card ${kind} ${size}`;

  const line = deps.doc.createElement('div');
  line.className = 'woc-banner-text';
  line.textContent = text;
  card.appendChild(line);

  if (opts?.detail !== undefined) {
    const detail = deps.doc.createElement('div');
    detail.className = 'woc-banner-detail';
    detail.textContent = opts.detail;
    card.appendChild(detail);
  }
  return card;
}

function createBanner(deps: BannerDeps): Banner {
  /** The one thing on screen, and the timer that will take it away. */
  let live: { card: HTMLElement; timer: number | null } | null = null;

  const clear = (): void => {
    if (live === null) {
      return;
    }
    if (live.timer !== null) {
      deps.clearTimer(live.timer);
    }
    live.card.remove();
    live = null;
  };

  return {
    show: (text, opts) => {
      // The previous card's timer goes too, or it would take the new banner down.
      clear();
      const slot = ensureSlot(deps);
      const card = buildContent(deps, text, opts);
      slot.appendChild(card);

      const shown = { card, timer: null as number | null };
      live = shown;
      const dismiss = (): void => {
        // Only if this card is still the one up, or it would dismiss a newer banner.
        if (live === shown) {
          clear();
        }
      };

      const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
      if (timeout > 0) {
        shown.timer = deps.setTimer(dismiss, timeout);
      }
      return dismiss;
    },

    dispose: () => {
      clear();
      deps.doc.getElementById(BANNER_ID)?.remove();
    },
  };
}

export type { Banner, BannerDeps, BannerKind, BannerOpts, BannerSize };
export {
  BANNER_ID,
  createBanner,
  DEFAULT_TIMEOUT_MS as BANNER_TIMEOUT_MS,
  KINDS as BANNER_KINDS,
  SIZES as BANNER_SIZES,
};
