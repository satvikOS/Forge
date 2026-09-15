// forge-desktop/src/AssemblySolverHost.cpp -- see AssemblySolverHost.hpp.
#include "AssemblySolverHost.hpp"

#include <cstddef>
#include <string>
#include <vector>

#include "forge_asmsolver/AsmSolver.h"

namespace forge::desktop {

namespace fa = forge_asmsolver;
namespace asmb = forge::ui::assembly;

namespace {

constexpr double kPi = 3.14159265358979323846;

fa::Placement toSolver(const asmb::Placement& p) {
  fa::Placement q;
  q.t = p.t;
  q.r = p.r;
  return q;
}

asmb::Placement fromSolver(const fa::Placement& p) {
  asmb::Placement q;
  q.t = p.t;
  q.r = p.r;
  return q;
}

// The two enums are separate on purpose -- the library's header must name no
// Forge type -- so they are joined here, exhaustively, where -Wswitch sees both.
fa::JointKind toSolver(asmb::JointKind k) {
  switch (k) {
    case asmb::JointKind::Fixed: return fa::JointKind::Fixed;
    case asmb::JointKind::Revolute: return fa::JointKind::Revolute;
    case asmb::JointKind::Slider: return fa::JointKind::Slider;
    case asmb::JointKind::Cylindrical: return fa::JointKind::Cylindrical;
    case asmb::JointKind::Ball: return fa::JointKind::Ball;
    case asmb::JointKind::Planar: return fa::JointKind::Planar;
    case asmb::JointKind::Distance: return fa::JointKind::Distance;
    case asmb::JointKind::Angle: return fa::JointKind::Angle;
  }
  return fa::JointKind::Fixed;
}

}  // namespace

bool AssemblySolverHost::compatible() const noexcept {
  return fa::apiVersion() == fa::kApiVersion;
}

std::string AssemblySolverHost::engineName() const { return fa::libraryVersion(); }

asmb::SolveOutcome AssemblySolverHost::solve(const asmb::Assembly& a,
                                             const std::vector<asmb::Drive>& drives) {
  ++solves_;
  asmb::SolveOutcome out;
  out.engine = engineName();
  if (!compatible()) {
    out.reason = "the installed assembly solver was built for a different version of Forge";
    return out;
  }
  if (a.components.empty()) {
    out.solved = true;
    return out;
  }

  fa::Request req;
  bool anyGrounded = false;
  for (const asmb::Component& c : a.components) {
    fa::Body b;
    b.name = c.name;
    b.placement = toSolver(c.placement);
    b.grounded = c.grounded;
    anyGrounded = anyGrounded || c.grounded;
    req.bodies.push_back(b);
  }
  // NOTHING GROUNDED is still an assembly: it floats, and its joints still hold
  // or do not. The solver needs something to hold still, so the first component
  // is held FOR THIS SOLVE ONLY. The rigid motion that removes is added back to
  // the count below, so the degrees of freedom are those of the floating
  // assembly, which is what Forge's own rank count measures.
  const bool anchored = !anyGrounded;
  if (anchored) req.bodies.front().grounded = true;

  for (const asmb::Joint& j : a.joints) {
    fa::Joint q;
    q.name = j.name;
    q.kind = toSolver(j.kind);
    q.first = a.componentIndex(j.first);
    q.second = a.componentIndex(j.second);
    q.frameOnFirst = toSolver(j.onFirst);
    q.frameOnSecond = toSolver(j.onSecond);
    q.value = j.kind == asmb::JointKind::Angle ? j.value * kPi / 180.0 : j.value;
    for (const asmb::Drive& d : drives) {
      if (d.jointId != j.id) continue;
      if (d.slide) {
        q.driveTranslation = true;
        q.translation = d.value;
      } else {
        q.driveRotation = true;
        q.rotation = d.value * kPi / 180.0;
      }
    }
    req.joints.push_back(q);
  }

  const fa::Result res = fa::solve(req);
  out.degreesOfFreedom = res.degreesOfFreedom + (anchored ? 6 : 0);
  for (std::size_t k = 0; k < res.joints.size() && k < a.joints.size(); ++k) {
    if (!res.joints[k].holds || !res.joints[k].driveHolds) {
      out.conflictingJoints.push_back(a.joints[k].id);
    }
  }
  if (res.status != fa::Status::Solved) {
    out.reason = res.reason.empty() ? std::string("the assembly could not be solved") : res.reason;
    return out;
  }
  out.placements.reserve(res.placements.size());
  for (const fa::Placement& p : res.placements) out.placements.push_back(fromSolver(p));
  out.solved = true;
  return out;
}

}  // namespace forge::desktop
