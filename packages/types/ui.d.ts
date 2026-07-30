import type { Unsubscribe } from './addon.js';
import type { KnownSkillIcon, SkillIconClass } from './icons.generated.js';
import type { School } from './world.js';

export type FrameDensity = 'comfortable' | 'compact';

export interface FrameOpts {
  /** Unique within your addon. It is the persistence key, so keep it stable. */
  id: string;
  title?: string;
  width?: number;
  height?: number;
  /**
   * Whether the edges resize it. Defaults to true for `window` and false for
   * `frame`: a frame is sized by its content, so an explicit height would leave
   * it padded out or clipped as its text changes.
   */
  resizable?: boolean;
  /** Persist position and visibility for this character. */
  save?: boolean;
  /** Whether it starts on screen. A restored `save` visibility wins over this. */
  visible?: boolean;
  /** Added to the frame element, so you can style your own. */
  className?: string;
  /**
   * How tightly the loader's own chrome is drawn. Defaults to 'comfortable'.
   *
   * 'comfortable' is 16px labels on a 40px minimum, which is the tap-target
   * floor the game itself holds to, and is right for anything a player OPERATES.
   * 'compact' is for a dense readout they glance at, where that floor makes the
   * title bar and close button the loudest things in the panel. Compact gives up
   * the tap floor, which is why it is opt-in: pick it for a desktop readout, not
   * for a form.
   *
   * It also reaches your own controls: a `.woc-btn` or `.woc-tab` inside a
   * compact frame is drawn compact too, so reusing those classes gets you the
   * matching density for free.
   */
  density?: FrameDensity;
}

export interface Frame {
  /** The frame element. Yours to fill; the loader only positions it. */
  readonly el: HTMLElement;
  /** Where your content goes. Everything above it is chrome. */
  readonly body: HTMLElement;
  readonly visible: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
  setTitle: (title: string) => void;
  destroy: () => void;
}

export interface ToastOpts {
  /** Milliseconds on screen. Zero keeps it up until dismissed. */
  timeout?: number;
  kind?: 'info' | 'warn' | 'error';
}

export type BannerKind = 'info' | 'warn' | 'danger';

/**
 * How loud a banner is. `large` is the "you are about to die" step.
 *
 * This moves the SIZE AND THE WEIGHT together, and both lines with them, which is
 * why there is no separate weight option. The game's display face has no lowercase
 * and only loads 400 to 700, so a huge light setting of it is less readable than a
 * medium heavy one: the two axes are not independent and offering them as if they
 * were would only offer combinations nobody wants.
 */
export type BannerSize = 'normal' | 'large';

export interface BannerOpts {
  /** Milliseconds on screen. Zero keeps it up until dismissed or replaced. */
  timeout?: number;
  /** Defaults to 'warn', which is what a banner is nearly always for. */
  kind?: BannerKind;
  /**
   * Defaults to 'normal', which is already sized to be read across a fight.
   *
   * Reach for 'large' when missing the warning ends the pull, not for every warning:
   * if everything is large then nothing is, which is the failure mode a raid mod
   * hits first.
   */
  size?: BannerSize;
  /** A quieter second line, e.g. who the mechanic is on. Set in the UI face. */
  detail?: string;
}

export type BarTone = 'default' | 'warn' | 'danger';

/**
 * A damage school to tint a bar's fill by. The same union `Aura.school` uses.
 *
 * A SEPARATE axis from `tone`, not more values on it. Tone is urgency, which is what
 * a cooldown row says as an ability comes back up; a school is what KIND of damage the
 * row is made of. Where both are set, tone wins.
 *
 * The colours are the GAME'S, taken from the custom properties it tints its own debuff
 * borders with, so a row you colour this way matches what the player already reads for
 * the same school on an aura icon. That is also why there is no way to pass a colour:
 * two addons colouring by school should look the same, which is the point of the kit.
 */
export type BarSchool = School;

/** Everything a bar can be told. All of it is optional on an update. */
export interface BarUpdate {
  label?: string;
  /**
   * An icon URL, from `ui.icon`, or null for none.
   *
   * The slot is re-shown on every change, so a row reused for another ability
   * gets its icon back even if the previous URL had failed to load.
   */
  icon?: string | null;
  /**
   * 0 through 1.
   *
   * Clamped, and anything that is not a finite number reads as 0. That is
   * deliberate: a timer fraction divides by a total, and a NaN reaching a style
   * property drops the declaration silently, which looks like a stuck bar.
   */
  fraction?: number;
  /** The right-hand figure, usually a countdown. Drawn with tabular figures. */
  value?: string;
  /**
   * Tint the fill by the game's own colour for a damage school.
   *
   * `damage` events carry `school`, so a meter can colour a row by what kind of damage
   * it was. `heal2` does NOT carry one, which is why null is allowed: pass what the
   * event gave you rather than omitting the property on some rows and not others.
   * Null and an unrecognised value both tint nothing rather than guessing.
   */
  school?: BarSchool | null;
  /**
   * A quieter second line under the head, e.g. a hit count and crit rate.
   *
   * The fill spans both lines, so a share reads as the whole row's rather than as a
   * bar on one line of it. An empty string hides the line again.
   */
  detail?: string;
  tone?: BarTone;
}

export interface BarOpts extends BarUpdate {
  /** Added alongside the kit's own classes, so you can style your own rows. */
  className?: string;
}

