import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { SIDEBAR_WIDTH_LIMITS } from '@ba/contracts';
import { cn } from '@/lib/utils';
import { clampSidebarWidth, maximumSidebarWidth } from '@/lib/sidebar-width';
import { useI18n } from '../hooks/useI18n';
import { SidebarProvider as PrimitiveProvider, SidebarRail, useSidebar } from './ui/sidebar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

type Drag = {
  pointerId: number;
  startX: number;
  startWidth: number;
  width: number;
  direction: number;
  element: HTMLElement;
};

type ResizeContext = {
  width: number;
  maximum: number;
  enabled: boolean;
  resizing: boolean;
  begin: (event: PointerEvent<HTMLElement>) => void;
  move: (event: PointerEvent<HTMLElement>) => void;
  end: (event: PointerEvent<HTMLElement>) => void;
  cancelPointer: (event: PointerEvent<HTMLElement>) => void;
  cancel: () => void;
  setWidth: (width: number) => void;
};

const SidebarResizeContext = createContext<ResizeContext | null>(null);

export function SidebarProvider({
  width: widthProp,
  onWidthChange,
  className,
  style,
  ...props
}: ComponentProps<typeof PrimitiveProvider> & {
  width?: number;
  onWidthChange?: (width: number) => void;
}) {
  const [storedWidth, setStoredWidth] = useState<number>(SIDEBAR_WIDTH_LIMITS.default);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [preview, setPreview] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const preferredWidth = widthProp ?? storedWidth;
  const maximum = maximumSidebarWidth(viewportWidth);
  const width = clampSidebarWidth(preview ?? preferredWidth, maximum);
  const drag = useRef<Drag | null>(null);
  const latest = useRef({ width, maximum, onWidthChange });
  latest.current = { width, maximum, onWidthChange };

  const finish = useCallback((commit: boolean, clientX?: number) => {
    const active = drag.current;
    if (!active) return;
    const next = clampSidebarWidth(
      clientX === undefined
        ? active.width
        : active.startWidth + (clientX - active.startX) * active.direction,
      latest.current.maximum,
    );
    drag.current = null;
    setPreview(null);
    setResizing(false);
    if (active.element.hasPointerCapture?.(active.pointerId))
      active.element.releasePointerCapture(active.pointerId);
    if (commit && next !== active.startWidth) {
      setStoredWidth(next);
      latest.current.onWidthChange?.(next);
    }
  }, []);

  const cancel = useCallback(() => finish(false), [finish]);
  const begin = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !event.isPrimary || drag.current) return;
    event.preventDefault();
    const element = event.currentTarget;
    element.focus({ preventScroll: true });
    element.setPointerCapture?.(event.pointerId);
    const initial = latest.current.width;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: initial,
      width: initial,
      direction: element.closest('[data-side]')?.getAttribute('data-side') === 'right' ? -1 : 1,
      element,
    };
    setPreview(initial);
    setResizing(true);
  }, []);

  const move = useCallback((event: PointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const next = clampSidebarWidth(
      active.startWidth + (event.clientX - active.startX) * active.direction,
      latest.current.maximum,
    );
    active.width = next;
    setPreview(next);
  }, []);

  const end = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (drag.current?.pointerId === event.pointerId) finish(true, event.clientX);
    },
    [finish],
  );

  const cancelPointer = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (drag.current?.pointerId === event.pointerId) finish(false);
    },
    [finish],
  );

  const setWidth = useCallback((value: number) => {
    if (drag.current) return;
    const next = clampSidebarWidth(value, latest.current.maximum);
    if (next === latest.current.width) return;
    setStoredWidth(next);
    latest.current.onWidthChange?.(next);
  }, []);

  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !drag.current) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener('resize', resize);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', keydown, true);
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', keydown, true);
      cancel();
    };
  }, [cancel]);

  useEffect(cancel, [cancel, preferredWidth, viewportWidth, props.open]);

  const value = useMemo(
    () => ({
      width,
      maximum,
      enabled: viewportWidth >= 768 && (widthProp === undefined || Boolean(onWidthChange)),
      resizing,
      begin,
      move,
      end,
      cancelPointer,
      cancel,
      setWidth,
    }),
    [
      width,
      maximum,
      viewportWidth,
      widthProp,
      onWidthChange,
      resizing,
      begin,
      move,
      end,
      cancelPointer,
      cancel,
      setWidth,
    ],
  );

  return (
    <SidebarResizeContext.Provider value={value}>
      <PrimitiveProvider
        {...props}
        data-resizing={resizing || undefined}
        className={cn(
          'data-[resizing=true]:select-none data-[resizing=true]:[&_*]:cursor-col-resize!',
          className,
        )}
        style={{ ...style, '--sidebar-width': `${width}px` } as CSSProperties}
      />
    </SidebarResizeContext.Provider>
  );
}

