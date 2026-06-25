#include "forge/InterferenceDetection.hpp"

#include "forge/AssemblyHierarchy.hpp"
#include "forge/ShapeRegistry.hpp"

#include <BRepAlgoAPI_Common.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <gp_GTrsf.hxx>
#include <gp_Trsf.hxx>
#include <gp_Mat.hxx>
#include <gp_XYZ.hxx>
#include <TopoDS_Shape.hxx>

#include <algorithm>
#include <memory>
#include <stdexcept>

// PHASE-D wiring (2026-06-25) — route the ONE genuine OCCT geometry op in this
// module, detectInterference's NARROW-PHASE clash test (the per-candidate-pair
// solid–solid intersection BRepAlgoAPI_Common + GProp_GProps overlap-volume
// measure), through the ALREADY-BUILT in-house native B-rep family behind a GATE:
//   * the intersection itself  -> forge::native::brep::booleanSolid(A,B,Common)
//     (Boolean.hpp — the OCCT-free analytic Fuse/Cut/Common; it now also carries
//     boolean LINEAGE: modifiedFromA/B, deletedA/B, generatedEdges — unused by an
//     interference test, which only needs "does A∩B have non-zero volume?").
//   * the overlap-volume measure -> forge::native::brep::massProperties(result)
//     (MassProps.hpp — the exact divergence-theorem volume; bit-exact for the
//     planar/quadric mechanical family). Volume below kInterferenceMinVolume ==
//     touch/clearance, so the pair is dropped exactly as the OCCT path drops it.
// Each instance's WORLD solid is produced by transformSolid (NativeRoute.hpp —
// the analytic R*p+t clone), the native analogue of worldShape()'s OCCT
// BRepBuilderAPI_Transform: the world Transform4x4's upper-left 3×3 is the
// rotation R[9] and its 4th column (m[3],m[7],m[11]) the translation t[3], the
// SAME row-major decomposition toOcctTrsf() feeds gp_Trsf::SetValues.
//
// Compiled in ONLY under -DFORGE_NATIVE_BREP and taken at runtime ONLY when the
// FEAT gate forgeNativeFeaturesEnabled() is true (env FORGE_NATIVE_FEATURES=1, or
// the A/B harness's setForgeNativeBrepEnabled(true), which flips CORE+FEAT+STEP
// together). PRODUCTION DEFAULT IS OFF: with the gate off the original OCCT
// narrow phase below (worldShape -> BRepAlgoAPI_Common -> GProp VolumeProperties)
// runs byte-for-byte unchanged. Mirrors the just-landed CamAdvanced.cpp
// (generateCmm) / Cam.cpp (inwardOffset) / Healing.cpp (heal/sew) wires:
// tryNativeInterferencePair takes the native branch ONLY when BOTH instances'
// components are NativeSolid handles (there is NO OCCT-shape -> native-Solid
// importer, so an OCCT-backed component HONESTLY DEFERS to OCCT — the broad phase,
// pair enumeration, dedup + sort all stay on the existing path). It returns false
// (NEVER throws) on every deferral, so the gate-off default and the gate-on
// OCCT-input path are both identical to today.
//
// STAGED — DEFERS TOTALLY TODAY. The live assembly pipeline (Booleans.cpp /
// Primitives.cpp on the default OCCT backend) registers Kind::Occt components, so
// `ComponentRegistry::getComponent(id)` resolves to an OCCT handle for every
// instance the API builds today; tryNativeInterferencePair therefore returns
// false on the kindOf() guard and the OCCT narrow phase runs — the gate-on result
// is byte-identical to gate-off RIGHT NOW. The native branch becomes LIVE only
// once assemblies are populated from native-core bodies (FORGE_NATIVE_BREP=1
// makeBox/.../cut), at which point the SAME wired path measures the clash with
// booleanSolid+massProperties. This is the correct, honest staging — wired now,
// exercised when native components exist — NOT a fabricated active path.
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"   // forgeNativeFeaturesEnabled(), transformSolid
#include "forge/native/brep/Boolean.hpp"       // booleanSolid, BoolOp::Common, BooleanResult
#include "forge/native/brep/MassProps.hpp"     // massProperties (exact overlap volume)
#include "forge/native/brep/Topology.hpp"      // brep::Solid, TopologyBuilder
#endif

