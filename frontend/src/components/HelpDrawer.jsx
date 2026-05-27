import { useEffect, useState } from 'react';
import { TOOL_DOCS } from '../foundation/toolDocs.js';
import './HelpDrawer.css';

/**
 * Help Drawer — F1-triggered slide-in panel that shows docs for the
 * tool the user is currently using (or last used). Sits over the right
 * gutter without disturbing layout — pure overlay.
 *
 * The drawer reads the active tool from window.__archdiscLastTool (set
 * by handleToolExecute) and looks it up in TOOL_DOCS. Unknown tools
 * fall back to a generic "no docs yet" body, which is honest about the
 * coverage state and invites the user to file a request.
 */

function selectDoc(tool) {
  if (!tool) return null;
  return TOOL_DOCS[tool] || null;
}

export default function HelpDrawer() {
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onKey = (e) => {
      // F1 toggles the drawer.
      if (e.key === 'F1') {
        e.preventDefault();
        setOpen(prev => !prev);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('archdisc:open-help', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('archdisc:open-help', onOpen);
    };
  }, [open]);

  // Track the active tool — refresh while the drawer is open.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const t = setInterval(() => {
      setTool(window.__archdiscLastTool || null);
    }, 250);
    return () => clearInterval(t);
  }, []);

  if (!open) return null;

  const doc = selectDoc(tool);

  return (
    <aside className="help-drawer" data-archdisc-help-drawer="open" data-archdisc-help-tool={tool || ''} role="complementary">
      <div className="help-head">
        <span className="help-title">Help{tool ? ` · ${tool}` : ''}</span>
        <button className="help-close" onClick={() => setOpen(false)} aria-label="Close help" data-archdisc-help-close="true">×</button>
      </div>

      {tool && doc && (
        <div className="help-body" data-archdisc-help-body="docs">
          <p className="help-summary">{doc.summary}</p>

          {Array.isArray(doc.parameters) && doc.parameters.length > 0 && (
            <>
              <div className="help-section">Parameters</div>
              <ul className="help-list">
                {doc.parameters.map((p, i) => (
                  <li key={i} className="help-param">
                    <span className="help-param-name">{p.name}</span>
                    <span className="help-param-desc">{p.desc}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {Array.isArray(doc.tips) && doc.tips.length > 0 && (
            <>
              <div className="help-section">Tips</div>
              <ul className="help-list">
                {doc.tips.map((t, i) => <li key={i} className="help-tip">{t}</li>)}
              </ul>
            </>
          )}
        </div>
      )}

      {tool && !doc && (
        <div className="help-body" data-archdisc-help-body="missing">
          <p className="help-summary">
            Detailed help for <strong>{tool}</strong> isn't authored yet.
          </p>
          <p className="help-fallback">
            See the ribbon tooltip + tooltips inside the parameter dialog for the
            short form of the documentation. File a help request via Settings →
            Feedback to prioritize this tool's doc page.
          </p>
        </div>
      )}

      {!tool && (
        <div className="help-body" data-archdisc-help-body="empty">
          <p className="help-summary">
            Press F1 while running any ribbon tool to see its docs here. The
            Command Palette (Ctrl+K) lists every tool with its category for
            quick discovery.
          </p>
        </div>
      )}

      <div className="help-footer">
        <kbd>F1</kbd> toggle · <kbd>Esc</kbd> close
      </div>
    </aside>
  );
}
