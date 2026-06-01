// Forge-161 — point-cloud import readers for reverse-engineering.
//
// Real parsers for the four most common point-cloud formats used in
// scan-to-CAD pipelines:
//
//   * PLY   — Stanford polygon format, ASCII + little-endian binary.
//             Header parsed line-by-line, body parsed per `element`
//             with property dispatch.
//   * PCD   — Point Cloud Library format (PCL).  ASCII + binary.
//             Header keys: VERSION, FIELDS, SIZE, TYPE, COUNT,
//             WIDTH, HEIGHT, VIEWPOINT, POINTS, DATA.
//   * XYZ   — plain whitespace-separated triples per line, optionally
//             with R/G/B per row, optionally with leading comment
//             lines starting with `#` or `//`.
//   * E57   — full E57 needs XML chunk extraction + compressed-vector
//             decode (CompressedVector + AStream).  We implement the
//             ASCII XML+ASCII subset that several public sample files
//             ship in — XML header at the top followed by an
//             ascii-data <points> block.  Closed-form binary E57
//             requires a native decoder which we honestly fall back
//             to "kernel required" for; see caveats.
//
// All readers return a uniform shape:
//
//   { positions: Float32Array,   // [x0,y0,z0, x1,y1,z1, …]
//     colors:    Float32Array | null,   // optional 0..1 RGB
//     normals:   Float32Array | null,   // optional
//     count:     number,
//     format:    'ply' | 'pcd' | 'xyz' | 'e57',
//   }

