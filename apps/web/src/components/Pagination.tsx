import { faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { Icon } from './Icon';
import { useI18n } from '../hooks/useI18n';
import { Button } from './ui';

export function Pagination({
  page,
  pageSize,
  total,
  label,
  onPageChange,
  reserveSpace = false,
  showSinglePage = false,
}: {
  page: number;
  pageSize: number;
  total: number;
  label: string;
  onPageChange: (page: number) => void;
  reserveSpace?: boolean;
  showSinglePage?: boolean;
}) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const hidden = pages === 1 && !showSinglePage;
  if (hidden && !reserveSpace) return null;
  const currentPage = Math.max(1, Math.min(page, pages));
  return (
    <nav
      className={`pagination${hidden ? ' pagination-placeholder' : ''}`}
      aria-label={label}
      aria-hidden={hidden || undefined}
    >
      <p className="pagination-summary" role="status">
        {t('paginationRange', {
          start: total === 0 ? 0 : (currentPage - 1) * pageSize + 1,
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
          <Icon icon={faChevronLeft} size={16} />
        </Button>
        <select
          aria-label={t('pageNumber')}
          value={currentPage}
          disabled={pages === 1}
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
          <Icon icon={faChevronRight} size={16} />
        </Button>
      </div>
    </nav>
  );
}
