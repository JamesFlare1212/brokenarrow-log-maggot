import type { MatchTitle } from '@ba/contracts';
import { titleConditionDetails } from '@ba/shared';
import { TooltipButton } from '../../components/Tooltip';
import { useI18n } from '../../hooks/useI18n';

export function MatchTitles({
  titles,
  labelled = false,
}: {
  titles: MatchTitle[];
  labelled?: boolean;
}) {
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
      {labelled && (
        <span className="match-award-caption" aria-hidden="true">
          {t('matchTitles.short')}
        </span>
      )}
      {visible.map((title) => {
        const condition = titleConditionDetails(title.id);
        const netTitle = ['carry', 'blame', 'tryhard', 'passenger', 'lonewolf'].includes(title.id);
        return (
          <TooltipButton
            key={title.id}
            className={`match-title-button match-title-${title.kind}`}
            pinOnClick
            tooltip={
              <>
                <span className="match-title-rule-heading">{t('title.condition.heading')}</span>
                <span className="button-tooltip-detail">{t(condition.key, condition.params)}</span>
                {netTitle && (
                  <span className="button-tooltip-detail">
                    {t(
                      condition.params.objectiveValue === 0
                        ? 'title.condition.net'
                        : 'title.condition.netWeighted',
                      condition.params,
                    )}
                  </span>
                )}
                {condition.eligibility && (
                  <span className="button-tooltip-detail">{t(condition.eligibility)}</span>
                )}
                {condition.selection && (
                  <span className="button-tooltip-detail">{t(condition.selection)}</span>
                )}
                <span className="button-tooltip-detail">
                  {t('title.condition.limit', condition.params)}
                </span>
                <span className="match-title-rule-heading">{t('title.condition.evidence')}</span>
                <span className="button-tooltip-detail match-title-detail">
                  {description(title)}
                </span>
              </>
            }
          >
            <span className="match-award-label">{t(`title.${title.id}`)}</span>
          </TooltipButton>
        );
      })}
    </div>
  );
}
