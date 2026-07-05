import { categoryIcon, categoryLabel, type Expense, type GroupDetail } from '@banana-split/shared';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatMoney } from '../lib/money';
import { Card, Screen, theme } from '../ui';

interface Row {
  key: string;
  label: string;
  amount: number;
}

function Bars({ rows, currency, max }: { rows: Row[]; currency: string; max: number }) {
  if (rows.length === 0) return <p style={{ color: theme.hint }}>No data yet.</p>;
  return (
    <>
      {rows.map((r) => (
        <div key={r.key} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
            <span>{r.label}</span>
            <strong>{formatMoney(r.amount, currency)}</strong>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: theme.secondaryBg }}>
            <div style={{ height: '100%', borderRadius: 4, background: theme.button, width: `${max > 0 ? Math.round((r.amount / max) * 100) : 0}%` }} />
          </div>
        </div>
      ))}
    </>
  );
}

export function Stats({ groupId, onBack }: { groupId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getGroup(groupId), api.listExpenses(groupId)])
      .then(([d, es]) => {
        setDetail(d);
        setExpenses(es);
      })
      .catch((e: unknown) => setError(String(e)));
  }, [groupId]);

  if (!detail) {
    return (
      <Screen title="Stats" onBack={onBack}>
        {error ? <p style={{ color: theme.destructive }}>{error}</p> : <p>Loading…</p>}
      </Screen>
    );
  }

  const nameOf = (id: number) => detail.members.find((m) => m.id === id)?.firstName ?? `User ${id}`;
  const currencies = [...new Set(expenses.map((e) => e.currency))].sort();

  const sumBy = <K,>(list: Expense[], keyFn: (e: Expense) => K) => {
    const m = new Map<K, number>();
    for (const e of list) m.set(keyFn(e), (m.get(keyFn(e)) ?? 0) + e.amount);
    return m;
  };

  return (
    <Screen title="Stats" onBack={onBack}>
      {error && <p style={{ color: theme.destructive }}>{error}</p>}
      {expenses.length === 0 && <p style={{ color: theme.hint }}>No expenses yet.</p>}

      {currencies.map((currency) => {
        const inCur = expenses.filter((e) => e.currency === currency);
        const total = inCur.reduce((s, e) => s + e.amount, 0);
        const byCategory: Row[] = [...sumBy(inCur, (e) => e.category ?? 'general').entries()]
          .map(([cat, amount]) => ({ key: cat, label: `${categoryIcon(cat)} ${categoryLabel(cat)}`, amount }))
          .sort((a, b) => b.amount - a.amount);
        const byPayer: Row[] = [...sumBy(inCur, (e) => e.paidBy).entries()]
          .map(([uid, amount]) => ({ key: String(uid), label: nameOf(uid), amount }))
          .sort((a, b) => b.amount - a.amount);
        const catMax = Math.max(0, ...byCategory.map((r) => r.amount));
        const payerMax = Math.max(0, ...byPayer.map((r) => r.amount));

        return (
          <div key={currency} style={{ marginBottom: 8 }}>
            <Card>
              <div style={{ fontSize: 13, color: theme.hint }}>{currency} total</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{formatMoney(total, currency)}</div>
              <div style={{ fontSize: 13, color: theme.hint, marginTop: 2 }}>{inCur.length} expenses</div>
            </Card>
            <h2 style={{ fontSize: 15, color: theme.hint, marginTop: 16 }}>By category ({currency})</h2>
            <Bars rows={byCategory} currency={currency} max={catMax} />
            <h2 style={{ fontSize: 15, color: theme.hint, marginTop: 16 }}>By member — paid ({currency})</h2>
            <Bars rows={byPayer} currency={currency} max={payerMax} />
          </div>
        );
      })}
    </Screen>
  );
}
