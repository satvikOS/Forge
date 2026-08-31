// ui/include/forge/ui/ExchangeModel.hpp
//
// THE IMPORT / EXPORT MODEL — headless, no ImGui, no GPU, no kernel.
//
// Everything about reading and writing a foreign CAD file that is NOT the actual
// call into the kernel lives here: which formats exist and what each one can
// really do, how a file's format is decided, what options an import or an export
// takes and how an out-of-range one is repaired, what a diagnostic is, how
// progress is reported for a file too large to read in one frame, what is
// MEASURED about a body that came through the door, and how two such
// measurements are compared.
//
// It is in ui/ and not in forge-desktop/ for the reason the whole split exists:
// a file nothing compiles cannot break. ui/ is gated by CI; forge-desktop is
// largely not. So the frame builder gets one job — draw the dialog this model
// describes and hand the answers back — and every rule about units, tolerances,
// sniffing, clamping and loss is compiled and asserted in a headless gate.
//
// ── THE OWNER'S BINDING CONSTRAINT, MADE STRUCTURAL ─────────────────────────
// "dont gate anything if you do that then how will Archie generate ultra long
// feature trees for Kernel to execute". An importer that REFUSES is a capability
// gate wearing a safety hat, and it fires hardest on the biggest files. So:
//
//   * sniffFormat() never refuses. It returns its best answer, says how
//     confident it is, and says what it looked at.
//   * normaliseImportOptions() CLAMPS a nonsense tolerance and REPORTS the clamp
//     as a diagnostic. It never rejects the import.
//   * An ImportOutcome may be `ok` and carry Error-severity diagnostics: a body
//     with 3 degenerate faces IMPORTS, with those 3 faces NAMED so a repair loop
//     can act on them. `ok=false` is reserved for "there is no body at all".
//   * Every diagnostic carries a machine-readable `code` and, where one exists,
//     the face / edge / entity it is about. "Something failed" is not actionable.
//
// ── WHAT IS NOT HERE ────────────────────────────────────────────────────────
// No file I/O and no geometry. ExchangeHost is the seam; forge-desktop
// implements it over forge::io / forge::heal, and the kernel's exchange probe
// implements it over the same calls for the batch experiment. One model, two
// hosts, and the model is the thing that is gated.
#ifndef FORGE_UI_EXCHANGEMODEL_HPP
#define FORGE_UI_EXCHANGEMODEL_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"

