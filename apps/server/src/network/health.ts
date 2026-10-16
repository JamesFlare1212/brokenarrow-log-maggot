import type { ApiHealthCheck } from '@ba/contracts';
import { object } from '@ba/shared';

export function failedHealthCheck(path: string, ms: number, error: unknown): ApiHealthCheck {
  const detail = object(error);
  const status = detail.status;
  return {
    path,
    ok: false,
    ms,
    status: typeof status === 'number' ? status : null,
    failure: detail.blocked
      ? 'blocked'
      : detail.invalidResponse
        ? 'invalid-response'
        : detail.name === 'TimeoutError' || detail.name === 'AbortError'
          ? 'timeout'
          : typeof status === 'number'
            ? 'http'
            : 'network',
    ...(typeof detail.rayId === 'string' ? { rayId: detail.rayId } : {}),
  };
}
