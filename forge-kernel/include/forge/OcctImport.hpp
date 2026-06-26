// forge/OcctImport.hpp
//
// IN-HOUSE KERNEL — the OCCT -> native B-rep IMPORTER (the Phase-D substrate
// keystone). The mirror of NativeOcctBridge.hpp (native -> OCCT): this turns an
// OCCT-backed shape (ShapeKind::Occt, a TopoDS_Shape) into a pure
// forge::native::brep::Solid so the 18 already-wired `tryNative*` op call-sites
// can take their native branch on OCCT inputs instead of deferring totally.
//
// ============================ HONESTY (Bible §0/§9) ========================
// SCOPE: ANALYTIC quadric faces — Plane + Cylinder + Cone + Sphere + TORUS — PLUS
// free-form BSpline / Bezier SURFACE faces AND the swept SurfaceOfLinearExtrusion
// (the biggest OCCT-zero gap: real CAD parts with fillet blends, lofts, sweeps and
// extruded walls). The routes, all FAITHFUL (no facet-fakes):
//   * Plane/Cylinder/Cone/Sphere/Torus — re-expressed as the SAME analytic surface
//     in the native model (frame matched to OCCT's elementary parameterization, so
//     the native (u,v) coincides with OCCT's). A torus IS a native SurfaceKind, and
//     gp_Torus's parameterization is IDENTICAL to the native one, so major/minor
//     radii + the gp_Ax3 frame copy 1:1. A full BRepPrimAPI_MakeTorus (one face
//     periodic in BOTH u=theta and v=phi) is staged by a doubly-wrapping NxM grid
//     of EXACT torus rectangle cells (genus 1 => b1 = 2), mirroring buildTorus.
//   * BSpline/Bezier — extracted EXACTLY (poles/weights/clamped knots/degrees, 1:1,
//     periodic->clamped via OCCT's own de-periodisation + Segment re-clamp) into a
//     native brep::NurbsSurface.
//   * SurfaceOfLinearExtrusion — built DIRECTLY as the EXACT rational tensor B-spline
//     (basis curve x linear-in-direction), matching OCCT to machine precision in BOTH
//     geometry AND (u,v) parameterization (GeomConvert THROWS for a B-spline-based
//     extrusion, so the direct construction is the faithful route), then routed
//     through the native NURBS path.
// A NURBS face whose trim IS the full parameter rectangle (an extrusion/loft wall, a
// fillet blend) is integrated by the EXACT tensor-Gauss rectangle path (per-cell
// 10-pt Gauss over the rational Jacobian), with its 4 border rows/columns welded to
// the adjacent faces from the CANONICAL shared-edge 3-D points — so the wall's mass is
// exact to quadrature precision, not the coarser CDT degree-5 triangle estimate. Other
// (trimmed-with-holes) NURBS faces still take the general CDT path. Every face is
// triangulated in its (u,v) domain (the proven Boolean "faceted topology over exact
// geometry" model) so faces with HOLES (a bored cap) are represented and welded
// watertight from the SHARED OCCT edge 3-D curves. Curved sub-faces keep the parent
// surface (paramTri / exact-rectangle integration over the EXACT — quadric or rational
// — Jacobian); planar sub-faces integrate the exact polygon. The result is A/B-verified
// vs the OCCT original (volume/area/bbox/Betti/validity) by
// test/native_occt_import_test.cpp, INCLUDING a variable-radius-fillet box (BSpline
// blend + 6 planes), a through-sections loft (BSpline side + caps), a full TORUS
// (genus-1, b1=2) and a SOLID OF EXTRUSION (exact swept wall + planes) — vol/area to
// 0.5% (analytic quadrics + the exact torus + the full-rectangle NURBS walls now hit
// machine-precision volume) and the loft's curved-cap meshing to <0.05%; bbox/Betti
// are exact.
//
// EXPLICITLY DEFERRED (ok=false, named reason — never facet-faked):
//   * SurfaceOfRevolution — a circular sweep has NO exact UNIFORM-ANGLE NURBS form
//     (the exact rational-quadratic circle is non-uniform in the angle, so it cannot
//     keep OCCT's u-domain that the face p-curves live in); GeomConvert's polynomial
//     approximation misses by ~4.6% volume / 0.16 abs at model scale. Deferred until
//     the native kernel grows a first-class revolved-surface geometry. (The native
//     Torus IS supported precisely because that quadric's parameterization is uniform
//     -angle and matches OCCT exactly.)
//   * OffsetSurface — offset->NURBS is a TOLERANCED fit (and parameter-mismatched) for
//     a free-form base, not exact. Deferred.
//   * GeomAbs_OtherSurface -> "non-analytic face other".
// (Degenerate BSpline corner-setback patches in a constant-radius all-edge fillet also
// defer honestly via the 2-manifold pre-check rather than emit a folded shell.)
//
// Compiled ONLY under FORGE_NATIVE_BREP. It READS OCCT (it is the bridge) but
// EMITS pure native types. C++20, no new deps.

#ifndef FORGE_OCCT_IMPORT_HPP
#define FORGE_OCCT_IMPORT_HPP

#ifdef FORGE_NATIVE_BREP

#include <array>
#include <memory>
#include <string>

