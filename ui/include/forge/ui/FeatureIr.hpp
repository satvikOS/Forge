// ui/include/forge/ui/FeatureIr.hpp
//
// The UI's half of the s19.2.1 seam: a command does not "call the kernel", it
// EMITS ONE LINE OF FEATURE-IR. That line is the contract between forge::ui and
// forge::ft — the same text the Archie VLM emits and `forge::ft::parse()` reads:
//
//     %<id> = OP(arg, arg, ...)
//
// with args being numbers, prior-value refs `%N`, bare keywords (ALL, LINEAR,
// XY) and quoted selector strings. The grammar, the op set and the per-op
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
// Mirrors forge::ft::TokKind (Number, Ref, Keyword, Str). `Points` is not
// modelled: no Part-workspace command emits a point ring today, and a token
// kind nothing produces is a liability, not coverage.
enum class IrArgKind : std::uint8_t { Number, Ref, Keyword, Text };

struct IrArg {
  IrArgKind kind = IrArgKind::Number;
  double number = 0.0;
  int ref = 0;            // kind == Ref: a prior op's 1-based creation id
  std::string word;       // kind == Keyword (bare) or Text (emitted quoted)

  static IrArg num(double v);
  static IrArg valueRef(int id);
  static IrArg keyword(std::string k);
  static IrArg text(std::string s);

  std::string token() const;
};

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
enum class IrCheck : std::uint8_t {
  Ok = 0,
  EmptyOp,
  UnknownOp,
  BadStatementId,
  TooFewArgs,
  TooManyArgs,
  FirstArgNotValueRef,
  ForwardValueRef,
};

const char* toString(IrCheck check) noexcept;
IrCheck validateIr(const IrLine& line);

// Deterministic, round-trippable through std::strtod (which is what
// forge::ft's parseDouble uses). 12.0 -> "12", 2.5 -> "2.5".
std::string formatIrNumber(double v);

}  // namespace forge::ui

#endif  // FORGE_UI_FEATUREIR_HPP
