# L2 AI Sculptor — First Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An LLM autonomously decides the atomic-operation sequence — given only a plain-text part description — and that sequence sculpts a real solid in the running ArchDisc desktop app. The AI does the modeling; no script hard-codes the steps.

**Architecture:** A new `ai/sculptor/PartSculptor.js`: build a prompt describing the atomic operation set → call the BYO LLM (`PROVIDERS.azureOpenAI`) → parse the returned JSON operation plan → execute it through `window.__archdiscAtomic`. The workbench exposes the sculptor on `window.__archdiscSculptor`; a headed Electron spec gives it a text prompt and watches the AI sculpt.

**Tech Stack:** ES modules; the BYO-LLM provider layer (`ai/PlannerProviders.js`); `manifold-3d` via the existing AtomicOps; React. Tests: Node-mode Playwright for the pure parse/execute logic; a headed `_electron` Playwright spec for the real end-to-end LLM sculpt. Runner: `./node_modules/.bin/playwright` (never `npx`).

---

## Context for the Engineer

**Plan 5** of the autonomous atomic-CAD sculptor (spec:
`docs/superpowers/specs/2026-05-17-autonomous-atomic-cad-sculptor-design.md`,
layer **L2**). Plans 1–4 shipped the **L0** atomic operations:
`window.__archdiscAtomic` (registered by the mechanical workbench) exposes
`createPart, startSketch, sketchRectangle, sketchCircle, finishSketch, extrude,
cut, revolve, render`. Until now a *script* sequenced those ops. This plan puts
an **LLM** in charge of deciding the sequence.

**Verified facts:**
- `frontend/src/ai/PlannerProviders.js` exports `PROVIDERS`. Each provider has
  `async generate({ apiKey, model, baseUrl, system, userMessage }) -> string`.
  `PROVIDERS.azureOpenAI.generate` POSTs to `${baseUrl}/chat/completions` with
  an `api-key` header and `{model, messages:[{role:'system'},{role:'user'}],
  temperature:0.2}`, returning `json.choices[0].message.content`.
- `PlannerProviders.js` is pure JS (fetch/TextDecoder, `localStorage` access is
  `typeof`-guarded) — safe to import in Node.
- LLM credentials live in the gitignored `.llm-credentials.local.json` at the
  repo root, shape: `{ provider:"azureOpenAI", endpoint, apiKey, deployment,
  model:"gpt-4.1", ... }`. `endpoint` is the `baseUrl`.
- `window.__archdiscAtomic` is registered in
  `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` inside a
  `useEffect`. `createPart/startSketch/sketchRectangle/sketchCircle/finishSketch`
  are synchronous; `extrude/cut/revolve` are async; `render(part)` draws.
- `Part.describe()` returns the construction history as `'1. op -> 2. op ...'`.
- The ArchDisc Electron desktop app loads `frontend/dist` — rebuild before
  launching. Electron-driving pattern: `e2e/atomic-sculpt-sleeve-electron.spec.js`.
- Node-mode Playwright specs: `import { test, expect } from '@playwright/test'`,
  synchronous `test(...)`, no `page`. Use bare imports (`import fs from 'fs'`).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/ai/sculptor/PartSculptor.js` | NEW — `buildSculptPrompt`, `parseSculptPlan`, `executeSculptPlan`, `sculptPart`. The L2 AI Sculptor. |
| `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` | MODIFIED — expose `window.__archdiscSculptor`. |
| `e2e/ai-sculptor-plan.spec.js` | NEW — Node-mode unit tests for prompt/parse/execute. |
| `e2e/ai-sculptor-electron.spec.js` | NEW — headed Electron test: the LLM autonomously sculpts a part. |

---

## Task 1: `PartSculptor.js` — prompt + plan parsing

**Files:**
- Create: `frontend/src/ai/sculptor/PartSculptor.js`
- Test: `e2e/ai-sculptor-plan.spec.js`

- [ ] **Step 1: Write the failing test** — create `e2e/ai-sculptor-plan.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { buildSculptPrompt, parseSculptPlan } from '../frontend/src/ai/sculptor/PartSculptor.js';

