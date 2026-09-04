// ui/test/sketch_diagnosis_test.cpp
//
// WHAT THE CONSTRAINTS, RELATIONS AND SOLVER TABS SHOW.
//
// Three of the eight tabs of the Sketch workspace drew nothing at all. They are
// now three readings of the sketch family the part document already carries, and
// the rule they are written to is InspectionReport.hpp's: A PANEL MAY ONLY PRINT
// WHAT SOMETHING HEADLESS HAS ALREADY ASSERTED.
//
// Four kinds of check, and the first is the one that makes the rest worth
// anything:
//
//   A. THE TABLES ARE RE-DERIVED FROM THE KERNEL THAT SOLVES THE SKETCH. "a
//      point is two free numbers" and "a coincidence holds two of them" are
//      facts about forge-kernel/src/Sketcher.cpp, not about this repository's
//      memory of them. Both halves are read out of that file AS DATA -- the
//      geometry side from Sketch::collectUnknowns(), which is the function that
//      hands the solver its unknowns, and the constraint side from the arms of
//      addConstraint(). The constraint side is then cross-checked against a
//      SECOND, independent table in the same repository,
//      forge-kernel/src/SketchDof.cpp, and must agree with it row for row.
//   B. the census is TOTAL -- every geometry row lands in exactly one cluster,
//      every constraint either holds something or is named as holding nothing.
//   C. the faults FIRE, each one on a fixture built to trip exactly it.
//   D. POSITIVE CONTROLS. A panel showing a plausible constant passes any check
//      that only asks "is there a number here". So the fixtures are EDITED and
//      the answers must move.
#include <algorithm>
#include <cctype>
#include <cstddef>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/ModelTree.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SketchDiagnosis.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

std::string repoRoot() {
#ifdef FORGE_UI_REPO_ROOT
  return std::string(FORGE_UI_REPO_ROOT);
#else
  return std::string(".");
#endif
}

std::string readFile(const std::string& path, bool& ok) {
  std::ifstream in(path, std::ios::binary);
  if (!in) { ok = false; return {}; }
  std::ostringstream ss;
  ss << in.rdbuf();
  ok = true;
  return ss.str();
}

// The brace-balanced body that follows `signature` in `src`. Returns "" when the
// signature is absent or its body never closes -- both of which must FAIL a
// derivation rather than quietly yield an empty answer that matches nothing.
std::string bodyAfter(const std::string& src, const std::string& signature) {
  const std::size_t at = src.find(signature);
  if (at == std::string::npos) return {};
  const std::size_t open = src.find('{', at);
  if (open == std::string::npos) return {};
  int depth = 0;
  for (std::size_t i = open; i < src.size(); ++i) {
    if (src[i] == '{') ++depth;
    if (src[i] == '}') {
      --depth;
      if (depth == 0) return src.substr(open, i - open + 1);
    }
  }
  return {};
}

std::size_t countOf(const std::string& hay, const std::string& needle) {
  std::size_t n = 0;
  std::size_t at = 0;
  while ((at = hay.find(needle, at)) != std::string::npos) {
    ++n;
    at += needle.size();
  }
  return n;
}

bool contains(const std::string& hay, const std::string& needle) {
  return hay.find(needle) != std::string::npos;
}

// One arm of the constraint switch in Sketcher.cpp: everything from
// `case SketchConstraintKind::NAME:` to the next `case ` at the same level. The
// arms are `case X: { ... }` so the next `\n    case ` is the boundary.
std::string switchArm(const std::string& src, const std::string& enumerator) {
  const std::string open = "case SketchConstraintKind::" + enumerator + ":";
  const std::size_t at = src.find(open);
  if (at == std::string::npos) return {};
  const std::size_t next = src.find("\n    case SketchConstraintKind::", at + open.size());
  const std::size_t end = next == std::string::npos ? src.size() : next;
  return src.substr(at, end - at);
}

// Appends one statement through the REAL receiver, so a malformed fixture fails
// as a fixture rather than as a mysteriously empty answer.
int append(PartDocument& doc, const char* op, std::vector<IrArg> args, IrValueKind kind,
           const char* label) {
  FeatureRecord r;
  r.irId = doc.nextIrId();
  r.label = label;
  r.produces = kind;
  r.line.id = r.irId;
  r.line.op = op;
  r.line.args = std::move(args);
  return doc.appendFeature(r, {}, std::string()) ? r.irId : 0;
}

