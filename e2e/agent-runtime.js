/*
 * Autonomous agent runtime (e2e helper, not a test).
 *
 * Reusable pieces of the ArchDisc autonomous design system:
 *   llm()                — one call through the configured BYO-LLM provider
 *   decomposeProduct()   — a product brief → a part graph (LLM)
 *   runTool()            — drive one real ArchDisc ribbon tool
 *   runPartAgent()       — one part through the closing loop, verified by a
 *                          DYNAMIC (time-stepped) analysis, motion rendered
 *   renderDynamicMotion()— the transient response drawn frame-by-frame
 *
 * Every part is designed by a real LLM operating ArchDisc's real tools,
 * exactly as a manual user would. The verification is never static — it
 * is a dynamic simulation (the part deflecting and oscillating in time),
 * rendered as motion, and the loop closes on the dynamic result.
 */

import { PROVIDERS } from '../frontend/src/ai/PlannerProviders.js';
import { encodeAVI, encodeMP4 } from '../frontend/src/foundation/VideoMux.js';

/** One generation call through the configured provider. */
export async function llm(cred, system, userMessage) {
  const provider = PROVIDERS[cred.provider];
  if (!provider) throw new Error(`unknown LLM provider "${cred.provider}"`);
  return provider.generate({
    apiKey: cred.apiKey, baseUrl: cred.endpoint, model: cred.deployment,
    apiVersion: cred.apiVersion, system, userMessage,
  });
}

/** Pull the first JSON object out of a model reply. */
export function extractJSON(raw) {
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`model reply had no JSON: ${String(raw).slice(0, 200)}`);
  return JSON.parse(m[0]);
}

const DECOMPOSE_SYSTEM = `You are an autonomous mechanical design lead in the ArchDisc CAD system.
Decompose a product into its load-bearing structural parts. Every part will be built and
verified by a DYNAMIC analysis as a rectangular cantilever bracket — it has a reach (mm) and
carries a tip load (N) that is suddenly applied (dynamic). Distribute the product's total load
sensibly across the parts. Give each part a role: exactly ONE part has role "span" (the member
that carries the payload and is held up by the others); every other part has role "support".
Also state totalLoad_N — the whole product's load.
Reply with ONLY JSON, no prose, no code fences:
{"product":"<name>","totalLoad_N":<num>,"parts":[{"id":"p1","name":"<part>","role":"support"|"span","reach_mm":<num>,"tipLoad_N":<num>}]}
Use 3 to 6 parts.`;

const CLARIFY_SYSTEM = `You are an autonomous design lead in the ArchDisc CAD system. Before
designing a product you ask the client focused multiple-choice questions to pin down the
requirements the brief leaves ambiguous — load cases, operating environment, dynamic vs static
loading, material / standards constraints, mounting, safety-factor policy, duty cycle, etc.
Each question must be answerable by picking ONE option. Mark the most typical option as the
recommended default.
Reply with ONLY JSON, no prose, no code fences:
{"questions":[{"q":"<question>","options":["<opt>", ...],"recommended":<index>}]}
Ask 4 to 8 questions.`;

/**
 * Clarifier — generate clarifying MCQs for a brief, then resolve them.
 * In the product a real user answers; here the test stands in for the
 * user by accepting each question's recommended default. Returns the
 * questions, the chosen answers, and the enriched (clarified) brief.
 */
export async function clarifyBrief(cred, brief) {
  const j = extractJSON(await llm(cred, CLARIFY_SYSTEM, `Product brief: ${brief}`));
  const questions = Array.isArray(j.questions) ? j.questions : [];
  const answers = questions.map((q) => {
    const opts = Array.isArray(q.options) ? q.options : [];
    const idx = Number.isInteger(q.recommended) && opts[q.recommended] !== undefined
      ? q.recommended : 0;
    return { q: q.q, options: opts, chosen: opts[idx] ?? '(no option)' };
  });
  const clarifiedBrief = `${brief}\n\nClarified requirements:\n`
    + answers.map((a) => `- ${a.q} → ${a.chosen}`).join('\n');
  return { questions, answers, clarifiedBrief };
}

/** Decompose a product brief into a part graph. */
export async function decomposeProduct(cred, brief) {
  const g = extractJSON(await llm(cred, DECOMPOSE_SYSTEM, `Product brief: ${brief}`));
  if (!Array.isArray(g.parts) || !g.parts.length) throw new Error('decomposer returned no parts');
  return g;
}

const DECOMPOSE_MECHANISM_SYSTEM = `You are an autonomous mechanical design lead in the ArchDisc
CAD system. Decompose a powered mechanical product into its parts. Each part has a "type" and
type-specific parameters:
  - "structural" — a load-bearing bracket/beam. params: reach_mm, tipLoad_N
  - "rotating"   — a rotating shaft. params: length_mm, operatingRPM, disk_mass_kg
  - "mount"      — an instrument/control mount that must avoid resonance.
                   params: reach_mm, excitationHz
  - "pressure"   — a pressure-loaded panel/cover. params: side_mm, pressure_kPa
Choose realistic values. Include the part types the product genuinely needs.
Reply with ONLY JSON, no prose, no code fences:
{"product":"<name>","parts":[{"id":"p1","name":"<part>","type":"structural|rotating|mount", ...type params...}]}
Use 3 to 6 parts.`;

