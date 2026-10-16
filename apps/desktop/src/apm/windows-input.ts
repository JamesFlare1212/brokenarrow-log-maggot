import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import source from './windows-input.cs?raw';

export interface InputFrame {
  type: 'ready' | 'sample' | 'stopped';
  elapsedMs: number;
  focusedMs: number;
  focused: boolean;
  seconds: Array<[number, number]>;
}
export interface InputCollector {
  start(frame: (value: InputFrame) => void, failure: (error: Error) => void): void;
  stop(): Promise<void>;
}

const command = `$ErrorActionPreference='Stop'; try { Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::ReadLine()))); [BAInputMonitor]::Run() } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;

export function parseInputFrame(line: string): InputFrame {
  const value = JSON.parse(line) as InputFrame;
  if (
    !value ||
    !['ready', 'sample', 'stopped'].includes(value.type) ||
    !Number.isSafeInteger(value.elapsedMs) ||
    value.elapsedMs < 0 ||
    !Number.isSafeInteger(value.focusedMs) ||
    value.focusedMs < 0 ||
    value.focusedMs > value.elapsedMs ||
    typeof value.focused !== 'boolean' ||
    !Array.isArray(value.seconds) ||
    value.seconds.length > 1000 ||
    value.seconds.some(
      (entry) =>
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        !Number.isSafeInteger(entry[0]) ||
        entry[0] < 0 ||
        entry[0] > Math.floor(value.elapsedMs / 1000) ||
        !Number.isSafeInteger(entry[1]) ||
        entry[1] < 0,
    )
  )
    throw new Error('Invalid input collector message');
  return value;
}

export class WindowsInputCollector implements InputCollector {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stopping: Promise<void> | null = null;
  constructor(private launch: typeof spawn = spawn) {}

  start(frame: (value: InputFrame) => void, failure: (error: Error) => void): void {
    if (process.platform !== 'win32') throw new Error('Raw Input requires Windows');
    if (this.child) throw new Error('Input collector already running');
    const child = this.launch(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command', command],
      { windowsHide: true, stdio: 'pipe' },
    ) as ChildProcessWithoutNullStreams;
    this.child = child;
    this.stopping = null;
    let buffer = '',
      errors = '',
      ready = false,
      stopped = false,
      failed = false;
    const fail = (error: Error) => {
      if (failed || this.child !== child) return;
      failed = true;
      clearTimeout(startup);
      clearInterval(heartbeat);
      failure(error);
      child.kill();
    };
    let lastMessage = performance.now();
    const startup = setTimeout(() => fail(new Error('Input collector startup timed out')), 15000);
    const heartbeat = setInterval(() => {
      if (ready && performance.now() - lastMessage > 5000)
        fail(new Error('Input collector stopped responding'));
    }, 1000);
    child.stdout.on('data', (data: Buffer) => {
      if (this.child !== child || failed) return;
      buffer += data.toString('utf8');
      if (buffer.length > 65536) return fail(new Error('Input collector message too large'));
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      try {
        for (const line of lines) {
          if (!line.trim()) continue;
          const value = parseInputFrame(line);
          if (stopped || (!ready && value.type !== 'ready') || (ready && value.type === 'ready'))
            throw new Error('Unexpected input collector message');
          if (value.type === 'stopped' && !this.stopping)
            throw new Error('Input collector stopped unexpectedly');
          ready = true;
          stopped = value.type === 'stopped';
          lastMessage = performance.now();
          clearTimeout(startup);
          frame(value);
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stderr.on('data', (data: Buffer) => {
      errors = (errors + data.toString('utf8')).slice(-2048);
    });
    child.stdin.on('error', fail);
    child.on('error', fail);
    child.once('close', (code) => {
      clearTimeout(startup);
      clearInterval(heartbeat);
      if (this.child !== child) return;
      if (!stopped || code !== 0)
        fail(new Error(errors.trim() || 'Input collector exited unexpectedly'));
      this.child = null;
    });
    child.stdin.write(Buffer.from(source, 'utf8').toString('base64') + '\n');
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const child = this.child;
    if (!child) return Promise.resolve();
    this.stopping = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Input collector shutdown timed out'));
      }, 3000);
      child.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
      child.stdin.write('stop\n');
    });
    return this.stopping;
  }
}
