import { useLayoutEffect, useRef, useState } from 'react';

export function useRosterHeight(populated: boolean, enabled = true) {
  const layout = useRef<HTMLDivElement>(null);
  const lastLayout = useRef<{ width: number; height: number } | null>(null);
  const [reservedHeight, setReservedHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = layout.current;
    if (!element || !enabled) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      if (populated) {
        lastLayout.current = { width, height };
        setReservedHeight(height);
      } else {
        // A height measured for another width cannot represent wrapped rows or stacked teams.
        setReservedHeight(lastLayout.current?.width === width ? lastLayout.current.height : null);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [populated, enabled]);

  return { layout, reservedHeight };
}