namespace forge::ui {

// ── formats ─────────────────────────────────────────────────────────────────
// The enumeration is the set of formats this application has an OPINION about,
// which is deliberately larger than the set it can read: a user who opens a .jt
// must be told what a .jt is and what to do instead, and that answer has to come
// from somewhere a gate can read.
enum class ExchangeFormat : std::uint8_t {
  Unknown = 0,
  Step,       // ISO 10303 AP203/214/242 — exact B-rep
  Iges,       // IGES 5.3 — exact surfaces, historically leaky topology
  Brep,       // OCCT's own B-rep dump
  Stl,        // tessellated triangles, ASCII or binary
  Obj,        // Wavefront OBJ — tessellated
  Dxf,        // AutoCAD DXF — 2D curve entities, not a solid
  Jt,         // Siemens JT — proprietary container
  Parasolid,  // Siemens Parasolid x_t / x_b — proprietary kernel
};

const char* toString(ExchangeFormat f) noexcept;
// Parse the lowercase spelling toString() produces. Unknown on anything else --
// never a throw and never a guess at a neighbouring format.
ExchangeFormat formatFromString(const std::string& s) noexcept;

// What KIND of thing a format carries. Not decoration: it is why a DXF import
// cannot produce a solid however good the reader is, and why an STL export of a
// B-rep is lossy BY CONSTRUCTION rather than by defect.
enum class GeometryClass : std::uint8_t {
  None,
  ExactBrep,    // analytic + NURBS surfaces with topology (STEP, IGES, BREP)
  Tessellated,  // triangles only (STL, OBJ)
  Curves2d,     // planar curve entities (DXF)
};
const char* toString(GeometryClass g) noexcept;

// ── the census, as data ─────────────────────────────────────────────────────
// One row per format: what the CURRENT BUILD can actually do, and when it cannot
// do something, WHY — in a sentence a user can act on. This table is the
// machine-readable form of the format census, and the gate asserts its internal
// consistency (a direction that is unavailable must say why and must name no
// backing; an available one must name a backing and give no excuse).
struct FormatCapability {
  ExchangeFormat format = ExchangeFormat::Unknown;
  const char* label = "";
  // Space-separated, dot-prefixed, lowercase: ".step .stp".
  const char* extensions = "";
  GeometryClass geometry = GeometryClass::None;
  bool canImport = false;
  bool canExport = false;
  // The implementation actually reached, named so a reader can go and find it.
  // "" exactly when the direction is unavailable.
  const char* importBacking = "";
  const char* exportBacking = "";
  // Non-empty exactly when the direction is unavailable. A sentence, not a code.
  const char* whyNoImport = "";
  const char* whyNoExport = "";
  // Where an unavailable EXPORT should send the user instead. Unknown when there
  // is nowhere sensible to send them.
  ExchangeFormat exportAlternative = ExchangeFormat::Unknown;
};

// Every row, in a stable order. Never empty.
const std::vector<FormatCapability>& formatCapabilities();
// The row for `f`. Always returns a row; the Unknown row is a real row.
const FormatCapability& capabilityOf(ExchangeFormat f);
// The formats a file dialog should offer, in menu order.
std::vector<ExchangeFormat> importableFormats();
std::vector<ExchangeFormat> exportableFormats();

// ── sniffing ────────────────────────────────────────────────────────────────
// Confidence is reported, not hidden. A .stp whose bytes say ISO-10303 is
// Certain; a .stp that is actually an STL is decided BY THE BYTES and reported
// as Content with the conflicting extension recorded — because dispatching on
// the extension is exactly the defect that made valid binary STLs unopenable in
// this kernel before (their 80-byte header often begins "solid ").
enum class SniffConfidence : std::uint8_t {
  None,       // nothing matched: neither bytes nor extension
  Extension,  // only the file name suggested it
  Content,    // the bytes said so, and the name disagreed or said nothing
  Certain,    // the bytes said so AND the extension agrees
};
const char* toString(SniffConfidence c) noexcept;

struct SniffResult {
  ExchangeFormat format = ExchangeFormat::Unknown;
  SniffConfidence confidence = SniffConfidence::None;
  // The format the FILE NAME implied, when it differs from `format`. Unknown
  // when the name agreed or said nothing. A UI shows this as a note, never as a
  // refusal: the bytes win.
  ExchangeFormat extensionSaid = ExchangeFormat::Unknown;
  // What the decision was actually made on, for a diagnostic a human can read.
  std::string evidence;
};

// `head` is the first bytes of the file (256 is plenty; more is fine) and
// `totalBytes` its full size — the binary-STL discriminator is arithmetic on the
// size, not a header string, exactly as forge::io::importStl does it. `path` may
// be empty. NEVER refuses: the worst answer is Unknown with SniffConfidence::None.
SniffResult sniffFormat(const std::string& path, const std::string& head,
                        std::uint64_t totalBytes);
// Extension only. Exposed because a file dialog filters on names before it has
// any bytes, and because the gate has to be able to test the two halves apart.
ExchangeFormat formatFromPath(const std::string& path) noexcept;

// ── units ───────────────────────────────────────────────────────────────────
// The kernel's STEP transfer is pinned to MM, so a file authored in inches
// arrives 25.4x too small and NOTHING in the geometry says so. That is what this
// option is for, and it is why `autoDetectUnit` is a separate flag from the unit
// itself: "believe the file" and "the file is wrong, it is inches" are different
// instructions and must not be spelled the same way.
enum class LengthUnit : std::uint8_t {
  Millimetre, Centimetre, Metre, Micron, Inch, Foot,
};
const char* toString(LengthUnit u) noexcept;
LengthUnit unitFromString(const std::string& s) noexcept;
double unitInMillimetres(LengthUnit u) noexcept;
// The factor that takes a coordinate expressed in `from` to one in `to`.
double unitScale(LengthUnit from, LengthUnit to) noexcept;

// ── healing ─────────────────────────────────────────────────────────────────
// Three named policies rather than a pile of booleans, because "what do I do
// with a leaky import" is one decision with three defensible answers, and a UI
// that offers five independent checkboxes is offering a combinatorial space it
// has never tested. The individual switches stay reachable under Custom.
enum class HealPolicy : std::uint8_t {
  None,        // take the file exactly as it reads. Diagnostics still recorded.
  Standard,    // sew within tolerance, harmonise normals, unify coplanar faces
  Aggressive,  // Standard + fill missing faces + repair self-intersections
  Custom,      // whatever the individual flags say
};
const char* toString(HealPolicy p) noexcept;
HealPolicy healPolicyFromString(const std::string& s) noexcept;

// ── diagnostics ─────────────────────────────────────────────────────────────
enum class Severity : std::uint8_t { Info, Warning, Error };
const char* toString(Severity s) noexcept;

// `code` is a stable, machine-readable slug ("degenerate_face",
// "unit_scale_applied", "tolerance_clamped"). `entity` names the face / edge /
// op the diagnostic is about when one exists, so a repair loop has something to
// act on; "" when the diagnostic is about the file as a whole.
struct ExchangeDiagnostic {
  Severity severity = Severity::Info;
  std::string code;
  std::string message;
  std::string entity;
  std::string format() const;  // "[warning] degenerate_face: … (face#12)"
};

// A diagnostic LIST that keeps its own counts, because "did anything go wrong"
// asked of a bare vector is a loop every caller writes differently.
class DiagnosticLog {
 public:
  void add(Severity s, std::string code, std::string message, std::string entity = std::string());
  void info(std::string code, std::string message, std::string entity = std::string());
  void warn(std::string code, std::string message, std::string entity = std::string());
  void error(std::string code, std::string message, std::string entity = std::string());

