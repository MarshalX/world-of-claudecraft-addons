export interface StorageApi {
  /**
   * Read one of your own keys.
   *
   * Deliberately `unknown` rather than generic: nothing validates what comes
   * back, and a generic here would be an unchecked cast dressed up as a type.
   * The value is whatever was stored, which a previous version of your addon
   * may have written differently. Check it before you use it.
   *
   * `fallback` is returned only for a key that was never written; a stored null
   * is a value you chose and is returned as one.
   */
  get: (key: string, fallback?: unknown) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<void>;
  /** Your own keys only. Your settings and keybinds live elsewhere. */
  keys: () => Promise<string[]>;
}
