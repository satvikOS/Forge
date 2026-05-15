/**
 * ArchDisc Foundation — Vendor Package bundler.
 *
 * Collects the hand-off artifacts a customer would normally email
 * to a CNC vendor — A3 drawing, G-code (if any), cost CSV+JSON,
 * DFM JSON, optional cert MD — and bundles them into a single
 * ZIP archive. Tiny stored-only ZIP builder so no new runtime
 * dependencies.
 *
 * Output shape:
 *   { zipBytes: Uint8Array, manifest: {...}, fileNames: [...] }
 *
 * The manifest itself is one of the files in the ZIP, so a vendor
 * has self-describing metadata about the part (mass, volume,
 * material, generated-at timestamp) without opening every file.
 */

import { buildDrawingSVG } from './Drawing2D.js';
import { checkManifoldDFM } from './DFMCheck.js';
import { rollupAssemblyCost } from './AssemblyCost.js';
import { profileToCostOpts } from './VendorProfiles.js';

/**
 * Build a vendor package from whatever is currently in scope.
 *
 * @param {object} args
 * @param {object[]} args.bodies           BodyRegistry list (must have manifold)
 * @param {string=}  args.gcode             optional CAM program
 * @param {string=}  args.gcodeSource       "3-Axis Milling" etc.
 * @param {string=}  args.certMarkdown      optional cert matrix MD
 * @param {object=}  args.certJson          optional cert matrix payload
 * @param {string=}  args.partName
 * @param {string=}  args.material
 * @param {Array=}   args.drawingPdfs   [{name, bytes}] pre-rasterised
 *                                      PDF drawings (browser-side only —
 *                                      the foundation can't rasterise SVG)
 * @returns {{ zipBytes: Uint8Array, manifest: object, fileNames: string[] }}
 */
export function buildVendorPackage(args) {
  const bodies = args.bodies ?? [];
  if (bodies.length === 0) {
    throw new Error('Vendor package needs at least one body in scope.');
  }
  const profile = args.profile ?? null;
  const partName = args.partName ?? 'ArchDisc Part';
  const material = args.material ?? profile?.materialDefault ?? 'Aluminum 6061-T6';
  const stamp = new Date().toISOString().slice(0, 10);

  const entries = [];

  // 1. Drawing SVG (per body)
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (!b.manifold) continue;
    const svg = buildDrawingSVG(b.manifold, { name: b.name ?? `${partName} #${i + 1}`, material });
    entries.push({
      name: `drawings/${slug(b.name ?? `body-${i + 1}`)}.svg`,
      data: textBytes(svg),
    });
  }

  // 1b. Pre-rasterised PDF drawings (caller supplies these — the
  //     foundation can't rasterise SVG without a browser canvas).
  for (const pdf of args.drawingPdfs ?? []) {
    if (!pdf || !pdf.bytes) continue;
    entries.push({
      name: `drawings/${slug(pdf.name ?? 'drawing')}.pdf`,
      data: pdf.bytes instanceof Uint8Array ? pdf.bytes : new Uint8Array(pdf.bytes),
    });
  }

  // 2. G-code if available
  if (args.gcode) {
    entries.push({
      name: `cam/${slug(args.gcodeSource ?? 'program')}.nc`,
      data: textBytes(args.gcode),
    });
  }

  // 3. Cost rollup — uses the profile's rate card if provided.
  const cost = rollupAssemblyCost(bodies, profile ? profileToCostOpts(profile) : undefined);
  entries.push({
    name: 'cost/cost.json',
    data: textBytes(JSON.stringify({ generatedAt: new Date().toISOString(), ...cost }, null, 2)),
  });
  entries.push({
    name: 'cost/cost.csv',
    data: textBytes(costToCSV(cost)),
  });

  // 4. DFM per body
  const dfmReports = bodies.map(b => {
    if (!b.manifold) return null;
    try { return { bodyId: b.id, name: b.name, ...checkManifoldDFM(b.manifold) }; }
    catch (err) { return { bodyId: b.id, name: b.name, error: err.message }; }
  }).filter(Boolean);
  entries.push({
    name: 'dfm/dfm.json',
    data: textBytes(JSON.stringify({ generatedAt: new Date().toISOString(), reports: dfmReports }, null, 2)),
  });

  // 5. Cert matrix passthrough
  if (args.certMarkdown) {
    entries.push({ name: 'cert/cert-matrix.md', data: textBytes(args.certMarkdown) });
  }
  if (args.certJson) {
    entries.push({
      name: 'cert/cert-matrix.json',
      data: textBytes(JSON.stringify(args.certJson, null, 2)),
    });
  }

  // 6. Self-describing manifest
  const manifest = {
    package: 'ArchDisc Vendor Package',
    schema: 'archdisc-vendor-1.0',
    generatedAt: new Date().toISOString(),
    partName, material, stamp,
    bodyCount: bodies.length,
    totals: cost.totals,
    vendor: profile ? {
      id: profile.id, name: profile.name, location: profile.location,
      currency: profile.currency, leadTimeDays: profile.leadTimeDays,
      rates: profileToCostOpts(profile),
    } : null,
    files: entries.map(e => ({ name: e.name, bytes: e.data.length })),
  };
  // Insert manifest at the top so unzippers list it first.
  entries.unshift({
    name: 'manifest.json',
    data: textBytes(JSON.stringify(manifest, null, 2)),
  });
  manifest.files = entries.map(e => ({ name: e.name, bytes: e.data.length }));

  const zipBytes = buildZip(entries);
  return { zipBytes, manifest, fileNames: entries.map(e => e.name) };
}

