// Forge-137 — Role switcher chip.
//
// Lives in the TopBar (mounted via window.__forgeRoleApply so we don't
// rewrite TopBar.jsx). Click-to-open dropdown lists every built-in
// role + every persisted custom role. Selecting a role:
//   1. writes the id to localStorage forge.v4.role,
//   2. broadcasts forge:role-changed (consumed by Toolbar host below),
//   3. opens any panels the role lists via the window.__forgeOpen<X> hooks
//      already registered by other panel hosts.
//
// The host (RoleSwitcherHost) self-mounts via portal so App.jsx can keep
// its one-line shape.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ROLE_TEMPLATES, getAllRoles, getRole,
  getActiveRoleId, setActiveRoleId,
  applyRoleToSpec, DEFAULT_ROLE_ID,
} from './roleTemplates.js';

const chipStyle = {
  display: 'flex', alignItems: 'center', gap: 6,
  height: 22,
  padding: '0 10px',
  background: 'var(--forge-surface)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 11,
  color: 'var(--forge-ink)',
  fontSize: 11, fontWeight: 600,
  cursor: 'pointer',
  position: 'relative',
};

const dropdownStyle = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  right: 0,
  minWidth: 240,
  background: 'var(--forge-canvas-2)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius)',
  boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
  padding: 6,
  zIndex: 1500,
};

const itemStyle = (active) => ({
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '6px 10px',
  background: active ? 'var(--forge-accent-mute)' : 'transparent',
  border: 'none',
  color: 'var(--forge-ink)',
  fontSize: 12,
  cursor: 'pointer',
  borderRadius: 3,
});

function openPanelsForRole(role) {
  if (!role || typeof window === 'undefined') return;
  const map = {
    convergenceChart: window.__forgeOpenConvergence,
    scenarioRunner:   window.__forgeOpenScenarioRunner,
    stockSimulator:   window.__forgeOpenStockSim,
    cutListPanel:     window.__forgeOpenCutList,
    ifcExport:        window.__forgeOpenIfcExport,
    bomPanel:         window.__forgeOpenBom,
    helpDrawer:       window.__forgeOpenHelp,
    // featureTree / drawingsInspector / configurations / revisionTable
    // are always-visible side panels — no explicit toggle.
  };
  for (const p of role.panels || []) {
    try { map[p]?.(true); } catch {}
  }
}

export function RoleSwitcher() {
  const [activeId, setActiveIdState] = useState(() => getActiveRoleId());
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const roles = useMemo(() => getAllRoles(), [activeId, open]);

  // Close on outside click + Esc.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Listen for external role changes (e.g. RibbonCustomiser saving a
  // custom role and switching to it).
  useEffect(() => {
    const onRoleChange = (e) => {
      if (e?.detail?.id) setActiveIdState(e.detail.id);
    };
    window.addEventListener('forge:role-changed', onRoleChange);
    return () => window.removeEventListener('forge:role-changed', onRoleChange);
  }, []);

  const role = getRole(activeId);

  return (
    <div ref={ref} style={chipStyle}
         data-testid="forge-role-chip"
         data-role-active={activeId}
         onClick={() => setOpen((v) => !v)}>
      <span style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
        background: role.accent || 'var(--forge-accent)',
      }} />
      <span>{role.label}</span>
      <span style={{ color: 'var(--forge-ink-mute)', fontSize: 9 }}>▾</span>
      {open && (
        <div style={dropdownStyle}
             data-testid="forge-role-menu"
             onMouseDown={(e) => e.stopPropagation()}>
          <div style={{
            fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em',
            color: 'var(--forge-ink-mute)', padding: '4px 8px 6px',
          }}>
            Built-in roles
          </div>
          {ROLE_TEMPLATES.map((r) => (
            <button key={r.id}
                    type="button"
                    style={itemStyle(r.id === activeId)}
                    data-role-id={r.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveIdState(r.id);
                      setActiveRoleId(r.id);
                      openPanelsForRole(r);
                      setOpen(false);
                    }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                  background: r.accent,
                }} />
                <span style={{ flex: 1 }}>{r.label}</span>
                {r.id === activeId && (
                  <span style={{ fontSize: 9, color: 'var(--forge-ink-mute)' }}>active</span>
                )}
              </span>
              <span style={{ display: 'block', fontSize: 10,
                             color: 'var(--forge-ink-mute)',
                             marginTop: 2, marginLeft: 14 }}>
                {r.hint}
              </span>
            </button>
          ))}
          {(() => {
            const custom = roles.filter((r) =>
              !ROLE_TEMPLATES.find((x) => x.id === r.id));
            if (!custom.length) return null;
            return (
              <>
                <div style={{
                  fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: 'var(--forge-ink-mute)', padding: '8px 8px 6px',
                  borderTop: '1px solid var(--forge-rail-edge)',
                  marginTop: 4,
                }}>
                  Custom roles
                </div>
                {custom.map((r) => (
                  <button key={r.id}
                          type="button"
                          style={itemStyle(r.id === activeId)}
                          data-role-id={r.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveIdState(r.id);
                            setActiveRoleId(r.id);
                            openPanelsForRole(r);
                            setOpen(false);
                          }}>
                    <span>{r.label}</span>
                  </button>
                ))}
              </>
            );
          })()}
          <div style={{
            borderTop: '1px solid var(--forge-rail-edge)',
            marginTop: 4, padding: '6px 8px',
          }}>
            <button type="button"
                    style={{
                      ...itemStyle(false),
                      textAlign: 'center',
                      fontSize: 11,
                      color: 'var(--forge-accent)',
                    }}
                    data-testid="forge-role-open-customiser"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(false);
                      try { window.__forgeOpenRibbonCustomiser?.(true); } catch {}
                    }}>
              Customise ribbons…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── host ──────────────────────────────────
