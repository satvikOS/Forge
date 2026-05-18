# Cut-on-Face + Verify-Loop Resilience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the two blockers the Seamaster build loop hit on component c1: (A) `cut` cannot cut on a sketch-on-face plane; (B) `sculptAndVerify` crashes when a plan throws during execution instead of feeding the error back for revision.

**Architecture:** (A) `cut` drops its sketch-on-face guard and positions the cut tool by the sketch's base Z — a top-face sketch cuts *downward* from the face. (B) `sculptAndVerify` wraps `executePlan` in try/catch; an execution failure becomes a revision round — `requestPlan` is re-invoked with the error text so the LLM produces a corrected plan.

**Tech Stack:** ES modules; `manifold-3d`. Tests: Node-mode Playwright; the headed Seamaster build-batch spec re-run. Runner: `./node_modules/.bin/playwright` (never `npx`).

---

## Context for the Engineer

Part of the **Omega Seamaster autonomous build**. Plan 12 built the component
build loop; its first real run (building the watch case) hit two blockers:
- `frontend/src/kernel/atomic/AtomicOps.js` `cut` throws
  `'cut: sketch-on-face is not supported for cut yet'` when `part.pendingBaseZ`
  is non-zero (a Plan-7 guard). But the LLM legitimately needs to cut holes on
  the top face of a part.
- `frontend/src/ai/sculptor/PartSculptor.js` `sculptAndVerify` calls
  `executePlan(plan)` with no try/catch — an AtomicOps error propagates and
  crashes the whole build instead of being handled as a revise-able failure.

**Verified facts:**
- `cut` currently: extrudes the pending profile into a `tool`, `tool.translate(
  [0,0,-1])` → `loweredTool`, `Mod.Manifold.difference(part.solid, loweredTool)`.
  The `-1` makes an XY-plane cut start 1 mm below z=0. `part.pendingBaseZ` is the
  sketch's base Z (0 for XY, the face's max/min Z for sketch-on-'top'/'bottom').
- `sculptAndVerify({description, requestPlan, executePlan, renderAndCapture,
  verify, maxRounds})` — `requestPlan` is `async () => ...`; `executePlan(plan)`
  → result; `verify` → `{matches, feedback, revisedOperations}`.
- `e2e/ai-verify-loop.spec.js` has the Node-mode `sculptAndVerify` tests
  (currently 9 total in the file).
- The Seamaster build-batch spec is `e2e/seamaster-build-batch-electron.spec.js`
  — written in Plan 12 T3 but NOT committed (it failed on the blockers). Its
  `requestPlan` callback is `async () => requestSculptPlan({description: comp.
  description, llm})`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/kernel/atomic/AtomicOps.js` | MODIFIED — `cut` supports sketch-on-face. |
| `frontend/src/ai/sculptor/PartSculptor.js` | MODIFIED — `sculptAndVerify` resilient to execution failures. |
| `e2e/ai-verify-loop.spec.js` | MODIFIED — test for the execution-failure recovery path. |
| `e2e/seamaster-build-batch-electron.spec.js` | MODIFIED — `requestPlan` becomes feedback-aware; then committed. |

---

## Task 1: `cut` supports sketch-on-face

**Files:**
- Modify: `frontend/src/kernel/atomic/AtomicOps.js`

- [ ] **Step 1: Rewrite the `cut` function**

In `frontend/src/kernel/atomic/AtomicOps.js`, replace the WHOLE `cut` function
with this:

```js
/**
 * Cut: extrude the pending sketch profile into a tool and subtract it from
 * the Part's current solid.
 *
 * For an XY-plane sketch the tool starts 1 mm below z=0 and goes up. For a
 * sketch-on-face (top/bottom) sketch — `part.pendingBaseZ` non-zero — the tool
 * is positioned to cut DOWNWARD from that face: its top sits 1 mm proud of the
 * face and it removes a pocket of depth `distance` (a through-cut when
 * `distance` exceeds the material thickness).
 *
 * @param {Part} part
 * @param {number} distance  cut depth (mm, > 0; exceed the thickness for a
 *                           through-cut)
 * @returns {Promise<object>} the resulting manifold-3d solid
 */
