/***************************************************************************
 *   Copyright (c) 2026 ArchDisc                                           *
 *                                                                         *
 *   This file is part of forge_asmsolver, a modified version of           *
 *   OndselSolver (Copyright (c) 2023 Ondsel, Inc.).                       *
 *                                                                         *
 *   This library is free software; you can redistribute it and/or         *
 *   modify it under the terms of the GNU Lesser General Public            *
 *   License version 2.1 as published by the Free Software Foundation.     *
 *   See ../COPYING.LGPL.                                                  *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
//
// ADDED for Forge (ArchDisc), 2026-09-15 -- see ../MODIFICATIONS.md.
//
// The forge_asmsolver facade: turns one plain-data Request into a fresh
// OndselSolver ASMT assembly, runs the position solve, and reads back
// placements, per-joint equation counts, redundancy and the error of EVERY
// equation -- including the ones the solver set aside as redundant, because an
// equation set aside is not an equation satisfied.
//
// Nothing leaves this file as an exception.

#include "forge_asmsolver/AsmSolver.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <exception>
#include <memory>
#include <string>
#include <vector>

#include "ASMTAngleJoint.h"
#include "ASMTAssembly.h"
#include "ASMTCylindricalJoint.h"
#include "ASMTFixedJoint.h"
#include "ASMTMarker.h"
#include "ASMTPart.h"
#include "ASMTPlanarJoint.h"
#include "ASMTPrincipalMassMarker.h"
#include "ASMTRevoluteJoint.h"
#include "ASMTRotationalMotion.h"
#include "ASMTSimulationParameters.h"
#include "ASMTSphSphJoint.h"
#include "ASMTSphericalJoint.h"
#include "ASMTTranslationalJoint.h"
#include "ASMTTranslationalMotion.h"
#include "CREATE.h"
#include "Constraint.h"
#include "FullColumn.h"
#include "FullMatrix.h"
#include "Joint.h"
#include "MaximumIterationError.h"
#include "NewtonRaphsonError.h"
#include "RedundantConstraint.h"
#include "SimulationStoppingError.h"
#include "SingularMatrixError.h"
#include "TooManyTriesError.h"

namespace forge_asmsolver {

namespace {

constexpr const char* kAssemblyName = "Assembly";
constexpr double kPi = 3.14159265358979323846;
// A drive is walked in steps no larger than this, so every solve starts well
// inside the basin of the branch it is meant to land on. The rotational drive's
// equation is sin(theta - target) = 0, which has a second root half a turn
// away; starting within 20 degrees of the target keeps Newton off it.
constexpr double kMaxDriveStep = 20.0 * kPi / 180.0;
constexpr int kMaxDriveSteps = 64;

using V3 = std::array<double, 3>;

bool isFiniteNumber(double v) { return std::isfinite(v); }

V3 col(const std::array<double, 9>& r, int c) { return {r[0 + c], r[3 + c], r[6 + c]}; }
double dot(const V3& a, const V3& b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

std::array<double, 9> mul(const std::array<double, 9>& a, const std::array<double, 9>& b) {
    std::array<double, 9> m{};
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) {
            double s = 0.0;
            for (int k = 0; k < 3; ++k) s += a[3 * i + k] * b[3 * k + j];
            m[3 * i + j] = s;
        }
    return m;
}

V3 mulVec(const std::array<double, 9>& r, const V3& p) {
    return {r[0] * p[0] + r[1] * p[1] + r[2] * p[2], r[3] * p[0] + r[4] * p[1] + r[5] * p[2],
            r[6] * p[0] + r[7] * p[1] + r[8] * p[2]};
}

// World placement of a frame given on a body: body * frame.
Placement compose(const Placement& body, const Placement& frame) {
    Placement w;
    w.r = mul(body.r, frame.r);
    const V3 p = mulVec(body.r, frame.t);
    for (int i = 0; i < 3; ++i) w.t[i] = p[i] + body.t[i];
    return w;
}

// Rotation by `angle` about unit axis `u` (Rodrigues), row-major.
std::array<double, 9> axisAngle(const V3& u, double angle) {
    const double c = std::cos(angle), s = std::sin(angle), k = 1.0 - c;
    return {c + u[0] * u[0] * k,        u[0] * u[1] * k - u[2] * s, u[0] * u[2] * k + u[1] * s,
            u[1] * u[0] * k + u[2] * s, c + u[1] * u[1] * k,        u[1] * u[2] * k - u[0] * s,
            u[2] * u[0] * k - u[1] * s, u[2] * u[1] * k + u[0] * s, c + u[2] * u[2] * k};
}

// Turn/slide a whole body rigidly about/along a world axis through `origin`.
void rotateBodyAbout(Placement& body, const V3& origin, const V3& axis, double angle) {
    const std::array<double, 9> q = axisAngle(axis, angle);
    body.r = mul(q, body.r);
    V3 rel{body.t[0] - origin[0], body.t[1] - origin[1], body.t[2] - origin[2]};
    rel = mulVec(q, rel);
    for (int i = 0; i < 3; ++i) body.t[i] = origin[i] + rel[i];
}

bool rotationIsProper(const std::array<double, 9>& r, double tol) {
    const V3 x = col(r, 0), y = col(r, 1), z = col(r, 2);
    if (std::abs(dot(x, x) - 1.0) > tol || std::abs(dot(y, y) - 1.0) > tol ||
        std::abs(dot(z, z) - 1.0) > tol)
        return false;
    if (std::abs(dot(x, y)) > tol || std::abs(dot(y, z)) > tol || std::abs(dot(x, z)) > tol)
        return false;
    const double det = r[0] * (r[4] * r[8] - r[5] * r[7]) - r[1] * (r[3] * r[8] - r[5] * r[6]) +
                       r[2] * (r[3] * r[7] - r[4] * r[6]);
    return std::abs(det - 1.0) <= tol * 3.0;
}

bool placementFinite(const Placement& p) {
    for (double v : p.t)
        if (!isFiniteNumber(v)) return false;
    for (double v : p.r)
        if (!isFiniteNumber(v)) return false;
    return true;
}

const char* kindWord(JointKind k) {
    switch (k) {
        case JointKind::Fixed: return "fixed";
        case JointKind::Revolute: return "revolute";
        case JointKind::Slider: return "slider";
        case JointKind::Cylindrical: return "cylindrical";
        case JointKind::Ball: return "ball";
        case JointKind::Planar: return "planar";
        case JointKind::Distance: return "distance";
        case JointKind::Angle: return "angle";
    }
    return "unknown";
}

std::string formatNumber(double v) {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%.17g", v);
    return buf;
}

std::string partName(std::size_t i) { return "b" + std::to_string(i); }

// Joint objects are created in NAME order by ASMTAssembly::createMbD, and the
// order decides which of two dependent equations the pivoting calls redundant.
// Grounds sort first and joints in request order, so when a joint only repeats
// what is already held it is the JOINT that is reported redundant -- the thing
// the user added -- and not the ground they started from.
std::string groundName(std::size_t i) {
    char buf[32];
    std::snprintf(buf, sizeof(buf), "a%08zu", i);
    return buf;
}
std::string jointName(std::size_t k) {
    char buf[32];
    std::snprintf(buf, sizeof(buf), "j%08zu", k);
    return buf;
}
std::string driveName(std::size_t k, char what) {
    char buf[32];
    std::snprintf(buf, sizeof(buf), "m%08zu%c", k, what);
    return buf;
}

std::shared_ptr<MbD::ASMTMarker> makeMarker(const std::string& name, const Placement& p) {
    auto m = MbD::CREATE<MbD::ASMTMarker>::With();
    m->setName(name);
    m->setPosition3D(p.t[0], p.t[1], p.t[2]);
    m->setRotationMatrix(p.r[0], p.r[1], p.r[2], p.r[3], p.r[4], p.r[5], p.r[6], p.r[7], p.r[8]);
    return m;
}

std::shared_ptr<MbD::ASMTJoint> makeJoint(const Joint& j) {
    switch (j.kind) {
        case JointKind::Fixed: return MbD::CREATE<MbD::ASMTFixedJoint>::With();
        case JointKind::Revolute: return MbD::CREATE<MbD::ASMTRevoluteJoint>::With();
        case JointKind::Slider: return MbD::CREATE<MbD::ASMTTranslationalJoint>::With();
        case JointKind::Cylindrical: return MbD::CREATE<MbD::ASMTCylindricalJoint>::With();
        case JointKind::Ball: return MbD::CREATE<MbD::ASMTSphericalJoint>::With();
        case JointKind::Planar: return MbD::CREATE<MbD::ASMTPlanarJoint>::With();
        case JointKind::Distance: {
            auto d = MbD::CREATE<MbD::ASMTSphSphJoint>::With();
            d->distanceIJ = j.value;
            return d;
        }
        case JointKind::Angle: {
            auto a = MbD::CREATE<MbD::ASMTAngleJoint>::With();
            a->theIzJz = j.value;
            return a;
        }
    }
    return nullptr;
}

// Every equation of a constraint set, evaluated at the CURRENT state of the
// solved system. A redundant equation is unwrapped and evaluated too: the
// solver stopped enforcing it, which says nothing about whether it holds.
struct EquationCount {
    std::size_t equations = 0;
    std::size_t redundant = 0;
    double largestError = 0.0;
};

EquationCount measure(const std::shared_ptr<MbD::Item>& item) {
    EquationCount out;
    auto set = std::dynamic_pointer_cast<MbD::ConstraintSet>(item);
    if (!set) return out;
    set->constraintsDo([&](std::shared_ptr<MbD::Constraint> con) {
        if (!con) return;
        ++out.equations;
        std::shared_ptr<MbD::Constraint> eval = con;
        if (con->isRedundant()) {
            ++out.redundant;
            auto wrapped = std::static_pointer_cast<MbD::RedundantConstraint>(con);
            if (wrapped->constraint) eval = wrapped->constraint;
        }
        eval->calcPostDynCorrectorIteration();
        const double e = std::abs(eval->aG);
        out.largestError = std::max(out.largestError, isFiniteNumber(e) ? e : HUGE_VAL);
    });
    return out;
}

std::string validate(const Request& req) {
    if (req.bodies.empty()) return "there are no bodies to solve";
    if (!(req.tolerance > 0.0) || !isFiniteNumber(req.tolerance)) return "the tolerance must be a positive number";
    for (std::size_t i = 0; i < req.bodies.size(); ++i) {
        const Body& b = req.bodies[i];
        if (b.name.empty()) return "body " + std::to_string(i + 1) + " has no name";
        for (std::size_t k = 0; k < i; ++k)
            if (req.bodies[k].name == b.name) return "two bodies are both called \"" + b.name + "\"";
        if (!placementFinite(b.placement)) return "\"" + b.name + "\" has a position that is not a number";
        if (!rotationIsProper(b.placement.r, 1e-9))
            return "\"" + b.name + "\" has an orientation that is not a rotation";
    }
    for (std::size_t k = 0; k < req.joints.size(); ++k) {
        const Joint& j = req.joints[k];
        if (j.name.empty()) return "joint " + std::to_string(k + 1) + " has no name";
        for (std::size_t m = 0; m < k; ++m)
            if (req.joints[m].name == j.name) return "two joints are both called \"" + j.name + "\"";
        const std::string who = "\"" + j.name + "\"";
        if (static_cast<std::uint8_t>(j.kind) > static_cast<std::uint8_t>(JointKind::Angle))
            return who + " is a kind of joint this solver does not know";
        if (j.first >= req.bodies.size() || j.second >= req.bodies.size())
            return who + " names a body that is not in the assembly";
        if (j.first == j.second) return who + " joins a body to itself";
        if (!placementFinite(j.frameOnFirst) || !placementFinite(j.frameOnSecond) || !isFiniteNumber(j.value))
            return who + " has a frame that is not a number";
        if (!rotationIsProper(j.frameOnFirst.r, 1e-9) || !rotationIsProper(j.frameOnSecond.r, 1e-9))
            return who + " has a frame whose orientation is not a rotation";
        if (j.kind == JointKind::Distance && !(j.value > 0.0))
            return who + " is a distance joint and its distance must be greater than zero";
        if (j.kind == JointKind::Angle && !(j.value > 0.0 && j.value < kPi))
            return who + " is an angle joint and its angle must be between 0 and 180 degrees, exclusive";
        if (j.driveRotation && j.kind != JointKind::Revolute && j.kind != JointKind::Cylindrical)
            return who + " is a " + kindWord(j.kind) + " joint, which cannot be turned";
        if (j.driveTranslation && j.kind != JointKind::Slider && j.kind != JointKind::Cylindrical)
            return who + " is a " + kindWord(j.kind) + " joint, which cannot be slid";
        if ((j.driveRotation && !isFiniteNumber(j.rotation)) || (j.driveTranslation && !isFiniteNumber(j.translation)))
            return who + " is being moved to a value that is not a number";
        if ((j.driveRotation || j.driveTranslation) && req.bodies[j.first].grounded &&
            req.bodies[j.second].grounded)
            return who + " joins two grounded bodies, so neither side can move";
    }
    return {};
}

double lengthScaleOf(const Request& req) {
    double s = 1.0;
    auto grow = [&](const std::array<double, 3>& t) {
        for (double v : t) s = std::max(s, std::abs(v));
    };
    for (const Body& b : req.bodies) grow(b.placement.t);
    for (const Joint& j : req.joints) {
        grow(j.frameOnFirst.t);
        grow(j.frameOnSecond.t);
        if (j.kind == JointKind::Distance) s = std::max(s, std::abs(j.value));
        if (j.driveTranslation) s = std::max(s, std::abs(j.translation));
    }
    return s;
}

// Current rotation of frame J relative to frame I about I's z axis: the angle
// from I's x to J's x, measured in I's xy plane.
double currentRotation(const Request& req, const Joint& j) {
    const Placement wi = compose(req.bodies[j.first].placement, j.frameOnFirst);
    const Placement wj = compose(req.bodies[j.second].placement, j.frameOnSecond);
    const V3 xj = col(wj.r, 0);
    return std::atan2(dot(xj, col(wi.r, 1)), dot(xj, col(wi.r, 0)));
}

double currentTranslation(const Request& req, const Joint& j) {
    const Placement wi = compose(req.bodies[j.first].placement, j.frameOnFirst);
    const Placement wj = compose(req.bodies[j.second].placement, j.frameOnSecond);
    const V3 d{wj.t[0] - wi.t[0], wj.t[1] - wi.t[1], wj.t[2] - wi.t[2]};
    return dot(d, col(wi.r, 2));
}

// One position solve of `req` exactly as given, with drives held at the
// request's own rotation/translation values.
Result runOnce(const Request& req, double scale) {
    Result out;
    out.lengthScale = scale;
    const double tol = req.tolerance * scale;

    auto assembly = MbD::ASMTAssembly::With();
    assembly->setName(kAssemblyName);
    auto sim = MbD::CREATE<MbD::ASMTSimulationParameters>::With();
    sim->settstart(0.0);
    sim->settend(0.0);
    sim->sethmin(1.0e-9);
    sim->sethmax(1.0);
    sim->sethout(0.04);
    sim->seterrorTol(std::min(1.0e-6, req.tolerance));
    assembly->setSimulationParameters(sim);

    std::vector<std::shared_ptr<MbD::ASMTPart>> parts;
    for (std::size_t i = 0; i < req.bodies.size(); ++i) {
        const Body& b = req.bodies[i];
        auto part = MbD::CREATE<MbD::ASMTPart>::With();
        part->setName(partName(i));
        auto mass = MbD::CREATE<MbD::ASMTPrincipalMassMarker>::With();
        mass->setMass(1.0);
        mass->setDensity(1.0);
        mass->setMomentOfInertias(1.0, 1.0, 1.0);
        part->setPrincipalMassMarker(mass);
        part->setPosition3D(b.placement.t[0], b.placement.t[1], b.placement.t[2]);
        const auto& r = b.placement.r;
        part->setRotationMatrix(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]);
        assembly->addPart(part);
        parts.push_back(part);
    }

    const std::string root = std::string("/") + kAssemblyName + "/";
    std::vector<std::shared_ptr<MbD::ASMTJoint>> grounds;
    for (std::size_t i = 0; i < req.bodies.size(); ++i) {
        if (!req.bodies[i].grounded) continue;
        const std::string held = "g" + std::to_string(i);
        assembly->addMarker(makeMarker(held, req.bodies[i].placement));
        parts[i]->addMarker(makeMarker("ground", Placement{}));
        auto fix = MbD::CREATE<MbD::ASMTFixedJoint>::With();
        fix->setName(groundName(i));
        fix->setMarkerI(root + held);
        fix->setMarkerJ(root + partName(i) + "/ground");
        assembly->addJoint(fix);
        grounds.push_back(fix);
    }

    std::vector<std::shared_ptr<MbD::ASMTJoint>> joints;
    std::vector<std::shared_ptr<MbD::ASMTMotion>> rotationDrives(req.joints.size());
    std::vector<std::shared_ptr<MbD::ASMTMotion>> translationDrives(req.joints.size());
    for (std::size_t k = 0; k < req.joints.size(); ++k) {
        const Joint& j = req.joints[k];
        const std::string mi = "k" + std::to_string(k) + "i";
        const std::string mj = "k" + std::to_string(k) + "j";
        parts[j.first]->addMarker(makeMarker(mi, j.frameOnFirst));
        parts[j.second]->addMarker(makeMarker(mj, j.frameOnSecond));
        const std::string fi = root + partName(j.first) + "/" + mi;
        const std::string fj = root + partName(j.second) + "/" + mj;
        auto joint = makeJoint(j);
        joint->setName(jointName(k));
        joint->setMarkerI(fi);
        joint->setMarkerJ(fj);
        assembly->addJoint(joint);
        joints.push_back(joint);
        if (j.driveRotation) {
            auto drive = MbD::CREATE<MbD::ASMTRotationalMotion>::With();
            drive->setName(driveName(k, 'r'));
            drive->setMarkerI(fi);
            drive->setMarkerJ(fj);
            drive->setRotationZ(formatNumber(j.rotation));
            assembly->addMotion(drive);
            rotationDrives[k] = drive;
        }
        if (j.driveTranslation) {
            auto drive = MbD::CREATE<MbD::ASMTTranslationalMotion>::With();
            drive->setName(driveName(k, 't'));
            drive->setMarkerI(fi);
            drive->setMarkerJ(fj);
            drive->setTranslationZ(formatNumber(j.translation));
            assembly->addMotion(drive);
            translationDrives[k] = drive;
        }
    }

    assembly->runPreDrag();

    out.placements.resize(req.bodies.size());
    for (std::size_t i = 0; i < parts.size(); ++i) {
        const auto& p = parts[i]->position3D;
        const auto& r = parts[i]->rotationMatrix;
        Placement& q = out.placements[i];
        for (int a = 0; a < 3; ++a) {
            q.t[a] = p->at(a);
            for (int b = 0; b < 3; ++b) q.r[3 * a + b] = r->at(a)->at(b);
        }
    }

    std::size_t independent = 0;
    bool everythingHolds = true;
    for (const auto& g : grounds) {
        const EquationCount c = measure(g->mbdObject);
        out.groundEquations += c.equations;
        out.redundantGroundEquations += c.redundant;
        independent += c.equations - c.redundant;
        if (c.largestError > tol) everythingHolds = false;
    }
    out.joints.resize(req.joints.size());
    for (std::size_t k = 0; k < joints.size(); ++k) {
        const EquationCount c = measure(joints[k]->mbdObject);
        JointOutcome& o = out.joints[k];
        o.equations = c.equations;
        o.redundantEquations = c.redundant;
        o.largestError = c.largestError;
        o.holds = c.largestError <= tol;
        independent += c.equations - c.redundant;
        if (!o.holds) everythingHolds = false;
        for (const auto& drive : {rotationDrives[k], translationDrives[k]}) {
            if (!drive) continue;
            const EquationCount d = measure(drive->mbdObject);
            o.driveError = std::max(o.driveError, d.largestError);
            if (d.largestError > tol) {
                o.driveHolds = false;
                everythingHolds = false;
            }
        }
    }
    out.degreesOfFreedom =
        static_cast<int>(6 * req.bodies.size()) - static_cast<int>(independent);
    if (assembly->solverMessages) out.messages = *assembly->solverMessages;

    if (everythingHolds) {
        out.status = Status::Solved;
    } else {
        out.status = Status::Conflicting;
        std::string names;
        for (std::size_t k = 0; k < req.joints.size(); ++k) {
            if (out.joints[k].holds && out.joints[k].driveHolds) continue;
            if (!names.empty()) names += ", ";
            names += "\"" + req.joints[k].name + "\"";
        }
        out.reason = names.empty()
                         ? std::string("a grounded body cannot stay where it is")
                         : "these joints cannot all hold at once: " + names;
    }
    return out;
}

Result failure(Status status, std::string reason) {
    Result out;
    out.status = status;
    out.reason = std::move(reason);
    return out;
}

bool anyDrive(const Request& req) {
    for (const Joint& j : req.joints)
        if (j.driveRotation || j.driveTranslation) return true;
    return false;
}

}  // namespace

const char* toString(Status status) noexcept {
    switch (status) {
        case Status::Solved: return "solved";
        case Status::InvalidRequest: return "invalid_request";
        case Status::NothingGrounded: return "nothing_grounded";
        case Status::DidNotConverge: return "did_not_converge";
        case Status::Conflicting: return "conflicting";
        case Status::SolverFault: return "solver_fault";
    }
    return "unknown";
}

int apiVersion() noexcept { return kApiVersion; }

const char* libraryVersion() noexcept {
    return "forge_asmsolver 1 (OndselSolver 30e9b64e8bf881d438d4b88834f9ba3674865418 + Forge "
           "modifications)";
}

Result solve(const Request& request) noexcept {
    Result out;
    try {
        const std::string invalid = validate(request);
        if (!invalid.empty()) {
            out.status = Status::InvalidRequest;
            out.reason = invalid;
            return out;
        }
        bool grounded = false;
        for (const Body& b : request.bodies) grounded = grounded || b.grounded;
        if (!grounded) {
            out.status = Status::NothingGrounded;
            out.reason = "no part of the assembly is grounded, so there is nothing to hold it still";
            return out;
        }
        const double scale = lengthScaleOf(request);

        if (!anyDrive(request)) return runOnce(request, scale);

        // ── a MOVE: walk every driven coordinate from where it is to where it
        // is asked to be, in steps, carrying the placements forward.
        Request walk = request;
        std::vector<double> rotFrom(request.joints.size(), 0.0), rotTo(request.joints.size(), 0.0);
        std::vector<double> trFrom(request.joints.size(), 0.0), trTo(request.joints.size(), 0.0);
        int steps = 1;
        for (std::size_t k = 0; k < request.joints.size(); ++k) {
            const Joint& j = request.joints[k];
            if (j.driveRotation) {
                rotFrom[k] = currentRotation(request, j);
                // The shortest way round to the asked-for angle, so a request
                // for 350 degrees from 0 is a 10 degree move and not 350.
                double delta = std::remainder(j.rotation - rotFrom[k], 2.0 * kPi);
                rotTo[k] = rotFrom[k] + delta;
                steps = std::max(steps, static_cast<int>(std::ceil(std::abs(delta) / kMaxDriveStep)));
            }
            if (j.driveTranslation) {
                trFrom[k] = currentTranslation(request, j);
                trTo[k] = j.translation;
                steps = std::max(steps, 1);
            }
        }
        if (steps > kMaxDriveSteps) steps = kMaxDriveSteps;

        Result last;
        for (int s = 1; s <= steps; ++s) {
            const double f = static_cast<double>(s) / steps;
            for (std::size_t k = 0; k < walk.joints.size(); ++k) {
                Joint& j = walk.joints[k];
                const bool moveSecond = !walk.bodies[j.second].grounded;
                Body& mover = moveSecond ? walk.bodies[j.second] : walk.bodies[j.first];
                const Placement wi = compose(walk.bodies[j.first].placement, j.frameOnFirst);
                const V3 axis = col(wi.r, 2);
                const V3 origin = wi.t;
                if (j.driveRotation) {
                    const double target = rotFrom[k] + (rotTo[k] - rotFrom[k]) * f;
                    const double now = currentRotation(walk, j);
                    const double delta = std::remainder(target - now, 2.0 * kPi);
                    rotateBodyAbout(mover.placement, origin, axis, moveSecond ? delta : -delta);
                    j.rotation = target;
                }
                if (j.driveTranslation) {
                    const double target = trFrom[k] + (trTo[k] - trFrom[k]) * f;
                    const double delta = target - currentTranslation(walk, j);
                    const double sign = moveSecond ? 1.0 : -1.0;
                    for (int a = 0; a < 3; ++a) mover.placement.t[a] += sign * delta * axis[a];
                    j.translation = target;
                }
            }
            last = runOnce(walk, scale);
            if (last.status != Status::Solved) return last;
            for (std::size_t i = 0; i < walk.bodies.size(); ++i) walk.bodies[i].placement = last.placements[i];
        }
        return last;
    } catch (const MbD::MaximumIterationError&) {
        return failure(Status::DidNotConverge,
                       "the solver could not find a position that satisfies the joints");
    } catch (const MbD::TooManyTriesError&) {
        return failure(Status::DidNotConverge,
                       "the solver could not find a position that satisfies the joints");
    } catch (const MbD::SingularMatrixError&) {
        return failure(Status::DidNotConverge,
                       "the joints leave the solver no single answer to move towards");
    } catch (const std::exception& e) {
        const std::string what = e.what();
        return failure(Status::SolverFault,
                       "the solver stopped: " + (what.empty() ? std::string("no reason given") : what));
    } catch (...) {
        return failure(Status::SolverFault, "the solver stopped without giving a reason");
    }
}

}  // namespace forge_asmsolver
