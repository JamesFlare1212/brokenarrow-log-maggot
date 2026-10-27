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
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useI18n } from '../hooks/useI18n';

interface ConfirmationOptions {
  title: string;
  description: string;
  detail?: string;
  confirmLabel?: string;
  variant?: 'danger' | 'primary';
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
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const pending = useRef<((accepted: boolean) => void) | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useCallback<Confirm>((request) => {
    if (pending.current) return Promise.resolve(false);
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menu = active?.closest('[role="menu"]');
    const trigger = menu?.getAttribute('aria-labelledby');
    opener.current = (trigger ? document.getElementById(trigger) : null) ?? active;
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
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancel.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = opener.current;
            queueMicrotask(() => {
              if (pending.current) return;
              (target?.isConnected ? target : document.getElementById('main-content'))?.focus({
                preventScroll: true,
              });
            });
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{options?.title}</AlertDialogTitle>
            <AlertDialogDescription>{options?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          {options?.detail && (
            <p className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-sm whitespace-pre-wrap wrap-anywhere">
              {options.detail}
            </p>
          )}
          <AlertDialogFooter>
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