export interface Bar {
  /** The row. Append it where you want it; the loader does not place it. */
  readonly el: HTMLElement;
  update: (next: BarUpdate) => void;
  /** Removes the row. Also done for you when your addon is disabled. */
  destroy: () => void;
}

/**
 * An ability id that ships a painted icon file, or any other string.
 *
 * Open for the reason `Cue` is: the set is content, a game release commits art before
 * these types catch up, and a published type must not be able to reject a working
 * addon. The known half is generated from every channel's manifest, so it autocompletes
 * what is actually reachable rather than every ability the game has.
 */
export type AbilityIconId = KnownSkillIcon | (string & Record<never, never>);

/**
 * A class the game files skill art under, or any other string.
 *
 * Open because the value you pass is normally `world.player.templateId`, which is a
 * plain string: a closed union would reject the ordinary call.
 */
export type IconClass = SkillIconClass | (string & Record<never, never>);

/**
 * Where the game's own art lives.
 *
 * Use these rather than writing a path: the directories are the game's, not the
 * loader's, and a hardcoded one in an addon breaks silently when the game moves
 * it. Every builder answers null for an id it cannot make a file name from.
 */
export interface IconUrls {
  /**
   * A class ability's icon.
   *
   * `cls` is the class the ability belongs to. For anything you cast that is
   * `world.player.templateId`, which is the class id for a player entity.
   *
   * Not every ability ships painted art. The game composites an icon for the rest
   * on a canvas, from a module no addon can reach, so those have no URL at all: the
   * ability has an icon in the game and none the loader can point at.
   *
   * The game serves a manifest of which ids have a file, so this returns null once
   * the loader KNOWS there is none. Until that manifest has been read the answer is
   * optimistic and the image load decides, which is why `ui.bar` hides its own icon
   * slot on error rather than making every addon handle it. See `preload`.
   */
  ability: (abilityId: AbilityIconId, cls: IconClass) => string | null;
  /** A mob or npc portrait, by the `templateId` on its entity. */
  mob: (templateId: string) => string | null;
  item: (itemId: string) => string | null;
  /**
   * Read a class's art manifest, so `ability` is exact from its first call.
   *
   * Optional, and it never rejects: the manifest is fetched in the background the
   * first time you ask for an ability in that class either way. Await it when a
   * blank slot on the first row you draw would be worse than a frame's delay.
   */
  preload: (cls: IconClass) => Promise<void>;
}

export interface AlertButton {
  id: string;
  label: string;
  /** Drawn as the affirmative action, and focused when the modal opens. */
  primary?: boolean;
  /** What Escape and a backdrop click resolve to. At most one. */
  cancel?: boolean;
}

export interface AlertOpts {
  title?: string;
  message: string;
  /** Defaults to a single dismissing "OK". */
  buttons?: readonly AlertButton[];
}

export interface MicroButtonOpts {
  /** Unique within your addon. The loader namespaces it before it reaches the page. */
  id: string;
  label: string;
  onClick: () => void;
  /** Inline SVG markup. Defaults to the loader's own glyph. */
  glyph?: string;
}

export interface MenuEntryOpts {
  id: string;
  label: string;
  onClick: () => void;
}

export interface UiApi {
  /** A light, content-sized HUD frame: movable, with no close button. */
  frame: (opts: FrameOpts) => Frame;
  /** A panel window: movable, resizable, with a title bar and close button. */
  window: (opts: FrameOpts) => Frame;
  /** Returns a dismiss function. */
  toast: (text: string, opts?: ToastOpts) => Unsubscribe;
  /**
   * A centre-screen warning, for the one thing a player must read immediately.
   *
   * Not a toast, and the difference is not cosmetic: this lands in the middle of
   * the view and is announced assertively, which interrupts a screen reader. Use
   * it for a mechanic about to land, not for information.
   *
   * There is ONE slot for the whole loader and a new banner replaces whatever is
   * up, including another addon's. Stacking these would cover the fight the
   * warning is about. For anything a player reads at their own pace, use a frame.
   */
  banner: (text: string, opts?: BannerOpts) => Unsubscribe;
  /**
   * A timer row: an icon, a name, a fill behind both, and a figure on the right.
   *
   * Append `bar.el` wherever you want it and call `bar.update()` as the numbers
   * move. Subscribe for the change and animate from the read: `world.on` fires
   * when a SET changes, so the bars that exist come from the subscription and how
   * full each one is comes from a frame loop.
   *
   * Inside a `density: 'compact'` frame the row is drawn compact too.
   */
  bar: (opts?: BarOpts) => Bar;
  /** Where the game's own art lives, so no addon writes a path. */
  icon: IconUrls;
  /**
   * Resolves with the id of the button pressed, or with the cancel button's id
   * when dismissed, or null when there was no cancel button.
   *
   * It ALWAYS resolves, including when your addon is disabled while it is open.
   */
  alert: (opts: AlertOpts) => Promise<string | null>;
  /** A button on the game's own rail. Lands when the HUD does. */
  microButton: (opts: MicroButtonOpts) => Unsubscribe;
  /** An entry in the game menu, below the loader's own "Addons". */
  menuEntry: (opts: MenuEntryOpts) => Unsubscribe;
  /** Shows on hover and on focus. */
  tooltip: (el: Element, text: string) => Unsubscribe;
}
