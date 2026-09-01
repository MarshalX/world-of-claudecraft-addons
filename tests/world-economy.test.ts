import { describe, expect, it } from 'vitest';

import { economyReads } from '../loader/src/runtime/api/world-economy-reads.ts';
import { createGameBackend } from '../loader/src/runtime/world/backend.ts';
import type { WorldHub } from '../loader/src/runtime/world/hub.ts';
import { capture } from '../loader/src/runtime/world/signature.ts';
import { at, PLAYER_ENTITY, setAt } from './fakes/frames.ts';

/** No damage clock and no DOM: these cases drive the economy reads alone. */
const DEPS = {
  lastDamageAt: () => null,
  now: () => 0,
  zoneName: () => null,
  simNow: () => null,
  realm: () => null,
};

const A_LISTING = {
  id: 71,
  sellerName: 'Marshal',
  itemId: 'copper_ore',
  count: 20,
  price: 4200,
  mine: false,
  house: false,
};

const A_PAGE = {
  listings: [A_LISTING],
  totalCount: 1,
  filter: '',
  itemType: '',
  subtype: '',
  armorClass: '',
  primaryStat: '',
  rarity: '',
  sort: 'name',
  page: 0,
  pageCount: 1,
  collectionCopper: 0,
  collectionItems: [],
  cutPct: 5,
  maxListings: 12,
  myListingCount: 0,
};

const A_LETTER = {
  id: 3,
  senderName: 'Bursar Vane',
  kind: 'system',
  subject: 'Your goods',
  body: 'Returned, unsold.',
  copper: 0,
  items: [{ itemId: 'copper_ore', count: 20 }],
  read: false,
};

const A_BOX = {
  messages: [A_LETTER],
  totalCount: 1,
  unread: 1,
  postage: 30,
  maxAttachments: 3,
  deliverySeconds: 45,
};

/** Most recent first: a sale unshifts, and a re-sale moves a stack back to the front. */
const A_RING = [
  { itemId: 'silk', count: 1 },
  { itemId: 'linen', count: 4 },
];

/**
 * The deposit box. Keep the game's decoder invariants when editing a case:
 * `generalCapacity + materialsCapacity` is `capacity`, and
 * `generalUsed + materialsUsed` is `slots.length`.
 */
const A_BANK = {
  slots: [{ itemId: 'linen', count: 8 }],
  capacity: 24,
  purchasedSlots: 0,
  bonusSlots: 0,
  nextExpansionCost: 500,
  bonusSources: [],
  socketsUnlocked: 1,
  socketBags: ['runecloth_bag', null, null, null],
  nextSocketCost: 25_000,
  generalCapacity: 16,
  materialsCapacity: 8,
  generalUsed: 1,
  materialsUsed: 0,
};

/**
 * A material-to-count record, built from pairs: the keys are the game's item ids,
 * which `useNamingConvention` would flag as object-literal keys.
 */
function stock(...rows: readonly (readonly [string, number])[]): Record<string, number> {
  return Object.fromEntries(rows);
}

/** The Materials Vault: per-material stock rather than a slot budget. */
const A_VAULT = {
  stock: stock(['copper_ore', 120], ['linen', 40]),
  special: [{ itemId: 'sheenleaf_herb', count: 2, craftedRecipeId: 'tincture' }],
  upgrades: 2,
  perMaterialCap: 80,
  nextUpgradeCost: 12_000,
};

/**
 * __game.world with a decoded roster, which is what tells "away" from "unknown".
 *
 * `entities` is the signal the backend uses for "a snapshot has arrived", so a
 * case that wants `unknown` passes an empty map rather than removing a member.
 */
function gameWorld(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    world: {
      player: { ...PLAYER_ENTITY },
      entities: new Map<number, unknown>([[661, { ...PLAYER_ENTITY }]]),
      marketInfo: null,
      marketCollectPending: false,
      mailInfo: null,
      mailUnread: 0,
      bankInfo: null,
      vaultInfo: null,
      craftVaultStock: null,
      vendorBuyback: [],
      ...over,
    },
  };
}

