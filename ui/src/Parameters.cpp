#include "forge/ui/Parameters.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "forge/ui/ArchieOpVocabulary.hpp"
#include "forge/ui/ExpressionEngine.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/ParameterSet.hpp"
#include "forge/ui/PartCommands.hpp"

namespace forge::ui {

// ── ExprDimensions ──────────────────────────────────────────────────────────
bool ExprDimensions::dimensionless() const noexcept {
  for (const std::int8_t e : exps) {
    if (e != 0) return false;
  }
  return true;
}

ExprDimensions ExprDimensions::length() noexcept {
  ExprDimensions d;
  d.exps[0] = 1;
  return d;
}

ExprDimensions ExprDimensions::mass() noexcept {
  ExprDimensions d;
  d.exps[1] = 1;
  return d;
}

ExprDimensions ExprDimensions::angle() noexcept {
  ExprDimensions d;
  d.exps[7] = 1;
  return d;
}

// ── ParameterSet ────────────────────────────────────────────────────────────
bool operator==(const ParameterDef& a, const ParameterDef& b) noexcept {
  return a.name == b.name && a.expression == b.expression && a.comment == b.comment;
}
bool operator!=(const ParameterDef& a, const ParameterDef& b) noexcept { return !(a == b); }

bool operator==(const DimensionBinding& a, const DimensionBinding& b) noexcept {
  return a.irId == b.irId && a.argument == b.argument && a.slot == b.slot &&
         a.expression == b.expression;
}
bool operator!=(const DimensionBinding& a, const DimensionBinding& b) noexcept {
  return !(a == b);
}

const ParameterDef* ParameterSet::find(const std::string& name) const noexcept {
  for (const ParameterDef& p : parameters_) {
    if (p.name == name) return &p;
  }
  return nullptr;
}

const DimensionBinding* ParameterSet::bindingFor(int irId, std::size_t slot) const noexcept {
  for (const DimensionBinding& b : bindings_) {
    if (b.irId == irId && b.slot == slot) return &b;
  }
  return nullptr;
}

void ParameterSet::upsertParameter(const ParameterDef& def) {
  for (ParameterDef& p : parameters_) {
    if (p.name == def.name) {
      p = def;
      return;
    }
  }
  parameters_.push_back(def);
}

bool ParameterSet::eraseParameter(const std::string& name) {
  const auto it = std::find_if(parameters_.begin(), parameters_.end(),
                               [&name](const ParameterDef& p) { return p.name == name; });
  if (it == parameters_.end()) return false;
  parameters_.erase(it);
  return true;
}

void ParameterSet::upsertBinding(const DimensionBinding& binding) {
  for (DimensionBinding& b : bindings_) {
    if (b.irId == binding.irId && b.slot == binding.slot) {
      b = binding;
      return;
    }
  }
  bindings_.push_back(binding);
}

bool ParameterSet::eraseBinding(int irId, std::size_t slot) {
  const auto it = std::find_if(bindings_.begin(), bindings_.end(), [&](const DimensionBinding& b) {
    return b.irId == irId && b.slot == slot;
  });
  if (it == bindings_.end()) return false;
  bindings_.erase(it);
  return true;
}

bool ParameterSet::operator==(const ParameterSet& other) const noexcept {
  return parameters_ == other.parameters_ && bindings_ == other.bindings_;
}

// ── slots ───────────────────────────────────────────────────────────────────
const char* toString(SlotUnit unit) noexcept {
  switch (unit) {
    case SlotUnit::Length:  return "length";
    case SlotUnit::Angle:   return "angle";
    case SlotUnit::Plain:   return "number";
    case SlotUnit::Count:   return "count";
    case SlotUnit::Unknown: return "unknown";
  }
  return "unknown";
}

ExprDimensions dimensionsOf(SlotUnit unit) noexcept {
  switch (unit) {
    case SlotUnit::Length: return ExprDimensions::length();
    case SlotUnit::Angle:  return ExprDimensions::angle();
    case SlotUnit::Plain:
    case SlotUnit::Count:
    case SlotUnit::Unknown:
      return ExprDimensions::none();
  }
  return ExprDimensions::none();
}

namespace {

SlotUnit unitFromVocabulary(std::string_view spelling) noexcept {
  if (spelling == "mm") return SlotUnit::Length;
  if (spelling == "deg") return SlotUnit::Angle;
  if (spelling == "count") return SlotUnit::Count;
  if (spelling == "dimensionless") return SlotUnit::Plain;
  return SlotUnit::Unknown;
}

NumericSlot fromRow(const vocab::NumericSlotRow& row) {
  NumericSlot s;
  s.found = true;
  s.ambiguous = row.ambiguous;
  s.index = row.index;
  s.name = std::string(row.name);
  s.unit = row.ambiguous ? SlotUnit::Unknown : unitFromVocabulary(row.unit);
  return s;
}

std::string upper(std::string_view text) {
  std::string out(text);
  for (char& c : out) {
    if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 'a' + 'A');
  }
  return out;
}

std::string titleCase(std::string_view op) {
  std::string name(op);
  for (std::size_t i = 0; i < name.size(); ++i) {
    const unsigned char c = static_cast<unsigned char>(name[i]);
    if (i == 0) {
      if (c >= 'a' && c <= 'z') name[i] = static_cast<char>(c - 'a' + 'A');
    } else if (c >= 'A' && c <= 'Z') {
      name[i] = static_cast<char>(c - 'A' + 'a');
    }
  }
  return name;
}

bool isBindable(const NumericSlot& s) noexcept {
  return s.found && !s.ambiguous && s.unit != SlotUnit::Unknown;
}

}  // namespace

