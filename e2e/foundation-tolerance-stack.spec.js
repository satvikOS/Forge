import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'tolerance-stack');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(120000);

test.describe('Foundation tolerance stack — worst-case, RSS, Monte Carlo', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Linear 5-link chain: worst-case = Σtol, RSS = √Σtol²', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { Dimension, Stack, DIST, analyze, seededRng }
        = await import('/src/foundation/ToleranceStack.js');

      // 5 links, each 20 ± 0.05, summing in series. Output = total length.
      const inputs = [];
      for (let i = 1; i <= 5; i++) {
        inputs.push(new Dimension({
          name: `L${i}`, nominal: 20.0, tolPlus: 0.05, tolMinus: 0.05,
          distribution: DIST.NORMAL, cp: 1.0,  // Cp=1.0 → ±tol = 3σ
        }));
      }
      const stack = new Stack({
        inputs,
        compute: (v) => v.L1 + v.L2 + v.L3 + v.L4 + v.L5,
        outputName: 'TotalLength',
      });
      const rng = seededRng(42);
      const mc = stack.monteCarlo(100000, rng);
      const r = {
        nominalSum: stack.evalNominal(),
        worstCase: stack.worstCase(),
        rss: stack.rss(),
        mc,
      };
      return r;
    });

    // Analytical:
    //   Worst-case range: 5 × 0.05 = 0.25 each side → total range 0.5, ±0.25 from nominal 100
    //   RSS:               √(5 × 0.05²) = 0.05 × √5 ≈ 0.1118; ±3σ = 3 × 0.0373 = 0.1118
    //   Note: with Cp=1.0, σ_link = 0.05/3, so σ_total = √5 × 0.05/3 = 0.0373
    //   3σ_total = 0.1118

    console.log(`\n=== 5-LINK STACK VALIDATION ===`);
    console.log(`Nominal: ${result.nominalSum.toFixed(4)}`);
    console.log(`Worst-case [low, high]: [${result.worstCase.low.toFixed(4)}, ${result.worstCase.high.toFixed(4)}], range=${result.worstCase.range.toFixed(4)}`);
    console.log(`RSS σ_out: ${result.rss.sigma.toFixed(6)}, ±3σ band: [${result.rss.low3sigma.toFixed(4)}, ${result.rss.high3sigma.toFixed(4)}]`);
    console.log(`Monte Carlo: μ=${result.mc.mean.toFixed(4)}, σ=${result.mc.stddev.toFixed(6)}`);
    console.log(`             p1=${result.mc.p1.toFixed(4)}  p99=${result.mc.p99.toFixed(4)}`);

    fs.writeFileSync(path.join(ROOT, '5-link-validation.json'), JSON.stringify(result, null, 2));

    // Assertions
    // Worst-case = ±0.25
    expect(Math.abs(result.worstCase.range - 0.5)).toBeLessThan(1e-6);
    expect(Math.abs(result.worstCase.low - 99.75)).toBeLessThan(1e-6);
    expect(Math.abs(result.worstCase.high - 100.25)).toBeLessThan(1e-6);

    // RSS: σ = sqrt(5) × 0.05/3 = 0.03727
    const expectedSigma = Math.sqrt(5) * 0.05 / 3;
    expect(Math.abs(result.rss.sigma - expectedSigma)).toBeLessThan(1e-6);

    // Monte Carlo σ matches RSS σ within ~1%
    const sigmaError = Math.abs(result.mc.stddev - expectedSigma) / expectedSigma;
    expect(sigmaError).toBeLessThan(0.02);
    // Mean within 0.001 of nominal
    expect(Math.abs(result.mc.mean - 100)).toBeLessThan(0.001);
  });

  test('Hinge pin clearance fit: real engineering example', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { Dimension, Stack, DIST, seededRng }
        = await import('/src/foundation/ToleranceStack.js');

      // From M8 Hinge Bracket pair:
      //   Pin OD: Ø5.8 ± 0.05 (printed shaft, 0.05 mm typical FDM
      //                          dimensional tolerance)
      //   Knuckle bore: Ø6.0 +0.10 / -0.00 (hole tolerance class —
      //                          slightly oversized on print)
      // Required clearance: 0.05 – 0.30 mm to allow free rotation
      //                    without excessive slop.
      const pinOD = new Dimension({
        name: 'PinOD', nominal: 5.8, tolPlus: 0.05, tolMinus: 0.05,
        distribution: DIST.NORMAL, cp: 1.33,
      });
      const knuckleID = new Dimension({
        name: 'KnuckleID', nominal: 6.0, tolPlus: 0.10, tolMinus: 0.00,
        distribution: DIST.ASYMMETRIC,
      });
      const stack = new Stack({
        inputs: [pinOD, knuckleID],
        compute: (v) => v.KnuckleID - v.PinOD,
        outputName: 'DiametricalClearance',
        spec: { lsl: 0.05, usl: 0.30, target: 0.15 },
      });

      const rng = seededRng(12345);
      const mc = stack.monteCarlo(100000, rng);
      return {
        nominal: stack.evalNominal(),
        worstCase: stack.worstCase(),
        rss: stack.rss(),
        mc,
      };
    });

    console.log(`\n=== HINGE PIN CLEARANCE — TOLERANCE STACK ===`);
    console.log(`Nominal clearance: ${result.nominal.toFixed(3)} mm`);
    console.log(`Worst-case range: [${result.worstCase.low.toFixed(3)}, ${result.worstCase.high.toFixed(3)}] mm`);
    console.log(`RSS ±3σ: [${result.rss.low3sigma.toFixed(3)}, ${result.rss.high3sigma.toFixed(3)}] mm`);
    console.log(`Monte Carlo:`);
    console.log(`  μ=${result.mc.mean.toFixed(3)}, σ=${result.mc.stddev.toFixed(4)}`);
    console.log(`  p1=${result.mc.p1.toFixed(3)}, p50=${result.mc.p50.toFixed(3)}, p99=${result.mc.p99.toFixed(3)} mm`);
    console.log(`  Spec: [LSL ${result.mc.spec.lsl}, USL ${result.mc.spec.usl}] mm`);
    console.log(`  Out-of-spec: ${result.mc.outOfSpec}/${result.mc.N} (${result.mc.defectsPerMillion.toFixed(0)} ppm)`);
    if (result.mc.Cp != null)
      console.log(`  Cp = ${result.mc.Cp.toFixed(2)}, Cpk = ${result.mc.Cpk.toFixed(2)}`);

    fs.writeFileSync(path.join(ROOT, 'hinge-pin-clearance.json'), JSON.stringify(result, null, 2));

    // Sanity checks
    expect(result.nominal).toBeCloseTo(0.20, 3);                 // 6.0 - 5.8
    // Worst-case clearance should be within 0..0.30 (positive ⇒ no interference)
    expect(result.worstCase.low).toBeGreaterThan(0);
    expect(result.worstCase.low).toBeCloseTo(0.15, 3);           // 6.00 - 5.85
    expect(result.worstCase.high).toBeCloseTo(0.35, 3);          // 6.10 - 5.75
    // MC stats
    expect(result.mc.mean).toBeGreaterThan(0.18);
    expect(result.mc.mean).toBeLessThan(0.30);
  });

  test('HTML report bundle for both stacks', async ({ page }) => {
    // Generate a simple HTML report combining results for the package.
    const validation = JSON.parse(fs.readFileSync(path.join(ROOT, '5-link-validation.json'), 'utf-8'));
    const hinge = JSON.parse(fs.readFileSync(path.join(ROOT, 'hinge-pin-clearance.json'), 'utf-8'));

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>ArchDisc Foundation — Tolerance Stack Reports</title>
<style>body{font-family:system-ui,sans-serif;margin:32px;max-width:1100px;color:#1a1a1a}
h1{font-size:24px}h2{font-size:18px;border-bottom:1px solid #ddd;padding-bottom:6px;margin-top:32px}
table{border-collapse:collapse;width:100%;font-size:13px;margin-bottom:8px}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #eee}
th{background:#f6f8fa;font-weight:600}
.metric{display:inline-block;background:#f6f8fa;border-radius:4px;padding:4px 12px;margin:2px;font-size:12px;font-family:monospace}
.bad{background:#f8d7da;color:#721c24}
.good{background:#d4edda;color:#155724}</style></head>
<body>
<h1>Foundation tolerance stack reports</h1>

<h2>Validation: 5-link chain (analytical)</h2>
<p>Five 20 mm links, each ±0.05 mm, summing to total length. Cp = 1.0 (so ±tol = ±3σ).</p>
<table><tr><th>Method</th><th>Range / σ</th><th>Bounds</th></tr>
<tr><td>Worst-case</td><td>±${(validation.worstCase.range/2).toFixed(4)} (= 5 × 0.05)</td>
  <td>[${validation.worstCase.low.toFixed(4)}, ${validation.worstCase.high.toFixed(4)}]</td></tr>
<tr><td>RSS</td><td>σ = ${validation.rss.sigma.toFixed(4)} (= √5·σ_link)</td>
  <td>±3σ: [${validation.rss.low3sigma.toFixed(4)}, ${validation.rss.high3sigma.toFixed(4)}]</td></tr>
<tr><td>Monte Carlo (100 k)</td><td>μ = ${validation.mc.mean.toFixed(4)}, σ = ${validation.mc.stddev.toFixed(4)}</td>
  <td>p1 = ${validation.mc.p1.toFixed(4)}, p99 = ${validation.mc.p99.toFixed(4)}</td></tr>
</table>

<h2>Real example: hinge pin diametrical clearance fit</h2>
<p>Pin Ø5.8 ± 0.05 (FDM print) into knuckle Ø6.0 +0.10/−0.00 (asymmetric reaming clearance). Required clearance ${hinge.mc.spec.lsl}–${hinge.mc.spec.usl} mm.</p>
<table><tr><th>Statistic</th><th>Value (mm)</th></tr>
<tr><td>Nominal clearance</td><td>${hinge.nominal.toFixed(3)}</td></tr>
<tr><td>Worst-case range</td><td>[${hinge.worstCase.low.toFixed(3)}, ${hinge.worstCase.high.toFixed(3)}]</td></tr>
<tr><td>RSS ±3σ</td><td>[${hinge.rss.low3sigma.toFixed(3)}, ${hinge.rss.high3sigma.toFixed(3)}]</td></tr>
<tr><td>MC μ</td><td>${hinge.mc.mean.toFixed(3)}</td></tr>
<tr><td>MC σ</td><td>${hinge.mc.stddev.toFixed(4)}</td></tr>
<tr><td>MC percentiles (p1 / p50 / p99)</td><td>${hinge.mc.p1.toFixed(3)} / ${hinge.mc.p50.toFixed(3)} / ${hinge.mc.p99.toFixed(3)}</td></tr>
<tr><td>Defects per million</td><td><span class="metric ${hinge.mc.defectsPerMillion < 1000 ? 'good' : 'bad'}">${hinge.mc.defectsPerMillion.toFixed(0)}</span></td></tr>
<tr><td>Cp / Cpk</td><td>${hinge.mc.Cp != null ? hinge.mc.Cp.toFixed(2) : '—'} / ${hinge.mc.Cpk != null ? hinge.mc.Cpk.toFixed(2) : '—'}</td></tr>
</table>

<h2>Histogram (hinge clearance, 100 k samples)</h2>
<svg viewBox="0 0 1000 300" width="1000" height="300" xmlns="http://www.w3.org/2000/svg">
<rect x="0" y="0" width="1000" height="300" fill="#fafafa"/>
${(() => {
  const max = Math.max(...hinge.mc.histogram.map(b => b.count));
  return hinge.mc.histogram.map((b, i) => {
    const x = i * 1000 / hinge.mc.histogram.length;
    const w = 1000 / hinge.mc.histogram.length - 1;
    const h = b.count / max * 250;
    return `<rect x="${x}" y="${280 - h}" width="${w}" height="${h}" fill="#5b9bd5"/>`;
  }).join('');
})()}
<line x1="0" y1="280" x2="1000" y2="280" stroke="black" stroke-width="0.5"/>
</svg>

<div style="color:#888;font-size:12px;margin-top:24px">
Generated by ArchDisc Foundation tolerance stack analyzer.
Worst-case via 2^n corner enumeration; RSS via linearized sensitivity at nominal;
Monte Carlo via 100 000 samples per stack with seeded xorshift32 PRNG.
</div></body></html>`;
    fs.writeFileSync(path.join(ROOT, 'tolerance-report.html'), html);
    console.log(`  ✓ tolerance-report.html`);
  });
});