#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Face.hxx>

#include "forge/native/brep/Topology.hpp"   // brep::TopologyBuilder, brep::Solid
#include "forge/native/brep/Sweep.hpp"      // brep::Profile (CCW outer + CW holes, Point2)

namespace forge {

// Result of importing one OCCT shape into the native analytic B-rep model.
//   ok     — true iff EVERY face imported faithfully AND the assembled native
//            Solid is a closed 2-manifold. On false, `solid`/`owner` are null and
//            `reason` names why (e.g. "non-analytic face BSpline", "not a closed
//            2-manifold after import", "no solid in shape").
//   reason — empty on success; the honest deferral cause on failure.
//   solid  — a non-owning view into *owner (null on failure).
//   owner  — keeps the native TopologyBuilder (which owns the topology/surfaces
//            the Solid* views into) alive for the entry's lifetime.
struct ImportResult {
    bool ok = false;
    std::string reason;
    native::brep::Solid* solid = nullptr;
    std::shared_ptr<native::brep::TopologyBuilder> owner;
};

// Import the FIRST solid found in `shape` (or, if the shape carries no TopoDS_Solid,
// the shape's faces directly) into a native analytic B-rep Solid. Never throws on
// an unsupported face — returns ok=false with a reason so the caller can defer.
ImportResult importOcctSolid(const TopoDS_Shape& shape);

// ---------------------------------------------------------------------------
// OCCT sketch WIRE / planar FACE -> native B-rep PROFILE.
//
// The producer that lights up the Weldments / SheetMetal / DirectModeling fuse
// wires: those ops take an OCCT *sketch wire / profile* and want to build a native
// prism (brep::prism, Sweep.hpp) from it, but brep::prism consumes a native
// brep::Profile (a CCW outer ring + CW hole rings of geom::Point2 in the sketch
// plane), and until now there was NO OCCT-wire -> native-Profile converter — so
// every such op DEFERRED totally even with a NativeSolid body. This closes that gap.
//
//   importOcctProfile(const TopoDS_Wire&)  — one closed planar wire -> outer ring.
//   importOcctProfile(const TopoDS_Face&)  — a planar sketch face -> outer ring +
//                                            inner (hole) rings (a bored sketch).
//
// EACH EDGE of the wire is read EXACTLY where it is a line (its two vertices), and a
// curved edge (arc/B-spline) is discretised by GCPnts_UniformAbscissa on the
// BRepAdaptor_Curve into kProfileEdgeSamples ordered points (so a circular sketch
// imports as a fine chordal polygon within the prism's volume gate). Points are
// taken in the wire's TRAVERSAL ORDER (BRepTools_WireExplorer, honouring each edge's
// orientation), the shared end vertex contributed once, and PROJECTED into the wire's
// own plane (the 2D (u,v) of gp_Pln) to give geom::Point2. The outer ring is oriented
// CCW and each hole CW (the brep::Profile contract). The plane frame (origin + normal
// + x/y dirs) is returned so the caller can map the 2D profile / native prism back
// into world space (and gate on whether the plane matches its own sweep axis).
//
// HONEST DEFERS (ok=false, named reason — never a fabricated profile):
//   * a NON-PLANAR wire (its edges do not lie in one plane)            -> defer.
//   * an OPEN wire / fewer than 3 distinct projected points            -> defer.
//   * a degenerate (zero-area) projected loop                          -> defer.
//   * an edge whose 3-D curve cannot be read                           -> defer.
// Compiled ONLY under FORGE_NATIVE_BREP; READS OCCT, EMITS native types. C++20.
struct ProfileImportResult {
    bool ok = false;
    std::string reason;                 // honest deferral cause on failure
    native::brep::Profile profile;      // CCW outer + CW holes (geom::Point2), wire-plane 2D
    // Wire-plane frame (so the 2D profile maps to world: P = origin + u*xDir + v*yDir,
    // with normal = xDir x yDir). On a sheet-metal z=0 sketch this is the global XY.
    std::array<double, 3> origin{{0, 0, 0}};
    std::array<double, 3> normal{{0, 0, 1}};
    std::array<double, 3> xDir{{1, 0, 0}};
    std::array<double, 3> yDir{{0, 1, 0}};
};

// Number of ordered points a CURVED profile edge is discretised into (a line edge
// contributes only its two endpoints). 64 keeps a unit-circle sketch's chordal area
// within ~0.06% of the true disk — well inside the native prism's volume A/B gate.
constexpr int kProfileEdgeSamples = 64;

ProfileImportResult importOcctProfile(const TopoDS_Wire& wire);
ProfileImportResult importOcctProfile(const TopoDS_Face& face);

// TEST-ONLY PROBE — the number of times importOcctSolid has been ENTERED process-wide
// (incremented on the first line of every call, regardless of ok/defer). A/B tests use
// it to PROVE a Phase-D-wired op actually ran the OCCT->native importer on an OCCT input
// (i.e. it took the native branch, not silently deferred to OCCT). Zero behavioral impact
// on production — it only reads/writes a counter.
unsigned long long importOcctSolidCallCount();

}  // namespace forge

#endif  // FORGE_NATIVE_BREP

#endif  // FORGE_OCCT_IMPORT_HPP
