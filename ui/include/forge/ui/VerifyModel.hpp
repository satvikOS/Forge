// ui/include/forge/ui/VerifyModel.hpp
//
// THE VERIFY OP, AUTHORABLE AND INSPECTABLE.
//
// `VERIFY(%body, "faces=42", "holes=4")` asserts a MEASURED property of the live
// solid and fails the build when it does not hold. Archie leans on it hard —
// 533 uses in one 600-row emission set — and it is the single largest failure
// mode in that set: 41.3% of the failures are VERIFY assertions the emitter's
// OWN output does not satisfy. Not a geometry failure. A part is built, it is
// very often the RIGHT part, and the tree then claims something false about it.
//
// The cause is structural, not careless. Until this file existed there was no
// way, anywhere in the product, to find out what a body actually measures
// BEFORE committing an assertion about it: `VERIFY` was in `forbidden_ops` with
// the reason "no command in the forge::ui registry emits it", so a user could
// not author one, and the kernel's answer only arrived as a compile failure
// after the fact. Writing an assertion was guessing, and the measurement that
// would have settled it was one function call away in the same process.
//
// So this module does three things, and they are the same three things a repair
// loop needs:
//
//   1. PARSE  — read an assertion string exactly as forge::ft's opVerify reads
//               it, including the comparator search order and the alias table,
//               and say precisely why an unparsable one failed.
//   2. EVALUATE — measure it against a ShapeReport and report `got`, so the
//               panel shows PASS/FAIL for an assertion that has not been
//               committed to the document yet.
//   3. REPAIR — hand back the assertion that WOULD hold: `measuredAssertion()`
//               turns "holes=36" on a four-hole part into "holes=4". That is
//               the whole 41.3%, made a one-click fix instead of a rebuild.
//
// ── the vocabulary is the KERNEL's, and a gate keeps it that way ────────────
// Every accepted name here is one forge::ft::Builder::opVerify accepts, with the
// same aliases and the same comparator precedence. A UI that accepted a spelling
// the kernel refuses would let a user author a statement that cannot compile —
// worse than offering nothing, because it looks like it worked.
// ui/test/verify_model_test.cpp re-derives the accepted key set by reading
// forge-kernel/src/ft/FeatureTreeCompiler.cpp AS DATA (the same technique
// feature_ir_test.cpp uses on FeatureTree.hpp) and fails if this table has
// drifted from it by one name.
//
// ── refusing is a last resort ───────────────────────────────────────────────
// The owner's constraint is that nothing may REFUSE input, because a refusal
// fires hardest on the longest, densest trees. So an assertion whose quantity
// this model cannot measure is NOT rejected: it comes back `Unsupported`, with
// the reason named, and it is still emitted into the IR — the kernel is the
// authority on what it can measure, and a UI that will not pass through a
// quantity the kernel added yesterday is a capability gate wearing a safety hat.
// Only a string with NO comparator, or no parsable number, is unparsable, and
// that one really is unusable: there is no assertion in it.
#ifndef FORGE_UI_VERIFYMODEL_HPP
#define FORGE_UI_VERIFYMODEL_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/ShapeReport.hpp"

