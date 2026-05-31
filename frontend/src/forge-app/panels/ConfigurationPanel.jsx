import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { Configuration } from '../../kernel/forge/Configurations.js';

/**
 * ConfigurationPanel — variant manager for the active part.
 *
 * Lists every Configuration in the set, highlights the active one,
 * lets the user switch by click, add a fresh "Variant N" config, and
 * edit overrides inline as `paramKey = value` rows. Inline override
 * editing is a thin shim over Configuration.set/unset; it stays
 * deliberately string-typed because the FeatureTree binding is the
 * one that knows the canonical types.
 */
export default function ConfigurationPanel({ configurations }) {
  const [, bump] = useState(0);

  if (!configurations) {
    return (
      <div className="forge-panel">
        <div className="forge-panel-header">Configurations</div>
        <div className="forge-panel-body" style={{ color: 'var(--muted)' }}>
          No active document.
        </div>
      </div>
    );
  }

  const configs = configurations.list();
  const activeId = configurations.activeId;

  function addConfig() {
    const n = configs.length + 1;
    configurations.add(new Configuration({ name: `Variant ${n}` }));
    bump((x) => x + 1);
  }
  function selectConfig(id) {
    configurations.setActive(id);
    bump((x) => x + 1);
  }

  const active = activeId ? configurations.configs.get(activeId) : null;

  return (
    <div className="forge-panel">
      <div className="forge-panel-header">
        Configurations
        <div className="spacer" />
        <button
          type="button"
          style={{
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text)', borderRadius: 3, padding: '0 6px', cursor: 'pointer',
          }}
          onClick={addConfig}
        >
          +
        </button>
      </div>
      <div className="forge-panel-body">
        {configs.map((c) => (
          <div
            key={c.id}
            className={`forge-config-row${c.id === activeId ? ' active' : ''}`}
            onClick={() => selectConfig(c.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') selectConfig(c.id); }}
          >
            <span className="name">{c.name}</span>
            <span style={{ color: 'var(--muted)', fontSize: 11 }}>
              {Object.keys(c.overrides).length} overrides
            </span>
          </div>
        ))}
        {active && (
          <OverrideEditor cfg={active} onChange={() => bump((x) => x + 1)} />
        )}
      </div>
    </div>
  );
}

ConfigurationPanel.propTypes = {
  configurations: PropTypes.object,
};

function OverrideEditor({ cfg, onChange }) {
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const entries = Object.entries(cfg.overrides);

  return (
    <div style={{ marginTop: 8, borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
      <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 4 }}>
        Overrides — {cfg.name}
      </div>
      {entries.length === 0 && (
        <div style={{ color: 'var(--muted)', fontSize: 11 }}>None yet</div>
      )}
      {entries.map(([k, v]) => (
        <div key={k} className="forge-prop-field">
          <span className="label">{k}</span>
          <span style={{ display: 'flex', gap: 4 }}>
            <input
              type="text"
              defaultValue={String(v)}
              onBlur={(e) => {
                const next = e.target.value;
                const num = Number(next);
                cfg.set(k, Number.isFinite(num) && next.trim() !== '' ? num : next);
                onChange();
              }}
            />
            <button
              type="button"
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer' }}
              onClick={() => { cfg.unset(k); onChange(); }}
            >
              ✕
            </button>
          </span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        <input
          type="text"
          placeholder="paramKey"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          style={{ flex: 1 }}
        />
        <input
          type="text"
          placeholder="value"
          value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          onClick={() => {
            if (!newKey.trim()) return;
            const num = Number(newVal);
            cfg.set(newKey.trim(), Number.isFinite(num) && newVal.trim() !== '' ? num : newVal);
            setNewKey(''); setNewVal('');
            onChange();
          }}
          style={{
            background: 'var(--panel-2)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 3, padding: '0 8px',
            cursor: 'pointer',
          }}
        >
          add
        </button>
      </div>
    </div>
  );
}

OverrideEditor.propTypes = {
  cfg: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};
