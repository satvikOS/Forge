// Fix 1 verification — the "Start a new design" viewport welcome dialog is
// removed so nothing gates / floats over the viewport on load or when Archie
// is invoked. Headless source assertions (no DOM, no Electron).
// Run: node viewportWelcomeRemoved.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(here, rel), 'utf8');

// ── App.jsx no longer imports or mounts the welcome host ───────────────────
const app = read('../../App.jsx');
assert.ok(!/ViewportWelcomeHost/.test(app),
  'App.jsx must not import or mount ViewportWelcomeHost');
assert.ok(!/ViewportWelcome\.jsx/.test(app),
  'App.jsx must not import from ViewportWelcome.jsx');

// ── The component itself renders nothing and carries no welcome content ─────
const welcome = read('../ViewportWelcome.jsx');
assert.ok(!/Start a new design/.test(welcome),
  'the "Start a new design" dialog content is gone');
assert.ok(!/createPortal/.test(welcome),
  'the welcome no longer portals a modal over the viewport');
assert.ok(/return null/.test(welcome),
  'ViewportWelcomeHost is a no-op (returns null)');

console.log('[welcome] start-designing dialog removed — all tests passed');
