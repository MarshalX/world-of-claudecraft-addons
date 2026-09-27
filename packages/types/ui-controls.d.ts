// The pieces of a pane you build yourself: what a row says, what a control does,
// and which pane is open.
//
// Every one is drawn with the classes the manager uses, so it follows its frame's
// density and matches the game with no palette of your own.

/**
 * What a tooltip line MEANS, the distinctions the game's own tooltips draw:
 * flavour is quieter than rules, and a met requirement reads differently from an
 * unmet one. Separate from `BarTone`, which is urgency, though names overlap.
 */
export type TooltipTone = 'default' | 'muted' | 'good' | 'warn' | 'danger';

export interface TooltipLine {
  text: string;
  /** Defaults to 'default'. An unrecognised value falls back to it too. */
  tone?: TooltipTone;
}

export interface TooltipContent {
  /** The name of the thing, drawn in the game's own heading colour. */
  title?: string;
  /** An icon URL, from `ui.icon`, beside the title. Null draws none. */
  icon?: string | null;
  /**
   * The body, one paragraph per entry.
   *
   * A bare string is a line at the default tone.
   */
  lines?: readonly (string | TooltipLine)[];
}

/**
 * A line of text, the whole tooltip, or a function returning either.
 *
 * The function form is called WHEN THE TOOLTIP IS SHOWN, so live content (a
 * meter row's current numbers) is current, and it is built only for the row
 * under the pointer. A throw inside it gives an empty tooltip and a log line.
 */
export type TooltipInput = string | TooltipContent | (() => string | TooltipContent);

/** What every field hands back. `T` is what that control's value is. */
export interface Field<T> {
  /** The labelled row. Append it where it goes; the loader does not place it. */
  readonly el: HTMLElement;
  value: () => T;
  /** Move it WITHOUT calling back, which is what a reset or a reload does. */
  set: (next: T) => void;
  /** Removes the row. Also done for you when your addon is disabled. */
  destroy: () => void;
}

export interface FieldOpts<T> {
  label: string;
  value: T;
  onChange: (next: T) => void;
  /** Drawn dimmed and unusable. */
  disabled?: boolean;
}

export interface SelectOpts extends FieldOpts<string> {
  options: readonly string[];
}

export interface SliderOpts extends FieldOpts<number> {
  min: number;
  max: number;
  /** Defaults to 1. */
  step?: number;
}

export interface TextOpts extends FieldOpts<string> {
  placeholder?: string;
}

/**
 * The controls a settings pane is made of, drawn as the manager draws its own.
 *
 * Reached at `ui.field`. They follow your frame's density, like `.woc-btn` and
 * `.woc-tab`. A checkbox puts its label beside the box; the other three put it
 * above.
 */
export interface FieldBuilders {
  checkbox: (opts: FieldOpts<boolean>) => Field<boolean>;
  select: (opts: SelectOpts) => Field<string>;
  /** Shows its current number beside the label. */
  slider: (opts: SliderOpts) => Field<number>;
  /** Calls back as you type, so a value abandoned by closing the window is not lost. */
  text: (opts: TextOpts) => Field<string>;
}

export interface Tab {
  /** Returned by `active()` and passed to `onSelect`. Unique within the strip. */
  id: string;
  label: string;
}

export interface TabsOpts {
  tabs: readonly Tab[];
  /** Which one starts open. Defaults to the first. */
  active?: string;
  onSelect: (id: string) => void;
}

export interface Tabs {
  readonly el: HTMLElement;
  active: () => string;
  /** Move the strip WITHOUT calling back, e.g. when a keybind changed the pane. */
  select: (id: string) => void;
  destroy: () => void;
}

export interface MenuItem {
  label: string;
  /** Runs after the menu has closed, so a handler may open another one. */
  onSelect: () => void;
  /** Drawn dimmed and unselectable. The reason belongs in the label. */
  disabled?: boolean;
  /** A rule above this item. Ignored on the first, where it would draw a lid. */
  separator?: boolean;
}
