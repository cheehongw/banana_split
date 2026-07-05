import { CATEGORIES, DEFAULT_CATEGORY, resolveSplits, type GroupDetail, type SplitType } from '@banana-split/shared';
import { useMemo, useState } from 'react';
import { api, type AddExpenseInput } from '../lib/api';
import { COMMON_CURRENCIES, formatMoney, parseMoney } from '../lib/money';
import { useMainButton } from '../lib/useMainButton';
import { Button, Field, inputStyle, Screen, theme } from '../ui';

const SPLIT_TYPES: SplitType[] = ['equal', 'shares', 'exact'];

export function AddExpense({ detail, onDone, onBack }: { detail: GroupDetail; onDone: () => void; onBack: () => void }) {
  const { group, members } = detail;
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState<number>(members[0]?.id ?? 0);
  const [splitType, setSplitType] = useState<SplitType>('equal');
  const [category, setCategory] = useState<string>(DEFAULT_CATEGORY);
  const [currency, setCurrency] = useState<string>(group.currency);
  const [selected, setSelected] = useState<Set<number>>(new Set(members.map((m) => m.id)));
  const [weights, setWeights] = useState<Record<number, string>>({});
  const [exact, setExact] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const cents = parseMoney(amount, currency);
  const participants = members.filter((m) => selected.has(m.id)).map((m) => m.id);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Live preview of per-person amounts, reusing the exact same math the server uses.
  const preview = useMemo(() => {
    if (cents == null || participants.length === 0) return { error: null, splits: [] };
    try {
      const splits = resolveSplits(splitType, cents, participants, {
        shares: mapNumbers(weights, participants),
        exact: mapCents(exact, participants, currency),
      });
      return { error: null as string | null, splits };
    } catch (e) {
      return { error: (e as Error).message, splits: [] };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cents, currency, splitType, participants.join(','), JSON.stringify(weights), JSON.stringify(exact)]);

  const nameOf = (id: number) => members.find((m) => m.id === id)?.firstName ?? `User ${id}`;

  async function submit() {
    setError(null);
    if (!description.trim()) return setError('Enter a description.');
    if (cents == null || cents <= 0) return setError('Enter a valid amount.');
    if (participants.length === 0) return setError('Pick at least one participant.');
    if (preview.error) return setError(preview.error);

    const body: AddExpenseInput = {
      groupId: group.id,
      description: description.trim(),
      amount: cents,
      paidBy,
      splitType,
      participants,
      category,
      currency,
      ...(splitType === 'shares' && { shares: mapNumbers(weights, participants) }),
      ...(splitType === 'exact' && { exact: mapCents(exact, participants, currency) }),
    };

    setSaving(true);
    try {
      await api.addExpense(body);
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  // Native Telegram MainButton for the primary action; in-page button is the
  // browser fallback when there's no MainButton (returns false).
  const canSave = !saving && !!description.trim() && cents != null && cents > 0 && participants.length > 0 && !preview.error;
  const hasMainButton = useMainButton({
    text: saving ? 'Saving…' : 'Save expense',
    visible: true,
    enabled: canSave,
    progress: saving,
    onClick: submit,
  });

  return (
    <Screen title="Add expense" onBack={onBack}>
      {error && <p style={{ color: theme.destructive }}>{error}</p>}

      <Field label="Description">
        <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Dinner" />
      </Field>

      <Field label="Amount">
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            style={{ ...inputStyle, width: 110, flexShrink: 0 }}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {[group.currency, ...COMMON_CURRENCIES.filter((c) => c !== group.currency)].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input style={inputStyle} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" />
        </div>
      </Field>

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
        <div style={{ display: 'flex', gap: 8 }}>
          {SPLIT_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setSplitType(t)}
              style={{
                flex: 1,
                padding: '8px 0',
                borderRadius: 8,
                textTransform: 'capitalize',
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

      <h2 style={{ fontSize: 15, color: theme.hint, marginTop: 16 }}>Participants</h2>
      {members.map((m) => {
        const on = selected.has(m.id);
        const p = preview.splits.find((s) => s.userId === m.id);
        return (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
            <input type="checkbox" checked={on} onChange={() => toggle(m.id)} />
            <span style={{ flex: 1 }}>{m.firstName}</span>

            {on && splitType === 'shares' && (
              <input
                style={{ ...inputStyle, width: 70 }}
                inputMode="numeric"
                placeholder="1"
                value={weights[m.id] ?? ''}
                onChange={(e) => setWeights((w) => ({ ...w, [m.id]: e.target.value }))}
              />
            )}
            {on && splitType === 'exact' && (
              <input
                style={{ ...inputStyle, width: 90 }}
                inputMode="decimal"
                placeholder="0.00"
                value={exact[m.id] ?? ''}
                onChange={(e) => setExact((x) => ({ ...x, [m.id]: e.target.value }))}
              />
            )}
            {on && p && (
              <span style={{ width: 90, textAlign: 'right', color: theme.hint }}>{formatMoney(p.amount, currency)}</span>
            )}
          </div>
        );
      })}

      {preview.error && <p style={{ color: theme.destructive }}>{preview.error}</p>}

      {!hasMainButton && (
        <div style={{ marginTop: 20 }}>
          <Button onClick={submit} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save expense'}
          </Button>
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
