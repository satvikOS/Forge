// ui/src/OpConstraintBridge.cpp -- the op-constraint bridge.
//
// Two jobs, and they are kept apart on purpose:
//
//   1. TRANSCRIBE the generated constexpr table into runtime form, mapping the
//      vocabulary's own spellings ("SOLID", "Edge") onto the forge::ui enums.
//      Every unmapped spelling is RECORDED, never defaulted -- an unmapped kind
//      silently becoming `None` would pass every check below.
//   2. RULE on a proposed plan. Each rule is one fact the vocabulary states, and
//      each refusal names the op and says which fact it broke.
#include "forge/ui/OpConstraintBridge.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "forge/ui/ArchieOpVocabulary.hpp"

namespace forge::ui {
namespace {

std::string lower(std::string_view text) {
  std::string out;
  out.reserve(text.size());
  for (const char ch : text) {
    out.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(ch))));
  }
  return out;
}

// The vocabulary writes value kinds as "SOLID" (ops) and "Solid" (commands);
// forge::ui::toString(IrValueKind) writes "solid". Comparing case-folded against
// the enum's OWN names is a derivation from the enum, not a second transcription
// of it -- add a kind to IrValueKind and this keeps working.
bool mapValueKind(std::string_view spelling, IrValueKind& out) {
  const IrValueKind kinds[] = {IrValueKind::None, IrValueKind::Profile, IrValueKind::Wire,
                               IrValueKind::Solid};
  const std::string want = lower(spelling);
  for (const IrValueKind kind : kinds) {
    if (want == toString(kind)) {
      out = kind;
      return true;
    }
  }
  return false;
}

bool mapEntityKind(std::string_view spelling, EntityKind& out) {
  const EntityKind kinds[] = {EntityKind::None,      EntityKind::Vertex,    EntityKind::Edge,
                              EntityKind::Face,      EntityKind::Body,      EntityKind::Sketch,
                              EntityKind::SketchCurve, EntityKind::Wire,    EntityKind::Feature,
                              EntityKind::Component, EntityKind::Datum,     EntityKind::Any};
  const std::string want = lower(spelling);
  for (const EntityKind kind : kinds) {
    if (want == toString(kind)) {
      out = kind;
      return true;
    }
  }
  return false;
}

std::size_t mapBound(std::size_t generated) {
  // The generator and FeatureIr.hpp spell "unbounded" the same way -- (size_t)-1
  // -- but the two constants live in different headers, so the equality is
  // asserted here rather than assumed by a reader.
  static_assert(vocab::kUnboundedArgs == kIrArgsUnbounded,
                "the generated unbounded marker must be forge::ui::kIrArgsUnbounded");
  return generated;
}

std::string countList(const std::vector<OpVocabulary::ArgCounts>& forms) {
  std::string out;
  for (std::size_t i = 0; i < forms.size(); ++i) {
    if (i != 0) out += (i + 1 == forms.size()) ? " or " : ", ";
    out += std::to_string(forms[i].min);
    if (forms[i].max == kIrArgsUnbounded) {
      out += " or more";
    } else if (forms[i].max != forms[i].min) {
      out += "-" + std::to_string(forms[i].max);
    }
  }
  return out.empty() ? std::string("none") : out;
}

std::string kindList(const std::vector<IrValueKind>& kinds) {
  std::string out;
  for (std::size_t i = 0; i < kinds.size(); ++i) {
    if (i != 0) out += ", ";
    out += toString(kinds[i]);
  }
  return out.empty() ? std::string("nothing") : out;
}

std::string joined(const std::vector<std::string>& items) {
  std::string out;
  for (std::size_t i = 0; i < items.size(); ++i) {
    if (i != 0) out += ", ";
    out += items[i];
  }
  return out.empty() ? std::string("none") : out;
}

void addKind(std::vector<IrValueKind>& kinds, IrValueKind kind) {
  if (std::find(kinds.begin(), kinds.end(), kind) == kinds.end()) kinds.push_back(kind);
}