NumericSlot numericSlotByName(std::string_view op, std::string_view argument) {
  const std::string key = upper(op);
  for (const vocab::NumericSlotRow& row : vocab::kNumericSlots) {
    if (row.op == key && row.name == argument) return fromRow(row);
  }
  return NumericSlot{};
}

NumericSlot numericSlotAt(std::string_view op, std::size_t index) {
  const std::string key = upper(op);
  for (const vocab::NumericSlotRow& row : vocab::kNumericSlots) {
    if (row.op == key && row.index == index) return fromRow(row);
  }
  return NumericSlot{};
}

std::vector<NumericSlot> bindableSlotsOf(std::string_view op) {
  const std::string key = upper(op);
  std::vector<NumericSlot> out;
  for (const vocab::NumericSlotRow& row : vocab::kNumericSlots) {
    if (row.op != key) continue;
    NumericSlot s = fromRow(row);
    if (isBindable(s)) out.push_back(std::move(s));
  }
  return out;
}

std::string featureReferenceLabel(const FeatureRecord& record) {
  const std::string name = featureDisplayName(record);
  const std::string id = std::to_string(record.irId);
  // featureDisplayName() is the tree's LABEL when a command set one ("Hole",
  // "Edge Fillet"), and two holes share it. A sentence that says which feature a
  // refusal is about has to say WHICH one, so the statement number is appended
  // unless the name already ends with it ("Fillet 4").
  if (name.size() > id.size() && name.compare(name.size() - id.size(), id.size(), id) == 0 &&
      name[name.size() - id.size() - 1] == ' ') {
    return name;
  }
  return name + " " + id;
}

std::string slotReferenceName(const FeatureRecord& record, std::string_view argument) {
  return titleCase(record.line.op) + std::to_string(record.irId) + "." + std::string(argument);
}

bool parseSlotReference(const std::string& name, std::string& opTitle, int& irId,
                        std::string& argument) {
  const std::size_t dot = name.find('.');
  if (dot == std::string::npos || dot == 0 || dot + 1 >= name.size()) return false;
  if (name.find('.', dot + 1) != std::string::npos) return false;
  const std::string head = name.substr(0, dot);
  std::size_t digits = head.size();
  while (digits > 0 && head[digits - 1] >= '0' && head[digits - 1] <= '9') --digits;
  if (digits == 0 || digits == head.size()) return false;
  const std::string number = head.substr(digits);
  if (number.size() > 9 || number[0] == '0') return false;
  for (std::size_t i = 0; i < digits; ++i) {
    const char c = head[i];
    if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'))) return false;
  }
  opTitle = head.substr(0, digits);
  irId = std::stoi(number);
  argument = name.substr(dot + 1);
  return irId > 0;
}

