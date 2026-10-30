import { useLayoutEffect, useRef, useState } from 'react';
import { Spinner } from './ui/spinner';
import { Button } from './ui';

export function RecoveryAction({
  available,
  pending,
  retryLabel,
  refreshLabel,
  pendingLabel,
  onRetry,
}: {
  available: boolean;
  pending: boolean;
  retryLabel: string;
  refreshLabel: string;
  pendingLabel: string;
  onRetry: () => void;
}) {
  const [engaged, setEngaged] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (button.current && document.activeElement === button.current)
      button.current.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }, [available, pending, pendingLabel, refreshLabel, retryLabel]);
  if (!available && !engaged) return null;
  return (
    <div className="flex min-w-0 flex-wrap gap-2" data-recovery-action="">
      <Button
        ref={button}
        size="sm"
        className="h-auto min-h-7 max-w-full scroll-m-2 whitespace-normal"
        aria-disabled={pending}
        aria-busy={pending}
        onFocus={() => setEngaged(true)}
        onClick={() => {
          if (pending) return;
          setEngaged(true);
          onRetry();
        }}
      >
        {pending && <Spinner />}
        {pending ? pendingLabel : available ? retryLabel : refreshLabel}
      </Button>
    </div>
  );
}
