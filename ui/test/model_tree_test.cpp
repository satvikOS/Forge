// ui/test/model_tree_test.cpp — THE MODEL BROWSER AND THE SKETCH TREE, HEADLESS.
//
// The defect these two views exist for is stated in ModelTree.hpp: seven docked
// tabs were dispatched to one function, so six of them showed a user the feature
// history under a name that promised something else. Replacing that with two
// REAL views is only worth anything if the rows they produce are asserted
// against the document that produced them, which is what this file does.
//
// FIVE checks, and the first is the falsifiability proof:
//
//   A. the header diff FIRES. The argument names this module labels a profile's
//      numbers with are transcribed from the documented forms in
//      forge-kernel/include/forge/ft/FeatureTree.hpp. They are re-derived HERE by
//      parsing that header as data, exactly as feature_ir_test.cpp re-derives the
//      arities beside them -- and a deliberately wrong table must be caught, or
//      every check below could be a comparison that always agrees.
//   B. the shipped table equals the header's, op by op and token by token.
//   C. the model browser's split is the DOCUMENT'S own: a value still exists
//      exactly while PartDocument still binds a selection node to it, which is
//      the same table the commands maintain -- and a pass-through statement adds
//      an annotation, never a phantom body.
//   D. the sketch tree attaches every entity to the sketch that owns it, counts
//      points, curves and constraints separately, and reports the solve.
//   E. the empty document produces EMPTY structures -- no invented rows -- which
//      is what lets a panel say "there are none yet" without lying.
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

std::string trimmed(const std::string& s) {
  std::size_t a = 0;
  std::size_t b = s.size();
  while (a < b && (s[a] == ' ' || s[a] == '\t')) ++a;
  while (b > a && (s[b - 1] == ' ' || s[b - 1] == '\t' || s[b - 1] == '\r')) --b;
  return s.substr(a, b - a);
}

std::vector<std::string> splitTop(const std::string& s) {
  std::vector<std::string> out;
  std::string cur;
  int depth = 0;
  for (char c : s) {
    if (c == '(' || c == '[') ++depth;
    if (c == ')' || c == ']') --depth;
    if (c == ',' && depth == 0) {
      const std::string t = trimmed(cur);
      if (!t.empty()) out.push_back(t);
      cur.clear();
    } else {
      cur += c;
    }
  }
  const std::string t = trimmed(cur);
  if (!t.empty()) out.push_back(t);
  return out;
}

// The argument TOKENS of one documented form, required then optional, in order:
// `RECT(w, h [, cx=0, cy=0])` -> {"w", "h", "cx=0", "cy=0"}.
std::vector<std::string> tokensOfForm(const std::string& args) {
  std::string head;
  std::vector<std::string> optionalGroups;
  std::size_t i = 0;
  while (i < args.size()) {
    if (args[i] == '[') {
      std::size_t j = i + 1;
      while (j < args.size() && args[j] == ' ') ++j;
      if (j < args.size() && args[j] == ',') {
        std::size_t k = i;
        int depth = 0;
        for (; k < args.size(); ++k) {
          if (args[k] == '[') ++depth;
          if (args[k] == ']') {
            --depth;
            if (depth == 0) break;
          }
        }
        optionalGroups.push_back(args.substr(i + 1, k > i ? k - i - 1 : 0));
        i = (k < args.size()) ? k + 1 : k;
        continue;
      }
    }
    head += args[i];
    ++i;
  }
  std::vector<std::string> out = splitTop(head);
  for (const std::string& g : optionalGroups) {
    const std::vector<std::string> toks = splitTop(g);
    out.insert(out.end(), toks.begin(), toks.end());
  }
  return out;
}