/** Decompose a powered product into typed (multi-archetype) parts. */
export async function decomposeMechanism(cred, brief) {
  const g = extractJSON(await llm(cred, DECOMPOSE_MECHANISM_SYSTEM, `Product brief: ${brief}`));
  if (!Array.isArray(g.parts) || !g.parts.length) throw new Error('decomposer returned no parts');
  return g;
}

const ALU = { name: 'aluminium 6061', E_MPa: 69000, nu: 0.33, yield_MPa: 276, density: 2700 };
const STEEL = { name: 'AISI 4340 steel', E_MPa: 200000, density_kg_m3: 7850 };

/** Dispatch a typed part to its archetype agent (the swarm router). */
export async function runPartByType(page, cred, part, opts = {}) {
  if (part.type === 'rotating') {
    return runShaftAgent(page, cred, {
      name: part.name, length_mm: part.length_mm,
      operatingRPM: part.operatingRPM, disk_mass_kg: part.disk_mass_kg,
    }, STEEL, opts);
  }
  if (part.type === 'mount') {
    return runResonanceAgent(page, cred, {
      name: part.name, reach_mm: part.reach_mm, excitationHz: part.excitationHz,
    }, ALU, opts);
  }
  if (part.type === 'pressure') {
    return runPressureAgent(page, cred, {
      name: part.name, side_mm: part.side_mm, pressure_kPa: part.pressure_kPa,
    }, ALU, opts);
  }
  return runPartAgent(page, cred, {
    name: part.name, reach_mm: part.reach_mm, tipLoad_N: part.tipLoad_N,
  }, ALU, opts);
}

/** Drive one real ArchDisc ribbon tool exactly as a user click does. */
export async function runTool(page, tab, tool, params, slot) {
  await page.locator('.ribbon-tab', { hasText: tab }).first().click();
  await page.waitForTimeout(280);
  await page.evaluate(({ t, p }) => {
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams[t] = p;
  }, { t: tool, p: params });
  await page.locator('.ribbon-tool-label', { hasText: new RegExp(`^${tool}$`) }).first().click();
  await page.waitForFunction((k) => !!window[k], slot, { timeout: 60000 });
  await page.waitForTimeout(250);
}

const PART_SYSTEM = `You are an autonomous mechanical design agent operating ArchDisc CAD.
You design ONE part by choosing its dimensions; the system builds it ("Extrude Boss") and runs
a DYNAMIC analysis ("Dynamic Response") — the part is treated as a cantilever hit by a
suddenly-applied tip load, so it deflects past its static position and oscillates. The analysis
returns a DYNAMIC safety factor (yield / peak dynamic stress); the dynamic peak is ~2× the
static one. Safety factor rises roughly with height h squared. The design is ACCEPTED only when
the dynamic safety factor is between 1.5 and 3.0 — safe under the dynamic peak, not wastefully
heavy. If it is far above 3.0 the part is over-built (make it much thinner); below 1.5 it is
unsafe (thicker).
Reply with ONLY JSON: {"L_mm":num,"b_mm":num,"h_mm":num,"reasoning":"short"}. No prose.`;

/**
 * Run one part through the closing design loop. The LLM picks dimensions,
 * ArchDisc's real tools build it and run the DYNAMIC analysis, the LLM
 * redesigns on failure. On convergence the motion is rendered to video.
 */
