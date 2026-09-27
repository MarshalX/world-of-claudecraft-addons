/**
 * The three boxes a panel is assembled out of, and the one way to hide any of
 * them. `woc.ui.column`, `woc.ui.row`, `woc.ui.line` and `woc.ui.show`.
 *
 * Added in API minor 4, every option below included.
 */

/** Where a row's items sit against each other. Defaults to `center`. */
export type RowAlign = 'baseline' | 'center' | 'end' | 'start';

/** `muted` is the smaller, dimmer note a panel puts under its figures. */
export type LineTone = 'default' | 'muted';

export interface StackOpts {
  /** Appended here when given. */
  parent?: Element;
  /** Added alongside the kit's own class, so your own CSS still reaches it. */
  className?: string;
  /**
   * Pixels. Defaults to the density's own spacing: the frame's gap in a comfortable
   * frame, tighter in a compact or bare one.
   *
   * The only number these take. Lay a panel out with these rather than inline
   * styles: an inline style outranks every stylesheet rule, so it opts out of
   * rules the loader holds for you, the touch-screen tap-target floor among them.
   */
  gap?: number;
}

export interface RowOpts extends StackOpts {
  /** Wrap onto more lines. Default false. */
  wrap?: boolean;
  /**
   * Defaults to `center`. Use `baseline` where a small label sits beside a bigger
   * figure, since centring lines up neither of them.
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
   * Without it, a gap wide enough to separate figures across the line drops the
   * wrapped line far enough to read as a second strip.
   */
  wrapGap?: number;
}

export interface LineOpts {
  /** Appended here when given. */
  parent?: Element;
  /** Added alongside the kit's own class. */
  className?: string;
  /** Defaults to `default`. */
  tone?: LineTone;
}
