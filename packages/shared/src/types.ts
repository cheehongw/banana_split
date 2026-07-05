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
  createdAt: number; // unix seconds
}

export interface GroupMember {
  groupId: string;
  userId: number;
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
  createdAt: number;
}

/** Net position of a member in a group. Positive = is owed money; negative = owes money. */
export interface Balance {
  userId: number;
  net: number; // minor units
}

/** A single suggested payment produced by debt simplification. */
export interface SettlementSuggestion {
  fromUser: number;
  toUser: number;
  amount: number; // minor units
}
