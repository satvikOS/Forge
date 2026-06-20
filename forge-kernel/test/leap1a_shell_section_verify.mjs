#!/usr/bin/env node
/**
 * leap1a_shell_section_verify.mjs — ONE headless verification of the CFM LEAP-1A
 * re-targeted turbofan (frontend/src/forge-v4/ge9xBuilder.js → buildLEAP1A).
 *
 * Builds the engine TWICE through the existing forge-kernel.node:
 *   (A) cowl-ON  (default 360° revolves) — full nacelle exterior + CHEVRON nozzle.
 *   (B) cutaway  (section:true, 180° revolves of the shell/casing groups).
 *
 * Asserts: body/instance counts, bbox (≈ 1.98 m fan Ø, ~3.3 m core / ~3.7 m incl
 * nacelle), the five nacelle shell bodies + chevron nozzle + tail cone are VALID
 * SOLIDS, the chevron nozzle actually cut its sawtooth notches (cowl-on only),
 * the section build's shells stay valid as half-shell B-reps, and the cowl-on vs
 * cutaway capture body sets differ correctly.
 *
 *   node forge-kernel/test/leap1a_shell_section_verify.mjs
 */
import { fileURLToPath } from 'url';
import path from 'path';
import { makeHeadlessForge } from './cadscore_harness.mjs';

const __filename = fileURLToPath(import.meta.url);
const BUILDER = path.resolve(__filename, '..', '..', '..',
  'frontend', 'src', 'forge-v4', 'ge9xBuilder.js');

const SHELL = ['nacelle_inlet_lip', 'nacelle_fan_cowl', 'nacelle_core_cowl',
  'chevron_exhaust_nozzle', 'exhaust_tail_cone'];

function fanTipDia(res) {
  // fan-blade ring tip Ø = 2 × (fanHubR + fan-blade span) == fanDiameter.
  return res.derived.fanTipR * 2;
}

