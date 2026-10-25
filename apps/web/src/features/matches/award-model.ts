import type { MatchScoreLabel, MatchTitle } from '@ba/contracts';
import { formatMetric, MAX_SCORE_LABELS, MAX_TITLES, titleConditionDetails } from '@ba/shared';
import type { useI18n } from '../../hooks/useI18n';

type Translate = ReturnType<typeof useI18n>['t'];

export interface MatchAward {
  id: string;
  name: string;
  tone: 'success' | 'destructive' | 'secondary' | 'info';
  evidence: string;
  rules: string[];
}

export interface MatchAwardGroup {
  source: 'title' | 'score';
  name: string;
  awards: MatchAward[];
}

/** Adapt both rule families to one view model without changing their independent limits. */
export function matchAwardGroups(
  titles: MatchTitle[],
  scoreLabels: MatchScoreLabel[],
  t: Translate,
): MatchAwardGroup[] {
  return [
    {
      source: 'title' as const,
      name: t('matchTitles'),
      awards: titles.slice(0, MAX_TITLES).map((title) => titleAward(title, t)),
    },
    {
      source: 'score' as const,
      name: t('scoreLabels'),
      awards: scoreLabels.slice(0, MAX_SCORE_LABELS).map((label) => scoreAward(label, t)),
    },
  ].filter((group) => group.awards.length > 0);
}

function titleAward(title: MatchTitle, t: Translate): MatchAward {
  const condition = titleConditionDetails(title.id);
  const netTitle = ['carry', 'blame', 'tryhard', 'passenger', 'lonewolf'].includes(title.id);
  return {
    id: title.id,
    name: t(`title.${title.id}`),
    tone: title.kind === 'good' ? 'success' : title.kind === 'bad' ? 'destructive' : 'secondary',
    evidence: t(
      title.id === 'deserter' ? `title.deserter.${title.params.reason}` : `title.${title.id}.tip`,
      Object.fromEntries(Object.entries(title.params).map(([key, value]) => [key, String(value)])),
    ),
    rules: [
      t(condition.key, condition.params),
      ...(netTitle
        ? [
            t(
              condition.params.objectiveValue === 0
                ? 'title.condition.net'
                : 'title.condition.netWeighted',
              condition.params,
            ),
          ]
        : []),
      ...(condition.eligibility ? [t(condition.eligibility)] : []),
      ...(condition.selection ? [t(condition.selection)] : []),
      t('title.condition.limit', condition.params),
    ],
  };
}

function scoreAward(label: MatchScoreLabel, t: Translate): MatchAward {
  return {
    id: label.id,
    name: t(`scoreLabel.${label.id}`),
    tone: 'info',
    evidence: scoreEvidence(label, t),
    rules: [
      t('scoreLabel.condition', { metric: t(`scoreLabel.${label.id}.metric`) }),
      t('scoreLabel.limit', { limit: MAX_SCORE_LABELS }),
    ],
  };
}

function scoreEvidence(label: MatchScoreLabel, t: Translate): string {
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
}
