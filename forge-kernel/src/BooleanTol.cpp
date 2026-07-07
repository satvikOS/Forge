// PUSH-18 — Tolerant ("fuzzy") boolean operations.
//
// Mirrors forge::Booleans but with an extra `fuzz` (mm) value: near-coincident
// geometry within `fuzz` is treated as coincident, so two operands separated (or
// overlapping) by a gap <= fuzz still produce a clean result instead of a sliver.
// Use it sparingly — too large a value collapses real geometric features.
//
// ─────────────────────────── OCCT-ZERO (K2, C-FUZZY) ───────────────────────────
// NATIVE-FIRST fuzzy route. When the in-house B-rep path is compiled (FORGE_NATIVE_BREP)
// AND enabled at runtime (forgeNativeBrepEnabled), fuse/cut/common now route the fuzzy
// operation through the OCCT-FREE native engine FIRST and only DEFER to OCCT's
// BRepAlgoAPI_BooleanOperation::SetFuzzyValue when the native engine honestly cannot
// close the pair:
//
//   * PURE NATIVE-SOLID pair  -> booleanSolid(A,B,op, BooleanOptions{fuzz}). The native
//     analytic boolean ALREADY consumes the fuzz value (SSI coincidence tol + face-
//     overlap AABB pad + stitch corner-weld grid — see Boolean.cpp), verified 1:1 vs
//     OCCT SetFuzzyValue at the engine level by test/native_vs_occt_fuzzy_boolean.cpp.
//     This covers exactly the CURVED THROUGH-CUT and TANGENT / near-coincident pairs
//     that used to defer to OCCT: the fuzz lets a tangent wall or a sub-fuzz gap
//     resolve to a clean analytic solid, and on any analytic-envelope miss booleanSolid
//     escalates to its own native mesh fallback (meshBooleanExact) — never OCCT.
//   * NATIVE-MESH operand pair (fillet/chamfer result operand) -> booleanMeshOperand
//     (the shared native mesh arrangement). NOTE: the OCCT fallback below CANNOT handle
//     a NativeMesh operand at all — ShapeRegistry::get() THROWS on a mesh-backed handle
//     (a faceted feature result has no analytic TopoDS_Shape). So for that operand class
//     the native route is not merely OCCT-free, it is the ONLY correct path; the fuzz is
//     absorbed by the mesh weld tolerance (the mesh boolean is inherently tolerant).
//
// Only a pair the native engine cannot close, OR a pair involving a genuine OCCT-imported
// (ShapeKind::Occt) operand — the classic dirty-STEP/IGES fuzzy target, which still needs
// the BRepMesh native-tessellation bridge that lives in src/Booleans.cpp (GAP A) and is
// not yet shared here — HONESTLY DEFERS to the OCCT SetFuzzyValue path (return false /
// fall through). A NativeSolid operand in the OCCT path is lazily bridged to OCCT by
// ShapeRegistry::get(), so the deferral is byte-identical to the prior behaviour.
//
// The functions here are siblings to forge::{fuse,cut,common} from Booleans.hpp and
// return a fresh ShapeHandle on success. They throw std::runtime_error on real failure
// (native OR OCCT) — no swallowing.

#include "forge/BooleanTol.hpp"

#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"     // forgeNativeBrepEnabled()
#include "forge/native/brep/Boolean.hpp"          // booleanSolid / booleanMeshOperand / BoolOp
#include "forge/native/brep/SolidTessellate.hpp"  // tessellateSolid (NativeSolid -> soup)
#include <chrono>
#include <cstdint>
#include <future>
#include <memory>
#include <thread>
#include <vector>
#endif

#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <Precision.hxx>
#include <TopoDS_Shape.hxx>

#include <stdexcept>
#include <string>

