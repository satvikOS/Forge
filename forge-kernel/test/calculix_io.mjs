// ===========================================================================
// calculix_io.mjs — CalculiX / Abaqus  .inp reader  +  .frd writer  SUBSET
// ---------------------------------------------------------------------------
// Task #62. REAL native-FEA I/O, no stubs. Pure JS: it marshals a pragmatic
// keyword subset of a CalculiX/Abaqus .inp deck into Forge's EXISTING native
// solve verbs and writes the results back as a CalculiX .frd result file.
// NO kernel rebuild — the hex/tet solvers already accept a directly-built mesh
// object (Float64Array nodes + element connectivity), so the deck is parsed in
// JS and dispatched straight into:
//     forge.fea.solveStatic / solveModal            (C3D8/C3D8R/C3D8I → hex)
//     forge.fea.tet.solveLinearStatic / solveModal  (C3D4/C3D10        → tet)
//
// .inp KEYWORD SUBSET SUPPORTED
//   *NODE [,NSET=]                node label, x, y, z
//   *ELEMENT, TYPE=, [ELSET=]     element label, n1..nk   (comma-continuation)
//        TYPE ∈ {C3D8, C3D8R, C3D8I}  → 8-node hex   (forge C3D8I incompat-modes)
//        TYPE ∈ {C3D4}                → 4-node linear tet
//        TYPE ∈ {C3D10}               → read as linear Tet4 on the 4 CORNER nodes
//   *NSET, NSET=  [,GENERATE]      node-set (explicit list or start,end,inc)
//   *ELSET, ELSET= [,GENERATE]     element-set
//   *MATERIAL, NAME=
//   *ELASTIC [,TYPE=ISO]          E, nu
//   *DENSITY                      rho
//   *EXPANSION                    alpha            (thermoelastic CTE, optional)
//   *SOLID SECTION, ELSET=, MATERIAL=   (parsed; forge solves ONE material/mesh)
//   *BOUNDARY                     node|nset, dof1, dof2 [,value]   (ENCASTRE/PINNED)
//   *CLOAD                        node|nset, dof, magnitude
//   *DLOAD / *DSLOAD              elem|elset, Pn, pressure   (→ equiv. nodal forces)
//   *STEP ... *STATIC / *FREQUENCY ... *END STEP
//
// .frd FIELDS WRITTEN
//   2C  node block         ( -1 node x y z )
//   3C  element block       ( -1 elem type grp mat ; -2 connectivity )
//   100CL DISP  ( D1 D2 D3 )           — nodal displacement vector
//   100CL STRESS( SXX SYY SZZ SXY SYZ SZX ) — nodal Cauchy stress tensor (static)
//   9999 terminator
// (For *FREQUENCY a DISP block per mode is written, the step value = the eigen-
//  frequency in Hz.)
//
// UNITS: the deck is treated verbatim in whatever CONSISTENT unit system it is
// written in (exactly as CalculiX itself — unit-agnostic). No scaling is applied.
//
// HONEST SCOPE / subset boundaries (surfaced, never silently faked):
//   * One element FAMILY per deck (all-hex OR all-tet) — the two map onto two
//     distinct native solvers. A mixed hex+tet deck throws (no silent fallback).
//   * One material per mesh (forge's solver takes a single Material); the first
//     *MATERIAL is used and a note is recorded if more than one is present.
//   * C3D8R reduced integration ≡ the incompatible-modes C3D8I element here.
//   * C3D10 quadratic tet is solved as a LINEAR Tet4 on its 4 corner nodes.
// ===========================================================================

// ---- element-type registry -------------------------------------------------
const ELTYPE = {
  C3D8:  { family: 'hex', nnodes: 8,  frdType: 1, cornerCount: 8 },
  C3D8R: { family: 'hex', nnodes: 8,  frdType: 1, cornerCount: 8 },
  C3D8I: { family: 'hex', nnodes: 8,  frdType: 1, cornerCount: 8 },
  C3D4:  { family: 'tet', nnodes: 4,  frdType: 3, cornerCount: 4 },
  C3D10: { family: 'tet', nnodes: 10, frdType: 3, cornerCount: 4 }, // linear Tet4 on corners
};