bool hasKind(const std::vector<IrValueKind>& kinds, IrValueKind kind) {
  return std::find(kinds.begin(), kinds.end(), kind) != kinds.end();
}

// ── argument-value helpers ──────────────────────────────────────────────────
// forge::ft upper-cases every BARE keyword it reads, so `sphere` and `SPHERE`
// are the same token to the kernel and must be the same token to this gate. A
// quoted string is NOT upper-cased by the kernel, so a Text argument is compared
// as written -- matching a lower-cased selector against the op table would refuse
// "sphere" as a face name the kernel would have kept verbatim.
std::string upperWord(const std::string& text) {
  std::string out;
  out.reserve(text.size());
  for (const char ch : text) {
    out.push_back(static_cast<char>(std::toupper(static_cast<unsigned char>(ch))));
  }
  return out;
}

// A BARE keyword token: what forge::ft's tokenizer will read back as one
// Keyword. Anything outside this set ends the token or ends the statement, so a
// "keyword" holding it is not a keyword at all.
bool bareKeyword(const std::string& word) {
  if (word.empty()) return false;
  for (const char ch : word) {
    const unsigned char c = static_cast<unsigned char>(ch);
    if (std::isalnum(c) == 0 && ch != '_') return false;
  }
  return true;
}

// Names the offending character so a refusal can be acted on. A control
// character has no printable form, and printing it raw into a log or a panel
// would reproduce the very injection being refused.
std::string describeChar(char ch) {
  switch (ch) {
    case '\n': return "a newline (\\n)";
    case '\r': return "a carriage return (\\r)";
    case '\t': return "a tab (\\t)";
    case '"':  return "a double quote (\")";
    case '\'': return "a single quote (')";
    default: break;
  }
  char buf[16];
  std::snprintf(buf, sizeof(buf), "0x%02X", static_cast<unsigned>(static_cast<unsigned char>(ch)));
  return std::string("the control character ") + buf;
}

// The character that would break `IrLine::text()` out of one token of one
// statement, or '\0' when the value is writable. Both quote characters are
// refused, not just the one IrArg::token() emits: forge::ft's tokenizer opens a
// string on EITHER, so a single quote inside a double-quoted selector is a live
// delimiter the moment anything re-renders the line.
char unwritableChar(const std::string& value) {
  for (const char ch : value) {
    const unsigned char c = static_cast<unsigned char>(ch);
    if (ch == '"' || ch == '\'') return ch;
    if (c < 0x20 || c == 0x7F) return ch;
  }
  return '\0';
}

