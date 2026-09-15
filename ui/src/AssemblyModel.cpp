// ui/src/AssemblyModel.cpp -- see forge/ui/AssemblyModel.hpp.
#include "forge/ui/AssemblyModel.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"

namespace forge::ui::assembly {

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kDeg = kPi / 180.0;

double dot(const Vec3& a, const Vec3& b) noexcept { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
Vec3 sub(const Vec3& a, const Vec3& b) noexcept { return {a[0] - b[0], a[1] - b[1], a[2] - b[2]}; }
Vec3 cross(const Vec3& a, const Vec3& b) noexcept {
  return {a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]};
}
double norm(const Vec3& a) noexcept { return std::sqrt(dot(a, a)); }

Mat3 mul(const Mat3& a, const Mat3& b) noexcept {
  Mat3 m{};
  for (int i = 0; i < 3; ++i) {
    for (int j = 0; j < 3; ++j) {
      double s = 0.0;
      for (int k = 0; k < 3; ++k) s += a[3 * i + k] * b[3 * k + j];
      m[3 * i + j] = s;
    }
  }
  return m;
}

Mat3 transpose(const Mat3& a) noexcept {
  return {a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]};
}

Vec3 mulVec(const Mat3& r, const Vec3& p) noexcept {
  return {r[0] * p[0] + r[1] * p[1] + r[2] * p[2], r[3] * p[0] + r[4] * p[1] + r[5] * p[2],
          r[6] * p[0] + r[7] * p[1] + r[8] * p[2]};
}

// Rotation by `angle` radians about unit axis `u`.
Mat3 axisAngle(const Vec3& u, double angle) noexcept {
  const double c = std::cos(angle), s = std::sin(angle), k = 1.0 - c;
  return {c + u[0] * u[0] * k,        u[0] * u[1] * k - u[2] * s, u[0] * u[2] * k + u[1] * s,
          u[1] * u[0] * k + u[2] * s, c + u[1] * u[1] * k,        u[1] * u[2] * k - u[0] * s,
          u[2] * u[0] * k - u[1] * s, u[2] * u[1] * k + u[0] * s, c + u[2] * u[2] * k};
}

double lengthScale(const Assembly& a) noexcept {
  double s = 1.0;
  auto grow = [&](const Vec3& v) {
    for (double x : v) s = std::max(s, std::abs(x));
  };
  for (const Component& c : a.components) grow(c.placement.t);
  for (const Joint& j : a.joints) {
    grow(j.onFirst.t);
    grow(j.onSecond.t);
    if (j.kind == JointKind::Distance) s = std::max(s, std::abs(j.value));
  }
  return s;
}

double lengthTolerance(const Assembly& a, const Tolerance& tol) noexcept {
  return tol.lengthMm * std::max(1.0, lengthScale(a) / 100.0);
}

// ── the joint equations, written out ────────────────────────────────────────
// Each row is one equation that is ZERO when the joint holds. `position` rows
// are millimetres, the rest are direction cosines. The rows are the same set,
// in the same number, that the solver states for each kind, so a rank count
// over them is comparable with the solver's own count.
struct Row {
  double value = 0.0;
  bool position = false;
};

void jointRows(const Joint& j, const Placement& wi, const Placement& wj, std::vector<Row>& out) {
  const Vec3 d = sub(wj.t, wi.t);
  const Vec3 xi = wi.axis(0), yi = wi.axis(1), zi = wi.axis(2);
  const Vec3 xj = wj.axis(0), yj = wj.axis(1);
  const Vec3 zj = wj.axis(2);
  auto pos = [&](double v) { out.push_back(Row{v, true}); };
  auto dir = [&](double v) { out.push_back(Row{v, false}); };
  switch (j.kind) {
    case JointKind::Fixed:
      pos(d[0]); pos(d[1]); pos(d[2]);
      dir(dot(zi, xj)); dir(dot(zi, yj)); dir(dot(yi, xj));
      break;
    case JointKind::Revolute:
      pos(d[0]); pos(d[1]); pos(d[2]);
      dir(dot(zi, xj)); dir(dot(zi, yj));
      break;
    case JointKind::Slider:
      pos(dot(d, xi)); pos(dot(d, yi));
      dir(dot(zi, xj)); dir(dot(zi, yj)); dir(dot(yi, xj));
      break;
    case JointKind::Cylindrical:
      pos(dot(d, xi)); pos(dot(d, yi));
      dir(dot(zi, xj)); dir(dot(zi, yj));
      break;
    case JointKind::Ball:
      pos(d[0]); pos(d[1]); pos(d[2]);
      break;
    case JointKind::Planar:
      pos(dot(d, zi));
      dir(dot(zi, xj)); dir(dot(zi, yj));
      break;
    case JointKind::Distance:
      pos(norm(d) - j.value);
      break;
    case JointKind::Angle:
      dir(dot(zi, zj) - std::cos(j.value * kDeg));
      break;
  }
}

bool jointOnBranch(const Joint& j, const Placement& wi, const Placement& wj) noexcept {
  const double zz = dot(wi.axis(2), wj.axis(2));
  const double xx = dot(wi.axis(0), wj.axis(0));
  switch (j.kind) {
    case JointKind::Fixed:
    case JointKind::Slider: return zz > 0.0 && xx > 0.0;
    case JointKind::Revolute:
    case JointKind::Cylindrical:
    case JointKind::Planar: return zz > 0.0;
    case JointKind::Ball:
    case JointKind::Distance:
    case JointKind::Angle: return true;
  }
  return true;
}

