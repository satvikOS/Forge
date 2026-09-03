#include "forge/ui/ModelTree.hpp"

#include <algorithm>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"

namespace forge::ui {

namespace {

// ── the kernel header's documented forms, transcribed ───────────────────────
// forge-kernel/include/forge/ft/FeatureTree.hpp:
//
//   Rect,        // RECT(w, h [, cx=0, cy=0])
//   RRect,       // RRECT(w, h, r [, cx=0, cy=0])
//   Circle,      // CIRCLE(r [, cx=0, cy=0])
//   Slot,        // SLOT(len, wid [, cx=0, cy=0, angleDeg=0])
//   RegPoly,     // REGPOLY(r, n [, cx=0, cy=0, rotDeg=0])
//
// KEPT AS THE HEADER SPELLS THEM, `=0` default and all, because that is what
// ui/test/model_tree_test.cpp diffs against after parsing the header itself. A
// table that pre-digested the tokens could not be compared to its source.
struct ProfileForm {
  const char* op;
  const char* const* tokens;
  std::size_t count;
};

const char* const kRectArgs[] = {"w", "h", "cx=0", "cy=0"};
const char* const kRRectArgs[] = {"w", "h", "r", "cx=0", "cy=0"};
const char* const kCircleArgs[] = {"r", "cx=0", "cy=0"};
const char* const kSlotArgs[] = {"len", "wid", "cx=0", "cy=0", "angleDeg=0"};
const char* const kRegPolyArgs[] = {"r", "n", "cx=0", "cy=0", "rotDeg=0"};

const ProfileForm kProfileForms[] = {
    {"RECT", kRectArgs, 4},     {"RRECT", kRRectArgs, 5},
    {"CIRCLE", kCircleArgs, 3}, {"SLOT", kSlotArgs, 5},
    {"REGPOLY", kRegPolyArgs, 5},
};

// A ring op: one argument, and what a user wants to know about it is how many
// points it carries.
bool isRingProfile(const std::string& op) { return op == "POLY" || op == "ARC"; }

// The sketch family, by role. Every name here is an op in the kernel's own
// table; nothing invents one.
bool isSketchPoint(const std::string& op) { return op == "SPT"; }
bool isSketchCurve(const std::string& op) {
  return op == "SLINE" || op == "SCIRC" || op == "SARC";
}

// Split "cx=0" into its name and its documented default.
void splitToken(const std::string& token, std::string& name, double& value, bool& hasDefault) {
  const std::size_t eq = token.find('=');
  if (eq == std::string::npos) {
    name = token;
    value = 0.0;
    hasDefault = false;
    return;
  }
  name = token.substr(0, eq);
  hasDefault = true;
  value = 0.0;
  const std::string tail = token.substr(eq + 1);
  // The documented defaults are plain decimals. Anything else is left at 0 and
  // reported as UNDOCUMENTED rather than guessed: hasDefault stays true only
  // when the text really is a number.
  bool numeric = !tail.empty();
  for (std::size_t i = 0; i < tail.size(); ++i) {
    const char c = tail[i];
    const bool digit = c >= '0' && c <= '9';
    const bool sign = (i == 0) && (c == '-' || c == '+');
    if (!digit && !sign && c != '.') { numeric = false; break; }
  }
  if (!numeric) { hasDefault = false; return; }
  value = std::stod(tail);
}

// The row label a %ref should carry. The DOCUMENT's own label for that
// statement, so a sketch entity refers to its point by the name the rest of the
// application shows -- never by a number only this file understands.
std::string refLabel(const std::vector<FeatureRecord>& records, int irId) {
  for (const FeatureRecord& r : records) {
    if (r.irId != irId) continue;
    if (!r.label.empty()) return r.label;
    return r.line.op;
  }
  return std::string();
}

std::string joinNumber(double v) { return formatIrNumber(v); }

}  // namespace

const char* toString(SketchItemRole role) noexcept {
  switch (role) {
    case SketchItemRole::Point:      return "point";
    case SketchItemRole::Curve:      return "curve";
    case SketchItemRole::Constraint: return "constraint";
    case SketchItemRole::Solve:      return "solve";
  }
  return "point";
}

bool profileArgNames(const std::string& op, std::vector<std::string>& out) {
  for (const ProfileForm& f : kProfileForms) {
    if (op != f.op) continue;
    out.clear();
    for (std::size_t i = 0; i < f.count; ++i) out.push_back(f.tokens[i]);
    return true;
  }
  return false;
}

std::string argDisplayName(const std::string& token) {
  if (token == "w") return "Width";
  if (token == "h") return "Height";
  if (token == "r") return "Radius";
  if (token == "len") return "Length";
  if (token == "wid") return "Width";
  if (token == "n") return "Sides";
  if (token == "cx") return "Centre X";
  if (token == "cy") return "Centre Y";
  if (token == "angleDeg") return "Angle";
  if (token == "rotDeg") return "Rotation";
  return token;
}

DimensionUnit argUnit(const std::string& token) {
  if (token == "n") return DimensionUnit::Count;
  if (token == "angleDeg" || token == "rotDeg") return DimensionUnit::Angle;
  return DimensionUnit::Length;
}

std::string constraintDisplayName(const std::string& keyword) {
  if (keyword == "COINC")  return "Coincident";
  if (keyword == "PARA")   return "Parallel";
  if (keyword == "PERP")   return "Perpendicular";
  if (keyword == "TANG")   return "Tangent";
  if (keyword == "EQUAL")  return "Equal";
  if (keyword == "CONC")   return "Concentric";
  if (keyword == "COLL")   return "Collinear";
  if (keyword == "SYMM")   return "Symmetric";
  if (keyword == "MIDPT")  return "Midpoint";
  if (keyword == "HORIZ")  return "Horizontal";
  if (keyword == "VERT")   return "Vertical";
  if (keyword == "PTON")   return "Point on curve";
  if (keyword == "FIX")    return "Fixed";
  if (keyword == "DIST")   return "Distance";
  if (keyword == "DISTX")  return "Distance in X";
  if (keyword == "DISTY")  return "Distance in Y";
  if (keyword == "ANGLE")  return "Angle";
  if (keyword == "RADIUS") return "Radius";
  if (keyword == "DIAM")   return "Diameter";
  return std::string();
}

const ModelValue* ModelBrowser::find(int irId) const noexcept {
  for (const ModelValue& v : values) {
    if (v.irId == irId) return &v;
  }
  return nullptr;
}

std::size_t SketchTree::rowCount() const noexcept {
  std::size_t n = sketches.size() + profiles.size() + unattached.size();
  for (const SketchGroup& g : sketches) n += g.entities.size();
  return n;
}

// ── the model browser ───────────────────────────────────────────────────────
bool isPassThroughOp(const std::string& op) {
  // forge-kernel/include/forge/ft/FeatureTree.hpp documents each of these as
  // returning its operand unchanged:
  //   Con        "constrain; PASS-THROUGH like TAG"
  //   Tag        "Pass-through like VERIFY: it returns %body unchanged"
  //   Verify     the assertion op TAG is documented against
  //   SurfCheck  "Pass-through like VERIFY/TAG: it returns %surface unchanged"
  // ui/test/model_tree_test.cpp re-reads those sentences out of the header, so a
  // fifth pass-through op added there fails this list rather than quietly
  // producing a phantom body in the browser.
  return op == "CON" || op == "TAG" || op == "VERIFY" || op == "SURFCHECK";
}

namespace {

// ── the id -> record index, built once ──────────────────────────────────────
// Every walk below asks "which record is %N". Answering that by scanning the
// vector makes this file quadratic in the statement count, and the feature tree
// beside it is virtualized precisely because real documents are long. One
// vector, indexed by creation id, and every lookup is a subscript.
class RecordIndex {
 public:
  explicit RecordIndex(const std::vector<FeatureRecord>& records) : records_(records) {
    int top = 0;
    for (const FeatureRecord& r : records) {
      if (r.irId > top) top = r.irId;
    }
    slot_.assign(static_cast<std::size_t>(top) + 1, static_cast<std::size_t>(-1));
    for (std::size_t i = 0; i < records.size(); ++i) {
      const int id = records[i].irId;
      if (id > 0) slot_[static_cast<std::size_t>(id)] = i;
    }
  }

