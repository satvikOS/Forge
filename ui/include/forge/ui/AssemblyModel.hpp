// ui/include/forge/ui/AssemblyModel.hpp
//
// THE ASSEMBLY -- components, joints, ground -- as Forge's own document model.
//
// ── what this is ─────────────────────────────────────────────────────────────
// A COMPONENT is one placed instance of a solid body the part document builds.
// It has a stable id (never reused, never renumbered), a name a person chose, the
// feature statement whose body it instances, and a placement. Two components can
// instance the same body: that is what makes a bill of materials count.
//
// A JOINT holds two components together. It carries a FRAME on each one, in that
// component's own coordinates, whose z axis is the joint's axis -- so the joint
// moves with the components rather than staying behind in world space. A
// GROUNDED component is held where it is.
//
// ── what this is NOT ─────────────────────────────────────────────────────────
// It is not a solver. Solving is done by the assembly solver behind the
// AssemblySolver seam below (Forge's modified OndselSolver, libforge_asmsolver),
// which this layer never links: forge::ui stays headless and dependency-free.
//
// What IS here is Forge's OWN MEASUREMENT of a result: every joint's error
// recomputed from the placements with arithmetic written in this file, and the
// degrees of freedom counted from the rank of the joint equations. A solver's
// answer is accepted only when that measurement agrees with it. A wrong placement
// reported as solved is worse than a refusal, and "the solver said so" is not a
// measurement.
//
// ── units ────────────────────────────────────────────────────────────────────
// Lengths are millimetres and angles are DEGREES everywhere in this header, the
// same rule the feature IR states. A placement's rotation is a row-major 3x3
// matrix: a point p in the component's own coordinates is at r*p + t.
#ifndef FORGE_UI_ASSEMBLYMODEL_HPP
#define FORGE_UI_ASSEMBLYMODEL_HPP

#include <array>
#include <cstddef>
#include <cstdint>
#include <iterator>
#include <string>
#include <string_view>
#include <vector>

namespace forge::ui {
class PartDocument;
}

namespace forge::ui::assembly {

using Vec3 = std::array<double, 3>;
using Mat3 = std::array<double, 9>;  // row-major

// ── placement ───────────────────────────────────────────────────────────────
struct Placement {
  Vec3 t{0.0, 0.0, 0.0};
  Mat3 r{1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0};

  static Placement at(double x, double y, double z) noexcept;
  // Turned about world X by rx, then world Y by ry, then world Z by rz (degrees):
  // r = Rz * Ry * Rx. The order is stated because it decides the result.
  static Placement fromAngles(double x, double y, double z, double rxDeg, double ryDeg,
                              double rzDeg) noexcept;

  Placement then(const Placement& inner) const noexcept;  // this * inner
  Placement inverse() const noexcept;
  Vec3 point(const Vec3& p) const noexcept;
  Vec3 direction(const Vec3& d) const noexcept;
  Vec3 axis(int column) const noexcept;  // 0 = x, 1 = y, 2 = z, in world
  // The inverse of fromAngles, in degrees; ry in [-90, 90].
  void angles(double& rxDeg, double& ryDeg, double& rzDeg) const noexcept;

  bool operator==(const Placement& o) const noexcept = default;
};

bool isProperRotation(const Mat3& r, double tol = 1e-9) noexcept;
bool isFinite(const Placement& p) noexcept;

// A frame at `origin` whose z axis is `axis`. Its x axis is world X with the axis
// component removed, or world Y when the axis is within 1e-6 of X, so the same
// inputs always give the same frame. False, and `out` untouched, for a zero or
// non-finite axis.
bool frameFromAxis(const Vec3& origin, const Vec3& axis, Placement& out) noexcept;

// ── joints ──────────────────────────────────────────────────────────────────
enum class JointKind : std::uint8_t {
  Fixed = 0,
  Revolute,
  Slider,
  Cylindrical,
  Ball,
  Planar,
  Distance,
  Angle,
};

inline constexpr JointKind kAllJointKinds[] = {
    JointKind::Fixed,       JointKind::Revolute, JointKind::Slider,   JointKind::Cylindrical,
    JointKind::Ball,        JointKind::Planar,   JointKind::Distance, JointKind::Angle,
};
static_assert(std::size(kAllJointKinds) == static_cast<std::size_t>(JointKind::Angle) + 1,
              "kAllJointKinds must list every JointKind");

// "REVOLUTE" -- the IR keyword. Stable: documents and Archie plans store it.
const char* keyword(JointKind kind) noexcept;
// Case-insensitive.
bool jointKindFromKeyword(std::string_view word, JointKind& out) noexcept;
// "revolute" -- the word a person reads.
const char* userWord(JointKind kind) noexcept;
// How many independent equations the joint states when it is not redundant.
std::size_t equationCount(JointKind kind) noexcept;
bool jointTurns(JointKind kind) noexcept;   // revolute, cylindrical
bool jointSlides(JointKind kind) noexcept;  // slider, cylindrical
bool jointTakesValue(JointKind kind) noexcept;  // distance (mm), angle (degrees)

struct Component {
  int id = 0;
  std::string name;
  int body = 0;  // the IR statement id of the solid this instances
  Placement placement;
  bool grounded = false;

