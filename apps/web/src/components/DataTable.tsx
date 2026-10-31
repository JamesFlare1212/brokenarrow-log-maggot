import type { ReactNode, Ref } from 'react';
import { flexRender, type Table as TableModel } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { LoadingStatus, TableSkeletonRows } from './LoadingState';

export function DataTable<T>({
  table,
  label,
  pending,
  loading = false,
  empty,
  scrollRef,
  className,
  onRowOpen,
}: {
  table: TableModel<T>;
  label: string;
  pending: boolean;
  loading?: boolean;
  empty: ReactNode;
  scrollRef?: Ref<HTMLDivElement>;
  className?: string;
  onRowOpen?: (value: T) => void;
}) {
  return (
    <div
      className={cn('table-wrap data-table-scroll', className)}
      ref={scrollRef}
      tabIndex={0}
      aria-busy={pending}
    >
      {pending && <LoadingStatus />}
      <Table aria-label={label} aria-busy={pending}>
        <colgroup>
          {table.getAllLeafColumns().map((column) => (
            <col key={column.id} style={{ width: column.columnDef.size }} />
          ))}
        </colgroup>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const direction = header.column.getIsSorted();
                const Icon =
                  direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ArrowUpDown;
                const right =
                  (header.column.columnDef.meta as { align?: string } | undefined)?.align ===
                  'right';
                return (
                  <TableHead
                    key={header.id}
                    className={cn(right && 'text-right')}
                    aria-sort={
                      header.column.getCanSort()
                        ? direction === 'asc'
                          ? 'ascending'
                          : direction === 'desc'
                            ? 'descending'
                            : 'none'
                        : undefined
                    }
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn('-mx-2', right && 'ml-auto flex')}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <Icon data-icon="inline-end" aria-hidden="true" />
                      </Button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-row-action={onRowOpen ? true : undefined}
                onClick={
                  onRowOpen
                    ? (event) => {
                        if (
                          event.button !== 0 ||
                          !(event.target instanceof Element) ||
                          event.target.closest(
                            'button, a, input, select, textarea, [role="menu"], [role="menuitem"]',
                          ) ||
                          window.getSelection()?.toString()
                        )
                          return;
                        onRowOpen(row.original);
                      }
                    : undefined
                }
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      (cell.column.columnDef.meta as { align?: string } | undefined)?.align ===
                        'right' && 'text-right tabular-nums',
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : loading ? (
            <TableSkeletonRows
              columns={table.getVisibleLeafColumns().map((column) => column.id)}
              alignRight={table
                .getVisibleLeafColumns()
                .filter(
                  (column) =>
                    (column.columnDef.meta as { align?: string } | undefined)?.align === 'right',
                )
                .map((column) => column.id)}
            />
          ) : (
            <TableRow>
              <TableCell colSpan={table.getAllLeafColumns().length}>{empty}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
