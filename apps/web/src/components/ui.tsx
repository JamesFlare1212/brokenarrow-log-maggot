import * as RadixDialog from '@radix-ui/react-dialog';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  useId,
  useRef,
  type ReactElement,
} from 'react';
import {
  faXmark,
  faChevronDown,
  faChevronUp,
  faSpinner,
  faEllipsis,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from './Icon';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { useI18n } from '../hooks/useI18n';
import { TooltipAutoFocusContext, TooltipButton } from './Tooltip';
export function Button({
  variant = 'ghost',
  className = '',
  children,
  ...props
}: ComponentPropsWithRef<'button'> & {
  variant?: 'primary' | 'danger' | 'ghost';
  tooltip?: ReactNode;
}) {
  return (
    <TooltipButton {...props} className={`button button-${variant} ${className}`}>
      {children}
    </TooltipButton>
  );
}
export function Card({
  title,
  icon,
  actions,
  children,
  collapsed = false,
  onToggle,
  className = '',
  showHeader = true,
}: {
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
  className?: string;
  showHeader?: boolean;
}) {
  const { t } = useI18n();
  const contentId = useId();
  return (
    <section className={`card ${className}`} aria-label={showHeader ? undefined : title}>
      {showHeader && (
        <div className="card-header">
          <h2>
            {icon && (
              <span className="card-icon" aria-hidden="true">
                {icon}
              </span>
            )}
            {title}
          </h2>
          <div className="actions">
            {actions}
            {onToggle && (
              <Button
                onClick={onToggle}
                aria-label={title + ' ' + t(collapsed ? 'expand' : 'collapse')}
                aria-expanded={!collapsed}
                aria-controls={contentId}
              >
                {collapsed ? (
                  <Icon icon={faChevronDown} size={16} />
                ) : (
                  <Icon icon={faChevronUp} size={16} />
                )}
              </Button>
            )}
          </div>
        </div>
      )}
      {!collapsed && (
        <div className="card-body" id={contentId}>
          {children}
        </div>
      )}
    </section>
  );
}
export function Dialog({
  open,
  onClose,
  title,
  children,
  className = '',
  showHeader = true,
  banner,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
  showHeader?: boolean;
  banner?: ReactNode;
}) {
  const { t } = useI18n();
  const returnFocus = useRef<HTMLElement | null>(null);
  const autoFocus = useRef(false);
  const dialogTitle = (
    <RadixDialog.Title className={showHeader ? undefined : 'sr-only'}>{title}</RadixDialog.Title>
  );
  const closeButton = (
    <RadixDialog.Close asChild>
      <Button aria-label={t('close')} className={showHeader ? undefined : 'dialog-close-button'}>
        <Icon icon={faXmark} size={showHeader ? 18 : 22} />
      </Button>
    </RadixDialog.Close>
  );
  return (
    <TooltipAutoFocusContext value={autoFocus}>
      <RadixDialog.Root
        open={open}
        onOpenChange={(value) => {
          if (!value) onClose();
        }}
      >
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="dialog-overlay" />
          <RadixDialog.Content
            className={`dialog ${className}`}
            aria-describedby={undefined}
            onOpenAutoFocus={() => {
              autoFocus.current = true;
              queueMicrotask(() => {
                autoFocus.current = false;
              });
              returnFocus.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null;
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              queueMicrotask(() => {
                if (!document.querySelector('[role="dialog"]') && returnFocus.current?.isConnected)
                  returnFocus.current.focus();
              });
            }}
          >
            {!showHeader && banner ? (
              <>
                {dialogTitle}
                <div className="dialog-banner">
                  {banner}
                  {closeButton}
                </div>
              </>
            ) : (
              <div className={showHeader ? 'dialog-header' : 'dialog-headerless-controls'}>
                {dialogTitle}
                {closeButton}
              </div>
            )}
            <div className="dialog-body">{children}</div>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
    </TooltipAutoFocusContext>
  );
}
export function Empty({
  children,
  icon,
  description,
  action,
}: {
  children: ReactNode;
  icon?: ReactNode;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && (
        <span className="empty-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <strong>{children}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function Loading() {
  const { t } = useI18n();
  return (
    <div className="loading" role="status">
      <Icon icon={faSpinner} spin size={18} aria-hidden="true" />
      {t('loading')}
    </div>
  );
}
export function Notice({ error, children }: { error?: boolean; children: ReactNode }) {
  return (
    <div className={`notice ${error ? 'notice-error' : ''}`} role={error ? 'alert' : undefined}>
      {children}
    </div>
  );
}
export function Badge({
  tone = 'muted',
  children,
}: {
  tone?: 'muted' | 'success' | 'danger' | 'info' | 'warning';
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function Stats({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <div className="stats">
      {items.map((item, index) => (
        <div className="stat" key={index}>
          <strong>{item.value}</strong>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
export function Field({
  id,
  label,
  children,
  hint,
}: {
  id: string;
  label: string;
  children: ReactNode;
  hint?: string;
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
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? describe(children) : children}
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}
export function Toggle({
  id,
  label,
  'aria-label': ariaLabel,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  'aria-label'?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggle" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="checkbox"
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  );
}
function menuItems(children: ReactNode): ReactElement[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) return [];
    return child.type === Fragment
      ? menuItems((child.props as { children: ReactNode }).children)
      : [child];
  });
}
export function Menu({ children, label }: { children: ReactNode; label?: string }) {
  const { t } = useI18n();
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <Button data-menu-trigger aria-label={label || t('actions')}>
          <Icon icon={faEllipsis} size={18} />
        </Button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className="menu-content" align="end" sideOffset={6}>
          {menuItems(children).map((child, index) => (
            <Dropdown.Item asChild key={index}>
              {child}
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
