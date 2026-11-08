// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar, SidebarProvider } from '../apps/web/src/components/Sidebar';
import { LocaleContext } from '../apps/web/src/hooks/useI18n';

const originalWidth = window.innerWidth;

function viewport(width: number) {
  act(() => {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    window.dispatchEvent(new Event('resize'));
  });
}

function Harness({
  initial = 256,
  open = true,
  commit,
  toggle,
}: {
  initial?: number;
  open?: boolean;
  commit: (width: number) => void;
  toggle?: (open: boolean) => void;
}) {
  const [width, setWidth] = useState(initial);
  return (
    <LocaleContext.Provider value="en">
      <SidebarProvider
        width={width}
        open={open}
        onOpenChange={toggle}
        onWidthChange={(next) => {
          commit(next);
          setWidth(next);
        }}
      >
        <Sidebar id="test-sidebar">
          <span>Navigation</span>
        </Sidebar>
        <main>Workspace</main>
      </SidebarProvider>
    </LocaleContext.Provider>
  );
}

function handle() {
  return screen.getByRole('separator', { name: 'Drag to resize sidebar' });
}

function currentWidth() {
  return Number(handle().getAttribute('aria-valuenow'));
}

function pointer(
  type: string,
  clientX: number,
  options: { id?: number; primary?: boolean; button?: number } = {},
) {
  const event = new window.PointerEvent(type, {
    bubbles: true,
    clientX,
    button: options.button ?? 0,
    pointerType: 'mouse',
  });
  Object.defineProperties(event, {
    pointerId: { value: options.id ?? 1 },
    isPrimary: { value: options.primary ?? true },
  });
  fireEvent(handle(), event);
}

beforeEach(() => viewport(1280));
afterEach(() => {
  cleanup();
  viewport(originalWidth);
});

describe('sidebar resizing', () => {
  it('previews dragging and commits once on release without collapsing navigation', () => {
    const commit = vi.fn(),
      toggle = vi.fn();
    render(<Harness commit={commit} toggle={toggle} />);
    expect(handle().getAttribute('aria-controls')).toBe('test-sidebar');
    pointer('pointerdown', 256);
    pointer('pointermove', 300);
    pointer('pointermove', 340);
    expect(currentWidth()).toBe(340);
    expect(commit).not.toHaveBeenCalled();
    pointer('pointerup', 340);
    expect(commit).toHaveBeenCalledExactlyOnceWith(340);
    fireEvent.click(handle());
    expect(toggle).not.toHaveBeenCalled();
    expect(handle().closest('[data-slot=sidebar-wrapper]')?.hasAttribute('data-resizing')).toBe(
      false,
    );
  });

  it.each(['Escape', 'pointercancel', 'lostpointercapture', 'blur'])(
    'restores the saved width on %s without persisting a partial drag',
    (reason) => {
      const commit = vi.fn();
      render(<Harness commit={commit} />);
      pointer('pointerdown', 256);
      pointer('pointermove', 320);
      expect(currentWidth()).toBe(320);
      if (reason === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
      else if (reason === 'blur') fireEvent(window, new Event('blur'));
      else pointer(reason, 320);
      expect(currentWidth()).toBe(256);
      expect(commit).not.toHaveBeenCalled();
      expect(handle().closest('[data-slot=sidebar-wrapper]')?.hasAttribute('data-resizing')).toBe(
        false,
      );
    },
  );

  it('supports bounded keyboard adjustment, larger steps, and both reset methods', () => {
    const commit = vi.fn();
    render(<Harness commit={commit} />);
    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(currentWidth()).toBe(272);
    fireEvent.keyDown(handle(), { key: 'ArrowRight', shiftKey: true });
    expect(currentWidth()).toBe(336);
    fireEvent.keyDown(handle(), { key: 'Home' });
    expect(currentWidth()).toBe(200);
    const calls = commit.mock.calls.length;
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
    expect(commit).toHaveBeenCalledTimes(calls);
    fireEvent.keyDown(handle(), { key: 'End' });
    expect(currentWidth()).toBe(400);
    fireEvent.keyDown(handle(), { key: 'Enter' });
    expect(currentWidth()).toBe(256);
    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    fireEvent.doubleClick(handle());
    expect(currentWidth()).toBe(256);
  });

  it('protects workspace room without overwriting the preferred width on viewport changes', () => {
    const commit = vi.fn();
    render(<Harness initial={400} commit={commit} />);
    viewport(768);
    expect(currentWidth()).toBe(288);
    expect(handle().getAttribute('aria-valuemax')).toBe('288');
    fireEvent.keyDown(handle(), { key: 'End' });
    viewport(1280);
    expect(currentWidth()).toBe(400);
    expect(commit).not.toHaveBeenCalled();
  });

  it('cancels an active drag when collapsed and omits the handle on mobile', () => {
    const commit = vi.fn();
    const view = render(<Harness commit={commit} />);
    pointer('pointerdown', 256);
    pointer('pointermove', 320);
    view.rerender(<Harness commit={commit} open={false} />);
    expect(screen.queryByRole('separator')).toBeNull();
    view.rerender(<Harness commit={commit} />);
    expect(currentWidth()).toBe(256);
    viewport(375);
    expect(screen.queryByRole('separator')).toBeNull();
    viewport(1280);
    expect(currentWidth()).toBe(256);
    expect(commit).not.toHaveBeenCalled();
  });

  it('ignores secondary pointers and button presses during the primary drag', () => {
    const commit = vi.fn();
    render(<Harness commit={commit} />);
    pointer('pointerdown', 256, { primary: false });
    pointer('pointermove', 320);
    pointer('pointerup', 320);
    pointer('pointerdown', 256, { button: 2 });
    pointer('pointermove', 320);
    pointer('pointerup', 320);
    expect(currentWidth()).toBe(256);
    pointer('pointerdown', 256, { id: 7 });
    pointer('pointermove', 320, { id: 8 });
    pointer('pointercancel', 320, { id: 8 });
    expect(currentWidth()).toBe(256);
    pointer('pointermove', 320, { id: 7 });
    pointer('pointerup', 320, { id: 7 });
    expect(commit).toHaveBeenCalledExactlyOnceWith(320);
  });
});