OpVocabulary buildFromGeneratedTable() {
  OpVocabulary v;
  v.sourcePath.assign(vocab::kVocabularyPath);
  v.sha256.assign(vocab::kVocabularySha256);
  v.schema.assign(vocab::kVocabularySchema);
  v.kernelOpCount = vocab::kKernelOpsCount;
  v.registryCommandCount = vocab::kRegistryCommandsCount;
  v.commandsEmittingIr = vocab::kCommandsEmittingIrCount;

  v.ops.reserve(vocab::kAllowedOps.size());
  for (const vocab::OpRow& row : vocab::kAllowedOps) {
    OpVocabulary::Op op;
    op.op.assign(row.op);
    if (!mapValueKind(row.produces, op.produces)) {
      v.unmappedSpellings.push_back(std::string(row.op) + ".produces=" + std::string(row.produces));
    }
    for (std::size_t i = 0; i < row.consumesCount; ++i) {
      const std::string_view spelling = vocab::kConsumedValueKinds[row.consumesFirst + i];
      IrValueKind kind = IrValueKind::None;
      if (mapValueKind(spelling, kind)) {
        op.consumes.push_back(kind);
      } else {
        v.unmappedSpellings.push_back(std::string(row.op) + ".consumes=" + std::string(spelling));
      }
    }
    op.kernelMinArgs = mapBound(row.kernelMinArgs);
    op.kernelMaxArgs = mapBound(row.kernelMaxArgs);
    op.firstArgIsValueRef = row.firstArgIsValueRef;
    for (std::size_t i = 0; i < row.formCount; ++i) {
      const vocab::ArgCountRange& form = vocab::kEmittedArgCounts[row.formFirst + i];
      op.emittedForms.push_back(OpVocabulary::ArgCounts{mapBound(form.min), mapBound(form.max)});
    }
    for (std::size_t i = 0; i < row.commandCount; ++i) {
      op.commands.emplace_back(vocab::kOpCommandIds[row.commandFirst + i]);
    }
    v.ops.push_back(std::move(op));
  }

  v.forbidden.reserve(vocab::kForbiddenOps.size());
  for (const vocab::ForbiddenRow& row : vocab::kForbiddenOps) {
    v.forbidden.push_back(OpVocabulary::Forbidden{std::string(row.op), std::string(row.reason)});
  }

  v.commands.reserve(vocab::kEmittingCommands.size());
  for (const vocab::CommandRow& row : vocab::kEmittingCommands) {
    OpVocabulary::Command cmd;
    cmd.id.assign(row.id);
    cmd.op.assign(row.op);
    if (!mapEntityKind(row.selectionKind, cmd.selection)) {
      v.unmappedSpellings.push_back(std::string(row.id) + ".selection=" +
                                    std::string(row.selectionKind));
    }
    cmd.selectionMin = mapBound(row.selectionMin);
    cmd.selectionMax = mapBound(row.selectionMax);
    if (!mapValueKind(row.producesValueKind, cmd.produces)) {
      v.unmappedSpellings.push_back(std::string(row.id) + ".produces=" +
                                    std::string(row.producesValueKind));
    }
    v.commands.push_back(std::move(cmd));
  }
  return v;
}

VocabularyClosure computeClosure(const OpVocabulary& v) {
  VocabularyClosure c;

  // A CREATOR is an op that needs no value AND has a command that needs no
  // selection: both halves are required for it to be reachable from an EMPTY
  // document. An op taking no %ref but demanding a picked body is not a way in.
  for (const OpVocabulary::Op& op : v.ops) {
    if (op.firstArgIsValueRef || !op.consumes.empty()) continue;
    bool reachableWithNoSelection = false;
    for (const OpVocabulary::Command& cmd : v.commands) {
      if (cmd.op == op.op && cmd.selectionMin == 0) reachableWithNoSelection = true;
    }
    if (!reachableWithNoSelection) continue;
    c.creatorOps.push_back(op.op);
    addKind(c.reachableKinds, op.produces);
  }

  for (const OpVocabulary::Op& op : v.ops) {
    for (const IrValueKind kind : op.consumes) addKind(c.requiredKinds, kind);
  }

  // Fixpoint: an op's product is reachable once everything it consumes is.
  // Bounded by the op count, so it terminates even on a cyclic table.
  for (std::size_t round = 0; round <= v.ops.size(); ++round) {
    bool grew = false;
    for (const OpVocabulary::Op& op : v.ops) {
      if (hasKind(c.reachableKinds, op.produces)) continue;
      bool ready = true;
      for (const IrValueKind kind : op.consumes) {
        if (!hasKind(c.reachableKinds, kind)) ready = false;
      }
      if (!ready) continue;
      addKind(c.reachableKinds, op.produces);
      grew = true;
    }
    if (!grew) break;
  }

  for (const IrValueKind kind : c.requiredKinds) {
    if (!hasKind(c.reachableKinds, kind)) c.owedCreatorKinds.push_back(kind);
  }
  for (const OpVocabulary::Op& op : v.ops) {
    for (const IrValueKind kind : op.consumes) {
      if (!hasKind(c.reachableKinds, kind)) {
        if (std::find(c.unreachableOps.begin(), c.unreachableOps.end(), op.op) ==
            c.unreachableOps.end()) {
          c.unreachableOps.push_back(op.op);
        }
      }
    }
  }
  return c;
}

}  // namespace

