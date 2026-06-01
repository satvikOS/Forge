// Forge-137 — Ribbon customiser.
//
// Drag-drop UI for re-arranging toolbar groups across workbenches and
// saving the result as a custom role.
//
// Layout: two-column grid. Left column = available groups for the
// chosen workbench (drawn from Toolbar.jsx's SPEC). Right column = the
// active "in role" list, drag-orderable. User can:
//   - move groups between columns,
//   - reorder within the right column,
//   - name + save the resulting layout as a custom role,
//   - switch to it immediately.
//
// Saved roles persist in localStorage (forge.v4.customRoles).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toolsForWorkbench } from './Toolbar.jsx';
import { WORKBENCHES } from './WorkbenchRail.jsx';
import {
  saveCustomRole, setActiveRoleId, getActiveRoleId,
  getRole, ROLE_TEMPLATES,
} from './roleTemplates.js';

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 1460,
  background: 'rgba(8,9,12,0.62)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const panelStyle = {
  width: 760, maxWidth: '94vw',
  background: 'var(--forge-canvas-2)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius)',
  padding: 16,
  display: 'flex', flexDirection: 'column', gap: 12,
  color: 'var(--forge-ink)',
  boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
};
const colStyle = {
  flex: 1,
  background: 'var(--forge-canvas)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 3,
  padding: 8,
  display: 'flex', flexDirection: 'column', gap: 4,
  minHeight: 220, maxHeight: 360, overflowY: 'auto',
};
const groupItemStyle = (dragging) => ({
  padding: '6px 8px',
  background: dragging ? 'var(--forge-accent-mute)' : 'var(--forge-surface)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 3,
  fontSize: 12,
  cursor: 'grab',
  userSelect: 'none',
  display: 'flex', alignItems: 'center', gap: 6,
});
const inputStyle = {
  background: 'var(--forge-canvas)',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)',
  padding: '6px 8px',
  borderRadius: 3, fontSize: 12,
};
const buttonStyle = (kind) => ({
  padding: '8px 14px',
  background: kind === 'primary' ? 'var(--forge-accent)' : 'var(--forge-surface)',
  color: kind === 'primary' ? '#0a0a0a' : 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 3, cursor: 'pointer', fontSize: 12, fontWeight: 600,
});