  const FeatureRecord* find(int irId) const {
    if (irId <= 0 || static_cast<std::size_t>(irId) >= slot_.size()) return nullptr;
    const std::size_t at = slot_[static_cast<std::size_t>(irId)];
    return at == static_cast<std::size_t>(-1) ? nullptr : &records_[at];
  }

  std::size_t size() const noexcept { return records_.size(); }

 private:
  const std::vector<FeatureRecord>& records_;
  std::vector<std::size_t> slot_;
};

int firstRefOf(const FeatureRecord& rec) {
  for (const IrArg& a : rec.line.args) {
    if (a.kind == IrArgKind::Ref) return a.ref;
  }
  return 0;
}

// The SKETCH a sketch-family statement belongs to, walking the %ref chain: an
// entity names its sketch (SPT) or another entity (SLINE names two points), so
// the owner is found by following the first operand until a SKETCH is reached.
// Bounded by the record count, because creation ids strictly decrease along it.
int ownerSketch(const RecordIndex& index, int irId, int depth) {
  if (irId <= 0 || depth > static_cast<int>(index.size()) + 1) return 0;
  const FeatureRecord* r = index.find(irId);
  if (r == nullptr) return 0;
  if (r->line.op == "SKETCH") return r->irId;
  return ownerSketch(index, firstRefOf(*r), depth + 1);
}

// The value a statement's result IS. A pass-through returns what it was handed,
// so it is not a new object: TAG / VERIFY / SURFCHECK return their first
// operand, and CON returns THE SKETCH the entity it names belongs to (which is
// what the kernel's own note says, and why it is not simply the first operand).
int identityOf(const RecordIndex& index, int irId, int depth) {
  if (irId <= 0 || depth > static_cast<int>(index.size()) + 1) return irId;
  const FeatureRecord* r = index.find(irId);
  if (r == nullptr) return irId;
  if (!isPassThroughOp(r->line.op)) return irId;
  if (r->line.op == "CON") {
    const int owner = ownerSketch(index, firstRefOf(*r), 0);
    return owner != 0 ? owner : irId;
  }
  const int base = firstRefOf(*r);
  return base != 0 ? identityOf(index, base, depth + 1) : irId;
}

}  // namespace

ModelBrowser buildModelBrowser(const PartDocument& document) {
  const std::vector<FeatureRecord>& records = document.records();
  const RecordIndex index(records);
  ModelBrowser out;
  out.values.reserve(records.size());
  // irId -> position in out.values, for the same reason RecordIndex exists.
  int topId = 0;
  for (const FeatureRecord& r : records) {
    if (r.irId > topId) topId = r.irId;
  }
  std::vector<std::size_t> valueSlot(static_cast<std::size_t>(topId) + 1,
                                     static_cast<std::size_t>(-1));

  for (const FeatureRecord& rec : records) {
    // A pass-through statement produces no object. It is counted on the value it
    // annotates, below, rather than offered as a thing that exists.
    if (isPassThroughOp(rec.line.op)) continue;
    ModelValue v;
    v.irId = rec.irId;
    v.kind = rec.produces;
    v.label = rec.label.empty() ? rec.line.op : rec.label;
    v.op = rec.line.op;
    v.statement = rec.line.text();
    v.node = document.nodeFor(rec.irId);
    v.live = !v.node.empty();
    for (const IrArg& a : rec.line.args) {
      if (a.kind == IrArgKind::Ref) v.operands.push_back(identityOf(index, a.ref, 0));
    }
    valueSlot[static_cast<std::size_t>(rec.irId)] = out.values.size();
    out.values.push_back(std::move(v));
  }

  auto valueAt = [&out, &valueSlot](int irId) -> ModelValue* {
    if (irId <= 0 || static_cast<std::size_t>(irId) >= valueSlot.size()) return nullptr;
    const std::size_t at = valueSlot[static_cast<std::size_t>(irId)];
    return at == static_cast<std::size_t>(-1) ? nullptr : &out.values[at];
  };

  // USED BY, and the annotation count, in one walk of the program. A
  // pass-through statement is not a consumer of anything -- it hands its operand
  // back -- so it contributes an annotation and no consumption at all.
  for (const FeatureRecord& rec : records) {
    if (isPassThroughOp(rec.line.op)) {
      const int target = identityOf(index, rec.irId, 0);
      // ★ THE BINDING CAN SIT ON THE PASS-THROUGH. `part.sketch_constrain`
      // re-binds the SKETCH's own node to the CON statement it just appended, so
      // after one constraint `nodeFor(sketchId)` is "" and the node is held by a
      // statement that produced no object. Reading only the object's own id
      // there would have shown a real, selectable, constrained sketch as
      // unnamed -- the browser hiding the very thing the user is working on.
      const std::string passNode = document.nodeFor(rec.irId);
      if (ModelValue* v = valueAt(target)) {
        ++v->annotations;
        if (v->node.empty() && !passNode.empty()) {
          v->node = passNode;
          v->live = true;
        }
      }
      continue;
    }
    for (const IrArg& a : rec.line.args) {
      if (a.kind != IrArgKind::Ref) continue;
      const int target = identityOf(index, a.ref, 0);
      ModelValue* v = valueAt(target);
      if (v == nullptr || v->consumedBy != 0 || v->irId == rec.irId) continue;
      v->consumedBy = rec.irId;
      v->consumedByLabel = rec.label.empty() ? rec.line.op : rec.label;
    }
  }

  for (std::size_t i = 0; i < out.values.size(); ++i) {
    const ModelValue& v = out.values[i];
    if (!v.live) {
      if (v.consumedBy != 0) out.consumed.push_back(i);
      else out.unnamed.push_back(i);
      continue;
    }
    switch (v.kind) {
      case IrValueKind::Solid:     out.bodies.push_back(i);   break;
      case IrValueKind::Surface:   out.sheets.push_back(i);   break;
      case IrValueKind::Wire:      out.wires.push_back(i);    break;
      case IrValueKind::Profile:   out.profiles.push_back(i); break;
      case IrValueKind::Sketch:
      case IrValueKind::SketchRef: out.sketches.push_back(i); break;
      case IrValueKind::None:      break;
    }
  }
  return out;
}

// ── the sketch tree ─────────────────────────────────────────────────────────
SketchTree buildSketchTree(const PartDocument& document) {
  const std::vector<FeatureRecord>& records = document.records();
  const RecordIndex index(records);
  SketchTree out;

  // The used-by map, so every row can say what became of it. Built from the same
  // walk the model browser uses rather than a second reading of the rule.
  const ModelBrowser browser = buildModelBrowser(document);

  for (const FeatureRecord& rec : records) {
    if (rec.line.op != "SKETCH") continue;
    SketchGroup g;
    g.irId = rec.irId;
    g.label = rec.label.empty() ? rec.line.op : rec.label;
    for (const IrArg& a : rec.line.args) {
      if (a.kind == IrArgKind::Keyword) g.plane = a.word;
    }
    out.sketches.push_back(std::move(g));
  }

  auto groupFor = [&out](int sketchId) -> SketchGroup* {
    for (SketchGroup& g : out.sketches) {
      if (g.irId == sketchId) return &g;
    }
    return nullptr;
  };

  for (const FeatureRecord& rec : records) {
    const std::string& op = rec.line.op;
    const bool point = isSketchPoint(op);
    const bool curve = isSketchCurve(op);
    const bool con = op == "CON";
    const bool solve = op == "SOLVE";
    if (!point && !curve && !con && !solve) continue;

    const int owner = con ? ownerSketch(index, firstRefOf(rec), 0)
                          : ownerSketch(index, rec.irId, 0);
    SketchGroup* g = owner != 0 ? groupFor(owner) : nullptr;

    if (solve) {
      if (g != nullptr) {
        g->solvedBy = rec.irId;
        // What the SOLVED profile feeds. That is a property of the SOLVE
        // statement's value, not of the sketch's, because SOLVE is what turns a
        // sketch into something an extrude can consume.
        if (const ModelValue* v = browser.find(rec.irId)) {
          g->consumedBy = v->consumedBy;
          g->consumedByLabel = v->consumedByLabel;
        }
      }
      continue;
    }

    SketchEntity e;
    e.irId = rec.irId;
    e.op = op;
    if (point) {
      e.role = SketchItemRole::Point;
      e.label = "Point";
      if (rec.line.args.size() >= 3 && rec.line.args[1].kind == IrArgKind::Number &&
          rec.line.args[2].kind == IrArgKind::Number) {
        e.detail = "at " + joinNumber(rec.line.args[1].number) + ", " +
                   joinNumber(rec.line.args[2].number) + " mm";
      }
    } else if (curve) {
      e.role = SketchItemRole::Curve;
      if (op == "SLINE") {
        e.label = "Line";
        if (rec.line.args.size() >= 2) {
          e.detail = "from " + refLabel(records, rec.line.args[0].ref) + " to " +
                     refLabel(records, rec.line.args[1].ref);
        }
      } else if (op == "SCIRC") {
        e.label = "Circle";
        if (rec.line.args.size() >= 2 && rec.line.args[1].kind == IrArgKind::Number) {
          e.detail = "centre " + refLabel(records, rec.line.args[0].ref) + ", radius " +
                     joinNumber(rec.line.args[1].number) + " mm";
        }
      } else {
        e.label = "Arc";
        if (rec.line.args.size() >= 3) {
          e.detail = "centre " + refLabel(records, rec.line.args[0].ref) + ", from " +
                     refLabel(records, rec.line.args[1].ref) + " to " +
                     refLabel(records, rec.line.args[2].ref);
        }
      }
    } else {
      e.role = SketchItemRole::Constraint;
      std::string kind;
      for (const IrArg& a : rec.line.args) {
        if (a.kind == IrArgKind::Keyword) { kind = a.word; break; }
      }
      const std::string named = constraintDisplayName(kind);
      // An unknown keyword is NAMED, never silently dropped and never renamed:
      // the compiler skips it and says so, and a panel that showed a friendly
      // word for a constraint the kernel ignored would be worse than one that
      // shows the word the document actually carries.
      e.label = named.empty() ? kind : named;
      std::string detail;
      bool firstRef = true;
      for (const IrArg& a : rec.line.args) {
        if (a.kind == IrArgKind::Ref) {
          const std::string who = refLabel(records, a.ref);
          if (who.empty()) continue;
          detail += (firstRef ? "" : " and ") + who;
          firstRef = false;
        }
      }
      for (const IrArg& a : rec.line.args) {
        if (a.kind == IrArgKind::Number) {
          detail += " = " + joinNumber(a.number);
          break;
        }
      }
      e.detail = detail;
    }

    if (g == nullptr) {
      out.unattached.push_back(std::move(e));
      continue;
    }
    if (e.role == SketchItemRole::Point) ++g->points;
    else if (e.role == SketchItemRole::Curve) ++g->curves;
    else ++g->constraints;
    g->entities.push_back(std::move(e));
  }

  // ── the baked profiles ────────────────────────────────────────────────────
  for (const FeatureRecord& rec : records) {
    const std::string& op = rec.line.op;
    std::vector<std::string> tokens;
    const bool named = profileArgNames(op, tokens);
    const bool ring = isRingProfile(op);
    if (!named && !ring) continue;

    ProfileShape p;
    p.irId = rec.irId;
    p.op = op;
    p.label = rec.label.empty() ? op : rec.label;
    if (const ModelValue* v = browser.find(rec.irId)) {
      p.consumedBy = v->consumedBy;
      p.consumedByLabel = v->consumedByLabel;
    }

    if (ring) {
      for (const IrArg& a : rec.line.args) {
        if (a.kind == IrArgKind::Points) p.points = a.pts.size();
      }
      out.profiles.push_back(std::move(p));
      continue;
    }

    for (std::size_t i = 0; i < tokens.size(); ++i) {
      std::string name;
      double fallback = 0.0;
      bool hasDefault = false;
      splitToken(tokens[i], name, fallback, hasDefault);

      ProfileDimension d;
      d.name = name;
      d.display = argDisplayName(name);
      d.unit = argUnit(name);
      if (i < rec.line.args.size() && rec.line.args[i].kind == IrArgKind::Number) {
        d.value = rec.line.args[i].number;
        d.defaulted = false;
      } else if (i < rec.line.args.size()) {
        // An argument in this position that is not a number is not a dimension.
        // Skipped rather than printed as 0, which would be a fabricated value.
        continue;
      } else if (hasDefault) {
        d.value = fallback;
        d.defaulted = true;
      } else {
        continue;
      }
      p.dimensions.push_back(std::move(d));
    }
    out.profiles.push_back(std::move(p));
  }

  std::sort(out.profiles.begin(), out.profiles.end(),
            [](const ProfileShape& a, const ProfileShape& b) { return a.irId < b.irId; });
  return out;
}

}  // namespace forge::ui
