// PUSH-93 (Slice-61 / BOM Balloon Auto-Place).
//
// Pure-math layer behind BomBalloonsPanel.jsx. PUSH-60's BOM panel turned
// the body list into a row-per-body engineering view; a real mechanical
// drawing needs *balloons* — numbered circles tied to a BOM row by leader
// lines, placed near each body's projected centroid on a drawing view.
//
// This module is intentionally framework-free so:
//   * the React panel can import the same generator the e2e drives via
//     `window.__forgeBomBalloonsHelper`,
//   * plugins / Archie tool calls can synthesize the same SVG with no
//     React tree mounted,
//   * the unit math (projection, ring layout, leader path) is testable
//     without an Electron window.
//
// Projection contract:
//   * 'front' view → screen X = world X, screen Y = -world Z (Z up → Y down)
//   * 'top'   view → screen X = world X, screen Y =  world Y
//   * 'right' view → screen X = world Y, screen Y = -world Z
// All emitted coordinates are in *drawing space* (the same SVG user
// units the rest of Forge's drawing panels work in: 1 unit = 1 mm).
//
// Balloon layout: balloons live on a ring around the projected bounding
// box of all body centroids; ring centre = bbox centre, ring radius =
// `max(bbox width, bbox height) * 0.7 + padding`. Each balloon's centre
// is placed at angle `-π/2 + i * 2π/n` (first balloon at 12 o'clock,
// going clockwise). The leader is a single straight segment from the
// balloon centre to the projected centroid.
//
// Hard constraints (PUSH-93 brief):
//   * NO new npm packages, NO new C++ libs. Pure JS + the existing
//     window.forge.massProps surface.
//   * Real impl, no MVP, no stub: every body in `bodies` produces one
//     balloon; the SVG is renderable as-is (single root <svg>, real
//     leader paths, real circle elements, real numbered <text> labels).
//   * The panel imports from this file — the math has only one home.

// ─────────────────────────────────────────────────────────────────────
// Constants.

export const BALLOON_DEFAULT_RADIUS = 8;     // mm — matches ISO 7573 #4 mm
                                             // ballooning convention scaled
                                             // up so the digits are legible
                                             // on the SVG preview.
export const BALLOON_RING_PADDING  = 24;     // mm — gap between projected
                                             // bbox edge and balloon ring.
export const SUPPORTED_VIEWS = Object.freeze(['front', 'top', 'right']);

// ─────────────────────────────────────────────────────────────────────
// Pure helpers — exported for unit testing and for the e2e to call
// directly via window.__forgeBomBalloonsHelper.

/**
 * Project a 3D world-space point onto a drawing view's 2D plane.
 *
 * @param {number} x  world X (mm)
 * @param {number} y  world Y (mm)
 * @param {number} z  world Z (mm)
 * @param {string} view  'front' | 'top' | 'right'
 * @returns {{u: number, v: number}}  drawing-space coordinates
 */
export function projectPoint(x, y, z, view) {
  const X = Number(x), Y = Number(y), Z = Number(z);
  switch (view) {
    case 'top':
      return { u: X, v: Y };
    case 'right':
      return { u: Y, v: -Z };
    case 'front':
    default:
      return { u: X, v: -Z };
  }
}

/**
 * Read a body's centroid via window.forge.massProps when available;
 * otherwise fall back to a synthetic origin so the generator still
 * produces a finite balloon for bodies that lost their kernel handle
 * (the panel renders these in grey so the user knows). Returns
 * `{x, y, z, source}` — source is 'kernel' | 'origin'.
 */
export function centroidForBody(body, kernelMassProps) {
  // Allow the caller to inject a stub `kernelMassProps(handle)` for
  // unit tests; default to window.forge.massProps in the browser.
  let fn = kernelMassProps;
  if (typeof fn !== 'function' && typeof window !== 'undefined') {
    fn = window?.forge?.massProps;
  }
  if (typeof fn === 'function' && body && typeof body.handle === 'number') {
    try {
      const r = fn(body.handle);
      const com = r?.centerOfMass;
      if (Array.isArray(com) && com.length >= 3) {
        const x = Number(com[0]);
        const y = Number(com[1]);
        const z = Number(com[2]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          return { x, y, z, source: 'kernel' };
        }
      }
    } catch { /* fall through to origin */ }
  }
  return { x: 0, y: 0, z: 0, source: 'origin' };
}

