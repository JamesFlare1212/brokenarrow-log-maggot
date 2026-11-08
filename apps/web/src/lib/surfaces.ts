import { cn } from './utils';

export const glassMaterialClasses =
  'shadow-(--glass-shadow) backdrop-blur-(--glass-blur) backdrop-saturate-(--glass-saturation)';

export const glassOverlaySurfaceClasses = cn(
  glassMaterialClasses,
  'rounded-xl bg-popover text-popover-foreground ring-1 ring-(--glass-border)',
);
