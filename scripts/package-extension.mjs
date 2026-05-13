import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const outFile = resolve(root, "releases", `dominion-navigator-${manifest.version}.zip`);

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) return collectFiles(absolute);
      if (!entry.isFile()) return [];
      return [absolute];
    })
  );
  return files.flat().sort((a, b) => a.localeCompare(b));
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function uint16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

const fileRecords = [];
const centralRecords = [];
let offset = 0;
const now = dosDateTime();

for (const absolute of await collectFiles(dist)) {
  const name = relative(dist, absolute).replaceAll("\\", "/");
  const nameBuffer = Buffer.from(name, "utf8");
  const source = await readFile(absolute);
  const compressed = deflateRawSync(source, { level: 9 });
  const checksum = crc32(source);

  const localHeader = Buffer.concat([
    uint32(0x04034b50),
    uint16(20),
    uint16(0x0800),
    uint16(8),
    uint16(now.dosTime),
    uint16(now.dosDate),
    uint32(checksum),
    uint32(compressed.length),
    uint32(source.length),
    uint16(nameBuffer.length),
    uint16(0),
    nameBuffer
  ]);

  fileRecords.push(localHeader, compressed);

  centralRecords.push(
    Buffer.concat([
      uint32(0x02014b50),
      uint16(20),
      uint16(20),
      uint16(0x0800),
      uint16(8),
      uint16(now.dosTime),
      uint16(now.dosDate),
      uint32(checksum),
      uint32(compressed.length),
      uint32(source.length),
      uint16(nameBuffer.length),
      uint16(0),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(0),
      uint32(offset),
      nameBuffer
    ])
  );

  offset += localHeader.length + compressed.length;
}

const centralDirectory = Buffer.concat(centralRecords);
const end = Buffer.concat([
  uint32(0x06054b50),
  uint16(0),
  uint16(0),
  uint16(centralRecords.length),
  uint16(centralRecords.length),
  uint32(centralDirectory.length),
  uint32(offset),
  uint16(0)
]);

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, Buffer.concat([...fileRecords, centralDirectory, end]));
console.log(relative(root, outFile));