export async function runPartAgent(page, cred, part, material, opts = {}) {
  const MINSF = opts.minSF ?? 1.5, MAXSF = opts.maxSF ?? 3.0, maxIter = opts.maxIter ?? 6;
  const inBand = (sf) => sf >= MINSF && sf <= MAXSF;
  const tag = (sf) => inBand(sf) ? 'ACCEPTED' : sf < MINSF ? 'FAILS-unsafe' : 'over-built';
  const history = [];
  let converged = false;

  for (let iter = 1; iter <= maxIter; iter++) {
    const prompt = `Part: ${part.name}. Reach ${part.reach_mm} mm, suddenly-applied tip load `
      + `${part.tipLoad_N} N, material ${material.name} (yield ${material.yield_MPa} MPa). `
      + `Accepted when ${MINSF} <= dynamic SF <= ${MAXSF}.\n`
      + (history.length
        ? 'Previous attempts:\n' + history.map((h) =>
            `  L=${h.L} b=${h.b} h=${h.h} mm -> dynamic SF=${h.SF.toFixed(2)} (${tag(h.SF)})`).join('\n') + '\n'
        : 'First attempt.\n')
      + 'Give the next design as JSON.';
    const d = extractJSON(await llm(cred, PART_SYSTEM, prompt));
    const L = +d.L_mm, b = +d.b_mm, h = +d.h_mm;
    if (!(Number.isFinite(L) && Number.isFinite(b) && Number.isFinite(h))) {
      throw new Error(`agent returned non-numeric dims for ${part.name}`);
    }

    await runTool(page, 'Part', 'Extrude Boss',
      { width: b, depth: L, height: h }, '__lastFoundationManifold');
    await runTool(page, 'Simulate', 'Dynamic Response', {
      L_mm: L, b_mm: b, h_mm: h, P_N: part.tipLoad_N,
      E_MPa: material.E_MPa, density: material.density, yield_MPa: material.yield_MPa,
    }, '__lastDynamicResult');
    const dyn = await page.evaluate(() => window.__lastDynamicResult);

    history.push({
      iter, L, b, h, SF: dyn.dynamicSafetyFactor,
      peakStress: dyn.peakDynamicStressMPa, DAF: dyn.dynamicAmplificationFactor,
      freqHz: dyn.naturalFrequencyHz, reasoning: d.reasoning || '',
    });
    if (inBand(dyn.dynamicSafetyFactor)) { converged = true; break; }
  }

  // Render the accepted design's transient motion to video.
  let motion = null;
  if (history.length) {
    const m = await renderDynamicMotion(page);
    if (m && m.durls.length) {
      const frames = m.durls.map((u) => Buffer.from(u.split(',')[1], 'base64'));
      motion = {
        mp4: encodeMP4(frames, { fps: 24, width: m.W, height: m.H }),
        avi: encodeAVI(frames, { fps: 24, width: m.W, height: m.H }),
        frameCount: frames.length,
      };
    }
  }
  const f0 = history[history.length - 1];
  return {
    part: part.name, archetype: 'structural-cantilever', converged,
    iterations: history.length, final: f0, history, motion,
    geometry: { kind: 'box', width: f0.b, depth: f0.L, height: f0.h },
  };
}

const SHAFT_SYSTEM = `You are an autonomous mechanical design agent operating ArchDisc CAD.
You design a ROTATING SHAFT by choosing its diameter (mm); the system builds it ("Revolve
Boss") and runs a rotordynamic analysis ("Rotordynamics") returning the critical (whirl)
speed in RPM. A shaft must run SUBCRITICAL — critical speed safely above the operating speed.
Critical speed rises strongly with diameter (≈ diameter squared). The design is ACCEPTED only
when criticalSpeed / operatingSpeed is between 1.5 and 3.0 — a safe resonance margin without
wasteful mass. Below 1.5 → resonance risk, thicken it; above 3.0 → over-built, thin it.
Reply with ONLY JSON: {"diameter_mm":num,"reasoning":"short"}. No prose.`;

/**
 * Rotating-shaft archetype agent. A different part type from the
 * structural cantilever: a Revolve-Boss cylinder, verified by a
 * rotordynamic (whirl) analysis, the loop closing on the resonance
 * margin (critical speed vs operating speed) — not on stress.
 *
 * @param shaft { name, length_mm, operatingRPM, disk_mass_kg }
 */
export async function runShaftAgent(page, cred, shaft, material, opts = {}) {
  const MIN = opts.minRatio ?? 1.5, MAX = opts.maxRatio ?? 3.0, maxIter = opts.maxIter ?? 6;
  const inBand = (r) => r >= MIN && r <= MAX;
  const tag = (r) => inBand(r) ? 'ACCEPTED' : r < MIN ? 'FAILS-resonance-risk' : 'over-built';
  const history = [];
  let converged = false;

  for (let iter = 1; iter <= maxIter; iter++) {
    const prompt = `Shaft: ${shaft.name}. Length ${shaft.length_mm} mm, operating speed `
      + `${shaft.operatingRPM} RPM, mid-mounted rotor mass ${shaft.disk_mass_kg} kg, `
      + `material ${material.name}. Accepted when `
      + `${MIN} <= criticalSpeed/operatingSpeed <= ${MAX}.\n`
      + (history.length
        ? 'Previous attempts:\n' + history.map((h) =>
            `  D=${h.D} mm -> critical ${h.crit.toFixed(0)} RPM, ratio ${h.ratio.toFixed(2)} `
            + `(${tag(h.ratio)})`).join('\n') + '\n'
        : 'First attempt.\n')
      + 'Give the next design as JSON.';
    const d = extractJSON(await llm(cred, SHAFT_SYSTEM, prompt));
    const D = +d.diameter_mm;
    if (!Number.isFinite(D) || D <= 0) throw new Error(`agent returned bad diameter for ${shaft.name}`);
    const L = shaft.length_mm, R = D / 2;

    await runTool(page, 'Part', 'Revolve Boss', {
      profile: [[0, 0], [R, 0], [R, L], [0, L]], revolveSegs: 48,
    }, '__lastFoundationManifold');
    await runTool(page, 'Simulate', 'Shaft Whirl', {
      length_mm: L, diameter_mm: D, E_MPa: material.E_MPa,
      density_kg_m3: material.density_kg_m3,
      diskMass_kg: shaft.disk_mass_kg, operatingRPM: shaft.operatingRPM,
    }, '__lastShaftWhirl');
    const rd = await page.evaluate(() => window.__lastShaftWhirl);
    const ratio = rd.marginRatio;

    history.push({
      iter, D, crit: rd.criticalSpeedRPM, f1: rd.firstWhirlHz, ratio,
      reasoning: d.reasoning || '',
    });
    if (inBand(ratio)) { converged = true; break; }
  }
  const f0 = history[history.length - 1];
  return {
    part: shaft.name, archetype: 'rotating-shaft', converged,
    iterations: history.length, final: f0, history,
    geometry: { kind: 'cylinder', diameter: f0.D, length: shaft.length_mm },
  };
}

