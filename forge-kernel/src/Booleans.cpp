#include "forge/Booleans.hpp"
#include "forge/LineageRegistry.hpp"

// IN-HOUSE KERNEL STEP 3a — route fuse/cut/common through the native analytic
// B-rep boolean (brep::booleanSolid) behind FORGE_NATIVE_BREP + the runtime gate.
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"
#include "forge/native/brep/Boolean.hpp"   // detectBooleanTangentPinch (pre-OCCT guard)
#include <cstdint>
#include <cmath>                            // GAP A — quantized weld of an OCCT operand soup
#include <map>                              // GAP A — weld map for the OCCT-tessellation soup
#include <tuple>                            // GAP A — weld key
#include <vector>
// NOTE: the OCCT fallback below passes the ORIGINAL handles to runBoolean<> —
// ShapeRegistry::get() lazily bridges any native operand to OCCT on demand
// (see ShapeRegistry::get / NativeOcctBridge), so no explicit conversion is needed.
#endif

#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Common.hxx>
// The fourth operator. Its result is a compound of EDGES, so it needs the wire
// builder and the vertex reader the other three do not.
#include <BRepAlgoAPI_Section.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Pnt.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopAbs.hxx>
#ifdef FORGE_NATIVE_BREP
// GAP A — native-tessellate an OCCT operand into a triangle soup for the native
// mesh-operand boolean (the mixed native/OCCT boolean route).
// K5 — native meshing replaces BRepMesh_IncrementalMesh here (no TKMesh).
#include "forge/OcctNativeMesh.hpp"
#include <Bnd_Box.hxx>
#include <BRepBndLib.hxx>
#include <TopoDS.hxx>
#endif
#include <algorithm>                        // OCCT-boolean watchdog: per-call deadline cap
#include <chrono>                           // OCCT-boolean watchdog deadline
#include <cstddef>                          // SECTION edge chaining indices
#include <cstdio>                           // tangent-pinch diagnostic formatting
#include <future>                           // OCCT-boolean watchdog (packaged_task)
#include <memory>                           // shared op holder (watchdog + lineage)
#include <mutex>                            // OCCT-boolean cumulative budget guard
#include <stdexcept>
#include <string>
#include <thread>                           // OCCT-boolean watchdog worker
#include <unordered_set>
#include <vector>                           // SECTION edge/wire chaining (unconditional:
                                            // the FORGE_NATIVE_BREP block above also
                                            // includes it, and section() is not gated)

