import { createContext, useContext } from 'react';
import { ArrowDown, ArrowUpRight, Check, Info, Minus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TooltipButton } from '@/components/Tooltip';
import { cn } from '@/lib/utils';

export type Scenario = 'screenshot' | 'low' | 'partial';
type Sample = {
  index: number | null;
  rank: number | null;
  trend: 'up' | 'flat' | null;
  count: number;
};

export const samples: Record<Scenario, Sample> = {
  screenshot: { index: 7.5, rank: 3.6, trend: 'up', count: 12 },
  low: { index: 2.8, rank: 1.9, trend: 'flat', count: 12 },
  partial: { index: null, rank: null, trend: null, count: 7 },
};

function scoreColor(value: number | null) {
  return value === null
    ? 'text-muted-foreground'
    : value <= 3.5
      ? 'text-success'
      : value <= 7
        ? 'text-warning'
        : 'text-destructive';
}

function Score({ sample, compact = false }: { sample: Sample; compact?: boolean }) {
  return (
    <div
      className="flex items-baseline gap-2 tabular-nums"
      aria-label={`指数 ${sample.index ?? '暂无'}`}
    >
      <strong
        className={cn(
          'font-semibold leading-none tracking-[-0.055em]',
          compact ? 'text-[2.75rem]' : 'text-[3.75rem]',
          scoreColor(sample.index),
        )}
      >
        {sample.index?.toFixed(1) ?? '—'}
      </strong>
      <span className="text-sm text-muted-foreground">/ 10</span>
    </div>
  );
}

function Trend({ sample, large = false }: { sample: Sample; large?: boolean }) {
  const improving = sample.trend === 'up';
  const Icon = improving ? ArrowUpRight : Minus;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-medium',
        large ? 'text-xl' : 'text-sm',
        improving && 'text-success',
        !sample.trend && 'text-muted-foreground',
      )}
    >
      {sample.trend && <Icon aria-hidden="true" className={large ? 'size-5' : 'size-4'} />}
      {sample.trend ? (improving ? '变强' : '稳定') : '—'}
    </span>
  );
}

function Header({ sample }: { sample: Sample }) {
  const explanation =
    sample.count === 12
      ? '基于最近 12 场有效排位'
      : `已收集 ${sample.count} / 12 场有效排位，还需 ${Math.max(0, 12 - sample.count)} 场。`;
  return (
    <CardHeader>
      <CardTitle className="flex items-center gap-1">
        蛐指数
        <TooltipButton
          variant="ghost"
          size="icon-xs"
          aria-label="查看蛐指数样本说明"
          tooltip={explanation}
          pinOnClick
        >
          <Info aria-hidden="true" />
        </TooltipButton>
      </CardTitle>
      <CardAction className="self-center">
        <Badge variant="outline">
          {sample.count === 12 && <Check data-icon="inline-start" aria-hidden="true" />}
          {sample.count === 12 ? '已计算' : '样本不足'}
        </Badge>
      </CardAction>
    </CardHeader>
  );
}

