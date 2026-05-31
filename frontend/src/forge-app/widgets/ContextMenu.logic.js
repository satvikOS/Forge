/**
 * Pure (no-React, no-DOM) logic for ContextMenu (Forge-28).
 *
 * Keeps the per-kind builder registry and the edge-clamp math in a
 * plain JS module so node-smoke tests can import without a JSX runtime.
 * The JSX widget re-exports these for callers who only want a single
 * import surface.
 */

const _menuRegistry = new Map();

export function registerContextMenu(kind, builder) {
  if (!kind || typeof builder !== 'function') {
    throw new Error('[forge.menu] registerContextMenu: kind + builder fn required');
  }
  _menuRegistry.set(kind, builder);
}

export function getContextMenuItems(kind, ctx = {}) {
  const builder = _menuRegistry.get(kind);
  if (!builder) return [];
  const items = builder(ctx) || [];
  return items.filter((it) => !it.when || it.when(ctx));
}

export function listRegisteredKinds() {
  return [..._menuRegistry.keys()];
}

// Default empty builders for the six entity kinds Forge cares about.
['body', 'face', 'edge', 'vertex', 'feature', 'component'].forEach((kind) => {
  if (!_menuRegistry.has(kind)) _menuRegistry.set(kind, () => []);
});

/**
 * Clamp an x/y origin so a w×h menu stays inside `viewportW × viewportH`,
 * leaving `margin` px of breathing room. Pure for testability.
 */
export function clampToViewport({ x, y, w, h, viewportW, viewportH, margin = 4 }) {
  let nx = x, ny = y;
  if (nx + w > viewportW - margin) nx = Math.max(margin, viewportW - w - margin);
  if (ny + h > viewportH - margin) ny = Math.max(margin, viewportH - h - margin);
  if (nx < margin) nx = margin;
  if (ny < margin) ny = margin;
  return { x: nx, y: ny };
}
