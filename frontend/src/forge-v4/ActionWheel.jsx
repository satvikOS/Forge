// Forge-138 — action wheel (radial menu) on right-click empty viewport
// and marking menu on body context.
//
// 8-spoke radial. Spoke index: 0=N, 1=NE, ... clockwise. Each spoke has
// { id, label, icon }. Dispatches a forge:menu-action event with the
// spoke's id when the user releases the mouse over a spoke.

import React from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';

const SPOKES = [
  { id: 'view.section',     label: 'Section',     icon: 'view.section'    },
  { id: 'tools.measure',    label: 'Measure',     icon: 'measure.distance'},
  { id: 'view.center',      label: 'Camera Home', icon: 'view.iso'        },
  { id: 'view.shaded',      label: 'Display',     icon: 'view.shaded'     },
  { id: 'view.theme',       label: 'Theme',       icon: 'misc.theme'      },
  { id: 'tools.library',    label: 'Materials',   icon: 'misc.search'     },
  { id: 'view.perfHud',     label: 'Snap',        icon: 'misc.kbd'        },
  { id: 'help.docs',        label: 'Help',        icon: 'menu.help'       },
];

const MARK_BODY = [
  { id: 'edit.copy',       label: 'Copy',       icon: 'edit.copy'    },
  { id: 'edit.delete',     label: 'Delete',     icon: 'edit.delete'  },
  { id: 'gizmo.translate', label: 'Move',       icon: 'gizmo.translate'},
  { id: 'tools.measure',   label: 'Measure',    icon: 'measure.distance' },
  { id: 'edit.filterBody', label: 'Properties', icon: 'select.body'  },
  { id: 'gizmo.rotate',    label: 'Rotate',     icon: 'gizmo.rotate' },
  { id: 'solid.fillet',    label: 'Fillet',     icon: 'solid.fillet' },
  { id: 'tools.measure',   label: 'Hide',       icon: 'misc.eye_off' },
];

const RADIUS = 86;
const SPOKE_R = 32;

function wheelLayout(spokes) {
  const N = spokes.length;
  return spokes.map((s, i) => {
    const angle = -Math.PI / 2 + (i / N) * Math.PI * 2;
    return { ...s, x: Math.cos(angle) * RADIUS, y: Math.sin(angle) * RADIUS };
  });
}

export function ActionWheelHost() {
  const [state, setState] = React.useState(null);    // { x, y, spokes, hover }

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onContext = (e) => {
      // Only fire when right-click is on the viewport — let other elements
      // keep their normal context menus.
      const target = e.target?.closest?.('[data-testid="forge-viewport"], [data-testid="forge-v4-canvas"]');
      if (!target) return;
      e.preventDefault();
      const hovered = window.__forgeHovered;
      const spokes = wheelLayout(hovered ? MARK_BODY : SPOKES);
      setState({ x: e.clientX, y: e.clientY, spokes, hover: null });
    };
    window.addEventListener('contextmenu', onContext);
    return () => window.removeEventListener('contextmenu', onContext);
  }, []);

  React.useEffect(() => {
    if (!state) return;
    const onMove = (e) => {
      const dx = e.clientX - state.x, dy = e.clientY - state.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 24) { setState((s) => s && { ...s, hover: null }); return; }
      let bestIdx = 0, bestD = Infinity;
      for (let i = 0; i < state.spokes.length; i++) {
        const s = state.spokes[i];
        const d = Math.hypot(s.x - dx, s.y - dy);
        if (d < bestD) { bestD = d; bestIdx = i; }
      }
      setState((s) => s && { ...s, hover: bestIdx });
    };
    const onUp = () => {
      if (state.hover != null) {
        const id = state.spokes[state.hover].id;
        window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id } }));
      }
      setState(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setState(null); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [state]);

  if (!state || typeof document === 'undefined') return null;
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 1700, pointerEvents: 'none' }}
         data-testid="forge-action-wheel">
      <div style={{ position: 'absolute',
                    left: state.x, top: state.y,
                    transform: 'translate(-50%, -50%)',
                    width: (RADIUS + SPOKE_R) * 2,
                    height: (RADIUS + SPOKE_R) * 2 }}>
        {/* centre dot */}
        <div style={{ position: 'absolute', left: '50%', top: '50%',
                      width: 6, height: 6, borderRadius: '50%',
                      background: 'var(--forge-accent)',
                      transform: 'translate(-50%,-50%)' }} />
        {state.spokes.map((s, i) => (
          <button key={i}
                  data-spoke={i}
                  data-spoke-id={s.id}
                  style={{
                    position: 'absolute',
                    left: `calc(50% + ${s.x}px)`,
                    top:  `calc(50% + ${s.y}px)`,
                    transform: 'translate(-50%, -50%)',
                    width: SPOKE_R * 2, height: SPOKE_R * 2,
                    borderRadius: '50%',
                    background: state.hover === i ? 'var(--forge-accent)' : 'var(--forge-canvas-2)',
                    color: state.hover === i ? 'var(--forge-canvas)' : 'var(--forge-ink)',
                    border: '1px solid var(--forge-rail-edge)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexDirection: 'column', gap: 4, padding: 0,
                    pointerEvents: 'auto',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                  }}
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('forge:menu-action',
                      { detail: { id: s.id } }));
                    setState(null);
                  }}>
            <Icon name={s.icon} size={16} />
            <small style={{ fontSize: 9, lineHeight: 1 }}>{s.label}</small>
          </button>
        ))}
      </div>
    </div>,
    document.body);
}
