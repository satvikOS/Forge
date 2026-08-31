// ui/include/forge/ui/FeatureIr.hpp
//
// The UI's half of the s19.2.1 seam: a command does not "call the kernel", it
// EMITS ONE LINE OF FEATURE-IR. That line is the contract between forge::ui and
// forge::ft — the same text the Archie VLM emits and `forge::ft::parse()` reads:
//
//     %<id> = OP(arg, arg, ...)
//
// with args being numbers, prior-value refs `%N`, bare keywords (ALL, LINEAR,
// XY), quoted selector strings and point rings `[x y z; x y z; ...]`. The
// grammar, the op set and the per-op
// argument lists are DEFINED in forge-kernel/include/forge/ft/FeatureTree.hpp;
// nothing here may invent an op or an arity. `ui/test/feature_ir_test.cpp`
// re-derives the whole table straight out of that kernel header and fails if
// this file has drifted from it by so much as one optional argument — a UI that
// emits IR the kernel would reject is worse than a UI that emits none, because
// it looks like progress.
//
// This header deliberately knows nothing about commands, selection or ImGui: it
// is a value type plus a validator, so it compiles and runs headless.
#ifndef FORGE_UI_FEATUREIR_HPP
#define FORGE_UI_FEATUREIR_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace forge::ui {

// LOFT(%w0, %w1 [, %w2 ...]) and VERIFY(%body, "expr", ...) take unboundedly
// many arguments; every other op has a hard ceiling.
inline constexpr std::size_t kIrArgsUnbounded = static_cast<std::size_t>(-1);

// ── one argument ────────────────────────────────────────────────────────────
// Mirrors forge::ft::TokKind (Number, Ref, Keyword, Str, Points).
//
// `Points` used to be absent, and the reason recorded here was "no Part-workspace
// command emits a point ring today, and a token kind nothing produces is a
// liability, not coverage". That reason was correct and it was CIRCULAR: WIRE and
// SWEEP are the only two ops whose arguments are point rings, so no command could
// emit one without the token, and the token was withheld because no command
// emitted one. `part.wire_section` and `part.sweep_pipe` break the circle, and the
// kind is modelled exactly as far as they need it -- 2D or 3D, semicolon-separated,
// which is the whole of the kernel's grammar for it.
enum class IrArgKind : std::uint8_t { Number, Ref, Keyword, Text, Points };

struct IrArg {
  IrArgKind kind = IrArgKind::Number;
  double number = 0.0;
  int ref = 0;            // kind == Ref: a prior op's 1-based creation id
  std::string word;       // kind == Keyword (bare) or Text (emitted quoted)
  // kind == Points: `dim` coordinates per point, flattened. Flat rather than a
  // vector of structs because that is how forge::part::profileWire and
  // pipeFromPolyline take it, and a second point type would be a second place to
  // get the stride wrong.
  std::vector<double> coords;
  std::size_t dim = 3;    // 2 or 3; meaningless unless kind == Points

  static IrArg num(double v);
  static IrArg valueRef(int id);
  static IrArg keyword(std::string k);
  static IrArg text(std::string s);
  // From the SPEC STRING a user types: "x y; x y; ..." / "x y z; x y z; ...".
  // A spec that does not parse yields an EMPTY point list rather than a
  // half-parsed one, and validateIr answers MalformedPointList for it -- so a
  // typo is a named refusal, never a wire with a point silently dropped.
  static IrArg points2(const std::string& spec);
  static IrArg points3(const std::string& spec);

  std::string token() const;
  // The inside of the brackets: "20 0 0; 0 20 0". Empty for every other kind.
  // This is what a .fpart writes, so the file grammar and the IR grammar are one
  // grammar with one parser.
  std::string pointSpec() const;
  std::size_t pointCount() const noexcept;
};

// Parse "x y[ z]; ..." into a flat coordinate vector of `dim`-tuples. ALL OR
// NOTHING: on any malformed point `out` is left empty and the answer is false,
// because a point list that silently lost its third point is a different wire.
// Numbers go through std::strtod, which is what forge::ft's parseDouble uses, and
// a non-finite value is refused -- "nan" parses, and a NaN coordinate is not a
// point.
bool parseIrPoints(const std::string& spec, std::size_t dim, std::vector<double>& out);

// Would `spec` make a legal point list of at least `minPoints` points? The
// question a command's enabled predicate asks, answered by the SAME parser the
// emission uses, so a greyed-out command and a refused statement can never
// disagree.
bool irPointsWellFormed(const std::string& spec, std::size_t dim, std::size_t minPoints);

// ── one statement ───────────────────────────────────────────────────────────
struct IrLine {
  int id = 0;                 // the 1-based creation id this statement defines
  std::string op;             // UPPERCASE op name, e.g. "FILLET"
  std::vector<IrArg> args;

  std::string text() const;   // "%4 = FILLET(%3, 2.5, ALL)"
};

// ── the kernel's op table, transcribed ──────────────────────────────────────
struct IrOpSpec {
  std::string name;
  std::size_t minArgs = 0;
  std::size_t maxArgs = 0;
  bool firstArgIsValueRef = false;  // the header writes the first arg as `%body`
};

const std::vector<IrOpSpec>& irOpTable();
const IrOpSpec* findIrOp(const std::string& name);

// ── validation ──────────────────────────────────────────────────────────────
// Everything here is a rule stated in FeatureTree.hpp, not a house style:
//   UnknownOp            — not in forge::ft::opFromName's table
//   TooFew/TooManyArgs   — outside the documented arg list for that op
//   FirstArgNotValueRef  — the header writes `OP(%body, ...)` and got a number
//   ForwardValueRef      — "Ops reference prior ids by %N. Creation order ==
//                           evaluation order." A ref to a later (or equal) id
//                           can never resolve.
//   MalformedPointList   — the kernel's tokenizer fails an empty point list
//                          ("empty point list") and a point with fewer than two
//                          coordinates ("point needs `x y` or `x y z`"), so a
//                          POINTS argument carrying neither is refused here
//                          rather than three layers down.
//
// APPENDED, never inserted: these values are compared as ints by the gates.
enum class IrCheck : std::uint8_t {
  Ok = 0,
  EmptyOp,
  UnknownOp,
  BadStatementId,
  TooFewArgs,
  TooManyArgs,
  FirstArgNotValueRef,
  ForwardValueRef,
  MalformedPointList,
};

const char* toString(IrCheck check) noexcept;
IrCheck validateIr(const IrLine& line);

// Deterministic, round-trippable through std::strtod (which is what
// forge::ft's parseDouble uses). 12.0 -> "12", 2.5 -> "2.5".
std::string formatIrNumber(double v);

}  // namespace forge::ui

#endif  // FORGE_UI_FEATUREIR_HPP
