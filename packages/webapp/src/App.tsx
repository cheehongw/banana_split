import type { Group } from '@banana-split/shared';
import { useEffect, useState } from 'react';
import { api } from './lib/api';

export function App() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listGroups()
      .then(setGroups)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1>🍌 Banana Split</h1>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {loading && <p>Loading…</p>}

      {!loading && (
        <section>
          <h2>Your groups</h2>
          {groups.length === 0 ? (
            <p>No groups yet.</p>
          ) : (
            <ul>
              {groups.map((g) => (
                <li key={g.id}>
                  {g.title} <small>({g.currency})</small>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/*
        TODO (UI, build deliberately):
        - "Create group" form
        - Group detail: expenses list + activity feed
        - Add-expense form (payer, amount, split type: equal / shares / exact)
        - Balances view + "Settle up" using /settlements/balances suggestions
        - Wire Telegram MainButton for primary actions; use themeParams for styling
      */}
    </main>
  );
}
