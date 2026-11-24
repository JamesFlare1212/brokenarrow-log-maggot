import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from 'radix-ui';

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center h-(--button-height) rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 has-[>[data-slot=avatar]:only-child]:rounded-full [--badge-height:--spacing(5)] [--badge-inset:calc((var(--button-height)-var(--badge-height))/2)] has-[>[data-slot=badge]:last-child]:rounded-[calc(var(--radius-sm)+var(--badge-inset))] has-[>[data-slot=badge]:last-child]:pe-[calc(var(--badge-inset)-1px)] [&>[data-slot=badge]:last-child]:h-(--badge-height) [&>[data-slot=badge]:last-child]:rounded-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/80',
        outline:
          'border-border bg-muted/50 text-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        overlay: 'bg-transparent',
        ghost:
          'text-foreground hover:bg-muted hover:text-foreground aria-[haspopup]:aria-expanded:bg-muted aria-[haspopup]:aria-expanded:text-foreground dark:hover:bg-muted/50',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default:
          '[--button-height:var(--control-standard)] gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: "[--button-height:var(--control-inset)] gap-1 rounded-md px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "[--button-height:var(--control-compact)] gap-1 rounded-md px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: '[--badge-height:--spacing(6)] [&>[data-slot=badge]:last-child]:min-w-(--badge-height) [--button-height:var(--control-large)] gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        icon: '[--button-height:var(--control-standard)] w-(--button-height)',
        'icon-xs':
          "[--button-height:var(--control-inset)] w-(--button-height) in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        'icon-sm':
          "[--button-height:var(--control-compact)] w-(--button-height) in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3.5",
        'icon-lg': '[--button-height:var(--control-large)] w-(--button-height)',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
