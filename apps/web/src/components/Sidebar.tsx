import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export function Sidebar({
  collapsed,
  className = '',
  ...props
}: ComponentPropsWithoutRef<'aside'> & { collapsed: boolean }) {
  return <aside {...props} className={`app-sidebar ${className}`} data-collapsed={collapsed} />;
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
  ...props
}: ComponentPropsWithoutRef<'button'> & { icon: ReactNode; label: string; selected?: boolean }) {
  return (
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
}

export function SidebarFooter({ className = '', ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={`app-sidebar-footer ${className}`} />;
}
