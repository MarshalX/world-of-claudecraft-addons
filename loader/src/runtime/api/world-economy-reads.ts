// The economy reads on `woc.world`: the group whose closed arm is a STATUS rather
// than a null, which is why the `UNKNOWN` fallback lives here and not in
// `world-reads.ts`.

import type { BankState } from '../world/bank.ts';
import type { InvSlot } from '../world/game-types.ts';
import type { WorldHub } from '../world/hub.ts';
import type { MailState } from '../world/mail.ts';
import type { MarketState } from '../world/market.ts';
import { UNKNOWN } from '../world/proximity.ts';
import type { VaultState } from '../world/vault.ts';
import { fromBackend } from './world-reads.ts';

/**
 * The counters the player walks up to, and the badges that outlive them.
 *
 * Four of the eight answer a STATUS rather than a value, because the server gates
 * them on where the player is standing. Before the game exists those four answer
 * `unknown` rather than null, the choice `combat` and `abilities` make: they are
 * never-null readings, so there is nothing for a null to mean.
 */
export function economyReads(hub: WorldHub) {
  return {
    get market(): MarketState {
      const backend = hub.backend();
      if (backend === null) {
        return UNKNOWN;
      }
      return backend.market;
    },

    get marketCollectPending(): boolean | null {
      return fromBackend(hub, (backend) => backend.marketCollectPending);
    },

    get mail(): MailState {
      const backend = hub.backend();
      if (backend === null) {
        return UNKNOWN;
      }
      return backend.mail;
    },

    get mailUnread(): number | null {
      return fromBackend(hub, (backend) => backend.mailUnread);
    },

    get bank(): BankState {
      const backend = hub.backend();
      if (backend === null) {
        return UNKNOWN;
      }
      return backend.bank;
    },

    get vault(): VaultState {
      const backend = hub.backend();
      if (backend === null) {
        return UNKNOWN;
      }
      return backend.vault;
    },

    get craftVaultStock(): Readonly<Record<string, number>> | null {
      return fromBackend(hub, (backend) => backend.craftVaultStock);
    },

    get buyback(): readonly InvSlot[] | null {
      return fromBackend(hub, (backend) => backend.buyback);
    },
  };
}