const RESONANCE_SYSTEM = `You are an autonomous mechanical design agent operating ArchDisc CAD.
You design an instrument MOUNT (a bracket) by choosing its cross-section so it does NOT
resonate with the machine it is bolted to. The system builds it ("Extrude Boss") and runs a
dynamic analysis ("Dynamic Response") returning the mount's natural frequency (Hz). To avoid
resonance the natural frequency must sit well ABOVE the machine's excitation frequency — a
taller cross-section (height h) raises it (≈ h to the first power). The design is ACCEPTED only
when naturalFrequency / excitationFrequency is between 1.5 and 4.0 — safely clear of resonance,
not wastefully stiff. Below 1.5 → resonance risk, stiffen it; above 4.0 → over-stiff, thin it.
Reply with ONLY JSON: {"b_mm":num,"h_mm":num,"reasoning":"short"}. No prose.`;

/**
 * Resonance-avoidance archetype agent. A third part type: a structural
 * mount verified by a dynamic analysis but on a different design driver
 * — frequency separation from a machine's excitation, not stress.
 *
 * @param mount { name, reach_mm, excitationHz }
 */
export async function runResonanceAgent(page, cred, mount, material, opts = {}) {
  const MIN = opts.minRatio ?? 1.5, MAX = opts.maxRatio ?? 4.0, maxIter = opts.maxIter ?? 6;
  const inBand = (r) => r >= MIN && r <= MAX;
  const tag = (r) => inBand(r) ? 'ACCEPTED' : r < MIN ? 'FAILS-resonance-risk' : 'over-stiff';
  const history = [];
  let converged = false;

  for (let iter = 1; iter <= maxIter; iter++) {
    const prompt = `Mount: ${mount.name}. Reach ${mount.reach_mm} mm, bolted to a machine `
      + `whose excitation frequency is ${mount.excitationHz} Hz, material ${material.name}. `
      + `Accepted when ${MIN} <= naturalFrequency/excitation <= ${MAX}.\n`
      + (history.length
        ? 'Previous attempts:\n' + history.map((h) =>
            `  b=${h.b} h=${h.h} mm -> f₁=${h.f1.toFixed(1)} Hz, ratio ${h.ratio.toFixed(2)} `
            + `(${tag(h.ratio)})`).join('\n') + '\n'
        : 'First attempt.\n')
      + 'Give the next design as JSON.';
    const d = extractJSON(await llm(cred, RESONANCE_SYSTEM, prompt));
    const b = +d.b_mm, h = +d.h_mm;
    if (!(Number.isFinite(b) && Number.isFinite(h))) {
      throw new Error(`agent returned non-numeric dims for ${mount.name}`);
    }

    await runTool(page, 'Part', 'Extrude Boss',
      { width: b, depth: mount.reach_mm, height: h }, '__lastFoundationManifold');
    await runTool(page, 'Simulate', 'Dynamic Response', {
      L_mm: mount.reach_mm, b_mm: b, h_mm: h, P_N: 100,
      E_MPa: material.E_MPa, density: material.density, yield_MPa: material.yield_MPa,
    }, '__lastDynamicResult');
    const dyn = await page.evaluate(() => window.__lastDynamicResult);
    const ratio = dyn.naturalFrequencyHz / mount.excitationHz;

    history.push({
      iter, b, h, f1: dyn.naturalFrequencyHz, ratio, reasoning: d.reasoning || '',
    });
    if (inBand(ratio)) { converged = true; break; }
  }
  const f0 = history[history.length - 1];
  return {
    part: mount.name, archetype: 'resonance-mount', converged,
    iterations: history.length, final: f0, history,
    geometry: { kind: 'box', width: f0.b, depth: mount.reach_mm, height: f0.h },
  };
}

const PRESSURE_SYSTEM = `You are an autonomous mechanical design agent operating ArchDisc CAD.
You design a pressure-loaded PANEL (a cover / bulkhead / tank wall) by choosing its thickness
(mm); the system builds it ("Extrude Boss") and runs a DYNAMIC analysis ("Pressure Response")
— a sudden uniform pressure is applied and the panel responds transiently — returning a
dynamic safety factor. A thicker panel lowers stress (the safety factor rises strongly with
thickness). The design is ACCEPTED only when the dynamic safety factor is between 1.5 and 3.0
— safe under the dynamic peak, not wastefully heavy. Below 1.5 → unsafe, thicken it; above
3.0 → over-built, thin it.
Reply with ONLY JSON: {"thickness_mm":num,"reasoning":"short"}. No prose.`;