export function SidebarResizeHandle({ controls }: { controls?: string }) {
  const resize = useContext(SidebarResizeContext);
  const { open, isMobile } = useSidebar();
  const { t } = useI18n();
  const hint = useId();
  const [tooltip, setTooltip] = useState(false);
  const [pointerOffset, setPointerOffset] = useState<{ x: number; y: number } | null>(null);
  const cancel = resize?.cancel;
  useEffect(() => cancel, [cancel]);
  useEffect(() => {
    if (!open || isMobile || !resize?.enabled) {
      setTooltip(false);
      cancel?.();
    }
  }, [open, isMobile, resize?.enabled, cancel]);
  if (!resize?.enabled || !open || isMobile) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || resize.resizing) return;
    const direction =
      event.currentTarget.closest('[data-side]')?.getAttribute('data-side') === 'right' ? -1 : 1;
    const step = event.shiftKey ? 64 : 16;
    const next = {
      ArrowLeft: resize.width - step * direction,
      ArrowRight: resize.width + step * direction,
      Home: SIDEBAR_WIDTH_LIMITS.min,
      End: resize.maximum,
      Enter: SIDEBAR_WIDTH_LIMITS.default,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    resize.setWidth(next);
  };

  return (
    <>
      <TooltipProvider delayDuration={400}>
        <Tooltip open={resize.resizing ? false : tooltip} onOpenChange={setTooltip}>
          <TooltipTrigger asChild>
            <SidebarRail
              asChild
              title={undefined}
              tabIndex={0}
              aria-label={t('resizeSidebar')}
              aria-describedby={hint}
              aria-controls={controls}
              aria-orientation="vertical"
              aria-valuemin={SIDEBAR_WIDTH_LIMITS.min}
              aria-valuemax={resize.maximum}
              aria-valuenow={resize.width}
              aria-valuetext={t('sidebarWidthPixels', { width: resize.width })}
              data-resizing={resize.resizing || undefined}
              onFocus={() => setPointerOffset(null)}
              onClick={(event) => event.preventDefault()}
              onPointerDown={(event) => {
                setTooltip(false);
                resize.begin(event);
              }}
              onPointerMove={(event) => {
                resize.move(event);
                if (resize.resizing || event.pointerType !== 'mouse') return;
                const bounds = event.currentTarget.getBoundingClientRect();
                setPointerOffset({
                  x: event.clientX - bounds.right + 12,
                  y: event.clientY - bounds.top + 12,
                });
              }}
              onPointerUp={resize.end}
              onPointerCancel={resize.cancelPointer}
              onLostPointerCapture={resize.cancelPointer}
              onKeyDown={onKeyDown}
              onDoubleClick={(event) => {
                event.preventDefault();
                setTooltip(false);
                resize.setWidth(SIDEBAR_WIDTH_LIMITS.default);
              }}
              className="touch-none select-none outline-none [-webkit-app-region:no-drag] in-data-[side=left]:cursor-col-resize in-data-[side=right]:cursor-col-resize after:w-px after:bg-sidebar-border/60 hover:after:bg-sidebar-border focus-visible:after:w-0.5 focus-visible:after:bg-sidebar-ring data-[resizing=true]:after:w-0.5 data-[resizing=true]:after:bg-sidebar-foreground/25"
            >
              <div role="separator" />
            </SidebarRail>
          </TooltipTrigger>
          <TooltipContent
            side="right"
            align={pointerOffset ? 'start' : 'center'}
            sideOffset={pointerOffset?.x}
            alignOffset={pointerOffset?.y}
            collisionPadding={12}
          >
            {t('resizeSidebar')}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <span id={hint} className="sr-only">
        {t('resizeSidebarHint')}
      </span>
    </>
  );
}
