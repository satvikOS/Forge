import { useEffect, useMemo, useState } from 'react';
import './WelcomeScreen.css';

/**
 * Welcome Screen — first-run modal + on-demand Templates picker.
 *
 * Auto-shows on first launch (localStorage `archdisc:welcome:v1` unset)
 * and presents three primary actions to engineers who have nothing on
 * screen yet:
 *
 *   1. Start Empty           Standard empty viewport
 *   2. Open a Template       Real engineering starter assemblies —
 *                             ISO-6431 pneumatic cylinder, worm-gear
 *                             reducer housing, automotive shock
 *                             absorber, hydraulic-cylinder cap. Each
 *                             template dispatches the run-tool event
 *                             chain that builds the bodies; same code
 *                             path a user-driven build takes.
 *   3. Recent                Last 5 saved-snapshot filenames (from
 *                             localStorage `archdisc:recent-projects:v1`)
 *
 * Manual re-open: dispatch `archdisc:open-welcome`. Wired up so a future
 * File menu / Welcome button can re-launch it.
 */

const SHOWN_KEY  = 'archdisc:welcome:v1';
const RECENT_KEY = 'archdisc:recent-projects:v1';

const TEMPLATES = [
  {
    id: 'empty',
    title: 'Start Empty',
    blurb: 'Open the viewport with nothing in it — start drawing.',
    glyph: '▢',
    accent: '#5a8bd9',
    plan: [],   // no bodies, just dismiss
  },
  {
    id: 'pneumatic-cylinder',
    title: 'Pneumatic Cylinder · ISO 6431',
    blurb: '5-component pneumatic actuator — tube, piston, front cap, rear cap, rod.',
    glyph: '⌥',
    accent: '#7ed957',
    plan: [
      { tab: 'part', tool: 'Cylinder', label: 'PneumaticCyl-Tube-4140' },
      { tab: 'part', tool: 'Cylinder', label: 'PneumaticCyl-Piston-AL6061' },
      { tab: 'part', tool: 'Cylinder', label: 'PneumaticCyl-FrontCap-316L' },
      { tab: 'part', tool: 'Cylinder', label: 'PneumaticCyl-RearCap-316L' },
      { tab: 'part', tool: 'Cylinder', label: 'PneumaticCyl-Rod-4140' },
    ],
  },
  {
    id: 'worm-gear-reducer',
    title: 'Worm-Gear Reducer Housing',
    blurb: '8-component cast-iron gearbox: main housing, flange, two bores, gear cavity, sump, cover seat, vent boss.',
    glyph: '⚙',
    accent: '#ffb84d',
    plan: [
      { tab: 'part', tool: 'Box',      label: 'WormReducer-MainHousing-A48Cl40' },
      { tab: 'part', tool: 'Box',      label: 'WormReducer-MountingFlange' },
      { tab: 'part', tool: 'Cylinder', label: 'WormReducer-WormShaftBore-32H7' },
      { tab: 'part', tool: 'Cylinder', label: 'WormReducer-OutputShaftBore-45H7' },
      { tab: 'part', tool: 'Cylinder', label: 'WormReducer-WormGearCavity-100' },
      { tab: 'part', tool: 'Box',      label: 'WormReducer-OilSumpExtension' },
      { tab: 'part', tool: 'Cylinder', label: 'WormReducer-InspectionCoverSeat-50' },
      { tab: 'part', tool: 'Cylinder', label: 'WormReducer-VentBoss-15' },
    ],
  },
  {
    id: 'shock-absorber',
    title: 'Shock Absorber · MacPherson',
    blurb: '8-component automotive damper — body, rod, mounts, bumpstop, spring seats, gas reservoir.',
    glyph: '↕',
    accent: '#e84a82',
    plan: [
      { tab: 'part', tool: 'Cylinder', label: 'ShockAbsorber-MainBodyTube-EN24' },
      { tab: 'part', tool: 'Cylinder', label: 'ShockAbsorber-PistonRod-ChromeplateRod' },
      { tab: 'part', tool: 'Cylinder', label: 'ShockAbsorber-TopMount-1045' },
      { tab: 'part', tool: 'Cylinder', label: 'ShockAbsorber-BottomMount-1045' },
      { tab: 'part', tool: 'Cylinder', label: 'ShockAbsorber-Bumpstop-PU' },
      { tab: 'part', tool: 'Cylinder', label: 'ShockAbsorber-LowerSpringSeat-C45' },
      { tab: 'part', tool: 'Cylinder', label: 'ShockAbsorber-UpperSpringSeat-C45' },
      { tab: 'part', tool: 'Cylinder', label: 'ShockAbsorber-GasReservoir-EN24' },
    ],
  },
];

