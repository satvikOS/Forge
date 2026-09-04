#include "forge/ui/ToolLibrary.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/WorkspaceTrees.hpp"

namespace forge::ui {

namespace {

// Two diameters are the same cutter when they agree to a micron. A shop does not
// hold two drills a nanometre apart, and floating-point arithmetic on a radius
// doubled is exactly where a spurious pair would come from.
constexpr double kSameCutterMm = 1.0e-3;

struct Slot {
  CutterKind kind;
  double diameterMm;
  bool diameterKnown;
};

// The cutter an operation's FIRST named size calls for.
bool primarySlot(const MachiningOperation& o, Slot& out) {
  switch (o.kind) {
    case MachiningKind::Drill:
    case MachiningKind::Counterbore:
      out = Slot{CutterKind::Drill, o.toolDiameterMm, o.toolDiameterMm > 0.0};
      return true;
    case MachiningKind::Bore:
      out = Slot{CutterKind::BoringHead, o.toolDiameterMm, o.toolDiameterMm > 0.0};
      return true;
    case MachiningKind::EdgeRound:
      out = Slot{CutterKind::EndMill, o.toolDiameterMm, o.toolDiameterMm > 0.0};
      return true;
    case MachiningKind::EdgeBreak:
      // A chamfer of any size is cut with a chamfer tool, and the statement's
      // distance is the width of the cut rather than the tool's diameter. It
      // names a TOOL and no size, which is a different fact from naming neither.
      out = Slot{CutterKind::ChamferTool, 0.0, false};
      return true;
    case MachiningKind::Cutout:
    case MachiningKind::Hollow:
      return false;
  }
  return false;
}

std::string cutterName(const Slot& slot) {
  const std::string kind = cutterWord(slot.kind);
  if (!slot.diameterKnown) return kind;
  return formatIrNumber(slot.diameterMm) + " mm " + kind;
}

}  // namespace

const char* cutterWord(CutterKind kind) noexcept {
  switch (kind) {
    case CutterKind::Drill:       return "drill";
    case CutterKind::EndMill:     return "end mill";
    case CutterKind::BoringHead:  return "boring head";
    case CutterKind::ChamferTool: return "chamfer tool";
    case CutterKind::Unsized:     return "cutter";
  }
  return "cutter";
}

ToolList buildToolList(const MachiningPlan& plan) {
  ToolList out;
  if (plan.operations.empty()) return out;
  out.known = true;

  auto slotFor = [&out](const Slot& slot) -> RequiredTool& {
    for (RequiredTool& t : out.tools) {
      if (t.kind != slot.kind) continue;
      if (t.diameterKnown != slot.diameterKnown) continue;
      if (t.diameterKnown && std::fabs(t.diameterMm - slot.diameterMm) > kSameCutterMm) continue;
      return t;
    }
    RequiredTool t;
    t.kind = slot.kind;
    t.diameterMm = slot.diameterKnown ? slot.diameterMm : 0.0;
    t.diameterKnown = slot.diameterKnown;
    t.name = cutterName(slot);
    out.tools.push_back(std::move(t));
    return out.tools.back();
  };

  // `through` is a property of THE CUT THIS CUTTER MAKES, not of the statement.
  // A counterbore is the one op where the two differ: its pilot drill goes right
  // through and gives no depth, while the flat-bottomed cutter beside it goes
  // exactly as deep as the statement's own counterbore depth. Passing the
  // statement's `through` to both would lose the one depth the operation
  // actually states.
  auto record = [](RequiredTool& t, std::size_t at, bool through, double depthMm) {
    t.operations.push_back(at);
    if (through) {
      t.cutsThrough = true;
      return;
    }
    if (depthMm <= 0.0) return;
    if (!t.depthKnown || depthMm > t.deepestCutMm) {
      t.deepestCutMm = depthMm;
      t.depthKnown = true;
    }
  };

  for (std::size_t i = 0; i < plan.operations.size(); ++i) {
    const MachiningOperation& o = plan.operations[i];
    Slot slot{CutterKind::Unsized, 0.0, false};
    if (!primarySlot(o, slot)) {
      ++out.operationsWithNoCutter;
      continue;
    }
    // The counterbore's own depth belongs to its SECOND cutter, so the first one
    // is told only what applies to it.
    const bool secondCutter = o.secondToolKnown && o.secondToolDiameterMm > 0.0;
    record(slotFor(slot), i, o.through, secondCutter ? 0.0 : o.depthMm);
    if (secondCutter) {
      // The counterbore's flat-bottomed cutter. A second row rather than a
      // second number on the first: it is a second tool the machine has to be
      // loaded with, and a setup sheet that hid it would be short by one.
      const Slot second{CutterKind::EndMill, o.secondToolDiameterMm, true};
      record(slotFor(second), i, false, o.depthMm);
    }
  }

  // Smallest first, unsized last. The smallest cutter is the one that limits the
  // job, and a machinist reads it first.
  std::sort(out.tools.begin(), out.tools.end(),
            [](const RequiredTool& a, const RequiredTool& b) {
              if (a.diameterKnown != b.diameterKnown) return a.diameterKnown;
              if (a.diameterKnown && a.diameterMm != b.diameterMm) {
                return a.diameterMm < b.diameterMm;
              }
              return static_cast<int>(a.kind) < static_cast<int>(b.kind);
            });

  for (const RequiredTool& t : out.tools) {
    if (t.diameterKnown) {
      ++out.sizedTools;
      if (!out.smallestKnown || t.diameterMm < out.smallestMm) {
        out.smallestMm = t.diameterMm;
        out.smallestKnown = true;
      }
      if (!out.largestKnown || t.diameterMm > out.largestMm) {
        out.largestMm = t.diameterMm;
        out.largestKnown = true;
      }
    }
    if (t.depthKnown && (!out.deepestKnown || t.deepestCutMm > out.deepestMm)) {
      out.deepestMm = t.deepestCutMm;
      out.deepestKnown = true;
    }
  }
  return out;
}

}  // namespace forge::ui
