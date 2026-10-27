import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { formatDuration } from '@ba/shared';
import { useI18n } from '../../hooks/useI18n';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

export function ApmChart({
  counts,
  bucketSec,
  durationSec,
  title,
}: {
  counts: number[];
  bucketSec: number;
  durationSec: number;
  title: string;
}) {
  const { t } = useI18n();
  const data = counts.map((actions, index) => {
    const start = index * bucketSec;
    const end = Math.min((index + 1) * bucketSec, durationSec);
    return {
      range: `${formatDuration(start)}–${formatDuration(end)}${end - start < bucketSec ? ' *' : ''}`,
      actions,
    };
  });
  const config = {
    actions: { label: t('totalActions'), color: 'var(--chart-1)' },
  } satisfies ChartConfig;
  return (
    <figure className="flex min-w-0 flex-col gap-3">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      <ChartContainer config={config} className="h-64 w-full" role="group" aria-label={title}>
        <LineChart accessibilityLayer data={data} margin={{ left: 0, right: 12, top: 12 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="range"
            tickLine={false}
            axisLine={false}
            tickMargin={10}
            minTickGap={30}
            tickFormatter={(value: string) => value.split('–')[0] ?? value}
          />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={40} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line
            dataKey="actions"
            type="linear"
            stroke="var(--color-actions)"
            strokeWidth={2}
            dot={data.length < 60}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
    </figure>
  );
}
