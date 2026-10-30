import { useId, type ReactNode, type Ref } from 'react';
import { flexRender, type Table as TableModel } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Loading } from './ui';

export function DataTable<T>({
  table,
  label,
  pending,
  empty,
  scrollRef,
  className,
  sortDescription,
}: {
  table: TableModel<T>;
  label: string;
  pending: boolean;
  empty: ReactNode;
  scrollRef?: Ref<HTMLDivElement>;
  className?: string;
  sortDescription?: string;
}) {
  const sortDescriptionId = useId();
  return (
    <div
      className={cn('table-wrap data-table-scroll', className)}
      ref={scrollRef}
      tabIndex={0}
      aria-busy={pending}
    >
      {sortDescription && (
        <p id={sortDescriptionId} className="sr-only">
          {sortDescription}
        </p>
      )}
      <Table aria-label={label}>
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
                        aria-describedby={
                          direction && sortDescription ? sortDescriptionId : undefined
                        }
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <Icon data-icon="inline-end" aria-hidden="true" />
                        {direction && (
                          <span
                            aria-hidden="true"
                            className="inline-flex size-4 items-center justify-center rounded bg-muted text-xs tabular-nums"
                          >
                            {header.column.getSortIndex() + 1}
                          </span>
                        )}
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
              <TableRow key={row.id}>
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
          ) : (
            <TableRow>
              <TableCell colSpan={table.getAllLeafColumns().length}>
                {pending ? <Loading /> : empty}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