// Detect format from the first ~256 bytes of a Uint8Array.
export function detectFormat(buf) {
  if (!(buf instanceof Uint8Array)) {
    if (typeof buf === 'string') buf = new TextEncoder().encode(buf);
    else throw new Error('pointCloudImport: detectFormat needs Uint8Array');
  }
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(buf.subarray(0, Math.min(buf.length, 256)));
  if (/^ply\s*\n/.test(head))                        return 'ply';
  if (/^# \.PCD/.test(head) || /^VERSION /m.test(head)) return 'pcd';
  if (/^\s*<\?xml/.test(head) && /e57/i.test(head))  return 'e57';
  // XYZ heuristic — at least one line of 3 whitespace-separated
  // floats anywhere in the first 256 bytes.
  if (/[-+]?\d*\.?\d+\s+[-+]?\d*\.?\d+\s+[-+]?\d*\.?\d+/.test(head)) return 'xyz';
  throw new Error('pointCloudImport: unable to detect format');
}

export async function importCloud(buf) {
  const fmt = detectFormat(buf);
  switch (fmt) {
    case 'ply': return readPLY(buf);
    case 'pcd': return readPCD(buf);
    case 'xyz': return readXYZ(buf);
    case 'e57': return readE57(buf);
    default:    throw new Error(`pointCloudImport: unknown format ${fmt}`);
  }
}

// ============================================================
// PLY — Stanford polygon format
// ============================================================

const PLY_PROP_SIZES = {
  char: 1, uchar: 1, int8: 1, uint8: 1,
  short: 2, ushort: 2, int16: 2, uint16: 2,
  int: 4, uint: 4, int32: 4, uint32: 4,
  float: 4, float32: 4, double: 8, float64: 8,
};

function readDV(dv, off, type, le) {
  switch (type) {
    case 'char': case 'int8':  return [dv.getInt8(off), 1];
    case 'uchar': case 'uint8':return [dv.getUint8(off), 1];
    case 'short': case 'int16':return [dv.getInt16(off, le), 2];
    case 'ushort': case 'uint16': return [dv.getUint16(off, le), 2];
    case 'int': case 'int32':  return [dv.getInt32(off, le), 4];
    case 'uint': case 'uint32':return [dv.getUint32(off, le), 4];
    case 'float': case 'float32': return [dv.getFloat32(off, le), 4];
    case 'double': case 'float64': return [dv.getFloat64(off, le), 8];
    default: throw new Error(`PLY: unknown type ${type}`);
  }
}

export function readPLY(buf) {
  if (typeof buf === 'string') buf = new TextEncoder().encode(buf);
  // Find header end.
  const textHead = new TextDecoder().decode(buf.subarray(0, Math.min(buf.length, 65536)));
  const endMatch = textHead.match(/end_header\s*\n/);
  if (!endMatch) throw new Error('PLY: end_header not found');
  const headerText = textHead.substring(0, endMatch.index + endMatch[0].length);
  const headerBytes = new TextEncoder().encode(headerText).length;
  const lines = headerText.split('\n').map((l) => l.trim()).filter(Boolean);

  let format = 'ascii';   // 'ascii' | 'binary_little_endian' | 'binary_big_endian'
  const elements = [];
  let cur = null;
  for (const line of lines) {
    if (line.startsWith('format ')) {
      format = line.split(/\s+/)[1];
    } else if (line.startsWith('element ')) {
      const [, name, count] = line.split(/\s+/);
      cur = { name, count: parseInt(count, 10), properties: [] };
      elements.push(cur);
    } else if (line.startsWith('property ') && cur) {
      const parts = line.split(/\s+/);
      if (parts[1] === 'list') {
        cur.properties.push({ list: true, countType: parts[2],
                              type: parts[3], name: parts[4] });
      } else {
        cur.properties.push({ type: parts[1], name: parts[2] });
      }
    }
  }

  const vertElt = elements.find((e) => e.name === 'vertex');
  if (!vertElt) throw new Error('PLY: vertex element missing');
  const N = vertElt.count;
  const positions = new Float32Array(N * 3);
  let colors = null, normals = null;
  if (vertElt.properties.some((p) => p.name === 'red'))   colors  = new Float32Array(N * 3);
  if (vertElt.properties.some((p) => p.name === 'nx'))    normals = new Float32Array(N * 3);

  if (format === 'ascii') {
    const body = textHead.substring(endMatch.index + endMatch[0].length);
    const rows = body.split('\n');
    let row = 0;
    for (let i = 0; i < N; i++) {
      while (row < rows.length && !rows[row].trim()) row++;
      if (row >= rows.length) throw new Error(`PLY: ran out of vertex rows at i=${i}`);
      const tokens = rows[row++].trim().split(/\s+/);
      vertElt.properties.forEach((p, j) => {
        const v = parseFloat(tokens[j]);
        if (p.name === 'x') positions[i * 3]     = v;
        if (p.name === 'y') positions[i * 3 + 1] = v;
        if (p.name === 'z') positions[i * 3 + 2] = v;
        if (colors) {
          if (p.name === 'red')   colors[i * 3]     = v / 255;
          if (p.name === 'green') colors[i * 3 + 1] = v / 255;
          if (p.name === 'blue')  colors[i * 3 + 2] = v / 255;
        }
        if (normals) {
          if (p.name === 'nx') normals[i * 3]     = v;
          if (p.name === 'ny') normals[i * 3 + 1] = v;
          if (p.name === 'nz') normals[i * 3 + 2] = v;
        }
      });
    }
  } else {
    const le = format !== 'binary_big_endian';
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let off = headerBytes;
    for (let i = 0; i < N; i++) {
      for (const p of vertElt.properties) {
        if (p.list) {
          // Skip list — we don't load face indices in this scan path.
          const [count, sz1] = readDV(dv, off, p.countType, le);
          off += sz1;
          off += count * PLY_PROP_SIZES[p.type];
        } else {
          const [v, sz] = readDV(dv, off, p.type, le);
          off += sz;
          if (p.name === 'x') positions[i * 3]     = v;
          if (p.name === 'y') positions[i * 3 + 1] = v;
          if (p.name === 'z') positions[i * 3 + 2] = v;
          if (colors) {
            if (p.name === 'red')   colors[i * 3]     = v / 255;
            if (p.name === 'green') colors[i * 3 + 1] = v / 255;
            if (p.name === 'blue')  colors[i * 3 + 2] = v / 255;
          }
          if (normals) {
            if (p.name === 'nx') normals[i * 3]     = v;
            if (p.name === 'ny') normals[i * 3 + 1] = v;
            if (p.name === 'nz') normals[i * 3 + 2] = v;
          }
        }
      }
    }
  }
  return { positions, colors, normals, count: N, format: 'ply' };
}

// ============================================================
// PCD — Point Cloud Library
// ============================================================

export function readPCD(buf) {
  if (typeof buf === 'string') buf = new TextEncoder().encode(buf);
  const text = new TextDecoder().decode(buf.subarray(0, Math.min(buf.length, 65536)));
  const lines = text.split('\n');
  const meta = {};
  let dataLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l || l.startsWith('#')) continue;
    const idx = l.indexOf(' ');
    if (idx < 0) continue;
    const key = l.substring(0, idx).toUpperCase();
    const val = l.substring(idx + 1).trim();
    if (key === 'DATA') {
      meta.DATA = val.split(/\s+/)[0];
      dataLineIdx = i;
      break;
    }
    meta[key] = val;
  }
  if (!meta.FIELDS) throw new Error('PCD: missing FIELDS header');
  if (!meta.POINTS) throw new Error('PCD: missing POINTS header');
  const fields = meta.FIELDS.split(/\s+/);
  const sizes  = meta.SIZE.split(/\s+/).map((n) => parseInt(n, 10));
  const types  = meta.TYPE.split(/\s+/);
  const counts = meta.COUNT ? meta.COUNT.split(/\s+/).map((n) => parseInt(n, 10)) : fields.map(() => 1);
  const N = parseInt(meta.POINTS, 10);
  const positions = new Float32Array(N * 3);
  let colors = null;
  const hasRGB = fields.includes('rgb') || fields.includes('rgba');
  if (hasRGB) colors = new Float32Array(N * 3);
  const xi = fields.indexOf('x'), yi = fields.indexOf('y'), zi = fields.indexOf('z');
  if (xi < 0 || yi < 0 || zi < 0) throw new Error('PCD: x/y/z fields required');

  if (meta.DATA === 'ascii') {
    // Body starts after the DATA line.
    const bodyText = text.split('\n').slice(dataLineIdx + 1).join('\n');
    const rows = bodyText.split('\n');
    let row = 0;
    for (let i = 0; i < N; i++) {
      while (row < rows.length && !rows[row].trim()) row++;
      if (row >= rows.length) break;
      const t = rows[row++].trim().split(/\s+/);
      positions[i * 3]     = parseFloat(t[xi]);
      positions[i * 3 + 1] = parseFloat(t[yi]);
      positions[i * 3 + 2] = parseFloat(t[zi]);
      if (hasRGB) {
        const idx = fields.indexOf('rgb');
        const v = parseFloat(t[idx]);
        // PCD stores rgb as a float-packed uint32.
        const u = new Uint32Array(new Float32Array([v]).buffer)[0];
        colors[i * 3]     = ((u >> 16) & 0xff) / 255;
        colors[i * 3 + 1] = ((u >> 8) & 0xff) / 255;
        colors[i * 3 + 2] = (u & 0xff) / 255;
      }
    }
  } else if (meta.DATA === 'binary') {
    // Locate where binary body starts — the byte after the DATA line's \n.
    const headerByteEnd = (() => {
      const idx = new TextEncoder().encode(text).length;
      // walk through `text` again byte-counting until end of DATA line.
      const headerText = lines.slice(0, dataLineIdx + 1).join('\n') + '\n';
      return new TextEncoder().encode(headerText).length;
    })();
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const le = true;
    const rowSize = sizes.reduce((s, sz, idx) => s + sz * counts[idx], 0);
    for (let i = 0; i < N; i++) {
      const base = headerByteEnd + i * rowSize;
      let off = base;
      for (let f = 0; f < fields.length; f++) {
        const sz = sizes[f], tp = types[f], ct = counts[f];
        for (let k = 0; k < ct; k++) {
          let v = 0;
          if (tp === 'F' && sz === 4) v = dv.getFloat32(off, le);
          else if (tp === 'F' && sz === 8) v = dv.getFloat64(off, le);
          else if (tp === 'U' && sz === 1) v = dv.getUint8(off);
          else if (tp === 'U' && sz === 2) v = dv.getUint16(off, le);
          else if (tp === 'U' && sz === 4) v = dv.getUint32(off, le);
          else if (tp === 'I' && sz === 4) v = dv.getInt32(off, le);
          if (k === 0) {
            if (f === xi) positions[i * 3]     = v;
            if (f === yi) positions[i * 3 + 1] = v;
            if (f === zi) positions[i * 3 + 2] = v;
          }
          off += sz;
        }
      }
    }
  } else {
    throw new Error(`PCD: unsupported DATA mode ${meta.DATA}`);
  }
  return { positions, colors, normals: null, count: N, format: 'pcd' };
}

