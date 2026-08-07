/**
 * Formatting: a countdown, an id as words, a counted noun, an arrow.
 *
 * All four are pure, so they are safe from a frame handler and from your addon's
 * first line alike.
 */
export interface FmtApi {
  /**
   * A remaining time. `'timer'` is one unit for a bar's corner (`"45"`, `"3m"`,
   * seconds unmarked); `'coarse'` is two for a list row (`"45s"`, `"4m 12s"`,
   * `"1h 4m"`, `"2d 3h"`).
   *
   * Always rounds UP, so it is right for time REMAINING and overstates time
   * ELAPSED. Keep your own arithmetic for an elapsed figure.
   *
   * `'coarse'` picks its tier from the value and carries four of them, so before
   * you replace a hand-written formatter, work out the largest value your input
   * can reach: a shorter one agrees below its own ceiling and nowhere above it.
   *
   * `duration(59.5)` is `"60"` in `'timer'`, since the minute branch tests the
   * value you passed and the ceiling is applied after it.
   *
   * Null and any non-finite number give `""`, so a figure you do not have yet
   * draws nothing and `LootRoll.remaining` can be passed straight through. Zero
   * is a real reading and gives `"0"`; a negative is not clamped and gives
   * `"-5"`.
   *
   * Added in API minor 4.
   */
  duration: (seconds: number | null, style?: 'timer' | 'coarse') => string;
  /**
   * An id as words: `aimed_shot` becomes `Aimed Shot`.
   *
   * A LAST RESORT and worth saying so on screen. Ids and display names have
   * diverged across abilities, items and mob templates alike, so this answers
   * `Arcane Shot` for an ability the game calls Fell Shot. Reach for it only
   * after every route to a carried name has come back empty.
   *
   * Added in API minor 4.
   */
  titleCase: (id: string) => string;
  /**
   * `1` gives `"1 item"`, anything else `"4 items"`. Pass `plural` for an
   * irregular one.
   *
   * Added in API minor 4.
   */
  count: (n: number, singular: string, plural?: string) => string;
  /**
   * An eight-point arrow for a bearing in degrees clockwise from where you face:
   * one of `↑ ↗ → ↘ ↓ ↙ ← ↖`, in 45-degree sectors with `↑` straight ahead.
   *
   * Pairs with `woc.world.bearingTo`, which answers in this convention. A value
   * outside [-180, 180) is normalised rather than refused.
   *
   * Null and any non-finite number give `""`, so a bearing you do not have draws
   * no arrow rather than one pointing confidently forward. `0` is a real reading.
   *
   * Added in API minor 4.
   */
  compass: (degrees: number | null) => string;
}