namespace forge::ui {

// ── the comparators, in the kernel's search order ───────────────────────────
// opVerify scans for "<=", ">=", "=", "<", ">" IN THAT ORDER and takes the
// first that occurs. The order is load-bearing: "volume<=100" contains '=' at
// index 7, and a naive scan that looked for '=' first would read the key as
// "volume<" and refuse the statement. Reproduced, not re-derived.
enum class VerifyComparator : std::uint8_t { Le, Ge, Eq, Lt, Gt };

const char* toString(VerifyComparator cmp) noexcept;

// ── the quantities ──────────────────────────────────────────────────────────
// `Bbox` and `Bore` are FAMILIES: the axis (and, for a bbox, whether the
// assertion is about an EXTENT or an extreme COORDINATE) lives in the parsed
// assertion rather than in a separate enumerator per spelling, because
// `bbox.xmin`, `bbox.x` and `-x` are one quantity asked three ways.
enum class VerifyQuantity : std::uint8_t {
  Unknown = 0,
  FaceCount,
  EdgeCount,
  VertexCount,
  Volume,
  SurfaceArea,
  HoleCount,
  RadialCount,
  Genus,
  ShellCount,
  Bbox,
  CentreOfMass,
  BoreExtreme,
};

// What a bbox assertion is about.
enum class BboxAspect : std::uint8_t { Extent, Min, Max };

// Which end of the hole census, and in what units. Kept explicit because
// "the largest bore" is ambiguous between radius and diameter, and a drawing
// states diameters while the kernel's face inventory stores radii — silently
// picking one is how a 5 mm edit becomes a 10 mm edit.
enum class BoreExtremeKind : std::uint8_t { MaxDiameter, MinDiameter, MaxRadius, MinRadius };

// ── one parsed assertion ────────────────────────────────────────────────────
struct VerifyAssertion {
  bool parsed = false;      // a key, a comparator and a number were all found
  std::string source;       // the text exactly as written
  std::string key;          // lower-cased, trimmed — what the kernel compares
  VerifyComparator comparator = VerifyComparator::Eq;
  double want = 0.0;

  VerifyQuantity quantity = VerifyQuantity::Unknown;
  std::size_t axis = 0;                                     // Bbox / CentreOfMass: 0=x 1=y 2=z
  BboxAspect aspect = BboxAspect::Extent;                   // Bbox only
  BoreExtremeKind boreKind = BoreExtremeKind::MaxDiameter;  // BoreExtreme only

  // Why the parse failed, empty when it did not. This text is shown to the user
  // AND handed to a repair loop, so it names what may be written instead rather
  // than only saying no.
  std::string error;

  // The canonical text this assertion emits: "faces=42". Round-trips through
  // parseVerifyAssertion() to an equal assertion, which is what makes an
  // authored assertion and a repaired one the same kind of thing.
  std::string text() const;
};

// The kernel's own tolerance rule, reproduced: an equality holds within
// max(1e-6, 1e-3 * |want|), and the two STRICT comparators use no tolerance at
// all. A UI that showed PASS where the kernel computes FAIL would be worse than
// showing nothing.
double verifyTolerance(double want) noexcept;

// ── the outcome of measuring one assertion ──────────────────────────────────
enum class VerifyStatus : std::uint8_t {
  Pass,
  Fail,
  Unparsable,   // no comparator, or no number: there is no assertion here
  Unsupported,  // a quantity this model cannot measure — still emitted
  Unmeasured,   // the quantity is measurable in principle, but this report
                // has no value for it (the tree did not build, or the census
                // is absent)
};

const char* toString(VerifyStatus status) noexcept;

struct VerifyResult {
  VerifyStatus status = VerifyStatus::Unparsable;
  double got = 0.0;
  bool hasGot = false;  // `got` means something
  std::string note;     // why, when the status is not Pass/Fail

