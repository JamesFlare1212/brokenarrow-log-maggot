import { cn } from '@/lib/utils';
import { Loader2Icon } from 'lucide-react';

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  const labeled = Boolean(props['aria-label'] || props['aria-labelledby']);
  return (
    <Loader2Icon
      data-slot="spinner"
      role={labeled ? 'status' : undefined}
      aria-hidden={labeled ? undefined : true}
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  );
}

export { Spinner };
