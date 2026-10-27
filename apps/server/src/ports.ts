import type {
  ApmState,
  Display,
  Match,
  PublicConfig,
  RecordingState,
  AnalyticsRuntimeSample,
} from '@ba/contracts';
import type { HttpPort } from './network/client';
export interface Platform {
  analytics?: {
    enabled: boolean;
    distribution: 'installed' | 'portable';
    sampleRuntime?: () => AnalyticsRuntimeSample;
  };
  updates?: {
    status(): import('@ba/contracts').UpdateState;
    check(): Promise<import('@ba/contracts').UpdateState>;
    download(): Promise<import('@ba/contracts').UpdateState>;
    install(): import('@ba/contracts').UpdateState;
  };
  http: HttpPort;
  version: string;
  selectDirectory(kind: 'logs' | 'replays' | 'decks'): Promise<string | null>;
  detectLogDirectory(): Promise<string>;
  openPath(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  notify(title: string, body: string): void;
  recordings: {
    status(): RecordingState;
    start(match: Match, config: PublicConfig, test?: boolean): Promise<void>;
    stop(match?: Match): Promise<void>;
    abort(): Promise<void>;
    displays(): Promise<Display[]>;
    thumbnail(id: string): Promise<string | null>;
    playback(path: string): Promise<string>;
  };
  apm: {
    status(): ApmState;
    start(match: Match, partial?: boolean): Promise<void> | void;
    updateMatch(match: Match): void;
    stop(interrupted?: boolean): Promise<void> | void;
    disable(): Promise<void> | void;
  };
}
