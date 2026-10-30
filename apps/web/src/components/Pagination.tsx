import { useLayoutEffect, useRef, type MouseEvent, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '../hooks/useI18n';
import {
  Pagination as PrimitivePagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
} from './ui/pagination';

export function paginationItems(page: number, pages: number): Array<number | 'before' | 'after'> {
  if (pages <= 5) return Array.from({ length: pages }, (_, index) => index + 1);
  const selected = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 2) selected.add(3);
  if (page >= pages - 1) selected.add(pages - 2);
  const numbers = [...selected]
    .filter((value) => value >= 1 && value <= pages)
    .sort((a, b) => a - b);
  const items: Array<number | 'before' | 'after'> = [];
  numbers.forEach((value, index) => {
    const previous = numbers[index - 1];
    if (previous !== undefined && value - previous > 1)
      items.push(value <= page ? 'before' : 'after');
    items.push(value);
  });
  return items;
}
export function Pagination({
  page,
  pageSize,
  total,
  label,
  onPageChange,
  reserveSpace = false,
  showSinglePage = false,
  focusFallback,
}: {
  page: number;
  pageSize: number;
  total: number;
  label: string;
  onPageChange: (page: number) => void;
  reserveSpace?: boolean;
  showSinglePage?: boolean;
  focusFallback?: RefObject<HTMLElement | null>;
}) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize)),
    hidden = pages === 1 && !showSinglePage;
  const current = Math.max(1, Math.min(page, pages));
  const navigation = useRef<HTMLElement>(null);
  const focused = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (
      focused.current &&
      !focused.current.isConnected &&
      document.activeElement === document.body
    ) {
      (
        navigation.current?.querySelector<HTMLElement>('[aria-current="page"]') ??
        focusFallback?.current
      )?.focus({ preventScroll: true });
      focused.current = null;
    }
  }, [current, pages, hidden, focusFallback]);
  if (hidden && !reserveSpace) return null;
  const navigate = (event: MouseEvent<HTMLAnchorElement>, next: number) => {
    event.preventDefault();
    if (!hidden && next >= 1 && next <= pages && next !== current) onPageChange(next);
  };
  return (
    <PrimitivePagination
      ref={navigation}
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLElement) focused.current = event.target;
      }}
      onBlurCapture={() => {
        if (focused.current?.isConnected) focused.current = null;
      }}
      className={cn('flex-wrap justify-between gap-3 py-3', hidden && 'invisible')}
      aria-label={label}
      aria-hidden={hidden || undefined}
    >
      <p className="text-xs text-muted-foreground sm:text-sm" role="status">
        {t('paginationRange', {
          start: total === 0 ? 0 : (current - 1) * pageSize + 1,
          end: Math.min(current * pageSize, total),
          total,
        })}
      </p>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href="#"
            text={t('previousPage')}
            aria-label={t('previousPage')}
            aria-disabled={hidden || current === 1}
            tabIndex={hidden || current === 1 ? -1 : undefined}
            className={cn((hidden || current === 1) && 'pointer-events-none opacity-50')}
            onClick={(event) => navigate(event, current - 1)}
          />
        </PaginationItem>
        {paginationItems(current, pages).map((item) => (
          <PaginationItem
            key={item}
            className={cn(
              typeof item === 'number' &&
                item !== 1 &&
                item !== pages &&
                item !== current &&
                'hidden sm:list-item',
            )}
          >
            {typeof item === 'number' ? (
              <PaginationLink
                href="#"
                aria-label={t('goToPage', { page: item })}
                isActive={item === current}
                tabIndex={hidden ? -1 : undefined}
                onClick={(event) => navigate(event, item)}
              >
                {item}
              </PaginationLink>
            ) : (
              <PaginationEllipsis />
            )}
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationNext
            href="#"
            text={t('nextPage')}
            aria-label={t('nextPage')}
            aria-disabled={hidden || current === pages}
            tabIndex={hidden || current === pages ? -1 : undefined}
            className={cn((hidden || current === pages) && 'pointer-events-none opacity-50')}
            onClick={(event) => navigate(event, current + 1)}
          />
        </PaginationItem>
      </PaginationContent>
    </PrimitivePagination>
  );
}
