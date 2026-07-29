// Per-addon lifecycle.
//
// Addon source is evaluated as new Function('woc', src) and paired with a
// DisposalBag that releases everything the addon's API calls created.

export function createAddonLoader(): never {
  throw new Error('not implemented: addon loader');
}
