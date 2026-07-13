import {
  CATEGORIES,
  categoryIcon,
  categoryLabel,
  type Expense,
  type GroupDetail,
  type SettlementSuggestion,
  type User,
} from '@banana-split/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { groupByDay } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { useMainButton } from '../lib/useMainButton';
import { Button, Card, EmptyState, inputStyle, Screen, SectionHeader, Skeleton, SkeletonCard, theme } from '../ui';

export function GroupDetailScreen({
  groupId,
  onBack,
  onAddExpense,
  onOpenStats,
  onOpenSettings,
  onOpenManageUsers,
}: {
  groupId: string;
  onBack: () => void;
  onAddExpense: (detail: GroupDetail) => void;
  onOpenStats: () => void;
  onOpenSettings: () => void;
  onOpenManageUsers: () => void;
}) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [suggestions, setSuggestions] = useState<SettlementSuggestion[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showAllDebts, setShowAllDebts] = useState(false);
  const [search, setSearch] = useState('');
  const [filterPayer, setFilterPayer] = useState<number | 'all'>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, es, b, m] = await Promise.all([
        api.getGroup(groupId),
        api.listExpenses(groupId),
        api.balances(groupId),
        api.me(),
      ]);
      setDetail(d);
      setExpenses(es);
      setSuggestions(b.suggestions);
      setMe(m);
    } catch (e) {
      setError(String(e));
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = (userId: number): string => detail?.members.find((u) => u.id === userId)?.firstName ?? `User ${userId}`;

  async function settle(s: SettlementSuggestion) {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await api.settle(groupId, s.fromUser, s.toUser, s.amount, s.currency);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const hasMainButton = useMainButton({
    text: 'Add expense',
    visible: !!detail,
    onClick: () => detail && onAddExpense(detail),
  });

  if (!detail) {
    return (
      <Screen title="Group" onBack={onBack}>
        {error ? (
          <p style={{ color: theme.destructive }}>{error}</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <Skeleton height={64} style={{ flex: 1, borderRadius: 12 }} />
              <Skeleton height={64} style={{ flex: 1, borderRadius: 12 }} />
            </div>
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}
      </Screen>
    );
  }

  const currency = detail.group.currency;
  const title = `${detail.group.avatar ? detail.group.avatar + ' ' : ''}${detail.group.title}`;

  // Summary totals per currency (currencies never sum together).
  const sumByCurrency = (amountOf: (e: Expense) => number) => {
    const m = new Map<string, number>();
    for (const e of expenses) m.set(e.currency, (m.get(e.currency) ?? 0) + amountOf(e));
    return [...m.entries()].filter(([, v]) => v !== 0);
  };
  const groupTotals = sumByCurrency((e) => e.amount);
  const yourTotals = me ? sumByCurrency((e) => e.splits.find((s) => s.userId === me.id)?.amount ?? 0) : [];
  const totalsLabel = (totals: [string, number][]) =>
    totals.length === 0 ? formatMoney(0, currency) : totals.map(([cur, amt]) => formatMoney(amt, cur)).join(' · ');

  // Personalized outstanding debts from the simplified suggestions.
  const youOwe = me ? suggestions.filter((s) => s.fromUser === me.id) : [];
  const owedToYou = me ? suggestions.filter((s) => s.toUser === me.id) : [];

  // Feed.
  const query = search.trim().toLowerCase();
  const filtered = expenses.filter(
    (e) =>
      (query === '' || e.description.toLowerCase().includes(query)) &&
      (filterPayer === 'all' || e.paidBy === filterPayer) &&
      (filterCategory === 'all' || (e.category ?? 'general') === filterCategory),
  );
  const dayGroups = groupByDay(filtered, (e) => e.createdAt);

  return (
    <Screen title={title} onBack={onBack}>
      {error && <p style={{ color: theme.destructive }}>{error}</p>}

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ ...summaryCardStyle }}>
          <div style={{ fontSize: 13, color: theme.hint }}>
            Group Total <span title="Sum of all expenses in this group, per currency">ⓘ</span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{totalsLabel(groupTotals)}</div>
        </div>
        <div style={{ ...summaryCardStyle }}>
          <div style={{ fontSize: 13, color: theme.hint }}>
            Your Total <span title="Your share across all expenses, per currency">ⓘ</span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{totalsLabel(yourTotals)}</div>
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <div style={{ flex: 1 }}>
          <Button variant="secondary" onClick={onOpenStats}>📊 Stats</Button>
        </div>
        <div style={{ flex: 1 }}>
          <Button variant="secondary" onClick={onOpenManageUsers}>👥 Members</Button>
        </div>
        <div style={{ flex: 1 }}>
          <Button variant="secondary" onClick={onOpenSettings}>⚙️ Settings</Button>
        </div>
      </div>

      {!hasMainButton && (
        <div style={{ marginTop: 8 }}>
          <Button onClick={() => onAddExpense(detail)}>+ Add expense</Button>
        </div>
      )}

      {/* Your outstanding debts */}
      <SectionHeader>Your Outstanding Debts</SectionHeader>
      {youOwe.length === 0 && owedToYou.length === 0 ? (
        <p style={{ color: theme.hint }}>You're all settled up. 🎉</p>
      ) : (
        <>
          {youOwe.map((s) => (
            <div key={`owe-${s.currency}-${s.toUser}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
              <span>
                You owe <strong>{nameOf(s.toUser)}</strong>
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: theme.destructive }}>{formatMoney(s.amount, s.currency)}</span>
                <button onClick={() => settle(s)} disabled={busy} style={settleLinkStyle}>
                  Settle
                </button>
              </div>
            </div>
          ))}
          {owedToYou.map((s) => (
            <div key={`owed-${s.currency}-${s.fromUser}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
              <span>
                <strong>{nameOf(s.fromUser)}</strong> owes you
              </span>
              <span style={{ color: '#2e7d32' }}>{formatMoney(s.amount, s.currency)}</span>
            </div>
          ))}
        </>
      )}
      {suggestions.length > 0 && (
        <button onClick={() => setShowAllDebts((v) => !v)} style={{ ...settleLinkStyle, marginTop: 8 }}>
          {showAllDebts ? 'Hide group debts' : 'See all group debts'}
        </button>
      )}
      {showAllDebts &&
        suggestions.map((s) => (
          <div key={`all-${s.currency}-${s.fromUser}-${s.toUser}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
            <span>
              {nameOf(s.fromUser)} → {nameOf(s.toUser)}
            </span>
            <span style={{ color: theme.hint }}>{formatMoney(s.amount, s.currency)}</span>
          </div>
        ))}

      {/* Expense feed */}
      <SectionHeader>History</SectionHeader>
      <input style={inputStyle} placeholder="Search expenses…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <select
          style={inputStyle}
          value={filterPayer === 'all' ? 'all' : String(filterPayer)}
          onChange={(e) => setFilterPayer(e.target.value === 'all' ? 'all' : Number(e.target.value))}
        >
          <option value="all">All payers</option>
          {detail.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.firstName}
            </option>
          ))}
        </select>
        <select style={inputStyle} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.label}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        expenses.length === 0 ? (
          <EmptyState emoji="🧾" title="No expenses yet" hint="Tap “Add expense” to record your first one." />
        ) : (
          <EmptyState emoji="🔍" title="No matches" hint="Try a different search or clear the filters." />
        )
      ) : (
        dayGroups.map((g) => (
          <div key={g.label}>
            <div style={dayDividerStyle}>{g.label}</div>
            {g.items.map((e) => {
              const open = expandedId === e.id;
              return (
                <Card key={e.id} onClick={() => setExpandedId(open ? null : e.id)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span style={{ fontSize: 22 }}>{categoryIcon(e.category)}</span>
                      <div>
                        <div>{e.description}</div>
                        <div style={{ fontSize: 13, color: theme.hint }}>Paid by {nameOf(e.paidBy)}</div>
                      </div>
                    </div>
                    <strong>{formatMoney(e.amount, e.currency)}</strong>
                  </div>
                  {open && (
                    <div style={{ marginTop: 8, borderTop: `1px solid ${theme.secondaryBg}`, paddingTop: 8 }}>
                      <div style={{ fontSize: 13, color: theme.hint, marginBottom: 4 }}>
                        {categoryLabel(e.category)} · split {e.splitType}
                      </div>
                      {e.splits.map((s) => (
                        <div key={s.userId} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                          <span>{nameOf(s.userId)}</span>
                          <span style={{ color: theme.hint }}>{formatMoney(s.amount, e.currency)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        ))
      )}

      {/* Members (read-only; manage via the Members action) */}
      <SectionHeader>Members</SectionHeader>
      {detail.members.map((m) => (
        <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
          <span>{m.firstName}</span>
          <span style={{ color: theme.hint }}>#{m.id}</span>
        </div>
      ))}
      <div style={{ marginTop: 8 }}>
        <Button variant="secondary" onClick={onOpenManageUsers}>Manage members</Button>
      </div>
    </Screen>
  );
}

const dayDividerStyle = { textAlign: 'center', fontSize: 13, color: theme.hint, margin: '14px 0 8px' } as const;
const summaryCardStyle = { flex: 1, background: theme.secondaryBg, borderRadius: 12, padding: 12 } as const;
const settleLinkStyle = { background: 'none', border: 'none', color: theme.link, cursor: 'pointer', fontSize: 15, padding: 0 } as const;
