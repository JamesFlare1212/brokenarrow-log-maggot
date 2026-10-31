import { cn } from '@/lib/utils';
import { useI18n } from '../hooks/useI18n';
import { Skeleton } from './ui/skeleton';
import { Item, ItemActions, ItemContent, ItemGroup } from './ui/item';
import { TableCell, TableRow } from './ui/table';

export function LoadingStatus() {
  const { t } = useI18n();
  return (
    <span className="sr-only" role="status">
      {t('loading')}
    </span>
  );
}

export function TableSkeletonRows({
  columns,
  rows = 5,
  alignRight = [],
  compact = false,
}: {
  columns: readonly string[];
  rows?: number;
  alignRight?: readonly string[];
  compact?: boolean;
}) {
  return Array.from({ length: rows }, (_, index) => (
    <TableRow key={index} aria-hidden="true">
      {columns.map((column) => (
        <TableCell key={column} data-column={column}>
          <div
            className={cn(
              'flex items-center',
              compact ? 'h-6' : 'h-8',
              alignRight.includes(column) && 'justify-end',
            )}
          >
            <Skeleton
              className={cn(
                'h-4 max-w-full',
                column === 'time' || column === 'map'
                  ? 'w-28'
                  : column === 'matchId'
                    ? 'w-16'
                    : 'w-20',
              )}
            />
          </div>
        </TableCell>
      ))}
    </TableRow>
  ));
}

export function ListSkeletonRows({
  rows = 3,
  className,
  rowClassName,
}: {
  rows?: number;
  className?: string;
  rowClassName?: string;
}) {
  return (
    <ItemGroup className={className} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <Item size="xs" className={rowClassName} key={index}>
          <ItemContent>
            <Skeleton className="h-5 w-32 max-w-full" />
            <Skeleton className="h-4 w-40 max-w-full" />
          </ItemContent>
          <ItemActions>
            <Skeleton className="h-6 w-12" />
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  );
}
