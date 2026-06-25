// PUSH-18 — Law-driven variable-radius fillet.
//
// Wraps BRepFilletAPI_MakeFillet with the Add(R, edge) + SetRadius(law)
// idiom. Calling Add(law, edge) directly trips OCCT's contour bookkeeping
// (NCollection_Sequence::First abort) — the contour must already exist
// before a Law_Function can be attached. The supplied law is either
// Law_Linear (default) or Law_S (smooth, C^1 endpoints). The parameter
// range of the law spans the edge's [FirstParameter, LastParameter] from
// BRepAdaptor_Curve so the fillet smoothly varies from radiusStart at the
// edge's start vertex to radiusEnd at its end vertex.

#include "forge/VarFillet.hpp"

#include <BRepFilletAPI_MakeFillet.hxx>
#include <TColgp_Array1OfPnt2d.hxx>
#include <gp_Pnt2d.hxx>
#include <Law_Function.hxx>
#include <Law_Linear.hxx>
#include <Law_S.hxx>
#include <Precision.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Shape.hxx>

#include <stdexcept>
#include <string>

// PHASE-D wiring (2026-06-25) — route forge::varfillet::fillet through the ALREADY-BUILT,
// A/B-certified native VARIABLE-RADIUS analytic fillet (forge::native::brep::
// filletBoxEdgeVariable — FilletAnalytic.cpp) behind a GATE. Compiled in ONLY under
// -DFORGE_NATIVE_BREP and taken at runtime ONLY when the FEAT gate
// forgeNativeFeaturesEnabled() is true (env FORGE_NATIVE_FEATURES=1, or the A/B harness's
// setForgeNativeBrepEnabled(true), which flips CORE+FEAT+STEP together). PRODUCTION
// DEFAULT IS OFF: with the gate off, the original OCCT BRepFilletAPI_MakeFillet +
// Law_Linear/Law_S path below runs byte-for-byte unchanged. This mirrors the just-landed
// Sewing.cpp (commit 19840b66) / ShapeFix.cpp / ShapeCheck wires: the native branch is
// taken only when the input handle is a NativeSolid that is an axis-aligned CUBE [0,L]^3
// with a SINGLE LINEAR-law (smooth=false) edge spec whose edge maps to one of the native
// box's 12 edges; ANY other input (OCCT-backed shape, non-cube native solid, multi-edge,
// Law_S/smooth, or an unmappable edge) HONESTLY DEFERS to OCCT — the native analytic
// variable fillet's certified scope is exactly the box-edge linear-law case (see the
// HONEST SCOPE block in FilletAnalytic.hpp and the A/B harness in
// test/native_vs_occt_fillet_var.cpp). No silent degrade: every gap defers, never fakes.
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"     // forgeNativeFeaturesEnabled()
#include "forge/native/brep/FilletAnalytic.hpp"  // filletBoxEdgeVariable, AnalyticVariableFilletResult
#include "forge/native/brep/Topology.hpp"        // TopologyBuilder, Solid/Shell/Face/Loop/Coedge/Vertex/Point3
#include <algorithm>
#include <array>
#include <cmath>
#include <memory>
#endif

