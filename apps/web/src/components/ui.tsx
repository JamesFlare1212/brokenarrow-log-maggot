import * as RadixDialog from '@radix-ui/react-dialog';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Children, Fragment, isValidElement, useRef, type ReactElement } from 'react';
import { X, ChevronDown, ChevronUp, LoaderCircle, MoreHorizontal } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { useI18n } from '../hooks/useI18n';
export function Button({
  variant = 'ghost',
  className = '',
  children,
  ...props
}: ComponentPropsWithRef<'button'> & { variant?: 'primary' | 'danger' | 'ghost' }) {
  return (
    <button type="button" {...props} className={`button button-${variant} ${className}`}>
      {children}
    </button>
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
}: {
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <section className={`card ${className}`}>
      <div className="card-header">
        <h2>
          {icon}
          {title}
        </h2>
        <div className="actions">
          {actions}
          {onToggle && (
            <Button
              onClick={onToggle}
              aria-label={title + ' ' + t(collapsed ? 'expand' : 'collapse')}
              aria-expanded={!collapsed}
            >
              {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </Button>
          )}
        </div>
      </div>
      {!collapsed && <div className="card-body">{children}</div>}
    </section>
  );
}
export function Dialog({
  open,
  onClose,
  title,
  children,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
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
          <div className="dialog-header">
            <RadixDialog.Title>{title}</RadixDialog.Title>
            <RadixDialog.Close asChild>
              <Button aria-label={t('close')}>
                <X size={18} />
              </Button>
            </RadixDialog.Close>
          </div>
          <div className="dialog-body">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Loading() {
  const { t } = useI18n();
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spinner" size={18} />
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
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}
export function Toggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggle" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="checkbox"
        checked={checked}
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
export function Menu({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <Button data-menu-trigger aria-label={t('actions')}>
          <MoreHorizontal size={18} />
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