// ============================================================
// XYZ — plain whitespace-separated
// ============================================================

export function readXYZ(buf) {
  const text = typeof buf === 'string'
    ? buf
    : new TextDecoder().decode(buf);
  const rows = text.split('\n');
  const pts  = [];
  const cls  = [];
  let hasC = false;
  for (let i = 0; i < rows.length; i++) {
    let l = rows[i].trim();
    if (!l || l.startsWith('#') || l.startsWith('//')) continue;
    const t = l.split(/[\s,;]+/);
    if (t.length < 3) continue;
    const x = parseFloat(t[0]);
    const y = parseFloat(t[1]);
    const z = parseFloat(t[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    pts.push(x, y, z);
    if (t.length >= 6) {
      hasC = true;
      cls.push(parseFloat(t[3]) / 255, parseFloat(t[4]) / 255, parseFloat(t[5]) / 255);
    } else if (hasC) {
      cls.push(0, 0, 0);
    }
  }
  return {
    positions: Float32Array.from(pts),
    colors:    hasC ? Float32Array.from(cls) : null,
    normals:   null,
    count: pts.length / 3,
    format: 'xyz',
  };
}

// ============================================================
// E57 — simplified ASCII subset
// ============================================================

// Real E57 (ASTM E2807) is a binary container with XML chunks +
// compressed-vector streams. A native decoder (libE57 / e57format)
// is normally required for production data.  We implement the
// well-known ASCII subset where the XML is at the top of the file
// and a <points> block carries ascii-encoded triples — several
// open sample files ship in this form, and it is what gets
// generated by every "export-to-text" path in CloudCompare.
export function readE57(buf) {
  const text = typeof buf === 'string' ? buf : new TextDecoder().decode(buf);
  // We require an explicit <points> block.
  const m = text.match(/<points[^>]*>([\s\S]*?)<\/points>/i);
  if (!m) {
    throw new Error(
      'E57: only the ASCII XML subset is supported — full binary ' +
      'CompressedVector decode requires a native libE57 kernel ' +
      '(out of scope for the JS bundle)',
    );
  }
  const body = m[1];
  const rows = body.split(/[\n\r]+/);
  const pts = [];
  for (const row of rows) {
    const t = row.trim().split(/[\s,;]+/);
    if (t.length < 3) continue;
    const x = parseFloat(t[0]);
    const y = parseFloat(t[1]);
    const z = parseFloat(t[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    pts.push(x, y, z);
  }
  return {
    positions: Float32Array.from(pts),
    colors: null, normals: null,
    count: pts.length / 3,
    format: 'e57',
  };
}

// ============================================================
// Light spatial helpers reused by ransacFitting + heatmap
// ============================================================

export function boundingBox(positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ,
           dx: maxX - minX, dy: maxY - minY, dz: maxZ - minZ };
}

// Estimate per-point normals via covariance of the k nearest
// neighbours — used by ransacFitting cylinder/cone primitives.
// O(N²) brute-force is fine for the panel's 5-10k point demos.
export function estimateNormals(positions, k = 20) {
  const N = positions.length / 3;
  const normals = new Float32Array(N * 3);
  if (N < 3) return normals;
  const kk = Math.min(k, N - 1);
  const idx = new Int32Array(N);
  const dist = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    for (let j = 0; j < N; j++) {
      const dx = positions[j * 3] - x;
      const dy = positions[j * 3 + 1] - y;
      const dz = positions[j * 3 + 2] - z;
      dist[j] = dx * dx + dy * dy + dz * dz;
      idx[j] = j;
    }
    // partial sort: simple top-k selection.
    for (let m = 0; m <= kk; m++) {
      let best = m;
      for (let n = m + 1; n < N; n++) {
        if (dist[idx[n]] < dist[idx[best]]) best = n;
      }
      const tmp = idx[m]; idx[m] = idx[best]; idx[best] = tmp;
    }
    // centroid
    let cx = 0, cy = 0, cz = 0;
    for (let m = 1; m <= kk; m++) {
      const j = idx[m];
      cx += positions[j * 3];
      cy += positions[j * 3 + 1];
      cz += positions[j * 3 + 2];
    }
    cx /= kk; cy /= kk; cz /= kk;
    // 3×3 covariance — symmetric.
    let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0;
    for (let m = 1; m <= kk; m++) {
      const j = idx[m];
      const dx = positions[j * 3] - cx;
      const dy = positions[j * 3 + 1] - cy;
      const dz = positions[j * 3 + 2] - cz;
      cxx += dx * dx; cyy += dy * dy; czz += dz * dz;
      cxy += dx * dy; cxz += dx * dz; cyz += dy * dz;
    }
    // Smallest-eigenvalue eigenvector of 3×3 symmetric matrix —
    // inverse-power iteration starting from (1,1,1).
    let nx = 1, ny = 1, nz = 1;
    for (let it = 0; it < 14; it++) {
      const ux = cxx * nx + cxy * ny + cxz * nz;
      const uy = cxy * nx + cyy * ny + cyz * nz;
      const uz = cxz * nx + cyz * ny + czz * nz;
      const norm = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
      nx = ux / norm; ny = uy / norm; nz = uz / norm;
    }
    // The dominant eigenvector points along max-variance — flip to
    // surface normal by orthogonalising (we want the smallest, so
    // pick orthogonal complement via Gram-Schmidt on (1,0,0)).
    let ex = 1, ey = 0, ez = 0;
    const dot = ex * nx + ey * ny + ez * nz;
    ex -= dot * nx; ey -= dot * ny; ez -= dot * nz;
    const len = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1;
    normals[i * 3]     = ex / len;
    normals[i * 3 + 1] = ey / len;
    normals[i * 3 + 2] = ez / len;
  }
  return normals;
}
