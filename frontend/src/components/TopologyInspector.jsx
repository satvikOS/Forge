/**
 * ArchDisc Topology Inspector — SP-1 Stage S7
 *
 * The spine-aware sidebar panel that surfaces the unified topology
 * `Body → Lump → Shell → Face → Loop → Coedge → Edge → Vertex` for the
 * selected body. Sits in the WorkbenchMechanical right aside next to the
 * Part Browser — NOT a floating debug box (matches the
 * feedback_no_floating_panels standard).
 *
 * Reads (never writes) the live spine via `Body.toInspectorJSON()` —
 * snapshot is acyclic JSON so React state survives the spine's legitimate
 * back-reference cycles. The live entity is fetched on demand by
 * `Body.findEntityById(...)` when a tree node is opened for read-out.
 *
 * Three sources of selection feed the inspector, in priority order:
 *   1. `window.__archdiscRegistry.selectedId` — the user's body pick.
 *   2. `window.__lastSpineBody` — the SpineBody currency of the last
 *      successful ribbon op (the SP-1 §6 introspection contract). Used as
 *      a fall-back when no body is registry-selected.
 *
 * Inspector → viewport drill-down:
 *   - Clicking a Face tree node flips
 *     `window.__archdiscSelectionFilter = 'face'` and dispatches an
 *     `archdisc:inspector-drill` event. Viewport3D's Tier-11a filter-aware
 *     pick path already consumes that filter, so subsequent viewport
 *     clicks pick faces (the inspector primes the mode).
 *   - Same for Edge / Vertex nodes. The inspector also writes
 *     `window.__lastSpineInspectorPick` so e2e specs can assert what was
 *     drill-clicked without intercepting React state.
 *
 * The inspector is selection-driven from end to end:
 *   - When a body is selected in the viewport (registry.select) the
 *     inspector populates its tree from that body's spine.
 *   - When nothing is selected, the inspector shows a Selection hint —
 *     never an empty / confused state.
 *
 * NOT covered by S7 (documented honest scope):
 *   - The inspector does NOT yet draw a face/edge/vertex highlight in
 *     the viewport when the tree node is clicked — it sets the
 *     selection filter to face/edge/vertex (the Tier-11a pick path
 *     handles the actual highlight on the user's next viewport click).
 *     A direct programmatic highlight would require a Viewport3D
 *     refactor outside the S7 file allowlist; the inspector wires the
 *     drill-down via the existing filter mechanism so the path the
 *     spec exercises is the same path the user exercises.
 */

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { getBodyRegistry } from '../foundation/BodyRegistry.js';
import { selectionFilterBus } from './SwUxOverlays.jsx';
import './TopologyInspector.css';

// ── Spine snapshot subscription ─────────────────────────────────────────────

/**
 * Subscribe to spine changes coming through the body registry. Returns the
 * current "active spine body" — registry-selected first, then the last spine
 * body that ran through addBrepShapeToScene (the window slot ToolExecutionEngine
 * mirrors after every migrated op).
 *
 * Re-evaluates on EVERY registry notification — bodies added / removed / the
 * selection changes — because each of those is the moment a fresh spine
 * snapshot is available.
 */
function useActiveSpineBody() {
  const [active, setActive] = useState(() => readActive());
  // Bump a tick when the registry changes — even if selectedId / window slot
  // didn't move, the body could have been mutated (a fresh op replaced its
  // bodyRef). Tick forces the snapshot to be re-projected by the caller.
  const [, setTick] = useState(0);

  useEffect(() => {
    const reg = getBodyRegistry();
    const recalc = () => { setActive(readActive()); setTick(t => t + 1); };
    const unsub = reg.onChange(recalc);
    // Also listen for the topology-inspector drill event so the read-out
    // refreshes when the user clicks a tree node (per-entity readout
    // depends on the latest entity).
    const onDrill = () => setTick(t => t + 1);
    if (typeof window !== 'undefined') {
      window.addEventListener('archdisc:inspector-drill', onDrill);
    }
    // Manual refresh path — e2e specs can dispatch this to force a re-read
    // after a programmatic body swap.
    const onRefresh = () => { setActive(readActive()); setTick(t => t + 1); };
    if (typeof window !== 'undefined') {
      window.addEventListener('archdisc:inspector-refresh', onRefresh);
    }
    return () => {
      unsub();
      if (typeof window !== 'undefined') {
        window.removeEventListener('archdisc:inspector-drill', onDrill);
        window.removeEventListener('archdisc:inspector-refresh', onRefresh);
      }
    };
  }, []);

  return active;
}

