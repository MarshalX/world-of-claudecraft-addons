// The Ravenpost mailbox.
//
// Proximity-gated: the reading exists only while the player stands at a raven
// pillar.
//
// The unread COUNT is not in here and must not be. It streams everywhere, with
// no proximity gate at all, because a badge exists for the moment you are NOT at
// a mailbox. It is `world.mailUnread`. `MailInfo` carries its own `unread` over
// the same letters, which is the mailbox pane's figure; neither should be
// derived from the other.
//
// Passed through rather than projected, for the reason `market.ts` gives.

import type { InvSlot } from './game-types.ts';
import type { ProximityState } from './proximity.ts';

/** Where a letter came from. Authored letters localize through `letterId`. */
type MailKind = 'player' | 'system' | 'npc';

interface MailMessage {
  id: number;
  senderName: string;
  kind: MailKind;
  /** Authored-letter id on system and NPC mail. Absent on player mail. */
  letterId?: string;
  subject: string;
  body: string;
  /** Coin still waiting in the letter. */
  copper: number;
  /**
   * Parcels still waiting in the letter.
   *
   * An instance here is the DISPLAY trim, your own letters included: the full
   * payload only arrives when the letter is taken, which no addon can do.
   */
  items: readonly InvSlot[];
  read: boolean;
}

interface MailInfo {
  /** Newest first. Delivered letters only: one in flight is not in here. */
  messages: readonly MailMessage[];
  totalCount: number;
  /** Unread among the letters in this box. For a badge, use `world.mailUnread`. */
  unread: number;
  /** Copper cost of sending one letter. */
  postage: number;
  /** Item stacks one letter can carry. */
  maxAttachments: number;
  /** The raven's flight time for player mail, in seconds. */
  deliverySeconds: number;
}

/** The mailbox, or why there is not one. */
type MailState = ProximityState<MailInfo>;

export type { MailInfo, MailKind, MailMessage, MailState };
