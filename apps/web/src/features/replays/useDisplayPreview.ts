import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bridge, DisplayPreview, DisplayChoice } from '@ba/contracts';
import { errorMessage } from '@ba/shared';

export function useDisplayPreview(api: Bridge, id: string) {
  const [request, setRequest] = useState<{
    target: string;
    data: DisplayPreview | null;
    pending: boolean;
    error: string | null;
    choices: DisplayChoice[];
  }>({ target: id, data: null, pending: true, error: null, choices: [] });
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    let active = true,
      inFlight = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      clearTimeout(timer);
      setRequest((previous) => ({
        target: id,
        data: previous.target === id ? previous.data : null,
        pending: true,
        error: previous.target === id ? previous.error : null,
        choices: previous.choices,
      }));
      try {
        const data = await api.invoke('displays.preview', { id });
        if (data.requestedId !== id) throw new Error('DISPLAY_PREVIEW_TARGET_CHANGED');
        if (active)
          setRequest({ target: id, data, pending: false, error: null, choices: data.displays });
      } catch (error) {
        if (active)
          setRequest((previous) => ({
            target: id,
            data: previous.target === id ? previous.data : null,
            pending: false,
            error: errorMessage(error),
            choices: previous.choices,
          }));
      } finally {
        inFlight = false;
        if (active) timer = setTimeout(() => void refresh(), 2000);
      }
    };
    refreshRef.current = refresh;
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
      if (refreshRef.current === refresh) refreshRef.current = null;
    };
  }, [api, id]);
  const refresh = useCallback(() => void refreshRef.current?.(), []);
  return {
    ...(request.target === id
      ? request
      : { target: id, data: null, pending: true, error: null, choices: request.choices }),
    refresh,
  };
}