// ── names ───────────────────────────────────────────────────────────────────
const char* toString(OpConstraint check) noexcept {
  switch (check) {
    case OpConstraint::Ok:                  return "ok";
    case OpConstraint::EmptyOp:             return "empty_op";
    case OpConstraint::UnknownOp:           return "unknown_op";
    case OpConstraint::ForbiddenOp:         return "forbidden_op";
    case OpConstraint::WrongArity:          return "wrong_arity";
    case OpConstraint::WrongSelectionKind:  return "wrong_selection_kind";
    case OpConstraint::WrongSelectionCount: return "wrong_selection_count";
    case OpConstraint::BadStatementId:      return "bad_statement_id";
    case OpConstraint::MissingValueRef:     return "missing_value_ref";
    case OpConstraint::UnexpectedValueRef:  return "unexpected_value_ref";
    case OpConstraint::ForwardValueRef:     return "forward_value_ref";
    case OpConstraint::UnresolvedValueRef:  return "unresolved_value_ref";
    case OpConstraint::WrongValueKind:      return "wrong_value_kind";
    case OpConstraint::ForbiddenOpInArgument:  return "forbidden_op_in_argument";
    case OpConstraint::OpNameInArgument:       return "op_name_in_argument";
    case OpConstraint::MalformedArgumentValue: return "malformed_argument_value";
  }
  return "unknown_op";
}

// ── OpVocabulary ────────────────────────────────────────────────────────────
const OpVocabulary::Op* OpVocabulary::find(const std::string& op) const noexcept {
  for (const Op& row : ops) {
    if (row.op == op) return &row;
  }
  return nullptr;
}

const OpVocabulary::Forbidden* OpVocabulary::findForbidden(const std::string& op) const noexcept {
  for (const Forbidden& row : forbidden) {
    if (row.op == op) return &row;
  }
  return nullptr;
}

std::vector<std::string> OpVocabulary::opNames() const {
  std::vector<std::string> names;
  names.reserve(ops.size());
  for (const Op& row : ops) names.push_back(row.op);
  return names;
}

const OpVocabulary& generatedVocabulary() {
  static const OpVocabulary kVocabulary = buildFromGeneratedTable();
  return kVocabulary;
}

// ── PlanRuling ──────────────────────────────────────────────────────────────
const OpRuling* PlanRuling::firstRejection() const noexcept {
  for (const OpRuling& r : rulings) {
    if (!r.accepted()) return &r;
  }
  return nullptr;
}

std::string PlanRuling::report() const {
  std::string out;
  for (const OpRuling& r : rulings) {
    out += r.accepted() ? "  ACCEPT " : "  REFUSE ";
    out += "%" + std::to_string(r.statementId) + " " + r.op;
    if (!r.accepted()) out += " -- " + std::string(toString(r.verdict)) + ": " + r.reason;
    out += "\n";
  }
  out += "  " + std::to_string(accepted) + " accepted, " + std::to_string(rejected) + " refused\n";
  return out;
}

// ── VocabularyClosure ───────────────────────────────────────────────────────
std::string VocabularyClosure::report() const {
  std::string out;
  out += "  creators (reachable from an EMPTY document): " + joined(creatorOps) + "\n";
  out += "  value kinds reachable: " + kindList(reachableKinds) + "\n";
  out += "  value kinds required:  " + kindList(requiredKinds) + "\n";
  if (closed()) {
    out += "  CLOSED: every kind an allowed op consumes is producible from the allowed set.\n";
    return out;
  }
  out += "  NOT CLOSED -- the allowed set cannot express a program on its own.\n";
  if (!owedCreatorKinds.empty()) {
    out += "  OWED, a forge::ui command that CREATES: " + kindList(owedCreatorKinds) + "\n";
  }
  if (!unreachableOps.empty()) {
    out += "  OWED, unreachable until then: " + joined(unreachableOps) + "\n";
  }
  return out;
}

// ── the bridge ──────────────────────────────────────────────────────────────
OpConstraintBridge::OpConstraintBridge() : OpConstraintBridge(generatedVocabulary()) {}

