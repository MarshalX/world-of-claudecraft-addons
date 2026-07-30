// The centre-screen warning: the one thing a player must read within a second.
//
// Deliberately NOT a toast, and the difference is not decoration. A toast is
// informational, sits in a column at the top of the screen, and is announced
// politely so it waits its turn in a screen reader. This is for a mechanic about
// to kill someone. It lands in the middle of the view where the eye already is,
// and it carries `role="alert"`, which IS assertive: interrupting is the correct
// behaviour for a message whose whole value expires in about two seconds.
//
// There is ONE slot for the whole loader and a new banner replaces whatever is up.
// A stack in the centre of the screen would cover the fight the warning is about,
// and two warnings at once is the moment that matters most. The cost is real and
// belongs in the open: one addon's warning can displace another's, so an addon
// that wants a persistent readout wants a frame, not this.
//
// It takes no pointer events at all. A banner appears without being asked for, in
// the middle of where the player is clicking, and a dead patch over the world
// during a mechanic would be worse than the warning is good.
//
// SIZE IS AN ENUM, and it moves the weight and both lines with it. A caller cannot
// set a size and a weight separately on purpose: a huge thin display serif is less
// readable than a medium heavy one, so the two axes are not independent and offering
// them as if they were is offering a combination nobody wants.

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
  /**
   * Defaults to 'normal', which is already sized to be read across a fight.
   *
   * One step up rather than a scale, because the honest number of positions is two:
   * the mechanic you must react to, and the one that kills the raid if you do not.
   */
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
 * A variant class, for a value the caller gave or did not.
 *
 * Both fallbacks are safe to land on, which is why an absent value and an
 * unrecognised one can share a path here. That is NOT true of frame density, where
 * the fallback exists to stop a typo dropping the tap-target floor: here both sizes
 * are sized to be read across a fight, so the worst a typo costs is a step of
 * emphasis rather than a warning nobody sees.
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
      // Replacing, not stacking. The previous card's timer goes with it, or a
      // banner shown for two seconds would take the next one down with it.
      clear();
      const slot = ensureSlot(deps);
      const card = buildContent(deps, text, opts);
      slot.appendChild(card);

      const shown = { card, timer: null as number | null };
      live = shown;
      const dismiss = (): void => {
        // Only if this card is still the one up: a later banner has already
        // replaced it, and dismissing then would take the newer one down.
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
