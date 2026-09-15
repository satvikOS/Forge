/***************************************************************************
 *   Copyright (c) 2026 ArchDisc                                           *
 *                                                                         *
 *   This file is part of forge_asmsolver, a modified version of           *
 *   OndselSolver (Copyright (c) 2023 Ondsel, Inc.).                       *
 *                                                                         *
 *   This library is free software; you can redistribute it and/or         *
 *   modify it under the terms of the GNU Lesser General Public            *
 *   License version 2.1 as published by the Free Software Foundation.     *
 *   See ../../COPYING.LGPL.                                               *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
//
// ADDED for Forge (ArchDisc), 2026-09-15 -- see ../../MODIFICATIONS.md.
//
// THE WHOLE PUBLIC SURFACE OF libforge_asmsolver.
//
// This header is deliberately the ONLY thing a host includes. It names no
// OndselSolver type, so the library behind it can be rebuilt from its modified
// source and swapped into an installed application without recompiling the
// host (LGPL-2.1 section 6). Everything here is plain data plus one function.
//
// ── the contract ─────────────────────────────────────────────────────────────
// solve() never throws. Every failure comes back as a Status with a reason in
// words, because a solver fault must reach a user as a refusal and never as a
// crash of the application that asked.
//
// A body's placement is a rotation followed by a translation: a point p given
// in the body's own coordinates is at  r * p + t  in the assembly, with r a
// ROW-MAJOR 3x3 rotation (orthonormal, determinant +1). A joint frame is a
// placement of the same kind in its body's own coordinates; its z axis is the
// joint axis.
//
// What each joint holds, stated on frames I (on `first`) and J (on `second`):
//
//   Fixed        the two frames coincide                               6 equations
//   Revolute     origins coincide, z axes collinear; turns about z      5
//   Slider       z axes collinear, x axes aligned; slides along z       5
//   Cylindrical  z axes collinear; turns about and slides along z       4
//   Ball         origins coincide                                       3
//   Planar       z axes parallel, J's origin in I's xy plane            3
//   Distance     |origin J - origin I| == value (mm, > 0)               1
//   Angle        angle between the z axes == value (radians, in (0,pi)) 1
//
// Each grounded body contributes 6 equations holding it where it is.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace forge_asmsolver {

// Bumped whenever a struct below changes shape. A host checks apiVersion()
// against the value it was compiled with before it trusts the layout.
inline constexpr int kApiVersion = 1;

struct Placement {
    std::array<double, 3> t{0.0, 0.0, 0.0};
    std::array<double, 9> r{1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0};
};

struct Body {
    std::string name;       // non-empty, unique within the request
    Placement placement;    // where the body is now; the solver starts here
    bool grounded = false;  // held exactly where it is
};

enum class JointKind : std::uint8_t {
    Fixed = 0,
    Revolute = 1,
    Slider = 2,
    Cylindrical = 3,
    Ball = 4,
    Planar = 5,
    Distance = 6,
    Angle = 7,
};

struct Joint {
    std::string name;               // non-empty, unique within the request
    JointKind kind = JointKind::Fixed;
    std::size_t first = 0;          // index into Request::bodies
    std::size_t second = 0;         // index into Request::bodies, != first
    Placement frameOnFirst;         // frame I, in first's own coordinates
    Placement frameOnSecond;        // frame J, in second's own coordinates
    double value = 0.0;             // Distance (mm) or Angle (radians); ignored otherwise
    // A MOVE, not a constraint: hold the joint's own free coordinate at a value
    // for this solve. Rotation (radians, J's x from I's x about I's z) is
    // accepted on Revolute and Cylindrical; translation (mm, J's origin along
    // I's z) on Slider and Cylindrical. The solver walks there in steps small
    // enough that it cannot land on the mirror-image branch of the same angle.
    bool driveRotation = false;
    double rotation = 0.0;
    bool driveTranslation = false;
    double translation = 0.0;
};

struct Request {
    std::vector<Body> bodies;
    std::vector<Joint> joints;
    // The largest constraint error, in mm for positions and as a pure number
    // for direction cosines, that still counts as "holds". It is scaled by the
    // size of the request (see Result::lengthScale).
    double tolerance = 1.0e-7;
};

enum class Status : std::uint8_t {
    Solved = 0,          // every equation holds at `placements`
    InvalidRequest,      // the request itself is malformed; nothing was solved
    NothingGrounded,     // no body is grounded, so there is nothing to solve against
    DidNotConverge,      // the solver could not find placements satisfying the joints
    Conflicting,         // it found placements, and some joint does NOT hold at them
    SolverFault,         // the solver raised an error it does not explain
};

const char* toString(Status status) noexcept;

struct JointOutcome {
    std::size_t equations = 0;           // equations this joint contributes
    std::size_t redundantEquations = 0;  // of those, how many are implied by the others
    double largestError = 0.0;           // the worst error over ALL of them at `placements`
    bool holds = false;                  // largestError <= the scaled tolerance
    // Set only for a driven joint: the drive's own error at the result.
    double driveError = 0.0;
    bool driveHolds = true;
};

struct Result {
    Status status = Status::SolverFault;
    std::string reason;                  // empty exactly when status == Solved
    std::vector<Placement> placements;   // one per body; filled for Solved and Conflicting
    std::vector<JointOutcome> joints;    // one per joint, same order as the request
    std::size_t groundEquations = 0;
    std::size_t redundantGroundEquations = 0;
    // 6 per body, minus every INDEPENDENT ground and joint equation. Drives are
    // not counted: a move changes where a mechanism is, not how free it is.
    int degreesOfFreedom = 0;
    double lengthScale = 1.0;            // the size the tolerance was scaled by, mm
    std::vector<std::string> messages;   // the solver's own progress notes
};

// Never throws.
Result solve(const Request& request) noexcept;

int apiVersion() noexcept;

// "forge_asmsolver 1 (OndselSolver 30e9b64 + Forge modifications)"
const char* libraryVersion() noexcept;

}  // namespace forge_asmsolver
