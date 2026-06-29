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
// Compiled in ONLY under -DFORGE_NATIVE_BREP and taken at runtime when the
// DEDICATED gate forgeNativeInterferenceEnabled() is true.
//
// WAVE-2 FLIP (2026-06-29): this clash test was previously bundled under the FEAT
// gate (forgeNativeFeaturesEnabled, default OFF) alongside the representation-
// CHANGING mesh-bridge ops (fillet/chamfer/draft → NativeMesh). But it is NOT a
// representation change — it returns a SCALAR overlap volume from the analytic-core
// engine (booleanSolid(Common)+massProperties+transformSolid), the SAME Wave-1
// CORE family that is already the production default and A/B-verified vs OCCT.
// It now has its OWN gate, DEFAULT ON, so the native clash test runs by default and
// FORGE_NATIVE_INTERFERENCE=0/off rolls back to the OCCT narrow phase for the whole
// module. WHAT THIS REMOVES AT RUNTIME (default): for every candidate pair whose
// BOTH operands resolve to a native analytic Solid (NativeSolid handles directly,
// or OCCT-analytic handles via importOcctSolid), the OCCT BRepAlgoAPI_Common +
// BRepGProp::VolumeProperties + BRepBuilderAPI_Transform narrow-phase calls below
// are NO LONGER EXECUTED — replaced by native booleanSolid(Common)+massProperties+
// transformSolid. WHAT STILL LINKS OCCT (honest, per Bible §0 — delete OCCT last):
// (1) importOcctSolid still READS the OCCT shape to convert OCCT-backed operands to
// native; (2) the worldShape→BRepAlgoAPI_Common→GProp fallback below stays compiled
// and IS taken for any pair where importOcctSolid honestly defers (NURBS/torus/
// non-analytic) or booleanSolid returns no closed result. The A/B harness's
// setForgeNativeBrepEnabled(true/false) still flips this gate together with CORE/
// FEAT/STEP. Mirrors the CamAdvanced.cpp / Cam.cpp / Healing.cpp native wires.
//
// PHASE-D ACTIVATION (2026-06-25) — wired LIVE for OCCT inputs via the now-existing
// OCCT->native importer forge::importOcctSolid (src/OcctImport.cpp). resolveWorldSolid
// resolves EACH instance's world solid natively: a NativeSolid handle directly, OR an
// OCCT-backed (ShapeKind::Occt) handle by importing it (analytic box/cyl/cone/sphere/
// prism + analytic-boolean results) — so the live assembly pipeline (Booleans.cpp /
// Primitives.cpp on the default OCCT backend, which registers Kind::Occt components)
// NOW takes the native clash test instead of deferring. SAFE + HONEST: if importOcctSolid
// returns ok==false (NURBS/Torus/non-analytic) OR the boolean has no closed result, the
// helper returns false (NEVER throws) and the pair falls back to the OCCT narrow phase,
// byte-identical to today. The broad phase, pair enumeration, dedup + sort all stay on
// the existing path regardless.
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"   // forgeNativeInterferenceEnabled(), transformSolid
#include "forge/native/brep/Boolean.hpp"       // booleanSolid, BoolOp::Common, BooleanResult
#include "forge/native/brep/MassProps.hpp"     // massProperties (exact overlap volume)
#include "forge/native/brep/Topology.hpp"      // brep::Solid, TopologyBuilder
#include "forge/OcctImport.hpp"                // importOcctSolid (OCCT analytic -> native Solid)
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
// Resolve one assembly instance to its WORLD-space native analytic Solid, returning
// the (R,t)-transformed clone in `worldOut` and stashing the lifetimes it views into
// (the transformSolid builder + — for an OCCT input — the importOcctSolid ImportResult
// that owns the imported native topology) in `keepAlive`. Returns false (NEVER throws)
// when the instance HONESTLY DEFERS, so the pair falls back to the OCCT narrow phase:
//   * the component is a NativeSolid           -> transformSolid(getNativeSolid).
//   * the component is OCCT-backed (ShapeKind::Occt) AND importOcctSolid succeeds
//     (analytic box/cyl/cone/sphere/prism + analytic-boolean result) -> import to a
//     native Solid, then transformSolid that. PHASE-D ACTIVATION: this is the branch
//     that now runs the native clash test on OCCT inputs instead of deferring.
//   * the component is OCCT-backed but importOcctSolid defers (ok==false: NURBS/Torus/
//     non-analytic) -> false (defer to OCCT, unchanged).
//   * the component is a NativeMesh, or transformSolid yields null -> false (defer).
bool resolveWorldSolid(InstanceId id,
                       const native::brep::Solid*& worldOut,
                       std::vector<std::shared_ptr<void>>& keepAlive) {
    using namespace forge::native::brep;
    auto& shapes = ShapeRegistry::instance();
    const ShapeHandle h = ComponentRegistry::instance().getComponent(id);

    const Transform4x4 x = AssemblyHierarchy::instance().worldTransform(id);
    const double R[9] = { x.m[0], x.m[1], x.m[2],
                          x.m[4], x.m[5], x.m[6],
                          x.m[8], x.m[9], x.m[10] };
    const double t[3] = { x.m[3], x.m[7], x.m[11] };

    const Solid* model = nullptr;
    if (shapes.kindOf(h) == ShapeKind::NativeSolid) {
        model = &shapes.getNativeSolid(h);
    } else if (shapes.kindOf(h) == ShapeKind::Occt) {
        // PHASE-D: import the OCCT analytic solid into a native Solid. ok==false
        // (NURBS/Torus/etc.) -> defer to OCCT, exactly as before.
        ImportResult ir = importOcctSolid(shapes.get(h));
        if (!ir.ok || ir.solid == nullptr) return false;
        keepAlive.push_back(ir.owner);   // keep the imported topology alive
        model = ir.solid;
    } else {
        return false;  // NativeMesh -> no analytic Solid -> defer
    }

    std::shared_ptr<TopologyBuilder> owner;
    Solid* world = transformSolid(*model, R, t, owner);
    if (!world) return false;  // clone gap -> defer
    keepAlive.push_back(owner);
    worldOut = world;
    return true;
}

