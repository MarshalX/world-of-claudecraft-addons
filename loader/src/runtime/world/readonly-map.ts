// A read-only view over one of the game's live maps.
//
// The entity map is the game's own, mutated in place every tick. Handing it to
// addons directly means one accidental clear() ends the session. The values are
// still the live objects: this stops a slip, it is not a boundary.
//
// It extends Map rather than merely implementing ReadonlyMap because addon code
// written against a map will reach for `instanceof Map`, and a plain object that
// answers every read but fails that check is the kind of surprise that shows up
// only in somebody else's addon. The inherited storage stays empty; every read
// is delegated.

const IMMUTABLE = 'woc.world.entities is a read-only view of the game state';

class ReadonlyMapView<K, V> extends Map<K, V> {
  readonly #source: ReadonlyMap<K, V>;

  constructor(source: ReadonlyMap<K, V>) {
    super();
    this.#source = source;
  }

  override get size(): number {
    return this.#source.size;
  }

  override get(key: K): V | undefined {
    return this.#source.get(key);
  }

  override has(key: K): boolean {
    return this.#source.has(key);
  }

  override keys(): MapIterator<K> {
    return this.#source.keys();
  }

  override values(): MapIterator<V> {
    return this.#source.values();
  }

  override entries(): MapIterator<[K, V]> {
    return this.#source.entries();
  }

  override forEach(callback: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this.#source) {
      callback.call(thisArg, value, key, this);
    }
  }

  override [Symbol.iterator](): MapIterator<[K, V]> {
    return this.#source[Symbol.iterator]();
  }

  override set(): never {
    throw new TypeError(IMMUTABLE);
  }

  override delete(): never {
    throw new TypeError(IMMUTABLE);
  }

  override clear(): never {
    throw new TypeError(IMMUTABLE);
  }
}

export function readonlyMapView<K, V>(source: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  return new ReadonlyMapView(source);
}
