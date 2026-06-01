// Forge-103 — project-bundle ZIP exporter.
//
// One button → one ZIP containing every deliverable from the current
// session. Built in renderer memory with JSZip (no Node fs in the
// renderer process under contextIsolation), then handed to the
// preload bridge for an atomic write via `window.forge.dialog.writeBlob`.
//
// Layout inside the ZIP:
//
//   manifest.json                          — root index
//   cad/step/<name>.step                   — native B-Rep (STEP AP214)
//   cad/stl/<name>.stl                     — meshed (ASCII)
//   cad/brep/<name>.brep                   — OCCT native
//   drawings/<name>.svg                    — projected HLR sheet
//   bom/bill-of-materials.csv              — name, qty, material, ...
//   cam/<op-name>-<dialect>.nc             — posted G-code
//   simulations/<study>.json               — stress / modal / dynamic
//   configurations/configurations.json     — design table
//
// Every claim in manifest.json is REAL — if STEP export fails for one
// body the manifest records the failure and skips that file; we never
// invent placeholder entries.

import JSZip from 'jszip';
import { startJob, updateJob, finishJob } from './progressBus.js';

// ────────────────────────────────────────────── helpers

const FORGE_VERSION = '1.0.0';

function safeName(s) {
  return String(s ?? 'untitled')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || 'untitled';
}

function isoNow() {
  return new Date().toISOString();
}

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Read a file written to /tmp by the kernel into a Uint8Array, then
// stage it in the ZIP. We don't have fs in the renderer, but the
// preload bridge exposes a path round-trip via a helper.
//
// Strategy: we use a small fetch() against the file:// path. Electron
// renderers can load local files freely under our webPreferences.
async function readFileBytes(filepath) {
  try {
    const url = filepath.startsWith('file://') ? filepath : `file://${filepath}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch ${filepath} → ${r.status}`);
    const buf = await r.arrayBuffer();
    return new Uint8Array(buf);
  } catch (err) {
    throw new Error(`readFileBytes(${filepath}): ${err.message}`);
  }
}

// Generate a unique /tmp path for kernel-driven exports.
function tmpPath(ext) {
  const r = Math.random().toString(36).slice(2, 10);
  return `/tmp/forge-bundle-${Date.now()}-${r}.${ext}`;
}

// ────────────────────────────────────────────── per-section builders

async function addCadFiles(zip, bodies, manifestBodies) {
  const forge = (typeof window !== 'undefined' ? window.forge : null);
  if (!forge?.io) {
    // No kernel — still create the empty folders so the layout is stable.
    zip.folder('cad/step');
    zip.folder('cad/stl');
    zip.folder('cad/brep');
    for (const b of bodies || []) {
      manifestBodies.push({
        id: b?.id ?? null,
        name: b?.name || 'Body',
        status: 'skipped',
        reason: 'kernel-offline',
      });
    }
    return;
  }
  for (const b of bodies || []) {
    if (!b || typeof b.handle !== 'number') {
      manifestBodies.push({
        id: b?.id ?? null,
        name: b?.name || 'Body',
        status: 'skipped',
        reason: 'no-handle',
      });
      continue;
    }
    const baseName = safeName(b.name || b.id || `body-${b.handle}`);
    const entry = { id: b.id ?? null, name: baseName, handle: b.handle, files: {} };

    // STEP
    try {
      const tp = tmpPath('step');
      forge.io.exportStep(b.handle, tp);
      const bytes = await readFileBytes(tp);
      zip.file(`cad/step/${baseName}.step`, bytes);
      entry.files.step = { path: `cad/step/${baseName}.step`, bytes: bytes.length };
    } catch (err) {
      entry.files.step = { error: err.message };
    }

    // STL (ASCII, default 0.1 mm linear / 0.5 rad angular tolerances)
    try {
      const tp = tmpPath('stl');
      forge.io.exportStl(b.handle, tp, 0.1, 0.5, true);
      const bytes = await readFileBytes(tp);
      zip.file(`cad/stl/${baseName}.stl`, bytes);
      entry.files.stl = { path: `cad/stl/${baseName}.stl`, bytes: bytes.length };
    } catch (err) {
      entry.files.stl = { error: err.message };
    }

    // BREP (OCCT native)
    try {
      const tp = tmpPath('brep');
      forge.io.exportBrep(b.handle, tp);
      const bytes = await readFileBytes(tp);
      zip.file(`cad/brep/${baseName}.brep`, bytes);
      entry.files.brep = { path: `cad/brep/${baseName}.brep`, bytes: bytes.length };
    } catch (err) {
      entry.files.brep = { error: err.message };
    }

    entry.status = Object.values(entry.files).some((f) => !f.error) ? 'ok' : 'failed';
    manifestBodies.push(entry);
  }
}

