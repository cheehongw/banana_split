import type { GroupDetail } from '@banana-split/shared';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { COMMON_CURRENCIES } from '../lib/money';
import { getThemeMode, setThemeMode, type ThemeMode } from '../lib/theme';
import { resetTutorial } from '../lib/tutorial';
import { Card, Screen, theme } from '../ui';

const THEME_MODES: ThemeMode[] = ['auto', 'light', 'dark'];
const AVATARS = ['🍈', '🏠', '✈️', '🍽️', '🎉', '🏔️', '🚗', '🏖️', '🎿', '🍻'];

export function GroupSettings({
  groupId,
  onBack,
  onOpenManageUsers,
}: {
  groupId: string;
  onBack: () => void;
  onOpenManageUsers: () => void;
}) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [mode, setMode] = useState<ThemeMode>(getThemeMode());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getGroup(groupId).then(setDetail).catch((e: unknown) => setError(String(e)));
  }, [groupId]);

  const group = detail?.group;

  async function patch(p: { currency?: string; avatar?: string | null; notificationsEnabled?: boolean }) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateGroup(groupId, p);
      setDetail((d) => (d ? { ...d, group: updated } : d));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function chooseTheme(m: ThemeMode) {
    setMode(m);
    setThemeMode(m);
  }

  async function exportCsv() {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await api.exportGroup(groupId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function replayTutorial() {
    resetTutorial();
    setNote('The tutorial will show next time you open the groups list.');
  }

  return (
    <Screen title="Group Settings" onBack={onBack}>
      <p style={{ color: theme.hint, marginTop: -8 }}>
        Manage settings for <strong>{group?.title ?? '…'}</strong>
      </p>
      {error && <p style={{ color: theme.destructive }}>{error}</p>}
      {note && <p style={{ color: theme.link }}>{note}</p>}

      <h2 style={sectionStyle}>Personal</h2>
      <Card>
        <div style={{ marginBottom: 6 }}>Theme</div>
        <div style={{ fontSize: 13, color: theme.hint, marginBottom: 8 }}>Override Telegram's light/dark.</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {THEME_MODES.map((m) => (
            <button key={m} onClick={() => chooseTheme(m)} style={segStyle(mode === m)}>
              {m}
            </button>
          ))}
        </div>
      </Card>
      <Card onClick={replayTutorial}>
        <Row label="Show tutorial again" hint="Replay the onboarding tips on the groups list." action="Show" />
      </Card>

      <h2 style={sectionStyle}>User management</h2>
      <Card onClick={onOpenManageUsers}>
        <Row label="Manage Users" hint="Add or remove group members." action="›" />
      </Card>

      <h2 style={sectionStyle}>Notifications</h2>
      <Card onClick={() => group && patch({ notificationsEnabled: !group.notificationsEnabled })}>
        <Row
          label="Notifications"
          hint="Bot posts activity to the linked chat."
          action={group?.notificationsEnabled ? '🔔 On' : '🔕 Off'}
        />
      </Card>

      <h2 style={sectionStyle}>Group management</h2>
      <Card onClick={busy ? undefined : exportCsv}>
        <Row label="Export to CSV" hint="Download all expenses and settlements." action={busy ? '…' : 'Export'} />
      </Card>
      <Card>
        <div style={{ marginBottom: 6 }}>Group currency</div>
        <select
          value={group?.currency ?? 'USD'}
          onChange={(e) => patch({ currency: e.target.value })}
          disabled={busy}
          style={selectStyle}
        >
          {COMMON_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 12, color: theme.hint, marginTop: 6 }}>Applies to new expenses; past ones keep their currency.</div>
      </Card>
      <Card>
        <div style={{ marginBottom: 8 }}>Group avatar</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {AVATARS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => patch({ avatar: group?.avatar === emoji ? null : emoji })}
              style={{
                fontSize: 22,
                width: 40,
                height: 40,
                borderRadius: 10,
                cursor: 'pointer',
                border: `2px solid ${group?.avatar === emoji ? theme.button : 'transparent'}`,
                background: theme.bg,
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </Card>
    </Screen>
  );
}

function Row({ label, hint, action }: { label: string; hint: string; action: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <div>{label}</div>
        <div style={{ fontSize: 13, color: theme.hint }}>{hint}</div>
      </div>
      <span style={{ color: theme.link, whiteSpace: 'nowrap' }}>{action}</span>
    </div>
  );
}

const sectionStyle = { fontSize: 15, color: theme.hint, marginTop: 24, marginBottom: 8 } as const;
const selectStyle = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 16,
  borderRadius: 10,
  border: `1px solid ${theme.hint}`,
  background: theme.bg,
  color: theme.text,
  boxSizing: 'border-box',
} as const;

function segStyle(active: boolean) {
  return {
    flex: 1,
    padding: '8px 0',
    borderRadius: 8,
    textTransform: 'capitalize',
    border: `1px solid ${active ? theme.button : theme.hint}`,
    background: active ? theme.button : 'transparent',
    color: active ? theme.buttonText : theme.text,
    cursor: 'pointer',
  } as const;
}
