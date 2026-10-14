import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@ba/shared';
export function useRequest<T>() {
  const generation = useRef(0);
  const [data, setData] = useState<T | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const load = useCallback(async (run: () => Promise<T>, keepData = false) => {
    const id = ++generation.current;
    setPending(true);
    setError(null);
    if (!keepData) setData(null);
    try {
      const result = await run();
      if (id === generation.current) setData(result);
      return id === generation.current ? result : null;
    } catch (e) {
      if (id === generation.current) setError(errorMessage(e));
      return null;
    } finally {
      if (id === generation.current) setPending(false);
    }
  }, []);
  const invalidate = useCallback(() => {
    generation.current++;
    setPending(false);
    setData(null);
    setError(null);
  }, []);
  return { data, pending, error, load, invalidate, setData };
}
