import { useRef, useState } from 'react';
import { hasTelemetryConsent, TELEMETRY_CONSENT_VERSION } from '@ba/contracts';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Button, Dialog, Notice } from '../../components/ui';

export function TelemetryConsentDialog() {
  const { state, settings } = useApp();
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  if (hasTelemetryConsent(state.config)) return null;

  const choose = async (enabled: boolean) => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      settings.change({
        telemetryEnabled: enabled,
        telemetryConsentConfirmed: true,
        telemetryConsentVersion: TELEMETRY_CONSENT_VERSION,
      });
      await settings.flush();
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  return (
    <Dialog open title={t('telemetryConsentTitle')} onClose={() => {}} dismissible={false}>
      <p>{t('telemetryConsentPrompt')}</p>
      <p>{t('telemetryDescription')}</p>
      <p>{t('telemetryPrivacy')}</p>
      <p>{t('telemetryConsentChangeLater')}</p>
      {settings.error && <Notice error>{settings.error}</Notice>}
      {saving && <p role="status">{t('settingsSaving')}</p>}
      <div className="dialog-footer">
        <Button disabled={saving} onClick={() => void choose(false)}>
          {t('telemetryConsentDecline')}
        </Button>
        <Button variant="default" disabled={saving} onClick={() => void choose(true)}>
          {t('telemetryConsentAccept')}
        </Button>
      </div>
    </Dialog>
  );
}