OpConstraintBridge::OpConstraintBridge(OpVocabulary vocabulary)
    : vocabulary_(std::move(vocabulary)) {
  closure_ = computeClosure(vocabulary_);
  allowed_ = vocabulary_.opNames();
}

bool OpConstraintBridge::allows(const std::string& op) const noexcept {
  return vocabulary_.find(op) != nullptr;
}

std::vector<std::string> OpConstraintBridge::forbiddenOps() const {
  std::vector<std::string> names;
  names.reserve(vocabulary_.forbidden.size());
  for (const OpVocabulary::Forbidden& row : vocabulary_.forbidden) names.push_back(row.op);
  return names;
}

IrValueKind OpConstraintBridge::produces(const std::string& op) const noexcept {
  const OpVocabulary::Op* row = vocabulary_.find(op);
  return row ? row->produces : IrValueKind::None;
}

std::vector<EntityKind> OpConstraintBridge::acceptedSelections(const std::string& op) const {
  std::vector<EntityKind> kinds;
  for (const OpVocabulary::Command& cmd : vocabulary_.commands) {
    if (cmd.op != op) continue;
    if (std::find(kinds.begin(), kinds.end(), cmd.selection) == kinds.end()) {
      kinds.push_back(cmd.selection);
    }
  }
  return kinds;
}

OpRuling OpConstraintBridge::accept(const ProposedOp& proposal) const {
  OpRuling r;
  r.verdict = OpConstraint::Ok;
  r.op = proposal.line.op;
  r.statementId = proposal.line.id;
  return r;
}

OpRuling OpConstraintBridge::reject(const ProposedOp& proposal, OpConstraint verdict,
                                    std::string reason) const {
  OpRuling r;
  r.verdict = verdict;
  r.op = proposal.line.op;
  r.statementId = proposal.line.id;
  r.reason = std::move(reason);
  return r;
}

// ── one argument's VALUE ────────────────────────────────────────────────────
// See the header for why these two rules and no others. The order matters: a
// value is judged WRITABLE first, because a value that cannot be written into
// the IR text at all is broken whatever word it happens to spell, and reporting
// the op-name fact for a string that also carries a newline would name the
// smaller of the two problems.
OpConstraint OpConstraintBridge::checkValue(const IrArg& arg, std::string& reason) const {
  reason.clear();

  // Rule 1: WRITABLE.
  if (arg.kind == IrArgKind::Number) {
    // std::isfinite, not a comparison: `v != v` is true for NaN but says nothing
    // about an infinity, and "%.10g" writes BOTH as a bare word ("nan", "inf")
    // that re-reads as a KEYWORD -- an argument that changed kind on the way to
    // the kernel.
    if (!std::isfinite(arg.number)) {
      reason = "a non-finite number cannot be written as feature-IR: formatIrNumber() renders "
               "it as a bare word, which forge::ft re-reads as a KEYWORD rather than a number";
      return OpConstraint::MalformedArgumentValue;
    }
    return OpConstraint::Ok;
  }
  if (arg.kind == IrArgKind::Ref) return OpConstraint::Ok;  // an int; shape-checked by the plan

  if (arg.kind == IrArgKind::Keyword && !bareKeyword(arg.word)) {
    reason = arg.word.empty()
                 ? std::string("an EMPTY keyword argument: it renders as nothing at all, and "
                               "the statement comes back with one argument fewer than it was "
                               "written with")
                 : ("a keyword argument that is not a bare keyword: forge::ft reads a bare "
                    "token as [A-Za-z0-9_]+ and this one carries something else, so it does "
                    "not come back as the ONE keyword it was written as");
    return OpConstraint::MalformedArgumentValue;
  }
  if (const char bad = unwritableChar(arg.word); bad != '\0') {
    reason = "the value carries " + describeChar(bad) +
             ", and IrArg::token() escapes nothing: rendered into a statement it does not "
             "come back as one argument of one statement. forge::ft reads statements LINE BY "
             "LINE and opens a string on either quote, so such a value can carry a whole "
             "further statement -- including an op no command emits -- past a gate that only "
             "read the op name";
    return OpConstraint::MalformedArgumentValue;
  }

  // Rule 2: NOT AN OP. Whole token only.
  const std::string word = arg.kind == IrArgKind::Keyword ? upperWord(arg.word) : arg.word;
  if (const OpVocabulary::Forbidden* forbidden = vocabulary_.findForbidden(word)) {
    reason = word + ": forbidden -- " + forbidden->reason +
             "; it is here in an ARGUMENT, where the op name of the statement is " +
             "not what carries it";
    return OpConstraint::ForbiddenOpInArgument;
  }
  const bool allowed = vocabulary_.find(word) != nullptr;
  if (!allowed && findIrOp(word) != nullptr) {
    // Same DRIFT case check() reports for a statement op, and the same answer: an
    // op nobody classified is not a permission.
    reason = word + ": forbidden -- forge::ui::irOpTable() has this op but the generated "
                    "vocabulary (" + vocabulary_.sourcePath + ") classifies it neither as "
                    "user-invocable nor as forbidden, so no command is known to emit it";
    return OpConstraint::ForbiddenOpInArgument;
  }
  if (allowed && arg.kind == IrArgKind::Keyword) {
    // An op the app DOES expose, but as a STATEMENT. No command emits an op name
    // as a bare keyword, so a plan that does was not produced by this app.
    //
    // Deliberately NOT applied to a quoted Text argument: a selector is free-form
    // text the kernel resolves against the face inventory, and refusing a face a
    // user legitimately named "EXTRUDE" would remove capability to fix nothing --
    // an allowed op inside a quoted string escalates to nothing.
    reason = word + ": user-invocable as a STATEMENT op, but no forge::ui command emits an op "
                    "name as a bare keyword argument";
    return OpConstraint::OpNameInArgument;
  }
  return OpConstraint::Ok;
}

