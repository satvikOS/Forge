#include "forge/ui/InspectionReport.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/Material.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/PartCommands.hpp"

namespace forge::ui {

namespace {

// Fixed-point, never scientific: a panel row reading "1.4e+03 mm3" is a number a
// machinist has to decode. snprintf into a bounded buffer keeps this free of a
// stream's locale, which can put a comma where a user expects a point.
std::string fixed(double v, int decimals) {
  char buf[64];
  std::snprintf(buf, sizeof(buf), "%.*f", decimals, v);
  return buf;
}

std::string count(std::size_t n) { return std::to_string(n); }

}  // namespace

// ── the nth numeric argument ────────────────────────────────────────────────
std::size_t numericArgCount(const std::vector<IrArg>& args) noexcept {
  std::size_t n = 0;
  for (const IrArg& a : args) {
    if (a.kind == IrArgKind::Number) ++n;
  }
  return n;
}

std::size_t numericArgSlot(const std::vector<IrArg>& args, std::size_t index) noexcept {
  std::size_t seen = 0;
  for (std::size_t i = 0; i < args.size(); ++i) {
    if (args[i].kind != IrArgKind::Number) continue;
    if (seen == index) return i;
    ++seen;
  }
  return args.size();
}

const char* toString(CheckState state) noexcept {
  switch (state) {
    case CheckState::Pass:          return "pass";
    case CheckState::Fail:          return "fail";
    case CheckState::Unavailable:   return "unavailable";
    case CheckState::Informational: return "reported";
  }
  return "unavailable";
}

// ── 1. the two instruments ──────────────────────────────────────────────────
InspectionReport buildInspectionReport(const KernelSolidReport& kernel, const MeshMeasure& mesh,
                                       const std::vector<FeatureRecord>& records) {
  InspectionReport report;
  const auto add = [&report](std::string name, CheckState state, std::string detail) {
    InspectionCheck c;
    c.name = std::move(name);
    c.state = state;
    c.evidence = std::move(detail);
    report.checks.push_back(std::move(c));
  };

  // ── A. did every feature the document declares actually get built? ────────
  // s0.4: a statement that is declared and parsed but never compiled is a
  // MISSING FEATURE reported as a built part. The counts come from the kernel's
  // own report, so this is the kernel contradicting itself, not us guessing.
  if (kernel.declared == 0) {
    add("Every feature was built", CheckState::Unavailable,
        "this part has no features yet");
  } else if (kernel.declared == kernel.parsed && kernel.parsed == kernel.compiled) {
    add("Every feature was built", CheckState::Pass,
        count(kernel.compiled) + " of " + count(kernel.declared) + " built");
  } else {
    add("Every feature was built", CheckState::Fail,
        count(kernel.declared) + " asked for, " + count(kernel.parsed) + " understood, " +
            count(kernel.compiled) + " built");
  }

  // ── B. the kernel's own verdict on the solid ──────────────────────────────
  if (!kernel.built) {
    add("The part rebuilt", CheckState::Fail, "the last rebuild did not finish");
  } else {
    add("The part rebuilt", CheckState::Pass, "every step finished");
    add("The solid is sound", kernel.valid ? CheckState::Pass : CheckState::Fail,
        kernel.valid ? "closed, single-sided and consistently wound"
                     : "the shape has a gap, a doubled face or a side facing the wrong way");
  }

  // ── C. THE SECOND INSTRUMENT ──────────────────────────────────────────────
  // The surface on screen, measured on its own, without asking the modeller
  // whether it is happy. This is the check that can catch a build reported as
  // successful over geometry that is not closed — the one failure a single
  // reported number can never expose.
  if (mesh.triangles == 0) {
    add("The surface on screen closes", CheckState::Unavailable,
        "there is nothing drawn to measure");
  } else if (mesh.watertight) {
    add("The surface on screen closes", CheckState::Pass,
        count(mesh.triangles) + " triangles over " + count(mesh.faces) +
            " faces, every edge shared by exactly two");
    add("The surface faces outward", mesh.outward ? CheckState::Pass : CheckState::Fail,
        mesh.outward ? "the outside of the shape is the side you can see"
                     : "the shape is inside out");
  } else {
    add("The surface on screen closes", CheckState::Fail,
        count(mesh.boundaryEdges) + " open, " + count(mesh.nonManifoldEdges) + " shared by more "
            "than two faces, " + count(mesh.reversedEdges) + " wound the same way twice");
  }

  // ── D. do the two instruments agree on how many faces there are? ──────────
  // Both are counting B-rep faces: the kernel from its own topology, the mesh
  // from the face id every triangle carries. A disagreement means the picture
  // is not of the solid that was reported.
  if (kernel.faceCount < 0 || mesh.triangles == 0) {
    add("The picture shows every face", CheckState::Unavailable,
        "only one of the two counts is available");
  } else if (static_cast<std::size_t>(kernel.faceCount) == mesh.faces) {
    add("The picture shows every face", CheckState::Pass,
        count(mesh.faces) + " faces, counted two independent ways");
  } else {
    add("The picture shows every face", CheckState::Fail,
        "the shape has " + std::to_string(kernel.faceCount) + " faces and the picture shows " +
            count(mesh.faces));
  }

  // ── E. is the drawn shape inside the reported box? ────────────────────────
  // Every drawn vertex is a point ON the shape, so the drawn box can fall short
  // of the reported one (a curved face is drawn with flats) but can never
  // exceed it. Exceeding it means the two are not the same shape.
  if (!kernel.bboxKnown || !mesh.box.valid) {
    add("The drawn shape fits the reported size", CheckState::Unavailable,
        "only one of the two sizes is available");
  } else {
    double slack = 0.0;
    for (std::size_t a = 0; a < 3; ++a) {
      slack = std::max(slack, kernel.bboxMax[a] - kernel.bboxMin[a]);
    }
    slack *= kInspectionBoxSlackFraction;
    double worst = 0.0;
    for (std::size_t a = 0; a < 3; ++a) {
      worst = std::max(worst, kernel.bboxMin[a] - mesh.box.min[a]);
      worst = std::max(worst, mesh.box.max[a] - kernel.bboxMax[a]);
    }
    if (worst <= slack) {
      add("The drawn shape fits the reported size", CheckState::Pass,
          "within " + fixed(slack, 6) + " mm of the reported size on every axis");
    } else {
      add("The drawn shape fits the reported size", CheckState::Fail,
          "the drawing reaches " + fixed(worst, 6) + " mm outside the reported size");
    }
  }

  // ── F. the volumes, REPORTED and not graded ───────────────────────────────
  // The modeller's volume is exact. The drawn volume is the same shape with its
  // curves flattened into triangles, so the two are expected to differ, and by
  // how much is a reading about how finely the part is drawn — not a defect.
  if (!kernel.built || kernel.volumeMm3 <= 0.0 || !mesh.watertight) {
    add("Volume, measured two ways", CheckState::Unavailable,
        "one of the two measurements is not available");
  } else {
    const double rel = 100.0 * (mesh.volume - kernel.volumeMm3) / kernel.volumeMm3;
    // The SIGN comes off the ROUNDED figure, not the raw one. A difference of
    // -1e-14% is zero at four decimals, and printing it as "-0.0000%" reads as a
    // shortfall that is not there.
    std::string shown = fixed(rel, 4);
    if (shown == "-0.0000" || shown == "0.0000") shown = "0.0000";
    else if (shown[0] != '-') shown = "+" + shown;
    add("Volume, measured two ways", CheckState::Informational,
        fixed(kernel.volumeMm3, 3) + " mm3 exact, " + fixed(mesh.volume, 3) +
            " mm3 as drawn (" + shown + "%)");
  }

  // ── G. is every statement a legal one? ────────────────────────────────────
  // The document's own grammar, checked over the whole program rather than at
  // the one statement that was last edited.
  if (records.empty()) {
    add("Every step is well formed", CheckState::Unavailable, "this part has no steps yet");
  } else {
    std::size_t bad = 0;
    std::string first;
    for (const FeatureRecord& r : records) {
      if (validateIr(r.line) == IrCheck::Ok) continue;
      ++bad;
      if (first.empty()) first = r.line.text();
    }
    if (bad == 0) {
      add("Every step is well formed", CheckState::Pass,
          count(records.size()) + " steps, all readable");
    } else {
      add("Every step is well formed", CheckState::Fail,
          count(bad) + " of " + count(records.size()) + " cannot be read, starting at " + first);
    }
  }

  for (const InspectionCheck& c : report.checks) {
    switch (c.state) {
      case CheckState::Pass:          ++report.passed; break;
      case CheckState::Fail:          ++report.failed; break;
      case CheckState::Unavailable:   ++report.unavailable; break;
      case CheckState::Informational: ++report.informational; break;
    }
  }
  return report;
}

// ── 2. the driving dimensions ───────────────────────────────────────────────
std::vector<DimensionRow> collectDrivingDimensions(const std::vector<FeatureRecord>& records) {
  std::vector<DimensionRow> rows;
  for (const FeatureRecord& rec : records) {
    const std::size_t numbers = numericArgCount(rec.line.args);
    for (std::size_t i = 0; i < numbers; ++i) {
      const std::size_t slot = numericArgSlot(rec.line.args, i);
      if (slot >= rec.line.args.size()) continue;  // unreachable; never guessed at
      DimensionRow row;
      row.irId = rec.irId;
      row.op = rec.line.op;
      row.label = rec.label;
      row.numberIndex = i;
      row.argSlot = slot;
      row.value = rec.line.args[slot].number;
      rows.push_back(std::move(row));
    }
  }
  return rows;
}

std::size_t statementsWithoutDimensions(const std::vector<FeatureRecord>& records) noexcept {
  std::size_t n = 0;
  for (const FeatureRecord& rec : records) {
    if (numericArgCount(rec.line.args) == 0) ++n;
  }
  return n;
}

// ── 4. the smallest block this part can be cut from ─────────────────────────
StockEnvelope stockEnvelope(const MeasureBox& box, double partVolumeMm3) noexcept {
  StockEnvelope s;
  if (!box.valid) return s;
  for (std::size_t a = 0; a < 3; ++a) s.size[a] = box.size(a);
  s.blockVolumeMm3 = s.size[0] * s.size[1] * s.size[2];
  s.partVolumeMm3 = partVolumeMm3;
  // A flat or empty box has no block, and a part cannot be bigger than the box
  // that contains it. Either says one of the two measurements is wrong, and the
  // honest answer to that is "unknown", never a negative amount of swarf.
  if (!(s.blockVolumeMm3 > 0.0) || !(partVolumeMm3 > 0.0)) return s;
  if (partVolumeMm3 > s.blockVolumeMm3) return s;
  s.removedVolumeMm3 = s.blockVolumeMm3 - partVolumeMm3;
  s.removedFraction = s.removedVolumeMm3 / s.blockVolumeMm3;
  s.buyToFly = s.blockVolumeMm3 / partVolumeMm3;
  s.known = true;
  return s;
}

// ── 3. what it would weigh ──────────────────────────────────────────────────
std::vector<MassRow> massTable(double volumeMm3) {
  std::vector<MassRow> rows;
  // A volume of zero is not a light part, it is a part nobody has measured.
  if (!(volumeMm3 > 0.0)) return rows;
  for (const Material& m : materialLibrary()) {
    if (!m.hasDensity()) continue;
    MassRow row;
    row.material = m;
    row.properties = massPropertiesOf(m, volumeMm3);
    rows.push_back(std::move(row));
  }
  std::sort(rows.begin(), rows.end(), [](const MassRow& a, const MassRow& b) {
    if (a.properties.massGrams != b.properties.massGrams) {
      return a.properties.massGrams < b.properties.massGrams;
    }
    return a.material.id < b.material.id;
  });
  return rows;
}

}  // namespace forge::ui
