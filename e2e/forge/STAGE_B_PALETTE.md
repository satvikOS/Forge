# Stage B (path 1) — CommandPalette-driven genuine CUA

`demo-forge-cua-palette.spec.js` is the second on-ramp to **genuine computer-use**
for Archie driving Forge. Where Stage A (`demo-forge-cua-genuine.spec.js`) has the
model emit kernel `<tool_call>`s into the chat console, Stage B path 1 upgrades the
**driver** to genuine UI operation: the model names a UI **command**, and the
harness opens the real **CommandPalette**, types it, and selects the top fuzzy
match — turning spatial grounding into text-search.

## How to run it

This is a HEADED capture harness ([[feedback-headed-tests]]), not a deterministic
CI test. It needs the **built dist** and a **live serve on :8080** with the Forge
adapter. The GPU must be free (do NOT run it while a training job holds the GPU).

```sh
cd /Users/account_clawteam1/archdisc-Mech
(cd frontend && npm run build)                 # the dist must be current

# in another shell, with the Forge LoRA weights present:
cd ~/archdisc-Models && ./serve_forge_cua.sh   # boots mlx_lm.server on :8080

# back in archdisc-Mech, headed on the Mac Studio:
npx playwright test e2e/forge/demo-forge-cua-palette.spec.js \
  --config=playwright.config.js --headed
```

### Env knobs

| Env | Default | Meaning |
| --- | --- | --- |
| `FORGE_PALETTE_PROMPT`  | an L-bracket goal | the CAD goal the model drives toward. **VARY THIS per run** ([[feedback-vary-test-prompts]]). |
| `FORGE_PALETTE_STEPS`   | `10` | max screenshot→decide→act turns (each is one :8080 call). |
| `FORGE_PALETTE_ENV`     | `studio` | photoreal HDRI environment preset. |
| `FORGE_PALETTE_OUT`     | `forge-cua-palette` | output basename. |
| `FORGE_PALETTE_ADAPTER` | the routed adapter | informational only; logged. |
| `FORGE_ARCHIE_URL`      | `http://localhost:8080` | the served model endpoint. |

Deliverables land in `e2e/forge/shots/flagship/`:
`forge-cua-palette.mp4`, `forge-cua-palette.png` (hero), `…_hero_{iso,front,top,right,back}.png`.

## What it proves

1. **Genuine palette operation.** Each turn the harness screenshots the *canvas
   only* (`[data-testid="forge-v4-canvas"]`), asks the served model — via the
   **same :8080 endpoint + `adapters` routing ForgeRunner uses** (no `model`
   field; `frontend/src/ai/ForgeRunner.js:25,35,235`) — for ONE UI command as a
   tiny JSON `{"command","done","why"}`, then performs the real human gesture:
   open the CommandPalette → type the command into its real input → let the
   fuzzy matcher filter → select the top match (Enter).
2. **The model is genuinely in the loop.** A *compact palette system prompt*
   (`PALETTE_SYSTEM` in the spec) instructs the model to name UI command search
   text, **NOT** a forge `tool_call`. The decision is parsed and logged per turn;
   the spec asserts the model named ≥1 command and the palette matched + executed
   ≥1 of them.
3. **Honest outcomes.** It asserts an mp4 was produced (real `ftyp` header, >20
   frames), `:8080` actually answered (else it fails loudly with the
   `serve_forge_cua.sh` fix — **no fake fallback**), and a body **or** feature was
   produced through genuine palette operation. Then photoreal multi-cam render
   (≥5 named angles + orbit) of whatever the palette built, mirroring the Stage-A
   / flagship `setupPhotoreal` + `fitPart` path.

## The real palette surface (from source)

- **Open shortcut:** `Cmd+K` / `Ctrl+K` — `CommandPaletteHost` keydown listener,
  `CommandPalette.jsx:423-431` (`meta && e.key.toLowerCase() === 'k'`).
  Programmatic opener (same state setter the chord calls):
  `window.__forgeOpenCommandPalette(true)` — `CommandPalette.jsx:434`.
- **Input:** `[data-testid="forge-cmd-palette-input"]` — `CommandPalette.jsx:367`.
- **Results list:** `[data-testid="forge-cmd-palette-results"]` with a live
  `data-result-count` attribute — `CommandPalette.jsx:373-374`.
- **Result rows:** `li[role="option"]`, each with `data-cmd-id`, `data-cmd-kind`
  and `aria-selected` — `CommandPalette.jsx:384-388`. The active (first) row is
  `aria-selected="true"`; **Enter executes the active row** then closes
  (`CommandPalette.jsx:342-346`).
