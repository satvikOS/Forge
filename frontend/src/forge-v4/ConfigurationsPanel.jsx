// Forge-95 — configurations + design table + version history.
//
// Configurations: named variants of the same feature tree, each with a map
// of per-feature param overrides + suppress flags.  Switching activates a
// re-dispatch through the same kernel pipeline.
// Design table: rows = configurations, columns = parameter keys. Cell edit
// updates the configuration's overrides map.
// Version history: every featureTree mutation snapshots to a JSONL append
// log in localStorage. Restore loads any historical featureTree.

import React from 'react';

const LS_CFG  = 'forge.v4.configs';
const LS_HIST = 'forge.v4.history';

function readLS(key, fallback) {
  if (typeof localStorage === 'undefined') return fallback;
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; }
  catch { return fallback; }
}
function writeLS(key, v) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
}

export function loadConfigurations() {
  return readLS(LS_CFG, { active: 'default', configs: { default: { overrides: {}, suppress: {} } } });
}
export function saveConfigurations(state) { writeLS(LS_CFG, state); }

export function loadHistory() { return readLS(LS_HIST, []); }
export function pushHistory(featureTree) {
  const log = loadHistory();
  log.push({ ts: Date.now(), nodes: featureTree.length, featureTree });
  writeLS(LS_HIST, log.slice(-200));   // keep last 200 snapshots
}

/** Apply a configuration's overrides to a base feature tree. */
export function applyConfiguration(tree, config) {
  if (!config) return tree;
  return tree.map((n) => {
    const ov = config.overrides[n.id];
    const sup = config.suppress[n.id];
    return {
      ...n,
      suppressed: sup ?? n.suppressed,
      params: ov ? { ...n.params, ...ov } : n.params,
    };
  });
}

const sectionHdr = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--forge-ink-mute)', padding: 'var(--forge-space-1) 0',
};
const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)',
  padding: 'var(--forge-space-1) var(--forge-space-2)', borderRadius: 'var(--forge-radius)',
};