OpRuling OpConstraintBridge::check(const ProposedOp& proposal) const {
  const IrLine& line = proposal.line;
  if (line.op.empty()) {
    return reject(proposal, OpConstraint::EmptyOp,
                  "a statement with no op name: there is nothing to allow or forbid");
  }

  // ── 1. membership ─────────────────────────────────────────────────────────
  const OpVocabulary::Op* op = vocabulary_.find(line.op);
  if (op == nullptr) {
    if (const OpVocabulary::Forbidden* forbidden = vocabulary_.findForbidden(line.op)) {
      return reject(proposal, OpConstraint::ForbiddenOp,
                    line.op + ": forbidden -- " + forbidden->reason);
    }
    if (findIrOp(line.op) != nullptr) {
      // The kernel has it and the generated vocabulary lists it neither as
      // allowed nor as forbidden. That is DRIFT, and it is reported as such
      // rather than waved through: an op nobody classified is not a permission.
      return reject(proposal, OpConstraint::ForbiddenOp,
                    line.op + ": forbidden -- forge::ui::irOpTable() has this op but the "
                              "generated vocabulary (" + vocabulary_.sourcePath +
                              ") classifies it neither as user-invocable nor as forbidden, so "
                              "no command is known to emit it");
    }
    return reject(proposal, OpConstraint::UnknownOp,
                  line.op + ": unknown -- not a feature-IR op at all; it is absent from "
                            "forge::ui::irOpTable(), which mirrors forge::ft::opFromName");
  }

  // ── 2. statement id ───────────────────────────────────────────────────────
  if (line.id <= 0) {
    return reject(proposal, OpConstraint::BadStatementId,
                  line.op + ": statement id " + std::to_string(line.id) +
                      " is not positive; ids are 1-based and define what later %N mean");
  }

  // ── 3. arity a USER command can emit ──────────────────────────────────────
  // Deliberately the emitted forms, not the kernel arity: forge::ft would accept
  // more, and a form no command produces is a form no user could have made.
  const std::size_t argc = line.args.size();
  bool arityOk = false;
  for (const OpVocabulary::ArgCounts& form : op->emittedForms) {
    if (argc < form.min) continue;
    if (form.max != kIrArgsUnbounded && argc > form.max) continue;
    arityOk = true;
  }
  if (!arityOk) {
    return reject(proposal, OpConstraint::WrongArity,
                  line.op + ": wrong arity -- " + std::to_string(argc) +
                      " argument(s); the only forms a forge::ui command emits take " +
                      countList(op->emittedForms) + " (the kernel would accept " +
                      std::to_string(op->kernelMinArgs) + "-" +
                      (op->kernelMaxArgs == kIrArgsUnbounded ? std::string("n")
                                                             : std::to_string(op->kernelMaxArgs)) +
                      ", which is wider than the app)");
  }

  // ── 4. the leading value reference ────────────────────────────────────────
  const bool leadsWithRef = !line.args.empty() && line.args[0].kind == IrArgKind::Ref;
  if (op->firstArgIsValueRef && !leadsWithRef) {
    return reject(proposal, OpConstraint::MissingValueRef,
                  line.op + ": the app writes it as " + line.op +
                      "(%body, ...) -- its first argument must be a value reference to an "
                      "earlier statement, and this one is not");
  }
  if (!op->firstArgIsValueRef && leadsWithRef) {
    return reject(proposal, OpConstraint::UnexpectedValueRef,
                  line.op + ": it CREATES a value (" + toString(op->produces) +
                      ") and takes no leading value reference, but one was given");
  }

  // ── 5. what each argument SAYS ────────────────────────────────────────────
  // Checks 3 and 4 read the argument list's SHAPE. This one reads its CONTENT,
  // and it is the difference between "a plan whose statements name only allowed
  // ops" and "a plan that can only produce allowed ops": FILLET's third argument
  // is a word a caller supplies verbatim through the `selector` parameter, so
  // without this the op name of the statement is not the only op the statement
  // can carry.
  for (std::size_t i = 0; i < line.args.size(); ++i) {
    std::string why;
    const OpConstraint verdict = checkValue(line.args[i], why);
    if (verdict == OpConstraint::Ok) continue;
    return reject(proposal, verdict,
                  line.op + ": argument " + std::to_string(i + 1) + " of " +
                      std::to_string(line.args.size()) + " -- " + why);
  }

  // ── 6. the selection the user would have had to make ──────────────────────
  if (proposal.selection != EntityKind::Any) {
    const std::vector<EntityKind> kinds = acceptedSelections(line.op);
    bool kindOk = false;
    for (const EntityKind kind : kinds) {
      if (kind == proposal.selection) kindOk = true;
    }
    if (!kindOk) {
      std::string wanted;
      for (std::size_t i = 0; i < kinds.size(); ++i) {
        if (i != 0) wanted += " or ";
        wanted += toString(kinds[i]);
      }
      std::vector<std::string> owners;
      for (const OpVocabulary::Command& cmd : vocabulary_.commands) {
        if (cmd.op == line.op) owners.push_back(cmd.id);
      }
      return reject(proposal, OpConstraint::WrongSelectionKind,
                    line.op + ": wrong selection kind -- the plan states a " +
                        std::string(toString(proposal.selection)) +
                        " selection, and the command(s) that emit this op (" + joined(owners) +
                        ") require " + (wanted.empty() ? std::string("no selection") : wanted));
    }
    bool countOk = false;
    std::string bounds;
    for (const OpVocabulary::Command& cmd : vocabulary_.commands) {
      if (cmd.op != line.op || cmd.selection != proposal.selection) continue;
      if (!bounds.empty()) bounds += " or ";
      bounds += std::to_string(cmd.selectionMin) + "-" +
                (cmd.selectionMax == kIrArgsUnbounded ? std::string("n")
                                                      : std::to_string(cmd.selectionMax));
      if (proposal.selectionCount < cmd.selectionMin) continue;
      if (cmd.selectionMax != kIrArgsUnbounded && proposal.selectionCount > cmd.selectionMax) {
        continue;
      }
      countOk = true;
    }
    if (!countOk) {
      return reject(proposal, OpConstraint::WrongSelectionCount,
                    line.op + ": wrong selection count -- the plan picks " +
                        std::to_string(proposal.selectionCount) + " " +
                        toString(proposal.selection) + "(s); the command needs " + bounds);
    }
  }
  return accept(proposal);
}

