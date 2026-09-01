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

// ── one point of a ring ─────────────────────────────────────────────────────
// Mirrors forge::ft::Point3. A 2D ring stores z = 0 and is WRITTEN with two
// coordinates per point; `IrArg::dim` is what decides which, exactly as the
// kernel lexer's `tok.dim` does.
struct IrPoint {
  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
};

// ── one argument ────────────────────────────────────────────────────────────
// Mirrors forge::ft::TokKind (Number, Ref, Keyword, Str, Points).
//
// `Points` was deliberately ABSENT until three commands needed it, on the stated
// rule that "a token kind nothing produces is a liability, not coverage". That
// rule cut both ways and this is the other edge of it: POLY, WIRE and SWEEP are
// the only three kernel ops whose argument is a `[x y; ...]` ring, and while this
// enum had no such kind NO forge::ui command could spell any of them -- the
// vocabulary recorded all three as forbidden for a reason that was structural
// rather than "nobody has written the command yet". The kind is added here
// TOGETHER WITH the three commands that produce it, so it is never a kind
// nothing produces.
enum class IrArgKind : std::uint8_t { Number, Ref, Keyword, Text, Points };

struct IrArg {
  IrArgKind kind = IrArgKind::Number;
  double number = 0.0;
  int ref = 0;            // kind == Ref: a prior op's 1-based creation id
  std::string word;       // kind == Keyword (bare) or Text (emitted quoted)
  std::vector<IrPoint> pts;  // kind == Points: the ring, in order
  int dim = 0;               // kind == Points: 2 or 3 coordinates WRITTEN per point

  static IrArg num(double v);
  static IrArg valueRef(int id);
  static IrArg keyword(std::string k);
  static IrArg text(std::string s);
  // `dim` is 2 or 3 and is NOT inferred from the data here: a caller that means a
  // 2D ring and hands over points whose z happens to be 0 must still say so, because
  // `[x y; ...]` and `[x y z; ...]` are different tokens to forge::ft (a 2D ring is
  // lifted to z=0; a 3D one is placed) and guessing would let the difference turn on
  // whether a coordinate rounded to zero.
  static IrArg points(std::vector<IrPoint> ring, int dim);
  // The spelling a COMMAND uses: text in, one ring out, ONE statement of the
  // dimension. `IrArg::points(pts(...), 2)` would name the dim twice and two
  // statements of one fact are a defect waiting for an edit to disagree with
  // itself. It is also the form the vocabulary generator reads -- it matches
  // `IrArg::<factory>(` and then the inline `txt(ctx, "name", "fallback")`, so a
  // ring hoisted into a local would make it REFUSE rather than guess.
  static IrArg pointsFromText(const std::string& text, int dim);

  std::string token() const;
};

// Read a ring out of the text a user types: `x y; x y; ...` (dim 2) or
// `x y z; ...` (dim 3), whitespace-separated coordinates, `;`-separated points,
// a trailing `;` tolerated. NO brackets -- IrArg::token() writes those.
//
// Returns an EMPTY vector on anything it cannot read completely, including a
// point with too few coordinates or a non-finite one. Empty is the signal, so a
// caller's `enabled` predicate is the same expression as its `execute` guard and
// a half-parsed ring can never reach the document.
std::vector<IrPoint> parseIrPoints(const std::string& text, int dim);

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
  //   EmptyPointList      — forge::ft's lexer fails an empty `[]` outright
  //                         ("empty point list"), and POLY additionally refuses
  //                         fewer than three. An empty ring is not a small ring:
  //                         it is a statement the kernel cannot parse.
  EmptyPointList,
};

const char* toString(IrCheck check) noexcept;
IrCheck validateIr(const IrLine& line);

// Deterministic, round-trippable through std::strtod (which is what
// forge::ft's parseDouble uses). 12.0 -> "12", 2.5 -> "2.5".
std::string formatIrNumber(double v);

}  // namespace forge::ui

#endif  // FORGE_UI_FEATUREIR_HPP
