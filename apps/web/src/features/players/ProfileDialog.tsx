import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { BATRACE_ORIGIN } from '@ba/contracts';
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw as faArrowsRotate } from 'lucide-react';
import { Icon } from '../../components/Icon';
import type { PlayerProfile } from '@ba/contracts';
import { formatTime, formatMetric } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Dialog, Button, Loading, Notice, Badge } from '../../components/ui';
import { ReportCopyButton } from './Reports';
import { ProfileOverview } from './ProfileOverview';
import { ProfileRecords, ProfileRecordNavigation } from './ProfileRecords';
import { ProfileBody } from './ProfileBody';
import { Tabs } from '@/components/ui/tabs';
import { PlayerReportStatus } from './PlayerReportStatus';
import { RecoveryAction } from '../../components/RecoveryAction';

export function ProfileDialog({ id, name }: { id: string; name: string }) {
  const {
      api,
      state,
      modal,
      setProfileTab,
      closeModal,
      backModal,
      notify,
      runMaggot,
      reports,
      loadReport,
    } = useApp(),
    { t, locale } = useI18n(),
    profile = useRequest<{ key: string; value: PlayerProfile; loadedAt: number }>();
  const report = reports[id];
  const content = useRef<ProfileBody>(null);
  const navigationFrame = useRef<number | null>(null);
  const [localTab, setLocalTab] = useState('statistics');
  const selectedTab =
    modal?.type === 'profile' && modal.id === id ? (modal.tab ?? localTab) : localTab;
  const navigate = (value: string) => {
    setLocalTab(value);
    setProfileTab?.(value);
    if (navigationFrame.current !== null) cancelAnimationFrame(navigationFrame.current);
    navigationFrame.current = requestAnimationFrame(() => {
      const panel = content.current?.content.current?.querySelector<HTMLElement>(
        '[data-slot=tabs-content][data-state=active]',
      );
      panel?.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
      navigationFrame.current = null;
    });
  };
  useEffect(
    () => () => {
      if (navigationFrame.current !== null) cancelAnimationFrame(navigationFrame.current);
    },
    [],
  );
  const accountId = state.session.localPlayerId ?? null;
  const combined = state.config.multiAccountBond;
  const scopeKey = JSON.stringify([id, accountId, combined, state.accountContextRevision]);
  const owner = useRef('');
  const loadProfile = (force = false) => {
    owner.current = scopeKey;
    return profile.load(
      async () => ({
        key: scopeKey,
        value: await api.invoke('players.profile', { id, force, accountId, combined }),
        loadedAt: Date.now(),
      }),
      true,
    );
  };
  const load = async (force = false) => {
    await Promise.all([loadProfile(force), loadReport(id, force)]);
    if (force) await runMaggot(id, true);
  };
  useEffect(() => {
    void loadReport(id);
  }, [id, loadReport]);
  useEffect(() => {
    void loadProfile();
  }, [id, api, scopeKey, state.matchesRevision]);
  const p = profile.data?.key === scopeKey ? profile.data.value : null,
    r = report?.data ?? null,
    info = r ?? p?.info,
    aliases = p?.names.filter((entry) => entry.name !== p.name) || [];
  const fullName = p?.name || r?.name || name;
  return (
    <Tabs value={selectedTab} onValueChange={navigate} className="profile-tabs-owner">
      <Dialog
        open
        onClose={closeModal}
        onBack={backModal}
        title={`${fullName} · #${id}`}
        description={t('profileIdentityHint')}
        bodyLabel={t('profileReadingLabel')}
        className="dialog-wide profile-dialog"
        ready={
          !!(p || (owner.current === scopeKey && profile.error)) &&
          !!(r || report?.error) &&
          !profile.pending &&
          !report?.pending
        }
        headerActions={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('openBatrace')}
              onClick={() =>
                void api
                  .invoke('external.open', { url: `${BATRACE_ORIGIN}/player/${id}` })
                  .catch((error) => notify(String(error), true))
              }
            >
              <ExternalLink aria-hidden="true" />
            </Button>
            <ReportCopyButton report={r} iconOnly />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('refresh')}
              onClick={() => {
                if (!profile.pending && !report?.pending) void load(true);
              }}
              aria-disabled={profile.pending || report?.pending}
              aria-busy={profile.pending || report?.pending}
            >
              <Icon
                icon={faArrowsRotate}
                spin={profile.pending || report?.pending}
                aria-hidden="true"
              />
            </Button>
          </>
        }
        banner={
          <div className="profile-navigation">
            <ProfileRecordNavigation
              profile={p}
              matchReport={report?.details.matches}
              mapReport={report?.details.maps}
              onNavigate={navigate}
            />
          </div>
        }
      >
        <ProfileBody ref={content}>
          <section
            className="profile-identity"
            role="region"
            tabIndex={0}
            aria-label={t('profileIdentity')}
          >
            <strong data-profile-full-name="">{fullName}</strong>
            <code>#{id}</code>
            {name !== fullName && (
              <p>
                {t('profileOpenedName')} <span data-profile-opened-name="">{name}</span>
              </p>
            )}
          </section>
          <div className="profile-toolbar">
            <div className="profile-heading">
              <div className="profile-heading-title">
                <h2>{t('profileOverview')}</h2>
                {p?.banned && <Badge tone="danger">{t('banned')}</Badge>}
              </div>
              <dl className="profile-meta">
                <div>
                  <dt>{t('totalMatches')}</dt>
                  <dd>{formatMetric(info?.matchCount ?? null, 0)}</dd>
                </div>
                <div>
                  <dt>{t('samples')}</dt>
                  <dd>{formatMetric(info?.sampleCount ?? null, 0)}</dd>
                </div>
              </dl>
            </div>
          </div>
          <div className="profile-recovery-slot">
            <RecoveryAction
              key={`profile-recovery:${scopeKey}`}
              available={owner.current === scopeKey && !!profile.error}
              pending={profile.pending}
              retryLabel={t('retry')}
              refreshLabel={t('refreshEncounters')}
              pendingLabel={t('encountersLoading')}
              onRetry={() => void loadProfile(true)}
            />
          </div>
          <PlayerReportStatus
            key={id}
            actionFirst
            request={report}
            onRetry={() => void loadReport(id, true)}
          />
          {owner.current === scopeKey && profile.error && (
            <Notice error>
              <div className="min-w-0 flex-1 wrap-anywhere">
                <p>{t('encounterRequestFailed')}</p>
                <p>{profile.error}</p>
                {p && (
                  <p>
                    {t('encounterPreviousResult', {
                      time: formatTime(profile.data?.loadedAt ?? null, locale),
                    })}
                  </p>
                )}
              </div>
            </Notice>
          )}
          {profile.pending && !p && <Loading />}
          {info?.stale && !r && (
            <Notice>
              {t('stale')} · {formatTime(info.updatedAt, locale)}
            </Notice>
          )}
          <ProfileOverview id={id} profile={p} report={r} />
          {p?.unverifiedObservation && <Notice>{t('unverifiedEncounterHint')}</Notice>}
          {
            <ProfileRecords
              key={`records:${id}`}
              externalNavigation
              recoveryKey={scopeKey}
              profile={p}
              report={r}
              matchReport={report?.details.matches}
              mapReport={report?.details.maps}
              reportPending={!report || report.pending}
              reportError={report?.error}
              encounterError={owner.current === scopeKey ? profile.error : null}
              onRetryReport={() => void loadReport(id, true)}
              onRetryProfile={() => void loadProfile(true)}
              tab={selectedTab}
              encounterPending={!p && !(owner.current === scopeKey && profile.error)}
              scopeLabel={
                combined
                  ? t('combinedEncounterScope')
                  : accountId
                    ? t('accountScope', {
                        name:
                          p?.encounterScope?.accountName || state.session.localName || accountId,
                        id: accountId,
                      })
                    : t('accountIdentityNeeded')
              }
            />
          }
          {p && (
            <>
              {aliases.length > 0 && (
                <Accordion type="single" collapsible className="profile-name-history">
                  <AccordionItem value="details">
                    <AccordionTrigger>
                      {t('names')} <Badge>{aliases.length}</Badge>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="name-history">
                        {aliases.map((n) => (
                          <span className="profile-alias" key={n.name}>
                            <strong>{n.name}</strong>
                            <small>{formatTime(n.lastSeen, locale)}</small>
                          </span>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
            </>
          )}
        </ProfileBody>
      </Dialog>
    </Tabs>
  );
}
