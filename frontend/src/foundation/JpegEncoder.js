/**
 * ArchDisc Foundation — baseline (sequential) JPEG encoder.
 *
 * Encodes an RGBA pixel buffer to a JFIF/JPEG image with zero external
 * dependencies. 4:4:4 (no chroma subsampling) for simplicity and
 * correctness; standard Annex-K quantisation and Huffman tables.
 *
 * This is the per-frame codec for ArchDisc's in-platform Motion-JPEG
 * video export — no ffmpeg, no native libraries.
 *
 * Reference: ITU-T T.81 (the JPEG standard), Annex K.
 */

import { Buffer } from 'node:buffer';

// ── Standard tables (ITU-T T.81 Annex K) ───────────────────────────

const STD_LUMA_QT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const STD_CHROMA_QT = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

const DC_LUMA_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_LUMA_VAL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const DC_CHROMA_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_CHROMA_VAL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_LUMA_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_LUMA_VAL = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];
const AC_CHROMA_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_CHROMA_VAL = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];

/** Build {symbol → [code, size]} from a BITS/HUFFVAL pair. */
function buildHuffTable(bits, huffval) {
  const sizes = [];
  for (let l = 1; l <= 16; l++) for (let i = 0; i < bits[l - 1]; i++) sizes.push(l);
  const codes = [];
  let code = 0, k = 0, si = sizes[0];
  while (k < sizes.length) {
    while (k < sizes.length && sizes[k] === si) { codes.push(code++); k++; }
    code <<= 1; si++;
  }
  const table = {};
  for (let i = 0; i < huffval.length; i++) table[huffval[i]] = [codes[i], sizes[i]];
  return table;
}

/** Scale a base quant table by a quality factor (1–100). */
function scaleQT(base, quality) {
  const q = Math.max(1, Math.min(100, quality));
  const s = q < 50 ? Math.floor(5000 / q) : 200 - 2 * q;
  return base.map((v) => Math.max(1, Math.min(255, Math.floor((v * s + 50) / 100))));
}

// Forward 8×8 DCT (direct, separable cosine basis).
const COS = (() => {
  const c = new Float64Array(64);
  for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) {
    c[u * 8 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  }
  return c;
})();
function fdct(block) {
  const tmp = new Float64Array(64);
  for (let y = 0; y < 8; y++) {            // rows
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let x = 0; x < 8; x++) s += block[y * 8 + x] * COS[u * 8 + x];
      tmp[y * 8 + u] = s * (u === 0 ? Math.SQRT1_2 : 1);
    }
  }
  const out = new Float64Array(64);
  for (let u = 0; u < 8; u++) {             // columns
    for (let v = 0; v < 8; v++) {
      let s = 0;
      for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * COS[v * 8 + y];
      out[v * 8 + u] = 0.25 * s * (v === 0 ? Math.SQRT1_2 : 1);
    }
  }
  return out;
}

/** Bit length of |n| (the JPEG coefficient "category"). */
function category(n) {
  n = Math.abs(n);
  let c = 0;
  while (n > 0) { c++; n >>= 1; }
  return c;
}

/**
 * Encode an RGBA buffer to a baseline JPEG.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba   length width*height*4
 * @param {number=} quality   1–100 (default 85)
 * @returns {Buffer}
 */
