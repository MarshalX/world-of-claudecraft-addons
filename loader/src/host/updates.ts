// Which installed addons have a newer version waiting, from the cached indexes.
//
// A pure comparison of two readings the host already holds, with no fetch of its
// own. That is deliberate: an update badge must never be the thing that decides
// to go to the network, or opening the manager would issue a request per source
// before it could draw anything. The Updates pane's Refresh is what re-reads the
// indexes, and this reports on whatever they last said.
//
// A source whose index has never been read this session contributes nothing.
// Silence is the honest reading of "not looked yet", where an empty answer would
// read as "nothing to update".

import type { InstalledAddon, MarketplaceState, UpdateRow } from '../shared/protocol.ts';
import { isNewerVersion } from '../shared/version.ts';

/** Index rows by marketplace id, then by addon id, for one pass over the installed set. */
function indexByMarketplace(
  markets: readonly MarketplaceState[],
): Map<string, Map<string, string>> {
  const byMarket = new Map<string, Map<string, string>>();
  for (const market of markets) {
    const versions = new Map<string, string>();
    for (const addon of market.addons) {
      versions.set(addon.id, addon.version);
    }
    byMarket.set(market.ref.id, versions);
  }
  return byMarket;
}

/**
 * One row per installed addon whose marketplace offers something newer.
 *
 * A pinned addon still produces a row, carrying its pin. Dropping it would leave
 * the pane unable to say that an update exists and that the player's own pin is
 * what is holding it back, which is the only thing a pin needs a UI for.
 */
export function computeUpdates(
  installed: readonly InstalledAddon[],
  markets: readonly MarketplaceState[],
): UpdateRow[] {
  const byMarket = indexByMarketplace(markets);
  const rows: UpdateRow[] = [];

  for (const addon of installed) {
    const available = byMarket.get(addon.marketplace)?.get(addon.manifest.id);
    if (available !== undefined && isNewerVersion(available, addon.manifest.version)) {
      rows.push({
        fqid: addon.fqid,
        name: addon.manifest.name,
        marketplace: addon.marketplace,
        installed: addon.manifest.version,
        available,
        pin: addon.pin,
      });
    }
  }

  return rows;
}
