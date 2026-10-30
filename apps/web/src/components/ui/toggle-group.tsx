'use client';

import * as React from 'react';
import { type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { RadioGroup as RadioGroupPrimitive, ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';

import { toggleVariants } from '@/components/ui/toggle';

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number;
    orientation?: 'horizontal' | 'vertical';
    single?: boolean;
  }
>({
  size: 'default',
  variant: 'default',
  spacing: 2,
  orientation: 'horizontal',
});

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 2,
  orientation,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants> & {
    spacing?: number;
    orientation?: 'horizontal' | 'vertical';
  }) {
  const rootProps = {
    'data-slot': 'toggle-group',
    'data-variant': variant,
    'data-size': size,
    'data-spacing': spacing,
    'data-orientation': orientation ?? 'horizontal',
    style: { '--gap': spacing } as React.CSSProperties,
    className: cn(
      'group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-lg data-[size=sm]:rounded-[min(var(--radius-md),10px)] data-vertical:flex-col data-vertical:items-stretch',
      className,
    ),
    orientation,
  };
  const content = (
    <ToggleGroupContext.Provider
      value={{ variant, size, spacing, orientation, single: props.type === 'single' }}
    >
      {children}
    </ToggleGroupContext.Provider>
  );
  const selectionTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSelection = () => {
    if (selectionTimer.current !== null) clearTimeout(selectionTimer.current);
    selectionTimer.current = null;
  };
  React.useEffect(() => clearSelection, []);
  if (props.type === 'single') {
    const { type: _type, rovingFocus: _rovingFocus, ...radioProps } = props;
    return (
      <RadioGroupPrimitive.Root
        {...rootProps}
        {...radioProps}
        onKeyDownCapture={(event) => {
          clearSelection();
          radioProps.onKeyDownCapture?.(event);
          const group = event.currentTarget;
          if (event.defaultPrevented || !(group.getRootNode() instanceof ShadowRoot)) return;
          const source = event.target;
          if (
            !(source instanceof HTMLButtonElement) ||
            source.getAttribute('role') !== 'radio' ||
            source.closest('[role=radiogroup]') !== group ||
            source.disabled
          )
            return;
          const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
          const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
          if (
            (!horizontal && !vertical) ||
            (orientation === 'vertical' && horizontal) ||
            (orientation === 'horizontal' && vertical)
          )
            return;
          // Radix roving focus compares document.activeElement, which is the shadow host.
          const options = [
            ...group.querySelectorAll<HTMLButtonElement>('[role=radio]:not(:disabled)'),
          ].filter((option) => option.closest('[role=radiogroup]') === group);
          const index = options.indexOf(source);
          const rtl =
            radioProps.dir === 'rtl' ||
            (!radioProps.dir && getComputedStyle(group).direction === 'rtl');
          const step =
            (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) *
            (horizontal && rtl ? -1 : 1);
          const next = index + step;
          event.preventDefault();
          event.stopPropagation();
          if (
            index < 0 ||
            !options.length ||
            (radioProps.loop === false && (next < 0 || next >= options.length))
          )
            return;
          const target = options[(next + options.length) % options.length];
          if (!target) return;
          target.focus();
          if (target.getAttribute('aria-checked') !== 'true') target.click();
        }}
        onPointerDownCapture={(event) => {
          clearSelection();
          radioProps.onPointerDownCapture?.(event);
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) clearSelection();
          radioProps.onBlurCapture?.(event);
        }}
        onKeyDown={(event) => {
          radioProps.onKeyDown?.(event);
          if (
            !event.defaultPrevented ||
            !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
          )
            return;
          const group = event.currentTarget;
          const source = event.target;
          // Radix defers roving focus; a quick keyup can clear its selection intent first.
          selectionTimer.current = setTimeout(() => {
            selectionTimer.current = null;
            const root = group.getRootNode();
            const target = root instanceof ShadowRoot ? root.activeElement : document.activeElement;
            if (
              group.isConnected &&
              target instanceof HTMLButtonElement &&
              target !== source &&
              target.closest('[role=radiogroup]') === group &&
              target.getAttribute('role') === 'radio' &&
              target.getAttribute('aria-checked') === 'false' &&
              !target.disabled
            )
              target.click();
          }, 0);
        }}
      >
        {content}
      </RadioGroupPrimitive.Root>
    );
  }
  return (
    <ToggleGroupPrimitive.Root {...rootProps} {...props}>
      {content}
    </ToggleGroupPrimitive.Root>
  );
}

function ToggleGroupItem({
  className,
  children,
  variant = 'default',
  size = 'default',
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext);
  const Item = context.single ? RadioGroupPrimitive.Item : ToggleGroupPrimitive.Item;

  return (
    <Item
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        'shrink-0 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-2 focus:z-10 focus-visible:z-10 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pr-1.5 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:pl-1.5 group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-l-lg group-data-vertical/toggle-group:data-[spacing=0]:first:rounded-t-lg group-data-horizontal/toggle-group:data-[spacing=0]:last:rounded-r-lg group-data-vertical/toggle-group:data-[spacing=0]:last:rounded-b-lg group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:border-l-0 group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:border-t-0 group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-l group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-t',
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className,
      )}
      {...props}
    >
      {children}
    </Item>
  );
}

export { ToggleGroup, ToggleGroupItem };
