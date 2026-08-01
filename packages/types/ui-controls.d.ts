// The pieces of a pane you build yourself: what a row says, what a control does,
// and which pane is open.
//
// Split from ui.d.ts for the reason the timers are: that file is what the loader
// hands you already assembled, and these are the parts you put together. They
// share one property worth stating once. Every one of them is drawn from the
// classes the MANAGER is drawn with, so a form inside a loader frame answers to
// that frame's density and matches the game without an addon copying a palette.

/**
 * What a tooltip line MEANS, which is not what a bar's tone means.
 *
 * Its own union rather than `BarTone`, even though three names overlap. A bar's
 * tone is urgency, which is the only thing a fill can say; a tooltip line is prose,
 * and the useful distinctions there are the ones the game's own tooltips draw:
 * flavour text is quieter than the rules, and a requirement you meet reads
 * differently from one you do not.
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
   * A bare string is a line at the default tone, so a list of plain strings is
   * the ordinary case and needs no wrapping.
   */
  lines?: readonly (string | TooltipLine)[];
}

/**
 * A line of text, the whole tooltip, or a function returning either.
 *
 * The function form is called WHEN THE TOOLTIP IS SHOWN, which is what anything
 * live needs: a meter row has to say what its numbers are under the pointer, and
 * content fixed when the row was built says what they were when it was built.
 *
 * It is also cheaper than the static form for anything that moves, since the
 * content is built for the one row being pointed at rather than for every row on
 * screen. A throw inside it costs an empty tooltip and a line in your addon's log.
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
 * Named `Builders` rather than `Api` on purpose. The suffix is what marks a
 * top-level domain on `woc`, and this one is reached at `ui.field`; `IconUrls` is
 * the same kind of thing and is named the same way.
 *
 * They answer to your frame's density for free, the same way `.woc-btn` and
 * `.woc-tab` do, so a form inside a compact frame is compact without being told.
 *
 * A checkbox puts its label beside the box; the other three put it above. That is
 * not a style choice: a checkbox reads as a sentence with a box in front of it,
 * and a label above one reads as a heading for whatever comes next.
 */
export interface FieldBuilders {
  checkbox: (opts: FieldOpts<boolean>) => Field<boolean>;
  select: (opts: SelectOpts) => Field<string>;
  /** Shows its number beside the label: a range input alone says nothing about where it is. */
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
