// Forge-65 — first-launch welcome screen.
// Big anvil-spark mark, copper headline, 4 role cards (Pro / Designer /
// Student / Curious). The choice toggles which tools are pinned in
// the Toolbar — same density everywhere, different defaults.

import React from 'react';
import { ForgeMark } from './icons/Logo.jsx';
import { Icon } from './icons/Icon.jsx';

export const ROLES = [
  { id: 'pro',      label: 'Professional',  icon: 'wb.mech',
    blurb: 'CAD/CAM/CAE practitioner. Every tool pinned, dense feature tree, AI assists on demand.' },
  { id: 'designer', label: 'Industrial designer', icon: 'wb.mold',
    blurb: 'Form-first. Surface modelling and rendering pinned; sim tucked away.' },
  { id: 'student',  label: 'Student / Learning', icon: 'wb.drawing',
    blurb: 'Sketcher and basic 3D pinned. Tutorial chips in Archie. Everything else one Cmd+K away.' },
  { id: 'curious',  label: 'Just curious', icon: 'archie.spark',
    blurb: 'Drive Forge entirely from the command bar. Toolbar shows only the 6 most-used ops.' },
];

export function WelcomeOverlay({ open, onPick }) {
  if (!open) return null;
  return (
    <div role="dialog"
         aria-label="Welcome to Forge"
         data-testid="forge-welcome"
         style={{
           position: 'fixed', inset: 0,
           background: 'var(--forge-overlay)',
           backdropFilter: 'blur(8px)',
           display: 'flex', flexDirection: 'column',
           alignItems: 'center', justifyContent: 'center',
           padding: 32,
           zIndex: 3000,
         }}>
      <div style={{
        background: 'var(--forge-canvas-2)',
        border: '1px solid var(--forge-rail-edge)',
        borderRadius: 'var(--forge-radius-lg)',
        padding: 32,
        maxWidth: 760,
        width: '100%',
      }}>
        <div style={{ display: 'flex', alignItems: 'center',
                      gap: 16, marginBottom: 18 }}>
          <ForgeMark size={56} />
          <div>
            <h1 style={{ font: 'inherit', fontSize: 22, fontWeight: 600,
                         color: 'var(--forge-ink)', margin: 0,
                         letterSpacing: '-0.01em' }}>
              Welcome to <span style={{ color: 'var(--forge-accent)' }}>Forge</span>.
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--forge-ink-2)' }}>
              Tell us how you'll use it. We tune which tools sit up front — you can change this anytime in Settings.
            </p>
          </div>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 10,
        }}>
          {ROLES.map((r) => (
            <button key={r.id}
                    type="button"
                    data-role-card={r.id}
                    onClick={() => onPick?.(r.id)}
                    style={{
                      background: 'var(--forge-surface)',
                      border: '1px solid var(--forge-rail-edge)',
                      borderRadius: 'var(--forge-radius)',
                      padding: 14,
                      color: 'var(--forge-ink)',
                      font: 'inherit',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'border-color 120ms ease, background 120ms ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--forge-accent)';
                      e.currentTarget.style.background = 'var(--forge-accent-mute)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--forge-rail-edge)';
                      e.currentTarget.style.background = 'var(--forge-surface)';
                    }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ color: 'var(--forge-accent)' }}>
                  <Icon name={r.icon} size={20} />
                </span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{r.label}</span>
              </div>
              <p style={{ fontSize: 11, color: 'var(--forge-ink-2)', margin: 0, lineHeight: 1.5 }}>
                {r.blurb}
              </p>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 18, display: 'flex',
                      justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--forge-ink-mute)' }}>
            All tools stay reachable from <kbd style={{
              fontFamily: 'var(--forge-mono)', fontSize: 10,
              background: 'var(--forge-surface)', padding: '1px 5px',
              borderRadius: 3, border: '1px solid var(--forge-rail-edge)',
            }}>⌘K</kbd> regardless of choice.
          </span>
          <button type="button"
                  data-testid="welcome-skip"
                  onClick={() => onPick?.('pro')}
                  style={{
                    background: 'transparent', border: 'none',
                    color: 'var(--forge-ink-mute)', cursor: 'pointer',
                    font: 'inherit', fontSize: 11,
                  }}>
            Skip → use defaults
          </button>
        </div>
      </div>
    </div>
  );
}
