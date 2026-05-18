# Multi-Angle Vision Verification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The vision-verify loop currently judges a 3-D component from ONE fixed camera angle — unreliable (a sphere reads as a domed disc, a solid as a hollow ring). This plan makes verification **orbit the camera** and show the vision LLM the component from **several angles**, so verdicts are trustworthy.

**Architecture:** A new `window.__archdiscOrbitView(azimuth, elevation)` hook positions the viewport camera around the framed part. `verifyRender` accepts an array of images and sends all of them in one multimodal message. The build loop's `renderAndCapture` orbits through ~5 angles and returns all the screenshots.

**Tech Stack:** ES modules; Three.js viewport; React. Tests: a headed `_electron` spec. Runner: `./node_modules/.bin/playwright` (never `npx`).

---

## Context for the Engineer

Part of the **Omega Seamaster autonomous build**. The vision-verify loop
(`sculptAndVerify` → `verifyRender`) shows the LLM a single screenshot of the
built component. That is too weak to judge 3-D geometry — every accept/reject
verdict is unreliable. This plan adds multi-angle capture.

**Verified facts:**
- `frontend/src/components/Viewport3D.jsx` sets up Three.js: `camera`,
  `renderer`, `scene`, and `orbitControls` (an `OrbitControls`). Around its other
  `window.__archdisc*` hooks (`__archdiscFocusOnObject`,
  `__archdiscFocusOnFoundationBodies`, `__archdiscScene`, etc.) all four —
  `camera`, `renderer`, `scene`, `orbitControls` — are in scope.
- `addFoundationManifoldToScene` already auto-frames the camera on a new body
  (`__archdiscFocusOnFoundationBodies`). So after a `render`, the part is framed.
- `frontend/src/ai/sculptor/PartVerifier.js` `verifyRender({description,
  imageDataUrl, llm})` builds an Azure multimodal message with one `image_url`.
- `frontend/src/ai/sculptor/PartSculptor.js` `sculptAndVerify` does
  `const imageDataUrl = await renderAndCapture(); verify({description, imageDataUrl})`
  — it is agnostic to what `renderAndCapture` returns, so it needs NO change:
  `renderAndCapture` can return an array and it flows straight through to
  `verify` as the `imageDataUrl` field.
- `e2e/seamaster-build-batch-electron.spec.js` has the `renderAndCapture` and
  `verify` callbacks that drive the build loop.
- The Electron desktop app loads `frontend/dist` — rebuild before launching.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/components/Viewport3D.jsx` | MODIFIED — add `window.__archdiscOrbitView`. |
| `frontend/src/ai/sculptor/PartVerifier.js` | MODIFIED — `verifyRender` accepts multiple images. |
| `e2e/seamaster-build-batch-electron.spec.js` | MODIFIED — `renderAndCapture` orbits + captures 5 views. |
| `e2e/multiview-verify-electron.spec.js` | NEW — headed test proving the orbit + multi-view verify. |

---

## Task 1: `window.__archdiscOrbitView` — orbit the viewport camera

**Files:**
- Modify: `frontend/src/components/Viewport3D.jsx`

- [ ] **Step 1: Add the orbit hook**

In `frontend/src/components/Viewport3D.jsx`, find the block where the other
`window.__archdisc*` hooks are assigned (near `window.__archdiscFocusOnObject`,
`window.__archdiscFocusOnFoundationBodies`, `window.__archdiscScene`). In that
same scope — where `camera`, `renderer`, `scene`, and `orbitControls` are all
in scope — add this hook:

```js
          // Orbit the camera around the framed part to a given azimuth /
          // elevation (degrees), keeping the current distance. Used by the
          // vision-verify loop to inspect a component from several angles.
          window.__archdiscOrbitView = (azimuthDeg, elevationDeg = 20) => {
            const target = orbitControls.target;
            const r = camera.position.distanceTo(target) || 1;
            const az = (azimuthDeg * Math.PI) / 180;
            const el = (elevationDeg * Math.PI) / 180;
            camera.position.set(
              target.x + r * Math.cos(el) * Math.sin(az),
              target.y + r * Math.sin(el),
              target.z + r * Math.cos(el) * Math.cos(az),
            );
            camera.lookAt(target);
            orbitControls.update();
            renderer.render(scene, camera);
          };
```

If the exact variable names differ (e.g. the controls are named `controls` not
`orbitControls`), adapt to the real names in that file — the four things needed
are: the perspective camera, the OrbitControls, the renderer, the scene. The
`renderer.render(scene, camera)` line forces an immediate frame so a screenshot
taken right after reflects the new angle.

- [ ] **Step 2: Verify the app builds**

Run: `cd frontend && npx vite build` then `cd ..`. Expected: build succeeds. Fix
only the hook you added if it fails (e.g. a wrong variable name).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Viewport3D.jsx
git commit -m "Add window.__archdiscOrbitView — orbit the viewport camera for multi-angle capture"
```

