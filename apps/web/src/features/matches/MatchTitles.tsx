import type { MatchTitle } from '@ba/contracts';
import { TooltipButton } from '../../components/Tooltip';
import { useI18n } from '../../hooks/useI18n';

export function MatchTitles({ titles }: { titles: MatchTitle[] }) {
  const { t } = useI18n();
  const description = (title: MatchTitle) =>
    t(
      title.id === 'deserter' ? `title.deserter.${title.params.reason}` : `title.${title.id}.tip`,
      Object.fromEntries(Object.entries(title.params).map(([key, value]) => [key, String(value)])),
    );
  const visible = titles.slice(0, 2);
  if (!visible.length) return null;
  return (
    <div className="match-titles" role="group" aria-label={t('matchTitles')}>
      {visible.map((title) => (
        <TooltipButton
          key={title.id}
          className={`match-title-button match-title-${title.kind}`}
          pinOnClick
          tooltip={
            <>
              <span className="button-tooltip-label">{t(`title.${title.id}`)}</span>
              <span className="button-tooltip-detail match-title-detail">{description(title)}</span>
            </>
          }
        >
          {t(`title.${title.id}`)}
        </TooltipButton>
      ))}
    </div>
  );
}