namespace forge {

namespace {

// Walk an OCCT boolean op's Modified() / Generated() / IsDeleted()
// maps for every input face and produce the JS-shaped lineage list.
//
// The contract (matches ForgeTopoIdRegistry.applyOp on the JS side):
//   - input face i in shape A:
//       op.Modified(face) returns a list of output faces it became
//         survivor: 1 input → 1 output  (no shape change beyond reindex)
//         split:    1 input → ≥2 outputs (e.g. cut splits a face in 2)
//       op.Generated(face) returns NEW output faces produced by the
//         intersection (births).
//       op.IsDeleted(face) → true ⇒ death entry.
template <typename Op>
std::vector<LineageEntry> buildLineage(Op& op,
                                       const TopoDS_Shape& inputA,
                                       const TopoDS_Shape& output,
                                       const char* opName) {
  std::vector<LineageEntry> entries;

  TopTools_IndexedMapOfShape inMap;
  TopExp::MapShapes(inputA, TopAbs_FACE, inMap);
  TopTools_IndexedMapOfShape outMap;
  TopExp::MapShapes(output, TopAbs_FACE, outMap);

  std::unordered_set<uint32_t> claimedOutputIndices;

  for (int i = 1; i <= inMap.Extent(); ++i) {
    const TopoDS_Shape& face = inMap(i);
    const uint32_t oldIdx = static_cast<uint32_t>(i);

    if (op.IsDeleted(face)) {
      LineageEntry e;
      e.kind        = LineageEntry::Kind::Death;
      e.entityKind  = "face";
      e.originOp    = opName;
      e.oldIndices.push_back(oldIdx);
      entries.push_back(std::move(e));
      continue;
    }

    const TopTools_ListOfShape& modList = op.Modified(face);
    if (modList.IsEmpty()) {
      // No modification recorded — face survived unchanged. Find its
      // index in the output map (TopExp::MapShapes hashes by topology,
      // so identical faces line up).
      int newIdx = outMap.FindIndex(face);
      if (newIdx > 0) {
        LineageEntry e;
        e.kind        = LineageEntry::Kind::Survivor;
        e.entityKind  = "face";
        e.originOp    = opName;
        e.oldIndices.push_back(oldIdx);
        e.newIndices.push_back(static_cast<uint32_t>(newIdx));
        claimedOutputIndices.insert(static_cast<uint32_t>(newIdx));
        entries.push_back(std::move(e));
      } else {
        LineageEntry e;
        e.kind        = LineageEntry::Kind::Death;
        e.entityKind  = "face";
        e.originOp    = opName;
        e.oldIndices.push_back(oldIdx);
        entries.push_back(std::move(e));
      }
      continue;
    }

    LineageEntry e;
    e.entityKind = "face";
    e.originOp   = opName;
    e.oldIndices.push_back(oldIdx);
    for (TopTools_ListIteratorOfListOfShape it(modList); it.More(); it.Next()) {
      int newIdx = outMap.FindIndex(it.Value());
      if (newIdx > 0) {
        e.newIndices.push_back(static_cast<uint32_t>(newIdx));
        claimedOutputIndices.insert(static_cast<uint32_t>(newIdx));
      }
    }
    e.kind = (e.newIndices.size() <= 1)
              ? LineageEntry::Kind::Survivor
              : LineageEntry::Kind::Split;
    entries.push_back(std::move(e));
  }

  // Generated faces become births (no oldIdx). We also pick up any
  // output faces that nothing claimed — those are also births from
  // the intersection region.
  for (int i = 1; i <= inMap.Extent(); ++i) {
    const TopoDS_Shape& face = inMap(i);
    const TopTools_ListOfShape& genList = op.Generated(face);
    for (TopTools_ListIteratorOfListOfShape it(genList); it.More(); it.Next()) {
      int newIdx = outMap.FindIndex(it.Value());
      if (newIdx > 0 && claimedOutputIndices.find(static_cast<uint32_t>(newIdx))
                          == claimedOutputIndices.end()) {
        LineageEntry e;
        e.kind        = LineageEntry::Kind::Birth;
        e.entityKind  = "face";
        e.originOp    = opName;
        e.newIndices.push_back(static_cast<uint32_t>(newIdx));
        claimedOutputIndices.insert(static_cast<uint32_t>(newIdx));
        entries.push_back(std::move(e));
      }
    }
  }
  // Any remaining unclaimed output faces are also births (cap faces,
  // intersection seams that OCCT didn't explicitly emit through
  // Generated()).
  for (int i = 1; i <= outMap.Extent(); ++i) {
    if (claimedOutputIndices.count(static_cast<uint32_t>(i))) continue;
    LineageEntry e;
    e.kind        = LineageEntry::Kind::Birth;
    e.entityKind  = "face";
    e.originOp    = opName;
    e.newIndices.push_back(static_cast<uint32_t>(i));
    entries.push_back(std::move(e));
  }

  return entries;
}

// Shared cumulative wall-time budget for the OCCT boolean fallback (one window
// across fuse/cut/common). See runBoolean for the rationale.
struct BoolBudgetState {
  std::mutex mx;
  std::chrono::steady_clock::time_point winStart{};
  std::chrono::steady_clock::time_point lastEnd{};
  // Time actually SPENT INSIDE boolean Build() calls in this window. The budget
  // must meter boolean work, not wall-clock: metering elapsed time since the
  // window opened counts every millisecond the caller spent doing something
  // else, so a sustained stream of FAST booleans (a corpus build doing thousands
  // of 50 ms cuts back to back) tripped the hang guard after 20 s of ordinary
  // progress. That is the opposite of the intent — the guard exists to collapse
  // a storm of SLOW degenerate ops, which accumulates real Build() time quickly.
  std::chrono::milliseconds spent{0};
  bool active = false;
};
inline BoolBudgetState& boolBudget() { static BoolBudgetState s; return s; }

template <typename Op>
ShapeHandle runBoolean(ShapeHandle a, ShapeHandle b, const char* opName) {
  const auto& sa = ShapeRegistry::instance().get(a);
  const auto& sb = ShapeRegistry::instance().get(b);

  // ─────────────────────── OCCT-boolean hang guard ────────────────────────
  // BRepAlgoAPI_{Fuse,Cut,Common}::Build() has NO cancellation hook and can SPIN
  // for minutes on a degenerate operand pair — notably a TANGENT / near-tangent
  // hole (a cylinder wall coincident with a boundary face), which produces a
  // zero-thickness pinch the fuzzy intersector cannot resolve. The native analytic
  // boolean DEFERS on that case and the obvious tangent pinches are rejected FAST
  // up-front (detectBooleanTangentPinch), but this watchdog is the universal
  // backstop so NO boolean — tangent, near-tangent, or otherwise pathological —
  // can hang the in-process kernel. Mirrors the Features.cpp fillet watchdog:
  //   (a) the single Build() runs on a WORKER THREAD with a per-call DEADLINE
  //       (≤ kPerCall), abandoned on timeout (no inner cancel point); and
  //   (b) a CUMULATIVE per-window WALL BUDGET across back-to-back boolean calls
  //       (a > kGap idle gap starts a fresh window) collapses a storm of slow
  //       degenerate ops to ~the budget instead of summing to minutes.
  using BoolClock = std::chrono::steady_clock;
  constexpr std::chrono::milliseconds kBudget{20000};   // per-window cumulative budget
  constexpr std::chrono::milliseconds kGap{3000};       // window-reset idle gap
  constexpr std::chrono::milliseconds kPerCall{8000};   // hard per-call ceiling (< 10 s)

  std::chrono::milliseconds remaining{};
  {
    BoolBudgetState& bs = boolBudget();
    std::lock_guard<std::mutex> lk(bs.mx);
    const BoolClock::time_point now = BoolClock::now();
    if (!bs.active || (now - bs.lastEnd) > kGap) {
      bs.winStart = now; bs.active = true; bs.spent = std::chrono::milliseconds{0};
    }
    const auto used = bs.spent;
    if (used >= kBudget)
      throw std::runtime_error(
          std::string("forge: boolean ") + opName +
          ": cumulative OCCT-boolean budget (20s) exhausted for this body without "
          "converging — refusing further attempts rather than hanging (a degenerate / "
          "tangent operand on which BRepAlgoAPI spins). Valid quadric operands use the "
          "OCCT-free native analytic boolean.");
    remaining = std::min(kPerCall, kBudget - used);
  }

  // Run construction + Build on a worker thread. TopoDS_Shape copies are shallow
  // handle copies, so capturing them (and owning the Op via a shared holder) keeps
  // a TIMED-OUT, detached build self-contained — it never dangles into registry
  // state. On success the joined main thread reads the Op back for lineage.
  TopoDS_Shape saCopy = sa, sbCopy = sb;
  struct OpHolder { std::shared_ptr<Op> op; };
  auto holder = std::make_shared<OpHolder>();
  auto task = std::make_shared<std::packaged_task<TopoDS_Shape()>>(
      [holder, saCopy, sbCopy, opName]() -> TopoDS_Shape {
        holder->op = std::make_shared<Op>(saCopy, sbCopy);
        holder->op->Build();
        if (!holder->op->IsDone())
          throw std::runtime_error(std::string("forge: boolean ") + opName + " failed");
        return holder->op->Shape();
      });
  std::future<TopoDS_Shape> fut = task->get_future();
  const BoolClock::time_point callStart = BoolClock::now();
  std::thread worker([task]() { (*task)(); });
  const std::future_status st = fut.wait_for(remaining);
  {
    BoolBudgetState& bs = boolBudget();
    std::lock_guard<std::mutex> lk(bs.mx);
    const BoolClock::time_point done = BoolClock::now();
    // charge the window ONLY for the time this Build() actually took
    bs.spent += std::chrono::duration_cast<std::chrono::milliseconds>(done - callStart);
    bs.lastEnd = done;
  }
  if (st == std::future_status::timeout) {
    worker.detach();   // abandon the non-cancellable OCCT build (no inner hook)
    throw std::runtime_error(
        std::string("forge: boolean ") + opName +
        " did not converge within the per-call watchdog deadline (" +
        std::to_string((long long)kPerCall.count()) +
        " ms) — BRepAlgoAPI spun on a degenerate / near-tangent operand. Refusing "
        "rather than hanging; obvious tangent / sub-tolerance pinches are rejected "
        "up-front and valid quadric operands use the OCCT-free native analytic boolean.");
  }
  worker.join();
  const TopoDS_Shape out = fut.get();   // rethrows any worker error
  ShapeHandle hOut = ShapeRegistry::instance().add(out);
  // Forge-60 — emit lineage for downstream ForgeTopoIdRegistry consumption.
  try {
    auto entries = buildLineage(*holder->op, saCopy, out, opName);
    LineageRegistry::instance().put(hOut, std::move(entries));
  } catch (...) {
    // Lineage emission is best-effort; failure should NOT mask the op result.
  }
  return hOut;
}

#ifdef FORGE_NATIVE_BREP
// GAP A — native-tessellate an OCCT B-rep operand into a WELDED double-precision
// triangle soup so a MIXED native/OCCT boolean can run through the native mesh-operand
// engine (meshBooleanExact) instead of deferring the whole operation to BRepAlgoAPI.
// This READS OCCT geometry (BRepMesh faceting) but the BOOLEAN arrangement itself is
// native — eliminating the OCCT boolean surface. Works for ANY OCCT surface (quadric,
// NURBS, revolved, offset). Returns false if the shape produced no triangulable face.
bool tessellateOcctOperandToSoup(const TopoDS_Shape& shape,
                                 std::vector<double>& pos,
                                 std::vector<std::uint32_t>& idx) {
    // K5 — NATIVE tessellation, NO BRepMesh / TKMesh. occtmesh::tessellateShapeToSoup
    // discretises each face's trim wire (adaptive pcurve sampling) + fills an adaptive
    // UV grid and triangulates the whole PSLG with the in-house constrained Delaunay,
    // reading ONLY OCCT surface points / wire pcurves (TKBRep/TKG3d/TKG2d/TKTopAlgo).
    // Absolute chord deflection = 0.1% of the shape's bounding-box diagonal (mirrors
    // the previous RELATIVE 0.001 BRepMesh faceting, so the soup density is unchanged).
    // Returns false on an honest native miss (a face whose boundary has no pcurve), so
    // the mixed boolean falls back to OCCT for that pair only.
    pos.clear();
    idx.clear();
    Bnd_Box box;
    BRepBndLib::Add(shape, box);
    double diag = 1.0;
    if (!box.IsVoid()) {
        double xmin, ymin, zmin, xmax, ymax, zmax;
        box.Get(xmin, ymin, zmin, xmax, ymax, zmax);
        const double dx = xmax - xmin, dy = ymax - ymin, dz = zmax - zmin;
        diag = std::sqrt(dx * dx + dy * dy + dz * dz);
    }
    const double linDefl = std::max(1e-4, 0.001 * diag);
    // The mesh-operand boolean REQUIRES a watertight operand: with the mesher's
    // per-face fallback (2026-07-23) a partial soup now returns true, so the
    // deferred-face count restores this caller's old whole-shape deferral —
    // any unmeshed face => honest OCCT fallback, never an open-mesh boolean.
    int deferred = 0;
    const bool ok =
        occtmesh::tessellateShapeToSoup(shape, pos, idx, linDefl, /*angDefl*/ 0.1,
                                        &deferred);
    return ok && deferred == 0;
}

// Try to resolve a boolean NATIVELY. Returns true + sets `out` on success; returns
// false (NEVER throws) only when the pair HONESTLY cannot be closed natively, so the
// caller can fall back to OCCT.
//
// GAP A — MIXED native/OCCT operand booleans now resolve NATIVELY through the native
// MESH-OPERAND engine (meshBooleanExact):
//   * pure NativeSolid x NativeSolid keeps the EXACT analytic boolean (booleanSolid).
//   * ANY pair involving an OCCT B-rep (ShapeKind::Occt) operand — a genuine imported-
//     STEP body — or a NativeMesh operand is gathered into triangle soups and combined
//     by the native mesh boolean. An OCCT operand is native-tessellated DIRECTLY
//     (BRepMesh, adequate deflection): this READS OCCT geometry but the BOOLEAN
//     arrangement is native — eliminating the OCCT boolean surface. It also covers OCCT
//     surfaces importOcctSolid cannot (revolved/offset/other), and — unlike routing the
//     import through the analytic engine — cannot SPIN on an imported periodic quadric
//     face (booleanSolidAnalytic mishandles an imported cylinder's seam'd face; the mesh
//     arrangement is robust to it).
// Only a pair the mesh engine cannot close (an operand with no native soup, or a
// genuinely-degenerate arrangement) still defers to OCCT (return false).
bool tryNativeBoolean(ShapeHandle a, ShapeHandle b,
                      native::brep::BoolOp op, ShapeHandle& out) {
    using namespace forge::native::brep;
    auto& reg = ShapeRegistry::instance();
    const ShapeKind ka = reg.kindOf(a);
    const ShapeKind kb = reg.kindOf(b);

    // ---- EXACT ANALYTIC PATH: pure native analytic Solid x Solid (fast/proven) --
    if (ka == ShapeKind::NativeSolid && kb == ShapeKind::NativeSolid) {
        BooleanResult r = booleanSolid(reg.getNativeSolid(a), reg.getNativeSolid(b), op);
        if (!r.ok || !r.solid || !r.owner)
            return false;   // booleanSolid already tried analytic + mesh natively
        out = reg.addNativeSolid(r.owner, r.solid);
        return true;
    }

    // ---- NATIVE MESH-OPERAND PATH (GAP A + the fillet/chamfer bridge) ----------
    // Handles every remaining resolvable pair: a NativeMesh operand and/or an OCCT
    // B-rep operand. Gather each operand's triangle soup NATIVELY, then meshBooleanExact.
    // Registry accessors take their lock only for the borrow; the soup copies run on the
    // returned references with NO registry lock held (mirrors booleanSolidMeshFallback).
    auto gatherSoup = [&](ShapeHandle h, ShapeKind k,
                          std::vector<double>& pos, std::vector<std::uint32_t>& idx) -> bool {
        if (k == ShapeKind::NativeMesh) {
            reg.getNativeMesh(h).toSoup(pos, idx);
            return !idx.empty();
        }
        if (k == ShapeKind::NativeSolid) {
            native::brep::tessellateSolid(reg.getNativeSolid(h), pos, idx);
            return !idx.empty();
        }
        // ShapeKind::Occt — GAP A: native-tessellate the imported OCCT B-rep directly.
        return tessellateOcctOperandToSoup(reg.get(h), pos, idx);
    };
    std::vector<double> aPos, bPos;
    std::vector<std::uint32_t> aIdx, bIdx;
    if (!gatherSoup(a, ka, aPos, aIdx)) return false;
    if (!gatherSoup(b, kb, bPos, bIdx)) return false;

    // NATIVE-BOOLEAN WATCHDOG (mirrors the OCCT runBoolean watchdog): meshBooleanExact
    // has NO cancellation hook and can SPIN on a pathological curved/degenerate mixed
    // arrangement (e.g. an imported cylindrical wall cutting a planar face at a chain of
    // near-triple-points, which escalates the exact arrangement). Run it on a WORKER
    // THREAD with a per-call DEADLINE; the soups are captured BY VALUE so a timed-out,
    // detached computation is fully self-contained (no dangling reference into this frame
    // or the registry). On timeout the pair HONESTLY DEFERS to OCCT (return false) instead
    // of hanging the in-process kernel — a successful native mesh boolean completes in
    // well under this budget (a few hundred ms even for a curved operand in practice).
    MeshOperandResult mr;
    {
        constexpr std::chrono::milliseconds kMeshDeadline{2000};
        auto task = std::make_shared<std::packaged_task<MeshOperandResult()>>(
            [aPos, aIdx, bPos, bIdx, op]() {
                return booleanMeshOperand(aPos, aIdx, bPos, bIdx, op);
            });
        std::future<MeshOperandResult> fut = task->get_future();
        std::thread worker([task]() { (*task)(); });
        if (fut.wait_for(kMeshDeadline) == std::future_status::timeout) {
            worker.detach();   // abandon the non-cancellable mesh boolean
            return false;      // defer to OCCT rather than hang
        }
        worker.join();
        mr = fut.get();
    }
    if (!mr.ok || !mr.solid || !mr.owner)
        return false;  // honest deferral (the mesh boolean could not close the result)
    out = reg.addNativeSolid(mr.owner, mr.solid);
    return true;
}

// TANGENT-PINCH FAST REJECT (boolean robustness): when both operands are native
// analytic solids and the native boolean has DEFERRED (so the caller is about to
// hand the pair to the OCCT fallback, which can SPIN for minutes on a tangent
// cut), run the fast geometric pre-check and THROW a clear diagnostic instead of
// hanging. No-op for any non-native-solid pair (the OCCT path then runs under the
// runBoolean watchdog). HONEST: rejects the degenerate request, never silently
// moves geometry and never emits a non-manifold pinch.
void throwIfTangentPinch(ShapeHandle a, ShapeHandle b,
                         native::brep::BoolOp op, const char* opName) {
    auto& reg = ShapeRegistry::instance();
    if (reg.kindOf(a) != ShapeKind::NativeSolid || reg.kindOf(b) != ShapeKind::NativeSolid)
        return;
    native::brep::TangentPinchReport tp =
        native::brep::detectBooleanTangentPinch(reg.getNativeSolid(a), reg.getNativeSolid(b), op);
    if (!tp.degenerate) return;
    char msg[640];
    std::snprintf(msg, sizeof(msg),
        "forge: boolean %s refused — tangent/degenerate cut: a O%.4g cylindrical "
        "feature wall lies %.3g mm from a planar face (within eps=%.3g of tangent), "
        "which would create a zero-thickness non-manifold pinch (a sub-tolerance "
        "sliver wall). Refusing FAST rather than hanging the OCCT boolean; offset the "
        "feature >= eps off the boundary to keep a manufacturable wall.",
        opName, 2.0 * tp.radius, tp.wall, tp.eps);
    throw std::runtime_error(msg);
}

// K2 — NATIVE-ONLY BOOLEAN CLASS (kill the OCCT BRepAlgoAPI fallback for
// all-native operands). When BOTH operands are native (analytic Solid and/or
// mesh-bridge) the native analytic/mesh boolean OWNS this class — it is the
// verified native_vs_occt path. If tryNativeBoolean DEFERRED on such a pair
// (and it was not a tangent pinch, handled just above by throwIfTangentPinch),
// the request is a genuine degenerate or an unimplemented native intersection:
// reject it HONESTLY rather than silently masking a native gap with OCCT
// (Bible §0 — never fake native; a kind=occt that still shows is an honest FAIL).
//
// OCCT booleans are RETAINED (below, via runBoolean<>) only for the genuinely-
// unsupported cases: (1) at least one OCCT-backed operand — an imported
// trimmed-NURBS/torus STEP solid the native analytic boolean cannot consume —
// and (2) the A/B oracle path (setNativeBrep(false), forgeNativeBrepEnabled()
// == false), which never reaches this guard. Fuzzy/Splitter stay OCCT-only in
// their own translation units (BooleanTol / SheetMetal / Mold).
void throwIfNativeOnlyDeferred(ShapeHandle a, ShapeHandle b, const char* opName) {
    auto& reg = ShapeRegistry::instance();
    const ShapeKind ka = reg.kindOf(a);
    const ShapeKind kb = reg.kindOf(b);
    const bool aNative = (ka == ShapeKind::NativeSolid || ka == ShapeKind::NativeMesh);
    const bool bNative = (kb == ShapeKind::NativeSolid || kb == ShapeKind::NativeMesh);
    if (!(aNative && bNative))
        return;  // >= 1 OCCT-backed operand -> genuinely-unsupported -> OCCT below
    throw std::runtime_error(
        std::string("forge: boolean ") + opName +
        ": native analytic/mesh boolean deferred on an all-native operand pair. "
        "This operand class is NATIVE-ONLY — the OCCT BRepAlgoAPI fallback was "
        "removed (K2). The operands are degenerate or hit an unimplemented native "
        "intersection; refusing rather than masking a native gap with OCCT "
        "(Bible \xC2\xA7""0). OCCT booleans remain only for OCCT-backed operands "
        "(imported trimmed-NURBS/torus STEP solids) and fuzzy/splitter.");
}
#endif

// ─────────────────────────── SECTION (the fourth operator) ───────────────────
// Section edges come back as an UNORDERED compound. They are chained into wires
// here rather than through ShapeAnalysis_FreeBounds::ConnectEdgesToWires because
// that class lives in TKShHealing, the toolkit this repo is actively REMOVING
// call sites from (FORGE_SHHEAL_DROP_NATIVE, CMakeLists "TKShHealing PARTIAL
// DROP"). Adding a new dependency on a toolkit under deletion is new debt, and
// endpoint chaining is twenty lines.
bool sectionSamePoint(const gp_Pnt& a, const gp_Pnt& b, double tol) {
    return a.SquareDistance(b) <= tol * tol;
}

// Greedy endpoint chaining: seed a chain with an unused edge, then repeatedly
// absorb any unused edge touching either free end, until nothing more attaches.
// Every edge lands in exactly one chain, so no section edge is dropped — a lost
// edge is a silently shortened section, which is the failure this must not have.
std::vector<TopoDS_Wire> chainSectionEdges(const std::vector<TopoDS_Edge>& edges, double tol) {
    std::vector<bool> used(edges.size(), false);
    std::vector<TopoDS_Wire> wires;
    for (std::size_t seed = 0; seed < edges.size(); ++seed) {
        if (used[seed]) continue;
        used[seed] = true;
        BRepBuilderAPI_MakeWire mk(edges[seed]);
        TopoDS_Vertex v0, v1;
        TopExp::Vertices(edges[seed], v0, v1);
        gp_Pnt head = BRep_Tool::Pnt(v0);
        gp_Pnt tail = BRep_Tool::Pnt(v1);
        bool grew = true;
        while (grew) {
            grew = false;
            for (std::size_t i = 0; i < edges.size(); ++i) {
                if (used[i]) continue;
                TopoDS_Vertex a, b;
                TopExp::Vertices(edges[i], a, b);
                const gp_Pnt pa = BRep_Tool::Pnt(a);
                const gp_Pnt pb = BRep_Tool::Pnt(b);
                if (sectionSamePoint(pa, tail, tol) || sectionSamePoint(pb, tail, tol)) {
                    mk.Add(edges[i]);
                    tail = sectionSamePoint(pa, tail, tol) ? pb : pa;
                    used[i] = true;
                    grew = true;
                } else if (sectionSamePoint(pa, head, tol) || sectionSamePoint(pb, head, tol)) {
                    mk.Add(edges[i]);
                    head = sectionSamePoint(pa, head, tol) ? pb : pa;
                    used[i] = true;
                    grew = true;
                }
            }
        }
        // A chain BRepBuilderAPI_MakeWire refused (a self-touching section, a
        // sub-tolerance sliver) is reported, not silently skipped: skipping it
        // would return a shorter section that looks perfectly healthy.
        if (!mk.IsDone())
            throw std::runtime_error(
                "forge: boolean section: the intersection edges do not form a wire "
                "(BRepBuilderAPI_MakeWire refused a chain of the section curve) — the "
                "operands touch along a degenerate / self-intersecting curve.");
        wires.push_back(mk.Wire());
    }
    return wires;
}

}  // namespace

void resetBooleanBudget() {
    BoolBudgetState& bs = boolBudget();
    std::lock_guard<std::mutex> lk(bs.mx);
    bs.active = false;                 // the next boolean opens a fresh window
    bs.spent = std::chrono::milliseconds{0};
}

ShapeHandle fuse(ShapeHandle a, ShapeHandle b) {
#ifdef FORGE_NATIVE_BREP
    if (native::brep::forgeNativeBrepEnabled()) {
        ShapeHandle out = kInvalidHandle;
        if (tryNativeBoolean(a, b, native::brep::BoolOp::Fuse, out)) return out;
        // native deferred. Fast-reject a tangent/degenerate pinch, then refuse an
        // all-native deferral (native-only class — K2), else fall through to OCCT
        // only for an OCCT-backed operand (get() lazily bridges native operands).
        throwIfTangentPinch(a, b, native::brep::BoolOp::Fuse, "fuse");
        throwIfNativeOnlyDeferred(a, b, "fuse");
    }
#endif
    return runBoolean<BRepAlgoAPI_Fuse>(a, b, "fuse");
}
ShapeHandle cut(ShapeHandle a, ShapeHandle b) {
#ifdef FORGE_NATIVE_BREP
    if (native::brep::forgeNativeBrepEnabled()) {
        ShapeHandle out = kInvalidHandle;
        if (tryNativeBoolean(a, b, native::brep::BoolOp::Cut, out)) return out;
        // native deferred. Fast-reject a tangent/degenerate pinch, then refuse an
        // all-native deferral (native-only class — K2), else fall through to OCCT
        // only for an OCCT-backed operand (get() lazily bridges native operands).
        throwIfTangentPinch(a, b, native::brep::BoolOp::Cut, "cut");
        throwIfNativeOnlyDeferred(a, b, "cut");
    }
#endif
    return runBoolean<BRepAlgoAPI_Cut>(a, b, "cut");
}
ShapeHandle common(ShapeHandle a, ShapeHandle b) {
#ifdef FORGE_NATIVE_BREP
    if (native::brep::forgeNativeBrepEnabled()) {
        ShapeHandle out = kInvalidHandle;
        if (tryNativeBoolean(a, b, native::brep::BoolOp::Common, out)) return out;
        // native deferred. Fast-reject a tangent/degenerate pinch, then refuse an
        // all-native deferral (native-only class — K2), else fall through to OCCT
        // only for an OCCT-backed operand (get() lazily bridges native operands).
        throwIfTangentPinch(a, b, native::brep::BoolOp::Common, "common");
        throwIfNativeOnlyDeferred(a, b, "common");
    }
#endif
    return runBoolean<BRepAlgoAPI_Common>(a, b, "common");
}

// ─────────────────────────────── SECTION ─────────────────────────────────────
// The fourth OCCT boolean, and the only one whose result is NOT a solid.
//
// It does NOT go through runBoolean<>, for two reasons that are both correctness,
// not style:
//   1. runBoolean<> ends by calling buildLineage(), which walks Modified/Generated
//      over the input FACES and matches them against the output's face map. A
//      section HAS NO OUTPUT FACES, so every input face would be recorded as a
//      DEATH — a lineage that says the operands were destroyed by an operation
//      that does not touch them.
//   2. its result kind differs, so the caller contract differs.
// The hang guard is the same, and deliberately shares the same window: a storm of
// degenerate sections is exactly the storm the cumulative budget exists to collapse.
//
// There is NO native analytic path here and none is faked. forge::native::brep has
// a Section module, but it intersects a native Solid with a PLANE; this is
// shape-against-shape. ShapeRegistry::get() lazily bridges a native operand to
// OCCT, so a native-backed operand still works — as OCCT, honestly (Bible §0),
// which is also why throwIfNativeOnlyDeferred is NOT called here: that guard
// exists to stop a native ENGINE being masked by OCCT, and for section there is
// no native engine to mask.
ShapeHandle section(ShapeHandle a, ShapeHandle b) {
    const auto& sa = ShapeRegistry::instance().get(a);
    const auto& sb = ShapeRegistry::instance().get(b);

    using BoolClock = std::chrono::steady_clock;
    constexpr std::chrono::milliseconds kBudget{20000};
    constexpr std::chrono::milliseconds kGap{3000};
    constexpr std::chrono::milliseconds kPerCall{8000};

    std::chrono::milliseconds remaining{};
    {
        BoolBudgetState& bs = boolBudget();
        std::lock_guard<std::mutex> lk(bs.mx);
        const BoolClock::time_point now = BoolClock::now();
        if (!bs.active || (now - bs.lastEnd) > kGap) {
            bs.winStart = now; bs.active = true; bs.spent = std::chrono::milliseconds{0};
        }
        if (bs.spent >= kBudget)
            throw std::runtime_error(
                "forge: boolean section: cumulative OCCT-boolean budget (20s) exhausted "
                "for this body without converging — refusing further attempts rather than "
                "hanging.");
        remaining = std::min(kPerCall, kBudget - bs.spent);
    }

    TopoDS_Shape saCopy = sa, sbCopy = sb;
    auto task = std::make_shared<std::packaged_task<TopoDS_Shape()>>(
        [saCopy, sbCopy]() -> TopoDS_Shape {
            // PerformNow=false so ComputePCurveOn1/Approximation are set BEFORE the
            // build: with the default (immediate) constructor they would be applied
            // to an operation that had already run, and the section would come back
            // as unapproximated intersection edges.
            BRepAlgoAPI_Section sec(saCopy, sbCopy, Standard_False);
            sec.ComputePCurveOn1(Standard_True);
            sec.Approximation(Standard_True);
            sec.Build();
            if (!sec.IsDone())
                throw std::runtime_error("forge: boolean section failed");
            return sec.Shape();
        });
    std::future<TopoDS_Shape> fut = task->get_future();
    const BoolClock::time_point callStart = BoolClock::now();
    std::thread worker([task]() { (*task)(); });
    const std::future_status st = fut.wait_for(remaining);
    {
        BoolBudgetState& bs = boolBudget();
        std::lock_guard<std::mutex> lk(bs.mx);
        const BoolClock::time_point done = BoolClock::now();
        bs.spent += std::chrono::duration_cast<std::chrono::milliseconds>(done - callStart);
        bs.lastEnd = done;
    }
    if (st == std::future_status::timeout) {
        worker.detach();   // abandon the non-cancellable OCCT build (no inner hook)
        throw std::runtime_error(
            "forge: boolean section did not converge within the per-call watchdog "
            "deadline (" + std::to_string((long long)kPerCall.count()) +
            " ms) — BRepAlgoAPI_Section spun on a degenerate / near-tangent operand pair.");
    }
    worker.join();
    const TopoDS_Shape raw = fut.get();   // rethrows any worker error

    std::vector<TopoDS_Edge> edges;
    for (TopExp_Explorer ex(raw, TopAbs_EDGE); ex.More(); ex.Next())
        edges.push_back(TopoDS::Edge(ex.Current()));
    if (edges.empty())
        throw std::runtime_error(
            "forge: boolean section: the operands do not intersect — the section is EMPTY. "
            "An empty section is not a wire any consumer can use, so it is refused here "
            "rather than handed on as a valid-looking empty compound.");

    // 1e-6 mm. Section vertices are the algorithm's OWN shared endpoints, so the
    // chain tolerance only has to absorb double round-off, not modelling slop; a
    // loose tolerance would weld two genuinely distinct loops that pass near each
    // other into one wire, which is a wrong answer rather than a missing one.
    const std::vector<TopoDS_Wire> wires = chainSectionEdges(edges, 1.0e-6);
    if (wires.size() == 1) {
        // The common case, and the one that matters: a single closed loop is a real
        // TopoDS_Wire, so loftguide::loft (and anything else taking a WIRE handle)
        // consumes it directly.
        return ShapeRegistry::instance().add(wires.front());
    }
    TopoDS_Compound comp;
    BRep_Builder bb;
    bb.MakeCompound(comp);
    for (const TopoDS_Wire& w : wires) bb.Add(comp, w);
    return ShapeRegistry::instance().add(comp);
}

}  // namespace forge
