/**
 * GE9X build — tiny 2-D rasteriser into an RGBA buffer.
 * Just enough to draw the engine animation frames: filled circles,
 * rings, polygons, lines and a radial-gradient background.
 */

export function makeCanvas(w, h, bg = [14, 16, 22, 255]) {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = bg[0]; px[i * 4 + 1] = bg[1]; px[i * 4 + 2] = bg[2]; px[i * 4 + 3] = bg[3];
  }
  return { w, h, px };
}

function blend(c, x, y, col, alpha = 1) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  const a = alpha;
  c.px[i] = c.px[i] * (1 - a) + col[0] * a;
  c.px[i + 1] = c.px[i + 1] * (1 - a) + col[1] * a;
  c.px[i + 2] = c.px[i + 2] * (1 - a) + col[2] * a;
  c.px[i + 3] = 255;
}

export function fillRect(c, x0, y0, x1, y1, col) {
  for (let y = Math.max(0, y0 | 0); y < Math.min(c.h, y1 | 0); y++)
    for (let x = Math.max(0, x0 | 0); x < Math.min(c.w, x1 | 0); x++) blend(c, x, y, col);
}

export function fillCircle(c, cx, cy, r, col) {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d <= r2) blend(c, x, y, col);
      else if (d <= (r + 1) ** 2) blend(c, x, y, col, 0.4);   // soft edge
    }
}

export function ring(c, cx, cy, rInner, rOuter, col) {
  const ro2 = rOuter * rOuter, ri2 = rInner * rInner;
  for (let y = Math.floor(cy - rOuter); y <= Math.ceil(cy + rOuter); y++)
    for (let x = Math.floor(cx - rOuter); x <= Math.ceil(cx + rOuter); x++) {
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d <= ro2 && d >= ri2) blend(c, x, y, col);
    }
}

/** Filled convex/simple polygon via scanline. pts = [[x,y],...]. */
export function fillPoly(c, pts, col, alpha = 1) {
  let ymin = Infinity, ymax = -Infinity;
  for (const p of pts) { ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); }
  for (let y = Math.max(0, Math.floor(ymin)); y <= Math.min(c.h - 1, Math.ceil(ymax)); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(c.w - 1, Math.floor(xs[k + 1])); x++) {
        blend(c, x, y, col, alpha);
      }
    }
  }
}

export function line(c, x0, y0, x1, y1, col, width = 1) {
  const dx = x1 - x0, dy = y1 - y0;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  for (let i = 0; i <= n; i++) {
    const x = x0 + dx * i / n, y = y0 + dy * i / n;
    if (width <= 1) blend(c, Math.round(x), Math.round(y), col);
    else fillCircle(c, x, y, width / 2, col);
  }
}

/** Encode the canvas to a PNG Buffer. */
export { encodePNG } from './pnglib.mjs';
