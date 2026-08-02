// What a declared data file may weigh.
//
// Its own module because the two enforcers live in different trees and must not
// disagree: loader/src/host/addon-data.ts refuses one at install, and
// tools/manifests.ts refuses one in CI. A second copy of the number is the
// version of this that drifts, and `tools/` importing a `host/` module would be
// a new edge in a graph that currently only points at `shared/`.
//
// Shared rather than host-only for that reason alone. It carries no imports, so
// it is safe in either realm even though the page realm has no use for it.
//
// Half a megabyte, the same figure a preview carries (tools/manifests.ts) and
// for a related reason: the player waits for this during an install they asked
// for, and it then sits in GM storage for as long as the addon is installed.

export const DATA_MAX_BYTES = 524_288;
