import { useLayoutEffect, useState, type RefObject } from 'react';
import { ArrowDownUp, ArrowLeftRight } from 'lucide-react';
import { useI18n } from '../hooks/useI18n';

export function OverflowHint({
  viewport,
  axis = 'horizontal',
  compact = false,
}: {
  viewport: RefObject<HTMLElement | null>;
  axis?: 'horizontal' | 'both';
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [overflow, setOverflow] = useState<'none' | 'horizontal' | 'vertical' | 'both'>('none');
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      const horizontal = element.scrollWidth > element.clientWidth + 1;
      const vertical = axis === 'both' && element.scrollHeight > element.clientHeight + 1;
      setOverflow(horizontal ? (vertical ? 'both' : 'horizontal') : vertical ? 'vertical' : 'none');
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const table = element.querySelector('table');
    if (table) observer.observe(table);
    measure();
    return () => observer.disconnect();
  });
  return overflow !== 'none' ? (
    <p
      className="table-overflow-hint flex shrink-0 items-center gap-1.5 py-1.5 px-3 text-muted-foreground text-[0.75rem] leading-[1.25rem] [&_svg]:w-4 [&_svg]:h-4 [&_svg]:shrink-0 [.profile-unit-actions_&]:min-w-0 [.profile-unit-actions_&]:m-0 [.profile-unit-actions_&]:p-0 [.profile-unit-actions_&]:whitespace-nowrap"
      aria-hidden="true"
    >
      {overflow === 'vertical' ? (
        <ArrowDownUp aria-hidden="true" />
      ) : (
        <ArrowLeftRight aria-hidden="true" />
      )}
      {t(
        compact
          ? 'tableScrollCompactHint'
          : overflow === 'horizontal'
            ? 'tableScrollHint'
            : overflow === 'vertical'
              ? 'tableScrollRowsHint'
              : 'tableScrollBothHint',
      )}
    </p>
  ) : null;
}
