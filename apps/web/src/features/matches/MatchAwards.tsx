import type { MatchScoreLabel, MatchTitle } from '@ba/contracts';
import { MatchScoreLabels } from './MatchScoreLabels';
import { MatchTitles } from './MatchTitles';

export function MatchAwards({
  titles,
  scoreLabels = [],
}: {
  titles: MatchTitle[];
  scoreLabels?: MatchScoreLabel[];
}) {
  if (!titles.length && !scoreLabels.length) return null;
  return (
    <>
      <MatchTitles titles={titles} />
      <MatchScoreLabels labels={scoreLabels} />
    </>
  );
}