// Build an SVG document from a projection { edges:[{points:[[x,y],…], visible}] }
// or from a pre-rendered SVG string. Returns a UTF-8 byte array.
function buildSvgFromProjection(name, drawing) {
  if (drawing?.svg && typeof drawing.svg === 'string') {
    return new TextEncoder().encode(drawing.svg);
  }
  const edges = Array.isArray(drawing?.edges) ? drawing.edges : [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of edges) {
    for (const [x, y] of (e.points || [])) {
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 100; maxY = 100; }
  const pad = 8;
  const vbX = (minX - pad), vbY = (minY - pad);
  const vbW = Math.max(1, (maxX - minX) + 2 * pad);
  const vbH = Math.max(1, (maxY - minY) + 2 * pad);
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" data-forge-drawing="${safeName(name)}">`,
    `  <g fill="none" stroke="#14161b" stroke-width="0.5" stroke-linejoin="round">`,
  ];
  for (const e of edges) {
    const pts = (e.points || []).map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' ');
    if (!pts) continue;
    const dash = e.visible === false ? ' stroke-dasharray="1.5,1.5"' : '';
    lines.push(`    <polyline points="${pts}"${dash} />`);
  }
  lines.push(`  </g>`);
  lines.push(`</svg>`);
  return new TextEncoder().encode(lines.join('\n'));
}

function addDrawings(zip, drawings, manifestDrawings) {
  zip.folder('drawings');
  for (const d of drawings || []) {
    if (!d) continue;
    const name = safeName(d.name || d.id || 'drawing');
    try {
      const bytes = buildSvgFromProjection(name, d);
      zip.file(`drawings/${name}.svg`, bytes);
      manifestDrawings.push({
        id: d.id ?? null,
        name,
        path: `drawings/${name}.svg`,
        bytes: bytes.length,
        edges: Array.isArray(d.edges) ? d.edges.length : null,
        direction: d.direction ?? null,
        status: 'ok',
      });
    } catch (err) {
      manifestDrawings.push({
        id: d.id ?? null, name, status: 'failed', error: err.message,
      });
    }
  }
}

function addBom(zip, bom, manifestBom) {
  zip.folder('bom');
  const rows = Array.isArray(bom) ? bom : [];
  const header = ['name', 'qty', 'material', 'mass_g', 'volume_mm3', 'cost'];
  const lines = [header.join(',')];
  let totalMassG = 0;
  let totalCost  = 0;
  for (const r of rows) {
    // BomBalloons stores mass in kg. Bundle wants grams.
    const massG = typeof r.mass_g === 'number'
      ? r.mass_g
      : (typeof r.mass === 'number' ? r.mass * 1000 : 0);
    const vol = typeof r.volume_mm3 === 'number'
      ? r.volume_mm3
      : (typeof r.volume === 'number' ? r.volume : 0);
    const cost = typeof r.cost === 'number' ? r.cost : 0;
    totalMassG += massG;
    totalCost  += cost * (r.qty || 1);
    lines.push([
      csvCell(r.name),
      csvCell(r.qty ?? 1),
      csvCell(r.material ?? ''),
      csvCell(massG.toFixed(3)),
      csvCell(vol.toFixed(3)),
      csvCell(cost),
    ].join(','));
  }
  const csv = lines.join('\n') + '\n';
  zip.file('bom/bill-of-materials.csv', csv);
  manifestBom.path = 'bom/bill-of-materials.csv';
  manifestBom.rows = rows.length;
  manifestBom.totalMassG = Number(totalMassG.toFixed(3));
  manifestBom.totalCost  = Number(totalCost.toFixed(2));
  manifestBom.status = 'ok';
}

function addCam(zip, camOps, manifestCam) {
  zip.folder('cam');
  const forge = (typeof window !== 'undefined' ? window.forge : null);
  for (const op of camOps || []) {
    if (!op) continue;
    const opName = safeName(op.name || op.id || 'op');
    const dialect = op.dialect || 'iso';
    const filename = `cam/${opName}-${safeName(String(dialect))}.nc`;
    try {
      let code = null;
      if (typeof op.gcode === 'string' && op.gcode.length > 0) {
        code = op.gcode;
      } else if (op.toolpath && forge?.cam?.gcode?.toGcode) {
        const safeZ = typeof op.safeZ === 'number' ? op.safeZ : 25;
        code = forge.cam.gcode.toGcode(op.toolpath, op.dialect, safeZ);
      }
      if (code == null) throw new Error('no toolpath or g-code');
      zip.file(filename, code);
      manifestCam.push({
        id: op.id ?? null,
        name: opName,
        dialect,
        path: filename,
        bytes: code.length,
        moveCount: op.toolpath?.moveCount ?? null,
        status: 'ok',
      });
    } catch (err) {
      manifestCam.push({
        id: op.id ?? null, name: opName, dialect, status: 'failed', error: err.message,
      });
    }
  }
}