// Try the native analytic clash test (brep::booleanSolid Common + massProperties)
// for ONE candidate pair. On success sets `volOut` to the exact overlap volume and
// returns true; returns false (NEVER throws) when the native path HONESTLY DEFERS
// so the caller falls through to the OCCT BRepAlgoAPI_Common / GProp narrow phase.
// Same deferral contract as Cam.cpp::tryNativeInwardOffset / Healing.cpp::tryNativeHeal.
//
// Deferral / GAP cases (Bible §0 — native-where-valid, OCCT otherwise) — see
// resolveWorldSolid: EITHER instance is a NativeMesh, or an OCCT-backed body whose
// importOcctSolid defers (NURBS/Torus/non-analytic), or transformSolid yields null;
// OR booleanSolid returns ok==false (a tangency/degenerate clash with no closed
// 2-manifold result, or an honest SSI gap) -> defer so OCCT's own narrow phase —
// which owns its own degenerate handling (op.IsDone()/IsNull() skips) — decides.
// The overlap is booleanSolid(A,B,Common) and the volume is massProperties(result).volume
// (|·| for sign-safety, mirroring solidVolume).
bool tryNativeInterferencePair(InstanceId a, InstanceId b, double& volOut) {
    using namespace forge::native::brep;

    // Each instance's world solid is resolved natively (NativeSolid directly, OCCT input
    // via importOcctSolid). If EITHER honestly defers, the whole pair defers to OCCT.
    std::vector<std::shared_ptr<void>> keepAlive;   // owns imported + transformed topology
    const Solid* wa = nullptr;
    const Solid* wb = nullptr;
    if (!resolveWorldSolid(a, wa, keepAlive)) return false;
    if (!resolveWorldSolid(b, wb, keepAlive)) return false;

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
            // massProperties) runs by default via the dedicated interference gate
            // (DEFAULT ON; FORGE_NATIVE_INTERFERENCE=0 rolls back to OCCT). Each
            // component is resolved to a native world solid (NativeSolid directly, or an
            // OCCT-backed analytic solid via importOcctSolid), and the overlap is measured
            // natively; if EITHER component honestly defers (non-analytic import / mesh /
            // boolean gap) the pair falls through to the OCCT narrow phase below. A false
            // return == defer.
            if (native::brep::forgeNativeInterferenceEnabled()) {
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