//
// The host mounts the chip into the top bar by finding the existing
// .forge-topbar element and creating a fixed-position container next
// to the workbench chip. This avoids editing TopBar.jsx.

function findTopbarHost() {
  if (typeof document === 'undefined') return null;
  return document.querySelector('.forge-topbar') ||
         document.querySelector('[data-testid="forge-topbar"]');
}

export function RoleSwitcherHost() {
  const [mountEl, setMountEl] = useState(null);

  // Wait for the TopBar to mount, then create a sibling span we can
  // portal the chip into. This mirrors the SnapStatusChip pattern.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let detach = () => {};
    const tryMount = () => {
      const host = findTopbarHost();
      if (!host) return false;
      // Find the wb chip so we can slot ours just before it.
      const wbChip = host.querySelector('[data-testid="forge-topbar-wb-chip"]');
      const span = document.createElement('span');
      span.dataset.forgeRoleSlot = '1';
      span.style.display = 'inline-flex';
      span.style.alignItems = 'center';
      span.style.marginRight = '8px';
      if (wbChip && wbChip.parentNode) {
        wbChip.parentNode.insertBefore(span, wbChip);
      } else {
        host.appendChild(span);
      }
      setMountEl(span);
      detach = () => { try { span.remove(); } catch {} };
      return true;
    };
    if (!tryMount()) {
      // Re-try on every DOM mutation until the topbar shows up.
      const obs = new MutationObserver(() => {
        if (tryMount()) obs.disconnect();
      });
      obs.observe(document.body, { childList: true, subtree: true });
      return () => { obs.disconnect(); detach(); };
    }
    return () => { detach(); };
  }, []);

  // Drive Toolbar.jsx by exposing the SPEC-transformer on window so
  // ForgeShellV4 / Toolbar can read it lazily.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeRoleApply = (spec) => {
      const role = getRole(getActiveRoleId());
      return applyRoleToSpec(role, spec);
    };
    window.__forgeRoleActiveId = getActiveRoleId;
    const onRoleChange = () => {
      // Force Toolbar to re-render by touching the wb-changed event the
      // shell already listens to.
      try {
        window.dispatchEvent(new CustomEvent('forge:role-applied', {
          detail: { id: getActiveRoleId() },
        }));
      } catch {}
    };
    window.addEventListener('forge:role-changed', onRoleChange);
    return () => {
      try { delete window.__forgeRoleApply; } catch {}
      try { delete window.__forgeRoleActiveId; } catch {}
      window.removeEventListener('forge:role-changed', onRoleChange);
    };
  }, []);

  if (!mountEl) return null;
  return createPortal(<RoleSwitcher />, mountEl);
}
