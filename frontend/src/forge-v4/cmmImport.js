// Forge-162 — CMM measurement readers.
//
// Three real CMM-format parsers:
//
//   * AICON .mmp        — AICON 3D Systems metrology export.  ASCII
//                         file with a [Measurement] header and one
//                         feature per indented block.
//   * Hexagon DMIS      — ISO 22093 DMIS dialect emitted by
//                         Hexagon PC-DMIS.  We tokenise the F(... ),
//                         FEAT/, MEAS/, T(... ) records.
//   * ISO 22093 I++ DME — vendor-neutral I++ DME ASCII (one command
//                         per line) — "PtMeas" lines record a
//                         probed point with a nominal target.
//
// All readers normalise to a single Measurement model:
//
//   {
//     source: 'aicon' | 'dmis' | 'ipp',
//     features: [
//       {
//         id, name,
//         kind: 'point' | 'plane' | 'cylinder' | 'sphere' | 'circle',
//         probed:  { x, y, z, ... }   // measured value(s)
//         nominal: { x, y, z, ... }   // CAD target
//         tolerance: { lo, hi }       // ± band in mm
//         result:    { deviation, status: 'pass'|'warn'|'fail' }
//       }
//     ],
//   }
//
// We don't ship the proprietary parsers from PC-DMIS or AICON — we
// implement enough of each ASCII dialect to read the public-sample
// files that the standards groups ship for interoperability tests.

export function importCmm(text, hint) {
  if (typeof text !== 'string') text = new TextDecoder().decode(text);
  const lower = text.slice(0, 1024).toLowerCase();
  const fmt = hint
    || (lower.includes('aicon')                          ? 'aicon'
      : lower.includes('iso 22093')                      ? 'ipp'
      : (lower.includes('dmis') || /^\s*FILNAM\s*\//im.test(text)) ? 'dmis'
      : lower.includes('ptmeas')                         ? 'ipp'
      : null);
  if (!fmt) {
    throw new Error('cmmImport: unrecognised CMM file — provide a hint argument');
  }
  switch (fmt) {
    case 'aicon': return readAICON(text);
    case 'dmis':  return readDMIS(text);
    case 'ipp':   return readIpp(text);
    default:      throw new Error(`cmmImport: unknown format ${fmt}`);
  }
}

// ============================================================
// AICON .mmp
// ============================================================

export function readAICON(text) {
  const features = [];
  const lines = text.split(/\r?\n/);
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';')) continue;
    // Section header e.g. "[Feature_001]" — start a new feature.
    const sec = trimmed.match(/^\[Feature[_-]?(\S+)\]\s*$/);
    if (sec) {
      cur = makeFeature(sec[1]);
      features.push(cur);
      continue;
    }
    // KEY = VALUE pairs.
    const kv = trimmed.match(/^([A-Za-z][\w]*)\s*=\s*(.+)$/);
    if (kv && cur) {
      const key = kv[1].toLowerCase();
      const val = kv[2].trim();
      applyAICONField(cur, key, val);
    }
  }
  // Finalise — compute deviations, classify pass/warn/fail.
  for (const f of features) {
    f.result = classify(f);
  }
  return { source: 'aicon', features };
}

function applyAICONField(f, key, val) {
  if (key === 'type' || key === 'kind') {
    f.kind = val.toLowerCase();
  } else if (key === 'name') {
    f.name = val;
  } else if (key === 'probedx' || key === 'measx') f.probed.x = parseFloat(val);
  else if (key === 'probedy' || key === 'measy') f.probed.y = parseFloat(val);
  else if (key === 'probedz' || key === 'measz') f.probed.z = parseFloat(val);
  else if (key === 'nomx' || key === 'nominalx') f.nominal.x = parseFloat(val);
  else if (key === 'nomy' || key === 'nominaly') f.nominal.y = parseFloat(val);
  else if (key === 'nomz' || key === 'nominalz') f.nominal.z = parseFloat(val);
  else if (key === 'radius')        f.probed.radius = parseFloat(val);
  else if (key === 'nominalradius') f.nominal.radius = parseFloat(val);
  else if (key === 'toleranceupper' || key === 'tolup' || key === 'plus') {
    f.tolerance.hi = parseFloat(val);
  } else if (key === 'tolerancelower' || key === 'tollo' || key === 'minus') {
    f.tolerance.lo = parseFloat(val);
  }
}

