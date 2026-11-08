'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Switch as SwitchPrimitive } from 'radix-ui';

function Switch({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: 'sm' | 'default';
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        'peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-all outline-none group-has-[:focus-visible]/field-label:border-transparent group-has-[:focus-visible]/field-label:ring-0 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input/80 data-disabled:cursor-not-allowed data-disabled:opacity-50',
        'forced-colors:forced-color-adjust-none forced-colors:transition-none forced-colors:border-transparent! forced-colors:ring-0! forced-colors:bg-[ButtonFace]! forced-colors:outline-solid forced-colors:outline-1 forced-colors:outline-[ButtonText] forced-colors:outline-offset-0 forced-colors:data-checked:bg-[Highlight]! forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-[Highlight] forced-colors:data-disabled:opacity-100 forced-colors:data-disabled:bg-[ButtonFace]! forced-colors:data-disabled:data-checked:bg-[ButtonFace]! forced-colors:data-disabled:outline-[GrayText] forced-colors:[--switch-thumb-color:ButtonText] forced-colors:data-checked:[--switch-thumb-color:HighlightText] forced-colors:data-disabled:[--switch-thumb-color:GrayText] forced-colors:data-disabled:data-checked:[--switch-thumb-color:GrayText]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block rounded-full bg-background ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] dark:data-checked:bg-primary-foreground group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0 dark:data-unchecked:bg-foreground',
          'forced-colors:bg-(--switch-thumb-color)! forced-colors:transition-none',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
