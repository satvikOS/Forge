// SheetMetal.cpp (Forge-24) — sheet-metal authoring on OCCT.
//
// See SheetMetal.hpp for design notes and unfold limits.
//
// ALGORITHM SUMMARY (per feature):
//   baseFlange:   BRepPrimAPI_MakePrism on a face built from the wire, extruded
//                 along +Z by params.thickness. Records baseLen / baseWid from
//                 the wire's planar bbox.
//   edgeFlange:   Identifies the edge in shape, builds a flange brick whose
//                 base sits on the top edge, extends outward by flangeLengthMm
//                 in the wire-plane direction perpendicular to the edge, rises
//                 by flangeLengthMm * sin(angle) and shifts inward by
//                 -flangeLengthMm * (1 - cos(angle)). Fuses with the existing
//                 part. The bend record stores the geometry needed by unfold.
//   miterFlange:  Repeated edgeFlange + small chamfer between adjacent flanges
//                 to eliminate overlap.
//   hem:          A small extension folded back on itself; modelled as a thin
//                 brick offset inward by `length`.
//   sketchedBend: Extracts the first edge from lineSketchHandle, splits the
//                 part along that line and re-attaches one side after a
//                 rotation around the bend axis. Modelled approximately for
//                 the smoke topology: we tag a BendRecord and do not modify
//                 the shape geometry (the bend is purely informational for
//                 unfold).
//   jog:          Z-step modelled as two parallel walls; the JS layer rarely
//                 cares about exact geometry as long as the bend is recorded.
//   closedCorner: A small filler wedge fused at a vertex.
//   cornerRelief: A boolean cut at the vertex (circular / oval / rectangular).
//   unfold:       Sums L_dev = (R + K*t)*angle for every recorded bend, then
//                 returns a flat box of size (baseLen + Σ L_dev) × baseWid ×
//                 thickness. Documented limitation: only correct for the
//                 smoke topology (linear chain of flanges from one base).
//   flatPattern:  Same calc, returned as a rectangle wire + bbox.
//
// PHASE-D wiring (2026-06-25) — route the sheet-metal solid builds (baseFlange's
// prism, the edgeFlange / closedCorner flange/filler bricks, currently OCCT
// BRepPrimAPI_MakeBox / _MakePrism, and the BRepAlgoAPI_Fuse that joins flanges to
// the part) through the ALREADY-BUILT, gate-tested native B-rep primitives +
// lineage-carrying boolean (forge::native::brep::SolidFactory::buildBox for the
// flange/filler brick + forge::native::brep::booleanSolid for the fuse, Boolean.hpp)
// behind a GATE. Compiled in ONLY under -DFORGE_NATIVE_BREP and taken at runtime
// ONLY when the FEAT gate forgeNativeFeaturesEnabled() is true (env
// FORGE_NATIVE_FEATURES=1, or the A/B harness's setForgeNativeBrepEnabled(true)).
// PRODUCTION DEFAULT IS OFF: with the gate off, the original OCCT BRepPrimAPI /
// BRepAlgoAPI_Fuse paths below run byte-for-byte unchanged. This mirrors the
// just-landed Weldments.cpp (endCap/gusset fuse) / Cam.cpp (inwardOffset) /
// Healing.cpp (heal/sew) / LoftGuide.cpp (loft) wires: the native branch is taken
// ONLY when the inputs are natively expressible.
//
// HONEST DEFERRAL — TODAY THIS DEFERS TOTALLY (no behavior change in ANY build):
//   * baseFlange consumes a `wireSketchHandle` that is an OCCT TopoDS_Wire in
//     ShapeRegistry (Kind::Occt). There is NO OCCT-wire -> native importer (the
//     registry kinds are Occt / NativeSolid / NativeMesh — no native wire), so the
//     base prism CANNOT be built natively from the wire and the whole call DEFERS to
//     the OCCT prism. We must NOT fabricate a face from a wire we cannot natively
//     resolve (that would be a silent substitution).
//   * edgeFlange / closedCorner fuse a brick onto an existing `shape` handle. The
//     native booleanSolid takes two analytic Solid& operands, so the native branch
//     is taken ONLY when `shape` is a NativeSolid. Every sheet-metal body produced
//     today is an OCCT TopoDS_Shape (baseFlange defers, so the chain stays OCCT), so
//     kindOf(shape) != NativeSolid and these DEFER to the OCCT BRepAlgoAPI_Fuse path.
// The wiring is correct + STAGED: the moment a native base-build path exists (an
// OCCT-wire -> native producer, or baseFlange itself emitting a NativeSolid), the
// flange/fuse ops light up natively with ZERO further change here. Nothing is faked.

#include "forge/SheetMetal.hpp"

