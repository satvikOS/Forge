// Forge-184 — Drag-drop file import from the OS file manager.
//
// Attaches a transparent overlay over the entire viewport that activates
// on drag-enter and dispatches the file through the appropriate kernel
// import path (STEP / IGES / STL / BREP / GLTF / GLB). Electron preload
// supports `File.path`, so dropped paths flow straight into
// `forge.io.import*` without an IPC round-trip.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const overlayStyle = {
  position: 'fixed', inset: 0,
  background: 'rgba(217, 122, 59, 0.18)',
  border: '4px dashed var(--forge-accent)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 24, fontFamily: 'var(--forge-mono)',
  color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.6)',
  zIndex: 5000, pointerEvents: 'none',
};

const errorStyle = {
  position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
  background: 'var(--forge-bad, #ff6363)', color: '#fff',
  padding: '8px 12px', borderRadius: 4,
  fontSize: 12, fontFamily: 'var(--forge-mono)',
  zIndex: 5001,
};

const okStyle = {
  position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
  background: 'var(--forge-ok, #4ec18b)', color: '#0a0e14',
  padding: '8px 12px', borderRadius: 4,
  fontSize: 12, fontFamily: 'var(--forge-mono)',
  zIndex: 5001, fontWeight: 600,
};

const SUPPORTED_EXTENSIONS = [
  '.step', '.stp',
  '.iges', '.igs',
  '.stl',
  '.brep', '.brp',
  '.gltf', '.glb',
];

function extOf(name) {
  if (typeof name !== 'string') return '';
  const idx = name.lastIndexOf('.');
  if (idx < 0) return '';
  return name.slice(idx).toLowerCase();
}

async function importFile(filepath, ext) {
  const f = (typeof window !== 'undefined') ? window.forge : null;
  if (!f || !f.io) throw new Error('forge.io not available');
  if (ext === '.step' || ext === '.stp') return f.io.importStep(filepath);
  if (ext === '.iges' || ext === '.igs') return f.io.importIges(filepath);
  if (ext === '.stl')                    return f.io.importStl(filepath);
  if (ext === '.brep' || ext === '.brp') return f.io.importBrep(filepath);
  if (ext === '.gltf' || ext === '.glb') {
    // glTF import is not yet a kernel surface — surface the real
    // limitation rather than swallowing it.
    throw new Error('glTF import via drag-drop is queued for a follow-up slice');
  }
  throw new Error(`unsupported extension '${ext}'`);
}

export function DragDropImportHost() {
  const [dragging, setDragging] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const [counter, setCounter] = React.useState(0);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let dragDepth = 0;

    const onDragEnter = (e) => {
      e.preventDefault();
      dragDepth += 1;
      setDragging(true);
    };
    const onDragLeave = (e) => {
      e.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDragging(false);
    };
    const onDragOver = (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = async (e) => {
      e.preventDefault();
      dragDepth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files || []);
      if (!files.length) return;
      let succ = 0, fail = 0;
      for (const file of files) {
        const ext = extOf(file.name);
        if (!SUPPORTED_EXTENSIONS.includes(ext)) {
          setToast({ kind: 'err', text: `${file.name}: unsupported (${ext || 'no ext'})` });
          fail += 1; continue;
        }
        // Electron sets File.path to the OS path; some platforms also
        // expose it under file.webkitRelativePath as a fallback.
        const filepath = file.path || file.webkitRelativePath;
        if (!filepath) {
          setToast({ kind: 'err', text: `${file.name}: no path available (drop into Electron, not a browser)` });
          fail += 1; continue;
        }
        try {
          const handle = await importFile(filepath, ext);
          if (typeof handle !== 'number') throw new Error('import returned non-handle');
          if (typeof window.__forgeAppendBody === 'function') {
            window.__forgeAppendBody({
              id: `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              kind: 'native',
              handle,
              name: file.name,
              label: file.name,
              toolId: 'io.dragDrop',
            });
          }
          succ += 1;
        } catch (err) {
          setToast({ kind: 'err', text: `${file.name}: ${err.message}` });
          fail += 1;
        }
      }
      if (succ > 0 && fail === 0) {
        setToast({ kind: 'ok', text: `Imported ${succ} file${succ === 1 ? '' : 's'}` });
      }
      setCounter((n) => n + 1);
      // Auto-dismiss the toast after 3 s.
      setTimeout(() => setToast(null), 3000);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover',  onDragOver);
    window.addEventListener('drop',      onDrop);

    // Expose for e2e — programmatically drive the drop pipeline without
    // needing real OS file dragging.
    window.__forgeDragDropImport = async (paths) => {
      const arr = Array.isArray(paths) ? paths : [paths];
      let succ = 0;
      for (const p of arr) {
        const ext = extOf(p);
        try {
          const handle = await importFile(p, ext);
          if (typeof handle === 'number' && typeof window.__forgeAppendBody === 'function') {
            window.__forgeAppendBody({
              id: `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              kind: 'native', handle, name: p, label: p, toolId: 'io.dragDrop',
            });
            succ += 1;
          }
        } catch (e) {
          setToast({ kind: 'err', text: `${p}: ${e.message}` });
          setTimeout(() => setToast(null), 3000);
        }
      }
      if (succ > 0) {
        setToast({ kind: 'ok', text: `Imported ${succ} file${succ === 1 ? '' : 's'}` });
        setTimeout(() => setToast(null), 3000);
      }
      setCounter((n) => n + 1);
      return succ;
    };

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover',  onDragOver);
      window.removeEventListener('drop',      onDrop);
      try { delete window.__forgeDragDropImport; } catch { /* noop */ }
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      {dragging && (
        <div style={overlayStyle} data-testid="forge-dragdrop-overlay">
          Drop STEP / IGES / STL / BREP files to import
        </div>
      )}
      {toast && (
        <div style={toast.kind === 'err' ? errorStyle : okStyle}
             data-testid={`forge-dragdrop-toast-${toast.kind}`}>
          {toast.text}
        </div>
      )}
      {/* invisible counter to keep React happy that we observe the rev */}
      <span style={{ display: 'none' }} data-testid="forge-dragdrop-counter">{counter}</span>
    </>,
    document.body,
  );
}

export default DragDropImportHost;