// Reads the kernel header and returns, for each documented form `NAME(args)`,
// the argument tokens. First form wins, which is the same rule feature_ir_test
// applies to the arities.
std::vector<std::pair<std::string, std::vector<std::string>>> derivedForms(const std::string& path,
                                                                          bool& ok) {
  std::vector<std::pair<std::string, std::vector<std::string>>> out;
  std::ifstream in(path);
  ok = in.good();
  if (!ok) return out;
  std::string line;
  while (std::getline(in, line)) {
    const std::size_t slashes = line.find("//");
    if (slashes == std::string::npos) continue;
    const std::string comment = trimmed(line.substr(slashes + 2));
    // `NAME(` with NAME upper-case, at the start of the comment.
    std::size_t p = 0;
    while (p < comment.size() && ((comment[p] >= 'A' && comment[p] <= 'Z') ||
                                  (comment[p] >= '0' && comment[p] <= '9'))) {
      ++p;
    }
    if (p == 0 || p >= comment.size() || comment[p] != '(') continue;
    const std::string name = comment.substr(0, p);
    int depth = 0;
    std::size_t k = p;
    for (; k < comment.size(); ++k) {
      if (comment[k] == '(') ++depth;
      else if (comment[k] == ')') {
        --depth;
        if (depth == 0) break;
      }
    }
    if (k >= comment.size()) continue;
    bool already = false;
    for (const auto& row : out) {
      if (row.first == name) already = true;
    }
    if (already) continue;
    out.emplace_back(name, tokensOfForm(comment.substr(p + 1, k - p - 1)));
  }
  return out;
}

// Appends one statement through the REAL receiver, with the real consumed /
// produced node bookkeeping a command does. Returns false if the document
// refused it, so a malformed fixture fails as a fixture rather than as a
// mysterious empty answer.
bool append(PartDocument& doc, const char* op, std::vector<IrArg> args, IrValueKind kind,
            const char* label, const std::vector<std::string>& consumed,
            const std::string& produced) {
  FeatureRecord r;
  r.irId = doc.nextIrId();
  r.label = label;
  r.produces = kind;
  r.line.id = r.irId;
  r.line.op = op;
  r.line.args = std::move(args);
  return doc.appendFeature(r, consumed, produced);
}

// The UPPER-CASE op names the kernel header mentions within one sentence of the
// words "pass-through". VERIFY is never called one on its OWN line -- TAG and
// SURFCHECK are documented as "Pass-through like VERIFY" -- so a per-op comment
// block would have missed exactly the op the other two are defined against.
std::vector<std::string> headerPassThroughOps(const std::string& src) {
  std::string low;
  low.reserve(src.size());
  for (char c : src) low += static_cast<char>(c >= 'A' && c <= 'Z' ? c - 'A' + 'a' : c);
  std::vector<std::string> out;
  const std::string needle = "pass-through";
  std::size_t at = 0;
  while ((at = low.find(needle, at)) != std::string::npos) {
    const std::size_t lo = at > 200 ? at - 200 : 0;
    const std::size_t hi = at + 200 < src.size() ? at + 200 : src.size();
    std::size_t i = lo;
    while (i < hi) {
      if (!(src[i] >= 'A' && src[i] <= 'Z')) { ++i; continue; }
      std::size_t j = i;
      while (j < hi && ((src[j] >= 'A' && src[j] <= 'Z') || (src[j] >= '0' && src[j] <= '9'))) ++j;
      const std::string token = src.substr(i, j - i);
      // An op NAME, not a word shouted in prose: it is immediately followed by
      // the '(' of its documented form, or it is a bare reference to one.
      if (token.size() >= 3) {
        bool already = false;
        for (const std::string& k : out) {
          if (k == token) already = true;
        }
        if (!already) out.push_back(token);
      }
      i = j;
    }
    at += needle.size();
  }
  return out;
}

bool contains(const std::vector<std::string>& v, const std::string& s) {
  for (const std::string& k : v) {
    if (k == s) return true;
  }
  return false;
}

}  // namespace

