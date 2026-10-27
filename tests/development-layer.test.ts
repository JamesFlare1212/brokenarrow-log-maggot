import { describe, expect, it } from 'vitest';
import { clampToolPosition } from '../apps/web/src/dev/layer';

describe('floating development tool bounds', () => {
  it('retains a freely selected position within the viewport', () => {
    expect(clampToolPosition({ x: 120, y: 220 }, 200, 40, 1440, 900)).toEqual({ x: 120, y: 220 });
  });
  it('keeps the handle reachable after dragging beyond any edge', () => {
    expect(clampToolPosition({ x: -40, y: -80 }, 200, 40, 1440, 900)).toEqual({ x: 8, y: 8 });
    expect(clampToolPosition({ x: 2000, y: 2000 }, 200, 40, 1440, 900)).toEqual({
      x: 1232,
      y: 852,
    });
  });
  it('repositions the dock after the viewport becomes smaller', () => {
    expect(clampToolPosition({ x: 1200, y: 800 }, 200, 40, 375, 600)).toEqual({ x: 167, y: 552 });
    expect(clampToolPosition({ x: 100, y: 100 }, 400, 40, 300, 200)).toEqual({ x: 8, y: 100 });
  });
});
