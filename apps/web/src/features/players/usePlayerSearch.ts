import { useRef, useState } from 'react';
import type { Bridge, RpcOutputs } from '@ba/contracts';
import { useRequest } from '../../hooks/useRequest';

export function usePlayerSearch(api: Bridge) {
  const results = useRequest<{ query: string; value: RpcOutputs['players.search'] }>();
  const [query, setQuery] = useState('');
  const [attemptedQuery, setAttemptedQuery] = useState('');
  const active = useRef<{ query: string; id: number } | null>(null);
  const generation = useRef(0);
  const search = async (value = query) => {
    const trimmed = value.trim();
    if (!trimmed || active.current?.query === trimmed) return;
    const id = ++generation.current;
    active.current = { query: trimmed, id };
    setAttemptedQuery(trimmed);
    await results.load(
      async () => ({
        query: trimmed,
        value: await api.invoke('players.search', { query: trimmed }),
      }),
      true,
    );
    if (id !== generation.current) return;
    active.current = null;
  };
  const clear = () => {
    generation.current++;
    active.current = null;
    setQuery('');
    setAttemptedQuery('');
    results.invalidate();
  };
  return {
    ...results,
    query,
    setQuery,
    data: results.data?.value ?? null,
    completedQuery: results.data?.query ?? '',
    attemptedQuery,
    search,
    clear,
    submitDisabled: !query.trim() || (results.pending && query.trim() === attemptedQuery),
  };
}
