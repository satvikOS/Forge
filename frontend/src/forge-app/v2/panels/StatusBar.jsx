/**
 * StatusBar v2 — bottom strip. Mouse coords, selection summary, snap
 * toggles, units, theme switch, help.
 */

import React from 'react';
import { Icon } from '../../design-system/icons/Icon.jsx';
import { Tooltip } from '../../design-system/primitives/Modal.jsx';
import { Divider } from '../../design-system/primitives/Card.jsx';

export function StatusBar({
  cursor = null,            // {x, y, z} world coord, or null
  selection = 0,            // selection count
  units = 'mm',
  onUnitsChange,
  theme = 'dark',
  onThemeChange,
  kernelReady = true,
  archieStatus = 'ready',
}) {
  const cell = {
    display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)',
    padding: '0 var(--space-6)',
    height: 24,
    fontSize: 'var(--text-2xs)',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-mono)',
  };

  return (
    <div role="status" aria-label="Status bar" style={{
      display: 'flex', alignItems: 'center', height: 24,
      background: 'var(--surface-panel)',
      color: 'var(--text-tertiary)',
    }}>
      {/* LEFT */}
      <span style={cell}>
        <Icon name="frame" size={10} />
        {selection > 0 ? `${selection} selected` : 'No selection'}
      </span>
      <Divider orientation="vertical" />
      <span style={cell} aria-label="Cursor coordinates">
        {cursor
          ? `${cursor.x.toFixed(2)}  ${cursor.y.toFixed(2)}  ${cursor.z.toFixed(2)}`
          : '—  —  —'}
      </span>

      {/* SPACER */}
      <span style={{ flex: 1 }} />

      {/* CENTER — Archie status pill */}
      <ArchieStatusPill status={archieStatus} />

      {/* RIGHT */}
      <Divider orientation="vertical" />
      <Tooltip content="Toggle units">
        <button type="button" aria-label="Units"
          onClick={() => onUnitsChange?.(units === 'mm' ? 'in' : units === 'in' ? 'ft' : 'mm')}
          style={{ ...cell, background: 'transparent', border: 'none', cursor: 'pointer' }}>
          {units}
        </button>
      </Tooltip>
      <Divider orientation="vertical" />
      <Tooltip content={`Theme — ${theme}`}>
        <button type="button" aria-label="Theme"
          onClick={() => {
            const next = theme === 'dark' ? 'light' : theme === 'light' ? 'contrast' : 'dark';
            onThemeChange?.(next);
          }}
          style={{ ...cell, background: 'transparent', border: 'none', cursor: 'pointer' }}>
          <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'monitor'} size={10} />
        </button>
      </Tooltip>
      <Divider orientation="vertical" />
      <Tooltip content={kernelReady ? 'Forge kernel ready (OCCT 7.9.3)' : 'Kernel not loaded'}>
        <span style={cell}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: kernelReady ? 'var(--success-bg)' : 'var(--danger-bg)',
          }} />
          {kernelReady ? 'Forge' : 'Offline'}
        </span>
      </Tooltip>
    </div>
  );
}

function ArchieStatusPill({ status }) {
  const tones = {
    ready:    { dot: 'var(--success-bg)',  label: 'Archie ready' },
    thinking: { dot: 'var(--warning-bg)',  label: 'Archie thinking' },
    offline:  { dot: 'var(--text-tertiary)', label: 'Archie offline' },
    error:    { dot: 'var(--danger-bg)',   label: 'Archie error' },
  };
  const t = tones[status] || tones.offline;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)',
      padding: '0 var(--space-6)',
      fontSize: 'var(--text-2xs)',
      color: 'var(--text-secondary)',
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', background: t.dot,
      }} />
      {t.label}
    </span>
  );
}
