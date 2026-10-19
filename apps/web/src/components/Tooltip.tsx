import * as Popper from '@radix-ui/react-popper';
import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { ComponentPropsWithRef, ReactElement, ReactNode, RefObject } from 'react';

export const TooltipAutoFocusContext = createContext<RefObject<boolean> | null>(null);

export function TooltipButton({
  title,
  tooltip,
  tooltipSide = 'top',
  pinOnClick = false,
  ...props
}: ComponentPropsWithRef<'button'> & {
  tooltip?: ReactNode;
  tooltipSide?: 'top' | 'right';
  pinOnClick?: boolean;
}) {
  const content = tooltip === undefined ? (title ?? props['aria-label']) : tooltip;
  const button = <button type="button" {...props} />;
  return content ? (
    <Tooltip content={content} side={tooltipSide} pinOnClick={pinOnClick}>
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
  pinOnClick = false,
}: {
  content: ReactNode;
  children: ReactElement<ComponentPropsWithRef<'button'>>;
  side?: 'top' | 'right';
  pinOnClick?: boolean;
}) {
  const id = useId();
  const autoFocus = useContext(TooltipAutoFocusContext);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focused = useRef(false);
  const bubble = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const forwardedRef = children.props.ref;
  const anchorRef = useCallback(
    (node: HTMLButtonElement | null) => {
      anchor.current = node;
      if (typeof forwardedRef === 'function') return forwardedRef(node);
      if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );
  const cancel = () => clearTimeout(timer.current);
  const close = () => {
    cancel();
    setOpen(false);
    setPinned(false);
  };
  const show = () => {
    window.dispatchEvent(new CustomEvent('ba:tooltip-open', { detail: id }));
    setOpen(true);
  };
  const enter = () => {
    cancel();
    if (pinned) return;
    timer.current = setTimeout(show, 400);
  };
  const leave = () => {
    cancel();
    if (!focused.current && !pinned) timer.current = setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const dismissOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail === id) return;
      clearTimeout(timer.current);
      setOpen(false);
      setPinned(false);
    };
    window.addEventListener('ba:tooltip-open', dismissOther);
    return () => window.removeEventListener('ba:tooltip-open', dismissOther);
  }, [id]);
  useEffect(() => {
    if (!open) return;
    const dismiss = () => {
      clearTimeout(timer.current);
      setOpen(false);
      setPinned(false);
    };
    const pointerDown = (event: PointerEvent) => {
      if (
        pinned &&
        (anchor.current?.contains(event.target as Node) ||
          bubble.current?.contains(event.target as Node))
      )
        return;
      dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (pinned && event.key === 'Tab') {
        dismiss();
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    const scroll = (event: Event) => {
      if (!bubble.current?.contains(event.target as Node)) dismiss();
    };
    window.addEventListener('keydown', escape, true);
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('keydown', escape, true);
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [open, pinned]);

  const props = children.props;
  return (
    <Popper.Root>
      <Popper.Anchor asChild>
        {cloneElement(children, {
          ref: anchorRef,
          title: undefined,
          'aria-expanded': pinOnClick ? pinned : props['aria-expanded'],
          'aria-controls': pinOnClick && pinned ? id : props['aria-controls'],
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
            if (!pinned) close();
          },
          onPointerDown: (event) => {
            props.onPointerDown?.(event);
            if (!pinOnClick) close();
          },
          onClick: (event) => {
            props.onClick?.(event);
            if (!pinOnClick || pinned) close();
            else {
              setPinned(true);
              show();
            }
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
