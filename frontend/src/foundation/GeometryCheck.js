/**
 * ArchDisc Foundation — geometry diagnostics for manifold bodies.
 *
 * A real check, not a canned string. Inspects a manifold-3d
 * Manifold and the triangle mesh it carries:
 *
 *   - status   : manifold-3d's own error code (NoError = watertight,
 *                topologically valid). The single most important
 *                gate — a non-NoError body will fail booleans / export.
 *   - empty    : zero-volume / no geometry.
 *   - volume   : signed; a valid solid has positive volume. A
 *                negative volume means inverted face winding.
 *   - genus    : topological hole count (0 = simply connected).
 *   - euler    : V − E + F. For a closed orientable manifold this
 *                must equal 2·(1 − genus); a mismatch flags a
 *                topology defect even when status looks clean.
 *   - degenerateTriangles : zero-area (collinear) triangles in the
 *                mesh — these break downstream meshing / FEA.
 *   - bbox, counts.
 *
 * Returns { ok, severity, findings[], metrics } — severity is the
 * worst finding ('error' | 'warn' | 'info' | 'pass').
 */

export function inspectManifold(manifold) {
  if (!manifold) {
    return { ok: false, severity: 'error',
      findings: [{ severity: 'error', code: 'GEOM-NULL', text: 'No body to check.' }],
      metrics: {} };
  }
  const findings = [];
  const metrics = {};

  // ── manifold-3d status code ────────────────────────────────
  // status() varies by binding: a number (0 = NoError), the string
  // 'NoError', or an enum object {value}. Treat all NoError forms
  // as healthy; anything else is a genuine topology fault.
  try {
    const st = manifold.status?.();
    const code = (st && typeof st === 'object') ? st.value : st;
    metrics.statusCode = code ?? 'NoError';
    const healthy =
      code === undefined || code === null ||
      code === 0 ||
      (typeof code === 'string' && /no.?error/i.test(code));
    if (!healthy) {
      findings.push({ severity: 'error', code: 'GEOM-STATUS',
        text: `manifold-3d reports a non-watertight / invalid body (status ${code}).` });
    }
  } catch { /* status() not available on this build — rely on the rest */ }

  // ── empty ──────────────────────────────────────────────────
  let empty = false;
  try { empty = manifold.isEmpty?.() ?? false; } catch {}
  if (empty) {
    findings.push({ severity: 'error', code: 'GEOM-EMPTY', text: 'Body is empty (no geometry).' });
  }

  // ── volume + orientation ───────────────────────────────────
  let volume = 0;
  try { volume = manifold.volume(); } catch {}
  metrics.volume_mm3 = volume;
  if (!empty && volume <= 0) {
    findings.push({ severity: 'error', code: 'GEOM-INVERTED',
      text: `Volume is ${volume.toFixed(2)} mm³ — non-positive volume means inverted face winding.` });
  }

  // ── surface area ───────────────────────────────────────────
  try { metrics.surfaceArea_mm2 = manifold.surfaceArea(); } catch { metrics.surfaceArea_mm2 = 0; }

  // ── genus ──────────────────────────────────────────────────
  let genus = 0;
  try { genus = manifold.genus?.() ?? 0; } catch {}
  metrics.genus = genus;
  if (genus > 0) {
    findings.push({ severity: 'info', code: 'GEOM-GENUS',
      text: `Topological genus ${genus} — the body has ${genus} through-hole${genus === 1 ? '' : 's'} / handle${genus === 1 ? '' : 's'}.` });
  }

  // ── mesh-level counts + degenerate triangles + Euler ───────
  let degenerate = 0, triCount = 0, vertCount = 0;
  try {
    const mesh = manifold.getMesh();
    const np = mesh.numProp;
    const verts = mesh.vertProperties;
    vertCount = verts.length / np;
    triCount = mesh.triVerts.length / 3;
    for (let t = 0; t < triCount; t++) {
      const a = mesh.triVerts[t * 3], b = mesh.triVerts[t * 3 + 1], c = mesh.triVerts[t * 3 + 2];
      const ax = verts[a * np], ay = verts[a * np + 1], az = verts[a * np + 2];
      const bx = verts[b * np], by = verts[b * np + 1], bz = verts[b * np + 2];
      const cx = verts[c * np], cy = verts[c * np + 1], cz = verts[c * np + 2];
      // Cross-product magnitude = 2·area.
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (Math.hypot(nx, ny, nz) < 1e-9) degenerate++;
    }
  } catch {}
  metrics.vertexCount = vertCount;
  metrics.triangleCount = triCount;
  metrics.degenerateTriangles = degenerate;
  if (degenerate > 0) {
    findings.push({ severity: 'warn', code: 'GEOM-DEGEN',
      text: `${degenerate} degenerate (zero-area) triangle${degenerate === 1 ? '' : 's'} — these break downstream meshing / FEA.` });
  }

  // A closed triangle mesh has E = 3F/2 → Euler V − E + F = V − F/2.
  const euler = vertCount - triCount / 2;
  metrics.eulerCharacteristic = euler;
  const expectedEuler = 2 * (1 - genus);
  if (triCount > 0 && Math.abs(euler - expectedEuler) > 0.5) {
    findings.push({ severity: 'error', code: 'GEOM-EULER',
      text: `Euler characteristic ${euler} ≠ expected ${expectedEuler} for genus ${genus} — topology defect.` });
  }

  // ── bounding box ───────────────────────────────────────────
  try {
    const bb = manifold.boundingBox();
    metrics.bbox = {
      min: bb.min, max: bb.max,
      size: [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]],
    };
  } catch {}

  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warn').length;
  const infos = findings.filter(f => f.severity === 'info').length;
  const severity = errors > 0 ? 'error' : warnings > 0 ? 'warn' : infos > 0 ? 'info' : 'pass';
  if (severity === 'pass') {
    findings.push({ severity: 'pass', code: 'GEOM-OK',
      text: 'Watertight, correctly oriented, no degenerate triangles, topology consistent.' });
  }

  return {
    ok: errors === 0,
    severity,
    findings,
    metrics,
    summary: { errors, warnings, infos },
  };
}
