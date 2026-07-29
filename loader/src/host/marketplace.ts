// Marketplace index fetch and merge.
//
// The built-in marketplace is merged in at position 0 on every read and is never
// persisted alongside the user-added ones.

export function createMarketplaceService(): never {
  throw new Error('not implemented: marketplace service');
}
