// forge/native/brep/StepRead.hpp
//
// K6-core — FOREIGN STEP READ. Parse an ARBITRARY external AP203 / AP214 / AP242
// STEP (ISO-10303-21) instance file into the Forge NATIVE B-rep (the K1 trimmed-
// NURBS faces + the K1.4 native sew), so the kernel can INGEST real-world parts —
// not merely round-trip its own emitted dialect (that is StepAnalytic's scope).
//
// This is the unblock-the-most item of docs/SCOPE_2026-06-24/EXECUTION_ROADMAP.md
// WAVE 2 "K6-core" and the Phase-B keystone of kernel/data-exchange.md §3 (B1):
// the FIRST native reader that handles the full core geometry+topology zoo a
// commercial exporter (NX / CATIA / SolidWorks / OCCT) actually emits:
//
//   GEOMETRY
//     CARTESIAN_POINT, DIRECTION, VECTOR, AXIS2_PLACEMENT_3D / _2D
//     surfaces:  PLANE, CYLINDRICAL_SURFACE, CONICAL_SURFACE, SPHERICAL_SURFACE,
//                TOROIDAL_SURFACE, B_SPLINE_SURFACE_WITH_KNOTS (+ the
//                (BOUNDED_SURFACE...(RATIONAL_)B_SPLINE_SURFACE...) complex form)
//     curves:    LINE, CIRCLE, ELLIPSE, B_SPLINE_CURVE_WITH_KNOTS (+ rational
//                complex form)
//   TOPOLOGY
//     VERTEX_POINT, EDGE_CURVE, ORIENTED_EDGE, EDGE_LOOP,
//     FACE_BOUND / FACE_OUTER_BOUND, ADVANCED_FACE   -> a native trimmed face
//                (outer + inner/hole trim loops),
//     CLOSED_SHELL / OPEN_SHELL, MANIFOLD_SOLID_BREP / BREP_WITH_VOIDS /
//     SHELL_BASED_SURFACE_MODEL / MANIFOLD_SURFACE_SHAPE_REPRESENTATION
//                -> native faces, then SEWN (Sew.hpp) into a shell / solid.
//   UNITS
//     the length scale is read from the GEOMETRIC_REPRESENTATION_CONTEXT unit
//     context (SI_UNIT(.MILLI.,.METRE.) / CONVERSION_BASED_UNIT inch ...) and
//     applied to every CARTESIAN_POINT so the model arrives in millimetres.
//
// HONEST REPORTING: an ADVANCED_FACE whose surface kind is not supported is NOT
// silently dropped — its entity type is recorded in `unsupported` and the read
// reports the count, so a caller knows the body is incomplete (the data-exchange
// §1 "report unsupported entities honestly, don't silently drop a face" rule).
//
// ============================ HONESTY (Bible §0/§9) ========================
// REAL reader, pure C++20 + stdlib only — NO external dependencies, NO OCCT, NO
// WASM. ADDITIVE: a brand-new header + TU. It REUSES (no re-derivation):
//   * StepPart21.hpp   — the shared ISO-10303-21 lexer (locateSections /
//                        parseInstances / splitTopLevel / parseRef / stepNum),
//   * Topology.hpp     — Vertex/Edge/Coedge/Loop/Face/Shell/Solid + the builder,
//   * Surface.hpp      — the 5 analytic quadrics (so a foreign quadric face is a
//                        native analytic face with EXACT mass props),
//   * Nurbs.hpp / NurbsSurface.hpp / TrimmedFace.hpp — the trimmed-NURBS face,
//   * Sew.hpp          — the native sew/diagnose to weld the independent faces.
// It does NOT edit binding.cpp / CMakeLists / the native gate.
//
// CONVENTIONS: namespace forge::native::brep. The reader is robust-in-practice:
// it never fabricates geometry; any malformed / dangling / arity-wrong record is
// an honest `ok=false` with a `reason`. A face whose surface is unsupported is
// recorded (not faked, not dropped) and the read still succeeds for the rest so a
// caller can inspect the supported part and the honest gap list.

