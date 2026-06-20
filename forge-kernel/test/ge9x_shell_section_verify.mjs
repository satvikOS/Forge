#!/usr/bin/env node
/**
 * ge9x_shell_section_verify.mjs — SUPERSEDED SHIM.
 *
 * The flagship turbofan in frontend/src/forge-v4/ge9xBuilder.js was RE-TARGETED
 * from the GE9X to the CFM LEAP-1A (the demo engine): ~1.98 m fan, ~3.3 m core,
 * 18 woven-CFRP fan blades, 10-stage HPC, 7-stage LPT, CHEVRON sawtooth nozzle.
 * The GE9X-specific assertions in the old version of this file (3.40 m fan,
 * ~6.7 m length, ~20k components, body name `exhaust_nozzle`) no longer describe
 * the geometry, so this file now simply delegates to the LEAP-1A verifier:
 *
 *   forge-kernel/test/leap1a_shell_section_verify.mjs
 *
 * The `buildGE9X` export is kept as a back-compat alias of `buildLEAP1A`, so the
 * builder still imports cleanly under either name.
 */
import { fileURLToPath } from 'url';
import path from 'path';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const LEAP = path.resolve(__filename, '..', 'leap1a_shell_section_verify.mjs');

console.log('[ge9x_shell_section_verify] flagship re-targeted to CFM LEAP-1A — delegating to leap1a_shell_section_verify.mjs\n');
const r = spawnSync(process.execPath, [LEAP], { stdio: 'inherit' });
process.exit(r.status ?? 1);
