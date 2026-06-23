#include "forge/Booleans.hpp"
#include "forge/LineageRegistry.hpp"

// IN-HOUSE KERNEL STEP 3a — route fuse/cut/common through the native analytic
// B-rep boolean (brep::booleanSolid) behind FORGE_NATIVE_BREP + the runtime gate.
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"
#include <memory>
// NOTE: the OCCT fallback below passes the ORIGINAL handles to runBoolean<> —
// ShapeRegistry::get() lazily bridges any native operand to OCCT on demand
// (see ShapeRegistry::get / NativeOcctBridge), so no explicit conversion is needed.
#endif

#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopAbs.hxx>
#include <stdexcept>
#include <unordered_set>

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

template <typename Op>
ShapeHandle runBoolean(ShapeHandle a, ShapeHandle b, const char* opName) {
  const auto& sa = ShapeRegistry::instance().get(a);
  const auto& sb = ShapeRegistry::instance().get(b);
  Op op(sa, sb);
  op.Build();
  if (!op.IsDone()) {
    throw std::runtime_error(std::string("forge: boolean ") + opName + " failed");
  }
  const TopoDS_Shape& out = op.Shape();
  ShapeHandle hOut = ShapeRegistry::instance().add(out);
  // Forge-60 — emit lineage for downstream ForgeTopoIdRegistry consumption.
  try {
    auto entries = buildLineage(op, sa, out, opName);
    LineageRegistry::instance().put(hOut, std::move(entries));
  } catch (...) {
    // Lineage emission is best-effort; failure should NOT mask the op result.
  }
  return hOut;
}

#ifdef FORGE_NATIVE_BREP
// Try the native analytic boolean (brep::booleanSolid). Returns true + sets `out`
// on success; returns false (NEVER throws) when the native path HONESTLY DEFERS,
// so the caller can fall back to OCCT on bridged operands.
//
// Deferral cases (Bible §0 — native-where-valid, OCCT otherwise, never a hard
// failure on a valid modelling request):
//   * a mixed OCCT/native operand pair (a caller built one operand on OCCT).
//   * booleanSolid ok==false — the analytic SSI AND the flagged mesh fallback
//     both deferred (e.g. a degenerate coincident-face cut). OCCT handles it.
//   * usedMeshFallback==true is NOT a deferral (the result IS a closed solid).
bool tryNativeBoolean(ShapeHandle a, ShapeHandle b,
                      native::brep::BoolOp op, ShapeHandle& out) {
    using namespace forge::native::brep;
    auto& reg = ShapeRegistry::instance();
    if (reg.kindOf(a) != ShapeKind::NativeSolid || reg.kindOf(b) != ShapeKind::NativeSolid)
        return false;
    BooleanResult r = booleanSolid(reg.getNativeSolid(a), reg.getNativeSolid(b), op);
    if (!r.ok || !r.solid || !r.owner)
        return false;
    out = reg.addNativeSolid(r.owner, r.solid);
    return true;
}
#endif

}  // namespace

ShapeHandle fuse(ShapeHandle a, ShapeHandle b) {
#ifdef FORGE_NATIVE_BREP
    if (native::brep::forgeNativeBrepEnabled()) {
        ShapeHandle out = kInvalidHandle;
        if (tryNativeBoolean(a, b, native::brep::BoolOp::Fuse, out)) return out;
        // native deferred -> OCCT fallback (get() lazily bridges native operands).
    }
#endif
    return runBoolean<BRepAlgoAPI_Fuse>(a, b, "fuse");
}
ShapeHandle cut(ShapeHandle a, ShapeHandle b) {
#ifdef FORGE_NATIVE_BREP
    if (native::brep::forgeNativeBrepEnabled()) {
        ShapeHandle out = kInvalidHandle;
        if (tryNativeBoolean(a, b, native::brep::BoolOp::Cut, out)) return out;
        // native deferred -> OCCT fallback (get() lazily bridges native operands).
    }
#endif
    return runBoolean<BRepAlgoAPI_Cut>(a, b, "cut");
}
ShapeHandle common(ShapeHandle a, ShapeHandle b) {
#ifdef FORGE_NATIVE_BREP
    if (native::brep::forgeNativeBrepEnabled()) {
        ShapeHandle out = kInvalidHandle;
        if (tryNativeBoolean(a, b, native::brep::BoolOp::Common, out)) return out;
        // native deferred -> OCCT fallback (get() lazily bridges native operands).
    }
#endif
    return runBoolean<BRepAlgoAPI_Common>(a, b, "common");
}

}  // namespace forge
