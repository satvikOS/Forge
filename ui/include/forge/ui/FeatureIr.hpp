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

// One vertex of a point ring. The kernel stores every ring as Point3 and records
// the SOURCE dimension separately (forge::ft::Token::dim), because `[x y; ...]`
// and `[x y 0; ...]` are different statements: POLY reads a 2D ring on Z=0, WIRE
// reads a 3D one, and the tokenizer decides which from the first point's arity.
struct IrPoint {
  double x = 0.0, y = 0.0, z = 0.0;
};

// ── one argument ────────────────────────────────────────────────────────────
// Mirrors forge::ft::TokKind (Number, Ref, Keyword, Str, Points) — ALL FIVE.
//
// `Points` was deliberately absent while nothing produced a ring: "a token kind
// nothing produces is a liability, not coverage". The sketcher produces one. A
// solved sketch is an arbitrary closed loop of lines and arcs, and the only ops
// in the kernel table that can carry an arbitrary loop are POLY([x y; ...]) ->
// PROFILE and WIRE([x y z; ...]) -> WIRE. Without this token a sketcher could
// author geometry the IR cannot name, which is the one thing the s19.2.1 seam
// exists to prevent.
enum class IrArgKind : std::uint8_t { Number, Ref, Keyword, Text, Points };

struct IrArg {
  IrArgKind kind = IrArgKind::Number;
  double number = 0.0;
  int ref = 0;            // kind == Ref: a prior op's 1-based creation id
  std::string word;       // kind == Keyword (bare) or Text (emitted quoted)
  std::vector<IrPoint> points;  // kind == Points
  int pointDim = 0;             // kind == Points: 2 (x y) or 3 (x y z), never else

  static IrArg num(double v);
  static IrArg valueRef(int id);
  static IrArg keyword(std::string k);
  static IrArg text(std::string s);
  // `dim` SELECTS THE SPELLING, and the spelling is not cosmetic: the kernel's
  // tokenizer takes `got >= 3` on the FIRST point as the ring's dimension, so a
  // 2D ring written with a trailing zero is read as a 3D ring — legal for WIRE,
  // and refused by POLY's `x y` reader.
  static IrArg pointRing(std::vector<IrPoint> pts, int dim);

  std::string token() const;
  std::string pointsToken() const;  // "[x y; x y]" — only meaningful for Points
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
  // APPENDED, never inserted — the values above are compared as ints in the
  // gates and stored in macros, so renumbering would change what a recorded
  // check means.
  //
  // DegeneratePointRing — a Points argument no op that takes one could use. The
  // kernel refuses these at parse time and says so ("POLY needs >= 3 points",
  // "empty point list", "point needs `x y` or `x y z`"): fewer than three
  // vertices is not a closed ring in any of the three ops that read one, and a
  // dimension other than 2 or 3 is not a spelling the tokenizer has. Caught here
  // so the statement never reaches the document, with the rule NAMED — a repair
  // loop can act on "degenerate_point_ring", not on "invalid".
  DegeneratePointRing,
};

const char* toString(IrCheck check) noexcept;
IrCheck validateIr(const IrLine& line);

// Deterministic, round-trippable through std::strtod (which is what
// forge::ft's parseDouble uses). 12.0 -> "12", 2.5 -> "2.5".
std::string formatIrNumber(double v);

}  // namespace forge::ui

#endif  // FORGE_UI_FEATUREIR_HPP
