// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, Dialog, Menu } from '../apps/web/src/components/ui';
import { TooltipBadge, TooltipButton } from '../apps/web/src/components/Tooltip';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('button tooltips', () => {
  it('uses a Badge trigger with the same rich panel and content for hover and click', async () => {
    vi.useFakeTimers();
    render(
      <TooltipBadge
        variant="info"
        tooltip={
          <section>
            <h3>Match evidence</h3>
            <p>Damage dealt: 1,471</p>
          </section>
        }
      >
        Damage Dealer
      </TooltipBadge>,
    );
    const badge = screen.getByRole('button', { name: 'Damage Dealer' });
    expect(badge.getAttribute('data-slot')).toBe('badge');
    expect(badge.getAttribute('data-variant')).toBe('info');
    expect(badge.classList.contains('group/button')).toBe(false);
    fireEvent.pointerMove(badge, { pointerType: 'mouse' });
    await act(async () => vi.advanceTimersByTime(400));
    const hover = document.querySelector<HTMLElement>('[data-slot=tooltip-content]')!;
    const content = hover.firstElementChild!.innerHTML;
    const panelClasses = (element: HTMLElement) =>
      element.className
        .split(/\s+/)
        .filter(
          (name) => !name.startsWith('origin-') && !name.startsWith('data-[state=delayed-open]'),
        )
        .sort();
    const hoverClasses = panelClasses(hover);
    fireEvent.click(badge);
    const pinned = document.querySelector<HTMLElement>('[data-slot=popover-content]')!;
    expect(pinned.firstElementChild!.innerHTML).toBe(content);
    expect(panelClasses(pinned)).toEqual(hoverClasses);
    fireEvent.pointerLeave(badge);
    await act(async () => vi.advanceTimersByTime(500));
    expect(document.querySelector('[data-slot=popover-content]')).toBe(pinned);
    fireEvent.click(badge);
    expect(document.querySelector('[data-slot=popover-content]')).toBeNull();
  });

  it('pins explanations through pointer movement and closes on a second click, outside press or Escape', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <TooltipButton pinOnClick tooltip="Match evidence">
        Carry
      </TooltipButton>,
    );
    const button = screen.getByRole('button', { name: 'Carry' });
    await user.click(button);
    const tooltip = explanation();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(container.contains(tooltip)).toBe(false);
    fireEvent.pointerLeave(button);
    fireEvent.pointerDown(tooltip);
    expect(explanation()).toBe(tooltip);
    await user.click(button);
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await user.click(button);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    await user.click(button);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });

  it('opens pinned evidence with the keyboard and dismisses it as focus moves on', async () => {
    const user = userEvent.setup();
    render(
      <>
        <TooltipButton pinOnClick tooltip="Match evidence">
          Carry
        </TooltipButton>
        <button>Next</button>
      </>,
    );
    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Carry' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next' }));
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });

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
    expect(button.classList.contains('palette-choice')).toBe(true);
    expect(button.getAttribute('data-slot')).toBe('tooltip-trigger');
    await user.tab();
    expect(explanation().textContent).toBe('Ocean palette');
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
    expect(explanation().textContent).toBe('Copy team');
    fireEvent.pointerMove(screen.getByRole('button', { name: 'Move up' }));
    await act(async () => vi.advanceTimersByTime(400));
    expect(screen.getAllByRole('tooltip', { hidden: true })).toHaveLength(1);
    expect(explanation().textContent).toBe('Move up');
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
    expect(explanation().textContent).toBe('Match actions');
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
    const tooltip = explanation();
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
    expect(explanation()).toBeTruthy();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('delays hover, allows moving into the bubble and cancels abandoned hovers', async () => {
    vi.useFakeTimers();
    render(<Button title="Update details">Update</Button>);
    const button = screen.getByRole('button');
    fireEvent.pointerMove(button, { pointerType: 'mouse' });
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    fireEvent.pointerLeave(button);
    await act(async () => vi.advanceTimersByTime(500));
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    fireEvent.pointerMove(button, { pointerType: 'mouse' });
    await act(async () => vi.advanceTimersByTime(400));
    const tooltip = explanation();
    fireEvent.pointerLeave(button);
    fireEvent.pointerMove(tooltip, { pointerType: 'mouse' });
    await act(async () => vi.advanceTimersByTime(200));
    expect(explanation()).toBe(tooltip);
    fireEvent.pointerLeave(tooltip);
    fireEvent.pointerMove(document.body, { pointerType: 'mouse', clientX: 1000, clientY: 1000 });
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
    fireEvent.pointerMove(button, { pointerType: 'mouse' });
    await act(async () => vi.advanceTimersByTime(400));
    expect(explanation().textContent).toBe('Wait for the match to end');
    fireEvent.scroll(document);
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    fireEvent.pointerMove(button, { pointerType: 'mouse' });
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
    expect(explanation()).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    expect(close).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(close).toHaveBeenCalledTimes(1);
  });
});

function explanation() {
  return (
    document.querySelector<HTMLElement>('[data-slot="popover-content"]') ??
    screen.getByRole('tooltip', { hidden: true })
  );
}