#ifndef FORGE_NATIVE_BREP_STEPREAD_HPP
#define FORGE_NATIVE_BREP_STEPREAD_HPP

#include <cstddef>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "forge/native/brep/Topology.hpp"     // Solid / Face / TopologyBuilder
#include "forge/native/brep/TrimmedFace.hpp"   // TrimmedFace (B-spline faces)

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// ForeignFaceInfo — per-ADVANCED_FACE bookkeeping the reader exposes so a test /
// A/B harness can probe the surface kind and (for B-spline faces) the trimmed-
// NURBS face it built. `nativeFace` points into the owned Solid (null for an
// unsupported face that was recorded but not built). `trimmedIndex` indexes into
// ForeignReadResult::trimmedFaces when the surface is a B-spline (else -1).
// ---------------------------------------------------------------------------
struct ForeignFaceInfo {
    std::string surfaceType;        // the STEP surface keyword (e.g. "PLANE")
    Face*       nativeFace = nullptr;
    long        trimmedIndex = -1;  // index into trimmedFaces, or -1
    std::size_t innerLoopCount = 0; // number of hole loops on this face
    bool        supported = true;   // false ⇒ recorded in `unsupported`
};

// ---------------------------------------------------------------------------
// ForeignReadResult — the native B-rep + the honest report.
// ---------------------------------------------------------------------------
struct ForeignReadResult {
    bool ok = false;
    std::string reason;

    // Ownership: the TopologyBuilder owns every Vertex/Edge/Coedge/Loop/Face/
    // Shell/Solid/Surface; `solid` points into it. Keep `owner` alive as long as
    // `solid` is used.
    std::shared_ptr<TopologyBuilder> owner;
    Solid* solid = nullptr;

    // The sewn shell(s). After the native sew, `closed` is true iff the body is a
    // watertight 2-manifold (0 free + 0 non-manifold edges).
    std::vector<Shell*> shells;
    bool closed = false;

    // Topology signature of the sewn body (the A/B signature vs OCCT): distinct
    // welded vertices / shared edges / faces, and the Euler characteristic.
    std::size_t vertices = 0;
    std::size_t edges = 0;
    std::size_t faces = 0;          // supported (built) faces
    long long   eulerCharacteristic = 0;

    // The trimmed-NURBS faces (one per B-spline ADVANCED_FACE) so a caller can
    // round-trip their area independently of the quadric mass-props path.
    std::vector<TrimmedFace> trimmedFaces;

    // Per-face report (parallel to the ADVANCED_FACE records, in shell order).
    std::vector<ForeignFaceInfo> faceInfos;

    // HONEST gap list: the distinct STEP entity types that appeared on a face but
    // were not reconstructed (e.g. "SURFACE_OF_REVOLUTION"), with a count each.
    std::map<std::string, std::size_t> unsupported;

    // Units: the length scale that was applied to every point (model is reported
    // in millimetres). 1.0 for a millimetre file, 25.4 for an inch file, 1000.0
    // for a metre file, etc. `unitName` is the resolved length unit keyword.
    double lengthScaleToMm = 1.0;
    std::string unitName = "MILLIMETRE";
};

// ---------------------------------------------------------------------------
// readForeignStep — parse the ISO-10303-21 `text` into a native B-rep.
//
// `sewTol` is the model-space distance (in the FILE's units, before scaling) under
// which two independent face-boundary vertices are welded by the native sew; a
// value <= 0 picks an automatic tolerance from the model bounding box. The faces
// are built INDEPENDENTLY (each ADVANCED_FACE owns its own vertices/edges, as in a
// real STEP file) and then sewn — so the closure of the result is a genuine test
// of the sew, not an artefact of shared topology.
// ---------------------------------------------------------------------------
ForeignReadResult readForeignStep(const std::string& text, double sewTol = -1.0);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_STEPREAD_HPP