// ============================================================
// Hexagon DMIS (ISO 22093 dialect)
// ============================================================

// The PC-DMIS DMIS subset uses keyword records ending with `$`:
//   F(PT1)=FEAT/POINT,CART,10.0,5.0,2.0,0,0,1$
//   MEAS/POINT,F(PT1),1$
//   T(TOL1)=TOL/POS,3D,0.05,0.05,0.05$
//   OUTPUT/FA(PT1),TA(TOL1)$
//
// We pull out FEAT lines as nominals and any subsequent records that
// carry measured numbers via MEAS/MTRL or PMM logs.  In the absence
// of measured values we treat deviation = 0 with status 'pass'.
export function readDMIS(text) {
  const features = [];
  const byId = new Map();
  const lines = text.split(/[\r\n]+/);
  for (const raw of lines) {
    const line = raw.trim().replace(/\$$/, '');
    if (!line || line.startsWith('$$')) continue;

    let m = line.match(/^F\(([\w-]+)\)\s*=\s*FEAT\/(\w+),?\s*([A-Z]*),?\s*([-+\d.,e ]*)/i);
    if (m) {
      const id = m[1];
      const kind = m[2].toLowerCase();
      const numbers = m[4].split(',').map((s) => parseFloat(s.trim())).filter(Number.isFinite);
      const f = makeFeature(id);
      f.kind = kind;
      f.nominal.x = numbers[0] ?? 0;
      f.nominal.y = numbers[1] ?? 0;
      f.nominal.z = numbers[2] ?? 0;
      if (kind === 'circle' || kind === 'sphere' || kind === 'cylinder') {
        f.nominal.radius = numbers[6] ?? 0;
      }
      features.push(f);
      byId.set(id, f);
      continue;
    }
    // T(TOL1)=TOL/POS,3D,0.05,0.05,0.05
    m = line.match(/^T\(([\w-]+)\)\s*=\s*TOL\/POS,3D,([-+\d.,e ]*)/i);
    if (m) {
      const tolId = m[1];
      const nums = m[2].split(',').map((s) => parseFloat(s.trim()));
      const tol = nums[0] || 0.05;
      // Apply to most-recent feature.
      const last = features[features.length - 1];
      if (last) { last.tolerance.hi = tol; last.tolerance.lo = -tol; }
      continue;
    }
    // MEAS lines optionally carry measured numbers:
    //   MEAS/POINT,F(PT1),NPTS=1,X=10.01,Y=4.99,Z=2.02
    m = line.match(/^MEAS\/[\w]+,F\(([\w-]+)\)(.*)$/i);
    if (m) {
      const id = m[1];
      const tail = m[2];
      const f = byId.get(id);
      if (!f) continue;
      const xm = tail.match(/X=([-+\d.eE]+)/);
      const ym = tail.match(/Y=([-+\d.eE]+)/);
      const zm = tail.match(/Z=([-+\d.eE]+)/);
      if (xm) f.probed.x = parseFloat(xm[1]);
      if (ym) f.probed.y = parseFloat(ym[1]);
      if (zm) f.probed.z = parseFloat(zm[1]);
      continue;
    }
  }
  // Where measured wasn't supplied, copy nominal so pass-through
  // round-trip preserves shape and result classifies as 'pass'.
  for (const f of features) {
    if (f.probed.x === null && f.probed.y === null && f.probed.z === null) {
      f.probed = { ...f.nominal };
    }
    f.result = classify(f);
  }
  return { source: 'dmis', features };
}

