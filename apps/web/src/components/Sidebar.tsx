import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '../hooks/useI18n';
import { Tooltip, TooltipButton } from './Tooltip';
import {
  Sidebar as PrimitiveSidebar,
  SidebarContent,
  SidebarFooter as PrimitiveFooter,
  SidebarHeader as PrimitiveHeader,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from './ui/sidebar';

export function Sidebar({
  hidden,
  className,
  label,
  ...props
}: ComponentPropsWithoutRef<'div'> & { label?: string }) {
  const { t } = useI18n();
  if (hidden) return null;
  return (
    <PrimitiveSidebar
      {...props}
      variant="inset"
      collapsible="offcanvas"
      className={className}
      label={label ?? t('workspaceNav')}
    />
  );
}

export function SidebarHeader({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <PrimitiveHeader className="min-h-16 justify-center">
      <div className="flex min-h-12 items-center gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        {isMobile && (
          <TooltipButton
            variant="ghost"
            size="icon-sm"
            aria-label={t('closeNavigation')}
            onClick={() => setOpenMobile(false)}
          >
            <X />
          </TooltipButton>
        )}
      </div>
    </PrimitiveHeader>
  );
}

export function SidebarToggle({ controls }: { controls: string }) {
  const { t } = useI18n();
  const { isMobile, openMobile, open } = useSidebar();
  const label = t(
    isMobile
      ? openMobile
        ? 'closeNavigation'
        : 'openNavigation'
      : open
        ? 'collapseSidebar'
        : 'expandSidebar',
  );
  return (
    <Tooltip content={label} side="bottom">
      <SidebarTrigger
        className="-ml-1 shrink-0"
        aria-label={label}
        aria-expanded={isMobile ? openMobile : open}
        aria-controls={controls}
      />
    </Tooltip>
  );
}

export function SidebarHeading({
  icon,
  children,
  className,
}: {
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-3 px-2 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0',
        className,
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center" aria-hidden="true">
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5 truncate group-data-[collapsible=icon]:hidden">
        {children}
      </div>
    </div>
  );
}

export function SidebarNavigation({
  as: Element = 'nav',
  className,
  heading,
  ...props
}: ComponentPropsWithoutRef<'nav'> & { as?: 'nav' | 'div'; heading?: string }) {
  return (
    <SidebarContent className="group-data-[collapsible=icon]:overflow-auto">
      <Element {...props} className={cn('py-2', className)}>
        <SidebarGroup>
          {heading && <SidebarGroupLabel>{heading}</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu className="gap-1 group-data-[collapsible=icon]:items-center">
              {props.children}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </Element>
    </SidebarContent>
  );
}

export function SidebarItem({
  icon,
  label,
  selected = false,
  className,
  title,
  ...props
}: ComponentPropsWithoutRef<'button'> & { icon: ReactNode; label: string; selected?: boolean }) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        {...props}
        size="workspace"
        onClick={(event) => {
          props.onClick?.(event);
          if (isMobile) setOpenMobile(false);
        }}
        className={className}
        isActive={selected}
        tooltip={title || label}
      >
        {icon}
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function SidebarFooter(props: ComponentPropsWithoutRef<'div'>) {
  return (
    <PrimitiveFooter {...props}>
      <SidebarMenu className="gap-1 group-data-[collapsible=icon]:items-center">
        {props.children}
      </SidebarMenu>
    </PrimitiveFooter>
  );
}
