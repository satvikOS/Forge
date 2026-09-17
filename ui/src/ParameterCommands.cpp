// ui/src/ParameterCommands.cpp
//
// THE PARAMETER COMMANDS -- how a person, a macro and Archie create a parameter
// and drive a feature's number with a formula. Four commands, one registry, one
// undo stack; the Parameters panel dispatches these same four and nothing else.
//
// Every handler follows the transaction the whole application is held to:
//
//   prepare   build the CANDIDATE parameter set: the document's set with this
//             one change applied, touching nothing
//   resolve   recomputeParameters() resolves every name, orders the graph and
//             refuses a cycle, naming every member
//   dry run   ... evaluates every formula through the engine (unit-checked) and
//             checks every bound number's dimension, producing the list of
//             statement numbers that must change
//   execute   ParameterEdit applies the set and all of those numbers as ONE step
//   validate  PartDocument::editFeatureArgs() re-validates each rewritten
//             statement against the kernel's op table; any refusal rolls every
//             earlier rewrite back
//   commit    the edit is pushed on the undo stack only if all of that held
//
// A refusal at any stage reaches the caller through CommandContext::fail() with a
// sentence naming the reason, and the document is byte-identical to before.
//
// These are NOT feature-IR emitters. Like part.edit_feature they rewrite numbers
// of statements that already exist, so featureIrOp is empty.
#include <cmath>
#include <cstddef>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/ExpressionEngine.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/ParameterSet.hpp"
#include "forge/ui/Parameters.hpp"
#include "forge/ui/PartCommands.hpp"

