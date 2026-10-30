import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from './ui/alert-dialog';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useI18n } from '../hooks/useI18n';
import { BanAlertsIndicator } from '../features/bans/BanAlertsIndicator';

interface ConfirmationOptions {
  title: string;
  description: string;
  detail?: string;
  confirmLabel?: string;
  variant?: 'danger' | 'primary';
  returnFocus?: HTMLElement | null;
}
type Confirm = (options: ConfirmationOptions) => Promise<boolean>;
const ConfirmationContext = createContext<Confirm | null>(null);

export function useConfirmation() {
  const confirm = useContext(ConfirmationContext);
  if (!confirm) throw new Error('ConfirmationProvider is required');
  return confirm;
}

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const detailId = useId();
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const pending = useRef<((accepted: boolean) => void) | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useCallback<Confirm>((request) => {
    if (pending.current) return Promise.resolve(false);
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menu = active?.closest('[role="menu"]');
    const trigger = menu?.getAttribute('aria-labelledby');
    opener.current =
      request.returnFocus ?? (trigger ? document.getElementById(trigger) : null) ?? active;
    return new Promise((resolve) => {
      pending.current = resolve;
      setOptions(request);
    });
  }, []);
  const finish = useCallback((accepted: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setOptions(null);
    resolve?.(accepted);
  }, []);
  useEffect(() => () => pending.current?.(false), []);
  const variant = options?.variant ?? 'danger';
  return (
    <ConfirmationContext.Provider value={confirm}>
      {children}
      <AlertDialog open={options !== null} onOpenChange={(open) => !open && finish(false)}>
        <AlertDialogContent
          className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden"
          aria-describedby={options?.detail ? detailId : undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancel.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = opener.current;
            requestAnimationFrame(() => {
              if (pending.current) return;
              const dialog = Array.from(
                document.querySelectorAll<HTMLElement>('[role="dialog"]'),
              ).at(-1);
              if (dialog) {
                if (target?.isConnected && dialog.contains(target) && !target.matches(':disabled'))
                  target.focus({ preventScroll: true });
                else if (!dialog.contains(document.activeElement))
                  (
                    dialog.querySelector<HTMLElement>('[data-dialog-feedback]') ??
                    dialog.querySelector<HTMLElement>('button:not(:disabled)') ??
                    dialog
                  ).focus({ preventScroll: true });
                return;
              }
              (target?.isConnected ? target : document.getElementById('main-content'))?.focus({
                preventScroll: true,
              });
            });
          }}
        >
          <div
            role="region"
            aria-label={t('confirmation.details')}
            tabIndex={0}
            className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain wrap-anywhere focus-visible:outline-2 focus-visible:outline-ring"
          >
            <AlertDialogHeader>
              <div className="flex items-start gap-2">
                <AlertDialogTitle className="min-w-0 flex-1">{options?.title}</AlertDialogTitle>
                <BanAlertsIndicator />
              </div>
              <AlertDialogDescription>{options?.description}</AlertDialogDescription>
            </AlertDialogHeader>
            {options?.detail && (
              <p
                id={detailId}
                className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap wrap-anywhere"
              >
                {options.detail}
              </p>
            )}
          </div>
          <AlertDialogFooter className="shrink-0">
            <AlertDialogCancel ref={cancel} onClick={() => finish(false)}>
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant={variant === 'danger' ? 'destructive' : 'default'}
              onClick={() => finish(true)}
            >
              {options?.confirmLabel ?? t('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmationContext.Provider>
  );
}
