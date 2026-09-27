// The Ravenpost mailbox.
//
// Proximity-gated: the reading exists only while the player stands at a raven pillar. Passed
// through rather than projected, as in `market.ts`.
//
// The ungated unread count is `world.mailUnread`, for badges; do not derive it from `MailInfo`.

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
   * Parcels still waiting in the letter. An instance here is the public trim, even on your own
   * letters.
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
