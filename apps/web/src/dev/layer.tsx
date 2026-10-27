import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

export interface ToolPosition {
  x: number;
  y: number;
}
export function clampToolPosition(
  position: ToolPosition,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): ToolPosition {
  return {
    x: Math.max(8, Math.min(position.x, Math.max(8, viewportWidth - width - 8))),
    y: Math.max(8, Math.min(position.y, Math.max(8, viewportHeight - height - 8))),
  };
}

/** Native top-layer placement and a shadow boundary isolate the tools from the application. */
export function useDevelopmentLayer(onEscape: () => void) {
  const [layer, setLayer] = useState<ShadowRoot | null>(null);
  useLayoutEffect(() => {
    const host = document.createElement('div');
    host.setAttribute('data-development-layer', '');
    host.setAttribute('aria-live', 'off');
    host.setAttribute('popover', 'manual');
    Object.assign(host.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100dvh',
      margin: '0',
      padding: '0',
      border: '0',
      background: 'transparent',
      overflow: 'visible',
      pointerEvents: 'none',
      maxWidth: 'none',
      maxHeight: 'none',
    });
    const root = host.attachShadow({ mode: 'open' });
    const stop = (event: Event) => event.stopPropagation();
    for (const event of ['pointerdown', 'pointerup', 'click', 'focusin', 'focusout', 'keydown'])
      root.addEventListener(event, stop);
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && event.composedPath().includes(host)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onEscape();
      }
    };
    window.addEventListener('keydown', escape, true);
    document.body.append(host);
    if (typeof host.showPopover === 'function') host.showPopover();
    else host.style.zIndex = '2147483647';
    setLayer(root);
    return () => {
      window.removeEventListener('keydown', escape, true);
      host.remove();
    };
  }, [onEscape]);
  return layer;
}

const positionKey = 'brokenarrow:development-tool-position';
export function useToolPosition(layer: ShadowRoot | null) {
  const [initial] = useState(() => {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(positionKey) ?? 'null',
      ) as ToolPosition | null;
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y))
        return { position: saved, saved: true };
    } catch {}
    return {
      position: { x: Math.max(8, innerWidth - 220), y: Math.max(8, innerHeight - 60) },
      saved: false,
    };
  });
  const [position, setPosition] = useState(initial.position);
  const dock = useRef<HTMLDivElement>(null),
    current = useRef(position),
    initialized = useRef(false);
  const drag = useRef<{
    id: number;
    clientX: number;
    clientY: number;
    position: ToolPosition;
  } | null>(null);
  const move = useCallback((next: ToolPosition) => {
    const rect = dock.current?.getBoundingClientRect();
    const value = clampToolPosition(
      next,
      rect?.width ?? 220,
      rect?.height ?? 40,
      innerWidth,
      innerHeight,
    );
    current.current = value;
    setPosition((old) => (old.x === value.x && old.y === value.y ? old : value));
  }, []);
  const reset = useCallback(() => {
    const rect = dock.current?.getBoundingClientRect();
    move({ x: innerWidth - (rect?.width ?? 220) - 16, y: innerHeight - (rect?.height ?? 40) - 16 });
  }, [move]);
  const save = () => {
    try {
      sessionStorage.setItem(positionKey, JSON.stringify(current.current));
    } catch {}
  };
  useLayoutEffect(() => {
    if (!layer) return;
    if (!initialized.current) {
      initialized.current = true;
      if (initial.saved) move(current.current);
      else reset();
    }
    const resize = () => move(current.current);
    const observer = new ResizeObserver(resize);
    if (dock.current) observer.observe(dock.current);
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [layer, initial.saved, move, reset]);
  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    save();
  };
  return {
    dock,
    position,
    handle: {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = {
          id: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          position: current.current,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
        const start = drag.current;
        if (start?.id === event.pointerId)
          move({
            x: start.position.x + event.clientX - start.clientX,
            y: start.position.y + event.clientY - start.clientY,
          });
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        const step = event.shiftKey ? 40 : 10;
        const delta = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        }[event.key];
        if (event.key === 'Home') {
          event.preventDefault();
          reset();
          save();
        } else if (delta) {
          event.preventDefault();
          move({ x: current.current.x + delta[0]!, y: current.current.y + delta[1]! });
          save();
        }
      },
    },
  };
}

export function useDevelopmentTheme() {
  const read = () => {
    const computed = getComputedStyle(document.documentElement);
    const variables: Record<string, string> = {};
    for (const name of Array.from(computed))
      if (name.startsWith('--')) variables[name] = computed.getPropertyValue(name);
    return {
      dark: document.documentElement.classList.contains('dark'),
      style: { ...variables, colorScheme: computed.colorScheme } as CSSProperties,
    };
  };
  const [theme, setTheme] = useState(read);
  useLayoutEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-mode'],
    });
    return () => observer.disconnect();
  }, []);
  return theme;
}