// Six equations holding a grounded component at the placement it had.
void groundRows(const Placement& now, const Placement& held, double scale, std::vector<double>& out) {
  for (int k = 0; k < 3; ++k) out.push_back((now.t[k] - held.t[k]) / scale);
  const Mat3 m = mul(now.r, transpose(held.r));
  out.push_back(0.5 * (m[7] - m[5]));
  out.push_back(0.5 * (m[2] - m[6]));
  out.push_back(0.5 * (m[3] - m[1]));
}

// A component moved by the k-th of its six small motions: 0..2 translate along
// world x/y/z by `h*scale`, 3..5 turn about world x/y/z through its own origin.
Placement nudged(const Placement& p, int k, double h, double scale) noexcept {
  Placement q = p;
  if (k < 3) {
    q.t[static_cast<std::size_t>(k)] += h * scale;
  } else {
    Vec3 axis{0.0, 0.0, 0.0};
    axis[static_cast<std::size_t>(k - 3)] = 1.0;
    q.r = mul(axisAngle(axis, h), p.r);
  }
  return q;
}

std::string quoted(const std::string& s) { return "\"" + s + "\""; }

std::string namedList(const std::vector<std::string>& names) {
  std::string out;
  for (std::size_t i = 0; i < names.size(); ++i) {
    if (i > 0) out += i + 1 == names.size() ? " and " : ", ";
    out += names[i];
  }
  return out;
}

}  // namespace

// ── placement ───────────────────────────────────────────────────────────────

Placement Placement::at(double x, double y, double z) noexcept {
  Placement p;
  p.t = {x, y, z};
  return p;
}

Placement Placement::fromAngles(double x, double y, double z, double rxDeg, double ryDeg,
                                double rzDeg) noexcept {
  Placement p = at(x, y, z);
  const Mat3 rx = axisAngle({1.0, 0.0, 0.0}, rxDeg * kDeg);
  const Mat3 ry = axisAngle({0.0, 1.0, 0.0}, ryDeg * kDeg);
  const Mat3 rz = axisAngle({0.0, 0.0, 1.0}, rzDeg * kDeg);
  p.r = mul(rz, mul(ry, rx));
  return p;
}

Placement Placement::then(const Placement& inner) const noexcept {
  Placement w;
  w.r = mul(r, inner.r);
  const Vec3 p = mulVec(r, inner.t);
  for (int i = 0; i < 3; ++i) w.t[static_cast<std::size_t>(i)] = p[static_cast<std::size_t>(i)] + t[static_cast<std::size_t>(i)];
  return w;
}

Placement Placement::inverse() const noexcept {
  Placement inv;
  inv.r = transpose(r);
  const Vec3 p = mulVec(inv.r, t);
  inv.t = {-p[0], -p[1], -p[2]};
  return inv;
}

Vec3 Placement::point(const Vec3& p) const noexcept {
  const Vec3 q = mulVec(r, p);
  return {q[0] + t[0], q[1] + t[1], q[2] + t[2]};
}

Vec3 Placement::direction(const Vec3& d) const noexcept { return mulVec(r, d); }

Vec3 Placement::axis(int column) const noexcept {
  const std::size_t c = static_cast<std::size_t>(column);
  return {r[c], r[3 + c], r[6 + c]};
}

void Placement::angles(double& rxDeg, double& ryDeg, double& rzDeg) const noexcept {
  // r = Rz * Ry * Rx  =>  r[6] = -sin(ry), r[7] = cos(ry) sin(rx), r[8] = cos(ry) cos(rx),
  //                       r[3] = cos(ry) sin(rz), r[0] = cos(ry) cos(rz).
  const double sy = std::clamp(-r[6], -1.0, 1.0);
  ryDeg = std::asin(sy) / kDeg;
  if (std::abs(sy) < 1.0 - 1e-12) {
    rxDeg = std::atan2(r[7], r[8]) / kDeg;
    rzDeg = std::atan2(r[3], r[0]) / kDeg;
  } else {
    // Gimbal: only rx - rz (or rx + rz) is defined; report it all as rx.
    rzDeg = 0.0;
    rxDeg = std::atan2(-r[5], r[4]) / kDeg;
  }
}

bool isProperRotation(const Mat3& r, double tol) noexcept {
  for (double v : r) {
    if (!std::isfinite(v)) return false;
  }
  const Vec3 x{r[0], r[3], r[6]}, y{r[1], r[4], r[7]}, z{r[2], r[5], r[8]};
  if (std::abs(dot(x, x) - 1.0) > tol || std::abs(dot(y, y) - 1.0) > tol ||
      std::abs(dot(z, z) - 1.0) > tol) {
    return false;
  }
  if (std::abs(dot(x, y)) > tol || std::abs(dot(y, z)) > tol || std::abs(dot(x, z)) > tol) {
    return false;
  }
  return std::abs(dot(cross(x, y), z) - 1.0) <= 3.0 * tol;
}

bool isFinite(const Placement& p) noexcept {
  for (double v : p.t) {
    if (!std::isfinite(v)) return false;
  }
  for (double v : p.r) {
    if (!std::isfinite(v)) return false;
  }
  return true;
}

bool frameFromAxis(const Vec3& origin, const Vec3& axis, Placement& out) noexcept {
  for (double v : origin) {
    if (!std::isfinite(v)) return false;
  }
  const double n = norm(axis);
  if (!std::isfinite(n) || n < 1e-12) return false;
  const Vec3 z{axis[0] / n, axis[1] / n, axis[2] / n};
  Vec3 seed{1.0, 0.0, 0.0};
  if (std::abs(dot(seed, z)) > 1.0 - 1e-6) seed = {0.0, 1.0, 0.0};
  Vec3 x = sub(seed, Vec3{z[0] * dot(seed, z), z[1] * dot(seed, z), z[2] * dot(seed, z)});
  const double nx = norm(x);
  x = {x[0] / nx, x[1] / nx, x[2] / nx};
  const Vec3 y = cross(z, x);
  out.t = origin;
  out.r = {x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]};
  return true;
}

