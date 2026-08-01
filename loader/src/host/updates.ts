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

import { API_MINOR, API_VERSION } from '../shared/api-version.ts';
import type {
  InstalledAddon,
  MarketplaceEntry,
  MarketplaceState,
  UpdateRow,
} from '../shared/protocol.ts';
import { isNewerVersion } from '../shared/version.ts';

/**
 * Whether this loader could actually run the version being offered.
 *
 * An update the loader cannot run is worse than no update at all: the offered
 * addon installs, reports running, and then throws against a member that is not
 * there, on whatever frame first reaches it. So an offer is withheld rather than
 * made and broken, and the player keeps the version that works until they update
 * the loader.
 *
 * The same two comparisons the supervisor makes, deliberately duplicated rather
 * than shared: that one guards STARTING an addon and this one guards OFFERING it,
 * they live in different realms, and each is two integer comparisons.
 */
function runnableHere(entry: MarketplaceEntry): boolean {
  return entry.apiVersion === API_VERSION && (entry.apiMinor ?? 0) <= API_MINOR;
}

/** Index rows by marketplace id, then by addon id, for one pass over the installed set. */
function indexByMarketplace(
  markets: readonly MarketplaceState[],
): Map<string, Map<string, string>> {
  const byMarket = new Map<string, Map<string, string>>();
  for (const market of markets) {
    const versions = new Map<string, string>();
    for (const addon of market.addons) {
      if (runnableHere(addon)) {
        versions.set(addon.id, addon.version);
      }
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
