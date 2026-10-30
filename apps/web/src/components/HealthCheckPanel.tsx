import { RefreshCw, ChevronDown } from 'lucide-react';
import type { ApiHealth } from '@ba/contracts';
import { useI18n } from '../hooks/useI18n';
import type { HealthCheckRequest } from '../hooks/useHealthCheck';
import { Button } from './ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';

export const healthStateMessage = (health: ApiHealth) =>
  ({ ok: 'serviceConnected', partial: 'servicePartial', down: 'serviceDown', unknown: 'unknown' })[
    health.state
  ];

const endpoints: Record<string, string> = {
  '/api/players/search': 'healthPlayerSearch',
  '/api/players/info': 'healthPlayerInfo',
  '/api/leaderboard/ban': 'healthBanLeaderboard',
  '/api/players/matches': 'healthPlayerMatches',
  '/api/match': 'healthMatchDetail',
};

function HealthDetails({ health }: { health: ApiHealth }) {
  const { t } = useI18n();
  const checks: Array<ApiHealth['checks'][number] & { unchecked?: boolean }> = Object.keys(
    endpoints,
  ).map(
    (path) =>
      health.checks.find((check) => check.path.split('?')[0] === path) ?? {
        path,
        ok: false,
        ms: 0,
        status: null,
        unchecked: true,
      },
  );
  checks.push(
    ...health.checks.filter((check) => !Object.hasOwn(endpoints, check.path.split('?')[0] ?? '')),
  );
  return (
    <>
      {checks.length > 0 && (
        <ul className="health-checks">
          {checks.map((check) => {
            const reason = check.unchecked
              ? 'healthEndpointNotChecked'
              : check.ok
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
                        check.unchecked
                          ? 'muted'
                          : check.ok
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
                        {t(check.fallback.ok ? 'healthFallbackSuccess' : 'healthFallbackFailed')}
                      </span>
                    )}
                  </span>
                </div>
                <code>{check.path}</code>
                {!check.unchecked && (
                  <small className="muted">
                    {check.status === null ? t('healthNoHttpResponse') : `HTTP ${check.status}`}
                    {' · '}
                    {check.ms} ms
                  </small>
                )}
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
    </>
  );
}

export function HealthCheckPanel({
  request,
  collapsible = false,
}: {
  request: HealthCheckRequest;
  collapsible?: boolean;
}) {
  const { t, locale } = useI18n();
  const { current, pending, failure } = request;
  return (
    <div className="grid min-w-0 gap-3" data-health-panel="">
      {request.canCheck && (
        <Button
          type="button"
          variant="outline"
          aria-disabled={pending}
          aria-busy={pending}
          aria-label={collapsible ? t('healthCheck') : t('health')}
          onClick={() => void request.check()}
          className="w-fit"
        >
          <RefreshCw
            data-icon="inline-start"
            className={pending ? 'animate-spin' : undefined}
            aria-hidden="true"
          />
          {t('healthCheck')}
        </Button>
      )}
      <div className="settings-health-feedback grid gap-1 wrap-anywhere" role="status">
        <p>
          {t(
            pending
              ? 'healthChecking'
              : failure
                ? 'healthCheckFailed'
                : healthStateMessage(current),
          )}
        </p>
        {(pending || failure) && (
          <p className="text-sm text-muted-foreground">
            {t('healthLastResult', { state: t(healthStateMessage(current)) })}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {current.at
            ? t('healthCheckedAt', { time: new Date(current.at).toLocaleString(locale) })
            : t('healthNotChecked')}
        </p>
      </div>
      {failure && (
        <div role="alert" className="grid gap-1 text-sm text-destructive wrap-anywhere">
          <p>{t('healthFailedAt', { time: new Date(failure.at).toLocaleString(locale) })}</p>
          <p>{failure.message}</p>
        </div>
      )}
      {collapsible ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-fit">
              {t('healthDetails')}
              <ChevronDown aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <HealthDetails health={current} />
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <HealthDetails health={current} />
      )}
      <p className="text-sm text-muted-foreground wrap-anywhere">{t('healthRefreshHint')}</p>
    </div>
  );
}
