/**
 * ArchDisc Foundation — project diff.
 *
 * Compares two project snapshots (the JSON payload AIChatPanel
 * persists) and produces a flat list of comparable metrics with
 * an A value, a B value, and a delta. Used by the chat's
 * side-by-side comparison table — once a user has design v1 vs v2
 * (or two vendor-tuned variants) this is the decision tool.
 *
 * Metrics extracted:
 *   - domain, plan step count
 *   - cert: total / covered / passed / failed / uncovered
 *   - DFM: errors / warnings / infos / overall
 *   - cost: parts / mass (g) / total ($) / sell ($)
 *
 * Each row: { key, label, a, b, delta, better }
 *   - delta: numeric difference (b - a) where both are numbers, else null
 *   - better: 'a' | 'b' | 'same' | null  — which side is preferable for
 *     metrics where direction has meaning (lower cost is better, more
 *     cert passes is better, fewer DFM errors is better)
 */

function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

/** Extract the comparable verdict bundle from one snapshot. */
export function extractVerdicts(snapshot) {
  if (!snapshot) return null;
  const cert = snapshot.certMatrix?.summary ?? null;
  const dfm  = snapshot.dfmReport?.summary ?? null;
  const cost = snapshot.costReport?.totals ?? null;
  return {
    domain: snapshot.domain ?? null,
    planSteps: Array.isArray(snapshot.plan) ? snapshot.plan.length : null,
    cert: cert ? {
      total: cert.total, covered: cert.covered,
      passed: cert.passed, failed: cert.failed, uncovered: cert.uncovered,
    } : null,
    dfm: dfm ? {
      errors: dfm.errors, warnings: dfm.warnings,
      infos: dfm.infos, overall: dfm.overall,
    } : null,
    cost: cost ? {
      partCount: cost.partCount,
      mass_g: (cost.mass_kg ?? 0) * 1000,
      totalCost: cost.totalCost,
      sellPrice: cost.sellPrice,
    } : null,
  };
}

/**
 * @param {object} projA  { name, snapshot }
 * @param {object} projB  { name, snapshot }
 * @returns {{ a, b, rows }}
 */
export function diffProjects(projA, projB) {
  const va = extractVerdicts(projA?.snapshot);
  const vb = extractVerdicts(projB?.snapshot);
  const rows = [];

  // direction: +1 = higher is better, -1 = lower is better, 0 = neutral
  const push = (key, label, a, b, direction = 0) => {
    const na = num(a), nb = num(b);
    let delta = null, better = null;
    if (na !== null && nb !== null) {
      delta = nb - na;
      if (direction !== 0 && delta !== 0) {
        const bWins = direction > 0 ? nb > na : nb < na;
        better = bWins ? 'b' : 'a';
      } else if (direction !== 0) {
        better = 'same';
      }
    }
    rows.push({ key, label, a: a ?? '—', b: b ?? '—', delta, better });
  };

  push('domain', 'Domain', va?.domain, vb?.domain, 0);
  push('planSteps', 'Plan steps', va?.planSteps, vb?.planSteps, 0);

  push('certPassed', 'Cert rules passed', va?.cert?.passed, vb?.cert?.passed, +1);
  push('certFailed', 'Cert rules failed', va?.cert?.failed, vb?.cert?.failed, -1);
  push('certUncovered', 'Cert uncovered', va?.cert?.uncovered, vb?.cert?.uncovered, -1);

  push('dfmErrors', 'DFM errors', va?.dfm?.errors, vb?.dfm?.errors, -1);
  push('dfmWarnings', 'DFM warnings', va?.dfm?.warnings, vb?.dfm?.warnings, -1);
  push('dfmOverall', 'DFM verdict', va?.dfm?.overall, vb?.dfm?.overall, 0);

  push('costParts', 'Part count', va?.cost?.partCount, vb?.cost?.partCount, 0);
  push('costMass', 'Mass (g)', round1(va?.cost?.mass_g), round1(vb?.cost?.mass_g), -1);
  push('costTotal', 'Total cost ($)', round2(va?.cost?.totalCost), round2(vb?.cost?.totalCost), -1);
  push('costSell', 'Sell price ($)', round2(va?.cost?.sellPrice), round2(vb?.cost?.sellPrice), -1);

  return {
    a: { name: projA?.name ?? 'Project A', verdicts: va },
    b: { name: projB?.name ?? 'Project B', verdicts: vb },
    rows,
  };
}

function round1(v) { return num(v) === null ? v : Math.round(v * 10) / 10; }
function round2(v) { return num(v) === null ? v : Math.round(v * 100) / 100; }