const char* toString(ParameterProblem problem) noexcept {
  switch (problem) {
    case ParameterProblem::None:               return "none";
    case ParameterProblem::NoEngine:           return "no_engine";
    case ParameterProblem::InvalidName:        return "invalid_name";
    case ParameterProblem::BadFormula:         return "bad_formula";
    case ParameterProblem::UnknownName:        return "unknown_name";
    case ParameterProblem::Cycle:              return "cycle";
    case ParameterProblem::Evaluation:         return "evaluation";
    case ParameterProblem::WrongDimension:     return "wrong_dimension";
    case ParameterProblem::NotWholeNumber:     return "not_whole_number";
    case ParameterProblem::NoSuchFeature:      return "no_such_feature";
    case ParameterProblem::NoSuchArgument:     return "no_such_argument";
    case ParameterProblem::AmbiguousArgument:  return "ambiguous_argument";
    case ParameterProblem::UnitlessArgument:   return "unitless_argument";
    case ParameterProblem::ArgumentNotWritten: return "argument_not_written";
    case ParameterProblem::NotBound:           return "not_bound";
    case ParameterProblem::NoSuchParameter:    return "no_such_parameter";
    case ParameterProblem::StillUsed:          return "still_used";
    case ParameterProblem::EditRefused:        return "edit_refused";
  }
  return "none";
}

// ── recompute ───────────────────────────────────────────────────────────────
namespace {

// One vertex of the dependency graph: a parameter, or a bound feature number.
struct Node {
  bool isParameter = true;
  std::size_t row = 0;         // index into set.parameters() or set.bindings()
  std::string key;             // the name formulas use for it
  std::string expression;
  std::vector<std::string> uses;
  std::vector<std::size_t> deps;  // node indices, in `uses` order
  ParameterProblem problem = ParameterProblem::None;
  std::string error;
  bool evaluated = false;
  bool ok = false;
  ExprQuantity value;
};

// What a name that is NOT a node resolves to: an unbound feature number, whose
// value is whatever its statement holds now.
struct Leaf {
  bool ok = false;
  ExprQuantity value;
  ParameterProblem problem = ParameterProblem::None;
  std::string error;
};

struct FeatureNumber {
  ParameterProblem problem = ParameterProblem::None;
  std::string error;
  const FeatureRecord* record = nullptr;
  NumericSlot slot;
  double current = 0.0;
};

// Resolve `argument` of statement `irId`, checking everything a binding or a
// reference needs: the statement exists, its op has that argument, the argument's
// meaning and unit are known, and the statement actually wrote it.
FeatureNumber featureNumber(const PartDocument& doc, int irId, const std::string& argument,
                            const std::string* expectOp) {
  FeatureNumber out;
  out.record = doc.featureAt(irId);
  if (out.record == nullptr) {
    out.problem = ParameterProblem::NoSuchFeature;
    out.error = "there is no feature " + std::to_string(irId) + " in this part";
    return out;
  }
  const std::string featureName = featureReferenceLabel(*out.record);
  if (expectOp != nullptr && upper(*expectOp) != upper(out.record->line.op)) {
    out.problem = ParameterProblem::NoSuchFeature;
    out.error = "feature " + std::to_string(irId) + " is " + featureName + ", not a " +
                titleCase(*expectOp);
    return out;
  }
  out.slot = numericSlotByName(out.record->line.op, argument);
  if (!out.slot.found) {
    std::string known;
    for (const NumericSlot& s : bindableSlotsOf(out.record->line.op)) {
      if (!known.empty()) known += ", ";
      known += s.name;
    }
    out.problem = ParameterProblem::NoSuchArgument;
    out.error = featureName + " has no number called '" + argument + "'" +
                (known.empty() ? std::string(" -- it has no number that can be driven")
                               : " -- its numbers are " + known);
    return out;
  }
  if (out.slot.ambiguous) {
    out.problem = ParameterProblem::AmbiguousArgument;
    out.error = "what '" + argument + "' means in " + featureName +
                " depends on how the feature was made, so it cannot be driven by a formula";
    return out;
  }
  if (out.slot.unit == SlotUnit::Unknown) {
    out.problem = ParameterProblem::UnitlessArgument;
    out.error = "'" + argument + "' of " + featureName + " has no known unit to check a formula against";
    return out;
  }
  const std::vector<IrArg>& args = out.record->line.args;
  if (out.slot.index >= args.size() || args[out.slot.index].kind != IrArgKind::Number) {
    out.problem = ParameterProblem::ArgumentNotWritten;
    out.error = featureName + " was made without a '" + argument + "' value";
    return out;
  }
  out.current = args[out.slot.index].number;
  return out;
}

class Solver final : public ExprNameResolver {
 public:
  Solver(const PartDocument& doc, const ParameterSet& set, const ExpressionEngine& engine)
      : doc_(doc), set_(set), engine_(engine) {}

