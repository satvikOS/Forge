#include "forge/ui/PartCommands.hpp"

#include <algorithm>
#include <cstddef>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"

namespace forge::ui {

const char* toString(IrValueKind kind) noexcept {
  switch (kind) {
    case IrValueKind::None:    return "none";
    case IrValueKind::Profile: return "profile";
    case IrValueKind::Wire:    return "wire";
    case IrValueKind::Solid:   return "solid";
  }
  return "none";
}

// ── PartDocument ────────────────────────────────────────────────────────────
int PartDocument::seed(IrValueKind kind, const std::string& nodeId, const std::string& op,
                       std::vector<IrArg> args) {
  FeatureRecord rec;
  rec.irId = nextIrId();
  rec.label = nodeId;
  rec.line = IrLine{rec.irId, op, std::move(args)};
  rec.produces = kind;
  return appendFeature(rec, {}, nodeId) ? rec.irId : 0;
}

int PartDocument::valueFor(const std::string& nodeId) const noexcept {
  auto it = bindings_.find(nodeId);
  return it == bindings_.end() ? 0 : it->second;
}

IrValueKind PartDocument::kindOf(int irId) const noexcept {
  if (irId <= 0 || static_cast<std::size_t>(irId) > records_.size()) return IrValueKind::None;
  return records_[static_cast<std::size_t>(irId) - 1].produces;
}

std::size_t PartDocument::featureCount() const noexcept {
  std::size_t n = 0;
  for (const FeatureRecord& r : records_) {
    if (!r.commandId.empty()) ++n;
  }
  return n;
}

const FeatureRecord* PartDocument::lastFeature() const noexcept {
  for (std::size_t i = records_.size(); i > 0; --i) {
    const FeatureRecord& r = records_[i - 1];
    if (!r.commandId.empty()) return &r;
  }
  return nullptr;
}

std::string PartDocument::irProgram() const {
  std::string out;
  for (const FeatureRecord& r : records_) {
    out += r.line.text();
    out += "\n";
  }
  return out;
}

bool PartDocument::appendFeature(const FeatureRecord& record,
                                 const std::vector<std::string>& consumedNodes,
                                 const std::string& producedNode) {
  // A statement must be numbered by creation order, or every `%N` in the
  // program after it means something different.
  if (record.irId != nextIrId() || record.line.id != record.irId) {
    lastCheck_ = IrCheck::BadStatementId;
    return false;
  }
  const IrCheck check = validateIr(record.line);
  lastCheck_ = check;
  if (check != IrCheck::Ok) return false;  // no partial mutation

  records_.push_back(record);
  for (const std::string& node : consumedNodes) bindings_.erase(node);
  if (!producedNode.empty()) bindings_[producedNode] = record.irId;
  return true;
}

PartDocument::Snapshot PartDocument::snapshot() const {
  return Snapshot{records_.size(), bindings_};
}

void PartDocument::restore(const Snapshot& state) {
  if (state.records < records_.size()) {
    records_.resize(state.records);
  }
  bindings_ = state.bindings;
}

// ── AppendFeatureEdit (GoF ConcreteCommand + Memento) ───────────────────────
AppendFeatureEdit::AppendFeatureEdit(FeatureRecord record, std::vector<std::string> consumedNodes,
                                     std::string producedNode)
    : record_(std::move(record)),
      consumed_(std::move(consumedNodes)),
      produced_(std::move(producedNode)) {}

bool AppendFeatureEdit::apply(PartDocument& doc) {
  before_ = doc.snapshot();
  // On redo the record keeps its ORIGINAL ir id. An id that drifted on redo
  // would silently rewrite every later `%N` in the program.
  return doc.appendFeature(record_, consumed_, produced_);
}

void AppendFeatureEdit::revert(PartDocument& doc) { doc.restore(before_); }

// ── UndoStack (GoF Caretaker) ───────────────────────────────────────────────
bool UndoStack::perform(PartDocument& doc, std::unique_ptr<UndoableEdit> edit) {
  if (!edit) return false;
  if (!edit->apply(doc)) return false;  // a refused edit is never pushed
  done_.push_back(std::move(edit));
  undone_.clear();  // linear undo: a new edit abandons the redo branch
  return true;
}

bool UndoStack::undo(PartDocument& doc) {
  if (done_.empty()) return false;
  std::unique_ptr<UndoableEdit> edit = std::move(done_.back());
  done_.pop_back();
  edit->revert(doc);
  undone_.push_back(std::move(edit));
  return true;
}

bool UndoStack::redo(PartDocument& doc) {
  if (undone_.empty()) return false;
  std::unique_ptr<UndoableEdit> edit = std::move(undone_.back());
  undone_.pop_back();
  if (!edit->apply(doc)) {
    // The pop above happened BEFORE the outcome was known. Returning here without
    // putting the edit back destructs it: the redo step vanishes from the stack
    // with no message, and the user cannot get that feature back. apply() really
    // does refuse -- AppendFeatureEdit replays its ORIGINAL ir id, and any append
    // that bypassed this stack (PartDocument::seed is public) has taken it.
    undone_.push_back(std::move(edit));
    return false;
  }
  done_.push_back(std::move(edit));
  return true;
}

std::string UndoStack::undoLabel() const {
  return done_.empty() ? std::string() : done_.back()->label();
}

std::string UndoStack::redoLabel() const {
  return undone_.empty() ? std::string() : undone_.back()->label();
}

void UndoStack::clear() noexcept {
  done_.clear();
  undone_.clear();
}

// ── registration ────────────────────────────────────────────────────────────
namespace {

// Resolve the live selection to DISTINCT feature-IR value ids, in selection
// order. An empty result means "this selection does not name IR values of the
// required kind" — which is the question every Part enabled-predicate is really
// asking, and the reason a command can be greyed out even with a signature-legal
// selection (a face of a body that is not in this document, say).
std::vector<int> resolveValues(const PartDocument& doc, const SelectionService& sel,
                               IrValueKind required) {
  std::vector<int> ids;
  for (const EntityRef& ref : sel.selection()) {
    const int id = doc.valueFor(ref.bodyId);
    if (id == 0 || doc.kindOf(id) != required) return {};
    if (std::find(ids.begin(), ids.end(), id) == ids.end()) ids.push_back(id);
  }
  return ids;
}

// The document node the selection belongs to (all refs must agree — a single
// FILLET op takes ONE %body, so two bodies is not one command).
std::string singleNode(const SelectionService& sel) {
  if (sel.selection().empty()) return {};
  const std::string node = sel.selection().front().bodyId;
  for (const EntityRef& ref : sel.selection()) {
    if (ref.bodyId != node) return {};
  }
  return node;
}

// A count is a count only if it is a WHOLE number. Written once because it was
// already written twice -- LINEAR and CIRCULAR each carried their own copy -- and
// then forgotten a third time, which is how GRID came to accept `nx = 1.5`.
// The magnitude test is what makes the cast DEFINED: static_cast<long long> of a
// double outside long long's range is undefined behaviour, and these values come
// straight from user-supplied parameters. It also rejects NaN, since every
// comparison against NaN is false.
bool wholeCount(double v) {
  constexpr double kTwoPow63 = 9223372036854775808.0;  // exactly representable
  if (!(v > -kTwoPow63 && v < kTwoPow63)) return false;
  return v == static_cast<double>(static_cast<long long>(v));
}

double num(const CommandContext& ctx, const char* name, double fallback) {
  return ctx.params().number(name).value_or(fallback);
}
bool flagOn(const CommandContext& ctx, const char* name) {
  return ctx.params().flag(name).value_or(false);
}
std::string txt(const CommandContext& ctx, const char* name, const char* fallback) {
  return ctx.params().text(name).value_or(std::string(fallback));
}
bool hasNumber(const CommandContext& ctx, const char* name) {
  return ctx.params().number(name).has_value();
}

std::string bodyNodeFor(int irId) { return "body_" + std::to_string(irId); }

// One emission == one undoable transaction.
void emit(CommandContext& ctx, PartDocument& doc, UndoStack& stack, const char* commandId,
          const char* label, const char* op, std::vector<IrArg> args, IrValueKind produces,
          const std::vector<std::string>& consumed, const std::string& producedNode) {
  FeatureRecord rec;
  rec.irId = doc.nextIrId();
  rec.commandId = commandId;
  rec.label = label;
  rec.line = IrLine{rec.irId, op, std::move(args)};
  rec.produces = produces;
  const std::string node = producedNode.empty() ? bodyNodeFor(rec.irId) : producedNode;
  // perform() returns whether the edit applied. Discarding it is how a refused feature became
  // a command that reported success and did nothing; appendFeature() is documented to refuse
  // and mutate NOTHING, and it was doing exactly that, unheard.
  if (!stack.perform(doc, std::make_unique<AppendFeatureEdit>(rec, consumed, node))) {
    ctx.fail(std::string("the document refused the statement: ") + toString(doc.lastCheck()));
  }
}

// Shared shape of every solid-editing command: exactly one solid in, the same
// document node out (a fillet does not give you a new body — the body keeps its
// identity and gains history, as it does in every parametric modeller).
struct SolidTarget {
  bool ok = false;
  int value = 0;
  std::string node;
};

SolidTarget solidTarget(const PartDocument& doc, const SelectionService& sel) {
  SolidTarget t;
  const std::vector<int> ids = resolveValues(doc, sel, IrValueKind::Solid);
  const std::string node = singleNode(sel);
  if (ids.size() != 1 || node.empty()) return t;
  t.ok = true;
  t.value = ids.front();
  t.node = node;
  return t;
}

// The FAIL-CLOSED read of a selection-derived value list. solidTarget() already
// gives every solid command this discipline -- it returns ok=false rather than
// indexing -- but three handlers indexed the raw vector instead and relied
// entirely on their enabled predicate having run first. dispatch() does run it,
// but CommandRegistry::find() hands out the descriptor with its public execute,
// so the predicate is a convention, not an enforcement. MEASURED on the code
// before this guard: calling execute() directly with an empty selection exits
// 139 (SIGSEGV) -- resolveValues returns a default-constructed vector whose data
// pointer is null, and front() dereferences it. Not a wrong answer: a crash.
bool requireValues(CommandContext& ctx, const std::vector<int>& ids, std::size_t want) {
  if (ids.size() == want) return true;
  ctx.fail("selection does not resolve to " + std::to_string(want) +
           " feature-IR value(s) of the required kind");
  return false;
}

CommandDescriptor base(const char* id, const char* label, const char* irOp,
                       SelectionSignature signature) {
  CommandDescriptor c;
  c.id = id;
  c.label = label;
  c.category = "Part";
  c.featureIrOp = irOp;
  c.signature = signature;
  c.sideEffect = SideEffectClass::Document;
  c.undo = UndoContract::Transaction;
  c.version = 1;
  return c;
}

}  // namespace

std::size_t registerPartCommands(CommandRegistry& registry, PartDocument& doc,
                                 UndoStack& stack) {
  PartDocument* d = &doc;
  UndoStack* s = &stack;
  std::size_t added = 0;
  const auto add = [&registry, &added](CommandDescriptor c) {
    if (registry.add(std::move(c))) ++added;
  };

  // ── EXTRUDE ───────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.extrude", "Extrude", "EXTRUDE",
                               SelectionSignature::exactly(EntityKind::Sketch, 1));
    c.schema.push_back(ParamSpec{"distance", ParamType::Number, true, 10.0, ""});
    c.schema.push_back(ParamSpec{"dirx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"diry", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"dirz", ParamType::Number, false, 1.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [d](const CommandContext& ctx) {
      return resolveValues(*d, ctx.selection(), IrValueKind::Profile).size() == 1 &&
             num(ctx, "distance", 0.0) != 0.0;  // a zero-height extrude is not a solid
    };
    c.execute = [d, s](CommandContext& ctx) {
      const std::vector<int> profiles = resolveValues(*d, ctx.selection(), IrValueKind::Profile);
      if (!requireValues(ctx, profiles, 1)) return;
      const int profile = profiles.front();
      std::vector<IrArg> args{IrArg::valueRef(profile), IrArg::num(num(ctx, "distance", 10.0))};
      if (hasNumber(ctx, "dirx") || hasNumber(ctx, "diry") || hasNumber(ctx, "dirz")) {
        args.push_back(IrArg::num(num(ctx, "dirx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "diry", 0.0)));
        args.push_back(IrArg::num(num(ctx, "dirz", 1.0)));
      }
      emit(ctx, *d, *s, "part.extrude", "Extrude", "EXTRUDE", std::move(args), IrValueKind::Solid,
           {}, {});
    };
    add(std::move(c));
  }

  // ── REVOLVE ───────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.revolve", "Revolve", "REVOLVE",
                               SelectionSignature::exactly(EntityKind::Sketch, 1));
    c.schema.push_back(ParamSpec{"angle", ParamType::Number, true, 360.0, ""});
    c.schema.push_back(ParamSpec{"axx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axy", ParamType::Number, false, 1.0, ""});
    c.schema.push_back(ParamSpec{"axz", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [d](const CommandContext& ctx) {
      const double a = num(ctx, "angle", 0.0);
      // REVOLVE's documented domain is 0 < a <= 360.
      return resolveValues(*d, ctx.selection(), IrValueKind::Profile).size() == 1 && a > 0.0 &&
             a <= 360.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const std::vector<int> profiles = resolveValues(*d, ctx.selection(), IrValueKind::Profile);
      if (!requireValues(ctx, profiles, 1)) return;
      const int profile = profiles.front();
      std::vector<IrArg> args{IrArg::valueRef(profile), IrArg::num(num(ctx, "angle", 360.0))};
      if (hasNumber(ctx, "axx") || hasNumber(ctx, "axy") || hasNumber(ctx, "axz")) {
        args.push_back(IrArg::num(0.0));  // ox, oy, oz — origin of the axis line
        args.push_back(IrArg::num(0.0));
        args.push_back(IrArg::num(0.0));
        args.push_back(IrArg::num(num(ctx, "axx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axy", 1.0)));
        args.push_back(IrArg::num(num(ctx, "axz", 0.0)));
      }
      emit(ctx, *d, *s, "part.revolve", "Revolve", "REVOLVE", std::move(args), IrValueKind::Solid,
           {}, {});
    };
    add(std::move(c));
  }

  // ── LOFT ──────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.loft", "Loft", "LOFT",
                               SelectionSignature::atLeast(EntityKind::Sketch, 2));
    c.schema.push_back(ParamSpec{"ruled", ParamType::Flag, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"open", ParamType::Flag, false, 0.0, ""});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      return resolveValues(*d, ctx.selection(), IrValueKind::Profile).size() >= 2;
    };
    c.execute = [d, s](CommandContext& ctx) {
      std::vector<IrArg> args;
      for (int id : resolveValues(*d, ctx.selection(), IrValueKind::Profile)) {
        args.push_back(IrArg::valueRef(id));
      }
      if (flagOn(ctx, "ruled")) args.push_back(IrArg::keyword("RULED"));
      if (flagOn(ctx, "open")) args.push_back(IrArg::keyword("OPEN"));
      emit(ctx, *d, *s, "part.loft", "Loft", "LOFT", std::move(args), IrValueKind::Solid, {}, {});
    };
    add(std::move(c));
  }