function backendOf(game: Record<string, unknown>) {
  const backend = createGameBackend(game, DEPS);
  if (backend === null) {
    throw new Error('expected a backend');
  }
  return backend;
}

/** A hub with no backend at all, which is every read before the game exists. */
const NO_GAME = {
  backend: () => null,
} as unknown as WorldHub;

describe('the proximity-gated economy reads', () => {
  // The whole reason these three are a status rather than `T | null`. On a
  // nullable value `world.market?.listings ?? []` answers the empty array for
  // both of these, so an addon reports an empty market to a player in a town.
  it('tells an empty market page from no Merchant', () => {
    const empty = backendOf(gameWorld({ marketInfo: { ...A_PAGE, listings: [], totalCount: 0 } }));
    const nowhere = backendOf(gameWorld());

    expect(empty.market.status).toBe('near');
    expect(empty.market.info?.listings).toEqual([]);
    expect(nowhere.market).toEqual({ status: 'away', info: null });
  });

  it('answers unknown before a snapshot has decoded, rather than away', () => {
    const backend = backendOf(gameWorld({ entities: new Map<number, unknown>() }));

    expect(backend.market.status).toBe('unknown');
    expect(backend.mail.status).toBe('unknown');
    expect(backend.bank.status).toBe('unknown');
  });

  it('answers unknown before the game exists at all', () => {
    const reads = economyReads(NO_GAME);

    expect(reads.market).toEqual({ status: 'unknown', info: null });
    expect(reads.mail).toEqual({ status: 'unknown', info: null });
    expect(reads.bank).toEqual({ status: 'unknown', info: null });
    expect(reads.marketCollectPending).toBeNull();
    expect(reads.mailUnread).toBeNull();
    expect(reads.buyback).toBeNull();
  });

  // A browsing player reads this up to forty times a second. Rebuilding the
  // wrapper per access would allocate for a page that did not move.
  it('keeps one wrapper while the game holds the same page object', () => {
    const game = gameWorld({ marketInfo: A_PAGE });
    const backend = backendOf(game);
    const first = backend.market;

    expect(backend.market).toBe(first);

    setAt(at(game, 'world'), 'marketInfo', { ...A_PAGE });

    expect(backend.market).not.toBe(first);
    expect(backend.market.status).toBe('near');
  });

  it('reads live rather than capturing the world at construction', () => {
    const game = gameWorld();
    const backend = backendOf(game);

    setAt(at(game, 'world'), 'bankInfo', A_BANK);

    expect(backend.bank.info?.capacity).toBe(24);
  });
});

// The store is banker-gated and the craft draw is not; do not fold them into one shape.
describe('the Materials Vault', () => {
  it('gates the store on the banker, like the bank beside it', () => {
    const away = backendOf(gameWorld({ bankInfo: A_BANK }));
    const near = backendOf(gameWorld({ bankInfo: A_BANK, vaultInfo: A_VAULT }));

    expect(away.vault).toEqual({ status: 'away', info: null });
    expect(near.vault.status).toBe('near');
    expect(near.vault.info?.perMaterialCap).toBe(80);
  });

  it('answers unknown before a snapshot has decoded, rather than away', () => {
    const backend = backendOf(gameWorld({ entities: new Map<number, unknown>() }));

    expect(backend.vault.status).toBe('unknown');
  });

  it('tells an empty craft draw from a refused one', () => {
    const empty = backendOf(gameWorld({ craftVaultStock: {} }));
    const refused = backendOf(gameWorld({ craftVaultStock: null }));

    expect(empty.craftVaultStock).toEqual({});
    expect(refused.craftVaultStock).toBeNull();
  });

  it('reads the craft draw with no banker anywhere', () => {
    const backend = backendOf(gameWorld({ craftVaultStock: stock(['copper_ore', 120]) }));

    expect(backend.vault.status).toBe('away');
    expect(backend.craftVaultStock).toEqual(stock(['copper_ore', 120]));
  });
});

