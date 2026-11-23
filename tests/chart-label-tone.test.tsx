import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChartContainer } from '../apps/web/src/components/ui/chart';

describe('chart label tone', () => {
  it('supports an opt-in foreground tone for analytical axes', () => {
    const markup = renderToStaticMarkup(
      <ChartContainer config={{}} labelTone="strong">
        <svg />
      </ChartContainer>,
    );
    expect(markup).toContain('data-label-tone="strong"');
    expect(markup).toContain('fill-foreground');
    expect(markup).not.toContain('fill-muted-foreground');
  });

  it('preserves the existing muted tone by default', () => {
    const markup = renderToStaticMarkup(
      <ChartContainer config={{}}>
        <svg />
      </ChartContainer>,
    );
    expect(markup).toContain('data-label-tone="muted"');
    expect(markup).toContain('fill-muted-foreground');
    expect(markup).not.toContain('fill-foreground');
  });
});
