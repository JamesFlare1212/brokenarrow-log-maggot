import type { ApmState } from './models';

export function initialApmState(status: ApmState['status'] = 'disabled'): ApmState {
  return {
    status,
    captureId: null,
    sessionId: null,
    map: '',
    startedAt: null,
    endedAt: null,
    totalActions: 0,
    durationSec: 0,
    matchDurationSec: null,
    focusedDurationSec: 0,
    apm: 0,
    currentApm: null,
    peak: 0,
    perMinute: [],
    focused: false,
    fid: null,
    partial: false,
    interrupted: false,
    error: null,
  };
}