// ── joints ──────────────────────────────────────────────────────────────────

const char* keyword(JointKind kind) noexcept {
  switch (kind) {
    case JointKind::Fixed: return "FIXED";
    case JointKind::Revolute: return "REVOLUTE";
    case JointKind::Slider: return "SLIDER";
    case JointKind::Cylindrical: return "CYLINDRICAL";
    case JointKind::Ball: return "BALL";
    case JointKind::Planar: return "PLANAR";
    case JointKind::Distance: return "DISTANCE";
    case JointKind::Angle: return "ANGLE";
  }
  return "FIXED";
}

bool jointKindFromKeyword(std::string_view word, JointKind& out) noexcept {
  for (const JointKind k : kAllJointKinds) {
    const std::string_view kw = keyword(k);
    if (kw.size() != word.size()) continue;
    bool same = true;
    for (std::size_t i = 0; i < kw.size() && same; ++i) {
      char c = word[i];
      if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 'a' + 'A');
      same = c == kw[i];
    }
    if (same) {
      out = k;
      return true;
    }
  }
  return false;
}

const char* userWord(JointKind kind) noexcept {
  switch (kind) {
    case JointKind::Fixed: return "fixed";
    case JointKind::Revolute: return "revolute";
    case JointKind::Slider: return "slider";
    case JointKind::Cylindrical: return "cylindrical";
    case JointKind::Ball: return "ball";
    case JointKind::Planar: return "planar";
    case JointKind::Distance: return "distance";
    case JointKind::Angle: return "angle";
  }
  return "fixed";
}

std::size_t equationCount(JointKind kind) noexcept {
  switch (kind) {
    case JointKind::Fixed: return 6;
    case JointKind::Revolute: return 5;
    case JointKind::Slider: return 5;
    case JointKind::Cylindrical: return 4;
    case JointKind::Ball: return 3;
    case JointKind::Planar: return 3;
    case JointKind::Distance: return 1;
    case JointKind::Angle: return 1;
  }
  return 0;
}

bool jointTurns(JointKind kind) noexcept {
  return kind == JointKind::Revolute || kind == JointKind::Cylindrical;
}
bool jointSlides(JointKind kind) noexcept {
  return kind == JointKind::Slider || kind == JointKind::Cylindrical;
}
bool jointTakesValue(JointKind kind) noexcept {
  return kind == JointKind::Distance || kind == JointKind::Angle;
}

const Component* Assembly::component(int id) const noexcept {
  for (const Component& c : components) {
    if (c.id == id) return &c;
  }
  return nullptr;
}

Component* Assembly::component(int id) noexcept {
  for (Component& c : components) {
    if (c.id == id) return &c;
  }
  return nullptr;
}

const Component* Assembly::componentNamed(std::string_view name) const noexcept {
  for (const Component& c : components) {
    if (c.name == name) return &c;
  }
  return nullptr;
}

std::size_t Assembly::componentIndex(int id) const noexcept {
  for (std::size_t i = 0; i < components.size(); ++i) {
    if (components[i].id == id) return i;
  }
  return components.size();
}

const Joint* Assembly::joint(int id) const noexcept {
  for (const Joint& j : joints) {
    if (j.id == id) return &j;
  }
  return nullptr;
}

const Joint* Assembly::jointNamed(std::string_view name) const noexcept {
  for (const Joint& j : joints) {
    if (j.name == name) return &j;
  }
  return nullptr;
}

std::vector<const Joint*> Assembly::jointsOf(int componentId) const {
  std::vector<const Joint*> out;
  for (const Joint& j : joints) {
    if (j.first == componentId || j.second == componentId) out.push_back(&j);
  }
  return out;
}

std::size_t Assembly::groundedCount() const noexcept {
  std::size_t n = 0;
  for (const Component& c : components) n += c.grounded ? 1 : 0;
  return n;
}

bool jointWorldFrames(const Assembly& a, const Joint& j, Placement& onFirst,
                      Placement& onSecond) noexcept {
  const Component* f = a.component(j.first);
  const Component* s = a.component(j.second);
  if (f == nullptr || s == nullptr) return false;
  onFirst = f->placement.then(j.onFirst);
  onSecond = s->placement.then(j.onSecond);
  return true;
}

// ── names and validation ────────────────────────────────────────────────────

bool isValidName(std::string_view name) noexcept {
  if (name.empty() || name.size() > 64) return false;
  bool visible = false;
  for (char ch : name) {
    const unsigned char c = static_cast<unsigned char>(ch);
    if (c < 0x20 || c == 0x7f || c == '"' || c == '\\') return false;
    if (c != ' ') visible = true;
  }
  return visible;
}

const char* toString(AsmCheck check) noexcept {
  switch (check) {
    case AsmCheck::Ok: return "ok";
    case AsmCheck::BadName: return "bad_name";
    case AsmCheck::DuplicateName: return "duplicate_name";
    case AsmCheck::DuplicateId: return "duplicate_id";
    case AsmCheck::BadIdCounter: return "bad_id_counter";
    case AsmCheck::NoSuchBody: return "no_such_body";
    case AsmCheck::NotASolid: return "not_a_solid";
    case AsmCheck::NoSuchComponent: return "no_such_component";
    case AsmCheck::SelfJoint: return "self_joint";
    case AsmCheck::BadPlacement: return "bad_placement";
    case AsmCheck::BadValue: return "bad_value";
  }
  return "unknown";
}