namespace forge::booleantol {

namespace {

// Stable op code shared with the native mapping (available in every build so the
// non-native build compiles without the native BoolOp type).
enum class FuzzyOp : int { Fuse = 0, Cut = 1, Common = 2 };

#ifdef FORGE_NATIVE_BREP
inline native::brep::BoolOp toNativeOp(FuzzyOp op) {
    switch (op) {
        case FuzzyOp::Cut:    return native::brep::BoolOp::Cut;
        case FuzzyOp::Common: return native::brep::BoolOp::Common;
        case FuzzyOp::Fuse:   default: return native::brep::BoolOp::Fuse;
    }
}

// Try to resolve the fuzzy boolean NATIVELY. Returns true + sets `out` on success;
// returns false (NEVER throws) when the pair honestly cannot be closed natively, so
// the caller can fall back to the OCCT SetFuzzyValue path. Mirrors the structure of
// src/Booleans.cpp::tryNativeBoolean, threading the fuzz value.
bool tryNativeFuzzyBoolean(ShapeHandle a, ShapeHandle b,
                           FuzzyOp op, double fuzz, ShapeHandle& out) {
    using namespace forge::native::brep;
    if (!forgeNativeBrepEnabled()) return false;

    auto& reg = ShapeRegistry::instance();
    const ShapeKind ka = reg.kindOf(a);
    const ShapeKind kb = reg.kindOf(b);
    const BoolOp nop = toNativeOp(op);

    // A genuine OCCT-imported operand still needs the BRepMesh native-tessellation
    // bridge (GAP A in src/Booleans.cpp) to enter the native mesh engine; that bridge
    // is not yet shared into this TU, so an OCCT operand HONESTLY DEFERS to the OCCT
    // fuzzy path below (no wrong result). A NativeSolid there is bridged by get().
    if (ka == ShapeKind::Occt || kb == ShapeKind::Occt) return false;

    // ---- PURE NATIVE ANALYTIC pair: booleanSolid WITH the fuzz value ------------
    // Covers the curved-through-cut / tangent / near-coincident pairs. The analytic
    // path consumes opts.fuzz; on an analytic miss booleanSolid escalates to its own
    // native mesh fallback — either way, no OCCT.
    if (ka == ShapeKind::NativeSolid && kb == ShapeKind::NativeSolid) {
        BooleanOptions opts;
        if (fuzz > 0.0) {
            opts.fuzz = fuzz;
            if (fuzz > opts.weldTol) opts.weldTol = fuzz;  // widen the position weld too
        }
        BooleanResult r = booleanSolid(reg.getNativeSolid(a), reg.getNativeSolid(b), nop, opts);
        if (!r.ok || !r.solid || !r.owner) return false;   // honest deferral
        out = reg.addNativeSolid(r.owner, r.solid);
        return true;
    }

    // ---- NATIVE-MESH operand pair: mesh-operand boolean ------------------------
    // At least one operand is a NativeMesh (fillet/chamfer result). Gather each
    // operand's triangle soup NATIVELY (OUTSIDE any held registry lock — the borrow
    // accessors take their lock only for the reference), then booleanMeshOperand. The
    // OCCT fallback CANNOT service a NativeMesh operand (get() throws), so this native
    // route is the only correct path here.
    auto gatherSoup = [&](ShapeHandle h, ShapeKind k,
                          std::vector<double>& pos, std::vector<std::uint32_t>& idx) -> bool {
        if (k == ShapeKind::NativeMesh) { reg.getNativeMesh(h).toSoup(pos, idx); return !idx.empty(); }
        if (k == ShapeKind::NativeSolid) { tessellateSolid(reg.getNativeSolid(h), pos, idx); return !idx.empty(); }
        return false;  // ShapeKind::Occt already returned above
    };
    std::vector<double> aPos, bPos;
    std::vector<std::uint32_t> aIdx, bIdx;
    if (!gatherSoup(a, ka, aPos, aIdx)) return false;
    if (!gatherSoup(b, kb, bPos, bIdx)) return false;

    // NATIVE-BOOLEAN WATCHDOG (mirrors src/Booleans.cpp::tryNativeBoolean): the mesh
    // arrangement has no cancellation hook and can spin on a pathological curved/
    // degenerate soup. Run it on a WORKER THREAD with a per-call deadline; the soups
    // are captured BY VALUE so a timed-out, detached computation is self-contained. On
    // timeout the pair HONESTLY DEFERS (return false) instead of hanging.
    MeshOperandResult mr;
    {
        constexpr std::chrono::milliseconds kMeshDeadline{2000};
        auto task = std::make_shared<std::packaged_task<MeshOperandResult()>>(
            [aPos, aIdx, bPos, bIdx, nop]() {
                return booleanMeshOperand(aPos, aIdx, bPos, bIdx, nop);
            });
        std::future<MeshOperandResult> fut = task->get_future();
        std::thread worker([task]() { (*task)(); });
        if (fut.wait_for(kMeshDeadline) == std::future_status::timeout) {
            worker.detach();   // abandon the non-cancellable mesh boolean
            return false;      // defer rather than hang
        }
        worker.join();
        mr = fut.get();
    }
    if (!mr.ok || !mr.solid || !mr.owner) return false;    // honest deferral
    out = reg.addNativeSolid(mr.owner, mr.solid);
    return true;
}
#endif  // FORGE_NATIVE_BREP

template <typename Op>
ShapeHandle runFuzzy(ShapeHandle a, ShapeHandle b, double fuzz,
                     [[maybe_unused]] FuzzyOp nativeOp, const char* name) {
    if (fuzz < 0.0) {
        throw std::invalid_argument(
            std::string("forge.booleantol.") + name +
            ": fuzz must be >= 0 (got " + std::to_string(fuzz) + ")");
    }

#ifdef FORGE_NATIVE_BREP
    // NATIVE-FIRST: resolve the fuzzy op through the OCCT-free engine when it can
    // close the pair; only defer to OCCT (below) on an honest native miss.
    {
        ShapeHandle out = kInvalidHandle;
        if (tryNativeFuzzyBoolean(a, b, nativeOp, fuzz, out)) return out;
    }
#endif

    const auto& sa = ShapeRegistry::instance().get(a);
    const auto& sb = ShapeRegistry::instance().get(b);
    Op op(sa, sb);
    // SetFuzzyValue is inherited from BOPAlgo_Options via BRepAlgoAPI_BuilderAlgo.
    // A value of 0 leaves OCCT in classic tolerance-only mode; any positive value
    // relaxes the algorithm by that many millimetres on top of the per-shape tolerances.
    op.SetFuzzyValue(fuzz);
    op.Build();
    if (!op.IsDone()) {
        throw std::runtime_error(
            std::string("forge.booleantol.") + name +
            ": OCCT BRepAlgoAPI failed (fuzz=" + std::to_string(fuzz) + ")");
    }
    return ShapeRegistry::instance().add(op.Shape());
}

}  // namespace

ShapeHandle fuse(ShapeHandle a, ShapeHandle b, double fuzz) {
    return runFuzzy<BRepAlgoAPI_Fuse>(a, b, fuzz, FuzzyOp::Fuse, "fuse");
}

ShapeHandle cut(ShapeHandle a, ShapeHandle b, double fuzz) {
    return runFuzzy<BRepAlgoAPI_Cut>(a, b, fuzz, FuzzyOp::Cut, "cut");
}

ShapeHandle common(ShapeHandle a, ShapeHandle b, double fuzz) {
    return runFuzzy<BRepAlgoAPI_Common>(a, b, fuzz, FuzzyOp::Common, "common");
}

}  // namespace forge::booleantol