export function RibbonCustomiserPanel({ open, onClose }) {
  // Workbench whose groups we're editing right now.
  const [wb, setWb] = useState('mech');
  const [available, setAvailable] = useState([]);
  const [active, setActive] = useState([]);
  const [name, setName] = useState('My Role');
  const [savedMessage, setSavedMessage] = useState(null);
  const [dragId, setDragId] = useState(null);

  // Re-seed columns when the workbench changes.
  useEffect(() => {
    const all = toolsForWorkbench(wb).map((g) => g.label);
    const activeRole = getRole(getActiveRoleId());
    const wbCfg = (activeRole.toolbarGroups || []).find((c) => c.workbench === wb);
    const fromRole = wbCfg && wbCfg.groups[0] !== '*'
      ? wbCfg.groups.filter((lbl) => all.includes(lbl)) : all.slice();
    setActive(fromRole);
    setAvailable(all.filter((lbl) => !fromRole.includes(lbl)));
  }, [wb, open]);

  if (!open) return null;

  const moveToActive = (lbl) => {
    setActive((arr) => [...arr, lbl]);
    setAvailable((arr) => arr.filter((x) => x !== lbl));
  };
  const moveToAvailable = (lbl) => {
    setAvailable((arr) => [...arr, lbl]);
    setActive((arr) => arr.filter((x) => x !== lbl));
  };
  const reorderActive = (fromLbl, toLbl) => {
    setActive((arr) => {
      const i = arr.indexOf(fromLbl);
      const j = arr.indexOf(toLbl);
      if (i < 0 || j < 0 || i === j) return arr;
      const next = arr.slice();
      const [moved] = next.splice(i, 1);
      next.splice(j, 0, moved);
      return next;
    });
  };

  const handleSave = () => {
    const id = `custom-${name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}` ||
               `custom-${Date.now().toString(36)}`;
    const role = {
      id, label: name.trim() || 'Custom role',
      hint:  'User-defined role (saved from Ribbon customiser).',
      defaultWorkbench: wb,
      toolbarGroups: [{ workbench: wb, groups: active.slice() }],
      panels: [],
      accent: '#9ad0ff',
    };
    saveCustomRole(role);
    setActiveRoleId(id);
    setSavedMessage(`Saved · ${role.label}`);
  };

  return (
    <div style={overlayStyle}
         data-testid="forge-ribbon-overlay"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <section style={panelStyle}
               data-testid="forge-ribbon-panel"
               role="dialog"
               aria-label="Ribbon customiser"
               onMouseDown={(e) => e.stopPropagation()}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong>Ribbon customiser</strong>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}
                  data-testid="forge-ribbon-close"
                  style={{ background: 'transparent', border: 'none',
                           color: 'var(--forge-ink-mute)', cursor: 'pointer',
                           fontSize: 14 }}>×</button>
        </header>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12,
                      fontSize: 11, color: 'var(--forge-ink-mute)' }}>
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Workbench
          </span>
          <select value={wb}
                  data-testid="forge-ribbon-wb"
                  onChange={(e) => setWb(e.target.value)}
                  style={{ ...inputStyle, minWidth: 160 }}>
            {WORKBENCHES.map((w) => (
              <option key={w.id} value={w.id}>{w.label}</option>
            ))}
          </select>
          <span style={{ flex: 1 }} />
          <span>Drag groups between columns; reorder by dragging within Active.</span>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: 'var(--forge-ink-mute)', marginBottom: 4 }}>
              Available
            </div>
            <div style={colStyle}
                 data-testid="forge-ribbon-available"
                 onDragOver={(e) => e.preventDefault()}
                 onDrop={(e) => {
                   e.preventDefault();
                   const lbl = e.dataTransfer.getData('text/plain');
                   if (lbl && active.includes(lbl)) moveToAvailable(lbl);
                   setDragId(null);
                 }}>
              {available.map((lbl) => (
                <div key={lbl}
                     draggable
                     data-group-label={lbl}
                     style={groupItemStyle(dragId === lbl)}
                     onDragStart={(e) => {
                       e.dataTransfer.setData('text/plain', lbl);
                       e.dataTransfer.effectAllowed = 'move';
                       setDragId(lbl);
                     }}
                     onDragEnd={() => setDragId(null)}
                     onDoubleClick={() => moveToActive(lbl)}>
                  <span style={{ flex: 1 }}>{lbl}</span>
                  <button type="button"
                          data-testid={`forge-ribbon-add-${lbl}`}
                          onClick={() => moveToActive(lbl)}
                          style={{
                            background: 'transparent', border: 'none',
                            color: 'var(--forge-accent)', cursor: 'pointer',
                            fontSize: 16,
                          }}>+</button>
                </div>
              ))}
              {available.length === 0 && (
                <div style={{ fontStyle: 'italic',
                              color: 'var(--forge-ink-mute)',
                              fontSize: 11, padding: 4 }}>
                  No additional groups.
                </div>
              )}
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: 'var(--forge-ink-mute)', marginBottom: 4 }}>
              Active in role
            </div>
            <div style={colStyle}
                 data-testid="forge-ribbon-active"
                 onDragOver={(e) => e.preventDefault()}
                 onDrop={(e) => {
                   e.preventDefault();
                   const lbl = e.dataTransfer.getData('text/plain');
                   if (lbl && available.includes(lbl)) moveToActive(lbl);
                   setDragId(null);
                 }}>
              {active.map((lbl) => (
                <div key={lbl}
                     draggable
                     data-group-label={lbl}
                     style={groupItemStyle(dragId === lbl)}
                     onDragStart={(e) => {
                       e.dataTransfer.setData('text/plain', lbl);
                       e.dataTransfer.effectAllowed = 'move';
                       setDragId(lbl);
                     }}
                     onDragOver={(e) => {
                       e.preventDefault();
                       if (dragId && dragId !== lbl) reorderActive(dragId, lbl);
                     }}
                     onDragEnd={() => setDragId(null)}>
                  <span style={{ flex: 1 }}>{lbl}</span>
                  <button type="button"
                          data-testid={`forge-ribbon-remove-${lbl}`}
                          onClick={() => moveToAvailable(lbl)}
                          style={{
                            background: 'transparent', border: 'none',
                            color: 'var(--forge-ink-mute)', cursor: 'pointer',
                            fontSize: 16,
                          }}>−</button>
                </div>
              ))}
              {active.length === 0 && (
                <div style={{ fontStyle: 'italic',
                              color: 'var(--forge-ink-mute)',
                              fontSize: 11, padding: 4 }}>
                  Drop groups here to add them to the role.
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 11, color: 'var(--forge-ink-mute)',
                          textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Save as
          </label>
          <input value={name}
                 onChange={(e) => setName(e.target.value)}
                 data-testid="forge-ribbon-name"
                 style={{ ...inputStyle, flex: 1 }} />
          <button type="button"
                  onClick={handleSave}
                  style={buttonStyle('primary')}
                  data-testid="forge-ribbon-save">
            Save as custom role
          </button>
        </div>

        {savedMessage && (
          <div data-testid="forge-ribbon-saved"
               style={{ fontSize: 11, color: 'var(--forge-ink-2)',
                        fontFamily: 'var(--forge-mono)' }}>
            {savedMessage}
          </div>
        )}

        <footer style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button"
                  onClick={onClose}
                  data-testid="forge-ribbon-done"
                  style={buttonStyle('secondary')}>
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}

export function RibbonCustomiserHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeOpenRibbonCustomiser = (v) =>
      setOpen(typeof v === 'boolean' ? v : !open);
    return () => { try { delete window.__forgeOpenRibbonCustomiser; } catch {} };
  }, [open]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <RibbonCustomiserPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}