// Abaqus face → local (0-based) node indices. Outward normal is recovered from
// the element centroid at load time, so face winding here is irrelevant.
const HEX_FACES = { 1:[0,1,2,3], 2:[4,5,6,7], 3:[0,1,5,4], 4:[1,2,6,5], 5:[2,3,7,6], 6:[3,0,4,7] };
const TET_FACES = { 1:[0,1,2], 2:[0,3,1], 3:[1,3,2], 4:[2,3,0] };

// ===========================================================================
// PARSER
// ===========================================================================
function splitCsv(line) {
  return line.split(',').map(s => s.trim());
}
function parseKeywordLine(line) {
  // line begins with a single '*' (caller already filtered '**' comments)
  const parts = splitCsv(line.slice(1));
  const keyword = parts[0].toUpperCase().replace(/\s+/g, ' ').trim();
  const params = {};
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const eq = p.indexOf('=');
    if (eq >= 0) params[p.slice(0, eq).trim().toUpperCase()] = p.slice(eq + 1).trim();
    else params[p.trim().toUpperCase()] = true;
  }
  return { keyword, params };
}

export function parseInp(text) {
  const rawLines = text.split(/\r?\n/);
  const deck = {
    nodes: new Map(),          // label(int) -> [x,y,z]
    elements: [],              // {label, typeKey, conn:[labels]}
    elementByLabel: new Map(),
    nsets: new Map(),          // name -> [labels]
    elsets: new Map(),         // name -> [labels]
    materials: [],             // {name, E, nu, rho, alpha}
    sections: [],              // {elset, material}
    boundaries: [],            // {target, d1, d2, value}
    cloads: [],                // {target, dof, mag}
    dloads: [],                // {target, face, mag}
    stepType: null,            // 'static' | 'frequency'
    numEigen: 0,
    notes: [],
  };

  let i = 0;
  const isKeyword = (l) => l.startsWith('*') && !l.startsWith('**');
  // peek/consume the contiguous data lines (non-keyword, non-comment) following
  // a keyword, honouring Abaqus trailing-comma continuation when requested.
  function dataLines() {
    const out = [];
    while (i < rawLines.length) {
      const l = rawLines[i].trim();
      if (l === '' || l.startsWith('**')) { i++; continue; }
      if (isKeyword(rawLines[i].trim())) break;
      out.push(rawLines[i]);
      i++;
    }
    return out;
  }
  // group element data lines into records, joining trailing-comma continuations.
  function elementRecords(lines) {
    const records = [];
    let pending = [];
    for (const raw of lines) {
      const trimmed = raw.trim();
      if (trimmed === '') continue;
      const cont = trimmed.endsWith(',');
      const toks = splitCsv(trimmed).filter(t => t !== '');
      pending.push(...toks);
      if (!cont) { records.push(pending); pending = []; }
    }
    if (pending.length) records.push(pending);
    return records;
  }

  let curMaterial = null;

  while (i < rawLines.length) {
    const lineTrim = rawLines[i].trim();
    if (lineTrim === '' || lineTrim.startsWith('**')) { i++; continue; }
    if (!isKeyword(lineTrim)) { i++; continue; } // stray data — skip
    const { keyword, params } = parseKeywordLine(lineTrim);
    i++; // advance past the keyword line

    switch (keyword) {
      case 'NODE': {
        const lines = dataLines();
        const setName = params.NSET ? params.NSET.toUpperCase() : null;
        const setList = [];
        for (const l of lines) {
          const t = splitCsv(l).filter(s => s !== '');
          if (t.length < 4) continue;
          const lab = parseInt(t[0], 10);
          deck.nodes.set(lab, [parseFloat(t[1]), parseFloat(t[2]), parseFloat(t[3])]);
          setList.push(lab);
        }
        if (setName) deck.nsets.set(setName, (deck.nsets.get(setName) || []).concat(setList));
        break;
      }
      case 'ELEMENT': {
        const typeKey = (params.TYPE || '').toUpperCase();
        if (!ELTYPE[typeKey]) {
          deck.notes.push(`unsupported *ELEMENT TYPE=${typeKey} — skipped`);
          dataLines();
          break;
        }
        const spec = ELTYPE[typeKey];
        const recs = elementRecords(dataLines());
        const setName = params.ELSET ? params.ELSET.toUpperCase() : null;
        const setList = [];
        for (const r of recs) {
          if (r.length < 1 + spec.nnodes) continue; // incomplete record
          const lab = parseInt(r[0], 10);
          const conn = r.slice(1, 1 + spec.nnodes).map(s => parseInt(s, 10));
          const el = { label: lab, typeKey, conn };
          deck.elements.push(el);
          deck.elementByLabel.set(lab, el);
          setList.push(lab);
        }
        if (setName) deck.elsets.set(setName, (deck.elsets.get(setName) || []).concat(setList));
        break;
      }
      case 'NSET': {
        const name = (params.NSET || '').toUpperCase();
        const gen = !!params.GENERATE;
        const toks = dataLines().flatMap(l => splitCsv(l)).filter(t => t !== '');
        const list = [];
        if (gen) {
          for (let k = 0; k + 1 < toks.length; k += 3) {
            const a = parseInt(toks[k], 10), b = parseInt(toks[k + 1], 10);
            const inc = toks[k + 2] !== undefined ? parseInt(toks[k + 2], 10) : 1;
            for (let v = a; v <= b; v += inc) list.push(v);
          }
        } else {
          for (const t of toks) {
            const n = parseInt(t, 10);
            if (!Number.isNaN(n)) list.push(n);
            else if (deck.nsets.has(t.toUpperCase())) list.push(...deck.nsets.get(t.toUpperCase()));
          }
        }
        deck.nsets.set(name, (deck.nsets.get(name) || []).concat(list));
        break;
      }
      case 'ELSET': {
        const name = (params.ELSET || '').toUpperCase();
        const gen = !!params.GENERATE;
        const toks = dataLines().flatMap(l => splitCsv(l)).filter(t => t !== '');
        const list = [];
        if (gen) {
          for (let k = 0; k + 1 < toks.length; k += 3) {
            const a = parseInt(toks[k], 10), b = parseInt(toks[k + 1], 10);
            const inc = toks[k + 2] !== undefined ? parseInt(toks[k + 2], 10) : 1;
            for (let v = a; v <= b; v += inc) list.push(v);
          }
        } else {
          for (const t of toks) {
            const n = parseInt(t, 10);
            if (!Number.isNaN(n)) list.push(n);
            else if (deck.elsets.has(t.toUpperCase())) list.push(...deck.elsets.get(t.toUpperCase()));
          }
        }
        deck.elsets.set(name, (deck.elsets.get(name) || []).concat(list));
        break;
      }
      case 'MATERIAL': {
        curMaterial = { name: (params.NAME || `M${deck.materials.length + 1}`), E: null, nu: null, rho: 0, alpha: 0 };
        deck.materials.push(curMaterial);
        break;
      }
      case 'ELASTIC': {
        const t = dataLines().flatMap(l => splitCsv(l)).filter(s => s !== '');
        if (curMaterial && t.length >= 2) { curMaterial.E = parseFloat(t[0]); curMaterial.nu = parseFloat(t[1]); }
        break;
      }
      case 'DENSITY': {
        const t = dataLines().flatMap(l => splitCsv(l)).filter(s => s !== '');
        if (curMaterial && t.length >= 1) curMaterial.rho = parseFloat(t[0]);
        break;
      }
      case 'EXPANSION': {
        const t = dataLines().flatMap(l => splitCsv(l)).filter(s => s !== '');
        if (curMaterial && t.length >= 1) curMaterial.alpha = parseFloat(t[0]);
        break;
      }
      case 'SOLID SECTION': {
        deck.sections.push({ elset: (params.ELSET || '').toUpperCase(), material: (params.MATERIAL || '').toUpperCase() });
        dataLines();
        break;
      }
      case 'BOUNDARY': {
        for (const l of dataLines()) {
          const t = splitCsv(l).filter(s => s !== '');
          if (t.length < 1) continue;
          const target = t[0];
          // keyword forms
          if (t.length >= 2 && /^[A-Za-z]/.test(t[1])) {
            const kw = t[1].toUpperCase();
            if (kw === 'ENCASTRE' || kw === 'PINNED') { deck.boundaries.push({ target, d1: 1, d2: 3, value: 0 }); continue; }
          }
          const d1 = parseInt(t[1], 10);
          const d2 = t.length >= 3 && /^-?\d+$/.test(t[2]) ? parseInt(t[2], 10) : d1;
          const value = t.length >= 4 ? parseFloat(t[3]) : 0;
          deck.boundaries.push({ target, d1, d2, value });
        }
        break;
      }
      case 'CLOAD': {
        for (const l of dataLines()) {
          const t = splitCsv(l).filter(s => s !== '');
          if (t.length < 3) continue;
          deck.cloads.push({ target: t[0], dof: parseInt(t[1], 10), mag: parseFloat(t[2]) });
        }
        break;
      }
      case 'DLOAD':
      case 'DSLOAD': {
        for (const l of dataLines()) {
          const t = splitCsv(l).filter(s => s !== '');
          if (t.length < 3) continue;
          const faceTok = t[1].toUpperCase();          // e.g. P3
          const m = faceTok.match(/^P(\d+)$/);
          if (!m) { deck.notes.push(`*${keyword} non-pressure label ${faceTok} skipped`); continue; }
          deck.dloads.push({ target: t[0], face: parseInt(m[1], 10), mag: parseFloat(t[2]) });
        }
        break;
      }
      case 'STEP': { break; }
      case 'STATIC': { deck.stepType = 'static'; dataLines(); break; }
      case 'FREQUENCY': {
        deck.stepType = 'frequency';
        const t = dataLines().flatMap(l => splitCsv(l)).filter(s => s !== '');
        deck.numEigen = t.length >= 1 ? parseInt(t[0], 10) : 1;
        break;
      }
      case 'END STEP': { break; }
      default: { dataLines(); break; } // unknown keyword: swallow its data block
    }
  }
  return deck;
}

