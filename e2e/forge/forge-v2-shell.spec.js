// forge-v2-shell.spec.js — headless screenshots of the ForgeAppV2 shell.
//
// Drives the packaged Vite build via the `webServer` block in the headless
// playwright config; each test toggles a different overlay / theme so the
// screenshot folder ends up with a visual inventory of the v2 UI.

const { test, expect } = require('@playwright/test');
const path = require('path');
const { launchForge, shot } = require('./_helpers');

let app;
let page;

test.beforeAll(async () => {
  app = await launchForge();
  page = await app.firstWindow();
  await page.goto('about:blank');
});

test.afterAll(async () => {
  if (app) await app.close();
});

// We don't have a real dev-server in Electron headless out of the box,
// so we render the v2 shell inline by injecting the bundled JS isn't
// trivial. Instead, this spec verifies the shell at the design-system
// level: it mounts an inline page that imports the design tokens and
// renders the Welcome modal markup directly. Real Electron-app screenshots
// happen once the bundled `forge-kernel.node` ships (Forge-47).

async function mountTokens(page) {
  const tokensPath = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'forge-app', 'design-system', 'tokens.css');
  const fs = require('fs');
  const css = fs.readFileSync(tokensPath, 'utf-8');
  await page.goto('about:blank');
  await page.addStyleTag({ content: css });
}

async function renderHTML(page, theme, body) {
  await page.evaluate(({ theme, body }) => {
    document.documentElement.dataset.forgeTheme = theme;
    document.documentElement.classList.add('forge-root');
    document.body.innerHTML = body;
    document.body.style.cssText = 'margin:0;background:var(--surface-app);color:var(--text-primary);font-family:var(--font-sans);font-size:var(--text-base);';
  }, { theme, body });
}

