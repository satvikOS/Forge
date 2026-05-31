/**
 * Forge Design System — barrel.
 *
 * Forge has its own visual identity: the forge metaphor (warm copper accent
 * against deep graphite), Inter + JetBrains Mono typography, 8-point grid,
 * three themes (dark default, light blueprint, contrast for AAA). This
 * module is the single place new UI code reaches for primitives + icons +
 * tokens. The legacy `forge-app/styles.css` is kept temporarily so v1
 * panels keep rendering during the migration.
 *
 * Side-effect import: `tokens.css` registers the CSS custom properties on
 * the `[data-forge-theme]` selector.
 */

import './tokens.css';

export * from './primitives/Button.jsx';
export * from './primitives/IconButton.jsx';
export * from './primitives/Input.jsx';
export * from './primitives/NumberInput.jsx';
export * from './primitives/Select.jsx';
export * from './primitives/Switch.jsx';
export * from './primitives/Checkbox.jsx';
export * from './primitives/SegmentedControl.jsx';
export * from './primitives/Tabs.jsx';
export * from './primitives/Tooltip.jsx';
export * from './primitives/Modal.jsx';
export * from './primitives/Toast.jsx';
export * from './primitives/Field.jsx';
export * from './primitives/CollapsibleSection.jsx';
export * from './primitives/EmptyState.jsx';
export * from './primitives/KeyHint.jsx';
export * from './primitives/Spinner.jsx';
export * from './primitives/ProgressBar.jsx';
export * from './primitives/Card.jsx';
export * from './primitives/Stack.jsx';
export * from './primitives/Divider.jsx';
export * from './primitives/Tree.jsx';
export * from './icons/Icon.jsx';
export * from './a11y.js';
