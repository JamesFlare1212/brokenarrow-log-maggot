export interface VdfObject {
  [key: string]: string | VdfObject;
}

/** The text KeyValues subset used by Steam library and app manifests. */
export function parseVdf(raw: string): VdfObject {
  if (raw.length > 1024 * 1024) throw new Error('Steam metadata is too large');
  const token = /\s+|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|[{}]|[^\s{}"]+/gy;
  let offset = 0;
  const next = (): string | undefined => {
    while (offset < raw.length) {
      token.lastIndex = offset;
      const match = token.exec(raw);
      if (!match) throw new Error('Invalid Steam metadata');
      offset = token.lastIndex;
      const value = match[0];
      if (/^\s|^\/\//.test(value)) continue;
      return value;
    }
    return undefined;
  };
  const decode = (value: string): string =>
    value.startsWith('"') ? value.slice(1, -1).replace(/\\(["\\])/g, '$1') : value;
  const object = (depth: number): VdfObject => {
    if (depth > 32) throw new Error('Steam metadata is nested too deeply');
    const result: VdfObject = Object.create(null);
    while (true) {
      const key = next();
      if (key === undefined) {
        if (depth) throw new Error('Unclosed Steam metadata object');
        return result;
      }
      if (key === '}') {
        if (!depth) throw new Error('Unexpected Steam metadata closing brace');
        return result;
      }
      if (key === '{') throw new Error('Missing Steam metadata key');
      const value = next();
      if (value === undefined || value === '}') throw new Error('Missing Steam metadata value');
      result[decode(key).toLowerCase()] = value === '{' ? object(depth + 1) : decode(value);
    }
  };
  return object(0);
}
