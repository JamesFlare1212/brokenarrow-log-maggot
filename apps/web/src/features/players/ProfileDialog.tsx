import { Card, CardContent } from '@/components/ui/card';
import { tableHeadClasses } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@/components/ui/item';
import { BATRACE_ORIGIN } from '@ba/contracts';
import { Skeleton } from '@/components/ui/skeleton';
import { Fragment, useEffect } from 'react';
import { ExternalLink, RefreshCw as faArrowsRotate } from 'lucide-react';
import { Icon } from '../../components/Icon';
import type { PlayerProfile, PlayerReport } from '@ba/contracts';
import { formatTime, formatMetric } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Dialog, Button, Notice, Badge } from '../../components/ui';
import { ReportCopyButton } from './Reports';
import { ProfileOverview } from './ProfileOverview';
import { ProfileRecords } from './ProfileRecords';

export function ProfileDialog({ id, name }: { id: string; name: string }) {
  const { api, closeModal, backModal, notify, runMaggot } = useApp(),
    { t, locale } = useI18n(),
    profile = useRequest<PlayerProfile>(),
    report = useRequest<PlayerReport>();
  const load = async (force = false) => {
    await Promise.all([
      profile.load(() => api.invoke('players.profile', { id, force }), true),
      report.load(() => api.invoke('players.report', { id, force }), true),
    ]);
    if (force) await runMaggot(id, true);
  };
  useEffect(() => {
    void load();
  }, [id, api]);
  const p = profile.data?.id === id ? profile.data : null,
    r = report.data?.id === id ? report.data : null,
    info = r ?? p?.info,
    aliases = p?.names.filter((entry) => entry.name !== p.name) || [];
  const profilePending = !p && (profile.pending || !profile.error);
  const reportPending = !r && (report.pending || !report.error);
  const metaPending = !info && (profilePending || reportPending);
  return (
    <Dialog
      open
      onClose={closeModal}
      onBack={backModal}
      title={`${p?.name || r?.name || name} · #${id}`}
      className="dialog-wide profile-dialog w-[calc(100%_-_3rem)] max-w-288 sm:max-w-288 h-[min(52rem,_calc(100svh_-_var(--window-controls-height)_-_3rem))] viewport-max-767:w-[calc(100%_-_1.5rem)]"
      headerActions={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('refresh')}
          onClick={() => void load(true)}
          disabled={profile.pending || report.pending}
          aria-busy={profile.pending || report.pending}
        >
          <Icon icon={faArrowsRotate} spin={profile.pending || report.pending} aria-hidden="true" />
        </Button>
      }
    >
      <div className="profile-toolbar flex items-center flex-wrap justify-between gap-4">
        <div className="profile-heading flex min-w-0 flex-col gap-1.5">
          <div className="profile-heading-title flex flex-wrap items-baseline gap-2 [&_h2]:text-[1.125rem] [&_h2]:font-semibold [&_h2]:tracking-[-0.025em]">
            <h2>{t('profileOverview')}</h2>
            {p?.banned && <Badge tone="danger">{t('banned')}</Badge>}
          </div>
          <dl
            className="profile-meta flex flex-wrap items-baseline gap-4 text-[0.75rem] [&>div]:flex [&>div]:flex-wrap [&>div]:items-center [&>div]:gap-2 [&_dt]:text-muted-foreground [&_dd]:flex [&_dd]:min-w-6 [&_dd]:min-h-4.5 [&_dd]:items-center [&_dd]:font-medium [&_dd]:tabular-nums"
            aria-busy={metaPending}
          >
            {[
              { label: t('totalMatches'), value: info?.matchCount },
              { label: t('samples'), value: info?.sampleCount },
            ].map(({ label, value }) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {metaPending ? (
                    <Skeleton className="h-4 w-6" aria-hidden="true" />
                  ) : (
                    formatMetric(value ?? null, 0)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="actions flex items-center gap-2 flex-wrap [.add-match-form_&]:justify-end [.dialog-body>&:last-child]:justify-end viewport-max-767:[.profile-toolbar>&]:gap-1.5">
          <Button
            onClick={() =>
              void api
                .invoke('external.open', { url: `${BATRACE_ORIGIN}/player/${id}` })
                .catch((error) => notify(String(error), true))
            }
          >
            <ExternalLink data-icon="inline-start" aria-hidden="true" />
            {t('openBatrace')}
          </Button>
          <ReportCopyButton report={r} />
        </div>
      </div>
      <span className="sr-only" role="status">
        {(profilePending || reportPending) && t('loading')}
      </span>
      {profile.error && <Notice error>{profile.error}</Notice>}
      {report.error && <Notice error>{report.error}</Notice>}
      {info?.stale && (
        <Notice>
          {t('stale')} · {formatTime(info.updatedAt, locale)}
        </Notice>
      )}
      <ProfileOverview
        id={id}
        profile={p}
        report={r}
        profilePending={profilePending}
        reportPending={reportPending}
      />
      <ProfileRecords
        key={id}
        profile={p}
        report={r}
        profilePending={profilePending}
        reportPending={reportPending}
      />
      {aliases.length > 0 && (
        <Card
          size="sm"
          className="profile-name-history min-w-0 gap-0 py-0 @container/aliases"
          role="region"
          aria-label={t('names')}
        >
          <CardContent className="px-0">
            <ItemGroup
              className="name-history max-h-64 min-w-0 gap-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] has-data-[size=xs]:gap-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:-outline-offset-2"
              aria-label={t('names')}
              tabIndex={0}
            >
              <div
                aria-hidden="true"
                className={cn(
                  tableHeadClasses,
                  'hidden shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-6 py-2.5 text-xs @sm/aliases:grid @[60rem]/aliases:px-3',
                )}
              >
                <span>{t('nameHistoryAlias')}</span>
                <span>{t('nameHistoryLastUsed')}</span>
              </div>
              <ItemSeparator className="my-0 hidden @sm/aliases:block" />
              {aliases.map((entry, index) => (
                <Fragment key={entry.name}>
                  <Item
                    size="xs"
                    role="listitem"
                    className="profile-alias grid min-h-10 min-w-0 shrink-0 grid-cols-[minmax(0,1fr)] items-start gap-x-6 gap-y-1 px-2 @sm/aliases:grid-cols-[minmax(0,1fr)_auto] @sm/aliases:items-center @[60rem]/aliases:px-3"
                  >
                    <ItemContent className="min-w-0">
                      <ItemTitle className="block w-full line-clamp-none wrap-anywhere">
                        {entry.name}
                      </ItemTitle>
                    </ItemContent>
                    <ItemContent className="min-w-0 flex-none">
                      <ItemDescription className="line-clamp-none tabular-nums @sm/aliases:text-right">
                        <span className="sr-only">{t('nameHistoryLastUsed')}: </span>
                        <time
                          dateTime={
                            entry.lastSeen > 0 ? new Date(entry.lastSeen).toISOString() : undefined
                          }
                        >
                          {formatTime(entry.lastSeen, locale)}
                        </time>
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                  {index < aliases.length - 1 && <ItemSeparator className="my-0" />}
                </Fragment>
              ))}
            </ItemGroup>
          </CardContent>
        </Card>
      )}
    </Dialog>
  );
}
