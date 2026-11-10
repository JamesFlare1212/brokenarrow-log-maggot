'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

function Table({
  className,
  ref,
  stickyHeader = false,
  stickyFirstColumn = false,
  ...props
}: React.ComponentProps<'table'> & { stickyHeader?: boolean; stickyFirstColumn?: boolean }) {
  const table = React.useRef<HTMLTableElement>(null);
  React.useImperativeHandle(ref, () => table.current!, []);
  React.useLayoutEffect(() => {
    const element = table.current;
    if (!element || (!stickyHeader && !stickyFirstColumn)) return;
    let viewport = element.parentElement!;
    while (viewport.parentElement && !/(auto|scroll)/.test(getComputedStyle(viewport).overflow))
      viewport = viewport.parentElement;

    // Clip covered content so sticky labels need no opaque or extra glass layer.
    const update = () => {
      const cells = stickyFirstColumn
        ? Array.from(element.rows).flatMap((row) => Array.from(row.cells))
        : [];
      const pinnedRight = stickyFirstColumn
        ? (element.rows[0]?.cells[0]?.getBoundingClientRect().right ?? 0)
        : 0;
      const clips = cells.map((cell) => {
        const rect = cell.getBoundingClientRect();
        return stickyFirstColumn && cell.cellIndex > 0
          ? Math.min(rect.width, Math.max(0, pinnedRight - rect.left))
          : 0;
      });
      const body = element.tBodies[0];
      const bodyRect = stickyHeader ? body?.getBoundingClientRect() : undefined;
      const bodyTop = bodyRect
        ? Math.min(
            bodyRect.height,
            Math.max(
              0,
              viewport.getBoundingClientRect().top +
                viewport.clientTop +
                (element.tHead?.getBoundingClientRect().height ?? 0) -
                bodyRect.top,
            ),
          )
        : 0;
      cells.forEach((cell, index) =>
        cell.style.setProperty('--table-clip-left', `${clips[index]}px`),
      );
      body?.style.setProperty('--table-clip-top', `${bodyTop}px`);
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(element);
    resize.observe(viewport);
    const mutation = new MutationObserver(update);
    mutation.observe(element, { childList: true, subtree: true });
    viewport.addEventListener('scroll', update, { passive: true });
    return () => {
      resize.disconnect();
      mutation.disconnect();
      viewport.removeEventListener('scroll', update);
      element
        .querySelectorAll<HTMLElement>('th, td')
        .forEach((cell) => cell.style.removeProperty('--table-clip-left'));
      element.tBodies[0]?.style.removeProperty('--table-clip-top');
    };
  }, [stickyHeader, stickyFirstColumn]);
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        ref={table}
        data-slot="table"
        data-sticky-header={stickyHeader || undefined}
        data-sticky-first-column={stickyFirstColumn || undefined}
        className={cn('group/table w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        'group-data-[sticky-header=true]/table:sticky group-data-[sticky-header=true]/table:top-0 group-data-[sticky-header=true]/table:z-2 [&_tr]:border-b',
        className,
      )}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn(
        'group-data-[sticky-header=true]/table:[clip-path:inset(var(--table-clip-top,0px)_0_0)] [&_tr:last-child]:border-0',
        className,
      )}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-t font-medium [&>tr]:last:border-b-0', className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted/50',
        className,
      )}
      {...props}
    />
  );
}

const tableHeadClasses =
  'h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0';

const pinnedCellClasses =
  'group-data-[sticky-first-column=true]/table:[clip-path:inset(0_0_0_var(--table-clip-left,0px))] group-data-[sticky-first-column=true]/table:first:sticky group-data-[sticky-first-column=true]/table:first:left-0 group-data-[sticky-first-column=true]/table:first:z-1';

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(tableHeadClasses, pinnedCellClasses, className)}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0',
        pinnedCellClasses,
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-4 text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  tableHeadClasses,
};
