// Core domain types shared between the server and the Mini App frontend.
//
// MONEY: every amount is an integer in MINOR UNITS (e.g. cents). Never floats.
// This avoids rounding drift when splitting and summing balances.

export type SplitType = 'equal' | 'shares' | 'exact' | 'itemized';

export interface User {
  id: number; // Telegram user id; NEGATIVE ids are non-Telegram "placeholder" members
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  isPlaceholder?: boolean; // true when this is a placeholder (id < 0), not a real Telegram user
}

export interface Group {
  id: string; // uuid
  title: string;
  telegramChatId?: number | null; // linked group chat, if the bot was added to one
  currency: string; // ISO 4217, e.g. "USD"
  avatar?: string | null; // optional emoji/branding
  notificationsEnabled: boolean; // whether the bot posts activity to the linked chat
  createdAt: number; // unix seconds
}

export interface GroupMember {
  groupId: string;
  userId: number;
}

/** A group plus its resolved members — the payload for the group-detail screen. */
export interface GroupDetail {
  group: Group;
  members: User[];
}

/** One member's share of a single expense. */
export interface ExpenseSplit {
  userId: number;
  /** Exact amount this user owes for the expense, in minor units. */
  amount: number;
  /** For 'shares' splits, the raw weight (e.g. 2). Undefined otherwise. */
  shares?: number;
}

export interface Expense {
  id: string;
  groupId: string;
  description: string;
  amount: number; // total, minor units
  currency: string;
  paidBy: number; // Telegram user id of who fronted the money
  splitType: SplitType;
  category?: string | null; // category id (see categories.ts); null = uncategorized
  splits: ExpenseSplit[];
  /** Present only when splitType === 'itemized': the receipt lines + who claimed each. */
  items?: ExpenseItem[];
  createdBy: number;
  createdAt: number;
}

/** A single receipt line on an itemized expense. */
export interface ExpenseItem {
  id: string;
  description: string;
  amount: number; // minor units, in the expense's currency
  /** 'item' lines are claimable; tax/tip/discount are allocated proportionally. */
  kind: 'item' | 'tax' | 'tip' | 'discount';
  /** User ids sharing this item (empty ⇒ shared by all participants). Only meaningful for 'item'. */
  claimants: number[];
}

/**
 * A receipt parsed from an image — the technology-agnostic contract between the
 * webapp and whatever backend parser produced it (OCR / LLM / cloud API).
 * Amounts are integer minor units in `currency` (or the group currency if absent).
 */
export interface ParsedReceipt {
  currency?: string;
  items: { description: string; amount: number }[];
  tax?: number;
  tip?: number;
  discount?: number;
}

export interface Settlement {
  id: string;
  groupId: string;
  fromUser: number; // payer
  toUser: number; // payee
  amount: number; // minor units
  currency: string; // ISO 4217 — settlements are per-currency
  createdAt: number;
}

/** Net position of a member in a group, per currency. Positive = owed; negative = owes. */
export interface Balance {
  userId: number;
  currency: string;
  net: number; // minor units
}

/** A single suggested payment produced by debt simplification, in one currency. */
export interface SettlementSuggestion {
  fromUser: number;
  toUser: number;
  amount: number; // minor units
  currency: string;
}
