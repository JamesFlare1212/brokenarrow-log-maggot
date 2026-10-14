import { open, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
interface Vint {
  value: number;
  length: number;
  unknown: boolean;
}
function vint(buf: Buffer, offset: number, id = false): Vint | null {
  if (offset >= buf.length) return null;
  let length = 1,
    mask = 0x80;
  while (length <= 8 && !((buf[offset] || 0) & mask)) {
    length++;
    mask >>= 1;
  }
  if (length > 8 || offset + length > buf.length) return null;
  let value = id ? buf[offset] || 0 : (buf[offset] || 0) & (mask - 1),
    unknown = !id && value === mask - 1;
  for (let i = 1; i < length; i++) {
    const b = buf[offset + i] || 0;
    value = value * 256 + b;
    unknown = unknown && b === 255;
  }
  return { value, length, unknown };
}
function size(value: number, length?: number): Buffer {
  let n = length || 1;
  while (!length && value >= 2 ** (7 * n) - 1) n++;
  const b = Buffer.alloc(n);
  let remaining = value;
  for (let i = n - 1; i >= 0; i--) {
    b[i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  b[0] = (b[0] || 0) | (1 << (8 - n));
  return b;
}
export function patchDuration(buf: Buffer, seconds: number): Buffer {
  if (!Number.isFinite(seconds) || seconds <= 0) return buf;
  const ebml = vint(buf, 0, true);
  if (ebml?.value !== 0x1a45dfa3) return buf;
  const firstSize = vint(buf, ebml.length);
  if (!firstSize) return buf;
  const segmentAt = ebml.length + firstSize.length + firstSize.value,
    segment = vint(buf, segmentAt, true);
  if (segment?.value !== 0x18538067) return buf;
  const segmentSize = vint(buf, segmentAt + segment.length);
  if (!segmentSize) return buf;
  let offset = segmentAt + segment.length + segmentSize.length;
  while (offset < buf.length) {
    const id = vint(buf, offset, true);
    if (!id) return buf;
    const elementSize = vint(buf, offset + id.length);
    if (!elementSize || elementSize.unknown) return buf;
    const dataAt = offset + id.length + elementSize.length,
      end = dataAt + elementSize.value;
    if (end > buf.length) return buf;
    if (id.value === 0x1549a966) {
      let child = dataAt,
        timeScale = 1000000;
      let existingDuration: { at: number; length: number } | null = null;
      while (child < end) {
        const tag = vint(buf, child, true);
        if (!tag) break;
        const length = vint(buf, child + tag.length);
        if (!length) break;
        const valueAt = child + tag.length + length.length;
        if (valueAt + length.value > end) break;
        if (tag.value === 0x2ad7b1 && length.value <= 6)
          timeScale = buf.readUIntBE(valueAt, length.value);
        if (tag.value === 0x4489 && (length.value === 4 || length.value === 8)) {
          existingDuration = { at: valueAt, length: length.value };
        }
        child = valueAt + length.value;
      }
      if (existingDuration) {
        const copy = Buffer.from(buf);
        if (existingDuration.length === 4)
          copy.writeFloatBE((seconds * 1e9) / timeScale, existingDuration.at);
        else copy.writeDoubleBE((seconds * 1e9) / timeScale, existingDuration.at);
        return copy;
      }
      const duration = Buffer.alloc(11);
      duration.set([0x44, 0x89, 0x88]);
      duration.writeDoubleBE((seconds * 1e9) / timeScale, 3);
      const newSize = size(elementSize.value + 11),
        out = Buffer.concat([
          buf.subarray(0, offset + id.length),
          newSize,
          duration,
          buf.subarray(dataAt),
        ]),
        added = out.length - buf.length;
      if (!segmentSize.unknown) {
        const updated = size(segmentSize.value + added, segmentSize.length);
        updated.copy(out, segmentAt + segment.length);
      }
      return out;
    }
    if (id.value === 0x1f43b675) return buf;
    offset = end;
  }
  return buf;
}
export async function patchDurationFile(
  source: string,
  dest: string,
  seconds: number,
): Promise<void> {
  const info = await stat(source),
    count = Math.min(65536, info.size);
  if (!count) throw new Error('Recording has no data');
  const fd = await open(source, 'r'),
    head = Buffer.alloc(count);
  try {
    await fd.read(head, 0, count, 0);
  } finally {
    await fd.close();
  }
  const stream = createWriteStream(dest, { flags: 'wx' }),
    patched = patchDuration(head, seconds);
  stream.write(patched);
  if (info.size > count) await pipeline(createReadStream(source, { start: count }), stream);
  else {
    stream.end();
    await new Promise<void>((resolve, reject) => {
      stream.once('finish', resolve);
      stream.once('error', reject);
    });
  }
}