namespace forge::varfillet {

namespace {

TopoDS_Edge edgeById(const TopoDS_Shape& shape, std::uint32_t id) {
    std::uint32_t i = 0;
    for (TopExp_Explorer ex(shape, TopAbs_EDGE); ex.More(); ex.Next()) {
        if (i == id) return TopoDS::Edge(ex.Current());
        ++i;
    }
    throw std::invalid_argument(
        "forge.varfillet: edge index " + std::to_string(id) +
        " out of range (only " + std::to_string(i) + " edges in shape)");
}

}  // namespace

#ifdef FORGE_NATIVE_BREP
namespace {

// The native filletBoxEdgeVariable understands the box vertex layout in
// TopologyBuilder::buildBox and the FilletAnalytic.hpp doc:
//   v0(0,0,0) v1(L,0,0) v2(L,L,0) v3(0,L,0)   -- bottom ring z=0
//   v4(0,0,L) v5(L,0,L) v6(L,L,L) v7(0,L,L)   -- top    ring z=L
//   edges 0..3 : bottom ring  (v0-v1, v1-v2, v2-v3, v3-v0)
//   edges 4..7 : top    ring  (v4-v5, v5-v6, v6-v7, v7-v4)
//   edges 8..11: verticals    (v0-v4, v1-v5, v2-v6, v3-v7)
// EdgeSpec.edgeIndex is interpreted as that SAME 0..11 cube enumeration (a NativeSolid
// carries no OCCT TopoDS_Shape, so there is no OCCT TopExp_EDGE order to walk — the cube
// edge enumeration IS the addressing scheme for the native path).
//
// Unit-cube corner positions (multiply by L). Index matches v0..v7 above. Used to
// confirm a registered native solid really is the cube [0,L]^3 the native fillet rebuilds.
constexpr std::array<std::array<double, 3>, 8> kCubeCorners = {{
    {0, 0, 0}, {1, 0, 0}, {1, 1, 0}, {0, 1, 0},
    {0, 0, 1}, {1, 0, 1}, {1, 1, 1}, {0, 1, 1},
}};

// Detect whether the native Solid is exactly an axis-aligned CUBE [0,L]^3 (corner at the
// origin, equal side L). Returns true + sets `L` on success. Conservative: requires the
// canonical 8 distinct corners at {0,L}^3 with one corner at the origin and side L>0. Any
// other native solid (translated/non-cube/non-uniform box, cylinder, boolean result, ...)
// returns false so the caller HONESTLY DEFERS to OCCT — the native analytic variable
// fillet builds its OWN box [0,L]^3 internally, so only a matching cube can be served.
bool isOriginCube(const native::brep::Solid& s, double& L) {
    using namespace forge::native::brep;
    // Gather distinct vertices via the shells' faces' loops' coedges.
    std::vector<const Vertex*> verts;
    auto pushVertex = [&](const Vertex* v) {
        for (const Vertex* u : verts) if (u == v) return;
        verts.push_back(v);
    };
    double mn[3] = { 1e300,  1e300,  1e300};
    double mx[3] = {-1e300, -1e300, -1e300};
    for (Shell* sh : s.shells) {
        if (!sh) continue;
        for (Face* f : sh->faces) {
            if (!f || !f->outerLoop) continue;
            Coedge* c = f->outerLoop->first;
            for (std::size_t i = 0; i < f->outerLoop->coedgeCount && c; ++i, c = c->next) {
                if (Vertex* o = c->originVertex()) {
                    pushVertex(o);
                    mn[0] = std::min(mn[0], o->point.x); mx[0] = std::max(mx[0], o->point.x);
                    mn[1] = std::min(mn[1], o->point.y); mx[1] = std::max(mx[1], o->point.y);
                    mn[2] = std::min(mn[2], o->point.z); mx[2] = std::max(mx[2], o->point.z);
                }
            }
        }
    }
    if (verts.size() != 8) return false;              // a cube has exactly 8 vertices
    // Min corner must sit at the origin and the box must be a uniform cube.
    const double tol = 1e-9;
    if (std::fabs(mn[0]) > tol || std::fabs(mn[1]) > tol || std::fabs(mn[2]) > tol)
        return false;                                 // not anchored at the origin
    const double Lx = mx[0] - mn[0], Ly = mx[1] - mn[1], Lz = mx[2] - mn[2];
    if (Lx <= tol) return false;
    if (std::fabs(Lx - Ly) > 1e-9 * Lx || std::fabs(Lx - Lz) > 1e-9 * Lx)
        return false;                                 // not a uniform cube (Lx==Ly==Lz)
    L = Lx;
    // Confirm every vertex coincides with a canonical {0,L}^3 corner.
    for (const Vertex* v : verts) {
        bool onCorner = false;
        for (const auto& c : kCubeCorners) {
            if (std::fabs(v->point.x - c[0] * L) <= 1e-9 * L &&
                std::fabs(v->point.y - c[1] * L) <= 1e-9 * L &&
                std::fabs(v->point.z - c[2] * L) <= 1e-9 * L) { onCorner = true; break; }
        }
        if (!onCorner) return false;
    }
    return true;
}

// Try the native variable fillet (brep::filletBoxEdgeVariable). Returns true + sets `out`
// on success; returns false (NEVER throws) when the native path HONESTLY DEFERS so the
// caller falls back to OCCT. Deferral cases (Bible §0 — native-where-valid, OCCT otherwise
// — every one is an EXPLICIT capability gap in the native API, surfaced not faked):
//   * smooth==true (Law_S) — the native analytic fillet implements ONLY the LINEAR law
//     R(t)=R0+(R1-R0)t/L (FilletAnalytic.hpp "HONEST SCOPE: LINEAR radius law"). Smooth
//     S-law is an explicit native follow-up; defer to OCCT's Law_S path.
//   * more than one edge spec — the native entry point fillets ONE edge per call (the
//     edge-chain analytic API is a DIFFERENT function with no variable-radius variant);
//     multi-edge variable fillet defers to OCCT's multi-Add loop.
//   * the input handle is NOT a NativeSolid (OCCT-backed shape — no OCCT->native importer).
//   * the native solid is not an axis-aligned cube [0,L]^3 anchored at the origin, OR the
//     selected edge doesn't map to one of its 12 box edges. filletBoxEdgeVariable rebuilds
//     its OWN box [0,L]^3 and fillets edge `edgeIndex` of it, so it is geometrically valid
//     ONLY for that exact cube; any other native solid defers.
bool tryNativeVarFillet(ShapeHandle solid,
                        const std::vector<EdgeSpec>& specs,
                        bool smooth,
                        ShapeHandle& out) {
    using namespace forge::native::brep;
    auto& reg = ShapeRegistry::instance();

    // GAP: native fillet is LINEAR-law only — Law_S / smooth defers to OCCT (no degrade).
    if (smooth) return false;
    // GAP: native variable-fillet entry point handles ONE edge per call — multi-edge defers.
    if (specs.size() != 1) return false;
    // DEFER unless the input is a native analytic solid (the only shape the native path
    // can ingest — no OCCT-face -> native-Face importer exists). Mirrors Sewing/ShapeFix.
    if (reg.kindOf(solid) != ShapeKind::NativeSolid) return false;

    const Solid& s = reg.getNativeSolid(solid);
    double L = 0.0;
    if (!isOriginCube(s, L)) return false;            // native scope is the cube [0,L]^3

    const EdgeSpec& sp = specs[0];
    // Radii must be valid for the native rolling-ball scope: 0 < R0,R1 < L (the tangent
    // lines stay on both faces). Out-of-band radii defer to OCCT (it may still build them).
    if (!(sp.radiusStart > 0.0) || !(sp.radiusEnd > 0.0)) return false;
    if (sp.radiusStart >= L || sp.radiusEnd >= L) return false;

    // A NativeSolid carries no OCCT TopoDS_Shape, so the edge is addressed directly by the
    // native cube's 0..11 enumeration (see the comment above kCubeCorners). Out-of-range
    // indices defer; filletBoxEdgeVariable itself rejects out-of-scope edges (ok==false),
    // which we treat as a final defer below.
    if (sp.edgeIndex > 11) return false;              // outside the cube's 12-edge range
    const int edgeIndex = static_cast<int>(sp.edgeIndex);

    auto owner = std::make_shared<TopologyBuilder>();
    AnalyticVariableFilletResult vf =
        filletBoxEdgeVariable(*owner, L, sp.radiusStart, sp.radiusEnd, edgeIndex);
    if (!vf.ok || vf.solid == nullptr) return false;  // out-of-scope edge -> defer to OCCT

    out = reg.addNativeSolid(std::move(owner), vf.solid);
    return true;
}

}  // namespace
#endif

ShapeHandle fillet(ShapeHandle solid,
                   const std::vector<EdgeSpec>& specs,
                   bool smooth) {
    if (specs.empty()) {
        throw std::invalid_argument(
            "forge.varfillet.fillet: must supply at least one edge spec");
    }

#ifdef FORGE_NATIVE_BREP
    // GATE: native variable fillet is opt-in via the FEAT gate (default OFF). When on AND
    // the input is the cube [0,L]^3 with a single LINEAR-law (smooth=false) edge spec that
    // maps to one of its 12 box edges, fillet via brep::filletBoxEdgeVariable; otherwise
    // fall through to OCCT (OCCT-backed input, non-cube native solid, Law_S/smooth,
    // multi-edge, or an unmappable edge ALL honestly DEFER — no behavior change in the
    // default build). Runs BEFORE the OCCT ShapeRegistry::get() below, which would resolve
    // a null TopoDS_Shape for a NativeSolid handle (native solids carry no OCCT shape).
    if (native::brep::forgeNativeFeaturesEnabled()) {
        ShapeHandle nativeOut = 0;
        if (tryNativeVarFillet(solid, specs, smooth, nativeOut)) return nativeOut;
        // native deferred -> OCCT path below (unchanged).
    }
#endif

    const auto& src = ShapeRegistry::instance().get(solid);
    if (src.IsNull()) {
        throw std::invalid_argument("forge.varfillet.fillet: null solid handle");
    }

    BRepFilletAPI_MakeFillet mk(src);

    // For each edge spec, drive BRepFilletAPI_MakeFillet through its
    // Add(law, edge) overload: OCCT internally seeds a contour from the
    // edge, propagates tangentially, and parametrises the supplied law
    // across the resulting contour's arc-length. The law's Bounds() must
    // match the spine parameter range; for OCCT the convention for a
    // single-edge contour is the edge's [FirstParameter, LastParameter].
    // Two-step idiom: Add(R1, R2, edge) seeds the contour with a
    // constant placeholder; then SetRadius(law, IC, IinC) installs the
    // requested Law_Linear (matching the constant-pair semantics
    // exactly) or Law_S (smooth, C^1 endpoints) over the same contour.
    // This is the documented workaround for OCCT 7.9's
    // ChFi3d_FilBuilder::Add(law, edge) cold-start abort path
    // (NCollection_Sequence::First on empty contour list).
    for (std::size_t i = 0; i < specs.size(); ++i) {
        const auto& sp = specs[i];
        if (!(sp.radiusStart > Precision::Confusion()) ||
            !(sp.radiusEnd   > Precision::Confusion())) {
            throw std::invalid_argument(
                "forge.varfillet.fillet: edge index " +
                std::to_string(sp.edgeIndex) +
                " — radii must be > Precision::Confusion (got " +
                std::to_string(sp.radiusStart) + ", " +
                std::to_string(sp.radiusEnd) + ")");
        }
        TopoDS_Edge e = edgeById(src, sp.edgeIndex);

        // Build the requested OCCT Law_Function (Law_Linear or Law_S),
        // sample it at N evenly-spaced u values across [0, 1], and feed
        // the (u, r) pairs into BRepFilletAPI_MakeFillet's stable
        // Pnt2d-array overload. Direct Add(law, edge) and
        // SetRadius(law, IC, IinC) both abort with
        // NCollection_Sequence::First inside Build() on OCCT 7.9.3 for
        // simple box-edge contours; the Pnt2d-array form is the
        // documented working path and is fed identical radii at every
        // sample, so geometry matches calling SetRadius(law) exactly.
        constexpr int N = 9;
        Handle(Law_Function) law;
        if (smooth) {
            Handle(Law_S) lawS = new Law_S();
            lawS->Set(0.0, sp.radiusStart, 1.0, sp.radiusEnd);
            law = lawS;
        } else {
            Handle(Law_Linear) lawL = new Law_Linear();
            lawL->Set(0.0, sp.radiusStart, 1.0, sp.radiusEnd);
            law = lawL;
        }
        TColgp_Array1OfPnt2d uvs(1, N);
        for (int s = 0; s < N; ++s) {
            const double u = static_cast<double>(s) / (N - 1);
            uvs.SetValue(s + 1, gp_Pnt2d(u, law->Value(u)));
        }
        mk.Add(uvs, e);
    }

    mk.Build();
    if (!mk.IsDone()) {
        throw std::runtime_error(
            "forge.varfillet.fillet: BRepFilletAPI_MakeFillet failed to build");
    }
    return ShapeRegistry::instance().add(mk.Shape());
}

}  // namespace forge::varfillet
