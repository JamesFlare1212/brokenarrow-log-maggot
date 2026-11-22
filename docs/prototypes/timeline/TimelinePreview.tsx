import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUp,
  ArrowUpToLine,
  ArrowRight,
  ChartLine,
  ZoomIn,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Info,
  Moon,
  Sun,
  Clock3,
  X,
} from 'lucide-react';
import {
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Bar,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  buildTimeline,
  clock,
  pointAt,
  minuteBuckets,
  niceScale,
  timeWindow,
  type Moment,
  type Point,
  type RawMatch,
  type UnitCatalog,
} from './model';
import { EventMarkers, eventKindLabels } from './EventMarkers';
import { PlotSelection, PlotSelectionRoot } from './PlotSelection';
import '@/styles/index.css';
import './preview.css';

// Injected from checksum-verified, committed fixtures by the isolated build.
declare const __TIMELINE_SOURCE__: {
  match: RawMatch;
  catalog: UnitCatalog;
  provenance: { map: string; matchId: string };
};
const source = __TIMELINE_SOURCE__;
const data = buildTimeline(source.match, source.catalog);
const lossBuckets = minuteBuckets(data.points);
const number = (value: number) => Math.round(value).toLocaleString('en-US');
const signed = (value: number) => `${value > 0 ? '+' : ''}${number(value)}`;
const compact = (value: number) =>
  Math.abs(value) >= 1000 ? `${Math.round(value / 100) / 10}k` : String(value);
const chartConfig = {
  alpha: { label: 'Alpha', color: 'var(--info)' },
  bravo: { label: 'Bravo', color: 'var(--warning)' },
};
const chartMargin = { top: 10, right: 14, left: 0, bottom: 0 };
const ticks = [0, 300, 600, 900, 1200, data.duration];
const modes = [
  { id: 'force', label: '兵力', title: '兵力价值', unit: '点' },
  { id: 'difference', label: '兵力差', title: '兵力差', unit: 'Alpha − Bravo · 点' },
  { id: 'change', label: '净变化', title: '兵力净变化', unit: '近 60 秒 · 点' },
] as const;
type View = (typeof modes)[number]['id'];

function selectRadioWithArrow(
  event: KeyboardEvent<HTMLDivElement>,
  values: string[],
  select: (value: string) => void,
) {
  const direction = ['ArrowRight', 'ArrowDown'].includes(event.key)
    ? 1
    : ['ArrowLeft', 'ArrowUp'].includes(event.key)
      ? -1
      : 0;
  if (!direction && event.key !== 'Home' && event.key !== 'End') return;
  const current = (event.target as HTMLElement).closest<HTMLElement>('[data-choice]')?.dataset
    .choice;
  if (!current) return;
  event.preventDefault();
  event.stopPropagation();
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? values.length - 1
        : (values.indexOf(current) + direction + values.length) % values.length;
  const value = values[index]!;
  select(value);
  event.currentTarget.querySelector<HTMLButtonElement>(`[data-choice="${value}"]`)?.focus();
}

function TeamMark({ team }: { team: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block w-4 shrink-0 border-t-2',
        team === 0 ? 'border-info' : 'border-warning border-dashed',
      )}
    />
  );
}

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function MethodNote() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="link"
          className="px-0 has-data-[icon=inline-end]:pr-0"
          aria-label="估算 · 点：数据口径"
        >
          估算 · 点<Info data-icon="inline-end" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-32px)]">
        <div className="flex flex-col gap-3 text-sm leading-relaxed">
          <h3 className="font-medium">数据口径</h3>
          <p>
            兵力价值为估算：按单位基础价分摊玩家官方出兵与损失总分，再计算累计出兵减损失。无配装价格，回收单位不计入曲线；不代表实时在场兵力。
          </p>
          <p>
            按记录的出场、阵亡秒数更新曲线。净变化为近 60 秒的价值变化。损失柱按分钟汇总，末段仅 19
            秒。区间标记位于区间中点；数字表示相邻时刻，可点击选择并定位到事件。
          </p>
          <p>
            高光只定位到出场区间；击杀数是本次出场累计值，不代表击杀发生在标记瞬间。侦察仅标出部署，不推断因果。
          </p>
          <Separator />
          <p className="text-sm text-foreground/80">
            BATrace 离线存档 · #{source.provenance.matchId}
            <br />
            单位名称与基础价均来自本仓库已有数据。
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LocalizedDialogClose() {
  return (
    <DialogClose asChild>
      <Button variant="ghost" size="icon-sm" className="absolute top-2 right-2" aria-label="关闭">
        <X />
      </Button>
    </DialogClose>
  );
}