namespace forge {

namespace {

// Inflate an AABB by `tol` on every face. We use this to widen the
// broad-phase so near-touches inside `tolerance` still get evaluated by
// the exact boolean engine.
AABB inflated(const AABB& a, double tol) {
    return AABB{
        a.minX - tol, a.minY - tol, a.minZ - tol,
        a.maxX + tol, a.maxY + tol, a.maxZ + tol,
    };
}

// Convert our row-major 4×4 into an OCCT gp_Trsf, when the upper-left 3×3
// is an orthonormal rotation. Forge's assembly transforms are built that
// way (Rodrigues × translation) so this is always safe inside the
// assembly subsystem.
gp_Trsf toOcctTrsf(const Transform4x4& m) {
    gp_Trsf t;
    // SetValues takes row-major 3×4: (a11..a14 / a21..a24 / a31..a34)
    t.SetValues(
        m.m[0],  m.m[1],  m.m[2],  m.m[3],
        m.m[4],  m.m[5],  m.m[6],  m.m[7],
        m.m[8],  m.m[9],  m.m[10], m.m[11]);
    return t;
}

TopoDS_Shape worldShape(InstanceId id) {
    const auto compHandle = ComponentRegistry::instance().getComponent(id);
    const auto& shape = ShapeRegistry::instance().get(compHandle);
    const auto x = AssemblyHierarchy::instance().worldTransform(id);
    gp_Trsf tr = toOcctTrsf(x);
    BRepBuilderAPI_Transform mover(shape, tr, /*copy*/ Standard_True);
    return mover.Shape();
}

double solidVolume(const TopoDS_Shape& s) {
    if (s.IsNull()) return 0.0;
    GProp_GProps props;
    BRepGProp::VolumeProperties(s, props);
    const double v = props.Mass();
    return std::abs(v);
}

#ifdef FORGE_NATIVE_BREP
// Try the native analytic clash test (brep::booleanSolid Common + massProperties)
// for ONE candidate pair. On success sets `volOut` to the exact overlap volume and
// returns true; returns false (NEVER throws) when the native path HONESTLY DEFERS
// so the caller falls through to the OCCT BRepAlgoAPI_Common / GProp narrow phase.
// Same deferral contract as Cam.cpp::tryNativeInwardOffset / Healing.cpp::tryNativeHeal.
//
// Deferral / GAP cases (Bible §0 — native-where-valid, OCCT otherwise):
//   * EITHER instance's component is NOT a NativeSolid (an OCCT-backed body, or a
//     NativeMesh fillet/chamfer result): there is NO OCCT-shape -> native-Solid
//     importer, and a NativeMesh has no analytic Solid for booleanSolid, so we MUST
//     NOT substitute or mix backends — defer the WHOLE pair to OCCT, exactly as the
//     gate-off default behaves. (Today EVERY live component is OCCT-backed, so this
//     guard fires for every pair and the call defers totally — staged, see header.)
//   * booleanSolid returns ok==false (a tangency/degenerate clash with no closed
//     2-manifold result, or an honest SSI gap): defer so OCCT's own narrow phase —
//     which owns its own degenerate handling (op.IsDone()/IsNull() skips) — decides,
//     matching today.
//
// The world solid of each instance is the analytic R*p+t clone (transformSolid),
// the native analogue of worldShape()'s OCCT BRepBuilderAPI_Transform: R is the
// world Transform4x4's upper-left 3×3 (row-major m[0,1,2 / 4,5,6 / 8,9,10]) and t
// its 4th column (m[3],m[7],m[11]) — the SAME decomposition toOcctTrsf feeds
// gp_Trsf::SetValues. The overlap is then booleanSolid(A,B,Common) and the volume
// is massProperties(result).volume (|·| for sign-safety, mirroring solidVolume).
bool tryNativeInterferencePair(InstanceId a, InstanceId b, double& volOut) {
    using namespace forge::native::brep;
    auto& shapes = ShapeRegistry::instance();
    auto& comps  = ComponentRegistry::instance();

    const ShapeHandle ha = comps.getComponent(a);
    const ShapeHandle hb = comps.getComponent(b);
    // Both components must be analytic native solids (no OCCT->native importer).
    if (shapes.kindOf(ha) != ShapeKind::NativeSolid ||
        shapes.kindOf(hb) != ShapeKind::NativeSolid) {
        return false;  // OCCT-backed (or mesh) input -> defer to OCCT narrow phase
    }

    // World-space analytic clones via the SAME row-major (R,t) split worldShape's
    // toOcctTrsf uses: upper-left 3×3 -> R, 4th column -> t.
    const Transform4x4 xa = AssemblyHierarchy::instance().worldTransform(a);
    const Transform4x4 xb = AssemblyHierarchy::instance().worldTransform(b);
    const double Ra[9] = { xa.m[0], xa.m[1], xa.m[2],
                           xa.m[4], xa.m[5], xa.m[6],
                           xa.m[8], xa.m[9], xa.m[10] };
    const double ta[3] = { xa.m[3], xa.m[7], xa.m[11] };
    const double Rb[9] = { xb.m[0], xb.m[1], xb.m[2],
                           xb.m[4], xb.m[5], xb.m[6],
                           xb.m[8], xb.m[9], xb.m[10] };
    const double tb[3] = { xb.m[3], xb.m[7], xb.m[11] };

    std::shared_ptr<TopologyBuilder> ownerA, ownerB;
    Solid* wa = transformSolid(shapes.getNativeSolid(ha), Ra, ta, ownerA);
    Solid* wb = transformSolid(shapes.getNativeSolid(hb), Rb, tb, ownerB);
    if (!wa || !wb) return false;  // clone gap -> defer

    // Clash = does A∩B have non-zero volume. Common boolean + exact mass props.
    BooleanResult inter = booleanSolid(*wa, *wb, BoolOp::Common);
    if (!inter.ok || inter.solid == nullptr) {
        return false;  // honest boolean gap -> defer to OCCT narrow phase
    }
    const MassProps mp = massProperties(*inter.solid);
    volOut = std::abs(mp.volume);
    return true;
}
#endif

} // namespace

std::vector<InterferencePair> detectInterference(
    const std::vector<InstanceId>& instances,
    double tolerance) {
    std::vector<InterferencePair> out;
    if (instances.size() < 2) return out;

    // ---- broad phase: cache inflated world AABBs ------------------
    std::vector<AABB> boxes;
    boxes.reserve(instances.size());
    for (auto id : instances) {
        if (!ComponentRegistry::instance().exists(id)) {
            throw std::invalid_argument(
                "detectInterference: instance does not exist");
        }
        boxes.push_back(inflated(ComponentRegistry::instance().getAABB(id),
                                 std::max(0.0, tolerance)));
    }

    // ---- pair enumeration ------------------------------------------
    // The general assembly target for Forge-35 is small (≤ a few hundred
    // moving parts at a time). A direct O(N²) AABB sweep on this scale
    // beats the cost of building a one-shot BVH for what is typically a
    // < 100-instance subset. Larger subsets fall back through the same
    // overlap test — the worst case is still milliseconds.
    for (std::size_t i = 0; i + 1 < instances.size(); ++i) {
        for (std::size_t j = i + 1; j < instances.size(); ++j) {
            if (!boxes[i].intersects(boxes[j])) continue;
            // ---- narrow phase: exact solid intersection -----------
#ifdef FORGE_NATIVE_BREP
            // GATE: the native analytic clash test (brep::booleanSolid Common +
            // massProperties) is opt-in via the FEAT gate (default OFF). When on AND
            // BOTH components are NativeSolid, measure the overlap natively; otherwise
            // fall through to the OCCT narrow phase below (an OCCT-backed component
            // HONESTLY DEFERS — no behavior change in the default build). A false
            // return == defer. Today every live component is OCCT-backed so this
            // defers totally; it goes live once assemblies hold native-core bodies.
            if (native::brep::forgeNativeFeaturesEnabled()) {
                double vNative = 0.0;
                if (tryNativeInterferencePair(instances[i], instances[j], vNative)) {
                    if (vNative >= kInterferenceMinVolume) {
                        out.push_back({instances[i], instances[j], vNative});
                    }
                    continue;  // native handled this pair -> skip OCCT path
                }
                // native deferred -> OCCT narrow phase below (unchanged).
            }
#endif
            TopoDS_Shape sa = worldShape(instances[i]);
            TopoDS_Shape sb = worldShape(instances[j]);
            BRepAlgoAPI_Common op(sa, sb);
            op.Build();
            if (!op.IsDone()) continue;
            TopoDS_Shape inter = op.Shape();
            if (inter.IsNull()) continue;
            const double v = solidVolume(inter);
            if (v < kInterferenceMinVolume) continue;
            out.push_back({instances[i], instances[j], v});
        }
    }

    std::sort(out.begin(), out.end(),
              [](const InterferencePair& a, const InterferencePair& b) {
                  if (a.instA != b.instA) return a.instA < b.instA;
                  return a.instB < b.instB;
              });
    return out;
}

} // namespace forge