test.describe('PartSculptor — prompt', () => {
  test('the system prompt names every atomic operation', () => {
    const p = buildSculptPrompt();
    for (const op of ['startSketch', 'sketchRectangle', 'sketchCircle', 'finishSketch', 'extrude', 'cut', 'revolve']) {
      expect(p).toContain(op);
    }
  });
});

test.describe('PartSculptor — parseSculptPlan', () => {
  test('parses a bare JSON array of operations', () => {
    const plan = parseSculptPlan('[{"op":"startSketch","plane":"XY"},{"op":"finishSketch"}]');
    expect(plan.length).toBe(2);
    expect(plan[0].op).toBe('startSketch');
  });

  test('parses a {"operations":[...]} wrapper object', () => {
    const plan = parseSculptPlan('{"operations":[{"op":"startSketch"},{"op":"finishSketch"}]}');
    expect(plan.length).toBe(2);
  });

  test('strips a ```json markdown fence', () => {
    const plan = parseSculptPlan('```json\n[{"op":"startSketch"}]\n```');
    expect(plan.length).toBe(1);
    expect(plan[0].op).toBe('startSketch');
  });

  test('rejects an unknown operation name', () => {
    expect(() => parseSculptPlan('[{"op":"teleport"}]')).toThrow(/unknown operation/);
  });

  test('rejects a sketchRectangle missing a required numeric param', () => {
    expect(() => parseSculptPlan('[{"op":"sketchRectangle","cx":0,"cy":0,"w":10}]')).toThrow(/sketchRectangle/);
  });

  test('rejects an extrude with a non-numeric distance', () => {
    expect(() => parseSculptPlan('[{"op":"extrude","distance":"deep"}]')).toThrow(/extrude/);
  });

  test('rejects input that is not JSON at all', () => {
    expect(() => parseSculptPlan('I cannot help with that.')).toThrow(/could not parse/);
  });

  test('accepts a full valid plate-with-hole plan', () => {
    const plan = parseSculptPlan(JSON.stringify({ operations: [
      { op: 'startSketch', plane: 'XY' },
      { op: 'sketchRectangle', cx: 0, cy: 0, w: 80, h: 60 },
      { op: 'finishSketch' },
      { op: 'extrude', distance: 8 },
      { op: 'startSketch', plane: 'XY' },
      { op: 'sketchCircle', cx: 0, cy: 0, r: 7.5 },
      { op: 'finishSketch' },
      { op: 'cut', distance: 12 },
    ] }));
    expect(plan.length).toBe(8);
  });
});
```

- [ ] **Step 2: Run test, verify it FAILS**

Run: `./node_modules/.bin/playwright test e2e/ai-sculptor-plan.spec.js --reporter=list`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/ai/sculptor/PartSculptor.js`** (this task writes the first two exports; Task 2 appends the rest):

