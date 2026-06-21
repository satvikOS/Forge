// ─────────────────────────────────────────────────────────────────────────────
// Merged professional icon registry — every per-tool glyph from the 13 category
// libraries (sketch / feature / boolean+xform / assembly / surface / mesh+analysis
// / drawing / cam / cae / gdt+pmi / file+edit+app / viewport+nav / archie+status)
// in one map: toolId -> SVG React component (24x24, currentColor, NX/CATIA-grade).
// Icon.jsx consults this FIRST and falls back to its legacy 16x16 PATHS.
// ─────────────────────────────────────────────────────────────────────────────
import FEATURE from './featureIcons.jsx';
import SKETCH from './sketchIcons.jsx';
import BOOLEAN from './boolean-xformIcons.jsx';
import ASSEMBLY from './assemblyIcons.jsx';
import SURFACE from './surfaceIcons.jsx';
import MESH from './mesh-analysisIcons.jsx';
import DRAWING from './drawingIcons.jsx';
import CAM from './camIcons.jsx';
import CAE from './caeIcons.jsx';
import GDT from './gdt-pmiIcons.jsx';
import FILEEDIT from './file-edit-appIcons.jsx';
import VIEWPORT from './viewport-navIcons.jsx';
import ARCHIE from './archie-statusIcons.jsx';

export const ICON_REGISTRY = {
  ...FEATURE, ...SKETCH, ...BOOLEAN, ...ASSEMBLY, ...SURFACE, ...MESH,
  ...DRAWING, ...CAM, ...CAE, ...GDT, ...FILEEDIT, ...VIEWPORT, ...ARCHIE,
};

export const REGISTRY_ICON_NAMES = Object.keys(ICON_REGISTRY);
export default ICON_REGISTRY;
