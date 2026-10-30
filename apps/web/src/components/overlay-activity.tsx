import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';

export const OverlayActivityContext = createContext<(token: object) => () => void>(() => () => {});

export function useTrackedOverlay<
  T extends { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void },
>(props: T) {
  const register = useContext(OverlayActivityContext);
  const token = useRef({});
  const [localOpen, setLocalOpen] = useState(props.defaultOpen ?? false);
  const open = props.open ?? localOpen;
  useLayoutEffect(() => (open ? register(token.current) : undefined), [open, register]);
  return {
    ...props,
    open,
    onOpenChange: (value: boolean) => {
      if (props.open === undefined) setLocalOpen(value);
      props.onOpenChange?.(value);
    },
  };
}
