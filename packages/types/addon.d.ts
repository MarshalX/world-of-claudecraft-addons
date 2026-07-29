export type Unsubscribe = () => void;

export interface AddonInfo {
  readonly id: string;
  readonly fqid: string;
  readonly name: string;
  readonly version: string;
  readonly marketplace: string;
}

export interface GameInfo {
  readonly host: string;
  readonly channel: 'live' | 'pbe' | 'pbe2';
  /**
   * The running client version, with the patch the game's own formatter drops
   * restored, or null before the page's footer is readable.
   */
  readonly version: string | null;
  /** Null until the game has filled its footer in. */
  readonly build: string | null;
}
