import React from 'react';
import { useAppState } from './state/AppState.js';

/**
 * Multi-document bar — the row of open .forge projects above the ribbon.
 *
 * Switching a tab swaps which ForgeProject the panels (FeatureTree /
 * Configurations / PropertyPanel) read from. A close button per tab
 * removes the project from `state.projects` and falls back to the next
 * remaining one (or leaves the workspace empty).
 *
 * Project state is held in AppState; no IndexedDB / filesystem writes
 * happen here. The "+" button creates a fresh untitled project so the
 * shell is usable straight out of the box.
 */
export default function MultiDocumentBar() {
  const { state, openProject, closeProject, setActiveProject } = useAppState();
  const projects = state.projects || [];

  return (
    <div className="forge-docbar" role="tablist" aria-label="Open documents">
      {projects.length === 0 && (
        <div style={{ padding: '6px 10px', color: 'var(--muted)', fontSize: 12 }}>
          No documents open
        </div>
      )}
      {projects.map((p) => (
        <div
          key={p._uid}
          className={`forge-doc-tab${p._uid === state.activeProjectId ? ' active' : ''}`}
          role="tab"
          aria-selected={p._uid === state.activeProjectId}
        >
          <button
            type="button"
            className="title"
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}
            onClick={() => setActiveProject(p._uid)}
          >
            {p.name || 'Untitled'}
          </button>
          <button
            type="button"
            className="close"
            aria-label={`Close ${p.name || 'Untitled'}`}
            onClick={() => closeProject(p._uid)}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="forge-doc-new"
        onClick={() => openProject({ name: `Untitled ${projects.length + 1}` })}
      >
        + New
      </button>
    </div>
  );
}
