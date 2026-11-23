// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Table, TableBody, TableCell, TableRow } from '../apps/web/src/components/ui/table';

afterEach(cleanup);

describe('current table-row emphasis', () => {
  it('provides an accent surface and stable leading marker for the current row', () => {
    render(
      <Table>
        <TableBody>
          <TableRow emphasis="current" data-state="selected" aria-current="time">
            <TableCell>20:00</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const row = screen.getByRole('row');
    expect(row.getAttribute('aria-current')).toBe('time');
    expect(row.className).toContain('data-[state=selected]:bg-accent');
    expect(row.className).toContain('[&>td:first-child]:border-l-2');
    expect(row.className).toContain('data-[state=selected]:[&>td:first-child]:border-l-ring');
  });

  it('preserves the default row selection treatment', () => {
    render(
      <Table>
        <TableBody>
          <TableRow data-state="selected">
            <TableCell>Default</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const row = screen.getByRole('row');
    expect(row.className).toContain('data-[state=selected]:bg-muted/50');
    expect(row.className).not.toContain('data-[state=selected]:bg-accent');
    expect(row.className).not.toContain('[&>td:first-child]:border-l-2');
  });
});
