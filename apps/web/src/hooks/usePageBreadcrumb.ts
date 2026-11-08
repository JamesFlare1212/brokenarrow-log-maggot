import { useLayoutEffect } from 'react';
import type { Panel } from '@ba/contracts';
import { useApp } from '../app/state';

export function usePageBreadcrumb(panel: Panel, label: string | null, onBack: () => void) {
  const { setBreadcrumb } = useApp();
  useLayoutEffect(() => {
    setBreadcrumb(panel, label ? { label, onBack } : null);
    return () => setBreadcrumb(panel, null);
  }, [panel, label, onBack, setBreadcrumb]);
}
