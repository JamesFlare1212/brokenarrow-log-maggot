import * as RadixDialog from '@radix-ui/react-dialog';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { faArrowRightArrowLeft, faTrashCan } from '@fortawesome/free-solid-svg-icons';
import { Icon } from './Icon';
import { Button } from './ui';
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
      <RadixDialog.Root open={options !== null} onOpenChange={(open) => !open && finish(false)}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="dialog-overlay confirmation-overlay" />
          <RadixDialog.Content
            role="alertdialog"
            className={`dialog confirmation-dialog confirmation-${variant}`}
            onPointerDownOutside={(event) => event.preventDefault()}
            onInteractOutside={(event) => event.preventDefault()}
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
            <div className="confirmation-content">
              <span className="confirmation-icon" aria-hidden="true">
                <Icon icon={variant === 'danger' ? faTrashCan : faArrowRightArrowLeft} size={22} />
              </span>
              <div className="confirmation-copy">
                <RadixDialog.Title>{options?.title}</RadixDialog.Title>
                <RadixDialog.Description>{options?.description}</RadixDialog.Description>
              </div>
              {options?.detail && <div className="confirmation-detail">{options.detail}</div>}
            </div>
            <div className="confirmation-actions">
              <Button ref={cancel} onClick={() => finish(false)}>
                {t('cancel')}
              </Button>
              <Button variant={variant} onClick={() => finish(true)}>
                {options?.confirmLabel ?? t('confirm')}
              </Button>
            </div>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
    </ConfirmationContext.Provider>
  );
}
