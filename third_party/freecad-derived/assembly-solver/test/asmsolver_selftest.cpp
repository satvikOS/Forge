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
// The library's own self-test, through the public header only. It is what a
// recipient who rebuilds this LGPL library runs to see that their build still
// solves. Every expected number is derived from the geometry of the case, not
// copied from an earlier run, and every pose is checked with arithmetic written
// here rather than with anything the solver reports about itself.
//
// Exit 0 iff every check holds.

#include "forge_asmsolver/AsmSolver.h"

#include <cmath>
#include <cstdio>
#include <string>

using namespace forge_asmsolver;

namespace {

int g_checks = 0;
int g_failed = 0;

void check(bool ok, const std::string& what) {
    ++g_checks;
    if (!ok) {
        ++g_failed;
        std::printf("  FAIL %s\n", what.c_str());
    } else {
        std::printf("  ok   %s\n", what.c_str());
    }
}

constexpr double kPi = 3.14159265358979323846;

Placement at(double x, double y, double z) {
    Placement p;
    p.t = {x, y, z};
    return p;
}

std::array<double, 3> col(const Placement& p, int c) { return {p.r[c], p.r[3 + c], p.r[6 + c]}; }

// Two 100 x 20 x 5 mm plates. Plate A is grounded at the origin; plate B lies
// on top of it. The hinge is at (90, 10, 5), the far end of A, turning about +z.
Request hingedPlates() {
    Request r;
    r.bodies.push_back(Body{"A", at(0, 0, 0), true});
    r.bodies.push_back(Body{"B", at(80, 0, 5), false});
    Joint hinge;
    hinge.name = "hinge";
    hinge.kind = JointKind::Revolute;
    hinge.first = 0;
    hinge.second = 1;
    hinge.frameOnFirst = at(90, 10, 5);    // in A's coordinates
    hinge.frameOnSecond = at(10, 10, 0);   // the same world point in B's coordinates
    r.joints.push_back(hinge);
    return r;
}

}  // namespace

