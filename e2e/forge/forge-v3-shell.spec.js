// forge-v3-shell.spec.js — Forge-48 visual regression of the v3 shell.
//
// Loads an inline HTML page that mounts the v3 layout via React SSR
// markup against the live tokens.css so we can screenshot all three
// themes + the empty-state. v3 supersedes the v2 spec (deleted in
// Forge-48).

const { test } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { launchForge, shot, loadInlinePage } = require('./_helpers');

const TOKENS_CSS_PATH = path.resolve(__dirname, '..', '..', 'frontend',
                                     'src', 'forge-app', 'v3', 'tokens.css');

let app;
let page;
let tokensCss;

test.beforeAll(async () => {
  app = await launchForge();
  page = await app.firstWindow();
  tokensCss = fs.readFileSync(TOKENS_CSS_PATH, 'utf8');
});

test.afterAll(async () => {
  if (app) await app.close();
});

function inlineShell(theme, { withSteps = false, withThread = false, archieCollapsed = false } = {}) {
  // Render a static analogue of the v3 shell so we have a deterministic
  // SSR-ish snapshot without booting the full React build. The classNames
  // match ForgeShellV3 so styling is verified end-to-end.
  const verbs = [
    { id: 'create.sketch',  icon: '✎',  active: false },
    { id: 'create.box',     icon: '▣',  active: true  },
    { id: 'create.cyl',     icon: '◯',  active: false },
    { id: 'import',         icon: '⤓',  active: false },
    { id: 'measure',        icon: '⟶',  active: false },
  ];
  const verbItems = verbs.map((v) => `
    <button class="forge-v3-verb" data-verb="${v.id}" data-active="${v.active}" title="${v.id}">
      <span aria-hidden="true">${v.icon}</span>
    </button>
  `).join('');

  const steps = withSteps ? `
    <button class="forge-v3-timeline-step" data-active="false">
      <span class="forge-v3-timeline-step-label">box 10mm</span>
      <span class="forge-v3-timeline-step-meta">create</span>
    </button>
    <span class="forge-v3-timeline-head" aria-hidden="true"></span>
    <button class="forge-v3-timeline-step" data-active="true">
      <span class="forge-v3-timeline-step-label">fillet 2mm</span>
      <span class="forge-v3-timeline-step-meta">modify</span>
    </button>
    <button class="forge-v3-timeline-step" data-active="false">
      <span class="forge-v3-timeline-step-label">shell 1mm</span>
      <span class="forge-v3-timeline-step-meta">modify</span>
    </button>
  ` : `
    <span class="forge-v3-timeline-empty">
      Timeline appears here as you build. No steps yet.
    </span>
  `;

  const thread = withThread ? `
    <div class="forge-v3-archie-msg" data-role="user">a 10 mm cube, fillet 2 mm</div>
    <div class="forge-v3-archie-msg" data-role="archie">Built. Box 10 × 10 × 10 mm, then filleted 12 edges at 2 mm.</div>
    <div class="forge-v3-archie-msg" data-role="tool">makeBox(10,10,10) → handle 7\nfilletEdges(7, [...], 2) → handle 8</div>
  ` : `<div class="forge-v3-archie-empty">Thread is empty. Type at the bottom; Archie answers here.</div>`;

  return `<!DOCTYPE html>
<html data-forge-theme="${theme}">
<head>
<meta charset="utf-8">
<title>Forge v3 — ${theme}</title>
<style>${tokensCss}</style>
</head>
<body style="margin:0">
<div class="forge-v3-app">
  <header class="forge-v3-titlebar">
    <span class="forge-v3-titlebar-brand">
      <span class="forge-v3-titlebar-brand-mark">⎈</span>Forge
    </span>
    <span class="forge-v3-titlebar-spacer"></span>
    <span class="forge-v3-titlebar-doc-name">bracket-v3.forge</span>
    <span class="forge-v3-titlebar-spacer"></span>
    <span style="font-size:11px;opacity:0.6">0.3.0</span>
  </header>
  <nav class="forge-v3-verbs" aria-label="Forge verbs">${verbItems}</nav>
  <main class="forge-v3-viewport">
    <div class="forge-v3-viewport-empty">
      <span class="forge-v3-viewport-empty-mark">⎈</span>
      <div style="font-size:14px;color:var(--forge-v3-ink)">Forge — a blank canvas.</div>
      <div class="forge-v3-viewport-empty-hint">
        Press <kbd>⌘K</kbd> and tell Archie what you want.
      </div>
    </div>
  </main>
  <footer class="forge-v3-timeline">${steps}</footer>
  <aside class="forge-v3-archie" data-collapsed="${archieCollapsed}">
    <header class="forge-v3-archie-header">
      <span class="forge-v3-archie-header-mark">◐</span>
      ${archieCollapsed ? '' : '<span>Archie</span>'}
    </header>
    ${archieCollapsed ? '' : `<div class="forge-v3-archie-thread">${thread}</div>`}
  </aside>
  <footer class="forge-v3-cmdbar">
    <span class="forge-v3-cmdbar-prompt">⌘</span>
    <input class="forge-v3-cmdbar-input" placeholder="Tell Archie what to build — e.g. “a 10mm cube, fillet 2mm”" />
    <span class="forge-v3-cmdbar-hint">
      <kbd>⌘K</kbd> focus &nbsp; <kbd>↵</kbd> send
    </span>
  </footer>
</div>
</body></html>`;
}

test('v3 shell — dark, empty', async () => {
  await page.setContent(inlineShell('dark'));
  await page.waitForLoadState('domcontentloaded');
  await shot(page, '40-v3-shell-dark-empty');
});

test('v3 shell — light, populated', async () => {
  await page.setContent(inlineShell('light', { withSteps: true, withThread: true }));
  await page.waitForLoadState('domcontentloaded');
  await shot(page, '41-v3-shell-light-populated');
});

test('v3 shell — contrast theme', async () => {
  await page.setContent(inlineShell('contrast', { withSteps: true, withThread: true }));
  await page.waitForLoadState('domcontentloaded');
  await shot(page, '42-v3-shell-contrast');
});

test('v3 shell — Archie collapsed', async () => {
  await page.setContent(inlineShell('dark', { withSteps: true, archieCollapsed: true }));
  await page.waitForLoadState('domcontentloaded');
  await shot(page, '43-v3-shell-archie-collapsed');
});
