import { Skeleton } from '@/components/ui/skeleton';
import { TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export function ProfileTableSkeleton({ columns }: { columns: readonly string[] }) {
  return Array.from({ length: 5 }, (_, index) => (
    <TableRow key={index} aria-hidden="true">
      {columns.map((column) => (
        <TableCell key={column} data-column={column}>
          <div className={cn('flex h-6 items-center', column === 'eloDelta' && 'justify-end')}>
            <Skeleton
              className={cn(
                'h-4 max-w-full',
                column === 'time' || column === 'map'
                  ? 'w-28'
                  : column === 'matchId'
                    ? 'w-16'
                    : 'w-10',
              )}
            />
          </div>
        </TableCell>
      ))}
    </TableRow>
  ));
}