---

## Task 2: `verifyRender` accepts multiple view images

**Files:**
- Modify: `frontend/src/ai/sculptor/PartVerifier.js`

- [ ] **Step 1: Update `buildVerifyPrompt`**

In `frontend/src/ai/sculptor/PartVerifier.js`, in `buildVerifyPrompt`, find the
opening lines describing the task and add a sentence that the reviewer is shown
multiple angles. Change the first paragraph so it includes:
`'You are shown the rendered part from SEVERAL camera angles — judge the whole'`
`'3-D shape, not a single silhouette.'`
(Insert those two array elements after the existing
`'actually built. Judge whether the rendered part faithfully matches the'` /
`'description.'` lines, before the blank-line element.)

- [ ] **Step 2: Replace `verifyRender`**

Replace the WHOLE `verifyRender` function with this version — it accepts
`imageDataUrls` (an array) and still tolerates a single `imageDataUrl` for
backward compatibility:

```js
/**
 * Ask a vision-capable LLM whether the rendered part matches `description`.
 * Accepts either `imageDataUrls` (an array of data: URLs — multiple camera
 * angles) or a single `imageDataUrl`. All views go in one multimodal message.
 * Assumes an Azure-OpenAI-style v1 chat endpoint.
 *
 * @param {object} args
 * @param {string} args.description
 * @param {string[]} [args.imageDataUrls]  data: URLs, one per camera angle
 * @param {string} [args.imageDataUrl]     a single data: URL (back-compat)
 * @param {object} args.llm                { apiKey, baseUrl, model }
 * @returns {Promise<{matches:boolean, feedback:string, revisedOperations:Array|null}>}
 */
export async function verifyRender({ description, imageDataUrls, imageDataUrl, llm }) {
  if (!llm?.baseUrl) throw new Error('verifyRender: llm.baseUrl is required');
  const urls = Array.isArray(imageDataUrls) && imageDataUrls.length
    ? imageDataUrls
    : (imageDataUrl ? [imageDataUrl] : []);
  if (urls.length === 0) throw new Error('verifyRender: at least one image is required');
  const url = `${llm.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const content = [
    { type: 'text', text: `Intended part: ${description}\n`
      + `You are shown the rendered part from ${urls.length} camera angle(s).` },
    ...urls.map((u) => ({ type: 'image_url', image_url: { url: u } })),
  ];
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': llm.apiKey },
    body: JSON.stringify({
      model: llm.model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: buildVerifyPrompt() },
        { role: 'user', content },
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

- [ ] **Step 3: Confirm the parser tests still pass**

Run: `./node_modules/.bin/playwright test e2e/ai-verify-loop.spec.js --reporter=list`
Expected: PASS — 11 passed (`buildVerifyPrompt`/`parseVerifyResponse`/
`sculptAndVerify` tests are unaffected by the `verifyRender` change).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/ai/sculptor/PartVerifier.js e2e/ai-verify-loop.spec.js
git commit -m "verifyRender accepts multiple camera-angle images (multi-angle verification)"
```

(If `ai-verify-loop.spec.js` was not modified, just `git add` PartVerifier.js.)

---

## Task 3: Multi-angle capture in the build loop + a proof spec

**Files:**
- Modify: `e2e/seamaster-build-batch-electron.spec.js`
- Create: `e2e/multiview-verify-electron.spec.js`

- [ ] **Step 1: Update the build loop's `renderAndCapture` and `verify`**

In `e2e/seamaster-build-batch-electron.spec.js`, find the `renderAndCapture` and
`verify` callbacks inside the `sculptAndVerify({ ... })` call.

Replace `renderAndCapture` with a multi-angle version:
```js
      renderAndCapture: async () => {
        const views = [];
        for (const az of [30, 100, 170, 240, 310]) {
          await win.evaluate((a) => window.__archdiscOrbitView(a, 22), az);
          await win.waitForTimeout(350);
          const buf = await win.locator('canvas').first().screenshot();
          views.push('data:image/png;base64,' + buf.toString('base64'));
        }
        return views;
      },
```

Replace `verify` so it passes the array of views to `verifyRender`:
```js
      verify: ({ description, imageDataUrl }) =>
        verifyRender({ description, imageDataUrls: imageDataUrl, llm }),
```
(`sculptAndVerify` passes `renderAndCapture`'s return value through as
`imageDataUrl` — here that value is the array of views.)

Make no other change to that spec.

- [ ] **Step 2: Create the proof spec** — `e2e/multiview-verify-electron.spec.js`:

```js
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { verifyRender } from '../frontend/src/ai/sculptor/PartVerifier.js';

/*
 * Proof of multi-angle vision verification: sculpt one part, orbit the camera
 * through five angles capturing a screenshot at each, send all five to the
 * vision LLM in one call, and confirm a verdict comes back. The five view
 * images are saved so a human can see the part really was captured all round.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');
const CREDS = path.resolve(__dirname, '..', '.llm-credentials.local.json');

test('the vision verifier judges a part from five orbited camera angles', async () => {
  test.skip(!fs.existsSync(CREDS), 'no .llm-credentials.local.json — BYO LLM not configured');
  test.setTimeout(180000);
  const cred = JSON.parse(fs.readFileSync(CREDS, 'utf8'));
  const llm = { provider: cred.provider, apiKey: cred.apiKey, baseUrl: cred.endpoint, model: cred.model };
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(
    () => !!window.__archdiscSculptor && !!window.__archdiscOrbitView, null, { timeout: 60000 });

  const description = 'A flat ring (annulus) 40 mm outer diameter, 24 mm inner diameter, 4 mm thick.';

  // Sculpt the part.
  await win.evaluate(async ({ description, llm }) => {
    const { part } = await window.__archdiscSculptor.sculptPart({
      description, llm, atomicApi: window.__archdiscAtomic,
    });
    window.__archdiscAtomic.render(part);
  }, { description, llm });

  // Orbit the camera through five angles, capturing a view at each.
  const views = [];
  const angles = [30, 100, 170, 240, 310];
  for (let i = 0; i < angles.length; i++) {
    await win.evaluate((a) => window.__archdiscOrbitView(a, 22), angles[i]);
    await win.waitForTimeout(400);
    const buf = await win.locator('canvas').first().screenshot();
    fs.writeFileSync(path.join(OUT, `multiview-${i + 1}.png`), buf);
    views.push('data:image/png;base64,' + buf.toString('base64'));
  }
  expect(views.length).toBe(5);

  // Two views from different angles must actually differ (the camera moved).
  expect(views[0]).not.toBe(views[2]);

  // Send all five to the vision LLM.
  const verdict = await verifyRender({ description, imageDataUrls: views, llm });
  console.log('  multi-angle verdict: matches=' + verdict.matches + ', feedback=' + verdict.feedback);
  expect(typeof verdict.matches).toBe('boolean');

  await app.close();
});
```

- [ ] **Step 3: Rebuild and run the proof spec**

Run: `cd frontend && npx vite build` then `cd ..`.
Then: `./node_modules/.bin/playwright test e2e/multiview-verify-electron.spec.js --reporter=list`

Expected: PASS — 1 passed. Five view images `autonomous-output/multiview-1.png`
… `multiview-5.png` are written, the camera demonstrably moved between them
(`views[0] !== views[2]`), and the vision LLM returned a verdict.

If it FAILS, diagnose honestly:
- `__archdiscOrbitView` not a function → Task 1 hook did not register; BLOCKED.
- `views[0] === views[2]` → the camera did not actually orbit (the hook ran but
  the render did not update); report BLOCKED — the orbit hook needs the render
  fix.
- `verifyRender` HTTP error → paste it; BLOCKED.

- [ ] **Step 4: Verify the artifacts**

Open `autonomous-output/multiview-1.png` … `multiview-5.png`. Honestly confirm
they show the SAME part from FIVE genuinely different camera angles (the part
rotates / the viewpoint changes across the five). Report what you see.

- [ ] **Step 5: Commit**

```bash
git add e2e/seamaster-build-batch-electron.spec.js e2e/multiview-verify-electron.spec.js
git commit -m "Multi-angle capture in the build loop + proof spec (multi-angle verification)"
```

---

## Self-Review

**Spec coverage:** The vision-verify loop now inspects each component from five
orbited camera angles instead of one — verdicts (accept and reject alike) become
trustworthy. `sculptAndVerify` is unchanged (it passes `renderAndCapture`'s
return straight to `verify`). Honest note: multi-angle verification makes the
check *more accurate*, which means it will catch *more* bad geometry — it does
not make limited geometry pass; it makes the honest verdict reliable.

**Placeholder scan:** No placeholders.

**Type consistency:** `window.__archdiscOrbitView(azimuthDeg, elevationDeg)`.
`verifyRender` accepts `imageDataUrls` (array) or `imageDataUrl` (single,
back-compat). `renderAndCapture` returns a `string[]`; `sculptAndVerify` passes
it through as `imageDataUrl`; the build spec's `verify` forwards it as
`imageDataUrls` to `verifyRender`.

---

## Subsequent Plans

- Re-run the Seamaster build batch with multi-angle verification active.
- Deliverable plan: ZIP of component STEPs + an honest per-component
  verified/best-effort build report.