describe('the badge reads beside them', () => {
  // The failure that folding these into their parents would cause: a badge
  // exists for the moment the player is NOT at the counter.
  it('keeps the unread count while the mailbox is out of reach', () => {
    const backend = backendOf(gameWorld({ mailUnread: 12 }));

    expect(backend.mail.status).toBe('away');
    expect(backend.mailUnread).toBe(12);
  });

  it('keeps the collect flag while the Merchant is out of reach', () => {
    const backend = backendOf(gameWorld({ marketCollectPending: true }));

    expect(backend.market.status).toBe('away');
    expect(backend.marketCollectPending).toBe(true);
  });

  // Both guard a reader written around truthiness: zero unread letters and
  // nothing waiting to collect are the ORDINARY answers, not missing ones.
  it('publishes an unread count of zero as zero rather than as absent', () => {
    expect(backendOf(gameWorld({ mailUnread: 0 })).mailUnread).toBe(0);
  });

  it('publishes a collect flag of false as false rather than as absent', () => {
    expect(backendOf(gameWorld({ marketCollectPending: false })).marketCollectPending).toBe(false);
  });
});

describe('the buyback ring', () => {
  // Standing at a vendor is what lets a player USE the ring, not what lets them
  // see it, so wrapping it in a ProximityState by analogy would be wrong.
  it('is readable with no vendor, no Merchant and no banker anywhere', () => {
    const backend = backendOf(gameWorld({ vendorBuyback: A_RING }));

    expect(backend.market.status).toBe('away');
    expect(backend.buyback).toEqual(A_RING);
  });

  it('keeps the game"s order, most recent first', () => {
    const backend = backendOf(gameWorld({ vendorBuyback: A_RING }));

    expect(backend.buyback?.[0]).toEqual({ itemId: 'silk', count: 1 });
  });
});