int sketch(PartDocument& doc, const char* plane, const char* label) {
  return append(doc, "SKETCH", {IrArg::keyword(plane)}, IrValueKind::Sketch, label);
}
int point(PartDocument& doc, int owner, double x, double y, const char* label) {
  return append(doc, "SPT", {IrArg::valueRef(owner), IrArg::num(x), IrArg::num(y)},
                IrValueKind::SketchRef, label);
}
int line(PartDocument& doc, int a, int b, const char* label) {
  return append(doc, "SLINE", {IrArg::valueRef(a), IrArg::valueRef(b)}, IrValueKind::SketchRef,
                label);
}
int circle(PartDocument& doc, int centre, double r, const char* label) {
  return append(doc, "SCIRC", {IrArg::valueRef(centre), IrArg::num(r)}, IrValueKind::SketchRef,
                label);
}
int con(PartDocument& doc, std::vector<IrArg> args, const char* label) {
  return append(doc, "CON", std::move(args), IrValueKind::Sketch, label);
}

const SketchConstraintRow* rowFor(const SketchDiagnosis& d, int irId) {
  for (const SketchConstraintRow& c : d.constraints) {
    if (c.irId == irId) return &c;
  }
  return nullptr;
}

const SketchGeometryRow* geomFor(const SketchDiagnosis& d, int irId) {
  for (const SketchGeometryRow& g : d.geometry) {
    if (g.irId == irId) return &g;
  }
  return nullptr;
}

}  // namespace

