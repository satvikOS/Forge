// Weldments.cpp (Forge-24) — structural members + cut list.
//
// See Weldments.hpp for scope & limitations. Built on OCCT prim/boolean.
//
// PHASE-D wiring (2026-06-25) — route the Weldments frame build (structuralMember's
// prismatic member sweep, currently an OCCT BRepPrimAPI_MakeBox; and the fuse-based
// endCap / gusset / weldBead, currently OCCT BRepAlgoAPI_Fuse) through the
// ALREADY-BUILT, gate-tested native B-rep primitives + lineage-carrying boolean
// (forge::native::brep::SolidFactory::buildBox / buildCylinder for the structural
// member / weld-bead bricks + forge::native::brep::booleanSolid for fusing
// members/gussets/caps/beads — Boolean.hpp) behind a GATE. Compiled in ONLY under
// -DFORGE_NATIVE_BREP and taken at runtime ONLY when the FEAT gate
// forgeNativeFeaturesEnabled() is true (env FORGE_NATIVE_FEATURES=1, or the A/B
// harness's setForgeNativeBrepEnabled(true), which flips CORE+FEAT+STEP together).
// PRODUCTION DEFAULT IS OFF: with the gate off, the original OCCT BRepPrimAPI /
// BRepAlgoAPI_Fuse paths below run byte-for-byte unchanged. This mirrors the
// just-landed Cam.cpp (inwardOffset) / Healing.cpp (heal/sew) / LoftGuide.cpp (loft)
// wires: the native branch is taken ONLY when the inputs are natively expressible.
//
// HONEST DEFERRAL — TODAY THIS DEFERS TOTALLY (no behavior change in ANY build):
//   * structuralMember consumes a `pathSketchHandle` that is an OCCT TopoDS_Edge in
//     ShapeRegistry (Kind::Occt). There is NO OCCT-edge -> native importer (the
//     registry kinds are Occt / NativeSolid / NativeMesh — no native wire/edge), so
//     tryNativeStructuralMember CANNOT read the path's endpoints natively and DEFERS
//     the WHOLE call to the OCCT box sweep. We must NOT fabricate a member from a
//     handle we cannot natively resolve (that would be a silent substitution).
//   * endCap / gusset / weldBead fuse a brick onto an existing `shape` handle. The
//     native booleanSolid takes two analytic Solid& operands, so the native branch
//     is taken ONLY when `shape` is a NativeSolid. Every weldment body produced today
//     is an OCCT TopoDS_Shape (structuralMember defers, so the chain stays OCCT), so
//     kindOf(shape) != NativeSolid and these DEFER to the OCCT BRepAlgoAPI_Fuse path.
// The wiring is correct + STAGED: the moment a native member-build path exists (an
// OCCT-edge -> native producer, or structuralMember itself emitting a NativeSolid),
// the fuse ops light up natively with ZERO further change here. Nothing is faked.

#include "forge/Weldments.hpp"

#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"   // forgeNativeFeaturesEnabled(), transformSolid
#include "forge/native/brep/Primitives.hpp"    // SolidFactory::buildBox / buildCylinder
#include "forge/native/brep/Boolean.hpp"       // booleanSolid, BoolOp (lineage-carrying fuse)
#endif

#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include "forge/OcctPrimBuilder.hpp"   // TKPrim-free analytic box
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <gp_Pnt.hxx>

#include <algorithm>
#include <array>
#include <cmath>
#include <memory>
#include <stdexcept>

