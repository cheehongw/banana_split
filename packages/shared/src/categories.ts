// Expense categories, shared so the server, bot, and Mini App agree on ids/labels.
// Stored as the category `id` string on expenses (nullable = uncategorized).

export interface CategoryMeta {
  id: string;
  label: string;
  icon: string; // emoji, rendered on the feed
}

export const CATEGORIES: CategoryMeta[] = [
  { id: 'general', label: 'General', icon: '🧾' },
  { id: 'food', label: 'Food & Drink', icon: '🍽️' },
  { id: 'groceries', label: 'Groceries', icon: '🛒' },
  { id: 'transport', label: 'Transport', icon: '🚗' },
  { id: 'home', label: 'Home / Stay', icon: '🏠' },
  { id: 'entertainment', label: 'Entertainment', icon: '🎉' },
  { id: 'utilities', label: 'Utilities', icon: '💡' },
  { id: 'shopping', label: 'Shopping', icon: '🛍️' },
  { id: 'travel', label: 'Travel', icon: '✈️' },
];

export const DEFAULT_CATEGORY = 'general';

const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

export function categoryIcon(id?: string | null): string {
  return (id && byId.get(id)?.icon) || '🧾';
}

export function categoryLabel(id?: string | null): string {
  return (id && byId.get(id)?.label) || 'General';
}

/** Whether an id is a known category (used to validate input server-side). */
export function isKnownCategory(id: string): boolean {
  return byId.has(id);
}
