import { useEffect, useRef, useState } from 'react';
import { hasAnalyticsChoice } from '@ba/contracts';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Button, Dialog, Notice } from '../../components/ui';

export function AnalyticsConsentDialog() {
  const { state, settings } = useApp();
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState(false);
  const busy = useRef(false);
  const requested = useRef<boolean | null>(null);
  const decline = useRef<HTMLButtonElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const revealFeedback = () =>
    feedback.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  useEffect(() => {
    if (settings.error) revealFeedback();
  }, [settings.error]);
  useEffect(() => {
    if (
      requested.current !== null &&
      settings.status === 'saved' &&
      hasAnalyticsChoice(state.config) &&
      state.config.analyticsEnabled === requested.current
    )
      setCompleted(true);
  }, [state.config, settings.status]);
  if (completed || (requested.current === null && hasAnalyticsChoice(state.config))) return null;

  const choose = async (enabled: boolean) => {
    if (busy.current) return;
    busy.current = true;
    requested.current = enabled;
    setSaving(true);
    try {
      settings.change({
        analyticsEnabled: enabled,
        analyticsChoiceSaved: true,
      });
      if (await settings.flush()) setCompleted(true);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      title={t('analyticsConsentTitle')}
      description={t('analyticsConsentSummary')}
      bodyLabel={t('analyticsConsentDetails')}
      className="consent-dialog"
      initialFocus={() => decline.current}
      onClose={() => {}}
      dismissible={false}
      footer={
        <div className="grid w-full gap-2">
          <div className="flex h-8 min-w-0 items-center justify-between gap-2">
            <span role="status" aria-label={t('analyticsConsentFeedback')} data-consent-feedback="">
              {t(
                saving
                  ? 'analyticsConsentSaving'
                  : settings.status === 'unconfirmed'
                    ? 'settingsSaveUnconfirmed'
                    : settings.error
                      ? 'analyticsConsentSaveFailed'
                      : 'analyticsConsentChoose',
              )}
            </span>
            <Button
              data-consent-details=""
              variant="ghost"
              size="sm"
              className={settings.error ? 'shrink-0' : 'invisible shrink-0'}
              aria-hidden={!settings.error}
              aria-disabled={saving || !settings.error}
              tabIndex={settings.error ? undefined : -1}
              onClick={() => {
                if (saving || !settings.error) return;
                revealFeedback();
                feedback.current
                  ?.closest<HTMLElement>('.dialog-body')
                  ?.focus({ preventScroll: true });
              }}
            >
              {t('analyticsConsentFeedbackDetails')}
            </Button>
          </div>
          <div className="flex w-full flex-wrap justify-end gap-2">
            <Button
              ref={decline}
              className="h-auto min-h-8 max-w-full whitespace-normal"
              aria-disabled={saving}
              aria-busy={saving}
              onClick={() => void choose(false)}
            >
              {t('analyticsConsentDecline')}
            </Button>
            <Button
              variant="default"
              className="h-auto min-h-8 max-w-full whitespace-normal"
              aria-disabled={saving}
              aria-busy={saving}
              onClick={() => void choose(true)}
            >
              {t('analyticsConsentAccept')}
            </Button>
          </div>
        </div>
      }
    >
      {settings.error && (
        <div ref={feedback}>
          <Notice error>
            <div className="grid min-w-0 gap-2 wrap-anywhere">
              {settings.status === 'unconfirmed' && <p>{t('analyticsConsentUnconfirmedHint')}</p>}
              <p>{settings.error}</p>
            </div>
          </Notice>
        </div>
      )}
      <p>{t('analyticsConsentPrompt')}</p>
      <p>{t('analyticsDescription')}</p>
      <p>{t('analyticsPrivacy')}</p>
      <p>{t('analyticsConsentChangeLater')}</p>
    </Dialog>
  );
}