/**
 * Pressure-panel archetype agent. A fourth part type: a clamped square
 * panel verified by a transient response to a suddenly-applied uniform
 * pressure — a distinct load case from beam / shaft / mount.
 *
 * @param panel { name, side_mm, pressure_kPa }
 */
export async function runPressureAgent(page, cred, panel, material, opts = {}) {
  const MIN = opts.minSF ?? 1.5, MAX = opts.maxSF ?? 3.0, maxIter = opts.maxIter ?? 6;
  const inBand = (sf) => sf >= MIN && sf <= MAX;
  const tag = (sf) => inBand(sf) ? 'ACCEPTED' : sf < MIN ? 'FAILS-unsafe' : 'over-built';
  const history = [];
  let converged = false;

  for (let iter = 1; iter <= maxIter; iter++) {
    const prompt = `Panel: ${panel.name}. ${panel.side_mm}×${panel.side_mm} mm, suddenly-applied `
      + `uniform pressure ${panel.pressure_kPa} kPa, material ${material.name} `
      + `(yield ${material.yield_MPa} MPa). Accepted when ${MIN} <= dynamic SF <= ${MAX}.\n`
      + (history.length
        ? 'Previous attempts:\n' + history.map((h) =>
            `  t=${h.t} mm -> dynamic SF=${h.SF.toFixed(2)} (${tag(h.SF)})`).join('\n') + '\n'
        : 'First attempt.\n')
      + 'Give the next design as JSON.';
    const d = extractJSON(await llm(cred, PRESSURE_SYSTEM, prompt));
    const t = +d.thickness_mm;
    if (!(Number.isFinite(t) && t > 0)) throw new Error(`agent returned bad thickness for ${panel.name}`);

    await runTool(page, 'Part', 'Extrude Boss',
      { width: panel.side_mm, depth: panel.side_mm, height: t }, '__lastFoundationManifold');
    await runTool(page, 'Simulate', 'Pressure Response', {
      side_mm: panel.side_mm, thickness_mm: t, pressure_kPa: panel.pressure_kPa,
      E_MPa: material.E_MPa, nu: material.nu, yield_MPa: material.yield_MPa,
      density: material.density,
    }, '__lastPressureResult');
    const pr = await page.evaluate(() => window.__lastPressureResult);

    history.push({
      iter, t, SF: pr.dynamicSafetyFactor, peakStress: pr.peakDynamicStressMPa,
      f1: pr.naturalFrequencyHz, reasoning: d.reasoning || '',
    });
    if (inBand(pr.dynamicSafetyFactor)) { converged = true; break; }
  }
  const f0 = history[history.length - 1];
  return {
    part: panel.name, archetype: 'pressure-panel', converged,
    iterations: history.length, final: f0, history,
    geometry: { kind: 'box', width: panel.side_mm, depth: panel.side_mm, height: f0.t },
  };
}

/**
 * Parallel agent swarm — a worker pool of concurrent ArchDisc instances.
 *
 * Each agent must operate its own ArchDisc app (a shared tab's ribbon,
 * tool slots and body registry would collide), so every worker runs in
 * its own browser context. `concurrency` workers pull parts off a shared
 * queue and design them through the closing loop in parallel — the way
 * the swarm scales (raise concurrency, or queue more parts).
 *
 * @param browser  Playwright Browser
 * @param parts    [{ name, reach_mm, tipLoad_N, ... }]
 * @returns results aligned to `parts`
 */
export async function runSwarm(browser, cred, parts, material, opts = {}) {
  const concurrency = Math.min(opts.concurrency ?? 3, parts.length);
  const log = opts.log || (() => {});
  const results = new Array(parts.length);
  const t0 = Date.now();
  let next = 0;

  async function worker(wid) {
    for (;;) {
      const idx = next++;
      if (idx >= parts.length) return;
      const part = parts[idx];
      log(`  [worker ${wid} @${((Date.now() - t0) / 1000).toFixed(1)}s] START ${part.name}`);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto('/');
        await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 30000 });
        await page.waitForTimeout(2000);
        results[idx] = part.type
          ? await runPartByType(page, cred, part, opts)        // multi-archetype
          : await runPartAgent(page, cred, part, material, opts);
      } finally {
        await ctx.close();
      }
      log(`  [worker ${wid} @${((Date.now() - t0) / 1000).toFixed(1)}s] DONE  ${part.name}`
        + ` (${results[idx].converged ? 'OK' : 'FAIL'})`);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i + 1)));
  return results;
}