function addSimulations(zip, simulations, manifestSim) {
  zip.folder('simulations');
  for (const s of simulations || []) {
    if (!s) continue;
    const name = safeName(s.name || s.id || 'study');
    try {
      const payload = {
        name,
        type: s.type || null,
        material: s.material || null,
        stressField:    s.stressField    ?? null,
        modal:          s.modal           ?? null,
        frequencies:    s.frequencies     ?? null,
        dynamicTimeline: s.dynamicTimeline ?? s.dynamic ?? null,
        thermal:        s.thermal         ?? null,
        fatigue:        s.fatigue         ?? null,
        buckling:       s.buckling        ?? null,
        loads:          s.loads           ?? null,
        bcs:            s.bcs             ?? null,
        mesh: s.mesh ? { nodeCount: s.mesh.nodeCount ?? null,
                         elemCount: s.mesh.elemCount ?? null } : null,
        runAt: s.runAt || null,
      };
      const json = JSON.stringify(payload, null, 2);
      zip.file(`simulations/${name}.json`, json);
      manifestSim.push({
        id: s.id ?? null,
        name,
        type: s.type || null,
        path: `simulations/${name}.json`,
        bytes: json.length,
        status: 'ok',
      });
    } catch (err) {
      manifestSim.push({
        id: s.id ?? null, name, status: 'failed', error: err.message,
      });
    }
  }
}

function addConfigurations(zip, configurations, manifestCfg) {
  zip.folder('configurations');
  const cfg = configurations ?? { active: 'default', configs: {} };
  const json = JSON.stringify(cfg, null, 2);
  zip.file('configurations/configurations.json', json);
  manifestCfg.path = 'configurations/configurations.json';
  manifestCfg.bytes = json.length;
  manifestCfg.active = cfg.active ?? null;
  manifestCfg.count = cfg.configs ? Object.keys(cfg.configs).length : 0;
  manifestCfg.status = 'ok';
}

// ────────────────────────────────────────────── public API

/**
 * Build a project-bundle ZIP in renderer memory.
 *
 * @param {object} args
 * @param {string} args.projectName             — display name baked into the manifest
 * @param {Array}  args.bodies                  — [{ id, name, handle, ... }]
 * @param {Array}  args.featureTree             — feature nodes (optional, embedded in manifest)
 * @param {object} args.configurations          — { active, configs:{ name:{overrides,suppress} } }
 * @param {Array}  args.drawings                — [{ id, name, edges, direction, svg? }]
 * @param {Array}  args.simulations             — [{ id, name, type, stressField, ... }]
 * @param {Array}  args.camOps                  — [{ id, name, dialect, toolpath, gcode? }]
 * @param {Array}  args.bom                     — [{ name, qty, material, mass | mass_g, ... }]
 * @param {string} [args.filepath]              — pre-resolved save path. If absent the
 *                                                caller is expected to invoke saveFile()
 *                                                themselves and pass it in.
 * @param {object} [args.sections]              — { cad, drawings, bom, cam, sim, configs }
 *                                                booleans; default everything on.
 *
 * @returns {Promise<{ ok:boolean, path?:string, bytes?:number,
 *                     manifest?:object, error?:string }>}
 */
