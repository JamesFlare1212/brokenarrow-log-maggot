import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { TimelineData } from '@ba/contracts';
import { TimelinePresentationProvider, useTimeline } from './presentation';
import { scrollToElement } from './scroll';
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
import { Button as SharedButton } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  ToggleGroup,
  ToggleGroupItem as SharedToggleGroupItem,
} from '@/components/ui/toggle-group';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import {
  NativeSelect,
  NativeSelectOption,
  NativeSelectOptGroup,
} from '@/components/ui/native-select';
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
  clock,
  frameAt,
  timeTicks,
  pointAt,
  minuteBuckets,
  niceScale,
  timeWindow,
  type Moment,
  type Point,
} from './model';
import { EventMarkers } from './EventMarkers';
import { PlotSelection, PlotSelectionRoot } from './PlotSelection';

function Button({ className, ...props }: React.ComponentProps<typeof SharedButton>) {
  return (
    <SharedButton
      className={cn('min-h-(--control-touch) min-w-(--control-touch)', className)}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof SharedToggleGroupItem>) {
  return <SharedToggleGroupItem className={cn('min-h-(--control-touch)', className)} {...props} />;
}
const compact = (value: number) =>
  Math.abs(value) >= 1000 ? `${Math.round(value / 100) / 10}k` : String(value);
const chartConfig = {
  alpha: { label: 'Alpha', color: 'var(--info)' },
  bravo: { label: 'Bravo', color: 'var(--warning)' },
};
const chartMargin = { top: 10, right: 14, left: 0, bottom: 0 };
type View = 'force' | 'difference' | 'change';

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
  const { t } = useTimeline();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="link"
          className="px-0 has-data-[icon=inline-end]:pr-0"
          aria-label={t('timeline.methodAction')}
        >
          {t('timeline.estimatedPoints')}
          <Info data-icon="inline-end" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[min(32rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-32px)] overflow-y-auto"
      >
        <div className="flex flex-col gap-3 text-sm leading-relaxed">
          <h3 className="font-medium">{t('timeline.method')}</h3>
          <p>{t('timeline.methodValues')}</p>
          <p>{t('timeline.methodTime')}</p>
          <p>{t('timeline.methodEvents')}</p>
          <Separator />
          <p className="text-sm text-foreground/80">{t('timeline.methodMetadata')}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LocalizedDialogClose() {
  const { t } = useTimeline();
  return (
    <DialogClose asChild>
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute top-2 right-2"
        aria-label={t('timeline.close')}
      >
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
  const { t } = useTimeline();
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
          'grid min-h-0 grid-rows-[minmax(0,1fr)] rounded-md focus-visible:outline-2 focus-visible:outline-ring [&>[data-slot=table-container]]:min-h-0 [&>[data-slot=table-container]]:max-h-[min(20rem,var(--table-viewport-height,20rem))] [&>[data-slot=table-container]]:overflow-auto sm:[&>[data-slot=table-container]]:max-h-[min(24rem,var(--table-viewport-height,24rem))]',
          rowsPerViewport &&
            '[&>[data-slot=table-container]]:max-h-[min(24rem,var(--table-viewport-height,24rem))]',
        )}
      >
        {children}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-foreground/80">
        <span className="min-w-24 tabular-nums" data-testid="table-scroll-status">
          {t('timeline.browsing', { first: visibleRows.first, last: visibleRows.last, count })}
        </span>
        {scrollable && (
          <div className="flex max-w-full flex-wrap items-center gap-1">
            <IconAction
              label={t('timeline.top')}
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
              {t('timeline.previousRows')}
            </Button>
            <Button
              variant="outline"
              size="default"
              disabled={!hasMore}
              onClick={() => viewport()?.scrollBy({ top: pageStep() })}
            >
              {t('timeline.nextRows')}
              <ChevronDown data-icon="inline-end" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function RecordDialog({ moment }: { moment: Moment }) {
  const { t, number } = useTimeline();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="default">
          {t('timeline.records', { count: moment.sorties.length })}
          <ChevronRight data-icon="inline-end" />
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle className="pr-10">
            {t('timeline.deathRecords', { player: moment.player })}
          </DialogTitle>
          <LocalizedDialogClose />
          <DialogDescription>
            {t('timeline.lossInterval', {
              start: clock(moment.start),
              end: clock(moment.end),
              value: number(moment.value),
            })}
          </DialogDescription>
        </DialogHeader>
        <TableScroll label={t('timeline.recordTable')} count={moment.sorties.length}>
          <Table stickyHeader>
            <TableHeader>
              <TableRow>
                <TableHead>{t('timeline.death')}</TableHead>
                <TableHead>{t('timeline.unitPlayer')}</TableHead>
                <TableHead className="text-right">{t('timeline.estimatedValue')}</TableHead>
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
  const { data, t, number } = useTimeline();
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
        <Button variant="ghost" size="default">
          {t('timeline.minuteData')}
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
        className="max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle className="pr-10">
            {t('timeline.minutePosition', {
              interval:
                selectedMinute === 0
                  ? t('timeline.opening')
                  : `${clock(intervalStart)}–${clock(selectedMinute)}`,
            })}
          </DialogTitle>
          <LocalizedDialogClose />
          <DialogDescription>
            {t(selectedMinute === 0 ? 'timeline.openingValues' : 'timeline.intervalValues')}
          </DialogDescription>
        </DialogHeader>
        <TableScroll
          label={t('timeline.minuteTable')}
          count={data.points.length}
          revealSelected
          rowsPerViewport={6}
        >
          <Table stickyHeader>
            <TableHeader>
              <TableRow>
                <TableHead rowSpan={2} className="px-1">
                  {t('timeline.intervalEnd')}
                </TableHead>
                <TableHead colSpan={2} className="px-1 text-center">
                  {t('timeline.alpha')}
                </TableHead>
                <TableHead colSpan={2} className="px-1 text-center">
                  {t('timeline.bravo')}
                </TableHead>
              </TableRow>
              <TableRow>
                {['alpha-force', 'alpha-loss', 'bravo-force', 'bravo-loss'].map((key, index) => (
                  <TableHead key={key} className="px-1 text-right">
                    {t(index % 2 === 0 ? 'timeline.force' : 'timeline.loss')}
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
                  <TableCell className="px-1 py-0 font-mono text-sm tabular-nums">
                    <Button
                      variant="link"
                      className="px-0 has-data-[icon=inline-end]:pr-0"
                      aria-label={t('timeline.seek', { time: clock(point.second) })}
                      onClick={(event) => {
                        event.stopPropagation();
                        seek(point.second);
                      }}
                    >
                      {clock(point.second)}
                      <ArrowRight data-icon="inline-end" />
                    </Button>
                  </TableCell>
                  <TableCell className="px-1 text-right tabular-nums">
                    {number(point.alpha)}
                  </TableCell>
                  <TableCell className="px-1 text-right tabular-nums text-foreground/80">
                    {number(point.alphaLoss)}
                  </TableCell>
                  <TableCell className="px-1 text-right tabular-nums">
                    {number(point.bravo)}
                  </TableCell>
                  <TableCell className="px-1 text-right tabular-nums text-foreground/80">
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
  const { t, number } = useTimeline();
  const single = moment.playerId !== null && moment.sorties.length === 1 ? moment.sorties[0] : null;
  if (!inContext && !showInspect && moment.kind === 'recon') return null;
  const attribution = (
    <div
      className="flex flex-wrap items-center gap-x-1.5 text-sm text-foreground/80"
      data-testid="event-attribution"
    >
      <TeamMark team={moment.team} />
      {single && <span className="sr-only">{moment.team === 0 ? 'Alpha' : 'Bravo'} · </span>}
      <span className="min-w-0 break-words">
        {moment.player} · {moment.title}
      </span>
      {single && moment.kind === 'loss' && (
        <span className="font-medium text-foreground">· ≈{number(moment.value)}</span>
      )}
    </div>
  );
  return (
    <div
      className={cn(
        'flex flex-col',
        inContext ? 'gap-1' : 'gap-3 pb-3 pl-4 pr-3 @min-[640px]/timeline:pl-26',
      )}
      data-testid={inContext ? 'context-evidence' : 'event-evidence'}
    >
      {inContext && single && attribution}
      {single && moment.kind !== 'recon' && (
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div className={cn('min-w-0', inContext && 'flex flex-wrap items-baseline gap-x-1')}>
            <dt className="text-foreground/80">{t('timeline.lifetime')}</dt>
            <dd className={cn('font-medium tabular-nums', !inContext && 'mt-1')}>
              {t('timeline.seconds', { value: Math.round((moment.end - moment.start) * 10) / 10 })}
            </dd>
          </div>
          <div className={cn('min-w-0', inContext && 'flex flex-wrap items-baseline gap-x-1')}>
            <dt className="text-foreground/80">{t('timeline.killsTotal')}</dt>
            <dd className={cn('font-medium tabular-nums', !inContext && 'mt-1')}>{single.kills}</dd>
          </div>
          <div className={cn('min-w-0', inContext && 'flex flex-wrap items-baseline gap-x-1')}>
            <dt className="text-foreground/80">{t('timeline.damageTotal')}</dt>
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
              <span className="text-sm tabular-nums">
                {t('timeline.lossValue', { value: number(moment.value) })}
              </span>
            </div>
          ) : showInspect ? (
            <Button
              variant="ghost"
              size="default"
              onClick={onViewChart}
              aria-label={t('timeline.inspectAt', { time: clock(moment.start) })}
            >
              <ArrowUp data-icon="inline-start" />
              {t('timeline.inspectWindow')}
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
  const { data, ids } = useTimeline();
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
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
      aria-describedby={`${ids.keys} ${ids.method}`}
      onKeyDown={keyDown}
      className="min-w-0 touch-pan-y touch-pinch-zoom rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {children}
    </PlotSelectionRoot>
  );
}

export interface TimelineViewProps {
  data: TimelineData;
  scrollContainer?: HTMLElement | null;
  stickyOffset?: number;
}

export function TimelineView({ data, scrollContainer, stickyOffset = 0 }: TimelineViewProps) {
  return (
    <TimelinePresentationProvider data={data}>
      <TooltipProvider>
        <div className="@container/timeline min-w-0 w-full">
          <TimelineBody scrollContainer={scrollContainer} stickyOffset={stickyOffset} />
        </div>
      </TooltipProvider>
    </TimelinePresentationProvider>
  );
}

function TimelineBody({ scrollContainer, stickyOffset = 0 }: Omit<TimelineViewProps, 'data'>) {
  const { data, ids, t, number, signed } = useTimeline();
  const lossBuckets = useMemo(() => minuteBuckets(data.points), [data.points]);
  const ticks = timeTicks(data.duration);
  const modes = [
    { id: 'force', label: t('timeline.force'), title: t('timeline.forceTitle') },
    { id: 'difference', label: t('timeline.difference'), title: t('timeline.difference') },
    { id: 'change', label: t('timeline.change'), title: t('timeline.changeTitle') },
  ] as const;
  const [mode, setMode] = useState<View>('force');
  const [selected, setSelected] = useState<string | null>(null);
  const [second, setSecond] = useState(data.duration);
  const [hovered, setHovered] = useState<number | null>(null);
  const [player, setPlayer] = useState('all');
  const [kind, setKind] = useState('all');
  const [lossesExpanded, setLossesExpanded] = useState(false);
  const [chartExpanded, setChartExpanded] = useState(false);
  const [narrow, setNarrow] = useState(true);
  const [detail, setDetail] = useState(false);
  const [windowCenter, setWindowCenter] = useState(data.duration);
  const chartRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);
  const compactContextRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    let previous: boolean | null = null;
    const update = () => {
      const next = element.getBoundingClientRect().width < 1100;
      if (previous === next) return;
      previous = next;
      setNarrow(next);
      setChartExpanded(!next);
      setLossesExpanded(!next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setSelected(null);
    setSecond(data.duration);
    setWindowCenter(data.duration);
    setHovered(null);
    setPlayer('all');
    setKind('all');
    setDetail(false);
  }, [data.points]);
  const eventRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const window = timeWindow(data.duration, windowCenter, detail);
  const frames = useMemo(
    () => data.frames.filter((point) => point.second >= window.start && point.second <= window.end),
    [data.frames, window.start, window.end],
  );
  const buckets = useMemo(
    () => lossBuckets.filter((point) => point.start >= window.start && point.second <= window.end),
    [lossBuckets, window.start, window.end],
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
  const overviewAnnotationHeight = new Set(visible.map((moment) => moment.kind)).size > 2 ? 72 : 52;
  const annotationHeight =
    new Set(
      visible
        .filter((moment) => moment.end >= window.start && moment.start <= window.end)
        .map((moment) => moment.kind),
    ).size > 2
      ? 72
      : 52;
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
        `${Math.ceil(sticky?.getBoundingClientRect().height ?? 0) + stickyOffset + 16}px`,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    if (cardRef.current) observer.observe(cardRef.current);
    if (contextRef.current) observer.observe(contextRef.current);
    if (compactContextRef.current) observer.observe(compactContextRef.current);
    return () => observer.disconnect();
  }, [narrow, chartExpanded, active?.id, stickyOffset]);
  const current = frameAt(data.frames, hovered ?? second, data.sorties);
  const atRangeStart = (time: number) =>
    !!active && active.end > active.start && time === active.start;
  const losses = pointAt(data.points, current.second, atRangeStart(current.second));
  const inspectedMinute = pointAt(data.points, second, atRangeStart(second));
  const windowAnchor = atRangeStart(second) ? (active!.start + active!.end) / 2 : second;
  const positionLabel = t(
    hovered !== null
      ? 'timeline.hover'
      : atRangeStart(second)
        ? 'timeline.start'
        : active && active.end > active.start && second === active.end
          ? 'timeline.end'
          : 'timeline.position',
  );
  const lossStart = data.points[Math.max(0, data.points.indexOf(losses) - 1)]!.second;
  const currentMode = modes.find((item) => item.id === mode)!;
  const valueKeys: [keyof Point, keyof Point] =
    mode === 'change' ? ['alphaChange', 'bravoChange'] : ['alpha', 'bravo'];
  const forceScale = useMemo(
    () =>
      niceScale(
        frames.flatMap((point) =>
          mode === 'difference'
            ? [point.difference]
            : mode === 'change'
              ? [point.alphaChange, point.bravoChange]
              : [point.alpha, point.bravo],
        ),
      ),
    [frames, mode],
  );
  const lossScale = useMemo(
    () => niceScale(buckets.flatMap((point) => [point.alphaLoss, point.bravoLoss])),
    [buckets],
  );
  const overviewScale = useMemo(
    () =>
      niceScale(
        data.frames.flatMap((point) =>
          mode === 'difference'
            ? [point.difference]
            : mode === 'change'
              ? [point.alphaChange, point.bravoChange]
              : [point.alpha, point.bravo],
        ),
      ),
    [data.frames, mode],
  );
  const reveal = (
    element: HTMLElement | null | undefined,
    align: 'start' | 'nearest' | 'center' = 'nearest',
  ) => {
    const sticky = narrow ? (contextRef.current ?? compactContextRef.current) : null;
    scrollToElement(
      element,
      scrollContainer,
      stickyOffset + (sticky?.getBoundingClientRect().height ?? 0) + 16,
      align,
    );
  };
  const selectMoment = (moment: Moment) => {
    if (narrow && chartExpanded && moment.id !== selected)
      setLossesExpanded(moment.kind === 'loss');
    setSelected(moment.id === selected ? null : moment.id);
    setSecond(moment.start);
    setWindowCenter((moment.start + moment.end) / 2);
    setHovered(null);
    if (narrow && !chartExpanded && moment.id !== selected) {
      requestAnimationFrame(() => {
        reveal(eventRefs.current[moment.id]?.parentElement);
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
      reveal(eventRefs.current[moment.id]);
      eventRefs.current[moment.id]?.focus({ preventScroll: true });
    });
  };
  const changeTime = (value: number) => {
    value = Math.max(0, Math.min(data.duration, value));
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
      ? t('timeline.differenceSummary', {
          position: positionLabel,
          time: clock(current.second),
          value: signed(current.difference),
        })
      : t('timeline.forceSummary', {
          position: positionLabel,
          time: clock(current.second),
          mode:
            mode === 'change'
              ? `${currentMode.title} · ${t('timeline.lastMinute')}`
              : currentMode.title,
          alpha: number(current[valueKeys[0]]),
          bravo: number(current[valueKeys[1]]),
        });
  const lossSummary = t('timeline.lossSummary', {
    start: clock(lossStart),
    end: clock(losses.second),
    alpha: number(losses.alphaLoss),
    bravo: number(losses.bravoLoss),
  });
  const focusChart = (moveFocus = true) =>
    requestAnimationFrame(() => {
      if (narrow && contextRef.current && cardRef.current) {
        // The sticky card's visible position is not its flow position. Align from
        // the non-sticky plot card so repeated paging cannot accumulate drift.
        const context = contextRef.current;
        const card = cardRef.current;
        const gap = Number.parseFloat(getComputedStyle(card.parentElement!).rowGap) || 0;
        scrollToElement(
          card,
          scrollContainer,
          stickyOffset + 8 + context.getBoundingClientRect().height + gap,
          'start',
        );
      } else {
        reveal(chartRef.current, 'center');
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
      setLossesExpanded(!narrow || active.kind === 'loss');
      setHovered(null);
    }
    focusChart();
  };
  const returnToEvent = () => {
    if (!active) return;
    reveal(eventRefs.current[active.id], 'center');
    eventRefs.current[active.id]?.focus({ preventScroll: true });
  };
  const clearMoment = () => {
    const id = active?.id;
    setSelected(null);
    if (id) eventRefs.current[id]?.focus({ preventScroll: true });
  };
  const collapseAnalysis = () => {
    setChartExpanded(false);
    requestAnimationFrame(() => {
      if (active) {
        reveal(eventRefs.current[active.id], 'center');
        eventRefs.current[active.id]?.focus({ preventScroll: true });
      } else {
        scrollToElement(overviewRef.current, scrollContainer, stickyOffset + 16, 'center');
        overviewRef.current?.focus({ preventScroll: true });
      }
    });
  };
  const activeIndex = visible.findIndex((moment) => moment.id === active?.id);
  return (
    <section
      ref={workspaceRef}
      className="flex w-full min-w-0 flex-col gap-(--content-gap) text-sm text-foreground"
      style={
        { '--timeline-sticky-top': `${Math.max(0, stickyOffset) + 8}px` } as React.CSSProperties
      }
      aria-label={t('timeline.title')}
    >
      <p id={ids.keys} className="sr-only">
        {t('timeline.chartKeys')}
      </p>
      <p id={ids.method} className="sr-only">
        {t('timeline.chartMethod')}
      </p>
      <p role="status" className="sr-only">
        {chartSummary}. {lossSummary}
      </p>
      <Collapsible
        open={chartExpanded}
        onOpenChange={setChartExpanded}
        className="flex flex-col items-stretch gap-(--content-gap) @min-[1100px]/timeline:grid @min-[1100px]/timeline:items-start @min-[1100px]/timeline:grid-cols-[minmax(0,1fr)_360px]"
      >
        {narrow && chartExpanded && (
          <Card
            ref={contextRef}
            size="sm"
            className="sticky top-(--timeline-sticky-top) z-20"
            data-testid={active ? 'event-context' : 'analysis-context'}
            id={active ? ids.details : ids.navigation}
            role="region"
            aria-label={t(active ? 'timeline.selectedDetails' : 'timeline.navigation')}
          >
            <CardHeader className="sr-only">
              <CardTitle>{t(active ? 'timeline.selectedEvent' : 'timeline.navigation')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  onClick={() => focusChart()}
                  aria-label={t('timeline.currentChart')}
                >
                  <span className="@max-[640px]/timeline:sr-only">{t('timeline.chart')}</span>
                  <ChartLine data-icon="inline-end" />
                </Button>
                <div className="flex items-center">
                  {active && (
                    <>
                      <IconAction
                        label={t('timeline.previousEvent')}
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
                        aria-label={t('timeline.eventPosition', {
                          index: activeIndex + 1,
                          count: visible.length,
                        })}
                        data-testid="event-position"
                      >
                        {activeIndex + 1}/{visible.length}
                      </span>
                      <IconAction
                        label={t('timeline.nextEvent')}
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
                    {t('timeline.overview')}
                  </Button>
                </div>
              </div>
              {active && (
                <>
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                    data-testid="event-identity"
                  >
                    <span className="min-w-0 break-words font-medium">
                      <span className="font-normal text-foreground/80">
                        {t('timeline.selected')}{' '}
                      </span>
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
            <div
              className={cn(
                'flex items-center gap-1',
                chartExpanded && 'order-2 @min-[640px]/timeline:order-1',
              )}
            >
              <CardTitle className={cn(chartExpanded && '@max-[640px]/timeline:sr-only')}>
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
                className="order-1 @min-[640px]/timeline:order-2"
                aria-label={t('timeline.curveView')}
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
                  <ToggleGroupItem key={item.id} value={item.id} data-choice={item.id}>
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
                  aria-label={t('timeline.inspectDetail')}
                  onClick={() => inspectDetail(second)}
                >
                  {t('timeline.inspect')}
                  <ZoomIn data-icon="inline-end" />
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-2 @min-[640px]/timeline:gap-4">
            <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 px-1 @max-[420px]/timeline:grid-cols-2">
              {mode === 'difference' ? (
                <div className="col-span-2 flex flex-col gap-1">
                  <span className="text-sm text-foreground/80">
                    {t('timeline.differenceLabel')}
                  </span>
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
                      className="text-xl font-medium tabular-nums tracking-tight @min-[640px]/timeline:text-2xl"
                      data-testid={team === 0 ? 'alpha-value' : 'bravo-value'}
                    >
                      {mode === 'change'
                        ? signed(current[valueKeys[team]!] as number)
                        : number(current[valueKeys[team]!] as number)}
                    </span>
                  </div>
                ))
              )}
              <div className="flex flex-col items-end gap-1.5 pb-1 text-sm @max-[420px]/timeline:col-span-2 @max-[420px]/timeline:flex-row @max-[420px]/timeline:flex-wrap @max-[420px]/timeline:justify-between">
                <span className="text-foreground/80 tabular-nums" data-testid="readout-time">
                  {positionLabel}{' '}
                  <time className="text-base font-medium text-foreground">
                    {clock(current.second)}
                  </time>
                </span>
                {mode === 'force' ? (
                  <span className="text-foreground/80" data-testid="estimate-caveat">
                    {t('timeline.caveat')}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {t(mode === 'change' ? 'timeline.lastMinute' : 'timeline.positiveLead')}
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
                  aria-label={t('timeline.overviewAction')}
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
                      margin={{ top: overviewAnnotationHeight, right: 12, left: 0, bottom: 0 }}
                      accessibilityLayer={false}
                    >
                      <XAxis
                        type="number"
                        dataKey="second"
                        domain={[0, data.duration]}
                        ticks={timeTicks(data.duration, 5)}
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
            <CollapsibleContent
              id={ids.visuals}
              className="flex flex-col gap-2 @min-[640px]/timeline:gap-4"
            >
              <div className="relative">
                <ChartInteraction
                  name={t('timeline.forceChart')}
                  second={second}
                  summary={chartSummary}
                  onTime={changeTime}
                  onPreviewChange={setHovered}
                  chartRef={chartRef}
                >
                  <ChartContainer
                    config={chartConfig}
                    labelTone="strong"
                    className="h-[160px] w-full aspect-auto text-sm @min-[700px]/timeline:h-[196px] @min-[1100px]/timeline:h-[252px]"
                    data-testid="force-chart"
                    aria-hidden="true"
                  >
                    <ComposedChart
                      data={frames}
                      margin={{ ...chartMargin, top: annotationHeight }}
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
                        aria-label={t(
                          lossesExpanded ? 'timeline.hideLosses' : 'timeline.showLosses',
                        )}
                      >
                        {t('timeline.minuteLosses')}
                        <ChevronDown
                          data-icon="inline-end"
                          className={cn(!lossesExpanded && '-rotate-90')}
                        />
                      </Button>
                    </CollapsibleTrigger>
                  </h3>
                  <span className="text-foreground/80" data-testid="chart-input-hint">
                    <span className="hidden pointer-coarse:inline">{t('timeline.touchHint')}</span>
                    <span className="pointer-coarse:hidden">{t('timeline.pointerHint')}</span>
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
                    name={t('timeline.lossChart')}
                    second={second}
                    summary={lossSummary}
                    onTime={changeTime}
                    onPlotSelect={onLossSelect}
                    onPreviewChange={previewLoss}
                  >
                    <ChartContainer
                      config={chartConfig}
                      labelTone="strong"
                      className="h-[104px] w-full aspect-auto text-sm @min-[640px]/timeline:h-[120px]"
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
                  className="min-h-(--control-touch)"
                  min={0}
                  max={data.duration}
                  step={1}
                  value={[second]}
                  onValueChange={(value) => changeTime(value[0]!)}
                  aria-label={t('timeline.seekTime')}
                  aria-valuetext={clock(second)}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="default"
                    spacing={0}
                    value={detail ? 'detail' : 'full'}
                    aria-label={t('timeline.timeWindow')}
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
                      {!detail && <Check data-icon="inline-start" />}
                      {t('timeline.fullMatch')}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="detail" data-choice="detail">
                      {detail && <Check data-icon="inline-start" />}
                      {t('timeline.fiveMinutes')}
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="default"
                      aria-label={t('timeline.backSecond')}
                      disabled={second === 0}
                      onClick={() => changeTime(Math.max(0, second - 1))}
                    >
                      {t('timeline.minusSecond')}
                    </Button>
                    <span className="min-w-10 text-center text-sm tabular-nums">
                      {clock(second)}
                    </span>
                    <Button
                      variant="ghost"
                      size="default"
                      aria-label={t('timeline.forwardSecond')}
                      disabled={second === data.duration}
                      onClick={() => changeTime(Math.min(data.duration, second + 1))}
                    >
                      {t('timeline.plusSecond')}
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
                  <IconAction label={t('timeline.clearSelection')} onClick={clearMoment}>
                    <X />
                  </IconAction>
                </div>
                {chartExpanded && (
                  <div className="flex items-center">
                    <IconAction
                      label={t('timeline.previousEvent')}
                      disabled={activeIndex <= 0}
                      onClick={() => selectMoment(visible[activeIndex - 1]!)}
                    >
                      <ChevronLeft />
                    </IconAction>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={returnToEvent}
                      aria-label={t('timeline.locateSelected')}
                    >
                      {t('timeline.viewInList')}
                    </Button>
                    <IconAction
                      label={t('timeline.nextEvent')}
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
        <section
          className="flex min-w-0 flex-col gap-(--content-gap)"
          aria-label={t('timeline.moments')}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-medium">
              {t('timeline.moments')}
              <span className="text-sm font-normal text-foreground/80">{visible.length}</span>
            </h2>
            <NativeSelect
              value={player}
              aria-label={t('timeline.filterPlayer')}
              onChange={(event) => {
                setPlayer(event.target.value);
                setSelected(null);
              }}
              className="max-w-48 [&>select]:min-h-(--control-touch)"
            >
              <NativeSelectOption value="all">{t('timeline.allPlayers')}</NativeSelectOption>
              {[0, 1].map((team) => (
                <NativeSelectOptGroup key={team} label={team === 0 ? 'Alpha' : 'Bravo'}>
                  {data.players
                    .filter((p) => p.team === team)
                    .map((p) => (
                      <NativeSelectOption key={p.id} value={p.id}>
                        {p.name}
                      </NativeSelectOption>
                    ))}
                </NativeSelectOptGroup>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ToggleGroup
              type="single"
              size="default"
              spacing={1}
              variant="filter"
              className="flex-wrap"
              value={kind}
              aria-label={t('timeline.filterKind')}
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
              <ToggleGroupItem value="all" data-choice="all">
                {kind === 'all' && <Check data-icon="inline-start" />}
                {t('timeline.all')}
              </ToggleGroupItem>
              {(['highlight', 'loss', 'recon'] as const).map((value) => {
                return (
                  <ToggleGroupItem key={value} value={value} data-choice={value}>
                    {kind === value && <Check data-icon="inline-start" />}
                    {t(`timeline.kind.${value}`)}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </div>
          {narrow && !chartExpanded && active && (
            <Card
              ref={compactContextRef}
              size="sm"
              className="sticky top-(--timeline-sticky-top) z-20"
              data-testid="compact-event-summary"
              id={ids.compact}
              role="region"
              aria-label={t('timeline.selectedSummary')}
            >
              <CardHeader className="sr-only">
                <CardTitle>{t('timeline.selectedEvent')}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-2">
                <time className="text-sm tabular-nums">{clock(active.start)}</time>
                <span className="min-w-0 flex-1 truncate font-medium">{active.unit}</span>
                <Button
                  variant="outline"
                  onClick={viewChart}
                  aria-label={t('timeline.inspectAt', { time: clock(active.start) })}
                >
                  {t('timeline.inspect')}
                  <ZoomIn data-icon="inline-end" />
                </Button>
                <IconAction label={t('timeline.clearSelection')} onClick={clearMoment}>
                  <X />
                </IconAction>
              </CardContent>
            </Card>
          )}
          <Card className="gap-0 py-0">
            <CardHeader className="sr-only">
              <CardTitle>{t('timeline.eventList')}</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {visible.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>
                      {t(data.moments.length ? 'timeline.noEvents' : 'timeline.noDerivedEvents')}
                    </EmptyTitle>
                    <EmptyDescription>
                      {t(
                        data.moments.length
                          ? 'timeline.tryFilters'
                          : 'timeline.inspectWithoutEvents',
                      )}
                    </EmptyDescription>
                  </EmptyHeader>
                  {data.moments.length > 0 && (
                    <Button variant="outline" size="default" onClick={resetFilter}>
                      {t('timeline.resetFilters')}
                    </Button>
                  )}
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
                      <Button
                        variant="ghost"
                        type="button"
                        className="group grid h-auto w-full scroll-mt-(--timeline-context-height) grid-cols-[4rem_minmax(0,1fr)_auto] items-start gap-3 whitespace-normal px-4 py-4 text-left @min-[640px]/timeline:grid-cols-[4.5rem_minmax(0,1fr)_auto]"
                        ref={(element) => {
                          eventRefs.current[moment.id] = element;
                        }}
                        aria-expanded={chosen}
                        aria-controls={
                          chosen
                            ? narrow
                              ? chartExpanded
                                ? ids.details
                                : `${ids.compact} ${ids.evidence}-${moment.id}`
                              : `${ids.evidence}-${moment.id}`
                            : undefined
                        }
                        onClick={() => selectMoment(moment)}
                      >
                        <span className="flex flex-col gap-1 pt-0.5 font-mono text-sm tabular-nums">
                          <span className="text-foreground">{clock(moment.start)}</span>
                          {moment.end !== moment.start && (
                            <span className="text-foreground/80">
                              {t('timeline.until', { time: clock(moment.end) })}
                            </span>
                          )}
                        </span>
                        <span className="flex min-w-0 flex-col gap-1.5">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 break-all font-medium">
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
                              ? t('timeline.kills', { count: moment.value })
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
                      </Button>
                      {chosen && !(narrow && chartExpanded) && (
                        <div id={`${ids.evidence}-${moment.id}`}>
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
    </section>
  );
}
