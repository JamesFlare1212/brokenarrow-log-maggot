// @vitest-environment jsdom
import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameDialog } from '../apps/web/src/features/game/GameDialog';
import { GameEngine } from '../apps/web/src/features/game/engine';
import type { Artillery, Missile, Plane } from '../apps/web/src/features/game/engine';
import { LocaleContext } from '../apps/web/src/hooks/useI18n';

function plane(x: number, kind: Plane['kind'] = 'normal'): Plane {
  return { kind, hp: 1, x, y: 100, vx: 0, seadCooldown: 3.6, gone: false };
}

function missile(target: Plane): Missile {
  return {
    x: target.x,
    y: target.y,
    vx: 0,
    vy: -360,
    speed: 360,
    target: null,
    lost: false,
    fade: 0,
    gone: false,
  };
}

function shell(x: number): Artillery {
  return { x, warning: 0, impact: false, done: false, hit: false };
}

function engine() {
  return new GameEngine({ width: 960, height: 480, random: () => 0.5 });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('air-defense simulation', () => {
  it('moving turns off radar, prevents startup en route and allows delayed startup after arrival', () => {
    const game = engine();
    game.moveTo(game.state.x + 100);
    expect(game.state.radarOn).toBe(false);
    game.toggleRadar();
    expect(game.state.spinup).toBe(0);
    for (let i = 0; i < 9; i++) game.step(0.05);
    expect(game.state.moving).toBe(false);
    expect(game.state.radarOn).toBe(false);
    game.toggleRadar();
    expect(game.getHud().radar).toBe('spinup');
    for (let i = 0; i < 10; i++) game.step(0.05);
    expect(game.getHud().radar).toBe('on');
    game.moveTo(-1000);
    expect(game.state.targetX).toBe(24);
  });

  it('radar shutdown breaks SEAD lock and the hostile missile expires without relocking', () => {
    const game = engine();
    game.state.seadMissiles.push({
      x: game.state.x,
      y: 100,
      vx: 0,
      vy: 240,
      speed: 240,
      locked: true,
      fade: 0,
      gone: false,
    });
    game.toggleRadar();
    game.step(0.05);
    expect(game.state.seadMissiles[0]?.locked).toBe(false);
    game.toggleRadar();
    for (let i = 0; i < 30; i++) game.step(0.05);
    expect(game.state.radarOn).toBe(true);
    expect(game.state.seadMissiles).toHaveLength(0);
    expect(game.state.phase).toBe('playing');
  });

  it('spawns all enemy kinds, fires SEAD attacks and applies jammer slowdown', () => {
    const game = engine();
    game.state.normalTimer = 0;
    game.state.seadTimer = 0;
    game.state.jamTimer = 0;
    game.state.b2Timer = 0;
    game.step(0.01);
    expect(new Set(game.state.planes.map((item) => item.kind))).toEqual(
      new Set(['normal', 'sead', 'jam', 'b2']),
    );
    const sead = plane(game.state.x, 'sead');
    sead.seadCooldown = 0;
    game.state.planes = [sead, plane(game.state.x + 40, 'jam')];
    game.state.fireTimer = 0;
    game.step(0.01);
    expect(game.state.seadMissiles[0]?.locked).toBe(true);
    expect(game.state.fireTimer).toBeCloseTo(1.6 * 1.35);
    expect(game.getHud().jammed).toBe(true);
  });

  it('rewards B2 kills and pauses combat at the cumulative kill upgrade threshold', () => {
    const b2Game = engine();
    const b2 = plane(b2Game.state.x, 'b2');
    b2Game.state.fireTimer = 999;
    b2Game.state.planes = [b2];
    b2Game.state.missiles = [missile(b2)];
    b2Game.step(0.01);
    expect(b2Game.getHud().score).toBe(80);
    expect(b2Game.state.kills.b2).toBe(1);

    const game = engine();
    game.state.fireTimer = 999;
    game.state.planes = Array.from({ length: 8 }, (_, i) => plane(100 + i * 40));
    game.state.missiles = game.state.planes.map(missile);
    game.step(0.01);
    expect(game.state.kills.total).toBe(8);
    expect(game.state.phase).toBe('upgrade');
    expect(game.state.upgradeOptions).toHaveLength(3);
    expect(new Set(game.state.upgradeOptions).size).toBe(3);
    const time = game.state.time;
    game.state.artillery = [shell(game.state.x)];
    game.step(0.05);
    expect(game.state.time).toBe(time);
    expect(game.state.phase).toBe('upgrade');
    const choice = game.state.upgradeOptions[0];
    if (!choice) throw new Error('An upgrade must be offered after eight kills');
    game.chooseUpgrade(choice);
    expect(game.state.phase).toBe('playing');
    expect(game.state.nextUpgradeAt).toBe(16);
    expect(game.state.upgradeOptions).toHaveLength(0);
  });

  it('CIWS absorbs one artillery impact; the next hit settles the game once and freezes simulation', () => {
    const onGameOver = vi.fn();
    const game = new GameEngine({ width: 960, height: 480, random: () => 0.5, onGameOver });
    game.state.ciws = 1;
    game.state.artillery = [shell(game.state.x)];
    game.step(0.05);
    expect(game.state.ciws).toBe(0);
    expect(game.state.phase).toBe('playing');
    game.state.artillery.push(shell(game.state.x));
    game.step(0.05);
    expect(game.state.phase).toBe('over');
    expect(onGameOver).toHaveBeenCalledTimes(1);
    const time = game.state.time;
    game.step(0.05);
    expect(game.state.time).toBe(time);
    expect(onGameOver).toHaveBeenCalledTimes(1);
  });

  it('emits immutable HUD snapshots at most ten times a second, with immediate control feedback', () => {
    const onHud = vi.fn();
    const game = new GameEngine({ width: 960, height: 480, random: () => 0.5, onHud });
    for (let i = 0; i < 60; i++) game.step(1 / 60);
    expect(onHud.mock.calls.length).toBeLessThanOrEqual(11);
    const previousCalls = onHud.mock.calls.length;
    game.toggleRadar();
    expect(onHud.mock.calls.length).toBe(previousCalls + 1);
    expect(game.getHud().radar).toBe('off');
    const snapshot = game.getHud();
    game.state.kills.total++;
    expect(snapshot.kills.total).toBe(0);
  });
});

describe('React game lifecycle', () => {
  let frames: Map<number, FrameRequestCallback>;
  let now: number;
  beforeEach(() => {
    frames = new Map();
    now = performance.now();
    let id = 0;
    const stored = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return stored.size;
      },
      clear: () => stored.clear(),
      getItem: (key) => stored.get(key) ?? null,
      key: (index) => [...stored.keys()][index] ?? null,
      removeItem: (key) => {
        stored.delete(key);
      },
      setItem: (key, value) => {
        stored.set(key, value);
      },
    };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => {
      frames.delete(frameId);
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    localStorage.clear();
  });

  function advanceFrame() {
    now = Math.max(now, performance.now()) + 16;
    const pending = [...frames.values()];
    frames.clear();
    act(() => {
      for (const callback of pending) callback(now);
    });
  }

  function ControlledGame() {
    const [open, setOpen] = useState(true);
    return <GameDialog open={open} onClose={() => setOpen(false)} />;
  }

  it('has one animation loop in StrictMode and releases it and its keyboard listener on close', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const step = vi.spyOn(GameEngine.prototype, 'step');
    const view = render(
      <StrictMode>
        <ControlledGame />
      </StrictMode>,
    );
    advanceFrame();
    expect(step).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(frames.size).toBe(0);
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
    const calls = step.mock.calls.length;
    fireEvent.keyDown(window, { key: 'z' });
    advanceFrame();
    expect(step).toHaveBeenCalledTimes(calls);
    view.unmount();
  });

  it('keeps the finished dialog open, persists the best score, restarts and still closes with Escape', () => {
    localStorage.setItem('ba_game_best', '120');
    const realStep = GameEngine.prototype.step;
    const forcedImpact = vi.spyOn(GameEngine.prototype, 'step').mockImplementation(function (
      this: GameEngine,
      dt,
    ) {
      this.state.score = 450;
      this.state.artillery = [shell(this.state.x)];
      realStep.call(this, dt);
    });
    render(<ControlledGame />);
    advanceFrame();
    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(screen.getByText('防空阵地被摧毁')).toBeTruthy();
    expect(localStorage.getItem('ba_game_best')).toBe('450');
    expect(frames.size).toBe(0);
    forcedImpact.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: '再来一局' }));
    expect(screen.queryByText('防空阵地被摧毁')).toBeNull();
    expect(frames.size).toBe(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(frames.size).toBe(0);
    expect(localStorage.getItem('ba_game_best')).toBe('450');
  });

  it('changes language without resetting the round or radar state', () => {
    const onClose = vi.fn();
    const view = render(
      <LocaleContext.Provider value="zh">
        <GameDialog open onClose={onClose} />
      </LocaleContext.Provider>,
    );
    fireEvent.keyDown(window, { key: 'z' });
    expect(screen.getByText('已关闭')).toBeTruthy();
    view.rerender(
      <LocaleContext.Provider value="en">
        <GameDialog open onClose={onClose} />
      </LocaleContext.Provider>,
    );
    expect(screen.getByText('Off')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Toggle radar (Z)' }).getAttribute('aria-pressed'),
    ).toBe('false');
  });
});
