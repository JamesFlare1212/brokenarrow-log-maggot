import type { ComponentPropsWithoutRef } from 'react';
import { faOutdent, faIndent } from '@fortawesome/free-solid-svg-icons';
import { Icon } from './Icon';
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
      {collapsed ? <Icon icon={faIndent} size={18} /> : <Icon icon={faOutdent} size={18} />}
    </Button>
  );
}
