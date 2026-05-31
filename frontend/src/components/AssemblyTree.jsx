import { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Box, Layers } from 'lucide-react';
import './AssemblyTree.css';

/**
 * Assembly Tree — hierarchical view of all parts in the assembly.
 * Groups identical parts (same solid) into "instance groups" with counts.
 * Supports: expand/collapse, visibility toggle, search, right-click context menu.
 */
export default function AssemblyTree({ assembly, onPartClick, onPartVisibility, onPartDelete }) {
  const [expanded, setExpanded] = useState(new Set(['root']));
  const [search, setSearch] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [tick, setTick] = useState(0);

  // Re-render when assembly changes
  useEffect(() => {
    if (!assembly) return;
    const unsub = assembly.onChange?.(() => setTick(t => t + 1));
    return unsub;
  }, [assembly]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [contextMenu]);

  // Group parts by solid identity (instance grouping)
  const grouped = useMemo(() => {
    if (!assembly?.parts) return [];
    const groups = new Map(); // solidName → { name, parts, color, mass }
    for (const part of assembly.parts) {
      if (!part.solid) continue;
      const key = part.solid.name || `Solid_${part.solid.id}`;
      if (!groups.has(key)) {
        groups.set(key, {
          name: key,
          solidId: part.solid.id,
          parts: [],
          color: part.color,
          material: part.material,
        });
      }
      groups.get(key).parts.push(part);
    }
    return [...groups.values()];
  }, [assembly, tick]);

  const filtered = search
    ? grouped.filter(g => g.name.toLowerCase().includes(search.toLowerCase()))
    : grouped;

  const totalParts = assembly?.parts?.length || 0;
  const visibleParts = assembly?.parts?.filter(p => p.visible !== false).length || 0;

  const toggleExpand = useCallback((key) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleVisibility = useCallback((part, e) => {
    e?.stopPropagation();
    if (part) {
      part.visible = !(part.visible !== false);
      onPartVisibility?.(part);
    }
    setTick(t => t + 1);
  }, [onPartVisibility]);

  const handleGroupVisibility = useCallback((group, e) => {
    e?.stopPropagation();
    const allVisible = group.parts.every(p => p.visible !== false);
    group.parts.forEach(p => { p.visible = !allVisible; });
    setTick(t => t + 1);
  }, []);

  const handleClick = useCallback((part) => {
    onPartClick?.(part);
  }, [onPartClick]);

  if (!assembly) {
    return (
      <div className="assembly-tree">
        <div className="at-header">
          <span className="at-title">Assembly</span>
        </div>
        <div className="at-empty">No assembly loaded</div>
      </div>
    );
  }

  return (
    <div className="assembly-tree">
      <div className="at-header">
        <span className="at-title">Assembly</span>
        <span className="at-stats">{visibleParts}/{totalParts}</span>
      </div>

      {/* Search */}
      {totalParts > 5 && (
        <div className="at-search-row">
          <input
            type="text"
            placeholder="Filter parts..."
            className="at-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {/* Tree */}
      <div className="at-list">
        {filtered.length === 0 && (
          <div className="at-empty">{search ? 'No matches' : 'Empty assembly'}</div>
        )}

        {filtered.map(group => {
          const isExpanded = expanded.has(group.name);
          const allVisible = group.parts.every(p => p.visible !== false);
          const someVisible = group.parts.some(p => p.visible !== false);

          return (
            <div key={group.name} className="at-group">
              <div className="at-group-row" onClick={() => toggleExpand(group.name)}>
                {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                <Box size={11} className="at-group-icon" />
                <span className="at-group-name">{group.name}</span>
                <span className="at-group-count">×{group.parts.length}</span>
                <button
                  className="at-vis-btn"
                  onClick={(e) => handleGroupVisibility(group, e)}
                  title={allVisible ? 'Hide all' : 'Show all'}
                >
                  {allVisible ? <Eye size={11} /> : someVisible ? <Eye size={11} style={{opacity:0.5}} /> : <EyeOff size={11} />}
                </button>
              </div>

              {isExpanded && (
                <div className="at-group-body">
                  {group.parts.map(part => (
                    <div
                      key={part.id}
                      className={`at-part-row ${part.visible === false ? 'hidden' : ''}`}
                      onClick={() => handleClick(part)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu({ x: e.clientX, y: e.clientY, part });
                      }}
                    >
                      <span className="at-part-dot" style={{ background: `#${(part.color || 0x4a90d9).toString(16).padStart(6,'0')}` }} />
                      <span className="at-part-name">{part.name}</span>
                      <button
                        className="at-vis-btn"
                        onClick={(e) => handleVisibility(part, e)}
                        title={part.visible === false ? 'Show' : 'Hide'}
                      >
                        {part.visible === false ? <EyeOff size={10} /> : <Eye size={10} />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Stats footer */}
      {totalParts > 0 && (
        <div className="at-footer">
          <span>{grouped.length} unique × {totalParts} total</span>
          {assembly.totalMass && <span>{(assembly.totalMass() * 1000).toFixed(2)}g</span>}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="at-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { handleVisibility(contextMenu.part); setContextMenu(null); }}>
            {contextMenu.part.visible === false ? 'Show' : 'Hide'}
          </button>
          <button onClick={() => { handleClick(contextMenu.part); setContextMenu(null); }}>
            Select
          </button>
          <div className="at-ctx-divider"></div>
          <button className="at-ctx-delete" onClick={() => {
            onPartDelete?.(contextMenu.part);
            setContextMenu(null);
          }}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
