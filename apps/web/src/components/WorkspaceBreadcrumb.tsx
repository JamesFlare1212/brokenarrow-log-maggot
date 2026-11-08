import type { MouseEvent } from 'react';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { useApp } from '../app/state';
import { useI18n } from '../hooks/useI18n';
import { panelLabelKey } from '../lib/navigation';
import { cn } from '@/lib/utils';

function follow(event: MouseEvent<HTMLAnchorElement>, navigate: () => void) {
  if (event.button || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  event.preventDefault();
  navigate();
}

export function WorkspaceBreadcrumb() {
  const { page, setPage, breadcrumbs } = useApp();
  const { t } = useI18n();
  const detail = breadcrumbs[page];
  return (
    <Breadcrumb className="min-w-0" aria-label={t('breadcrumb')}>
      <BreadcrumbList>
        {page !== 'current' && (
          <>
            <BreadcrumbItem className="shrink-0 whitespace-nowrap workspace-max-36:hidden">
              <BreadcrumbLink
                href="#current"
                onClick={(event) => follow(event, () => setPage('current'))}
              >
                {t('overview')}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="shrink-0 workspace-max-36:hidden" />
          </>
        )}
        <BreadcrumbItem
          className={cn(detail && 'shrink-0 whitespace-nowrap', !detail && 'min-w-0')}
        >
          {detail ? (
            <BreadcrumbLink href={'#' + page} onClick={(event) => follow(event, detail.onBack)}>
              {t(panelLabelKey(page))}
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage>{t(panelLabelKey(page))}</BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {detail && (
          <>
            <BreadcrumbSeparator className="shrink-0" />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage>{detail.label}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
