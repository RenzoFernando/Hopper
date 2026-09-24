const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const ZIP32_LIMIT = 0xffffffff;

export type ZipEntry = {
  name: string;
  blob: Blob;
  modifiedAt?: Date;
};

type PreparedEntry = ZipEntry & {
  crc32: number;
  encodedName: Uint8Array;
  offset: number;
  dosDate: number;
  dosTime: number;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

async function crc32(blob: Blob) {
  let crc = 0xffffffff;
  const reader = blob.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      for (const byte of value) {
        const tableValue = CRC_TABLE[(crc ^ byte) & 0xff];
        crc = (tableValue ?? 0) ^ (crc >>> 8);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTimestamp(date: Date) {
  const valid = Number.isFinite(date.getTime()) ? date : new Date();
  const year = Math.min(2107, Math.max(1980, valid.getFullYear()));
  const month = valid.getMonth() + 1;
  const day = valid.getDate();
  const hours = valid.getHours();
  const minutes = valid.getMinutes();
  const seconds = Math.floor(valid.getSeconds() / 2);
  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds
  };
}

function localHeader(entry: PreparedEntry) {
  const header = new Uint8Array(30 + entry.encodedName.length);
  const view = new DataView(header.buffer);
  writeUint32(view, 0, 0x04034b50);
  writeUint16(view, 4, 20);
  writeUint16(view, 6, UTF8_FLAG);
  writeUint16(view, 8, STORE_METHOD);
  writeUint16(view, 10, entry.dosTime);
  writeUint16(view, 12, entry.dosDate);
  writeUint32(view, 14, entry.crc32);
  writeUint32(view, 18, entry.blob.size);
  writeUint32(view, 22, entry.blob.size);
  writeUint16(view, 26, entry.encodedName.length);
  writeUint16(view, 28, 0);
  header.set(entry.encodedName, 30);
  return header;
}

function centralHeader(entry: PreparedEntry) {
  const header = new Uint8Array(46 + entry.encodedName.length);
  const view = new DataView(header.buffer);
  writeUint32(view, 0, 0x02014b50);
  writeUint16(view, 4, 20);
  writeUint16(view, 6, 20);
  writeUint16(view, 8, UTF8_FLAG);
  writeUint16(view, 10, STORE_METHOD);
  writeUint16(view, 12, entry.dosTime);
  writeUint16(view, 14, entry.dosDate);
  writeUint32(view, 16, entry.crc32);
  writeUint32(view, 20, entry.blob.size);
  writeUint32(view, 24, entry.blob.size);
  writeUint16(view, 28, entry.encodedName.length);
  writeUint16(view, 30, 0);
  writeUint16(view, 32, 0);
  writeUint16(view, 34, 0);
  writeUint16(view, 36, 0);
  writeUint32(view, 38, 0);
  writeUint32(view, 42, entry.offset);
  header.set(entry.encodedName, 46);
  return header;
}

function endRecord(entries: number, centralSize: number, centralOffset: number) {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);
  writeUint32(view, 0, 0x06054b50);
  writeUint16(view, 4, 0);
  writeUint16(view, 6, 0);
  writeUint16(view, 8, entries);
  writeUint16(view, 10, entries);
  writeUint32(view, 12, centralSize);
  writeUint32(view, 16, centralOffset);
  writeUint16(view, 20, 0);
  return record;
}

function safeEntryName(name: string) {
  const normalized = String(name || "archivo").replaceAll("\\", "/").split("/").at(-1) || "archivo";
  return normalized
      .split("")
      .map((character) => (character.charCodeAt(0) < 32 ? "_" : character))
      .join("");
}

function uniqueNames(entries: ZipEntry[]) {
  const used = new Set<string>();
  return entries.map((entry) => {
    const original = safeEntryName(entry.name);
    let candidate = original;
    const dot = original.lastIndexOf(".");
    const base = dot > 0 ? original.slice(0, dot) : original;
    const extension = dot > 0 ? original.slice(dot) : "";
    let counter = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${base} (${counter})${extension}`;
      counter += 1;
    }
    used.add(candidate.toLowerCase());
    return { ...entry, name: candidate };
  });
}

export async function createZipBlob(entries: ZipEntry[]) {
  if (entries.length === 0) throw new Error("No hay archivos para empaquetar.");
  if (entries.length > 65535) throw new Error("La selección supera el límite del formato ZIP.");

  const encoder = new TextEncoder();
  const prepared: PreparedEntry[] = [];
  let offset = 0;

  // Se usa ZIP sin recompresión para evitar duplicar CPU y memoria con archivos que ya suelen venir comprimidos.
  for (const entry of uniqueNames(entries)) {
    if (entry.blob.size > ZIP32_LIMIT) throw new Error(`${entry.name} supera el límite de ZIP clásico.`);
    const encodedName = encoder.encode(entry.name);
    if (encodedName.length > 65535) throw new Error("Uno de los nombres de archivo es demasiado largo para ZIP.");
    const stamp = dosTimestamp(entry.modifiedAt ?? new Date());
    const preparedEntry: PreparedEntry = {
      ...entry,
      crc32: await crc32(entry.blob),
      encodedName,
      offset,
      dosDate: stamp.date,
      dosTime: stamp.time
    };
    const localSize = 30 + encodedName.length + entry.blob.size;
    if (offset + localSize > ZIP32_LIMIT) throw new Error("La selección es demasiado grande para un ZIP compatible con el navegador.");
    prepared.push(preparedEntry);
    offset += localSize;
  }

  const centralOffset = offset;
  const centralParts = prepared.map(centralHeader);
  const centralSize = centralParts.reduce((total, part) => total + part.byteLength, 0);
  if (centralOffset + centralSize > ZIP32_LIMIT) throw new Error("La selección es demasiado grande para un ZIP compatible con el navegador.");

  const parts: BlobPart[] = [];
  for (const entry of prepared) parts.push(localHeader(entry).buffer as ArrayBuffer, entry.blob);
  for (const part of centralParts) parts.push(part.buffer as ArrayBuffer);
  parts.push(endRecord(prepared.length, centralSize, centralOffset).buffer as ArrayBuffer);
  return new Blob(parts, { type: "application/zip" });
}
