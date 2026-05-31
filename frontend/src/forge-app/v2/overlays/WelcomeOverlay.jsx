/**
 * WelcomeOverlay — first-launch landing. Friendly, dismissible, never
 * blocks. Suggests Recent Projects, sample parts, a quick tour, and
 * one-click new-project templates.
 */

import React from 'react';
import { Modal } from '../../design-system/primitives/Modal.jsx';
import { Card, Stack, Inline } from '../../design-system/primitives/Card.jsx';
import { Button } from '../../design-system/primitives/Button.jsx';
import { Icon } from '../../design-system/icons/Icon.jsx';

const SAMPLES = [
  { id: 'bracket',  title: 'L-bracket',     subtitle: 'Sketch → Extrude → Hole', icon: 'partTab' },
  { id: 'frame',    title: 'Steel frame',   subtitle: 'Weldments + cut list',    icon: 'weldmentsTab' },
  { id: 'enclosure',title: 'Enclosure',     subtitle: 'Sheet metal + unfold',    icon: 'sheetMetalTab' },
];

export function WelcomeOverlay({ open, onClose, onNewProject, onOpenSample, onTakeTour, recent = [] }) {
  return (
    <Modal open={open} onClose={onClose} size="lg" title="" closeOnBackdrop={false}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-9)' }}>
        {/* LEFT: brand + actions */}
        <div>
          <Inline gap="var(--space-5)" align="center" style={{ marginBottom: 'var(--space-9)' }}>
            <span style={{
              width: 40, height: 40, borderRadius: 'var(--radius-md)',
              background: 'var(--accent-bg)', color: 'var(--accent-text)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-xl)',
            }}>F</span>
            <div>
              <h2 style={{ margin: 0, fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)' }}>
                Welcome to <span style={{ color: 'var(--accent-bg)' }}>Forge</span>
              </h2>
              <p style={{ margin: 'var(--space-2) 0 0', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
                Native MCAD on OCCT, driven by local Archie.
              </p>
            </div>
          </Inline>

          <Stack gap="var(--space-5)">
            <Button variant="primary" fullWidth onClick={onNewProject}
              leftIcon={<Icon name="fileNew" size={14} />}>
              New project
            </Button>
            <Button variant="secondary" fullWidth onClick={() => {/* open dialog */}}
              leftIcon={<Icon name="fileOpen" size={14} />}>
              Open existing…
            </Button>
            <Button variant="ghost" fullWidth onClick={onTakeTour}
              leftIcon={<Icon name="help" size={14} />}>
              Take the 60-second tour
            </Button>
          </Stack>

          <div style={{ marginTop: 'var(--space-11)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            <Inline gap="var(--space-5)">
              <span>⌘K for any command</span>
              <span>·</span>
              <span>? for shortcuts</span>
            </Inline>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-7)' }}>
              <input type="checkbox" defaultChecked
                onChange={(e) => {
                  if (typeof localStorage !== 'undefined') {
                    localStorage.setItem('forge.welcome.show', e.target.checked ? '1' : '0');
                  }
                }} />
              Show this on launch
            </label>
          </div>
        </div>

        {/* RIGHT: recent + samples */}
        <div>
          <h3 style={{ margin: '0 0 var(--space-5)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Recent
          </h3>
          {recent.length === 0 ? (
            <Card tone="panel" style={{ marginBottom: 'var(--space-7)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>
              No recent projects.
            </Card>
          ) : (
            <Stack gap="var(--space-3)" style={{ marginBottom: 'var(--space-7)' }}>
              {recent.slice(0, 4).map((r) => (
                <button key={r.id} type="button" style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-5)',
                  padding: 'var(--space-5)',
                  background: 'var(--surface-raised)', color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
                  cursor: 'pointer', textAlign: 'left',
                }}>
                  <Icon name="partTab" size={16} style={{ color: 'var(--accent-bg)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{r.path}</div>
                  </div>
                </button>
              ))}
            </Stack>
          )}

          <h3 style={{ margin: '0 0 var(--space-5)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Start from a sample
          </h3>
          <Stack gap="var(--space-3)">
            {SAMPLES.map((s) => (
              <button key={s.id} type="button" onClick={() => onOpenSample?.(s.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-5)',
                  padding: 'var(--space-5)',
                  background: 'var(--surface-raised)', color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
                  cursor: 'pointer', textAlign: 'left',
                  transition: 'border-color var(--motion-fast)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-bg)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}>
                <Icon name={s.icon} size={20} style={{ color: 'var(--accent-bg)' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' }}>{s.title}</div>
                  <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>{s.subtitle}</div>
                </div>
                <Icon name="chevronRight" size={12} style={{ color: 'var(--text-tertiary)' }} />
              </button>
            ))}
          </Stack>
        </div>
      </div>
    </Modal>
  );
}
