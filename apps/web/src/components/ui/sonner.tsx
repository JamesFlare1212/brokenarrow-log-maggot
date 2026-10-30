import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useEffect, useState } from 'react';
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react';

const Toaster = ({ position, ...props }: ToasterProps) => {
  const [layout, setLayout] = useState<{
    bottom: number;
    maxHeight: number | string;
  }>({ bottom: 16, maxHeight: 'calc(50dvh - 3rem)' });
  useEffect(() => {
    const observer = new ResizeObserver(() => place());
    const place = () => {
      const active = document.activeElement;
      if (
        !(active instanceof HTMLElement) ||
        active === document.body ||
        active.closest('[data-sonner-toaster]')
      )
        return;
      const bounds = active.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const above = Math.max(0, Math.min(innerHeight, bounds.top) - 40);
      const below = Math.max(0, innerHeight - Math.max(0, bounds.bottom) - 40);
      const bottom =
        above >= below ? Math.max(16, Math.ceil(innerHeight - Math.max(0, bounds.top) + 24)) : 16;
      const maxHeight = Math.max(48, Math.floor(Math.max(above, below)));
      setLayout((previous) =>
        previous.bottom === bottom && previous.maxHeight === maxHeight
          ? previous
          : { bottom, maxHeight },
      );
    };
    const followFocus = () => {
      observer.disconnect();
      const active = document.activeElement;
      if (active instanceof HTMLElement && !active.closest('[data-sonner-toaster]'))
        for (let node: HTMLElement | null = active; node; node = node.parentElement)
          observer.observe(node);
      place();
    };
    document.addEventListener('focusin', followFocus);
    document.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    followFocus();
    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', followFocus);
      document.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, []);
  return (
    <Sonner
      position={position ?? 'bottom-right'}
      theme="system"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          bottom: position ? undefined : layout.bottom,
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
          '--toast-close-button-start': 'unset',
          '--toast-close-button-end': '0px',
          '--toast-close-button-transform': 'translate(-25%, 25%)',
        } as React.CSSProperties
      }
      toastOptions={{
        style: { maxHeight: layout.maxHeight, overflowY: 'auto', paddingInlineEnd: '2.5rem' },
        classNames: {
          toast: 'cn-toast',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