```js
/**
 * ArchDisc — L2 AI Sculptor.
 *
 * An LLM autonomously decides the sequence of atomic CAD operations that
 * sculpts a part from a plain-text description. This module builds the
 * prompt, parses the LLM's JSON operation plan, validates it, and (Task 2)
 * executes it through the L0 AtomicOps API.
 *
 * The AI does the modeling — no canned recipe, no generator.
 */

/** The atomic operations the sculptor may use, and their required numeric params. */
const OP_SCHEMA = {
  startSketch:     [],
  sketchRectangle: ['cx', 'cy', 'w', 'h'],
  sketchCircle:    ['cx', 'cy', 'r'],
  finishSketch:    [],
  extrude:         ['distance'],
  cut:             ['distance'],
  revolve:         [],
};

/**
 * The system prompt: describes the atomic operation set and the required
 * JSON output schema for the LLM.
 * @returns {string}
 */
export function buildSculptPrompt() {
  return [
    'You are a CAD modeling agent for ArchDisc. Given a description of a',
    'mechanical part, output the sequence of atomic CAD operations that',
    'sculpts it from scratch — the way a human modeler builds it.',
    '',
    'Output ONLY a JSON object: {"operations":[ ... ]}. No prose, no markdown.',
    '',
    'All units are millimetres. Sketches are drawn on the XY plane.',
    'Available operations:',
    '- {"op":"startSketch","plane":"XY"} — open a new sketch (required before sketch entities).',
    '- {"op":"sketchRectangle","cx":N,"cy":N,"w":N,"h":N} — rectangle centred at (cx,cy); w,h > 0.',
    '- {"op":"sketchCircle","cx":N,"cy":N,"r":N} — circle centred at (cx,cy); r > 0.',
    '- {"op":"finishSketch"} — close the sketch into a profile (required before extrude/cut/revolve).',
    '- {"op":"extrude","distance":N} — extrude the finished profile by N mm (>0); adds material.',
    '- {"op":"cut","distance":N} — extrude the finished profile and subtract it (a hole/pocket).',
    '       Use distance GREATER than the material thickness for a clean through-hole.',
    '- {"op":"revolve","segments":N,"degrees":N} — revolve the finished profile into a solid of',
    '       revolution; the profile must lie in the +X half (all x >= 0).',
    '',
    'Rules:',
    '- The first feature must be an extrude or a revolve (cut needs existing material).',
    '- Each extrude/cut/revolve consumes one finished sketch; startSketch again for the next feature.',
    '- Choose real millimetre dimensions that match the description.',
  ].join('\n');
}

/**
 * Parse and validate the LLM's response into an array of operation objects.
 * Accepts a bare JSON array, a {"operations":[...]} wrapper, or either wrapped
 * in a ```json markdown fence. Throws on anything invalid.
 *
 * @param {string} text  the raw LLM completion
 * @returns {Array<object>} the validated operation list
 */
export function parseSculptPlan(text) {
  let s = String(text ?? '').trim();
  // strip a leading/trailing markdown code fence if present
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();

  let data;
  try {
    data = JSON.parse(s);
  } catch {
    throw new Error('parseSculptPlan: could not parse LLM response as JSON');
  }
  const ops = Array.isArray(data) ? data : data?.operations;
  if (!Array.isArray(ops)) {
    throw new Error('parseSculptPlan: expected a JSON array or {"operations":[...]}');
  }
  if (ops.length === 0) {
    throw new Error('parseSculptPlan: the operation plan is empty');
  }
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    const required = OP_SCHEMA[o?.op];
    if (!required) {
      throw new Error(`parseSculptPlan: unknown operation '${o?.op}' at index ${i}`);
    }
    for (const key of required) {
      if (typeof o[key] !== 'number' || !Number.isFinite(o[key])) {
        throw new Error(`parseSculptPlan: operation '${o.op}' at index ${i} needs a numeric '${key}'`);
      }
    }
  }
  return ops;
}
```

- [ ] **Step 4: Run test, verify it PASSES**

Run: `./node_modules/.bin/playwright test e2e/ai-sculptor-plan.spec.js --reporter=list`
Expected: PASS — 9 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ai/sculptor/PartSculptor.js e2e/ai-sculptor-plan.spec.js
git commit -m "Add AI Sculptor prompt + plan parsing (L2 first slice)"
```

---

## Task 2: `executeSculptPlan` + `sculptPart`

**Files:**
- Modify: `frontend/src/ai/sculptor/PartSculptor.js` (append two functions)
- Test: `e2e/ai-sculptor-plan.spec.js` (append a `test.describe` block)

- [ ] **Step 1: Write the failing test** — extend the top import line of `e2e/ai-sculptor-plan.spec.js` to:
`import { buildSculptPrompt, parseSculptPlan, executeSculptPlan } from '../frontend/src/ai/sculptor/PartSculptor.js';`

Append:

```js
test.describe('PartSculptor — executeSculptPlan', () => {
  /** A fake AtomicOps API that records every call instead of doing geometry. */
  function fakeAtomicApi() {
    const calls = [];
    const part = { __fake: true };
    return {
      calls, part,
      createPart: (name) => { calls.push(['createPart', name]); return part; },
      startSketch: (p, plane) => calls.push(['startSketch', plane]),
      sketchRectangle: (p, cx, cy, w, h) => calls.push(['sketchRectangle', cx, cy, w, h]),
      sketchCircle: (p, cx, cy, r) => calls.push(['sketchCircle', cx, cy, r]),
      finishSketch: () => calls.push(['finishSketch']),
      extrude: async (p, d) => calls.push(['extrude', d]),
      cut: async (p, d) => calls.push(['cut', d]),
      revolve: async (p, s, deg) => calls.push(['revolve', s, deg]),
    };
  }

  test('executes a plan as the matching sequence of AtomicOps calls', async () => {
    const api = fakeAtomicApi();
    const plan = [
      { op: 'startSketch', plane: 'XY' },
      { op: 'sketchRectangle', cx: 0, cy: 0, w: 80, h: 60 },
      { op: 'finishSketch' },
      { op: 'extrude', distance: 8 },
    ];
    const part = await executeSculptPlan(plan, api);
    expect(part).toBe(api.part);
    expect(api.calls).toEqual([
      ['createPart', 'AI-Sculpted Part'],
      ['startSketch', 'XY'],
      ['sketchRectangle', 0, 0, 80, 60],
      ['finishSketch'],
      ['extrude', 8],
    ]);
  });

  test('revolve uses its segments/degrees, defaulting when absent', async () => {
    const api = fakeAtomicApi();
    await executeSculptPlan([
      { op: 'startSketch' }, { op: 'sketchRectangle', cx: 15, cy: 20, w: 10, h: 40 },
      { op: 'finishSketch' }, { op: 'revolve' },
    ], api);
    expect(api.calls[api.calls.length - 1]).toEqual(['revolve', 64, 360]);
  });

  test('an unknown op in executeSculptPlan throws', async () => {
    const api = fakeAtomicApi();
    await expect(executeSculptPlan([{ op: 'warpDrive' }], api)).rejects.toThrow(/unknown op/);
  });
});
```

- [ ] **Step 2: Run test, verify the new tests FAIL**

Run: `./node_modules/.bin/playwright test e2e/ai-sculptor-plan.spec.js --reporter=list`
Expected: the 3 new tests FAIL (`executeSculptPlan is not a function`); the 9 prior tests still pass.

- [ ] **Step 3: Append to `frontend/src/ai/sculptor/PartSculptor.js`:**

```js
/**
 * Execute a validated operation plan through an AtomicOps-shaped API,
 * building a Part. The `atomicApi` must provide `createPart, startSketch,
 * sketchRectangle, sketchCircle, finishSketch, extrude, cut, revolve`.
 *
 * @param {Array<object>} plan  operations (validated by parseSculptPlan)
 * @param {object} atomicApi    the AtomicOps API
 * @returns {Promise<object>} the sculpted Part
 */
export async function executeSculptPlan(plan, atomicApi) {
  const part = atomicApi.createPart('AI-Sculpted Part');
  for (const o of plan) {
    switch (o.op) {
      case 'startSketch':     atomicApi.startSketch(part, o.plane ?? 'XY'); break;
      case 'sketchRectangle': atomicApi.sketchRectangle(part, o.cx, o.cy, o.w, o.h); break;
      case 'sketchCircle':    atomicApi.sketchCircle(part, o.cx, o.cy, o.r); break;
      case 'finishSketch':    atomicApi.finishSketch(part); break;
      case 'extrude':         await atomicApi.extrude(part, o.distance); break;
      case 'cut':             await atomicApi.cut(part, o.distance); break;
      case 'revolve':         await atomicApi.revolve(part, o.segments ?? 64, o.degrees ?? 360); break;
      default: throw new Error(`executeSculptPlan: unknown op '${o.op}'`);
    }
  }
  return part;
}

/**
 * The full L2 sculpt: ask the LLM for an operation plan, parse it, and
 * execute it into a Part.
 *
 * @param {object}   args
 * @param {string}   args.description  plain-text part description
 * @param {object}   args.llm          { provider, apiKey, baseUrl, model }
 * @param {object}   args.atomicApi    the AtomicOps API
 * @param {object}   [args.providers]  PROVIDERS map (injected for testing;
 *                                     defaults to ai/PlannerProviders PROVIDERS)
 * @returns {Promise<{part:object, plan:Array, raw:string}>}
 */
export async function sculptPart({ description, llm, atomicApi, providers }) {
  const PROV = providers ?? (await import('../PlannerProviders.js')).PROVIDERS;
  const provider = PROV[llm?.provider];
  if (!provider) throw new Error(`sculptPart: unknown LLM provider '${llm?.provider}'`);
  const raw = await provider.generate({
    apiKey: llm.apiKey,
    model: llm.model,
    baseUrl: llm.baseUrl,
    system: buildSculptPrompt(),
    userMessage: `Part to sculpt: ${description}`,
  });
  const plan = parseSculptPlan(raw);
  const part = await executeSculptPlan(plan, atomicApi);
  return { part, plan, raw };
}
```

