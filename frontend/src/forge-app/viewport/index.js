/**
 * Forge viewport — public surface for Forge-27.
 *
 * The UI-shell agent (Forge-26) consumes this barrel:
 *   import { ForgeViewport, NamedViews, DisplayStates,
 *            MotionPlayerControls, ViewportStore } from './viewport';
 *
 * Pure helpers are re-exported so other slices (and the headless
 * tests) can import them without pulling React.
 */

// React components.
export { ForgeViewport, default as ForgeViewportDefault } from './ForgeViewport.jsx';
export { SelectionHighlight } from './SelectionHighlight.jsx';
export { TransformGizmo } from './TransformGizmo.jsx';
export { MeasurementTool } from './MeasurementTool.jsx';
export { SectionView } from './SectionView.jsx';
export { NamedViews, captureNamedView, restoreNamedView,
         captureThumbnail } from './NamedViews.jsx';
export { DisplayStates } from './DisplayStates.jsx';
export { MotionPlayerControls } from './MotionPlayerControls.jsx';

// Pure helpers (React-free, headless-testable).
export { captureCamera, applyCamera, cameraStatesEqual,
         DEFAULT_CAMERA_STATE } from './cameraState.js';
export { buildDisplayMaterial, applyDisplayState,
         DISPLAY_STATES, DEFAULT_DISPLAY_STATE } from './displayStateMaterial.js';
export { distance, angleAt, polygonArea, summarise,
         snapToHints } from './measurements.js';
export { resolvePicks, nearestPick, nextSelection } from './selectionLogic.js';
export { makeSectionState, slidePlane, worldToPlaneOffset,
         clippingDescriptor, reorientPlane,
         DEFAULT_SECTION_NORMAL } from './sectionPlaneLogic.js';
export { ViewportStore, makeDefaultViewportState,
         bodiesFromProject, gatePicks } from './viewportState.js';
