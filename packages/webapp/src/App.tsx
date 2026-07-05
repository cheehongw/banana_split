import type { GroupDetail } from '@banana-split/shared';
import { useEffect, useState } from 'react';
import { api, startParam } from './lib/api';
import { AddExpense } from './screens/AddExpense';
import { GroupDetailScreen } from './screens/GroupDetail';
import { Groups } from './screens/Groups';
import { GroupSettings } from './screens/GroupSettings';
import { ManageUsers } from './screens/ManageUsers';
import { Stats } from './screens/Stats';

type View =
  | { name: 'groups' }
  | { name: 'group'; groupId: string }
  | { name: 'addExpense'; detail: GroupDetail }
  | { name: 'stats'; groupId: string }
  | { name: 'settings'; groupId: string }
  | { name: 'manageUsers'; groupId: string };

export function App() {
  const [view, setView] = useState<View>({ name: 'groups' });

  // Opened via the bot's deep link (t.me/<bot>?startapp=<groupId>): join that
  // group as the current user, then jump straight into it.
  useEffect(() => {
    const groupId = startParam();
    if (!groupId) return;
    api
      .joinGroup(groupId)
      .then(() => setView({ name: 'group', groupId }))
      .catch(() => {
        /* group gone or not joinable — fall back to the groups list */
      });
  }, []);

  switch (view.name) {
    case 'group':
      return (
        <GroupDetailScreen
          groupId={view.groupId}
          onBack={() => setView({ name: 'groups' })}
          onAddExpense={(detail) => setView({ name: 'addExpense', detail })}
          onOpenStats={() => setView({ name: 'stats', groupId: view.groupId })}
          onOpenSettings={() => setView({ name: 'settings', groupId: view.groupId })}
          onOpenManageUsers={() => setView({ name: 'manageUsers', groupId: view.groupId })}
        />
      );
    case 'addExpense':
      return (
        <AddExpense
          detail={view.detail}
          onBack={() => setView({ name: 'group', groupId: view.detail.group.id })}
          onDone={() => setView({ name: 'group', groupId: view.detail.group.id })}
        />
      );
    case 'stats':
      return <Stats groupId={view.groupId} onBack={() => setView({ name: 'group', groupId: view.groupId })} />;
    case 'settings':
      return (
        <GroupSettings
          groupId={view.groupId}
          onBack={() => setView({ name: 'group', groupId: view.groupId })}
          onOpenManageUsers={() => setView({ name: 'manageUsers', groupId: view.groupId })}
        />
      );
    case 'manageUsers':
      return <ManageUsers groupId={view.groupId} onBack={() => setView({ name: 'group', groupId: view.groupId })} />;
    case 'groups':
    default:
      return <Groups onOpen={(groupId) => setView({ name: 'group', groupId })} />;
  }
}
