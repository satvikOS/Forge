/**
 * ArchDisc Foundation — surface curvature & continuity analysis.
 *
 * Operates on NURBSSurface (via evalDerivatives2). Provides the
 * differential-geometry layer that class-A surfacing depends on:
 *
 *   • First & second fundamental forms.
 *   • Gaussian / mean / principal curvature.
 *   • G0 / G1 / G2 continuity checking across a shared edge — the test
 *     that decides whether two patches join smoothly enough for an
 *     aesthetic surface.
 *   • Isophote (reflection-line / zebra) values — the scalar a zebra-
 *     stripe render is banded from; an isophote is continuous across a
 *     G1 join and kink-free across a G2 join.
 *
 * Honest scope: this is the curvature ANALYSIS toolkit. It is not a
 * class-A modelling WORKFLOW (interactive curvature-comb editing,
 * surface matching) — that remains a larger build.
 *
 * Kernel-free pure math — node-importable for e2e.
 */

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * First and second fundamental forms from the surface derivatives
 * { S, Su, Sv, Suu, Suv, Svv, normal } returned by evalDerivatives2.
 */
export function fundamentalForms(d) {
  return {
    E: dot(d.Su, d.Su), F: dot(d.Su, d.Sv), G: dot(d.Sv, d.Sv),
    L: dot(d.Suu, d.normal), M: dot(d.Suv, d.normal), N: dot(d.Svv, d.normal),
  };
}

/**
 * Gaussian, mean and principal curvatures from the surface derivatives.
 * Gaussian curvature is orientation-independent; mean and principal
 * curvatures flip sign with the normal.
 *
 * @returns {{ gaussian, mean, k1, k2 }}
 */
export function curvature(d) {
  const { E, F, G, L, M, N } = fundamentalForms(d);
  const denom = E * G - F * F;
  if (Math.abs(denom) < 1e-14) return { gaussian: 0, mean: 0, k1: 0, k2: 0 };
  const gaussian = (L * N - M * M) / denom;
  const mean = (E * N - 2 * F * M + G * L) / (2 * denom);
  const disc = Math.sqrt(Math.max(0, mean * mean - gaussian));
  return { gaussian, mean, k1: mean + disc, k2: mean - disc };
}

/** Curvature of a NURBSSurface at parameter (u,v). */
export function surfaceCurvature(surface, u, v) {
  return curvature(surface.evalDerivatives2(u, v));
}

/**
 * Isophote / zebra scalar at a point: the cosine between the surface
 * normal and a light direction. Zebra stripes are bands of this value;
 * it is continuous iff the join is at least G1.
 */
export function isophoteValue(normal, lightDir = [0, 0, 1]) {
  const n = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  return dot(normal, [lightDir[0] / n, lightDir[1] / n, lightDir[2] / n]);
}

/**
 * G0 / G1 / G2 continuity across a shared edge between two surfaces.
 * `paramA(t)` / `paramB(t)`, t ∈ [0,1], give the (u,v) coordinates of
 * the shared edge on each surface.
 *
 *   G0 — positions coincide along the edge.
 *   G1 — tangent planes coincide (normals collinear).
 *   G2 — curvature also matches (Gaussian + |mean|, both
 *        orientation-independent).
 *
 * @returns {{ g0, g1, g2, maxPositionGap, minNormalAlignment,
 *             maxGaussianGap, maxMeanGap }}
 */
export function continuityCheck(surfA, paramA, surfB, paramB, opts = {}) {
  const n = opts.samples ?? 12;
  const tolPos = opts.tolPosition ?? 1e-6;
  const tolNormal = opts.tolNormal ?? 1e-6;
  const tolCurv = opts.tolCurvature ?? 1e-4;

  let maxPositionGap = 0, minNormalAlignment = 1;
  let maxGaussianGap = 0, maxMeanGap = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [uA, vA] = paramA(t);
    const [uB, vB] = paramB(t);
    const dA = surfA.evalDerivatives2(uA, vA);
    const dB = surfB.evalDerivatives2(uB, vB);
    maxPositionGap = Math.max(maxPositionGap, Math.hypot(
      dA.S[0] - dB.S[0], dA.S[1] - dB.S[1], dA.S[2] - dB.S[2]));
    minNormalAlignment = Math.min(minNormalAlignment, Math.abs(dot(dA.normal, dB.normal)));
    const cA = curvature(dA), cB = curvature(dB);
    maxGaussianGap = Math.max(maxGaussianGap, Math.abs(cA.gaussian - cB.gaussian));
    maxMeanGap = Math.max(maxMeanGap, Math.abs(Math.abs(cA.mean) - Math.abs(cB.mean)));
  }
  const g0 = maxPositionGap < tolPos;
  const g1 = g0 && (1 - minNormalAlignment) < tolNormal;
  const g2 = g1 && maxGaussianGap < tolCurv && maxMeanGap < tolCurv;
  return { g0, g1, g2, maxPositionGap, minNormalAlignment, maxGaussianGap, maxMeanGap };
}
