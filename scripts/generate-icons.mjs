import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "icons");
const sizes = [16, 32, 48, 128];

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function pngFromRgba(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const stride = width * 4;
  const scanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    scanlines[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      scanlines,
      y * (stride + 1) + 1
    );
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function hex(value) {
  const normalized = value.replace("#", "");
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
    normalized.length === 8 ? Number.parseInt(normalized.slice(6, 8), 16) : 255
  ];
}

function mix(a, b, t) {
  return a.map((channel, index) => Math.round(channel + (b[index] - channel) * t));
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

function draw(size) {
  const scale = size / 128;
  const samples = size >= 64 ? 3 : 4;
  const rgba = new Uint8ClampedArray(size * size * 4);
  const center = 64;
  const palette = {
    transparent: [0, 0, 0, 0],
    navy: hex("#17283c"),
    teal: hex("#1e7280"),
    parchment: hex("#f2dfb2"),
    gold: hex("#d8a43d"),
    red: hex("#b34036"),
    ink: hex("#1f2933"),
    light: hex("#fff4d6")
  };

  const needleNorth = [
    [64, 18],
    [78, 68],
    [64, 59],
    [50, 68]
  ];
  const needleSouth = [
    [64, 110],
    [78, 68],
    [64, 77],
    [50, 68]
  ];

  function colorAt(x, y) {
    const dx = x - center;
    const dy = y - center;
    const radius = Math.hypot(dx, dy);
    if (radius > 60) return palette.transparent;

    const shadowAlpha = radius > 55 ? 190 * smoothstep(60, 55, radius) : 0;
    if (radius > 56) return [9, 18, 28, shadowAlpha];

    let color = mix(palette.teal, palette.navy, smoothstep(0, 56, radius));
    const ring = Math.abs(radius - 45);
    const innerRing = Math.abs(radius - 30);
    if (ring < 4.2) color = mix(palette.gold, palette.light, smoothstep(4.2, 0, ring));
    if (innerRing < 1.7) color = palette.gold;

    const cardTiltX = (x - 64) * 0.88 + (y - 64) * 0.22;
    const cardTiltY = (y - 64) * 0.88 - (x - 64) * 0.22;
    if (Math.abs(cardTiltX) < 24 && Math.abs(cardTiltY) < 31 && radius < 42) {
      color = mix(palette.parchment, palette.light, smoothstep(-31, 31, cardTiltY));
      if (Math.abs(cardTiltX) > 21 || Math.abs(cardTiltY) > 28) color = palette.gold;
    }

    const tickAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    for (const angle of tickAngles) {
      const ax = 64 + Math.cos(angle) * 36;
      const ay = 64 + Math.sin(angle) * 36;
      const bx = 64 + Math.cos(angle) * 51;
      const by = 64 + Math.sin(angle) * 51;
      if (distanceToSegment(x, y, ax, ay, bx, by) < 1.7) color = palette.light;
    }

    if (pointInPolygon(x, y, needleSouth)) color = mix(palette.ink, palette.navy, 0.15);
    if (pointInPolygon(x, y, needleNorth)) color = palette.red;
    if (Math.hypot(x - 64, y - 68) < 6.2) color = palette.gold;
    if (Math.hypot(x - 64, y - 68) < 2.8) color = palette.ink;

    return color;
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const total = [0, 0, 0, 0];
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const sourceX = ((x + (sx + 0.5) / samples) / scale);
          const sourceY = ((y + (sy + 0.5) / samples) / scale);
          const color = colorAt(sourceX, sourceY);
          for (let channel = 0; channel < 4; channel += 1) total[channel] += color[channel];
        }
      }
      const offset = (y * size + x) * 4;
      const denominator = samples * samples;
      for (let channel = 0; channel < 4; channel += 1) rgba[offset + channel] = Math.round(total[channel] / denominator);
    }
  }

  return pngFromRgba(size, size, rgba);
}

await mkdir(outDir, { recursive: true });
for (const size of sizes) {
  await writeFile(resolve(outDir, `icon-${size}.png`), draw(size));
}