// ─── Stored-only ZIP builder ────────────────────────────────────

function buildZip(entries) {
  // Compute total local-record + central-record sizes.
  const localChunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = textBytes(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;
    const localHeader = makeLocalHeader(nameBytes, crc, size);
    localChunks.push(localHeader, nameBytes, e.data);
    central.push({ nameBytes, crc, size, offset });
    offset += localHeader.length + nameBytes.length + size;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) {
    const cdh = makeCentralDirHeader(c.nameBytes, c.crc, c.size, c.offset);
    localChunks.push(cdh, c.nameBytes);
    centralSize += cdh.length + c.nameBytes.length;
  }
  const eocd = makeEOCD(entries.length, centralSize, centralStart);
  localChunks.push(eocd);
  return concatChunks(localChunks);
}

function makeLocalHeader(nameBytes, crc, size) {
  const buf = new Uint8Array(30);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 0x04034b50, true);   // signature
  dv.setUint16(4, 20, true);            // version needed
  dv.setUint16(6, 0, true);             // flags
  dv.setUint16(8, 0, true);             // compression = stored
  dv.setUint16(10, 0, true);            // mod time
  dv.setUint16(12, 0, true);            // mod date
  dv.setUint32(14, crc, true);
  dv.setUint32(18, size, true);         // compressed size = uncompressed (stored)
  dv.setUint32(22, size, true);
  dv.setUint16(26, nameBytes.length, true);
  dv.setUint16(28, 0, true);            // extra field length
  return buf;
}

function makeCentralDirHeader(nameBytes, crc, size, offset) {
  const buf = new Uint8Array(46);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 0x02014b50, true);
  dv.setUint16(4, 20, true);            // version made by
  dv.setUint16(6, 20, true);            // version needed
  dv.setUint16(8, 0, true);
  dv.setUint16(10, 0, true);
  dv.setUint16(12, 0, true);
  dv.setUint16(14, 0, true);
  dv.setUint32(16, crc, true);
  dv.setUint32(20, size, true);
  dv.setUint32(24, size, true);
  dv.setUint16(28, nameBytes.length, true);
  dv.setUint16(30, 0, true);
  dv.setUint16(32, 0, true);
  dv.setUint16(34, 0, true);
  dv.setUint16(36, 0, true);
  dv.setUint32(38, 0, true);
  dv.setUint32(42, offset, true);
  return buf;
}

function makeEOCD(entryCount, centralSize, centralStart) {
  const buf = new Uint8Array(22);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(4, 0, true);
  dv.setUint16(6, 0, true);
  dv.setUint16(8, entryCount, true);
  dv.setUint16(10, entryCount, true);
  dv.setUint32(12, centralSize, true);
  dv.setUint32(16, centralStart, true);
  dv.setUint16(20, 0, true);
  return buf;
}

function concatChunks(chunks) {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// CRC-32 with on-demand table.
let _crcTable = null;
function crc32(bytes) {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      _crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (_crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─── Helpers ────────────────────────────────────────────────────

function textBytes(str) {
  return new TextEncoder().encode(str);
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'part';
}

function costToCSV(cost) {
  const rows = [
    ['Part', 'Mass (g)', 'Material ($)', 'CNC ($)', 'Setup ($)', 'Finish ($)', 'Subtotal ($)'],
    ...cost.lineItems.map(l => [
      l.name, (l.mass_kg * 1000).toFixed(2),
      l.materialCost.toFixed(2), l.cncCost.toFixed(2),
      l.setupCost.toFixed(2), l.finishCost.toFixed(2),
      l.subtotal.toFixed(2),
    ]),
    ['TOTAL', (cost.totals.mass_kg * 1000).toFixed(2),
     cost.totals.materialCost.toFixed(2), cost.totals.cncCost.toFixed(2),
     cost.totals.setupCost.toFixed(2), cost.totals.finishCost.toFixed(2),
     cost.totals.totalCost.toFixed(2)],
    [`Sell @${cost.totals.marginPct.toFixed(0)}% margin`, '', '', '', '', '',
     cost.totals.sellPrice.toFixed(2)],
  ];
  return rows.map(r => r.join(',')).join('\n');
}
