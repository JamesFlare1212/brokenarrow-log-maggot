// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRosterHeight } from '../apps/web/src/features/session/useRosterHeight';

let size = { width: 900, height: 480 };
const observers = new Set<() => void>();

beforeEach(() => {
  size = { width: 900, height: 480 };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, size.width, size.height),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private resize: () => void) {}
      observe() {
        observers.add(this.resize);
      }
      disconnect() {
        observers.delete(this.resize);
      }
    },
  );
});

afterEach(() => {
  cleanup();
  observers.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Roster({ populated }: { populated: boolean }) {
  const { layout, reservedHeight } = useRosterHeight(populated);
  return (
    <div
      ref={layout}
      data-testid="layout"
      style={{ minHeight: populated ? undefined : (reservedHeight ?? undefined) }}
    >
      {populated ? 'Player roster' : 'Waiting for game logs'}
    </div>
  );
}

describe('empty room height reservation', () => {
  it('keeps the populated roster natural and reserves its latest height only while empty', () => {
    const { rerender, unmount } = render(<Roster populated />);
    const layout = screen.getByTestId('layout');
    expect(layout.style.minHeight).toBe('');
    rerender(<Roster populated={false} />);
    expect(layout.style.minHeight).toBe('480px');

    // A shorter room must replace the old height rather than retain unused space.
    size.height = 400;
    rerender(<Roster populated />);
    expect(layout.style.minHeight).toBe('');
    rerender(<Roster populated={false} />);
    expect(layout.style.minHeight).toBe('400px');
    unmount();
    expect(observers.size).toBe(0);
  });

  it('discards heights measured at another width and tracks wrapping in a populated roster', () => {
    const { rerender } = render(<Roster populated />);
    size.height = 520;
    act(() => observers.forEach((resize) => resize()));
    rerender(<Roster populated={false} />);
    expect(screen.getByTestId('layout').style.minHeight).toBe('520px');

    size = { width: 440, height: 940 };
    act(() => observers.forEach((resize) => resize()));
    expect(screen.getByTestId('layout').style.minHeight).toBe('');
    rerender(<Roster populated />);
    rerender(<Roster populated={false} />);
    expect(screen.getByTestId('layout').style.minHeight).toBe('940px');
  });
});
