'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Toggle as TogglePrimitive } from 'radix-ui';
import { cardSurfaceClasses } from '@/components/ui/card';

const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-lg text-sm font-medium whitespace-nowrap transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:bg-muted data-[state=on]:bg-muted dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border border-input bg-transparent hover:bg-muted',
        filter:
          'border border-transparent bg-transparent hover:bg-muted/40 data-[state=on]:border-ring data-[state=on]:bg-accent data-[state=on]:text-accent-foreground',
        card: cn(
          cardSurfaceClasses,
          'has-[>[data-slot=card-preview]]:[--preview-inset:--spacing(2)] has-[>[data-slot=card-preview]]:p-(--preview-inset) has-[>[data-slot=card-preview]]:rounded-[calc(var(--radius-lg)+var(--preview-inset)+1px)]',
          'hover:border-foreground/20 hover:bg-(--glass-surface) aria-pressed:bg-(--glass-surface) data-[state=on]:border-(--appearance-selection) data-[state=on]:bg-(--glass-surface)',
        ),
        sphere:
          'bg-transparent hover:bg-transparent data-[state=on]:bg-transparent aria-pressed:bg-transparent',
      },
      size: {
        default:
          'h-(--control-standard) min-w-(--control-standard) px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        sm: "h-(--control-compact) min-w-(--control-compact) rounded-md px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-(--control-large) min-w-(--control-large) px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Toggle({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
