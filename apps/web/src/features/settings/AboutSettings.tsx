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
    <Card
      className="settings-about-card @container/about-settings gap-3"
      role="region"
      aria-labelledby="settings-about-title"
    >
      <CardHeader>
        <CardTitle id="settings-about-title">{t('about')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <UpdatePanel />
        <Separator />
        <div className="settings-about-row flex min-w-0 flex-col gap-3 @min-[32rem]/about-settings:flex-row @min-[32rem]/about-settings:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <BrandLogo size={32} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <strong>{t('brand')}</strong>
              <span className="text-xs text-muted-foreground">{t('projectLinks')}</span>
            </div>
          </div>
          <div className="settings-about-links grid grid-cols-2 gap-2 @min-[32rem]/about-settings:flex @min-[32rem]/about-settings:shrink-0">
            {[
              ['GitHub', 'https://github.com/JamesFlare1212/brokenarrow-log-maggot'],
              ['BATrace', BATRACE_ORIGIN + '/'],
            ].map(([label, url]) => (
              <Button
                className="w-full @min-[32rem]/about-settings:w-auto"
                key={label}
                onClick={() =>
                  void api
                    .invoke('external.open', { url: url! })
                    .catch((error) => notify(String(error), true))
                }
              >
                {label}
                <Icon icon={faArrowUpRightFromSquare} data-icon="inline-end" aria-hidden="true" />
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
