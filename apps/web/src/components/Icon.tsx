import type { LucideIcon, LucideProps } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Icon({
  icon: Component,
  spin,
  className,
  ...props
}: LucideProps & { icon: LucideIcon; spin?: boolean }) {
  return (
    <Component
      size={16}
      data-icon="inline-start"
      className={cn(spin && 'animate-spin', className)}
      {...props}
    />
  );
}