// ---- target resolution -----------------------------------------------------
function resolveNodes(target, deck) {
  const n = parseInt(target, 10);
  if (!Number.isNaN(n) && /^-?\d+$/.test(String(target).trim())) return [n];
  const key = String(target).toUpperCase();
  return deck.nsets.get(key) || [];
}
function resolveElems(target, deck) {
  const n = parseInt(target, 10);
  if (!Number.isNaN(n) && /^-?\d+$/.test(String(target).trim())) return [n];
  const key = String(target).toUpperCase();
  return deck.elsets.get(key) || [];
}

// ===========================================================================
// SOLVE — marshal the deck into forge's native solver and return a normalized
// result keyed by ORIGINAL node labels.
// ===========================================================================
export function solveInp(forge, deck) {
  if (deck.elements.length === 0) throw new Error('calculix_io: deck has no elements');
  // homogeneous family check (no silent fallback for mixed meshes)
  const families = new Set(deck.elements.map(e => ELTYPE[e.typeKey].family));
  if (families.size !== 1) throw new Error(`calculix_io: mixed element families ${[...families].join('+')} — one solver family per deck`);
  const family = [...families][0];

  const mat = deck.materials[0];
  if (!mat || mat.E == null || mat.nu == null) throw new Error('calculix_io: missing *MATERIAL/*ELASTIC (E, nu)');
  if (deck.materials.length > 1) deck.notes.push(`${deck.materials.length} materials present — forge solves ONE material/mesh; using "${mat.name}"`);
  const material = { E: mat.E, nu: mat.nu, rho: mat.rho || 0, alpha: mat.alpha || 0 };

  // compact node table: only the nodes referenced by the (solved) elements,
  // in first-seen order. internal index == frd/output index.
  const labelToIndex = new Map();
  const nodeLabels = [];
  const pushNode = (lab) => {
    if (!labelToIndex.has(lab)) { labelToIndex.set(lab, nodeLabels.length); nodeLabels.push(lab); }
    return labelToIndex.get(lab);
  };
  const solvedElems = [];   // {label, typeKey, frdType, idx:[internal indices]}
  for (const el of deck.elements) {
    const spec = ELTYPE[el.typeKey];
    const corners = el.conn.slice(0, spec.cornerCount);
    const idx = corners.map(pushNode);
    solvedElems.push({ label: el.label, typeKey: el.typeKey, frdType: spec.frdType, idx, allConn: el.conn });
  }
  const N = nodeLabels.length;
  const nodesXYZ = new Float64Array(3 * N);
  for (let k = 0; k < N; k++) {
    const c = deck.nodes.get(nodeLabels[k]);
    if (!c) throw new Error(`calculix_io: element references undefined node ${nodeLabels[k]}`);
    nodesXYZ[3 * k] = c[0]; nodesXYZ[3 * k + 1] = c[1]; nodesXYZ[3 * k + 2] = c[2];
  }

  // ---- boundary conditions (per internal node, per DOF) -------------------
  // bc[idx] = {fixed:[bool,bool,bool], val:[v,v,v]}
  const bcMap = new Map();
  const getBc = (idx) => { if (!bcMap.has(idx)) bcMap.set(idx, { fixed: [false, false, false], val: [0, 0, 0] }); return bcMap.get(idx); };
  for (const b of deck.boundaries) {
    const labs = resolveNodes(b.target, deck);
    const d1 = Math.max(1, b.d1), d2 = Math.min(3, b.d2 || b.d1); // solids: translational DOF 1..3 only
    for (const lab of labs) {
      if (!labelToIndex.has(lab)) continue;
      const idx = labelToIndex.get(lab); const bc = getBc(idx);
      for (let d = d1; d <= d2; d++) { bc.fixed[d - 1] = true; bc.val[d - 1] = b.value || 0; }
    }
  }

  // ---- nodal loads (CLOAD) -------------------------------------------------
  const loadMap = new Map(); // idx -> [fx,fy,fz]
  const addLoad = (idx, d, v) => { if (!loadMap.has(idx)) loadMap.set(idx, [0, 0, 0]); loadMap.get(idx)[d] += v; };
  for (const c of deck.cloads) {
    const labs = resolveNodes(c.target, deck);
    if (c.dof < 1 || c.dof > 3) continue;
    for (const lab of labs) { if (labelToIndex.has(lab)) addLoad(labelToIndex.get(lab), c.dof - 1, c.mag); }
  }

  // ---- pressure loads (DLOAD/DSLOAD) → equivalent nodal forces -------------
  const elemByLabel = new Map(solvedElems.map(e => [e.label, e]));
  for (const dl of deck.dloads) {
    const labs = resolveElems(dl.target, deck);
    for (const elab of labs) {
      const el = elemByLabel.get(elab); if (!el) continue;
      const faces = ELTYPE[el.typeKey].family === 'hex' ? HEX_FACES : TET_FACES;
      const faceLocal = faces[dl.face]; if (!faceLocal) continue;
      const fNodes = faceLocal.map(li => el.idx[li]);
      // element centroid (for outward orientation)
      const c = [0, 0, 0];
      for (const gi of el.idx) { c[0] += nodesXYZ[3 * gi]; c[1] += nodesXYZ[3 * gi + 1]; c[2] += nodesXYZ[3 * gi + 2]; }
      const nn = el.idx.length; c[0] /= nn; c[1] /= nn; c[2] /= nn;
      const P = fNodes.map(gi => [nodesXYZ[3 * gi], nodesXYZ[3 * gi + 1], nodesXYZ[3 * gi + 2]]);
      // area + normal via triangle fan from P[0]
      let area = 0; let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
      for (const p of P) { cx += p[0]; cy += p[1]; cz += p[2]; }
      cx /= P.length; cy /= P.length; cz /= P.length;
      for (let t = 0; t < P.length; t++) {
        const a = P[t], b = P[(t + 1) % P.length];
        const ux = a[0] - cx, uy = a[1] - cy, uz = a[2] - cz;
        const vx = b[0] - cx, vy = b[1] - cy, vz = b[2] - cz;
        const wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
        const triA = 0.5 * Math.hypot(wx, wy, wz);
        area += triA; nx += wx; ny += wy; nz += wz;
      }
      let nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      // orient OUTWARD (away from element centroid)
      if ((cx - c[0]) * nx + (cy - c[1]) * ny + (cz - c[2]) * nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      // Abaqus positive pressure acts INTO the face (along -outward normal)
      const per = -dl.mag * area / fNodes.length;
      for (const gi of fNodes) { addLoad(gi, 0, per * nx); addLoad(gi, 1, per * ny); addLoad(gi, 2, per * nz); }
    }
  }

  // ---- dispatch to the native solver --------------------------------------
  const stepType = deck.stepType || 'static';
  const result = { family, stepType, nodeLabels, labelToIndex, nodesXYZ, elements: solvedElems, material, notes: deck.notes };

  if (family === 'hex') {
    const mesh = { nodes: nodesXYZ, tets: new Uint32Array(solvedElems.flatMap(e => e.idx)), elemNodeCount: 8 };
    if (stepType === 'frequency') {
      const bcs = [...bcMap.entries()].map(([idx, b]) => ({ nodeId: idx, fx: b.fixed[0], fy: b.fixed[1], fz: b.fixed[2], ux: b.val[0], uy: b.val[1], uz: b.val[2] }));
      const r = forge.fea.solveModal(mesh, material, bcs, deck.numEigen || 4);
      result.frequencies = Array.from(r.eigenvalues).map(w2 => Math.sqrt(Math.max(0, w2)) / (2 * Math.PI));
      result.modeShapes = (r.eigenvectors || []).map(v => Float64Array.from(v));
    } else {
      const loads = [...loadMap.entries()].map(([idx, f]) => ({ nodeId: idx, fx: f[0], fy: f[1], fz: f[2] }));
      const bcs = [...bcMap.entries()].map(([idx, b]) => ({ nodeId: idx, fx: b.fixed[0], fy: b.fixed[1], fz: b.fixed[2], ux: b.val[0], uy: b.val[1], uz: b.val[2] }));
      // thermoelastic ΔT is not in this keyword subset → isothermal (empty)
      const r = forge.fea.solveStatic(mesh, material, loads, [], bcs);
      result.disp = Float64Array.from(r.u);
      result.nodeStress = { sxx: r.nodeSxx, syy: r.nodeSyy, szz: r.nodeSzz, sxy: r.nodeSxy, syz: r.nodeSyz, szx: r.nodeSzx };
      result.nodeVonMises = r.nodeVonMises;
      result.residual = r.residual;
    }
  } else { // tet
    const mesh = { nodes: nodesXYZ, tets: new Int32Array(solvedElems.flatMap(e => e.idx)) };
    if (stepType === 'frequency') {
      const fixedNodes = [];
      for (const [idx, b] of bcMap) if (b.fixed[0] && b.fixed[1] && b.fixed[2]) fixedNodes.push(idx);
      const r = forge.fea.tet.solveModal(mesh, material, fixedNodes, deck.numEigen || 4);
      result.frequencies = Array.from(r.eigenfrequencies);
      result.modeShapes = (r.modeShapes || []).map(s => Float64Array.from(s));
    } else {
      const nodalForces = [...loadMap.entries()].map(([idx, f]) => ({ nodeId: idx, fx: f[0], fy: f[1], fz: f[2] }));
      const fixedNodes = []; const prescribed = [];
      for (const [idx, b] of bcMap) {
        const full = b.fixed[0] && b.fixed[1] && b.fixed[2] && b.val[0] === 0 && b.val[1] === 0 && b.val[2] === 0;
        if (full) fixedNodes.push(idx);
        else prescribed.push({ nodeId: idx, fx: b.fixed[0], fy: b.fixed[1], fz: b.fixed[2], ux: b.val[0], uy: b.val[1], uz: b.val[2] });
      }
      const r = forge.fea.tet.solveLinearStatic(mesh, material, { fixedNodes, nodalForces, prescribed, nodeTemps: [] });
      const disp = new Float64Array(3 * N);
      for (let k = 0; k < N; k++) { disp[3 * k] = r.displacement[3 * k]; disp[3 * k + 1] = r.displacement[3 * k + 1]; disp[3 * k + 2] = r.displacement[3 * k + 2]; }
      result.disp = disp;
      result.nodeStress = { sxx: r.nodeSxx, syy: r.nodeSyy, szz: r.nodeSzz, sxy: r.nodeSxy, syz: r.nodeSyz, szx: r.nodeSzx };
      result.nodeVonMises = r.nodeVonMises;
      result.converged = r.converged;
      result.residual = r.cgResidual;
    }
  }
  return result;
}

// ===========================================================================
// .frd WRITER
// ===========================================================================
function i_(n, w) { return String(n).padStart(w); }
function e12_5(x) {
  if (!Number.isFinite(x)) x = 0;
  if (Object.is(x, -0)) x = 0;
  let s = x.toExponential(5);                  // e.g. "-5.00000e-1"
  let [m, e] = s.split('e');
  let exp = parseInt(e, 10);
  const es = (exp < 0 ? '-' : '+') + String(Math.abs(exp)).padStart(2, '0');
  let out = m + 'E' + es;                        // "-5.00000E-01"
  return out.padStart(12, ' ');
}

export function writeFrd(solved, opts = {}) {
  const job = opts.jobName || 'FORGE';
  const N = solved.nodeLabels.length;
  const L = []; // lines
  // ---- header ----
  L.push('    1C');
  L.push(`    1UFORGE native FEA — CalculiX .frd subset (job ${job})`.padEnd(72));
  L.push('    1UVERSION    forge-kernel');
  // ---- node block (2C) ----
  L.push('    2C' + i_(N, 12) + ' '.repeat(67) + '1');
  for (let k = 0; k < N; k++) {
    const lab = solved.nodeLabels[k];
    L.push(' -1' + i_(lab, 10) + e12_5(solved.nodesXYZ[3 * k]) + e12_5(solved.nodesXYZ[3 * k + 1]) + e12_5(solved.nodesXYZ[3 * k + 2]));
  }
  L.push(' -3');
  // ---- element block (3C) ----
  L.push('    3C' + i_(solved.elements.length, 12) + ' '.repeat(67) + '1');
  for (const el of solved.elements) {
    L.push(' -1' + i_(el.label, 10) + i_(el.frdType, 5) + i_(0, 5) + i_(1, 5));
    // connectivity in ORIGINAL node labels (10 per -2 line)
    const labs = el.idx.map(gi => solved.nodeLabels[gi]);
    for (let off = 0; off < labs.length; off += 10) {
      L.push(' -2' + labs.slice(off, off + 10).map(v => i_(v, 10)).join(''));
    }
  }
  L.push(' -3');

  // ---- results ----
  const dispBlock = (label, value, disp) => {
    L.push('  100CL' + i_(101, 5) + e12_5(value) + i_(N, 12) + ' '.repeat(20) + i_(1, 2) + i_(1, 5) + ' '.repeat(10) + i_(1, 2));
    L.push(' -4  DISP        4    1');
    L.push(' -5  D1          1    2    1    0');
    L.push(' -5  D2          1    2    2    0');
    L.push(' -5  D3          1    2    3    0');
    L.push(' -5  ALL         1    2    0    0    1ALL');
    for (let k = 0; k < N; k++) {
      L.push(' -1' + i_(solved.nodeLabels[k], 10) + e12_5(disp[3 * k]) + e12_5(disp[3 * k + 1]) + e12_5(disp[3 * k + 2]));
    }
    L.push(' -3');
  };

  if (solved.stepType === 'frequency') {
    for (let mode = 0; mode < (solved.frequencies || []).length; mode++) {
      const f = solved.frequencies[mode];
      const phi = (solved.modeShapes && solved.modeShapes[mode]) ? solved.modeShapes[mode] : new Float64Array(3 * N);
      dispBlock('DISP', f, phi);   // step value = eigenfrequency (Hz)
    }
  } else {
    dispBlock('DISP', 1.0, solved.disp);
    if (solved.nodeStress && solved.nodeStress.sxx) {
      const s = solved.nodeStress;
      L.push('  100CL' + i_(101, 5) + e12_5(1.0) + i_(N, 12) + ' '.repeat(20) + i_(1, 2) + i_(1, 5) + ' '.repeat(10) + i_(1, 2));
      L.push(' -4  STRESS      6    1');
      L.push(' -5  SXX         1    4    1    1');
      L.push(' -5  SYY         1    4    2    2');
      L.push(' -5  SZZ         1    4    3    3');
      L.push(' -5  SXY         1    4    1    2');
      L.push(' -5  SYZ         1    4    2    3');
      L.push(' -5  SZX         1    4    3    1');
      for (let k = 0; k < N; k++) {
        L.push(' -1' + i_(solved.nodeLabels[k], 10) +
          e12_5(s.sxx[k]) + e12_5(s.syy[k]) + e12_5(s.szz[k]) +
          e12_5(s.sxy[k]) + e12_5(s.syz[k]) + e12_5(s.szx[k]));
      }
      L.push(' -3');
    }
  }
  L.push(' 9999');
  return L.join('\n') + '\n';
}

// minimal .frd back-reader for the round-trip gate: returns the FIRST DISP
// block as Map(nodeLabel -> [ux,uy,uz]). Proves the written file is well-formed
// and the numbers survive a write→read cycle.
export function readFrdDisp(text) {
  const lines = text.split(/\r?\n/);
  const out = new Map();
  let inDisp = false, headerSeen = false;
  for (const ln of lines) {
    if (ln.startsWith(' -4')) { inDisp = /DISP/.test(ln); headerSeen = false; continue; }
    if (inDisp && ln.startsWith(' -5')) { headerSeen = true; continue; }
    if (inDisp && ln.startsWith(' -3')) { break; }      // end of first DISP block
    if (inDisp && headerSeen && ln.startsWith(' -1')) {
      const node = parseInt(ln.slice(3, 13), 10);
      const ux = parseFloat(ln.slice(13, 25)), uy = parseFloat(ln.slice(25, 37)), uz = parseFloat(ln.slice(37, 49));
      out.set(node, [ux, uy, uz]);
    }
  }
  return out;
}

// ===========================================================================
// .inp WRITER (small) — used by the round-trip gate to emit a CalculiX deck
// from a forge mesh so the .inp path can be compared to the native path.
//   spec = { nodes:Float64Array(3N), elements:[{label,type,conn:[labels]}],
//            material:{name,E,nu,rho,alpha?}, boundaries:[{nodes:[labels],d1,d2,value?}],
//            cloads:[{nodes:[labels],dof,mag}], dloads:[{elems:[labels],face,mag}],
//            step:'static'|'frequency', numEigen?, nodeLabels?:[labels] }
// ===========================================================================
export function writeInp(spec) {
  const N = spec.nodes.length / 3;
  const labels = spec.nodeLabels || Array.from({ length: N }, (_, k) => k + 1);
  const L = [];
  L.push('*HEADING');
  L.push(' Forge native FEA — generated CalculiX deck');
  L.push('*NODE, NSET=NALL');
  for (let k = 0; k < N; k++) {
    L.push(`${labels[k]}, ${spec.nodes[3 * k]}, ${spec.nodes[3 * k + 1]}, ${spec.nodes[3 * k + 2]}`);
  }
  // group elements by type
  const byType = new Map();
  for (const el of spec.elements) { if (!byType.has(el.type)) byType.set(el.type, []); byType.get(el.type).push(el); }
  for (const [type, els] of byType) {
    L.push(`*ELEMENT, TYPE=${type}, ELSET=E_${type}`);
    for (const el of els) L.push(`${el.label}, ${el.conn.join(', ')}`);
  }
  const m = spec.material;
  L.push(`*MATERIAL, NAME=${m.name || 'MAT1'}`);
  L.push('*ELASTIC');
  L.push(`${m.E}, ${m.nu}`);
  L.push('*DENSITY');
  L.push(`${m.rho != null ? m.rho : 0}`);
  if (m.alpha) { L.push('*EXPANSION'); L.push(`${m.alpha}`); }
  L.push('*SOLID SECTION, ELSET=NALL, MATERIAL=' + (m.name || 'MAT1'));
  L.push(`*STEP`);
  L.push(spec.step === 'frequency' ? '*FREQUENCY' : '*STATIC');
  if (spec.step === 'frequency') L.push(`${spec.numEigen || 4}`);
  if (spec.boundaries) {
    L.push('*BOUNDARY');
    for (const b of spec.boundaries) for (const n of b.nodes) L.push(`${n}, ${b.d1}, ${b.d2 != null ? b.d2 : b.d1}${b.value != null ? ', ' + b.value : ''}`);
  }
  if (spec.cloads && spec.cloads.length) {
    L.push('*CLOAD');
    for (const c of spec.cloads) for (const n of c.nodes) L.push(`${n}, ${c.dof}, ${c.mag}`);
  }
  if (spec.dloads && spec.dloads.length) {
    L.push('*DLOAD');
    for (const d of spec.dloads) for (const e of d.elems) L.push(`${e}, P${d.face}, ${d.mag}`);
  }
  L.push('*NODE PRINT, NSET=NALL');
  L.push('U');
  L.push('*EL PRINT');
  L.push('S');
  L.push('*END STEP');
  return L.join('\n') + '\n';
}
