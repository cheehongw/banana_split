import type { Balance, Expense, Group, GroupDetail, SettlementSuggestion, User } from '@banana-split/shared';

// Vite proxies /api to the Hono server in dev; in prod both are served together.
const BASE = import.meta.env.VITE_API_URL ?? '';

/** The signed initData Telegram gives the Mini App; the server validates it. */
function initData(): string {
  return window.Telegram?.WebApp?.initData ?? '';
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': initData(),
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export interface AddExpenseInput {
  groupId: string;
  description: string;
  amount: number; // minor units
  paidBy: number;
  splitType: 'equal' | 'shares' | 'exact';
  participants: number[];
  category?: string;
  currency?: string;
  shares?: Record<number, number>;
  exact?: Record<number, number>;
}

export const api = {
  me: () => request<User>('/me'),
  listGroups: () => request<Group[]>('/groups'),
  createGroup: (title: string, currency?: string) =>
    request<Group>('/groups', { method: 'POST', body: JSON.stringify({ title, currency }) }),
  getGroup: (groupId: string) => request<GroupDetail>(`/groups/${encodeURIComponent(groupId)}`),
  updateGroup: (
    groupId: string,
    patch: { title?: string; currency?: string; avatar?: string | null; notificationsEnabled?: boolean },
  ) => request<Group>(`/groups/${encodeURIComponent(groupId)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  addMember: (groupId: string, userId: number, firstName?: string) =>
    request<{ ok: true }>(`/groups/${encodeURIComponent(groupId)}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId, firstName }),
    }),
  removeMember: (groupId: string, userId: number) =>
    request<{ ok: true }>(`/groups/${encodeURIComponent(groupId)}/members/${userId}`, { method: 'DELETE' }),
  joinGroup: (groupId: string) =>
    request<{ ok: true }>(`/groups/${encodeURIComponent(groupId)}/join`, { method: 'POST' }),

  listExpenses: (groupId: string) =>
    request<Expense[]>(`/expenses?groupId=${encodeURIComponent(groupId)}`),
  addExpense: (body: AddExpenseInput) =>
    request<{ id: string }>('/expenses', { method: 'POST', body: JSON.stringify(body) }),

  balances: (groupId: string) =>
    request<{ balances: Balance[]; suggestions: SettlementSuggestion[] }>(
      `/settlements/balances?groupId=${encodeURIComponent(groupId)}`,
    ),
  settle: (groupId: string, fromUser: number, toUser: number, amount: number, currency: string) =>
    request<{ id: string }>('/settlements', {
      method: 'POST',
      body: JSON.stringify({ groupId, fromUser, toUser, amount, currency }),
    }),

  /** Fetch the group's CSV export as a Blob (carries the initData auth header). */
  exportGroup: async (groupId: string): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch(`${BASE}/api/groups/${encodeURIComponent(groupId)}/export`, {
      headers: { 'X-Telegram-Init-Data': initData() },
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    const blob = await res.blob();
    const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '');
    return { blob, filename: match?.[1] ?? 'export.csv' };
  },
};

/** The current Telegram user, if the app is running inside Telegram. */
export function currentUserId(): number | undefined {
  return window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
}

/** The `startapp=` param from a deep link (we use it to carry a group id to join). */
export function startParam(): string | undefined {
  return window.Telegram?.WebApp?.initDataUnsafe?.start_param;
}