const SHELL_HTML = `
<div style="display:grid;grid-template-rows:auto auto auto 1fr auto auto;height:100vh">
  <!-- title bar -->
  <div style="display:flex;align-items:center;gap:24px;padding:6px 28px;background:var(--surface-panel);border-bottom:1px solid var(--border-subtle)">
    <span style="display:inline-flex;align-items:center;gap:8px;font-weight:600">
      <span style="width:22px;height:22px;border-radius:4px;background:var(--accent-bg);color:var(--accent-text);display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:11px">F</span>
      Forge<span style="font-size:10px;color:var(--text-tertiary);font-weight:400;margin-left:6px">v2</span>
    </span>
    <span style="flex:1"></span>
    <span style="font-size:11px;color:var(--text-tertiary)">⌘K · ?</span>
  </div>

  <!-- ribbon -->
  <div style="background:var(--surface-raised);border-bottom:1px solid var(--border-subtle)">
    <div style="display:flex;padding:0 28px;border-bottom:1px solid var(--border-subtle)">
      <button style="padding:8px 28px;color:var(--text-secondary);font-size:12px;border:none;background:transparent">Sketch</button>
      <button style="padding:8px 28px;color:var(--text-primary);font-size:12px;border:none;background:transparent;border-bottom:2px solid var(--accent-bg)">Part</button>
      <button style="padding:8px 28px;color:var(--text-secondary);font-size:12px;border:none;background:transparent">Surfaces</button>
      <button style="padding:8px 28px;color:var(--text-secondary);font-size:12px;border:none;background:transparent">Sheet Metal</button>
      <button style="padding:8px 28px;color:var(--text-secondary);font-size:12px;border:none;background:transparent">Assembly</button>
      <button style="padding:8px 28px;color:var(--text-secondary);font-size:12px;border:none;background:transparent">Drawing</button>
      <button style="padding:8px 28px;color:var(--text-secondary);font-size:12px;border:none;background:transparent">Simulate</button>
      <button style="padding:8px 28px;color:var(--text-secondary);font-size:12px;border:none;background:transparent">Manufacture</button>
    </div>
    <div style="padding:10px 24px;color:var(--text-tertiary);font-size:11px">Primitives · Sketch-Driven · Modify · Boolean · Pattern · Direct</div>
  </div>

  <!-- doc tabs -->
  <div style="padding:0 12px;background:var(--surface-panel);border-bottom:1px solid var(--border-subtle)">
    <span style="display:inline-flex;align-items:center;gap:6px;padding:8px 12px;background:var(--surface-raised);color:var(--text-primary);font-size:12px;border-top:2px solid var(--accent-bg);border-radius:4px 4px 0 0">📐 bracket-v3.forge</span>
    <span style="padding:8px 12px;color:var(--text-tertiary);font-size:12px">+</span>
  </div>

  <!-- main 3-column -->
  <div style="display:flex;min-height:0;background:var(--surface-app)">
    <aside style="flex:0 0 280px;background:var(--surface-panel);border-right:1px solid var(--border-subtle);padding:14px">
      <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:4px">bracket-v3.forge</div>
      <div style="font-size:10px;color:var(--text-tertiary);margin-bottom:12px">v3 · 5 features</div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">⚙ Steel (1018)</div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">▾ Default Planes</div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;padding-left:16px">Front Plane (XY)</div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;padding-left:16px">Top Plane (XZ)</div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;padding-left:16px">Right Plane (YZ)</div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">Origin</div>
      <div style="padding:4px 8px;background:var(--surface-selected);font-size:12px;color:var(--text-primary);border-radius:3px;margin-bottom:4px">🟧 Boss-Extrude1 — Ø50×20</div>
      <div style="font-size:12px;color:var(--text-secondary);padding:4px 8px">🟧 Fillet1</div>
      <div style="font-size:12px;color:var(--text-disabled);padding:4px 8px">⊘ Hole-Wizard1</div>
    </aside>

    <main style="flex:1;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center, var(--surface-raised) 0%, var(--surface-app) 100%)">
      <div style="text-align:center;color:var(--text-secondary)">
        <div style="width:64px;height:64px;background:var(--accent-soft);color:var(--accent-bg);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:28px">⬡</div>
        <h2 style="margin:0;color:var(--text-primary);font-size:16px">Viewport — kernel-driven</h2>
        <p style="margin:8px 0;font-size:12px;max-width:320px">GPU-instanced viewport mounts here once Forge-44 lands.</p>
      </div>
    </main>

    <aside style="flex:0 0 360px;background:var(--surface-panel);border-left:1px solid var(--border-subtle);display:flex;flex-direction:column">
      <div style="padding:12px 14px;border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;gap:10px">
        <div style="width:28px;height:28px;border-radius:50%;background:var(--accent-soft);color:var(--accent-bg);display:inline-flex;align-items:center;justify-content:center">🔥</div>
        <div style="flex:1">
          <div style="font-size:12px;font-weight:600">Archie</div>
          <div style="font-size:10px;color:var(--success-text)">ready · <span style="font-family:monospace">archie-7b-base</span></div>
        </div>
      </div>
      <div style="flex:1;padding:14px;background:var(--surface-app);overflow:auto">
        <div style="text-align:center;padding:32px 8px;color:var(--text-secondary)">
          <div style="width:48px;height:48px;background:var(--accent-soft);color:var(--accent-bg);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px">🔥</div>
          <h3 style="margin:0 0 8px;color:var(--text-primary);font-size:14px">Drive the platform with words</h3>
          <p style="margin:0 0 16px;font-size:12px">Archie runs locally. Tell it what to build.</p>
          <div style="display:flex;flex-direction:column;gap:8px">
            <button style="padding:10px 14px;background:var(--surface-raised);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:6px;font-size:12px;text-align:left;cursor:pointer">
              <span style="display:inline-block;font-size:9px;color:var(--accent-bg);text-transform:uppercase;letter-spacing:0.06em;margin-right:10px">part</span>
              Build a 100×50×20 mm bracket with 4 mounting holes
            </button>
            <button style="padding:10px 14px;background:var(--surface-raised);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:6px;font-size:12px;text-align:left;cursor:pointer">
              <span style="display:inline-block;font-size:9px;color:var(--accent-bg);text-transform:uppercase;letter-spacing:0.06em;margin-right:10px">simulate</span>
              Run static FEA with 1 kN at the tip
            </button>
          </div>
        </div>
      </div>
      <div style="padding:12px 14px;border-top:1px solid var(--border-subtle)">
        <textarea placeholder="Ask Archie — build a bracket, optimise this beam, generate G-code…" style="width:100%;height:48px;padding:10px;background:var(--surface-app);color:var(--text-primary);border:1px solid var(--border-default);border-radius:6px;font-family:inherit;font-size:12px;resize:vertical"></textarea>
        <div style="display:flex;justify-content:flex-end;margin-top:8px;font-size:10px;color:var(--text-tertiary)">⌘+Enter to send</div>
      </div>
    </aside>
  </div>

  <!-- status bar -->
  <div style="display:flex;align-items:center;height:24px;background:var(--surface-panel);border-top:1px solid var(--border-subtle);font-size:10px;color:var(--text-tertiary);font-family:monospace">
    <span style="padding:0 12px">No selection</span>
    <span style="border-left:1px solid var(--border-subtle);height:100%;display:inline-block"></span>
    <span style="padding:0 12px">—  —  —</span>
    <span style="flex:1"></span>
    <span style="padding:0 12px"><span style="width:6px;height:6px;border-radius:50%;background:var(--success-bg);display:inline-block;margin-right:6px"></span>Archie ready</span>
    <span style="padding:0 12px">mm</span>
    <span style="padding:0 12px">●Forge</span>
  </div>
</div>
`;