AsmVerdict validate(const Assembly& a, const PartDocument* document) {
  auto refuse = [](AsmCheck c, std::string why) { return AsmVerdict{c, std::move(why)}; };
  std::vector<std::string_view> names;
  for (std::size_t i = 0; i < a.components.size(); ++i) {
    const Component& c = a.components[i];
    if (!isValidName(c.name)) {
      return refuse(AsmCheck::BadName, "a component name must be 1 to 64 printable characters "
                                       "without quotes or backslashes");
    }
    if (std::find(names.begin(), names.end(), std::string_view(c.name)) != names.end()) {
      return refuse(AsmCheck::DuplicateName, "two items are both called " + quoted(c.name));
    }
    names.push_back(c.name);
    for (std::size_t k = 0; k < i; ++k) {
      if (a.components[k].id == c.id) {
        return refuse(AsmCheck::DuplicateId, quoted(c.name) + " shares its identity with " +
                                                 quoted(a.components[k].name));
      }
    }
    if (c.id <= 0 || c.id >= a.nextComponentId) {
      return refuse(AsmCheck::BadIdCounter, quoted(c.name) + " has an identity this assembly "
                                                             "has not issued yet");
    }
    if (!isFinite(c.placement) || !isProperRotation(c.placement.r, 1e-9)) {
      return refuse(AsmCheck::BadPlacement, quoted(c.name) + " has a position or orientation "
                                                             "that is not a real placement");
    }
    if (document != nullptr) {
      const FeatureRecord* rec = document->featureAt(c.body);
      if (rec == nullptr) {
        return refuse(AsmCheck::NoSuchBody, quoted(c.name) + " is made from a body that is no "
                                                             "longer in this part");
      }
      if (rec->produces != IrValueKind::Solid) {
        return refuse(AsmCheck::NotASolid, quoted(c.name) + " is made from " +
                                               featureDisplayName(*rec) +
                                               ", which is not a solid body");
      }
    }
  }
  for (std::size_t i = 0; i < a.joints.size(); ++i) {
    const Joint& j = a.joints[i];
    if (!isValidName(j.name)) {
      return refuse(AsmCheck::BadName, "a joint name must be 1 to 64 printable characters "
                                       "without quotes or backslashes");
    }
    if (std::find(names.begin(), names.end(), std::string_view(j.name)) != names.end()) {
      return refuse(AsmCheck::DuplicateName, "two items are both called " + quoted(j.name));
    }
    names.push_back(j.name);
    for (std::size_t k = 0; k < i; ++k) {
      if (a.joints[k].id == j.id) {
        return refuse(AsmCheck::DuplicateId, quoted(j.name) + " shares its identity with " +
                                                 quoted(a.joints[k].name));
      }
    }
    if (j.id <= 0 || j.id >= a.nextJointId) {
      return refuse(AsmCheck::BadIdCounter, quoted(j.name) + " has an identity this assembly "
                                                             "has not issued yet");
    }
    if (a.component(j.first) == nullptr || a.component(j.second) == nullptr) {
      return refuse(AsmCheck::NoSuchComponent, quoted(j.name) + " joins a component that is "
                                                                "not in the assembly");
    }
    if (j.first == j.second) {
      return refuse(AsmCheck::SelfJoint, quoted(j.name) + " joins a component to itself");
    }
    if (!isFinite(j.onFirst) || !isFinite(j.onSecond) || !isProperRotation(j.onFirst.r, 1e-9) ||
        !isProperRotation(j.onSecond.r, 1e-9) || !std::isfinite(j.value)) {
      return refuse(AsmCheck::BadPlacement, quoted(j.name) + " has a frame that is not a real "
                                                             "placement");
    }
    if (j.kind == JointKind::Distance && !(j.value > 0.0)) {
      return refuse(AsmCheck::BadValue, quoted(j.name) + " is a distance joint, and its distance "
                                                         "must be more than 0 mm");
    }
    if (j.kind == JointKind::Angle && !(j.value > 0.0 && j.value < 180.0)) {
      return refuse(AsmCheck::BadValue, quoted(j.name) + " is an angle joint, and its angle must "
                                                         "be between 0 and 180 degrees");
    }
  }
  return {};
}

// ── the typed IR ────────────────────────────────────────────────────────────
//
// The signature of each op, in the grammar FeatureTree.hpp uses. Arguments in
// [brackets] are optional. gen_archie_op_vocabulary.py parses these lines.
//
//   COMPONENT(%body, "name", x, y, z [, rx, ry, rz])
//       place an instance of the solid %body at x/y/z (mm), turned rx/ry/rz
//       (degrees) about world X, then Y, then Z
//   GROUND("component" [, OFF])
//       hold a component where it is; with OFF, let it move again
//   JOINT(KIND, "name", "first", "second", ox, oy, oz [, ax, ay, az [, value]])
//       KIND = FIXED|REVOLUTE|SLIDER|CYLINDRICAL|BALL|PLANAR|DISTANCE|ANGLE; a joint
//       at world point o (mm) about world axis a (default 0, 0, 1); value is the
//       DISTANCE in mm or the ANGLE in degrees, and the joint holds as created
//   MATE(KIND, "name", "first", "second", x1, y1, z1, ax1, ay1, az1,
//        x2, y2, z2, ax2, ay2, az2 [, value])
//       the same joint stated on each component in its OWN coordinates: the point
//       and axis on the first, then on the second. The solver moves the components
//       until the joint holds, which is how parts are assembled from where they
//       were inserted; value is the DISTANCE in mm or the ANGLE in degrees
//   DRIVE("joint", value [, TURN|SLIDE])
//       turn a joint to an angle (degrees) or slide it to an offset (mm)
//   REMOVE("name")
//       remove a joint, or a component no joint holds
const std::vector<AsmOpSpec>& assemblyOpTable() {
  static const std::vector<AsmOpSpec> table = {
      {"COMPONENT", 5, 8, true},
      {"GROUND", 1, 2, false},
      {"JOINT", 7, 11, false},
      {"MATE", 16, 17, false},
      {"DRIVE", 2, 3, false},
      {"REMOVE", 1, 1, false},
  };
  return table;
}

