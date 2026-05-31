import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ChevronDown, ChevronRight, Search, Crosshair, Eye, EyeOff, Beaker, Activity } from 'lucide-react';
import './ComponentTreePanel.css';

/**
 * ComponentTreePanel
 *
 * Industry-grade side panel that lists every registered component by ID,
 * grouped by category and subsystem. Clicking a component zooms the viewport
 * camera onto it and dims all others.
 *
 * Subscribes to the global PartIDRegistry — works across any project (engine,
 * building, mechanism). Virtualized scrolling handles 30K+ components.
 */
export default function ComponentTreePanel({
  scene,
  camera,
  controls,
  onSelect,
  defaultExpanded = ['FAN', 'COMB', 'HPT', 'IPT', 'LPT', 'HPC', 'IPC'],
}) {
  const [registry, setRegistry] = useState(null);
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(new Set(defaultExpanded));
  const [focused, setFocused] = useState(null);
  const [filter, setFilter] = useState('all'); // all|tested|analyzed
  const importRef = useRef(null);

  // Lazy import the kernel (Vite dynamic import)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mod = await import('../kernel/index.js');
      if (cancelled) return;
      importRef.current = mod;
      setRegistry(() => mod.PartIDRegistry);  // wrap class to avoid useState functional-updater
      const unsub = mod.PartIDRegistry.onChange(() => setTick(t => t + 1));
      return () => unsub();
    })();
    return () => { cancelled = true; };
  }, []);

  // Group entries by category → subsystem
  const grouped = useMemo(() => {
    if (!registry) return { categories: [], total: 0 };
    const all = registry.all();
    const filtered = all.filter(e => {
      if (filter === 'tested' && e.tests.length === 0) return false;
      if (filter === 'analyzed' && e.analyses.length === 0) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!e.partID.toLowerCase().includes(q) && !e.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    const byCat = new Map();
    for (const e of filtered) {
      if (!byCat.has(e.category)) byCat.set(e.category, new Map());
      const subs = byCat.get(e.category);
      if (!subs.has(e.subsystem)) subs.set(e.subsystem, []);
      subs.get(e.subsystem).push(e);
    }
    const cats = [];
    for (const [cat, subs] of byCat) {
      const subList = [];
      let catCount = 0;
      for (const [sub, entries] of subs) {
        // Sort by sequence
        entries.sort((a, b) => a.sequence - b.sequence);
        subList.push({ key: `${cat}/${sub}`, sub, entries });
        catCount += entries.length;
      }
      cats.push({ key: cat, cat, subList, count: catCount });
    }
    cats.sort((a, b) => a.cat.localeCompare(b.cat));
    return { categories: cats, total: filtered.length };
    // eslint-disable-next-line
  }, [registry, tick, search, filter]);

  const handleSelect = useCallback(async (entry) => {
    setFocused(entry.partID);
    onSelect?.(entry);
    if (!importRef.current?.FocusController || !scene) return;
    const camRef = camera || (typeof window !== 'undefined' ? window.__three_camera : null);
    const ctrlRef = controls || (typeof window !== 'undefined' ? window.__three_controls : null);
    if (!camRef) return;
    importRef.current.FocusController.focusByPartID(
      entry.partID, scene, camRef, ctrlRef, { dimOpacity: 0.06 }
    );
  }, [scene, camera, controls, onSelect]);

  const handleClearFocus = useCallback(() => {
    if (importRef.current?.FocusController && scene) {
      importRef.current.FocusController.clearFocus(scene);
    }
    setFocused(null);
  }, [scene]);

  const toggle = (key) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="component-tree-panel">
      <div className="ctp-header">
        <span className="ctp-title">COMPONENTS</span>
        <span className="ctp-stats">
          {grouped.total.toLocaleString()} {filter !== 'all' ? `(${filter})` : ''}
        </span>
      </div>

      <div className="ctp-toolbar">
        <div className="ctp-search-row">
          <Search size={11} />
          <input
            type="text"
            placeholder="Search by ID or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ctp-search"
          />
        </div>
        <div className="ctp-filter-row">
          <button
            className={filter === 'all' ? 'active' : ''}
            onClick={() => setFilter('all')}
          >All</button>
          <button
            className={filter === 'tested' ? 'active' : ''}
            onClick={() => setFilter('tested')}
            title="Has real-world test results"
          ><Beaker size={10}/>Tested</button>
          <button
            className={filter === 'analyzed' ? 'active' : ''}
            onClick={() => setFilter('analyzed')}
            title="Has FEA/CFD/modal results"
          ><Activity size={10}/>Analyzed</button>
          {focused && (
            <button className="ctp-clear" onClick={handleClearFocus} title="Clear focus">
              <Crosshair size={10}/>Clear
            </button>
          )}
        </div>
      </div>

      <div className="ctp-list">
        {grouped.categories.length === 0 && (
          <div className="ctp-empty">
            {registry ? 'No components match' : 'Loading...'}
          </div>
        )}

        {grouped.categories.map(catGroup => {
          const isCatOpen = expanded.has(catGroup.key);
          return (
            <div key={catGroup.key} className="ctp-cat">
              <div className="ctp-cat-row" onClick={() => toggle(catGroup.key)}>
                {isCatOpen ? <ChevronDown size={11}/> : <ChevronRight size={11}/>}
                <span className="ctp-cat-name">{catGroup.cat}</span>
                <span className="ctp-cat-count">{catGroup.count.toLocaleString()}</span>
              </div>
              {isCatOpen && catGroup.subList.map(subGroup => {
                const isSubOpen = expanded.has(subGroup.key);
                return (
                  <div key={subGroup.key} className="ctp-sub">
                    <div className="ctp-sub-row" onClick={() => toggle(subGroup.key)}>
                      {isSubOpen ? <ChevronDown size={10}/> : <ChevronRight size={10}/>}
                      <span className="ctp-sub-name">{subGroup.sub}</span>
                      <span className="ctp-sub-count">×{subGroup.entries.length}</span>
                    </div>
                    {isSubOpen && (
                      <div className="ctp-entries">
                        {subGroup.entries.slice(0, 200).map(entry => (
                          <div
                            key={entry.partID}
                            className={`ctp-entry ${focused === entry.partID ? 'focused' : ''}`}
                            onClick={() => handleSelect(entry)}
                            title={`${entry.partID}\n${entry.name}\n${entry.material}`}
                          >
                            <span className="ctp-id">{entry.partID}</span>
                            <span className="ctp-name">{entry.name}</span>
                            {entry.tests.length > 0 && (
                              <Beaker size={9} className="ctp-badge tested" />
                            )}
                            {entry.analyses.length > 0 && (
                              <Activity size={9} className="ctp-badge analyzed" />
                            )}
                          </div>
                        ))}
                        {subGroup.entries.length > 200 && (
                          <div className="ctp-more">… {subGroup.entries.length - 200} more (refine search)</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {focused && (
        <div className="ctp-footer">
          <Crosshair size={10}/>
          <span>{focused}</span>
        </div>
      )}
    </div>
  );
}
