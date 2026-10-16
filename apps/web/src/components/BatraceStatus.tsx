import { useEffect, useId, useRef, useState } from 'react';
import type { ApiHealth } from '@ba/contracts';
import { useI18n } from '../hooks/useI18n';

const endpoints: Record<string, string> = {
  '/api/players/search': 'healthPlayerSearch',
  '/api/players/info': 'healthPlayerInfo',
  '/api/leaderboard/ban': 'healthBanLeaderboard',
  '/api/players/matches': 'healthPlayerMatches',
  '/api/match': 'healthMatchDetail',
};

export function BatraceStatus({ health }: { health: ApiHealth }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const tone = { ok: 'success', partial: 'warning', down: 'danger', unknown: 'muted' }[
    health.state
  ];
  const label = t(
    { ok: 'serviceConnected', partial: 'servicePartial', down: 'serviceDown', unknown: 'unknown' }[
      health.state
    ],
  );
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div
      className="health-status"
      ref={root}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!root.current?.contains(document.activeElement)) setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className={`badge badge-${tone} health-status-trigger`}
        aria-label={`BATrace · ${label}`}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
      >
        <span className={`status-dot status-${tone}`} aria-hidden="true" />
        BATrace <span>· {label}</span>
      </button>
      {open && (
        <div className="health-status-details" role="tooltip" id={id}>
          <strong>{t('health')}</strong>
          <p className="muted">
            {health.at
              ? t('healthCheckedAt', { time: new Date(health.at).toLocaleString(locale) })
              : t('healthNotChecked')}
          </p>
          {health.checks.length > 0 && (
            <ul className="health-checks">
              {health.checks.map((check) => {
                const reason = check.ok
                  ? 'healthSuccess'
                  : check.failure && check.failure !== 'http'
                    ? `healthFailure_${check.failure}`
                    : check.status !== null
                      ? ({
                          401: 'healthHttp401',
                          403: 'healthHttp403',
                          404: 'healthHttp404',
                          429: 'healthHttp429',
                        }[check.status] ?? 'healthHttpError')
                      : 'healthFailure_network';
                return (
                  <li key={check.path}>
                    <div className="health-check-heading">
                      <strong>
                        {t(endpoints[check.path.split('?')[0] ?? ''] ?? 'healthEndpoint')}
                      </strong>
                      <span className="health-check-status">
                        <span
                          className={
                            check.ok
                              ? 'text-success'
                              : check.fallback?.ok
                                ? 'text-warning'
                                : 'text-danger'
                          }
                        >
                          {t(reason)}
                        </span>
                        {check.fallback && (
                          <span className={check.fallback.ok ? 'text-success' : 'text-danger'}>
                            {t(
                              check.fallback.ok ? 'healthFallbackSuccess' : 'healthFallbackFailed',
                            )}
                          </span>
                        )}
                      </span>
                    </div>
                    <code>{check.path}</code>
                    <small className="muted">
                      {check.status === null ? t('healthNoHttpResponse') : `HTTP ${check.status}`}
                      {' · '}
                      {check.ms} ms
                    </small>
                    {check.rayId && <small className="muted">Ray ID: {check.rayId}</small>}
                    {check.fallback && (
                      <>
                        <code>{check.fallback.path}</code>
                        <small className="muted">
                          {check.fallback.status === null
                            ? t('healthNoHttpResponse')
                            : `HTTP ${check.fallback.status}`}
                          {' · '}
                          {check.fallback.ms} ms
                        </small>
                        {check.fallback.rayId && (
                          <small className="muted">Ray ID: {check.fallback.rayId}</small>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="muted">{t('healthRefreshHint')}</p>
        </div>
      )}
    </div>
  );
}