  const std::vector<ExchangeDiagnostic>& all() const noexcept { return items_; }
  std::size_t count(Severity s) const noexcept;
  std::size_t size() const noexcept { return items_.size(); }
  bool empty() const noexcept { return items_.empty(); }
  // TRUE when at least one Error was recorded. Deliberately NOT the same as
  // "the import failed" — see ImportOutcome::ok.
  bool hasErrors() const noexcept { return count(Severity::Error) > 0; }
  void clear() noexcept;
  // Every diagnostic with this code, in order. What a repair loop iterates.
  std::vector<ExchangeDiagnostic> withCode(const std::string& code) const;
  std::string summary() const;  // "2 errors, 1 warning, 4 info"

  // ── the cap, and why it is HERE and not at each call site ────────────────
  // A 400-face part with a systemic defect produces one diagnostic per face. Ten
  // thousand strings is not a diagnostic, it is the payload. So the log caps
  // itself and REMEMBERS what it dropped: dropped() is non-zero exactly when
  // something was suppressed, and the counts below still count the dropped ones,
  // so "3 errors" stays true even when only 2 are listed. A cap that lies about
  // the total would be worse than no cap.
  void setCap(std::size_t cap) noexcept { cap_ = cap; }  // 0 == unlimited
  std::size_t cap() const noexcept { return cap_; }
  std::size_t dropped() const noexcept { return dropped_; }

 private:
  std::vector<ExchangeDiagnostic> items_;
  std::size_t cap_ = 0;
  std::size_t dropped_ = 0;
  std::size_t counts_[3] = {0, 0, 0};
};

// ── options ─────────────────────────────────────────────────────────────────
// The BOUNDS live here as named constants, because a magic number inside a clamp
// is unreviewable and because the gate asserts against these, not against copies.
inline constexpr double kMinTolerance = 1e-7;  // mm — below this the kernel's own
                                               // confusion tolerance dominates
inline constexpr double kMaxTolerance = 10.0;  // mm — above this "sewing" is
                                               // moving geometry, not joining it
inline constexpr double kDefaultSewTolerance = 1e-3;      // mm
inline constexpr double kDefaultLinearTolerance = 0.05;   // mm  (chord height)
inline constexpr double kDefaultAngularTolerance = 0.08;  // rad (~78 facets/turn)
inline constexpr double kMinAngularTolerance = 1e-3;      // rad
inline constexpr double kMaxAngularTolerance = 1.5;       // rad

struct ImportOptions {
  // Unknown means "sniff it" — which is what a UI should pass unless the user
  // explicitly overrode the type in the dialog.
  ExchangeFormat format = ExchangeFormat::Unknown;

  // Units. `autoDetectUnit` means "believe the file"; when it is false the
  // geometry is scaled from `sourceUnit` into `documentUnit`.
  bool autoDetectUnit = true;
  LengthUnit sourceUnit = LengthUnit::Millimetre;
  LengthUnit documentUnit = LengthUnit::Millimetre;

  HealPolicy heal = HealPolicy::Standard;
  double sewTolerance = kDefaultSewTolerance;

