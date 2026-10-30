import { useContext, useId, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { BanAlertsContext } from './ban-alerts-context';
import { useI18n } from '../../hooks/useI18n';

export function BanAlertsIndicator() {
  const inbox = useContext(BanAlertsContext);
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const titleId = useId();
  const body = useRef<HTMLDivElement>(null);
  if (!inbox) return null;
  const queued = inbox.alerts.filter((alert) => !inbox.activeIds.includes(alert.id));
  const selected = inbox.alerts.find((alert) => alert.id === selectedId);
  const busy = selectedId !== null && inbox.pending.has(selectedId);
  const error = selectedId ? inbox.errors[selectedId] : undefined;
  const count = queued.reduce((total, alert) => total + alert.players.length, 0);
  const label = t('banAlertsPending', { count });
  const acknowledge = async () => {
    if (!selected || busy) return;
    const opener = document.activeElement;
    await inbox.acknowledge(selected.id);
    if (document.activeElement === opener) body.current?.focus({ preventScroll: true });
  };
  return (
    <Popover
      open={open && inbox.available}
      onOpenChange={(value) => {
        if (value) setSelectedId(queued[0]?.id ?? null);
        setOpen(value);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          title={label}
          tabIndex={inbox.available && count ? 0 : -1}
          className={inbox.available ? 'relative shrink-0' : 'invisible shrink-0'}
          data-ban-alerts-trigger=""
        >
          <Bell className={count ? 'text-destructive' : 'text-muted-foreground'} />
          {count > 0 && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -top-1 -right-1 rounded-full bg-destructive px-1 text-[0.625rem] leading-4 text-white"
            >
              {count > 99 ? '99+' : count}
            </span>
          )}
          <span className="sr-only">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-labelledby={titleId}
        className="ban-alerts-popover"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          body.current?.focus();
        }}
      >
        <PopoverHeader className="shrink-0">
          <PopoverTitle id={titleId}>{t('banAlert')}</PopoverTitle>
        </PopoverHeader>
        <div
          ref={body}
          role="region"
          aria-label={t('banAlertsDetails')}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain wrap-anywhere focus-visible:outline-2 focus-visible:outline-ring"
        >
          {selected ? (
            <>
              <p className="mb-3 text-muted-foreground">{t('banAlertsContinue')}</p>
              <ul className="space-y-3">
                {selected.players.map((player) => (
                  <li key={player.id}>
                    <strong className="block">{player.name}</strong>
                    <span className="text-muted-foreground">
                      #{player.id} · {t('banned')}
                    </span>
                  </li>
                ))}
              </ul>
              {error && (
                <p role="alert" className="mt-3 text-destructive">
                  {t('banAlertsSaveFailed')} {error}
                </p>
              )}
            </>
          ) : (
            <p role="status">{t(selectedId ? 'banAlertsAcknowledged' : 'banAlertsEmpty')}</p>
          )}
        </div>
        <div className="flex min-h-8 shrink-0 items-center justify-end gap-2 border-t pt-2">
          {!selected && queued.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedId(queued[0]!.id);
                body.current?.focus();
              }}
            >
              {t('banAlertsNext')}
            </Button>
          )}
          {selected && (
            <Button size="sm" aria-disabled={busy} onClick={() => void acknowledge()}>
              {t(busy ? 'settingsSaving' : error ? 'retry' : 'banAlertsDismiss')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            {t('close')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