  // ── HOLE ──────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.hole", "Hole", "HOLE",
                               SelectionSignature::atLeast(EntityKind::Face, 1));
    c.schema.push_back(ParamSpec{"diameter", ParamType::Number, true, 6.0, ""});
    c.schema.push_back(ParamSpec{"x", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"y", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"z", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"depth", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      return solidTarget(*d, ctx.selection()).ok && num(ctx, "diameter", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      std::vector<IrArg> args{IrArg::valueRef(t.value), IrArg::num(num(ctx, "diameter", 6.0)),
                              IrArg::num(num(ctx, "x", 0.0)), IrArg::num(num(ctx, "y", 0.0)),
                              IrArg::num(num(ctx, "z", 0.0))};
      if (hasNumber(ctx, "depth")) {
        args.push_back(IrArg::num(0.0));  // axis: +Z
        args.push_back(IrArg::num(0.0));
        args.push_back(IrArg::num(1.0));
        args.push_back(IrArg::num(num(ctx, "depth", 0.0)));  // <= 0 => through
      }
      emit(ctx, *d, *s, "part.hole", "Hole", "HOLE", std::move(args), IrValueKind::Solid, {}, t.node);
    };
    add(std::move(c));
  }

  // ── COUNTERBORE ───────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.counterbore", "Counterbore Hole", "CBORE",
                               SelectionSignature::atLeast(EntityKind::Face, 1));
    c.schema.push_back(ParamSpec{"diameter", ParamType::Number, true, 6.0, ""});
    c.schema.push_back(ParamSpec{"cbore_diameter", ParamType::Number, true, 11.0, ""});
    c.schema.push_back(ParamSpec{"cbore_depth", ParamType::Number, true, 6.0, ""});
    c.schema.push_back(ParamSpec{"x", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"y", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"z", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      // A counterbore narrower than its own through-hole is not a counterbore.
      return solidTarget(*d, ctx.selection()).ok && num(ctx, "diameter", 0.0) > 0.0 &&
             num(ctx, "cbore_diameter", 0.0) > num(ctx, "diameter", 0.0) &&
             num(ctx, "cbore_depth", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      std::vector<IrArg> args{IrArg::valueRef(t.value),
                              IrArg::num(num(ctx, "diameter", 6.0)),
                              IrArg::num(num(ctx, "cbore_diameter", 11.0)),
                              IrArg::num(num(ctx, "cbore_depth", 6.0)),
                              IrArg::num(num(ctx, "x", 0.0)),
                              IrArg::num(num(ctx, "y", 0.0)),
                              IrArg::num(num(ctx, "z", 0.0))};
      emit(ctx, *d, *s, "part.counterbore", "Counterbore Hole", "CBORE", std::move(args),
           IrValueKind::Solid, {}, t.node);
    };
    add(std::move(c));
  }

  // ── FILLET ────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.fillet", "Edge Fillet", "FILLET",
                               SelectionSignature::atLeast(EntityKind::Edge, 1));
    c.schema.push_back(ParamSpec{"radius", ParamType::Number, true, 1.0, ""});
    c.schema.push_back(ParamSpec{"selector", ParamType::Text, false, 0.0, "ALL"});
    c.preview = PreviewPolicy::Live;
    c.enabled = [d](const CommandContext& ctx) {
      return solidTarget(*d, ctx.selection()).ok && num(ctx, "radius", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      const std::string sel = txt(ctx, "selector", "ALL");
      std::vector<IrArg> args{IrArg::valueRef(t.value), IrArg::num(num(ctx, "radius", 1.0))};
      // ALL|VERTICAL|RIM|CONVEX are bare keywords; anything else is a quoted
      // face/edge selector resolved against the live inventory at compile time.
      args.push_back(sel == "ALL" || sel == "VERTICAL" || sel == "RIM" || sel == "CONVEX"
                         ? IrArg::keyword(sel)
                         : IrArg::text(sel));
      emit(ctx, *d, *s, "part.fillet", "Edge Fillet", "FILLET", std::move(args), IrValueKind::Solid,
           {}, t.node);
    };
    add(std::move(c));
  }

  // ── CHAMFER ───────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.chamfer", "Edge Chamfer", "CHAMFER",
                               SelectionSignature::atLeast(EntityKind::Edge, 1));
    c.schema.push_back(ParamSpec{"distance", ParamType::Number, true, 1.0, ""});
    c.schema.push_back(ParamSpec{"selector", ParamType::Text, false, 0.0, "ALL"});
    c.preview = PreviewPolicy::Live;
    c.enabled = [d](const CommandContext& ctx) {
      return solidTarget(*d, ctx.selection()).ok && num(ctx, "distance", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      const std::string sel = txt(ctx, "selector", "ALL");
      std::vector<IrArg> args{IrArg::valueRef(t.value), IrArg::num(num(ctx, "distance", 1.0))};
      args.push_back(sel == "ALL" || sel == "VERTICAL" || sel == "RIM" || sel == "CONVEX"
                         ? IrArg::keyword(sel)
                         : IrArg::text(sel));
      emit(ctx, *d, *s, "part.chamfer", "Edge Chamfer", "CHAMFER", std::move(args),
           IrValueKind::Solid, {}, t.node);
    };
    add(std::move(c));
  }

  // ── VARIABLE FILLET ───────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.variable_fillet", "Variable Fillet", "BLEND",
                               SelectionSignature::atLeast(EntityKind::Edge, 1));
    c.schema.push_back(ParamSpec{"radius_start", ParamType::Number, true, 1.0, ""});
    c.schema.push_back(ParamSpec{"radius_end", ParamType::Number, true, 3.0, ""});
    c.schema.push_back(ParamSpec{"smooth", ParamType::Flag, false, 0.0, ""});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      return solidTarget(*d, ctx.selection()).ok && num(ctx, "radius_start", 0.0) > 0.0 &&
             num(ctx, "radius_end", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      std::vector<IrArg> args{IrArg::valueRef(t.value),
                              IrArg::num(num(ctx, "radius_start", 1.0)),
                              IrArg::num(num(ctx, "radius_end", 3.0))};
      // BLEND's args are positional: SMOOTH cannot be reached without naming the
      // selector slot before it.
      if (flagOn(ctx, "smooth")) {
        args.push_back(IrArg::keyword("ALL"));
        args.push_back(IrArg::keyword("SMOOTH"));
      }
      emit(ctx, *d, *s, "part.variable_fillet", "Variable Fillet", "BLEND", std::move(args),
           IrValueKind::Solid, {}, t.node);
    };
    add(std::move(c));
  }

  // ── SHELL ─────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.shell", "Shell Body", "SHELL",
                               SelectionSignature::atLeast(EntityKind::Face, 1));
    c.schema.push_back(ParamSpec{"thickness", ParamType::Number, true, 2.0, ""});
    c.schema.push_back(ParamSpec{"open_axx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"open_axy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"open_axz", ParamType::Number, false, -1.0, ""});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      return solidTarget(*d, ctx.selection()).ok && num(ctx, "thickness", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      std::vector<IrArg> args{IrArg::valueRef(t.value), IrArg::num(num(ctx, "thickness", 2.0))};
      if (hasNumber(ctx, "open_axx") || hasNumber(ctx, "open_axy") ||
          hasNumber(ctx, "open_axz")) {
        args.push_back(IrArg::num(num(ctx, "open_axx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "open_axy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "open_axz", -1.0)));
      }
      emit(ctx, *d, *s, "part.shell", "Shell Body", "SHELL", std::move(args), IrValueKind::Solid, {},
           t.node);
    };
    add(std::move(c));
  }

  // ── LINEAR PATTERN ────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.pattern_linear", "Linear Pattern", "PATTERN",
                               SelectionSignature::exactly(EntityKind::Body, 1));
    c.schema.push_back(ParamSpec{"count", ParamType::Number, true, 2.0, ""});
    c.schema.push_back(ParamSpec{"dx", ParamType::Number, true, 10.0, ""});
    c.schema.push_back(ParamSpec{"dy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"dz", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      const double n = num(ctx, "count", 0.0);
      // A one-instance pattern is a no-op feature, and a fractional count is not
      // a count: both are refused rather than emitted and left to the kernel.
      return solidTarget(*d, ctx.selection()).ok && n >= 2.0 && wholeCount(n);
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      std::vector<IrArg> args{IrArg::valueRef(t.value), IrArg::keyword("LINEAR"),
                              IrArg::num(num(ctx, "count", 2.0)),
                              IrArg::num(num(ctx, "dx", 10.0))};
      if (hasNumber(ctx, "dy") || hasNumber(ctx, "dz")) {
        args.push_back(IrArg::num(num(ctx, "dy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "dz", 0.0)));
      }
      emit(ctx, *d, *s, "part.pattern_linear", "Linear Pattern", "PATTERN", std::move(args),
           IrValueKind::Solid, {}, t.node);
    };
    add(std::move(c));
  }

  // ── CIRCULAR PATTERN ──────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.pattern_circular", "Circular Pattern", "PATTERN",
                               SelectionSignature::exactly(EntityKind::Body, 1));
    c.schema.push_back(ParamSpec{"count", ParamType::Number, true, 4.0, ""});
    c.schema.push_back(ParamSpec{"total_angle", ParamType::Number, false, 360.0, ""});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      const double n = num(ctx, "count", 0.0);
      const double a = num(ctx, "total_angle", 360.0);
      return solidTarget(*d, ctx.selection()).ok && n >= 2.0 && wholeCount(n) && a > 0.0 &&
             a <= 360.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      std::vector<IrArg> args{IrArg::valueRef(t.value), IrArg::keyword("POLAR"),
                              IrArg::num(num(ctx, "count", 4.0)),
                              IrArg::num(num(ctx, "total_angle", 360.0))};
      emit(ctx, *d, *s, "part.pattern_circular", "Circular Pattern", "PATTERN", std::move(args),
           IrValueKind::Solid, {}, t.node);
    };
    add(std::move(c));
  }

  // ── GRID PATTERN ──────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.pattern_grid", "Grid Pattern", "PATTERN",
                               SelectionSignature::exactly(EntityKind::Body, 1));
    c.schema.push_back(ParamSpec{"nx", ParamType::Number, true, 2.0, ""});
    c.schema.push_back(ParamSpec{"ny", ParamType::Number, true, 2.0, ""});
    c.schema.push_back(ParamSpec{"dx", ParamType::Number, true, 10.0, ""});
    c.schema.push_back(ParamSpec{"dy", ParamType::Number, true, 10.0, ""});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      const double nx = num(ctx, "nx", 0.0);
      const double ny = num(ctx, "ny", 0.0);
      return solidTarget(*d, ctx.selection()).ok && nx >= 1.0 && ny >= 1.0 &&
             wholeCount(nx) && wholeCount(ny) && nx * ny >= 2.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      std::vector<IrArg> args{IrArg::valueRef(t.value),   IrArg::keyword("GRID"),
                              IrArg::num(num(ctx, "nx", 2.0)), IrArg::num(num(ctx, "ny", 2.0)),
                              IrArg::num(num(ctx, "dx", 10.0)), IrArg::num(num(ctx, "dy", 10.0))};
      emit(ctx, *d, *s, "part.pattern_grid", "Grid Pattern", "PATTERN", std::move(args),
           IrValueKind::Solid, {}, t.node);
    };
    add(std::move(c));
  }

  // ── MIRROR ────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.mirror", "Mirror Body", "MIRROR",
                               SelectionSignature::exactly(EntityKind::Body, 1));
    c.schema.push_back(ParamSpec{"plane", ParamType::Text, true, 0.0, "XY"});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      const std::string p = txt(ctx, "plane", "");
      // MIRROR's keyword form accepts exactly these three principal planes.
      return solidTarget(*d, ctx.selection()).ok && (p == "XY" || p == "YZ" || p == "XZ");
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      std::vector<IrArg> args{IrArg::valueRef(t.value), IrArg::keyword(txt(ctx, "plane", "XY"))};
      emit(ctx, *d, *s, "part.mirror", "Mirror Body", "MIRROR", std::move(args), IrValueKind::Solid,
           {}, t.node);
    };
    add(std::move(c));
  }

  // ── BOOLEANS ──────────────────────────────────────────────────────────────
  // Selection ORDER is load-bearing for CUT: the first pick is the target, the
  // second is the tool. The tool body is consumed — its node stops resolving,
  // which is what stops a later command from filleting a body that no longer
  // exists.
  struct BoolSpec {
    const char* id;
    const char* label;
    const char* op;
  };
  const BoolSpec booleans[] = {
      {"part.boolean_union", "Union", "FUSE"},
      {"part.boolean_subtract", "Subtract", "CUT"},
      {"part.boolean_intersect", "Intersect", "COMMON"},
  };
  for (const BoolSpec& b : booleans) {
    CommandDescriptor c = base(b.id, b.label, b.op,
                               SelectionSignature::exactly(EntityKind::Body, 2));
    c.preview = PreviewPolicy::None;
    c.enabled = [d](const CommandContext& ctx) {
      return resolveValues(*d, ctx.selection(), IrValueKind::Solid).size() == 2;
    };
    const std::string id = b.id;
    const std::string label = b.label;
    const std::string op = b.op;
    c.execute = [d, s, id, label, op](CommandContext& ctx) {
      const std::vector<int> ids = resolveValues(*d, ctx.selection(), IrValueKind::Solid);
      if (!requireValues(ctx, ids, 2)) return;
      // front() below is safe ONLY because of the line above: resolveValues walks
      // the selection, so two distinct ids cannot come from an empty selection.
      const std::string targetNode = ctx.selection().selection().front().bodyId;
      std::string toolNode;
      for (const EntityRef& ref : ctx.selection().selection()) {
        if (ref.bodyId != targetNode) {
          toolNode = ref.bodyId;
          break;
        }
      }
      FeatureRecord rec;
      rec.irId = d->nextIrId();
      rec.commandId = id;
      rec.label = label;
      rec.line = IrLine{rec.irId, op, {IrArg::valueRef(ids[0]), IrArg::valueRef(ids[1])}};
      rec.produces = IrValueKind::Solid;
      if (!s->perform(*d, std::make_unique<AppendFeatureEdit>(
                              rec, std::vector<std::string>{toolNode}, targetNode))) {
        ctx.fail(std::string("the document refused the statement: ") + toString(d->lastCheck()));
      }
    };
    add(std::move(c));
  }

  // ── UNDO / REDO ───────────────────────────────────────────────────────────
  // Registered here, not in ForgeShell, because these drive THIS document's
  // stack. They are the only Part commands with no feature-IR op: they move the
  // program back and forth rather than extending it.
  {
    CommandDescriptor c = base("part.undo", "Undo", "", SelectionSignature::none());
    c.undo = UndoContract::NotUndoable;
    c.enabled = [s](const CommandContext&) { return s->undoDepth() > 0; };
    c.execute = [d, s](CommandContext&) { s->undo(*d); };
    add(std::move(c));
  }
  {
    CommandDescriptor c = base("part.redo", "Redo", "", SelectionSignature::none());
    c.undo = UndoContract::NotUndoable;
    c.enabled = [s](const CommandContext&) { return s->redoDepth() > 0; };
    c.execute = [d, s](CommandContext&) { s->redo(*d); };
    add(std::move(c));
  }

  return added;
}

const std::vector<std::string>& partCommandIds() {
  static const std::vector<std::string> ids = [] {
    std::vector<std::string> v{
        "part.boolean_intersect", "part.boolean_subtract", "part.boolean_union",
        "part.chamfer",           "part.counterbore",      "part.extrude",
        "part.fillet",            "part.hole",             "part.loft",
        "part.mirror",            "part.pattern_circular", "part.pattern_grid",
        "part.pattern_linear",    "part.redo",             "part.revolve",
        "part.shell",             "part.undo",             "part.variable_fillet",
    };
    std::sort(v.begin(), v.end());
    return v;
  }();
  return ids;
}

}  // namespace forge::ui