int main() {
    std::printf("%s (api %d)\n", libraryVersion(), apiVersion());

    std::printf("[1] two plates and a revolute joint\n");
    {
        const Result res = solve(hingedPlates());
        check(res.status == Status::Solved, "solves: " + std::string(toString(res.status)) + " " + res.reason);
        check(res.degreesOfFreedom == 1, "1 degree of freedom (got " + std::to_string(res.degreesOfFreedom) + ")");
        check(res.joints.size() == 1 && res.joints[0].equations == 5, "the revolute joint is 5 equations");
        check(res.groundEquations == 6, "grounding A is 6 equations");
    }

    std::printf("[2] the hinge turns B by 30 degrees about the hinge axis\n");
    {
        Request req = hingedPlates();
        req.joints[0].driveRotation = true;
        req.joints[0].rotation = 30.0 * kPi / 180.0;
        const Result res = solve(req);
        check(res.status == Status::Solved, "solves: " + std::string(toString(res.status)) + " " + res.reason);
        if (res.status == Status::Solved) {
            const Placement& b = res.placements[1];
            // B's x axis must now point 30 degrees round from world x.
            const auto bx = col(b, 0);
            check(std::abs(bx[0] - std::cos(kPi / 6)) < 1e-9 && std::abs(bx[1] - std::sin(kPi / 6)) < 1e-9 &&
                      std::abs(bx[2]) < 1e-9,
                  "B's x axis is at +30 degrees in the xy plane");
            // The hinge point (10,10,0) on B must still be at (90,10,5) in the world.
            const double hx = b.r[0] * 10 + b.r[1] * 10 + b.t[0];
            const double hy = b.r[3] * 10 + b.r[4] * 10 + b.t[1];
            const double hz = b.r[6] * 10 + b.r[7] * 10 + b.t[2];
            check(std::abs(hx - 90) < 1e-7 && std::abs(hy - 10) < 1e-7 && std::abs(hz - 5) < 1e-7,
                  "the hinge point did not move");
            // A grounded body stays exactly where it was.
            const Placement& a = res.placements[0];
            check(std::abs(a.t[0]) < 1e-9 && std::abs(a.t[1]) < 1e-9 && std::abs(a.t[2]) < 1e-9 &&
                      std::abs(a.r[0] - 1) < 1e-9 && std::abs(a.r[4] - 1) < 1e-9,
                  "grounded A did not move");
            check(res.degreesOfFreedom == 1, "still 1 degree of freedom while moved");
        }
    }

    std::printf("[3] a 170 degree turn lands on 170, not on the mirror branch at -10\n");
    {
        Request req = hingedPlates();
        req.joints[0].driveRotation = true;
        req.joints[0].rotation = 170.0 * kPi / 180.0;
        const Result res = solve(req);
        check(res.status == Status::Solved, "solves");
        if (res.status == Status::Solved) {
            const auto bx = col(res.placements[1], 0);
            const double deg = std::atan2(bx[1], bx[0]) * 180.0 / kPi;
            check(std::abs(deg - 170.0) < 1e-6, "B is at 170 degrees (got " + std::to_string(deg) + ")");
        }
    }

    std::printf("[4] fixing B to A as well leaves 0 degrees of freedom\n");
    {
        Request req = hingedPlates();
        Joint fix;
        fix.name = "fix";
        fix.kind = JointKind::Fixed;
        fix.first = 0;
        fix.second = 1;
        fix.frameOnFirst = at(80, 0, 5);
        fix.frameOnSecond = at(0, 0, 0);
        req.joints.push_back(fix);
        const Result res = solve(req);
        check(res.status == Status::Solved, "solves: " + res.reason);
        check(res.degreesOfFreedom == 0, "0 degrees of freedom (got " + std::to_string(res.degreesOfFreedom) + ")");
        std::size_t redundant = 0;
        for (const JointOutcome& o : res.joints) redundant += o.redundantEquations;
        check(redundant == 5, "5 equations are redundant (got " + std::to_string(redundant) + ")");
    }

    std::printf("[5] a fixed joint that disagrees with the hinge is a conflict, named\n");
    {
        Request req = hingedPlates();
        Joint fix;
        fix.name = "fix";
        fix.kind = JointKind::Fixed;
        fix.first = 0;
        fix.second = 1;
        // Holds B 10 mm further along x than where it is -- where the hinge cannot be.
        fix.frameOnFirst = at(90, 0, 5);
        fix.frameOnSecond = at(0, 0, 0);
        req.joints.push_back(fix);
        const Result res = solve(req);
        // Either the solver converges on the independent equations and reports the
        // redundant one violated (Conflicting), or it cannot converge at all
        // (DidNotConverge). What it may never do is report Solved.
        check(res.status == Status::Conflicting || res.status == Status::DidNotConverge,
              "refused, not solved: " + std::string(toString(res.status)) + " " + res.reason);
        check(res.reason.find("\"hinge\"") != std::string::npos || res.reason.find("\"fix\"") != std::string::npos,
              "the reason names a joint: " + res.reason);
        check(res.placements.empty() || res.status == Status::Conflicting,
              "no placements are offered for a solve that did not finish");
    }

    std::printf("[6] refusals\n");
    {
        Request req = hingedPlates();
        req.bodies[0].grounded = false;
        check(solve(req).status == Status::NothingGrounded, "nothing grounded");
        req = hingedPlates();
        req.joints[0].second = 0;
        check(solve(req).status == Status::InvalidRequest, "a joint from a body to itself");
        req = hingedPlates();
        req.bodies[1].placement.r[0] = 2.0;
        check(solve(req).status == Status::InvalidRequest, "a non-rotation orientation");
        req = hingedPlates();
        req.joints[0].kind = JointKind::Distance;
        req.joints[0].value = 0.0;
        check(solve(req).status == Status::InvalidRequest, "a zero distance");
    }

    std::printf("[7] a slider slides 25 mm along its axis\n");
    {
        Request req = hingedPlates();
        req.joints[0].kind = JointKind::Slider;
        req.joints[0].driveTranslation = true;
        req.joints[0].translation = 25.0;
        const Result res = solve(req);
        check(res.status == Status::Solved, "solves: " + res.reason);
        if (res.status == Status::Solved) {
            const Placement& b = res.placements[1];
            check(std::abs(b.t[0] - 80) < 1e-7 && std::abs(b.t[1]) < 1e-7 && std::abs(b.t[2] - 30) < 1e-7,
                  "B moved from z=5 to z=30 and nowhere else");
            check(std::abs(b.r[0] - 1) < 1e-9 && std::abs(b.r[4] - 1) < 1e-9 && std::abs(b.r[8] - 1) < 1e-9,
                  "B did not turn");
        }
        req.joints[0].driveTranslation = false;
        const Result free = solve(req);
        check(free.degreesOfFreedom == 1, "a slider leaves 1 degree of freedom");
    }

    std::printf("[8] degrees of freedom of every joint kind\n");
    {
        const struct {
            JointKind kind;
            double value;
            int dof;
            const char* name;
        } kinds[] = {
            {JointKind::Fixed, 0, 0, "fixed"},         {JointKind::Revolute, 0, 1, "revolute"},
            {JointKind::Slider, 0, 1, "slider"},       {JointKind::Cylindrical, 0, 2, "cylindrical"},
            {JointKind::Ball, 0, 3, "ball"},           {JointKind::Planar, 0, 3, "planar"},
            {JointKind::Distance, 5.0, 5, "distance"}, {JointKind::Angle, kPi / 3, 5, "angle"},
        };
        for (const auto& k : kinds) {
            Request req = hingedPlates();
            req.joints[0].kind = k.kind;
            req.joints[0].value = k.value;
            if (k.kind == JointKind::Distance) {
                // put B's frame 5 mm above A's so the distance already holds
                req.joints[0].frameOnSecond = at(10, 10, -5);
            }
            if (k.kind == JointKind::Angle) {
                // tilt B's frame 60 degrees about x so the angle already holds
                Placement f = at(10, 10, 0);
                const double c = std::cos(kPi / 3), s = std::sin(kPi / 3);
                f.r = {1, 0, 0, 0, c, -s, 0, s, c};
                req.joints[0].frameOnSecond = f;
            }
            const Result res = solve(req);
            check(res.status == Status::Solved && res.degreesOfFreedom == k.dof,
                  std::string(k.name) + " leaves " + std::to_string(k.dof) + " (got " +
                      std::to_string(res.degreesOfFreedom) + ", " + toString(res.status) + " " + res.reason + ")");
        }
    }

    std::printf("%d checks, %d failed\n", g_checks, g_failed);
    return g_failed == 0 ? 0 : 1;
}
