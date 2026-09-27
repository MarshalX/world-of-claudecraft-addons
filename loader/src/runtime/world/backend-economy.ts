// The economy reads. Some are gated by the server on PROXIMITY to an NPC and some are not; see
// `proximity.ts`.
//
// `hasSelf` ("a snapshot has decoded") is the ROSTER's size, not the player record, because the
// offline sim's player accessor throws when the primary is missing.

import { fieldValue } from '../net/frames.ts';
import { readAs } from './backend-read.ts';
import type { BankInfo, BankState } from './bank.ts';
import type { InvSlot } from './game-types.ts';
import type { MailInfo, MailState } from './mail.ts';
import type { MarketInfo, MarketState } from './market.ts';
import { proximityReader } from './proximity.ts';
import type { VaultInfo, VaultState } from './vault.ts';

interface EconomyReads {
  /** The Merchant's book, one page at a time. Gated on standing at the Merchant. */
  readonly market: MarketState;
  /** Whether gold or goods wait at the Merchant. Ungated, so a badge always works. */
  readonly marketCollectPending: boolean | null;
  /** The mailbox. Gated on standing at a raven pillar. */
  readonly mail: MailState;
  /** Delivered and unread letters. Ungated, so a badge always works. */
  readonly mailUnread: number | null;
  /** The deposit box. Gated on standing at a banker. */
  readonly bank: BankState;
  /** The Materials Vault. Gated on standing at a banker, like the bank. */
  readonly vault: VaultState;
  /** What crafting may draw from the vault HERE. Null where it may not. */
  readonly craftVaultStock: Readonly<Record<string, number>> | null;
  /** The buyback ring, most recent first. Ungated. */
  readonly buyback: readonly InvSlot[] | null;
}

/**
 * A boolean read that keeps `false`, the ordinary answer; a truthiness-based reader would turn
 * it into "no snapshot yet".
 */
function flagAt(source: unknown, field: string): boolean | null {
  const value = fieldValue(source, field);
  if (typeof value === 'boolean') {
    return value;
  }
  return null;
}

/** A number read that keeps `0`, which is the ordinary answer for an unread count. */
function countAt(source: unknown, field: string): number | null {
  const value = fieldValue(source, field);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

/**
 * The economy reads off the game's own world object. One `proximityReader` per gated key, held
 * for the backend's life, so a wrapper is rebuilt only when the game swaps the object.
 */
function economyReads(world: unknown, hasSelf: () => boolean): EconomyReads {
  const market = proximityReader<MarketInfo>();
  const mail = proximityReader<MailInfo>();
  const bank = proximityReader<BankInfo>();
  const vault = proximityReader<VaultInfo>();

  return {
    get market(): MarketState {
      return market(fieldValue(world, 'marketInfo'), hasSelf());
    },

    get marketCollectPending(): boolean | null {
      return flagAt(world, 'marketCollectPending');
    },

    get mail(): MailState {
      return mail(fieldValue(world, 'mailInfo'), hasSelf());
    },

    get mailUnread(): number | null {
      return countAt(world, 'mailUnread');
    },

    get bank(): BankState {
      return bank(fieldValue(world, 'bankInfo'), hasSelf());
    },

    get vault(): VaultState {
      return vault(fieldValue(world, 'vaultInfo'), hasSelf());
    },

    // Not a proximity reader: null means an instance refuses the draw, which walking cannot fix.
    get craftVaultStock(): Readonly<Record<string, number>> | null {
      return readAs<Record<string, number>>(world, 'craftVaultStock');
    },

    get buyback(): readonly InvSlot[] | null {
      return readAs<InvSlot[]>(world, 'vendorBuyback');
    },
  };
}

export type { EconomyReads };
export { economyReads };
