import {
  createContext,
  useContext,
  useId,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { cn } from '@/lib/utils';
import {
  Tooltip as PrimitiveTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

export const TooltipAutoFocusContext = createContext<RefObject<boolean> | null>(null);

export function Tooltip({
  children,
  content,
  side = 'top',
}: {
  children: ReactElement;
  content: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <TooltipProvider delayDuration={400}>
      <PrimitiveTooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{content}</TooltipContent>
      </PrimitiveTooltip>
    </TooltipProvider>
  );
}

type TooltipButtonProps = ComponentProps<typeof Button> & {
  tooltip?: ReactNode;
  pinOnClick?: boolean;
};

export function TooltipButton(props: TooltipButtonProps) {
  return <TooltipControl {...props} />;
}

export function TooltipBadge({
  variant = 'secondary',
  ...props
}: ComponentProps<'button'> & {
  variant?: ComponentProps<typeof Badge>['variant'];
  tooltip: ReactNode;
}) {
  return <TooltipControl {...props} badgeVariant={variant} pinOnClick />;
}

function TooltipControl({
  tooltip,
  title,
  pinOnClick = false,
  children,
  onClick,
  badgeVariant,
  ...props
}: TooltipButtonProps & { badgeVariant?: ComponentProps<typeof Badge>['variant'] }) {
  const autoFocus = useContext(TooltipAutoFocusContext);
  const [hint, setHint] = useState(false);
  const [pinned, setPinned] = useState(false);
  const id = useId();
  const content = tooltip ?? title ?? props['aria-label'];
  const triggerId = props.id ?? id;
  const richContent = badgeVariant !== undefined;
  const buttonProps = {
    type: 'button' as const,
    id: triggerId,
    ...props,
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      setHint(false);
      onClick?.(event);
    },
  };
  const button = richContent ? (
    <Badge asChild variant={badgeVariant}>
      <button {...buttonProps} data-slot="badge">
        {children}
      </button>
    </Badge>
  ) : (
    <Button {...buttonProps}>{children}</Button>
  );
  if (!content) return button;
  const trigger =
    props.disabled !== undefined ? (
      <span
        className="inline-flex"
        tabIndex={props.disabled ? 0 : undefined}
        aria-label={props.disabled ? props['aria-label'] : undefined}
      >
        {button}
      </span>
    ) : (
      button
    );
  const hintTrigger = pinOnClick ? <PopoverTrigger asChild>{trigger}</PopoverTrigger> : trigger;
  const panelClassName = richContent
    ? 'w-80 max-w-[calc(100vw-2rem)] max-h-[70svh] overflow-y-auto p-4'
    : undefined;
  const panelContent = (gap: string) => (
    <div className={cn('flex flex-col', richContent ? 'gap-4' : gap)}>{content}</div>
  );
  const explanation = (
    <TooltipProvider delayDuration={400}>
      <PrimitiveTooltip
        open={hint && !pinned}
        onOpenChange={(value) => {
          if (!value || !autoFocus?.current) setHint(value);
        }}
      >
        <TooltipTrigger asChild>{hintTrigger}</TooltipTrigger>
        <TooltipContent
          variant={richContent ? 'popover' : 'default'}
          className={panelClassName}
          sideOffset={richContent ? 8 : undefined}
          collisionPadding={richContent ? 12 : undefined}
        >
          {panelContent('gap-1')}
        </TooltipContent>
      </PrimitiveTooltip>
    </TooltipProvider>
  );
  if (!pinOnClick) return explanation;
  return (
    <Popover
      open={pinned}
      onOpenChange={(value) => {
        setHint(false);
        setPinned(value);
      }}
    >
      {explanation}
      <PopoverContent
        aria-labelledby={triggerId}
        className={cn('max-h-[70svh] overflow-y-auto', panelClassName)}
        side={richContent ? 'top' : undefined}
        sideOffset={richContent ? 8 : undefined}
        collisionPadding={richContent ? 12 : undefined}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {panelContent('gap-2')}
      </PopoverContent>
    </Popover>
  );
}