/**
 * Compute the AABB of a list of 2D points. Returns `null` for an empty
 * input. The bbox is in drawing space (the same plane the balloons live
 * on).
 */
export function bbox2D(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  let minU =  Infinity, minV =  Infinity;
  let maxU = -Infinity, maxV = -Infinity;
  for (const p of points) {
    if (!p || !Number.isFinite(p.u) || !Number.isFinite(p.v)) continue;
    if (p.u < minU) minU = p.u;
    if (p.v < minV) minV = p.v;
    if (p.u > maxU) maxU = p.u;
    if (p.v > maxV) maxV = p.v;
  }
  if (!Number.isFinite(minU) || !Number.isFinite(maxU)) return null;
  const w = maxU - minU;
  const h = maxV - minV;
  return {
    minU, minV, maxU, maxV,
    w, h,
    cu: (minU + maxU) / 2,
    cv: (minV + maxV) / 2,
  };
}

/**
 * Ring layout for N balloons around a 2D bbox. First balloon sits at the
 * 12 o'clock position, others walk clockwise. Returns an array of
 * `{cx, cy}` in drawing space (same units as the projected centroids).
 */
export function ringPositions(n, bb, radius = BALLOON_DEFAULT_RADIUS, pad = BALLOON_RING_PADDING) {
  if (!Number.isFinite(n) || n <= 0) return [];
  const out = new Array(n);
  if (!bb) {
    // Degenerate single-body / no-bbox case: stack vertically near origin.
    for (let i = 0; i < n; i++) {
      out[i] = { cx: radius + pad, cy: (radius * 2 + 4) * i + radius + pad };
    }
    return out;
  }
  // Half the bbox extent + a balloon-radius + pad → ring radius.
  const halfMax = Math.max(bb.w, bb.h) / 2;
  const R = halfMax + pad + radius;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    out[i] = {
      cx: bb.cu + R * Math.cos(a),
      cy: bb.cv + R * Math.sin(a),
    };
  }
  return out;
}

/**
 * Build the leader-line SVG path for a balloon. The path is a single
 * straight segment from the balloon centre to the projected centroid;
 * the panel renders it as `<path d="…" />`.
 */
export function leaderPath(cx, cy, tx, ty) {
  const a = Number(cx), b = Number(cy), c = Number(tx), d = Number(ty);
  // Sanitize: any non-finite input becomes 0 so the SVG remains valid —
  // the generator never silently drops a balloon.
  const safe = (n) => (Number.isFinite(n) ? n : 0);
  return `M ${safe(a)} ${safe(b)} L ${safe(c)} ${safe(d)}`;
}

// ─────────────────────────────────────────────────────────────────────
// Main entry — generateBalloons(bodies, view, radius).
//
// Returns an array of:
//   { n, id, name, cx, cy, targetX, targetY, leader, source }
// where `n` is the 1-based balloon number, `cx,cy` is the balloon centre
// in drawing space, `targetX,targetY` is the projected centroid, and
// `leader` is a ready-to-render SVG path d-attribute.