export async function cut(part, distance) {
  if (!part.pendingProfile) throw new Error('cut: no finished sketch profile — call finishSketch first');
  if (!part.solid) throw new Error('cut: no solid to cut — extrude a base first');
  if (!(distance > 0)) throw new Error('cut: distance must be > 0');
  const Mod = await getManifold();
  const cs = Mod.CrossSection.ofPolygons(part.pendingProfile);
  const tool = Mod.Manifold.extrude(cs, distance);
  cs.delete();
  // Position the tool. XY-plane cut: tool spans z = -1 .. distance-1 (cuts up
  // from below the base). Sketch-on-face cut at z = baseZ: tool spans
  // z = baseZ+1-distance .. baseZ+1 (cuts down from 1 mm proud of the face).
  const baseZ = part.pendingBaseZ ?? 0;
  const dz = baseZ ? (baseZ + 1 - distance) : -1;
  const positioned = tool.translate([0, 0, dz]);
  tool.delete();
  const result = Mod.Manifold.difference(part.solid, positioned);
  part.solid.delete();
  positioned.delete();
  part.solid = result;
  part.pendingProfile = null;
  part.pendingBaseZ = 0;
  part.addFeature('cut', { distance }, result);
  return result;
}
```

This removes the `if (part.pendingBaseZ) throw ...` guard and replaces the fixed
`translate([0,0,-1])` with the base-Z-aware `dz`.

- [ ] **Step 2: Syntax check**

Run: `node --check frontend/src/kernel/atomic/AtomicOps.js` — expect exit 0 (skip if Node rejects ESM `import` in `--check`).

- [ ] **Step 3: Confirm existing atomic tests still pass**

Run: `./node_modules/.bin/playwright test e2e/atomic-parametric-curve.spec.js e2e/atomic-sketch-profile.spec.js e2e/ai-sculptor-plan.spec.js --reporter=list`
Expected: all pass (these don't exercise `cut` directly, but confirm no syntax/import regression — count and report the totals).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/kernel/atomic/AtomicOps.js
git commit -m "cut supports sketch-on-face — cut downward from the face plane (atomic-CAD L0)"
```

---

## Task 2: `sculptAndVerify` resilient to plan-execution failures

**Files:**
- Modify: `frontend/src/ai/sculptor/PartSculptor.js`
- Test: `e2e/ai-verify-loop.spec.js`

- [ ] **Step 1: Write the failing test** — append to the
`test.describe('PartSculptor — sculptAndVerify loop', ...)` block in
`e2e/ai-verify-loop.spec.js`:

```js
  test('an execution failure triggers a re-plan with the error as feedback', async () => {
    let planCalls = 0;
    let executes = 0;
    const feedbacks = [];
    const result = await sculptAndVerify({
      description: 'a part',
      requestPlan: async (feedback) => {
        planCalls++;
        feedbacks.push(feedback ?? null);
        return [{ op: 'extrude', distance: planCalls }];
      },
      executePlan: async () => {
        executes++;
        if (executes === 1) throw new Error('cut: sketch-on-face not supported');
        return { volume: executes };
      },
      renderAndCapture: async () => 'data:image/png;base64,AAA',
      verify: async () => ({ matches: true, feedback: 'ok', revisedOperations: null }),
      maxRounds: 3,
    });
    expect(result.accepted).toBe(true);
    expect(planCalls).toBe(2);                       // initial + re-plan after the failure
    expect(executes).toBe(2);                        // failed attempt + successful retry
    expect(feedbacks[0]).toBe(null);                 // first plan request: no feedback
    expect(feedbacks[1]).toContain('sketch-on-face');// re-plan carries the error text
    expect(result.rounds[0].matches).toBe(false);    // round 1 recorded as a failure
    expect(result.rounds[0].feedback).toContain('execution failed');
  });

  test('persistent execution failures end unaccepted at maxRounds', async () => {
    const result = await sculptAndVerify({
      description: 'an impossible part',
      requestPlan: async () => [{ op: 'extrude', distance: 1 }],
      executePlan: async () => { throw new Error('always broken'); },
      renderAndCapture: async () => 'data:image/png;base64,AAA',
      verify: async () => ({ matches: true }),
      maxRounds: 2,
    });
    expect(result.accepted).toBe(false);
    expect(result.rounds.length).toBe(2);
    expect(result.rounds.every((r) => r.matches === false)).toBe(true);
  });
```

