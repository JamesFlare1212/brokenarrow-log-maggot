export const BATRACE_ORIGIN = 'https://dash.batrace.top';
export const BATRACE_API_ORIGIN = 'https://bot.batrace.top';

export function batraceClientHeaders(version: string): Record<string, string> {
  return {
    'User-Agent': `brokenarrow-log-maggot/${version} (+https://github.com/JamesFlare1212/brokenarrow-log-maggot)`,
    'X-Client': 'brokenarrow-log-maggot',
  };
}
