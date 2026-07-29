export interface StorageApi {
  get: <T = unknown>(key: string, fallback?: T) => Promise<T>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<void>;
  keys: () => Promise<string[]>;
}
