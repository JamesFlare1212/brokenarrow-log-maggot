// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, Dialog, Menu } from '../apps/web/src/components/ui';
import { TooltipButton } from '../apps/web/src/components/Tooltip';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('button tooltips', () => {
  it('gives icon controls consistent hints without changing their classes or click behavior', async () => {
    const select = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <TooltipButton className="palette-choice" aria-label="Ocean palette" onClick={select}>
        <span aria-hidden="true" />
      </TooltipButton>,
    );
    const button = screen.getByRole('button', { name: 'Ocean palette' });
    expect(container.firstElementChild).toBe(button);
    expect(button.className).toBe('palette-choice');
    await user.tab();
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe('Ocean palette');
    await user.keyboard('{Enter}');
    expect(select).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });

  it('replaces the focused button hint when another icon button is hovered', async () => {
    vi.useFakeTimers();
    render(
      <>
        <Button aria-label="Copy team">
          <span aria-hidden="true" />
        </Button>
        <Button aria-label="Move up">
          <span aria-hidden="true" />
        </Button>
      </>,
    );
    act(() => screen.getByRole('button', { name: 'Copy team' }).focus());
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe('Copy team');
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Move up' }));
    await act(async () => vi.advanceTimersByTime(400));
    expect(screen.getAllByRole('tooltip', { hidden: true })).toHaveLength(1);
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe('Move up');
  });

  it('keeps menu keyboard navigation working with a tooltip on the trigger', async () => {
    const activate = vi.fn();
    const user = userEvent.setup();
    render(
      <Menu label="Match actions">
        <Button onClick={activate}>Refresh</Button>
      </Menu>,
    );
    await user.tab();
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe('Match actions');
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.keyboard('{Enter}');
    expect(activate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('supports keyboard focus, preserves descriptions and dismisses without activating', async () => {
    const activate = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <>
        <span id="description">Existing description</span>
        <Button title="Check for updates" aria-describedby="description" onClick={activate}>
          Update
        </Button>
      </>,
    );
    const button = screen.getByRole('button');
    expect(button.hasAttribute('title')).toBe(false);
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    await user.tab();
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip.textContent).toBe('Check for updates');
    expect(button.getAttribute('aria-describedby')).toBe(`description ${tooltip.id}`);
    expect(container.contains(tooltip)).toBe(false);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    expect(button.getAttribute('aria-describedby')).toBe('description');
    expect(document.activeElement).toBe(button);
    expect(activate).not.toHaveBeenCalled();
    await user.tab();
    await user.tab({ shift: true });
    expect(screen.getByRole('tooltip', { hidden: true })).toBeTruthy();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('delays hover, allows moving into the bubble and cancels abandoned hovers', async () => {
    vi.useFakeTimers();
    render(<Button title="Update details">Update</Button>);
    const button = screen.getByRole('button');
    fireEvent.pointerEnter(button);
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    fireEvent.pointerLeave(button);
    await act(async () => vi.advanceTimersByTime(500));
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    fireEvent.pointerEnter(button);
    await act(async () => vi.advanceTimersByTime(400));
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    fireEvent.pointerLeave(button);
    fireEvent.pointerEnter(tooltip);
    await act(async () => vi.advanceTimersByTime(200));
    expect(screen.getByRole('tooltip', { hidden: true })).toBe(tooltip);
    fireEvent.pointerLeave(tooltip);
    await act(async () => vi.advanceTimersByTime(120));
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });

  it('explains disabled actions on hover and removes stale bubbles on scroll and unmount', async () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <Button title="Wait for the match to end" disabled>
        Install
      </Button>,
    );
    const button = screen.getByRole('button');
    fireEvent.pointerEnter(button);
    await act(async () => vi.advanceTimersByTime(400));
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe(
      'Wait for the match to end',
    );
    fireEvent.scroll(document);
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    fireEvent.pointerEnter(button);
    unmount();
    await act(async () => vi.advanceTimersByTime(500));
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });

  it('dismisses a tooltip inside a dialog before dismissing the dialog', async () => {
    const close = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog open title="Settings" onClose={close}>
        <Button title="Check for updates">Update</Button>
      </Dialog>,
    );
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    await user.tab();
    expect(screen.getByRole('tooltip', { hidden: true })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    expect(close).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
