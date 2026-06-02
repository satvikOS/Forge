#pragma once

// Forge-191 — Civil-engineering terrain meshing.
//
// Bowyer-Watson Delaunay triangulation of an (x, y) point set with
// per-point z attached so the output is a Triangular Irregular Network
// (TIN). Plus a per-triangle volume integrator that computes cut + fill
// against a designed plane (z = a·x + b·y + c).

#include <cstdint>
#include <vector>

namespace forge { namespace terrain {

struct DelaunayInputs {
    // Length = 3·N (interleaved x, y, z). z is carried through but
    // doesn't influence the triangulation — it only affects volume
    // integration downstream.
    std::vector<double> points;
};

struct DelaunayResult {
    std::vector<std::uint32_t> triangles;   // 3·M indices into points
    int n;                                  // = N
};

DelaunayResult triangulate(const DelaunayInputs& in);

struct CutFillInputs {
    std::vector<double>        points;       // 3·N
    std::vector<std::uint32_t> triangles;    // 3·M
    // Design plane z = a·x + b·y + c
    double a, b, c;
};

struct CutFillResult {
    double cutVolume;     // existing above design (cut to get to design)
    double fillVolume;    // existing below design (fill required)
    double netVolume;     // cut − fill
    double tinArea;
};

CutFillResult cutFillVsPlane(const CutFillInputs& in);

}} // namespace forge::terrain
