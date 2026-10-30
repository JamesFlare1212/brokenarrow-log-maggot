import type { RatingTrendPoint } from '@ba/contracts';

export function buildRatingTrend(points: readonly RatingTrendPoint[]) {
  const data = points.map((point, index) => ({
    ...point,
    matchNumber: index + 1,
    change:
      point.ratingBefore !== null && point.ratingAfter !== null
        ? point.ratingAfter - point.ratingBefore
        : null,
  }));
  const baseline = data[0]?.ratingBefore ?? null;
  const latest = data.at(-1)?.ratingAfter ?? null;
  const change = baseline !== null && latest !== null ? latest - baseline : null;
  const ratings = data.flatMap((point) => (point.ratingAfter === null ? [] : [point.ratingAfter]));
  const hasRatings = ratings.length > 0;
  if (baseline !== null) ratings.push(baseline);
  const minimum = ratings.length ? Math.min(...ratings) : 0;
  const maximum = ratings.length ? Math.max(...ratings) : 0;
  const padding = Math.max((maximum - minimum) * 0.15, 10);

  return {
    data,
    baseline,
    latest,
    change,
    hasRatings,
    domain: [Math.floor(minimum - padding), Math.ceil(maximum + padding)] as [number, number],
  };
}