const AsmOpSpec* findAssemblyOp(std::string_view name) noexcept {
  for (const AsmOpSpec& s : assemblyOpTable()) {
    if (s.name == name) return &s;
  }
  return nullptr;
}

std::string statementFor(const Component& c) {
  double rx = 0.0, ry = 0.0, rz = 0.0;
  c.placement.angles(rx, ry, rz);
  std::string s = "COMPONENT(%" + std::to_string(c.body) + ", " + quoted(c.name) + ", " +
                  formatIrNumber(c.placement.t[0]) + ", " + formatIrNumber(c.placement.t[1]) +
                  ", " + formatIrNumber(c.placement.t[2]);
  if (rx != 0.0 || ry != 0.0 || rz != 0.0) {
    s += ", " + formatIrNumber(rx) + ", " + formatIrNumber(ry) + ", " + formatIrNumber(rz);
  }
  return s + ")";
}

std::string statementFor(const Assembly& a, const Joint& j) {
  const Component* f = a.component(j.first);
  const Component* s = a.component(j.second);
  std::string out = std::string("JOINT(") + keyword(j.kind) + ", " + quoted(j.name) + ", " +
                    quoted(f != nullptr ? f->name : std::string("?")) + ", " +
                    quoted(s != nullptr ? s->name : std::string("?"));
  Placement wi;
  Placement wj;
  if (jointWorldFrames(a, j, wi, wj)) {
    const Vec3 z = wi.axis(2);
    out += ", " + formatIrNumber(wi.t[0]) + ", " + formatIrNumber(wi.t[1]) + ", " +
           formatIrNumber(wi.t[2]) + ", " + formatIrNumber(z[0]) + ", " + formatIrNumber(z[1]) +
           ", " + formatIrNumber(z[2]);
    if (jointTakesValue(j.kind)) out += ", " + formatIrNumber(j.value);
  }
  return out + ")";
}

// ── measurement ─────────────────────────────────────────────────────────────

std::vector<JointMeasure> measureJoints(const Assembly& a, const Tolerance& tol) {
  std::vector<JointMeasure> out;
  const double lengthTol = lengthTolerance(a, tol);
  std::vector<Row> rows;
  for (const Joint& j : a.joints) {
    JointMeasure m;
    m.jointId = j.id;
    m.equations = equationCount(j.kind);
    Placement wi;
    Placement wj;
    if (!jointWorldFrames(a, j, wi, wj)) {
      m.positionError = HUGE_VAL;
      m.onBranch = false;
      out.push_back(m);
      continue;
    }
    rows.clear();
    jointRows(j, wi, wj, rows);
    for (const Row& r : rows) {
      const double e = std::isfinite(r.value) ? std::abs(r.value) : HUGE_VAL;
      if (r.position) {
        m.positionError = std::max(m.positionError, e);
      } else {
        m.directionError = std::max(m.directionError, e);
      }
    }
    m.onBranch = jointOnBranch(j, wi, wj);
    m.holds = m.onBranch && m.positionError <= lengthTol && m.directionError <= tol.direction;
    out.push_back(m);
  }
  return out;
}

std::size_t Freedom::redundantEquations() const noexcept {
  std::size_t n = 0;
  for (const Redundancy& r : redundancies) n += r.redundantEquations;
  return n;
}