// onApplyVariant(appliedTree) — regen bodies from this applied tree (the
//   base + active config's overrides/suppress) but DO NOT replace the
//   featureTree React state, so switching variants is reversible.
// onReplaceTree(tree) — replace the base feature tree wholesale (history
//   restore). Distinct from variant apply so variant switches are
//   idempotent across A→B→A.
export function ConfigurationsPanel({ open, onClose, featureTree, onApplyVariant, onReplaceTree }) {
  const [state, setState] = React.useState(() => loadConfigurations());
  const [tab, setTab] = React.useState('configs');     // 'configs' | 'table' | 'history'
  const [history, setHistory] = React.useState(() => loadHistory());
  React.useEffect(() => { if (open) setHistory(loadHistory()); }, [open]);

  if (!open) return null;

  const setActive = (name) => {
    const next = { ...state, active: name };
    setState(next); saveConfigurations(next);
    onApplyVariant?.(applyConfiguration(featureTree, next.configs[name]));
  };
  const addConfig = () => {
    const name = window.prompt('Configuration name', `Variant ${Object.keys(state.configs).length}`);
    if (!name) return;
    const next = { ...state, configs: { ...state.configs,
      [name]: { overrides: {}, suppress: {} } } };
    setState(next); saveConfigurations(next);
  };
  const editCell = (configName, featureId, key, value) => {
    const cfg = state.configs[configName] || { overrides: {}, suppress: {} };
    const ov = { ...(cfg.overrides[featureId] || {}), [key]: value };
    const nextCfgs = { ...state.configs,
      [configName]: { ...cfg, overrides: { ...cfg.overrides, [featureId]: ov } } };
    const next = { ...state, configs: nextCfgs };
    setState(next); saveConfigurations(next);
    // If we edit the ACTIVE configuration, re-apply so the viewport
    // immediately rebuilds with the new value — the design table is a
    // live editor, not a journal.
    if (configName === next.active) {
      onApplyVariant?.(applyConfiguration(featureTree, next.configs[configName]));
    }
  };
  const toggleSuppress = (configName, featureId, sup) => {
    const cfg = state.configs[configName] || { overrides: {}, suppress: {} };
    const nextCfgs = { ...state.configs,
      [configName]: { ...cfg, suppress: { ...cfg.suppress, [featureId]: !!sup } } };
    const next = { ...state, configs: nextCfgs };
    setState(next); saveConfigurations(next);
    if (configName === next.active) {
      onApplyVariant?.(applyConfiguration(featureTree, next.configs[configName]));
    }
  };
  const restoreSnapshot = (idx) => {
    const snap = history[idx];
    if (snap?.featureTree && onReplaceTree) {
      onReplaceTree(snap.featureTree);
    }
  };

  // Aggregate parameter keys across the feature tree.
  const paramKeys = Array.from(new Set(
    featureTree.flatMap((n) => Object.keys(n.params || {}))));
  const configNames = Object.keys(state.configs);

  return (
    <div style={{
      position: 'fixed',
      top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
      right: 0, bottom: 'var(--forge-statusbar-h)',
      width: 380, zIndex: 1320,
      background: 'var(--forge-canvas-2)',
      borderLeft: '1px solid var(--forge-rail-edge)',
      padding: 'var(--forge-space-3)',
      display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
      color: 'var(--forge-ink)', fontSize: 13,
    }}
         data-testid="forge-configs-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Configurations</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none', color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-configs-close">×</button>
      </header>
      <nav style={{ display: 'flex', gap: 'var(--forge-space-1)',
                    borderBottom: '1px solid var(--forge-rail-edge)' }}>
        {['configs','table','history'].map((t) => (
          <button key={t}
                  onClick={() => setTab(t)}
                  style={{ background: tab === t ? 'var(--forge-accent-mute)' : 'transparent',
                           border: 'none', padding: '6px 10px',
                           color: 'var(--forge-ink)', cursor: 'pointer', fontSize: 12 }}
                  data-testid={`forge-configs-tab-${t}`}>
            {t === 'configs' ? 'Variants' : t === 'table' ? 'Design Table' : 'History'}
          </button>
        ))}
      </nav>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {tab === 'configs' && (
          <section data-testid="forge-configs-list">
            <div style={sectionHdr}>Active</div>
            {configNames.map((name) => (
              <div key={name}
                   onClick={() => setActive(name)}
                   style={{ ...rowStyle, cursor: 'pointer',
                            background: state.active === name ? 'var(--forge-accent-mute)' : 'transparent' }}
                   data-config={name}>
                <span style={{ width: 6, height: 6, borderRadius: '50%',
                               background: state.active === name ? 'var(--forge-accent)' : 'var(--forge-ink-faint)' }} />
                {name}
                <span style={{ flex: 1 }} />
                <small style={{ color: 'var(--forge-ink-mute)' }}>
                  {Object.keys(state.configs[name].overrides).length} overrides
                </small>
              </div>
            ))}
            <button onClick={addConfig}
                    style={{ marginTop: 'var(--forge-space-2)',
                             background: 'var(--forge-surface)', border: '1px solid var(--forge-rail-edge)',
                             padding: '6px 12px', borderRadius: 'var(--forge-radius)',
                             color: 'var(--forge-ink)', cursor: 'pointer' }}
                    data-testid="forge-configs-add">+ New configuration</button>
          </section>
        )}
        {tab === 'table' && (
          <section data-testid="forge-configs-table">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 4, borderBottom: '1px solid var(--forge-rail-edge)' }}>
                    Feature
                  </th>
                  {configNames.map((c) => (
                    <th key={c} style={{ textAlign: 'left', padding: 4,
                                         borderBottom: '1px solid var(--forge-rail-edge)' }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {featureTree.flatMap((f) => [
                  // One leading Suppress row per feature: checkbox per config.
                  <tr key={`${f.id}/__suppress`} data-row="suppress" data-feature={f.id}>
                    <td style={{ padding: 4 }}>
                      <small style={{ color: 'var(--forge-ink-mute)' }}>{f.label}</small>
                      <br />
                      <em style={{ color: 'var(--forge-ink-mute)', fontSize: 10 }}>suppress</em>
                    </td>
                    {configNames.map((c) => {
                      const sup = !!state.configs[c].suppress?.[f.id];
                      return (
                        <td key={c} style={{ padding: 4, textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={sup}
                            onChange={(e) => toggleSuppress(c, f.id, e.target.checked)}
                            data-cell={`${c}/${f.id}/__suppress`} />
                        </td>
                      );
                    })}
                  </tr>,
                  // Then one row per parameter key the feature actually owns.
                  ...paramKeys
                    .filter((k) => k in (f.params || {}))
                    .map((k) => (
                      <tr key={`${f.id}/${k}`}>
                        <td style={{ padding: 4 }}>
                          <small style={{ color: 'var(--forge-ink-mute)' }}>{f.label}</small>
                          <br />
                          <strong style={{ fontFamily: 'var(--forge-mono)' }}>{k}</strong>
                        </td>
                        {configNames.map((c) => {
                          const ov = state.configs[c].overrides[f.id]?.[k];
                          const val = ov ?? f.params[k];
                          return (
                            <td key={c} style={{ padding: 2 }}>
                              <input
                                defaultValue={typeof val === 'object' ? JSON.stringify(val) : val}
                                onBlur={(e) => {
                                  let raw = e.target.value;
                                  try { raw = JSON.parse(raw); }
                                  catch { /* keep string/number as typed */ }
                                  editCell(c, f.id, k, raw);
                                }}
                                style={{ width: '100%',
                                         background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
                                         border: '1px solid var(--forge-rail-edge)', borderRadius: 3,
                                         padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11 }}
                                data-cell={`${c}/${f.id}/${k}`} />
                            </td>
                          );
                        })}
                      </tr>
                    )),
                ])}
              </tbody>
            </table>
          </section>
        )}
        {tab === 'history' && (
          <section data-testid="forge-configs-history">
            {history.length === 0 && (
              <div style={{ color: 'var(--forge-ink-mute)', fontSize: 12 }}>
                No history yet — every edit snapshots here automatically.
              </div>
            )}
            {history.slice().reverse().map((snap, i) => (
              <div key={snap.ts}
                   style={{ ...rowStyle, justifyContent: 'space-between',
                            borderBottom: '1px solid var(--forge-rail-edge)' }}
                   data-snap={i}>
                <small style={{ fontFamily: 'var(--forge-mono)' }}>
                  {new Date(snap.ts).toLocaleTimeString()}
                </small>
                <span>{snap.nodes} features</span>
                <button onClick={() => restoreSnapshot(history.length - 1 - i)}
                        style={{ background: 'var(--forge-surface)', border: '1px solid var(--forge-rail-edge)',
                                 padding: '2px 8px', borderRadius: 3, color: 'var(--forge-ink)', cursor: 'pointer',
                                 fontSize: 11 }}>
                  Restore
                </button>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
