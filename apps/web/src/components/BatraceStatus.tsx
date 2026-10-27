import { useId, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { errorMessage } from '@ba/shared';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from './ui/popover';
import type { ApiHealth } from '@ba/contracts';
import { useI18n } from '../hooks/useI18n';

const endpoints: Record<string, string> = {
  '/api/players/search': 'healthPlayerSearch',
  '/api/players/info': 'healthPlayerInfo',
  '/api/leaderboard/ban': 'healthBanLeaderboard',
  '/api/players/matches': 'healthPlayerMatches',
  '/api/match': 'healthMatchDetail',
};

export function BatraceStatus({
  health,
  onCheck,
}: {
  health: ApiHealth;
  onCheck?: () => Promise<ApiHealth>;
}) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const running = useRef(false);
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null),
    [result, setResult] = useState<ApiHealth | null>(null);
  const current = result && result.at >= health.at ? result : health;
  const checks: Array<ApiHealth['checks'][number] & { unchecked?: boolean }> = Object.keys(
    endpoints,
  ).map(
    (path) =>
      current.checks.find((check) => check.path.split('?')[0] === path) ?? {
        path,
        ok: false,
        ms: 0,
        status: null,
        unchecked: true,
      },
  );
  checks.push(
    ...current.checks.filter((check) => !Object.hasOwn(endpoints, check.path.split('?')[0] ?? '')),
  );
  const check = async () => {
    if (!onCheck || running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    try {
      setResult(await onCheck());
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      running.current = false;
      setPending(false);
    }
  };
  const label = t(
    { ok: 'serviceConnected', partial: 'servicePartial', down: 'serviceDown', unknown: 'unknown' }[
      current.state
    ],
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" aria-label={`BATrace · ${label}`}>
          BATrace
          <Badge
            variant={
              current.state === 'ok'
                ? 'success'
                : current.state === 'down'
                  ? 'destructive'
                  : current.state === 'partial'
                    ? 'warning'
                    : 'secondary'
            }
          >
            {label}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-labelledby={titleId}
        className="max-h-[75svh] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto"
      >
        <PopoverHeader>
          <PopoverTitle id={titleId}>{t('health')}</PopoverTitle>
          <PopoverDescription>
            {current.at
              ? t('healthCheckedAt', { time: new Date(current.at).toLocaleString(locale) })
              : t('healthNotChecked')}
          </PopoverDescription>
        </PopoverHeader>
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
        <p className="muted">{t('healthRefreshHint')}</p>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {onCheck && (
          <Button
            variant="outline"
            disabled={pending}
            aria-busy={pending}
            aria-label={t('health')}
            onClick={() => void check()}
          >
            <RefreshCw
              data-icon="inline-start"
              className={pending ? 'animate-spin' : undefined}
              aria-hidden="true"
            />
            {t(pending ? 'loading' : 'healthCheck')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