Freedom countFreedom(const Assembly& a) {
  Freedom out;
  const std::size_t n = a.components.size();
  const std::size_t cols = 6 * n;
  out.floating = a.groundedCount() == 0;
  if (n == 0) return out;
  const double scale = lengthScale(a);
  constexpr double h = 1e-6;

  // One Jacobian row, the component columns it touches, and who owns it:
  // owner > 0 a joint id, owner < 0 a grounded component id.
  struct JRow {
    std::vector<double> g;
    int owner = 0;
  };
  std::vector<JRow> jac;

  for (std::size_t ci = 0; ci < n; ++ci) {
    const Component& c = a.components[ci];
    if (!c.grounded) continue;
    std::vector<double> base;
    for (int k = 0; k < 6; ++k) {
      std::vector<double> plus, minus;
      groundRows(nudged(c.placement, k, h, scale), c.placement, scale, plus);
      groundRows(nudged(c.placement, k, -h, scale), c.placement, scale, minus);
      if (base.empty()) base.assign(6 * cols, 0.0);
      for (std::size_t r = 0; r < 6; ++r) {
        base[r * cols + 6 * ci + static_cast<std::size_t>(k)] = (plus[r] - minus[r]) / (2.0 * h);
      }
    }
    for (std::size_t r = 0; r < 6; ++r) {
      JRow row;
      row.g.assign(base.begin() + static_cast<std::ptrdiff_t>(r * cols),
                   base.begin() + static_cast<std::ptrdiff_t>((r + 1) * cols));
      row.owner = -c.id;
      jac.push_back(std::move(row));
    }
    out.equations += 6;
  }

  std::vector<Row> plus, minus;
  for (const Joint& j : a.joints) {
    const std::size_t fi = a.componentIndex(j.first);
    const std::size_t si = a.componentIndex(j.second);
    if (fi >= n || si >= n) continue;
    const std::size_t eq = equationCount(j.kind);
    std::vector<JRow> rows(eq);
    for (JRow& r : rows) {
      r.g.assign(cols, 0.0);
      r.owner = j.id;
    }
    for (int side = 0; side < 2; ++side) {
      const std::size_t idx = side == 0 ? fi : si;
      for (int k = 0; k < 6; ++k) {
        Assembly moved = a;
        moved.components[idx].placement = nudged(a.components[idx].placement, k, h, scale);
        Placement wi, wj;
        jointWorldFrames(moved, j, wi, wj);
        plus.clear();
        jointRows(j, wi, wj, plus);
        moved.components[idx].placement = nudged(a.components[idx].placement, k, -h, scale);
        jointWorldFrames(moved, j, wi, wj);
        minus.clear();
        jointRows(j, wi, wj, minus);
        for (std::size_t r = 0; r < eq && r < plus.size() && r < minus.size(); ++r) {
          const double denom = plus[r].position ? scale : 1.0;
          rows[r].g[6 * idx + static_cast<std::size_t>(k)] +=
              (plus[r].value - minus[r].value) / (2.0 * h * denom);
        }
      }
    }
    for (JRow& r : rows) jac.push_back(std::move(r));
    out.equations += eq;
  }

  // Rows in order; a row that adds no new direction is redundant, and the
  // independent rows that reproduce it are what already hold it.
  std::vector<std::vector<double>> basis;      // orthonormal
  std::vector<const JRow*> independent;        // the original rows behind the basis
  constexpr double kRankTol = 1e-7;
  auto addRedundancy = [&](const JRow& row, const std::vector<int>& heldBy) {
    for (Freedom::Redundancy& r : out.redundancies) {
      const bool same = row.owner > 0 ? r.jointId == row.owner
                                      : (r.jointId == 0 && r.componentId == -row.owner);
      if (same) {
        ++r.redundantEquations;
        for (int h2 : heldBy) {
          if (std::find(r.heldBy.begin(), r.heldBy.end(), h2) == r.heldBy.end()) r.heldBy.push_back(h2);
        }
        return;
      }
    }
    Freedom::Redundancy r;
    r.jointId = row.owner > 0 ? row.owner : 0;
    r.componentId = row.owner < 0 ? -row.owner : 0;
    r.redundantEquations = 1;
    r.heldBy = heldBy;
    out.redundancies.push_back(std::move(r));
  };

  for (const JRow& row : jac) {
    std::vector<double> w = row.g;
    double rowNorm = 0.0;
    for (double v : w) rowNorm += v * v;
    rowNorm = std::sqrt(rowNorm);
    for (int pass = 0; pass < 2; ++pass) {
      for (const std::vector<double>& q : basis) {
        double p = 0.0;
        for (std::size_t k = 0; k < cols; ++k) p += q[k] * w[k];
        for (std::size_t k = 0; k < cols; ++k) w[k] -= p * q[k];
      }
    }
    double rest = 0.0;
    for (double v : w) rest += v * v;
    rest = std::sqrt(rest);
    if (rowNorm > 0.0 && rest > kRankTol * std::max(1.0, rowNorm)) {
      for (double& v : w) v /= rest;
      basis.push_back(std::move(w));
      independent.push_back(&row);
      continue;
    }
    // Dependent: least squares over the independent rows (normal equations,
    // Cholesky) to find which of them it is made of.
    const std::size_t k = independent.size();
    std::vector<int> heldBy;
    if (k > 0 && rowNorm > 0.0) {
      std::vector<double> G(k * k, 0.0), b(k, 0.0);
      for (std::size_t p = 0; p < k; ++p) {
        for (std::size_t c = 0; c < cols; ++c) b[p] += independent[p]->g[c] * row.g[c];
        for (std::size_t q = 0; q <= p; ++q) {
          double s = 0.0;
          for (std::size_t c = 0; c < cols; ++c) s += independent[p]->g[c] * independent[q]->g[c];
          G[p * k + q] = s;
          G[q * k + p] = s;
        }
      }
      // Cholesky G = L L^T, in place in the lower triangle.
      bool spd = true;
      for (std::size_t p = 0; p < k && spd; ++p) {
        for (std::size_t q = 0; q <= p; ++q) {
          double s = G[p * k + q];
          for (std::size_t m = 0; m < q; ++m) s -= G[p * k + m] * G[q * k + m];
          if (p == q) {
            if (s <= 0.0) {
              spd = false;
              break;
            }
            G[p * k + p] = std::sqrt(s);
          } else {
            G[p * k + q] = s / G[q * k + q];
          }
        }
      }
      if (spd) {
        std::vector<double> y(k, 0.0), c(k, 0.0);
        for (std::size_t p = 0; p < k; ++p) {
          double s = b[p];
          for (std::size_t m = 0; m < p; ++m) s -= G[p * k + m] * y[m];
          y[p] = s / G[p * k + p];
        }
        for (std::size_t p = k; p-- > 0;) {
          double s = y[p];
          for (std::size_t m = p + 1; m < k; ++m) s -= G[m * k + p] * c[m];
          c[p] = s / G[p * k + p];
        }
        double biggest = 0.0;
        for (double v : c) biggest = std::max(biggest, std::abs(v));
        for (std::size_t p = 0; p < k; ++p) {
          if (std::abs(c[p]) > 1e-6 * std::max(1.0, biggest)) {
            const int owner = independent[p]->owner;
            if (owner != row.owner &&
                std::find(heldBy.begin(), heldBy.end(), owner) == heldBy.end()) {
              heldBy.push_back(owner);
            }
          }
        }
      }
    }
    addRedundancy(row, heldBy);
  }

  out.rank = basis.size();
  out.degrees = static_cast<int>(cols) - static_cast<int>(out.rank);
  return out;
}