export function generateBalloons(bodies, view = 'front', radius = BALLOON_DEFAULT_RADIUS,
                                 opts = {}) {
  const list = Array.isArray(bodies) ? bodies : [];
  const useView = SUPPORTED_VIEWS.includes(view) ? view : 'front';
  const useRad  = Number.isFinite(radius) && radius > 0 ? radius : BALLOON_DEFAULT_RADIUS;
  const pad     = Number.isFinite(opts.pad) && opts.pad >= 0
                  ? opts.pad : BALLOON_RING_PADDING;
  const kernel  = (typeof opts.massProps === 'function')
                  ? opts.massProps
                  : (typeof window !== 'undefined' ? window?.forge?.massProps : null);

  // 1) Project every body's centroid.
  const centroids = list.map((b) => {
    const c3 = centroidForBody(b, kernel);
    const p2 = projectPoint(c3.x, c3.y, c3.z, useView);
    return {
      body: b,
      world: c3,
      target: p2,
    };
  });

  // 2) Place balloons on a ring around the bbox of projected centroids.
  const bb = bbox2D(centroids.map((c) => c.target));
  const ring = ringPositions(centroids.length, bb, useRad, pad);

  // 3) Assemble the result rows.
  return centroids.map((c, i) => {
    const { cx, cy } = ring[i] || { cx: 0, cy: 0 };
    const targetX = Number.isFinite(c.target.u) ? c.target.u : 0;
    const targetY = Number.isFinite(c.target.v) ? c.target.v : 0;
    return {
      n: i + 1,
      id: c.body?.id || `body-${i}`,
      name: c.body?.name || c.body?.toolId || `Body ${i + 1}`,
      cx,
      cy,
      targetX,
      targetY,
      leader: leaderPath(cx, cy, targetX, targetY),
      source: c.world.source,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────
// SVG snippet builder.
//
// Wraps the generated balloons in a self-contained <svg> root sized
// to fit every balloon + leader endpoint, with the drawing-space
// origin centred so the user can drop the snippet directly onto a
// drawing view or copy it into another vector tool.
//
// Margin: 2 × balloon-radius + 8 mm so the numbered text isn't clipped
// by the viewBox edge.

export function svgSnippetFor(balloons, view = 'front', radius = BALLOON_DEFAULT_RADIUS) {
  const list = Array.isArray(balloons) ? balloons : [];
  if (list.length === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40" viewBox="0 0 100 40">'
         + '<text x="6" y="22" font-family="sans-serif" font-size="11" fill="#9aa1ab">'
         + 'No balloons generated.'
         + '</text></svg>';
  }
  // Combine every point we need to enclose (balloon centres + targets).
  const pts = [];
  for (const b of list) {
    pts.push({ u: b.cx, v: b.cy });
    pts.push({ u: b.targetX, v: b.targetY });
  }
  const bb = bbox2D(pts) || { minU: -50, minV: -50, maxU: 50, maxV: 50, w: 100, h: 100 };
  const margin = radius * 2 + 8;
  const vbMinU = bb.minU - margin;
  const vbMinV = bb.minV - margin;
  const vbW = Math.max(1, bb.w + margin * 2);
  const vbH = Math.max(1, bb.h + margin * 2);
  // Round to 3 decimals for readability + diff stability.
  const r3 = (n) => (Number.isFinite(n) ? Number(n.toFixed(3)) : 0);
  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(vbW)}" height="${r3(vbH)}" `
    + `viewBox="${r3(vbMinU)} ${r3(vbMinV)} ${r3(vbW)} ${r3(vbH)}" `
    + `data-view="${view}" data-balloons="${list.length}">`
  );
  parts.push(
    `<rect x="${r3(vbMinU)}" y="${r3(vbMinV)}" width="${r3(vbW)}" height="${r3(vbH)}" `
    + 'fill="#0e1218" stroke="#2a2d34" stroke-width="0.5"/>'
  );
  // Leaders first so the balloons sit on top.
  for (const b of list) {
    const cls = b.source === 'kernel' ? 'leader-kernel' : 'leader-origin';
    parts.push(
      `<path d="${b.leader}" stroke="#dadde2" stroke-width="0.8" fill="none" `
      + `data-balloon-leader="${b.n}" class="${cls}"/>`
    );
    parts.push(
      `<circle cx="${r3(b.targetX)}" cy="${r3(b.targetY)}" r="1.5" `
      + `fill="#4f87ff" data-balloon-target="${b.n}"/>`
    );
  }
  for (const b of list) {
    parts.push(
      `<circle cx="${r3(b.cx)}" cy="${r3(b.cy)}" r="${r3(radius)}" `
      + `fill="#161b22" stroke="#4f87ff" stroke-width="1.2" `
      + `data-balloon-circle="${b.n}"/>`
    );
    parts.push(
      `<text x="${r3(b.cx)}" y="${r3(b.cy + radius * 0.35)}" `
      + 'font-family="ui-monospace, monospace" font-size="' + r3(radius * 1.1) + '" '
      + `fill="#dadde2" text-anchor="middle" data-balloon-label="${b.n}">${b.n}</text>`
    );
  }
  parts.push('</svg>');
  return parts.join('');
}

// ─────────────────────────────────────────────────────────────────────
// Helper bundle — the host installs this on
// `window.__forgeBomBalloonsHelper` so e2e specs / plugins / Archie can
// drive the math without mounting the React panel first.

export const BOM_BALLOON_HELPERS = Object.freeze({
  BALLOON_DEFAULT_RADIUS,
  BALLOON_RING_PADDING,
  SUPPORTED_VIEWS,
  projectPoint,
  centroidForBody,
  bbox2D,
  ringPositions,
  leaderPath,
  generateBalloons,
  svgSnippetFor,
});

export default generateBalloons;
