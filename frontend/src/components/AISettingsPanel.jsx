import { useEffect, useState } from 'react';
import { PROVIDERS, COMPATIBLE_PRESETS, loadProviderConfig, saveProviderConfig } from '../ai/PlannerProviders.js';

/**
 * Minimal BYO-LLM settings surface. Toggled via the ribbon (or a
 * keyboard shortcut). Stores the user-supplied API key, provider
 * choice, and model in localStorage. Never sends the key anywhere
 * except the provider's own endpoint.
 */
export default function AISettingsPanel({ open, onClose }) {
  const [provider, setProvider] = useState('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const cfg = loadProviderConfig();
    if (cfg) {
      setProvider(cfg.provider ?? 'anthropic');
      setApiKey(cfg.apiKey ?? '');
      setModel(cfg.model ?? '');
      setBaseUrl(cfg.baseUrl ?? '');
    }
  }, [open]);

  if (!open) return null;

  const handleSave = () => {
    saveProviderConfig({ provider, apiKey, model, baseUrl });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };
  const handleClear = () => {
    saveProviderConfig(null);
    setApiKey('');
    setModel('');
    setBaseUrl('');
    setSaved(false);
  };

  const def = PROVIDERS[provider];

  return (
    <div className="ai-settings-backdrop" onClick={onClose}>
      <div className="ai-settings-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="ai-settings-header">
          <span className="ai-settings-title">AI Provider</span>
          <button className="ai-settings-close" onClick={onClose}>×</button>
        </div>
        <div className="ai-settings-blurb">
          Bring your own LLM. Keys live in this browser's localStorage and are sent
          only to the provider you choose. With no provider configured ArchDisc
          falls back to canonical plans.
        </div>
        <div className="ai-settings-body">
          <Row label="Provider">
            <select className="ai-settings-input" value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    data-field="provider">
              {Object.entries(PROVIDERS).map(([k, p]) => (
                <option key={k} value={k}>{p.label}</option>
              ))}
            </select>
          </Row>
          {provider === 'compatible' && (
            <Row label="Preset">
              <select className="ai-settings-input" data-field="preset"
                      onChange={(e) => {
                        const p = COMPATIBLE_PRESETS.find(x => x.id === e.target.value);
                        if (p) { setBaseUrl(p.baseUrl); setModel(p.model); }
                      }}>
                {COMPATIBLE_PRESETS.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </Row>
          )}
          <Row label="API key">
            <input className="ai-settings-input" type="password"
                   value={apiKey} placeholder={provider === 'compatible' ? '(optional)' : 'sk-…'}
                   onChange={(e) => setApiKey(e.target.value)}
                   data-field="apiKey" />
          </Row>
          <Row label="Model">
            <input className="ai-settings-input" type="text"
                   value={model} placeholder={def?.defaultModel ?? ''}
                   onChange={(e) => setModel(e.target.value)}
                   data-field="model" />
          </Row>
          <Row label="Base URL">
            <input className="ai-settings-input" type="text"
                   value={baseUrl} placeholder={def?.defaultBaseUrl ?? ''}
                   onChange={(e) => setBaseUrl(e.target.value)}
                   data-field="baseUrl" />
          </Row>
        </div>
        <div className="ai-settings-footer">
          <button className="ai-settings-btn-clear" onClick={handleClear}>Clear</button>
          <span className="ai-settings-saved">{saved ? 'Saved' : ''}</span>
          <button className="ai-settings-btn-save" onClick={handleSave} data-action="save">Save</button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="ai-settings-row">
      <label className="ai-settings-label">{label}</label>
      <div className="ai-settings-control">{children}</div>
    </div>
  );
}
