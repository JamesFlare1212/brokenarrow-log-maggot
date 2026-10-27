import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { BATRACE_ORIGIN } from '@ba/contracts';
import { useEffect } from 'react';
import { ExternalLink, RefreshCw as faArrowsRotate } from 'lucide-react';
import { Icon } from '../../components/Icon';
import type { PlayerProfile, PlayerReport } from '@ba/contracts';
import { formatTime, formatMetric } from '@ba/shared';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { useRequest } from '../../hooks/useRequest';
import { Dialog, Button, Loading, Notice, Badge } from '../../components/ui';
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
  return (
    <Dialog
      open
      onClose={closeModal}
      onBack={backModal}
      title={`${p?.name || r?.name || name} · #${id}`}
      className="dialog-wide profile-dialog"
    >
      <div className="profile-toolbar">
        <div className="profile-heading">
          <div className="profile-heading-title">
            <h2>{t('profileOverview')}</h2>
            {p?.banned && <Badge tone="danger">{t('banned')}</Badge>}
          </div>
          {info && (
            <dl className="profile-meta">
              <div>
                <dt>{t('totalMatches')}</dt>
                <dd>{formatMetric(info.matchCount, 0)}</dd>
              </div>
              <div>
                <dt>{t('samples')}</dt>
                <dd>{formatMetric(info.sampleCount ?? null, 0)}</dd>
              </div>
            </dl>
          )}
        </div>
        <div className="actions">
          <Button
            onClick={() => void load(true)}
            disabled={profile.pending || report.pending}
            aria-busy={profile.pending || report.pending}
          >
            <Icon
              icon={faArrowsRotate}
              size={16}
              spin={profile.pending || report.pending}
              aria-hidden="true"
            />
            {t('refresh')}
          </Button>
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
          {r && <ReportCopyButton report={r} />}
        </div>
      </div>
      {((profile.pending && !p) || (report.pending && !r)) && <Loading />}
      {profile.error && <Notice error>{profile.error}</Notice>}
      {report.error && <Notice error>{report.error}</Notice>}
      {info?.stale && (
        <Notice>
          {t('stale')} · {formatTime(info.updatedAt, locale)}
        </Notice>
      )}
      <ProfileOverview id={id} profile={p} report={r} />
      {(r || p) && <ProfileRecords key={id} profile={p} report={r} />}
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
    </Dialog>
  );
}
