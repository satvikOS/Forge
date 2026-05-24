/**
 * sp14-hardening-pass1-electron.spec.js — SP-14 first hardening pass
 *
 * Sub-Project SP-14 of the ArchDisc kernel-parity program — adversarial fuzz
 * over the kernel ops. Per
 * `docs/superpowers/plans/2026-05-21-kernel-parity-program.md` §6:
 *
 *   > "SP-14 (the hardening pass) is explicitly framed as ongoing, not a
 *   > finish line — an adversarial corpus, fuzzing of long op chains, and
 *   > degeneracy handling that grows as ArchDisc gets real use."
 *
 * THIS PASS — PURE E2E + DOCS. NO KERNEL CHANGES. The deliverable IS the
 * suite running + the failure inventory it surfaces. Future hardening passes
 * will fix the failures one by one.
 *
 * ── Corpus scope ────────────────────────────────────────────────────────────
 *
 * The fuzz corpus exercises 10 adversarial categories (per SP-14 brief):
 *   1. Degenerate primitives          (7 cases — zero/negative dims on all 5 prims)
 *   2. Near-tangent booleans          (3 cases — 1e-6 mm gap, edge-tangent, coincident face)
 *   3. Self-intersecting inputs       (2 cases — overlap fuse, self-intersect tool)
 *   4. Zero/extreme parameters        (4 cases — fillet r=0, r=1e6, shell over-thick)
 *   5. Hairline geometry              (3 cases — 1e-7 sides, 1M:1 aspect, 1um sliver)
 *   6. Sliver faces                   (2 cases — thin-strip touch, fillet on sliver)
 *   7. Long op chains                 (1 case  — 50-step alternating fuse/cut)
 *   8. Tolerance stress               (2 cases — mixed-tol fuse, high-tol heal)
 *   9. Massive count                  (2 cases — fuse 200, partition by 20 tools)
 *  10. Round-trip torture             (2 cases — STEP export+reimport)
 *
 * Total: 28 cases across 10 categories.
 *
 * Per-case outcome is classified as one of:
 *   PASS                  expected reject + op caught it / expected accept + op ran cleanly
 *   CAUGHT                op politely refused bad input (threw or returned-null)
 *   UNEXPECTED-EXCEPTION  op threw on input the kernel should handle (partial fail)
 *   SILENT-BAD-OUTPUT     op accepted bad input AND produced bad geometry (fail)
 *   CRASH                 kernel-level crash (Embind PointerErr / table OOB / …) (critical)
 *
 * The PASS / CAUGHT / UNEXPECTED-EXCEPTION / SILENT-BAD-OUTPUT / CRASH counts
 * are the SP-14 first-pass hardening report headline numbers; the full
 * per-case structured result is written to test-results/sp14-hardening/
 * report.json for offline inspection + the sp14-progress.md note.
 *
 * ── Framing — single end-of-run summary ─────────────────────────────────────
 *
 * No per-case motion capture (28 cases × 5+ stills = far too much). ONE
 * end-of-run summary still + the session video shows the workflow proceeding
 * through the corpus. The seed-box ribbon click proves the UI path is healthy
 * before the corpus runs.
 *
 * Run: ./node_modules/.bin/playwright test sp14-hardening-pass1 --headed --workers=1
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { buildPrimitive } from './helpers/uiWorkflow.js';
import { launchWithCapture } from './helpers/motionCapture.js';
import { buildFuzzCorpus, classifyOutcome } from './helpers/fuzzCorpus.js';

test.setTimeout(600000);

test('SP-14 — first hardening pass: adversarial fuzz corpus across 10 categories', async () => {
  const { app, win, pageErrors, story, motionDir } = await launchWithCapture('sp14-hardening');
  win.on('console', m => console.log('[browser] ' + m.text()));
  try {
    // ── Step 1 — seed Box via the ribbon to prove the UI path is healthy ──
    const seedBoxId = await buildPrimitive(win, 'Box');
    console.log(`  seed box id: ${seedBoxId}`);
    await story.frame('01-seed-box-via-ribbon');

    // Clear the scene so the fuzz corpus runs in isolation. Don't pollute
    // the scene with fuzz-case bodies — the corpus is API-level, not
    // scene-level. (If a body is added to scene the registry slows over 200
    // bodies and triggers viewport repaint storms.)
    await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      if (reg) {
        reg.clearSelection();
        const bodies = [...reg.bodies];
        for (const body of bodies) {
          if (typeof reg.remove === 'function') reg.remove(body.id);
          else if (body.group && body.group.parent) body.group.parent.remove(body.group);
        }
      }
    });
    await win.waitForTimeout(220);

    // ── Step 2 — Build the corpus once on the spec side. It serialises as a
    //         flat array of plain objects (id, category, description, expect,
    //         body), each `body` a string that the page rehydrates with
    //         `new AsyncFunction('K', body)`.
    const corpus = buildFuzzCorpus();
    console.log(`  corpus size: ${corpus.length} cases across 10 categories`);

    // ── Step 3 — Run the entire corpus inside the page context. Each case
    //         gets its own per-case try/catch so one CRASH doesn't blow the
    //         whole run. We bound the per-case time so a runaway case can't
    //         hang the whole spec.
    const runStart = Date.now();
    const results = await win.evaluate(async (corpus) => {
      const K = window.__archdiscKernel.kernel;
      const out = [];
      const AsyncFunction = (async () => {}).constructor;
      for (const c of corpus) {
        const caseStart = Date.now();
        let outcome = { ok: false, threw: false, errorMsg: null };
        let stack = null;
        try {
          const fn = new AsyncFunction('K', c.body);
          // The per-case time bound — wrap with a timeout race.
          const TIMEOUT_MS = 90000; // 90s per case
          const timedOut = Symbol('timedout');
          const racer = await Promise.race([
            fn(K),
            new Promise(res => setTimeout(() => res(timedOut), TIMEOUT_MS)),
          ]);
          if (racer === timedOut) {
            outcome = { ok: false, threw: false, note: 'timeout', errorMsg: 'case-exceeded-' + TIMEOUT_MS + 'ms' };
          } else if (racer && typeof racer === 'object') {
            outcome = racer;
          } else {
            outcome = { ok: false, threw: false, errorMsg: 'case-returned-non-object: ' + String(racer) };
          }
        } catch (e) {
          let msg = '';
          try { msg = String(e && e.message); } catch { msg = ''; }
          if (!msg || msg === 'undefined') {
            try { msg = String(e); } catch { msg = '(unstringifiable)'; }
          }
          if (e && typeof e === 'number') msg = 'BindingError(ptr=' + e + ')';
          stack = (e && e.stack ? e.stack.slice(0, 800) : null);
          outcome = { ok: false, threw: true, errorMsg: msg };
        }
        const caseElapsedMs = Date.now() - caseStart;
        out.push({
          id: c.id, category: c.category, description: c.description, expect: c.expect,
          outcome, elapsedMs: caseElapsedMs, stack,
        });
      }
      return out;
    }, corpus);
    const runElapsedSec = ((Date.now() - runStart) / 1000).toFixed(1);
    console.log(`  corpus complete: ${corpus.length} cases ran in ${runElapsedSec}s`);

    // ── Step 4 — Classify each case outcome into the SP-14 verdict band.
    const classified = results.map(r => ({
      ...r,
      verdict: classifyOutcome(r.expect, r.outcome).verdict,
      verdictReason: classifyOutcome(r.expect, r.outcome).reason,
    }));

    // ── Step 5 — Aggregate stats.
    const tally = {
      PASS: 0, CAUGHT: 0,
      'UNEXPECTED-EXCEPTION': 0, 'SILENT-BAD-OUTPUT': 0, CRASH: 0,
    };
    for (const c of classified) tally[c.verdict] = (tally[c.verdict] || 0) + 1;
    const byCategory = {};
    for (const c of classified) {
      if (!byCategory[c.category]) {
        byCategory[c.category] = {
          PASS: 0, CAUGHT: 0,
          'UNEXPECTED-EXCEPTION': 0, 'SILENT-BAD-OUTPUT': 0, CRASH: 0,
          total: 0,
        };
      }
      byCategory[c.category][c.verdict] += 1;
      byCategory[c.category].total += 1;
    }
    const summary = {
      total: classified.length,
      categories: 10,
      runElapsedSec: parseFloat(runElapsedSec),
      tally,
      byCategory,
    };

    // ── Step 6 — Persist the full report to test-results/sp14-hardening/.
    const outDir = path.join(__dirname, '..', 'test-results', 'sp14-hardening');
    fs.mkdirSync(outDir, { recursive: true });
    const report = {
      ranAt: new Date().toISOString(),
      passNumber: 1, // first hardening pass
      pageErrors: pageErrors.slice(),
      summary,
      cases: classified,
    };
    const reportPath = path.join(outDir, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`  report written: ${reportPath}`);

    // ── Step 7 — Dump the headline counts to the spec output for easy reading.
    console.log('\n  ─── SP-14 first hardening pass — summary ──────────────────────');
    console.log(`  Total cases:  ${summary.total}`);
    console.log(`  PASS:                  ${tally.PASS}`);
    console.log(`  CAUGHT (polite reject):${tally.CAUGHT}`);
    console.log(`  UNEXPECTED-EXCEPTION:  ${tally['UNEXPECTED-EXCEPTION']}`);
    console.log(`  SILENT-BAD-OUTPUT:     ${tally['SILENT-BAD-OUTPUT']}`);
    console.log(`  CRASH:                 ${tally.CRASH}`);
    console.log('\n  ─── By category ──────────────────────────────────────────────');
    for (let cat = 1; cat <= 10; cat++) {
      const stats = byCategory[cat];
      if (!stats) continue;
      console.log(`    cat${cat}: P=${stats.PASS} C=${stats.CAUGHT} ` +
        `UX=${stats['UNEXPECTED-EXCEPTION']} SB=${stats['SILENT-BAD-OUTPUT']} ` +
        `CR=${stats.CRASH} / ${stats.total}`);
    }
    console.log('\n  ─── Per-case verdicts (id : verdict : description) ──────────');
    for (const c of classified) {
      const v = c.verdict.padEnd(20);
      console.log(`    ${c.id.padEnd(36)} ${v} ${c.description}`);
    }

    // ── Step 8 — Capture the end-of-run summary still. Switch to the
    //         Topology tab + select the seed body so the screenshot shows
    //         a deterministic frame.
    await story.frame('02-fuzz-corpus-complete');

    // ── Step 9 — Acceptance gates. SP-14 is a hardening SURVEY, not a guard.
    //         The brief explicitly frames this as:
    //           > "this is the FIRST hardening pass. The report is the
    //           > deliverable. It WILL find issues. Catalog them faithfully."
    //         So the spec PASSES if:
    //           (a) every corpus case ran to completion (no swallowed-error
    //               case dropped silently from the report);
    //           (b) the report.json was written;
    //           (c) at least one PASS / CAUGHT was observed (proves the bridge
    //               is wired up and the suite is producing meaningful verdicts);
    //           (d) the corpus exercised every category 1..10 (proves the
    //               survey breadth — no category fell out of the corpus).
    //         The UNEXPECTED-EXCEPTION / SILENT-BAD-OUTPUT / CRASH counts are
    //         INFORMATIONAL findings — recorded in report.json + the progress
    //         note — to be addressed by future hardening passes.
    expect(classified.length, 'every corpus case got an outcome').toBe(corpus.length);
    expect(report.summary.total, 'summary matches corpus size').toBe(corpus.length);
    expect(fs.existsSync(reportPath), 'report.json written').toBe(true);
    expect(tally.PASS + tally.CAUGHT, 'at least one polite-outcome case ran').toBeGreaterThan(0);
    const coveredCategories = Object.keys(byCategory).map(k => Number(k)).sort((a,b)=>a-b);
    expect(coveredCategories, 'every category 1..10 exercised at least once')
      .toEqual([1,2,3,4,5,6,7,8,9,10]);

  } finally {
    await app.close();
    const meta = await story.finish();
    console.log(`  motion capture: video=${meta.videoPath || '(none)'} (${meta.videoSize} bytes), ${meta.stills.length} stills in ${motionDir}`);
  }
});
