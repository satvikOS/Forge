# L2 AI Sculptor — Visual Verify Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** After the AI sculpts a part, render it and show the render to a vision-capable LLM. The LLM judges whether the result matches the description and — if not — proposes a corrected operation plan, which is re-executed. The loop closes: design → render → see → revise.

**Architecture:** A new `ai/sculptor/PartVerifier.js` sends a render image + the part description to a vision LLM and parses its verdict. A new `sculptAndVerify` orchestration in `PartSculptor.js` runs the render→verify→revise loop via injected callbacks. A headed Electron spec wires the callbacks (sculpt + execute in the desktop app, screenshot the viewport, verify against the real LLM) and runs the loop end to end.

**Tech Stack:** ES modules; the BYO-LLM provider layer; `manifold-3d` via AtomicOps; React. Tests: Node-mode Playwright for the pure prompt/parse/loop logic; a headed `_electron` Playwright spec for the real end-to-end verify. Runner: `./node_modules/.bin/playwright` (never `npx`).

---

## Context for the Engineer

**Plan 6** of the autonomous atomic-CAD sculptor (spec:
`docs/superpowers/specs/2026-05-17-autonomous-atomic-cad-sculptor-design.md`,
layer **L2**, the "render + LLM verify" half). Plan 5 shipped the first L2 slice:
`frontend/src/ai/sculptor/PartSculptor.js` exports `buildSculptPrompt`,
`parseSculptPlan`, `executeSculptPlan`, `sculptPart`; an LLM autonomously
produces an atomic-op plan that sculpts a part. This plan adds the **visual
verification loop** — the antidote to "the data checks passed but the result
is a blob."

**Verified facts:**
- The BYO LLM is Azure GPT-4.1, **vision-capable**. The Azure OpenAI v1 chat
  endpoint accepts multimodal user content: `messages:[{role:'user',content:[
  {type:'text',text},{type:'image_url',image_url:{url:'data:image/png;base64,…'}}]}]`.
  Auth header is `api-key`. LLM config comes from `.llm-credentials.local.json`
  (`{provider, endpoint→baseUrl, apiKey, model}`).
- `PartSculptor.js` is Node-importable (its `PlannerProviders` use is a dynamic
  `import()`). `PlannerProviders.js` is Node-safe (fetch/TextDecoder).
- `window.__archdiscAtomic` (the L0 ops + `render`) and `window.__archdiscSculptor`
  (`{sculptPart}`) are registered by `WorkbenchMechanical.jsx`.
- A Three.js WebGL canvas's in-page `toDataURL` is unreliable (drawing buffer
  not preserved). Playwright's `win.screenshot()` reliably captures the rendered
  viewport — so the verify loop is orchestrated Node-side by the spec, calling
  into the page only to execute operations.
- `executeSculptPlan(plan, atomicApi)` is async and returns a `Part`;
  `Part.describe()` / `Part.solid.volume()` give the history / volume.
- The ArchDisc Electron desktop app loads `frontend/dist` — rebuild before
  launching. Electron pattern: `e2e/ai-sculptor-electron.spec.js`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/ai/sculptor/PartVerifier.js` | NEW — `buildVerifyPrompt`, `parseVerifyResponse`, `verifyRender` (the vision-LLM call). |
| `frontend/src/ai/sculptor/PartSculptor.js` | MODIFIED — add `requestSculptPlan` + `sculptAndVerify`; refactor `sculptPart` onto `requestSculptPlan`. |
| `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` | MODIFIED — expose `executeSculptPlan` on `window.__archdiscSculptor`. |
| `e2e/ai-verify-loop.spec.js` | NEW — Node-mode unit tests for verify prompt/parse + the `sculptAndVerify` loop. |
| `e2e/ai-verify-loop-electron.spec.js` | NEW — headed Electron test: the real render→vision-LLM→verdict loop. |

---

## Task 1: `PartVerifier.js` — verify prompt, response parser, vision call

**Files:**
- Create: `frontend/src/ai/sculptor/PartVerifier.js`
- Test: `e2e/ai-verify-loop.spec.js`

- [ ] **Step 1: Write the failing test** — create `e2e/ai-verify-loop.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { buildVerifyPrompt, parseVerifyResponse } from '../frontend/src/ai/sculptor/PartVerifier.js';