describe('the economy signatures', () => {
  const near = (info: unknown) => ({ status: 'near', info });

  // The cost of the wrong version: a walk over a 62 row page forty times a
  // second for a player who is nowhere near a Merchant.
  it('does not walk a page the player is away from', () => {
    const trap = {
      status: 'away',
      get info(): never {
        throw new Error('walked the page');
      },
    };

    expect(capture('market', trap)).toBe('away');
    expect(capture('mail', trap)).toBe('away');
    expect(capture('bank', trap)).toBe('away');
  });

  it('separates away from unknown', () => {
    expect(capture('market', { status: 'unknown', info: null })).toBe('unknown');
    expect(capture('market', { status: 'away', info: null })).not.toBe(
      capture('market', { status: 'unknown', info: null }),
    );
  });

  it('fires when a listing leaves the page', () => {
    const gone = { ...A_PAGE, listings: [{ ...A_LISTING, id: 72 }] };

    expect(capture('market', near(A_PAGE))).not.toBe(capture('market', near(gone)));
  });

  // A fresh join silently resets the server's own query while the window's
  // controls survive, and the echo is the only thing that can show it.
  it('fires when the server"s own query echo drifts', () => {
    const filtered = { ...A_PAGE, rarity: 'epic' };

    expect(capture('market', near(A_PAGE))).not.toBe(capture('market', near(filtered)));
  });

  // The order is not one of the filters and cannot be read off the id list: a
  // book of one row, or a page whose ids happen to come back in the same order,
  // reorders into an identical listing array under a different reading.
  it('fires when the browse order changes under an identical page', () => {
    const byPrice = { ...A_PAGE, sort: 'price' };

    expect(capture('market', near(A_PAGE))).not.toBe(capture('market', near(byPrice)));
  });

  it('ignores a letter"s body, which is unbounded free text', () => {
    const wordy = { ...A_BOX, messages: [{ ...A_LETTER, body: 'x'.repeat(4000) }] };

    expect(capture('mail', near(A_BOX))).toBe(capture('mail', near(wordy)));
  });

  it('fires when a letter arrives', () => {
    const fuller = {
      ...A_BOX,
      totalCount: 2,
      unread: 2,
      messages: [{ ...A_LETTER, id: 4 }, A_LETTER],
    };

    expect(capture('mail', near(A_BOX))).not.toBe(capture('mail', near(fuller)));
  });

  // Marking read and taking a parcel both mutate a letter IN PLACE, so an id
  // list alone would report that nothing moved. The box's own `unread` is held
  // still here on purpose: the counts are covered by the case above, and moving
  // both would let a signature that dropped the ROW field still pass.
  it('fires when a letter is marked read', () => {
    const seen = { ...A_BOX, messages: [{ ...A_LETTER, read: true }] };

    expect(capture('mail', near(A_BOX))).not.toBe(capture('mail', near(seen)));
  });

  it('fires when a parcel is taken out of a letter', () => {
    const emptied = { ...A_BOX, messages: [{ ...A_LETTER, copper: 0, items: [] }] };

    expect(capture('mail', near(A_BOX))).not.toBe(capture('mail', near(emptied)));
  });

  it('fires when a bank expansion is bought', () => {
    const wider = { ...A_BANK, capacity: 30, purchasedSlots: 6, nextExpansionCost: 1000 };

    expect(capture('bank', near(A_BANK))).not.toBe(capture('bank', near(wider)));
  });

  it('fires when a bank slot is filled', () => {
    const stocked = { ...A_BANK, slots: [{ itemId: 'linen', count: 9 }] };

    expect(capture('bank', near(A_BANK))).not.toBe(capture('bank', near(stocked)));
  });

  // Three ways the bag sockets move a bank without moving its capacity.
  it('fires when an empty bag socket is unlocked', () => {
    const unlocked = { ...A_BANK, socketsUnlocked: 2, nextSocketCost: 50_000 };

    expect(capture('bank', near(A_BANK))).not.toBe(capture('bank', near(unlocked)));
  });

  it('fires when one bag is swapped for another of the same size', () => {
    const swapped = { ...A_BANK, socketBags: ['mooncloth_bag', null, null, null] };

    expect(capture('bank', near(A_BANK))).not.toBe(capture('bank', near(swapped)));
  });

  it('fires when a bag swap moves capacity between the two pools', () => {
    const repooled = { ...A_BANK, generalCapacity: 8, materialsCapacity: 16 };

    expect(capture('bank', near(A_BANK))).not.toBe(capture('bank', near(repooled)));
  });

  it('fires when the pool occupancy moves under an unchanged slot list', () => {
    const recharged = { ...A_BANK, generalUsed: 0, materialsUsed: 1 };

    expect(capture('bank', near(A_BANK))).not.toBe(capture('bank', near(recharged)));
  });

  it('fires when a material is deposited into the vault', () => {
    const fuller = { ...A_VAULT, stock: stock(['copper_ore', 140], ['linen', 40]) };

    expect(capture('vault', near(A_VAULT))).not.toBe(capture('vault', near(fuller)));
  });

  // The record round-trips through the server's database and comes back re-ordered.
  it('stays quiet when the stock comes back in another key order', () => {
    const shuffled = { ...A_VAULT, stock: stock(['linen', 40], ['copper_ore', 120]) };

    expect(capture('vault', near(A_VAULT))).toBe(capture('vault', near(shuffled)));
  });

  it('fires when a vault rung is bought', () => {
    const upgraded = { ...A_VAULT, upgrades: 3, perMaterialCap: 120, nextUpgradeCost: 24_000 };

    expect(capture('vault', near(A_VAULT))).not.toBe(capture('vault', near(upgraded)));
  });

  it('tells a refused craft draw from an allowed but empty one', () => {
    expect(capture('craftVaultStock', null)).not.toBe(capture('craftVaultStock', {}));
    expect(capture('craftVaultStock', {})).not.toBe(
      capture('craftVaultStock', stock(['copper_ore', 1])),
    );
  });

  // Ordering is the only thing the ring tells an addon, so a sorted capture
  // would hide a re-sale moving a stack back to the front.
  it('fires when the buyback ring reorders', () => {
    expect(capture('buyback', A_RING)).not.toBe(capture('buyback', [...A_RING].reverse()));
  });

  it('reports the two badges as their own values', () => {
    expect(capture('mailUnread', 0)).not.toBe(capture('mailUnread', 1));
    expect(capture('marketCollectPending', false)).not.toBe(capture('marketCollectPending', true));
  });
});