- **Esc** closes (`CommandPalette.jsx:335`). Panel testid `forge-cmd-palette`,
  overlay testid `forge-cmd-palette-overlay`.

### Why the spec opens the palette programmatically

The spec opens via `window.__forgeOpenCommandPalette(true)` rather than
`page.keyboard.press('Meta+K')`. The `Cmd+K` chord can be intercepted by the
macOS application menu in a headed Electron window; the programmatic opener is the
**identical React state path** the keydown handler triggers (`setOpen(true)`), so
the open is still genuine UI operation. Everything after the open — typing into
the real input, the real fuzzy filter, the real Enter selection — is the unaltered
human gesture. (A robust testid hook for keyboard-driven open is listed below if
we want to exercise the chord itself later.)

## Known gaps

1. **Most palette geometry tools open a param dialog, not a one-selection body.**
   The palette's `tool` entries click the matching toolbar button
   (`CommandPalette.jsx:214-225`); in the shell, a tool with a schema only
   `setActiveTool(id)` + opens the **param dock**
   (`ForgeShellV4.jsx:2985-2994`). So selecting "Box"/"Extrude" from the palette
   *arms* the tool — it does not seed a solid in that single Enter. A genuine
   one-selection body comes from **menu/workbench actions** that dispatch
   `forge:menu-action` and seed directly (e.g. `tools.flange`, `tools.demoProject`
   → `ForgeShellV4.jsx:2470,2885`). The spec's outcome assertion therefore accepts
   **feature-tree growth OR body count** as the honest "built something" signal,
   and the model is steered (via the goal text) toward nameable whole-part actions.
   *Forward work:* a thin "palette quick-primitive" menu action (`insert.box`,
   `insert.cylinder`, …) that seeds a body in one dispatch would make pure-palette
   builds deterministic. That is an additive shell change, out of scope for this
   spec.

2. **The body-surfacing seam is Archie-only.** The handle→viewport-body bridge
   lives inside `runArchie`'s `onTrace` (`ForgeShellV4.jsx:644-702`), which only
   fires for tool_calls dispatched through `runForgePrompt`. Palette tool/menu
   actions surface bodies through their own `setBodies`/feature-tree paths, so a
   palette-built solid appears via the regenerate path, not the Archie path — fine
   for capture, but it means the two on-ramps don't share the surfacing code.

3. **Multimodal grounding depends on the served model.** Each turn sends the
   canvas as an OpenAI-compat `image_url`. If the served `hermes_forge` adapter
   ignores images, the model still receives the text state line (body/feature
   counts + command log) and degrades gracefully — no fake. True visual grounding
   needs the VLM path, not the text LoRA.

4. **Not deterministic.** Model-in-the-loop: exact commands vary per run; the spec
   asserts on outcomes, not a fixed command sequence.

## Minimal data-testid additions for robust Stage-B verification

The current testids are **sufficient** for the spec as written: input
(`forge-cmd-palette-input`), results count (`data-result-count`), and per-row
`data-cmd-id`/`data-cmd-kind`/`aria-selected` give stable, text-free selection of
the top match. **No testid is strictly required to run Stage B today.**

If we want Stage B to be *robustly verifiable end-to-end* (assert the exact entry
that ran, and exercise the keyboard chord), the following **minimal, additive**
changes to `frontend/src/forge-v4/CommandPalette.jsx` would help — none change
behaviour:

- **Per-row testid for the active match.** Add `data-testid="forge-cmd-palette-item"`
  to the `<li role="option">` (alongside the existing `data-cmd-id`), so the
  selected entry can be located without relying on `role="option"` ordering.
  *(Today the spec already reads `data-cmd-id`/`data-cmd-kind` off the first
  `role="option"`, which works — this is a convenience, not a blocker.)*
- **An "executed" signal.** Have `executeEntry` (or its callers) set
  `window.__forgeLastPaletteCommand = { id, kind, ts }` on execute, so the spec
  can assert the *exact* command id the palette ran (not just "a row was selected").
  This makes the genuine-operation proof airtight and removes the small
  type→settle→read race the spec currently absorbs with a fixed `waitForTimeout`.
- **(Optional) keyboard-open hook.** Tag the document/body that owns the Cmd+K
  listener with `data-forge-cmd-k="1"` so a future variant can verify the chord
  path itself rather than the programmatic opener.

All three are additive (new attributes / one window assignment), do not alter the
palette's rendered output or dispatch behaviour, and would be the only Stage-B
touch to `CommandPalette.jsx`. They are **documented, not applied** — per the
task's additive-only / do-not-edit-CommandPalette constraint.
