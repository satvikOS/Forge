/**
 * ArchDisc Foundation — in-platform Motion-JPEG video muxers.
 *
 * Wraps a sequence of JPEG frames (from JpegEncoder) into playable
 * video containers with zero external tools:
 *   encodeAVI — RIFF/AVI with an MJPG stream (robust, widely playable)
 *   encodeMP4 — ISO-BMFF with a 'jpeg' (Motion-JPEG) track
 *
 * Honest scope: real H.264 needs an encoder that cannot be hand-written
 * here, so this is Motion-JPEG. The .avi plays widely; the .mp4 plays
 * in VLC / QuickTime but not every player. extractFrames() reads frames
 * back so a test can verify the container round-trips.
 */

import { Buffer } from 'node:buffer';
import { encodeJPEG } from './JpegEncoder.js';

const fourCC = (s) => Buffer.from(s, 'ascii');
const u32le = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; };
const u16le = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff, 0); return b; };
const u32be = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0, 0); return b; };
const u16be = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v & 0xffff, 0); return b; };
const pad2 = (b) => (b.length % 2 ? Buffer.concat([b, Buffer.alloc(1)]) : b);

/** RIFF/LIST chunk: fourcc + LE size + data (padded to even). */
function riffChunk(id, data) {
  return Buffer.concat([fourCC(id), u32le(data.length), pad2(data)]);
}

/**
 * Mux JPEG frames into an AVI (RIFF) container with an MJPG video stream.
 * @param {Buffer[]} frames  one JPEG per frame
 * @param {object} opts      { fps, width, height }
 * @returns {Buffer}
 */
export function encodeAVI(frames, opts = {}) {
  const fps = opts.fps ?? 24;
  const w = opts.width ?? 640, h = opts.height ?? 480;
  const n = frames.length;
  const usPerFrame = Math.round(1e6 / fps);

  // movi list — one '00dc' chunk per frame; record index offsets.
  const moviParts = [fourCC('movi')];
  const index = [];
  let off = 4;                                  // first chunk sits at +4 inside movi
  for (const f of frames) {
    const chunk = riffChunk('00dc', f);
    index.push({ offset: off, size: f.length });
    moviParts.push(chunk);
    off += chunk.length;
  }
  const moviData = Buffer.concat(moviParts);
  const moviList = riffChunk('LIST', moviData);

  // idx1.
  const idx1Data = Buffer.concat(index.map((e) =>
    Buffer.concat([fourCC('00dc'), u32le(0x10), u32le(e.offset), u32le(e.size)])));
  const idx1 = riffChunk('idx1', idx1Data);

  // avih — main AVI header (14 dwords).
  const avih = riffChunk('avih', Buffer.concat([
    u32le(usPerFrame), u32le(0), u32le(0), u32le(0x10),       // flags = AVIF_HASINDEX
    u32le(n), u32le(0), u32le(1), u32le(0),
    u32le(w), u32le(h), u32le(0), u32le(0), u32le(0), u32le(0),
  ]));
  // strh — stream header.
  const strh = riffChunk('strh', Buffer.concat([
    fourCC('vids'), fourCC('MJPG'), u32le(0), u16le(0), u16le(0),
    u32le(0), u32le(1), u32le(fps), u32le(0), u32le(n), u32le(0), u32le(0), u32le(0),
    u16le(0), u16le(0), u16le(w), u16le(h),
  ]));
  // strf — BITMAPINFOHEADER.
  const strf = riffChunk('strf', Buffer.concat([
    u32le(40), u32le(w), u32le(h), u16le(1), u16le(24),
    fourCC('MJPG'), u32le(w * h * 3), u32le(0), u32le(0), u32le(0), u32le(0),
  ]));
  const strl = riffChunk('LIST', Buffer.concat([fourCC('strl'), strh, strf]));
  const hdrl = riffChunk('LIST', Buffer.concat([fourCC('hdrl'), avih, strl]));

  const body = Buffer.concat([fourCC('AVI '), hdrl, moviList, idx1]);
  return Buffer.concat([fourCC('RIFF'), u32le(body.length), body]);
}

