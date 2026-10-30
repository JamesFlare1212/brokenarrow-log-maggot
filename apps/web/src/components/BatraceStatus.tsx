import { useId } from 'react';
import {
  CircleCheck,
  CircleX,
  CircleAlert,
  CircleHelp,
  TriangleAlert,
  LoaderCircle,
} from 'lucide-react';
import type { ApiHealth } from '@ba/contracts';
import { useI18n } from '../hooks/useI18n';
import { useHealthCheck, type HealthCheckRequest } from '../hooks/useHealthCheck';
import { HealthCheckPanel, healthStateMessage } from './HealthCheckPanel';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Popover, PopoverContent, PopoverTrigger, PopoverHeader, PopoverTitle } from './ui/popover';

export function BatraceStatus({
  health,
  onCheck,
  request,
}: {
  health: ApiHealth;
  onCheck?: () => Promise<ApiHealth>;
  request?: HealthCheckRequest;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const local = useHealthCheck(health, onCheck);
  const check = request ?? local;
  const label = t(
    check.pending
      ? 'healthChecking'
      : check.failure
        ? 'healthCheckFailed'
        : healthStateMessage(check.current),
  );
  const name = `BATrace · ${label}${check.pending || check.failure ? ' · ' + t('healthLastResult', { state: t(healthStateMessage(check.current)) }) : ''}`;
  const StatusIcon = check.pending
    ? LoaderCircle
    : check.failure
      ? CircleAlert
      : check.current.state === 'ok'
        ? CircleCheck
        : check.current.state === 'down'
          ? CircleX
          : check.current.state === 'partial'
            ? TriangleAlert
            : CircleHelp;
  const iconColor =
    check.pending || check.failure || check.current.state === 'partial'
      ? 'text-warning'
      : check.current.state === 'ok'
        ? 'text-success'
        : check.current.state === 'down'
          ? 'text-danger'
          : 'text-muted-foreground';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" aria-label={name} title={name} className="health-status-trigger">
          <span className="health-status-compact" aria-hidden="true">
            <StatusIcon className={`${iconColor}${check.pending ? ' animate-spin' : ''}`} />
          </span>
          <span className="health-status-label inline-flex items-center gap-2">
            BATrace
            <Badge
              variant={
                check.pending || check.failure
                  ? 'warning'
                  : check.current.state === 'ok'
                    ? 'success'
                    : check.current.state === 'down'
                      ? 'destructive'
                      : check.current.state === 'partial'
                        ? 'warning'
                        : 'secondary'
              }
            >
              {label}
            </Badge>
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-labelledby={titleId}
        className="max-h-[75svh] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto"
      >
        <PopoverHeader>
          <PopoverTitle id={titleId}>{t('health')}</PopoverTitle>
        </PopoverHeader>
        <HealthCheckPanel request={check} />
      </PopoverContent>
    </Popover>
  );
}
