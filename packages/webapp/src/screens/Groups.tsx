import type { Group } from '@banana-split/shared';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { markTutorialSeen, tutorialSeen } from '../lib/tutorial';
import { useMainButton } from '../lib/useMainButton';
import { Button, Card, Field, inputStyle, Screen, theme } from '../ui';

export function Groups({ onOpen }: { onOpen: (groupId: string) => void }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [showTutorial, setShowTutorial] = useState(!tutorialSeen());

  function dismissTutorial() {
    markTutorialSeen();
    setShowTutorial(false);
  }

  function load() {
    setLoading(true);
    api
      .listGroups()
      .then(setGroups)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function create() {
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const group = await api.createGroup(title.trim());
      setTitle('');
      setGroups((gs) => [...gs, group]);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  // Native MainButton for "Create group"; in-page Create button is the fallback.
  const hasMainButton = useMainButton({
    text: creating ? 'Creating…' : 'Create group',
    visible: true,
    enabled: !creating && !!title.trim(),
    progress: creating,
    onClick: create,
  });

  return (
    <Screen title="🍌 Banana Split">
      {error && <p style={{ color: theme.destructive }}>{error}</p>}

      {showTutorial && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong>Welcome to Banana Split 🍌</strong>
            <button onClick={dismissTutorial} style={{ background: 'none', border: 'none', color: theme.link, cursor: 'pointer' }}>
              Dismiss
            </button>
          </div>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 14, color: theme.hint, lineHeight: 1.6 }}>
            <li>Create a group for a trip or a household.</li>
            <li>Add expenses and split them equally, by shares, or exact amounts.</li>
            <li>Open a group to see who owes whom and settle up.</li>
            <li>Add the bot to a Telegram group chat to get notifications.</li>
          </ul>
        </Card>
      )}

      <Field label="New group">
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={inputStyle}
            placeholder="e.g. Trip to Lisbon"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          {!hasMainButton && (
            <div style={{ width: 100, flexShrink: 0 }}>
              <Button onClick={create} disabled={creating || !title.trim()}>
                Create
              </Button>
            </div>
          )}
        </div>
      </Field>

      <h2 style={{ fontSize: 15, color: theme.hint, marginTop: 20 }}>Your groups</h2>
      {loading ? (
        <p>Loading…</p>
      ) : groups.length === 0 ? (
        <p style={{ color: theme.hint }}>No groups yet — create one above.</p>
      ) : (
        groups.map((g) => (
          <Card key={g.id} onClick={() => onOpen(g.id)}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{g.title}</strong>
              <span style={{ color: theme.hint }}>{g.currency} ›</span>
            </div>
          </Card>
        ))
      )}
    </Screen>
  );
}
