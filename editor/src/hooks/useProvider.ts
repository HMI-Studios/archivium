import { HocuspocusProvider } from '@hocuspocus/provider';
import { useEffect, useState } from 'react';
import { fetchAsync } from '../helpers';

import md5 from 'md5';
import * as Y from 'yjs';
import { deepCompare } from '../../../src/lib/utils';
import type { User } from '../../../src/api/models/user';

export type DocUser = {
  clientId: number,
  name: string,
  color: string | null,
  pfp: string,
};

export type DocSelection = {
  selectedElement: string | null,
  tab: string | null,
};

export type DocSelectors = {
  mySelection: DocSelection,
  selectedElement: { [el: string]: DocUser },
  tab: { [tab: string]: DocUser[] },
}

type AwarenessState = { clientId: number, user: DocUser, selection: DocSelection };

const colors = [
  ...[
    '#3CB371',
    '#DC143C',
    '#C71585',
    '#FF7F50',
    '#4682B4',
    '#808000',
  ].sort(() => Math.random() - 0.5),
  ...[
    '#008000',
    '#F08080',
    '#FF6347',
    '#F0E68C',
    '#6A5ACD',
    '#9ACD32'
  ].sort(() => Math.random() - 0.5),
  ...[
    '#66CDAA',
    '#FFB6C1',
  ].sort(() => Math.random() - 0.5),
];

export function useProvider(url: string, name: string, ydoc: Y.Doc): [
  HocuspocusProvider | null,
  string | null,
  DocUser[],
  DocSelectors,
  (data: Partial<DocSelection>) => void,
] {
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<{ [id: number]: DocUser }>({});
  const [me, setMe] = useState<DocUser | null>(null);
  const [selection, setSelection] = useState<DocSelection>({ selectedElement: null, tab: null });
  const [selections, setSelections] = useState<{ [id: number]: DocSelection }>({});

  const [incomingState, setIncomingState] = useState<AwarenessState[]>([]);

  useEffect(() => {
    if (!provider) return;
    provider.setAwarenessField('user', me);
    setTimeout(() => provider.setAwarenessField('user', me), 250);
  }, [me]);

  useEffect(() => {
    if (!provider) return;
    provider.setAwarenessField('selection', selection);
  }, [selection]);

  useEffect(() => {
    if (me && provider) {
      if (incomingState.length <= 1) {
        // We're alone in the room, which means that either
        // 1. there are no other users, so we don't need to bother with this, or
        // 2. the provider hasn't synced yet, so we need to wait for that.
        setUsers({});
        setSelections({});
        return;
      }
      const newUsers: { [id: number]: DocUser } = {};
      const newSelections: { [id: number]: DocSelection } = {};
      const usedColors: { [color: string]: true } = {};
      for (const { clientId, user, selection } of incomingState) {
        // if (clientId === me.clientId || !user) continue;
        if (!user) continue;
        if (clientId === me.clientId) {
          if (!deepCompare(me, user)) {
            setTimeout(() => provider.setAwarenessField('user', me), 100);
          }
          continue;
        }
        if (user.color) usedColors[user.color] = true;
        newUsers[clientId] = user;
        if (!selection) continue;
        newSelections[clientId] = selection;
      }
      setUsers(newUsers);
      setSelections(newSelections);

      if (me.color === null) {
        const newMe = { ...me };
        let i = 0;
        while (colors[i] in usedColors && i < colors.length) {
          i++;
        }
        newMe.color = colors[i];
        setMe(newMe);
      }
    }
  }, [me?.clientId, provider, incomingState]);

  useEffect(() => {
    const provider = new HocuspocusProvider({
      url,
      name,
      document: ydoc,
      token: async () => {
        try {
          return await fetchAsync('/api/session-token')
        } catch {
          setError('Disconnected from server');
          provider.off('awarenessChange');
          provider.off('awarenessUpdate');
          provider.off('authenticationFailed');
          provider.destroy();
        }
      },
    });

    fetchAsync('/api/me').then(async (user: User) => {
      const me: DocUser = {
        clientId: provider.awareness!.clientID,
        name: user.username,
        color: null,
        pfp: user.hasPfp ? `/api/users/${user.username}/pfp` : `https://www.gravatar.com/avatar/${md5(user.email ?? '')}.jpg`,
      };
      setMe(me);
    });

    provider.on('synced', () => {
      const awareness = provider.awareness!.states;
      const mappedStates: AwarenessState[] = Array
        .from(awareness.keys())
        .map(k => ({ clientId: k, ...awareness.get(k) } as AwarenessState));
        setIncomingState(mappedStates);
    });

    provider.on('awarenessChange', ({ states }: { states: AwarenessState[] }) => {
      setIncomingState(states);
    });

    provider.on('awarenessUpdate', ({ states }: { states: AwarenessState[] }) => {
      setIncomingState(states);
    });

    provider.on('authenticationFailed', () => {
      if (error) return;
      setError('Access denied');
    });

    setProvider(provider);

    return () => {
      provider.off('awarenessChange');
      provider.off('awarenessUpdate');
      provider.off('authenticationFailed');
      provider.destroy();
    };
  }, []);

  const userList = me ? [
    ...Object.keys(users).map(k => users[Number(k)]),
    me,
  ] : [];

  const selectors: DocSelectors = {
    mySelection: selection,
    selectedElement: {},
    tab: {}
  };
  for (const id in selections) {
    const { selectedElement, tab } = selections[id];
    const user = users[id];
    if (selectedElement && user.color) {
      selectors.selectedElement[selectedElement] = user;
    }
    if (tab && user.color) {
      if (!selectors.tab[tab]) selectors.tab[tab] = [];
      selectors.tab[tab].push(user);
    }
  }

  const setAwareness = (data: Partial<DocSelection>): void => {
    setSelection({ ...selection, ...data });
  };

  return [provider, error, userList, selectors, setAwareness];
}
