export function archiveMatchFromHash(hash: string): string | null {
  const value = /^#archive\/match\/([^/]+)$/.exec(hash)?.[1];
  if (!value) return null;
  try {
    return decodeURIComponent(value) || null;
  } catch {
    return null;
  }
}

export function archiveMatchHash(fid: string): string {
  return `#archive/match/${encodeURIComponent(fid)}`;
}