bool jointCoordinates(const Assembly& a, const Joint& j, double& turnDeg, double& slideMm) noexcept {
  Placement wi, wj;
  if (!jointWorldFrames(a, j, wi, wj)) return false;
  const Vec3 xj = wj.axis(0);
  turnDeg = std::atan2(dot(xj, wi.axis(1)), dot(xj, wi.axis(0))) / kDeg;
  slideMm = dot(sub(wj.t, wi.t), wi.axis(2));
  return std::isfinite(turnDeg) && std::isfinite(slideMm);
}

// ── the verdict of an edit ──────────────────────────────────────────────────

EditVerdict solveAndVerify(const Assembly& candidate, const PartDocument* document,
                           AssemblySolver* solver, const std::vector<Drive>& drives,
                           const Tolerance& tol) {
  EditVerdict v;
  const AsmVerdict valid = validate(candidate, document);
  if (!valid.ok()) {
    v.reason = valid.reason;
    return v;
  }
  auto jointName = [&](int id) {
    const Joint* j = candidate.joint(id);
    return j != nullptr ? quoted(j->name) : std::string("a joint");
  };
  for (const Drive& d : drives) {
    const Joint* j = candidate.joint(d.jointId);
    if (j == nullptr) {
      v.reason = "there is no joint to move";
      return v;
    }
    if (d.slide ? !jointSlides(j->kind) : !jointTurns(j->kind)) {
      v.reason = quoted(j->name) + " is a " + userWord(j->kind) + " joint, which cannot be " +
                 (d.slide ? "slid" : "turned");
      v.namedJoints.push_back(j->id);
      return v;
    }
    if (!std::isfinite(d.value)) {
      v.reason = quoted(j->name) + " cannot be moved to a value that is not a number";
      return v;
    }
  }

  Assembly result = candidate;
  int engineDegrees = 0;
  bool engineAnswered = false;
  if (!candidate.joints.empty() || !drives.empty()) {
    if (solver == nullptr) {
      // No engine in this build. An edit that moves nothing and whose every
      // joint already holds is still a correct assembly; anything else needs
      // placements computed, and there is nothing here to compute them.
      bool allHold = drives.empty();
      for (const JointMeasure& m : measureJoints(candidate, tol)) allHold = allHold && m.holds;
      if (!allHold) {
        v.reason = "this build of Forge has no assembly solver, so it cannot move the "
                   "components to where the joints need them";
        return v;
      }
    } else {
      const SolveOutcome out = solver->solve(candidate, drives);
      if (!out.solved) {
        v.reason = out.reason.empty() ? std::string("the assembly could not be solved") : out.reason;
        // Name the joints the engine could not satisfy -- or, when it named none,
        // the ones that do not hold where the parts are now -- and what they
        // collide with: the rows the rank count says already hold what they repeat.
        std::vector<int> suspects = out.conflictingJoints;
        if (suspects.empty()) {
          for (const JointMeasure& m : measureJoints(candidate, tol)) {
            if (!m.holds) suspects.push_back(m.jointId);
          }
        }
        std::vector<int> named = suspects;
        bool collides = false;
        const Freedom f = countFreedom(candidate);
        std::vector<std::string> alsoGrounded;
        for (int id : suspects) {
          for (const Freedom::Redundancy& r : f.redundancies) {
            if (r.jointId != id) continue;
            for (int h : r.heldBy) {
              collides = true;
              if (h > 0) {
                if (std::find(named.begin(), named.end(), h) == named.end()) named.push_back(h);
              } else if (const Component* g = candidate.component(-h)) {
                const std::string s = "grounded " + quoted(g->name);
                if (std::find(alsoGrounded.begin(), alsoGrounded.end(), s) == alsoGrounded.end()) {
                  alsoGrounded.push_back(s);
                }
              }
            }
          }
        }
        // "Cannot all hold at once" is a claim about the joints, and it is made only
        // when there is evidence for it: the rank count found a joint that does not
        // hold repeating what others already hold, or the engine itself found the
        // joints inconsistent. A solve that merely failed to converge keeps the
        // engine's own sentence, which names the joints it could not make hold.
        const bool engineSaysConflict =
            out.reason.rfind("these joints cannot all hold at once", 0) == 0;
        if (!named.empty() && (collides || engineSaysConflict)) {
          std::vector<std::string> words;
          for (int id : named) words.push_back(jointName(id));
          for (const std::string& g : alsoGrounded) words.push_back(g);
          v.reason = "these cannot all hold at once: " + namedList(words);
        }
        v.namedJoints = named;
        return v;
      }
      if (out.placements.size() != candidate.components.size()) {
        v.reason = "the assembly solver answered for a different number of components";
        return v;
      }
      for (std::size_t i = 0; i < out.placements.size(); ++i) {
        if (!isFinite(out.placements[i]) || !isProperRotation(out.placements[i].r, 1e-7)) {
          v.reason = "the assembly solver returned a placement for " +
                     quoted(candidate.components[i].name) + " that is not a real placement";
          return v;
        }
        result.components[i].placement = out.placements[i];
      }
      engineDegrees = out.degreesOfFreedom;
      engineAnswered = true;
    }
  }

  // ── MEASURE the answer, with this file's own arithmetic ──────────────────
  const double lengthTol = lengthTolerance(result, tol);
  for (std::size_t i = 0; i < result.components.size(); ++i) {
    const Component& before = candidate.components[i];
    if (!before.grounded) continue;
    const Placement& after = result.components[i].placement;
    double moved = 0.0;
    for (int k = 0; k < 3; ++k) moved = std::max(moved, std::abs(after.t[static_cast<std::size_t>(k)] - before.placement.t[static_cast<std::size_t>(k)]));
    double turned = 0.0;
    for (int k = 0; k < 9; ++k) turned = std::max(turned, std::abs(after.r[static_cast<std::size_t>(k)] - before.placement.r[static_cast<std::size_t>(k)]));
    if (moved > lengthTol || turned > tol.direction * 10.0) {
      v.reason = "the solver's answer moves " + quoted(before.name) + ", which is grounded";
      return v;
    }
    // Within tolerance is not the same as unmoved. A grounded part is put back
    // EXACTLY where it was, so round-off cannot creep it across a thousand edits.
    result.components[i].placement = before.placement;
  }
  const std::vector<JointMeasure> measures = measureJoints(result, tol);
  std::vector<int> broken;
  for (const JointMeasure& m : measures) {
    if (!m.holds) broken.push_back(m.jointId);
  }
  if (!broken.empty()) {
    std::vector<std::string> words;
    for (int id : broken) words.push_back(jointName(id));
    v.reason = "these cannot all hold at once: " + namedList(words);
    v.namedJoints = broken;
    return v;
  }
  for (const Drive& d : drives) {
    const Joint* j = result.joint(d.jointId);
    double turn = 0.0, slide = 0.0;
    if (j == nullptr || !jointCoordinates(result, *j, turn, slide)) {
      v.reason = "the moved joint could not be measured";
      return v;
    }
    const double wanted = d.slide ? d.value : std::remainder(d.value, 360.0);
    const double got = d.slide ? slide : turn;
    const double err = d.slide ? std::abs(got - wanted) : std::abs(std::remainder(got - wanted, 360.0));
    if (err > (d.slide ? lengthTol : 1e-6)) {
      char buf[160];
      std::snprintf(buf, sizeof(buf), "%s could not be %s to %s: the assembly holds it at %s",
                    quoted(j->name).c_str(), d.slide ? "slid" : "turned",
                    (formatIrNumber(d.value) + (d.slide ? " mm" : " degrees")).c_str(),
                    (formatIrNumber(got) + (d.slide ? " mm" : " degrees")).c_str());
      v.reason = buf;
      v.namedJoints.push_back(j->id);
      return v;
    }
  }
  v.freedom = countFreedom(result);
  if (engineAnswered && engineDegrees != v.freedom.degrees) {
    v.reason = "the solver and Forge's own count disagree about how free the assembly is (" +
               std::to_string(engineDegrees) + " against " + std::to_string(v.freedom.degrees) +
               "), so the result is not trusted";
    return v;
  }
  v.result = std::move(result);
  v.ok = true;
  return v;
}