export async function exportProjectBundle(args) {
  const {
    projectName = 'Untitled Project',
    bodies = [],
    featureTree = [],
    configurations = null,
    drawings = [],
    simulations = [],
    camOps = [],
    bom = [],
    filepath = null,
    sections = { cad: true, drawings: true, bom: true, cam: true, sim: true, configs: true },
  } = args || {};

  const forge = (typeof window !== 'undefined' ? window.forge : null);

  // Forge-114: register a progress row for the duration of the bundle build.
  // Unlike the kernel solvers we have REAL section boundaries, so we publish
  // an honest 0 / 14 / 28 / 42 / 56 / 70 / 84 / 95 / 100 % walk.
  let cancelled = false;
  const job = startJob({
    label: `Bundle · ${projectName}`,
    total: 100,
    onCancel: () => { cancelled = true; },
  });

  const tickCancelled = () => {
    if (!cancelled) return false;
    finishJob(job.id, { result: { cancelled: true } });
    return true;
  };

  try {
    updateJob(job.id, { pct: 2, message: 'Preparing manifest' });

    const zip = new JSZip();
    const manifest = {
      name: projectName,
      exportedAt: isoNow(),
      forgeVersion: FORGE_VERSION,
      kernel: forge?.version ? (() => { try { return forge.version(); } catch { return null; } })() : null,
      sections: { ...sections },
      featureTree: featureTree.map((n) => ({
        id: n.id, label: n.label, suppressed: !!n.suppressed,
        params: n.params || {},
      })),
      bodies: [],
      drawings: [],
      cam: [],
      sim: [],
      configurations: {},
      bom: {},
      totals: {},
    };

    if (sections.cad) {
      updateJob(job.id, { pct: 12, message: 'Exporting CAD (STEP / STL / BREP)' });
      await addCadFiles(zip, bodies, manifest.bodies);
      if (tickCancelled()) return { ok: false, error: 'cancelled', manifest };
    }
    if (sections.drawings) {
      updateJob(job.id, { pct: 30, message: 'Embedding drawings' });
      addDrawings(zip, drawings, manifest.drawings);
      if (tickCancelled()) return { ok: false, error: 'cancelled', manifest };
    }
    if (sections.bom) {
      updateJob(job.id, { pct: 44, message: 'Writing BOM' });
      addBom(zip, bom, manifest.bom);
      if (tickCancelled()) return { ok: false, error: 'cancelled', manifest };
    }
    if (sections.cam) {
      updateJob(job.id, { pct: 58, message: 'Posting CAM G-code' });
      addCam(zip, camOps, manifest.cam);
      if (tickCancelled()) return { ok: false, error: 'cancelled', manifest };
    }
    if (sections.sim) {
      updateJob(job.id, { pct: 72, message: 'Embedding simulations' });
      addSimulations(zip, simulations, manifest.sim);
      if (tickCancelled()) return { ok: false, error: 'cancelled', manifest };
    }
    if (sections.configs) {
      updateJob(job.id, { pct: 82, message: 'Writing configurations' });
      addConfigurations(zip, configurations, manifest.configurations);
      if (tickCancelled()) return { ok: false, error: 'cancelled', manifest };
    }

    manifest.totals = {
      bodies:         manifest.bodies.length,
      drawings:       manifest.drawings.length,
      cam:            manifest.cam.length,
      sim:            manifest.sim.length,
      bomRows:        manifest.bom.rows || 0,
      configurations: manifest.configurations.count || 0,
    };

    // manifest goes last so it sees the real per-section results.
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    updateJob(job.id, { pct: 90, message: 'Compressing ZIP' });

    // Generate the binary blob (Uint8Array — no Blob needed; preload uses bytes).
    const u8 = await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    if (tickCancelled()) return { ok: false, error: 'cancelled', manifest };

    updateJob(job.id, { pct: 96, message: 'Writing to disk' });

    // Resolve save path: caller can pass `filepath`, or we prompt now.
    let outPath = filepath;
    if (!outPath) {
      if (!forge?.dialog?.saveFile) {
        finishJob(job.id, { result: { error: 'no save dialog' } });
        return { ok: false, error: 'no save dialog available', manifest };
      }
      outPath = await forge.dialog.saveFile({
        title: 'Export Project Bundle',
        defaultPath: `${safeName(projectName)}-bundle.zip`,
        filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
      });
      if (!outPath) {
        finishJob(job.id, { result: { cancelled: true } });
        return { ok: false, error: 'cancelled', manifest };
      }
    }

    // Ship the bytes to disk via the preload bridge.
    if (!forge?.dialog?.writeBlob) {
      finishJob(job.id, { result: { error: 'writeBlob bridge missing' } });
      return { ok: false, error: 'writeBlob bridge missing', manifest };
    }
    const result = await forge.dialog.writeBlob(outPath, u8);
    if (!result?.ok) {
      finishJob(job.id, { result: { error: result?.error || 'writeBlob failed' } });
      return { ok: false, error: result?.error || 'writeBlob failed', manifest };
    }
    updateJob(job.id, { pct: 100, message: 'Saved' });
    finishJob(job.id, { result: { ok: true, path: result.path, bytes: result.bytes } });
    return { ok: true, path: result.path, bytes: result.bytes, manifest };
  } catch (err) {
    finishJob(job.id, { result: { error: err && err.message ? err.message : String(err) } });
    throw err;
  }
}

// Re-exports for tests and panels.
export const __test = { safeName, buildSvgFromProjection, csvCell };
