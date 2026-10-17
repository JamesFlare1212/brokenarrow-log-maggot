import type { ComponentPropsWithoutRef } from 'react';

export function PageToolbar({ className = '', ...props }: ComponentPropsWithoutRef<'header'>) {
  return <header {...props} className={`page-toolbar ${className}`} />;
}
