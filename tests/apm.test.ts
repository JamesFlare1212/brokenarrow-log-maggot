import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialApmState, type ApmState } from '@ba/contracts';
import { emptyMatch } from '@ba/shared';
import { ApmController } from '../apps/desktop/src/apm';
import {
  WindowsInputCollector,
  parseInputFrame,
  type InputCollector,
  type InputFrame,
} from '../apps/desktop/src/apm/windows-input';
import source from '../apps/desktop/src/apm/windows-input.cs?raw';
import { Database } from '../apps/server/src/storage/database';

class FakeCollector implements InputCollector {
  frame!: (value: InputFrame) => void;
  failure!: (error: Error) => void;
  final: InputFrame | null = null;
  start(frame: (value: InputFrame) => void, failure: (error: Error) => void) {
    this.frame = frame;
    this.failure = failure;
  }
  stop = vi.fn(async () => {
    if (this.final) this.frame(this.final);
  });
}
const match = () => ({ ...emptyMatch('local:session', 1), sessionId: 'session', map: 'Dam' });
const controllers: ApmController[] = [];
afterEach(async () => {
  await Promise.all(controllers.splice(0).map((value) => value.disable()));
});
async function capture(partial = false) {
  let now = 0,
    wallOffset = 0;
  const collector = new FakeCollector();
  const controller = new ApmController(
    () => collector,
    () => now,
    () => 1000000 + now + wallOffset,
  );
  controllers.push(controller);
  await controller.start(match(), partial);
  const push = (
    elapsedMs: number,
    seconds: Array<[number, number]> = [],
    focusedMs = 0,
    focused = false,
  ) => {
    now = elapsedMs;
    collector.frame({
      type: elapsedMs === 0 ? 'ready' : 'sample',
      elapsedMs,
      seconds,
      focusedMs,
      focused,
    });
  };
  push(0);
  return {
    controller,
    collector,
    push,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    shiftWall: (milliseconds: number) => {
      wallOffset += milliseconds;
    },
  };
}

