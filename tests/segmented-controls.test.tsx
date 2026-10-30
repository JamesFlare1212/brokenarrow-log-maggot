// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToggleGroup, ToggleGroupItem } from '../apps/web/src/components/ui/toggle-group';

afterEach(cleanup);

describe('single-selection keyboard behavior', () => {
  it.each([false, true])(
    'selects across a shadow boundary with held=%s arrow input',
    async (held) => {
      const host = document.createElement('div');
      document.body.append(host);
      const shadow = host.attachShadow({ mode: 'open' });
      const container = document.createElement('div');
      shadow.append(container);
      const change = vi.fn();
      const rendered = render(
        <ToggleGroup type="single" defaultValue="one" onValueChange={change}>
          {options()}
        </ToggleGroup>,
        { container },
      );
      try {
        const radios = within(container);
        const first = radios.getByRole('radio', { name: 'one' });
        first.focus();
        fireEvent.keyDown(first, { key: 'ArrowRight', code: 'ArrowRight' });
        if (!held) fireEvent.keyUp(first, { key: 'ArrowRight', code: 'ArrowRight' });
        await waitFor(() =>
          expect(radios.getByRole('radio', { checked: true }).textContent).toBe('two'),
        );
        expect(shadow.activeElement).toBe(radios.getByRole('radio', { name: 'two' }));
        if (held) fireEvent.keyUp(shadow.activeElement!, { key: 'ArrowRight', code: 'ArrowRight' });
        expect(change.mock.calls).toEqual([['two']]);
      } finally {
        rendered.unmount();
        host.remove();
      }
    },
  );
  async function arrow(user: ReturnType<typeof userEvent.setup>, key: string, value: string) {
    await user.keyboard(key);
    await waitFor(() =>
      expect(screen.getByRole('radio', { checked: true }).textContent).toBe(value),
    );
  }
  function options() {
    return ['one', 'two', 'three'].map((value) => (
      <ToggleGroupItem key={value} value={value}>
        {value}
      </ToggleGroupItem>
    ));
  }
  it.each(['{ArrowRight}', '{ArrowDown}', '{ArrowLeft}', '{ArrowUp}'])(
    'selects the focused radio and wraps with %s',
    async (key) => {
      const change = vi.fn();
      render(
        <ToggleGroup type="single" defaultValue="one" onValueChange={change} aria-label="Options">
          {options()}
        </ToggleGroup>,
      );
      const user = userEvent.setup();
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'one' }));
      const backwards = key === '{ArrowLeft}' || key === '{ArrowUp}';
      for (const value of backwards ? ['three', 'two', 'one'] : ['two', 'three', 'one']) {
        await arrow(user, key, value);
        await waitFor(() => {
          expect(document.activeElement).toBe(screen.getByRole('radio', { name: value }));
          expect(screen.getByRole('radio', { checked: true }).textContent).toBe(value);
        });
      }
      expect(change.mock.calls.map(([value]) => value)).toEqual(
        backwards ? ['three', 'two', 'one'] : ['two', 'three', 'one'],
      );
      await user.keyboard(' ');
      expect(change).toHaveBeenCalledTimes(3);
      expect(screen.getByRole('radio', { checked: true }).dataset.state).toBe('checked');
    },
  );
  it('keeps selection when revisiting it by pointer or ordinary focus', async () => {
    render(
      <ToggleGroup type="single" defaultValue="one">
        {options()}
      </ToggleGroup>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'one' }));
    await user.click(screen.getByRole('radio', { name: 'one' }));
    screen.getByRole('radio', { name: 'two' }).focus();
    expect(screen.getByRole('radio', { checked: true }).textContent).toBe('one');
    await user.keyboard(' ');
    expect(screen.getByRole('radio', { checked: true }).textContent).toBe('two');
  });
  it('selects only once when the arrow remains held through deferred focus', async () => {
    const change = vi.fn();
    render(
      <ToggleGroup type="single" defaultValue="one" onValueChange={change}>
        {options()}
      </ToggleGroup>,
    );
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard('{ArrowRight>}');
    await waitFor(() =>
      expect(screen.getByRole('radio', { checked: true }).textContent).toBe('two'),
    );
    await user.keyboard('{/ArrowRight}');
    expect(change.mock.calls).toEqual([['two']]);
  });
  it('respects consumer-handled arrow events', async () => {
    const change = vi.fn();
    render(
      <ToggleGroup
        type="single"
        defaultValue="one"
        onValueChange={change}
        onKeyDownCapture={(event) => event.preventDefault()}
      >
        {options()}
      </ToggleGroup>,
    );
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard('{ArrowRight}{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'one' }));
    expect(screen.getByRole('radio', { checked: true }).textContent).toBe('one');
    expect(change).not.toHaveBeenCalled();
  });
  it('honors controlled values, disabled options and Tab entry on the selection', async () => {
    function Controlled() {
      const [value, setValue] = useState('three');
      return (
        <>
          <button>Before</button>
          <ToggleGroup type="single" value={value} onValueChange={setValue}>
            <ToggleGroupItem value="one">one</ToggleGroupItem>
            <ToggleGroupItem value="two" disabled>
              two
            </ToggleGroupItem>
            <ToggleGroupItem value="three">three</ToggleGroupItem>
          </ToggleGroup>
          <button>After</button>
        </>
      );
    }
    render(<Controlled />);
    const user = userEvent.setup();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'three' }));
    await arrow(user, '{ArrowRight}', 'one');
    await waitFor(() =>
      expect(screen.getByRole('radio', { checked: true }).textContent).toBe('one'),
    );
    await arrow(user, '{ArrowRight}', 'three');
    await waitFor(() =>
      expect(screen.getByRole('radio', { checked: true }).textContent).toBe('three'),
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After' }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'three' }));
  });
  it.each(['vertical', 'rtl'] as const)(
    'supports %s navigation and disabled wrapping',
    async (mode) => {
      render(
        <ToggleGroup
          type="single"
          defaultValue="one"
          loop={false}
          orientation={mode === 'vertical' ? 'vertical' : undefined}
          dir={mode === 'rtl' ? 'rtl' : undefined}
        >
          {options()}
        </ToggleGroup>,
      );
      const user = userEvent.setup();
      await user.tab();
      await arrow(user, mode === 'vertical' ? '{ArrowDown}' : '{ArrowLeft}', 'two');
      await waitFor(() =>
        expect(screen.getByRole('radio', { checked: true }).textContent).toBe('two'),
      );
      await arrow(user, mode === 'vertical' ? '{ArrowDown}' : '{ArrowLeft}', 'three');
      await user.keyboard(mode === 'vertical' ? '{ArrowDown}' : '{ArrowLeft}');
      await waitFor(() =>
        expect(screen.getByRole('radio', { checked: true }).textContent).toBe('three'),
      );
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'three' }));
      if (mode === 'vertical')
        expect(screen.getByRole('radiogroup').getAttribute('aria-orientation')).toBe('vertical');
    },
  );
  it('does not select disabled groups or submit a form with Enter', async () => {
    const submit = vi.fn((event) => event.preventDefault());
    const change = vi.fn();
    render(
      <form onSubmit={submit}>
        <ToggleGroup type="single" defaultValue="one" onValueChange={change}>
          {options()}
        </ToggleGroup>
        <ToggleGroup type="single" disabled onValueChange={change}>
          <ToggleGroupItem value="disabled">Disabled</ToggleGroupItem>
        </ToggleGroup>
        <button type="submit">Submit</button>
      </form>,
    );
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(submit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('radio', { name: 'Disabled' }));
    expect(change).not.toHaveBeenCalled();
  });
  it('preserves independent multi-selection on palette controls', async () => {
    render(
      <ToggleGroup type="multiple" defaultValue={['one']}>
        {options()}
      </ToggleGroup>,
    );
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard('{ArrowRight}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'two' })),
    );
    expect(screen.getByRole('button', { name: 'one' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'two' }).getAttribute('aria-pressed')).toBe('false');
    await user.keyboard(' ');
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(2);
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});
