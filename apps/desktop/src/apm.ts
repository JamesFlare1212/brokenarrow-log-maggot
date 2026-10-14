import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { ApmState, Match } from '@ba/contracts';
interface HookEvent {
  button?: number;
  keycode?: number;
}
export interface Hook {
  on(event: string, callback: (event: HookEvent) => void): unknown;
  off(event: string, callback: (event: HookEvent) => void): unknown;
  start(): void;
  stop(): void;
}
export class InputCounter {
  private pressed = new Set<number>();
  private active = false;
  private mouse = (event: HookEvent) => {
    if (event.button) this.count();
  };
  private down = (event: HookEvent) => {
    if (event.keycode === undefined || this.pressed.has(event.keycode)) return;
    this.pressed.add(event.keycode);
    this.count();
  };
  private up = (event: HookEvent) => {
    if (event.keycode !== undefined) this.pressed.delete(event.keycode);
  };
  constructor(
    private hook: Hook,
    private count: () => void,
  ) {}
  start(): void {
    if (this.active) return;
    this.hook.on('mousedown', this.mouse);
    this.hook.on('keydown', this.down);
    this.hook.on('keyup', this.up);
    try {
      this.hook.start();
      this.active = true;
    } catch (error) {
      this.detach();
      throw error;
    }
  }
  stop(): void {
    try {
      if (this.active) this.hook.stop();
    } finally {
      this.active = false;
      this.detach();
      this.pressed.clear();
    }
  }
  private detach(): void {
    this.hook.off('mousedown', this.mouse);
    this.hook.off('keydown', this.down);
    this.hook.off('keyup', this.up);
  }
}
const FOCUS_SCRIPT = String.raw`Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class BAWindow { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }'; while ($true) { try { $baPid = 0; [BAWindow]::GetWindowThreadProcessId([BAWindow]::GetForegroundWindow(), [ref]$baPid) | Out-Null; (Get-Process -Id $baPid -ErrorAction Stop).ProcessName } catch { '' }; Start-Sleep -Milliseconds 750 }`;
export class FocusWatcher {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  focused = false;
  start(): void {
    this.stop();
    if (process.platform !== 'win32') return;
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', FOCUS_SCRIPT],
      { windowsHide: true },
    );
    this.child = child;
    child.stdout.on('data', (data: Buffer) => {
      if (this.child !== child) return;
      this.buffer += data.toString();
      const lines = this.buffer.split(/\r?\n/);
      this.buffer = lines.pop() || '';
      for (const line of lines) this.focused = /^broken[_ ]?arrow(?:_beta)?$/i.test(line.trim());
    });
    child.on('error', () => {
      if (this.child === child) {
        this.child = null;
        this.focused = false;
      }
    });
    child.on('exit', () => {
      if (this.child === child) {
        this.child = null;
        this.focused = false;
        this.buffer = '';
      }
    });
  }
  stop(): void {
    const child = this.child;
    this.child = null;
    this.focused = false;
    this.buffer = '';
    if (child) child.kill();
  }
}
export class ApmController {
  private counter: InputCounter | null = null;
  private focus = new FocusWatcher();
  private startedAt = 0;
  private buckets: number[] = [];
  private value: ApmState = {
    status: 'disabled',
    totalActions: 0,
    durationSec: 0,
    apm: 0,
    peak: 0,
    perMinute: [],
    focused: false,
    fid: null,
  };
  status(): ApmState {
    if (this.value.status === 'active') {
      const durationSec = Math.max(0, (Date.now() - this.startedAt) / 1000),
        minutes = Math.max(1, Math.ceil(durationSec / 60));
      return {
        ...this.value,
        durationSec,
        apm: Math.round((this.value.totalActions / minutes) * 10) / 10,
        perMinute: Array.from({ length: minutes }, (_, i) => this.buckets[i] || 0),
        focused: this.focus.focused,
      };
    }
    return { ...this.value, perMinute: [...this.value.perMinute] };
  }
  start(match: Match): void {
    this.disable();
    this.startedAt = Date.now();
    this.buckets = [];
    this.value = {
      status: 'active',
      totalActions: 0,
      durationSec: 0,
      apm: 0,
      peak: 0,
      perMinute: [],
      focused: false,
      fid: match.fid,
    };
    try {
      const require = createRequire(
          typeof __filename === 'string' ? __filename : join(process.cwd(), 'package.json'),
        ),
        mod = require('uiohook-napi') as { uIOhook: Hook };
      this.counter = new InputCounter(mod.uIOhook, () => {
        if (this.value.status !== 'active' || !this.focus.focused) return;
        const minute = Math.floor((Date.now() - this.startedAt) / 60000);
        this.buckets[minute] = (this.buckets[minute] || 0) + 1;
        this.value.totalActions++;
      });
      this.focus.start();
      this.counter.start();
    } catch {
      this.counter?.stop();
      this.counter = null;
      this.focus.stop();
      this.value.status = 'unavailable';
    }
  }
  stop(): void {
    if (this.value.status === 'active') {
      const value = this.status();
      this.value = { ...value, status: 'complete', peak: Math.max(0, ...value.perMinute) };
    }
    this.counter?.stop();
    this.counter = null;
    this.focus.stop();
  }
  disable(): void {
    this.stop();
    this.value = { ...this.value, status: 'disabled', focused: false };
  }
}