function TableScroll({
  children,
  count,
  label,
  revealSelected = false,
  rowsPerViewport,
}: {
  children: ReactNode;
  count: number;
  label: string;
  revealSelected?: boolean;
  rowsPerViewport?: number;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [hasMore, setHasMore] = useState(true);
  const [atStart, setAtStart] = useState(true);
  const [scrollable, setScrollable] = useState(false);
  const [visibleRows, setVisibleRows] = useState({ first: 0, last: 0 });
  const viewport = () =>
    holder.current?.querySelector<HTMLDivElement>('[data-slot="table-container"]');
  const pageStep = () => {
    const element = viewport();
    const row = element?.querySelector<HTMLTableRowElement>('tbody tr');
    return rowsPerViewport && row
      ? row.offsetHeight * Math.max(1, rowsPerViewport - 1)
      : (element?.clientHeight ?? 0) * 0.75;
  };
  const update = () => {
    const element = viewport();
    if (element) {
      const bounds = element.getBoundingClientRect();
      const lastRow = element.querySelector('tbody tr:last-child')?.getBoundingClientRect();
      setHasMore(
        element.scrollHeight - element.scrollTop - element.clientHeight > 1 ||
          (lastRow !== undefined && lastRow.bottom > bounds.bottom + 1),
      );
      setAtStart(element.scrollTop <= 1);
      setScrollable(element.scrollHeight > element.clientHeight + 1);
      const headerHeight = element.querySelector('thead')?.getBoundingClientRect().height ?? 0;
      const visible = [...element.querySelectorAll('tbody tr')]
        .map((row, index) => ({ index, bounds: row.getBoundingClientRect() }))
        .filter(
          (row) =>
            row.bounds.top >= bounds.top + headerHeight - 1 &&
            row.bounds.bottom <= bounds.bottom + 1,
        );
      const next = {
        first: visible.length ? visible[0]!.index + 1 : 0,
        last: visible.length ? visible.at(-1)!.index + 1 : 0,
      };
      setVisibleRows((previous) =>
        previous.first === next.first && previous.last === next.last ? previous : next,
      );
    }
  };
  useLayoutEffect(() => {
    let disposed = false;
    const settle = () => {
      const element = viewport();
      if (rowsPerViewport && element) {
        const header = element.querySelector<HTMLTableSectionElement>('thead');
        const rows = [...element.querySelectorAll<HTMLTableRowElement>('tbody tr')].slice(
          0,
          rowsPerViewport,
        );
        // A calculated native viewport budget keeps the initial minute table on
        // complete row boundaries instead of teasing a clipped final record.
        holder.current?.style.setProperty(
          '--table-viewport-height',
          `${(header?.offsetHeight ?? 0) + rows.reduce((height, row) => height + row.offsetHeight, 0)}px`,
        );
      }
      const selectedRow = holder.current?.querySelector<HTMLElement>('tr[data-state="selected"]');
      if (revealSelected && element && selectedRow) {
        const contentTop = element.getBoundingClientRect().top - element.scrollTop;
        const headerHeight = element.querySelector('thead')?.getBoundingClientRect().height ?? 0;
        const selectedTop = selectedRow.getBoundingClientRect().top - contentTop;
        const maximum = element.scrollHeight - element.clientHeight;
        const desired = Math.max(
          0,
          Math.min(
            maximum,
            selectedTop - (element.clientHeight + headerHeight) / 2 + selectedRow.offsetHeight / 2,
          ),
        );
        const boundaries = [...element.querySelectorAll('tbody tr')]
          .map((row) => row.getBoundingClientRect().top - contentTop - headerHeight)
          .filter((top) => top >= 0 && top <= desired);
        const aligned = Math.max(0, ...boundaries);
        element.scrollTop =
          selectedTop + selectedRow.offsetHeight - aligned > element.clientHeight
            ? maximum
            : aligned;
      }
      element?.dispatchEvent(new Event('scroll'));
      update();
    };
    settle();
    // Dialog scale transforms do not notify ResizeObserver. Recompute the shared
    // sticky-table clips once the opening animation has reached its final geometry.
    const frame = requestAnimationFrame(() => {
      const dialog = holder.current?.closest('[data-slot="dialog-content"]');
      void Promise.all(
        (dialog?.getAnimations() ?? []).map((animation) =>
          animation.finished.catch(() => undefined),
        ),
      ).then(() => {
        if (!disposed) settle();
      });
    });
    const observer = new ResizeObserver(update);
    if (viewport()) observer.observe(viewport()!);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div
        ref={holder}
        role="region"
        aria-label={label}
        tabIndex={0}
        onScrollCapture={update}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const element = viewport();
          if (!element) return;
          if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            if (event.key === 'Home' || event.key === 'End')
              element.scrollTo({ top: event.key === 'Home' ? 0 : element.scrollHeight });
            else
              element.scrollBy({
                top:
                  (event.key.includes('Down') ? 1 : -1) *
                  (event.key.startsWith('Page')
                    ? pageStep()
                    : rowsPerViewport
                      ? (element.querySelector<HTMLTableRowElement>('tbody tr')?.offsetHeight ?? 40)
                      : 40),
              });
          }
        }}
        className={cn(
          'min-h-0 rounded-md focus-visible:outline-2 focus-visible:outline-ring [&_[data-slot=table-container]]:max-h-[min(20rem,var(--table-viewport-height,20rem))] [&_[data-slot=table-container]]:overflow-auto sm:[&_[data-slot=table-container]]:max-h-[min(24rem,var(--table-viewport-height,24rem))]',
          rowsPerViewport &&
            '[&_[data-slot=table-container]]:max-h-[min(24rem,var(--table-viewport-height,24rem))]',
        )}
      >
        {children}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-foreground/80">
        <span className="min-w-24 tabular-nums" data-testid="table-scroll-status">
          浏览 {visibleRows.first}–{visibleRows.last} / {count} 条
        </span>
        {scrollable && (
          <div className="flex max-w-full flex-wrap items-center gap-1">
            <IconAction
              label="回到顶部"
              disabled={atStart}
              onClick={() => viewport()?.scrollTo({ top: 0 })}
            >
              <ArrowUpToLine />
            </IconAction>
            <Button
              variant="outline"
              size="default"
              disabled={atStart}
              onClick={() => viewport()?.scrollBy({ top: -pageStep() })}
            >
              <ChevronUp data-icon="inline-start" />
              查看上一段
            </Button>
            <Button
              variant="outline"
              size="default"
              disabled={!hasMore}
              onClick={() => viewport()?.scrollBy({ top: pageStep() })}
            >
              查看下一段
              <ChevronDown data-icon="inline-end" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function RecordDialog({ moment }: { moment: Moment }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="default" className="max-sm:min-h-10">
          {moment.sorties.length} 条记录
          <ChevronRight data-icon="inline-end" />
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-xl max-sm:[&_button]:min-h-11 max-sm:[&_button]:min-w-11"
      >
        <DialogHeader>
          <DialogTitle>{moment.player} · 阵亡记录</DialogTitle>
          <LocalizedDialogClose />
          <DialogDescription>
            {clock(moment.start)}–{clock(moment.end)} · 估算损失 {number(moment.value)} 点
          </DialogDescription>
        </DialogHeader>
        <TableScroll label="阵亡记录表" count={moment.sorties.length}>
          <Table stickyHeader>
            <TableHeader>
              <TableRow>
                <TableHead>阵亡</TableHead>
                <TableHead>单位 / 玩家</TableHead>
                <TableHead className="text-right">估算价值</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {moment.sorties
                .slice()
                .sort((a, b) => a.death! - b.death!)
                .map((unit) => (
                  <TableRow key={unit.id}>
                    <TableCell className="align-top font-mono text-sm tabular-nums">
                      {clock(unit.death!)}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <p className="font-medium">{unit.unit}</p>
                      <p className="mt-1 break-all text-sm text-foreground/80">{unit.player}</p>
                    </TableCell>
                    <TableCell className="text-right align-top tabular-nums">
                      ≈{number(unit.lossCost)}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableScroll>
      </DialogContent>
    </Dialog>
  );
}

function MinuteTable({ second, onSeek }: { second: number; onSeek: (time: number) => void }) {
  const [open, setOpen] = useState(false);
  const pendingSeek = useRef<number | null>(null);
  const selectedPoint = pointAt(data.points, second);
  const selectedMinute = selectedPoint.second;
  const intervalStart = data.points[Math.max(0, data.points.indexOf(selectedPoint) - 1)]!.second;
  const seek = (time: number) => {
    pendingSeek.current = time;
    setOpen(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value) pendingSeek.current = null;
        setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="default" className="max-sm:min-h-10">
          分钟数据
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          const time = pendingSeek.current;
          if (time === null) return;
          pendingSeek.current = null;
          event.preventDefault();
          onSeek(time);
        }}
        className="max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-xl max-sm:[&_button]:min-h-11 max-sm:[&_button]:min-w-11"
      >
        <DialogHeader>
          <DialogTitle className="pr-8">
            分钟数据 · 当前定位{' '}
            {selectedMinute === 0
              ? '开局 00:00'
              : `${clock(intervalStart)}–${clock(selectedMinute)}`}
          </DialogTitle>
          <LocalizedDialogClose />
          <DialogDescription>
            {selectedMinute === 0 ? '开局兵力' : '区间末兵力与区间损失'} · 估算点数
          </DialogDescription>
        </DialogHeader>
        <TableScroll
          label="分钟数据表"
          count={data.points.length}
          revealSelected
          rowsPerViewport={6}
        >
          <Table stickyHeader className="text-sm [&_th]:px-1 [&_td]:px-1">
            <TableHeader>
              <TableRow>
                <TableHead rowSpan={2}>区间末</TableHead>
                <TableHead colSpan={2} className="text-center">
                  Alpha
                </TableHead>
                <TableHead colSpan={2} className="text-center">
                  Bravo
                </TableHead>
              </TableRow>
              <TableRow>
                {['alpha-force', 'alpha-loss', 'bravo-force', 'bravo-loss'].map((key, index) => (
                  <TableHead key={key} className="text-right">
                    {index % 2 === 0 ? '兵力' : '损失'}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.points.map((point) => (
                <TableRow
                  key={point.second}
                  emphasis="current"
                  data-state={point.second === selectedMinute ? 'selected' : undefined}
                  aria-current={point.second === selectedMinute ? 'time' : undefined}
                  className="cursor-pointer data-[state=selected]:font-semibold"
                  onClick={() => seek(point.second)}
                >
                  <TableCell className="py-0 font-mono text-sm tabular-nums">
                    <Button
                      variant="link"
                      className="px-0 has-data-[icon=inline-end]:pr-0"
                      aria-label={`定位到 ${clock(point.second)}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        seek(point.second);
                      }}
                    >
                      {clock(point.second)}
                      <ArrowRight data-icon="inline-end" />
                    </Button>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{number(point.alpha)}</TableCell>
                  <TableCell className="text-right tabular-nums text-foreground/80">
                    {number(point.alphaLoss)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{number(point.bravo)}</TableCell>
                  <TableCell className="text-right tabular-nums text-foreground/80">
                    {number(point.bravoLoss)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      </DialogContent>
    </Dialog>
  );
}

function Evidence({
  moment,
  onViewChart,
  inContext = false,
  showInspect = true,
}: {
  moment: Moment;
  onViewChart: () => void;
  inContext?: boolean;
  showInspect?: boolean;
}) {
  const single = moment.sorties.length === 1 ? moment.sorties[0] : null;
  if (!inContext && !showInspect && moment.kind === 'recon') return null;
  const attribution = (
    <div
      className="flex flex-wrap items-center gap-x-1.5 text-sm text-foreground/80"
      data-testid="event-attribution"
    >
      <TeamMark team={moment.team} />
      {single && <span className="sr-only">{moment.team === 0 ? 'Alpha' : 'Bravo'} · </span>}
      <span>
        {moment.player} · {moment.title}
      </span>
      {single && moment.kind === 'loss' && (
        <span className="font-medium text-foreground">· ≈{number(moment.value)}</span>
      )}
    </div>
  );
  return (
    <div
      className={cn('flex flex-col', inContext ? 'gap-1' : 'gap-3 pb-3 pl-4 pr-3 sm:pl-26')}
      data-testid={inContext ? 'context-evidence' : 'event-evidence'}
    >
      {inContext && single && attribution}
      {single && moment.kind !== 'recon' && (
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div className={cn(inContext && 'flex items-baseline gap-1')}>
            <dt className="text-foreground/80">存活</dt>
            <dd className={cn('font-medium tabular-nums', !inContext && 'mt-1')}>
              {moment.end - moment.start} 秒
            </dd>
          </div>
          <div className={cn(inContext && 'flex items-baseline gap-1')}>
            <dt className="text-foreground/80">累计击杀</dt>
            <dd className={cn('font-medium tabular-nums', !inContext && 'mt-1')}>{single.kills}</dd>
          </div>
          <div className={cn(inContext && 'flex items-baseline gap-1')}>
            <dt className="text-foreground/80">累计伤害</dt>
            <dd className={cn('font-medium tabular-nums', !inContext && 'mt-1')}>
              {number(single.damage)}
            </dd>
          </div>
        </dl>
      )}
      {((!inContext && showInspect) || !single) && (
        <div
          className={cn(
            'flex flex-wrap items-center gap-1',
            !inContext && !showInspect ? 'justify-end' : 'justify-between',
          )}
        >
          {inContext ? (
            <div className="flex min-w-0 flex-1 flex-col">
              {attribution}
              <span className="text-sm tabular-nums">损失 ≈{number(moment.value)}</span>
            </div>
          ) : showInspect ? (
            <Button
              variant="ghost"
              size="default"
              className="max-sm:min-h-10"
              onClick={onViewChart}
              aria-label={`查看 ${clock(moment.start)} 附近 5 分钟`}
            >
              <ArrowUp data-icon="inline-start" />
              查看 5 分钟片段
            </Button>
          ) : null}
          {!single && <RecordDialog moment={moment} />}
        </div>
      )}
    </div>
  );
}

function ChartInteraction({
  children,
  name,
  second,
  summary,
  onTime,
  onPlotSelect = onTime,
  onPreviewChange,
  chartRef,
}: {
  children: ReactNode;
  name: string;
  second: number;
  summary: string;
  onTime: (second: number) => void;
  onPlotSelect?: (value: number) => void;
  onPreviewChange?: (value: number | null) => void;
  chartRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const values: Record<string, number> = {
      ArrowRight: second + 1,
      ArrowLeft: second - 1,
      PageUp: second + 60,
      PageDown: second - 60,
      Home: 0,
      End: data.duration,
    };
    if (event.key in values) {
      event.preventDefault();
      onTime(Math.max(0, Math.min(data.duration, values[event.key]!)));
    }
  };
  return (
    <PlotSelectionRoot
      ref={chartRef}
      onValueChange={onPlotSelect}
      onPreviewChange={onPreviewChange}
      role="slider"
      tabIndex={0}
      aria-label={name}
      aria-valuemin={0}
      aria-valuemax={data.duration}
      aria-valuenow={second}
      aria-valuetext={summary}
      aria-describedby="chart-keys chart-method"
      onKeyDown={keyDown}
      className="min-w-0 touch-pan-y touch-pinch-zoom rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {children}
    </PlotSelectionRoot>
  );
}

function TimelinePreview() {
  const [mode, setMode] = useState<View>('force');
  const [selected, setSelected] = useState<string | null>(null);
  const [second, setSecond] = useState(data.duration);
  const [hovered, setHovered] = useState<number | null>(null);
  const [player, setPlayer] = useState('all');
  const [kind, setKind] = useState('all');
  const [light, setLight] = useState(false);
  const [lossesExpanded, setLossesExpanded] = useState(() => globalThis.innerWidth >= 1100);
  const [chartExpanded, setChartExpanded] = useState(() => globalThis.innerWidth >= 1100);
  const [narrow, setNarrow] = useState(() => globalThis.innerWidth < 1100);
  useEffect(() => {
    const query = globalThis.matchMedia('(min-width: 1100px)');
    const change = () => {
      setLossesExpanded(query.matches);
      setChartExpanded(query.matches);
      setNarrow(!query.matches);
    };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  const [detail, setDetail] = useState(false);
  const [windowCenter, setWindowCenter] = useState(data.duration);
  const chartRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);
  const compactContextRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const eventRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const window = timeWindow(data.duration, windowCenter, detail);
  const frames = data.frames.filter(
    (point) => point.second >= window.start && point.second <= window.end,
  );
  const buckets = lossBuckets.filter(
    (point) => point.start >= window.start && point.second <= window.end,
  );
  const visibleTicks = detail
    ? [
        window.start,
        ...Array.from({ length: 5 }, (_, index) => window.start + (index + 1) * 60).filter(
          (time) => time < window.end,
        ),
        window.end,
      ]
    : ticks;
  const visible = data.moments.filter(
    (moment) =>
      (kind === 'all' || moment.kind === kind) &&
      (player === 'all' ||
        moment.playerId === player ||
        moment.sorties.some((unit) => unit.playerId === player)),
  );
  const active = visible.find((moment) => moment.id === selected);
  useLayoutEffect(() => {
    // Keep located event rows below whichever compact context surface is sticky.
    const update = () => {
      const sticky = narrow
        ? chartExpanded
          ? contextRef.current
          : compactContextRef.current
        : null;
      workspaceRef.current?.style.setProperty(
        '--timeline-context-height',
        `${Math.ceil(sticky?.getBoundingClientRect().height ?? 0) + 16}px`,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    if (cardRef.current) observer.observe(cardRef.current);
    if (contextRef.current) observer.observe(contextRef.current);
    if (compactContextRef.current) observer.observe(compactContextRef.current);
    return () => observer.disconnect();
  }, [narrow, chartExpanded, active?.id]);
  const current = data.frames[Math.round(hovered ?? second)]!;
  const atRangeStart = (time: number) =>
    !!active && active.end > active.start && time === active.start;
  const losses = pointAt(data.points, current.second, atRangeStart(current.second));
  const inspectedMinute = pointAt(data.points, second, atRangeStart(second));
  const windowAnchor = atRangeStart(second) ? (active!.start + active!.end) / 2 : second;
  const positionLabel =
    hovered !== null
      ? '悬停'
      : atRangeStart(second)
        ? '起点'
        : active && active.end > active.start && second === active.end
          ? '终点'
          : '定位';
  const lossStart = data.points[Math.max(0, data.points.indexOf(losses) - 1)]!.second;
  const currentMode = modes.find((item) => item.id === mode)!;
  const valueKeys: [keyof Point, keyof Point] =
    mode === 'change' ? ['alphaChange', 'bravoChange'] : ['alpha', 'bravo'];
  const forceScale = niceScale(
    frames.flatMap((point) =>
      mode === 'difference' ? [point.difference] : [point[valueKeys[0]], point[valueKeys[1]]],
    ),
  );
  const lossScale = niceScale(buckets.flatMap((point) => [point.alphaLoss, point.bravoLoss]));
  const overviewScale = niceScale(
    data.frames.flatMap((point) =>
      mode === 'difference' ? [point.difference] : [point[valueKeys[0]], point[valueKeys[1]]],
    ),
  );
  const selectMoment = (moment: Moment) => {
    if (narrow && chartExpanded && moment.id !== selected)
      setLossesExpanded(moment.kind === 'loss');
    setSelected(moment.id === selected ? null : moment.id);
    setSecond(moment.start);
    setWindowCenter((moment.start + moment.end) / 2);
    setHovered(null);
    if (narrow && !chartExpanded && moment.id !== selected) {
      requestAnimationFrame(() => {
        eventRefs.current[moment.id]?.parentElement?.scrollIntoView({
          behavior: 'instant',
          block: 'nearest',
        });
      });
    }
  };
  const locateMoment = (moment: Moment) => {
    setSelected(moment.id);
    setSecond(moment.start);
    setWindowCenter((moment.start + moment.end) / 2);
    setHovered(null);
    if (narrow && chartExpanded) setLossesExpanded(moment.kind === 'loss');
    requestAnimationFrame(() => {
      eventRefs.current[moment.id]?.scrollIntoView({ behavior: 'instant', block: 'nearest' });
      eventRefs.current[moment.id]?.focus({ preventScroll: true });
    });
  };
  const changeTime = (value: number) => {
    setSecond(value);
    if (value < window.start || value > window.end) setWindowCenter(value);
    setHovered(null);
  };
  const resetFilter = () => {
    setPlayer('all');
    setKind('all');
  };
  const previewLoss = (value: number | null) => {
    setHovered(
      value === null ? null : (buckets.find((point) => point.midpoint === value)?.second ?? null),
    );
  };
  const onLossSelect = (value: number) => {
    const bucket = buckets.find((point) => point.midpoint === value);
    if (bucket) changeTime(bucket.second);
  };
  const range =
    active && active.end > active.start ? (
      <ReferenceArea
        x1={active.start}
        x2={active.end}
        fill="var(--primary)"
        fillOpacity={0.09}
        strokeOpacity={0}
      />
    ) : null;
  const cursor = (
    <ReferenceLine
      x={current.second}
      stroke="var(--foreground)"
      strokeOpacity={0.65}
      strokeDasharray="3 4"
    />
  );
  const chartSummary =
    mode === 'difference'
      ? `${positionLabel} ${clock(current.second)}，Alpha 减 Bravo，${signed(current.difference)} 点`
      : `${positionLabel} ${clock(current.second)}，${currentMode.title}${mode === 'change' ? '，近60秒' : ''}，Alpha ${number(current[valueKeys[0]] as number)}，Bravo ${number(current[valueKeys[1]] as number)} 点`;
  const lossSummary = `${clock(lossStart)} 至 ${clock(losses.second)}，Alpha 损失 ${number(losses.alphaLoss)}，Bravo 损失 ${number(losses.bravoLoss)} 点`;
  const focusChart = (moveFocus = true) =>
    requestAnimationFrame(() => {
      if (narrow && contextRef.current && cardRef.current) {
        // The sticky card's visible position is not its flow position. Align from
        // the non-sticky plot card so repeated paging cannot accumulate drift.
        const context = contextRef.current;
        const card = cardRef.current;
        const gap = Number.parseFloat(getComputedStyle(card.parentElement!).rowGap) || 0;
        const inset = Number.parseFloat(getComputedStyle(context).top) || 0;
        globalThis.scrollTo({
          top:
            scrollY +
            card.getBoundingClientRect().top -
            context.getBoundingClientRect().height -
            gap -
            inset,
          behavior: 'instant',
        });
      } else {
        chartRef.current?.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
      if (moveFocus) chartRef.current?.focus({ preventScroll: true });
    });
  const inspectMinute = (time: number) => {
    setChartExpanded(true);
    setLossesExpanded(true);
    changeTime(time);
    focusChart();
  };
  const inspectDetail = (time: number) => {
    // Keep the original hit target until the tap's compatibility click finishes.
    requestAnimationFrame(() => {
      setChartExpanded(true);
      setDetail(true);
      setSecond(time);
      setWindowCenter(active && atRangeStart(time) ? (active.start + active.end) / 2 : time);
      setHovered(null);
      setLossesExpanded(active?.kind === 'loss');
      focusChart();
    });
  };
  const viewChart = () => {
    setChartExpanded(true);
    if (active) {
      setSecond(active.start);
      setWindowCenter((active.start + active.end) / 2);
      setDetail(true);
      setLossesExpanded(globalThis.innerWidth >= 1100 || active.kind === 'loss');
      setHovered(null);
    }
    focusChart();
  };
  const returnToEvent = () => {
    if (!active) return;
    eventRefs.current[active.id]?.scrollIntoView({ behavior: 'instant', block: 'center' });
    eventRefs.current[active.id]?.focus({ preventScroll: true });
  };
  const clearMoment = () => {
    const id = active?.id;
    setSelected(null);
    if (id) eventRefs.current[id]?.focus();
  };
  const collapseAnalysis = () => {
    setChartExpanded(false);
    requestAnimationFrame(() => {
      if (active) {
        eventRefs.current[active.id]?.scrollIntoView({ block: 'center', behavior: 'instant' });
        eventRefs.current[active.id]?.focus({ preventScroll: true });
      } else {
        overviewRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
        overviewRef.current?.focus({ preventScroll: true });
      }
    });
  };
  const activeIndex = visible.findIndex((moment) => moment.id === active?.id);
  const themeToggle = (
    <Button
      variant="ghost"
      size="icon-sm"
      className="max-sm:size-10"
      aria-label={light ? '切换深色' : '切换浅色'}
      onClick={() => {
        const next = !light;
        setLight(next);
        document.documentElement.dataset.mode = next ? 'light' : 'dark';
        document.documentElement.classList.toggle('dark', !next);
      }}
    >
      {light ? <Moon /> : <Sun />}
    </Button>
  );
  return (
    <main
      ref={workspaceRef}
      className="mx-auto flex w-full max-w-7xl flex-col gap-5 font-sans text-sm text-foreground max-sm:[&_button]:min-h-11 max-sm:[&_button]:min-w-11 max-sm:[&_select]:h-11"
      aria-label="对局时间线小样"
    >
      <header className="flex flex-col gap-3 pt-1">
        <div
          className={cn(
            'flex items-center justify-between gap-3',
            narrow && chartExpanded && 'hidden',
          )}
        >
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span>对局复盘</span>
            <ChevronRight className="size-3" />
            <span className="tabular-nums">#{source.provenance.matchId}</span>
            <ChevronRight className="size-3" />
            <span className="text-foreground">时间线</span>
          </div>
        </div>
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {source.provenance.map}
            </h1>
            <div
              className={cn(
                'flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground',
                narrow && chartExpanded && 'hidden',
              )}
            >
              <span>2026/10/31 · 12:35</span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="size-3.5" />
                {clock(data.duration)}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {themeToggle}
            <div className="flex flex-col items-end gap-1.5">
              <div className="text-2xl font-semibold tabular-nums tracking-tight">
                {source.match.TeamMatchPoints.Alpha}
                <span className="px-2 font-normal text-muted-foreground">:</span>
                {source.match.TeamMatchPoints.Bravo}
              </div>
              <span className="text-xs text-info">Alpha 胜利</span>
            </div>
          </div>
        </div>
      </header>
      <p id="chart-keys" className="sr-only">
        左右键移动一秒，PageUp 与 PageDown 移动一分钟，Home 与 End
        到起点与终点。也可使用下方时间滑块或分钟数据表。
      </p>
      <p id="chart-method" className="sr-only">
        估算点数，非实际在场兵力，回收单位不计入。
      </p>
      <p role="status" className="sr-only">
        {chartSummary}。{lossSummary}
      </p>
      <Collapsible
        open={chartExpanded}
        onOpenChange={setChartExpanded}
        className={cn(
          'flex flex-col items-stretch gap-5 min-[1100px]:grid min-[1100px]:items-start min-[1100px]:grid-cols-[minmax(0,1fr)_360px]',
          narrow && chartExpanded && active && 'gap-3',
        )}
      >
        {narrow && chartExpanded && (
          <Card
            ref={contextRef}
            size="sm"
            className="sticky top-2 z-20"
            data-testid={active ? 'event-context' : 'analysis-context'}
            id={active ? 'selected-event-details' : 'analysis-navigation'}
            role="region"
            aria-label={active ? '所选事件详情' : '图表导航'}
          >
            <CardHeader className="sr-only">
              <CardTitle>{active ? '所选事件' : '图表导航'}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  onClick={() => focusChart()}
                  aria-label="查看当前定位图表"
                >
                  图表
                  <ChartLine data-icon="inline-end" />
                </Button>
                <div className="flex items-center">
                  {active && (
                    <>
                      <IconAction
                        label="上一个关键时刻"
                        disabled={activeIndex <= 0}
                        onClick={() => {
                          selectMoment(visible[activeIndex - 1]!);
                          focusChart(false);
                        }}
                      >
                        <ChevronLeft />
                      </IconAction>
                      <span
                        className="text-sm tabular-nums"
                        role="status"
                        aria-label={`第 ${activeIndex + 1} 个，共 ${visible.length} 个关键时刻`}
                        data-testid="event-position"
                      >
                        {activeIndex + 1}/{visible.length}
                      </span>
                      <IconAction
                        label="下一个关键时刻"
                        disabled={activeIndex >= visible.length - 1}
                        onClick={() => {
                          selectMoment(visible[activeIndex + 1]!);
                          focusChart(false);
                        }}
                      >
                        <ChevronRight />
                      </IconAction>
                    </>
                  )}
                  <Button variant="ghost" onClick={collapseAnalysis}>
                    返回概览
                  </Button>
                </div>
              </div>
              {active && (
                <>
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                    data-testid="event-identity"
                  >
                    <span className="font-medium">
                      <span className="font-normal text-foreground/80">所选 </span>
                      {active.unit}
                    </span>
                    <span className="text-foreground/80 tabular-nums">
                      {clock(active.start)}
                      {active.end !== active.start ? `–${clock(active.end)}` : ''}
                    </span>
                  </div>
                  <Evidence moment={active} onViewChart={viewChart} inContext />
                </>
              )}
            </CardContent>
          </Card>
        )}
        <Card ref={cardRef} className="min-w-0" data-testid="timeline-card">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-x-2 gap-y-2">
            <div className={cn('flex items-center gap-1', chartExpanded && 'order-2 sm:order-1')}>
              <CardTitle className={cn(chartExpanded && 'max-sm:sr-only')}>
                {currentMode.title}
              </CardTitle>
              <MethodNote />
            </div>
            {chartExpanded ? (
              <ToggleGroup
                type="single"
                variant="outline"
                size="default"
                spacing={0}
                value={mode}
                className="order-1 sm:order-2"
                aria-label="曲线视图"
                onKeyDownCapture={(event) =>
                  selectRadioWithArrow(
                    event,
                    modes.map((item) => item.id),
                    (value) => setMode(value as View),
                  )
                }
                onValueChange={(value) => value && setMode(value as View)}
              >
                {modes.map((item) => (
                  <ToggleGroupItem
                    key={item.id}
                    value={item.id}
                    data-choice={item.id}
                    className="max-sm:min-h-10"
                  >
                    {item.id === mode && <Check data-icon="inline-start" />}
                    {item.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            ) : (
              <div className="flex items-center">
                <MinuteTable second={inspectedMinute.second} onSeek={inspectMinute} />
                <Button
                  variant="outline"
                  size="default"
                  aria-label="查看5分钟细节"
                  onClick={() => inspectDetail(second)}
                >
                  细看
                  <ZoomIn data-icon="inline-end" />
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-2 sm:gap-4">
            <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 px-1">
              {mode === 'difference' ? (
                <div className="col-span-2 flex flex-col gap-1">
                  <span className="text-sm text-foreground/80">Alpha − Bravo</span>
                  <span className="text-2xl font-medium tabular-nums tracking-tight">
                    {signed(current.difference)}
                  </span>
                </div>
              ) : (
                [0, 1].map((team) => (
                  <div key={team} className="flex flex-col gap-1">
                    <span className="flex items-center gap-2 text-sm text-foreground/80">
                      <TeamMark team={team} />
                      {team === 0 ? 'Alpha' : 'Bravo'}
                    </span>
                    <span
                      className="text-xl font-medium tabular-nums tracking-tight sm:text-2xl"
                      data-testid={team === 0 ? 'alpha-value' : 'bravo-value'}
                    >
                      {mode === 'change'
                        ? signed(current[valueKeys[team]!] as number)
                        : number(current[valueKeys[team]!] as number)}
                    </span>
                  </div>
                ))
              )}
              <div className="flex flex-col items-end gap-1.5 pb-1 text-sm">
                <span className="text-foreground/80 tabular-nums" data-testid="readout-time">
                  {positionLabel}{' '}
                  <time className="text-base font-medium text-foreground">
                    {clock(current.second)}
                  </time>
                </span>
                {mode === 'force' ? (
                  <span className="text-foreground/80" data-testid="estimate-caveat">
                    非在场值 · 回收除外
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {mode === 'change' ? '近 60 秒' : '正值为 Alpha 领先'}
                  </span>
                )}
              </div>
            </div>
            {!chartExpanded && (
              <div className="relative">
                <PlotSelectionRoot
                  ref={overviewRef}
                  role="button"
                  tabIndex={0}
                  aria-label="点选查看附近5分钟"
                  onValueChange={inspectDetail}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      inspectDetail(second);
                    }
                  }}
                  className="cursor-zoom-in touch-pan-y touch-pinch-zoom rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <ChartContainer
                    config={chartConfig}
                    labelTone="strong"
                    className="h-[180px] w-full aspect-auto text-sm"
                    data-testid="overview-chart"
                    aria-hidden="true"
                  >
                    <ComposedChart
                      data={data.frames}
                      margin={{ top: 52, right: 12, left: 0, bottom: 0 }}
                      accessibilityLayer={false}
                    >
                      <XAxis
                        type="number"
                        dataKey="second"
                        domain={[0, data.duration]}
                        ticks={[0, 300, 600, 900, data.duration]}
                        tickFormatter={clock}
                        minTickGap={8}
                        height={24}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        width={56}
                        domain={overviewScale.domain}
                        ticks={overviewScale.ticks}
                        interval={0}
                        tickFormatter={compact}
                        tickLine={false}
                        axisLine={false}
                      />
                      <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.35} />
                      {range}
                      {cursor}
                      {mode !== 'force' && <ReferenceLine y={0} stroke="var(--border)" />}
                      {mode === 'difference' ? (
                        <Line
                          dataKey="difference"
                          type="stepAfter"
                          stroke="var(--info)"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      ) : (
                        <>
                          <Line
                            dataKey={valueKeys[0]}
                            type="stepAfter"
                            stroke="var(--info)"
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive={false}
                          />
                          <Line
                            dataKey={valueKeys[1]}
                            type="stepAfter"
                            stroke="var(--warning)"
                            strokeDasharray="6 4"
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive={false}
                          />
                        </>
                      )}
                      <PlotSelection />
                    </ComposedChart>
                  </ChartContainer>
                </PlotSelectionRoot>
                <EventMarkers
                  moments={visible}
                  start={0}
                  end={data.duration}
                  selected={selected}
                  onLocate={locateMoment}
                  overview
                />
              </div>
            )}
            <CollapsibleContent id="chart-visuals" className="flex flex-col gap-2 sm:gap-4">
              <div className="relative">
                <ChartInteraction
                  name="兵力曲线"
                  second={second}
                  summary={chartSummary}
                  onTime={changeTime}
                  onPreviewChange={setHovered}
                  chartRef={chartRef}
                >
                  <ChartContainer
                    config={chartConfig}
                    labelTone="strong"
                    className="h-[160px] w-full aspect-auto text-sm min-[700px]:h-[196px] min-[1100px]:h-[252px]"
                    data-testid="force-chart"
                    aria-hidden="true"
                  >
                    <ComposedChart
                      data={frames}
                      margin={{ ...chartMargin, top: 52 }}
                      accessibilityLayer={false}
                    >
                      <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} />
                      <XAxis
                        type="number"
                        dataKey="second"
                        domain={[window.start, window.end]}
                        ticks={visibleTicks}
                        tickFormatter={clock}
                        tickLine={false}
                        axisLine={false}
                        height={26}
                        minTickGap={18}
                      />
                      <YAxis
                        width={56}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={compact}
                        domain={forceScale.domain}
                        ticks={forceScale.ticks}
                        interval={0}
                      />
                      <ChartTooltip content={() => null} cursor={false} />
                      {range}
                      {cursor}
                      {mode !== 'force' && (
                        <ReferenceLine
                          y={0}
                          stroke="var(--foreground)"
                          strokeOpacity={0.6}
                          strokeWidth={1.5}
                        />
                      )}
                      {mode === 'difference' ? (
                        <Line
                          dataKey="difference"
                          type="stepAfter"
                          stroke="var(--info)"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      ) : (
                        <>
                          <Line
                            dataKey={valueKeys[0]}
                            type="stepAfter"
                            stroke="var(--info)"
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive={false}
                          />
                          <Line
                            dataKey={valueKeys[1]}
                            type="stepAfter"
                            stroke="var(--warning)"
                            strokeWidth={2}
                            strokeDasharray="6 4"
                            dot={false}
                            isAnimationActive={false}
                          />
                        </>
                      )}
                      <PlotSelection />
                    </ComposedChart>
                  </ChartContainer>
                </ChartInteraction>
                <EventMarkers
                  moments={visible}
                  start={window.start}
                  end={window.end}
                  selected={selected}
                  onLocate={locateMoment}
                />
              </div>
              <Collapsible
                open={lossesExpanded}
                onOpenChange={setLossesExpanded}
                className="flex flex-col gap-1"
              >
                <div className="flex flex-wrap items-center justify-between gap-1 text-sm">
                  <h3>
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        size="default"
                        aria-label={lossesExpanded ? '收起分钟损失' : '展开分钟损失'}
                      >
                        分钟损失
                        <ChevronDown
                          data-icon="inline-end"
                          className={cn(!lossesExpanded && '-rotate-90')}
                        />
                      </Button>
                    </CollapsibleTrigger>
                  </h3>
                  <span className="text-foreground/80" data-testid="chart-input-hint">
                    <span className="hidden pointer-coarse:inline">轻点定位</span>
                    <span className="pointer-coarse:hidden">点选或 ← → 定位</span>
                  </span>
                  <MinuteTable second={inspectedMinute.second} onSeek={inspectMinute} />
                </div>
                <CollapsibleContent className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-sm text-foreground/80 tabular-nums">
                    <span className="mr-auto" data-testid="loss-time">
                      {clock(lossStart)}–{clock(losses.second)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <TeamMark team={0} />
                      Alpha {number(losses.alphaLoss)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <TeamMark team={1} />
                      Bravo {number(losses.bravoLoss)}
                    </span>
                  </div>
                  <ChartInteraction
                    name="分钟损失图"
                    second={second}
                    summary={lossSummary}
                    onTime={changeTime}
                    onPlotSelect={onLossSelect}
                    onPreviewChange={previewLoss}
                  >
                    <ChartContainer
                      config={chartConfig}
                      labelTone="strong"
                      className="h-[104px] w-full aspect-auto text-sm sm:h-[120px]"
                      data-testid="loss-chart"
                      aria-hidden="true"
                    >
                      <ComposedChart
                        data={buckets}
                        margin={chartMargin}
                        barGap={2}
                        barCategoryGap="20%"
                        accessibilityLayer={false}
                      >
                        <CartesianGrid
                          vertical={false}
                          stroke="var(--border)"
                          strokeOpacity={0.35}
                        />
                        <XAxis
                          type="number"
                          dataKey="midpoint"
                          domain={[window.start, window.end]}
                          ticks={visibleTicks}
                          tickFormatter={clock}
                          tickLine={false}
                          axisLine={false}
                          height={24}
                          minTickGap={24}
                        />
                        <YAxis
                          width={56}
                          tickFormatter={compact}
                          tickLine={false}
                          axisLine={false}
                          domain={lossScale.domain}
                          ticks={lossScale.ticks}
                          interval={0}
                        />
                        <ChartTooltip content={() => null} cursor={false} />
                        <ReferenceArea
                          x1={Math.max(window.start, lossStart)}
                          x2={Math.min(window.end, losses.second)}
                          fill="var(--primary)"
                          fillOpacity={0.14}
                          strokeOpacity={0}
                        />
                        {cursor}
                        <Bar
                          dataKey="alphaLoss"
                          fill="var(--info)"
                          fillOpacity={0.8}
                          maxBarSize={detail ? 14 : 5}
                          isAnimationActive={false}
                        >
                          {buckets.map((point) => (
                            <Cell
                              key={point.second}
                              fillOpacity={point.second === losses.second ? 1 : 0.9}
                              stroke={point.second === losses.second ? 'var(--foreground)' : 'none'}
                              strokeWidth={1}
                            />
                          ))}
                        </Bar>
                        <Bar
                          dataKey="bravoLoss"
                          fill="var(--warning)"
                          fillOpacity={0.8}
                          maxBarSize={detail ? 14 : 5}
                          isAnimationActive={false}
                        >
                          {buckets.map((point) => (
                            <Cell
                              key={point.second}
                              fillOpacity={point.second === losses.second ? 1 : 0.9}
                              stroke={point.second === losses.second ? 'var(--foreground)' : 'none'}
                              strokeWidth={1}
                            />
                          ))}
                        </Bar>
                        <PlotSelection />
                      </ComposedChart>
                    </ChartContainer>
                  </ChartInteraction>
                </CollapsibleContent>
              </Collapsible>
              <div className="flex flex-col gap-1">
                <Slider
                  className="min-h-11"
                  min={0}
                  max={data.duration}
                  step={1}
                  value={[second]}
                  onValueChange={(value) => changeTime(value[0]!)}
                  aria-label="定位对局时间"
                  aria-valuetext={clock(second)}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="default"
                    spacing={0}
                    value={detail ? 'detail' : 'full'}
                    aria-label="时间窗口"
                    onKeyDownCapture={(event) =>
                      selectRadioWithArrow(event, ['full', 'detail'], (value) => {
                        setDetail(value === 'detail');
                        setWindowCenter(windowAnchor);
                        setHovered(null);
                      })
                    }
                    onValueChange={(value) => {
                      if (value) {
                        setDetail(value === 'detail');
                        setWindowCenter(windowAnchor);
                        setHovered(null);
                      }
                    }}
                  >
                    <ToggleGroupItem value="full" data-choice="full">
                      {!detail && <Check data-icon="inline-start" />}全局
                    </ToggleGroupItem>
                    <ToggleGroupItem value="detail" data-choice="detail">
                      {detail && <Check data-icon="inline-start" />}5 分钟
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="default"
                      aria-label="后退 1 秒"
                      disabled={second === 0}
                      onClick={() => changeTime(Math.max(0, second - 1))}
                    >
                      −1秒
                    </Button>
                    <span className="min-w-10 text-center text-sm tabular-nums">
                      {clock(second)}
                    </span>
                    <Button
                      variant="ghost"
                      size="default"
                      aria-label="前进 1 秒"
                      disabled={second === data.duration}
                      onClick={() => changeTime(Math.min(data.duration, second + 1))}
                    >
                      +1秒
                    </Button>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
            {active && !narrow && (
              <div
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
                data-testid="selected-event-summary"
              >
                <div className="flex min-w-0 items-center gap-1">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium">{active.unit}</span>
                    <span className="text-foreground/80 tabular-nums">
                      {clock(active.start)}
                      {active.end !== active.start ? `–${clock(active.end)}` : ''}
                    </span>
                  </div>
                  <IconAction label="清除选中" onClick={clearMoment}>
                    <X />
                  </IconAction>
                </div>
                {chartExpanded && (
                  <div className="flex items-center">
                    <IconAction
                      label="上一个关键时刻"
                      disabled={activeIndex <= 0}
                      onClick={() => selectMoment(visible[activeIndex - 1]!)}
                    >
                      <ChevronLeft />
                    </IconAction>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={returnToEvent}
                      aria-label="在列表中查看选中事件"
                    >
                      在列表查看
                    </Button>
                    <IconAction
                      label="下一个关键时刻"
                      disabled={activeIndex >= visible.length - 1}
                      onClick={() => selectMoment(visible[activeIndex + 1]!)}
                    >
                      <ChevronRight />
                    </IconAction>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <section className="flex min-w-0 flex-col gap-3" aria-label="关键时刻">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-medium">
              关键时刻
              <span className="text-sm font-normal text-foreground/80">{visible.length}</span>
            </h2>
            <Select
              value={player}
              onValueChange={(value) => {
                setPlayer(value);
                setSelected(null);
              }}
            >
              <SelectTrigger aria-label="筛选事件玩家" className="max-w-48 max-sm:min-h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部玩家</SelectItem>
                </SelectGroup>
                {[0, 1].map((team) => (
                  <SelectGroup key={team}>
                    <SelectLabel>{team === 0 ? 'Alpha' : 'Bravo'}</SelectLabel>
                    {data.players
                      .filter((p) => p.team === team)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ToggleGroup
              type="single"
              size="default"
              spacing={1}
              variant="filter"
              value={kind}
              aria-label="筛选事件类型"
              onKeyDownCapture={(event) =>
                selectRadioWithArrow(event, ['all', 'highlight', 'loss', 'recon'], (value) => {
                  setKind(value);
                  setSelected(null);
                })
              }
              onValueChange={(value) => {
                if (value) {
                  setKind(value);
                  setSelected(null);
                }
              }}
            >
              <ToggleGroupItem value="all" data-choice="all" className="max-sm:min-h-10">
                {kind === 'all' && <Check data-icon="inline-start" />}全部
              </ToggleGroupItem>
              {(['highlight', 'loss', 'recon'] as const).map((value) => {
                return (
                  <ToggleGroupItem
                    key={value}
                    value={value}
                    data-choice={value}
                    className="max-sm:min-h-10"
                  >
                    {kind === value && <Check data-icon="inline-start" />}
                    {eventKindLabels[value]}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </div>
          {narrow && !chartExpanded && active && (
            <Card
              ref={compactContextRef}
              size="sm"
              className="sticky top-2 z-20"
              data-testid="compact-event-summary"
              id="compact-event-details"
              role="region"
              aria-label="所选事件摘要"
            >
              <CardHeader className="sr-only">
                <CardTitle>所选事件</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-2">
                <time className="text-sm tabular-nums">{clock(active.start)}</time>
                <span className="min-w-0 flex-1 truncate font-medium">{active.unit}</span>
                <Button
                  variant="outline"
                  onClick={viewChart}
                  aria-label={`查看 ${clock(active.start)} 附近 5 分钟`}
                >
                  细看
                  <ZoomIn data-icon="inline-end" />
                </Button>
                <IconAction label="清除选中" onClick={clearMoment}>
                  <X />
                </IconAction>
              </CardContent>
            </Card>
          )}
          <Card className="gap-0 py-0">
            <CardHeader className="sr-only">
              <CardTitle>关键时刻列表</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {visible.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>没有匹配的时刻</EmptyTitle>
                    <EmptyDescription>试试其他玩家或类型。</EmptyDescription>
                  </EmptyHeader>
                  <Button variant="outline" size="default" onClick={resetFilter}>
                    清除筛选
                  </Button>
                </Empty>
              ) : (
                visible.map((moment, index) => {
                  const chosen = active?.id === moment.id;
                  return (
                    <div
                      key={moment.id}
                      className={cn(
                        'scroll-mt-(--timeline-context-height)',
                        chosen && 'bg-accent/35',
                      )}
                      data-testid="moment-row"
                    >
                      {index > 0 && <Separator />}
                      <button
                        type="button"
                        className="group grid w-full scroll-mt-(--timeline-context-height) grid-cols-[4rem_1fr_auto] items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:grid-cols-[4.5rem_1fr_auto]"
                        ref={(element) => {
                          eventRefs.current[moment.id] = element;
                        }}
                        aria-expanded={chosen}
                        aria-controls={
                          narrow
                            ? chartExpanded
                              ? 'selected-event-details'
                              : `compact-event-details evidence-${moment.id}`
                            : `evidence-${moment.id}`
                        }
                        onClick={() => selectMoment(moment)}
                      >
                        <span className="flex flex-col gap-1 pt-0.5 font-mono text-sm tabular-nums">
                          <span className="text-foreground">{clock(moment.start)}</span>
                          {moment.end !== moment.start && (
                            <span className="text-foreground/80">至 {clock(moment.end)}</span>
                          )}
                        </span>
                        <span className="flex min-w-0 flex-col gap-1.5">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                            {moment.unit}
                          </span>
                          <span className="flex flex-wrap items-center gap-1.5 text-sm text-foreground/80">
                            <TeamMark team={moment.team} />
                            <span className="break-all">{moment.player}</span>
                            <span>·</span>
                            {moment.title}
                          </span>
                        </span>
                        <span className="flex flex-col items-end gap-2">
                          <span className="whitespace-nowrap font-medium tabular-nums">
                            {moment.kind === 'highlight'
                              ? `${moment.value} 击杀`
                              : moment.kind === 'loss'
                                ? `≈${number(moment.value)}`
                                : ''}
                          </span>
                          <ChevronDown
                            className={cn(
                              'size-3.5 text-muted-foreground transition-transform',
                              chosen && 'rotate-180',
                            )}
                          />
                        </span>
                      </button>
                      {chosen && !(narrow && chartExpanded) && (
                        <div id={`evidence-${moment.id}`}>
                          <Evidence
                            key={moment.id}
                            moment={moment}
                            onViewChart={viewChart}
                            showInspect={!narrow}
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </section>
      </Collapsible>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <TooltipProvider>
    <TimelinePreview />
  </TooltipProvider>,
);