(`sculptPart` uses a dynamic `import()` of `PlannerProviders.js` so this module
stays trivially Node-importable for the pure-function tests; the headed spec in
Task 4 exercises the real LLM path.)

- [ ] **Step 4: Run test, verify it PASSES**

Run: `./node_modules/.bin/playwright test e2e/ai-sculptor-plan.spec.js --reporter=list`
Expected: PASS — 12 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ai/sculptor/PartSculptor.js e2e/ai-sculptor-plan.spec.js
git commit -m "Add AI Sculptor plan execution + sculptPart (L2 first slice)"
```

---

## Task 3: Expose the AI Sculptor on `window.__archdiscSculptor`

**Files:**
- Modify: `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`

- [ ] **Step 1: Add the import**

Near the existing `import { createPart, ... } from '../../kernel/atomic/AtomicOps.js';` line, add:

```js
import { sculptPart } from '../../ai/sculptor/PartSculptor.js';
```

- [ ] **Step 2: Add a registration effect**

Immediately after the existing `useEffect` that registers `window.__archdiscAtomic`, add this second effect:

```js
    // Expose the L2 AI Sculptor so headed e2e specs (and the app) can ask an
    // LLM to autonomously sculpt a part from a plain-text description.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__archdiscSculptor = { sculptPart };
        return () => { delete window.__archdiscSculptor; };
    }, []);
```

- [ ] **Step 3: Verify the app builds**

Run: `cd frontend && npx vite build` then `cd ..`. Expected: build succeeds (refreshes `frontend/dist`). Fix only import/syntax you introduced if it fails.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx
git commit -m "Expose the L2 AI Sculptor on window.__archdiscSculptor"
```

---

## Task 4: Headed Electron spec — the LLM autonomously sculpts a part

**Files:**
- Create: `e2e/ai-sculptor-electron.spec.js`

- [ ] **Step 1: Rebuild the frontend**

Run: `cd frontend && npx vite build` then `cd ..`.

- [ ] **Step 2: Create `e2e/ai-sculptor-electron.spec.js`:**

