import { randomUUID } from 'node:crypto';
import { initialApmState, type ApmState, type Match } from '@ba/contracts';
import { WindowsInputCollector, type InputCollector, type InputFrame } from './apm/windows-input';

const round = (value: number) => Math.round(value * 10) / 10;

export class ApmController {
  private collector: InputCollector | null = null;
  private seconds = new Map<number, number>();
  private elapsedMs = 0;
  private receivedAt = 0;
  private ready = false;
  private value = initialApmState();
  constructor(
    private createCollector: () => InputCollector = () => new WindowsInputCollector(),
    private now: () => number = () => performance.now(),
    private wallTime: () => number = Date.now,
  ) {}

  status(): ApmState {
    if (this.value.status !== 'active') return structuredClone(this.value);
    const elapsed = this.ready ? this.elapsedMs + Math.max(0, this.now() - this.receivedAt) : 0;
    return this.snapshot(elapsed);
  }

  private snapshot(elapsed: number): ApmState {
    const durationSec = elapsed / 1000;
    const perMinute = Array.from({ length: Math.ceil(durationSec / 60) }, () => 0);
    const perSecond = Array.from({ length: Math.ceil(durationSec) }, () => 0);
    let totalActions = 0;
    for (const [second, count] of this.seconds) {
      totalActions += count;
      perSecond[second] = count;
      const minute = Math.floor(second / 60);
      perMinute[minute] = (perMinute[minute] || 0) + count;
    }
    // Convert complete rolling 10-second input counts to actions per minute.
    const completedSeconds = Math.floor(durationSec);
    let rolling = 0,
      peak = 0;
    for (let second = 0; second < completedSeconds; second++) {
      rolling += this.seconds.get(second) || 0;
      if (second >= 10) rolling -= this.seconds.get(second - 10) || 0;
      if (second >= 9) peak = Math.max(peak, rolling * 6);
    }
    return {
      ...this.value,
      durationSec,
      totalActions,
      apm: durationSec > 0 ? round((totalActions * 60) / durationSec) : 0,
      currentApm: durationSec >= 10 ? rolling * 6 : null,
      peak,
      perMinute,
      perSecond,
      focusedDurationSec: Math.min(
        durationSec,
        this.value.focusedDurationSec +
          (this.value.focused ? Math.max(0, elapsed - this.elapsedMs) / 1000 : 0),
      ),
    };
  }

  async start(match: Match, partial = false): Promise<void> {
    await this.stop(true);
    this.seconds.clear();
    this.elapsedMs = 0;
    this.ready = false;
    this.value = {
      ...initialApmState('active'),
      captureId: randomUUID(),
      sessionId: match.sessionId,
      fid: match.fid,
      map: match.map,
      matchDurationSec: match.durationSec,
      partial,
    };
    try {
      const collector = this.createCollector();
      this.collector = collector;
      collector.start(
        (frame) => {
          if (this.collector !== collector || this.value.status !== 'active') return;
          this.accept(frame);
        },
        (error) => {
          if (this.collector === collector) this.fail(error);
        },
      );
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private accept(frame: InputFrame): void {
    if (frame.elapsedMs < this.elapsedMs) throw new Error('Input collector clock moved backwards');
    for (const [second, count] of frame.seconds) {
      if (count < (this.seconds.get(second) || 0))
        throw new Error('Input collector count moved backwards');
      this.seconds.set(second, count);
    }
    this.elapsedMs = frame.elapsedMs;
    this.receivedAt = this.now();
    this.ready = true;
    this.value.startedAt ??= this.wallTime() - frame.elapsedMs;
    this.value.focused = frame.focused;
    this.value.focusedDurationSec = frame.focusedMs / 1000;
  }

  updateMatch(match: Match): void {
    if (match.sessionId !== this.value.sessionId) return;
    this.value.fid = match.fid ?? this.value.fid;
    this.value.map = match.map || this.value.map;
    this.value.matchDurationSec = match.durationSec ?? this.value.matchDurationSec;
  }

  private fail(error: Error): void {
    this.value = {
      ...this.snapshot(this.elapsedMs),
      status: 'unavailable',
      focused: false,
      partial: true,
      interrupted: true,
      endedAt: this.wallTime(),
      error: error.message,
    };
  }

  async stop(interrupted = false): Promise<void> {
    const collector = this.collector;
    if (collector) {
      try {
        // Consume the final native aggregate before saving the completed capture.
        await collector.stop();
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
      if (this.collector === collector) this.collector = null;
    }
    if (this.value.status === 'active')
      this.value = {
        ...this.snapshot(this.elapsedMs),
        status: 'complete',
        focused: false,
        partial: this.value.partial || interrupted,
        interrupted,
        endedAt: this.wallTime(),
      };
  }

  async disable(): Promise<void> {
    await this.stop(true);
    this.value = { ...this.value, status: 'disabled', focused: false };
  }
}
