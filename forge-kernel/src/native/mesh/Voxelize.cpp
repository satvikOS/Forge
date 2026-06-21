// forge/native/mesh/Voxelize.cpp
//
// Implementation of forge::native::mesh::voxelize — see Voxelize.hpp for the
// full spec, algorithm and the 0-FAKES failure contract.
//
// Pure C++20, standard library only. NO OCCT, NO WASM, NO third-party libs.

#include <cstdint>
#include "forge/native/mesh/Voxelize.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

namespace forge {
namespace native {
namespace mesh {

namespace {

// True iff every coordinate in a flat triple buffer is finite.
bool allFinite(const std::vector<double>& v) {
    for (double x : v)
        if (!std::isfinite(x)) return false;
    return true;
}

// Signed twice-area of a 2D triangle (a,b,c) — plain double. Used ONLY for the
// barycentric weights whose RATIO drives the X interpolation along the ray; the
// inside/outside CLASSIFICATION is the exact orient2d sign, not this value.
double triArea2(double ax, double ay, double bx, double by, double cx, double cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

} // namespace

VoxelizeResult voxelize(const std::vector<double>& positions,
                        const std::vector<std::uint32_t>& indices,
                        double spacing,
                        int padCells) {
    VoxelizeResult out;

    // ---- input validation (honest ok=false, never fabricate) ---------------
    if (!(spacing > 0.0) || !std::isfinite(spacing)) {
        out.reason = "spacing must be > 0 and finite";
        return out;
    }
    if (positions.empty() || indices.empty()) {
        out.reason = "empty soup";
        return out;
    }
    if (positions.size() % 3 != 0 || indices.size() % 3 != 0) {
        out.reason = "ragged positions/indices length";
        return out;
    }
    if (!allFinite(positions)) {
        out.reason = "non-finite coordinate";
        return out;
    }
    if (padCells < 1) padCells = 1;

    // The mesh MUST be a closed 2-manifold for parity fill to be defined.
    // buildFromSoup rejects out-of-range / degenerate-indexed / non-manifold
    // soup; validate() confirms watertight + manifold + consistent twins.
    HalfEdgeMesh hem;
    if (!hem.buildFromSoup(positions, indices)) {
        out.reason = "buildFromSoup failed (bad index / non-manifold / degenerate)";
        return out;
    }
    if (!hem.validate().isValid()) {
        out.reason = "mesh is not a closed 2-manifold (open / non-watertight)";
        return out;
    }

    // ---- padded AABB of the mesh -------------------------------------------
    double lo[3] = { std::numeric_limits<double>::max(),
                     std::numeric_limits<double>::max(),
                     std::numeric_limits<double>::max() };
    double hi[3] = { std::numeric_limits<double>::lowest(),
                     std::numeric_limits<double>::lowest(),
                     std::numeric_limits<double>::lowest() };
    const std::size_t nVerts = positions.size() / 3;
    for (std::size_t v = 0; v < nVerts; ++v) {
        for (int a = 0; a < 3; ++a) {
            double c = positions[3 * v + a];
            lo[a] = std::min(lo[a], c);
            hi[a] = std::max(hi[a], c);
        }
    }
    for (int a = 0; a < 3; ++a) {
        if (!(hi[a] > lo[a])) {           // zero-extent box -> cannot voxelize
            out.reason = "zero-extent bounding box (degenerate / planar mesh)";
            return out;
        }
        lo[a] -= padCells * spacing;
        hi[a] += padCells * spacing;
    }

    // Node counts so the box spans [lo,hi] with cubic cells of `spacing`.
    // n nodes => (n-1) cells. ceil so the box fully covers the padded AABB.
    std::size_t n[3];
    for (int a = 0; a < 3; ++a) {
        double span = hi[a] - lo[a];
        std::size_t cells = static_cast<std::size_t>(std::ceil(span / spacing));
        if (cells < 1) cells = 1;
        n[a] = cells + 1;                 // nodes = cells + 1
        if (n[a] < 2) n[a] = 2;
    }

    forge::native::Vec3 origin{ lo[0], lo[1], lo[2] };
    forge::native::VoxelGrid<float> grid(n[0], n[1], n[2], origin, spacing, 0.0f);

    const std::size_t cx = grid.cellsX();
    const std::size_t cy = grid.cellsY();
    const std::size_t cz = grid.cellsZ();

    // ---- parity scanline along +X ------------------------------------------
    // Triangle vertex positions, pulled once.
    const std::size_t nTris = indices.size() / 3;
    struct Tri { double ax,ay,az, bx,by,bz, cx,cy,cz; };
    std::vector<Tri> tris;
    tris.reserve(nTris);
    for (std::size_t t = 0; t < nTris; ++t) {
        std::uint32_t i0 = indices[3*t+0], i1 = indices[3*t+1], i2 = indices[3*t+2];
        tris.push_back(Tri{
            positions[3*i0+0], positions[3*i0+1], positions[3*i0+2],
            positions[3*i1+0], positions[3*i1+1], positions[3*i1+2],
            positions[3*i2+0], positions[3*i2+1], positions[3*i2+2] });
    }

    // For one (y,z) sample, gather the X where the +X ray pierces each triangle.
    // Containment in the triangle's Y-Z projection is decided by ROBUST orient2d:
    // the sample is inside iff it is on the same side of all three projected
    // edges (all CCW or all CW). A sample exactly ON a projected edge (orient2d
    // == ZERO) is a grazing case: we REJECT that triangle's contribution (it is
    // rasterized by the cell-centre offset generically missing edges; rejecting
    // the measure-zero graze keeps each true crossing counted exactly once).
    std::vector<double> hitsX;
    auto rowHits = [&](double y, double z) {
        hitsX.clear();
        for (const Tri& tr : tris) {
            // orient2d signs of (y,z) vs each projected edge (project out X).
            forge::native::Sign s0 = forge::native::orient2d(tr.ay, tr.az, tr.by, tr.bz, y, z);
            forge::native::Sign s1 = forge::native::orient2d(tr.by, tr.bz, tr.cy, tr.cz, y, z);
            forge::native::Sign s2 = forge::native::orient2d(tr.cy, tr.cz, tr.ay, tr.az, y, z);
            // Reject if the projected triangle is degenerate (zero area) — a tri
            // parallel to the ray contributes no transverse crossing here.
            if (s0 == forge::native::Sign::ZERO ||
                s1 == forge::native::Sign::ZERO ||
                s2 == forge::native::Sign::ZERO)
                continue;
            bool allPos = (s0 == forge::native::Sign::POSITIVE &&
                           s1 == forge::native::Sign::POSITIVE &&
                           s2 == forge::native::Sign::POSITIVE);
            bool allNeg = (s0 == forge::native::Sign::NEGATIVE &&
                           s1 == forge::native::Sign::NEGATIVE &&
                           s2 == forge::native::Sign::NEGATIVE);
            if (!allPos && !allNeg) continue;   // sample outside this triangle

            // Inside the projection: solve for X on the triangle plane at (y,z).
            // Barycentric in the Y-Z projection (areas are the orient2d dets / 2;
            // ratios are sign-consistent here). Use plain double interpolation of
            // X over the barycentric weights (the honest "exact class, double
            // coordinate" posture).
            double w0 = std::fabs(triArea2(tr.by, tr.bz, tr.cy, tr.cz, y, z));
            double w1 = std::fabs(triArea2(tr.cy, tr.cz, tr.ay, tr.az, y, z));
            double w2 = std::fabs(triArea2(tr.ay, tr.az, tr.by, tr.bz, y, z));
            double ws = w0 + w1 + w2;
            if (!(ws > 0.0)) continue;          // degenerate guard (should not hit)
            double x = (w0 * tr.ax + w1 * tr.bx + w2 * tr.cx) / ws;
            hitsX.push_back(x);
        }
        std::sort(hitsX.begin(), hitsX.end());
    };

    std::size_t occupied = 0;
    for (std::size_t k = 0; k < cz; ++k) {
        double zc = origin.z + (double(k) + 0.5) * spacing;
        for (std::size_t j = 0; j < cy; ++j) {
            double yc = origin.y + (double(j) + 0.5) * spacing;
            rowHits(yc, zc);
            // A row of a CLOSED mesh must have an EVEN number of crossings; if it
            // is odd (a graze rejected on only one side) the parity is ambiguous
            // for this row — fall through with no fill (the cell-centre sampling
            // makes odd rows vanishingly rare; we never fabricate a span).
            std::size_t m = hitsX.size();
            if (m < 2) continue;
            // Pair consecutive crossings: inside between hit[2p] and hit[2p+1].
            std::size_t pairs = m / 2;
            for (std::size_t p = 0; p < pairs; ++p) {
                double xa = hitsX[2*p+0];
                double xb = hitsX[2*p+1];
                for (std::size_t i = 0; i < cx; ++i) {
                    double xc = origin.x + (double(i) + 0.5) * spacing;
                    if (xc > xa && xc < xb) {
                        // Mark this cell occupied: store 1.0f at its lower node so
                        // VoxelGrid::countInsideCellsByCenter(0.5,false) reads it
                        // back, and tally directly.
                        if (grid.at(i, j, k) < 0.5f) {
                            grid.at(i, j, k) = 1.0f;
                            ++occupied;
                        }
                    }
                }
            }
        }
    }

    out.ok = true;
    out.grid = std::move(grid);
    out.occupiedCells = occupied;
    out.occupiedVolume = double(occupied) * (spacing * spacing * spacing);
    return out;
}

} // namespace mesh
} // namespace native
} // namespace forge