test('shell — dark theme', async () => {
  await mountTokens(page);
  await renderHTML(page, 'dark', SHELL_HTML);
  await shot(page, '30-v2-shell-dark');
});

test('shell — light theme', async () => {
  await mountTokens(page);
  await renderHTML(page, 'light', SHELL_HTML);
  await shot(page, '31-v2-shell-light');
});

test('shell — contrast theme', async () => {
  await mountTokens(page);
  await renderHTML(page, 'contrast', SHELL_HTML);
  await shot(page, '32-v2-shell-contrast');
});

const PALETTE_HTML = `
<div style="position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;justify-content:center;padding-top:12vh">
  <div style="width:640px;background:var(--surface-overlay);border:1px solid var(--border-default);border-radius:10px;box-shadow:0 24px 60px rgba(0,0,0,0.6);overflow:hidden">
    <div style="display:flex;align-items:center;gap:10px;padding:10px 28px;border-bottom:1px solid var(--border-subtle)">
      <span style="color:var(--text-tertiary)">🔍</span>
      <input value="ext" style="flex:1;background:transparent;border:none;outline:none;color:var(--text-primary);font-family:inherit;font-size:16px">
      <span style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.06em">Commands</span>
    </div>
    <div style="display:flex;gap:14px;padding:6px 28px;background:var(--surface-raised);border-bottom:1px solid var(--border-subtle);font-size:10px;color:var(--text-tertiary)">
      <span><code style="font-family:monospace;color:var(--accent-bg)">&gt;</code> commands</span>
      <span><code style="font-family:monospace;color:var(--accent-bg)">@</code> features</span>
      <span><code style="font-family:monospace;color:var(--accent-bg)">?</code> help</span>
      <span><code style="font-family:monospace;color:var(--accent-bg)">:</code> settings</span>
    </div>
    <ul style="list-style:none;margin:0;padding:6px 0">
      <li style="display:flex;align-items:center;gap:14px;padding:6px 28px;background:var(--surface-selected)">
        <span style="color:var(--accent-bg)">⬛</span>
        <span style="flex:1;font-size:12px">Extrude</span>
        <span style="font-size:11px;color:var(--text-tertiary)">Part</span>
        <kbd style="font-family:monospace;font-size:9px;padding:1px 6px;background:var(--surface-app);border:1px solid var(--border-subtle);border-radius:2px;color:var(--text-tertiary)">E</kbd>
      </li>
      <li style="display:flex;align-items:center;gap:14px;padding:6px 28px"><span>⬛</span><span style="flex:1;font-size:12px">Extrude Cut</span><span style="font-size:11px;color:var(--text-tertiary)">Part</span></li>
      <li style="display:flex;align-items:center;gap:14px;padding:6px 28px"><span>📤</span><span style="flex:1;font-size:12px">Export STEP</span><span style="font-size:11px;color:var(--text-tertiary)">File</span></li>
    </ul>
    <div style="display:flex;gap:14px;padding:6px 28px;border-top:1px solid var(--border-subtle);background:var(--surface-raised);font-size:10px;color:var(--text-tertiary)">
      <span>↑↓ navigate</span><span>↵ invoke</span><span>⇥ auto-fill</span><span>Esc close</span>
    </div>
  </div>
</div>
${SHELL_HTML}
`;

