import {
  CATEGORIES,
  currencyDecimals,
  DEFAULT_CATEGORY,
  resolveItemizedSplit,
  resolveSplits,
  type Expense,
  type GroupDetail,
  type SplitType,
} from '@banana-split/shared';
import { useMemo, useState } from 'react';
import { api, type AddExpenseInput } from '../lib/api';
import { COMMON_CURRENCIES, formatMoney, parseMoney } from '../lib/money';
import { useMainButton } from '../lib/useMainButton';
import { Button, Field, inputStyle, Screen, theme } from '../ui';

const SPLIT_TYPES: SplitType[] = ['equal', 'shares', 'exact', 'itemized'];

/** Integer minor units → plain major-unit input string (no currency code), e.g. 5000/JPY → "5000". */
function toAmountInput(minor: number, currency: string): string {
  const d = currencyDecimals(currency);
  return (minor / 10 ** d).toFixed(d);
}

interface ItemRow {
  description: string;
  amount: string;
  claimants: Set<number>;
}

export function AddExpense({
  detail,
  expense,
  onDone,
  onBack,
}: {
  detail: GroupDetail;
  expense?: Expense; // when present, edit this expense instead of creating a new one
  onDone: () => void;
  onBack: () => void;
}) {
  const { group, members } = detail;
  const editing = !!expense;
  const itemized = expense?.splitType === 'itemized' ? expense.items ?? [] : null;

  const [description, setDescription] = useState(expense?.description ?? '');
  // A refund is a negative-amount expense (non-itemized only); the amount input
  // stays a positive magnitude and we flip the sign at submit.
  const [isRefund, setIsRefund] = useState(expense && !itemized ? expense.amount < 0 : false);
  const [amount, setAmount] = useState(expense && !itemized ? toAmountInput(Math.abs(expense.amount), expense.currency) : '');
  const [paidBy, setPaidBy] = useState<number>(expense?.paidBy ?? members[0]?.id ?? 0);
  const [splitType, setSplitType] = useState<SplitType>(expense?.splitType ?? 'equal');
  const [category, setCategory] = useState<string>(expense?.category ?? DEFAULT_CATEGORY);
  const [currency, setCurrency] = useState<string>(expense?.currency ?? group.currency);
  const [selected, setSelected] = useState<Set<number>>(
    new Set(expense && !itemized ? expense.splits.map((s) => s.userId) : members.map((m) => m.id)),
  );
  const [weights, setWeights] = useState<Record<number, string>>(() =>
    expense && !itemized
      ? Object.fromEntries(expense.splits.filter((s) => s.shares != null).map((s) => [s.userId, String(s.shares)]))
      : {},
  );
  const [exact, setExact] = useState<Record<number, string>>(() =>
    expense && !itemized
      ? Object.fromEntries(expense.splits.map((s) => [s.userId, toAmountInput(Math.abs(s.amount), expense.currency)]))
      : {},
  );

  // Itemized state.
  const adjInit = (kind: 'tax' | 'tip' | 'discount') => {
    const row = itemized?.find((i) => i.kind === kind);
    return row && expense ? toAmountInput(row.amount, expense.currency) : '';
  };
  const [items, setItems] = useState<ItemRow[]>(() =>
    itemized
      ? itemized
          .filter((i) => i.kind === 'item')
          .map((i) => ({ description: i.description, amount: toAmountInput(i.amount, expense!.currency), claimants: new Set(i.claimants) }))
      : [{ description: '', amount: '', claimants: new Set(members.map((m) => m.id)) }],
  );
  const [tax, setTax] = useState(adjInit('tax'));
  const [tip, setTip] = useState(adjInit('tip'));
  const [discount, setDiscount] = useState(adjInit('discount'));

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isItemized = splitType === 'itemized';
  const cents = parseMoney(amount, currency);
  const signedCents = cents == null ? null : isRefund ? -cents : cents;
  const participants = members.filter((m) => selected.has(m.id)).map((m) => m.id);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Exact amounts are entered as positive magnitudes; a refund negates each.
  function signedExact() {
    const m = mapCents(exact, participants, currency);
    return isRefund ? Object.fromEntries(Object.entries(m).map(([k, v]) => [Number(k), -v])) : m;
  }

  function updateItem(idx: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function toggleClaimant(idx: number, userId: number) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const c = new Set(it.claimants);
        c.has(userId) ? c.delete(userId) : c.add(userId);
        return { ...it, claimants: c };
      }),
    );
  }

  // Non-itemized preview (reuses the exact same math the server uses).
  const preview = useMemo(() => {
    if (isItemized || signedCents == null || participants.length === 0) return { error: null, splits: [] };
    try {
      const splits = resolveSplits(splitType, signedCents, participants, {
        shares: mapNumbers(weights, participants),
        exact: signedExact(),
      });
      return { error: null as string | null, splits };
    } catch (e) {
      return { error: (e as Error).message, splits: [] };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isItemized, signedCents, currency, splitType, participants.join(','), JSON.stringify(weights), JSON.stringify(exact), isRefund]);

  // Itemized preview (per-person totals + derived grand total).
  const itemPreview = useMemo(() => {
    if (!isItemized) return null;
    const lines = items
      .map((it) => ({
        amount: parseMoney(it.amount, currency) ?? 0,
        claimants: [...it.claimants].filter((c) => selected.has(c)),
      }))
      .filter((l) => l.amount > 0);
    if (lines.length === 0 || participants.length === 0) return { error: null as string | null, total: 0, splits: [] as { userId: number; amount: number }[] };
    try {
      const r = resolveItemizedSplit(
        lines,
        { tax: parseMoney(tax, currency) ?? 0, tip: parseMoney(tip, currency) ?? 0, discount: parseMoney(discount, currency) ?? 0 },
        participants,
      );
      return { error: null as string | null, total: r.total, splits: r.splits };
    } catch (e) {
      return { error: (e as Error).message, total: 0, splits: [] as { userId: number; amount: number }[] };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isItemized, JSON.stringify(items.map((i) => [i.amount, [...i.claimants]])), tax, tip, discount, currency, participants.join(',')]);

  const nameOf = (id: number) => members.find((m) => m.id === id)?.firstName ?? `User ${id}`;

  async function submit() {
    setError(null);
    if (!description.trim()) return setError('Enter a description.');
    if (participants.length === 0) return setError('Pick at least one participant.');

    let body: AddExpenseInput;
    if (isItemized) {
      if (itemPreview?.error) return setError(itemPreview.error);
      const rows = items
        .map((it) => ({
          description: it.description.trim() || 'Item',
          amount: parseMoney(it.amount, currency) ?? 0,
          claimants: [...it.claimants].filter((c) => selected.has(c)),
        }))
        .filter((it) => it.amount > 0);
      if (rows.length === 0) return setError('Add at least one item with an amount.');
      if (!itemPreview || itemPreview.total <= 0) return setError('The itemized total must be positive.');
      body = {
        groupId: group.id,
        description: description.trim(),
        amount: itemPreview.total,
        paidBy,
        splitType,
        participants,
        category,
        currency,
        items: rows,
        tax: parseMoney(tax, currency) || undefined,
        tip: parseMoney(tip, currency) || undefined,
        discount: parseMoney(discount, currency) || undefined,
      };
    } else {
      if (cents == null || cents <= 0) return setError('Enter a valid amount.');
      if (preview.error) return setError(preview.error);
      body = {
        groupId: group.id,
        description: description.trim(),
        amount: signedCents as number,
        paidBy,
        splitType,
        participants,
        category,
        currency,
        ...(splitType === 'shares' && { shares: mapNumbers(weights, participants) }),
        ...(splitType === 'exact' && { exact: signedExact() }),
      };
    }

    setSaving(true);
    try {
      if (editing) await api.updateExpense(expense.id, body);
      else await api.addExpense(body);
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!expense || deleting) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setError(null);
    setDeleting(true);
    try {
      await api.deleteExpense(expense.id);
      onDone();
    } catch (e) {
      setError(String(e));
      setDeleting(false);
    }
  }

  const canSave =
    !saving &&
    !!description.trim() &&
    participants.length > 0 &&
    (isItemized ? !itemPreview?.error && (itemPreview?.total ?? 0) > 0 : cents != null && cents > 0 && !preview.error);
  const hasMainButton = useMainButton({
    text: saving ? 'Saving…' : editing ? 'Save changes' : isRefund ? 'Save refund' : 'Save expense',
    visible: true,
    enabled: canSave,
    progress: saving,
    onClick: submit,
  });

  const chipStyle = (on: boolean) => ({
    padding: '4px 10px',
    borderRadius: 14,
    fontSize: 13,
    border: `1px solid ${on ? theme.button : theme.hint}`,
    background: on ? theme.button : 'transparent',
    color: on ? theme.buttonText : theme.text,
    cursor: 'pointer',
  });

  return (
    <Screen title={`${editing ? 'Edit' : 'Add'} ${isRefund ? 'refund' : 'expense'}`} onBack={onBack}>
      {error && <p style={{ color: theme.destructive }}>{error}</p>}

      {!isItemized && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={isRefund} onChange={(e) => setIsRefund(e.target.checked)} />
          <span style={{ fontSize: 14 }}>This is a refund (money paid back to the group)</span>
        </label>
      )}

      <Field label="Description">
        <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Dinner" />
      </Field>

      {!isItemized && (
        <Field label="Amount">
          <div style={{ display: 'flex', gap: 8 }}>
            <select style={{ ...inputStyle, width: 110, flexShrink: 0 }} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {[group.currency, ...COMMON_CURRENCIES.filter((c) => c !== group.currency)].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input style={inputStyle} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" />
          </div>
        </Field>
      )}
      {isItemized && (
        <Field label="Currency">
          <select style={{ ...inputStyle, width: 110 }} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {[group.currency, ...COMMON_CURRENCIES.filter((c) => c !== group.currency)].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Category">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              style={{
                padding: '6px 10px',
                borderRadius: 16,
                fontSize: 14,
                border: `1px solid ${category === cat.id ? theme.button : theme.hint}`,
                background: category === cat.id ? theme.button : 'transparent',
                color: category === cat.id ? theme.buttonText : theme.text,
                cursor: 'pointer',
              }}
            >
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Paid by">
        <select style={inputStyle} value={paidBy} onChange={(e) => setPaidBy(Number(e.target.value))}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.firstName}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Split">
        <div style={{ display: 'flex', gap: 6 }}>
          {SPLIT_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setSplitType(t)}
              style={{
                flex: 1,
                padding: '8px 0',
                borderRadius: 8,
                textTransform: 'capitalize',
                fontSize: 13,
                border: `1px solid ${theme.hint}`,
                background: splitType === t ? theme.button : 'transparent',
                color: splitType === t ? theme.buttonText : theme.text,
                cursor: 'pointer',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </Field>

      {/* Participant selection (who's on this expense). */}
      <h2 style={{ fontSize: 15, color: theme.hint, marginTop: 16 }}>Participants</h2>
      {members.map((m) => {
        const on = selected.has(m.id);
        const p = preview.splits.find((s) => s.userId === m.id);
        const ip = itemPreview?.splits.find((s) => s.userId === m.id);
        return (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
            <input type="checkbox" checked={on} onChange={() => toggle(m.id)} />
            <span style={{ flex: 1 }}>{m.firstName}</span>
            {on && !isItemized && splitType === 'shares' && (
              <input style={{ ...inputStyle, width: 70 }} inputMode="numeric" placeholder="1" value={weights[m.id] ?? ''} onChange={(e) => setWeights((w) => ({ ...w, [m.id]: e.target.value }))} />
            )}
            {on && !isItemized && splitType === 'exact' && (
              <input style={{ ...inputStyle, width: 90 }} inputMode="decimal" placeholder="0.00" value={exact[m.id] ?? ''} onChange={(e) => setExact((x) => ({ ...x, [m.id]: e.target.value }))} />
            )}
            {on && !isItemized && p && <span style={{ width: 90, textAlign: 'right', color: theme.hint }}>{formatMoney(p.amount, currency)}</span>}
            {on && isItemized && ip && <span style={{ width: 90, textAlign: 'right', color: theme.hint }}>{formatMoney(ip.amount, currency)}</span>}
          </div>
        );
      })}

      {/* Itemized editor: items + per-item claimants + tax/tip/discount. */}
      {isItemized && (
        <>
          <h2 style={{ fontSize: 15, color: theme.hint, marginTop: 20 }}>Items</h2>
          {items.map((it, idx) => (
            <div key={idx} style={{ background: theme.secondaryBg, borderRadius: 12, padding: 12, marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...inputStyle, flex: 1 }} placeholder="Item" value={it.description} onChange={(e) => updateItem(idx, { description: e.target.value })} />
                <input style={{ ...inputStyle, width: 90 }} inputMode="decimal" placeholder="0.00" value={it.amount} onChange={(e) => updateItem(idx, { amount: e.target.value })} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {members
                  .filter((m) => selected.has(m.id))
                  .map((m) => (
                    <button key={m.id} onClick={() => toggleClaimant(idx, m.id)} style={chipStyle(it.claimants.has(m.id))}>
                      {m.firstName}
                    </button>
                  ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                <span style={{ fontSize: 12, color: theme.hint }}>{it.claimants.size === 0 ? 'Shared by everyone' : `Shared by ${it.claimants.size}`}</span>
                {items.length > 1 && (
                  <button onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', color: theme.destructive, cursor: 'pointer', fontSize: 13 }}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
          <Button variant="secondary" onClick={() => setItems((prev) => [...prev, { description: '', amount: '', claimants: new Set(participants) }])}>
            + Add item
          </Button>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Field label="Tax">
              <input style={inputStyle} inputMode="decimal" placeholder="0.00" value={tax} onChange={(e) => setTax(e.target.value)} />
            </Field>
            <Field label="Tip">
              <input style={inputStyle} inputMode="decimal" placeholder="0.00" value={tip} onChange={(e) => setTip(e.target.value)} />
            </Field>
            <Field label="Discount">
              <input style={inputStyle} inputMode="decimal" placeholder="0.00" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </Field>
          </div>

          {itemPreview && !itemPreview.error && itemPreview.total > 0 && (
            <p style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>Total: {formatMoney(itemPreview.total, currency)}</p>
          )}
          {itemPreview?.error && <p style={{ color: theme.destructive }}>{itemPreview.error}</p>}
        </>
      )}

      {!isItemized && preview.error && <p style={{ color: theme.destructive }}>{preview.error}</p>}

      {!hasMainButton && (
        <div style={{ marginTop: 20 }}>
          <Button onClick={submit} disabled={!canSave}>
            {saving ? 'Saving…' : editing ? 'Save changes' : isRefund ? 'Save refund' : 'Save expense'}
          </Button>
        </div>
      )}

      {editing && (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={remove}
            disabled={deleting}
            style={{
              width: '100%',
              padding: '12px 16px',
              fontSize: 16,
              fontWeight: 600,
              borderRadius: 10,
              border: `1px solid ${theme.destructive}`,
              background: 'transparent',
              color: theme.destructive,
              cursor: deleting ? 'default' : 'pointer',
              opacity: deleting ? 0.5 : 1,
            }}
          >
            {deleting ? 'Deleting…' : confirmDelete ? 'Tap again to delete' : '🗑️ Delete expense'}
          </button>
        </div>
      )}
    </Screen>
  );
}

/** Build a { userId: weight } map for the selected participants. A blank input
 *  defaults to weight 1; an explicit 0 (or invalid) is respected as 0. */
function mapNumbers(raw: Record<number, string>, participants: number[]): Record<number, number> {
  return Object.fromEntries(
    participants.map((id) => {
      const v = raw[id];
      if (v === undefined || v.trim() === '') return [id, 1];
      const n = Number(v);
      return [id, Number.isFinite(n) && n >= 0 ? n : 0];
    }),
  );
}

/** Build a { userId: minorUnits } map for the selected participants (default 0). */
function mapCents(raw: Record<number, string>, participants: number[], currency: string): Record<number, number> {
  return Object.fromEntries(participants.map((id) => [id, parseMoney(raw[id] ?? '', currency) ?? 0]));
}
