import { useEffect, useState, useCallback } from 'react';
import { getBodyRegistry } from '../foundation/BodyRegistry.js';

/**
 * Part Browser — lists every foundation body currently in the
 * scene. Click → focus, eye toggle → hide/show, right-click → menu
 * (isolate / show-all / rename / delete).
 *
 * Sits in the right aside between DesignHistoryPanel and
 * FeatureTreePanel.
 */
export default function PartBrowserPanel() {
  const [bodies, setBodies] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    const reg = getBodyRegistry();
    setBodies(reg.list().map(shallow));
    const unsub = reg.onChange((next) => setBodies(next.map(shallow)));
    return unsub;
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close);
    };
  }, [contextMenu]);

  const handleSelect = useCallback((id) => {
    const reg = getBodyRegistry();
    const body = reg.bodies.find(b => b.id === id);
    if (body?.group && typeof window?.__archdiscFocusOnObject === 'function') {
      window.__archdiscFocusOnObject(body.group);
    }
  }, []);

  const handleToggle = useCallback((id, currentlyVisible, e) => {
    e.stopPropagation();
    getBodyRegistry().setVisible(id, !currentlyVisible);
  }, []);

  const handleContextMenu = useCallback((e, body) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, body });
  }, []);

  const startRename = useCallback((body) => {
    setRenaming(body.id);
    setRenameValue(body.name);
    setContextMenu(null);
  }, []);

  const commitRename = useCallback((id) => {
    if (renameValue.trim()) getBodyRegistry().rename(id, renameValue);
    setRenaming(null);
  }, [renameValue]);

  return (
    <div className="part-browser-panel">
      <div className="pb-header">
        <span className="pb-title">Bodies</span>
        <span className="pb-count">{bodies.length}</span>
        {bodies.length > 0 && (
          <button className="pb-action-btn" title="Show all"
                  onClick={() => getBodyRegistry().showAll()}>◉</button>
        )}
      </div>
      <div className="pb-list">
        {bodies.length === 0 && <div className="pb-empty">No bodies in scene.</div>}
        {bodies.map((b) => (
          <div
            key={b.id}
            className={`pb-row ${b.visible ? '' : 'pb-hidden'}`}
            onClick={() => handleSelect(b.id)}
            onContextMenu={(e) => handleContextMenu(e, b)}
          >
            <button
              className="pb-eye"
              onClick={(e) => handleToggle(b.id, b.visible, e)}
              title={b.visible ? 'Hide' : 'Show'}
            >
              {b.visible ? '●' : '○'}
            </button>
            {renaming === b.id ? (
              <input
                className="pb-rename"
                value={renameValue}
                autoFocus
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => commitRename(b.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(b.id);
                  if (e.key === 'Escape') setRenaming(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="pb-name" onDoubleClick={() => startRename(b)}>
                {b.name}
              </span>
            )}
            <span className="pb-vol" title="Volume (mm³)">
              {formatVol(b.volume_mm3)}
            </span>
          </div>
        ))}
      </div>

      {contextMenu && (
        <div
          className="pb-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { getBodyRegistry().isolate(contextMenu.body.id); setContextMenu(null); }}>
            Isolate
          </button>
          <button onClick={() => { getBodyRegistry().showAll(); setContextMenu(null); }}>
            Show all
          </button>
          <button onClick={() => startRename(contextMenu.body)}>
            Rename
          </button>
          <div className="pb-ctx-divider" />
          <button className="pb-ctx-delete"
                  onClick={() => { getBodyRegistry().remove(contextMenu.body.id); setContextMenu(null); }}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function shallow(b) {
  return { id: b.id, name: b.name, sourceTool: b.sourceTool, volume_mm3: b.volume_mm3, visible: b.visible };
}

function formatVol(v) {
  if (v == null || !Number.isFinite(v)) return '';
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)} cm³`;
  return `${v.toFixed(0)} mm³`;
}
