import type { GroupDetail } from '@banana-split/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Button, Card, Field, inputStyle, Screen, SectionHeader, theme } from '../ui';

export function ManageUsers({ groupId, onBack }: { groupId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [memberId, setMemberId] = useState('');
  const [memberName, setMemberName] = useState('');
  const [placeholderName, setPlaceholderName] = useState('');
  const [confirmClaimId, setConfirmClaimId] = useState<number | null>(null);

  const load = useCallback(() => {
    api.getGroup(groupId).then(setDetail).catch((e: unknown) => setError(String(e)));
  }, [groupId]);

  useEffect(load, [load]);

  async function addMember() {
    const id = Number(memberId);
    if (!id || busy) return;
    setError(null);
    setBusy(true);
    try {
      await api.addMember(groupId, id, memberName.trim() || undefined);
      setMemberId('');
      setMemberName('');
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addPlaceholder() {
    const name = placeholderName.trim();
    if (!name || busy) return;
    setError(null);
    setBusy(true);
    try {
      await api.addPlaceholder(groupId, name);
      setPlaceholderName('');
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // Take over a placeholder: its history merges into the current user, then it's
  // deleted. Irreversible, so require a confirming second tap.
  async function claim(userId: number) {
    if (busy) return;
    if (confirmClaimId !== userId) {
      setConfirmClaimId(userId);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.claimPlaceholder(groupId, userId);
      setConfirmClaimId(null);
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(userId: number) {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await api.removeMember(groupId, userId);
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Manage Users" onBack={onBack}>
      {error && <p style={{ color: theme.destructive }}>{error}</p>}

      {(detail?.members ?? []).map((m) => (
        <Card key={m.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{m.firstName}</span>
                {m.isPlaceholder && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: 0.3,
                      color: theme.hint,
                      border: `1px solid ${theme.hint}`,
                      borderRadius: 6,
                      padding: '1px 5px',
                    }}
                  >
                    placeholder
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13, color: theme.hint }}>
                {m.isPlaceholder ? 'Not on Telegram yet' : `#${m.id}${m.username ? ` · @${m.username}` : ''}`}
              </div>
            </div>
            {m.isPlaceholder ? (
              <button
                onClick={() => claim(m.id)}
                disabled={busy}
                style={{ background: 'none', border: 'none', color: theme.link, cursor: 'pointer', fontSize: 15, flexShrink: 0 }}
              >
                {confirmClaimId === m.id ? 'Tap to confirm' : 'This is me'}
              </button>
            ) : (
              <button
                onClick={() => removeMember(m.id)}
                disabled={busy}
                style={{ background: 'none', border: 'none', color: theme.destructive, cursor: 'pointer', fontSize: 15, flexShrink: 0 }}
              >
                Remove
              </button>
            )}
          </div>
        </Card>
      ))}

      <SectionHeader>Add placeholder</SectionHeader>
      <p style={{ fontSize: 13, color: theme.hint, margin: '0 0 10px' }}>
        Track someone who isn't on Telegram yet. They can pay for and share expenses; later, they can open the app and
        tap “This is me” to take the placeholder over — inheriting all its history.
      </p>
      <Field label="Name">
        <input
          style={inputStyle}
          placeholder="e.g. Alex"
          value={placeholderName}
          onChange={(e) => setPlaceholderName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addPlaceholder()}
        />
      </Field>
      <Button variant="secondary" onClick={addPlaceholder} disabled={busy || !placeholderName.trim()}>
        Add placeholder
      </Button>

      <SectionHeader>Add member by id</SectionHeader>
      <Field label="Telegram user id + name">
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ ...inputStyle, width: 120 }}
            placeholder="user id"
            inputMode="numeric"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
          />
          <input style={inputStyle} placeholder="name" value={memberName} onChange={(e) => setMemberName(e.target.value)} />
        </div>
      </Field>
      <Button variant="secondary" onClick={addMember} disabled={busy || !Number(memberId)}>
        Add member
      </Button>

      <p style={{ fontSize: 13, color: theme.hint, marginTop: 12 }}>
        A member who already has expenses or settlements can't be removed (it would orphan balances).
      </p>
    </Screen>
  );
}
