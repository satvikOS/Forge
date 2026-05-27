/**
 * ArchDisc Kernel — Atomic-CAD Standards Library (root index).
 *
 * Single entry point for the Standards Library dialog + ToolExecutionEngine.
 *
 * Atomic-CAD contract: every placement runs real `AtomicOps.startSketch /
 * sketchCircle / sketchPolygon / sketchPolyline / finishSketch / extrude /
 * cut` on a `Part` instance; the resulting feature history is recorded
 * and visible in FeatureTreePanel. No fixture imports; no sealed Manifold
 * returns; no Math.random.
 *
 * Coverage (SP-1 session 1):
 *   ISO 4762 / 4014 / 4017 / 4032 / 7089 / 7090
 *   ASME B18.2.1 / B18.3
 *   AISC W-shape / L-shape / HSS rectangular
 *   SKF 60xx / 63xx / 302xx / 322xx
 *   ISO 273 clearance-hole cutter
 */

export {
  ISO_4762, ISO_4014, ISO_4017, ISO_4032, ISO_7089, ISO_7090,
  ISO_273, ISO_898_GRADES, ISO_SIZES,
  ASME_B18_2_1, ASME_B18_3, SAE_GRADES,
  ASME_HEX_SIZES, ASME_SHCS_SIZES, INCH_TO_MM,
  AISC_W_SHAPES, AISC_L_SHAPES, AISC_HSS_RECT,
  AISC_W_SIZES, AISC_L_SIZES, AISC_HSS_SIZES,
  SKF_DEEP_GROOVE_LIGHT, SKF_DEEP_GROOVE_HEAVY,
  SKF_TAPERED_LIGHT, SKF_TAPERED_HEAVY,
  STANDARDS_CATALOG, lookupCatalog,
} from './data/index.js';

export {
  getBuilder, placeStandard,
  Fastener, StructuralSection, Bearing, ClearanceHole,
} from './builders/index.js';