  // Reachable directly under HealPolicy::Custom; under the named policies these
  // are DERIVED by resolveHealing(), so the policy and the flags cannot disagree.
  bool sewShells = true;
  bool harmoniseNormals = true;
  bool unifyCoplanarFaces = true;
  bool fillMissingFaces = false;
  bool repairSelfIntersections = false;

  // ★ THE TOLERATE SWITCH. False is the refusing behaviour and is NOT the
  // default: a body with degenerate faces comes in, with the faces named.
  bool tolerateDegenerate = true;

  // How many diagnostics to keep. 0 means unlimited.
  std::size_t maxDiagnostics = 256;

  // Emit progress at most this often, in bytes read. A callback per entity on a
  // 500 MB STEP is its own performance problem.
  std::uint64_t progressIntervalBytes = 1u << 20;  // 1 MiB
};

struct ExportOptions {
  ExchangeFormat format = ExchangeFormat::Step;
  LengthUnit documentUnit = LengthUnit::Millimetre;
  LengthUnit targetUnit = LengthUnit::Millimetre;
  // Prefer real analytic surfaces over a tessellation when the writer can do
  // both. False forces the faceted route, which is the honest choice when the
  // consumer is a slicer.
  bool preferAnalytic = true;
  bool ascii = true;  // meaningful for STL / OBJ
  double linearTolerance = kDefaultLinearTolerance;
  double angularTolerance = kDefaultAngularTolerance;
  std::size_t maxDiagnostics = 256;
  std::uint64_t progressIntervalBytes = 1u << 20;
};

// Repair the options in place and DESCRIBE every repair. Returns the number of
// repairs made. NEVER refuses — that is the point. An out-of-range tolerance is
// clamped into [kMinTolerance, kMaxTolerance] and a "tolerance_clamped"
// diagnostic records both the value asked for and the value used.
std::size_t normaliseImportOptions(ImportOptions& opts, DiagnosticLog& log);
std::size_t normaliseExportOptions(ExportOptions& opts, DiagnosticLog& log);

// The individual healing switches a policy implies. Custom returns the options'
// own flags untouched; the named policies OVERWRITE them, so a UI that greys the
// checkboxes out under "Standard" is showing the truth.
struct HealingPlan {
  bool sew = false;
  bool harmoniseNormals = false;
  bool unifyCoplanarFaces = false;
  bool fillMissingFaces = false;
  bool repairSelfIntersections = false;
  double tolerance = kDefaultSewTolerance;
  bool any() const noexcept {
    return sew || harmoniseNormals || unifyCoplanarFaces || fillMissingFaces ||
           repairSelfIntersections;
  }
};
HealingPlan resolveHealing(const ImportOptions& opts);

// The scale factor an import must apply. Separated from the options so the host
// has exactly one number to use and the gate exactly one function to assert on.
double importScaleFactor(const ImportOptions& opts) noexcept;
double exportScaleFactor(const ExportOptions& opts) noexcept;

// ── progress ────────────────────────────────────────────────────────────────
// A large STEP is minutes of work. The phases are the real ones: reading bytes,
// parsing entities, transferring to topology, healing, measuring, writing.
// fraction() is MONOTONIC BY CONSTRUCTION — it can never go backwards, because a
// progress bar that retreats is read as a hang.
enum class ExchangePhase : std::uint8_t {
  Idle, Reading, Parsing, Transferring, Healing, Measuring, Writing,
  Done, Failed, Cancelled,
};
const char* toString(ExchangePhase p) noexcept;

class ExchangeProgress {
 public:
  // Declares the total size up front so the Reading phase can report real bytes.
  // 0 is legal and means "size unknown" — the fraction then advances by phase.
  void begin(std::uint64_t totalBytes);
  // Enter a phase. The working phases are ordered; entering an EARLIER one is
  // counted as a rewind attempt and does NOT move the fraction back. Terminal
  // phases (Done/Failed/Cancelled) are always accepted.
  void enterPhase(ExchangePhase p);
  // Absolute bytes consumed so far, for the phases that read or write bytes.
  void setBytesDone(std::uint64_t bytes);
  // Progress WITHIN the current phase, 0..1, for phases with no byte count of
  // their own (Transferring, Healing, Measuring).
  void setPhaseFraction(double f);
  void finish();  // -> Done, fraction 1
  void fail(std::string why);
  void cancel();  // cooperative: the host polls cancelled()

