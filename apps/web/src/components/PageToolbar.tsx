import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

export function PageToolbar({ className = '', ...props }: ComponentPropsWithoutRef<'header'>) {
  return (
    <header
      {...props}
      className={cn(
        'page-toolbar flex shrink-0 items-center justify-between gap-4 min-h-[calc(var(--toolbar-height)+1px)] py-2 px-6 border-b border-b-border viewport-max-767:px-5 viewport-max-479:gap-2',
        className,
      )}
    />
  );
}