// ── what the panels show ────────────────────────────────────────────────────

std::string bodyName(const PartDocument& document, int body) {
  const FeatureRecord* rec = document.featureAt(body);
  if (rec == nullptr || rec->produces != IrValueKind::Solid) return {};
  return rec->label.empty() ? featureDisplayName(*rec) : rec->label + " " + std::to_string(body);
}

std::vector<BomRow> billOfMaterials(const Assembly& a, const PartDocument& document) {
  std::vector<BomRow> rows;
  for (const Component& c : a.components) {
    BomRow* row = nullptr;
    for (BomRow& r : rows) {
      if (r.body == c.body) row = &r;
    }
    if (row == nullptr) {
      BomRow r;
      r.body = c.body;
      r.part = bodyName(document, c.body);
      if (r.part.empty()) r.part = "missing";
      rows.push_back(std::move(r));
      row = &rows.back();
    }
    ++row->quantity;
    row->instances.push_back(c.name);
  }
  return rows;
}

AssemblyStatus assessAssembly(const Assembly& a, const PartDocument& document) {
  AssemblyStatus s;
  s.empty = a.components.empty();
  s.validity = validate(a, &document);
  if (s.empty) {
    s.summary = "no components";
    return s;
  }
  s.joints = measureJoints(a);
  for (const JointMeasure& m : s.joints) {
    if (m.holds) {
      ++s.jointsHolding;
    } else {
      s.everyJointHolds = false;
    }
  }
  s.freedom = countFreedom(a);
  if (!s.validity.ok()) {
    s.summary = s.validity.reason;
  } else if (!s.everyJointHolds) {
    s.summary = std::to_string(s.joints.size() - s.jointsHolding) + " of " +
                std::to_string(s.joints.size()) + " joints do not hold";
  } else if (s.freedom.floating) {
    s.summary = "nothing is grounded, so the whole assembly is free to move (" +
                std::to_string(s.freedom.degrees) + " degrees of freedom)";
  } else if (s.freedom.degrees == 0) {
    s.summary = "fully held: 0 degrees of freedom";
  } else {
    s.summary = std::to_string(s.freedom.degrees) +
                (s.freedom.degrees == 1 ? " degree of freedom" : " degrees of freedom");
  }
  return s;
}

}  // namespace forge::ui::assembly
