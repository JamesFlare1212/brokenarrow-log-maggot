import { useRef, useState } from 'react';
import { ChevronDown, ExternalLink, FileText, RefreshCw, Trash2 } from 'lucide-react';
import { BATRACE_ORIGIN, type Match } from '@ba/contracts';
import { formatTime } from '@ba/shared';
import { useApp } from '../../app/state';
import { useConfirmation } from '../../components/Confirmation';
import { Button } from '../../components/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useI18n } from '../../hooks/useI18n';

export function MatchArchiveActions({
  match,
  onOpen,
  onUpdated,
}: {
  match: Match;
  onOpen: () => void;
  onUpdated: () => Promise<unknown>;
}) {
  const { api, notify } = useApp();
  const { t, locale } = useI18n();
  const confirm = useConfirmation();
  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlight = useRef(false);
  const openingDetails = useRef(false);
  const context = {
    map: match.map || (match.fid ? '#' + match.fid : t('matchUnrecorded')),
    time: formatTime(match.endedAt ?? match.startedAt, locale),
  };

  const refresh = async () => {
    if (!match.fid || refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      await api.invoke('matches.detail', { fid: match.fid, force: true });
      await onUpdated();
    } catch (error) {
      notify(String(error), true);
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  };

  const remove = async () => {
    if (
      !(await confirm({
        title: t('confirmation.deleteMatch'),
        description: t('confirmation.deleteHint'),
        detail: match.fid ? `${match.map} · #${match.fid}` : `${context.map} · ${context.time}`,
        confirmLabel: t('delete'),
      }))
    )
      return;
    try {
      await api.invoke('matches.delete', { id: match.id });
      await onUpdated();
    } catch (error) {
      notify(String(error), true);
    }
  };

  return (
    <div
      className="inline-flex"
      role="group"
      aria-label={`${t('actions')}: ${match.fid ? '#' + match.fid : context.map + ' · ' + context.time}`}
      onClick={(event) => event.stopPropagation()}
    >
      <Button
        size="sm"
        className="rounded-r-none"
        disabled={refreshing}
        aria-busy={refreshing}
        aria-label={t(match.fid ? 'matchRefresh' : 'matchOpenDetail', context)}
        data-match-open={!match.fid ? match.id : undefined}
        onClick={() => (match.fid ? void refresh() : onOpen())}
      >
        {match.fid ? (
          <RefreshCw
            data-icon="inline-start"
            className={cn(refreshing && 'animate-spin')}
            aria-hidden="true"
          />
        ) : (
          <FileText data-icon="inline-start" aria-hidden="true" />
        )}
        {t(match.fid ? 'refresh' : 'matchViewLocalDetails')}
      </Button>
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          if (open) openingDetails.current = false;
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            className="rounded-l-none border-l-0"
            data-menu-trigger
            data-match-open={match.id}
            aria-label={t('matchActions', context)}
          >
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          className="min-w-48"
          onCloseAutoFocus={(event) => {
            if (openingDetails.current || document.querySelector('[role="alertdialog"]'))
              event.preventDefault();
          }}
        >
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => {
                openingDetails.current = true;
                onOpen();
              }}
            >
              <FileText aria-hidden="true" />
              {t('matchViewDetails')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!match.fid || match.mode === 'pve'}
              onSelect={() =>
                void api
                  .invoke('external.open', { url: `${BATRACE_ORIGIN}/match/${match.fid}` })
                  .catch((error) => notify(String(error), true))
              }
            >
              <ExternalLink aria-hidden="true" />
              {t('openBatrace')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              disabled={refreshing}
              onSelect={() => void remove()}
            >
              <Trash2 aria-hidden="true" />
              {t('delete')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