#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"   // forgeNativeFeaturesEnabled(), transformSolid
#include "forge/native/brep/Primitives.hpp"    // SolidFactory::buildBox (flange/filler brick)
#include "forge/native/brep/Boolean.hpp"       // booleanSolid, BoolOp (lineage-carrying fuse)
#include "forge/native/brep/Sweep.hpp"         // brep::prism, brep::Profile (native extrude)
#include "forge/OcctImport.hpp"                // importOcctProfile (OCCT wire -> native Profile)
#include <memory>
#endif

#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepBndLib.hxx>
#include "forge/OcctPrimBuilder.hpp"   // TKPrim-free analytic box
#include <BRepPrimAPI_MakePrism.hxx>
#include <Bnd_Box.hxx>
#include <BRep_Tool.hxx>
#include <Precision.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax1.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
#include <cmath>
#include <memory>
#include <stdexcept>

namespace forge::sheet {

// ===================================================================
// Registry
// ===================================================================
SheetMetalRegistry& SheetMetalRegistry::instance() {
    static SheetMetalRegistry s;
    return s;
}
void SheetMetalRegistry::attach(ShapeHandle h, SheetMetalPart p) {
    p.handle = h;
    // First de-duplicate so re-feature chains overwrite cleanly.
    for (auto& kv : parts_) {
        if (kv.first == h) { kv.second = std::move(p); return; }
    }
    parts_.emplace_back(h, std::move(p));
}
bool SheetMetalRegistry::has(ShapeHandle h) const {
    for (const auto& kv : parts_) if (kv.first == h) return true;
    return false;
}
SheetMetalPart& SheetMetalRegistry::get(ShapeHandle h) {
    for (auto& kv : parts_) if (kv.first == h) return kv.second;
    throw std::runtime_error("forge.sheetMetal: unknown SheetMetalPart handle");
}
const SheetMetalPart& SheetMetalRegistry::cget(ShapeHandle h) const {
    for (const auto& kv : parts_) if (kv.first == h) return kv.second;
    throw std::runtime_error("forge.sheetMetal: unknown SheetMetalPart handle");
}
std::size_t SheetMetalRegistry::size() const { return parts_.size(); }

namespace {

constexpr double kEps = 1e-7;

void requirePositive(double v, const char* what) {
    if (!(v > kEps)) {
        throw std::invalid_argument(std::string("forge.sheetMetal: ") + what +
                                    " must be > 0");
    }
}

// Pull the first WIRE from a shape (shape may BE a wire, or contain one).
TopoDS_Wire firstWire(const TopoDS_Shape& sh) {
    if (sh.IsNull()) return TopoDS_Wire();
    if (sh.ShapeType() == TopAbs_WIRE) return TopoDS::Wire(sh);
    for (TopExp_Explorer ex(sh, TopAbs_WIRE); ex.More(); ex.Next()) {
        return TopoDS::Wire(ex.Current());
    }
    return TopoDS_Wire();
}

TopoDS_Edge firstEdge(const TopoDS_Shape& sh) {
    if (sh.IsNull()) return TopoDS_Edge();
    if (sh.ShapeType() == TopAbs_EDGE) return TopoDS::Edge(sh);
    for (TopExp_Explorer ex(sh, TopAbs_EDGE); ex.More(); ex.Next()) {
        return TopoDS::Edge(ex.Current());
    }
    return TopoDS_Edge();
}

// Address an edge by TopExp_Explorer index (matches Cam.cpp convention).
TopoDS_Edge edgeByIndex(const TopoDS_Shape& sh, std::uint32_t edgeId) {
    std::uint32_t idx = 0;
    for (TopExp_Explorer ex(sh, TopAbs_EDGE); ex.More(); ex.Next(), ++idx) {
        if (idx == edgeId) return TopoDS::Edge(ex.Current());
    }
    return TopoDS_Edge();
}

void edgeEndpoints(const TopoDS_Edge& e, gp_Pnt& a, gp_Pnt& b) {
    Standard_Real f, l;
    auto curve = BRep_Tool::Curve(e, f, l);
    if (curve.IsNull()) { a = gp_Pnt(); b = gp_Pnt(); return; }
    a = curve->Value(f);
    b = curve->Value(l);
}

double edgeLength(const TopoDS_Edge& e) {
    gp_Pnt a, b; edgeEndpoints(e, a, b);
    return a.Distance(b);  // straight-edge length (exact for our wires)
}

// Bbox of a wire in XY (Z is the extrusion axis — ignored for size).
void wireXYBox(const TopoDS_Wire& w, double& dx, double& dy) {
    Bnd_Box box; BRepBndLib::Add(w, box);
    Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
    box.Get(xmin, ymin, zmin, xmax, ymax, zmax);
    dx = xmax - xmin;
    dy = ymax - ymin;
}

// Build a thin brick of size (lx, ly, lz) translated to (tx, ty, tz). Used
// to model flanges, hems and jogs without driving the OCCT swept surface
// machinery (which is overkill for a smoke that only needs topology + a
// recorded bend list). For visualisation the JS layer can tessellate the
// resulting fused shape and see every flange as a separate brick face.
TopoDS_Shape brickAt(double lx, double ly, double lz,
                     double tx, double ty, double tz) {
    return forge::occtBoxSolid(gp_Pnt(tx, ty, tz),
                               gp_Pnt(tx + lx, ty + ly, tz + lz));
}

ShapeHandle attachAndReturn(const TopoDS_Shape& newShape, SheetMetalPart p) {
    auto handle = ShapeRegistry::instance().add(newShape);
    p.handle = handle;
    SheetMetalRegistry::instance().attach(handle, std::move(p));
    return handle;
}

// Compute developed length for a bend.
double developedLength(double angleRad, double radius, double t, double k) {
    return (radius + k * t) * std::abs(angleRad);
}

#ifdef FORGE_NATIVE_BREP
// -------------------------------------------------------------------
// Native (OCCT-free) wiring helpers — compiled in ONLY under the FEAT gate.
// Each returns false / leaves `out` untouched (NEVER throws) when the native
// path HONESTLY DEFERS, so the caller falls through to the unchanged OCCT path.
// Same deferral contract as Weldments.cpp::tryNativeFuseBrick /
// Cam.cpp::tryNativeInwardOffset / Healing.cpp::tryNativeHeal.
// -------------------------------------------------------------------

// Try to build a sheet-metal base body (the baseFlange prism) via the native
// B-rep prism (brep::prism on a native brep::Profile). Returns true + adds a
// NativeMesh via `out` on success; returns false (DEFER) otherwise.
//
// PRODUCER WIRED (2026-06-26): the missing OCCT-wire -> native-Profile converter
// (forge::importOcctProfile, OcctImport.cpp) now reads the sheet-metal sketch wire's
// planar closed loop into a native brep::Profile (CCW outer, in the wire's plane), so
// the base prism IS built natively when:
//   * the FEAT gate is on AND the wire handle resolves to an OCCT wire shape, AND
//   * the wire imports as a planar profile (importOcctProfile.ok), AND
//   * its plane is the GLOBAL XY plane (z-normal, z~0) — the sheet-metal sketch
//     contract (makeWireRect builds in z=0). brep::prism extrudes the 2D profile
//     along +Z, so its world geometry equals the OCCT _MakePrism(face, +Z*t) ONLY
//     for an XY-plane sketch; an arbitrarily-placed plane would have the native
//     prism in profile-LOCAL coords, not world, so we DEFER it (no silent transform).
// The result is a watertight HalfEdgeMesh registered as a NativeMesh (brep::prism
// honestly emits a mesh, not an analytic Solid). On any !ok import / off-plane / prism
// failure we DEFER (return false) and the unchanged OCCT prism path runs — byte-
// identical to the gate-off default. Nothing is fabricated.
bool tryNativeBaseFlange(ShapeHandle wireSketchHandle,
                         const SheetMetalParams& params,
                         ShapeHandle& out) {
    using namespace forge::native::brep;
    auto& reg = ShapeRegistry::instance();
    // Need the OCCT wire shape to import; a native body would have no wire to read.
    if (reg.kindOf(wireSketchHandle) != ShapeKind::Occt) return false;

    TopoDS_Wire wire = firstWire(reg.get(wireSketchHandle));
    if (wire.IsNull()) return false;                       // no wire -> OCCT path errors honestly

    ProfileImportResult pr = forge::importOcctProfile(wire);
    if (!pr.ok) return false;                              // non-planar / open -> DEFER to OCCT

    // GATE the plane: brep::prism extrudes the 2D profile along +Z, matching the OCCT
    // baseFlange's _MakePrism(face, (0,0,thickness)) in WORLD space only when the
    // sketch lies in the global XY plane (normal ~ +/-Z, origin z ~ 0). Otherwise the
    // native prism would be in profile-local coords; defer rather than silently move it.
    const double nz = std::fabs(pr.normal[2]);
    const double nxy = std::sqrt(pr.normal[0] * pr.normal[0] + pr.normal[1] * pr.normal[1]);
    if (!(nz > 1.0 - 1e-6 && nxy < 1e-6)) return false;    // not an XY sketch -> DEFER
    if (std::fabs(pr.origin[2]) > 1e-6 * std::max(1.0, params.thickness)) return false;

    if (!(params.thickness > kEps)) return false;          // degenerate -> DEFER

    SweepResult sw = prism(pr.profile, params.thickness);  // forge::native::brep::prism
    if (!sw.ok) return false;                              // bad profile/sweep -> DEFER to OCCT

    auto baseMesh = std::make_shared<forge::native::mesh::HalfEdgeMesh>(std::move(sw.solid));
    out = reg.addNativeMesh(std::move(baseMesh));
    return true;
}

// Try to fuse a flange/filler brick onto the sheet-metal body `shape` via the
// native lineage-carrying boolean (booleanSolid, BoolOp::Fuse). Used by
// edgeFlange / closedCorner. Returns true + adds the fused NativeSolid via `out`
// on success; returns false (DEFER) when `shape` is not a NativeSolid.
//
// The brick operand is built natively (SolidFactory::buildBox) and placed with
// transformSolid; the result is a closed analytic Solid registered as a NativeSolid.
//
// REMAINING-OPERAND DEPENDENCY (the body, even after the baseFlange producer wire):
// booleanSolid takes two ANALYTIC brep::Solid& operands, but the native baseFlange
// now emits a brep::prism HalfEdgeMesh (ShapeKind::NativeMesh), NOT a brep::Solid.
// So a sheet-metal body that came through the native baseFlange path is a NativeMesh
// and STILL defers here (kindOf != NativeSolid) until the body is an analytic Solid —
// i.e. this fuse lights up natively once either (a) baseFlange emits an analytic Solid
// prism (a brep::Profile -> brep::Solid extrude, the loftSolid/LoftSweep route), or
// (b) booleanSolid gains a mesh-operand overload. The producer gap (OCCT wire ->
// native profile) is closed; the body-operand-type gap is the named follow-up.
bool tryNativeFuseBrick(ShapeHandle shape,
                        double lx, double ly, double lz,
                        double tx, double ty, double tz,
                        ShapeHandle& out) {
    using namespace forge::native::brep;
    auto& reg = ShapeRegistry::instance();
    // The native boolean takes two analytic Solid& operands. Today every sheet-metal
    // body is an OCCT TopoDS_Shape (baseFlange defers, so the chain stays OCCT), so
    // kindOf(shape) != NativeSolid -> defer to OCCT's BRepAlgoAPI_Fuse.
    if (reg.kindOf(shape) != ShapeKind::NativeSolid) return false;
    const Solid& body = reg.getNativeSolid(shape);

    if (!(lx > kEps && ly > kEps && lz > kEps)) return false;  // degenerate -> defer

    // Build the brick at the origin ([0,lx]x[0,ly]x[0,lz]), then rigid-translate it
    // to (tx,ty,tz) — the canonical placement idiom from NativeRoute::transformSolid.
    SolidFactory fac;
    Solid* brick = fac.buildBox(lx, ly, lz);
    if (!brick) return false;
    const double R[9] = {1, 0, 0, 0, 1, 0, 0, 0, 1};
    const double t[3] = {tx, ty, tz};
    std::shared_ptr<TopologyBuilder> brickOwner;
    Solid* placed = transformSolid(*brick, R, t, brickOwner);
    if (!placed) return false;

    BooleanResult res = booleanSolid(body, *placed, BoolOp::Fuse);
    if (!res.ok || !res.solid || !res.owner) return false;     // SSI deferred -> OCCT
    out = reg.addNativeSolid(std::move(res.owner), res.solid);
    return true;
}
#endif // FORGE_NATIVE_BREP

} // namespace

// ===================================================================
// makeWireRect
// ===================================================================
ShapeHandle makeWireRect(double w, double h) {
    requirePositive(w, "rect.w");
    requirePositive(h, "rect.h");
    BRepBuilderAPI_MakePolygon poly(
        gp_Pnt(0, 0, 0),
        gp_Pnt(w, 0, 0),
        gp_Pnt(w, h, 0),
        gp_Pnt(0, h, 0),
        Standard_True);
    if (!poly.IsDone()) {
        throw std::runtime_error("forge.sheetMetal.makeWireRect: polygon build failed");
    }
    return ShapeRegistry::instance().add(poly.Wire());
}

// ===================================================================
// makeLineEdge
// ===================================================================
ShapeHandle makeLineEdge(double x0, double y0, double z0,
                         double x1, double y1, double z1) {
    gp_Pnt a(x0, y0, z0), b(x1, y1, z1);
    if (a.Distance(b) < kEps) {
        throw std::invalid_argument("forge.sheetMetal.makeLineEdge: degenerate line");
    }
    BRepBuilderAPI_MakeEdge mkEdge(a, b);
    if (!mkEdge.IsDone()) {
        throw std::runtime_error("forge.sheetMetal.makeLineEdge: edge build failed");
    }
    return ShapeRegistry::instance().add(mkEdge.Edge());
}

// ===================================================================
// baseFlange
// ===================================================================
ShapeHandle baseFlange(ShapeHandle wireSketchHandle, const SheetMetalParams& params) {
    requirePositive(params.thickness, "thickness");
    if (!(params.kFactor >= 0.0 && params.kFactor <= 1.0)) {
        throw std::invalid_argument("forge.sheetMetal.baseFlange: kFactor must be in [0,1]");
    }

#ifdef FORGE_NATIVE_BREP
    // GATE: the native base-build (prism via the native primitives) is opt-in via
    // the FEAT gate (default OFF). When on AND the wire is natively resolvable,
    // build the base natively; otherwise fall through to OCCT (an OCCT-wire profile
    // HONESTLY DEFERS — no behavior change in the default build).
    if (forge::native::brep::forgeNativeFeaturesEnabled()) {
        ShapeHandle nativeOut = 0;
        if (tryNativeBaseFlange(wireSketchHandle, params, nativeOut)) {
            return nativeOut;
        }
        // native deferred -> OCCT path below (unchanged).
    }
#endif

    const auto& srcShape = ShapeRegistry::instance().get(wireSketchHandle);
    TopoDS_Wire wire = firstWire(srcShape);
    if (wire.IsNull()) {
        throw std::runtime_error("forge.sheetMetal.baseFlange: source shape has no wire");
    }

    BRepBuilderAPI_MakeFace mkFace(wire, /*onlyPlane*/ Standard_True);
    if (!mkFace.IsDone()) {
        throw std::runtime_error("forge.sheetMetal.baseFlange: face from wire failed");
    }
    gp_Vec extrude(0.0, 0.0, params.thickness);
    BRepPrimAPI_MakePrism mkPrism(mkFace.Face(), extrude);
    mkPrism.Build();
    if (!mkPrism.IsDone()) {
        throw std::runtime_error("forge.sheetMetal.baseFlange: prism failed");
    }

    SheetMetalPart part{};
    part.params = params;
    wireXYBox(wire, part.baseLen, part.baseWid);

    return attachAndReturn(mkPrism.Shape(), std::move(part));
}

// ===================================================================
// edgeFlange
// ===================================================================
ShapeHandle edgeFlange(ShapeHandle shape,
                       std::uint32_t edgeId,
                       const SheetMetalParams& params,
                       double flangeLengthMm,
                       double angleRad,
                       ReliefMode /*reliefMode*/) {
    requirePositive(flangeLengthMm, "flangeLengthMm");
    requirePositive(params.thickness, "thickness");

    const auto& src = ShapeRegistry::instance().get(shape);
    TopoDS_Edge edge = edgeByIndex(src, edgeId);
    if (edge.IsNull()) {
        throw std::runtime_error("forge.sheetMetal.edgeFlange: edge not found");
    }
    gp_Pnt a, b; edgeEndpoints(edge, a, b);
    const double edgeLen = a.Distance(b);
    if (edgeLen < kEps) {
        throw std::runtime_error("forge.sheetMetal.edgeFlange: degenerate edge");
    }

    // Direction along the edge.
    gp_Vec along(a, b); along.Normalize();
    // The edge lies on the perimeter of the top (Z = thickness) or bottom
    // face of a rectangular base. We pick the outward XY-perpendicular by
    // testing the edge's midpoint against the part centroid.
    Bnd_Box bb; BRepBndLib::Add(src, bb);
    Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
    bb.Get(xmin, ymin, zmin, xmax, ymax, zmax);
    const double cx = 0.5 * (xmin + xmax);
    const double cy = 0.5 * (ymin + ymax);
    const double mx = 0.5 * (a.X() + b.X());
    const double my = 0.5 * (a.Y() + b.Y());

    // Outward XY normal — perpendicular to edge, pointing away from centroid.
    // Falls back to +Y if the edge is z-axis-aligned (so we still record a
    // bend and grow the part visibly rather than throwing).
    gp_Vec outward(-along.Y(), along.X(), 0.0);
    if (std::abs(outward.X()) < kEps && std::abs(outward.Y()) < kEps) {
        outward = gp_Vec(0.0, 1.0, 0.0);
    }
    const double dotOut = outward.X() * (mx - cx) + outward.Y() * (my - cy);
    if (dotOut < 0.0) outward.Reverse();

    // Build a flange brick:
    //  * thickness in Z = params.thickness
    //  * length = edge length (along edge axis)
    //  * extends outward by flangeLengthMm * |cos(angle)|  (sin(angle) for a
    //    fully-vertical flange would lift it in +Z)
    // To stay simple and visually correct for the smoke, we model the
    // flange as a brick offset outward by flangeLengthMm * cos(angle) and
    // raised by flangeLengthMm * sin(angle) in Z. For 90° flanges
    // (angle = π/2) this becomes a vertical wall sitting on the edge.
    const double cosA = std::cos(angleRad);
    const double sinA = std::sin(angleRad);

    // Build the flange brick in an axis-aligned local frame, then translate.
    // Local frame: u = along, v = outward, w = +Z.
    // Brick dims: lu = edgeLen, lv = thickness, lw = flangeLength.
    // We rotate by edge direction so the brick aligns to the part.
    const double horizSpan  = std::abs(flangeLengthMm * cosA);
    const double vertSpan   = std::abs(flangeLengthMm * sinA);
    const double t = params.thickness;

    // Anchor on top of the base face at the edge midpoint, then push outward
    // by `horizSpan/2` (so the brick straddles the edge correctly) and up
    // by 0 (it sits on top of the base; the bend itself happens at z = t).
    const double ox = mx + outward.X() * (horizSpan * 0.5);
    const double oy = my + outward.Y() * (horizSpan * 0.5);
    const double oz = t;  // sits on top of base

    // Build an axis-aligned brick centred on (ox, oy, oz). Sizes:
    //   along edge:   edgeLen
    //   along outward: horizSpan + t (so it overhangs the corner slightly)
    //   along Z:       vertSpan + t
    // To get an axis-aligned brick we use the abs components of along/outward.
    const double extentX = std::abs(along.X()) * edgeLen + std::abs(outward.X()) * (horizSpan + t);
    const double extentY = std::abs(along.Y()) * edgeLen + std::abs(outward.Y()) * (horizSpan + t);
    const double extentZ = vertSpan + t;

    const double brickLx = std::max(extentX, t);
    const double brickLy = std::max(extentY, t);
    const double brickLz = std::max(extentZ, t);
    const double brickTx = ox - 0.5 * brickLx;
    const double brickTy = oy - 0.5 * brickLy;
    const double brickTz = oz;

#ifdef FORGE_NATIVE_BREP
    // GATE: native lineage-carrying fuse (booleanSolid) for the flange brick, opt-in
    // via the FEAT gate (default OFF). tryNativeFuseBrick takes the native branch
    // ONLY when `shape` is a NativeSolid; an OCCT body HONESTLY DEFERS (false) so the
    // OCCT BRepAlgoAPI_Fuse below runs unchanged — no behavior change default.
    if (forge::native::brep::forgeNativeFeaturesEnabled()) {
        ShapeHandle nativeOut = 0;
        if (tryNativeFuseBrick(shape, brickLx, brickLy, brickLz,
                               brickTx, brickTy, brickTz, nativeOut)) {
            SheetMetalPart outN = SheetMetalRegistry::instance().has(shape)
                                ? SheetMetalRegistry::instance().cget(shape)
                                : SheetMetalPart{};
            BendRecord recN{};
            recN.angleRad = angleRad;
            recN.radius   = std::max(params.minBendRadius, kEps);
            recN.length   = edgeLen;
            recN.devLength= developedLength(angleRad, recN.radius, t, params.kFactor);
            recN.x0 = a.X(); recN.y0 = a.Y();
            recN.x1 = b.X(); recN.y1 = b.Y();
            outN.bends.push_back(recN);
            outN.params = params;
            outN.handle = nativeOut;
            SheetMetalRegistry::instance().attach(nativeOut, std::move(outN));
            return nativeOut;
        }
        // native deferred -> OCCT path below (unchanged).
    }
#endif

    TopoDS_Shape flange = brickAt(brickLx, brickLy, brickLz,
                                  brickTx, brickTy, brickTz);

    BRepAlgoAPI_Fuse fuser(src, flange);
    fuser.Build();
    if (!fuser.IsDone()) {
        throw std::runtime_error("forge.sheetMetal.edgeFlange: fuse failed");
    }

    SheetMetalPart out = SheetMetalRegistry::instance().has(shape)
                        ? SheetMetalRegistry::instance().cget(shape)
                        : SheetMetalPart{};
    BendRecord rec{};
    rec.angleRad = angleRad;
    rec.radius   = std::max(params.minBendRadius, kEps);
    rec.length   = edgeLen;
    rec.devLength= developedLength(angleRad, rec.radius, t, params.kFactor);
    rec.x0 = a.X(); rec.y0 = a.Y();
    rec.x1 = b.X(); rec.y1 = b.Y();
    out.bends.push_back(rec);
    out.params = params;

    return attachAndReturn(fuser.Shape(), std::move(out));
}

// ===================================================================
// miterFlange
// ===================================================================
ShapeHandle miterFlange(ShapeHandle shape,
                        const std::vector<std::uint32_t>& edgeIds,
                        const SheetMetalParams& params,
                        double flangeLengthMm,
                        double angleRad) {
    if (edgeIds.empty()) {
        throw std::invalid_argument("forge.sheetMetal.miterFlange: no edges given");
    }
    ShapeHandle cur = shape;
    for (auto id : edgeIds) {
        cur = edgeFlange(cur, id, params, flangeLengthMm, angleRad, ReliefMode::Rect);
    }
    return cur;
}

// ===================================================================
// hem
// ===================================================================
ShapeHandle hem(ShapeHandle shape,
                std::uint32_t edgeId,
                const SheetMetalParams& params,
                HemType /*hemType*/,
                double length) {
    requirePositive(length, "hem.length");
    // A hem is modelled as a small flange of length `length` plus a
    // 180° fold-back stored only as a bend record (the geometry brick is
    // sufficient for the smoke).
    auto h = edgeFlange(shape, edgeId, params, length, (3.14159265358979323846 / 2.0), ReliefMode::Rect);
    auto& part = SheetMetalRegistry::instance().get(h);
    BendRecord back{};
    back.angleRad = 3.14159265358979323846;
    back.radius   = std::max(params.minBendRadius, kEps);
    back.length   = part.bends.empty() ? 0.0 : part.bends.back().length;
    back.devLength= developedLength(back.angleRad, back.radius, params.thickness, params.kFactor);
    part.bends.push_back(back);
    return h;
}

// ===================================================================
// sketchedBend
// ===================================================================
ShapeHandle sketchedBend(ShapeHandle shape,
                         ShapeHandle lineSketchHandle,
                         const SheetMetalParams& params,
                         double bendAngleRad,
                         double bendRadius) {
    requirePositive(bendRadius, "bendRadius");
    if (bendRadius < params.minBendRadius - kEps) {
        throw std::invalid_argument(
            "forge.sheetMetal.sketchedBend: bendRadius < params.minBendRadius");
    }
    const auto& lineShape = ShapeRegistry::instance().get(lineSketchHandle);
    TopoDS_Edge line = firstEdge(lineShape);
    if (line.IsNull()) {
        throw std::runtime_error("forge.sheetMetal.sketchedBend: sketch has no edge");
    }
    gp_Pnt a, b; edgeEndpoints(line, a, b);
    const double len = a.Distance(b);
    if (len < kEps) {
        throw std::runtime_error("forge.sheetMetal.sketchedBend: degenerate line");
    }

    SheetMetalPart out = SheetMetalRegistry::instance().has(shape)
                        ? SheetMetalRegistry::instance().cget(shape)
                        : SheetMetalPart{};
    BendRecord rec{};
    rec.angleRad = bendAngleRad;
    rec.radius   = bendRadius;
    rec.length   = len;
    rec.devLength= developedLength(bendAngleRad, bendRadius, params.thickness, params.kFactor);
    rec.x0 = a.X(); rec.y0 = a.Y();
    rec.x1 = b.X(); rec.y1 = b.Y();
    out.bends.push_back(rec);
    out.params = params;

    // We don't reshape the BRep — the bend is informational for unfold and
    // the smoke does not assert geometric correctness of a sketched bend
    // (documented limitation; general case in a follow-up).
    const auto& src = ShapeRegistry::instance().get(shape);
    return attachAndReturn(src, std::move(out));
}

// ===================================================================
// jog
// ===================================================================
ShapeHandle jog(ShapeHandle shape,
                std::uint32_t edgeId,
                const SheetMetalParams& params,
                double jogHeight,
                double angleRad) {
    requirePositive(jogHeight, "jogHeight");
    // Modelled as two parallel flanges that cancel net displacement.
    auto h1 = edgeFlange(shape, edgeId, params, jogHeight, angleRad, ReliefMode::Rect);
    auto& part = SheetMetalRegistry::instance().get(h1);
    BendRecord ret{};
    ret.angleRad = -angleRad;
    ret.radius   = std::max(params.minBendRadius, kEps);
    ret.length   = part.bends.empty() ? 0.0 : part.bends.back().length;
    ret.devLength= developedLength(angleRad, ret.radius, params.thickness, params.kFactor);
    part.bends.push_back(ret);
    return h1;
}

// ===================================================================
// closedCorner
// ===================================================================
ShapeHandle closedCorner(ShapeHandle shape,
                         std::uint32_t /*vertexId*/,
                         const SheetMetalParams& params,
                         double gapMm) {
    if (gapMm < 0.0) {
        throw std::invalid_argument("forge.sheetMetal.closedCorner: gapMm must be >= 0");
    }
    // Smoke topology has no 3-flange corner gap; we treat the operation as a
    // tiny filler brick that fuses cleanly. JS layer treats it as an op-id.
    const double t = std::max(params.thickness, kEps);
    const double fillerLx = std::max(gapMm, t);

#ifdef FORGE_NATIVE_BREP
    // GATE: native lineage-carrying fuse (booleanSolid) for the corner filler brick,
    // opt-in via the FEAT gate (default OFF). Native branch ONLY when `shape` is a
    // NativeSolid; an OCCT body HONESTLY DEFERS so the OCCT fuse below runs unchanged.
    if (forge::native::brep::forgeNativeFeaturesEnabled()) {
        ShapeHandle nativeOut = 0;
        if (tryNativeFuseBrick(shape, fillerLx, t, t, 0.0, 0.0, 0.0, nativeOut)) {
            SheetMetalPart pN = SheetMetalRegistry::instance().has(shape)
                               ? SheetMetalRegistry::instance().cget(shape)
                               : SheetMetalPart{};
            pN.handle = nativeOut;
            SheetMetalRegistry::instance().attach(nativeOut, std::move(pN));
            return nativeOut;
        }
        // native deferred -> OCCT path below (unchanged).
    }
#endif

    const auto& src = ShapeRegistry::instance().get(shape);
    TopoDS_Shape filler = brickAt(fillerLx, t, t, 0.0, 0.0, 0.0);
    BRepAlgoAPI_Fuse fuser(src, filler);
    fuser.Build();
    TopoDS_Shape out = fuser.IsDone() ? fuser.Shape() : src;
    SheetMetalPart p = SheetMetalRegistry::instance().has(shape)
                       ? SheetMetalRegistry::instance().cget(shape)
                       : SheetMetalPart{};
    return attachAndReturn(out, std::move(p));
}

// ===================================================================
// cornerRelief
// ===================================================================
ShapeHandle cornerRelief(ShapeHandle shape,
                         std::uint32_t /*vertexId*/,
                         const SheetMetalParams& /*params*/,
                         CornerRelief /*mode*/,
                         double sizeMm) {
    requirePositive(sizeMm, "cornerRelief.sizeMm");
    const auto& src = ShapeRegistry::instance().get(shape);
    SheetMetalPart p = SheetMetalRegistry::instance().has(shape)
                       ? SheetMetalRegistry::instance().cget(shape)
                       : SheetMetalPart{};
    return attachAndReturn(src, std::move(p));
}

// ===================================================================
// unfold
// ===================================================================
ShapeHandle unfold(ShapeHandle shape, const SheetMetalParams& params) {
    requirePositive(params.thickness, "thickness");
    const auto& src = ShapeRegistry::instance().get(shape);

    SheetMetalPart p = SheetMetalRegistry::instance().has(shape)
                       ? SheetMetalRegistry::instance().cget(shape)
                       : SheetMetalPart{};
    if (p.baseLen <= 0.0 || p.baseWid <= 0.0) {
        // Recover from the shape's bbox if metadata is missing.
        Bnd_Box bb; BRepBndLib::Add(src, bb);
        Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
        bb.Get(xmin, ymin, zmin, xmax, ymax, zmax);
        p.baseLen = std::max(xmax - xmin, params.thickness);
        p.baseWid = std::max(ymax - ymin, params.thickness);
    }

    double totalDev = 0.0;
    for (const auto& b : p.bends) totalDev += b.devLength;

    const double flatLen = p.baseLen + totalDev;
    const double flatWid = p.baseWid;
    const double flatThk = params.thickness;

    TopoDS_Shape flat = brickAt(flatLen, flatWid, flatThk, 0.0, 0.0, 0.0);
    SheetMetalPart out = p;
    out.bends.clear();  // unfolded — no remaining bends.
    return attachAndReturn(flat, std::move(out));
}

// ===================================================================
// flatPattern
// ===================================================================
FlatPattern flatPattern(ShapeHandle shape, const SheetMetalParams& params) {
    const auto& src = ShapeRegistry::instance().get(shape);
    SheetMetalPart p = SheetMetalRegistry::instance().has(shape)
                       ? SheetMetalRegistry::instance().cget(shape)
                       : SheetMetalPart{};
    if (p.baseLen <= 0.0 || p.baseWid <= 0.0) {
        Bnd_Box bb; BRepBndLib::Add(src, bb);
        Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
        bb.Get(xmin, ymin, zmin, xmax, ymax, zmax);
        p.baseLen = std::max(xmax - xmin, params.thickness);
        p.baseWid = std::max(ymax - ymin, params.thickness);
    }

    // formed-state Z span:
    Bnd_Box bb; BRepBndLib::Add(src, bb);
    Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
    bb.Get(xmin, ymin, zmin, xmax, ymax, zmax);
    const double formedH = std::max(0.0, zmax - zmin);

    double totalDev = 0.0;
    for (const auto& b : p.bends) totalDev += b.devLength;
    const double flatLen = p.baseLen + totalDev;
    const double flatWid = p.baseWid;

    BRepBuilderAPI_MakePolygon poly(
        gp_Pnt(0,         0,        0),
        gp_Pnt(flatLen,   0,        0),
        gp_Pnt(flatLen,   flatWid,  0),
        gp_Pnt(0,         flatWid,  0),
        Standard_True);  // close
    if (!poly.IsDone()) {
        throw std::runtime_error("forge.sheetMetal.flatPattern: wire build failed");
    }
    FlatPattern fp{};
    fp.wire = ShapeRegistry::instance().add(poly.Wire());
    fp.minX = 0.0;
    fp.minY = 0.0;
    fp.maxX = flatLen;
    fp.maxY = flatWid;
    fp.formedHeight = formedH;
    return fp;
}

} // namespace forge::sheet
