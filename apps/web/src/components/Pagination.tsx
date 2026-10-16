import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '../hooks/useI18n';
import { Button } from './ui';

export function Pagination({
  page,
  pageSize,
  total,
  label,
  onPageChange,
  reserveSpace = false,
}: {
  page: number;
  pageSize: number;
  total: number;
  label: string;
  onPageChange: (page: number) => void;
  reserveSpace?: boolean;
}) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages === 1 && !reserveSpace) return null;
  const currentPage = Math.max(1, Math.min(page, pages));
  return (
    <nav
      className={`pagination${pages === 1 ? ' pagination-placeholder' : ''}`}
      aria-label={label}
      aria-hidden={pages === 1 ? true : undefined}
    >
      <p className="pagination-summary" role="status">
        {t('paginationRange', {
          start: (currentPage - 1) * pageSize + 1,
          end: Math.min(currentPage * pageSize, total),
          total,
        })}
      </p>
      <div className="pagination-controls">
        <Button
          className="pagination-step"
          aria-label={t('previousPage')}
          title={t('previousPage')}
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <ChevronLeft size={16} />
        </Button>
        <select
          aria-label={t('pageNumber')}
          value={currentPage}
          onChange={(event) => onPageChange(Number(event.target.value))}
        >
          {Array.from({ length: pages }, (_, index) => (
            <option key={index + 1} value={index + 1}>
              {index + 1} / {pages}
            </option>
          ))}
        </select>
        <Button
          className="pagination-step"
          aria-label={t('nextPage')}
          title={t('nextPage')}
          disabled={currentPage === pages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          <ChevronRight size={16} />
        </Button>
      </div>
    </nav>
  );
}
