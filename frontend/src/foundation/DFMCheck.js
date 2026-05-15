/**
 * ArchDisc Foundation — Design-For-Manufacturing check.
 *
 * Takes a manifold body and produces a list of findings, each
 * tagged `info` / `warn` / `error`. Checks are deliberately
 * geometric (no need for face / feature analysis) so they run
 * cheaply on any closed manifold:
 *
 *   1. Bounding-box aspect ratio. Long / slender parts are hard
 *      to fixture and prone to chatter; aspect > 10 is amber,
 *      > 25 is red.
 *   2. Characteristic thickness t ≈ 2 V / A. For a flat plate of
 *      thickness t this is exact; for a solid blob it returns the
 *      effective radius — both are useful first-order proxies for
 *      "thinnest cross-section the part will have". Threshold:
 *      < 0.8 mm = error (machinable lower bound for Al with end-mills),
 *      < 1.5 mm = warn.
 *   3. Genus > 0 → topological holes / through-features. Not always
 *      a problem, but flagged as info so manufacturing reviewers
 *      know to look at cavity access.
 *   4. Smallest bbox dimension. Anything < 1 mm warns (CNC tool
 *      diameters bottom out around 0.5 mm and pocket depth/diameter
 *      ratios become unfavourable).
 *   5. Volume sanity: > 1000 cm³ informs the user this is a heavy
 *      billet (Al-6061 ~2.7 g/cm³ → 2.7 kg).
 *
 * Output shape:
 *   {
 *     metrics: { bbox, volume_mm3, surfaceArea_mm2, mass_kg,
 *                aspectRatio, characteristicThickness_mm,
 *                smallestDim_mm, genus },
 *     issues: Array<{ severity, code, title, detail, recommendation }>,
 *     summary: { errors, warnings, infos, overall }
 *   }
 *
 * `overall` is the worst severity in `issues` (or 'pass' if empty).
 * Drives the DFMCheckPanel traffic-light UI.
 */

const DENSITY_AL6061 = 2700;   // kg/m³

const THRESHOLDS = {
  aspectAmber: 10,
  aspectRed: 25,
  thicknessRedMm: 0.8,
  thicknessAmberMm: 1.5,
  smallestDimAmberMm: 1,
  heavyVolumeCm3: 1000,
};

export function checkManifoldDFM(manifold, opts = {}) {
  if (!manifold) return null;
  const t = { ...THRESHOLDS, ...(opts.thresholds ?? {}) };

  const bb = manifold.boundingBox();
  const dims = [
    bb.max[0] - bb.min[0],
    bb.max[1] - bb.min[1],
    bb.max[2] - bb.min[2],
  ].map(Math.abs);
  const longest = Math.max(...dims);
  const shortest = Math.min(...dims);
  const aspectRatio = shortest > 1e-9 ? longest / shortest : Infinity;

  const Vmm3 = manifold.volume();
  const Amm2 = manifold.surfaceArea();
  const massKg = (Vmm3 * 1e-9) * DENSITY_AL6061;
  // Characteristic thickness from V/A. For a thin plate this is
  // exactly the thickness (V = A_face × t, A ≈ 2 A_face → 2V/A = t).
  // For a solid blob it's the effective radius.
  const charThickness = Amm2 > 1e-9 ? (2 * Vmm3) / Amm2 : Infinity;
  let genus = 0;
  try { genus = manifold.genus?.() ?? 0; } catch { /* not all manifolds expose it */ }

  const issues = [];

  if (aspectRatio > t.aspectRed) {
    issues.push({
      severity: 'error', code: 'DFM-ASPECT',
      title: 'Extreme aspect ratio',
      detail: `Bounding-box longest/shortest = ${aspectRatio.toFixed(1)} — slender stock will deflect under cutting load.`,
      recommendation: 'Break the part into two with a press-fit join, or add a thicker rib along the long axis.',
    });
  } else if (aspectRatio > t.aspectAmber) {
    issues.push({
      severity: 'warn', code: 'DFM-ASPECT',
      title: 'High aspect ratio',
      detail: `Bounding-box longest/shortest = ${aspectRatio.toFixed(1)} — fixturing will need axial support.`,
      recommendation: 'Plan a soft-jaw fixture sized to the longest face; expect light passes.',
    });
  }

  if (charThickness < t.thicknessRedMm) {
    issues.push({
      severity: 'error', code: 'DFM-THICK',
      title: 'Wall thickness below machinable limit',
      detail: `Characteristic thickness (2V/A) = ${charThickness.toFixed(2)} mm < ${t.thicknessRedMm.toFixed(1)} mm.`,
      recommendation: 'Thicken thin walls to ≥ 1.5 mm, or switch process to sheet-metal / SLM / SLS.',
    });
  } else if (charThickness < t.thicknessAmberMm) {
    issues.push({
      severity: 'warn', code: 'DFM-THICK',
      title: 'Thin walls',
      detail: `Characteristic thickness (2V/A) = ${charThickness.toFixed(2)} mm — < ${t.thicknessAmberMm.toFixed(1)} mm threshold.`,
      recommendation: 'Consider adding ribs or increasing wall thickness for vibration tolerance.',
    });
  }

  if (shortest < t.smallestDimAmberMm) {
    issues.push({
      severity: 'warn', code: 'DFM-SMALL-FEATURE',
      title: 'Smallest dimension below typical end-mill diameter',
      detail: `Min bbox dim = ${shortest.toFixed(2)} mm — tools < 0.5 mm Ø are slow and fragile.`,
      recommendation: 'Round up the smallest feature to ≥ 1 mm or specify wire-EDM.',
    });
  }

  if (genus > 0) {
    issues.push({
      severity: 'info', code: 'DFM-GENUS',
      title: `Topological genus = ${genus}`,
      detail: 'The part has one or more through-holes / internal cavities.',
      recommendation: 'Verify cavity access for tool entry + chip evacuation; consider split-line for moulded parts.',
    });
  }

  const volumeCm3 = Vmm3 / 1000;
  if (volumeCm3 > t.heavyVolumeCm3) {
    issues.push({
      severity: 'info', code: 'DFM-HEAVY',
      title: 'Heavy stock requirement',
      detail: `Volume = ${volumeCm3.toFixed(0)} cm³ (~${massKg.toFixed(1)} kg Al billet).`,
      recommendation: 'Cost-check billet stock against near-net-shape casting or weldment.',
    });
  }

  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warn').length;
  const infos = issues.filter(i => i.severity === 'info').length;
  const overall = errors > 0 ? 'error' : warnings > 0 ? 'warn' : infos > 0 ? 'info' : 'pass';

  return {
    metrics: {
      bbox: { min: bb.min, max: bb.max, dims },
      volume_mm3: Vmm3, surfaceArea_mm2: Amm2, mass_kg: massKg,
      aspectRatio,
      characteristicThickness_mm: charThickness,
      smallestDim_mm: shortest,
      genus,
    },
    issues,
    summary: { errors, warnings, infos, overall },
  };
}