PlanRuling OpConstraintBridge::check(const std::vector<ProposedOp>& plan,
                                     const std::vector<IrValueKind>& priorValues) const {
  PlanRuling out;
  out.rulings.reserve(plan.size());

  // values[i] is the kind of statement id i+1. Seeded values come first, exactly
  // as PartDocument numbers them.
  std::vector<IrValueKind> values = priorValues;

  for (const ProposedOp& proposal : plan) {
    OpRuling ruling = check(proposal);
    const int expectedId = static_cast<int>(values.size()) + 1;

    if (ruling.accepted() && proposal.line.id != expectedId) {
      ruling = reject(proposal, OpConstraint::BadStatementId,
                      proposal.line.op + ": statement id %" + std::to_string(proposal.line.id) +
                          " is out of order -- the next statement in this plan is %" +
                          std::to_string(expectedId) +
                          ", and renumbering would change what every later %N means");
    }

    if (ruling.accepted()) {
      const OpVocabulary::Op* op = vocabulary_.find(proposal.line.op);
      // Every %ref an allowed op takes is of the SAME declared kind -- each of
      // the 18 rows consumes at most one kind, which
      // ui/test/op_constraint_bridge_test.cpp pins. So one rule covers CUT's two
      // solid operands and LOFT's n wire sections alike.
      for (const IrArg& arg : proposal.line.args) {
        if (arg.kind != IrArgKind::Ref) continue;
        if (arg.ref <= 0 || arg.ref >= proposal.line.id) {
          ruling = reject(proposal, OpConstraint::ForwardValueRef,
                          proposal.line.op + ": %" + std::to_string(arg.ref) +
                              " does not name an EARLIER statement (this is %" +
                              std::to_string(proposal.line.id) +
                              "); creation order is evaluation order, so it can never resolve");
          break;
        }
        if (static_cast<std::size_t>(arg.ref) > values.size()) {
          ruling = reject(proposal, OpConstraint::UnresolvedValueRef,
                          proposal.line.op + ": %" + std::to_string(arg.ref) +
                              " names no statement -- this plan and its prior values define " +
                              std::to_string(values.size()) + " of them");
          break;
        }
        const IrValueKind have = values[static_cast<std::size_t>(arg.ref) - 1];
        if (op != nullptr && !op->consumes.empty() && !hasKind(op->consumes, have)) {
          ruling = reject(proposal, OpConstraint::WrongValueKind,
                          proposal.line.op + ": %" + std::to_string(arg.ref) + " is a " +
                              toString(have) + " and " + proposal.line.op + " consumes a " +
                              kindList(op->consumes));
          break;
        }
      }
    }

    if (ruling.accepted()) {
      ++out.accepted;
      const OpVocabulary::Op* op = vocabulary_.find(proposal.line.op);
      values.push_back(op ? op->produces : IrValueKind::None);
    } else {
      ++out.rejected;
      // A refused statement produces nothing, so later %N must not resolve to
      // it. Recording `None` keeps the numbering aligned and makes every
      // dependent statement fail on the KIND rather than silently pass.
      values.push_back(IrValueKind::None);
    }
    out.rulings.push_back(std::move(ruling));
  }
  return out;
}

PlanRuling OpConstraintBridge::check(const std::vector<IrLine>& program,
                                     const std::vector<IrValueKind>& priorValues) const {
  std::vector<ProposedOp> plan;
  plan.reserve(program.size());
  for (const IrLine& line : program) {
    ProposedOp proposal;
    proposal.line = line;
    plan.push_back(std::move(proposal));
  }
  return check(plan, priorValues);
}

}  // namespace forge::ui
