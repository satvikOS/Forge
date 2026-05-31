/**
 * Headless tests for Tooltip placement logic (Forge-28). The DOM-level
 * hover host (`<TooltipHost>`) is exercised by the Playwright suite.
 */

import assert from 'node:assert/strict';
import { placeTooltip, registerTooltipRenderer } from '../Tooltip.logic.js';

// ---- placement above by default ----------------------------------
{
  const targetRect = { left: 200, top: 300, right: 280, bottom: 320,
                       width: 80, height: 20 };
  const r = placeTooltip({ targetRect, w: 120, h: 30,
                            viewportW: 1024, viewportH: 768 });
  assert.equal(r.placement, 'above');
  assert.equal(r.x, 200 + 80 / 2 - 120 / 2, 'centred on target');
  assert.equal(r.y, 300 - 30 - 6, 'above with gap');
}

// ---- flips below when near top of viewport ------------------------
{
  const targetRect = { left: 200, top: 10, right: 280, bottom: 30,
                       width: 80, height: 20 };
  const r = placeTooltip({ targetRect, w: 120, h: 30,
                            viewportW: 1024, viewportH: 768 });
  assert.equal(r.placement, 'below', 'top-of-viewport flips below');
  assert.equal(r.y, 30 + 6);
}

// ---- horizontal clamp at right edge -------------------------------
{
  const targetRect = { left: 1000, top: 300, right: 1020, bottom: 320,
                       width: 20, height: 20 };
  const r = placeTooltip({ targetRect, w: 200, h: 30,
                            viewportW: 1024, viewportH: 768 });
  assert.ok(r.x + 200 <= 1024 - 4, 'right edge clamped');
}

// ---- horizontal clamp at left edge --------------------------------
{
  const targetRect = { left: 0, top: 300, right: 20, bottom: 320,
                       width: 20, height: 20 };
  const r = placeTooltip({ targetRect, w: 200, h: 30,
                            viewportW: 1024, viewportH: 768 });
  assert.ok(r.x >= 4, 'left edge clamped to margin');
}

// ---- registerTooltipRenderer --------------------------------------
{
  registerTooltipRenderer('extrude.depth', () => 'Depth in millimetres');
  // Just confirm registration doesn't throw — full lookup test runs in
  // the Tooltip.jsx integration path under Playwright.
}

console.log('[forge.tooltip] all tests passed');
