import type { Unsubscribe } from './addon.js';

/** One message on the bus. */
export interface BusMessage {
  /**
   * The fqid of the addon that sent it, e.g. `official/combat-meter`.
   *
   * Stamped by the loader, so a sender cannot claim to be another addon. Safe to
   * decide trust on.
   */
  readonly from: string;
  readonly topic: string;
  /** Whatever the sender passed. Untyped, and unvalidated: check it. */
  readonly payload: unknown;
}

/**
 * What `woc.bus.publish` hands back.
 *
 * Added in API minor 4.
 */
export interface Publication {
  /** Emit now, because what you publish has changed. */
  announce: () => void;
  /** Stop answering. Called for you when your addon is disabled. */
  stop: Unsubscribe;
}

/**
 * Publish and subscribe between addons, inside this page.
 *
 * An addon is one file with no imports, so this is the only way two of them
 * cooperate: a meter publishes its totals and another addon draws them.
 *
 * ```js
 * // in the meter
 * woc.bus.emit('totals', { top: 'Fell Shot', dps: 812 });
 *
 * // in the display
 * woc.bus.on('official/combat-meter', 'totals', ({ payload }) => draw(payload));
 * ```
 *
 *  - **You name the publisher you are listening to**, not just a topic, so two
 *    addons can both publish `totals` and nobody can squat a name. Pass
 *    `woc.bus.anySender` when any publisher will do, and read `from`.
 *  - **You never receive your own messages.**
 *  - **Delivery is synchronous**, inside your `emit` call, so keep handlers cheap.
 *    Do not assume a handler ran: the addon you are talking to may not be
 *    installed.
 *  - **There is no request-response.** A reply from an addon that may be disabled
 *    or absent is a hang with no timeout. Publish both ways.
 *
 * Payloads stay in this page and never reach the network. Treat anything you
 * publish as readable by every other installed addon.
 *
 * For a value one addon holds and another wants, use `publish` and `follow`
 * rather than building the ask by hand.
 */
export interface BusApi {
  /** Publish to every addon listening for this topic from you. */
  emit: (topic: string, payload?: unknown) => void;
  /**
   * Listen for one topic from one publisher.
   *
   * `from` is the publishing addon's fqid, or `woc.bus.anySender` for any of them.
   * A throw in your handler is logged against your addon and does not stop the
   * message reaching anyone else.
   */
  on: (from: string, topic: string, handler: (message: BusMessage) => void) => Unsubscribe;
  /**
   * Publish a value other addons can ask for.
   *
   * Answers `<topic>:ask` from any sender with whatever `produce` returns, and
   * announces once at publish, so it does not matter whether a follower started
   * before or after you. Call `announce` yourself when your own value moves.
   *
   * `produce` runs once per ask and once at that announce, so it must tolerate
   * being called before your addon has finished starting: return null when you
   * have nothing yet.
   *
   * ```js
   * const prices = woc.bus.publish('prices', () => table ?? null);
   * // later, when the table changes
   * prices.announce();
   * ```
   *
   * The loader defines no topic names; the ones official addons agree on are in
   * the authoring docs.
   *
   * Added in API minor 4.
   */
  publish: (topic: string, produce: () => unknown) => Publication;
  /**
   * Follow a value another addon publishes.
   *
   * Subscribes to `topic` from ANY sender and asks once, so it does not matter
   * which of you started first. Your handler may run inside this call or long
   * after it.
   *
   * Any sender, because the same addon installed from a fork publishes under
   * another fqid. Read `from` for who answered.
   *
   * Silence means nobody is publishing and a null payload means a publisher with
   * nothing yet. Both are ordinary states to show, not errors.
   *
   * ```js
   * woc.bus.follow('prices', (payload) => {
   *   if (Array.isArray(payload)) {
   *     draw(payload);
   *   }
   * });
   * ```
   *
   * Added in API minor 4.
   */
  follow: (topic: string, handler: (payload: unknown, from: string) => void) => Unsubscribe;
  /** Pass as `from` when any publisher will do. Read `message.from` for who it was. */
  readonly anySender: string;
}