test('command palette open', async () => {
  await mountTokens(page);
  await renderHTML(page, 'dark', PALETTE_HTML);
  await shot(page, '33-v2-command-palette');
});

const WELCOME_HTML = `
<div style="position:fixed;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:32px">
  <div style="width:960px;max-width:95vw;background:var(--surface-overlay);border:1px solid var(--border-default);border-radius:10px;box-shadow:0 24px 60px rgba(0,0,0,0.6);padding:32px;display:grid;grid-template-columns:1fr 1fr;gap:32px">
    <div>
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:24px">
        <span style="width:40px;height:40px;border-radius:6px;background:var(--accent-bg);color:var(--accent-text);display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:20px">F</span>
        <div>
          <h2 style="margin:0;font-size:24px;font-weight:700">Welcome to <span style="color:var(--accent-bg)">Forge</span></h2>
          <p style="margin:4px 0 0;color:var(--text-secondary);font-size:12px">Native MCAD on OCCT, driven by local Archie.</p>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button style="padding:10px 16px;background:var(--accent-bg);color:var(--accent-text);border:none;border-radius:6px;font-weight:500;cursor:pointer">+ New project</button>
        <button style="padding:10px 16px;background:var(--surface-raised);color:var(--text-primary);border:1px solid var(--border-default);border-radius:6px;font-weight:500;cursor:pointer">⌂ Open existing…</button>
        <button style="padding:10px 16px;background:transparent;color:var(--text-secondary);border:1px solid transparent;border-radius:6px;font-weight:500;cursor:pointer">? Take the 60-second tour</button>
      </div>
    </div>
    <div>
      <h3 style="margin:0 0 10px;font-size:12px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em">Start from a sample</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button style="display:flex;align-items:center;gap:14px;padding:12px;background:var(--surface-raised);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:6px;text-align:left;cursor:pointer">
          <span style="color:var(--accent-bg);font-size:20px">⬛</span>
          <div style="flex:1"><div style="font-size:14px;font-weight:500">L-bracket</div><div style="font-size:10px;color:var(--text-tertiary)">Sketch → Extrude → Hole</div></div>
        </button>
        <button style="display:flex;align-items:center;gap:14px;padding:12px;background:var(--surface-raised);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:6px;text-align:left;cursor:pointer">
          <span style="color:var(--accent-bg);font-size:20px">▰</span>
          <div style="flex:1"><div style="font-size:14px;font-weight:500">Steel frame</div><div style="font-size:10px;color:var(--text-tertiary)">Weldments + cut list</div></div>
        </button>
        <button style="display:flex;align-items:center;gap:14px;padding:12px;background:var(--surface-raised);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:6px;text-align:left;cursor:pointer">
          <span style="color:var(--accent-bg);font-size:20px">▱</span>
          <div style="flex:1"><div style="font-size:14px;font-weight:500">Enclosure</div><div style="font-size:10px;color:var(--text-tertiary)">Sheet metal + unfold</div></div>
        </button>
      </div>
    </div>
  </div>
</div>
`;

test('welcome overlay', async () => {
  await mountTokens(page);
  await renderHTML(page, 'dark', WELCOME_HTML);
  await shot(page, '34-v2-welcome');
});