```js
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * L2 AI Sculptor, end to end, in the real ArchDisc desktop app: an LLM is
 * given ONLY a plain-text part description. It autonomously decides the
 * sequence of atomic CAD operations, and that sequence sculpts a real solid
 * in the viewport. No script hard-codes the steps — the AI does the modeling.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');
const CREDS = path.resolve(__dirname, '..', '.llm-credentials.local.json');

test('the AI Sculptor autonomously sculpts a part from a text prompt in the ArchDisc desktop app', async () => {
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

  const description = 'A rectangular mounting plate 80 mm wide, 60 mm deep and 8 mm thick, '
    + 'with a single 15 mm diameter hole drilled clean through its centre.';

  const result = await win.evaluate(async ({ description, llm }) => {
    const { part, plan } = await window.__archdiscSculptor.sculptPart({
      description, llm, atomicApi: window.__archdiscAtomic,
    });
    window.__archdiscAtomic.render(part);
    return { plan, history: part.describe(), volume: part.solid.volume() };
  }, { description, llm });

  console.log('  AI-decided plan: ' + JSON.stringify(result.plan));
  console.log('  construction history: ' + result.history);
  console.log('  sculpted volume: ' + result.volume.toFixed(0) + ' mm^3');

  // The AI chose the dimensions from the prompt. A real solid with a sane
  // volume proves it sculpted something coherent; the screenshot is the
  // definitive check. An 80x60x8 plate is 38400 mm^3; a Ø15 through-hole
  // removes ~1414 mm^3 -> ~36986. Bounds are wide enough to tolerate the
  // AI's modelling choices but tight enough to reject a blob or an empty scene.
  expect(result.plan.length).toBeGreaterThanOrEqual(4);
  expect(result.volume).toBeGreaterThan(20000);
  expect(result.volume).toBeLessThan(55000);

  await win.waitForTimeout(3000);
  await win.screenshot({ path: path.join(OUT, 'electron-ai-sculpted-part.png') });
  await app.close();
});
```

- [ ] **Step 3: Run it**

Run: `./node_modules/.bin/playwright test e2e/ai-sculptor-electron.spec.js --reporter=list`
Expected: PASS — 1 passed. The ArchDisc desktop window opens; after the LLM
responds (a few seconds), a plate-with-a-hole appears in the viewport. The
console prints the AI-decided operation plan.

If it FAILS:
- `test.skip` fired (no creds) → report that honestly; the LLM is not configured.
- LLM HTTP error (401/404/429) → paste it; report BLOCKED — a credential/endpoint
  issue, not a code bug.
- `parseSculptPlan` threw → the LLM produced an off-format plan. Paste the raw
  LLM output if visible. The prompt may need tightening — report DONE_WITH_CONCERNS
  or BLOCKED with the raw output; do NOT loosen `parseSculptPlan`'s validation to
  force a pass.
- Volume outside the band → inspect the AI plan in the console output; report the
  actual plan + volume honestly.

- [ ] **Step 4: Verify the screenshot**

Confirm `autonomous-output/electron-ai-sculpted-part.png` exists and is non-empty.
Open it: confirm it shows a real 3-D solid (a plate with a hole, per the prompt)
in the ArchDisc viewport. Report honestly what you see and what the AI's plan was.

- [ ] **Step 5: Commit**

```bash
git add e2e/ai-sculptor-electron.spec.js
git commit -m "Add headed spec — the LLM AI Sculptor autonomously sculpts a part (L2)"
```

(Do NOT git-add `autonomous-output/` images or `frontend/dist`.)

---

## Self-Review

**Spec coverage:** This is the **L2** first slice — the LLM autonomously
produces the operation plan (spec L2 "decompose" + "execute"). The spec's fuller
L2 (constraint-sketch intent resolved by `SketchSolver`, the per-feature render +
LLM verify loop) is deliberately deferred — this slice proves the core: an LLM,
given only text, drives ArchDisc's real atomic tools to sculpt a solid.

**Placeholder scan:** No placeholders — every step has complete code/commands.

**Type consistency:** `buildSculptPrompt()`, `parseSculptPlan(text)`,
`executeSculptPlan(plan, atomicApi)`, `sculptPart({description, llm, atomicApi,
providers?})` — consistent across `PartSculptor.js`, both specs, and the
workbench. `executeSculptPlan` calls exactly the `window.__archdiscAtomic`
op names from Plans 1–4. The LLM `llm` object — `{provider, apiKey, baseUrl,
model}` — is built from the credential file's `{provider, apiKey, endpoint,
model}` (note `endpoint` → `baseUrl`).

---

## Subsequent Plans

- **Plan 6 — L2 verify loop:** after sculpting, render multi-view, send back to
  the LLM for a visual check; on mismatch, the LLM revises the plan.
- **Plan 7 — sketch constraints, sketch-on-face, patterns, fillet** (remaining L0
  + the constraint-intent half of Approach C).
- **Plan 8+ — L3 verification, L4 assembly, L5 dynamics, L6 render, L7 swarm.**
