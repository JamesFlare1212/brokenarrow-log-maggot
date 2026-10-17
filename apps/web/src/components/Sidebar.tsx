import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { faAnglesLeft, faAnglesRight } from '@fortawesome/free-solid-svg-icons';
import { useI18n } from '../hooks/useI18n';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';
import { Button } from './ui';

export function Sidebar({
  collapsed,
  className = '',
  ...props
}: ComponentPropsWithoutRef<'aside'> & { collapsed: boolean }) {
  return <aside {...props} className={`app-sidebar ${className}`} data-collapsed={collapsed} />;
}

export function SidebarHeader({
  children,
  collapsed,
  controls,
  onToggle,
}: {
  children: ReactNode;
  collapsed: boolean;
  controls: string;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="sidebar-header">
      {children}
      <Button
        className="sidebar-collapse-toggle button-borderless"
        aria-label={t(collapsed ? 'expandSidebar' : 'collapseSidebar')}
        title={t(collapsed ? 'expandSidebar' : 'collapseSidebar')}
        aria-expanded={!collapsed}
        aria-controls={controls}
        onClick={onToggle}
      >
        <Icon icon={collapsed ? faAnglesRight : faAnglesLeft} size={16} />
      </Button>
    </div>
  );
}

export function SidebarHeading({
  icon,
  children,
  className = '',
}: {
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`sidebar-heading ${className}`}>
      <span className="sidebar-heading-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="sidebar-heading-label">{children}</div>
    </div>
  );
}

export function SidebarNavigation({
  as: Element = 'nav',
  className = '',
  ...props
}: ComponentPropsWithoutRef<'nav'> & { as?: 'nav' | 'div' }) {
  return <Element {...props} className={`sidebar-navigation ${className}`} />;
}

export function SidebarItem({
  icon,
  label,
  selected = false,
  className = '',
  title,
  ...props
}: ComponentPropsWithoutRef<'button'> & { icon: ReactNode; label: string; selected?: boolean }) {
  const button = (
    <button
      type="button"
      {...props}
      className={`sidebar-item ${className}`}
      data-selected={selected}
    >
      <span className="sidebar-item-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="sidebar-item-label">{label}</span>
    </button>
  );
  return title ? (
    <Tooltip content={title} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}

export function SidebarFooter({ className = '', ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={`app-sidebar-footer ${className}`} />;
}
