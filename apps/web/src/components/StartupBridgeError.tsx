import { useEffect, useRef } from 'react';
import type { Locale } from '@ba/contracts';
import { TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { translate } from '../hooks/useI18n';

export function StartupBridgeError({ locale }: { locale: Locale }) {
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    main.current?.focus();
  }, []);
  return (
    <main
      className="startup-error"
      lang={locale === 'zh' ? 'zh-CN' : 'en'}
      tabIndex={-1}
      aria-labelledby="startup-bridge-title"
      aria-describedby="startup-bridge-hint"
      ref={main}
    >
      <Alert className="max-w-lg">
        <TriangleAlert aria-hidden="true" />
        <AlertTitle id="startup-bridge-title" role="heading" aria-level={1}>
          {translate(locale, 'desktopBridgeUnavailableTitle')}
        </AlertTitle>
        <AlertDescription id="startup-bridge-hint">
          {translate(locale, 'desktopBridgeUnavailableHint')}
        </AlertDescription>
      </Alert>
    </main>
  );
}
