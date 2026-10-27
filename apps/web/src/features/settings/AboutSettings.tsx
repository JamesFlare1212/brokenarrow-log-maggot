import { ExternalLink as faArrowUpRightFromSquare } from 'lucide-react';
import { Icon } from '../../components/Icon';
import { BrandLogo } from '../../components/BrandLogo';
import { BATRACE_ORIGIN } from '@ba/contracts';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Button, Notice } from '../../components/ui';
import { UpdatePanel } from './UpdatePanel';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

export function AboutSettings() {
  const { api, state, notify } = useApp(),
    { t } = useI18n();
  return (
    <Card role="region" aria-labelledby="settings-about-title">
      <CardHeader>
        <CardTitle id="settings-about-title">{t('about')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <UpdatePanel />
        <Separator />
        <div className="settings-about-row">
          <div className="settings-about-copy">
            <div className="settings-about-title">
              <BrandLogo size={32} />
              <strong>{t('projectLinks')}</strong>
            </div>
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
      </CardContent>
    </Card>
  );
}