describe('APM statistics', () => {
  it('uses exact elapsed seconds across minute boundaries', async () => {
    const { controller, push } = await capture();
    for (const [seconds, expected] of [
      [30, 120],
      [60, 60],
      [61, 59],
      [90, 40],
    ]) {
      push(seconds! * 1000, [[0, 60]]);
      expect(controller.status().apm).toBe(expected);
    }
  });
  it('waits for ten complete seconds and converts rolling counts to APM across bucket boundaries', async () => {
    const { controller, push } = await capture();
    push(9000, [[9, 20]]);
    expect(controller.status()).toMatchObject({ currentApm: null, peak: 0 });
    push(10000, [[10, 30]]);
    expect(controller.status()).toMatchObject({ currentApm: 120, peak: 120 });
    push(11000);
    expect(controller.status()).toMatchObject({ currentApm: 300, peak: 300 });
    push(20000);
    expect(controller.status()).toMatchObject({ currentApm: 180, peak: 300, perMinute: [50] });
    push(21000);
    expect(controller.status()).toMatchObject({ currentApm: 0, peak: 300 });
  });
  it('replaces cumulative second counts without counting a batch twice', async () => {
    const { controller, push } = await capture();
    push(1250, [[1, 3]]);
    push(1500, [[1, 5]]);
    push(1750, [[1, 5]]);
    expect(controller.status()).toMatchObject({ totalActions: 5, perMinute: [5] });
    expect(controller.status().perSecond).toEqual([0, 5]);
  });
  it('keeps foreground time separate and ignores wall-clock adjustments', async () => {
    const { controller, push, advance, shiftWall } = await capture();
    push(120000, [[30, 60]], 30000);
    shiftWall(-3600000);
    advance(1000);
    expect(controller.status()).toMatchObject({
      durationSec: 121,
      focusedDurationSec: 30,
      apm: 29.8,
    });
    push(121000, [], 30000, true);
    advance(1000);
    expect(controller.status().focusedDurationSec).toBe(31);
  });
  it('consumes the final native aggregate before completing and clears focus', async () => {
    const { controller, collector } = await capture();
    collector.final = {
      type: 'stopped',
      elapsedMs: 2000,
      focusedMs: 2000,
      focused: true,
      seconds: [[1, 3]],
    };
    await controller.stop();
    expect(controller.status()).toMatchObject({
      status: 'complete',
      totalActions: 3,
      durationSec: 2,
      focused: false,
      focusedDurationSec: 2,
      apm: 90,
      partial: false,
    });
    const value = controller.status();
    value.perMinute.push(999);
    value.perSecond!.push(999);
    expect(controller.status().perMinute).toEqual([3]);
    expect(controller.status().perSecond).toEqual([0, 3]);
  });
  it('binds late FIDs to the stable session and identifies partial captures', async () => {
    const { controller } = await capture(true);
    controller.updateMatch({ ...match(), sessionId: 'other', fid: '999' });
    expect(controller.status().fid).toBeNull();
    controller.updateMatch({ ...match(), fid: '123', durationSec: 300 });
    await controller.stop();
    expect(controller.status()).toMatchObject({
      sessionId: 'session',
      fid: '123',
      matchDurationSec: 300,
      partial: true,
    });
  });
  it('preserves the last batch and marks an unexpected collector failure', async () => {
    const { controller, collector, push } = await capture();
    push(30000, [[0, 20]]);
    collector.failure(new Error('Collector lost'));
    expect(controller.status()).toMatchObject({
      status: 'unavailable',
      totalActions: 20,
      durationSec: 30,
      partial: true,
      interrupted: true,
      focused: false,
      error: 'Collector lost',
    });
  });
  it('isolates stale callbacks when switching to a new capture', async () => {
    const first = new FakeCollector(),
      second = new FakeCollector();
    let next = first;
    const controller = new ApmController(
      () => next,
      () => 0,
      () => 1000000,
    );
    controllers.push(controller);
    await controller.start(match());
    const firstId = controller.status().captureId;
    next = second;
    await controller.start({ ...match(), sessionId: 'next' });
    first.frame({
      type: 'sample',
      elapsedMs: 10000,
      focusedMs: 0,
      focused: false,
      seconds: [[0, 99]],
    });
    first.failure(new Error('Stale exit'));
    expect(controller.status()).toMatchObject({
      status: 'active',
      totalActions: 0,
      sessionId: 'next',
    });
    expect(controller.status().captureId).not.toBe(firstId);
  });
  it('reports initialization failures and interrupted shutdowns', async () => {
    const controller = new ApmController(() => {
      throw new Error('Unavailable');
    });
    controllers.push(controller);
    await controller.start(match());
    expect(controller.status()).toMatchObject({ status: 'unavailable', interrupted: true });
    const active = await capture();
    await active.controller.stop(true);
    expect(active.controller.status()).toMatchObject({ partial: true, interrupted: true });
  });
});

