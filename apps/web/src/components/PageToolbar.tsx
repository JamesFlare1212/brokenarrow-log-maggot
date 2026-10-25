import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

export function PageToolbar({ className = '', ...props }: ComponentPropsWithoutRef<'header'>) {
  return <header {...props} className={cn('page-toolbar', className)} />;
}
