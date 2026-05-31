/**
 * Tooltip — hover tooltips for Forge (Forge-28).
 *
 * Any element decorated with `data-forge-tip="text"` (or
 * `data-forge-tip-key` keyed into a render table) gets a tooltip via
 * `<TooltipHost>` mounted once in the app shell. The host installs a
 * single document-level mouseover listener — no per-element React
 * machinery, no jank on big toolbars / property grids.
 *
 * Smart positioning: shown above the target unless that would clip the
 * viewport top (within `flipThresholdPx`), then shown below. Horizontal
 * position centres on the target and clamps to a 4px viewport margin.
 *
 * Dismissal: mouse leave the trigger; mouse enter another `data-forge-tip`
 * element (instant swap); Escape key.
 */

import { useEffect, useRef, useState } from 'react';
import {
  placeTooltip,
  registerTooltipRenderer,
  getTooltipRenderer,
} from './Tooltip.logic.js';

export { placeTooltip, registerTooltipRenderer };

const STYLES = {
  root: {
    position: 'fixed', zIndex: 9999,
    maxWidth: 320, padding: '6px 10px',
    background: 'rgba(20,21,25,0.96)',
    color: '#f0f1f3', fontSize: 12, lineHeight: 1.4,
    border: '1px solid #2c2d33', borderRadius: 4,
    pointerEvents: 'none',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
  },
};

/**
 * <TooltipHost> — mount once in the app shell. Listens at the document
 * level for `data-forge-tip[…]` elements; manages a single tooltip DOM
 * node positioned next to whichever element the user is hovering.
 */
export function TooltipHost({ delayMs = 600 }) {
  const [tip, setTip] = useState(null); // { content, x, y, placement }
  const timerRef = useRef(null);
  const lastTarget = useRef(null);

  useEffect(() => {
    const onOver = (ev) => {
      const el = ev.target && ev.target.closest ? ev.target.closest('[data-forge-tip], [data-forge-tip-key]') : null;
      if (!el) return;
      if (lastTarget.current === el) return;
      lastTarget.current = el;
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => showFor(el), delayMs);
    };
    const onOut = (ev) => {
      const el = ev.target && ev.target.closest ? ev.target.closest('[data-forge-tip], [data-forge-tip-key]') : null;
      if (!el) return;
      const next = ev.relatedTarget && ev.relatedTarget.closest
        ? ev.relatedTarget.closest('[data-forge-tip], [data-forge-tip-key]') : null;
      if (next === el) return;
      lastTarget.current = null;
      clearTimeout(timerRef.current);
      setTip(null);
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        clearTimeout(timerRef.current);
        lastTarget.current = null;
        setTip(null);
      }
    };

    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('keydown', onKey, true);
      clearTimeout(timerRef.current);
    };
  }, [delayMs]);

  function showFor(el) {
    const content = resolveContent(el);
    if (content == null) return;
    const rect = el.getBoundingClientRect();
    // Initial guess at 160×40; refined after mount.
    const placed = placeTooltip({
      targetRect: rect, w: 160, h: 40,
      viewportW: window.innerWidth, viewportH: window.innerHeight,
    });
    setTip({ content, x: placed.x, y: placed.y, placement: placed.placement, rect });
  }

  // After mount, re-measure to refine placement.
  const tipRef = useRef(null);
  useEffect(() => {
    if (!tip || !tipRef.current) return;
    const r = tipRef.current.getBoundingClientRect();
    const re = placeTooltip({
      targetRect: tip.rect, w: r.width, h: r.height,
      viewportW: window.innerWidth, viewportH: window.innerHeight,
    });
    if (re.x !== tip.x || re.y !== tip.y) setTip((t) => ({ ...t, x: re.x, y: re.y, placement: re.placement }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tip?.content]);

  if (!tip) return null;
  return (
    <div
      ref={tipRef}
      role="tooltip"
      data-forge-tooltip
      data-placement={tip.placement}
      style={{ ...STYLES.root, left: tip.x, top: tip.y }}
    >
      {tip.content}
    </div>
  );
}

function resolveContent(el) {
  const key = el.getAttribute('data-forge-tip-key');
  if (key) {
    const r = getTooltipRenderer(key);
    if (typeof r === 'function') return r(el);
  }
  const text = el.getAttribute('data-forge-tip');
  return text || null;
}

export default TooltipHost;
