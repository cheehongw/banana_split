import type { GroupDetail } from '@banana-split/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Button, Card, Field, inputStyle, Screen, theme } from '../ui';

export function ManageUsers({ groupId, onBack }: { groupId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [memberId, setMemberId] = useState('');
  const [memberName, setMemberName] = useState('');

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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div>{m.firstName}</div>
              <div style={{ fontSize: 13, color: theme.hint }}>#{m.id}{m.username ? ` · @${m.username}` : ''}</div>
            </div>
            <button
              onClick={() => removeMember(m.id)}
              disabled={busy}
              style={{ background: 'none', border: 'none', color: theme.destructive, cursor: 'pointer', fontSize: 15 }}
            >
              Remove
            </button>
          </div>
        </Card>
      ))}

      <h2 style={{ fontSize: 15, color: theme.hint, marginTop: 24 }}>Add member</h2>
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