/**
 * System-level test: combine the designed members into the assembled
 * product, run the "System Dynamic Test" tool, and render the whole
 * product's motion (the assembled structure deflecting under load).
 *
 * @param designedMembers [{ name, role, L_mm, b_mm, h_mm }]
 */
export async function runSystemTest(page, cred, designedMembers, totalLoad_N, material) {
  await runTool(page, 'Simulate', 'System Dynamic Test', {
    members: designedMembers, totalLoad_N,
    E_MPa: material.E_MPa, dampingRatio: 0.03,
  }, '__lastSystemResult');
  const result = await page.evaluate(() => window.__lastSystemResult);

  // Render the assembled product flexing under the dynamically-applied load.
  const m = await page.evaluate((lay) => {
    const r = window.__lastSystemResult;
    if (!r || !r.frames || !r.frames.length) return null;
    const W = 560, H = 340;
    const supports = lay.filter((x) => x.role === 'support');
    const span = lay.find((x) => x.role === 'span') || lay[0];
    const supReach = (supports[0] ? supports[0].L_mm : (span.L_mm * 0.7));
    const spanReach = span.L_mm;
    const peak = r.peakDynamicDeflection_mm || 1;
    const dPx = 55 / peak;                       // exaggerate deflection for visibility
    const sx = (W - 150) / ((supReach + spanReach) || 1);
    const ox = 70, oy = H * 0.36;
    const durls = [];
    for (const f of r.frames) {
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const c = cv.getContext('2d');
      c.fillStyle = '#0c0e16'; c.fillRect(0, 0, W, H);
      const d = f.systemDeflection_mm * dPx;
      // wall
      c.fillStyle = '#3a3f4a'; c.fillRect(ox - 22, 36, 22, H - 86);
      // support bracket — cantilever from the wall, tip drops by d
      c.strokeStyle = '#7fb0e0'; c.lineWidth = 9; c.lineJoin = 'round';
      c.beginPath();
      for (let s = 0; s <= 10; s++) {
        const u = s / 10;
        const x = ox + u * supReach * sx;
        const y = oy + ((3 * u * u - u * u * u) / 2) * d;
        if (s) c.lineTo(x, y); else c.moveTo(x, y);
      }
      c.stroke();
      // platform/span — rests on the support tip, sags under load
      const tipX = ox + supReach * sx, tipY = oy + d;
      c.strokeStyle = '#e0b070'; c.lineWidth = 11;
      c.beginPath();
      for (let s = 0; s <= 12; s++) {
        const u = s / 12;
        const x = tipX + u * spanReach * sx;
        const y = tipY + Math.sin(Math.PI * u) * d * 0.45;
        if (s) c.lineTo(x, y); else c.moveTo(x, y);
      }
      c.stroke();
      // payload marker on the platform
      c.fillStyle = '#e06a3a';
      c.beginPath(); c.arc(tipX + spanReach * sx * 0.5, tipY + d * 0.45, 8, 0, 7); c.fill();
      c.fillStyle = '#9ab'; c.font = '12px monospace';
      c.fillText('system dynamic test — assembled product under load', 12, 22);
      c.fillText(`t = ${(f.t * 1000).toFixed(0)} ms   system deflection = `
        + `${f.systemDeflection_mm.toFixed(2)} mm   f1 = ${r.systemNaturalFrequencyHz} Hz`, 12, H - 14);
      durls.push(cv.toDataURL('image/jpeg', 0.82));
    }
    return { W, H, durls };
  }, designedMembers);

  let motion = null;
  if (m && m.durls.length) {
    const frames = m.durls.map((u) => Buffer.from(u.split(',')[1], 'base64'));
    motion = {
      mp4: encodeMP4(frames, { fps: 24, width: m.W, height: m.H }),
      avi: encodeAVI(frames, { fps: 24, width: m.W, height: m.H }),
      frameCount: frames.length,
    };
  }
  return { result, motion };
}

/**
 * Deterministic assembly resolver — NOT free LLM coordinates.
 *
 * Real CAD assembly is constraint-driven: parts are positioned by their
 * relationships, not by guessed coordinates. This resolver places a
 * "support + span" assembly so the parts touch BY CONSTRUCTION:
 *   • supports are rooted at the wall (X=0) on the ground (Z=0),
 *     distributed in Y under the span, extending +X by their reach;
 *   • the span rests exactly on top of the supports (its underside Z =
 *     the supports' top Z).
 * Extrude Boss axes: width→X, depth→Y, height→Z (from Z=0 up), XY centred.
 *
 * @param designedParts [{ name, role, L_mm, b_mm, h_mm }]
 * @returns { placements:[{ name, build:{width,depth,height,translate,rotate} }], span, supports }
 */