  ExchangePhase phase() const noexcept { return phase_; }
  double fraction() const noexcept { return fraction_; }
  std::uint64_t totalBytes() const noexcept { return totalBytes_; }
  std::uint64_t bytesDone() const noexcept { return bytesDone_; }
  bool cancelled() const noexcept { return cancelled_; }
  bool done() const noexcept {
    return phase_ == ExchangePhase::Done || phase_ == ExchangePhase::Failed ||
           phase_ == ExchangePhase::Cancelled;
  }
  const std::string& error() const noexcept { return error_; }
  std::size_t rewindAttempts() const noexcept { return rewinds_; }
  // "Transferring 42% (12.3 MB of 29.1 MB)" — one line for a status strip.
  std::string label() const;

 private:
  ExchangePhase phase_ = ExchangePhase::Idle;
  double fraction_ = 0.0;
  std::uint64_t totalBytes_ = 0;
  std::uint64_t bytesDone_ = 0;
  bool cancelled_ = false;
  std::size_t rewinds_ = 0;
  std::string error_;
};

// ── observables ─────────────────────────────────────────────────────────────
// ★ VOLUME CANNOT VALIDATE GEOMETRY. Four measured cases in this programme have
// a wrong solid reproducing a right volume, and in one of them NO SINGLE
// observable caught it. So a body is described by a VECTOR, and round-trip
// fidelity is judged on the vector.
struct Observables {
  bool measured = false;  // false means nothing below is meaningful
  bool valid = false;     // watertight / manifold / oriented
  double volume = 0.0;
  double area = 0.0;
  double com[3] = {0.0, 0.0, 0.0};
  double bboxMin[3] = {0.0, 0.0, 0.0};
  double bboxMax[3] = {0.0, 0.0, 0.0};
  long faceCount = -1;
  long edgeCount = -1;
  long vertexCount = -1;  // welded tessellation vertices
  long genus = -1;
  long shellCount = -1;

  double bboxDiagonal() const noexcept;
  // The scale the relative comparisons are taken against: the bbox diagonal,
  // falling back to cbrt(volume) and then to 1. A length tolerance has to be
  // relative to SOMETHING, and "1 mm" on a 4 m part is not a test.
  double characteristicLength() const noexcept;
};

// What changed between two measurements of what should be the same body.
// Relative where a relative number is meaningful, absolute where it is not.
struct LossVector {
  bool comparable = false;       // both sides measured
  double volumeRel = 0.0;        // |b-a| / max(|a|, eps)
  double areaRel = 0.0;
  double comDistRel = 0.0;       // |com_b - com_a| / characteristicLength(a)
  double bboxMaxAbsDelta = 0.0;  // largest single-coordinate move, model units
  double bboxRel = 0.0;          // that move / characteristicLength(a)
  long faceDelta = 0;
  long edgeDelta = 0;
  long vertexDelta = 0;
  long genusDelta = 0;
  long shellDelta = 0;
  bool validityLost = false;  // a was valid, b is not
  // TRUE when every term is inside `tol`. The one number a distribution is built
  // from — but it is DERIVED from the vector, never a substitute for it.
  bool withinTolerance = false;
  // Which terms broke the tolerance, named: "volume", "genus", "com"…
  std::vector<std::string> violations;
};

// The tolerance a round trip is judged against. The defaults are not
// aspirational: a STEP round trip through an exact writer moves volume by ~1e-9,
// and a face count that changes at all is a topology change worth naming.
struct LossTolerance {
  double volumeRel = 1e-6;
  double areaRel = 1e-6;
  double comRel = 1e-6;
  double bboxRel = 1e-6;
  bool requireSameFaceCount = true;
  bool requireSameEdgeCount = true;
  bool requireSameGenus = true;
  bool requireSameShellCount = true;
  bool requireValidityPreserved = true;
};

LossVector compareObservables(const Observables& a, const Observables& b,
                              const LossTolerance& tol = LossTolerance());

// ── outcomes ────────────────────────────────────────────────────────────────
// `ok` means A BODY EXISTS, not "nothing went wrong". An import that produced a
// solid with three degenerate faces is ok=true with three Error diagnostics —
// that is the tolerate rule, stated in the type.
struct ImportOutcome {
  bool ok = false;
  ExchangeFormat format = ExchangeFormat::Unknown;
  std::string path;
  std::uint64_t fileBytes = 0;
  double scaleApplied = 1.0;
  HealingPlan healing;
  Observables observables;
  DiagnosticLog diagnostics;
  double seconds = 0.0;
  // Set only when ok == false: the one sentence that says why there is no body.
  std::string error;
};

struct ExportOutcome {
  bool ok = false;
  ExchangeFormat format = ExchangeFormat::Unknown;
  std::string path;
  std::uint64_t fileBytes = 0;
  double scaleApplied = 1.0;
  bool analytic = false;         // real surfaces were written, not triangles
  std::size_t facetedFaces = 0;  // faces that fell back to per-face faceting
  std::size_t totalFaces = 0;
  DiagnosticLog diagnostics;
  double seconds = 0.0;
  std::string error;
};

// ── the seam ────────────────────────────────────────────────────────────────
// The ONE interface between this model and geometry. forge-desktop implements it
// over forge::io; the kernel's exchange probe implements it over the same calls
// for the batch experiment. Neither implementation may re-decide anything this
// model already decided — the options arrive normalised, the healing plan
// resolved, the scale computed.
class ExchangeHost {
 public:
  virtual ~ExchangeHost() = default;
  // Read `path` into the host's document. `progress` is polled for cancel and
  // written for display. Returns the outcome; must NEVER throw.
  virtual ImportOutcome importFile(const std::string& path, const ImportOptions& opts,
                                   ExchangeProgress& progress) = 0;
  // Write the host's current body to `path`.
  virtual ExportOutcome exportFile(const std::string& path, const ExportOptions& opts,
                                   ExchangeProgress& progress) = 0;
  // Is there a body to export at all? A UI must be able to grey out Export.
  virtual bool hasExportableBody() const = 0;
};

// ── the model the UI holds ──────────────────────────────────────────────────
// Dialog state that is NOT frame state: the chosen format, the option values,
// the last outcome and the live progress. It is here rather than in ForgeFrame
// so a headless gate can drive the whole interaction, and so a macro or an
// Archie tool call sees the same object a click does.
class ExchangeModel {
 public:
  ImportOptions& importOptions() noexcept { return import_; }
  const ImportOptions& importOptions() const noexcept { return import_; }
  ExportOptions& exportOptions() noexcept { return export_; }
  const ExportOptions& exportOptions() const noexcept { return export_; }