export function encodeJPEG(width, height, rgba, quality = 85) {
  const lumaQT = scaleQT(STD_LUMA_QT, quality);
  const chromaQT = scaleQT(STD_CHROMA_QT, quality);
  const dcLuma = buildHuffTable(DC_LUMA_BITS, DC_LUMA_VAL);
  const acLuma = buildHuffTable(AC_LUMA_BITS, AC_LUMA_VAL);
  const dcChroma = buildHuffTable(DC_CHROMA_BITS, DC_CHROMA_VAL);
  const acChroma = buildHuffTable(AC_CHROMA_BITS, AC_CHROMA_VAL);

  const out = [];
  const u8 = (v) => out.push(v & 0xff);
  const u16 = (v) => { out.push((v >> 8) & 0xff, v & 0xff); };
  const marker = (m) => { out.push(0xff, m); };

  // ── Headers ──
  marker(0xd8);                                              // SOI
  marker(0xe0); u16(16);                                     // APP0 / JFIF
  for (const ch of 'JFIF') u8(ch.charCodeAt(0)); u8(0);
  u8(1); u8(1); u8(0); u16(1); u16(1); u8(0); u8(0);
  // DQT — luma then chroma.
  marker(0xdb); u16(67); u8(0); for (let i = 0; i < 64; i++) u8(lumaQT[ZIGZAG[i]]);
  marker(0xdb); u16(67); u8(1); for (let i = 0; i < 64; i++) u8(chromaQT[ZIGZAG[i]]);
  // SOF0 — 3 components, 1×1 sampling each (4:4:4).
  marker(0xc0); u16(17); u8(8); u16(height); u16(width); u8(3);
  u8(1); u8(0x11); u8(0); u8(2); u8(0x11); u8(1); u8(3); u8(0x11); u8(1);
  // DHT — four tables.
  const writeDHT = (cls, id, bits, val) => {
    marker(0xc4); u16(19 + val.length); u8((cls << 4) | id);
    for (const b of bits) u8(b);
    for (const v of val) u8(v);
  };
  writeDHT(0, 0, DC_LUMA_BITS, DC_LUMA_VAL);
  writeDHT(1, 0, AC_LUMA_BITS, AC_LUMA_VAL);
  writeDHT(0, 1, DC_CHROMA_BITS, DC_CHROMA_VAL);
  writeDHT(1, 1, AC_CHROMA_BITS, AC_CHROMA_VAL);
  // SOS.
  marker(0xda); u16(12); u8(3);
  u8(1); u8(0x00); u8(2); u8(0x11); u8(3); u8(0x11);
  u8(0); u8(63); u8(0);

  // ── Entropy-coded scan ──
  let bitBuf = 0, bitCnt = 0;
  const putBits = (code, size) => {
    for (let i = size - 1; i >= 0; i--) {
      bitBuf = (bitBuf << 1) | ((code >> i) & 1);
      bitCnt++;
      if (bitCnt === 8) {
        out.push(bitBuf & 0xff);
        if ((bitBuf & 0xff) === 0xff) out.push(0x00);    // byte stuffing
        bitBuf = 0; bitCnt = 0;
      }
    }
  };
  // Coefficient value bits (JPEG signed representation).
  const valueBits = (v, size) => (v >= 0 ? v : v + (1 << size) - 1);

  const encodeBlock = (block, qt, dcTab, acTab, prevDC) => {
    const coef = fdct(block);
    const q = new Int32Array(64);
    for (let i = 0; i < 64; i++) {
      q[i] = Math.round(coef[i] / qt[i]);
    }
    // DC.
    const diff = q[0] - prevDC;
    const dcCat = category(diff);
    putBits(dcTab[dcCat][0], dcTab[dcCat][1]);
    if (dcCat > 0) putBits(valueBits(diff, dcCat), dcCat);
    // AC in zig-zag order.
    let run = 0;
    for (let i = 1; i < 64; i++) {
      const c = q[ZIGZAG[i]];
      if (c === 0) { run++; continue; }
      while (run > 15) { putBits(acTab[0xf0][0], acTab[0xf0][1]); run -= 16; }
      const sz = category(c);
      const sym = (run << 4) | sz;
      putBits(acTab[sym][0], acTab[sym][1]);
      putBits(valueBits(c, sz), sz);
      run = 0;
    }
    if (run > 0) putBits(acTab[0x00][0], acTab[0x00][1]);    // EOB
    return q[0];
  };

  // Sample a pixel with edge clamping → [R,G,B].
  const px = (x, y) => {
    const cx = Math.min(width - 1, Math.max(0, x));
    const cy = Math.min(height - 1, Math.max(0, y));
    const i = (cy * width + cx) * 4;
    return [rgba[i], rgba[i + 1], rgba[i + 2]];
  };

  const mcuX = Math.ceil(width / 8), mcuY = Math.ceil(height / 8);
  let prevY = 0, prevCb = 0, prevCr = 0;
  const yBlk = new Float64Array(64), cbBlk = new Float64Array(64), crBlk = new Float64Array(64);
  for (let my = 0; my < mcuY; my++) {
    for (let mx = 0; mx < mcuX; mx++) {
      for (let by = 0; by < 8; by++) {
        for (let bx = 0; bx < 8; bx++) {
          const [r, g, b] = px(mx * 8 + bx, my * 8 + by);
          const Y = 0.299 * r + 0.587 * g + 0.114 * b;
          const Cb = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
          const Cr = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
          const idx = by * 8 + bx;
          yBlk[idx] = Y - 128;
          cbBlk[idx] = Cb - 128;
          crBlk[idx] = Cr - 128;
        }
      }
      prevY = encodeBlock(yBlk, lumaQT, dcLuma, acLuma, prevY);
      prevCb = encodeBlock(cbBlk, chromaQT, dcChroma, acChroma, prevCb);
      prevCr = encodeBlock(crBlk, chromaQT, dcChroma, acChroma, prevCr);
    }
  }
  // Flush remaining bits (pad with 1s).
  if (bitCnt > 0) {
    while (bitCnt < 8) { bitBuf = (bitBuf << 1) | 1; bitCnt++; }
    out.push(bitBuf & 0xff);
    if ((bitBuf & 0xff) === 0xff) out.push(0x00);
  }
  marker(0xd9);                                              // EOI
  return Buffer.from(out);
}
