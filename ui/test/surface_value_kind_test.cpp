// ui/test/surface_value_kind_test.cpp
//
// THE FOURTH IR VALUE KIND — `SURFACE` — proved at the forge::ui half of the seam.
//
// WHY A NEW KIND NEEDS ITS OWN GATE
//   The IR had exactly three value kinds (PROFILE, WIRE, SOLID) and that was the
//   STRUCTURAL reason the product had no surfacing: a surface was not
//   representable as a value, so no op could produce or consume one, so ~200 files
//   of NURBS / sweep / G2 / loft / subdivision machinery in forge-kernel had no
//   route into the emission target at all. Adding a kind is only safe if every
//   site that switches on the kind was found, so the checks below walk the kind
//   set exhaustively rather than naming `Surface` and hoping.
//
// WHAT IS DELIBERATELY *NOT* CHECKED HERE
//   Geometry. This gate is headless and OCCT-free, exactly like its neighbours;
//   the text-level agreement between forge::ui and forge::ft::parse() is proved by
//   forge-kernel/test/ft/build_surface_round_trip.sh, which links the real parser.
//
// ── THE BINDING CONSTRAINT THIS GATE ENFORCES ───────────────────────────────
//   "Don't gate anything; if you do that, how will Archie generate ultra-long
//   feature trees for the kernel to execute?"
//   A vocabulary or validator that REFUSES input is a capability gate wearing a
//   safety hat, and it fires hardest on the longest, densest, most curved trees.
//   So section 4 below asserts what must be ACCEPTED — a sheet with no faces, a
//   selector that matches nothing, a sew of a single sheet — as first-class
//   checks, not as commentary. A gate that only proves refusals will happily
//   ratchet the language shut.
#include <algorithm>
#include <string>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/OpConstraintBridge.hpp"
#include "forge/ui/PartCommands.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

// EVERY kind, listed once. This vector is the test's own transcription of the
// enum and it exists so a kind added without a name shows up as a duplicate or an
// empty string below rather than as nothing at all.
const std::vector<IrValueKind>& allKinds() {
  static const std::vector<IrValueKind> kinds = {IrValueKind::None, IrValueKind::Profile,
                                                 IrValueKind::Wire, IrValueKind::Solid,
                                                 IrValueKind::Surface};
  return kinds;
}

// The six ops that give the SURFACE kind producers and consumers. Without both
// directions the kind is a dead end: SOLID -> SURFACE is FACES, SURFACE -> SOLID
// is THICKEN / CAP.
const std::vector<std::string>& surfaceOps() {
  static const std::vector<std::string> ops = {"SKIN", "FACES",  "SEW",
                                               "THICKEN", "CAP", "SURFCHECK"};
  return ops;
}

bool contains(const std::vector<std::string>& v, const std::string& s) {
  return std::find(v.begin(), v.end(), s) != v.end();
}

}  // namespace

