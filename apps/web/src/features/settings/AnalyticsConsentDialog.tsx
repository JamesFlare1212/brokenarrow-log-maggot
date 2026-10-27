import { useRef, useState } from 'react';
import { hasAnalyticsChoice } from '@ba/contracts';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Button, Dialog, Notice } from '../../components/ui';

export function AnalyticsConsentDialog() {
  const { state, settings } = useApp();
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  if (hasAnalyticsChoice(state.config)) return null;

  const choose = async (enabled: boolean) => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      settings.change({
        analyticsEnabled: enabled,
        analyticsChoiceSaved: true,
      });
      await settings.flush();
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  return (
    <Dialog open title={t('analyticsConsentTitle')} onClose={() => {}} dismissible={false}>
      <p>{t('analyticsConsentPrompt')}</p>
      <p>{t('analyticsDescription')}</p>
      <p>{t('analyticsPrivacy')}</p>
      <p>{t('analyticsConsentChangeLater')}</p>
      {settings.error && <Notice error>{settings.error}</Notice>}
      {saving && <p role="status">{t('settingsSaving')}</p>}
      <div className="dialog-footer">
        <Button disabled={saving} onClick={() => void choose(false)}>
          {t('analyticsConsentDecline')}
        </Button>
        <Button variant="default" disabled={saving} onClick={() => void choose(true)}>
          {t('analyticsConsentAccept')}
        </Button>
      </div>
    </Dialog>
  );
}