export function resolveAssembly(designedParts) {
  let span = designedParts.find((p) => p.role === 'span');
  if (!span) {
    span = designedParts.slice().sort((a, b) => (b.L_mm * b.b_mm) - (a.L_mm * a.b_mm))[0];
  }
  const supports = designedParts.filter((p) => p !== span);
  const hSupMax = Math.max(1, ...supports.map((p) => p.h_mm));
  const spanWidthY = span.b_mm;
  const placements = [];

  supports.forEach((p, i) => {
    let y = 0;
    if (supports.length > 1) {
      const margin = p.b_mm / 2 + 10;
      const lo = -spanWidthY / 2 + margin, hi = spanWidthY / 2 - margin;
      y = lo + (hi - lo) * (i / (supports.length - 1));
    }
    placements.push({
      name: p.name,
      build: {
        width: p.L_mm, depth: p.b_mm, height: p.h_mm,   // reach→X, width→Y, thickness→Z
        translate: [p.L_mm / 2, y, 0], rotate: [0, 0, 0],
      },
    });
  });
  placements.push({
    name: span.name,
    build: {
      width: span.L_mm, depth: span.b_mm, height: span.h_mm,
      translate: [span.L_mm / 2, 0, hSupMax], rotate: [0, 0, 0],   // resting on the supports
    },
  });
  return { placements, span: span.name, supports: supports.map((p) => p.name) };
}

/**
 * Stacked assembly resolver — for layered products (a watch: caseback →
 * movement → dial → crystal stacked along the central axis; also racks,
 * presses, towers). Heterogeneous parts: each carries a `geometry`
 * descriptor ({kind:'box',width,depth,height} or {kind:'cylinder',
 * diameter,length}). Parts are centred on the axis and stacked in Z so
 * each rests on the previous — coherent by construction.
 *
 * @param parts [{ name, geometry }]
 */
export function resolveStackedAssembly(parts) {
  let z = 0;
  const placements = [];
  for (const p of parts) {
    const g = p.geometry || { kind: 'box', width: 20, depth: 20, height: 5 };
    if (g.kind === 'cylinder') {
      const R = g.diameter / 2;
      placements.push({
        name: p.name, tool: 'Revolve Boss',
        build: {
          profile: [[0, 0], [R, 0], [R, g.length], [0, g.length]],
          revolveSegs: 48, translate: [0, 0, z], rotate: [0, 0, 0],
        },
      });
      z += g.length;
    } else {
      placements.push({
        name: p.name, tool: 'Extrude Boss',
        build: {
          width: g.width, depth: g.depth, height: g.height,
          translate: [0, 0, z], rotate: [0, 0, 0],
        },
      });
      z += g.height;
    }
  }
  return { placements, totalHeight_mm: +z.toFixed(1) };
}

/** Build every part at its resolved placement (real ArchDisc tools). */
export async function buildAssembly(page, plan) {
  for (const pl of plan.placements) {
    await runTool(page, 'Part', pl.tool || 'Extrude Boss', pl.build, '__lastFoundationManifold');
  }
}

/**
 * Numeric coherence check: every body must connect to the rest. Two
 * bodies connect when their bounding boxes overlap (within a tolerance)
 * on all three axes. A coherent assembly is ONE connected component.
 */
export async function checkAssemblyCoherence(page) {
  return page.evaluate(() => {
    const bodies = window.__archdiscBodies.list();
    const boxes = bodies.map((b) => {
      const bb = b.manifold.boundingBox();
      return { min: bb.min, max: bb.max };
    });
    const tol = 2.0;                                  // mm
    const touch = (a, b) => {
      for (let ax = 0; ax < 3; ax++) {
        if (a.min[ax] > b.max[ax] + tol || b.min[ax] > a.max[ax] + tol) return false;
      }
      return true;
    };
    // connected components over the touch graph
    const n = boxes.length;
    const seen = new Array(n).fill(false);
    let components = 0;
    for (let i = 0; i < n; i++) {
      if (seen[i]) continue;
      components++;
      const stack = [i];
      seen[i] = true;
      while (stack.length) {
        const k = stack.pop();
        for (let j = 0; j < n; j++) {
          if (!seen[j] && touch(boxes[k], boxes[j])) { seen[j] = true; stack.push(j); }
        }
      }
    }
    const env = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
    for (const bx of boxes) for (let a = 0; a < 3; a++) {
      env.min[a] = Math.min(env.min[a], bx.min[a]);
      env.max[a] = Math.max(env.max[a], bx.max[a]);
    }
    return {
      bodyCount: n, components, coherent: components === 1,
      envelope_mm: [env.max[0] - env.min[0], env.max[1] - env.min[1], env.max[2] - env.min[2]]
        .map((v) => +v.toFixed(0)),
    };
  });
}

/**
 * Render the assembled 3-D product — an orbit of the real Three.js
 * viewport (capture renderer, per-part materials) → motion video.
 */
