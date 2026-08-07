/**
 * The three boxes a panel is assembled out of, and the one way to hide any of
 * them. `woc.ui.column`, `woc.ui.row`, `woc.ui.line` and `woc.ui.show`.
 *
 * Added in API minor 4.
 */

/** Where a row's items sit against each other. Defaults to `center`. */
export type RowAlign = 'baseline' | 'center' | 'end' | 'start';

/** `muted` is the smaller, dimmer note a panel puts under its figures. */
export type LineTone = 'default' | 'muted';

export interface StackOpts {
  /** Appended here when given. Added in API minor 4. */
  parent?: Element;
  /**
   * Added alongside the kit's own class, so your own CSS still reaches it.
   *
   * Added in API minor 4.
   */
  className?: string;
  /**
   * Pixels. Defaults to the density's own spacing: the frame's gap in a comfortable
   * frame, tighter in a compact or bare one.
   *
   * The one number these take, deliberately. They write classes rather than styles
   * because an inline style outranks every selector a stylesheet can spell, so a
   * panel laid out in style attributes opts out of rules the loader holds for you,
   * the tap-target floor on a touch screen among them.
   *
   * Added in API minor 4.
   */
  gap?: number;
}

export interface RowOpts extends StackOpts {
  /** Wrap onto more lines. Default false. Added in API minor 4. */
  wrap?: boolean;
  /**
   * Defaults to `center`. Reach for `baseline` where a small label sits beside a
   * bigger figure, since centring lines up neither of them. Added in API minor 4.
   */
  align?: RowAlign;
  /**
   * Pixels between WRAPPED LINES, for a strip whose spacing down the panel is not
   * its spacing across it. Defaults to `gap`, and means nothing without `wrap`.
   *
   * ```js
   * woc.ui.row({ wrap: true, gap: 10, wrapGap: 2 });
   * ```
   *
   * A gap wide enough to separate the figures across the line drops the wrapped
   * line far enough to read as a second strip.
   *
   * Added in API minor 4.
   */
  wrapGap?: number;
}

export interface LineOpts {
  /** Appended here when given. Added in API minor 4. */
  parent?: Element;
  /** Added alongside the kit's own class. Added in API minor 4. */
  className?: string;
  /** Defaults to `default`. Added in API minor 4. */
  tone?: LineTone;
}