/** ISO-BMFF box: big-endian size + type + payload. */
function box(type, payload) {
  return Buffer.concat([u32be(8 + payload.length), fourCC(type), payload]);
}
const fullBox = (type, version, flags, payload) =>
  box(type, Buffer.concat([Buffer.from([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), payload]));

/**
 * Mux JPEG frames into an ISO-BMFF (.mp4) container with a Motion-JPEG
 * ('jpeg') video track.
 * @param {Buffer[]} frames
 * @param {object} opts  { fps, width, height }
 * @returns {Buffer}
 */
export function encodeMP4(frames, opts = {}) {
  const fps = opts.fps ?? 24;
  const w = opts.width ?? 640, h = opts.height ?? 480;
  const n = frames.length;
  const timescale = fps;
  const duration = n;                            // n frames, 1 tick each

  // mdat — all JPEG samples concatenated; record sizes + offsets.
  const mdatPayload = Buffer.concat(frames);
  const mdat = box('mdat', mdatPayload);
  const mdatDataStart = 8;                       // sample data starts after the box header

  const ftyp = box('ftyp', Buffer.concat([
    fourCC('isom'), u32be(0x200), fourCC('isom'), fourCC('mp41'), fourCC('avc1'),
  ]));

  // ── sample tables ──
  const stts = fullBox('stts', 0, 0, Buffer.concat([u32be(1), u32be(n), u32be(1)]));
  const stsz = fullBox('stsz', 0, 0, Buffer.concat([
    u32be(0), u32be(n), ...frames.map((f) => u32be(f.length)),
  ]));
  const stsc = fullBox('stsc', 0, 0, Buffer.concat([u32be(1), u32be(1), u32be(1), u32be(1)]));
  // chunk offsets — one chunk per sample (filled after layout is known).
  const stssEntries = frames.map((_, i) => u32be(i + 1));
  const stss = fullBox('stss', 0, 0, Buffer.concat([u32be(n), ...stssEntries]));

  // 'jpeg' visual sample entry.
  const compressorName = Buffer.alloc(32);
  compressorName.write('Motion JPEG', 1, 'ascii'); compressorName[0] = 11;
  const sampleEntry = box('jpeg', Buffer.concat([
    Buffer.alloc(6), u16be(1),                   // reserved + data-reference-index
    u16be(0), u16be(0), Buffer.alloc(12),        // predefined / reserved
    u16be(w), u16be(h),
    u32be(0x00480000), u32be(0x00480000),        // 72 dpi
    u32be(0), u16be(1),                          // reserved + frame count
    compressorName, u16be(24), u16be(0xffff),    // depth + predefined
  ]));
  const stsd = fullBox('stsd', 0, 0, Buffer.concat([u32be(1), sampleEntry]));

  // stco placeholder — patched once total header size is known.
  const buildStco = (firstSampleOffset) => {
    let o = firstSampleOffset;
    const offs = [];
    for (const f of frames) { offs.push(u32be(o)); o += f.length; }
    return fullBox('stco', 0, 0, Buffer.concat([u32be(n), ...offs]));
  };

  const assemble = (stco) => {
    const stbl = box('stbl', Buffer.concat([stsd, stts, stsc, stsz, stco, stss]));
    const vmhd = fullBox('vmhd', 0, 1, Buffer.concat([u16be(0), Buffer.alloc(6)]));
    const dref = fullBox('dref', 0, 0, Buffer.concat([u32be(1), fullBox('url ', 0, 1, Buffer.alloc(0))]));
    const dinf = box('dinf', dref);
    const minf = box('minf', Buffer.concat([vmhd, dinf, stbl]));
    const hdlr = fullBox('hdlr', 0, 0, Buffer.concat([
      u32be(0), fourCC('vide'), Buffer.alloc(12), Buffer.from('ArchDisc\0', 'ascii'),
    ]));
    const mdhd = fullBox('mdhd', 0, 0, Buffer.concat([
      u32be(0), u32be(0), u32be(timescale), u32be(duration), u16be(0x55c4), u16be(0),
    ]));
    const mdia = box('mdia', Buffer.concat([mdhd, hdlr, minf]));
    const tkhd = fullBox('tkhd', 0, 7, Buffer.concat([
      u32be(0), u32be(0), u32be(1), u32be(0), u32be(duration),
      Buffer.alloc(8), u16be(0), u16be(0), u16be(0), u16be(0),
      // unity matrix
      u32be(0x00010000), u32be(0), u32be(0), u32be(0), u32be(0x00010000), u32be(0),
      u32be(0), u32be(0), u32be(0x40000000),
      u32be(w << 16), u32be(h << 16),
    ]));
    const trak = box('trak', Buffer.concat([tkhd, mdia]));
    const mvhd = fullBox('mvhd', 0, 0, Buffer.concat([
      u32be(0), u32be(0), u32be(timescale), u32be(duration),
      u32be(0x00010000), u16be(0x0100), u16be(0), u32be(0), u32be(0),
      u32be(0x00010000), u32be(0), u32be(0), u32be(0), u32be(0x00010000), u32be(0),
      u32be(0), u32be(0), u32be(0x40000000),
      Buffer.alloc(24), u32be(2),
    ]));
    return box('moov', Buffer.concat([mvhd, trak]));
  };

  // Two-pass: build moov with a guessed stco, then re-place mdat after
  // moov and patch the real sample offsets.
  let moov = assemble(buildStco(0));
  const firstSampleOffset = ftyp.length + moov.length + mdatDataStart;
  moov = assemble(buildStco(firstSampleOffset));
  // moov size is stable (stco entry count unchanged) → offsets are exact.
  return Buffer.concat([ftyp, moov, mdat]);
}

/**
 * General sim→video pipeline: JPEG-encode a sequence of RGBA frames and
 * mux them into both an .avi and an .mp4. This is the reusable capability
 * — any simulation that produces RGBA frames becomes a video.
 *
 * @param {Uint8Array[]} rgbaFrames  each width*height*4 bytes
 * @param {number} width, height
 * @param {object=} opts  { fps, quality }
 * @returns {{ avi:Buffer, mp4:Buffer, frameCount, jpegBytes }}
 */
export function framesToVideo(rgbaFrames, width, height, opts = {}) {
  const fps = opts.fps ?? 24;
  const quality = opts.quality ?? 85;
  const jpegs = rgbaFrames.map((rgba) => encodeJPEG(width, height, rgba, quality));
  return {
    avi: encodeAVI(jpegs, { fps, width, height }),
    mp4: encodeMP4(jpegs, { fps, width, height }),
    frameCount: jpegs.length,
    jpegBytes: jpegs.reduce((a, j) => a + j.length, 0),
  };
}

/**
 * Read JPEG frames back out of an AVI or MP4 produced above — lets a
 * test confirm the container round-trips.
 * @returns {Buffer[]}
 */
export function extractFrames(buf) {
  const frames = [];
  // Every JPEG starts FFD8 and ends FFD9 — scan for them.
  let i = 0;
  while (i < buf.length - 1) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8) {
      let j = i + 2;
      while (j < buf.length - 1 && !(buf[j] === 0xff && buf[j + 1] === 0xd9)) j++;
      if (j < buf.length - 1) {
        frames.push(buf.subarray(i, j + 2));
        i = j + 2;
        continue;
      }
    }
    i++;
  }
  return frames;
}
