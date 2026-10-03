// A ZIP archive written as a stream (the archive's uploads.zip): each entry is
// stored as is (media is compressed already), its CRC and size follow it in a
// data descriptor, and ZIP64 records take over past 4 GiB or 65,535 entries,
// so a bucket of any size goes through without being held in memory or on
// disk. zipEntryCount() reads the entry count back from an archive's tail.

import { crc32 } from "node:zlib";

const UINT32 = 0xffffffff;
const UINT16 = 0xffff;
// General purpose flags: sizes in a data descriptor (3), UTF-8 names (11).
const FLAGS = 0x0008 | 0x0800;

// `entries` (iterable) are { name, modified (Date), open() → async iterable
// of bytes }; yields the archive's bytes.
export async function* zipStream(entries) {
  const central = [];
  let offset = 0;
  const emit = (buffer) => {
    offset += buffer.length;
    return buffer;
  };

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const { time, date } = dosDateTime(entry.modified);
    const start = offset;
    // Whether the sizes need 8 bytes is known only after the data, so every
    // local header carries a ZIP64 field (readers take the central one).
    const local = Buffer.alloc(30 + name.length + 20);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(45, 4);
    local.writeUInt16LE(FLAGS, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(UINT32, 18);
    local.writeUInt32LE(UINT32, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(20, 28);
    name.copy(local, 30);
    zip64Extra([0n, 0n]).copy(local, 30 + name.length);
    yield emit(local);

    let crc = 0;
    let size = 0;
    for await (const chunk of await entry.open()) {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      crc = crc32(bytes, crc);
      size += bytes.length;
      yield emit(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length));
    }

    const descriptor = Buffer.alloc(24);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeBigUInt64LE(BigInt(size), 8);
    descriptor.writeBigUInt64LE(BigInt(size), 16);
    yield emit(descriptor);
    central.push({ name, time, date, crc, size, start });
  }

  const directoryStart = offset;
  for (const { name, time, date, crc, size, start } of central) {
    const wide = [];
    if (size >= UINT32) wide.push(BigInt(size), BigInt(size));
    if (start >= UINT32) wide.push(BigInt(start));
    const extra = wide.length > 0 ? zip64Extra(wide) : Buffer.alloc(0);
    const header = Buffer.alloc(46 + name.length + extra.length);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(45, 4);
    header.writeUInt16LE(45, 6);
    header.writeUInt16LE(FLAGS, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(Math.min(size, UINT32), 20);
    header.writeUInt32LE(Math.min(size, UINT32), 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(extra.length, 30);
    header.writeUInt32LE(Math.min(start, UINT32), 42);
    name.copy(header, 46);
    extra.copy(header, 46 + name.length);
    yield emit(header);
  }

  const directorySize = offset - directoryStart;
  const count = central.length;
  if (count >= UINT16 || directoryStart >= UINT32 || directorySize >= UINT32) {
    const record = Buffer.alloc(56);
    const recordStart = offset;
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(count), 24);
    record.writeBigUInt64LE(BigInt(count), 32);
    record.writeBigUInt64LE(BigInt(directorySize), 40);
    record.writeBigUInt64LE(BigInt(directoryStart), 48);
    yield emit(record);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(recordStart), 8);
    locator.writeUInt32LE(1, 16);
    yield emit(locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Math.min(count, UINT16), 8);
  end.writeUInt16LE(Math.min(count, UINT16), 10);
  end.writeUInt32LE(Math.min(directorySize, UINT32), 12);
  end.writeUInt32LE(Math.min(directoryStart, UINT32), 16);
  yield emit(end);
}

// How many bytes of an archive's end zipEntryCount() needs.
export const ZIP_TAIL_BYTES = 22 + 20 + 56;

// The entry count an archive's end records (its last ZIP_TAIL_BYTES bytes, as
// zipStream() writes it: no comment), or null when it isn't a ZIP's end.
export function zipEntryCount(tail) {
  const end = tail.length - 22;
  if (end < 0 || tail.readUInt32LE(end) !== 0x06054b50) return null;
  const count = tail.readUInt16LE(end + 10);
  if (count !== UINT16) return count;
  const locator = end - 20;
  const record = locator - 56;
  if (record < 0 || tail.readUInt32LE(locator) !== 0x07064b50) return null;
  if (tail.readUInt32LE(record) !== 0x06064b50) return null;
  return Number(tail.readBigUInt64LE(record + 32));
}

function zip64Extra(values) {
  const extra = Buffer.alloc(4 + values.length * 8);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(values.length * 8, 2);
  values.forEach((value, index) => extra.writeBigUInt64LE(value, 4 + index * 8));
  return extra;
}

// MS-DOS date and time (UTC), clamped to 1980, ZIP's epoch.
function dosDateTime(modified = new Date()) {
  const at = modified.getUTCFullYear() < 1980 ? new Date(Date.UTC(1980, 0, 1)) : modified;
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
    date: ((at.getUTCFullYear() - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}