  bool operator==(const Component& o) const noexcept = default;
};

struct Joint {
  int id = 0;
  std::string name;
  JointKind kind = JointKind::Fixed;
  int first = 0;   // component id
  int second = 0;  // component id
  Placement onFirst;   // frame I, in first's own coordinates
  Placement onSecond;  // frame J, in second's own coordinates
  double value = 0.0;  // Distance: mm (> 0). Angle: degrees (0 < v < 180).

  bool operator==(const Joint& o) const noexcept = default;
};

struct Assembly {
  std::vector<Component> components;
  std::vector<Joint> joints;
  int nextComponentId = 1;
  int nextJointId = 1;

  bool empty() const noexcept { return components.empty() && joints.empty(); }
  const Component* component(int id) const noexcept;
  Component* component(int id) noexcept;
  const Component* componentNamed(std::string_view name) const noexcept;
  std::size_t componentIndex(int id) const noexcept;  // components.size() when absent
  const Joint* joint(int id) const noexcept;
  const Joint* jointNamed(std::string_view name) const noexcept;
  // The joints that name `componentId` on either side, in joint order.
  std::vector<const Joint*> jointsOf(int componentId) const;
  std::size_t groundedCount() const noexcept;

  bool operator==(const Assembly& o) const noexcept = default;
};

// World frames of a joint at the assembly's current placements.
bool jointWorldFrames(const Assembly& a, const Joint& j, Placement& onFirst,
                      Placement& onSecond) noexcept;

// ── names ───────────────────────────────────────────────────────────────────
// A name is what a person and Archie refer to a component or joint by, so it has
// to survive being written into an IR statement as ONE quoted token: 1..64
// printable characters, no quote, no backslash, not blank.
bool isValidName(std::string_view name) noexcept;

// ── validation ──────────────────────────────────────────────────────────────
enum class AsmCheck : std::uint8_t {
  Ok = 0,
  BadName,          // empty, too long, unprintable, a quote or a backslash
  DuplicateName,    // two components, two joints, or a component and a joint share it
  DuplicateId,
  BadIdCounter,     // an id at or above the next-id counter
  NoSuchBody,       // a component instances a statement the document does not have
  NotASolid,        // ... or one that builds something other than a solid
  NoSuchComponent,  // a joint names a component that is not in the assembly
  SelfJoint,        // a joint with the same component on both sides
  BadPlacement,     // not finite, or an orientation that is not a rotation
  BadValue,         // a distance <= 0, or an angle outside (0, 180)
};

const char* toString(AsmCheck check) noexcept;

struct AsmVerdict {
  AsmCheck check = AsmCheck::Ok;
  std::string reason;  // in words a person reads; empty when Ok
  bool ok() const noexcept { return check == AsmCheck::Ok; }
};

// Every rule above, over the whole assembly. The document is needed to resolve
// each component's body; pass nullptr to check only the assembly's own rules.
AsmVerdict validate(const Assembly& a, const PartDocument* document);

// ── the typed IR ────────────────────────────────────────────────────────────
// The statements a person or Archie emits to author an assembly. Each assembly
// command in AssemblyCommands.cpp emits exactly one of these, and
// gen_archie_op_vocabulary.py reads this table and its signature comments.
struct AsmOpSpec {
  std::string name;
  std::size_t minArgs = 0;
  std::size_t maxArgs = 0;
  bool firstArgIsValueRef = false;
};

const std::vector<AsmOpSpec>& assemblyOpTable();
const AsmOpSpec* findAssemblyOp(std::string_view name) noexcept;

// The statement a component, a joint or a ground is shown as. Numbers go through
// formatIrNumber, so these are for READING; the document stores the exact values.
std::string statementFor(const Component& c);
std::string statementFor(const Assembly& a, const Joint& j);

// ── Forge's own measurement of a result ─────────────────────────────────────
struct JointMeasure {
  int jointId = 0;
  std::size_t equations = 0;
  double positionError = 0.0;   // mm, the worst position equation
  double directionError = 0.0;  // the worst direction-cosine equation (a pure number)
  // FALSE when the frames satisfy the equations on the WRONG BRANCH: a hinge
  // whose axes point in opposite directions, a fixed joint turned half a turn.
  // Direction-cosine equations cannot tell those apart; this can.
  bool onBranch = true;
  bool holds = false;
};

struct Tolerance {
  double lengthMm = 1e-6;
  double direction = 1e-8;
};

// Every joint, measured at the assembly's current placements.
std::vector<JointMeasure> measureJoints(const Assembly& a, const Tolerance& tol = {});

// How free the assembly is, from the RANK of the joint and ground equations with
// respect to a small move of every component. Rows are taken in order -- the
// grounds, then the joints as listed -- so when a joint only repeats what earlier
// ones already hold, it is the LATER joint that is counted redundant.
struct Freedom {
  int degrees = 0;               // 6 per component, minus the rank
  std::size_t rank = 0;
  std::size_t equations = 0;
  bool floating = false;         // nothing is grounded: the whole assembly can also move
  struct Redundancy {
    int jointId = 0;             // 0 for a ground
    int componentId = 0;         // the grounded component when jointId == 0
    std::size_t redundantEquations = 0;
    // Who already holds what this one repeats: joint ids, and grounded component
    // ids given as negative numbers.
    std::vector<int> heldBy;
  };
  std::vector<Redundancy> redundancies;
  std::size_t redundantEquations() const noexcept;
};

Freedom countFreedom(const Assembly& a);

// The angle (degrees, in (-180, 180]) J's x axis is turned from I's about I's z,
// and the distance (mm) J's origin lies along I's z. The coordinates a drive moves.
bool jointCoordinates(const Assembly& a, const Joint& j, double& turnDeg, double& slideMm) noexcept;

// ── the solver seam ─────────────────────────────────────────────────────────
// A MOVE of one joint's free coordinate: turn a revolute or cylindrical joint to
// an angle, or slide a slider or cylindrical joint to an offset. It changes where
// the mechanism is, never how free it is.
struct Drive {
  int jointId = 0;
  bool slide = false;  // false: turn, degrees. true: slide, mm.
  double value = 0.0;
};

struct SolveOutcome {
  bool solved = false;
  std::string reason;                 // why not, in words; empty when solved
  std::vector<Placement> placements;  // one per component, in component order, when solved
  int degreesOfFreedom = 0;           // the engine's own count
  std::vector<int> conflictingJoints; // joint ids the engine found do not hold
  std::string engine;                 // which solver answered, for the record
};

class AssemblySolver {
 public:
  virtual ~AssemblySolver() = default;
  // Never throws. Placements come back in the assembly's component order.
  virtual SolveOutcome solve(const Assembly& a, const std::vector<Drive>& drives) = 0;
  virtual std::string engineName() const = 0;
};

// ── the verdict of an EDIT ──────────────────────────────────────────────────
// solveAndVerify() is the one path from "a candidate assembly" to "placements a
// document may commit": validate, solve, then MEASURE the answer with the code in
// this file and refuse unless every joint holds on its branch, every drive landed
// on its target and the engine's degrees of freedom equal the rank count.
struct EditVerdict {
  bool ok = false;
  std::string reason;
  std::vector<int> namedJoints;  // the joints a refusal is about
  Assembly result;               // the candidate with the solved placements, when ok
  Freedom freedom;               // measured on `result`, when ok
};

EditVerdict solveAndVerify(const Assembly& candidate, const PartDocument* document,
                           AssemblySolver* solver, const std::vector<Drive>& drives = {},
                           const Tolerance& tol = {});

// ── what the Assembly tab and the parts list show ───────────────────────────
struct BomRow {
  int body = 0;                        // the IR statement the components instance
  std::string part;                    // the body's row label in the feature tree
  std::size_t quantity = 0;
  std::vector<std::string> instances;  // component names, in component order
};

// What a component is made of, as a person reads it: the body's row label and
// its statement number, "Box 1", because two boxes share the label "Box" and a
// parts list that cannot tell them apart is not a parts list. "" when the
// statement is missing or is not a solid.
std::string bodyName(const PartDocument& document, int body);

// One row per distinct body, in order of first appearance; quantities sum to the
// component count. A component whose body is missing still counts, under
// "missing", rather than vanishing from the list.
std::vector<BomRow> billOfMaterials(const Assembly& a, const PartDocument& document);

// The whole state of the assembly as a panel draws it, computed without a solver.
struct AssemblyStatus {
  bool empty = true;
  AsmVerdict validity;
  Freedom freedom;
  std::vector<JointMeasure> joints;   // in joint order
  std::size_t jointsHolding = 0;
  bool everyJointHolds = true;
  // A sentence: "1 degree of freedom", "fully held", "floating: nothing is grounded".
  std::string summary;
};

AssemblyStatus assessAssembly(const Assembly& a, const PartDocument& document);

}  // namespace forge::ui::assembly

#endif  // FORGE_UI_ASSEMBLYMODEL_HPP