  RecomputeResult run();

  bool resolve(const std::string& name, ExprQuantity& out, std::string& why) const override;

 private:
  void buildNodes();
  void linkEdges();
  void findCycles();
  void evaluate(std::size_t index);
  bool checkBinding(Node& node);
  void setProblem(ParameterProblem problem, const std::string& error);

  const PartDocument& doc_;
  const ParameterSet& set_;
  const ExpressionEngine& engine_;
  std::vector<Node> nodes_;
  std::map<std::string, std::size_t> byKey_;
  mutable std::map<std::string, Leaf> leaves_;
  RecomputeResult result_;
  std::vector<std::size_t> bindingNodeOfRow_;
};

void Solver::setProblem(ParameterProblem problem, const std::string& error) {
  if (result_.problem != ParameterProblem::None) return;  // the first reason is the cause
  result_.problem = problem;
  result_.error = error;
}

void Solver::buildNodes() {
  for (std::size_t i = 0; i < set_.parameters().size(); ++i) {
    const ParameterDef& def = set_.parameters()[i];
    Node n;
    n.isParameter = true;
    n.row = i;
    n.key = def.name;
    n.expression = def.expression;
    if (!engine_.validName(def.name)) {
      n.problem = ParameterProblem::InvalidName;
      n.error = "'" + def.name + "' cannot be a parameter name";
    } else if (byKey_.count(def.name) != 0) {
      n.problem = ParameterProblem::InvalidName;
      n.error = "there are two parameters called '" + def.name + "'";
    }
    byKey_.emplace(def.name, nodes_.size());
    nodes_.push_back(std::move(n));
  }
  for (std::size_t i = 0; i < set_.bindings().size(); ++i) {
    const DimensionBinding& b = set_.bindings()[i];
    Node n;
    n.isParameter = false;
    n.row = i;
    n.expression = b.expression;
    const FeatureNumber fn = featureNumber(doc_, b.irId, b.argument, nullptr);
    if (fn.problem != ParameterProblem::None) {
      n.key = "feature " + std::to_string(b.irId) + "." + b.argument;
      n.problem = fn.problem;
      n.error = fn.error;
    } else {
      n.key = slotReferenceName(*fn.record, b.argument);
      if (fn.slot.index != b.slot) {
        n.problem = ParameterProblem::NoSuchArgument;
        n.error = featureReferenceLabel(*fn.record) + "'s '" + b.argument +
                  "' is not the number this binding was made for";
      } else if (byKey_.count(n.key) != 0) {
        n.problem = ParameterProblem::InvalidName;
        n.error = featureReferenceLabel(*fn.record) + "'s '" + b.argument + "' is driven twice";
      }
    }
    byKey_.emplace(n.key, nodes_.size());
    bindingNodeOfRow_.push_back(nodes_.size());
    nodes_.push_back(std::move(n));
  }
}

void Solver::linkEdges() {
  for (Node& n : nodes_) {
    if (n.problem != ParameterProblem::None) continue;
    const ExprCompiled compiled = engine_.compile(n.expression);
    if (!compiled.ok) {
      n.problem = ParameterProblem::BadFormula;
      n.error = compiled.error;
      continue;
    }
    n.uses = compiled.names;
    for (const std::string& name : compiled.names) {
      const auto it = byKey_.find(name);
      if (it != byKey_.end()) {
        n.deps.push_back(it->second);
        continue;
      }
      // Not a node: an unbound feature number, or nothing.
      std::string opTitle;
      std::string argument;
      int irId = 0;
      if (!parseSlotReference(name, opTitle, irId, argument)) {
        n.problem = ParameterProblem::UnknownName;
        n.error = "there is no parameter called '" + name + "'";
        break;
      }
      const FeatureNumber fn = featureNumber(doc_, irId, argument, &opTitle);
      if (fn.problem != ParameterProblem::None) {
        n.problem = fn.problem;
        n.error = "'" + name + "' names nothing: " + fn.error;
        break;
      }
      Leaf leaf;
      leaf.ok = true;
      leaf.value.value = fn.current;
      leaf.value.dims = dimensionsOf(fn.slot.unit);
      leaves_.emplace(name, leaf);
    }
  }
}

// Tarjan-free and deterministic: an iterative-deepening DFS in document order,
// with the path kept, so the FIRST cycle met is reported with every member named
// in the order the definitions reach each other.
void Solver::findCycles() {
  enum class Mark : std::uint8_t { White, Grey, Black };
  std::vector<Mark> mark(nodes_.size(), Mark::White);
  std::vector<std::size_t> path;

  struct Frame {
    std::size_t node;
    std::size_t next;
  };

  for (std::size_t start = 0; start < nodes_.size(); ++start) {
    if (mark[start] != Mark::White) continue;
    std::vector<Frame> stack{{start, 0}};
    mark[start] = Mark::Grey;
    path.assign(1, start);
    while (!stack.empty()) {
      Frame& top = stack.back();
      const Node& n = nodes_[top.node];
      if (top.next < n.deps.size()) {
        const std::size_t dep = n.deps[top.next++];
        if (mark[dep] == Mark::Grey) {
          // The cycle is the path from `dep` to here, and back to `dep`.
          const auto from = std::find(path.begin(), path.end(), dep);
          std::vector<std::string> members;
          for (auto it = from; it != path.end(); ++it) members.push_back(nodes_[*it].key);
          members.push_back(nodes_[dep].key);
          std::string spelled;
          for (std::size_t i = 0; i < members.size(); ++i) {
            if (i != 0) spelled += " -> ";
            spelled += members[i];
          }
          for (auto it = from; it != path.end(); ++it) {
            Node& member = nodes_[*it];
            if (member.problem == ParameterProblem::None) {
              member.problem = ParameterProblem::Cycle;
              member.error = "these definitions depend on each other: " + spelled;
            }
          }
          if (result_.cycle.empty()) {
            result_.cycle = members;
            setProblem(ParameterProblem::Cycle,
                       "these definitions depend on each other: " + spelled);
          }
        } else if (mark[dep] == Mark::White) {
          mark[dep] = Mark::Grey;
          path.push_back(dep);
          stack.push_back(Frame{dep, 0});
        }
      } else {
        mark[top.node] = Mark::Black;
        path.pop_back();
        stack.pop_back();
      }
    }
  }
}

bool Solver::resolve(const std::string& name, ExprQuantity& out, std::string& why) const {
  const auto it = byKey_.find(name);
  if (it != byKey_.end()) {
    const Node& n = nodes_[it->second];
    if (!n.evaluated || !n.ok) {
      why = "'" + name + "' has no value";
      return false;
    }
    out = n.value;
    return true;
  }
  const auto leaf = leaves_.find(name);
  if (leaf != leaves_.end() && leaf->second.ok) {
    out = leaf->second.value;
    return true;
  }
  why = "there is no parameter called '" + name + "'";
  return false;
}

bool Solver::checkBinding(Node& node) {
  const DimensionBinding& b = set_.bindings()[node.row];
  const FeatureNumber fn = featureNumber(doc_, b.irId, b.argument, nullptr);
  const std::string featureName = featureReferenceLabel(*fn.record);
  const ExprDimensions want = dimensionsOf(fn.slot.unit);
  if (node.value.dims != want) {
    node.problem = ParameterProblem::WrongDimension;
    const std::string wantName = engine_.dimensionName(want);
    const std::string gotName = engine_.dimensionName(node.value.dims);
    std::string hint;
    if (node.value.dims.dimensionless() && fn.slot.unit == SlotUnit::Length) {
      hint = " -- write the unit, for example '" + engine_.describe(node.value) + " mm'";
    } else if (node.value.dims.dimensionless() && fn.slot.unit == SlotUnit::Angle) {
      hint = " -- write the unit, for example '" + engine_.describe(node.value) + " deg'";
    }
    node.error = featureName + "'s " + b.argument + " is " +
                 (want.dimensionless() ? std::string("a plain number") : "a " + wantName) +
                 ", but '" + b.expression + "' is " +
                 (node.value.dims.dimensionless() ? std::string("a plain number") : "a " + gotName) +
                 hint;
    return false;
  }
  if (fn.slot.unit == SlotUnit::Count) {
    const double v = node.value.value;
    if (std::fabs(v - std::round(v)) > 1e-9) {
      node.problem = ParameterProblem::NotWholeNumber;
      node.error = featureName + "'s " + b.argument + " counts copies and must be a whole number, "
                   "but '" + b.expression + "' is " + engine_.describe(node.value);
      return false;
    }
    node.value.value = std::round(v);
  }
  return true;
}

void Solver::evaluate(std::size_t index) {
  // Iterative post-order over the graph. findCycles() has already marked every
  // cycle member, so a well-formed run never meets a node that is still on the
  // stack; `onStack` is the second line of defence that turns a cycle the search
  // missed into a refusal instead of an unbounded loop.
  std::vector<std::pair<std::size_t, std::size_t>> stack{{index, 0}};
  std::vector<char> onStack(nodes_.size(), 0);
  onStack[index] = 1;
  while (!stack.empty()) {
    auto& [nodeIndex, next] = stack.back();
    Node& n = nodes_[nodeIndex];
    if (n.evaluated) {
      onStack[nodeIndex] = 0;
      stack.pop_back();
      continue;
    }
    if (n.problem != ParameterProblem::None) {
      n.evaluated = true;
      n.ok = false;
      onStack[nodeIndex] = 0;
      stack.pop_back();
      continue;
    }
    if (next < n.deps.size()) {
      const std::size_t dep = n.deps[next++];
      if (onStack[dep] != 0) {
        Node& looped = nodes_[dep];
        if (looped.problem == ParameterProblem::None) {
          looped.problem = ParameterProblem::Cycle;
          looped.error = "'" + looped.key + "' depends on itself";
        }
        continue;
      }
      if (!nodes_[dep].evaluated) {
        onStack[dep] = 1;
        stack.push_back({dep, 0});
      }
      continue;
    }
    // Every dependency is decided. One that failed fails this one, by name.
    for (std::size_t dep : n.deps) {
      if (!nodes_[dep].ok) {
        n.problem = nodes_[dep].problem == ParameterProblem::Cycle ? ParameterProblem::Cycle
                                                                    : nodes_[dep].problem;
        n.error = "it uses '" + nodes_[dep].key + "', which " +
                  (nodes_[dep].error.empty() ? std::string("has no value") : "failed: " + nodes_[dep].error);
        break;
      }
    }
    if (n.problem == ParameterProblem::None) {
      const ExprEvaluated value = engine_.evaluate(n.expression, *this);
      if (!value.ok) {
        n.problem = ParameterProblem::Evaluation;
        n.error = value.error;
      } else {
        n.value = value.quantity;
        n.ok = n.isParameter ? true : checkBinding(n);
      }
    }
    n.evaluated = true;
    n.ok = n.ok && n.problem == ParameterProblem::None;
    onStack[nodeIndex] = 0;
    stack.pop_back();
  }
}

RecomputeResult Solver::run() {
  buildNodes();
  linkEdges();
  findCycles();
  for (std::size_t i = 0; i < nodes_.size(); ++i) evaluate(i);

  // Report, in document order: parameters first, then bindings.
  for (const Node& n : nodes_) {
    if (n.problem != ParameterProblem::None) {
      const std::string subject =
          n.isParameter ? "'" + n.key + "'"
                        : (n.key.rfind("feature ", 0) == 0 ? n.key : "'" + n.key + "'");
      setProblem(n.problem, subject + ": " + n.error);
    }
    if (n.isParameter) {
      ParameterValue v;
      v.name = n.key;
      v.ok = n.ok;
      v.quantity = n.value;
      v.uses = n.uses;
      v.problem = n.problem;
      v.error = n.error;
      result_.parameters.push_back(std::move(v));
    }
  }
  for (std::size_t row = 0; row < set_.bindings().size(); ++row) {
    const Node& n = nodes_[bindingNodeOfRow_[row]];
    const DimensionBinding& b = set_.bindings()[row];
    BoundSlotValue v;
    v.binding = b;
    v.reference = n.key;
    v.uses = n.uses;
    v.problem = n.problem;
    v.error = n.error;
    v.ok = n.ok;
    v.quantity = n.value;
    if (const FeatureRecord* rec = doc_.featureAt(b.irId)) {
      v.feature = featureReferenceLabel(*rec);
      const NumericSlot slot = numericSlotByName(rec->line.op, b.argument);
      v.unit = slot.unit;
      if (b.slot < rec->line.args.size() && rec->line.args[b.slot].kind == IrArgKind::Number) {
        v.current = rec->line.args[b.slot].number;
      }
    }
    v.target = n.ok ? n.value.value : v.current;
    if (n.ok && formatIrNumber(v.target) != formatIrNumber(v.current)) {
      result_.updates.push_back(ArgumentUpdate{b.irId, b.slot, v.current, v.target});
    }
    result_.bindings.push_back(std::move(v));
  }
  result_.ok = result_.problem == ParameterProblem::None;
  if (!result_.ok) result_.updates.clear();
  return result_;
}

}  // namespace