async function main() {
  const forge = makeHeadlessForge();
  const { buildLEAP1A } = await import(BUILDER);

  console.log('\n  CFM LEAP-1A — NACELLE SHELL + CHEVRON NOZZLE + SECTION-CUT — headless verify');
  console.log('  ' + '═'.repeat(78));

  // ── (A) COWL-ON ────────────────────────────────────────────────────────────
  const A = await buildLEAP1A(forge, {}, {});          // default: full 360° shell
  const errA = A.verbLog.filter((v) => !v.ok);
  const fanDiaA = fanTipDia(A);
  const lenA = A.bboxMm.x / 1000, diaA = Math.max(A.bboxMm.y, A.bboxMm.z) / 1000;
  const coreLenA = (A.axialLayout.exhaust - A.axialLayout.fan) / 1000;  // fan face → core exit

  console.log(`\n  engine            : ${A.engine}`);
  console.log('\n  (A) COWL-ON  (full 360° nacelle shell + chevron nozzle)');
  console.log(`      unique bodies   : ${A.uniqueBodies}`);
  console.log(`      total components: ${A.totalComponents}`);
  console.log(`      verb errors     : ${errA.length}`);
  console.log(`      envelope        : ${lenA.toFixed(2)} m full nacelle × ${diaA.toFixed(2)} m max-Ø`);
  console.log(`      core length     : ${coreLenA.toFixed(2)} m fan-face → core exhaust (target ≈3.3 m)`);
  console.log(`      fan blade tip Ø : ${(fanDiaA / 1000).toFixed(3)} m  (target 1.98 m)`);
  console.log(`      chevrons cut    : ${A.section.chevronsCut}/${A.section.chevronCount}`);
  console.log(`      section.enabled : ${A.section.enabled}  angle=${A.section.angleDeg}°`);

  console.log('\n      HIERARCHY (modules → stages/rows → component counts)');
  for (const mod of A.hierarchy) {
    if (mod.stages) {
      const sum = mod.stages.reduce((a, st) => a + Object.entries(st)
        .filter(([kk]) => kk !== 'stage').reduce((y, [, v]) => y + (typeof v === 'number' ? v : 0), 0), 0);
      console.log(`        ${mod.module.padEnd(16)} ${mod.stages.length} stages → ${sum} components`);
    } else if (mod.flanges) {
      const sum = mod.flanges.reduce((a, f) => a + f.bolts + f.nuts, 0);
      console.log(`        ${mod.module.padEnd(16)} ${mod.flanges.length} flanges → ${sum} components (bolts+nuts)`);
    } else if (mod.rows) {
      const sum = Object.values(mod.rows).reduce((a, v) => a + (typeof v === 'number' ? v : 0), 0);
      console.log(`        ${mod.module.padEnd(16)} → ${sum} components`);
    }
  }

  console.log('\n      NACELLE SHELL BODIES (cowl-on):');
  let shellOkA = true;
  for (const sv of A.shellValidity) {
    const tag = sv.valid === true ? 'VALID' : (sv.valid === false ? 'INVALID' : 'unknown');
    const ok = sv.solid && sv.valid !== false;
    shellOkA = shellOkA && ok;
    console.log(`        ${sv.name.padEnd(24)} group=${(sv.group || '').padEnd(8)} solid=${sv.solid} validity=${tag} vol=${sv.volume != null ? (sv.volume / 1e9).toFixed(3) + ' L' : '—'}`);
  }
  const haveAllShellA = SHELL.every((n) => A.bodies.some((b) => b.name === n && b.triangles > 0));
  const chevBody = A.bodies.find((b) => b.name === 'chevron_exhaust_nozzle');
  const chevValid = A.shellValidity.find((s) => s.name === 'chevron_exhaust_nozzle');

  // ── (B) CUTAWAY (section-cut) ────────────────────────────────────────────────
  const forgeB = makeHeadlessForge();
  const B = await buildLEAP1A(forgeB, {}, { section: true, sectionAngleDeg: 180 });
  const errB = B.verbLog.filter((v) => !v.ok);
  const lenB = B.bboxMm.x / 1000, diaB = Math.max(B.bboxMm.y, B.bboxMm.z) / 1000;

  console.log('\n  (B) CUTAWAY  (section:true, 180° half-shell of nacelle/cowl/casing)');
  console.log(`      unique bodies   : ${B.uniqueBodies}`);
  console.log(`      total components: ${B.totalComponents}`);
  console.log(`      verb errors     : ${errB.length}`);
  console.log(`      envelope        : ${lenB.toFixed(2)} m long × ${diaB.toFixed(2)} m max-Ø`);
  console.log(`      chevrons cut    : ${B.section.chevronsCut}/${B.section.chevronCount}  (section nozzle skips chevron cut)`);
  console.log(`      section.enabled : ${B.section.enabled}  angle=${B.section.angleDeg}°  groups=[${B.section.sectionedGroups.join(',')}]`);

  console.log('\n      SHELL/CASING BODIES (sectioned half-shell B-reps):');
  let shellOkB = true;
  for (const sv of B.shellValidity) {
    const tag = sv.valid === true ? 'VALID' : (sv.valid === false ? 'INVALID' : 'unknown');
    const ok = sv.solid && sv.valid !== false;
    shellOkB = shellOkB && ok;
    console.log(`        ${sv.name.padEnd(24)} group=${(sv.group || '').padEnd(8)} solid=${sv.solid} validity=${tag} vol=${sv.volume != null ? (sv.volume / 1e9).toFixed(3) + ' L' : '—'}`);
  }

  // Section should HALVE the cowl/casing body volumes vs cowl-on (180° revolve).
  const volA = Object.fromEntries(A.shellValidity.map((s) => [s.name, s.volume || 0]));
  const volB = Object.fromEntries(B.shellValidity.map((s) => [s.name, s.volume || 0]));
  console.log('\n      HALF-SHELL VOLUME CHECK (section vol / cowl-on vol ≈ 0.5):');
  let halfOk = true;
  for (const n of ['nacelle_fan_cowl', 'core_casing', 'bypass_duct', 'combustor_liner']) {
    const ratio = volA[n] > 0 ? volB[n] / volA[n] : NaN;
    const ok = ratio > 0.40 && ratio < 0.60;
    halfOk = halfOk && ok;
    console.log(`        ${n.padEnd(24)} ratio=${isNaN(ratio) ? '—' : ratio.toFixed(3)} ${ok ? '' : ' (out of band)'}`);
  }

  // ── capture sets ──────────────────────────────────────────────────────────
  console.log('\n  CAPTURE SETS (how a render toggles cowl-on vs cutaway):');
  console.log(`      cowlOn.visibleGroups  : [${A.captureSets.cowlOn.visibleGroups.join(', ')}]`);
  console.log(`      cowlOn.bodies         : ${A.captureSets.cowlOn.bodies.length} bodies`);
  console.log(`      cutaway.hiddenGroups  : [${A.captureSets.cutaway.hiddenGroups.join(', ')}]`);
  console.log(`      cutaway.visibleGroups : [${A.captureSets.cutaway.visibleGroups.join(', ')}]`);
  console.log(`      cutaway.bodies        : ${A.captureSets.cutaway.bodies.length} bodies (cowl/nacelle hidden)`);
  const cowlOnlyNames = A.bodies.filter((b) => b.group === 'cowl' || b.group === 'nacelle').map((b) => b.name);
  const cutawayHidesShell = cowlOnlyNames.length > 0 &&
    cowlOnlyNames.every((n) => !A.captureSets.cutaway.bodies.includes(n));
  console.log(`      cowl/nacelle bodies hidden in cutaway: ${cutawayHidesShell} (${cowlOnlyNames.join(', ')})`);

  // ── verdict ─────────────────────────────────────────────────────────────────
  const coreOk = coreLenA > 3.0 && coreLenA < 3.6;   // ~3.3 m core (fan face → exit)
  const lenOk = lenA > 3.4 && lenA < 3.9;            // full nacelle envelope ~3.65 m
  const fanOk = Math.abs(fanDiaA - 1980) < 1;        // 1.98 m fan Ø
  const countOk = A.totalComponents > 3000 && A.totalComponents < 15000;
  const noErr = errA.length === 0 && errB.length === 0;
  const chevOk = A.section.chevronsCut === A.section.chevronCount && A.section.chevronCount >= 16 &&
    chevBody && chevBody.triangles > 0 && chevValid && chevValid.valid !== false && chevValid.solid;
  const chevSectionSkips = B.section.chevronsCut === 0; // half-nozzle skips the cut

  console.log('\n  CHECKS');
  const chk = (name, ok) => console.log(`      [${ok ? 'PASS' : 'FAIL'}] ${name}`);
  chk('cowl-on: zero verb errors', errA.length === 0);
  chk('cutaway: zero verb errors', errB.length === 0);
  chk('all 5 nacelle shell bodies present + tessellate (cowl-on)', haveAllShellA);
  chk('all shell/nozzle bodies are valid solids (cowl-on)', shellOkA);
  chk('all shell/casing bodies are valid solids (cutaway half-shells)', shellOkB);
  chk(`chevron nozzle cut all ${A.section.chevronCount} sawtooth notches + valid solid`, chevOk);
  chk('sectioned (half) nozzle correctly skips chevron cut', chevSectionSkips);
  chk('section halves the cowl/casing volumes (~0.5 ratio)', halfOk);
  chk('cutaway capture set hides cowl+nacelle groups', cutawayHidesShell);
  chk(`component count few-k (got ${A.totalComponents})`, countOk);
  chk(`core length ≈3.3 m fan→exit (got ${coreLenA.toFixed(2)} m)`, coreOk);
  chk(`full nacelle length ≈3.65 m (got ${lenA.toFixed(2)} m)`, lenOk);
  chk(`fan blade tip Ø = 1.98 m (got ${(fanDiaA / 1000).toFixed(3)} m)`, fanOk);

  const pass = noErr && haveAllShellA && shellOkA && shellOkB && chevOk && chevSectionSkips &&
    halfOk && cutawayHidesShell && countOk && coreOk && lenOk && fanOk;
  console.log(`\n  RESULT: ${pass ? 'PASS — LEAP-1A shell + chevron nozzle valid, section half-shells valid, cowl-on vs cutaway correct' : 'FAIL'}\n`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('\n[leap1a_shell_section_verify ERROR]', e.stack || e); process.exit(1); });