- [ ] **Step 2: Run it, verify the 2 new tests FAIL**

Run: `./node_modules/.bin/playwright test e2e/ai-verify-loop.spec.js --reporter=list`
Expected: the 2 new tests FAIL (the current `sculptAndVerify` lets the
`executePlan` error throw out of the function — the test's `await` rejects).
The prior tests still pass.

- [ ] **Step 3: Replace `sculptAndVerify`**

In `frontend/src/ai/sculptor/PartSculptor.js`, replace the WHOLE `sculptAndVerify`
function with this:

```js
/**
 * The closing L2 loop: produce a plan, execute it, render it, and have a
 * vision LLM verify the render against the description — revising and
 * re-executing when the verdict rejects.
 *
 * Resilient to execution failures: if `executePlan` throws (a bad plan), the
 * round is recorded as a failure and `requestPlan` is re-invoked WITH the error
 * text so the LLM produces a corrected plan. All side-effecting steps are
 * injected callbacks so the loop is environment-agnostic and unit-testable.
 *
 * @param {object} args
 * @param {string}   args.description       the intended part
 * @param {Function} args.requestPlan       async (feedback?) => operations array
 * @param {Function} args.executePlan       async (plan) => result handle (may throw)
 * @param {Function} args.renderAndCapture  async () => image data URL
 * @param {Function} args.verify            async ({description,imageDataUrl})
 *                                          => {matches,feedback,revisedOperations}
 * @param {number}   [args.maxRounds]       max rounds (default 3)
 * @returns {Promise<{plan:Array, result:*, rounds:Array, accepted:boolean}>}
 */
export async function sculptAndVerify({
  description, requestPlan, executePlan, renderAndCapture, verify, maxRounds = 3,
}) {
  const rounds = [];
  let plan = await requestPlan();
  let result = null;
  for (let r = 1; r <= maxRounds; r++) {
    try {
      result = await executePlan(plan);
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      rounds.push({ round: r, matches: false, feedback: 'plan execution failed: ' + msg });
      if (r === maxRounds) return { plan, result: null, rounds, accepted: false };
      plan = await requestPlan('The previous operation plan failed during execution with this '
        + 'error: ' + msg + '. Produce a corrected plan that avoids it.');
      continue;
    }
    const imageDataUrl = await renderAndCapture();
    const verdict = await verify({ description, imageDataUrl });
    rounds.push({ round: r, matches: verdict.matches, feedback: verdict.feedback });
    if (verdict.matches) {
      return { plan, result, rounds, accepted: true };
    }
    if (!verdict.revisedOperations || r === maxRounds) {
      return { plan, result, rounds, accepted: false };
    }
    plan = verdict.revisedOperations;
  }
  return { plan, result, rounds, accepted: false };
}
```

Key changes: `executePlan` is now inside the loop, wrapped in try/catch; on a
throw it records a failure round and re-requests a plan with the error text;
the loop's `continue` retries with the corrected plan.

- [ ] **Step 4: Run it, verify it PASSES**

Run: `./node_modules/.bin/playwright test e2e/ai-verify-loop.spec.js --reporter=list`
Expected: PASS — 11 passed (9 prior + 2 new).

Also re-run the Plan-5 sculptor tests to confirm nothing regressed:
`./node_modules/.bin/playwright test e2e/ai-sculptor-plan.spec.js --reporter=list`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ai/sculptor/PartSculptor.js e2e/ai-verify-loop.spec.js
git commit -m "sculptAndVerify recovers from plan-execution failures by re-planning (L2)"
```

---

## Task 3: Make the build-batch spec feedback-aware and re-run it

**Files:**
- Modify: `e2e/seamaster-build-batch-electron.spec.js`

- [ ] **Step 1: Confirm the spec exists**

`e2e/seamaster-build-batch-electron.spec.js` exists in the working tree
(uncommitted from Plan 12 T3). Confirm it is present. If it is NOT, STOP and
report BLOCKED (it should have been written by Plan 12 Task 3).

- [ ] **Step 2: Make `requestPlan` feedback-aware**

In `e2e/seamaster-build-batch-electron.spec.js`, find the `requestPlan` callback
inside the `sculptAndVerify({ ... })` call. It currently reads:
```js
      requestPlan: async () => requestSculptPlan({ description: comp.description, llm }),
```
Replace it with a feedback-aware version — when `sculptAndVerify` passes error
feedback, append it to the component description so the LLM re-plans informed:
```js
      requestPlan: async (feedback) => requestSculptPlan({
        description: feedback ? `${comp.description}\n\n${feedback}` : comp.description,
        llm,
      }),
```

- [ ] **Step 3: Rebuild the frontend and run the spec**

Run: `cd frontend && npx vite build` then `cd ..`.
Then: `./node_modules/.bin/playwright test e2e/seamaster-build-batch-electron.spec.js --reporter=list`

Expected: with the two blockers fixed, the build batch now progresses — the AI
builds components, each saved with an id and a STEP file under
`autonomous-output/seamaster/components/`. Some complex components (the watch
case) may still not produce a perfect result — but the loop should no longer
*crash*: an execution failure becomes a revision round, and `cut`-on-face works.

Report honestly, whatever happens:
- If it PASSES: how many components built this run, each component's id / name /
  `accepted` verdict / volume, and confirm each STEP file has an `ISO-10303-21`
  first line.
- If a component ends `accepted: false` after maxRounds: that is an HONEST
  outcome — the loop tried, the vision LLM kept rejecting. Report which
  component and the last feedback. Do NOT loosen anything.
- If it still crashes with an unhandled error: paste the exact error and report
  BLOCKED — that is a third blocker, not yet fixed.
- Test timeout: report how far it got (it is a long LLM-driven run).

- [ ] **Step 4: Verify artifacts**

Report the contents of `autonomous-output/seamaster/components/` (the `.step`
files present) and open `autonomous-output/seamaster/build-batch.png` — honestly
describe what the viewport shows.

- [ ] **Step 5: Commit**

If Step 3 PASSED (or ended with honest `accepted:false` components but no
crash — i.e. the spec itself passed its assertions):
```bash
git add e2e/seamaster-build-batch-electron.spec.js
git commit -m "Seamaster build-batch spec — feedback-aware re-planning; first components built"
```
If it still crashes (BLOCKED), do not commit; report the error.

---

## Self-Review

**Spec coverage:** Fixes blocker A (`cut` sketch-on-face) and blocker B
(`sculptAndVerify` execution-failure resilience), then re-runs the build loop.

**Placeholder scan:** No placeholders.

**Type consistency:** `cut` keeps its `(part, distance)` signature and
WASM-heap discipline; only the tool's Z translation changes. `sculptAndVerify`
keeps its `{plan, result, rounds, accepted}` return shape; `requestPlan` is now
called optionally with a `feedback` string — existing zero-arg `requestPlan`
callbacks still work (an extra arg is harmless), and the build-batch spec's
callback is updated to use it.

---

## Subsequent Plans

- Continue the build loop: re-run `seamaster-build-batch` each firing to build
  more components (resumable via the manifest + on-disk STEP files).
- **Plan 14 — assemble the saved components + assembled-watch STEP export.**
- **Plan 15 — motion render → .mp4/.avi; Plan 16 — deliverable ZIP.**
