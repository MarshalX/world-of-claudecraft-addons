import type { Unsubscribe } from './addon.js';

/** One message on the bus. */
export interface BusMessage {
  /**
   * The fqid of the addon that sent it, e.g. `official/combat-meter`.
   *
   * Stamped by the loader. A sender cannot set it, cannot change it, and cannot
   * claim to be another addon, so it is worth deciding what to trust on.
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
 * An addon is one file with no imports and no shared libraries, so this is the
 * only way two of them cooperate. A meter that publishes its per-ability totals
 * lets somebody else write the display without forking the meter; a boss addon
 * that publishes a phase lets three cosmetic addons react to it.
 *
 * ```js
 * // in the meter
 * woc.bus.emit('totals', { top: 'Fell Shot', dps: 812 });
 *
 * // in the display
 * woc.bus.on('official/combat-meter', 'totals', ({ payload }) => draw(payload));
 * ```
 *
 * Four things worth knowing before you design around it:
 *
 *  - **You name the publisher you are listening to**, not just a topic. Two
 *    addons can both publish `totals` without being confused for each other, and
 *    nobody can take a name by publishing under it first. Pass `woc.bus.anySender`
 *    when any publisher will do, and read `from` to see who it was.
 *  - **You never receive your own messages.** You do not need a bus to call your
 *    own code, and self-delivery is how a loop starts.
 *  - **Delivery is synchronous**, inside your `emit` call, so keep handlers cheap
 *    and do not assume a handler ran: nobody may be listening, and the addon you
 *    are talking to may not be installed.
 *  - **There is no request-response, and there will not be.** Awaiting a reply
 *    from an addon that may be disabled, may never have been installed, or may
 *    simply not answer is a hang with no timeout anyone chose. Publish both ways.
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
   * Topic names are content rather than API: the loader ships none, and the ones
   * addons here agree on are in the authoring docs.
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
   * Any sender rather than a named one because a hardcoded fqid is right only on
   * the official marketplace: the same addon installed from a fork publishes
   * under another name. Read `from` for who answered.
   *
   * Silence means nobody is publishing and a null payload means a publisher with
   * nothing yet. Both are ordinary, and worth saying on screen rather than
   * treating as an error.
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