RecomputeResult recomputeParameters(const PartDocument& doc, const ParameterSet& set,
                                    const ExpressionEngine& engine) {
  Solver solver(doc, set, engine);
  return solver.run();
}

// ── ParameterEdit ───────────────────────────────────────────────────────────
ParameterEdit::ParameterEdit(ParameterSet after, std::vector<ArgumentUpdate> updates,
                             std::string label, std::shared_ptr<std::string> failure)
    : after_(std::move(after)),
      updates_(std::move(updates)),
      label_(std::move(label)),
      failureSink_(std::move(failure)) {}

void ParameterEdit::rollback(PartDocument& doc) {
  for (auto it = beforeArgs_.rbegin(); it != beforeArgs_.rend(); ++it) {
    doc.editFeatureArgs(it->first, it->second);
  }
  beforeArgs_.clear();
  doc.setParameters(before_);
}

bool ParameterEdit::apply(PartDocument& doc) {
  failure_.clear();
  // Captured on EVERY apply -- redo calls apply() again -- for the reason
  // EditFeatureArgsEdit gives: a `before` frozen at construction would put back a
  // state the document stopped holding.
  before_ = doc.parameters();
  beforeArgs_.clear();
  for (const ArgumentUpdate& u : updates_) {
    const FeatureRecord* rec = doc.featureAt(u.irId);
    if (rec == nullptr || u.slot >= rec->line.args.size() ||
        rec->line.args[u.slot].kind != IrArgKind::Number) {
      failure_ = "feature " + std::to_string(u.irId) + " no longer has that number";
      if (failureSink_) *failureSink_ = failure_;
      rollback(doc);
      return false;
    }
    std::vector<IrArg> args = rec->line.args;
    const std::vector<IrArg> previous = args;
    args[u.slot] = IrArg::num(u.to);
    if (!doc.editFeatureArgs(u.irId, args)) {
      if (doc.lastEdit() == EditCheck::NoChange) continue;
      failure_ = featureReferenceLabel(*rec) + " cannot take the value " + formatIrNumber(u.to) +
                 (doc.lastEdit() == EditCheck::InvalidStatement
                      ? std::string(" -- the feature would no longer be valid")
                      : std::string(" -- the feature changed underneath the formula"));
      if (failureSink_) *failureSink_ = failure_;
      rollback(doc);
      return false;
    }
    beforeArgs_.emplace_back(u.irId, previous);
  }
  if (beforeArgs_.empty() && before_ == after_) {
    failure_ = "nothing changed";
    if (failureSink_) *failureSink_ = failure_;
    return false;
  }
  doc.setParameters(after_);
  return true;
}

void ParameterEdit::revert(PartDocument& doc) {
  rollback(doc);
}

}  // namespace forge::ui
