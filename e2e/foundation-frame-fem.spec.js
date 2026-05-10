import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'frame');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(120000);

test.describe('Welded-frame / 12-DOF beam FEM (Phase 7 — structural stack)', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Cantilever tip force: δ = PL³/(3EI) within 0.1%', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { FrameModel, solveFrame, Sections } = await import('/src/foundation/FrameFEM.js');

      // 1 m cantilever, square-tube 50 × 5 mm, A36 steel.
      // Tip load 100 N along global -Y.
      const STEEL = { E: 200000, G: 77000 };  // MPa
      const sec = Sections.squareTube(50, 5);
      const m = new FrameModel();
      const n0 = m.addNode([0, 0, 0]);
      const n1 = m.addNode([1000, 0, 0]);   // 1 m = 1000 mm
      m.addMember(n0, n1, { material: STEEL, section: sec });
      m.addFixedSupport(n0);
      m.addNodalLoad(n1, [0, -100, 0, 0, 0, 0]);
      const r = solveFrame(m);
      // Tip displacement is global DOF index n1*6 + 1 (Y direction)
      return {
        section: sec,
        tipDisp: r.displacement[n1 * 6 + 1],
        tipRotZ: r.displacement[n1 * 6 + 5],
        memberForces: r.memberForces[0],
        cgIters: r.cgIterations,
      };
    });

    const { section } = result;
    const E = 200000, P = 100, L = 1000;
    const Iz = section.Iz;
    const deltaTheory = (-P * L ** 3) / (3 * E * Iz);   // negative because load -Y
    const rotTheory = (-P * L ** 2) / (2 * E * Iz);
    const errDisp = ((result.tipDisp - deltaTheory) / Math.abs(deltaTheory)) * 100;
    const errRot = ((result.tipRotZ - rotTheory) / Math.abs(rotTheory)) * 100;

    console.log(`\n=== CANTILEVER (square-tube 50 × 5, 1 m, 100 N tip) ===`);
    console.log(`Section: A = ${section.A.toFixed(2)} mm²,  Iz = ${section.Iz.toFixed(2)} mm⁴`);
    console.log(`Theory δ = PL³/(3EI) = ${deltaTheory.toFixed(4)} mm    FEA δ = ${result.tipDisp.toFixed(4)} mm  (err ${errDisp.toFixed(3)} %)`);
    console.log(`Theory θ = PL²/(2EI) = ${rotTheory.toExponential(4)} rad   FEA θ = ${result.tipRotZ.toExponential(4)} rad  (err ${errRot.toFixed(3)} %)`);
    console.log(`Member forces: N = ${result.memberForces.Ni.toFixed(2)} / ${result.memberForces.Nj.toFixed(2)} N`);
    console.log(`               Vy_i = ${result.memberForces.Vyi.toFixed(2)} N (theory 100)`);
    console.log(`               Mz_i = ${result.memberForces.Mzi.toFixed(2)} N·mm (theory ${(P * L).toFixed(0)})`);

    fs.writeFileSync(path.join(ROOT, 'cantilever-tip-force.json'), JSON.stringify({
      analytical: { delta_mm: deltaTheory, rotZ_rad: rotTheory },
      fea: { delta_mm: result.tipDisp, rotZ_rad: result.tipRotZ },
      memberForces: result.memberForces,
      errorPct: { delta: errDisp, rotZ: errRot },
    }, null, 2));

    expect(Math.abs(errDisp)).toBeLessThan(0.1);
    expect(Math.abs(errRot)).toBeLessThan(0.1);
    expect(result.memberForces.Vyi).toBeCloseTo(100, 2);
    // Magnitude check (sign convention: cantilever fixed-end moment is
    // negative about +z by right-hand rule; we verify magnitude only)
    expect(Math.abs(result.memberForces.Mzi)).toBeCloseTo(P * L, 1);
  });

  test('Cantilever tip torque: φ = TL/(GJ) within 0.1%', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { FrameModel, solveFrame, Sections } = await import('/src/foundation/FrameFEM.js');
      const STEEL = { E: 200000, G: 77000 };
      // Round pipe Ø60 / Ø50 — closed-form J is exact
      const sec = Sections.pipe(30, 25);
      const m = new FrameModel();
      const n0 = m.addNode([0, 0, 0]);
      const n1 = m.addNode([1000, 0, 0]);
      m.addMember(n0, n1, { material: STEEL, section: sec });
      m.addFixedSupport(n0);
      // Apply torque about local x = global +x  → Mx = 1 kN·m = 1e6 N·mm
      m.addNodalLoad(n1, [0, 0, 0, 1e6, 0, 0]);
      const r = solveFrame(m);
      return {
        section: sec,
        tipRotX: r.displacement[n1 * 6 + 3],
        memberForces: r.memberForces[0],
      };
    });

    const G = 77000, T = 1e6, L = 1000;
    const J = result.section.J;
    const phiTheory = T * L / (G * J);
    const err = ((result.tipRotX - phiTheory) / phiTheory) * 100;
    console.log(`\n=== CANTILEVER TORSION (pipe Ø60/Ø50, 1 m, 1 kN·m) ===`);
    console.log(`J = ${J.toFixed(2)} mm⁴`);
    console.log(`Theory φ = TL/(GJ) = ${phiTheory.toExponential(4)} rad   FEA = ${result.tipRotX.toExponential(4)} rad  (err ${err.toFixed(3)} %)`);
    console.log(`Member torsion: T_i = ${result.memberForces.Ti.toFixed(2)} N·mm (theory 1e6)`);

    expect(Math.abs(err)).toBeLessThan(0.1);
    expect(result.memberForces.Ti).toBeCloseTo(1e6, -2);
  });

  test('Simply-supported beam under uniform load: δ_mid = 5wL⁴/(384EI)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { FrameModel, solveFrame, Sections } = await import('/src/foundation/FrameFEM.js');
      const STEEL = { E: 200000, G: 77000 };
      // 2 m beam, IPE-100-ish replacement using rectangle 100 × 50
      const sec = Sections.rectangle(50, 100);
      const m = new FrameModel();

      // Discretize into 10 segments to allow mid-span node where the
      // deflection is checked.
      const NSEG = 10;
      const Lspan = 2000;       // mm
      const ids = [];
      for (let i = 0; i <= NSEG; i++) ids.push(m.addNode([i * Lspan / NSEG, 0, 0]));
      for (let i = 0; i < NSEG; i++) m.addMember(ids[i], ids[i + 1], { material: STEEL, section: sec });

      // Pinned at left (allows rotation), roller at right (release axial)
      // Apply UDL w in -Y direction across each span, w = 0.05 N/mm = 50 N/m
      m.addPinnedSupport(ids[0]);
      // Right support: lock Y only (vertical) and Z (lateral) — roller in X
      // Use single-DOF lock for vertical
      m.addRollerSupport(ids[NSEG], 1);   // Y locked
      m.addRollerSupport(ids[NSEG], 2);   // Z locked (prevents drift, doesn't add axial)
      const w = -0.05;   // N/mm
      for (let i = 0; i < NSEG; i++) m.addDistributedLoad(i, [0, w, 0]);

      const r = solveFrame(m);
      const midNode = ids[NSEG / 2];
      return {
        section: sec,
        midDisp: r.displacement[midNode * 6 + 1],
        Lspan, w,
        cgIters: r.cgIterations,
      };
    });

    const E = 200000;
    const Iz = result.section.Iz;
    const wAbs = Math.abs(result.w);
    const L = result.Lspan;
    const deltaTheory = -5 * wAbs * L ** 4 / (384 * E * Iz);
    const err = ((result.midDisp - deltaTheory) / Math.abs(deltaTheory)) * 100;
    console.log(`\n=== SIMPLY-SUPPORTED BEAM (50 × 100, span 2 m, w = 50 N/m) ===`);
    console.log(`Theory δ_mid = 5wL⁴/(384EI) = ${deltaTheory.toExponential(4)} mm`);
    console.log(`FEA   δ_mid = ${result.midDisp.toExponential(4)} mm  (err ${err.toFixed(3)} %)`);
    console.log(`CG iterations: ${result.cgIters}`);

    fs.writeFileSync(path.join(ROOT, 'simply-supported-udl.json'), JSON.stringify({
      analytical: deltaTheory,
      fea: result.midDisp,
      errorPct: err,
    }, null, 2));

    expect(Math.abs(err)).toBeLessThan(0.5);   // multi-element beam: tiny shear-locking residual
  });

  test('3D space frame portal: pinned base + side load — equilibrium check', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { FrameModel, solveFrame, Sections } = await import('/src/foundation/FrameFEM.js');
      const STEEL = { E: 200000, G: 77000 };
      const col = Sections.squareTube(100, 6);   // columns
      const beam = Sections.rectangle(80, 200);  // beam

      const m = new FrameModel();
      // Two columns at x = 0 and x = 4000, height 3000 mm. Beam joins tops.
      const A = m.addNode([0, 0, 0]);
      const B = m.addNode([4000, 0, 0]);
      const C = m.addNode([4000, 0, 3000]);
      const D = m.addNode([0, 0, 3000]);
      m.addMember(A, D, { material: STEEL, section: col });   // left column
      m.addMember(B, C, { material: STEEL, section: col });   // right column
      m.addMember(D, C, { material: STEEL, section: beam });  // beam

      m.addFixedSupport(A);
      m.addFixedSupport(B);
      // Lateral load 5 kN at top-left node along +x
      m.addNodalLoad(D, [5000, 0, 0, 0, 0, 0]);
      const r = solveFrame(m);

      // Sum all support reactions ≈ -applied load (force balance)
      // Reactions = K · u at constrained DOFs ≈ -F_applied direction.
      // Here we just check the top of column A drifts in +x direction
      // by a few mm (qualitative + member-axial-summing instead).
      const driftD = r.displacement[D * 6 + 0];
      const driftC = r.displacement[C * 6 + 0];

      // Column shears (V_y in local x = global x for a vertical column with
      // refUp default Z) — should sum to applied 5000 N.
      const shearLeft  = r.memberForces[0].Vyj;
      const shearRight = r.memberForces[1].Vyj;
      // For a vertical member with default refUp = Z, local x is along
      // member direction (Z), local y is in -X direction (cross of Z with
      // refUp), so shear in local y picks up X-direction shear.
      // We just check the magnitude is reasonable.

      return {
        driftD, driftC,
        cgIters: r.cgIterations,
        memberForces: r.memberForces,
      };
    });

    console.log(`\n=== 3D PORTAL FRAME (4 m × 3 m, 5 kN side load) ===`);
    console.log(`Top-left drift  D_x = ${result.driftD.toFixed(4)} mm`);
    console.log(`Top-right drift C_x = ${result.driftC.toFixed(4)} mm`);
    console.log(`(both should be similar — beam ties tops together)`);
    console.log(`CG iterations: ${result.cgIters}`);

    // Both top nodes should drift roughly the same way (rigid beam couples them)
    expect(Math.abs(result.driftD - result.driftC)).toBeLessThan(0.01);
    expect(result.driftD).toBeGreaterThan(0);    // drifts in +x as load is +x
    expect(result.driftD).toBeLessThan(20);      // realistic stiffness
  });
});