function NumericCard({ sample }: { sample: Sample }) {
  return (
    <Card size="sm" className="min-w-0 gap-4" aria-label="方案 A：数字优先">
      <Header sample={sample} />
      <CardContent className="flex flex-1 flex-col justify-between gap-6">
        <div className="flex items-end justify-between gap-3">
          <Score sample={sample} />
          <p className="pb-1 text-right text-xs leading-relaxed text-muted-foreground">
            指数越低
            <br />
            表现越好
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <dt className="text-xs text-muted-foreground">平均 MVP 名次</dt>
            <dd className="text-xl font-medium leading-none tabular-nums">
              {sample.rank?.toFixed(1) ?? '—'}
            </dd>
          </div>
          <div className="flex flex-col gap-1.5">
            <dt className="text-xs text-muted-foreground">近期趋势</dt>
            <dd className="leading-none">
              <Trend sample={sample} large />
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function IndexScale({ sample }: { sample: Sample }) {
  const position = 6 + (sample.index ?? 0) * 28.8;
  return (
    <svg
      viewBox="0 0 300 44"
      className="h-12 w-full overflow-visible"
      role="img"
      aria-label={
        sample.index === null ? '样本不足，尚无刻度位置' : `指数 ${sample.index}，0 到 10，越低越好`
      }
    >
      <rect x="6" y="12" width="100" height="5" rx="2.5" className="fill-success/35" />
      <rect x="109" y="12" width="97" height="5" rx="2.5" className="fill-warning/35" />
      <rect x="209" y="12" width="85" height="5" rx="2.5" className="fill-destructive/35" />
      {sample.index !== null && (
        <path
          d={`M ${position - 3} 4 L ${position} 8 L ${position + 3} 4 M ${position} 8 V 22`}
          className="fill-none stroke-foreground"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      <g className="fill-muted-foreground text-[10px] tabular-nums">
        <text x="6" y="39">
          0
        </text>
        <text x="107" y="39" textAnchor="middle">
          3.5
        </text>
        <text x="207" y="39" textAnchor="middle">
          7
        </text>
        <text x="294" y="39" textAnchor="end">
          10
        </text>
      </g>
    </svg>
  );
}

function ScaleCard({ sample }: { sample: Sample }) {
  return (
    <Card size="sm" className="min-w-0 gap-4" aria-label="方案 B：刻度定位">
      <Header sample={sample} />
      <CardContent className="flex flex-1 flex-col justify-between gap-3">
        <div className="flex items-end justify-between gap-3">
          <Score sample={sample} compact />
          <p className="pb-0.5 text-xs text-muted-foreground">指数越低，表现越好</p>
        </div>
        <IndexScale sample={sample} />
        <dl className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 text-xs">
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">平均 MVP 名次</dt>
            <dd className="text-base font-medium tabular-nums">{sample.rank?.toFixed(1) ?? '—'}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="sr-only">近期趋势</dt>
            <dd>
              <Trend sample={sample} />
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function RingCard({ sample }: { sample: Sample }) {
  return (
    <Card size="sm" className="min-w-0 gap-4" aria-label="方案 C：环形概览">
      <Header sample={sample} />
      <CardContent className="flex flex-1 flex-col justify-center gap-3">
        <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-6">
          <div className="relative size-30">
            <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
              <circle
                cx="60"
                cy="60"
                r="50"
                fill="none"
                strokeWidth="5"
                className="stroke-border/60"
              />
              <circle
                cx="60"
                cy="60"
                r="50"
                fill="none"
                strokeWidth="5"
                pathLength="100"
                strokeDasharray={`${(sample.index ?? 0) * 10} 100`}
                strokeLinecap="round"
                className={cn(
                  sample.index === null
                    ? 'stroke-transparent'
                    : sample.index <= 3.5
                      ? 'stroke-success'
                      : sample.index <= 7
                        ? 'stroke-warning'
                        : 'stroke-destructive',
                )}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
              <strong
                className={cn(
                  'text-4xl font-semibold leading-none tracking-[-0.045em] tabular-nums',
                  scoreColor(sample.index),
                )}
              >
                {sample.index?.toFixed(1) ?? '—'}
              </strong>
              <span className="text-xs text-muted-foreground">/ 10</span>
            </div>
          </div>
          <dl className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">平均 MVP 名次</dt>
              <dd className="text-2xl font-medium leading-tight tabular-nums">
                {sample.rank?.toFixed(1) ?? '—'}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">近期趋势</dt>
              <dd>
                <Trend sample={sample} />
              </dd>
            </div>
          </dl>
        </div>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <ArrowDown className="size-3" aria-hidden="true" />
          指数越低，表现越好
        </p>
      </CardContent>
    </Card>
  );
}

export const concepts = [
  {
    id: 'A',
    name: '数字优先',
    component: NumericCard,
    description: '大数字作为第一落点，MVP 名次与趋势分列在下方。',
    detail: '层级清楚，最贴近现有界面。',
  },
  {
    id: 'B',
    name: '刻度定位',
    component: ScaleCard,
    description: '用一条横向刻度解释分数，直接看到当前指数在 0–10 中的位置。',
    detail: '让“越低越好”更容易理解。',
  },
  {
    id: 'C',
    name: '环形概览',
    component: RingCard,
    description: '以环形仪表承载指数，右侧集中放置两项辅助数据。',
    detail: '形态更鲜明，适合独立展示。',
  },
];

export type ConceptId = 'A' | 'B' | 'C';
export const ConceptContext = createContext<{ concept: ConceptId; scenario: Scenario }>({
  concept: 'A',
  scenario: 'screenshot',
});

export function ContextMaggotCard() {
  const { concept, scenario } = useContext(ConceptContext);
  const Component = concepts.find((entry) => entry.id === concept)!.component;
  return <Component sample={samples[scenario]} />;
}
