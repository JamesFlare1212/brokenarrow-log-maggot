import { createContext, useContext, useEffect, useRef, useState, type RefObject } from 'react';

export interface DialogReturnState {
  focusKey: string | null;
  focusLabel: string | null;
  scroll: { key: string; index: number; top: number; left: number }[];
}

export const DialogNavigationContext = createContext<DialogReturnState | undefined>(undefined);
const scrollSelector = '.dialog-body,[data-dialog-scroll],[data-slot="table-container"]';
const focusSelector = 'button,a,input,select,textarea,[role="tab"],[tabindex="0"]';
const label = (node: HTMLElement) =>
  node.getAttribute('aria-label') || node.textContent?.trim() || '';
const scrollKey = (node: HTMLElement) => node.dataset.dialogScroll || node.dataset.slot || 'body';

export function captureDialogReturn(): DialogReturnState | undefined {
  const dialog = [
    ...document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"]'),
  ].at(-1);
  if (!dialog) return;
  let active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const menuTrigger = active?.closest('[role="menu"]')?.getAttribute('aria-labelledby');
  if (menuTrigger) active = document.getElementById(menuTrigger);
  const indexes = new Map<string, number>();
  return {
    focusKey: active?.closest<HTMLElement>('[data-dialog-focus]')?.dataset.dialogFocus ?? null,
    focusLabel: active && dialog.contains(active) ? label(active) : null,
    scroll: [...dialog.querySelectorAll<HTMLElement>(scrollSelector)].map((node) => {
      const key = scrollKey(node),
        index = indexes.get(key) ?? 0;
      indexes.set(key, index + 1);
      return { key, index, top: node.scrollTop, left: node.scrollLeft };
    }),
  };
}

export function useDialogReturn(ready: boolean, autoFocus: RefObject<boolean>) {
  const memory = useContext(DialogNavigationContext);
  const root = useRef<HTMLDivElement>(null);
  const isReady = useRef(ready);
  isReady.current = ready;
  const consumed = useRef(false);
  const [targetMissing, setTargetMissing] = useState(false);
  const stop = useRef<() => void>(() => {});
  const restore = () => {
    const dialog = root.current;
    if (!memory || !dialog || consumed.current || !isReady.current) return;
    const candidates = [...dialog.querySelectorAll<HTMLElement>(focusSelector)];
    const source = memory.focusKey
      ? candidates.find((node) => node.dataset.dialogFocus === memory.focusKey)
      : candidates.find((node) => label(node) === memory.focusLabel);
    const target =
      source ?? dialog.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? dialog;
    if (!source && (memory.focusKey || memory.focusLabel)) setTargetMissing(true);
    for (const saved of memory.scroll) {
      const node = [...dialog.querySelectorAll<HTMLElement>(scrollSelector)].filter(
        (candidate) => scrollKey(candidate) === saved.key,
      )[saved.index];
      if (node) {
        node.scrollTop = saved.top;
        node.scrollLeft = saved.left;
      }
    }
    autoFocus.current = true;
    target.focus({ preventScroll: true });
    queueMicrotask(() => {
      autoFocus.current = false;
    });
    if (target !== dialog) target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    consumed.current = true;
    stop.current();
  };
  useEffect(() => {
    restore();
  });
  useEffect(() => () => stop.current(), []);
  return {
    root,
    targetMissing,
    restoreOnOpen: (event: Event) => {
      if (!memory) return false;
      event.preventDefault();
      root.current?.focus({ preventScroll: true });
      const observer = new MutationObserver(restore);
      if (root.current)
        observer.observe(root.current, { childList: true, subtree: true, attributes: true });
      const cancel = (input: Event) => {
        if (!input.isTrusted) return;
        consumed.current = true;
        stop.current();
      };
      document.addEventListener('keydown', cancel, true);
      document.addEventListener('pointerdown', cancel, true);
      stop.current = () => {
        observer.disconnect();
        document.removeEventListener('keydown', cancel, true);
        document.removeEventListener('pointerdown', cancel, true);
      };
      restore();
      return true;
    },
  };
}