test.describe('PartVerifier — verify prompt', () => {
  test('the verify prompt asks for matches / feedback / revisedOperations', () => {
    const p = buildVerifyPrompt();
    expect(p).toContain('matches');
    expect(p).toContain('feedback');
    expect(p).toContain('revisedOperations');
  });
});

test.describe('PartVerifier — parseVerifyResponse', () => {
  test('parses a matches:true verdict', () => {
    const v = parseVerifyResponse('{"matches":true,"feedback":"looks right","revisedOperations":null}');
    expect(v.matches).toBe(true);
    expect(v.feedback).toBe('looks right');
    expect(v.revisedOperations).toBe(null);
  });

  test('parses a matches:false verdict with a revised plan', () => {
    const v = parseVerifyResponse(JSON.stringify({
      matches: false, feedback: 'hole missing',
      revisedOperations: [{ op: 'startSketch' }, { op: 'finishSketch' }],
    }));
    expect(v.matches).toBe(false);
    expect(Array.isArray(v.revisedOperations)).toBe(true);
    expect(v.revisedOperations.length).toBe(2);
  });

  test('strips a ```json markdown fence', () => {
    const v = parseVerifyResponse('```json\n{"matches":true}\n```');
    expect(v.matches).toBe(true);
    expect(v.revisedOperations).toBe(null);   // absent -> normalised to null
  });

  test('rejects a response with no boolean "matches"', () => {
    expect(() => parseVerifyResponse('{"feedback":"hmm"}')).toThrow(/matches/);
  });

  test('rejects input that is not JSON', () => {
    expect(() => parseVerifyResponse('the part looks fine to me')).toThrow(/could not parse/);
  });
});
```

- [ ] **Step 2: Run test, verify it FAILS**

Run: `./node_modules/.bin/playwright test e2e/ai-verify-loop.spec.js --reporter=list`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/ai/sculptor/PartVerifier.js`:**

