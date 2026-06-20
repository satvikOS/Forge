// demo-ge9x-full-process.spec.js — DEPRECATED SHIM → demo-leap1a-full-process
// ============================================================================
// The flagship "full process" demo was RE-TARGETED from the GE9X to the CFM
// LEAP-1A (the ArchDisc demo engine). The canonical spec now lives at
//   e2e/forge/demo-leap1a-full-process.spec.js
// which renders the LEAP geometry (1.98 m fan, 18 woven-CFRP blades, 3-stage
// booster, 10-stage HPC, 2-stage HPT, 7-stage LPT, chevron nozzle) + the
// rendered-WIND particle module (windViz) + the equation-grounded CFD/FEA/rotor
// CAE post-processor (caeViz) into ONE continuous full-Electron-window clip
//   e2e/forge/shots/flagship/ge9x/leap1a-full-process-ui.mp4
// plus the marketing-exterior hero leap1a-marketing-exterior.png.
//
// This file is kept ONLY so the old GE9X path still resolves; it delegates to
// the LEAP-1A spec verbatim. Run the LEAP-1A spec directly:
//   FORGE_SKIP_BUILD=1 npx playwright test \
//     e2e/forge/demo-leap1a-full-process.spec.js --config=playwright.config.js --headed
// ============================================================================
require('./demo-leap1a-full-process.spec.js');