int main() {
  Harness H("surface_value_kind");

  // ── 1. the kind is NAMED, and the naming is total ─────────────────────────
  // toString is the only mapping between the enum and every text form of a value
  // kind in this codebase: OpConstraintBridge.cpp's mapValueKind case-folds the
  // vocabulary's spelling against it, and forge-desktop/src/PartFile.cpp reads a
  // saved document back through the same words. A kind toString cannot name is a
  // kind that silently becomes `None` three layers away.
  CHECK_EQ_STR(std::string(toString(IrValueKind::Surface)), "surface");
  {
    std::vector<std::string> names;
    for (const IrValueKind k : allKinds()) {
      const std::string n = toString(k);
      CHECK(!n.empty());
      CHECK(!contains(names, n));  // distinct: two kinds sharing a word are one kind
      names.push_back(n);
    }
    CHECK_EQ_INT(names.size(), 5);
  }

  // ── 2. a document can HOLD one ────────────────────────────────────────────
  // PartDocument is the receiver every command writes into. If it cannot bind a
  // node to a SURFACE value, the kind exists in the type system and nowhere else.
  {
    PartDocument doc;
    CHECK_EQ_INT(doc.seed(IrValueKind::Profile, "sketch_1", "RECT",
                          {IrArg::num(40), IrArg::num(30)}),
                 1);
    CHECK_EQ_INT(doc.seed(IrValueKind::Solid, "body_1", "BOX",
                          {IrArg::num(20), IrArg::num(20), IrArg::num(20)}),
                 2);
    const int sheet = doc.seed(IrValueKind::Surface, "sheet_1", "FACES",
                               {IrArg::valueRef(2), IrArg::text("+z")});
    CHECK_EQ_INT(sheet, 3);
    CHECK_EQ_INT(static_cast<int>(doc.kindOf(sheet)), static_cast<int>(IrValueKind::Surface));
    CHECK_EQ_INT(doc.valueFor("sheet_1"), 3);
    // and the other bindings are untouched by the new kind's arrival
    CHECK_EQ_INT(static_cast<int>(doc.kindOf(1)), static_cast<int>(IrValueKind::Profile));
    CHECK_EQ_INT(static_cast<int>(doc.kindOf(2)), static_cast<int>(IrValueKind::Solid));
    CHECK_EQ_INT(static_cast<int>(doc.kindOf(99)), static_cast<int>(IrValueKind::None));
  }

  // ── 3. every surface op ROUND-TRIPS through the text IR ───────────────────
  // `%N = OP(...)` is the whole contract, so the assertion is on the exact string.
  // The point of the SURFACE kind is that it needs NO grammar change: a sheet is
  // just a `%N` whose kind is Surface, so the printer that already exists prints
  // it and the parser that already exists reads it.
  {
    const struct { IrLine line; const char* text; } cases[] = {
        {{3, "SKIN", {IrArg::valueRef(1), IrArg::valueRef(2)}}, "%3 = SKIN(%1, %2)"},
        {{4, "SKIN", {IrArg::valueRef(1), IrArg::valueRef(2), IrArg::keyword("RULED")}},
         "%4 = SKIN(%1, %2, RULED)"},
        {{2, "FACES", {IrArg::valueRef(1), IrArg::text("bore:r=47.5")}},
         "%2 = FACES(%1, \"bore:r=47.5\")"},
        {{3, "SEW", {IrArg::valueRef(2)}}, "%3 = SEW(%2)"},
        {{4, "SEW", {IrArg::valueRef(2), IrArg::valueRef(3), IrArg::num(0.01)}},
         "%4 = SEW(%2, %3, 0.01)"},
        {{5, "THICKEN", {IrArg::valueRef(4), IrArg::num(2.5)}}, "%5 = THICKEN(%4, 2.5)"},
        {{6, "THICKEN", {IrArg::valueRef(4), IrArg::num(2.5), IrArg::keyword("OUT")}},
         "%6 = THICKEN(%4, 2.5, OUT)"},
        {{5, "CAP", {IrArg::valueRef(4)}}, "%5 = CAP(%4)"},
        {{7, "SURFCHECK", {IrArg::valueRef(6), IrArg::text("freeEdges=0"),
                           IrArg::text("freeform>=1")}},
         "%7 = SURFCHECK(%6, \"freeEdges=0\", \"freeform>=1\")"},
    };
    for (const auto& c : cases) {
      CHECK_EQ_STR(c.line.text(), c.text);
      CHECK_EQ_INT(static_cast<int>(validateIr(c.line)), static_cast<int>(IrCheck::Ok));
    }
  }

  // ── 4. TOLERANCE — the statements that MUST be accepted ───────────────────
  // Each of these is a degenerate or awkward surface the emitter has every reason
  // to write, and each was chosen because a "sensible" validator would be tempted
  // to refuse it. Refusing any of them turns the SURFACE kind into a gate.
  {
    // A selector that will match nothing is a perfectly legal STATEMENT. Whether
    // it matches is a question for the live face inventory at compile time, and
    // the answer is an EMPTY sheet, not a syntax error.
    const IrLine miss{2, "FACES", {IrArg::valueRef(1), IrArg::text("bore:r=99999")}};
    CHECK_EQ_INT(static_cast<int>(validateIr(miss)), static_cast<int>(IrCheck::Ok));

    // SEW of ONE sheet: re-stitching a single unsewn face set is the common case
    // after FACES, and a minimum arity of 2 would have made it inexpressible.
    const IrLine one{3, "SEW", {IrArg::valueRef(2)}};
    CHECK_EQ_INT(static_cast<int>(validateIr(one)), static_cast<int>(IrCheck::Ok));
    CHECK_EQ_INT(findIrOp("SEW")->minArgs, 1);

    // Asserting that a sheet is BROKEN is a legal assertion. A check vocabulary
    // that can only say "0 free edges" cannot describe the part you were handed.
    const IrLine broken{4, "SURFCHECK", {IrArg::valueRef(3), IrArg::text("freeEdges>=1"),
                                         IrArg::text("pcurves>=1"),
                                         IrArg::text("selfIntersect=1")}};
    CHECK_EQ_INT(static_cast<int>(validateIr(broken)), static_cast<int>(IrCheck::Ok));

    // Unbounded arity where the kernel documents it: SKIN over many sections and
    // SURFCHECK with many assertions must not hit a ceiling.
    CHECK(findIrOp("SKIN")->maxArgs == kIrArgsUnbounded);
    CHECK(findIrOp("SEW")->maxArgs == kIrArgsUnbounded);
    CHECK(findIrOp("SURFCHECK")->maxArgs == kIrArgsUnbounded);
    IrLine wide{40, "SKIN", {}};
    for (int i = 1; i < 40; ++i) wide.args.push_back(IrArg::valueRef(i));
    CHECK_EQ_INT(static_cast<int>(validateIr(wide)), static_cast<int>(IrCheck::Ok));
  }

  // ── 5. …and the rules that must still FIRE ────────────────────────────────
  // Tolerance is not permissiveness. A validator that accepts everything cannot
  // tell an emitter what it got wrong, and every rule below is one the kernel
  // itself enforces, so accepting it here would only move the failure later.
  {
    const IrLine few{5, "THICKEN", {IrArg::valueRef(4)}};
    CHECK_EQ_INT(static_cast<int>(validateIr(few)), static_cast<int>(IrCheck::TooFewArgs));

    const IrLine many{5, "CAP", {IrArg::valueRef(4), IrArg::num(0.01), IrArg::num(2)}};
    CHECK_EQ_INT(static_cast<int>(validateIr(many)), static_cast<int>(IrCheck::TooManyArgs));

    const IrLine notRef{2, "FACES", {IrArg::num(1), IrArg::text("+z")}};
    CHECK_EQ_INT(static_cast<int>(validateIr(notRef)),
                 static_cast<int>(IrCheck::FirstArgNotValueRef));

    // Creation order == evaluation order: a sheet cannot be thickened before it
    // exists, and this is the one arity-independent rule the parser cannot fix up.
    const IrLine fwd{5, "THICKEN", {IrArg::valueRef(9), IrArg::num(2)}};
    CHECK_EQ_INT(static_cast<int>(validateIr(fwd)), static_cast<int>(IrCheck::ForwardValueRef));
  }

  // ── 6. the generated vocabulary still maps EVERY spelling ─────────────────
  // `unmappedSpellings` is how the bridge reports "the vocabulary names a value
  // kind this build cannot map". It is non-empty exactly when the enum and the
  // generated table have diverged — which is what adding a kind risks.
  {
    const OpVocabulary& v = generatedVocabulary();
    CHECK_EQ_INT(v.unmappedSpellings.size(), 0);
    CHECK_EQ_INT(v.kernelOpCount, irOpTable().size());
  }

  // ── 7. the six ops are KNOWN to the kernel and FORBIDDEN to the user ──────
  // This is the honest state of the seam and it is asserted rather than described.
  // `UnknownOp` and `ForbiddenOp` are different facts: "no such op anywhere" and
  // "the kernel has it and no forge::ui command emits it yet" need different
  // fixes, and the second one is a UI gap, not an IR gap.
  //
  // NOTE FOR THE READER: this is the one place the SURFACE work still meets a
  // gate, and it is the pre-existing app-surface policy (D-021), not a new rule
  // about surfaces. It lifts the moment a command emits these ops.
  {
    const OpConstraintBridge bridge;
    for (const std::string& op : surfaceOps()) {
      CHECK(findIrOp(op) != nullptr);              // the kernel table HAS it
      CHECK(!bridge.allows(op));                   // no user command emits it yet
      CHECK(contains(bridge.forbiddenOps(), op));  // and it says so by name

      ProposedOp p;
      p.line = IrLine{2, op, {IrArg::valueRef(1), IrArg::num(1)}};
      const OpRuling r = bridge.check(p);
      CHECK_EQ_INT(static_cast<int>(r.verdict), static_cast<int>(OpConstraint::ForbiddenOp));
      CHECK(r.reason.find(op) != std::string::npos);  // the refusal names the op
    }
    // A name that is in NO table is a different verdict, and the distinction is
    // the whole reason ForbiddenOp exists as its own value.
    ProposedOp bogus;
    bogus.line = IrLine{1, "SURFACIFY", {}};
    CHECK_EQ_INT(static_cast<int>(bridge.check(bogus).verdict),
                 static_cast<int>(OpConstraint::UnknownOp));
  }

  return H.finish();
}
