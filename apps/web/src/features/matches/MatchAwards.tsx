import type { MatchScoreLabel, MatchTitle } from '@ba/contracts';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { TooltipBadge } from '../../components/Tooltip';
import { useI18n } from '../../hooks/useI18n';
import { matchAwardGroups, type MatchAward } from './award-model';

const awardColors: Record<MatchAward['tone'], string> = {
  info: 'text-info',
  success: 'text-success',
  destructive: 'text-destructive',
  secondary: 'text-foreground',
};

export function MatchAwards({
  titles,
  scoreLabels = [],
}: {
  titles: MatchTitle[];
  scoreLabels?: MatchScoreLabel[];
}) {
  const { t } = useI18n();
  const groups = matchAwardGroups(titles, scoreLabels, t);
  if (!groups.length) return null;
  return (
    <>
      {groups.map((group) => (
        <div
          key={group.source}
          className="match-awards"
          data-award-source={group.source}
          role="group"
          aria-label={group.name}
        >
          {group.awards.map((award) => (
            <TooltipBadge
              key={award.id}
              variant={award.tone}
              className="match-award-button"
              data-award-id={award.id}
              tooltip={<AwardDetails award={award} />}
            >
              {award.name}
            </TooltipBadge>
          ))}
        </div>
      ))}
    </>
  );
}

function AwardDetails({ award }: { award: MatchAward }) {
  const { t } = useI18n();
  return (
    <>
      <h3
        className={cn('match-award-tooltip-name text-base font-semibold', awardColors[award.tone])}
      >
        {award.name}
      </h3>
      <p className="match-award-evidence text-sm leading-6">{award.evidence}</p>
      <Separator />
      <section className="flex flex-col gap-2">
        <h4 className="match-award-rule-heading text-xs font-semibold">
          {t('title.condition.heading')}
        </h4>
        <ul className="flex list-disc flex-col gap-2 pl-4 text-xs leading-5 text-muted-foreground">
          {award.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
