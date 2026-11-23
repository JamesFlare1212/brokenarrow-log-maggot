import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { clock, clusterMoments, type Moment } from './model';

import { markerLabels } from './marker-labels';
export { eventKindLabels } from './marker-labels';
const interval = (moment: Moment) =>
  `${clock(moment.start)}${moment.end !== moment.start ? `–${clock(moment.end)}` : ''}`;

function EventMark({
  moments,
  percent,
  selected,
  onLocate,
}: {
  moments: Moment[];
  percent: number;
  selected: string | null;
  onLocate: (moment: Moment) => void;
}) {
  const [open, setOpen] = useState(false);
  const navigated = useRef(false);
  const moment = moments[0]!;
  const active = moments.some((item) => item.id === selected);
  const labels = markerLabels(moments);
  const position = { '--event-position': `${percent}%` } as CSSProperties;
  const classes =
    'pointer-events-auto absolute top-0 left-(--event-position) -translate-x-1/2 min-w-11 px-2';
  if (moments.length === 1) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={active ? 'secondary' : 'ghost'}
            size="default"
            className={classes}
            style={position}
            aria-label={`${moment.playerId ? moment.unit : labels[0]}，${moment.title}，${interval(moment)}，定位到事件`}
            aria-current={active ? 'true' : undefined}
            onClick={() => onLocate(moment)}
          >
            <span
              className={cn(
                'underline decoration-2 underline-offset-4',
                moment.team === 0
                  ? 'decoration-info decoration-solid'
                  : 'decoration-warning decoration-dashed',
              )}
            >
              {labels[0]}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-72">
          <div className="flex flex-col gap-1 text-sm">
            <strong>
              {moment.unit} · {moment.title}
            </strong>
            <span>
              {interval(moment)} · {moment.team === 0 ? 'Alpha' : 'Bravo'}
              {moment.playerId ? ` · ${moment.player}` : ''}
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        if (value) navigated.current = false;
        setOpen(value);
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant={active ? 'secondary' : 'outline'}
              size="default"
              className={cn(classes, 'px-1', labels.length > 1 && 'h-auto py-1')}
              style={position}
              aria-label={`查看 ${moments.length} 个关键时刻，${labels.join('、')}，${clock(Math.min(...moments.map((item) => item.start)))}–${clock(Math.max(...moments.map((item) => item.end)))}`}
            >
              <span className="flex flex-col">
                {labels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent className="max-w-72">
          {moments.map((item) => item.unit).join(' · ')}，点击选择
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        className="w-80 max-w-[calc(100vw-32px)]"
        aria-label={`${moments.length} 个关键时刻`}
        onCloseAutoFocus={(event) => {
          if (navigated.current) event.preventDefault();
        }}
      >
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{moments.length} 个关键时刻</h3>
          {moments.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              className="h-auto min-h-11 w-full justify-start whitespace-normal p-2 text-left"
              onClick={() => {
                navigated.current = true;
                setOpen(false);
                onLocate(item);
              }}
              aria-label={`定位事件：${item.unit}，${interval(item)}`}
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="font-medium">{item.unit}</span>
                <span className="text-sm text-foreground/80 tabular-nums">
                  {interval(item)} · {item.team === 0 ? 'Alpha' : 'Bravo'} · {item.title}
                </span>
              </span>
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function EventMarkers({
  moments,
  start,
  end,
  selected,
  onLocate,
  overview = false,
}: {
  moments: Moment[];
  start: number;
  end: number;
  selected: string | null;
  onLocate: (moment: Moment) => void;
  overview?: boolean;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [font, setFont] = useState({ value: '500 14px sans-serif' });
  const metrics = useMemo(() => {
    const canvas = document.createElement('canvas').getContext('2d');
    if (canvas) canvas.font = font.value;
    return canvas;
  }, [font]);
  useLayoutEffect(() => {
    let disposed = false;
    const update = () => {
      if (disposed || !rail.current) return;
      setWidth(rail.current.getBoundingClientRect().width);
      const style = getComputedStyle(rail.current);
      setFont({ value: `500 ${style.fontSize} ${style.fontFamily}` });
    };
    update();
    const observer = new ResizeObserver(update);
    if (rail.current) observer.observe(rail.current);
    void document.fonts.ready.then(update);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, []);
  const groups = clusterMoments(moments, start, end, width, 4, (items) =>
    Math.max(
      44,
      ...markerLabels(items).map(
        (label) =>
          (metrics?.measureText(label).width ?? label.length * 14) + (items.length > 1 ? 10 : 18),
      ),
    ),
  );
  return (
    <div
      ref={rail}
      role="group"
      aria-label="关键时刻标记"
      className={cn(
        'pointer-events-none absolute top-0 h-13',
        overview ? 'right-3 left-14' : 'right-3.5 left-14',
      )}
    >
      {groups.map((group) => (
        <EventMark
          key={group.moments.map((item) => item.id).join('|')}
          moments={group.moments}
          percent={group.percent}
          selected={selected}
          onLocate={onLocate}
        />
      ))}
    </div>
  );
}