namespace forge::ui {

namespace {

std::string txt(const CommandContext& ctx, const char* name, const char* fallback) {
  return ctx.params().text(name).value_or(std::string(fallback));
}

double num(const CommandContext& ctx, const char* name, double fallback) {
  return ctx.params().number(name).value_or(fallback);
}

bool hasText(const CommandContext& ctx, const char* name) {
  return ctx.params().text(name).has_value();
}

// A formula, a name and a note are each ONE LINE of text. The part file stores one
// record per line (forge-desktop/src/PartFile.cpp) and turns a control character
// into a space on the way out, so a line break accepted here would come back from
// a save as a different formula -- refused here instead, where it can be said.
bool plainLine(const std::string& text) {
  for (const char c : text) {
    const unsigned char u = static_cast<unsigned char>(c);
    if (u < 0x20 || u == 0x7f) return false;
  }
  return true;
}

CommandDescriptor base(const char* id, const char* label) {
  CommandDescriptor c;
  c.id = id;
  c.label = label;
  c.category = "Part";
  c.featureIrOp = "";
  c.signature = SelectionSignature::none();
  c.sideEffect = SideEffectClass::Document;
  c.undo = UndoContract::Transaction;
  c.preview = PreviewPolicy::None;
  c.version = 1;
  return c;
}

// The statement a `feature` parameter names, or nullptr. Whole, positive ids only:
// a statement id is a count, and 2.5 names no statement.
const FeatureRecord* featureFrom(const PartDocument& doc, const CommandContext& ctx) {
  const double feature = num(ctx, "feature", 0.0);
  if (!(feature >= 1.0 && feature <= 1.0e9) || feature != std::floor(feature)) return nullptr;
  return doc.featureAt(static_cast<int>(feature));
}

// Recompute `candidate`; on success, apply it and the numbers it changes as one
// undoable step. Returns false after ctx.fail() on any refusal.
bool commit(CommandContext& ctx, PartDocument& doc, UndoStack& stack,
            const ExpressionEngine& engine, const ParameterSet& candidate, std::string label) {
  const RecomputeResult r = recomputeParameters(doc, candidate, engine);
  if (!r.ok) {
    ctx.fail(r.reason);
    return false;
  }
  if (candidate == doc.parameters() && r.updates.empty()) return true;  // already so
  // perform() DESTROYS an edit whose apply() refused, so the reason cannot be read
  // off the edit afterwards; it is written to a sink both of them share.
  const auto failure = std::make_shared<std::string>();
  auto edit = std::make_unique<ParameterEdit>(candidate, r.updates, std::move(label), failure);
  if (!stack.perform(doc, std::move(edit))) {
    ctx.fail(failure->empty() ? std::string("the part refused the change") : *failure);
    return false;
  }
  return true;
}

}  // namespace

std::size_t registerParameterCommands(CommandRegistry& registry, PartDocument& document,
                                      UndoStack& undoStack, ExpressionEngineSource engine) {
  PartDocument* d = &document;
  UndoStack* s = &undoStack;
  const ExpressionEngineSource src = std::move(engine);
  std::size_t added = 0;
  const auto add = [&registry, &added](CommandDescriptor c) {
    if (registry.add(std::move(c))) ++added;
  };

  // ── SET PARAMETER ─────────────────────────────────────────────────────────
  // Create a named parameter, or change the formula of one that exists. Every
  // feature number that depends on it -- directly or through other parameters --
  // is rewritten in the same step, so "change wall and three features update" is
  // one command and one Ctrl+Z.
  //
  // `name` and `expression` are REQUIRED with no default: there is no honest
  // default name for a parameter and no default value for one, and inventing
  // either would let a menu click put a number into somebody's part.
  {
    CommandDescriptor c = base("part.parameter_set", "Set Parameter");
    c.schema.push_back(ParamSpec{.name = "name", .type = ParamType::Text, .required = true,
                                 .defaultNumber = 0.0, .defaultText = "", .hasDefault = false});
    c.schema.push_back(ParamSpec{.name = "expression", .type = ParamType::Text, .required = true,
                                 .defaultNumber = 0.0, .defaultText = "", .hasDefault = false});
    c.schema.push_back(ParamSpec{.name = "comment", .type = ParamType::Text, .required = false,
                                 .defaultNumber = 0.0, .defaultText = "", .hasDefault = false});
    // STRUCTURE only: is there an expression library to read a formula with? Whether
    // THIS formula is good is the execute's answer, and deciding it here would grey
    // out a keystroke instead of saying what is wrong with it.
    c.enabled = [src](const CommandContext&) { return src && src() != nullptr; };
    c.execute = [d, s, src](CommandContext& ctx) {
      const ExpressionEngine* engine = src ? src() : nullptr;
      if (engine == nullptr) {
        ctx.fail("parameters are not available in this build");
        return;
      }
      const std::string name = txt(ctx, "name", "");
      if (!engine->validName(name)) {
        ctx.fail("'" + name + "' cannot be a parameter name -- use letters, digits and _, "
                 "start with a letter, and do not reuse a unit, a constant or a function name");
        return;
      }
      ParameterSet candidate = d->parameters();
      ParameterDef def;
      def.name = name;
      def.expression = txt(ctx, "expression", "");
      const ParameterDef* existing = candidate.find(name);
      def.comment = hasText(ctx, "comment") ? txt(ctx, "comment", "")
                                            : (existing != nullptr ? existing->comment : "");
      if (!plainLine(def.expression) || !plainLine(def.comment)) {
        ctx.fail("a formula and its note must each fit on one line");
        return;
      }
      candidate.upsertParameter(def);
      commit(ctx, *d, *s, *engine, candidate, "Set " + name);
    };
    add(std::move(c));
  }

  // ── BIND A FEATURE NUMBER TO A FORMULA ────────────────────────────────────
  // `feature` is the statement id -- what the feature tree, a .fpart and Archie
  // already hold -- and `argument` is the kernel's own name for the number:
  // `dia` of a HOLE, `radius` of a FILLET, `wall` of a SHELL. A name rather than a
  // position, because "the second number" of a statement means different things
  // for different ops and a binding that silently drives the wrong one is the
  // failure this command exists not to have.
  {
    CommandDescriptor c = base("part.parameter_bind", "Drive Dimension by Formula");
    c.schema.push_back(ParamSpec{.name = "feature", .type = ParamType::Number, .required = true,
                                 .defaultNumber = 0.0, .defaultText = "", .hasDefault = false});
    c.schema.push_back(ParamSpec{.name = "argument", .type = ParamType::Text, .required = true,
                                 .defaultNumber = 0.0, .defaultText = "", .hasDefault = false});
    c.schema.push_back(ParamSpec{.name = "expression", .type = ParamType::Text, .required = true,
                                 .defaultNumber = 0.0, .defaultText = "", .hasDefault = false});
    c.enabled = [d, src](const CommandContext&) {
      return src && src() != nullptr && !d->records().empty();
    };
    c.execute = [d, s, src](CommandContext& ctx) {
      const ExpressionEngine* engine = src ? src() : nullptr;
      if (engine == nullptr) {
        ctx.fail("parameters are not available in this build");
        return;
      }
      const FeatureRecord* rec = featureFrom(*d, ctx);
      if (rec == nullptr) {
        ctx.fail("there is no feature " + formatIrNumber(num(ctx, "feature", 0.0)) + " in this part");
        return;
      }
      const std::string argument = txt(ctx, "argument", "");
      const NumericSlot slot = numericSlotByName(rec->line.op, argument);
      ParameterSet candidate = d->parameters();
      DimensionBinding binding;
      binding.irId = rec->irId;
      binding.argument = argument;
      binding.slot = slot.found ? slot.index : 0;
      binding.expression = txt(ctx, "expression", "");
      if (!plainLine(binding.expression)) {
        ctx.fail("a formula must fit on one line");
        return;
      }
      candidate.upsertBinding(binding);
      // An unknown argument, an ambiguous one, a unitless one and one the statement
      // never wrote are all refused by recomputeParameters(), with the names the
      // statement DOES have -- one set of checks, not a second copy here.
      commit(ctx, *d, *s, *engine, candidate,
             "Drive " + featureReferenceLabel(*rec) + " " + argument);
    };
    add(std::move(c));
  }

  // ── STOP DRIVING A FEATURE NUMBER ─────────────────────────────────────────
  // The number keeps the value the formula last gave it; only the link goes.
  {
    CommandDescriptor c = base("part.parameter_unbind", "Stop Driving Dimension");
    c.schema.push_back(ParamSpec{.name = "feature", .type = ParamType::Number, .required = true,
                                 .defaultNumber = 0.0, .defaultText = "", .hasDefault = false});
    c.schema.push_back(ParamSpec{.name = "argument", .type = ParamType::Text, .required = true,
                                 .defaultNumber = 0.0, .defaultText = "", .hasDefault = false});
    c.enabled = [d, src](const CommandContext&) {
      return src && src() != nullptr && !d->parameters().bindings().empty();
    };
    c.execute = [d, s, src](CommandContext& ctx) {
      const ExpressionEngine* engine = src ? src() : nullptr;
      if (engine == nullptr) {
        ctx.fail("parameters are not available in this build");
        return;
      }
      const double feature = num(ctx, "feature", 0.0);
      const std::string argument = txt(ctx, "argument", "");
      ParameterSet candidate = d->parameters();
      const DimensionBinding* found = nullptr;
      for (const DimensionBinding& b : candidate.bindings()) {
        if (static_cast<double>(b.irId) == feature && b.argument == argument) found = &b;
      }
      if (found == nullptr) {
        ctx.fail("feature " + formatIrNumber(feature) + "'s '" + argument +
                 "' is not driven by a formula");
        return;
      }
      const int irId = found->irId;
      const std::size_t slot = found->slot;
      candidate.eraseBinding(irId, slot);
      const FeatureRecord* rec = d->featureAt(irId);
      commit(ctx, *d, *s, *engine, candidate,
             "Stop driving " + (rec != nullptr ? featureReferenceLabel(*rec) : "feature") + " " +
                 argument);
    };
    add(std::move(c));
  }

  // ── DELETE A PARAMETER ────────────────────────────────────────────────────
  // Refused while any formula uses it, and the refusal names every one that does:
  // deleting `wall` out from under `hole_d` would leave a formula that means
  // nothing, and choosing a value for it on the user's behalf is worse.
  {
    CommandDescriptor c = base("part.parameter_remove", "Delete Parameter");
    c.schema.push_back(ParamSpec{.name = "name", .type = ParamType::Text, .required = true,
                                 .defaultNumber = 0.0, .defaultText = "", .hasDefault = false});
    c.enabled = [d, src](const CommandContext&) {
      return src && src() != nullptr && !d->parameters().parameters().empty();
    };
    c.execute = [d, s, src](CommandContext& ctx) {
      const ExpressionEngine* engine = src ? src() : nullptr;
      if (engine == nullptr) {
        ctx.fail("parameters are not available in this build");
        return;
      }
      const std::string name = txt(ctx, "name", "");
      ParameterSet candidate = d->parameters();
      if (candidate.find(name) == nullptr) {
        ctx.fail("there is no parameter called '" + name + "'");
        return;
      }
      std::string users;
      const auto usesName = [&](const std::string& expression) {
        const ExprCompiled compiled = engine->compile(expression);
        for (const std::string& used : compiled.names) {
          if (used == name) return true;
        }
        return false;
      };
      for (const ParameterDef& p : candidate.parameters()) {
        if (p.name != name && usesName(p.expression)) users += (users.empty() ? "" : ", ") + p.name;
      }
      for (const DimensionBinding& b : candidate.bindings()) {
        if (!usesName(b.expression)) continue;
        const FeatureRecord* rec = d->featureAt(b.irId);
        users += (users.empty() ? "" : ", ") +
                 (rec != nullptr ? featureReferenceLabel(*rec) : "feature " + std::to_string(b.irId)) +
                 " " + b.argument;
      }
      if (!users.empty()) {
        ctx.fail("'" + name + "' is still used by " + users);
        return;
      }
      candidate.eraseParameter(name);
      commit(ctx, *d, *s, *engine, candidate, "Delete " + name);
    };
    add(std::move(c));
  }

  return added;
}

const std::vector<std::string>& parameterCommandIds() {
  static const std::vector<std::string> kIds = {
      "part.parameter_bind",
      "part.parameter_remove",
      "part.parameter_set",
      "part.parameter_unbind",
  };
  return kIds;
}

}  // namespace forge::ui
