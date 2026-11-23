// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ToggleGroup, ToggleGroupItem } from '../apps/web/src/components/ui/toggle-group';
import { toggleVariants } from '../apps/web/src/components/ui/toggle';

afterEach(cleanup);

describe('shared filter toggle variant', () => {
  it('keeps a checked accent and border distinct from the lighter hover state', async () => {
    const user = userEvent.setup();
    render(
      <ToggleGroup type="single" variant="filter" defaultValue="all">
        <ToggleGroupItem value="all">All</ToggleGroupItem>
        <ToggleGroupItem value="loss">Loss</ToggleGroupItem>
      </ToggleGroup>,
    );
    const all = screen.getByRole('radio', { name: 'All' });
    const loss = screen.getByRole('radio', { name: 'Loss' });
    expect(all.getAttribute('aria-checked')).toBe('true');
    expect(all.className).toContain('data-[state=on]:bg-accent');
    expect(all.className).toContain('data-[state=on]:border-ring');
    expect(loss.className).toContain('hover:bg-muted/40');
    await user.hover(loss);
    expect(all.getAttribute('aria-checked')).toBe('true');
    expect(loss.getAttribute('aria-checked')).toBe('false');
    await user.click(loss);
    expect(loss.getAttribute('aria-checked')).toBe('true');
    expect(all.getAttribute('aria-checked')).toBe('false');
  });

  it('leaves existing outline controls unchanged', () => {
    const existing = toggleVariants({ variant: 'outline' });
    expect(existing).toContain('border-input');
    expect(existing).toContain('hover:bg-muted');
    expect(existing).not.toContain('hover:bg-muted/40');
    expect(existing).not.toContain('data-[state=on]:bg-accent');
  });
});
