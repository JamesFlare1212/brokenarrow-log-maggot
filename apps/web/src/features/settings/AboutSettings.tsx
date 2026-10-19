import { faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '../../components/Icon';
import { BATRACE_ORIGIN } from '@ba/contracts';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Button, Notice } from '../../components/ui';
import { UpdatePanel } from './UpdatePanel';

export function AboutSettings() {
  const { api, state, notify } = useApp(),
    { t } = useI18n();
  return (
    <section className="settings-section" aria-labelledby="settings-about-title">
      <h3 id="settings-about-title">{t('about')}</h3>
      <div className="settings-card settings-about">
        <UpdatePanel />
        <div className="settings-about-row">
          <div className="settings-about-copy">
            <strong>{t('projectLinks')}</strong>
            <p>{t('brand')}</p>
          </div>
          <div className="settings-about-links">
            {[
              ['GitHub', 'https://github.com/JamesFlare1212/brokenarrow-log-maggot'],
              ['BATrace', BATRACE_ORIGIN + '/'],
            ].map(([label, url]) => (
              <Button
                key={label}
                onClick={() =>
                  void api
                    .invoke('external.open', { url: url! })
                    .catch((error) => notify(String(error), true))
                }
              >
                {label}
                <Icon icon={faArrowUpRightFromSquare} size={14} />
              </Button>
            ))}
          </div>
        </div>
      </div>
      {state.migration.warnings.length > 0 && (
        <Notice error>
          <strong>{t('migrationWarnings')}</strong>
          <ul>
            {state.migration.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Notice>
      )}
    </section>
  );
}
