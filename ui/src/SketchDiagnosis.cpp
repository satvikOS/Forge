#include "forge/ui/SketchDiagnosis.hpp"

#include <algorithm>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/ModelTree.hpp"
#include "forge/ui/PartCommands.hpp"

namespace forge::ui {

namespace {

constexpr std::size_t kNoIndex = static_cast<std::size_t>(-1);

// irId -> record, without scanning the vector per lookup. Same reason
// ModelTree.cpp and WorkspaceTrees.cpp each carry one.
class RecordIndex {
 public:
  explicit RecordIndex(const std::vector<FeatureRecord>& records) : records_(records) {
    int top = 0;
    for (const FeatureRecord& r : records) {
      if (r.irId > top) top = r.irId;
    }
    slot_.assign(static_cast<std::size_t>(top) + 1, kNoIndex);
    for (std::size_t i = 0; i < records.size(); ++i) {
      const int id = records[i].irId;
      if (id > 0) slot_[static_cast<std::size_t>(id)] = i;
    }
  }

  const FeatureRecord* find(int irId) const {
    if (irId <= 0 || static_cast<std::size_t>(irId) >= slot_.size()) return nullptr;
    const std::size_t at = slot_[static_cast<std::size_t>(irId)];
    return at == kNoIndex ? nullptr : &records_[at];
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

// The SKETCH a sketch-family record belongs to, walking the %ref chain. The same
// rule ModelTree.cpp states: an entity names its sketch or another entity, and
// creation ids strictly decrease along the chain, so the walk terminates.
int ownerSketch(const RecordIndex& index, int irId, int depth) {
  if (irId <= 0 || depth > static_cast<int>(index.size()) + 1) return 0;
  const FeatureRecord* r = index.find(irId);
  if (r == nullptr) return 0;
  if (r->line.op == "SKETCH") return r->irId;
  return ownerSketch(index, firstRefOf(*r), depth + 1);
}

std::string labelOf(const FeatureRecord& rec) {
  return rec.label.empty() ? rec.line.op : rec.label;
}

std::string mm(double v) { return formatIrNumber(v) + " mm"; }

// The constraint keyword a CON record carries: its FIRST bare keyword. The
// kernel's own note says the kind is always argument 1.
std::string keywordOf(const IrLine& line) {
  for (const IrArg& a : line.args) {
    if (a.kind == IrArgKind::Keyword) return a.word;
  }
  return {};
}

}  // namespace

// ── the transcribed tables ──────────────────────────────────────────────────

const char* sketchGeometryWord(SketchGeometryKind kind) noexcept {
  switch (kind) {
    case SketchGeometryKind::Point:  return "Point";
    case SketchGeometryKind::Line:   return "Line";
    case SketchGeometryKind::Circle: return "Circle";
    case SketchGeometryKind::Arc:    return "Arc";
  }
  return "Point";
}

std::size_t sketchFreedoms(SketchGeometryKind kind) noexcept {
  // Sketch::collectUnknowns(), forge-kernel/src/Sketcher.cpp: x and y per point,
  // rad per circle, rad + startAngle + endAngle per arc, and nothing at all for a
  // line -- a line is two points that already counted themselves.
  switch (kind) {
    case SketchGeometryKind::Point:  return 2;
    case SketchGeometryKind::Line:   return 0;
    case SketchGeometryKind::Circle: return 1;
    case SketchGeometryKind::Arc:    return 3;
  }
  return 0;
}

bool isSketchGeometryOp(const std::string& op, SketchGeometryKind& kind) {
  if (op == "SPT")   { kind = SketchGeometryKind::Point;  return true; }
  if (op == "SLINE") { kind = SketchGeometryKind::Line;   return true; }
  if (op == "SCIRC") { kind = SketchGeometryKind::Circle; return true; }
  if (op == "SARC")  { kind = SketchGeometryKind::Arc;    return true; }
  return false;
}

namespace {

struct ConstraintSpec {
  const char* keyword;
  std::size_t holds;     // solver equations the arm adds
  std::size_t operands;  // %refs the kind takes in its ordinary form
  bool dimensional;      // it carries a number
  bool lineForm;         // it also has a one-operand form, for a LINE
};

// addConstraint(), forge-kernel/src/Sketcher.cpp, arm by arm. See the header for
// why COINC, CONC, SYMM, MIDPT, COLL and FIX are 2 and everything else is 1.
constexpr ConstraintSpec kConstraints[] = {
    {"COINC",  2, 2, false, false},
    {"PARA",   1, 2, false, false},
    {"PERP",   1, 2, false, false},
    {"TANG",   1, 2, false, false},
    {"EQUAL",  1, 2, false, false},
    {"CONC",   2, 2, false, false},
    {"COLL",   2, 2, false, false},
    {"SYMM",   2, 3, false, false},
    {"MIDPT",  2, 3, false, false},
    // HORIZ and VERT: two operands when they are two points, ONE when it is a
    // line. See constraintHasLineForm.
    {"HORIZ",  1, 2, false, true},
    {"VERT",   1, 2, false, true},
    {"PTON",   1, 2, false, false},
    {"FIX",    2, 1, false, false},
    {"DIST",   1, 2, true,  false},
    {"DISTX",  1, 2, true,  false},
    {"DISTY",  1, 2, true,  false},
    {"ANGLE",  1, 2, true,  false},
    {"RADIUS", 1, 1, true,  false},
    {"DIAM",   1, 1, true,  false},
};

const ConstraintSpec* findConstraint(const std::string& keyword) {
  for (const ConstraintSpec& c : kConstraints) {
    if (keyword == c.keyword) return &c;
  }
  return nullptr;
}

}  // namespace

std::size_t constraintFreedomsHeld(const std::string& keyword, bool& known) {
  const ConstraintSpec* c = findConstraint(keyword);
  known = c != nullptr;
  return c != nullptr ? c->holds : 0;
}

std::size_t constraintOperandCount(const std::string& keyword, bool& known) {
  const ConstraintSpec* c = findConstraint(keyword);
  known = c != nullptr;
  return c != nullptr ? c->operands : 0;
}

bool constraintHasLineForm(const std::string& keyword) {
  const ConstraintSpec* c = findConstraint(keyword);
  return c != nullptr && c->lineForm;
}

bool constraintIsDimensional(const std::string& keyword) {
  const ConstraintSpec* c = findConstraint(keyword);
  return c != nullptr && c->dimensional;
}

const char* toString(ConstraintFault fault) noexcept {
  switch (fault) {
    case ConstraintFault::None:              return "holding";
    case ConstraintFault::UnknownKind:       return "not a constraint this part can use";
    case ConstraintFault::OperandUnresolved: return "points at nothing in this sketch";
    case ConstraintFault::OperandCount:      return "not given enough to hold";
    case ConstraintFault::Repeated:          return "already said";
    case ConstraintFault::Contradicts:       return "disagrees with an earlier one";
  }
  return "holding";
}

const char* toString(SketchLinkKind kind) noexcept {
  switch (kind) {
    case SketchLinkKind::BuiltOn:     return "built on";
    case SketchLinkKind::Constrained: return "held to";
  }
  return "built on";
}

const char* toString(SketchDefinition definition) noexcept {
  switch (definition) {
    case SketchDefinition::Empty: return "nothing drawn yet";
    case SketchDefinition::Under: return "still free to move";
    case SketchDefinition::Fully: return "fully held";
    case SketchDefinition::Over:  return "held more than once";
  }
  return "still free to move";
}

std::size_t SketchDiagnosisSet::rowCount() const noexcept {
  std::size_t n = sketches.size();
  for (const SketchDiagnosis& s : sketches) n += s.rowCount();
  return n;
}

std::size_t SketchDiagnosisSet::constraintCount() const noexcept {
  std::size_t n = 0;
  for (const SketchDiagnosis& s : sketches) n += s.constraints.size();
  return n;
}

std::size_t SketchDiagnosisSet::faultCount() const noexcept {
  std::size_t n = 0;
  for (const SketchDiagnosis& s : sketches) n += s.faults;
  return n;
}

std::size_t SketchDiagnosisSet::unresolved() const noexcept {
  std::size_t n = 0;
  for (const SketchDiagnosis& s : sketches) {
    if (s.definition != SketchDefinition::Fully) ++n;
  }
  return n;
}

const SketchDiagnosis* SketchDiagnosisSet::find(int irId) const noexcept {
  for (const SketchDiagnosis& s : sketches) {
    if (s.irId == irId) return &s;
  }
  return nullptr;
}

// ── the reading ─────────────────────────────────────────────────────────────

SketchDiagnosisSet buildSketchDiagnosis(const PartDocument& document) {
  const std::vector<FeatureRecord>& records = document.records();
  const RecordIndex index(records);
  SketchDiagnosisSet out;

  for (const FeatureRecord& rec : records) {
    if (rec.line.op != "SKETCH") continue;
    SketchDiagnosis d;
    d.irId = rec.irId;
    d.label = labelOf(rec);
    for (const IrArg& a : rec.line.args) {
      if (a.kind == IrArgKind::Keyword) d.plane = a.word;
    }
    out.sketches.push_back(std::move(d));
  }

  auto sketchFor = [&out](int sketchId) -> SketchDiagnosis* {
    for (SketchDiagnosis& d : out.sketches) {
      if (d.irId == sketchId) return &d;
    }
    return nullptr;
  };

  // ── 1. the geometry, in document order ────────────────────────────────────
  for (const FeatureRecord& rec : records) {
    SketchGeometryKind kind = SketchGeometryKind::Point;
    if (!isSketchGeometryOp(rec.line.op, kind)) continue;
    const int owner = ownerSketch(index, rec.irId, 0);
    SketchDiagnosis* d = owner != 0 ? sketchFor(owner) : nullptr;
    if (d == nullptr) { ++out.unattached; continue; }

    SketchGeometryRow g;
    g.irId = rec.irId;
    g.kind = kind;
    g.op = rec.line.op;
    g.label = labelOf(rec);
    g.freedoms = sketchFreedoms(kind);
    // What it is built on: every %ref except the sketch itself, which SPT alone
    // names. Read from the arguments rather than assumed from the op, so a
    // statement with an argument this file did not expect still reads correctly.
    for (const IrArg& a : rec.line.args) {
      if (a.kind != IrArgKind::Ref) continue;
      if (a.ref == owner) continue;
      g.builtOn.push_back(a.ref);
    }
    // The numbers the statement itself carries, in a user's words.
    if (kind == SketchGeometryKind::Point && rec.line.args.size() >= 3 &&
        rec.line.args[1].kind == IrArgKind::Number &&
        rec.line.args[2].kind == IrArgKind::Number) {
      g.evidence = "at " + formatIrNumber(rec.line.args[1].number) + ", " +
                   mm(rec.line.args[2].number);
    } else if (kind == SketchGeometryKind::Circle) {
      for (const IrArg& a : rec.line.args) {
        if (a.kind != IrArgKind::Number) continue;
        g.evidence = "radius " + mm(a.number);
        break;
      }
    }
    if (kind == SketchGeometryKind::Point) ++d->points;
    else ++d->curves;
    d->geometry.push_back(std::move(g));
  }

  // ── 2. the constraints ────────────────────────────────────────────────────
  for (const FeatureRecord& rec : records) {
    if (rec.line.op != "CON") continue;
    const int owner = ownerSketch(index, firstRefOf(rec), 0);
    SketchDiagnosis* d = owner != 0 ? sketchFor(owner) : nullptr;
    if (d == nullptr) { ++out.unattached; continue; }

    SketchConstraintRow c;
    c.irId = rec.irId;
    c.label = labelOf(rec);
    c.keyword = keywordOf(rec.line);
    const std::string named = constraintDisplayName(c.keyword);
    // An unknown keyword is NAMED, never renamed and never silently dropped:
    // the kernel skips it and says so, and a panel that showed a friendly word
    // for a constraint nothing applied would be worse than one showing the
    // word the document carries.
    c.name = named.empty() ? c.keyword : named;
    c.dimensional = constraintIsDimensional(c.keyword);
    for (const IrArg& a : rec.line.args) {
      if (a.kind == IrArgKind::Ref) c.operands.push_back(a.ref);
      else if (a.kind == IrArgKind::Number && !c.hasValue) {
        c.hasValue = true;
        c.value = a.number;
      }
    }

    bool known = false;
    const std::size_t holds = constraintFreedomsHeld(c.keyword, known);
    bool arityKnown = false;
    const std::size_t wants = constraintOperandCount(c.keyword, arityKnown);

    // Every operand must name geometry of THIS sketch. The kernel skips one that
    // does not and names it; so does this. Resolved FIRST, because whether the
    // shorter form of HORIZ / VERT applies is a question about what the operand
    // IS and not about how many there are.
    std::vector<int> resolved;
    bool anyUnresolved = false;
    bool firstIsLine = false;
    for (std::size_t i = 0; i < c.operands.size(); ++i) {
      const SketchGeometryRow* row = nullptr;
      for (const SketchGeometryRow& g : d->geometry) {
        if (g.irId == c.operands[i]) { row = &g; break; }
      }
      if (row == nullptr) {
        anyUnresolved = true;
        c.operandLabels.push_back(std::string());
        continue;
      }
      if (i == 0 && row->kind == SketchGeometryKind::Line) firstIsLine = true;
      resolved.push_back(c.operands[i]);
      c.operandLabels.push_back(row->label);
    }

    // How many operands THIS statement needed. One for the line form of HORIZ
    // and VERT, the kind's ordinary count otherwise.
    const std::size_t needed =
        constraintHasLineForm(c.keyword) && firstIsLine ? std::size_t{1} : wants;

    // ── the faults, in the order that makes the first one the useful one ────
    if (!known) {
      c.fault = ConstraintFault::UnknownKind;
    } else if (c.operands.size() < needed) {
      c.fault = ConstraintFault::OperandCount;
    } else if (anyUnresolved) {
      c.fault = ConstraintFault::OperandUnresolved;
    }
    if (c.fault == ConstraintFault::None) {
      // The same kind over the same geometry, in the same order. Whether that is
      // a repeat or a contradiction is decided by the NUMBER: a second distance
      // of 40 mm between the same two points says nothing new, and a second one
      // of 55 mm says something else. Both hold nothing, and telling a user
      // which is which is the difference between "delete one" and "decide
      // which".
      for (const SketchConstraintRow& earlier : d->constraints) {
        if (earlier.fault != ConstraintFault::None) continue;
        if (earlier.keyword != c.keyword) continue;
        if (earlier.operands != c.operands) continue;
        const bool sameNumber = earlier.hasValue == c.hasValue &&
                                (!c.hasValue || earlier.value == c.value);
        c.fault = sameNumber ? ConstraintFault::Repeated : ConstraintFault::Contradicts;
        c.repeatOf = earlier.irId;
        break;
      }
    }
    c.holds = c.fault == ConstraintFault::None ? holds : 0;

    // What it does, with its own numbers in it.
    std::string who;
    for (const std::string& label : c.operandLabels) {
      if (label.empty()) continue;
      if (!who.empty()) who += " and ";
      who += label;
    }
    c.evidence = who;
    if (c.hasValue) {
      const std::string unit = c.keyword == "ANGLE" ? " degrees" : " mm";
      if (!c.evidence.empty()) c.evidence += " at ";
      c.evidence += formatIrNumber(c.value) + unit;
    }

    for (int ref : resolved) {
      for (std::size_t i = 0; i < d->geometry.size(); ++i) {
        if (d->geometry[i].irId != ref) continue;
        d->geometry[i].constraints.push_back(d->constraints.size());
        if (c.keyword == "FIX" && c.fault == ConstraintFault::None) {
          d->geometry[i].pinned = true;
        }
      }
    }
    d->constraints.push_back(std::move(c));
  }

  // ── 3. the SOLVE that closes each sketch ──────────────────────────────────
  for (const FeatureRecord& rec : records) {
    if (rec.line.op != "SOLVE") continue;
    const int owner = ownerSketch(index, firstRefOf(rec), 0);
    if (SketchDiagnosis* d = owner != 0 ? sketchFor(owner) : nullptr) d->solvedBy = rec.irId;
  }

  // ── 4. the arithmetic, the links and the clusters ─────────────────────────
  for (SketchDiagnosis& d : out.sketches) {
    // irId -> position in `geometry`, so the link walk is linear.
    std::vector<std::pair<int, std::size_t>> at;
    at.reserve(d.geometry.size());
    for (std::size_t i = 0; i < d.geometry.size(); ++i) {
      at.emplace_back(d.geometry[i].irId, i);
    }
    auto slotOf = [&at](int irId) -> std::size_t {
      for (const std::pair<int, std::size_t>& p : at) {
        if (p.first == irId) return p.second;
      }
      return kNoIndex;
    };

    for (std::size_t i = 0; i < d.geometry.size(); ++i) {
      d.freedoms += d.geometry[i].freedoms;
      for (int ref : d.geometry[i].builtOn) {
        const std::size_t other = slotOf(ref);
        if (other == kNoIndex) continue;
        SketchLink link;
        link.from = i;
        link.to = other;
        link.kind = SketchLinkKind::BuiltOn;
        link.irId = d.geometry[i].irId;
        link.name = toString(SketchLinkKind::BuiltOn);
        d.links.push_back(std::move(link));
      }
    }
    for (const SketchConstraintRow& c : d.constraints) {
      if (c.fault != ConstraintFault::None) { ++d.faults; continue; }
      d.held += c.holds;
      // Every pair the constraint names is linked. A constraint over three
      // operands links all three, which is what SYMM and MIDPT do.
      for (std::size_t a = 0; a + 1 < c.operands.size(); ++a) {
        for (std::size_t b = a + 1; b < c.operands.size(); ++b) {
          const std::size_t from = slotOf(c.operands[a]);
          const std::size_t to = slotOf(c.operands[b]);
          if (from == kNoIndex || to == kNoIndex) continue;
          SketchLink link;
          link.from = from;
          link.to = to;
          link.kind = SketchLinkKind::Constrained;
          link.irId = c.irId;
          link.name = c.name;
          d.links.push_back(std::move(link));
        }
      }
    }

    d.stillFree = static_cast<int>(d.freedoms) - static_cast<int>(d.held);
    if (d.geometry.empty()) d.definition = SketchDefinition::Empty;
    else if (d.stillFree > 0) d.definition = SketchDefinition::Under;
    else if (d.stillFree < 0) d.definition = SketchDefinition::Over;
    else d.definition = SketchDefinition::Fully;

    // Geometry that carries free numbers and that no SOUND constraint reaches.
    // Exact, and independent of every count above.
    for (const SketchGeometryRow& g : d.geometry) {
      if (g.freedoms == 0) continue;
      bool touched = false;
      for (std::size_t ci : g.constraints) {
        if (ci < d.constraints.size() && d.constraints[ci].fault == ConstraintFault::None) {
          touched = true;
          break;
        }
      }
      if (!touched) ++d.untouched;
    }

    // ── the clusters: connected components over the links ──────────────────
    // Union-find over `geometry`, walked once so the numbering is the order the
    // clusters' lowest members appear rather than the order the links do.
    std::vector<std::size_t> parent(d.geometry.size());
    for (std::size_t i = 0; i < parent.size(); ++i) parent[i] = i;
    // Iterative find with path compression: a sketch can be long, and a
    // recursive find on a chain of a thousand points is a stack this UI does
    // not need to spend.
    auto find = [&parent](std::size_t x) {
      std::size_t root = x;
      while (parent[root] != root) root = parent[root];
      while (parent[x] != root) {
        const std::size_t next = parent[x];
        parent[x] = root;
        x = next;
      }
      return root;
    };
    for (const SketchLink& link : d.links) {
      if (link.from >= parent.size() || link.to >= parent.size()) continue;
      const std::size_t a = find(link.from);
      const std::size_t b = find(link.to);
      if (a != b) parent[a] = b;
    }
    // A SEPARATE vector for the root's cluster number. Reusing one vector for
    // both "which cluster is this root" and "which cluster is this row" reads
    // correctly only as long as no row is ever both, which is a property of the
    // walk rather than of the data -- and a reader has to prove it before they
    // can trust the loop.
    std::vector<std::size_t> rootCluster(d.geometry.size(), kNoIndex);
    for (std::size_t i = 0; i < d.geometry.size(); ++i) {
      const std::size_t root = find(i);
      if (rootCluster[root] == kNoIndex) {
        rootCluster[root] = d.clusters.size();
        d.clusters.push_back(SketchCluster{});
      }
      const std::size_t c = rootCluster[root];
      d.geometry[i].cluster = c;
      d.clusters[c].members.push_back(i);
      d.clusters[c].freedoms += d.geometry[i].freedoms;
      if (d.geometry[i].pinned) d.clusters[c].pinned = true;
    }
    for (const SketchConstraintRow& c : d.constraints) {
      if (c.fault != ConstraintFault::None) continue;
      std::size_t cluster = kNoIndex;
      for (int ref : c.operands) {
        const std::size_t slot = slotOf(ref);
        if (slot == kNoIndex) continue;
        cluster = d.geometry[slot].cluster;
        break;
      }
      if (cluster != kNoIndex && cluster < d.clusters.size()) {
        d.clusters[cluster].held += c.holds;
      }
    }
  }

  return out;
}

}  // namespace forge::ui
