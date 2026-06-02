#pragma once

// Forge-206 — pipe routing via A* on a 3D axis-aligned grid.
//
// Given two end ports (position + outgoing direction), a list of AABB
// obstacles, and a grid spacing, finds the shortest axis-aligned
// polyline that links the two ports while avoiding obstacles. Each
// elbow (direction change) costs an elbowPenalty so the routing
// prefers fewer bends when path length is similar.

#include <cstdint>
#include <vector>

namespace forge { namespace piperoute {

struct Port {
    double position[3];
    double direction[3];   // unit; the pipe exits the port along +direction
};

struct AABB {
    double min[3];
    double max[3];
};

struct Inputs {
    Port  start;
    Port  end;
    std::vector<AABB> obstacles;
    double gridSpacing;
    double elbowPenalty;        // added to the per-step cost on every turn
    double bbMargin;            // extra search-box padding around the ports
    std::uint32_t maxIterations;
};

struct Outputs {
    bool                 found;
    std::vector<double>  polyline;   // x0, y0, z0, x1, y1, z1, …
    double               totalLength;
    std::uint32_t        elbowCount;
    std::uint32_t        iterationsUsed;
};

Outputs route(const Inputs& in);

}} // namespace forge::piperoute
