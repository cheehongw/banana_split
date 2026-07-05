import type { Balance, Expense, Group, SettlementSuggestion } from '@banana-split/shared';

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

export const api = {
  listGroups: () => request<Group[]>('/groups'),
  createGroup: (title: string, currency?: string) =>
    request<Group>('/groups', { method: 'POST', body: JSON.stringify({ title, currency }) }),

  listExpenses: (groupId: string) =>
    request<Expense[]>(`/expenses?groupId=${encodeURIComponent(groupId)}`),
  addExpense: (body: unknown) =>
    request<{ id: string }>('/expenses', { method: 'POST', body: JSON.stringify(body) }),

  balances: (groupId: string) =>
    request<{ balances: Balance[]; suggestions: SettlementSuggestion[] }>(
      `/settlements/balances?groupId=${encodeURIComponent(groupId)}`,
    ),
  settle: (body: unknown) =>
    request<{ id: string }>('/settlements', { method: 'POST', body: JSON.stringify(body) }),
};
