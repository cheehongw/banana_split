import { sql } from 'drizzle-orm';
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// All monetary columns store integer MINOR UNITS (cents).

export const users = sqliteTable('users', {
  id: integer('id').primaryKey(), // Telegram user id (not autoincrement)
  firstName: text('first_name').notNull(),
  lastName: text('last_name'),
  username: text('username'),
  photoUrl: text('photo_url'),
});

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(), // uuid
  title: text('title').notNull(),
  telegramChatId: integer('telegram_chat_id'), // linked group chat, if any
  currency: text('currency').notNull().default('USD'),
  avatar: text('avatar'), // optional emoji/branding shown on the group
  notificationsEnabled: integer('notifications_enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
});

export const groupMembers = sqliteTable(
  'group_members',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.groupId, t.userId] }) }),
);

export const expenses = sqliteTable('expenses', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id),
  description: text('description').notNull(),
  amount: integer('amount').notNull(), // total, minor units
  currency: text('currency').notNull(),
  paidBy: integer('paid_by')
    .notNull()
    .references(() => users.id),
  splitType: text('split_type', { enum: ['equal', 'shares', 'exact'] }).notNull(),
  category: text('category'), // optional category id (see @banana-split/shared categories)
  createdBy: integer('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
});

export const expenseSplits = sqliteTable(
  'expense_splits',
  {
    expenseId: text('expense_id')
      .notNull()
      .references(() => expenses.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    amount: integer('amount').notNull(), // amount this user owes, minor units
    shares: integer('shares'), // raw weight for 'shares' splits, else null
  },
  (t) => ({ pk: primaryKey({ columns: [t.expenseId, t.userId] }) }),
);

export const settlements = sqliteTable('settlements', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id),
  fromUser: integer('from_user')
    .notNull()
    .references(() => users.id),
  toUser: integer('to_user')
    .notNull()
    .references(() => users.id),
  amount: integer('amount').notNull(), // minor units
  currency: text('currency').notNull().default('USD'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
});
