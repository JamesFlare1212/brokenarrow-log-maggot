import type { MatchScoreLabel } from '@ba/contracts';
import { formatMetric, MAX_SCORE_LABELS } from '@ba/shared';
import { TooltipButton } from '../../components/Tooltip';
import { useI18n } from '../../hooks/useI18n';

export function MatchScoreLabels({ labels }: { labels: MatchScoreLabel[] }) {
  const { t } = useI18n();
  const evidence = (label: MatchScoreLabel) => {
    const facts = label.evidence;
    if (!facts || !Object.values(facts).some((value) => value !== null && value !== undefined))
      return t('scoreLabel.evidence.unavailable');
    const params = Object.fromEntries(
      (
        [
          'destructionValue',
          'killed',
          'damageDealt',
          'damageReceived',
          'lossValue',
          'dlRatio',
          'investment',
          'refunded',
          'objectivesCaptured',
          'supplyProvided',
        ] as const
      ).map((key) => [key, formatMetric(facts[key] ?? null)]),
    );
    if (facts.lossValue === 0)
      params.dlRatio = facts.destructionValue != null && facts.destructionValue > 0 ? '∞' : '—';
    params.roi = facts.roi == null ? '—' : `${formatMetric(facts.roi * 100)}%`;
    return t(`scoreLabel.${label.id}.evidence`, params);
  };
  const visible = labels.slice(0, MAX_SCORE_LABELS);
  if (!visible.length) return null;
  return (
    <div className="match-score-labels" role="group" aria-label={t('scoreLabels')}>
      {visible.map((label) => (
        <TooltipButton
          key={label.id}
          className="match-score-label-button"
          pinOnClick
          tooltip={
            <>
              <span className="match-award-tooltip-header match-award-tooltip-score">
                <span className="match-award-tooltip-category">{t('scoreLabels')}</span>
                <span className="button-tooltip-label match-award-tooltip-name">
                  {t(`scoreLabel.${label.id}`)}
                </span>
              </span>
              <span className="match-title-rule-heading">{t('title.condition.heading')}</span>
              <span className="button-tooltip-detail">
                {t('scoreLabel.condition', { metric: t(`scoreLabel.${label.id}.metric`) })}
              </span>
              <span className="button-tooltip-detail">
                {t('scoreLabel.limit', { limit: MAX_SCORE_LABELS })}
              </span>
              <span className="match-title-rule-heading">{t('title.condition.evidence')}</span>
              <span className="button-tooltip-detail match-title-detail">{evidence(label)}</span>
            </>
          }
        >
          <span className="match-award-label">{t(`scoreLabel.${label.id}`)}</span>
        </TooltipButton>
      ))}
    </div>
  );
}
