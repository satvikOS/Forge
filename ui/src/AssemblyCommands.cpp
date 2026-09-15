// ui/src/AssemblyCommands.cpp -- see forge/ui/AssemblyCommands.hpp.
#include "forge/ui/AssemblyCommands.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"

namespace forge::ui {

using assembly::Assembly;
using assembly::Component;
using assembly::Drive;
using assembly::Joint;
using assembly::JointKind;
using assembly::Placement;
using assembly::Vec3;

// ── AssemblyEdit ────────────────────────────────────────────────────────────
AssemblyEdit::AssemblyEdit(Assembly after, std::string label)
    : after_(std::move(after)), label_(std::move(label)) {}

bool AssemblyEdit::apply(PartDocument& doc) {
  before_ = doc.assembly();
  return doc.setAssembly(after_);
}

void AssemblyEdit::revert(PartDocument& doc) { doc.setAssembly(before_); }

namespace {

std::string quoted(const std::string& s) { return "\"" + s + "\""; }

AssemblyStatementResult refuse(std::string why) {
  AssemblyStatementResult r;
  r.reason = std::move(why);
  return r;
}

bool numberAt(const IrLine& st, std::size_t i, double& out) {
  if (i >= st.args.size() || st.args[i].kind != IrArgKind::Number) return false;
  out = st.args[i].number;
  return std::isfinite(out);
}

bool textAt(const IrLine& st, std::size_t i, std::string& out) {
  if (i >= st.args.size() || st.args[i].kind != IrArgKind::Text) return false;
  out = st.args[i].word;
  return true;
}

bool keywordAt(const IrLine& st, std::size_t i, std::string& out) {
  if (i >= st.args.size() || st.args[i].kind != IrArgKind::Keyword) return false;
  out = st.args[i].word;
  return true;
}

bool nameTaken(const Assembly& a, const std::string& name) {
  return a.componentNamed(name) != nullptr || a.jointNamed(name) != nullptr;
}

// ── the six statements ──────────────────────────────────────────────────────

AssemblyStatementResult applyComponent(const Assembly& current, const IrLine& st,
                                       const PartDocument& doc) {
  if (st.args.size() != 5 && st.args.size() != 8) {
    return refuse("COMPONENT takes a body, a name and a position, and optionally all three "
                  "turns");
  }
  if (st.args[0].kind != IrArgKind::Ref) return refuse("COMPONENT's first argument is the body it places");
  const int body = st.args[0].ref;
  const FeatureRecord* rec = doc.featureAt(body);
  if (rec == nullptr) return refuse("there is no body %" + std::to_string(body) + " in this part");
  if (rec->produces != IrValueKind::Solid) {
    return refuse(featureDisplayName(*rec) + " is not a solid body, so it cannot be placed as a "
                                             "component");
  }
  std::string name;
  if (!textAt(st, 1, name)) return refuse("COMPONENT's second argument is the component's name");
  if (!assembly::isValidName(name)) {
    return refuse("a component name must be 1 to 64 printable characters without quotes or "
                  "backslashes");
  }
  if (nameTaken(current, name)) return refuse("something in the assembly is already called " + quoted(name));
  double v[6] = {0.0, 0.0, 0.0, 0.0, 0.0, 0.0};
  for (std::size_t i = 0; i + 2 < st.args.size(); ++i) {
    if (!numberAt(st, i + 2, v[i])) return refuse("a component's position and turns must be numbers");
  }
  AssemblyStatementResult r;
  r.candidate = current;
  Component c;
  c.id = r.candidate.nextComponentId++;
  c.name = name;
  c.body = body;
  c.placement = Placement::fromAngles(v[0], v[1], v[2], v[3], v[4], v[5]);
  r.candidate.components.push_back(c);
  r.touchedComponent = c.id;
  r.label = "Insert " + name;
  r.ok = true;
  return r;
}

AssemblyStatementResult applyGround(const Assembly& current, const IrLine& st) {
  std::string name;
  if (!textAt(st, 0, name)) return refuse("GROUND names the component to hold");
  bool on = true;
  if (st.args.size() == 2) {
    std::string word;
    if (!keywordAt(st, 1, word) || word != "OFF") return refuse("GROUND's only option is OFF");
    on = false;
  }
  const Component* c = current.componentNamed(name);
  if (c == nullptr) return refuse("there is no component called " + quoted(name));
  if (c->grounded == on) {
    return refuse(quoted(name) + (on ? " is already grounded" : " is not grounded"));
  }
  AssemblyStatementResult r;
  r.candidate = current;
  r.candidate.component(c->id)->grounded = on;
  r.touchedComponent = c->id;
  r.label = (on ? "Ground " : "Release ") + name;
  r.ok = true;
  return r;
}

AssemblyStatementResult applyJoint(const Assembly& current, const IrLine& st) {
  const std::size_t n = st.args.size();
  if (n != 7 && n != 10 && n != 11) {
    return refuse("JOINT takes a kind, a name, two components and a point, then optionally an "
                  "axis and a value");
  }
  std::string kindWord;
  JointKind kind = JointKind::Fixed;
  if (!keywordAt(st, 0, kindWord) || !assembly::jointKindFromKeyword(kindWord, kind)) {
    return refuse("a joint is FIXED, REVOLUTE, SLIDER, CYLINDRICAL, BALL, PLANAR, DISTANCE or "
                  "ANGLE");
  }
  std::string name, first, second;
  if (!textAt(st, 1, name) || !textAt(st, 2, first) || !textAt(st, 3, second)) {
    return refuse("JOINT names the joint and then the two components it joins");
  }
  if (!assembly::isValidName(name)) {
    return refuse("a joint name must be 1 to 64 printable characters without quotes or "
                  "backslashes");
  }
  if (nameTaken(current, name)) return refuse("something in the assembly is already called " + quoted(name));
  const Component* a = current.componentNamed(first);
  const Component* b = current.componentNamed(second);
  if (a == nullptr) return refuse("there is no component called " + quoted(first));
  if (b == nullptr) return refuse("there is no component called " + quoted(second));
  if (a->id == b->id) return refuse("a joint cannot join " + quoted(first) + " to itself");
  Vec3 origin{0.0, 0.0, 0.0};
  Vec3 axis{0.0, 0.0, 1.0};
  for (std::size_t i = 0; i < 3; ++i) {
    if (!numberAt(st, 4 + i, origin[i])) return refuse("a joint's point must be three numbers");
  }
  if (n >= 10) {
    for (std::size_t i = 0; i < 3; ++i) {
      if (!numberAt(st, 7 + i, axis[i])) return refuse("a joint's axis must be three numbers");
    }
  }
  double value = 0.0;
  if (assembly::jointTakesValue(kind)) {
    if (n != 11 || !numberAt(st, 10, value)) {
      return refuse(std::string("a ") + assembly::userWord(kind) + " joint needs its " +
                    (kind == JointKind::Distance ? "distance" : "angle"));
    }
  } else if (n == 11) {
    return refuse(std::string("a ") + assembly::userWord(kind) + " joint takes no value");
  }
  Placement frame;
  if (!assembly::frameFromAxis(origin, axis, frame)) {
    return refuse("a joint's axis must have a length");
  }
  // The frame on the second component is placed so the joint HOLDS as created:
  // a distance joint's second point lies `value` along the axis, an angle
  // joint's second axis is turned `value` about the frame's own x.
  Placement onSecondWorld = frame;
  if (kind == JointKind::Distance) {
    const Vec3 z = frame.axis(2);
    for (std::size_t i = 0; i < 3; ++i) onSecondWorld.t[i] += value * z[i];
  } else if (kind == JointKind::Angle) {
    onSecondWorld = frame.then(Placement::fromAngles(0.0, 0.0, 0.0, value, 0.0, 0.0));
  }
  AssemblyStatementResult r;
  r.candidate = current;
  Joint j;
  j.id = r.candidate.nextJointId++;
  j.name = name;
  j.kind = kind;
  j.first = a->id;
  j.second = b->id;
  j.onFirst = a->placement.inverse().then(frame);
  j.onSecond = b->placement.inverse().then(onSecondWorld);
  j.value = value;
  r.candidate.joints.push_back(j);
  r.touchedJoint = j.id;
  r.label = "Add " + name;
  r.ok = true;
  return r;
}

AssemblyStatementResult applyMate(const Assembly& current, const IrLine& st) {
  const std::size_t n = st.args.size();
  if (n != 16 && n != 17) {
    return refuse("MATE takes a kind, a name, two components, a point and an axis on each, and "
                  "optionally a value");
  }
  std::string kindWord;
  JointKind kind = JointKind::Fixed;
  if (!keywordAt(st, 0, kindWord) || !assembly::jointKindFromKeyword(kindWord, kind)) {
    return refuse("a joint is FIXED, REVOLUTE, SLIDER, CYLINDRICAL, BALL, PLANAR, DISTANCE or "
                  "ANGLE");
  }
  std::string name, first, second;
  if (!textAt(st, 1, name) || !textAt(st, 2, first) || !textAt(st, 3, second)) {
    return refuse("MATE names the joint and then the two components it joins");
  }
  if (!assembly::isValidName(name)) {
    return refuse("a joint name must be 1 to 64 printable characters without quotes or "
                  "backslashes");
  }
  if (nameTaken(current, name)) return refuse("something in the assembly is already called " + quoted(name));
  const Component* a = current.componentNamed(first);
  const Component* b = current.componentNamed(second);
  if (a == nullptr) return refuse("there is no component called " + quoted(first));
  if (b == nullptr) return refuse("there is no component called " + quoted(second));
  if (a->id == b->id) return refuse("a joint cannot join " + quoted(first) + " to itself");
  double v[12] = {};
  for (std::size_t i = 0; i < 12; ++i) {
    if (!numberAt(st, 4 + i, v[i])) return refuse("a mate's points and axes must be numbers");
  }
  double value = 0.0;
  if (assembly::jointTakesValue(kind)) {
    if (n != 17 || !numberAt(st, 16, value)) {
      return refuse(std::string("a ") + assembly::userWord(kind) + " joint needs its " +
                    (kind == JointKind::Distance ? "distance" : "angle"));
    }
  } else if (n == 17) {
    return refuse(std::string("a ") + assembly::userWord(kind) + " joint takes no value");
  }
  Placement onFirst, onSecond;
  if (!assembly::frameFromAxis({v[0], v[1], v[2]}, {v[3], v[4], v[5]}, onFirst) ||
      !assembly::frameFromAxis({v[6], v[7], v[8]}, {v[9], v[10], v[11]}, onSecond)) {
    return refuse("a mate's axes must each have a length");
  }
  AssemblyStatementResult r;
  r.candidate = current;
  Joint j;
  j.id = r.candidate.nextJointId++;
  j.name = name;
  j.kind = kind;
  j.first = a->id;
  j.second = b->id;
  j.onFirst = onFirst;
  j.onSecond = onSecond;
  j.value = value;
  r.candidate.joints.push_back(j);
  r.touchedJoint = j.id;
  r.label = "Mate " + name;
  r.ok = true;
  return r;
}

AssemblyStatementResult applyDrive(const Assembly& current, const IrLine& st) {
  std::string name;
  double value = 0.0;
  if (!textAt(st, 0, name)) return refuse("DRIVE names the joint to move");
  if (!numberAt(st, 1, value)) return refuse("DRIVE moves a joint to a number");
  const Joint* j = current.jointNamed(name);
  if (j == nullptr) return refuse("there is no joint called " + quoted(name));
  bool slide = !assembly::jointTurns(j->kind);
  if (st.args.size() == 3) {
    std::string word;
    if (!keywordAt(st, 2, word) || (word != "TURN" && word != "SLIDE")) {
      return refuse("DRIVE either TURNs a joint or SLIDEs it");
    }
    slide = word == "SLIDE";
  }
  if (slide ? !assembly::jointSlides(j->kind) : !assembly::jointTurns(j->kind)) {
    return refuse(quoted(name) + " is a " + assembly::userWord(j->kind) + " joint, which cannot be " +
                  (slide ? "slid" : "turned"));
  }
  AssemblyStatementResult r;
  r.candidate = current;
  r.drives.push_back(Drive{j->id, slide, value});
  r.touchedJoint = j->id;
  r.label = (slide ? "Slide " : "Turn ") + name;
  r.ok = true;
  return r;
}

AssemblyStatementResult applyRemove(const Assembly& current, const IrLine& st) {
  std::string name;
  if (!textAt(st, 0, name)) return refuse("REMOVE names what to take out of the assembly");
  AssemblyStatementResult r;
  r.candidate = current;
  if (const Joint* j = current.jointNamed(name)) {
    const int id = j->id;
    r.candidate.joints.erase(std::remove_if(r.candidate.joints.begin(), r.candidate.joints.end(),
                                            [id](const Joint& x) { return x.id == id; }),
                             r.candidate.joints.end());
    r.touchedJoint = id;
    r.label = "Remove " + name;
    r.ok = true;
    return r;
  }
  const Component* c = current.componentNamed(name);
  if (c == nullptr) return refuse("there is nothing called " + quoted(name) + " in the assembly");
  const std::vector<const Joint*> holding = current.jointsOf(c->id);
  if (!holding.empty()) {
    std::string names;
    for (std::size_t i = 0; i < holding.size(); ++i) {
      if (i > 0) names += i + 1 == holding.size() ? " and " : ", ";
      names += quoted(holding[i]->name);
    }
    return refuse(quoted(name) + " is held by " + names + "; remove " +
                  (holding.size() == 1 ? "that joint" : "those joints") + " first");
  }
  const int id = c->id;
  r.candidate.components.erase(
      std::remove_if(r.candidate.components.begin(), r.candidate.components.end(),
                     [id](const Component& x) { return x.id == id; }),
      r.candidate.components.end());
  r.touchedComponent = id;
  r.label = "Remove " + name;
  r.ok = true;
  return r;
}

// ── command plumbing ────────────────────────────────────────────────────────

double num(const CommandContext& ctx, const char* name, double fallback) {
  return ctx.params().number(name).value_or(fallback);
}
std::string txt(const CommandContext& ctx, const char* name, const char* fallback) {
  return ctx.params().text(name).value_or(std::string(fallback));
}
bool flagOr(const CommandContext& ctx, const char* name, bool fallback) {
  return ctx.params().flag(name).value_or(fallback);
}

CommandDescriptor base(const char* id, const char* label, const char* irOp,
                       SelectionSignature signature) {
  CommandDescriptor c;
  c.id = id;
  c.label = label;
  c.category = "Assembly";
  c.featureIrOp = irOp;
  c.signature = signature;
  c.sideEffect = SideEffectClass::Document;
  c.undo = UndoContract::Transaction;
  c.version = 1;
  return c;
}

// The one solid body a selection names, 0 when it does not name exactly one.
int selectedSolid(const PartDocument& doc, const SelectionService& sel) {
  int found = 0;
  for (const EntityRef& ref : sel.selection()) {
    const int id = doc.valueFor(ref.bodyId);
    if (id == 0 || doc.kindOf(id) != IrValueKind::Solid) return 0;
    if (found != 0 && found != id) return 0;
    found = id;
  }
  return found;
}

// The name a new component gets when nobody gave one: the body's own row label,
// then "(2)", "(3)" ... so a second instance of the same plate is still
// distinguishable in a joint and in the parts list.
std::string suggestedName(const PartDocument& doc, int body) {
  std::string stem = assembly::bodyName(doc, body);
  if (stem.empty()) stem = "Component";
  const Assembly& a = doc.assembly();
  if (!nameTaken(a, stem)) return stem;
  for (int n = 2;; ++n) {
    const std::string candidate = stem + " (" + std::to_string(n) + ")";
    if (!nameTaken(a, candidate)) return candidate;
  }
}

std::string nextJointName(const PartDocument& doc, JointKind kind) {
  std::string stem = assembly::userWord(kind);
  if (!stem.empty()) stem[0] = static_cast<char>(stem[0] - 'a' + 'A');
  const Assembly& a = doc.assembly();
  for (int n = 1;; ++n) {
    const std::string candidate = stem + " " + std::to_string(n);
    if (!nameTaken(a, candidate)) return candidate;
  }
}

void commit(CommandContext& ctx, PartDocument& doc, UndoStack& undo, AssemblySolverSlot& slot,
            IrLine statement) {
  std::string reason;
  if (!performAssemblyStatement(doc, undo, slot.solver, statement, reason)) ctx.fail(reason);
}

}  // namespace

AssemblyStatementResult applyAssemblyStatement(const Assembly& current, const IrLine& statement,
                                               const PartDocument& document) {
  const assembly::AsmOpSpec* spec = assembly::findAssemblyOp(statement.op);
  if (spec == nullptr) return refuse(statement.op + " is not an assembly statement");
  if (statement.args.size() < spec->minArgs || statement.args.size() > spec->maxArgs) {
    return refuse(statement.op + " takes " + std::to_string(spec->minArgs) + " to " +
                  std::to_string(spec->maxArgs) + " arguments");
  }
  if (statement.op == "COMPONENT") return applyComponent(current, statement, document);
  if (statement.op == "GROUND") return applyGround(current, statement);
  if (statement.op == "JOINT") return applyJoint(current, statement);
  if (statement.op == "MATE") return applyMate(current, statement);
  if (statement.op == "DRIVE") return applyDrive(current, statement);
  if (statement.op == "REMOVE") return applyRemove(current, statement);
  return refuse(statement.op + " is not an assembly statement");
}

bool performAssemblyStatement(PartDocument& document, UndoStack& undo,
                              assembly::AssemblySolver* solver, const IrLine& statement,
                              std::string& reason) {
  const AssemblyStatementResult r = applyAssemblyStatement(document.assembly(), statement, document);
  if (!r.ok) {
    reason = r.reason;
    return false;
  }
  const assembly::EditVerdict v = assembly::solveAndVerify(r.candidate, &document, solver, r.drives);
  if (!v.ok) {
    reason = v.reason;
    return false;
  }
  if (v.result == document.assembly()) {
    // A move to where the joint already is. Nothing changed, so nothing is
    // recorded -- an undo step that does nothing is a step a user wastes.
    reason.clear();
    return true;
  }
  if (!undo.perform(document, std::make_unique<AssemblyEdit>(v.result, r.label))) {
    reason = "the document refused the assembly edit";
    return false;
  }
  reason.clear();
  return true;
}

// ── registration ────────────────────────────────────────────────────────────

std::size_t registerAssemblyCommands(CommandRegistry& registry, PartDocument& doc,
                                     UndoStack& stack, AssemblySolverSlot& solver) {
  PartDocument* d = &doc;
  UndoStack* s = &stack;
  AssemblySolverSlot* slot = &solver;
  std::size_t added = 0;
  const auto add = [&registry, &added](CommandDescriptor c) {
    if (registry.add(std::move(c))) ++added;
  };

  // ── INSERT COMPONENT ──────────────────────────────────────────────────────
  // One placed instance of the picked solid. The selection IS the body: the
  // same typed reference every Part command consumes, so Archie's
  // "the newest solid" resolves here exactly as it does for a fillet.
  {
    CommandDescriptor c = base("assembly.insert_component", "Insert Component", "COMPONENT",
                               SelectionSignature::exactly(EntityKind::Body, 1));
    c.schema.push_back(ParamSpec{.name = "name", .type = ParamType::Text, .required = false});
    c.schema.push_back(ParamSpec{.name = "x", .type = ParamType::Number, .required = true,
                                 .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "y", .type = ParamType::Number, .required = true,
                                 .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "z", .type = ParamType::Number, .required = true,
                                 .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"rx", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"ry", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"rz", ParamType::Number, false, 0.0, ""});
    c.enabled = [d](const CommandContext& ctx) { return selectedSolid(*d, ctx.selection()) != 0; };
    c.execute = [d, s, slot](CommandContext& ctx) {
      const int body = selectedSolid(*d, ctx.selection());
      if (body == 0) {
        ctx.fail("pick exactly one solid body to place");
        return;
      }
      const std::string name = ctx.params().text("name").value_or(suggestedName(*d, body));
      std::vector<IrArg> args{IrArg::valueRef(body), IrArg::text(name),
                              IrArg::num(num(ctx, "x", 0.0)), IrArg::num(num(ctx, "y", 0.0)),
                              IrArg::num(num(ctx, "z", 0.0))};
      if (ctx.params().has("rx") || ctx.params().has("ry") || ctx.params().has("rz")) {
        args.push_back(IrArg::num(num(ctx, "rx", 0.0)));
        args.push_back(IrArg::num(num(ctx, "ry", 0.0)));
        args.push_back(IrArg::num(num(ctx, "rz", 0.0)));
      }
      commit(ctx, *d, *s, *slot, IrLine{0, "COMPONENT", std::move(args)});
    };
    add(std::move(c));
  }

  // ── GROUND ────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c =
        base("assembly.ground", "Ground Component", "GROUND", SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "component", .type = ParamType::Text, .required = true});
    c.schema.push_back(ParamSpec{.name = "grounded", .type = ParamType::Flag, .required = false,
                                 .hasDefault = true});
    c.enabled = [d](const CommandContext&) { return !d->assembly().components.empty(); };
    c.execute = [d, s, slot](CommandContext& ctx) {
      std::vector<IrArg> args{IrArg::text(txt(ctx, "component", ""))};
      if (!flagOr(ctx, "grounded", true)) args.push_back(IrArg::keyword("OFF"));
      commit(ctx, *d, *s, *slot, IrLine{0, "GROUND", std::move(args)});
    };
    add(std::move(c));
  }

  // ── ADD JOINT ─────────────────────────────────────────────────────────────
  // The joint is stated at ONE world point and axis; each component keeps the
  // frame in its own coordinates, so the joint travels with the parts.
  {
    CommandDescriptor c = base("assembly.add_joint", "Add Joint", "JOINT", SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "kind", .type = ParamType::Text, .required = true,
                                 .defaultText = "REVOLUTE", .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "first", .type = ParamType::Text, .required = true});
    c.schema.push_back(ParamSpec{.name = "second", .type = ParamType::Text, .required = true});
    c.schema.push_back(ParamSpec{.name = "x", .type = ParamType::Number, .required = true,
                                 .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "y", .type = ParamType::Number, .required = true,
                                 .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "z", .type = ParamType::Number, .required = true,
                                 .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"axis_x", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axis_y", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{"axis_z", ParamType::Number, false, 1.0, ""});
    c.schema.push_back(ParamSpec{"value", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{.name = "name", .type = ParamType::Text, .required = false});
    c.enabled = [d](const CommandContext&) { return d->assembly().components.size() >= 2; };
    c.execute = [d, s, slot](CommandContext& ctx) {
      JointKind kind = JointKind::Revolute;
      if (!assembly::jointKindFromKeyword(txt(ctx, "kind", "REVOLUTE"), kind)) {
        ctx.fail("a joint is fixed, revolute, slider, cylindrical, ball, planar, distance or "
                 "angle");
        return;
      }
      const std::string name = ctx.params().text("name").value_or(nextJointName(*d, kind));
      std::vector<IrArg> args{IrArg::keyword(assembly::keyword(kind)), IrArg::text(name),
                              IrArg::text(txt(ctx, "first", "")),
                              IrArg::text(txt(ctx, "second", "")),
                              IrArg::num(num(ctx, "x", 0.0)), IrArg::num(num(ctx, "y", 0.0)),
                              IrArg::num(num(ctx, "z", 0.0))};
      const bool hasAxis = ctx.params().has("axis_x") || ctx.params().has("axis_y") ||
                           ctx.params().has("axis_z");
      if (hasAxis || assembly::jointTakesValue(kind)) {
        args.push_back(IrArg::num(num(ctx, "axis_x", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axis_y", 0.0)));
        args.push_back(IrArg::num(num(ctx, "axis_z", 1.0)));
      }
      if (assembly::jointTakesValue(kind)) args.push_back(IrArg::num(num(ctx, "value", 0.0)));
      commit(ctx, *d, *s, *slot, IrLine{0, "JOINT", std::move(args)});
    };
    add(std::move(c));
  }

  // ── MATE ──────────────────────────────────────────────────────────────────
  // The same joint, stated where it is ON EACH PART rather than where it is in
  // the world: "this hole on the plate, that end of the pin". The components are
  // moved until it holds -- the way parts inserted anywhere are put together.
  {
    CommandDescriptor c = base("assembly.mate", "Mate Components", "MATE", SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "kind", .type = ParamType::Text, .required = true,
                                 .defaultText = "REVOLUTE", .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "first", .type = ParamType::Text, .required = true});
    c.schema.push_back(ParamSpec{.name = "second", .type = ParamType::Text, .required = true});
    c.schema.push_back(ParamSpec{.name = "first_x", .type = ParamType::Number, .required = true,
                                 .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "first_y", .type = ParamType::Number, .required = true,
                                 .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "first_z", .type = ParamType::Number, .required = true,
                                 .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "first_axis_x", .type = ParamType::Number, .required = true,
                                 .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "first_axis_y", .type = ParamType::Number, .required = true,
                                 .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "first_axis_z", .type = ParamType::Number, .required = true,
                                 .defaultNumber = 1.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "second_x", .type = ParamType::Number, .required = true,
                                 .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "second_y", .type = ParamType::Number, .required = true,
                                 .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "second_z", .type = ParamType::Number, .required = true,
                                 .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "second_axis_x", .type = ParamType::Number, .required = true,
                                 .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "second_axis_y", .type = ParamType::Number, .required = true,
                                 .defaultNumber = 0.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{.name = "second_axis_z", .type = ParamType::Number, .required = true,
                                 .defaultNumber = 1.0, .hasDefault = true});
    c.schema.push_back(ParamSpec{"value", ParamType::Number, false, 0.0, ""});
    c.schema.push_back(ParamSpec{.name = "name", .type = ParamType::Text, .required = false});
    c.enabled = [d](const CommandContext&) { return d->assembly().components.size() >= 2; };
    c.execute = [d, s, slot](CommandContext& ctx) {
      JointKind kind = JointKind::Revolute;
      if (!assembly::jointKindFromKeyword(txt(ctx, "kind", "REVOLUTE"), kind)) {
        ctx.fail("a joint is fixed, revolute, slider, cylindrical, ball, planar, distance or "
                 "angle");
        return;
      }
      const std::string name = ctx.params().text("name").value_or(nextJointName(*d, kind));
      std::vector<IrArg> args{IrArg::keyword(assembly::keyword(kind)), IrArg::text(name),
                              IrArg::text(txt(ctx, "first", "")),
                              IrArg::text(txt(ctx, "second", "")),
                              IrArg::num(num(ctx, "first_x", 0.0)),
                              IrArg::num(num(ctx, "first_y", 0.0)),
                              IrArg::num(num(ctx, "first_z", 0.0)),
                              IrArg::num(num(ctx, "first_axis_x", 0.0)),
                              IrArg::num(num(ctx, "first_axis_y", 0.0)),
                              IrArg::num(num(ctx, "first_axis_z", 1.0)),
                              IrArg::num(num(ctx, "second_x", 0.0)),
                              IrArg::num(num(ctx, "second_y", 0.0)),
                              IrArg::num(num(ctx, "second_z", 0.0)),
                              IrArg::num(num(ctx, "second_axis_x", 0.0)),
                              IrArg::num(num(ctx, "second_axis_y", 0.0)),
                              IrArg::num(num(ctx, "second_axis_z", 1.0))};
      if (assembly::jointTakesValue(kind)) args.push_back(IrArg::num(num(ctx, "value", 0.0)));
      commit(ctx, *d, *s, *slot, IrLine{0, "MATE", std::move(args)});
    };
    add(std::move(c));
  }

  // ── MOVE JOINT ────────────────────────────────────────────────────────────
  // Turn a hinge to an angle or slide a slider to an offset. The solver walks
  // the whole mechanism there; anything the joint drags along moves with it.
  {
    CommandDescriptor c = base("assembly.move_joint", "Move Joint", "DRIVE", SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "joint", .type = ParamType::Text, .required = true});
    c.schema.push_back(ParamSpec{.name = "value", .type = ParamType::Number, .required = true});
    c.schema.push_back(ParamSpec{.name = "slide", .type = ParamType::Flag, .required = false,
                                 .hasDefault = true});
    c.enabled = [d](const CommandContext&) {
      for (const Joint& j : d->assembly().joints) {
        if (assembly::jointTurns(j.kind) || assembly::jointSlides(j.kind)) return true;
      }
      return false;
    };
    c.execute = [d, s, slot](CommandContext& ctx) {
      std::vector<IrArg> args{IrArg::text(txt(ctx, "joint", "")), IrArg::num(num(ctx, "value", 0.0))};
      if (ctx.params().has("slide")) {
        args.push_back(IrArg::keyword(flagOr(ctx, "slide", false) ? "SLIDE" : "TURN"));
      }
      commit(ctx, *d, *s, *slot, IrLine{0, "DRIVE", std::move(args)});
    };
    add(std::move(c));
  }

  // ── REMOVE ────────────────────────────────────────────────────────────────
  {
    CommandDescriptor c =
        base("assembly.remove", "Remove From Assembly", "REMOVE", SelectionSignature::none());
    c.schema.push_back(ParamSpec{.name = "name", .type = ParamType::Text, .required = true});
    c.enabled = [d](const CommandContext&) { return !d->assembly().empty(); };
    c.execute = [d, s, slot](CommandContext& ctx) {
      commit(ctx, *d, *s, *slot, IrLine{0, "REMOVE", {IrArg::text(txt(ctx, "name", ""))}});
    };
    add(std::move(c));
  }

  return added;
}

const std::vector<std::string>& assemblyCommandIds() {
  static const std::vector<std::string> ids = {
      "assembly.add_joint", "assembly.ground", "assembly.insert_component",
      "assembly.mate",      "assembly.move_joint", "assembly.remove",
  };
  return ids;
}

// ── the tree view ───────────────────────────────────────────────────────────

AssemblyTreeView buildAssemblyTreeView(const PartDocument& document) {
  AssemblyTreeView view;
  const Assembly& a = document.assembly();
  view.empty = a.empty();
  if (view.empty) {
    view.summary = "no components yet";
    return view;
  }
  const assembly::AssemblyStatus status = assembly::assessAssembly(a, document);
  view.summary = status.summary;
  view.trouble = !status.validity.ok() || !status.everyJointHolds;

  for (const Component& c : a.components) {
    AssemblyTreeRow row;
    row.id = c.id;
    row.label = c.name;
    row.grounded = c.grounded;
    row.statement = assembly::statementFor(c);
    const FeatureRecord* rec = document.featureAt(c.body);
    if (rec == nullptr || rec->produces != IrValueKind::Solid) {
      row.problem = true;
      row.detail = "its body is no longer in this part";
    } else {
      row.detail = assembly::bodyName(document, c.body);
      if (c.grounded) row.detail += ", grounded";
    }
    view.components.push_back(std::move(row));
  }

  std::vector<int> redundant;
  for (const assembly::Freedom::Redundancy& r : status.freedom.redundancies) {
    if (r.jointId != 0) redundant.push_back(r.jointId);
  }
  for (std::size_t i = 0; i < a.joints.size(); ++i) {
    const Joint& j = a.joints[i];
    AssemblyTreeRow row;
    row.id = j.id;
    row.label = j.name;
    row.statement = assembly::statementFor(a, j);
    const Component* f = a.component(j.first);
    const Component* s = a.component(j.second);
    row.detail = std::string(assembly::userWord(j.kind)) + ": " +
                 (f != nullptr ? f->name : std::string("?")) + " to " +
                 (s != nullptr ? s->name : std::string("?"));
    if (j.kind == JointKind::Distance) row.detail += ", " + formatIrNumber(j.value) + " mm apart";
    if (j.kind == JointKind::Angle) row.detail += ", " + formatIrNumber(j.value) + " degrees";
    const bool holds = i < status.joints.size() && status.joints[i].holds;
    if (!holds) {
      row.problem = true;
      row.detail += " -- does not hold";
    } else if (std::find(redundant.begin(), redundant.end(), j.id) != redundant.end()) {
      row.detail += " -- adds nothing the others do not already hold";
    }
    view.joints.push_back(std::move(row));
  }
  view.bom = assembly::billOfMaterials(a, document);
  return view;
}

}  // namespace forge::ui
