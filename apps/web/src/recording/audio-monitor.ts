import type { RecordingAudioState } from '@ba/contracts';

type Source = keyof RecordingAudioState;

export class RecordingAudioMonitor {
  private streams: Partial<Record<Source, MediaStream>> = {};
  private listeners: Partial<Record<Source, Array<() => void>>> = {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = '';
  private changed: ((state: RecordingAudioState) => void) | null = null;
  private state: RecordingAudioState;

  constructor(
    system: boolean,
    microphone: boolean,
    private processing: () => boolean = () => true,
  ) {
    this.state = {
      system: { state: system ? 'starting' : 'off', gap: false },
      microphone: { state: microphone ? 'starting' : 'off', gap: false },
    };
  }

  set(source: Source, stream: MediaStream | null): void {
    this.listeners[source]?.forEach((remove) => remove());
    this.listeners[source] = [];
    if (stream) this.streams[source] = stream;
    else delete this.streams[source];
    for (const track of stream?.getAudioTracks() ?? []) {
      const listener = () => this.report();
      for (const name of ['ended', 'mute', 'unmute']) track.addEventListener(name, listener);
      this.listeners[source]!.push(() => {
        for (const name of ['ended', 'mute', 'unmute']) track.removeEventListener(name, listener);
      });
    }
    this.report();
  }

  snapshot(): RecordingAudioState {
    for (const source of ['system', 'microphone'] as const) {
      const previous = this.state[source];
      if (previous.state === 'off') continue;
      const tracks = this.streams[source]?.getAudioTracks() ?? [];
      const live = tracks.filter((track) => track.readyState !== 'ended');
      const state = !tracks.length
        ? 'unavailable'
        : !live.length
          ? 'ended'
          : this.processing() && live.some((track) => track.enabled && !track.muted)
            ? 'active'
            : 'muted';
      this.state[source] = {
        state,
        gap: previous.gap || state !== 'active',
      };
    }
    return structuredClone(this.state);
  }

  private report(): void {
    if (!this.changed) return;
    const state = this.snapshot(),
      signature = JSON.stringify(state);
    if (signature === this.last) return;
    this.last = signature;
    this.changed(state);
  }

  start(changed: (state: RecordingAudioState) => void): void {
    this.changed = changed;
    this.last = '';
    this.report();
    // stop() does not dispatch ended, and enabled changes have no track event.
    this.timer = setInterval(() => this.report(), 250);
  }

  stop(): void {
    this.changed = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    Object.values(this.listeners)
      .flat()
      .forEach((remove) => remove());
    this.listeners = {};
  }
}
