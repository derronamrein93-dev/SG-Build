/**
 * Generate the kiosk's Home Screen icons.
 *
 * Committed as a generator rather than as three PNGs of unknown provenance: the
 * mark is the one in assets/img/favicon.svg, and this is how it becomes the
 * raster sizes iOS 12 needs. `apple-touch-icon` has never supported SVG, and
 * iOS 12 predates the manifest's icon handling entirely.
 *
 * Fully opaque, because iOS composites a transparent touch icon onto black and
 * rounds the corners itself — a pre-rounded transparent icon gets rounded twice.
 *
 *   node scripts/make-icons.mjs
 */
import { deflateSync } from 'zlib';
import { writeFileSync } from 'fs';

const BG = [0x0e, 0x12, 0x14];
const GREEN = [0x1f, 0x9c, 0x86];
const GREEN_DIM = [0x24, 0xc9, 0x5a];

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // colour type 2 = truecolour, no alpha
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const p = pixels[y * size + x];
      raw[row + 1 + x * 3] = p[0];
      raw[row + 2 + x * 3] = p[1];
      raw[row + 3 + x * 3] = p[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Cubic bezier point. */
function bezier(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

/**
 * The mark, in the favicon's own 32-unit coordinate space, stamped as discs
 * along each path so the stroke has round caps without a path rasteriser.
 */
function render(size) {
  const px = new Array(size * size);
  for (let i = 0; i < px.length; i++) px[i] = BG;
  const k = size / 32;

  const stamp = (cx, cy, r, colour) => {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(size - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(size - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) px[y * size + x] = colour;
      }
    }
  };

  const stroke = (pts, r, colour) => {
    for (let t = 0; t <= 1.0001; t += 0.002) {
      const [x, y] = pts(t);
      stamp(x * k, y * k, r * k, colour);
    }
  };

  // M9 22.5 c3.4 0 5-2.2 5.6-4.6  — the first half of the stride curve
  stroke((t) => bezier(t, [9, 22.5], [12.4, 22.5], [14, 20.3], [14.6, 17.9]), 1.3, GREEN);
  // .7-2.7 2.3-4.4 5.4-4.4        — and the second, rising away
  stroke((t) => bezier(t, [14.6, 17.9], [15.3, 15.2], [16.9, 13.5], [20, 13.5]), 1.3, GREEN);
  // M12 9.5 h8 — the bar above it
  stroke((t) => [12 + t * 8, 9.5], 1.3, GREEN_DIM);
  // the trailing dot
  stamp(23.5 * k, 22.5 * k, 1.9 * k, GREEN);

  return png(size, px);
}

for (const size of [180, 192, 512]) {
  const file = `public/kiosk/icon-${size}.png`;
  writeFileSync(file, render(size));
  console.log('wrote', file);
}
