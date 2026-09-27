// Which installed addons have a newer version waiting, from the cached indexes. Never fetches:
// a badge that went to the network would put a request per source in front of every open.

import { API_MINOR, API_VERSION } from '../shared/api-version.ts';
import type {
  InstalledAddon,
  MarketplaceEntry,
  MarketplaceState,
  UpdateRow,
} from '../shared/protocol.ts';
import { isNewerVersion } from '../shared/version.ts';

/**
 * Whether this loader could run the version being offered; otherwise the offer is withheld and
 * the player keeps the working version. Duplicates the supervisor's check, which lives in the
 * other realm.
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
 * One row per installed addon whose marketplace offers something newer. A pinned addon still
 * gets a row, carrying its pin, so the pane can say the pin is what holds the update back.
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
