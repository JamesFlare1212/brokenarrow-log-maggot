function scrollport(target: HTMLElement, supplied?: HTMLElement | null): HTMLElement {
  if (supplied) return supplied;
  let parent = target.parentElement;
  while (parent) {
    if (
      /(auto|scroll)/.test(getComputedStyle(parent).overflowY) &&
      parent.scrollHeight > parent.clientHeight
    )
      return parent;
    parent = parent.parentElement;
  }
  return target.ownerDocument.scrollingElement as HTMLElement;
}

export function scrollToElement(
  target: HTMLElement | null | undefined,
  container: HTMLElement | null | undefined,
  topInset = 0,
  align: 'start' | 'nearest' | 'center' = 'nearest',
) {
  if (!target) return;
  const viewport = scrollport(target, container);
  const documentScroll = viewport === target.ownerDocument.scrollingElement;
  const bounds = viewport.getBoundingClientRect();
  const top = documentScroll ? 0 : bounds.top + viewport.clientTop;
  const height = documentScroll
    ? target.ownerDocument.documentElement.clientHeight
    : viewport.clientHeight;
  const style = documentScroll ? null : getComputedStyle(viewport);
  const paddingTop = Number.parseFloat(style?.paddingTop ?? '0') || 0;
  const paddingBottom = Number.parseFloat(style?.paddingBottom ?? '0') || 0;
  const usableTop = top + paddingTop + topInset;
  const bottom = top + height - paddingBottom;
  const rect = target.getBoundingClientRect();
  let delta = 0;
  if (align === 'start' || rect.height >= bottom - usableTop) delta = rect.top - usableTop;
  else if (align === 'center') delta = (rect.top + rect.bottom - usableTop - bottom) / 2;
  else if (rect.top < usableTop) delta = rect.top - usableTop;
  else if (rect.bottom > bottom) delta = rect.bottom - bottom;
  if (delta)
    viewport.scrollTo({
      top: Math.max(0, Math.min(viewport.scrollHeight - height, viewport.scrollTop + delta)),
      behavior: 'instant',
    });
}
