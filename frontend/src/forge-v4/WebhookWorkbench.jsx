// Forge-197 — Webhook receiver workbench.
//
// Tiny control panel for the embedded loopback HTTP listener: start/
// stop, set port + optional HMAC shared secret, watch live payload
// arrivals in a scrolling log.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 540, zIndex: 1310,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};

const fieldInputStyle = {
  width: '100%', background: 'var(--forge-canvas)',
  color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '4px 6px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

export function WebhookWorkbenchPanel({ open, onClose }) {
  const [port, setPort] = React.useState(9595);
  const [secret, setSecret] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [status, setStatus] = React.useState({ kind: 'idle', text: 'idle' });
  const [received, setReceived] = React.useState([]);
  const unsubRef = React.useRef(null);

  const start = React.useCallback(async () => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.webhook) {
      setStatus({ kind: 'err', text: 'forge.webhook unavailable' });
      return;
    }
    const r = await f.webhook.start({ port, secret: secret || null });
    if (r.ok) {
      setRunning(true);
      setStatus({ kind: 'ok',
        text: `listening on 127.0.0.1:${r.port}${r.requireSignature ? ' (HMAC required)' : ''}` });
      if (unsubRef.current) unsubRef.current();
      unsubRef.current = f.webhook.onPayload((p) => {
        setReceived((arr) => [{ id: Date.now() + Math.random(), payload: p }, ...arr].slice(0, 30));
      });
    } else {
      setStatus({ kind: 'err', text: r.error || 'start failed' });
    }
  }, [port, secret]);

  const stop = React.useCallback(async () => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.webhook) return;
    await f.webhook.stop();
    setRunning(false);
    setStatus({ kind: 'idle', text: 'stopped' });
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
  }, []);

  // Auto-refresh status on mount.
  React.useEffect(() => {
    if (!open) return undefined;
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (f && f.webhook) {
      f.webhook.status().then((s) => {
        setRunning(s.running);
        if (s.running) {
          setStatus({ kind: 'ok',
            text: `listening on 127.0.0.1:${s.port}${s.requireSignature ? ' (HMAC required)' : ''}` });
          if (unsubRef.current) unsubRef.current();
          unsubRef.current = f.webhook.onPayload((p) => {
            setReceived((arr) => [{ id: Date.now() + Math.random(), payload: p }, ...arr].slice(0, 30));
          });
        }
      });
    }
    return () => {
      if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-webhook-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Webhook receiver · CI/CD trigger</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-webhook-close">×</button>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 6 }}>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>port</small>
          <input type="number" value={port}
                 onChange={(e) => setPort(parseInt(e.target.value) || 9595)}
                 style={fieldInputStyle} data-testid="forge-webhook-port" />
        </label>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>HMAC secret (optional)</small>
          <input value={secret}
                 onChange={(e) => setSecret(e.target.value)}
                 style={fieldInputStyle}
                 placeholder="leave blank to skip signature check"
                 data-testid="forge-webhook-secret" />
        </label>
      </section>

      <section style={{ display: 'flex', gap: 6 }}>
        {!running && (
          <button onClick={start}
                  style={{ background: 'var(--forge-accent)', border: 'none',
                           color: '#0a0e14', padding: '8px 12px', cursor: 'pointer',
                           fontWeight: 600, fontFamily: 'var(--forge-mono)' }}
                  data-testid="forge-webhook-start">
            Start listener
          </button>
        )}
        {running && (
          <button onClick={stop}
                  style={{ background: 'var(--forge-rail-edge)', border: 'none',
                           color: 'var(--forge-ink)', padding: '8px 12px', cursor: 'pointer',
                           fontFamily: 'var(--forge-mono)' }}
                  data-testid="forge-webhook-stop">
            Stop
          </button>
        )}
      </section>

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        color: status.kind === 'err' ? 'var(--forge-bad, #ff6363)'
                             : status.kind === 'ok'  ? 'var(--forge-ok, #4ec18b)'
                             : 'var(--forge-ink-mute)' }}
               data-testid="forge-webhook-status">
        {status.text}
      </section>

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        background: 'var(--forge-canvas)',
                        padding: 'var(--forge-space-2)',
                        borderRadius: 'var(--forge-radius)',
                        maxHeight: 280, overflowY: 'auto' }}
               data-testid="forge-webhook-log">
        {received.length === 0
          ? <div style={{ color: 'var(--forge-ink-mute)' }}>no payloads yet</div>
          : received.map((r) => (
              <div key={r.id} style={{ marginBottom: 6 }}>
                <div style={{ color: 'var(--forge-accent)' }}>
                  ← POST {r.payload.url || '/'} · {new Date(r.payload.receivedAt).toISOString().slice(11, 19)}
                </div>
                <div style={{ color: 'var(--forge-ink-mute)' }}>
                  {JSON.stringify(r.payload.body).slice(0, 240)}
                </div>
              </div>
            ))}
      </section>
    </div>
  );
}

export function WebhookWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenWebhookWorkbench  = () => setOpen(true);
    window.__forgeCloseWebhookWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.webhook' || e?.detail?.id === 'workbench.webhook') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'webhook') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <WebhookWorkbenchPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default WebhookWorkbenchPanel;
