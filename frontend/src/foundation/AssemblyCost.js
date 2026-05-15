/**
 * ArchDisc Foundation — Assembly-level cost rollup.
 *
 * Takes a list of registered bodies (BodyRegistry entries) and
 * applies the same per-part cost formula as the single-body
 * Cost Estimation tool:
 *
 *   material  = mass × $/kg   (Al-6061-T6 at $4.50/kg by default)
 *   CNC       = (A_surface_mm² / 100) min × $/hr  (rough rule:
 *               100 mm² of finished surface ≈ 1 minute of cutting)
 *   setup     = flat per-part (default $30 — soft jaws + offset
 *               touch-off per fresh fixture)
 *   finish    = flat per-part (default $5 — light deburr + edge
 *               break)
 *   subtotal  = material + CNC + setup + finish
 *   sellPrice = total × (1 + margin)
 *
 * Defaults reproduce the original ToolExecutionEngine handler
 * numbers exactly. Override any rate via the `opts` arg so the AI
 * chat (or a plan step) can quote in different materials / margins
 * without forking the formula.
 */

const DEFAULTS = {
  density_kg_per_m3: 2700,    // Al 6061-T6
  materialRate_per_kg: 4.5,
  cncRate_per_hr: 90,
  setupPerPart: 30,
  finishPerPart: 5,
  margin: 0.25,
  // 100 mm² of finished surface ≈ 1 min (60 s) of cutting
  cncSurfaceRate_mm2_per_min: 100,
};

/**
 * Roll up cost across an array of bodies. Each body must expose
 *   { id, name, sourceTool?, manifold } where manifold has
 *   .volume() and .surfaceArea().
 */
export function rollupAssemblyCost(bodies, opts = {}) {
  const c = { ...DEFAULTS, ...opts };
  if (!bodies || bodies.length === 0) {
    return {
      lineItems: [],
      totals: {
        partCount: 0, mass_kg: 0,
        materialCost: 0, cncCost: 0, setupCost: 0, finishCost: 0,
        totalCost: 0, sellPrice: 0, marginPct: c.margin * 100,
      },
    };
  }

  const lineItems = bodies.map((b) => {
    let Vmm3 = 0, Amm2 = 0;
    if (b.volume_mm3 != null) Vmm3 = b.volume_mm3;
    else try { Vmm3 = b.manifold?.volume?.() ?? 0; } catch {}
    try { Amm2 = b.manifold?.surfaceArea?.() ?? 0; } catch {}

    const massKg = (Vmm3 * 1e-9) * c.density_kg_per_m3;
    const cncTimeHr = (Amm2 / c.cncSurfaceRate_mm2_per_min) / 60;
    const materialCost = massKg * c.materialRate_per_kg;
    const cncCost = cncTimeHr * c.cncRate_per_hr;
    return {
      bodyId: b.id, name: b.name, sourceTool: b.sourceTool ?? null,
      volume_mm3: Vmm3, surfaceArea_mm2: Amm2,
      mass_kg: massKg, cncTime_hr: cncTimeHr,
      materialCost, cncCost,
      setupCost: c.setupPerPart, finishCost: c.finishPerPart,
      subtotal: materialCost + cncCost + c.setupPerPart + c.finishPerPart,
    };
  });

  const sum = (k) => lineItems.reduce((s, l) => s + l[k], 0);
  const totals = {
    partCount: lineItems.length,
    mass_kg: sum('mass_kg'),
    materialCost: sum('materialCost'),
    cncCost: sum('cncCost'),
    setupCost: sum('setupCost'),
    finishCost: sum('finishCost'),
    totalCost: sum('subtotal'),
    marginPct: c.margin * 100,
  };
  totals.sellPrice = totals.totalCost * (1 + c.margin);
  return { lineItems, totals };
}
