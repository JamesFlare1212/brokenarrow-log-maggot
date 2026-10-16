import * as Popper from '@radix-ui/react-popper';
import { cloneElement, createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ComponentPropsWithRef, ReactElement, ReactNode, RefObject } from 'react';

export const TooltipAutoFocusContext = createContext<RefObject<boolean> | null>(null);

export function TooltipButton({
  title,
  tooltip,
  tooltipSide = 'top',
  ...props
}: ComponentPropsWithRef<'button'> & {
  tooltip?: ReactNode;
  tooltipSide?: 'top' | 'right';
}) {
  const content = tooltip === undefined ? (title ?? props['aria-label']) : tooltip;
  const button = <button type="button" {...props} />;
  return content ? (
    <Tooltip content={content} side={tooltipSide}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}

export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode;
  children: ReactElement<ComponentPropsWithRef<'button'>>;
  side?: 'top' | 'right';
}) {
  const id = useId();
  const autoFocus = useContext(TooltipAutoFocusContext);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focused = useRef(false);
  const bubble = useRef<HTMLDivElement>(null);
  const cancel = () => clearTimeout(timer.current);
  const close = () => {
    cancel();
    setOpen(false);
  };
  const show = () => {
    window.dispatchEvent(new CustomEvent('ba:tooltip-open', { detail: id }));
    setOpen(true);
  };
  const enter = () => {
    cancel();
    timer.current = setTimeout(show, 400);
  };
  const leave = () => {
    cancel();
    if (!focused.current) timer.current = setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const dismissOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail === id) return;
      clearTimeout(timer.current);
      setOpen(false);
    };
    window.addEventListener('ba:tooltip-open', dismissOther);
    return () => window.removeEventListener('ba:tooltip-open', dismissOther);
  }, [id]);
  useEffect(() => {
    if (!open) return;
    const dismiss = () => {
      clearTimeout(timer.current);
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    const scroll = (event: Event) => {
      if (!bubble.current?.contains(event.target as Node)) dismiss();
    };
    window.addEventListener('keydown', escape, true);
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('keydown', escape, true);
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [open]);

  const props = children.props;
  return (
    <Popper.Root>
      <Popper.Anchor asChild>
        {cloneElement(children, {
          title: undefined,
          'aria-describedby':
            [props['aria-describedby'], open ? id : undefined].filter(Boolean).join(' ') ||
            undefined,
          onPointerEnter: (event) => {
            props.onPointerEnter?.(event);
            if (event.pointerType !== 'touch') enter();
          },
          onPointerLeave: (event) => {
            props.onPointerLeave?.(event);
            leave();
          },
          onFocus: (event) => {
            props.onFocus?.(event);
            if (autoFocus?.current || !event.currentTarget.matches(':focus-visible')) return;
            focused.current = true;
            cancel();
            show();
          },
          onBlur: (event) => {
            props.onBlur?.(event);
            focused.current = false;
            close();
          },
          onPointerDown: (event) => {
            props.onPointerDown?.(event);
            close();
          },
          onClick: (event) => {
            props.onClick?.(event);
            close();
          },
        })}
      </Popper.Anchor>
      {open &&
        createPortal(
          <Popper.Content
            ref={bubble}
            id={id}
            role="tooltip"
            className="button-tooltip"
            side={side}
            sideOffset={8}
            collisionPadding={8}
            hideWhenDetached
            onPointerEnter={cancel}
            onPointerLeave={leave}
          >
            {content}
          </Popper.Content>,
          document.body,
        )}
    </Popper.Root>
  );
}
