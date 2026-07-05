// Core domain types shared between the server and the Mini App frontend.
//
// MONEY: every amount is an integer in MINOR UNITS (e.g. cents). Never floats.
// This avoids rounding drift when splitting and summing balances.

export type SplitType = 'equal' | 'shares' | 'exact';

export interface User {
  id: number; // Telegram user id
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
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
  createdBy: number;
  createdAt: number;
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