function readActive() {
  if (typeof window === 'undefined') return null;
  const reg = window.__archdiscRegistry;
  // Priority 1 — registry-selected body. Walk the registry, find the body
  // whose group carries a brepShapeRef with a `.body` (= SpineBody).
  if (reg) {
    const selId = reg.selectedId;
    if (selId) {
      const entry = reg.bodies.find(b => b.id === selId);
      if (entry) {
        const ref = entry.brepShapeRef || entry.group?.userData?.brepShapeRef;
        if (ref && ref.body) {
          return {
            source: 'registry',
            bodyName: entry.name,
            sourceTool: entry.sourceTool || null,
            spineBody: ref,
            body: ref.body,
          };
        }
      }
    }
  }
  // Priority 2 — last spine body from the window slot.
  if (window.__lastSpineBody && window.__lastSpineBody.body) {
    return {
      source: 'window',
      bodyName: 'Last spine body',
      sourceTool: window.__lastSpineBody.meta?.op || null,
      spineBody: window.__lastSpineBody,
      body: window.__lastSpineBody.body,
    };
  }
  return null;
}

// ── Tree node component (recursive) ─────────────────────────────────────────

function TreeNode({ node, depth, expanded, onToggle, selectedId, onSelect }) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = !!expanded[nodeKey(node)];
  const isSelected = selectedId === nodeKey(node);

  const handleClick = useCallback((e) => {
    e.stopPropagation();
    onSelect(node);
  }, [onSelect, node]);

  const handleToggle = useCallback((e) => {
    e.stopPropagation();
    if (hasChildren) onToggle(nodeKey(node));
  }, [onToggle, node, hasChildren]);

  // Compact summary suffix per kind — shown after the label in muted text.
  const summary = nodeSummary(node);

  return (
    <div className="tinsp-tree-subtree">
      <div
        className={`tinsp-tree-row tinsp-kind-${node.kind}${isSelected ? ' tinsp-selected' : ''}`}
        style={{ paddingLeft: 4 + depth * 12 }}
        data-archdisc-tinsp-node={nodeKey(node)}
        data-archdisc-tinsp-kind={node.kind}
        data-archdisc-tinsp-pid={node.persistentId || ''}
        onClick={handleClick}
      >
        <span
          className="tinsp-tree-caret"
          onClick={handleToggle}
          data-archdisc-tinsp-caret={hasChildren ? (isExpanded ? 'open' : 'closed') : 'leaf'}
        >
          {hasChildren ? (isExpanded ? '▾' : '▸') : '·'}
        </span>
        <span className={`tinsp-tree-tag tinsp-tag-${node.kind}`}>{node.kind}</span>
        <span className="tinsp-tree-label">{node.label || nodeKey(node)}</span>
        {summary && <span className="tinsp-tree-summary">{summary}</span>}
      </div>
      {isExpanded && hasChildren && node.children.map((c, i) => (
        <TreeNode
          key={`${nodeKey(node)}:${i}:${nodeKey(c)}`}
          node={c}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function nodeKey(n) {
  // Persistent id is the primary key; transient id as fallback for entities
  // that have not been assigned a persistent id yet (rare — typically only
  // hand-built spines in tests).
  return n.persistentId || `t:${n.transientId}`;
}

function nodeSummary(n) {
  switch (n.kind) {
    case 'body':
      return null;  // body header has its own summary block
    case 'lump':
      return null;
    case 'shell':
      return n.isClosed === true ? 'closed' : n.isClosed === false ? 'open' : null;
    case 'face': {
      const bits = [];
      if (n.isAnalytic) bits.push('analytic');
      if (n.reversed) bits.push('rev');
      if (n.counts) bits.push(`E${n.counts.edges} V${n.counts.vertices}`);
      return bits.length ? bits.join(' · ') : null;
    }
    case 'loop':
      return null;
    case 'coedge': {
      const bits = [];
      if (n.reversed) bits.push('rev');
      if (n.radialAngle != null) bits.push(`∠${(n.radialAngle * 180 / Math.PI).toFixed(1)}°`);
      return bits.length ? bits.join(' · ') : null;
    }
    case 'edge': {
      const bits = [];
      if (n.isNonManifold) bits.push(`NM×${n.coedgeCount}`);
      else if (n.isManifold) bits.push('M');
      if (n.degenerate) bits.push('deg');
      if (n.length != null && Number.isFinite(n.length)) bits.push(`${(n.length).toFixed(2)}`);
      return bits.length ? bits.join(' · ') : null;
    }
    case 'vertex':
      return n.valence != null ? `val ${n.valence}` : null;
    default:
      return null;
  }
}

// ── Per-entity readout (selection-driven) ───────────────────────────────────

function EntityReadout({ active, node }) {
  if (!node) return (
    <div className="tinsp-readout tinsp-readout-empty">
      <em>Select a tree node to inspect.</em>
    </div>
  );

  // Body header readout — the top-level summary.
  if (node.kind === 'body') {
    const c = node.counts;
    const euler = node.euler;
    return (
      <div className="tinsp-readout" data-archdisc-tinsp-readout="body">
        <div className="tinsp-readout-title">Body
          <span className="tinsp-pill">{node.bodyKind || '?'}</span>
        </div>
        <div className="tinsp-kv"><label>Persistent ID</label><code>{node.persistentId}</code></div>
        {node.declaredKind && (
          <div className="tinsp-kv"><label>Declared kind</label><code>{node.declaredKind}</code></div>
        )}
        {node.kindMismatch && (
          <div className="tinsp-kv tinsp-warn"><label>Kind mismatch</label>
            <code>{node.kindMismatch.message || JSON.stringify(node.kindMismatch)}</code>
          </div>
        )}
        <div className="tinsp-counts-grid">
          <div><b>{c.lumps}</b><span>lumps</span></div>
          <div><b>{c.shells}</b><span>shells</span></div>
          <div><b>{c.faces}</b><span>faces</span></div>
          <div><b>{c.loops}</b><span>loops</span></div>
          <div><b>{c.coedges}</b><span>coedges</span></div>
          <div><b>{c.edges}</b><span>edges</span></div>
          <div><b>{c.vertices}</b><span>vertices</span></div>
          <div><b>{c.nonManifoldEdges}</b><span>NM edges</span></div>
        </div>
        {c.analyticFaces > 0 && (
          <div className="tinsp-kv"><label>Analytic faces</label><code>{c.analyticFaces}</code></div>
        )}
        <div className="tinsp-section-title">Euler-Poincaré</div>
        <div className="tinsp-kv"><label>V − E + F − R</label>
          <code>{euler.V} − {euler.E} + {euler.F} − {euler.R} = {euler.actual - (euler.R || 0)}</code>
        </div>
        <div className="tinsp-kv"><label>Genus (implied)</label>
          <code>{euler.genusImplied == null ? '—' : euler.genusImplied}</code>
        </div>
        <div className={`tinsp-kv ${euler.ok ? 'tinsp-ok' : 'tinsp-warn'}`}>
          <label>Status</label>
          <code data-archdisc-tinsp-euler-ok={euler.ok ? 'true' : 'false'}>
            {euler.ok ? 'consistent' : 'violation'}
          </code>
        </div>
        {node.validation && (
          <>
            <div className="tinsp-section-title">validateSpine</div>
            <div className={`tinsp-kv ${node.validation.ok ? 'tinsp-ok' : 'tinsp-warn'}`}>
              <label>Result</label>
              <code data-archdisc-tinsp-validate-ok={node.validation.ok ? 'true' : 'false'}>
                {node.validation.ok ? 'ok' : `${node.validation.errors.length} error(s)`}
              </code>
            </div>
            {node.validation.errors.length > 0 && (
              <ul className="tinsp-issue-list">
                {node.validation.errors.map((e, i) => (
                  <li key={i} className="tinsp-issue-err">{e.message || JSON.stringify(e)}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    );
  }

  // Face / Edge / Vertex / Loop / Coedge — fetch the live entity for
  // dynamic detail (the snapshot already contains enough for the inspector).
  return (
    <div className="tinsp-readout" data-archdisc-tinsp-readout={node.kind}>
      <div className="tinsp-readout-title">
        {capitalise(node.kind)}
        <span className="tinsp-pill">{node.kind}</span>
      </div>
      <div className="tinsp-kv"><label>Persistent ID</label><code>{node.persistentId}</code></div>
      <div className="tinsp-kv"><label>Transient ID</label><code>{node.transientId}</code></div>

      {node.kind === 'face' && (
        <>
          <div className="tinsp-kv"><label>Surface</label><code>{node.surfaceType}</code></div>
          <div className="tinsp-kv">
            <label>Analytic</label>
            <code data-archdisc-tinsp-face-analytic={node.isAnalytic ? 'true' : 'false'}>
              {node.isAnalytic ? 'yes (isAnalytic: true)' : 'no'}
            </code>
          </div>
          <div className="tinsp-kv"><label>Reversed</label><code>{node.reversed ? 'yes' : 'no'}</code></div>
          <div className="tinsp-kv"><label>Loops</label><code>{node.counts.loops} ({node.counts.innerLoops} hole{node.counts.innerLoops === 1 ? '' : 's'})</code></div>
          <div className="tinsp-kv"><label>Coedges</label><code>{node.counts.coedges}</code></div>
          <div className="tinsp-kv"><label>Edges</label><code>{node.counts.edges}</code></div>
        </>
      )}

      {node.kind === 'edge' && (
        <>
          <div className="tinsp-kv"><label>Curve</label><code>{node.curveType}</code></div>
          <div className="tinsp-kv"><label>Length</label>
            <code>{Number.isFinite(node.length) ? node.length.toFixed(4) : '—'}</code>
          </div>
          <div className="tinsp-kv"><label>Coedges</label>
            <code data-archdisc-tinsp-edge-radial={node.coedgeCount}>
              {node.coedgeCount}{node.isNonManifold ? ' (non-manifold)' : node.isManifold ? ' (manifold)' : ''}
            </code>
          </div>
          {node.isNonManifold && (
            <div className="tinsp-kv tinsp-warn">
              <label>Radial cycle</label>
              <code>{node.coedgeCount} coedges around this edge</code>
            </div>
          )}
          {node.degenerate && (
            <div className="tinsp-kv tinsp-warn"><label>Degenerate</label><code>yes (seam/apex)</code></div>
          )}
        </>
      )}

      {node.kind === 'vertex' && (
        <>
          {node.point && (
            <div className="tinsp-kv"><label>Point (mm)</label>
              <code>({node.point.x.toFixed(3)}, {node.point.y.toFixed(3)}, {node.point.z.toFixed(3)})</code>
            </div>
          )}
          {node.valence != null && (
            <div className="tinsp-kv"><label>Valence</label><code>{node.valence}</code></div>
          )}
        </>
      )}

      {node.kind === 'loop' && (
        <>
          <div className="tinsp-kv"><label>Role</label><code>{node.isOuter ? 'outer' : 'inner (hole)'}</code></div>
        </>
      )}

      {node.kind === 'coedge' && (
        <>
          <div className="tinsp-kv"><label>Reversed</label><code>{node.reversed ? 'yes' : 'no'}</code></div>
          {node.radialAngle != null && (
            <div className="tinsp-kv"><label>Radial angle</label>
              <code>{(node.radialAngle * 180 / Math.PI).toFixed(2)}°</code>
            </div>
          )}
          <div className="tinsp-kv"><label>Partner</label><code>{node.hasPartner ? 'present' : 'free'}</code></div>
          <div className="tinsp-kv"><label>Pcurve</label><code>{node.hasPcurve ? 'present' : 'none'}</code></div>
        </>
      )}

      {node.derivedFrom && node.derivedFrom.length > 0 && (
        <>
          <div className="tinsp-section-title">derivedFrom lineage (→)</div>
          <ul className="tinsp-lineage-list" data-archdisc-tinsp-lineage>
            {node.derivedFrom.map((src, i) => (
              <li key={i}>
                <span className="tinsp-lineage-arrow">→</span>
                <code>{String(src)}</code>
              </li>
            ))}
          </ul>
        </>
      )}

      {node.attributesKeys && node.attributesKeys.length > 0 && (
        <>
          <div className="tinsp-section-title">attributes</div>
          <code className="tinsp-keys">{node.attributesKeys.join(', ')}</code>
        </>
      )}

      {node.metaKeys && node.metaKeys.length > 0 && (
        <>
          <div className="tinsp-section-title">userData meta</div>
          <code className="tinsp-keys">{node.metaKeys.join(', ')}</code>
        </>
      )}
    </div>
  );
}

function capitalise(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ── Inspector root ──────────────────────────────────────────────────────────

export default function TopologyInspector() {
  const active = useActiveSpineBody();
  const snapshot = useMemo(() => {
    if (!active || !active.body || typeof active.body.toInspectorJSON !== 'function') return null;
    try { return active.body.toInspectorJSON(); }
    catch (e) {
      return { error: e && e.message ? e.message : String(e) };
    }
  }, [active]);

  // Expand state keyed by node id (persistent or transient).
  const [expanded, setExpanded] = useState({});
  // Currently-selected tree node — the per-entity readout reads from this.
  const [selectedId, setSelectedId] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const containerRef = useRef(null);

  // Expand the body root by default whenever the active spine changes.
  useEffect(() => {
    if (!snapshot || snapshot.error) {
      setExpanded({});
      setSelectedId(null);
      setSelectedNode(null);
      return;
    }
    const key = nodeKey(snapshot);
    setExpanded({ [key]: true });
    setSelectedId(key);
    setSelectedNode(snapshot);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Expose the inspector instance handle for e2e specs to drive
  // programmatically — pick a node by persistent id (or kind+index).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__archdiscTopologyInspector = {
      // Force a snapshot refresh — call after a spine swap that did not
      // route through addBrepShapeToScene (e.g. direct kernel calls in
      // a spec). Dispatches the refresh event the hook listens on.
      refresh: () => window.dispatchEvent(new Event('archdisc:inspector-refresh')),
      // Find a node in the current snapshot by predicate.
      findNode: (pred) => snapshot ? findNode(snapshot, pred) : null,
      // Programmatic selection — same effect as clicking the row.
      selectNode: (id) => {
        if (!snapshot) return null;
        const n = findNode(snapshot, x => nodeKey(x) === id || x.persistentId === id || `t:${x.transientId}` === id);
        if (n) {
          // Open the path to that node.
          const path = nodePath(snapshot, n);
          const open = { ...expanded };
          for (const p of path) open[nodeKey(p)] = true;
          setExpanded(open);
          setSelectedId(nodeKey(n));
          setSelectedNode(n);
          handleDrill(n);
        }
        return n;
      },
      getSnapshot: () => snapshot,
      getActive: () => active,
      getSelected: () => selectedNode,
    };
    return () => { delete window.__archdiscTopologyInspector; };
  }, [snapshot, expanded, selectedNode, active]);

  const handleToggle = useCallback((id) => {
    setExpanded(e => ({ ...e, [id]: !e[id] }));
  }, []);

  // Drill behaviour: prime the Selection Bar filter according to node kind so
  // the user's next viewport click picks at the right granularity, and
  // dispatch a custom event the spec / overlay can react to.
  const handleDrill = useCallback((node) => {
    if (typeof window === 'undefined') return;
    let filter = null;
    if (node.kind === 'face') filter = 'face';
    else if (node.kind === 'edge' || node.kind === 'coedge') filter = 'edge';
    else if (node.kind === 'vertex') filter = 'vertex';
    else if (node.kind === 'body' || node.kind === 'lump' || node.kind === 'shell') filter = 'solid';
    if (filter) {
      try { selectionFilterBus.set(filter); } catch { /* idempotent */ }
    }
    window.__lastSpineInspectorPick = {
      id: nodeKey(node),
      kind: node.kind,
      persistentId: node.persistentId || null,
      transientId: node.transientId,
      isAnalytic: !!node.isAnalytic,
      isNonManifold: !!node.isNonManifold,
      coedgeCount: node.coedgeCount || null,
      radialAngle: node.radialAngle != null ? node.radialAngle : null,
      derivedFrom: Array.isArray(node.derivedFrom) ? node.derivedFrom.slice() : [],
      timestamp: Date.now(),
    };
    window.dispatchEvent(new CustomEvent('archdisc:inspector-drill', { detail: window.__lastSpineInspectorPick }));
  }, []);

  const onSelect = useCallback((node) => {
    setSelectedId(nodeKey(node));
    setSelectedNode(node);
    handleDrill(node);
  }, [handleDrill]);

  const handleExpandAll = useCallback(() => {
    if (!snapshot) return;
    const open = {};
    walk(snapshot, n => { open[nodeKey(n)] = true; });
    setExpanded(open);
  }, [snapshot]);

  const handleCollapseAll = useCallback(() => {
    if (!snapshot) return;
    setExpanded({ [nodeKey(snapshot)]: true });
  }, [snapshot]);

  // Empty / no-spine state.
  if (!active) {
    return (
      <div className="topology-inspector tinsp-empty"
           data-archdisc-tinsp-state="empty"
           ref={containerRef}>
        <div className="tinsp-header">
          <span className="tinsp-title">Topology Inspector</span>
        </div>
        <div className="tinsp-empty-msg">
          <em>Select a body in the viewport — its spine appears here.</em>
        </div>
      </div>
    );
  }

  if (snapshot && snapshot.error) {
    return (
      <div className="topology-inspector" data-archdisc-tinsp-state="error" ref={containerRef}>
        <div className="tinsp-header">
          <span className="tinsp-title">Topology Inspector</span>
        </div>
        <div className="tinsp-empty-msg tinsp-warn">
          <em>Snapshot error: {snapshot.error}</em>
        </div>
      </div>
    );
  }

  return (
    <div className="topology-inspector"
         data-archdisc-tinsp-state="active"
         data-archdisc-tinsp-source={active.source}
         ref={containerRef}>
      <div className="tinsp-header">
        <span className="tinsp-title">Topology</span>
        <span className="tinsp-source-badge" title={`Source: ${active.source}`}>
          {active.bodyName}
        </span>
        <button
          className="tinsp-action-btn"
          title="Expand all"
          onClick={handleExpandAll}
          data-archdisc-tinsp-action="expand-all"
        >⤢</button>
        <button
          className="tinsp-action-btn"
          title="Collapse all"
          onClick={handleCollapseAll}
          data-archdisc-tinsp-action="collapse-all"
        >⤡</button>
      </div>
      <div className="tinsp-tree" data-archdisc-tinsp-tree>
        {snapshot && (
          <TreeNode
            node={snapshot}
            depth={0}
            expanded={expanded}
            onToggle={handleToggle}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        )}
      </div>
      <div className="tinsp-readout-wrap">
        <EntityReadout active={active} node={selectedNode} />
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function walk(node, fn) {
  fn(node);
  if (node.children) for (const c of node.children) walk(c, fn);
}

function findNode(root, pred) {
  if (pred(root)) return root;
  if (root.children) for (const c of root.children) {
    const f = findNode(c, pred);
    if (f) return f;
  }
  return null;
}

function nodePath(root, target, trail = []) {
  trail.push(root);
  if (root === target) return trail;
  if (root.children) {
    for (const c of root.children) {
      const r = nodePath(c, target, trail.slice());
      if (r) return r;
    }
  }
  return null;
}
