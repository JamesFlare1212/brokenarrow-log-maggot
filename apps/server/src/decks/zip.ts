import { deflateRaw, inflateRaw } from 'node:zlib';
import { promisify } from 'node:util';
import { filename } from '@ba/shared';
const deflate = promisify(deflateRaw),
  inflate = promisify(inflateRaw);
const MAX_ENTRY = 8 * 1024 * 1024,
  MAX_TOTAL = 100 * 1024 * 1024,
  MAX_ENTRIES = 2000;
export const ZIP_LIMITS = { entry: MAX_ENTRY, total: MAX_TOTAL, count: MAX_ENTRIES };
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = (table[(c ^ b) & 255] || 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export interface ZipEntry {
  name: string;
  data: Buffer;
}
export async function zipCreate(files: ZipEntry[]): Promise<Buffer> {
  if (files.length > MAX_ENTRIES) throw new Error('Too many deck files');
  let offset = 0,
    total = 0;
  const parts: Buffer[] = [],
    central: Buffer[] = [];
  for (const f of files) {
    filename(f.name, '.dek');
    total += f.data.length;
    if (f.data.length > MAX_ENTRY || total > MAX_TOTAL)
      throw new Error('Deck backup exceeds size limit');
    const name = Buffer.from(f.name),
      compressed = await deflate(f.data, { level: 6 }),
      method = compressed.length < f.data.length ? 8 : 0,
      data = method === 8 ? compressed : f.data,
      crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x800, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(f.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}
export async function zipExtract(buf: Buffer): Promise<ZipEntry[]> {
  if (buf.length > MAX_TOTAL) throw new Error('ZIP exceeds size limit');
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50 && i + 22 + buf.readUInt16LE(i + 20) === buf.length) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('Invalid ZIP');
  const count = buf.readUInt16LE(end + 10),
    start = buf.readUInt32LE(end + 16),
    size = buf.readUInt32LE(end + 12);
  if (
    count > MAX_ENTRIES ||
    start + size > end ||
    buf.readUInt16LE(end + 4) ||
    buf.readUInt16LE(end + 6)
  )
    throw new Error('Unsupported ZIP directory');
  const out: ZipEntry[] = [],
    names = new Set<string>();
  let pos = start,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > start + size || buf.readUInt32LE(pos) !== 0x02014b50)
      throw new Error('Corrupt ZIP directory');
    const flags = buf.readUInt16LE(pos + 8),
      method = buf.readUInt16LE(pos + 10),
      crc = buf.readUInt32LE(pos + 16),
      compressed = buf.readUInt32LE(pos + 20),
      length = buf.readUInt32LE(pos + 24),
      nameLen = buf.readUInt16LE(pos + 28),
      extra = buf.readUInt16LE(pos + 30),
      comment = buf.readUInt16LE(pos + 32),
      local = buf.readUInt32LE(pos + 42);
    if (
      pos + 46 + nameLen + extra + comment > start + size ||
      local + 30 > start ||
      length > MAX_ENTRY ||
      flags & 1
    )
      throw new Error('Unsafe ZIP entry');
    const name = filename(buf.toString('utf8', pos + 46, pos + 46 + nameLen), '.dek');
    if (names.has(name.toLowerCase())) throw new Error('Duplicate deck file');
    names.add(name.toLowerCase());
    total += length;
    if (total > MAX_TOTAL) throw new Error('ZIP decompressed size exceeds limit');
    if (buf.readUInt32LE(local) !== 0x04034b50 || buf.readUInt16LE(local + 8) !== method)
      throw new Error('Invalid ZIP local header');
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (dataStart + compressed > start) throw new Error('Truncated ZIP data');
    const content = buf.subarray(dataStart, dataStart + compressed),
      data =
        method === 0
          ? Buffer.from(content)
          : method === 8
            ? await inflate(content, { maxOutputLength: MAX_ENTRY })
            : null;
    if (!data || data.length !== length || crc32(data) !== crc)
      throw new Error('ZIP integrity check failed');
    out.push({ name, data });
    pos += 46 + nameLen + extra + comment;
  }
  if (pos !== start + size) throw new Error('ZIP directory length mismatch');
  return out;
}
