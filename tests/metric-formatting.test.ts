import { describe, expect, it } from 'vitest';
import { formatPercent } from '@ba/shared';

describe('percentage availability', () => {
  it.each([
    { value: null, digits: 0, expected: '—' },
    { value: 0, digits: 0, expected: '0%' },
    { value: 100, digits: 0, expected: '100%' },
    { value: 25.5, digits: 0, expected: '26%' },
    { value: 25.5, digits: 1, expected: '25.5%' },
    { value: Number.NaN, digits: 0, expected: '—' },
    { value: Number.POSITIVE_INFINITY, digits: 0, expected: '—' },
  ])('formats $value with $digits digits as $expected', ({ value, digits, expected }) => {
    expect(formatPercent(value, digits)).toBe(expected);
  });
});