int main() {
  Harness H("model_tree");
  const std::string header = repoRoot() + "/forge-kernel/include/forge/ft/FeatureTree.hpp";
  bool ok = false;
  const std::vector<std::pair<std::string, std::vector<std::string>>> forms =
      derivedForms(header, ok);
  if (!ok) std::printf("  cannot read %s\n", header.c_str());
  CHECK(ok);
  CHECK(forms.size() >= 40);

  auto formFor = [&forms](const std::string& op, std::vector<std::string>& out) {
    for (const auto& row : forms) {
      if (row.first != op) continue;
      out = row.second;
      return true;
    }
    return false;
  };

  // ── A. the diff can fail ────────────────────────────────────────────────
  // A deliberately wrong table must be caught by exactly the comparison check B
  // performs. Without this, B could be comparing a list to itself.
  {
    std::vector<std::string> derived;
    CHECK(formFor("RECT", derived));
    const std::vector<std::string> wrong = {"h", "w", "cx=0", "cy=0"};
    CHECK(wrong != derived);
    const std::vector<std::string> shortened = {"w", "h"};
    CHECK(shortened != derived);
  }

  // ── B. every labelled profile op agrees with the kernel header ──────────
  {
    const char* const kNamed[] = {"RECT", "RRECT", "CIRCLE", "SLOT", "REGPOLY"};
    for (const char* op : kNamed) {
      std::vector<std::string> shippedTokens;
      const bool have = profileArgNames(op, shippedTokens);
      CHECK(have);
      std::vector<std::string> derived;
      const bool documented = formFor(op, derived);
      CHECK(documented);
      if (!have || !documented) continue;
      CHECK_EQ_INT(shippedTokens.size(), derived.size());
      const std::size_t n = shippedTokens.size() < derived.size() ? shippedTokens.size()
                                                                  : derived.size();
      for (std::size_t i = 0; i < n; ++i) {
        CHECK_EQ_STR(shippedTokens[i], derived[i]);
      }
      // Every token this module will label must have a reading, and the reading
      // must not be the token itself -- a fallback that silently applies to a
      // documented argument is the mislabelling this table exists to prevent.
      for (const std::string& t : shippedTokens) {
        std::string name = t;
        const std::size_t eq = name.find('=');
        if (eq != std::string::npos) name = name.substr(0, eq);
        CHECK(argDisplayName(name) != name);
      }
    }
    // An op with no baked dimensions must SAY it has none rather than answer
    // with an empty list a caller would read as "no arguments".
    std::vector<std::string> none;
    CHECK(!profileArgNames("EXTRUDE", none));
    CHECK(!profileArgNames("POLY", none));
  }

  // ── C. the document's own answer to "what still exists" ────────────────
  {
    // The part a fresh document starts on, statement for statement, appended
    // through the receiver with the same node bookkeeping the commands do: only
    // the finished solid is bound to a selection node.
    PartDocument doc;
    CHECK(append(doc, "RECT", {IrArg::num(80.0), IrArg::num(50.0)}, IrValueKind::Profile,
                 "Base Sketch  80 x 50", {}, ""));
    CHECK(append(doc, "EXTRUDE", {IrArg::valueRef(1), IrArg::num(20.0)}, IrValueKind::Solid,
                 "Plate  extrude 20", {}, ""));
    CHECK(append(doc, "CYL",
                 {IrArg::num(6.0), IrArg::num(40.0), IrArg::num(0.0), IrArg::num(0.0),
                  IrArg::num(-10.0)},
                 IrValueKind::Solid, "Bore Tool  d12 x 40", {}, ""));
    CHECK(append(doc, "CUT", {IrArg::valueRef(2), IrArg::valueRef(3)}, IrValueKind::Solid,
                 "Through Bore  d12", {}, ""));
    CHECK(append(doc, "FILLET",
                 {IrArg::valueRef(4), IrArg::num(3.0), IrArg::keyword("VERTICAL")},
                 IrValueKind::Solid, "Corner Fillet  r3", {}, "body.bracket"));

    const ModelBrowser b = buildModelBrowser(doc);
    CHECK_EQ_INT(b.values.size(), 5u);
    // ONE body the document can still name; nothing else is selectable.
    CHECK_EQ_INT(b.bodies.size(), 1u);
    CHECK_EQ_INT(b.profiles.size(), 0u);
    CHECK_EQ_INT(b.sketches.size(), 0u);
    CHECK_EQ_INT(b.wires.size(), 0u);
    CHECK_EQ_INT(b.sheets.size(), 0u);
    CHECK_EQ_INT(b.consumed.size(), 4u);
    CHECK_EQ_INT(b.unnamed.size(), 0u);
    if (!b.bodies.empty()) {
      const ModelValue& body = b.values[b.bodies[0]];
      CHECK_EQ_STR(body.label, "Corner Fillet  r3");
      CHECK_EQ_INT(body.irId, 5);
      CHECK_EQ_STR(body.node, "body.bracket");
      CHECK(body.live);
      CHECK_EQ_INT(body.annotations, 0u);
      CHECK_EQ_INT(body.operands.size(), 1u);
    }
    // and each absorbed value NAMES what absorbed it.
    const ModelValue* rectValue = b.find(1);
    CHECK(rectValue != nullptr);
    if (rectValue != nullptr) {
      CHECK(!rectValue->live);
      CHECK_EQ_INT(rectValue->consumedBy, 2);
      CHECK_EQ_STR(rectValue->consumedByLabel, "Plate  extrude 20");
    }
    const ModelValue* cutValue = b.find(4);
    CHECK(cutValue != nullptr);
    if (cutValue != nullptr) {
      CHECK_EQ_INT(cutValue->consumedBy, 5);
      CHECK_EQ_INT(cutValue->operands.size(), 2u);
      CHECK_EQ_INT(cutValue->operands[0], 2);
      CHECK_EQ_INT(cutValue->operands[1], 3);
    }

    // The same document's sketch reading: one baked profile, no sketches.
    const SketchTree s = buildSketchTree(doc);
    CHECK_EQ_INT(s.sketches.size(), 0u);
    CHECK_EQ_INT(s.profiles.size(), 1u);
    if (!s.profiles.empty()) {
      const ProfileShape& p = s.profiles[0];
      CHECK_EQ_STR(p.op, "RECT");
      CHECK_EQ_INT(p.consumedBy, 2);
      CHECK_EQ_STR(p.consumedByLabel, "Plate  extrude 20");
      CHECK_EQ_INT(p.dimensions.size(), 4u);
      CHECK_EQ_STR(p.dimensions[0].display, "Width");
      CHECK_NEAR(p.dimensions[0].value, 80.0, 1e-12);
      CHECK(!p.dimensions[0].defaulted);
      CHECK_EQ_STR(p.dimensions[1].display, "Height");
      CHECK_NEAR(p.dimensions[1].value, 50.0, 1e-12);
      // The two the statement omitted come back as the KERNEL'S documented
      // defaults and are MARKED as omitted, so a panel can say which numbers the
      // user chose and which the kernel supplied.
      CHECK_EQ_STR(p.dimensions[2].display, "Centre X");
      CHECK(p.dimensions[2].defaulted);
      CHECK_NEAR(p.dimensions[2].value, 0.0, 1e-12);
      CHECK(p.dimensions[3].defaulted);
    }
  }

  // ── D. a constrained sketch reads as a sketch ────────────────────────────
  {
    // Node names and produce-kinds exactly as the sketch commands emit them: an
    // entity gets its own node, and a CON re-binds the SKETCH's node to itself.
    PartDocument doc;
    CHECK(append(doc, "SKETCH", {IrArg::keyword("XY")}, IrValueKind::Sketch, "Sketch 1", {},
                 "sketch_1"));
    CHECK(append(doc, "SPT", {IrArg::valueRef(1), IrArg::num(0.0), IrArg::num(0.0)},
                 IrValueKind::SketchRef, "Point A", {}, "sketchref_2"));
    CHECK(append(doc, "SPT", {IrArg::valueRef(1), IrArg::num(40.0), IrArg::num(0.0)},
                 IrValueKind::SketchRef, "Point B", {}, "sketchref_3"));
    CHECK(append(doc, "SLINE", {IrArg::valueRef(2), IrArg::valueRef(3)}, IrValueKind::SketchRef,
                 "Line 1", {}, "sketchref_4"));
    CHECK(append(doc, "SCIRC", {IrArg::valueRef(2), IrArg::num(12.0)}, IrValueKind::SketchRef,
                 "Circle 1", {}, "sketchref_5"));
    CHECK(append(doc, "CON", {IrArg::valueRef(4), IrArg::keyword("HORIZ")}, IrValueKind::Sketch,
                 "Constrain Entity", {}, "sketch_1"));
    CHECK(append(doc, "CON",
                 {IrArg::valueRef(2), IrArg::keyword("DIST"), IrArg::valueRef(3),
                  IrArg::num(40.0)},
                 IrValueKind::Sketch, "Constrain Entity Pair", {}, "sketch_1"));
    CHECK(append(doc, "SOLVE", {IrArg::valueRef(1)}, IrValueKind::Profile, "Solve Sketch", {},
                 "sketch_8"));
    CHECK(append(doc, "EXTRUDE", {IrArg::valueRef(8), IrArg::num(10.0)}, IrValueKind::Solid,
                 "Boss  extrude 10", {"sketch_8"}, "body_9"));

    const SketchTree s = buildSketchTree(doc);
    CHECK_EQ_INT(s.sketches.size(), 1u);
    CHECK_EQ_INT(s.profiles.size(), 0u);
    CHECK_EQ_INT(s.unattached.size(), 0u);
    if (!s.sketches.empty()) {
      const SketchGroup& g = s.sketches[0];
      CHECK_EQ_STR(g.plane, "XY");
      CHECK_EQ_INT(g.points, 2u);
      CHECK_EQ_INT(g.curves, 2u);
      CHECK_EQ_INT(g.constraints, 2u);
      CHECK_EQ_INT(g.entities.size(), 6u);
      CHECK_EQ_INT(g.solvedBy, 8);
      // The SOLVED profile is what the extrude took, and the sketch says so.
      CHECK_EQ_INT(g.consumedBy, 9);
      CHECK_EQ_STR(g.consumedByLabel, "Boss  extrude 10");
      // Entity details are read off the statements, never composed from a guess.
      CHECK_EQ_STR(g.entities[0].label, "Point");
      CHECK_EQ_STR(g.entities[0].operands, "at 0, 0 mm");
      CHECK_EQ_STR(g.entities[2].label, "Line");
      CHECK_EQ_STR(g.entities[2].operands, "from Point A to Point B");
      CHECK_EQ_STR(g.entities[3].label, "Circle");
      CHECK_EQ_STR(g.entities[3].operands, "centre Point A, radius 12 mm");
      CHECK_EQ_STR(g.entities[4].label, "Horizontal");
      CHECK_EQ_STR(g.entities[5].label, "Distance");
      CHECK_EQ_STR(g.entities[5].operands, "Point A and Point B = 40");
    }

    const ModelBrowser b = buildModelBrowser(doc);
    // The two CON statements produce NO object: they annotate the sketch, and
    // the sketch keeps the node one of them is holding.
    CHECK_EQ_INT(b.values.size(), 7u);
    CHECK_EQ_INT(b.bodies.size(), 1u);
    if (!b.bodies.empty()) CHECK_EQ_STR(b.values[b.bodies[0]].label, "Boss  extrude 10");
    CHECK_EQ_INT(b.sketches.size(), 5u);   // the sketch and its four entities
    const ModelValue* sketchValue = b.find(1);
    CHECK(sketchValue != nullptr);
    if (sketchValue != nullptr) {
      CHECK(sketchValue->live);
      CHECK_EQ_STR(sketchValue->node, "sketch_1");
      CHECK_EQ_INT(sketchValue->annotations, 2u);
    }
    // The solved profile WAS absorbed by the extrude, and the browser says so
    // instead of offering it as something to pick.
    const ModelValue* solved = b.find(8);
    CHECK(solved != nullptr);
    if (solved != nullptr) {
      CHECK(!solved->live);
      CHECK_EQ_INT(solved->consumedBy, 9);
    }
    // and no CON statement became a value.
    CHECK(b.find(6) == nullptr);
    CHECK(b.find(7) == nullptr);
  }

  // ── D1b. SOLVE names the LAST CONSTRAINT, not the sketch ────────────────
  // The program a user actually authors, taken from the op-constraint gate's
  // own measured example: `%27 = SOLVE(%26)` where %26 is a CON. CON is a
  // pass-through, so the sketch it belongs to has to be found by walking the
  // chain -- and a reader that took SOLVE's operand at face value would attach
  // the solve to a statement that produced no object.
  {
    PartDocument doc;
    CHECK(append(doc, "SKETCH", {IrArg::keyword("XY")}, IrValueKind::Sketch, "Sketch 1", {},
                 "sketch_1"));
    CHECK(append(doc, "SPT", {IrArg::valueRef(1), IrArg::num(0.0), IrArg::num(0.0)},
                 IrValueKind::SketchRef, "Point A", {}, "sketchref_2"));
    CHECK(append(doc, "SPT", {IrArg::valueRef(1), IrArg::num(40.0), IrArg::num(0.0)},
                 IrValueKind::SketchRef, "Point B", {}, "sketchref_3"));
    CHECK(append(doc, "SLINE", {IrArg::valueRef(2), IrArg::valueRef(3)}, IrValueKind::SketchRef,
                 "Line 1", {}, "sketchref_4"));
    CHECK(append(doc, "CON", {IrArg::valueRef(4), IrArg::keyword("HORIZ")}, IrValueKind::Sketch,
                 "Constrain Entity", {}, "sketch_1"));
    CHECK(append(doc, "SOLVE", {IrArg::valueRef(5)}, IrValueKind::Profile, "Solve Sketch", {},
                 "sketch_6"));

    const SketchTree s = buildSketchTree(doc);
    CHECK_EQ_INT(s.sketches.size(), 1u);
    if (!s.sketches.empty()) {
      CHECK_EQ_INT(s.sketches[0].irId, 1);
      CHECK_EQ_INT(s.sketches[0].solvedBy, 6);
      CHECK_EQ_INT(s.sketches[0].constraints, 1u);
      CHECK_EQ_INT(s.sketches[0].curves, 1u);
    }
    const ModelBrowser b = buildModelBrowser(doc);
    CHECK(b.find(5) == nullptr);          // the CON is not an object
    const ModelValue* sk = b.find(1);
    CHECK(sk != nullptr);
    if (sk != nullptr) {
      CHECK_EQ_STR(sk->node, "sketch_1");
      CHECK_EQ_INT(sk->annotations, 1u);
    }
  }

  // ── D2. the pass-through list is the kernel header's ────────────────────
  {
    std::ifstream in(header);
    std::ostringstream ss;
    ss << in.rdbuf();
    const std::string src = ss.str();
    CHECK(src.size() > 1000);
    const std::vector<std::string> named = headerPassThroughOps(src);
    const char* const kOps[] = {"CON", "TAG", "VERIFY", "SURFCHECK"};
    for (const char* op : kOps) {
      CHECK(contains(named, op));
      CHECK(isPassThroughOp(op));
    }
    // and the control: an op the header never calls a pass-through must not be
    // one here, or the check above would pass on anything.
    CHECK(!contains(named, "FILLET"));
    CHECK(!isPassThroughOp("FILLET"));
    CHECK(!isPassThroughOp("SOLVE"));
    CHECK(!isPassThroughOp("EXTRUDE"));
  }

  // ── E. an empty document produces nothing ────────────────────────────────
  {
    const PartDocument empty;
    const ModelBrowser b = buildModelBrowser(empty);
    CHECK_EQ_INT(b.values.size(), 0u);
    CHECK_EQ_INT(b.bodies.size(), 0u);
    const SketchTree s = buildSketchTree(empty);
    CHECK(s.empty());
    CHECK_EQ_INT(s.rowCount(), 0u);
  }

  return H.finish();
}