export async function renderAssemblyOrbit(page, opts = {}) {
  const nFrames = opts.frames ?? 28;
  const m = await page.evaluate((frames) => {
    const THREE = window.THREE, scene = window.__three_scene;
    if (!THREE || !scene) return null;
    const groups = scene.children.filter((o) => {
      let f = false; o.traverse((x) => { if (x.userData && x.userData.foundationManifold) f = true; });
      return f;
    });
    if (!groups.length) return null;
    const palette = [[120, 150, 188], [196, 168, 108], [126, 168, 138],
      [176, 140, 120], [150, 156, 168], [200, 120, 90]];
    groups.forEach((g, i) => {
      const c = palette[i % palette.length];
      g.traverse((mh) => {
        if (mh.isMesh) mh.material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255),
          metalness: 0.4, roughness: 0.5, side: THREE.DoubleSide,
        });
      });
    });
    const hidden = [];
    scene.traverse((o) => {
      if (o.visible && (o.type === 'GridHelper' || o.type === 'AxesHelper'
        || (o.userData && o.userData.isHelper))) { o.visible = false; hidden.push(o); }
    });
    const box = new THREE.Box3();
    for (const g of groups) { g.updateMatrixWorld(true); box.expandByObject(g); }
    const ctr = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const cap = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    cap.setClearColor(0x0c0e16, 1);
    cap.toneMapping = THREE.ACESFilmicToneMapping; cap.toneMappingExposure = 1.05;
    if (THREE.SRGBColorSpace) cap.outputColorSpace = THREE.SRGBColorSpace;
    const cam = new THREE.PerspectiveCamera(40, 1, maxDim * 0.01, maxDim * 100);
    const W = 640, H = 400;
    const shoot = (az) => {
      cap.setSize(W, H, false); cam.aspect = W / H;
      const a = az * Math.PI / 180, el = 14 * Math.PI / 180;
      const dist = (maxDim / 2) / Math.tan((cam.fov * Math.PI / 180) / 2) * 1.6;
      cam.position.set(ctr.x + dist * Math.cos(el) * Math.sin(a),
        ctr.y + dist * Math.sin(el), ctr.z + dist * Math.cos(el) * Math.cos(a));
      cam.lookAt(ctr); cam.updateProjectionMatrix();
      cap.render(scene, cam);
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      cv.getContext('2d').drawImage(cap.domElement, 0, 0);
      return cv.toDataURL('image/jpeg', 0.85);
    };
    const durls = [];
    for (let f = 0; f < frames; f++) durls.push(shoot((f / frames) * 360));
    cap.dispose();
    for (const o of hidden) o.visible = true;
    return { W, H, durls, partCount: groups.length };
  }, nFrames);
  if (!m || !m.durls.length) return null;
  const fr = m.durls.map((u) => Buffer.from(u.split(',')[1], 'base64'));
  return {
    mp4: encodeMP4(fr, { fps: 14, width: m.W, height: m.H }),
    avi: encodeAVI(fr, { fps: 14, width: m.W, height: m.H }),
    frameCount: fr.length, partCount: m.partCount,
    still: fr[Math.round(fr.length * 0.68)],   // wall-end 3/4 — shows all parts
  };
}

/**
 * Render the transient response in window.__lastDynamicResult frame by
 * frame — the cantilever flexing and settling — as JPEG data URLs.
 */
export async function renderDynamicMotion(page) {
  return page.evaluate(() => {
    const r = window.__lastDynamicResult;
    if (!r || !r.frames || !r.frames.length) return null;
    const W = 520, H = 320;
    let maxX = 0, maxY = 1e-6;
    for (const f of r.frames) for (const [x, y] of f.shape) {
      if (x > maxX) maxX = x;
      if (Math.abs(y) > maxY) maxY = Math.abs(y);
    }
    const mx = 70;
    const sx = (W - 2 * mx) / (maxX || 1);
    const sy = Math.min(sx, (H * 0.30) / maxY);
    const ox = mx, oy = H / 2;
    const durls = [];
    for (const f of r.frames) {
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const c = cv.getContext('2d');
      c.fillStyle = '#0c0e16'; c.fillRect(0, 0, W, H);
      // clamped wall
      c.fillStyle = '#3a3f4a'; c.fillRect(ox - 18, oy - 80, 18, 160);
      // the deflected cantilever
      c.strokeStyle = '#7fb0e0'; c.lineWidth = 7; c.lineJoin = 'round';
      c.beginPath();
      f.shape.forEach(([x, y], i) => {
        const px = ox + x * sx, py = oy - y * sy;
        if (i) c.lineTo(px, py); else c.moveTo(px, py);
      });
      c.stroke();
      // tip + load
      const tip = f.shape[f.shape.length - 1];
      const tx = ox + tip[0] * sx, ty = oy - tip[1] * sy;
      c.fillStyle = '#e06a3a';
      c.beginPath(); c.arc(tx, ty, 7, 0, 7); c.fill();
      c.fillStyle = '#9ab'; c.font = '12px monospace';
      c.fillText('dynamic response — transient cantilever', 12, 20);
      c.fillText(`t = ${(f.t * 1000).toFixed(1)} ms    tip = ${f.tipDeflection_mm.toFixed(2)} mm`,
        12, H - 14);
      durls.push(cv.toDataURL('image/jpeg', 0.82));
    }
    return { W, H, durls };
  });
}