int main() {
  Harness H("sketch_diagnosis");
  const std::string root = repoRoot();

  // ── A. THE TABLES, RE-DERIVED FROM THE KERNEL ────────────────────────────
  {
    bool ok = false;
    const std::string sketcher = readFile(root + "/forge-kernel/src/Sketcher.cpp", ok);
    if (!ok) std::printf("  cannot read forge-kernel/src/Sketcher.cpp -- nothing to derive from\n");
    CHECK(ok);

    // ── the geometry side: Sketch::collectUnknowns() ───────────────────────
    // It pushes one unknown per free number, grouped by a loop over each
    // container. The count per kind is how many push_back calls its loop makes.
    const std::string unknowns = bodyAfter(sketcher, "void collectUnknowns(");
    if (unknowns.empty()) {
      std::printf("  collectUnknowns() was not found in Sketcher.cpp -- the geometry side of "
                  "the table cannot be derived and must not be assumed\n");
    }
    CHECK(!unknowns.empty());
    if (!unknowns.empty()) {
      const std::size_t pointsAt = unknowns.find("gcsPoints");
      const std::size_t circlesAt = unknowns.find(": circles");
      const std::size_t arcsAt = unknowns.find(": arcs");
      CHECK(pointsAt != std::string::npos);
      CHECK(circlesAt != std::string::npos);
      CHECK(arcsAt != std::string::npos);
      // A LINE pushes nothing: it is two points that already counted themselves.
      // If a `lines` loop ever appears here, this table is wrong and says so.
      CHECK(!contains(unknowns, ": lines"));
      if (pointsAt != std::string::npos && circlesAt != std::string::npos &&
          arcsAt != std::string::npos && pointsAt < circlesAt && circlesAt < arcsAt) {
        const std::size_t pointPushes =
            countOf(unknowns.substr(pointsAt, circlesAt - pointsAt), "push_back(");
        const std::size_t circlePushes =
            countOf(unknowns.substr(circlesAt, arcsAt - circlesAt), "push_back(");
        const std::size_t arcPushes = countOf(unknowns.substr(arcsAt), "push_back(");
        CHECK_EQ_INT(sketchFreedoms(SketchGeometryKind::Point), pointPushes);
        CHECK_EQ_INT(sketchFreedoms(SketchGeometryKind::Circle), circlePushes);
        CHECK_EQ_INT(sketchFreedoms(SketchGeometryKind::Arc), arcPushes);
        CHECK_EQ_INT(sketchFreedoms(SketchGeometryKind::Line), 0);
        // and the derivation itself found real numbers, not zeroes from a
        // substring that stopped matching.
        CHECK_EQ_INT(pointPushes, 2);
        CHECK_EQ_INT(circlePushes, 1);
        CHECK_EQ_INT(arcPushes, 3);
      }
    }

    // ── the constraint side: the arms of addConstraint() ───────────────────
    // Each arm is one or more calls into the solver. The freedoms it holds is
    // the number of the solver's own equations those calls add, and the only
    // two primitives that are worth more than one are the point equalities:
    // P2PCoincident is x AND y (GCS.cpp), and P2PSymmetric is two constraints.
    struct KindRow { const char* keyword; const char* enumerator; };
    const KindRow kKinds[] = {
        {"COINC", "Coincident"},  {"PARA", "Parallel"},      {"PERP", "Perpendicular"},
        {"TANG", "Tangent"},      {"EQUAL", "Equal"},        {"CONC", "Concentric"},
        {"COLL", "Collinear"},    {"SYMM", "Symmetric"},     {"MIDPT", "Midpoint"},
        {"HORIZ", "Horizontal"},  {"VERT", "Vertical"},      {"PTON", "PointOnLine"},
        {"FIX", "Fix"},           {"DIST", "Distance"},      {"DISTX", "DistanceX"},
        {"DISTY", "DistanceY"},   {"ANGLE", "Angle"},        {"RADIUS", "Radius"},
        {"DIAM", "Diameter"},
    };
    for (const KindRow& k : kKinds) {
      const std::string arm = switchArm(sketcher, k.enumerator);
      if (arm.empty()) {
        std::printf("  no switch arm for SketchConstraintKind::%s -- the kind this UI names "
                    "\"%s\" is not one the kernel dispatches\n", k.enumerator, k.keyword);
      }
      CHECK(!arm.empty());
      if (arm.empty()) continue;

      // ── HOW MANY EQUATIONS THE ARM ADDS ────────────────────────────────
      // Counting the calls in the arm is WRONG on its own, and getting that
      // wrong is what this comment is for. Some arms make several calls of
      // which exactly ONE fires -- PTON chooses between point-on-line,
      // point-on-circle and point-on-arc by the target's kind, TANG chooses
      // between five overloads, ANGLE between two -- while others make several
      // that ALL fire: COLL is a parallel plus an endpoint on the other line,
      // and FIX is an x coordinate plus a y.
      //
      // The two are told apart by whether the arm BRANCHES. A branchless arm
      // runs every call it contains; a branching one runs one alternative. And
      // exactly two of the solver's primitives are worth more than one equation:
      // a point coincidence is x AND y, and a point symmetry is two constraints
      // (both read out of GCS.cpp).
      const bool branches = contains(arm, "if (") || contains(arm, "switch (");
      const std::size_t calls = countOf(arm, "gcs.addConstraint");
      const std::size_t doubles = countOf(arm, "gcs.addConstraintP2PCoincident") +
                                  countOf(arm, "gcs.addConstraintP2PSymmetric");
      CHECK(calls >= 1);
      std::size_t derived = 0;
      if (!branches) {
        derived = calls + doubles;  // every call fires
      } else {
        // One alternative fires. It is worth 2 only when every alternative in
        // the arm is one of the two doubled primitives.
        derived = (doubles == calls) ? 2 : 1;
      }
      bool known = false;
      const std::size_t held = constraintFreedomsHeld(k.keyword, known);
      CHECK(known);
      if (held != derived) {
        std::printf("  %s holds %zu here and the kernel's arm adds %zu solver equations\n",
                    k.keyword, held, derived);
      }
      CHECK_EQ_INT(held, derived);

      // ── HOW MANY OPERANDS THE KIND TAKES ───────────────────────────────
      // The arm's own need(N). HORIZ and VERT have a SECOND, shorter form --
      // one operand when it is a line -- and their need(2) sits in the else of
      // that branch, so the ordinary count is what is compared and the shorter
      // form is asserted separately, by the guard that selects it.
      const std::size_t needAt = arm.find("need(");
      CHECK(needAt != std::string::npos);
      if (needAt != std::string::npos) {
        const std::size_t wants =
            static_cast<std::size_t>(std::atoi(arm.c_str() + needAt + 5));
        bool arity = false;
        const std::size_t declared = constraintOperandCount(k.keyword, arity);
        CHECK(arity);
        if (declared != wants) {
          std::printf("  %s takes %zu operands here and need(%zu) in the kernel\n", k.keyword,
                      declared, wants);
        }
        CHECK_EQ_INT(declared, wants);
      }
      // The line form exists for exactly the kinds whose arm dispatches on the
      // operand being an entity, and for no others.
      // The GUARD, not the words in it: EQUAL and ANGLE also ask whether an
      // operand is an entity, and neither has a shorter form.
      const bool armHasLineForm = contains(arm, "refs.size() >= 1 && isEntity(refs[0])");
      CHECK_EQ_INT(constraintHasLineForm(k.keyword) ? 1 : 0, armHasLineForm ? 1 : 0);
      // Every keyword this file names is one the sketch tree can also name, so
      // the Constraints tab and the Sketch tab can never call one thing two.
      CHECK(!constraintDisplayName(k.keyword).empty());
    }

    // ── the SECOND source: forge-kernel/src/SketchDof.cpp ─────────────────
    // An independent counting table in the same repository. It names fifteen of
    // the nineteen kinds, and on those fifteen the two must AGREE. A table that
    // matched only the source it was copied from would prove nothing.
    bool dofOk = false;
    const std::string dofSrc = readFile(root + "/forge-kernel/src/SketchDof.cpp", dofOk);
    CHECK(dofOk);
    if (dofOk) {
      struct Cross { const char* keyword; const char* spelling; };
      const Cross kCross[] = {
          {"FIX", "fix"},           {"COINC", "coincident"},   {"HORIZ", "horizontal"},
          {"VERT", "vertical"},     {"DIST", "distance"},      {"RADIUS", "radius"},
          {"DIAM", "diameter"},     {"ANGLE", "angle"},        {"PARA", "parallel"},
          {"PERP", "perpendicular"},{"TANG", "tangent"},       {"EQUAL", "equal"},
          {"CONC", "concentric"},   {"SYMM", "symmetric"},     {"MIDPT", "midpoint"},
      };
      std::size_t crossed = 0;
      for (const Cross& c : kCross) {
        const std::string needle = std::string("{\"") + c.spelling + "\",";
        const std::size_t at = dofSrc.find(needle);
        if (at == std::string::npos) {
          std::printf("  SketchDof.cpp no longer names \"%s\"\n", c.spelling);
          continue;
        }
        const std::size_t value =
            static_cast<std::size_t>(std::atoi(dofSrc.c_str() + at + needle.size()));
        bool known = false;
        const std::size_t held = constraintFreedomsHeld(c.keyword, known);
        CHECK(known);
        if (held != value) {
          std::printf("  %s holds %zu here and %zu in SketchDof.cpp\n", c.keyword, held, value);
        }
        CHECK_EQ_INT(held, value);
        ++crossed;
      }
      // The cross-check must actually have run on all fifteen. A parse that
      // silently matched nothing would leave every CHECK above unexecuted and
      // this gate would report a triumphant pass over no comparison at all.
      CHECK_EQ_INT(crossed, 15);
    }

    // The six dimensional kinds, and only those, carry a number.
    const char* const kDimensional[] = {"DIST", "DISTX", "DISTY", "ANGLE", "RADIUS", "DIAM"};
    std::size_t dimensional = 0;
    for (const KindRow& k : kKinds) {
      bool want = false;
      for (const char* d : kDimensional) {
        if (std::string(d) == k.keyword) want = true;
      }
      CHECK_EQ_INT(constraintIsDimensional(k.keyword) ? 1 : 0, want ? 1 : 0);
      if (want) ++dimensional;
    }
    CHECK_EQ_INT(dimensional, 6);

    // A keyword the kernel does not dispatch is UNKNOWN, never silently zero.
    bool known = true;
    CHECK_EQ_INT(constraintFreedomsHeld("WOBBLE", known), 0);
    CHECK(!known);
  }

  // ── B. A REAL SKETCH, AND THE ARITHMETIC OVER IT ─────────────────────────
  //
  //   %1 SKETCH(XY)
  //   %2 %3 %5  three points          2 free numbers each  = 6
  //   %4 %6     two lines             0 each
  //   FIX %2                          holds 2
  //   HORIZ %4                        holds 1
  //   DIST %2 %3 = 40                 holds 1
  //   DISTY %3 %5 = 25                holds 1
  //   VERT %6                         holds 1
  //                                   ---------------------------
  //                                   6 held, 6 free  -> fully held
  {
    PartDocument doc;
    const int s1 = sketch(doc, "XY", "Base Sketch");
    CHECK(s1 == 1);
    const int p0 = point(doc, s1, 0.0, 0.0, "Corner");
    const int p1 = point(doc, s1, 40.0, 0.0, "Right");
    const int l0 = line(doc, p0, p1, "Bottom");
    const int p2 = point(doc, s1, 40.0, 25.0, "Top Right");
    const int l1 = line(doc, p1, p2, "Right Wall");
    CHECK(p0 != 0 && p1 != 0 && l0 != 0 && p2 != 0 && l1 != 0);

    const int cFix = con(doc, {IrArg::valueRef(p0), IrArg::keyword("FIX")}, "Pin the corner");
    const int cHoriz = con(doc, {IrArg::valueRef(l0), IrArg::keyword("HORIZ")}, "Bottom flat");
    const int cDist = con(doc, {IrArg::valueRef(p0), IrArg::keyword("DIST"), IrArg::valueRef(p1),
                                IrArg::num(40.0)}, "Width 40");
    const int cDistY = con(doc, {IrArg::valueRef(p1), IrArg::keyword("DISTY"), IrArg::valueRef(p2),
                                 IrArg::num(25.0)}, "Height 25");
    const int cVert = con(doc, {IrArg::valueRef(l1), IrArg::keyword("VERT")}, "Right upright");
    CHECK(cFix != 0 && cHoriz != 0 && cDist != 0 && cDistY != 0 && cVert != 0);

    const SketchDiagnosisSet set = buildSketchDiagnosis(doc);
    CHECK_EQ_INT(set.sketches.size(), 1);
    CHECK_EQ_INT(set.unattached, 0);
    if (set.sketches.empty()) return H.finish();
    const SketchDiagnosis& d = set.sketches.front();

    CHECK_EQ_STR(d.plane, "XY");
    CHECK_EQ_INT(d.geometry.size(), 5);
    CHECK_EQ_INT(d.points, 3);
    CHECK_EQ_INT(d.curves, 2);
    CHECK_EQ_INT(d.constraints.size(), 5);
    CHECK_EQ_INT(d.faults, 0);
    CHECK_EQ_INT(d.freedoms, 6);
    CHECK_EQ_INT(d.held, 6);
    CHECK_EQ_INT(d.stillFree, 0);
    CHECK(d.definition == SketchDefinition::Fully);
    CHECK_EQ_INT(d.solvedBy, 0);

    // THE CENSUS IS TOTAL: the freedoms are the sum over the geometry rows and
    // the held is the sum over the sound constraints. Re-derived here rather
    // than trusted.
    std::size_t freedoms = 0;
    for (const SketchGeometryRow& g : d.geometry) freedoms += g.freedoms;
    CHECK_EQ_INT(freedoms, d.freedoms);
    std::size_t held = 0;
    std::size_t faults = 0;
    for (const SketchConstraintRow& c : d.constraints) {
      held += c.holds;
      if (c.fault != ConstraintFault::None) ++faults;
      // A constraint that holds nothing must SAY so, and one that holds
      // something must not be reported as faulty. The two can never both be
      // true, which is what makes the count above unambiguous.
      CHECK((c.fault == ConstraintFault::None) == (c.holds > 0));
    }
    CHECK_EQ_INT(held, d.held);
    CHECK_EQ_INT(faults, d.faults);

    // Every geometry row is in exactly one cluster, and this sketch is ONE
    // connected piece: every point is reached from every other through a line or
    // a constraint.
    CHECK_EQ_INT(d.clusters.size(), 1);
    std::size_t members = 0;
    for (const SketchCluster& c : d.clusters) members += c.members.size();
    CHECK_EQ_INT(members, d.geometry.size());
    CHECK_EQ_INT(d.clusters.front().freedoms, 6);
    CHECK_EQ_INT(d.clusters.front().held, 6);
    CHECK(d.clusters.front().pinned);

    // The pin is on the point the FIX names, and on nothing else.
    const SketchGeometryRow* pinned = geomFor(d, p0);
    CHECK(pinned != nullptr);
    if (pinned != nullptr) CHECK(pinned->pinned);
    const SketchGeometryRow* other = geomFor(d, p1);
    CHECK(other != nullptr);
    if (other != nullptr) CHECK(!other->pinned);

    // Every geometry row is reached by a sound constraint, so nothing is
    // untouched. That is the EXACT half of the answer: it needs no arithmetic
    // about how much anything holds.
    CHECK_EQ_INT(d.untouched, 0);

    // A dimensional constraint carries the document's own number.
    const SketchConstraintRow* dist = rowFor(d, cDist);
    CHECK(dist != nullptr);
    if (dist != nullptr) {
      CHECK_EQ_STR(dist->keyword, "DIST");
      CHECK_EQ_STR(dist->name, "Distance");
      CHECK(dist->dimensional);
      CHECK(dist->hasValue);
      CHECK_NEAR(dist->value, 40.0, 1e-9);
      CHECK_EQ_INT(dist->operands.size(), 2);
      CHECK_EQ_INT(dist->holds, 1);
      // and it names both rows it holds, by the labels the document gave them.
      CHECK(contains(dist->evidence, "Corner"));
      CHECK(contains(dist->evidence, "Right"));
      CHECK(contains(dist->evidence, "40"));
    }

    // ── the links: a line is built on its two points ─────────────────────
    std::size_t builtOn = 0;
    std::size_t constrained = 0;
    for (const SketchLink& link : d.links) {
      CHECK(link.from < d.geometry.size());
      CHECK(link.to < d.geometry.size());
      if (link.kind == SketchLinkKind::BuiltOn) ++builtOn;
      else ++constrained;
    }
    // Two lines, two points each.
    CHECK_EQ_INT(builtOn, 4);
    // DIST and DISTY name two rows each; FIX, HORIZ and VERT name one, which
    // links nothing.
    CHECK_EQ_INT(constrained, 2);

    // ── D. THE POSITIVE CONTROLS ─────────────────────────────────────────
    //
    // 1. A REPEAT holds nothing. A naive count would add its 1 and report this
    //    sketch as over-constrained; the answer must not move at all.
    {
      PartDocument again = doc;
      const int repeat = con(again, {IrArg::valueRef(p0), IrArg::keyword("DIST"),
                                     IrArg::valueRef(p1), IrArg::num(40.0)}, "Width 40 again");
      CHECK(repeat != 0);
      const SketchDiagnosisSet s2 = buildSketchDiagnosis(again);
      CHECK_EQ_INT(s2.sketches.size(), 1);
      if (!s2.sketches.empty()) {
        const SketchDiagnosis& d2 = s2.sketches.front();
        CHECK_EQ_INT(d2.constraints.size(), 6);
        CHECK_EQ_INT(d2.held, 6);
        CHECK_EQ_INT(d2.stillFree, 0);
        CHECK(d2.definition == SketchDefinition::Fully);
        CHECK_EQ_INT(d2.faults, 1);
        const SketchConstraintRow* r = rowFor(d2, repeat);
        CHECK(r != nullptr);
        if (r != nullptr) {
          CHECK(r->fault == ConstraintFault::Repeated);
          CHECK_EQ_INT(r->repeatOf, cDist);
          CHECK_EQ_INT(r->holds, 0);
        }
        CHECK_EQ_INT(s2.faultCount(), 1);
      }
    }

    // 2. ADDING GEOMETRY MOVES THE ANSWER. One more point is two more free
    //    numbers, a second cluster, and one more row nothing reaches.
    {
      PartDocument again = doc;
      const int loose = point(again, s1, 90.0, 90.0, "Loose Point");
      CHECK(loose != 0);
      const SketchDiagnosisSet s2 = buildSketchDiagnosis(again);
      CHECK_EQ_INT(s2.sketches.size(), 1);
      if (!s2.sketches.empty()) {
        const SketchDiagnosis& d2 = s2.sketches.front();
        CHECK_EQ_INT(d2.freedoms, 8);
        CHECK_EQ_INT(d2.held, 6);
        CHECK_EQ_INT(d2.stillFree, 2);
        CHECK(d2.definition == SketchDefinition::Under);
        CHECK_EQ_INT(d2.clusters.size(), 2);
        CHECK_EQ_INT(d2.untouched, 1);
        CHECK_EQ_INT(s2.unresolved(), 1);
      }
    }

    // 3. A SECOND, DIFFERENT DIMENSION over the same two points is not a
    //    repeat: it is a contradiction, and the two are named separately
    //    because a user does something different about each. It holds nothing,
    //    exactly as the repeat does, because the kernel's own solve contract
    //    demotes it rather than failing.
    {
      PartDocument again = doc;
      const int extra = con(again, {IrArg::valueRef(p0), IrArg::keyword("DIST"),
                                    IrArg::valueRef(p1), IrArg::num(55.0)}, "Width 55");
      CHECK(extra != 0);
      const SketchDiagnosisSet s2 = buildSketchDiagnosis(again);
      if (!s2.sketches.empty()) {
        const SketchDiagnosis& d2 = s2.sketches.front();
        CHECK_EQ_INT(d2.held, 6);
        CHECK_EQ_INT(d2.faults, 1);
        const SketchConstraintRow* r = rowFor(d2, extra);
        CHECK(r != nullptr);
        if (r != nullptr) {
          CHECK(r->fault == ConstraintFault::Contradicts);
          CHECK_EQ_INT(r->repeatOf, cDist);
          CHECK_EQ_INT(r->holds, 0);
        }
      }
    }

    // 3b. OVER-HELD, for real: a second pin on a point that is already located
    //     by everything else. Nothing is repeated and nothing contradicts --
    //     the sketch simply says more than it has to give, and the count says
    //     so.
    {
      PartDocument again = doc;
      const int pin = con(again, {IrArg::valueRef(p1), IrArg::keyword("FIX")}, "Pin the right");
      CHECK(pin != 0);
      const SketchDiagnosisSet s2 = buildSketchDiagnosis(again);
      if (!s2.sketches.empty()) {
        const SketchDiagnosis& d2 = s2.sketches.front();
        CHECK_EQ_INT(d2.held, 8);
        CHECK_EQ_INT(d2.stillFree, -2);
        CHECK(d2.definition == SketchDefinition::Over);
        CHECK_EQ_INT(d2.faults, 0);
      }
    }

    // 4. A CIRCLE'S RADIUS IS A FREE NUMBER, and its centre is a point of its
    //    own -- which is what the geometry table says and what the kernel's
    //    unknowns actually are.
    {
      PartDocument again = doc;
      const int centre = point(again, s1, 10.0, 10.0, "Bore Centre");
      const int hole = circle(again, centre, 4.0, "Bore");
      CHECK(centre != 0 && hole != 0);
      const SketchDiagnosisSet s2 = buildSketchDiagnosis(again);
      if (!s2.sketches.empty()) {
        const SketchDiagnosis& d2 = s2.sketches.front();
        // 6 from before, 2 for the centre, 1 for the radius.
        CHECK_EQ_INT(d2.freedoms, 9);
        const SketchGeometryRow* g = geomFor(d2, hole);
        CHECK(g != nullptr);
        if (g != nullptr) {
          CHECK(g->kind == SketchGeometryKind::Circle);
          CHECK_EQ_INT(g->freedoms, 1);
          CHECK_EQ_INT(g->builtOn.size(), 1);
          CHECK(contains(g->evidence, "4"));
        }
      }
    }
  }

  // ── C. EVERY FAULT FIRES, ON A FIXTURE BUILT TO TRIP IT ──────────────────
  {
    PartDocument doc;
    const int s1 = sketch(doc, "XY", "First");
    const int a0 = point(doc, s1, 0.0, 0.0, "A0");
    const int a1 = point(doc, s1, 10.0, 0.0, "A1");
    const int s2 = sketch(doc, "YZ", "Second");
    const int b0 = point(doc, s2, 0.0, 0.0, "B0");
    CHECK(s1 != 0 && a0 != 0 && a1 != 0 && s2 != 0 && b0 != 0);

    // A keyword the kernel does not dispatch. It skips it and names it; so must
    // this, and it must hold nothing.
    const int bad = con(doc, {IrArg::valueRef(a0), IrArg::keyword("WOBBLE")}, "Wobble");
    // An operand from ANOTHER sketch. The kernel skips it the same way.
    const int cross = con(doc, {IrArg::valueRef(a0), IrArg::keyword("COINC"),
                                IrArg::valueRef(b0)}, "Across two sketches");
    // Too few operands: SYMM takes three.
    const int short_ = con(doc, {IrArg::valueRef(a0), IrArg::keyword("SYMM"),
                                 IrArg::valueRef(a1)}, "Half a symmetry");
    CHECK(bad != 0 && cross != 0 && short_ != 0);

    const SketchDiagnosisSet set = buildSketchDiagnosis(doc);
    CHECK_EQ_INT(set.sketches.size(), 2);
    const SketchDiagnosis* first = set.find(s1);
    CHECK(first != nullptr);
    if (first != nullptr) {
      CHECK_EQ_INT(first->constraints.size(), 3);
      CHECK_EQ_INT(first->faults, 3);
      CHECK_EQ_INT(first->held, 0);
      // Nothing holds either point, so both are untouched and the sketch is
      // entirely free -- 2 points, 4 free numbers.
      CHECK_EQ_INT(first->freedoms, 4);
      CHECK_EQ_INT(first->stillFree, 4);
      CHECK_EQ_INT(first->untouched, 2);
      CHECK(first->definition == SketchDefinition::Under);

      const SketchConstraintRow* r = rowFor(*first, bad);
      CHECK(r != nullptr);
      if (r != nullptr) {
        CHECK(r->fault == ConstraintFault::UnknownKind);
        // NAMED, never renamed: the word the document carries is what is shown.
        CHECK_EQ_STR(r->name, "WOBBLE");
        CHECK_EQ_INT(r->holds, 0);
      }
      const SketchConstraintRow* x = rowFor(*first, cross);
      CHECK(x != nullptr);
      if (x != nullptr) {
        CHECK(x->fault == ConstraintFault::OperandUnresolved);
        CHECK_EQ_INT(x->holds, 0);
      }
      const SketchConstraintRow* s = rowFor(*first, short_);
      CHECK(s != nullptr);
      if (s != nullptr) {
        CHECK(s->fault == ConstraintFault::OperandCount);
        CHECK_EQ_INT(s->holds, 0);
      }
    }
    // The second sketch owns its own point and none of the constraints.
    const SketchDiagnosis* second = set.find(s2);
    CHECK(second != nullptr);
    if (second != nullptr) {
      CHECK_EQ_INT(second->geometry.size(), 1);
      CHECK_EQ_INT(second->constraints.size(), 0);
      CHECK(second->definition == SketchDefinition::Under);
    }
    CHECK_EQ_INT(set.unresolved(), 2);
  }

  // ── an empty document has no sketches, and says so rather than crashing ──
  {
    const PartDocument empty;
    const SketchDiagnosisSet set = buildSketchDiagnosis(empty);
    CHECK(set.empty());
    CHECK_EQ_INT(set.rowCount(), 0);
    CHECK_EQ_INT(set.constraintCount(), 0);
    CHECK_EQ_INT(set.unresolved(), 0);
    CHECK(set.find(1) == nullptr);
  }

  // ── a SOLVE is recorded against the sketch it closes ─────────────────────
  {
    PartDocument doc;
    const int s1 = sketch(doc, "XZ", "Closed");
    const int p = point(doc, s1, 1.0, 2.0, "P");
    CHECK(s1 != 0 && p != 0);
    const int solved = append(doc, "SOLVE", {IrArg::valueRef(s1)}, IrValueKind::Profile, "Solve");
    CHECK(solved != 0);
    const SketchDiagnosisSet set = buildSketchDiagnosis(doc);
    CHECK_EQ_INT(set.sketches.size(), 1);
    if (!set.sketches.empty()) {
      CHECK_EQ_INT(set.sketches.front().solvedBy, solved);
      CHECK_EQ_STR(set.sketches.front().plane, "XZ");
    }
  }

  return H.finish();
}
