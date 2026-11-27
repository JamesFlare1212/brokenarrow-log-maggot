import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithRef,
  type RefObject,
} from 'react';
import { usePlotArea, useXAxisInverseDataSnapScale } from 'recharts';

interface PlotGeometry {
  element: SVGRectElement;
  x: number;
  width: number;
  inverse: (pixel: number) => unknown;
}

const PlotContext = createContext<RefObject<PlotGeometry | null> | null>(null);

export function PlotSelectionRoot({
  children,
  onValueChange,
  onPreviewChange,
  ...props
}: ComponentPropsWithRef<'div'> & {
  onValueChange: (value: number) => void;
  onPreviewChange?: (value: number | null) => void;
}) {
  const geometry = useRef<PlotGeometry | null>(null);
  const contact = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const touch = useRef(false);
  const pinned = useRef<{ x: number; y: number } | null>(null);
  const valueAt = (x: number, y: number) => {
    const plot = geometry.current;
    if (!plot) return undefined;
    const bounds = plot.element.getBoundingClientRect();
    if (
      bounds.width <= 0 ||
      x < bounds.left ||
      x > bounds.right ||
      y < bounds.top ||
      y > bounds.bottom
    )
      return undefined;
    const value = plot.inverse(plot.x + ((x - bounds.left) / bounds.width) * plot.width);
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  };
  return (
    <PlotContext.Provider value={geometry}>
      <div
        {...props}
        onPointerDownCapture={(event) => {
          touch.current = event.pointerType !== 'mouse';
          pinned.current = null;
          if (touch.current) onPreviewChange?.(null);
          contact.current =
            event.isPrimary &&
            event.button === 0 &&
            valueAt(event.clientX, event.clientY) !== undefined
              ? { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
              : null;
        }}
        onPointerMoveCapture={(event) => {
          touch.current = event.pointerType !== 'mouse';
          const start = contact.current;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8)
            start.moved = true;
          if (!touch.current) {
            const anchor = pinned.current;
            if (anchor && Math.hypot(event.clientX - anchor.x, event.clientY - anchor.y) <= 2)
              return;
            pinned.current = null;
            onPreviewChange?.(valueAt(event.clientX, event.clientY) ?? null);
          }
        }}
        onPointerCancel={() => {
          contact.current = null;
          pinned.current = null;
          onPreviewChange?.(null);
        }}
        onPointerLeave={() => {
          contact.current = null;
          pinned.current = null;
          onPreviewChange?.(null);
        }}
        onPointerUpCapture={(event) => {
          const start = contact.current;
          contact.current = null;
          if (
            !start ||
            start.id !== event.pointerId ||
            start.moved ||
            Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8
          )
            return;
          const value = valueAt(event.clientX, event.clientY);
          if (value !== undefined) {
            pinned.current = { x: event.clientX, y: event.clientY };
            onValueChange(value);
          }
        }}
        onClickCapture={(event) => event.stopPropagation()}
        onMouseMoveCapture={(event) => {
          if (touch.current || pinned.current) event.stopPropagation();
        }}
      >
        {children}
      </div>
    </PlotContext.Provider>
  );
}

export function PlotSelection() {
  const plot = usePlotArea();
  const inverse = useXAxisInverseDataSnapScale();
  const context = useContext(PlotContext);
  const element = useRef<SVGRectElement>(null);
  useLayoutEffect(() => {
    if (!context || !plot || !inverse || !element.current) return;
    const geometry = { element: element.current, x: plot.x, width: plot.width, inverse };
    context.current = geometry;
    return () => {
      if (context.current === geometry) context.current = null;
    };
  }, [context, plot, inverse]);
  return plot ? (
    <rect
      {...plot}
      ref={element}
      fill="none"
      pointerEvents="none"
      data-testid="plot-hit-area"
      aria-hidden="true"
    />
  ) : null;
}
