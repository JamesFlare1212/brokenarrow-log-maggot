import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  useId,
  useRef,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Ellipsis, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '../hooks/useI18n';
import { TooltipAutoFocusContext, TooltipButton } from './Tooltip';
import { BanAlertsIndicator } from '../features/bans/BanAlertsIndicator';
import { useDialogReturn } from './dialog-navigation';
import { Button as PrimitiveButton } from './ui/button';
import {
  Card as PrimitiveCard,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './ui/card';
import { Separator } from './ui/separator';
import {
  Dialog as PrimitiveDialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import {
  Empty as PrimitiveEmpty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from './ui/empty';
import {
  Field as PrimitiveField,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from './ui/field';
import { Badge as PrimitiveBadge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import { Switch } from './ui/switch';
import { Spinner } from './ui/spinner';
import { Skeleton } from './ui/skeleton';
import { Collapsible, CollapsibleContent } from './ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

export function Button({ variant = 'outline', ...props }: ComponentProps<typeof TooltipButton>) {
  return <TooltipButton variant={variant} {...props} />;
}

export function Card({
  title,
  icon,
  actions,
  children,
  collapsed = false,
  onToggle,
  className,
  showHeader = true,
  description,
  footer,
  contentClassName,
}: {
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
  className?: string;
  showHeader?: boolean;
  description?: ReactNode;
  footer?: ReactNode;
  contentClassName?: string;
}) {
  const { t } = useI18n();
  const contentId = useId();
  return (
    <PrimitiveCard className={cn('panel-card', className)} aria-label={title}>
      <Collapsible open={!collapsed} className="flex flex-col gap-4">
        {showHeader && (
          <CardHeader className="panel-card-header">
            <div className="min-w-0 flex-1">
              <CardTitle role="heading" aria-level={2} className="flex min-w-0 items-center gap-2">
                {icon}
                {title}
              </CardTitle>
              {description && <CardDescription className="mt-1">{description}</CardDescription>}
            </div>
            {(actions || onToggle) && (
              <CardAction className="panel-card-actions">
                {actions}
                {onToggle && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onToggle}
                    aria-label={title + ' ' + t(collapsed ? 'expand' : 'collapse')}
                    aria-expanded={!collapsed}
                    aria-controls={contentId}
                  >
                    {collapsed ? <ChevronDown /> : <ChevronUp />}
                  </Button>
                )}
              </CardAction>
            )}
          </CardHeader>
        )}
        <CollapsibleContent id={contentId}>
          <CardContent className={cn('flex min-w-0 flex-col gap-4', contentClassName)}>
            {children}
          </CardContent>
          {footer && <CardFooter>{footer}</CardFooter>}
        </CollapsibleContent>
      </Collapsible>
    </PrimitiveCard>
  );
}

const dialogOpeners = new WeakMap<Document, HTMLElement>();
export function Dialog({
  open,
  onClose,
  title,
  description,
  bodyLabel,
  children,
  className,
  showHeader = true,
  banner,
  onBack,
  headerActions,
  footer,
  initialFocus,
  dismissible = true,
  opener,
  ready = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  bodyLabel?: string;
  children: ReactNode;
  className?: string;
  showHeader?: boolean;
  banner?: ReactNode;
  onBack?: () => void;
  headerActions?: ReactNode;
  footer?: ReactNode;
  initialFocus?: () => HTMLElement | null;
  dismissible?: boolean;
  opener?: HTMLElement | null;
  ready?: boolean;
}) {
  const { t } = useI18n();
  const returnFocus = useRef<HTMLElement | null>(null);
  const explicitOpener = useRef(opener);
  explicitOpener.current = opener;
  const autoFocus = useRef(false);
  const navigation = useDialogReturn(ready, autoFocus);
  return (
    <TooltipAutoFocusContext value={autoFocus}>
      <PrimitiveDialog
        open={open}
        onOpenChange={(value) => {
          if (!value && dismissible) onClose();
        }}
      >
        <DialogContent
          ref={navigation.root}
          className={cn('app-dialog flex flex-col gap-0 overflow-hidden p-0', className)}
          showCloseButton={false}
          {...(description ? {} : { 'aria-describedby': undefined })}
          onEscapeKeyDown={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          onOpenAutoFocus={(event) => {
            autoFocus.current = true;
            queueMicrotask(() => {
              autoFocus.current = false;
            });
            returnFocus.current =
              explicitOpener.current ??
              (document.activeElement instanceof HTMLElement ? document.activeElement : null);
            const active = returnFocus.current;
            if (active && active !== document.body && !active.closest('[role="dialog"]')) {
              const triggerId = active.closest('[role="menu"]')?.getAttribute('aria-labelledby');
              dialogOpeners.set(
                document,
                (triggerId ? document.getElementById(triggerId) : null) ?? active,
              );
            }
            if (navigation.restoreOnOpen(event)) return;
            const target = initialFocus?.();
            if (target) {
              event.preventDefault();
              target.focus({ preventScroll: true });
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            queueMicrotask(() => {
              if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
              const opener = explicitOpener.current?.isConnected
                ? explicitOpener.current
                : dialogOpeners.get(document);
              const target = [
                opener,
                returnFocus.current,
                document.getElementById('main-content'),
              ].find((candidate) => candidate?.isConnected && !candidate.matches(':disabled'));
              target?.focus({ preventScroll: true });
              dialogOpeners.delete(document);
            });
          }}
        >
          <DialogHeader className="flex-row items-center gap-2 px-4 py-2">
            {onBack && (
              <Button variant="ghost" size="icon-sm" aria-label={t('dialogBack')} onClick={onBack}>
                <ArrowLeft />
              </Button>
            )}
            <DialogTitle className={cn('min-w-0 flex-1', !showHeader && 'sr-only')}>
              {title}
            </DialogTitle>
            {description && (
              <DialogDescription className="sr-only">{description}</DialogDescription>
            )}
            <BanAlertsIndicator />
            {headerActions}
            {dismissible && (
              <DialogClose asChild>
                <PrimitiveButton
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto"
                  aria-label={t('close')}
                >
                  <X />
                </PrimitiveButton>
              </DialogClose>
            )}
          </DialogHeader>
          <Separator />
          {banner}
          {navigation.targetMissing && (
            <p role="status" className="shrink-0 border-b px-5 py-2 text-sm text-muted-foreground">
              {t('dialogReturnUnavailable')}
            </p>
          )}
          <div
            className="dialog-body flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-5"
            role={bodyLabel ? 'region' : undefined}
            aria-label={bodyLabel}
            tabIndex={bodyLabel ? 0 : undefined}
          >
            {children}
          </div>
          {footer && (
            <div className="flex shrink-0 justify-end gap-2 border-t px-5 py-3">{footer}</div>
          )}
        </DialogContent>
      </PrimitiveDialog>
    </TooltipAutoFocusContext>
  );
}

export function Empty({
  children,
  icon,
  iconSize = 'default',
  description,
  action,
}: {
  children: ReactNode;
  icon?: ReactNode;
  iconSize?: 'default' | 'lg';
  description?: string;
  action?: ReactNode;
}) {
  return (
    <PrimitiveEmpty>
      <EmptyHeader>
        {icon && (
          <EmptyMedia variant="icon" size={iconSize}>
            {icon}
          </EmptyMedia>
        )}
        <EmptyTitle>{children}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </PrimitiveEmpty>
  );
}

export function Loading() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-4 py-4" role="status">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        {t('loading')}
      </span>
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-8 w-2/3" />
    </div>
  );
}

export function Notice({ error, children }: { error?: boolean; children: ReactNode }) {
  return (
    <Alert variant={error ? 'destructive' : 'default'} role={error ? 'alert' : 'status'}>
      {error ? <TriangleAlert /> : <Info />}
      <AlertDescription className="flex flex-wrap items-center gap-2">{children}</AlertDescription>
    </Alert>
  );
}

export function Badge({
  tone = 'muted',
  children,
  ...props
}: {
  tone?: 'muted' | 'success' | 'danger' | 'info' | 'warning';
} & Omit<ComponentProps<typeof PrimitiveBadge>, 'variant'>) {
  const variants = {
    muted: 'secondary',
    success: 'success',
    danger: 'destructive',
    info: 'info',
    warning: 'warning',
  } as const;
  return (
    <PrimitiveBadge variant={variants[tone]} {...props}>
      {children}
    </PrimitiveBadge>
  );
}

export function Stats({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="stats" data-count={items.length}>
      {items.map((item, index) => (
        <PrimitiveCard size="sm" key={index}>
          <CardHeader>
            <CardDescription>
              <dt>{item.label}</dt>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dd className="text-2xl font-semibold tracking-tight tabular-nums">{item.value}</dd>
          </CardContent>
        </PrimitiveCard>
      ))}
    </dl>
  );
}

export function Field({
  id,
  label,
  children,
  hint,
  labelHidden = false,
  orientation = 'vertical',
}: {
  id: string;
  label: string;
  children: ReactNode;
  hint?: string;
  labelHidden?: boolean;
  orientation?: 'horizontal' | 'vertical';
}) {
  const hintId = `${id}-hint`;
  const describe = (nodes: ReactNode): ReactNode =>
    Children.map(nodes, (node) => {
      if (!isValidElement<{ id?: string; children?: ReactNode; 'aria-describedby'?: string }>(node))
        return node;
      if (node.props.id === id)
        return cloneElement(node, {
          'aria-describedby': [node.props['aria-describedby'], hintId].filter(Boolean).join(' '),
        });
      return node.props.children
        ? cloneElement(node, { children: describe(node.props.children) })
        : node;
    });
  return (
    <FieldGroup>
      <PrimitiveField orientation={orientation}>
        <FieldLabel htmlFor={id} className={cn(labelHidden && 'sr-only')}>
          {label}
        </FieldLabel>
        {hint ? describe(children) : children}
        {hint && <FieldDescription id={hintId}>{hint}</FieldDescription>}
      </PrimitiveField>
    </FieldGroup>
  );
}

export function Toggle({
  id,
  label,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  checked,
  disabled,
  labelClickable = true,
  labelHidden = false,
  onChange,
}: {
  id: string;
  label: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  checked: boolean;
  disabled?: boolean;
  labelClickable?: boolean;
  labelHidden?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <FieldGroup>
      <PrimitiveField orientation="horizontal" data-disabled={disabled || undefined}>
        <FieldContent className={cn('min-w-0', labelHidden && 'sr-only')}>
          {labelClickable ? (
            <FieldLabel id={`${id}-label`} htmlFor={id}>
              {label}
            </FieldLabel>
          ) : (
            <span id={`${id}-label`}>{label}</span>
          )}
        </FieldContent>
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabel ? undefined : `${id}-label`}
          aria-describedby={describedBy}
        />
      </PrimitiveField>
    </FieldGroup>
  );
}

function menuItems(children: ReactNode): ReactElement<ComponentProps<typeof Button>>[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<ComponentProps<typeof Button>>(child)) return [];
    return child.type === Fragment ? menuItems(child.props.children) : [child];
  });
}

export function Menu({
  children,
  label,
  disabled = false,
}: {
  children: ReactNode;
  label?: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          data-menu-trigger
          variant="ghost"
          size="icon"
          aria-label={label || t('actions')}
          disabled={disabled}
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (document.querySelector('[role="alertdialog"]')) event.preventDefault();
        }}
      >
        <DropdownMenuGroup>
          {menuItems(children).map((child, index) => (
            <DropdownMenuItem
              key={index}
              disabled={child.props.disabled}
              variant={child.props.variant === 'destructive' ? 'destructive' : 'default'}
              onClick={child.props.onClick as ComponentProps<typeof DropdownMenuItem>['onClick']}
            >
              {child.props.children}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
