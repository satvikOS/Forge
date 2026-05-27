import { useEffect, useState, useMemo } from 'react';
import { STANDARDS_CATALOG } from '../kernel/atomic/standards/index.js';
import './StandardsLibraryDialog.css';

/**
 * StandardsLibraryDialog — modal browser for the SP-1 Standards Library.
 *
 * Two modes:
 *   single   — place ONE instance of the selected standard at the chosen
 *              position. Records the full atomic-CAD feature sequence on
 *              a new Part.
 *   pattern  — place N copies of the selected standard in a linear or
 *              circular pattern. Each instance is its own Part with its
 *              own atomic-CAD feature history, so the BOM lists N rows
 *              and the FeatureTreePanel shows replayable history per
 *              instance.
 *
 * Listens for `archdisc:standards-library:open` events (fired by the
 * Standards Library / Pattern Standards ribbon clicks). On submit, fires
 * `archdisc:standards-library:place` with the placement spec, which
 * ToolExecutionEngine handles.
 *
 * No randomness. No hardcoded demo inputs. Sizes / counts / radii come
 * from the user's catalog selection + numeric input.
 */
export default function StandardsLibraryDialog() {
  const [state, setState] = useState({
    open: false,
    mode: 'single',                 // 'single' | 'pattern'
    category: 'Fasteners',
    leafName: 'Socket Head Cap Screw (ISO 4762)',
    size: 'M6',
    length: 25,
    grade: '12.9',
    positionX: 0,
    positionY: 0,
    positionZ: 0,
    rotationX: 0,                   // deg, world X
    rotationY: 0,                   // deg, world Y
    rotationZ: 0,                   // deg, world Z (applied BEFORE translate)
    orientRadial: false,            // circular-pattern only: rotate each
                                    // instance around Z so +X points outward
    pattern: 'circular',            // 'circular' | 'linear'
    count: 8,
    radius: 100,                    // mm — circular pattern radius
    startAngle: 0,                  // deg
    sweep: 360,                     // deg
    dx: 50,                         // mm — linear pattern step X
    dy: 0,                          // mm — linear pattern step Y
    axisZOffset: 0,                 // mm — Z-offset for the placed pattern plane
  });

  // Listen for ribbon-driven open events.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (ev) => {
      const mode = ev?.detail?.mode === 'pattern' ? 'pattern' : 'single';
      setState((s) => ({ ...s, open: true, mode }));
    };
    window.addEventListener('archdisc:standards-library:open', handler);
    window.__archdiscStandardsLibrary = {
      open(mode = 'single') { handler({ detail: { mode } }); },
      isOpen() { return state.open; },
    };
    return () => {
      window.removeEventListener('archdisc:standards-library:open', handler);
      delete window.__archdiscStandardsLibrary;
    };
  }, [state.open]);

  // Resolve the catalog entry for the current selection.
  const leaf = useMemo(() => {
    const cat = STANDARDS_CATALOG[state.category];
    return cat ? cat[state.leafName] : null;
  }, [state.category, state.leafName]);

  // When category changes, reset leafName to first leaf in the category.
  useEffect(() => {
    const cat = STANDARDS_CATALOG[state.category];
    if (!cat) return;
    const firstLeaf = Object.keys(cat)[0];
    if (!cat[state.leafName]) {
      setState((s) => ({ ...s, leafName: firstLeaf }));
    }
  }, [state.category, state.leafName]);

  // When leaf changes, reset size + length to leaf defaults.
  useEffect(() => {
    if (!leaf) return;
    const firstSize = leaf.sizes[0];
    setState((s) => {
      if (s.size && leaf.table[s.size]) return s;
      return {
        ...s,
        size: firstSize,
        length: leaf.defaultLength_mm || leaf.defaultLength_in || 25,
        grade: leaf.defaultGrade || s.grade,
      };
    });
  }, [leaf]);

  const close = () => setState((s) => ({ ...s, open: false }));

  const place = () => {
    if (!leaf) { close(); return; }
    const spec = {
      builderKey: leaf.builderKey,
      standard: leaf.standard,
      units: leaf.units,
      category: state.category,
      leafName: state.leafName,
      size: state.size,
      grade: state.grade,
      length_mm: leaf.units === 'mm' ? state.length : null,
      length_in: leaf.units === 'in' ? state.length : null,
      sizeKey: state.size,
      designation: state.size,
      position: [state.positionX, state.positionY, state.positionZ + state.axisZOffset],
      rotation: [state.rotationX, state.rotationY, state.rotationZ],
      mode: state.mode,
    };
    if (state.mode === 'pattern') {
      spec.pattern = {
        type: state.pattern,
        count: state.count,
        radius: state.radius,
        startAngle: state.startAngle,
        sweep: state.sweep,
        dx: state.dx,
        dy: state.dy,
        orientRadial: state.orientRadial,
      };
    }
    window.dispatchEvent(new CustomEvent('archdisc:standards-library:place', { detail: spec }));
    close();
  };

  if (!state.open) return null;

  const categories = Object.keys(STANDARDS_CATALOG);
  const leafNames = STANDARDS_CATALOG[state.category]
    ? Object.keys(STANDARDS_CATALOG[state.category])
    : [];
  const sizes = leaf ? leaf.sizes : [];
  const grades = leaf?.grades || [];
  const lengthSeries = leaf?.lengthSeries || [];
  const hasLength = leaf && (leaf.defaultLength_mm != null || leaf.defaultLength_in != null);

  return (
    <div className="standards-library-dialog-backdrop" data-testid="standards-library-dialog">
      <div className="standards-library-dialog">
        <header>
          <h2>Standards Library</h2>
          <span className="mode-pill">{state.mode === 'pattern' ? 'Pattern placement' : 'Single placement'}</span>
          <button className="close-btn" onClick={close} aria-label="Close">×</button>
        </header>

        <div className="body">
          <aside className="category-tree">
            {categories.map((cat) => (
              <div key={cat} className={`cat ${cat === state.category ? 'active' : ''}`}>
                <button onClick={() => setState((s) => ({ ...s, category: cat }))}>{cat}</button>
                {cat === state.category && (
                  <ul>
                    {Object.keys(STANDARDS_CATALOG[cat]).map((leafKey) => (
                      <li key={leafKey} className={leafKey === state.leafName ? 'active' : ''}>
                        <button onClick={() => setState((s) => ({ ...s, leafName: leafKey }))}>
                          {leafKey}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </aside>

          <section className="picker">
            <div className="row">
              <label>Standard</label>
              <span className="value">{leaf?.standard || '—'}</span>
            </div>

            <div className="row">
              <label htmlFor="sl-size">Size</label>
              <select
                id="sl-size"
                value={state.size}
                onChange={(e) => setState((s) => ({ ...s, size: e.target.value }))}
              >
                {sizes.map((sz) => <option key={sz} value={sz}>{sz}</option>)}
              </select>
            </div>

            {hasLength && (
              <div className="row">
                <label htmlFor="sl-length">Length ({leaf.units})</label>
                <input
                  id="sl-length"
                  type="number"
                  value={state.length}
                  step={leaf.units === 'in' ? 0.25 : 5}
                  onChange={(e) => setState((s) => ({ ...s, length: parseFloat(e.target.value) || 0 }))}
                />
                {lengthSeries.length > 0 && (
                  <div className="length-chips">
                    {lengthSeries.map((l) => (
                      <button
                        key={l}
                        className={l === state.length ? 'chip active' : 'chip'}
                        onClick={() => setState((s) => ({ ...s, length: l }))}
                      >{l}</button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {grades.length > 0 && (
              <div className="row">
                <label htmlFor="sl-grade">Grade</label>
                <select
                  id="sl-grade"
                  value={state.grade}
                  onChange={(e) => setState((s) => ({ ...s, grade: e.target.value }))}
                >
                  {grades.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            )}

            <div className="row position-row">
              <label>Position (mm)</label>
              <input
                type="number" placeholder="X"
                value={state.positionX}
                onChange={(e) => setState((s) => ({ ...s, positionX: parseFloat(e.target.value) || 0 }))}
              />
              <input
                type="number" placeholder="Y"
                value={state.positionY}
                onChange={(e) => setState((s) => ({ ...s, positionY: parseFloat(e.target.value) || 0 }))}
              />
              <input
                type="number" placeholder="Z"
                value={state.positionZ}
                onChange={(e) => setState((s) => ({ ...s, positionZ: parseFloat(e.target.value) || 0 }))}
              />
            </div>

            <div className="row position-row">
              <label>Rotation (°)</label>
              <input
                type="number" placeholder="RX"
                value={state.rotationX}
                onChange={(e) => setState((s) => ({ ...s, rotationX: parseFloat(e.target.value) || 0 }))}
              />
              <input
                type="number" placeholder="RY"
                value={state.rotationY}
                onChange={(e) => setState((s) => ({ ...s, rotationY: parseFloat(e.target.value) || 0 }))}
              />
              <input
                type="number" placeholder="RZ"
                value={state.rotationZ}
                onChange={(e) => setState((s) => ({ ...s, rotationZ: parseFloat(e.target.value) || 0 }))}
              />
            </div>

            {state.mode === 'pattern' && (
              <div className="pattern-block">
                <div className="row">
                  <label htmlFor="sl-pattern">Pattern</label>
                  <select
                    id="sl-pattern"
                    value={state.pattern}
                    onChange={(e) => setState((s) => ({ ...s, pattern: e.target.value }))}
                  >
                    <option value="circular">Circular</option>
                    <option value="linear">Linear</option>
                  </select>
                </div>
                <div className="row">
                  <label htmlFor="sl-count">Count</label>
                  <input
                    id="sl-count"
                    type="number"
                    min={1}
                    value={state.count}
                    onChange={(e) => setState((s) => ({ ...s, count: parseInt(e.target.value, 10) || 1 }))}
                  />
                </div>
                {state.pattern === 'circular' ? (
                  <>
                    <div className="row">
                      <label htmlFor="sl-radius">Radius (mm)</label>
                      <input
                        id="sl-radius"
                        type="number"
                        value={state.radius}
                        onChange={(e) => setState((s) => ({ ...s, radius: parseFloat(e.target.value) || 0 }))}
                      />
                    </div>
                    <div className="row">
                      <label htmlFor="sl-start-angle">Start angle (°)</label>
                      <input
                        id="sl-start-angle"
                        type="number"
                        value={state.startAngle}
                        onChange={(e) => setState((s) => ({ ...s, startAngle: parseFloat(e.target.value) || 0 }))}
                      />
                    </div>
                    <div className="row">
                      <label htmlFor="sl-sweep">Sweep (°)</label>
                      <input
                        id="sl-sweep"
                        type="number"
                        value={state.sweep}
                        onChange={(e) => setState((s) => ({ ...s, sweep: parseFloat(e.target.value) || 0 }))}
                      />
                    </div>
                    <div className="row">
                      <label htmlFor="sl-orient-radial">Auto-orient radial</label>
                      <input
                        id="sl-orient-radial"
                        type="checkbox"
                        checked={state.orientRadial}
                        onChange={(e) => setState((s) => ({ ...s, orientRadial: e.target.checked }))}
                      />
                      <span style={{ fontSize: 11, color: '#9aa3ad' }}>
                        rotate each instance so +X points outward
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="row">
                      <label htmlFor="sl-dx">Step X (mm)</label>
                      <input
                        id="sl-dx" type="number" value={state.dx}
                        onChange={(e) => setState((s) => ({ ...s, dx: parseFloat(e.target.value) || 0 }))}
                      />
                    </div>
                    <div className="row">
                      <label htmlFor="sl-dy">Step Y (mm)</label>
                      <input
                        id="sl-dy" type="number" value={state.dy}
                        onChange={(e) => setState((s) => ({ ...s, dy: parseFloat(e.target.value) || 0 }))}
                      />
                    </div>
                  </>
                )}
                <div className="row">
                  <label htmlFor="sl-axis-z">Plane Z offset (mm)</label>
                  <input
                    id="sl-axis-z" type="number" value={state.axisZOffset}
                    onChange={(e) => setState((s) => ({ ...s, axisZOffset: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
              </div>
            )}
          </section>
        </div>

        <footer>
          <button className="cancel" onClick={close}>Cancel</button>
          <button className="place" onClick={place} data-testid="sl-place-btn">
            {state.mode === 'pattern' ? `Place ${state.count}` : 'Place'}
          </button>
        </footer>
      </div>
    </div>
  );
}
