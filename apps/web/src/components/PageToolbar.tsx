import type { ComponentPropsWithoutRef } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useI18n } from '../hooks/useI18n';
import { Button } from './ui';

export function PageToolbar({ className = '', ...props }: ComponentPropsWithoutRef<'header'>) {
  return <header {...props} className={`page-toolbar ${className}`} />;
}

export function SidebarToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <Button
      className="sidebar-collapse-toggle button-borderless"
      aria-label={t(collapsed ? 'expandSidebar' : 'collapseSidebar')}
      aria-expanded={!collapsed}
      onClick={onToggle}
    >
      {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
    </Button>
  );
}