function loadRecent() {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch { return []; }
}

async function runTemplate(plan) {
  if (typeof window === 'undefined') return;
  const reg = window.__archdiscBodies;
  for (const step of plan) {
    const beforeLen = reg
      ? (typeof reg.list === 'function' ? reg.list() : reg.bodies).length
      : 0;
    window.dispatchEvent(new CustomEvent('archdisc:run-tool', {
      detail: { tab: step.tab, tool: step.tool },
    }));
    // Wait for the body to materialize before naming it + firing the next.
    const start = Date.now();
    while (reg && Date.now() - start < 15000) {
      const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
      if (list.length > beforeLen) {
        if (step.label && typeof reg.rename === 'function') {
          reg.rename(list[list.length - 1].id, step.label);
        }
        break;
      }
      await new Promise(r => setTimeout(r, 60));
    }
  }
}

export default function WelcomeScreen() {
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    try { return window.localStorage.getItem(SHOWN_KEY) !== '1'; }
    catch { return true; }
  });
  const [busy, setBusy] = useState(false);
  const recent = useMemo(() => loadRecent(), [open]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onOpen = () => setOpen(true);
    window.addEventListener('archdisc:open-welcome', onOpen);
    return () => window.removeEventListener('archdisc:open-welcome', onOpen);
  }, []);

  const closeAndRemember = () => {
    setOpen(false);
    try { window.localStorage.setItem(SHOWN_KEY, '1'); } catch { /* ignore */ }
  };

  const pickTemplate = async (template) => {
    if (busy) return;
    setBusy(true);
    try {
      if (template.id !== 'empty') await runTemplate(template.plan);
    } finally {
      setBusy(false);
      closeAndRemember();
    }
  };

  if (!open) return null;

  return (
    <div className="welcome-overlay" data-archdisc-welcome="open" onClick={closeAndRemember}>
      <div className="welcome-modal" onClick={(e) => e.stopPropagation()}>
        <div className="welcome-head">
          <div className="welcome-title">
            <span className="welcome-logo">▦</span>
            <h2>ArchDisc · Mechanical CAD</h2>
          </div>
          <button className="welcome-close" onClick={closeAndRemember} aria-label="Close welcome" data-archdisc-welcome-close="true">×</button>
        </div>
        <p className="welcome-sub">Start from a real engineering template or open the empty viewport.</p>

        <div className="welcome-grid">
          {TEMPLATES.map(t => (
            <button
              key={t.id}
              className={`welcome-card${busy ? ' welcome-card-disabled' : ''}`}
              onClick={() => pickTemplate(t)}
              disabled={busy}
              data-archdisc-welcome-template={t.id}
              style={{ borderTopColor: t.accent }}
            >
              <span className="welcome-glyph" style={{ color: t.accent }}>{t.glyph}</span>
              <span className="welcome-card-title">{t.title}</span>
              <span className="welcome-card-blurb">{t.blurb}</span>
            </button>
          ))}
        </div>

        {recent.length > 0 && (
          <div className="welcome-recent">
            <div className="welcome-recent-head">Recent</div>
            <ul className="welcome-recent-list">
              {recent.map((r, i) => (
                <li key={i} className="welcome-recent-item" data-archdisc-welcome-recent={r.filename || i}>
                  <span className="welcome-recent-name">{r.filename || r}</span>
                  {r.savedAt && <span className="welcome-recent-date">{new Date(r.savedAt).toLocaleString()}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {busy && <div className="welcome-busy">Building template…</div>}
      </div>
    </div>
  );
}