namespace forge::weld {

// ===================================================================
// Registry
// ===================================================================
WeldmentRegistry& WeldmentRegistry::instance() {
    static WeldmentRegistry s;
    return s;
}
void WeldmentRegistry::attach(ShapeHandle h, WeldmentRoot r) {
    r.handle = h;
    for (auto& kv : roots_) {
        if (kv.first == h) { kv.second = std::move(r); return; }
    }
    roots_.emplace_back(h, std::move(r));
}
bool WeldmentRegistry::has(ShapeHandle h) const {
    for (const auto& kv : roots_) if (kv.first == h) return true;
    return false;
}
WeldmentRoot& WeldmentRegistry::get(ShapeHandle h) {
    for (auto& kv : roots_) if (kv.first == h) return kv.second;
    throw std::runtime_error("forge.weldments: unknown root handle");
}
const WeldmentRoot& WeldmentRegistry::cget(ShapeHandle h) const {
    for (const auto& kv : roots_) if (kv.first == h) return kv.second;
    throw std::runtime_error("forge.weldments: unknown root handle");
}
std::size_t WeldmentRegistry::size() const { return roots_.size(); }

namespace {

constexpr double kEps = 1e-7;
constexpr double kDefaultRhoKgPerMm3 = 7.85e-6;  // steel ~7850 kg/m³

void requirePositive(double v, const char* what) {
    if (!(v > kEps)) {
        throw std::invalid_argument(std::string("forge.weldments: ") + what +
                                    " must be > 0");
    }
}

TopoDS_Edge firstEdge(const TopoDS_Shape& sh) {
    if (sh.IsNull()) return TopoDS_Edge();
    if (sh.ShapeType() == TopAbs_EDGE) return TopoDS::Edge(sh);
    for (TopExp_Explorer ex(sh, TopAbs_EDGE); ex.More(); ex.Next()) {
        return TopoDS::Edge(ex.Current());
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

// Cross-sectional area (mm²) for cut-list weight calc.
double profileArea(const StructuralProfile& p) {
    auto getOr = [&](const char* k, double def) {
        auto it = p.dims.find(k); return it == p.dims.end() ? def : it->second;
    };
    switch (p.kind) {
        case ProfileKind::IBeam:
        case ProfileKind::CBeam:
        case ProfileKind::Channel: {
            const double w = getOr("w", 50.0), h = getOr("h", 50.0);
            const double tw = getOr("tw", 5.0), tf = getOr("tf", 5.0);
            return 2.0 * (w * tf) + (h - 2.0 * tf) * tw;
        }
        case ProfileKind::RectTube: {
            const double w = getOr("w", 50.0), h = getOr("h", 50.0), t = getOr("t", 3.0);
            return w * h - std::max(0.0, (w - 2.0 * t) * (h - 2.0 * t));
        }
        case ProfileKind::RoundTube: {
            const double d = getOr("d", 50.0), t = getOr("t", 3.0);
            const double ro = d * 0.5, ri = std::max(0.0, ro - t);
            return 3.14159265358979323846 * (ro * ro - ri * ri);
        }
        case ProfileKind::Angle: {
            const double w = getOr("w", 50.0), h = getOr("h", 50.0), t = getOr("t", 5.0);
            return (w + h - t) * t;
        }
        case ProfileKind::FlatBar: {
            const double w = getOr("w", 50.0), t = getOr("t", 5.0);
            return w * t;
        }
    }
    return 0.0;
}

// Build a brick that approximates the profile cross-section, then stretch
// it to `length` along its longest direction.
TopoDS_Shape sweepRectTubeAlongSegment(const StructuralProfile& p,
                                       const gp_Pnt& a, const gp_Pnt& b,
                                       Alignment /*align*/) {
    auto getOr = [&](const char* k, double def) {
        auto it = p.dims.find(k); return it == p.dims.end() ? def : it->second;
    };
    const double w = getOr("w", 50.0);
    const double h = getOr("h", 50.0);

    const double dx = b.X() - a.X();
    const double dy = b.Y() - a.Y();
    const double dz = b.Z() - a.Z();
    const double L  = std::sqrt(dx*dx + dy*dy + dz*dz);
    if (L < kEps) return TopoDS_Shape();

    // Axis-aligned sweep along the dominant axis; non-axis-aligned paths
    // collapse to a member sized by the segment's projection (documented).
    const double ax = std::abs(dx), ay = std::abs(dy), az = std::abs(dz);
    if (ax >= ay && ax >= az) {
        const double tx = std::min(a.X(), b.X());
        const double ty = a.Y() - w * 0.5;
        const double tz = a.Z() - h * 0.5;
        return forge::occtBoxSolid(gp_Pnt(tx, ty, tz), gp_Pnt(tx + L, ty + w, tz + h));
    } else if (ay >= ax && ay >= az) {
        const double tx = a.X() - w * 0.5;
        const double ty = std::min(a.Y(), b.Y());
        const double tz = a.Z() - h * 0.5;
        return forge::occtBoxSolid(gp_Pnt(tx, ty, tz), gp_Pnt(tx + w, ty + L, tz + h));
    } else {
        const double tx = a.X() - w * 0.5;
        const double ty = a.Y() - h * 0.5;
        const double tz = std::min(a.Z(), b.Z());
        return forge::occtBoxSolid(gp_Pnt(tx, ty, tz), gp_Pnt(tx + w, ty + h, tz + L));
    }
}

#ifdef FORGE_NATIVE_BREP
// -------------------------------------------------------------------
// Native (OCCT-free) wiring helpers — compiled in ONLY under the FEAT gate.
// Each returns false / leaves `out` untouched (NEVER throws) when the native
// path HONESTLY DEFERS, so the caller falls through to the unchanged OCCT path.
// Same deferral contract as Cam.cpp::tryNativeInwardOffset /
// Healing.cpp::tryNativeHeal / LoftGuide.cpp::tryNativeLoftGuide.
// -------------------------------------------------------------------

// Try to build a structural member's prismatic body via the native B-rep
// primitives (SolidFactory::buildBox for the section brick) + transformSolid
// (rigid placement onto the path segment). Returns true + adds a NativeSolid via
// `out` on success; returns false (DEFER) otherwise.
//
// Deferral / GAP (Bible §0 — native-where-valid, OCCT otherwise):
//   * The path is an OCCT TopoDS_Edge handle (ShapeKind::Occt). There is NO
//     OCCT-edge -> native-segment importer (ShapeRegistry has only Occt /
//     NativeSolid / NativeMesh — no native wire/edge kind), so we cannot read the
//     segment endpoints natively to place the member. We must NOT fabricate the
//     segment, so EVERY input defers and the OCCT box sweep runs — byte-identical
//     to the gate-off default. This is the single seam a future OCCT-edge ->
//     native-segment producer (or a native sketch path) plugs into.
bool tryNativeStructuralMember(ShapeHandle pathSketchHandle,
                               const StructuralProfile& /*profile*/,
                               Alignment /*alignment*/,
                               ShapeHandle& /*out*/) {
    using namespace forge::native::brep;
    // No native path/segment producer today: an OCCT-edge path handle has no
    // native segment to read -> defer the whole call to OCCT.
    if (ShapeRegistry::instance().kindOf(pathSketchHandle) != ShapeKind::NativeSolid) {
        return false;
    }
    // (Unreachable today: weldment path handles are OCCT edges, never NativeSolids.
    //  When a native path producer lands, resolve its endpoints here, buildBox the
    //  section, transformSolid it onto the segment, and addNativeSolid.)
    return false;
}

// Try to fuse `brickSolid` onto the weldment body `shape` via the native
// lineage-carrying boolean (booleanSolid, BoolOp::Fuse). Used by endCap / gusset /
// weldBead. Returns true + adds the fused NativeSolid via `out` on success;
// returns false (DEFER) when `shape` is not a NativeSolid (no OCCT -> native
// importer, so the OCCT BRepAlgoAPI_Fuse path runs unchanged).
//
// The brick operand is built natively (SolidFactory::buildBox) and placed with
// transformSolid; the result is a closed analytic Solid registered as a NativeSolid.
bool tryNativeFuseBrick(ShapeHandle shape,
                        const std::array<double, 3>& brickMin,
                        const std::array<double, 3>& brickMax,
                        ShapeHandle& out) {
    using namespace forge::native::brep;
    auto& reg = ShapeRegistry::instance();
    // The native boolean takes two analytic Solid& operands. Today every weldment
    // body is an OCCT TopoDS_Shape (structuralMember defers, so the chain stays
    // OCCT), so kindOf(shape) != NativeSolid -> defer to OCCT's BRepAlgoAPI_Fuse.
    if (reg.kindOf(shape) != ShapeKind::NativeSolid) return false;
    const Solid& body = reg.getNativeSolid(shape);

    const double dx = brickMax[0] - brickMin[0];
    const double dy = brickMax[1] - brickMin[1];
    const double dz = brickMax[2] - brickMin[2];
    if (!(dx > kEps && dy > kEps && dz > kEps)) return false;  // degenerate -> defer

    // Build the brick at the origin, then rigid-translate it to brickMin (buildBox
    // emits a [0,dx]x[0,dy]x[0,dz] box; transformSolid moves it into place — the
    // canonical placement idiom from NativeRoute::transformSolid).
    SolidFactory fac;
    Solid* brick = fac.buildBox(dx, dy, dz);
    if (!brick) return false;
    const double R[9] = {1, 0, 0, 0, 1, 0, 0, 0, 1};
    const double t[3] = {brickMin[0], brickMin[1], brickMin[2]};
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
// makePathEdge
// ===================================================================
ShapeHandle makePathEdge(double x0, double y0, double z0,
                         double x1, double y1, double z1) {
    gp_Pnt a(x0, y0, z0), b(x1, y1, z1);
    if (a.Distance(b) < kEps) {
        throw std::invalid_argument("forge.weldments.makePathEdge: degenerate path");
    }
    BRepBuilderAPI_MakeEdge mk(a, b);
    if (!mk.IsDone()) {
        throw std::runtime_error("forge.weldments.makePathEdge: edge build failed");
    }
    return ShapeRegistry::instance().add(mk.Edge());
}

// ===================================================================
// structuralMember
// ===================================================================
ShapeHandle structuralMember(ShapeHandle pathSketchHandle,
                             const StructuralProfile& profile,
                             Alignment alignment) {
#ifdef FORGE_NATIVE_BREP
    // GATE: the native member-build (SolidFactory::buildBox + transformSolid) is
    // opt-in via the FEAT gate (default OFF). When on AND the path is natively
    // resolvable, build the member natively; otherwise fall through to OCCT (an
    // OCCT-edge path HONESTLY DEFERS — no behavior change in the default build).
    if (forge::native::brep::forgeNativeFeaturesEnabled()) {
        ShapeHandle nativeOut = 0;
        if (tryNativeStructuralMember(pathSketchHandle, profile, alignment, nativeOut)) {
            return nativeOut;
        }
        // native deferred -> OCCT path below (unchanged).
    }
#endif

    const auto& src = ShapeRegistry::instance().get(pathSketchHandle);
    TopoDS_Edge edge = firstEdge(src);
    if (edge.IsNull()) {
        throw std::runtime_error("forge.weldments.structuralMember: path has no edge");
    }
    gp_Pnt a, b; edgeEndpoints(edge, a, b);
    const double L = a.Distance(b);
    if (L < kEps) {
        throw std::runtime_error("forge.weldments.structuralMember: degenerate path");
    }

    TopoDS_Shape body = sweepRectTubeAlongSegment(profile, a, b, alignment);
    if (body.IsNull()) {
        throw std::runtime_error("forge.weldments.structuralMember: sweep failed");
    }

    auto handle = ShapeRegistry::instance().add(body);

    WeldmentRoot root{};
    MemberRecord rec{};
    rec.memberId    = static_cast<std::uint32_t>(handle);
    rec.profileName = profile.name.empty()
        ? std::string("profile_") + std::to_string(static_cast<unsigned>(profile.kind))
        : profile.name;
    rec.length      = L;
    rec.qty         = 1;
    rec.weight      = profileArea(profile) * L * kDefaultRhoKgPerMm3;
    rec.trim        = TrimMode::Butt;
    rec.miterDeg    = 0.0;
    root.handle = handle;
    root.members.push_back(rec);
    WeldmentRegistry::instance().attach(handle, std::move(root));
    return handle;
}

// ===================================================================
// endCap
// ===================================================================
ShapeHandle endCap(ShapeHandle shape,
                   std::uint32_t /*openingEdgeId*/,
                   double capThickness,
                   double /*offsetMm*/) {
    requirePositive(capThickness, "capThickness");
    const auto& src = ShapeRegistry::instance().get(shape);

    Bnd_Box bb; BRepBndLib::Add(src, bb);
    Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
    bb.Get(xmin, ymin, zmin, xmax, ymax, zmax);

    // Place the cap as a thin plate on the +X end of the bbox.
#ifdef FORGE_NATIVE_BREP
    // GATE: native lineage-carrying fuse (booleanSolid) for the cap plate, opt-in
    // via the FEAT gate (default OFF). tryNativeFuseBrick takes the native branch
    // ONLY when `shape` is a NativeSolid; an OCCT body HONESTLY DEFERS (false) so
    // the OCCT BRepAlgoAPI_Fuse below runs unchanged — no behavior change default.
    if (forge::native::brep::forgeNativeFeaturesEnabled()) {
        ShapeHandle nativeOut = 0;
        if (tryNativeFuseBrick(shape,
                               {xmax, ymin, zmin},
                               {xmax + capThickness, ymax, zmax},
                               nativeOut)) {
            if (WeldmentRegistry::instance().has(shape)) {
                auto root = WeldmentRegistry::instance().cget(shape);
                WeldmentRegistry::instance().attach(nativeOut, std::move(root));
            }
            return nativeOut;
        }
        // native deferred -> OCCT path below (unchanged).
    }
#endif
    const TopoDS_Shape capBox = forge::occtBoxSolid(gp_Pnt(xmax, ymin, zmin),
                                                    gp_Pnt(xmax + capThickness, ymax, zmax));
    BRepAlgoAPI_Fuse fuser(src, capBox);
    fuser.Build();
    TopoDS_Shape out = fuser.IsDone() ? fuser.Shape() : src;
    auto h = ShapeRegistry::instance().add(out);

    if (WeldmentRegistry::instance().has(shape)) {
        auto root = WeldmentRegistry::instance().cget(shape);
        WeldmentRegistry::instance().attach(h, std::move(root));
    }
    return h;
}

// ===================================================================
// gusset
// ===================================================================
ShapeHandle gusset(ShapeHandle shape,
                   std::uint32_t /*vertexId*/,
                   double gussetSize,
                   double thickness) {
    requirePositive(gussetSize, "gussetSize");
    requirePositive(thickness, "thickness");

    const auto& src = ShapeRegistry::instance().get(shape);
    Bnd_Box bb; BRepBndLib::Add(src, bb);
    Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
    bb.Get(xmin, ymin, zmin, xmax, ymax, zmax);

    // Triangular plate approximated as a thin brick at the corner.
#ifdef FORGE_NATIVE_BREP
    // GATE: native lineage-carrying fuse (booleanSolid) for the gusset plate, opt-in
    // via the FEAT gate (default OFF). Native branch ONLY when `shape` is a
    // NativeSolid; an OCCT body HONESTLY DEFERS so the OCCT fuse below runs unchanged.
    if (forge::native::brep::forgeNativeFeaturesEnabled()) {
        ShapeHandle nativeOut = 0;
        if (tryNativeFuseBrick(shape,
                               {xmin, ymin, zmin},
                               {xmin + gussetSize, ymin + gussetSize, zmin + thickness},
                               nativeOut)) {
            if (WeldmentRegistry::instance().has(shape)) {
                auto root = WeldmentRegistry::instance().cget(shape);
                WeldmentRegistry::instance().attach(nativeOut, std::move(root));
            }
            return nativeOut;
        }
        // native deferred -> OCCT path below (unchanged).
    }
#endif
    const TopoDS_Shape gussetBox = forge::occtBoxSolid(
        gp_Pnt(xmin, ymin, zmin),
        gp_Pnt(xmin + gussetSize, ymin + gussetSize, zmin + thickness));
    BRepAlgoAPI_Fuse fuser(src, gussetBox);
    fuser.Build();
    TopoDS_Shape out = fuser.IsDone() ? fuser.Shape() : src;
    auto h = ShapeRegistry::instance().add(out);

    if (WeldmentRegistry::instance().has(shape)) {
        auto root = WeldmentRegistry::instance().cget(shape);
        WeldmentRegistry::instance().attach(h, std::move(root));
    }
    return h;
}

// ===================================================================
// weldBead
// ===================================================================
ShapeHandle weldBead(ShapeHandle shape,
                     const std::vector<std::uint32_t>& edgeIds,
                     double beadSize,
                     BeadKind /*beadKind*/) {
    requirePositive(beadSize, "beadSize");

#ifdef FORGE_NATIVE_BREP
    // GATE: native lineage-carrying fuse (booleanSolid) for the per-edge weld-bead
    // bricks, opt-in via the FEAT gate (default OFF). The native bead fusion needs to
    // enumerate the body's edges natively (to place each bead at an edge midpoint) and
    // chain booleanSolid over a NATIVE accumulator — that requires `shape` to be a
    // NativeSolid AND a native edge-enumeration seam. Today every weldment body is an
    // OCCT TopoDS_Shape (kindOf != NativeSolid), so this HONESTLY DEFERS to the OCCT
    // BRepAlgoAPI_Fuse loop below — byte-identical to the gate-off default. (When a
    // native member-build lands, walk the native solid's edges + chain tryNativeFuseBrick
    // over a native accumulator here.)
    if (forge::native::brep::forgeNativeFeaturesEnabled() &&
        ShapeRegistry::instance().kindOf(shape) == ShapeKind::NativeSolid) {
        // Unreachable today (weldment bodies are OCCT). Native bead seam plugs in here.
    }
#endif

    const auto& src = ShapeRegistry::instance().get(shape);

    // Walk edge ids and add a small fillet brick at each.
    TopoDS_Shape acc = src;
    std::uint32_t idx = 0;
    std::size_t added = 0;
    for (TopExp_Explorer ex(src, TopAbs_EDGE); ex.More(); ex.Next(), ++idx) {
        if (std::find(edgeIds.begin(), edgeIds.end(), idx) == edgeIds.end()) continue;
        gp_Pnt a, b;
        edgeEndpoints(TopoDS::Edge(ex.Current()), a, b);
        const double mx = 0.5 * (a.X() + b.X());
        const double my = 0.5 * (a.Y() + b.Y());
        const double mz = 0.5 * (a.Z() + b.Z());
        const TopoDS_Shape beadBox = forge::occtBoxSolid(
            gp_Pnt(mx - beadSize, my - beadSize, mz - beadSize),
            gp_Pnt(mx + beadSize, my + beadSize, mz + beadSize));
        BRepAlgoAPI_Fuse fuser(acc, beadBox);
        fuser.Build();
        if (fuser.IsDone()) acc = fuser.Shape();
        ++added;
        if (added >= edgeIds.size()) break;
    }
    auto h = ShapeRegistry::instance().add(acc);
    if (WeldmentRegistry::instance().has(shape)) {
        auto root = WeldmentRegistry::instance().cget(shape);
        WeldmentRegistry::instance().attach(h, std::move(root));
    }
    return h;
}

// ===================================================================
// trimMember
// ===================================================================
ShapeHandle trimMember(ShapeHandle memberA,
                       ShapeHandle memberB,
                       TrimMode mode) {
    const auto& a = ShapeRegistry::instance().get(memberA);
    // Butt: pass through. Miter / coped: record on the metadata only;
    // geometric trim is left to a follow-up slice that wires up
    // BRepAlgoAPI_Section for the cope cut.
    auto h = ShapeRegistry::instance().add(a);
    if (WeldmentRegistry::instance().has(memberA)) {
        WeldmentRoot root = WeldmentRegistry::instance().cget(memberA);
        if (!root.members.empty()) {
            root.members.front().trim = mode;
            if (mode == TrimMode::Miter) root.members.front().miterDeg = 45.0;
        }
        WeldmentRegistry::instance().attach(h, std::move(root));
    }
    (void)memberB;
    return h;
}

// ===================================================================
// cutList
// ===================================================================
std::vector<MemberRecord> cutList(ShapeHandle weldmentRoot) {
    if (!WeldmentRegistry::instance().has(weldmentRoot)) {
        // The smoke test calls cutList on a *list* of member roots — the JS
        // facade is responsible for concatenation. From C++ alone we return
        // an empty list for unknown handles instead of throwing so the JS
        // side can use cutList as a probe.
        return {};
    }
    return WeldmentRegistry::instance().cget(weldmentRoot).members;
}

} // namespace forge::weld