  ExchangeProgress& progress() noexcept { return progress_; }
  const ExchangeProgress& progress() const noexcept { return progress_; }

  const ImportOutcome& lastImport() const noexcept { return lastImport_; }
  const ExportOutcome& lastExport() const noexcept { return lastExport_; }
  // Everything the last operation said, whichever direction it was.
  const DiagnosticLog& diagnostics() const noexcept { return diagnostics_; }

  void setHost(ExchangeHost* host) noexcept { host_ = host; }
  ExchangeHost* host() const noexcept { return host_; }

  // Run an import: normalise the options, call the host, record everything.
  // Returns lastImport().ok. With no host installed it fails with a NAMED error
  // rather than pretending, exactly as ForgeShell's document seam does.
  bool runImport(const std::string& path);
  bool runExport(const std::string& path);

  // How many imports/exports this model has run — instrumentation a gate can
  // assert on without reaching into the host.
  std::size_t importCount() const noexcept { return importCount_; }
  std::size_t exportCount() const noexcept { return exportCount_; }

 private:
  ImportOptions import_;
  ExportOptions export_;
  ExchangeProgress progress_;
  ImportOutcome lastImport_;
  ExportOutcome lastExport_;
  DiagnosticLog diagnostics_;
  ExchangeHost* host_ = nullptr;
  std::size_t importCount_ = 0;
  std::size_t exportCount_ = 0;
};

// ── the commands ────────────────────────────────────────────────────────────
// file.import / file.export go into THE SAME registry as everything else, so a
// menu click, a shortcut, a macro step and an Archie tool call are one code path.
// They declare NO featureIrOp: an import is not an IR statement, and claiming one
// would put a fictional op into Archie's derived vocabulary.
//
// Every parameter that is required has hasDefault=true EXCEPT `path`, which has
// no honest default — so a keyboard gesture reports promptFor={"path"} and the
// UI opens its file dialog, instead of dying on missing_required_parameter.
std::size_t registerExchangeCommands(CommandRegistry& registry, ExchangeModel& model);

// The command ids that function registers, sorted. The gate compares the registry
// against this list, so a command added without a test is visible.
const std::vector<std::string>& exchangeCommandIds();

}  // namespace forge::ui

#endif  // FORGE_UI_EXCHANGEMODEL_HPP
