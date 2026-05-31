/**
 * Pure positioning logic for <Tooltip> (Forge-28). Kept in a plain JS
 * module so node-smoke tests can import without a JSX runtime.
 */

const _renderers = new Map();
export function registerTooltipRenderer(key, renderer) {
  _renderers.set(key, renderer);
}
export function getTooltipRenderer(key) {
  return _renderers.get(key) || null;
}

/**
 * Pick a tooltip placement above the target — flipping below when
 * staying above would clip the viewport top.
 *
 *   targetRect: { left, top, bottom, right, width, height }  (px)
 *   w, h:       tooltip size (px)
 *   viewportW/H: outer bounds
 *   flipThresholdPx: top-edge gutter that triggers the flip
 *   gap: tooltip ↔ target spacing
 */
export function placeTooltip({ targetRect, w, h, viewportW, viewportH,
                                flipThresholdPx = 24, gap = 6 }) {
  const cx = targetRect.left + targetRect.width / 2;
  let x = cx - w / 2;
  let y = targetRect.top - h - gap;
  let placement = 'above';
  if (y < flipThresholdPx) {
    y = targetRect.bottom + gap;
    placement = 'below';
  }
  if (x < 4) x = 4;
  if (x + w > viewportW - 4) x = viewportW - w - 4;
  if (y + h > viewportH - 4) y = viewportH - h - 4;
  return { x, y, placement };
}