  bool ok() const noexcept { return status == VerifyStatus::Pass; }
};

// ── the vocabulary, as data ─────────────────────────────────────────────────
struct VerifyQuantitySpec {
  std::string canonical;              // the spelling this model emits
  std::vector<std::string> aliases;   // every other spelling the kernel accepts
  VerifyQuantity quantity = VerifyQuantity::Unknown;
  std::string unit;                   // "count", "mm", "mm2", "mm3", ""
  std::string description;
  // Can forge::ui measure it from a ShapeReport? A quantity the KERNEL can
  // assert but the app cannot yet measure is listed with false rather than
  // omitted — the panel then says "the kernel checks this, I cannot preview
  // it", which is a true statement, and hiding the row would not be.
  bool previewable = true;
};

const std::vector<VerifyQuantitySpec>& verifyVocabulary();

// Every spelling, sorted — the list opVerify's "unknown quantity" error names.
std::vector<std::string> verifyQuantityNames();

// ── parse / evaluate / repair ───────────────────────────────────────────────
VerifyAssertion parseVerifyAssertion(const std::string& text);

VerifyResult evaluateVerify(const VerifyAssertion& assertion, const ShapeReport& report);

// Convenience: parse then evaluate.
VerifyResult checkVerify(const std::string& text, const ShapeReport& report);

// The assertion that WOULD hold, given this report — the repair. Returns an
// assertion with parsed=false when the quantity cannot be measured here, because
// inventing a value for it would be exactly the fabrication this whole module
// exists to stop. The comparator is preserved: repairing "volume<=100" on a part
// of volume 140 gives "volume<=140", not "volume=140".
VerifyAssertion measuredAssertion(const VerifyAssertion& assertion, const ShapeReport& report);

// ── the statement ───────────────────────────────────────────────────────────
// `VERIFY(%body, "a", "b", ...)`. The IrArg list, ready for a command handler;
// the caller supplies the body ref. Assertions are emitted in the order given —
// a repair loop reads the kernel's verify[] log positionally.
std::vector<IrArg> verifyIrArgs(int bodyRef, const std::vector<std::string>& assertions);

// ── inspecting what the KERNEL said ─────────────────────────────────────────
// forge::ft records one line per assertion in CompileResult::verify, spelled
// "PASS <expr> (got <n>)" / "FAIL <expr> (got <n>)". Reading it back is what
// lets the app show the kernel's own verdict beside its own preview, and lets a
// gate prove the two agree.
struct VerifyLogEntry {
  bool recognised = false;  // the line had the documented shape
  bool pass = false;
  std::string expression;
  double got = 0.0;
  bool hasGot = false;
  std::string raw;
};

VerifyLogEntry parseVerifyLogLine(const std::string& line);
std::vector<VerifyLogEntry> parseVerifyLog(const std::vector<std::string>& lines);

// ── the authoring session ───────────────────────────────────────────────────
// What the VERIFY panel holds while a user builds a statement: a list of
// assertion strings, each with its live result against the current report. It is
// a MODEL, not a widget — the panel renders rows() and calls the mutators, and a
// headless gate drives exactly the same object.
//
// The mutators are all "record the intent" shaped: none of them can be called
// from inside a frame walk over rows(), because rows() returns a snapshot by
// value. That is deliberate — mid-walk container mutation is the defect class
// that has shipped three crashes in this application.
class VerifyDraft {
 public:
  struct Row {
    std::string text;
    VerifyAssertion assertion;
    VerifyResult result;
  };

  // Appends. Returns false and changes NOTHING when the text has no assertion
  // in it at all — an empty row in a list of claims is a claim about nothing.
  bool add(const std::string& text);
  bool replace(std::size_t index, const std::string& text);
  bool remove(std::size_t index);
  void clear() noexcept;

  std::size_t size() const noexcept { return texts_.size(); }
  bool empty() const noexcept { return texts_.empty(); }
  const std::vector<std::string>& texts() const noexcept { return texts_; }

  // Every row measured against `report`. A snapshot by value: a caller iterating
  // it may safely call add()/remove() on this object, because it is not walking
  // the container those mutate.
  std::vector<Row> rows(const ShapeReport& report) const;

  // How many rows currently FAIL. This is the number the panel puts on the
  // button, and it is the number that predicts whether the build will fail.
  std::size_t failingCount(const ShapeReport& report) const;

  // Rewrite every FAILING row to the value the report measures. Returns how many
  // rows changed. Rows that pass, and rows whose quantity cannot be measured,
  // are left exactly as written — repairing an assertion nobody can check would
  // be inventing a measurement.
  std::size_t repairFailing(const ShapeReport& report);

  // The statement's arguments, body ref included.
  std::vector<IrArg> irArgs(int bodyRef) const;

  // The whole draft as one clipboard block, one assertion per line with its
  // measured value: what a user pastes into a bug report or a repair prompt.
  std::string exportText(const ShapeReport& report) const;

 private:
  std::vector<std::string> texts_;
};

// ── seeding a draft from a measurement ──────────────────────────────────────
// The assertions that DESCRIBE this part: the census numbers that are measured,
// and the hole count when the bore measurement was not degraded. This is the
// "assert what I just built" button, and it is the honest inverse of the 41.3%
// — every assertion it produces passes by construction, because every one was
// read off the part rather than remembered.
std::vector<std::string> describeAssertions(const ShapeReport& report);

}  // namespace forge::ui

#endif  // FORGE_UI_VERIFYMODEL_HPP