```js
/**
 * ArchDisc — L2 AI Sculptor: visual verification.
 *
 * After the sculptor builds a part, render it and send the image to a
 * vision-capable LLM, which judges whether the result matches the intent
 * and, if not, proposes a corrected operation plan. This is the antidote
 * to "the data checks passed but the result is a blob".
 */

const VERIFY_OP_REFERENCE =
  'Operation schema for revisedOperations: startSketch{plane}, '
  + 'sketchRectangle{cx,cy,w,h}, sketchCircle{cx,cy,r}, finishSketch, '
  + 'extrude{distance}, cut{distance}, revolve{segments,degrees}.';

/**
 * The system prompt for the visual verification call.
 * @returns {string}
 */
export function buildVerifyPrompt() {
  return [
    'You are a CAD design reviewer. You are given a text description of an',
    'intended mechanical part and a rendered image of the part a CAD agent',
    'actually built. Judge whether the rendered part faithfully matches the',
    'description.',
    '',
    'Output ONLY a JSON object — no prose, no markdown:',
    '{"matches": boolean, "feedback": "one short sentence", "revisedOperations": [...] or null}',
    '',
    '- matches: true only if the rendered part clearly matches the description.',
    '- feedback: one short sentence explaining your judgement.',
    '- revisedOperations: when matches is false, a corrected operation plan',
    '  (a JSON array) that would build the part correctly; otherwise null.',
    '  ' + VERIFY_OP_REFERENCE,
  ].join('\n');
}

/**
 * Parse and normalise the vision LLM's verdict.
 * @param {string} text  the raw LLM completion
 * @returns {{matches:boolean, feedback:string, revisedOperations:Array|null}}
 */
export function parseVerifyResponse(text) {
  let s = String(text ?? '').trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();
  let data;
  try {
    data = JSON.parse(s);
  } catch {
    throw new Error('parseVerifyResponse: could not parse LLM response as JSON');
  }
  if (typeof data?.matches !== 'boolean') {
    throw new Error('parseVerifyResponse: response missing a boolean "matches"');
  }
  return {
    matches: data.matches,
    feedback: typeof data.feedback === 'string' ? data.feedback : '',
    revisedOperations: Array.isArray(data.revisedOperations) ? data.revisedOperations : null,
  };
}

/**
 * Ask a vision-capable LLM whether `imageDataUrl` matches `description`.
 * Assumes an Azure-OpenAI-style v1 chat endpoint (`api-key` header,
 * multimodal user content).
 *
 * @param {object} args
 * @param {string} args.description    the intended part
 * @param {string} args.imageDataUrl   a data: URL of the rendered part
 * @param {object} args.llm            { apiKey, baseUrl, model }
 * @returns {Promise<{matches:boolean, feedback:string, revisedOperations:Array|null}>}
 */
export async function verifyRender({ description, imageDataUrl, llm }) {
  if (!llm?.baseUrl) throw new Error('verifyRender: llm.baseUrl is required');
  const url = `${llm.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': llm.apiKey },
    body: JSON.stringify({
      model: llm.model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: buildVerifyPrompt() },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Intended part: ${description}` },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`verifyRender: LLM ${res.status}: ${t.slice(0, 300)}`);
  }
  const json = await res.json();
  return parseVerifyResponse(json.choices?.[0]?.message?.content ?? '');
}
```

- [ ] **Step 4: Run test, verify it PASSES**

Run: `./node_modules/.bin/playwright test e2e/ai-verify-loop.spec.js --reporter=list`
Expected: PASS — 6 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ai/sculptor/PartVerifier.js e2e/ai-verify-loop.spec.js
git commit -m "Add PartVerifier — vision-LLM render verification (L2 verify loop)"
```

---

## Task 2: `sculptAndVerify` — the render→verify→revise loop

**Files:**
- Modify: `frontend/src/ai/sculptor/PartSculptor.js`
- Test: `e2e/ai-verify-loop.spec.js` (append a `test.describe` block)

- [ ] **Step 1: Write the failing test** — extend the top import of `e2e/ai-verify-loop.spec.js` to also import from PartSculptor:
`import { sculptAndVerify } from '../frontend/src/ai/sculptor/PartSculptor.js';`
(keep the existing PartVerifier import line as its own line.)

Append:

```js
test.describe('PartSculptor — sculptAndVerify loop', () => {
  test('accepts on round 1 when the LLM verdict matches', async () => {
    const calls = [];
    const result = await sculptAndVerify({
      description: 'a plate',
      requestPlan: async () => { calls.push('requestPlan'); return [{ op: 'finishSketch' }]; },
      executePlan: async (plan) => { calls.push('executePlan'); return { volume: 1 }; },
      renderAndCapture: async () => { calls.push('render'); return 'data:image/png;base64,AAA'; },
      verify: async () => ({ matches: true, feedback: 'good', revisedOperations: null }),
      maxRounds: 3,
    });
    expect(result.accepted).toBe(true);
    expect(result.rounds.length).toBe(1);
    expect(calls).toEqual(['requestPlan', 'executePlan', 'render']);
  });

  test('revises and re-executes when the first verdict fails', async () => {
    let verifyCall = 0;
    let executes = 0;
    const result = await sculptAndVerify({
      description: 'a plate with a hole',
      requestPlan: async () => [{ op: 'extrude', distance: 8 }],
      executePlan: async () => { executes++; return { volume: executes }; },
      renderAndCapture: async () => 'data:image/png;base64,AAA',
      verify: async () => {
        verifyCall++;
        return verifyCall === 1
          ? { matches: false, feedback: 'hole missing', revisedOperations: [{ op: 'cut', distance: 12 }] }
          : { matches: true, feedback: 'fixed', revisedOperations: null };
      },
      maxRounds: 3,
    });
    expect(result.accepted).toBe(true);
    expect(executes).toBe(2);                 // initial + one revision
    expect(result.rounds.length).toBe(2);
    expect(result.rounds[0].matches).toBe(false);
    expect(result.rounds[1].matches).toBe(true);
  });

  test('stops unaccepted at maxRounds if the LLM keeps rejecting', async () => {
    const result = await sculptAndVerify({
      description: 'an impossible part',
      requestPlan: async () => [{ op: 'extrude', distance: 8 }],
      executePlan: async () => ({ volume: 1 }),
      renderAndCapture: async () => 'data:image/png;base64,AAA',
      verify: async () => ({ matches: false, feedback: 'still wrong', revisedOperations: [{ op: 'extrude', distance: 9 }] }),
      maxRounds: 2,
    });
    expect(result.accepted).toBe(false);
    expect(result.rounds.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test, verify the new tests FAIL**

Run: `./node_modules/.bin/playwright test e2e/ai-verify-loop.spec.js --reporter=list`
Expected: the 3 new tests FAIL (`sculptAndVerify is not a function`); the 6 PartVerifier tests still pass.

- [ ] **Step 3: Modify `frontend/src/ai/sculptor/PartSculptor.js`.**

(a) Add this import at the very top of the file (after the file's doc comment, before the `OP_SCHEMA` const):

```js
import { verifyRender } from './PartVerifier.js';
```

(b) Find the existing `sculptPart` function. REPLACE the whole `sculptPart`
function with these two functions (`requestSculptPlan` factors out the LLM
plan request; `sculptPart` now reuses it):

```js
/**
 * Ask the LLM for an atomic-operation plan and return the validated plan.
 *
 * @param {object} args
 * @param {string} args.description  plain-text part description
 * @param {object} args.llm          { provider, apiKey, baseUrl, model }
 * @param {object} [args.providers]  PROVIDERS map (injected for testing)
 * @returns {Promise<Array<object>>} the validated operation plan
 */
export async function requestSculptPlan({ description, llm, providers }) {
  const PROV = providers ?? (await import('../PlannerProviders.js')).PROVIDERS;
  const provider = PROV[llm?.provider];
  if (!provider) throw new Error(`requestSculptPlan: unknown LLM provider '${llm?.provider}'`);
  const raw = await provider.generate({
    apiKey: llm.apiKey,
    model: llm.model,
    baseUrl: llm.baseUrl,
    system: buildSculptPrompt(),
    userMessage: `Part to sculpt: ${description}`,
  });
  return parseSculptPlan(raw);
}

/**
 * The full L2 sculpt: ask the LLM for an operation plan and execute it.
 *
 * @param {object}   args
 * @param {string}   args.description  plain-text part description
 * @param {object}   args.llm          { provider, apiKey, baseUrl, model }
 * @param {object}   args.atomicApi    the AtomicOps API
 * @param {object}   [args.providers]  PROVIDERS map (injected for testing)
 * @returns {Promise<{part:object, plan:Array}>}
 */
export async function sculptPart({ description, llm, atomicApi, providers }) {
  const plan = await requestSculptPlan({ description, llm, providers });
  const part = await executeSculptPlan(plan, atomicApi);
  return { part, plan };
}
```

(c) Append this new function at the end of the file:

```js
/**
 * The closing L2 loop: produce a plan, execute it, render it, and have a
 * vision LLM verify the render against the description — revising and
 * re-executing when the verdict rejects. All side-effecting steps are
 * injected callbacks so the loop itself is environment-agnostic and
 * unit-testable.
 *
 * @param {object} args
 * @param {string}   args.description       the intended part
 * @param {Function} args.requestPlan       async () => operations array
 * @param {Function} args.executePlan       async (plan) => result handle
 * @param {Function} args.renderAndCapture  async () => image data URL
 * @param {Function} args.verify            async ({description,imageDataUrl})
 *                                          => {matches,feedback,revisedOperations}
 * @param {number}   [args.maxRounds]       max verify rounds (default 3)
 * @returns {Promise<{plan:Array, result:*, rounds:Array, accepted:boolean}>}
 */
export async function sculptAndVerify({
  description, requestPlan, executePlan, renderAndCapture, verify, maxRounds = 3,
}) {
  let plan = await requestPlan();
  let result = await executePlan(plan);
  const rounds = [];
  for (let r = 1; r <= maxRounds; r++) {
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
    result = await executePlan(plan);
  }
  return { plan, result, rounds, accepted: false };
}
```

- [ ] **Step 4: Run test, verify it PASSES**

Run: `./node_modules/.bin/playwright test e2e/ai-verify-loop.spec.js --reporter=list`
Expected: PASS — 9 passed.

Also re-run the Plan 5 tests to confirm the `sculptPart` refactor didn't break
them: `./node_modules/.bin/playwright test e2e/ai-sculptor-plan.spec.js --reporter=list`
Expected: PASS — 12 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ai/sculptor/PartSculptor.js e2e/ai-verify-loop.spec.js
git commit -m "Add sculptAndVerify render-verify-revise loop (L2 verify loop)"
```

---

## Task 3: Expose `executeSculptPlan` + `requestSculptPlan` on the window hook

**Files:**
- Modify: `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`

The headed verify spec runs the loop in Node and calls into the page only to
execute operations. So the page must expose `executeSculptPlan`.

- [ ] **Step 1: Update the PartSculptor import**

Find:
```js
import { sculptPart } from '../../ai/sculptor/PartSculptor.js';
```
Change to:
```js
import { sculptPart, requestSculptPlan, executeSculptPlan } from '../../ai/sculptor/PartSculptor.js';
```

- [ ] **Step 2: Expose them on `window.__archdiscSculptor`**

Find the effect that registers `window.__archdiscSculptor`. Change the assignment
line from:
```js
        window.__archdiscSculptor = { sculptPart };
```
to:
```js
        window.__archdiscSculptor = { sculptPart, requestSculptPlan, executeSculptPlan };
```
Make no other change.

- [ ] **Step 3: Verify the app builds**

Run: `cd frontend && npx vite build` then `cd ..`. Expected: build succeeds
(refreshes `frontend/dist`). Fix only import/syntax you introduced if it fails.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx
git commit -m "Expose requestSculptPlan + executeSculptPlan on window.__archdiscSculptor"
```

---

## Task 4: Headed Electron spec — the real render→verify loop

**Files:**
- Create: `e2e/ai-verify-loop-electron.spec.js`

- [ ] **Step 1: Rebuild the frontend**

Run: `cd frontend && npx vite build` then `cd ..`.

- [ ] **Step 2: Create `e2e/ai-verify-loop-electron.spec.js`:**

```js
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { sculptAndVerify } from '../frontend/src/ai/sculptor/PartSculptor.js';
import { verifyRender } from '../frontend/src/ai/sculptor/PartVerifier.js';

/*
 * L2 closing loop, end to end, in the real ArchDisc desktop app: the AI
 * sculpts a part, ArchDisc renders it, the rendered image is shown to a
 * vision LLM, and the LLM judges whether it matches the intent (and revises
 * if not). design -> render -> see -> revise, closed.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');
const CREDS = path.resolve(__dirname, '..', '.llm-credentials.local.json');

test('the AI Sculptor sculpts, renders, and a vision LLM verifies the result', async () => {
  test.skip(!fs.existsSync(CREDS), 'no .llm-credentials.local.json — BYO LLM not configured');
  const cred = JSON.parse(fs.readFileSync(CREDS, 'utf8'));
  const llm = { provider: cred.provider, apiKey: cred.apiKey, baseUrl: cred.endpoint, model: cred.model };
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(
    () => !!window.__archdiscAtomic && !!window.__archdiscSculptor, null, { timeout: 60000 });

  const description = 'A round flange disc 70 mm in diameter and 6 mm thick, '
    + 'with a 20 mm diameter bore through its centre.';

  // The verify loop runs Node-side; it calls into the desktop app only to
  // execute operations, and screenshots the genuine viewport for the LLM.
  const result = await sculptAndVerify({
    description,
    requestPlan: async () => {
      const { requestSculptPlan } = await import('../frontend/src/ai/sculptor/PartSculptor.js');
      return requestSculptPlan({ description, llm });
    },
    executePlan: async (plan) => win.evaluate(async (p) => {
      const part = await window.__archdiscSculptor.executeSculptPlan(p, window.__archdiscAtomic);
      window.__archdiscAtomic.render(part);
      return { volume: part.solid.volume(), history: part.describe() };
    }, plan),
    renderAndCapture: async () => {
      await win.waitForTimeout(1500);
      const buf = await win.locator('canvas').first().screenshot();
      return 'data:image/png;base64,' + buf.toString('base64');
    },
    verify: ({ description, imageDataUrl }) => verifyRender({ description, imageDataUrl, llm }),
    maxRounds: 3,
  });

  console.log('  verify rounds: ' + JSON.stringify(result.rounds));
  console.log('  accepted: ' + result.accepted);
  console.log('  final result: ' + JSON.stringify(result.result));

  // The loop must have run at least one render+verify round, and the final
  // executed result must be a real solid (positive volume). `accepted` may be
  // true (the vision LLM approved) or false (it kept rejecting) — both are
  // honest outcomes; the assertion is that the loop genuinely ran.
  expect(result.rounds.length).toBeGreaterThanOrEqual(1);
  expect(typeof result.rounds[0].matches).toBe('boolean');
  expect(result.result.volume).toBeGreaterThan(0);

  await win.waitForTimeout(2000);
  await win.screenshot({ path: path.join(OUT, 'electron-ai-verified-part.png') });
  await app.close();
});
```

- [ ] **Step 3: Run it**

Run: `./node_modules/.bin/playwright test e2e/ai-verify-loop-electron.spec.js --reporter=list`
Expected: PASS — 1 passed. The desktop window opens; the AI sculpts a bored
flange; the console prints the verify rounds (each with the vision LLM's
`matches` verdict and `feedback`).

If it FAILS, diagnose honestly — do NOT loosen assertions or mock the LLM:
- `test.skip` fired → no creds; report it.
- LLM HTTP error on the **verify** call (the multimodal request) → paste it and
  report BLOCKED. A 400 on the image content may mean the deployment does not
  accept vision input — report that finding honestly.
- `parseVerifyResponse`/`parseSculptPlan` threw → the LLM returned off-format
  output; paste the raw output if visible; report DONE_WITH_CONCERNS or BLOCKED.
- An AtomicOps execution error → paste it; report BLOCKED.

- [ ] **Step 4: Verify the screenshot**

Confirm `autonomous-output/electron-ai-verified-part.png` exists and is
non-empty. Open it: confirm a real 3-D solid (a bored disc/flange) is in the
ArchDisc viewport. Report honestly what you see and what the verify rounds said.

- [ ] **Step 5: Commit**

```bash
git add e2e/ai-verify-loop-electron.spec.js
git commit -m "Add headed spec — AI sculpt + vision-LLM verify loop (L2)"
```

(Do NOT git-add `autonomous-output/` images or `frontend/dist`.)

---

## Self-Review

**Spec coverage:** This completes the spec's L2 "render + LLM verify" half — the
design→render→see→revise loop. The fuller L2 (constraint-sketch intent resolved
by `SketchSolver`) and L3+ remain for later plans.

**Placeholder scan:** No placeholders — every step has complete code/commands.

**Type consistency:** `buildVerifyPrompt()`, `parseVerifyResponse(text) ->
{matches,feedback,revisedOperations}`, `verifyRender({description,imageDataUrl,
llm})`, `requestSculptPlan({description,llm,providers?})`, `sculptAndVerify(
{description,requestPlan,executePlan,renderAndCapture,verify,maxRounds?})` —
consistent across `PartVerifier.js`, `PartSculptor.js`, both specs, and the
workbench. `verify`'s return shape matches `parseVerifyResponse`'s output, which
`sculptAndVerify` consumes (`.matches`, `.revisedOperations`). The `sculptPart`
refactor preserves its `{part, plan}` return shape.

---

## Subsequent Plans

- **Plan 7 — sketch constraints (`SketchSolver`) + sketch-on-face.**
- **Plan 8 — patterns, fillet/chamfer, `GeometryQuery` (L1).**
- **Plan 9+ — L3 part verification, L4 assembly, L5 dynamics, L6 render, L7 swarm.**
