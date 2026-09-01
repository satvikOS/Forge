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
    case IrValueKind::Surface: return "surface";
  }
  return "none";
}

const char* toString(EditCheck check) noexcept {
  switch (check) {
    case EditCheck::Ok:               return "ok";
    case EditCheck::NoSuchFeature:    return "no_such_feature";
    case EditCheck::OperandChanged:   return "operand_changed";
    case EditCheck::NoChange:         return "no_change";
    case EditCheck::InvalidStatement: return "invalid_statement";
  }
  return "no_such_feature";
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

std::string PartDocument::nodeFor(int irId) const {
  for (const auto& entry : bindings_) {
    if (entry.second == irId) return entry.first;
  }
  return std::string();
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

const FeatureRecord* PartDocument::featureAt(int irId) const noexcept {
  if (irId <= 0 || static_cast<std::size_t>(irId) > records_.size()) return nullptr;
  return &records_[static_cast<std::size_t>(irId) - 1];
}

bool PartDocument::editFeatureArgs(int irId, const std::vector<IrArg>& args) {
  lastEdit_ = EditCheck::Ok;
  if (irId <= 0 || static_cast<std::size_t>(irId) > records_.size()) {
    lastEdit_ = EditCheck::NoSuchFeature;
    return false;
  }
  FeatureRecord& rec = records_[static_cast<std::size_t>(irId) - 1];

  // THE INVARIANT: the set of (position, ref) pairs is identical. Comparing the
  // pairs rather than walking both lists in lockstep is what lets the arg COUNT
  // change -- dropping a trailing keyword must stay legal -- while still making
  // "%4 became %2" and "the ref moved from slot 0 to slot 1" both refusals.
  const auto refPairs = [](const std::vector<IrArg>& v) {
    std::vector<std::pair<std::size_t, int>> out;
    for (std::size_t i = 0; i < v.size(); ++i) {
      if (v[i].kind == IrArgKind::Ref) out.push_back({i, v[i].ref});
    }
    return out;
  };
  if (refPairs(args) != refPairs(rec.line.args)) {
    lastEdit_ = EditCheck::OperandChanged;
    return false;
  }

  // A no-op edit is refused rather than applied, so `perform()` never pushes an
  // undo step that undoes nothing -- a stack whose top entry does nothing when
  // you hit Ctrl+Z reads to a user as a broken undo.
  const IrLine candidate{rec.line.id, rec.line.op, args};
  if (candidate.text() == rec.line.text()) {
    lastEdit_ = EditCheck::NoChange;
    return false;
  }

  // The op table is the authority on arity, and it is DATA transcribed from
  // FeatureTree.hpp -- so this is reachable, not decoration: an edit that hands
  // FILLET six arguments is refused here and not by the compiler three layers
  // down, with the offending document unmutated.
  const IrCheck check = validateIr(candidate);
  lastCheck_ = check;
  if (check != IrCheck::Ok) {
    lastEdit_ = EditCheck::InvalidStatement;
    return false;
  }

  rec.line = candidate;  // no binding, no id and no produces-kind moved
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

// ── EditFeatureArgsEdit (GoF ConcreteCommand, self-inverse) ─────────────────
EditFeatureArgsEdit::EditFeatureArgsEdit(int irId, std::vector<IrArg> args, std::string label)
    : irId_(irId), after_(std::move(args)), label_(std::move(label)) {}

bool EditFeatureArgsEdit::apply(PartDocument& doc) {
  const FeatureRecord* rec = doc.featureAt(irId_);
  if (rec == nullptr) return false;
  // Captured on EVERY apply, not only the first, because redo runs apply()
  // again: a `before_` frozen at construction would, after undo-redo-undo,
  // restore an argument list the document no longer had.
  before_ = rec->line.args;
  return doc.editFeatureArgs(irId_, after_);
}

void EditFeatureArgsEdit::revert(PartDocument& doc) {
  // revert() returns void by the UndoableEdit contract, so a refusal here would
  // be unhearable -- which is exactly why apply() had to succeed first: the
  // arguments being put back are the ones the document itself held, so they pass
  // the same ref-pinning and validateIr checks the forward edit passed, and they
  // differ (or editFeatureArgs would have answered NoChange and apply() would
  // have returned false, so this edit would never have been pushed).
  doc.editFeatureArgs(irId_, before_);
}

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

// Profiles get their own node prefix so a selection can tell a sketch from a solid:
// resolveValues() maps EntityRef::bodyId -> valueFor() -> kindOf(), and a created
// PROFILE has to be addressable by the same route a seeded one is.
std::string sketchNodeFor(int irId) { return "sketch_" + std::to_string(irId); }

// And WIRE sections get a third prefix, for the same reason PROFILE got a second: a
// selection has to be able to tell a 3D loft section from a Z=0 sketch, because LOFT
// consumes the one and EXTRUDE the other and the kernel throws on the swap.
std::string wireNodeFor(int irId) { return "wire_" + std::to_string(irId); }

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

// ── which NUMBER of which statement an edit names ───────────────────────────
// `feature` is a 1-based statement id, and 0 means THE LAST STATEMENT -- the
// feature you just made, which is the one a bare "edit parameters" means in
// every history modeller. `index` counts only the NUMBER arguments, so index 0
// of `CYL(6, 40, 0, 0, -10)` is the radius and index 0 of
// `FILLET(%4, 3, VERTICAL)` is the radius too: the caller never has to know that
// one statement leads with a `%ref` and the other does not.
//
// ONE resolver, used by `enabled` AND by `execute`, so a greyed-out menu item
// and the dispatcher can never disagree about whether a parameter exists.
struct ParamTarget {
  bool ok = false;
  int irId = 0;
  std::size_t argIndex = 0;
};

ParamTarget paramTarget(const PartDocument& doc, const CommandContext& ctx) {
  ParamTarget t;
  const std::vector<FeatureRecord>& recs = doc.records();
  if (recs.empty()) return t;

  const double feature = num(ctx, "feature", 0.0);
  if (!wholeCount(feature)) return t;
  int irId = static_cast<int>(feature);
  if (irId == 0) irId = static_cast<int>(recs.size());
  if (irId < 1 || static_cast<std::size_t>(irId) > recs.size()) return t;

  const double index = num(ctx, "index", 0.0);
  if (!wholeCount(index) || index < 0.0) return t;

  const std::vector<IrArg>& args = recs[static_cast<std::size_t>(irId) - 1].line.args;
  std::size_t numbersSeen = 0;
  for (std::size_t i = 0; i < args.size(); ++i) {
    if (args[i].kind != IrArgKind::Number) continue;
    if (numbersSeen == static_cast<std::size_t>(index)) {
      t.ok = true;
      t.irId = irId;
      t.argIndex = i;
      return t;
    }
    ++numbersSeen;
  }
  return t;  // that statement has no such numeric parameter: not editable
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

  // ── RECTANGLE ─────────────────────────────────────────────────────────────
  // The FIRST value-CREATING command in this registry, and the reason it exists is a
  // measured closure gap rather than a feature request. archie_op_vocabulary.json
  // computes `value_kind_closure.gaps` about itself and reports that PROFILE is consumed
  // by EXTRUDE and REVOLVE while NO user-invocable op produces one -- every one of the 14
  // allowed ops takes a value reference first, and the only kind any of them produces is
  // SOLID. From an empty document no legal program existed: the constraint "emit only what
  // a user can invoke" described an EMPTY LANGUAGE.
  //
  // One profile producer closes it. Seeding RECT alone and driving the existing commands
  // yields RECT -> EXTRUDE -> FUSE -> FILLET -> HOLE -> SHELL -> PATTERN, so this single
  // command makes the whole existing registry reachable from nothing.
  //
  // Takes NO selection (SelectionSignature::none()) because it consumes no value. That is
  // what makes it a creator, and it is the property the registry did not have.
  {
    CommandDescriptor c = base("part.sketch_rect", "Rectangle", "RECT",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "width", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 40.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "height", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 30.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      // A zero or negative side is not a rectangle; the kernel would refuse it and the
      // command must not offer itself as callable when it cannot succeed.
      return num(ctx, "width", 0.0) > 0.0 && num(ctx, "height", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      // The IrArg::num(num(ctx, ...)) calls are INLINE on purpose. The vocabulary
      // generator derives each emitted argument by parsing this lambda and matching
      // `num(ctx, "name", default)`; hoisting them into locals makes it see a bare `w`
      // and REFUSE with "unparsed numeric argument" rather than guess. Refusing is the
      // right behaviour, so the command is written the way the tool can read.
      std::vector<IrArg> args{IrArg::num(num(ctx, "width", 40.0)),
                              IrArg::num(num(ctx, "height", 30.0))};
      // RECT(w, h [, cx=0, cy=0]) -- emit the centre only when it is not the default, so
      // the emitted form matches what the vocabulary records as this command's minimal
      // argument count and Archie is not trained to pad every statement.
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
      }
      emit(ctx, *d, *s, "part.sketch_rect", "Rectangle", "RECT", std::move(args),
           IrValueKind::Profile, {}, sketchNodeFor(d->nextIrId()));
    };
    add(std::move(c));
  }

  // ── CIRCLE ────────────────────────────────────────────────────────────────
  // The second PROFILE producer. RECT alone makes the language non-empty; it does not
  // make it expressive -- every revolve, every round boss and every cylindrical part
  // starts from a circle, and with only RECT reachable none of them could be authored.
  {
    CommandDescriptor c = base("part.sketch_circle", "Circle", "CIRCLE",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "radius", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 10.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) { return num(ctx, "radius", 0.0) > 0.0; };
    c.execute = [d, s](CommandContext& ctx) {
      std::vector<IrArg> args{IrArg::num(num(ctx, "radius", 10.0))};
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
      }
      emit(ctx, *d, *s, "part.sketch_circle", "Circle", "CIRCLE", std::move(args),
           IrValueKind::Profile, {}, sketchNodeFor(d->nextIrId()));
    };
    add(std::move(c));
  }

  // ── ROUNDED RECTANGLE ─────────────────────────────────────────────────────
  // The third PROFILE producer, and the first of the ten commands added to make the
  // KERNEL'S OWN PRIMITIVES reachable. The measured motivation, not a feature request:
  // across 600 held-out Archie emissions, 95.6% of the op uses the policy gate refuses
  // are REAL KERNEL OPS forbidden only because "no command in the forge::ui registry
  // emits it". `RRECT` is one of them, and it is the profile every bracket, cover plate
  // and gasket in the corpus starts from -- a rectangle with a sharp corner is the
  // exception in mechanical parts, not the rule.
  //
  // The kernel CLAMPS rather than refuses: profRRect computes
  // `rr = max(0.1, min(r, min(hw, hh) - 0.1))`, so RRECT(40, 30, 40) is RECORDED as a
  // 40 mm corner and BUILT as a 14.9 mm one. That is worse than a throw for a UI --
  // the statement in the history would say one thing and the solid be another -- so
  // the predicate refuses everything the clamp would touch, exactly as part.section_ring
  // refuses the p/seg values RING silently clamps.
  //
  // MEASURED through the pinned native verifier (forge::ft::compileText, the same
  // compiler the app links): `RRECT(40, 30, 5); EXTRUDE(%1, 10)` -> volume 11785.3982,
  // which is (40*30 - (4 - pi)*5^2) * 10 = 11785.3982 to ten significant figures, with
  // bbox 40 x 30 x 10 and genus 0. The centred form `RRECT(40, 30, 5, 3, 4)` moves the
  // bbox to [-17,-11,0]..[23,19,10] and leaves the volume unchanged -- so cx/cy are a
  // translation and not a size, which is the argument-order confusion this check exists
  // to rule out.
  {
    CommandDescriptor c = base("part.sketch_rounded_rect", "Rounded Rectangle", "RRECT",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "width", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 40.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "height", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 30.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "corner_radius", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 5.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      const double w = num(ctx, "width", 0.0);
      const double h = num(ctx, "height", 0.0);
      const double r = num(ctx, "corner_radius", 0.0);
      // The last two terms are the CLAMP BOUNDARY written out: profRRect keeps
      // `min(hw, hh) - 0.1`, so `2r <= w - 0.2` and `2r <= h - 0.2` are exactly the
      // radii it would leave alone. They read as `unparsed_terms` in the vocabulary
      // because the extractor reads comparisons against a parameter or a literal, not
      // against an expression -- recorded as unread rather than silently dropped.
      return w > 0.0 && h > 0.0 && r >= 0.1 && 2.0 * r <= w - 0.2 && 2.0 * r <= h - 0.2;
    };
    c.execute = [d, s](CommandContext& ctx) {
      std::vector<IrArg> args{IrArg::num(num(ctx, "width", 40.0)),
                              IrArg::num(num(ctx, "height", 30.0)),
                              IrArg::num(num(ctx, "corner_radius", 5.0))};
      // RRECT(w, h, r [, cx=0, cy=0]) -- one all-or-nothing optional group, because the
      // tail is POSITIONAL: emitting cy without cx would put the y centre in the x slot.
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
      }
      emit(ctx, *d, *s, "part.sketch_rounded_rect", "Rounded Rectangle", "RRECT", std::move(args),
           IrValueKind::Profile, {}, sketchNodeFor(d->nextIrId()));
    };
    add(std::move(c));
  }

  // ── REGULAR POLYGON ───────────────────────────────────────────────────────
  // The fourth PROFILE producer. Hex and square stock, spanner flats, nut bodies and
  // every n-gon boss start here, and none of them was authorable: REGPOLY was in the
  // kernel and in forge::ui::irOpTable() and reachable from no command.
  //
  // ARGUMENT ORDER IS THE TRAP and it is inverted from how the command reads: the
  // kernel writes REGPOLY(r, n, ...) -- the RADIUS first and the side COUNT second --
  // and `r` is the CIRCUMRADIUS (vertex distance), not the across-flats size. profRegPoly
  // places vertex i at `(cx + r*cos(rot + 2*pi*i/n), cy + r*sin(...))`, so a hexagon
  // asked for r = 20 measures 40 across corners and 34.64 across flats.
  //
  // MEASURED: `REGPOLY(20, 6); EXTRUDE(%1, 10)` -> volume 10392.3048, which is the exact
  // n-gon area 0.5*6*20^2*sin(60 deg) = 1039.23048 times 10, with bbox
  // 40.000 x 34.641 x 10 -- the across-corners/across-flats pair above. Emitting the two
  // in the other order would have built a 6 mm-radius 20-gon and still compiled.
  {
    CommandDescriptor c = base("part.sketch_polygon", "Polygon", "REGPOLY",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "radius", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 20.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "sides", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 6.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"rotation", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      const double n = num(ctx, "sides", 0.0);
      // profRegPoly throws on n < 3, and it reads the count through
      // `static_cast<int>(num(op, 1))`, which TRUNCATES: 5.9 sides would be recorded as
      // 5.9 and built as 5. A count is a count only if it is whole -- the same rule the
      // three PATTERN commands already apply, for the same reason.
      return num(ctx, "radius", 0.0) > 0.0 && n >= 3.0 && wholeCount(n);
    };
    c.execute = [d, s](CommandContext& ctx) {
      // REGPOLY(r, n [, cx=0, cy=0, rotDeg=0]) -- radius FIRST. See the comment above.
      std::vector<IrArg> args{IrArg::num(num(ctx, "radius", 20.0)),
                              IrArg::num(num(ctx, "sides", 6.0))};
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy") || hasNumber(ctx, "rotation")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "rotation", 0.0)));
      }
      emit(ctx, *d, *s, "part.sketch_polygon", "Polygon", "REGPOLY", std::move(args),
           IrValueKind::Profile, {}, sketchNodeFor(d->nextIrId()));
    };
    add(std::move(c));
  }

  // ── SLOT IS DELIBERATELY ABSENT, AND THIS IS WHY ──────────────────────────
  // SLOT(len, wid [, cx, cy, angleDeg]) is the fifth profile the kernel implements and
  // it is the one command in this batch that is NOT being added, because the kernel
  // builds the wrong solid and a command that emits it would ship that silently.
  //
  // MEASURED through the pinned native verifier, four sizes, `SLOT(len, wid)` extruded
  // 10 mm and the area read back as volume/10:
  //     SLOT(40, 12)  area 222.9027   an obround is 449.0973   bbox x = -14.000..14.000
  //     SLOT(60, 10)  area 421.4602   an obround is 578.5398   bbox x = -25.000..25.000
  //     SLOT(30, 20)  area 114.1593   an obround is 514.1593   bbox x =  -5.000.. 5.000
  //     SLOT(100, 4)  area 371.4336   an obround is 396.5664   bbox x = -48.000..48.000
  // Every row is EXACTLY `|(len - wid)*wid - pi*(wid/2)^2|`, and every bbox is
  // +/-(len - wid)/2 rather than +/-len/2. Both semicircular end caps bow INWARD: the
  // shape is the straight section with a full circle's area REMOVED, not an obround with
  // it added. On the nominal case that is -50.4% of the volume the signature promises,
  // and the part is 28 mm long where the statement says 40.
  //
  // profSlot's own source is right -- `addArc(s, cR, tr, br)` from (l/2, r) to (l/2, -r)
  // about (l/2, 0) IS the outward cap -- so the defect is in how a 180-degree arc's
  // direction is resolved downstream, not in the op's argument order. The control says
  // the same: RRECT's arcs are 90 degrees and its area is exact to ten significant
  // figures through the same code path.
  //
  // Adding the command would have made a broken solid one click away and, worse, put
  // SLOT into Archie's training vocabulary as a shape it is not. It stays in
  // `forbidden_ops` until the arc is fixed and re-measured.

  // ── SECTION RING ──────────────────────────────────────────────────────────
  // The WIRE producer, and the second half of a two-part fix. WIRE was the last open
  // value-kind gap in `archie_op_vocabulary.json`: LOFT consumes it and nothing a user
  // could invoke produced one. But a producer ALONE would not have made LOFT reachable,
  // because `part.loft` was resolving PROFILE values -- the defect the vocabulary already
  // recorded as `command_feeds_the_wrong_value_kind`. The kernel settles which of the two
  // is wrong, and it is not ambiguous: FeatureTreeCompiler.cpp's opLoft() takes every
  // %ref through refWire(), which throws unless the value's kind is Val::Wire, and
  // Builder::kindOf() gives Val::Wire to exactly two ops -- Ring and Wire. MEASURED
  // through the native verifier (forge_verify -> forge::ft::compileText):
  //     RECT(40,40); CIRCLE(10); LOFT(%1,%2)   -> ok=false,
  //         "LOFT: %1 is not a WIRE section (use RING(...) or WIRE([...]))"
  //     RING(20,20,0); RING(10,10,30); LOFT(%1,%2) -> ok=true, volume 21928.4
  // So this is NOT the command being deliberately widened; it is a statement forge::ui
  // called well-formed and forge::ft refused. `part.loft` is corrected below.
  //
  // RING rather than WIRE because WIRE([x y z; ...]) needs a POINTS token, and FeatureIr.hpp
  // deliberately does not model IrArgKind::Points ("a token kind nothing produces is a
  // liability, not coverage"). RING is all numbers, so it emits through the existing
  // IrArg::num path -- and its `z` is the whole point: the Z=0 sketcher cannot express a
  // section at another height, which is what makes a loft a loft.
  //
  // Takes NO selection, like the other two creators: it consumes no value.
  {
    CommandDescriptor c = base("part.section_ring", "Section Ring", "RING",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "rx", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 20.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "ry", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 20.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "z", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 0.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"p", ParamType::Number, false, 2.0, ""});
    c.schema.push_back(ParamSpec{"seg", ParamType::Number, false, 48.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      // wireRing() throws on rx <= 0 or ry <= 0, so the command must not offer itself
      // as callable there. It also SILENTLY CLAMPS p to >= 2 and seg to >= 8, which is
      // worse than a throw for a UI: the statement would be recorded saying one thing
      // and the kernel would build another. Refuse those instead of emitting a lie.
      return num(ctx, "rx", 0.0) > 0.0 && num(ctx, "ry", 0.0) > 0.0 &&
             num(ctx, "p", 2.0) >= 2.0 && num(ctx, "seg", 48.0) >= 8.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      std::vector<IrArg> args{IrArg::num(num(ctx, "rx", 20.0)), IrArg::num(num(ctx, "ry", 20.0)),
                              IrArg::num(num(ctx, "z", 0.0))};
      // RING(rx, ry, z [, cx=0, cy=0, p=2, seg=48]) -- the four optional arguments are
      // POSITIONAL, so they are emitted as ONE group or not at all. Emitting `p` without
      // cx/cy would put the superellipse exponent in the cx slot: a statement the kernel
      // accepts and reads as a different ring.
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy") || hasNumber(ctx, "p") ||
          hasNumber(ctx, "seg")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "p", 2.0)));
        args.push_back(IrArg::num(num(ctx, "seg", 48.0)));
      }
      emit(ctx, *d, *s, "part.section_ring", "Section Ring", "RING", std::move(args),
           IrValueKind::Wire, {}, wireNodeFor(d->nextIrId()));
    };
    add(std::move(c));
  }

  // ── SOLID PRIMITIVES ──────────────────────────────────────────────────────
  // Seven commands, one per kernel primitive, and the reason they are here is the same
  // measured one that put RECT and CIRCLE here: the op existed, the kernel built it, and
  // NO USER COULD ASK FOR IT. `BOX` and `CYL` are the two most-used ops in the repo's own
  // feature-tree corpus (30 and 17 statements of 183) and both were in `forbidden_ops`.
  // The app SEEDS a BOX into every new document -- ForgeFrame's default part is one --
  // so the shipped product was showing the user a solid it gave them no way to author.
  //
  // Each one takes NO SELECTION, like the three creators above: a primitive consumes no
  // value, which is what makes it reachable from an empty document.
  //
  // TWO RULES HOLD FOR ALL SEVEN, and both are the difference between a command and a
  // silent wrong answer:
  //
  //   1. THE OPTIONAL TAIL IS ONE ALL-OR-NOTHING GROUP. Every kernel primitive reads its
  //      optional arguments POSITIONALLY through `numOpt(op, i, default)`, so emitting an
  //      axis without a centre would put `axx` in the `cx` slot: a statement the kernel
  //      accepts and reads as a completely different solid. The group is emitted whole or
  //      not at all, exactly as part.section_ring does for RING.
  //   2. THE PREDICATE REFUSES WHAT THE KERNEL THROWS ON. requirePositive() in
  //      Primitives.cpp raises on a zero or negative size; makeTorus refuses
  //      minor >= major ("self-intersecting otherwise"); makeTube refuses
  //      rInner >= rOuter; makePrism refuses n < 3. A command must not offer itself as
  //      callable where it cannot succeed, so each of those is a term below.
  //
  // ALL SEVEN WERE MEASURED through the pinned native verifier (forge::ft::compileText),
  // against closed form, in BOTH the minimal and the full-optional-group form. A VECTOR
  // of observables, never volume alone -- the divergence theorem gives a self-intersecting
  // shell the right volume, so volume agreeing proves nothing on its own:
  //
  //   BOX(40,30,20)          vol 24000.0000   want 24000.0000   6 faces  genus 0
  //                          bbox [-20,-15,0]..[20,15,20]  -- centred in XY, base at cz
  //   BOX(40,30,20,3,4,5)    vol 24000.0000   bbox [-17,-11,5]..[23,19,25]
  //   CYL(10,25)             vol  7853.9816   want pi*100*25 = 7853.9816   3 faces
  //                          bbox [-10,-10,0]..[10,10,25]
  //   CYL(10,25,0,0,0,1,0,0) vol  7853.9816   bbox [0,-10,-10]..[25,10,10]  -- re-aimed +X
  //   CONE(10,4,25)          vol  4084.0705   want pi*h/3*(r1^2+r1r2+r2^2) = 4084.0704
  //   CONE(10,0,25)          vol  2617.9939   want pi*r^2*h/3 = 2617.9939   2 faces (apex)
  //   SPHERE(10)             vol  4188.7902   want 4/3*pi*1000 = 4188.7902  1 face
  //   SPHERE(10,5,5,5)       vol  4188.7902   bbox [-5,-5,-5]..[15,15,15]  -- CENTRE, not base
  //   TORUS(30,8)            vol 37899.2809   want 2*pi^2*30*64 = 37899.2809  GENUS 1
  //                          bbox [-38,-38,-8]..[38,38,8]
  //   PRISM(6,15,20)         vol 11691.3430   want 0.5*6*15^2*sin(60 deg)*20 = 11691.3430
  //                          8 faces = 6 sides + 2 caps;  bbox 30.000 x 25.981 x 20
  //   TUBE(12,8,30)          vol  7539.8224   want pi*(144-64)*30 = 7539.8224  GENUS 1
  //                          4 faces;  bbox [-12,-12,0]..[12,12,30]
  //
  // The two genus-1 rows are the point of measuring a vector: a tube whose bore failed to
  // cut would have kept a plausible volume and reported genus 0.

  // ── BOX ───────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.primitive_box", "Box", "BOX",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "dx", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 40.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "dy", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 30.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "dz", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 20.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cz", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      // makeBox calls requirePositive on all three: a zero side is not a solid.
      return num(ctx, "dx", 0.0) > 0.0 && num(ctx, "dy", 0.0) > 0.0 &&
             num(ctx, "dz", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      // BOX(dx, dy, dz [, cx=0, cy=0, cz=0]) -- primBox centres the box in XY on (cx, cy)
      // and puts its BASE at cz, which is why the minimal form's bbox is
      // [-dx/2, -dy/2, 0]..[dx/2, dy/2, dz] and not a corner at the origin.
      std::vector<IrArg> args{IrArg::num(num(ctx, "dx", 40.0)), IrArg::num(num(ctx, "dy", 30.0)),
                              IrArg::num(num(ctx, "dz", 20.0))};
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy") || hasNumber(ctx, "cz")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cz", 0.0)));
      }
      emit(ctx, *d, *s, "part.primitive_box", "Box", "BOX", std::move(args), IrValueKind::Solid,
           {}, {});
    };
    add(std::move(c));
  }

  // ── CYLINDER ──────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.primitive_cylinder", "Cylinder", "CYL",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "radius", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 10.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "height", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 25.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cz", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axz", ParamType::Number, false, 1.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      // makeCylinder calls requirePositive on both. A zero-radius cylinder is not a solid.
      return num(ctx, "radius", 0.0) > 0.0 && num(ctx, "height", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      // CYL(r, h [, cx=0, cy=0, cz=0, axx=0, axy=0, axz=1]) -- SIX optional arguments in
      // ONE group. place() re-aims the +Z-based primitive onto (axx, axy, axz) and then
      // moves the base to (cx, cy, cz); a degenerate axis is re-defaulted to +Z there
      // rather than throwing, so the group's axz fallback of 1 is the honest default and
      // not a filler.
      std::vector<IrArg> args{IrArg::num(num(ctx, "radius", 10.0)),
                              IrArg::num(num(ctx, "height", 25.0))};
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy") || hasNumber(ctx, "cz") ||
          hasNumber(ctx, "axx") || hasNumber(ctx, "axy") || hasNumber(ctx, "axz")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cz", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axz", 1.0)));
      }
      emit(ctx, *d, *s, "part.primitive_cylinder", "Cylinder", "CYL", std::move(args),
           IrValueKind::Solid, {}, {});
    };
    add(std::move(c));
  }

  // ── CONE ──────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.primitive_cone", "Cone", "CONE",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "radius_base", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 10.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "radius_top", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "height", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 25.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cz", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axz", ParamType::Number, false, 1.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      // makeCone accepts a ZERO radius at one end -- that is the apex, and CONE(10, 0, 25)
      // is the ordinary cone -- but not at BOTH, because it shims equal radii to
      // makeCylinder, which then throws on requirePositive. The `||` term is what forbids
      // the double zero; it is recorded in the vocabulary as an unparsed term, because the
      // constraint extractor reads conjunctions of comparisons and not disjunctions.
      return (num(ctx, "radius_base", 0.0) > 0.0 || num(ctx, "radius_top", 0.0) > 0.0) &&
             num(ctx, "radius_base", 0.0) >= 0.0 && num(ctx, "radius_top", 0.0) >= 0.0 &&
             num(ctx, "height", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      // CONE(r1, r2, h [, cx, cy, cz, axx, axy, axz]) -- r1 is the BASE radius (at cz) and
      // r2 the TOP. Swapping them compiles and builds the cone upside down.
      std::vector<IrArg> args{IrArg::num(num(ctx, "radius_base", 10.0)),
                              IrArg::num(num(ctx, "radius_top", 0.0)),
                              IrArg::num(num(ctx, "height", 25.0))};
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy") || hasNumber(ctx, "cz") ||
          hasNumber(ctx, "axx") || hasNumber(ctx, "axy") || hasNumber(ctx, "axz")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cz", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axz", 1.0)));
      }
      emit(ctx, *d, *s, "part.primitive_cone", "Cone", "CONE", std::move(args),
           IrValueKind::Solid, {}, {});
    };
    add(std::move(c));
  }

  // ── SPHERE ────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.primitive_sphere", "Sphere", "SPHERE",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "radius", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 10.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cz", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) { return num(ctx, "radius", 0.0) > 0.0; };
    c.execute = [d, s](CommandContext& ctx) {
      // SPHERE(r [, cx=0, cy=0, cz=0]) -- primSphere TRANSLATES by (cx, cy, cz), so unlike
      // BOX and CYL the triple is the sphere's CENTRE and not a base point. MEASURED:
      // SPHERE(10, 5, 5, 5) has bbox [-5,-5,-5]..[15,15,15].
      std::vector<IrArg> args{IrArg::num(num(ctx, "radius", 10.0))};
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy") || hasNumber(ctx, "cz")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cz", 0.0)));
      }
      emit(ctx, *d, *s, "part.primitive_sphere", "Sphere", "SPHERE", std::move(args),
           IrValueKind::Solid, {}, {});
    };
    add(std::move(c));
  }

  // ── TORUS ─────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.primitive_torus", "Torus", "TORUS",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "major_radius", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 30.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "minor_radius", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 8.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cz", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axz", ParamType::Number, false, 1.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      // makeTorus: "torus.minorR must be < majorR (self-intersecting otherwise)". A
      // self-intersecting torus is the exact shape whose VOLUME still looks plausible, so
      // this term is refused here rather than left to be noticed downstream.
      return num(ctx, "major_radius", 0.0) > 0.0 && num(ctx, "minor_radius", 0.0) > 0.0 &&
             num(ctx, "minor_radius", 0.0) < num(ctx, "major_radius", 0.0);
    };
    c.execute = [d, s](CommandContext& ctx) {
      // TORUS(major, minor [, cx, cy, cz, axx, axy, axz]) -- MEASURED genus 1, which is
      // the observable a volume check would have missed.
      std::vector<IrArg> args{IrArg::num(num(ctx, "major_radius", 30.0)),
                              IrArg::num(num(ctx, "minor_radius", 8.0))};
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy") || hasNumber(ctx, "cz") ||
          hasNumber(ctx, "axx") || hasNumber(ctx, "axy") || hasNumber(ctx, "axz")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cz", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axz", 1.0)));
      }
      emit(ctx, *d, *s, "part.primitive_torus", "Torus", "TORUS", std::move(args),
           IrValueKind::Solid, {}, {});
    };
    add(std::move(c));
  }

  // ── PRISM ─────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.primitive_prism", "Prism", "PRISM",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "sides", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 6.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "radius", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 15.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "height", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 20.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cz", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      const double n = num(ctx, "sides", 0.0);
      // makePrism throws on n < 3, and primPrism reads the count through
      // `static_cast<int>(num(op, 0))`, which truncates 5.9 to 5 while the statement
      // records 5.9. Whole numbers only, for the same reason the PATTERN counts are.
      return n >= 3.0 && wholeCount(n) && num(ctx, "radius", 0.0) > 0.0 &&
             num(ctx, "height", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      // PRISM(nSides, circumR, h [, cx, cy, cz]) -- the COUNT is first here and the radius
      // second, the opposite order to REGPOLY(r, n) two commands up. That is the kernel's
      // spelling, not a choice; getting it backwards builds a 6-sided prism of radius 15
      // as a 15-sided prism of radius 6 and compiles cleanly.
      std::vector<IrArg> args{IrArg::num(num(ctx, "sides", 6.0)),
                              IrArg::num(num(ctx, "radius", 15.0)),
                              IrArg::num(num(ctx, "height", 20.0))};
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy") || hasNumber(ctx, "cz")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cz", 0.0)));
      }
      emit(ctx, *d, *s, "part.primitive_prism", "Prism", "PRISM", std::move(args),
           IrValueKind::Solid, {}, {});
    };
    add(std::move(c));
  }

  // ── TUBE ──────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.primitive_tube", "Tube", "TUBE",
                               SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "outer_radius", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 12.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "inner_radius", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 8.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "height", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 30.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"cx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"cz", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [](const CommandContext& ctx) {
      // makeTube: requirePositive on all three, and "tube.rInner must be < rOuter".
      return num(ctx, "outer_radius", 0.0) > 0.0 && num(ctx, "inner_radius", 0.0) > 0.0 &&
             num(ctx, "inner_radius", 0.0) < num(ctx, "outer_radius", 0.0) &&
             num(ctx, "height", 0.0) > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      // TUBE(rOuter, rInner, h [, cx, cy, cz]) -- MEASURED genus 1 and 4 faces, which is
      // what says the bore really was cut. Volume alone could not.
      std::vector<IrArg> args{IrArg::num(num(ctx, "outer_radius", 12.0)),
                              IrArg::num(num(ctx, "inner_radius", 8.0)),
                              IrArg::num(num(ctx, "height", 30.0))};
      if (hasNumber(ctx, "cx") || hasNumber(ctx, "cy") || hasNumber(ctx, "cz")) {
        args.push_back(IrArg::num(num(ctx, "cx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "cz", 0.0)));
      }
      emit(ctx, *d, *s, "part.primitive_tube", "Tube", "TUBE", std::move(args),
           IrValueKind::Solid, {}, {});
    };
    add(std::move(c));
  }

  // ── MOVE ──────────────────────────────────────────────────────────────────
  // TRANSLATE was ORPHAN, and that is more serious than one missing command: with no
  // way to POSITION a body, every boolean in this registry operated on solids coincident
  // at the origin. FUSE, CUT and COMMON were reachable but not USEFUL -- two boxes both
  // at the origin have nothing interesting to subtract. This is also the op class behind
  // the derived-placement sub-task this programme measured as the hardest thing Archie
  // has to learn, so leaving it unreachable made that failure permanent by construction.
  //
  // Like every other solid-editing command it keeps the body's IDENTITY: the node is
  // consumed and reproduced, so the body gains history rather than becoming a new body.
  {
    CommandDescriptor c = base("part.move", "Move Body", "TRANSLATE",
                               SelectionSignature::exactly(EntityKind::Body, 1));
    c.schema.push_back(ParamSpec{"dx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"dy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"dz", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [d](const CommandContext& ctx) {
      // A zero move is a no-op statement in the history; refuse it rather than record it.
      return solidTarget(*d, ctx.selection()).ok &&
             (num(ctx, "dx", 0.0) != 0.0 || num(ctx, "dy", 0.0) != 0.0 ||
              num(ctx, "dz", 0.0) != 0.0);
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      if (!t.ok) { ctx.fail("selection does not resolve to one solid"); return; }
      std::vector<IrArg> args{IrArg::valueRef(t.value), IrArg::num(num(ctx, "dx", 0.0)),
                              IrArg::num(num(ctx, "dy", 0.0)), IrArg::num(num(ctx, "dz", 0.0))};
      emit(ctx, *d, *s, "part.move", "Move Body", "TRANSLATE", std::move(args),
           IrValueKind::Solid, {t.node}, t.node);
    };
    add(std::move(c));
  }

  // ── ROTATE ────────────────────────────────────────────────────────────────
  // The second half of placement. part.move made TRANSLATE reachable and left ROTATE
  // orphaned, which is not a cosmetic gap: with only translation, every solid a user
  // could author was axis-aligned, so an angled boss, a canted rib and a rotated flange
  // were all unauthorable and the booleans could only ever meet at right angles. ROTATE
  // is also 231 of the refused op uses in the held-out emission sample -- the third most
  // used op that no command emitted.
  //
  // It follows part.move EXACTLY, because it is the same kind of thing: one solid in,
  // the SAME document node out. The body keeps its identity and gains history rather
  // than becoming a new body, which is what stops a later fillet from naming a body
  // that no longer exists.
  //
  // ARITY: ROTATE's first five arguments are REQUIRED (forge::ui::irOpTable() says
  // 5..8), so the axis triple is emitted unconditionally -- it is not an optional tail
  // like CYL's. Only the pivot (ox, oy, oz) is a group, and it is all-or-nothing for the
  // usual positional reason.
  //
  // MEASURED through the pinned native verifier, and the observable that matters here is
  // the BBOX, not the volume -- a rigid motion cannot change the volume, so volume alone
  // could not tell a correct rotation from no rotation at all:
  //   BOX(20,10,4); ROTATE(%1, 90, 0, 1, 0)              vol 800.0000 (unchanged, as a
  //       rigid motion must be), bbox [0,-5,-10]..[4,5,10] -- the 20 mm X extent became
  //       the Z extent and the 4 mm Z extent became X: a real quarter turn about +Y.
  //   BOX(20,10,4); ROTATE(%1, 90, 0, 0, 1, 10, 0, 0)    vol 800.0000,
  //       bbox [5,-20,0]..[15,0,4] -- turned about the LINE x=10 rather than the origin,
  //       which is what the optional pivot is for and what its absence would hide.
  {
    CommandDescriptor c = base("part.rotate", "Rotate Body", "ROTATE",
                               SelectionSignature::exactly(EntityKind::Body, 1));
    // hasDefault, so a keyboard gesture can invoke it: see part.extrude. A quarter turn
    // about +Z is the honest default -- it is the move a user means by "rotate this".
    c.schema.push_back(ParamSpec{.name = "angle", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 90.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"axx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axz", ParamType::Number, false, 1.0, ""});
    c.schema.push_back(ParamSpec{"ox", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"oy", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"oz", ParamType::Number, false, 0.0, ""});
    c.preview = PreviewPolicy::Live;
    c.enabled = [d](const CommandContext& ctx) {
      const double ax = num(ctx, "axx", 0.0);
      const double ay = num(ctx, "axy", 0.0);
      const double az = num(ctx, "axz", 1.0);
      // A zero rotation is a no-op statement in the history -- refused rather than
      // recorded, exactly as part.move refuses a zero move. A zero AXIS is worse: unlike
      // place(), which re-defaults a degenerate axis to +Z, opRotate hands (ax, ay, az)
      // straight to forge::rotate, which throws "zero axis" on the native path and builds
      // a gp_Dir from a null vector on the OCCT one. The magnitude term reads as an
      // unparsed term in the vocabulary -- the extractor reads comparisons against a
      // parameter or a literal, and this one is against an expression.
      return solidTarget(*d, ctx.selection()).ok && num(ctx, "angle", 0.0) != 0.0 &&
             ax * ax + ay * ay + az * az > 0.0;
    };
    c.execute = [d, s](CommandContext& ctx) {
      const SolidTarget t = solidTarget(*d, ctx.selection());
      if (!t.ok) { ctx.fail("selection does not resolve to one solid"); return; }
      // ROTATE(%a, angleDeg, axx, axy, axz [, ox=0, oy=0, oz=0])
      std::vector<IrArg> args{IrArg::valueRef(t.value), IrArg::num(num(ctx, "angle", 90.0)),
                              IrArg::num(num(ctx, "axx", 0.0)), IrArg::num(num(ctx, "axy", 0.0)),
                              IrArg::num(num(ctx, "axz", 1.0))};
      if (hasNumber(ctx, "ox") || hasNumber(ctx, "oy") || hasNumber(ctx, "oz")) {
        args.push_back(IrArg::num(num(ctx, "ox", 0.0)));
        args.push_back(IrArg::num(num(ctx, "oy", 0.0)));
        args.push_back(IrArg::num(num(ctx, "oz", 0.0)));
      }
      emit(ctx, *d, *s, "part.rotate", "Rotate Body", "ROTATE", std::move(args),
           IrValueKind::Solid, {t.node}, t.node);
    };
    add(std::move(c));
  }

  // ── EXTRUDE ───────────────────────────────────────────────────────────────
  {
    CommandDescriptor c = base("part.extrude", "Extrude", "EXTRUDE",
                               SelectionSignature::exactly(EntityKind::Sketch, 1));
    // hasDefault, so a GESTURE can run this command. ForgeShell::invoke() fills
    // only the parameters whose spec says the default MEANS something, and the
    // braced-positional ParamSpec form stops before that flag, so a required
    // parameter written that way defaulted to hasDefault=false and every
    // keyboard shortcut and menu click for it died on missing_required_parameter
    // before the handler ran. distance 10 / radius 1 / thickness 2 are the
    // honest defaults the retired ForgeShell model.* stubs already declared and
    // shipped, moved onto the commands that emit IR.
    //
    // THIS WAS FIXED HERE FIRST AND ONLY HERE, and the other twenty-two required
    // parameters kept the defect: measured against the registry, 23 required
    // parameters across 13 of the 31 commands still had a usable value sitting
    // in defaultNumber that applyDefaults() was forbidden to read. They are now
    // all written in the designated form with hasDefault set, and
    // forge::ui::gestureBlockedCommands() (KeymapAudit.hpp) is the standing
    // measurement -- it reports every command a bare gesture still cannot run,
    // and ui/test/keymap_audit_test.cpp pins that list to the two commands whose
    // parameter genuinely has no honest value: a file path, and "the new value
    // of the parameter you are editing".
    c.schema.push_back(ParamSpec{.name = "distance",
                                 .type = ParamType::Number,
                                 .required = true,
                                 .defaultNumber = 10.0,
                                 .hasDefault = true});
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
    c.schema.push_back(ParamSpec{.name = "angle", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 360.0,
                                 .hasDefault = true});
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
  // This command used to resolve PROFILE and emit LOFT(%sketch, %sketch). That statement
  // passes validateIr() and is REFUSED BY THE KERNEL: opLoft() reads every %ref through
  // refWire(), which throws "%N is not a WIRE section (use RING(...) or WIRE([...]))"
  // unless Builder::kindOf() made the value Val::Wire -- and only Ring and Wire do.
  // Reproduced through forge_verify on the real compiler (see part.section_ring above):
  // the profile form fails at op %3, the ring form builds a solid. So the value kind is
  // corrected here to the one the kernel documents and enforces, and part.section_ring
  // supplies the sections. Fixing one without the other leaves LOFT unreachable either
  // way -- a wrong-kind command with a producer, or a right-kind command with nothing
  // to select.
  {
    CommandDescriptor c = base("part.loft", "Loft", "LOFT",
                               SelectionSignature::atLeast(EntityKind::Wire, 2));
    c.schema.push_back(ParamSpec{"ruled", ParamType::Flag, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"open", ParamType::Flag, false, 0.0, ""});
    c.preview = PreviewPolicy::OnDemand;
    c.enabled = [d](const CommandContext& ctx) {
      return resolveValues(*d, ctx.selection(), IrValueKind::Wire).size() >= 2;
    };
    c.execute = [d, s](CommandContext& ctx) {
      std::vector<IrArg> args;
      for (int section : resolveValues(*d, ctx.selection(), IrValueKind::Wire)) {
        args.push_back(IrArg::valueRef(section));
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
    c.schema.push_back(ParamSpec{.name = "diameter", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 6.0,
                                 .hasDefault = true});
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
    c.schema.push_back(ParamSpec{.name = "diameter", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 6.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "cbore_diameter", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 11.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "cbore_depth", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 6.0,
                                 .hasDefault = true});
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
    // hasDefault: see part.extrude above -- 1 mm is the fillet radius the retired
    // model.fillet stub declared, and it is what makes R / Ctrl+B run.
    c.schema.push_back(ParamSpec{.name = "radius",
                                 .type = ParamType::Number,
                                 .required = true,
                                 .defaultNumber = 1.0,
                                 .hasDefault = true});
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
    c.schema.push_back(ParamSpec{.name = "distance", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 1.0,
                                 .hasDefault = true});
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
    c.schema.push_back(ParamSpec{.name = "radius_start", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 1.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "radius_end", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 3.0,
                                 .hasDefault = true});
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
    // hasDefault: see part.extrude above -- 2 mm is the wall the retired
    // model.shell stub declared, and it is what makes Ctrl+Shift+H run.
    c.schema.push_back(ParamSpec{.name = "thickness",
                                 .type = ParamType::Number,
                                 .required = true,
                                 .defaultNumber = 2.0,
                                 .hasDefault = true});
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
    c.schema.push_back(ParamSpec{.name = "count", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 2.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "dx", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 10.0,
                                 .hasDefault = true});
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
    c.schema.push_back(ParamSpec{.name = "count", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 4.0,
                                 .hasDefault = true});
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
    c.schema.push_back(ParamSpec{.name = "nx", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 2.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "ny", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 2.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "dx", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 10.0,
                                 .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "dy", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 10.0,
                                 .hasDefault = true});
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
    c.schema.push_back(ParamSpec{.name = "plane", .type = ParamType::Text,
                                 .required = true, .defaultText = "XY",
                                 .hasDefault = true});
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

  // ── UNDO / REDO ARE NOT REGISTERED HERE ───────────────────────────────────
  // There used to be `part.undo` and `part.redo` in this list, driving the very
  // stack `s` points at. They were registered here when ForgeShell's own
  // `edit.undo` was a counter stub (`--doc_.undoDepth; ++doc_.redoDepth; ...`)
  // that touched no document at all.
  //
  // ForgeShell::DocumentHost closed that: `edit.undo` now calls
  // documentUndo() on whoever owns the document, and in the application that is
  // ForgeFrame, whose documentUndo() runs THIS UndoStack and then re-tessellates.
  // So the registry held TWO Undo commands over ONE stack -- two menu entries
  // both labelled "Undo", only one of them carrying Ctrl+Z, and only one of them
  // driving the viewport rebuild. One undo stack means one Undo command, and the
  // one that survives is the one the keyboard, the status strip and the geometry
  // already go through.
  //
  // The caretaker itself is unchanged and still public: UndoStack::undo/redo are
  // what documentUndo()/documentRedo() call.
  // ── EDIT FEATURE PARAMETER ────────────────────────────────────────────────
  // The command that makes the document PARAMETRIC. Every other Part command
  // appends; appendFeature() refuses anything not numbered nextIrId(), so before
  // this the only way to change the plate from 80 x 50 to 120 x 50 was to build
  // a new document. Worse, the app's starting part is five SEEDED statements, so
  // undo could not reach them at all -- the bore diameter of the part the user
  // opens on was unreachable by any user action.
  //
  // Takes NO selection: a feature is named by its statement id, which is what
  // the feature tree, a macro, a .fpart and Archie all already have. Requiring a
  // viewport pick would make the tree row -- the thing a user actually clicks to
  // edit a feature -- the one place that could not invoke it.
  //
  // `featureIrOp` is empty for the same reason part.undo's is: it emits no new
  // statement, it rewrites one that is already there.
  {
    CommandDescriptor c = base("part.edit_feature", "Edit Feature Parameter", "",
                               SelectionSignature::none());
    // `feature` and `index` HAVE honest defaults (the last statement, its first
    // number) so a bare invocation is meaningful. `value` has none: there is no
    // default new value for a parameter, and inventing one would let a menu click
    // silently resize the part.
    c.schema.push_back(ParamSpec{.name = "feature", .type = ParamType::Number,
                                 .required = false, .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "index", .type = ParamType::Number,
                                 .required = false, .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "value", .type = ParamType::Number,
                                 .required = true, .defaultNumber = 0.0, .hasDefault = false});
    c.preview = PreviewPolicy::Live;
    // STRUCTURE only, never the value. "Is there a number here to edit?" is the
    // question a greyed menu item answers; "does 0 make a solid?" is the
    // modeller's, and answering it here would grey out a legal keystroke.
    c.enabled = [d](const CommandContext& ctx) { return paramTarget(*d, ctx).ok; };
    c.execute = [d, s](CommandContext& ctx) {
      const ParamTarget t = paramTarget(*d, ctx);
      const FeatureRecord* rec = t.ok ? d->featureAt(t.irId) : nullptr;
      if (rec == nullptr) {
        ctx.fail("no numeric parameter at that feature/index");
        return;
      }
      std::vector<IrArg> args = rec->line.args;
      args[t.argIndex] = IrArg::num(num(ctx, "value", 0.0));
      std::string label = "Edit " + (rec->label.empty() ? rec->line.op : rec->label);
      if (!s->perform(*d, std::make_unique<EditFeatureArgsEdit>(t.irId, std::move(args),
                                                               std::move(label)))) {
        ctx.fail(std::string("the document refused the edit: ") + toString(d->lastEdit()));
      }
    };
    add(std::move(c));
  }

  // ── UNDO / REDO ARE NOT REGISTERED HERE ───────────────────────────────────
  // There used to be `part.undo` and `part.redo` beside `edit.undo` / `edit.redo`,
  // two pairs of buttons driving ONE stack. Whichever a user pressed, the other
  // pair's enabled state was still computed from the same depth, so the UI showed
  // two controls for one piece of state and a keystroke bound to the "wrong" pair
  // silently worked. One undo stack means one Undo command. They were also the
  // only Part commands with no feature-IR op, which is why removing them makes
  // "every registered Part command emits an IR op" literally true.

  return added;
}

const std::vector<std::string>& partCommandIds() {
  static const std::vector<std::string> ids = [] {
    std::vector<std::string> v{
        "part.boolean_intersect",  "part.boolean_subtract",   "part.boolean_union",
        "part.chamfer",            "part.counterbore",        "part.edit_feature",
        "part.extrude",            "part.fillet",             "part.hole",
        "part.loft",               "part.mirror",             "part.move",
        "part.pattern_circular",   "part.pattern_grid",       "part.pattern_linear",
        "part.primitive_box",      "part.primitive_cone",     "part.primitive_cylinder",
        "part.primitive_prism",    "part.primitive_sphere",   "part.primitive_torus",
        "part.primitive_tube",     "part.revolve",            "part.rotate",
        "part.section_ring",       "part.shell",              "part.sketch_circle",
        "part.sketch_polygon",     "part.sketch_rect",        "part.sketch_rounded_rect",
        "part.variable_fillet",
    };
    std::sort(v.begin(), v.end());
    return v;
  }();
  return ids;
}

}  // namespace forge::ui