function saved(overrides: Partial<ApmState> = {}): ApmState {
  return {
    ...initialApmState('active'),
    captureId: 'capture',
    sessionId: 'session',
    startedAt: 1000000,
    durationSec: 90,
    apm: 40,
    totalActions: 60,
    perMinute: [60, 0],
    ...overrides,
  };
}
describe('APM persistence', () => {
  it('persists second counts through checkpoints, recovery and metadata updates without upgrading legacy data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ba-apm-seconds-'));
    const file = join(directory, 'test.sqlite');
    let db = new Database(file);
    try {
      const { controller, push } = await capture();
      push(10500, [
        [0, 2],
        [9, 3],
        [10, 4],
      ]);
      const snapshot = controller.status();
      db.saveApm(snapshot);
      db.saveApm(saved({ captureId: 'legacy', perSecond: undefined, status: 'complete' }));
      db.close();
      db = new Database(file);
      db.recoverApmCaptures();
      db.updateApmMatch({ ...match(), fid: '123' });
      const history = db.apmHistory();
      expect(history.find((value) => value.captureId === snapshot.captureId)).toMatchObject({
        perSecond: [2, 0, 0, 0, 0, 0, 0, 0, 0, 3, 4],
        totalActions: 9,
        durationSec: 10.5,
        peak: 30,
        currentApm: null,
        fid: '123',
        interrupted: true,
      });
      expect(history.find((value) => value.captureId === 'legacy')?.perSecond).toBeUndefined();
    } finally {
      db.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('keeps captures across database restarts and marks unfinished checkpoints as partial', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ba-apm-'));
    let db = new Database(join(directory, 'test.sqlite'));
    try {
      db.saveApm(saved());
      db.close();
      db = new Database(join(directory, 'test.sqlite'));
      db.recoverApmCaptures();
      expect(db.apmHistory()).toEqual([
        expect.objectContaining({
          status: 'complete',
          durationSec: 90,
          totalActions: 60,
          partial: true,
          interrupted: true,
          endedAt: 1090000,
          currentApm: null,
          focused: false,
        }),
      ]);
    } finally {
      db.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('preserves separate segments and updates their metadata without inventing missing input', () => {
    const db = new Database(':memory:');
    try {
      db.saveApm(saved({ status: 'complete' }));
      db.saveApm(
        saved({ captureId: 'segment', startedAt: 1100000, partial: true, totalActions: 10 }),
      );
      db.updateApmMatch({ ...match(), fid: '123', map: 'New map', durationSec: 900 });
      expect(db.apmHistory()).toEqual([
        expect.objectContaining({
          captureId: 'segment',
          partial: true,
          totalActions: 10,
          fid: '123',
          matchDurationSec: 900,
        }),
        expect.objectContaining({
          captureId: 'capture',
          totalActions: 60,
          fid: '123',
          map: 'New map',
        }),
      ]);
      db.saveApm(saved({ status: 'disabled', totalActions: 0 }));
      expect(db.apmHistory()[1]?.totalActions).toBe(60);
    } finally {
      db.close();
    }
  });
  it('removes associated captures when the match is deleted', () => {
    const db = new Database(':memory:');
    try {
      db.saveMatch(match());
      db.saveApm(saved({ status: 'complete' }));
      expect(db.deleteMatch('local:session')).toBe(true);
      db.saveApm(saved());
      expect(db.apmHistory()).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe('input collector protocol', () => {
  const frame: InputFrame = {
    type: 'sample',
    elapsedMs: 1000,
    focusedMs: 500,
    focused: false,
    seconds: [[0, 4]],
  };
  it('accepts only aggregate counts and timing', () => {
    expect(parseInputFrame(JSON.stringify(frame))).toEqual(frame);
  });
  it.each([
    null,
    { ...frame, type: 'keydown' },
    { ...frame, elapsedMs: -1 },
    { ...frame, focusedMs: 1001 },
    { ...frame, focused: 'true' },
    { ...frame, seconds: [[2, 1]] },
    { ...frame, seconds: [[0, -1]] },
    { ...frame, seconds: [[0, 1.5]] },
  ])('rejects malformed native data: %j', (value) => {
    expect(() => parseInputFrame(JSON.stringify(value))).toThrow();
  });
});

describe.skipIf(process.platform !== 'win32')('Windows input collector', () => {
  it('compiles the native policy and verifies holds, releases, devices and mouse transitions', async () => {
    const script = `$ErrorActionPreference='Stop'; Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::ReadLine())));
      $policy = New-Object BAInputPolicy;
      for ($cycle=0; $cycle -lt 3; $cycle++) {
        if (-not $policy.Key([IntPtr]1,30,0,65)) { throw 'First press missing' };
        if ($policy.Key([IntPtr]1,30,0,65)) { throw 'Repeat counted' };
        if ($policy.Key([IntPtr]1,30,1,65)) { throw 'Release counted' };
      };
      if (-not $policy.Key([IntPtr]1,30,0,65)) { throw 'Fresh press missing' };
      if (-not $policy.Key([IntPtr]2,30,0,65)) { throw 'Second device missing' };
      $policy.RemoveDevice([IntPtr]1);
      if (-not $policy.Key([IntPtr]1,30,0,65)) { throw 'Removed device remained pressed' };
      if ($policy.Key([IntPtr]2,30,0,65)) { throw 'Other device lost state' };
      if ([BAInputPolicy]::Mouse(0x0155) -ne 5) { throw 'Mouse presses missing' };
      if ([BAInputPolicy]::Mouse(0x0eaa) -ne 0) { throw 'Release, motion or wheel counted' };
      Write-Output 'POLICY_OK'`;
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true },
    );
    let output = '',
      errors = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      errors += data;
    });
    child.stdin.end(Buffer.from(source).toString('base64') + '\n');
    const code = await new Promise((resolve, reject) => {
      child.once('close', resolve);
      child.once('error', reject);
    });
    expect(errors).toBe('');
    expect(code).toBe(0);
    expect(output).toContain('POLICY_OK');
  }, 15000);
  it('registers Raw Input and the foreground hook, then flushes before stopping', async () => {
    const collector = new WindowsInputCollector();
    let resolveReady!: () => void, rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const frames: InputFrame[] = [],
      errors: Error[] = [];
    collector.start(
      (value) => {
        frames.push(value);
        if (value.type === 'ready') resolveReady();
      },
      (error) => {
        errors.push(error);
        rejectReady(error);
      },
    );
    try {
      await ready;
    } finally {
      await collector.stop();
    }
    expect(errors).toEqual([]);
    expect(frames[0]?.type).toBe('ready');
    expect(frames.at(-1)?.type).toBe('stopped');
    expect(frames.at(-1)?.elapsedMs).toBeGreaterThanOrEqual(frames[0]!.elapsedMs);
  }, 20000);
  it('handles split messages and reports process failures without leaving callbacks active', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    });
    const collector = new WindowsInputCollector((() => child) as unknown as typeof spawn);
    const frame = vi.fn(),
      failure = vi.fn();
    collector.start(frame, failure);
    const line = JSON.stringify({
      type: 'ready',
      elapsedMs: 0,
      focusedMs: 0,
      focused: false,
      seconds: [],
    });
    child.stdout.write(line.slice(0, 20));
    expect(frame).not.toHaveBeenCalled();
    child.stdout.write(line.slice(20) + '\n');
    expect(frame).toHaveBeenCalledTimes(1);
    child.stderr.write('Native failure');
    child.emit('close', 1);
    expect(failure).toHaveBeenCalledOnce();
    expect(failure.mock.calls[0]?.[0].message).toBe('Native failure');
    expect(child.kill).toHaveBeenCalledOnce();
    await collector.stop();
  });
  it.each(['startup', 'heartbeat', 'unexpected-stop'])(
    'reports %s failures and terminates the helper',
    async (mode) => {
      vi.useFakeTimers();
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => true),
      });
      const collector = new WindowsInputCollector((() => child) as unknown as typeof spawn);
      const failure = vi.fn();
      try {
        collector.start(vi.fn(), failure);
        const send = (type: InputFrame['type']) =>
          child.stdout.write(
            JSON.stringify({
              type,
              elapsedMs: 0,
              focusedMs: 0,
              focused: false,
              seconds: [],
            }) + '\n',
          );
        if (mode !== 'startup') send('ready');
        if (mode === 'unexpected-stop') send('stopped');
        else await vi.advanceTimersByTimeAsync(mode === 'startup' ? 15000 : 6000);
        expect(failure).toHaveBeenCalledOnce();
        expect(child.kill).toHaveBeenCalledOnce();
        child.emit('close', 1);
        await collector.stop();
      } finally {
        child.emit('close', 1);
        vi.useRealTimers();
      }
    },
  );
});
