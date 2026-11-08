import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { cn } from '@/lib/utils';
import { glassOverlaySurfaceClasses } from '@/lib/surfaces';
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react';

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
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
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'transparent',
          '--normal-bg-hover': 'var(--accent)',
          '--normal-border-hover': 'var(--glass-border)',
          '--border-radius': 'var(--radius-xl)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          // Sonner's unlayered shadow needs an important utility to retain the shared material.
          toast: cn(
            'cn-toast',
            glassOverlaySurfaceClasses,
            'shadow-(--glass-shadow)! focus-visible:ring-2 focus-visible:ring-ring',
          ),
          description: 'text-muted-foreground!',
          closeButton:
            'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
          actionButton:
            'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
          cancelButton:
            'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
