import type { ComponentProps } from 'react';
import { ContextMenu as Primitive } from 'radix-ui';
import { cn } from '@/lib/utils';
import { glassMenuSurfaceClasses } from '@/lib/surfaces';

export const ContextMenu = Primitive.Root;
export const ContextMenuTrigger = Primitive.Trigger;
export const ContextMenuGroup = Primitive.Group;

export function ContextMenuLabel({ className, ...props }: ComponentProps<typeof Primitive.Label>) {
  return (
    <Primitive.Label
      className={cn('px-1.5 py-1 text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}
export function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        data-slot="context-menu-content"
        className={cn(
          glassMenuSurfaceClasses,
          'z-50 max-h-(--radix-context-menu-content-available-height) min-w-36 overflow-y-auto p-1',
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}
export function ContextMenuItem({ className, ...props }: ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      data-slot="context-menu-item"
      className={cn(
        'relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
}
