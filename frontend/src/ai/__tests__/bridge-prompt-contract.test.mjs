/**
 * Phase-1 A1 — bridge↔prompt contract test.
 *
 * Asserts that every tool id the TRAINED Archie system prompt
 * (`HERMES_FORGE_SYSTEM` in ForgeRunner.js) tells the model to emit is a
 * SUBSET of the verbs the ForgeToolBridge actually registers
 * (`FORGE_TOOLS[].name`). If the prompt ever names an id the bridge does
 * not register, dispatchToolCall() answers "unknown tool" at runtime — the
 * exact silent-drift failure Forge-192 fixed by hand. This test makes that
 * drift impossible to reintroduce without going red.
 *
 * Built-ins only (node:assert, node:fs, node:url, node:path) — no deps.
 *
 * Parsing strategy:
 *   - bridge verbs: imported live from ForgeToolBridge.js (FORGE_TOOLS is
 *     exported), so we read the real registry, not a copy.
 *   - prompt ids: HERMES_FORGE_SYSTEM is a NON-exported template-literal
 *     const, so we read ForgeRunner.js source and extract the template
 *     body, then pull every `<namespace>.<verb>` token. The prompt
 *     instructs the model with ids scattered through prose (e.g.
 *     `part.bolt-circle`, `gdt.datum`, `asset.make-flange`), not just in
 *     the "Tool ids" header block, so we scan the WHOLE template body.
 *
 * HONESTY: if either list cannot be parsed (empty), the test FAILS LOUDLY
 * with the reason rather than vacuously passing.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { FORGE_TOOLS } from '../ForgeToolBridge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = resolve(__dirname, '../ForgeRunner.js');
const BRIDGE_PATH = resolve(__dirname, '../ForgeToolBridge.js');

// --- 1. bridge verb registry (the contract's ALLOWED set) ---------------
const bridgeVerbs = new Set(
  FORGE_TOOLS
    .map((t) => t && t.name)
    .filter((n) => typeof n === 'string' && n.length > 0),
);
assert.ok(
  bridgeVerbs.size >= 25,
  `FAIL-LOUD: parsed only ${bridgeVerbs.size} bridge verbs from FORGE_TOOLS — ` +
  `the registry import is broken; refusing to fake a pass.`,
);

// --- 2. trained prompt id list (the contract's REQUESTED set) -----------
// HERMES_FORGE_SYSTEM is `const HERMES_FORGE_SYSTEM =\n`...`;` — a single
// template literal. Extract its body from source (it is not exported).
const runnerSrc = readFileSync(RUNNER_PATH, 'utf8');
const tplMatch = runnerSrc.match(
  /const\s+HERMES_FORGE_SYSTEM\s*=\s*\n?`([\s\S]*?)`;/,
);
assert.ok(
  tplMatch,
  `FAIL-LOUD: could not locate the HERMES_FORGE_SYSTEM template literal in ` +
  `${RUNNER_PATH}. The prompt source moved or changed shape — fix this test ` +
  `to point at the real trained prompt rather than letting it pass blind.`,
);
const promptBody = tplMatch[1];

// Pull every dotted `<ns>.<verb>` token from the whole prompt body.
const rawTokens = [
  ...promptBody.matchAll(/\b([a-z][a-z0-9]*\.[a-z][a-z0-9-]*)\b/gi),
].map((m) => m[1]);

// Known NON-id prose artifacts that legitimately appear as dotted tokens
// but are NOT tool ids the model is told to emit. Each is justified:
//   tool.id    — the `"name":"<tool.id>"` placeholder in the output-shape
//                example (line "<tool_call>{\"name\":\"<tool.id>\",...").
//   asset.make — the `asset.make-*` GLOB STEM from the prose sentence
//                "A whole standard part = ONE asset.make-* call"; the real
//                ids are the fully-spelled asset.make-flange etc.
// If a future prompt edit drops these phrasings, the set simply has no
// effect — it never masks a real id (a real id would not be on this list).
const PROSE_ARTIFACTS = new Set(['tool.id', 'asset.make']);

const promptIds = [...new Set(rawTokens)]
  .filter((id) => !PROSE_ARTIFACTS.has(id))
  .sort();

assert.ok(
  promptIds.length >= 25,
  `FAIL-LOUD: extracted only ${promptIds.length} tool ids from ` +
  `HERMES_FORGE_SYSTEM — the prompt parse is broken; refusing to fake a pass.`,
);

// --- 3. the contract: promptIds ⊆ bridgeVerbs ---------------------------
const drift = promptIds.filter((id) => !bridgeVerbs.has(id));

assert.deepEqual(
  drift,
  [],
  `bridge↔prompt DRIFT: the trained prompt names ${drift.length} tool id(s) ` +
  `that ForgeToolBridge does NOT register — every one of these dispatches as ` +
  `"unknown tool id" at runtime:\n  ${drift.join('\n  ')}\n` +
  `Fix: add the verb to FORGE_TOOLS in ${BRIDGE_PATH}, or correct the id in ` +
  `HERMES_FORGE_SYSTEM in ${RUNNER_PATH}. (Reverse drift — bridge verbs not ` +
  `mentioned in the prompt — is allowed: the prompt ships a curated subset.)`,
);

console.log(
  `[bridge-prompt-contract] OK — ${promptIds.length} prompt ids ⊆ ` +
  `${bridgeVerbs.size} bridge verbs (no "unknown tool id" drift).`,
);