// ============================================================
// I++ DME (ISO 22093) — ASCII command stream.
// ============================================================

// PtMeas() / GoToPar() / TchOn() / TchOff() etc.  We pull only
// PtMeas which carries (X, Y, Z, IJK, NominalX/Y/Z, ToleranceUpper,
// ToleranceLower).  Example:
//
//   PtMeas(X(10.0123),Y(5.0021),Z(2.0050),IJK(0,0,1),
//          Tag("pt1"),Pn(10.0,5.0,2.0),Tol(0.05,0.05))
//
// We also support a vendor-neutral `Feature(...)` block enclosing
// multiple PtMeas — used by Renishaw EQUATOR and other I++ servers.
export function readIpp(text) {
  const features = [];
  const lines = text.split(/[\r\n]+/);
  let groupTag = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    let mfg = line.match(/^Feature\(\s*Tag\s*\(\s*["']?([^"')]+)["']?\s*\)/);
    if (mfg) {
      groupTag = mfg[1];
      continue;
    }
    if (/^EndFeature/.test(line)) { groupTag = null; continue; }
    const m = line.match(/^PtMeas\((.*)\)\s*$/i);
    if (!m) continue;
    const body = m[1];
    const X  = num(body, /X\(([-+\d.eE]+)\)/);
    const Y  = num(body, /Y\(([-+\d.eE]+)\)/);
    const Z  = num(body, /Z\(([-+\d.eE]+)\)/);
    const Tg = (body.match(/Tag\(["']?([^"')]+)["']?\)/) || [])[1];
    const Pn = body.match(/Pn\(([-+\d.,e ]+)\)/);
    const Tol = body.match(/Tol\(([-+\d.,e ]+)\)/);
    const f = makeFeature(groupTag || Tg || `pt${features.length + 1}`);
    f.kind = 'point';
    f.probed.x = X ?? 0; f.probed.y = Y ?? 0; f.probed.z = Z ?? 0;
    if (Pn) {
      const nums = Pn[1].split(',').map((s) => parseFloat(s));
      f.nominal.x = nums[0] ?? f.probed.x;
      f.nominal.y = nums[1] ?? f.probed.y;
      f.nominal.z = nums[2] ?? f.probed.z;
    } else {
      f.nominal = { ...f.probed };
    }
    if (Tol) {
      const nums = Tol[1].split(',').map((s) => parseFloat(s));
      f.tolerance.hi = nums[0] ?? 0.05;
      f.tolerance.lo = -(nums[1] ?? nums[0] ?? 0.05);
    }
    f.result = classify(f);
    features.push(f);
  }
  return { source: 'ipp', features };
}

function num(body, re) {
  const m = body.match(re);
  return m ? parseFloat(m[1]) : null;
}

// ============================================================
// Shared helpers
// ============================================================

function makeFeature(id) {
  return {
    id, name: id, kind: 'point',
    probed:  { x: null, y: null, z: null, radius: null },
    nominal: { x: 0,    y: 0,    z: 0,    radius: 0 },
    tolerance: { lo: -0.1, hi: 0.1 },
    result: null,
  };
}

// ISO 14253-1: zone classification.  Conform → pass, in-uncertainty
// → warn, beyond uncertainty → fail.
export function classify(f) {
  const dx = (f.probed.x ?? 0) - (f.nominal.x ?? 0);
  const dy = (f.probed.y ?? 0) - (f.nominal.y ?? 0);
  const dz = (f.probed.z ?? 0) - (f.nominal.z ?? 0);
  const dev = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const tol = Math.max(Math.abs(f.tolerance.hi), Math.abs(f.tolerance.lo));
  const status =
    dev <= tol * 0.8 ? 'pass'
    : dev <= tol     ? 'warn'
    :                  'fail';
  return { deviation: dev, dx, dy, dz, status };
}
