/** Read Next.js JSON models without executing page scripts. */
export function findPageData(
  html: string,
  select: (value: Record<string, unknown>) => unknown,
): unknown {
  const chunks: string[] = [];
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const call = script[1]?.match(/^\s*self\.__next_f\.push\(([\s\S]*)\)\s*;?\s*$/);
    if (!call?.[1]) continue;
    try {
      const frame: unknown = JSON.parse(call[1]);
      if (Array.isArray(frame) && frame[0] === 1 && typeof frame[1] === 'string')
        chunks.push(frame[1]);
    } catch {
      // Ignore scripts that are not JSON stream frames.
    }
  }
  const find = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return;
    const selected = select(value as Record<string, unknown>);
    if (selected !== undefined) return selected;
    for (const child of Object.values(value)) {
      const result = find(child);
      if (result !== undefined) return result;
    }
  };
  // A model can span several streamed frames; join before reading records.
  for (const record of chunks.join('').split('\n')) {
    if (!/^[\da-f]+:/i.test(record)) continue;
    try {
      const result = find(JSON.parse(record.slice(record.indexOf(':') + 1)));
      if (result !== undefined) return result;
    } catch {
      // Flight also includes module, text and metadata records.
    }
  }
}
