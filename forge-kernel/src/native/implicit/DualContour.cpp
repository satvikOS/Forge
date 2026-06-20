// forge/native/implicit/DualContour.cpp
//
// Implementation of the dual-contouring mesher declared in
// forge/native/implicit/DualContour.hpp. See that header for the algorithm and
// the honest robustness statement.
//
// Outline (Ju-Losasso-Schaefer-Warren 2002, uniform-grid form):
//   1. Sample f at every grid vertex; sign(f) gives in/out per corner.
//   2. For each CELL that contains the surface (mixed corner signs), gather the
//      Hermite data on its 12 edges that change sign — the zero crossing point
//      and the SDF gradient (normal) there — and solve a QEF to place ONE vertex
//      in the cell. Clamp the solution to the cell box.
//   3. For each INTERIOR grid edge that changes sign, emit a quad joining the
//      vertices of the four cells sharing that edge, wound so its normal follows
//      the field gradient (sign of f along the edge). Triangulate each quad.
// The dual quads of a closed sign field form a closed surface (no boundary).
//
// Pure C++20. No external dependencies.

#include "forge/native/implicit/DualContour.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <map>
#include <stdexcept>
#include <vector>

namespace forge {
namespace native {
namespace implicit {

namespace {

// Cube corner offsets, SAME numbering as IsoMesher.cpp (kept consistent so the
// two meshers agree on what "corner c" means). Local-cell coords 0/1 per axis.
constexpr int cornerOffset[8][3] = {
    {0, 0, 0}, {1, 0, 0}, {1, 1, 0}, {0, 1, 0},
    {0, 0, 1}, {1, 0, 1}, {1, 1, 1}, {0, 1, 1},
};

// The two corner endpoints of each of the 12 edges (same numbering as IsoMesher).
constexpr int edgeCorner[12][2] = {
    {0, 1}, {1, 2}, {2, 3}, {3, 0}, // bottom face
    {4, 5}, {5, 6}, {6, 7}, {7, 4}, // top face
    {0, 4}, {1, 5}, {2, 6}, {3, 7}, // vertical
};

// ---------------------------------------------------------------------------
// Symmetric 3x3 eigen-decomposition (cyclic Jacobi).
//
// The QEF normal matrix M = A^T A is symmetric positive-semidefinite. Jacobi
// rotation diagonalises it: M = V diag(w) V^T, columns of V the eigenvectors.
// A handful of sweeps converge to machine precision for a 3x3. This is standard
// numerical-linear-algebra, written from first principles (no external BLAS).
// ---------------------------------------------------------------------------
struct Sym3 { double m[3][3]; }; // symmetric, only need full storage

void jacobiEigen(Sym3 A, double w[3], double V[3][3]) {
    // V starts as identity.
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) V[i][j] = (i == j) ? 1.0 : 0.0;

    for (int sweep = 0; sweep < 64; ++sweep) {
        // Sum of off-diagonal magnitudes; stop when negligible.
        double off = std::fabs(A.m[0][1]) + std::fabs(A.m[0][2]) + std::fabs(A.m[1][2]);
        if (off < 1e-300) break;

        for (int p = 0; p < 3; ++p) {
            for (int q = p + 1; q < 3; ++q) {
                const double apq = A.m[p][q];
                if (std::fabs(apq) < 1e-300) continue;
                const double app = A.m[p][p];
                const double aqq = A.m[q][q];
                // Jacobi rotation angle.
                const double phi = 0.5 * (aqq - app) / apq;
                double t = (phi >= 0.0 ? 1.0 : -1.0) /
                           (std::fabs(phi) + std::sqrt(phi * phi + 1.0));
                const double c = 1.0 / std::sqrt(t * t + 1.0);
                const double s = t * c;

                // Apply rotation to A (rows/cols p,q).
                for (int k = 0; k < 3; ++k) {
                    const double akp = A.m[k][p];
                    const double akq = A.m[k][q];
                    A.m[k][p] = c * akp - s * akq;
                    A.m[k][q] = s * akp + c * akq;
                }
                for (int k = 0; k < 3; ++k) {
                    const double apk = A.m[p][k];
                    const double aqk = A.m[q][k];
                    A.m[p][k] = c * apk - s * aqk;
                    A.m[q][k] = s * apk + c * aqk;
                }
                // Accumulate eigenvectors.
                for (int k = 0; k < 3; ++k) {
                    const double vkp = V[k][p];
                    const double vkq = V[k][q];
                    V[k][p] = c * vkp - s * vkq;
                    V[k][q] = s * vkp + c * vkq;
                }
            }
        }
    }
    w[0] = A.m[0][0];
    w[1] = A.m[1][1];
    w[2] = A.m[2][2];
}

// Solve the QEF for a cell.
//   planes: list of (point on surface, unit normal).
//   massPoint: average of the crossing points — the base point used for the
//              null/under-determined directions (Ju et al. regularisation).
//   lo, hi: the cell bounding box — the final vertex is clamped to it.
//
// Minimise E(x) = sum ( n_i . (x - p_i) )^2. Let y = x - massPoint; then
//   E = sum ( n_i . y - (n_i . (p_i - massPoint)) )^2 = |A y - b|^2.
// Normal equations: (A^T A) y = A^T b. Solve via truncated SVD of the symmetric
// 3x3 A^T A, dropping singular directions below a relative threshold so a flat
// region keeps y=0 there (vertex stays at the mass point in that direction).
Vec3 solveQEF(const std::vector<std::pair<Vec3, Vec3>>& planes,
              const Vec3& massPoint, const Vec3& lo, const Vec3& hi) {
    // Build A^T A and A^T b with the mass point as origin.
    Sym3 ATA{};
    for (auto& r : ATA.m) for (double& v : r) v = 0.0;
    double ATb[3] = {0.0, 0.0, 0.0};

    for (const auto& pl : planes) {
        const Vec3& n = pl.second;
        const Vec3 d = pl.first - massPoint;
        const double bi = dot(n, d); // target: n . (p - massPoint)
        const double nv[3] = {n.x, n.y, n.z};
        for (int a = 0; a < 3; ++a) {
            ATb[a] += nv[a] * bi;
            for (int c = 0; c < 3; ++c) ATA.m[a][c] += nv[a] * nv[c];
        }
    }

    // Eigen-decompose A^T A = V diag(w) V^T.
    double w[3];
    double V[3][3];
    jacobiEigen(ATA, w, V);

    // Truncated pseudo-inverse solve:  y = sum_k ( (v_k . A^T b) / w_k ) v_k,
    // skipping directions where w_k is below a relative threshold of the max.
    double wmax = std::max(std::max(std::fabs(w[0]), std::fabs(w[1])), std::fabs(w[2]));
    const double tol = wmax * 1e-6; // relative singular-value cutoff (sigma^2 here)

    double y[3] = {0.0, 0.0, 0.0};
    for (int k = 0; k < 3; ++k) {
        if (std::fabs(w[k]) <= tol) continue; // under-determined direction: keep 0
        const double vk[3] = {V[0][k], V[1][k], V[2][k]};
        const double proj = vk[0] * ATb[0] + vk[1] * ATb[1] + vk[2] * ATb[2];
        const double coef = proj / w[k];
        for (int a = 0; a < 3; ++a) y[a] += coef * vk[a];
    }

    Vec3 x{massPoint.x + y[0], massPoint.y + y[1], massPoint.z + y[2]};

    // Clamp to the cell box — the standard guard against an ill-posed QEF
    // placing the vertex far outside its own cell.
    x.x = std::clamp(x.x, lo.x, hi.x);
    x.y = std::clamp(x.y, lo.y, hi.y);
    x.z = std::clamp(x.z, lo.z, hi.z);
    return x;
}

} // namespace

Mesh DualContour::contour(const Sdf& sdf, const GridSpec& grid,
                          double isovalue, double gradH) {
    if (!sdf.valid()) throw std::runtime_error("DualContour::contour: empty Sdf");
    if (grid.nx < 1 || grid.ny < 1 || grid.nz < 1)
        throw std::runtime_error("DualContour::contour: grid must have >=1 cell per axis");

    Mesh mesh;

    const int Nx = grid.nx, Ny = grid.ny, Nz = grid.nz;
    const int VX = Nx + 1, VY = Ny + 1, VZ = Nz + 1;
    const double dx = (grid.max.x - grid.min.x) / Nx;
    const double dy = (grid.max.y - grid.min.y) / Ny;
    const double dz = (grid.max.z - grid.min.z) / Nz;

    // Finite-difference step for the normal: default a small fraction of the
    // smallest cell edge (well below the feature scale, above noise).
    if (gradH <= 0.0) {
        const double hmin = std::min(std::min(dx, dy), dz);
        gradH = hmin * 1e-3;
    }

    auto vidx = [&](int i, int j, int k) {
        return (static_cast<size_t>(k) * VY + j) * VX + i;
    };
    auto vpos = [&](int i, int j, int k) {
        return Vec3{grid.min.x + i * dx, grid.min.y + j * dy, grid.min.z + k * dz};
    };

    // Sample the field at every grid vertex once.
    std::vector<double> field(static_cast<size_t>(VX) * VY * VZ);
    for (int k = 0; k < VZ; ++k)
        for (int j = 0; j < VY; ++j)
            for (int i = 0; i < VX; ++i)
                field[vidx(i, j, k)] = sdf.eval(vpos(i, j, k)) - isovalue;

    // Zero crossing on an edge between two corner positions with field values
    // fa, fb (linear root) — the SAME crossing marching cubes uses.
    auto edgeCross = [&](const Vec3& pa, double fa, const Vec3& pb, double fb) -> Vec3 {
        double t = 0.5;
        const double denom = fa - fb;
        if (std::fabs(denom) > 1e-300) t = fa / denom;
        t = std::clamp(t, 0.0, 1.0);
        return pa + (pb - pa) * t;
    };

    // Surface normal at p: the SDF gradient (central differences), normalised.
    // REUSES Sdf::gradient — no new SDF machinery.
    auto surfaceNormal = [&](const Vec3& p) -> Vec3 {
        Vec3 g = sdf.gradient(p, gradH);
        const double L = length(g);
        if (L > 1e-300) g = g * (1.0 / L);
        return g;
    };

    // One vertex per CELL that contains the surface. cellVert[cell] = mesh index
    // or -1 if the cell has no surface vertex.
    std::vector<int> cellVert(static_cast<size_t>(Nx) * Ny * Nz, -1);
    auto cidx = [&](int i, int j, int k) {
        return (static_cast<size_t>(k) * Ny + j) * Nx + i;
    };

    for (int k = 0; k < Nz; ++k) {
        for (int j = 0; j < Ny; ++j) {
            for (int i = 0; i < Nx; ++i) {
                // Corner field values & positions.
                double fc[8];
                Vec3 pc[8];
                int insideMask = 0;
                for (int c = 0; c < 8; ++c) {
                    const int ic = i + cornerOffset[c][0];
                    const int jc = j + cornerOffset[c][1];
                    const int kc = k + cornerOffset[c][2];
                    fc[c] = field[vidx(ic, jc, kc)];
                    pc[c] = vpos(ic, jc, kc);
                    if (fc[c] < 0.0) insideMask |= (1 << c);
                }
                if (insideMask == 0 || insideMask == 0xFF) continue; // no surface

                // Gather Hermite planes on every sign-changing edge.
                std::vector<std::pair<Vec3, Vec3>> planes;
                Vec3 mass{0, 0, 0};
                int nCross = 0;
                for (int e = 0; e < 12; ++e) {
                    const int c0 = edgeCorner[e][0];
                    const int c1 = edgeCorner[e][1];
                    const bool in0 = (fc[c0] < 0.0);
                    const bool in1 = (fc[c1] < 0.0);
                    if (in0 == in1) continue; // edge doesn't cross
                    const Vec3 x = edgeCross(pc[c0], fc[c0], pc[c1], fc[c1]);
                    const Vec3 n = surfaceNormal(x);
                    planes.emplace_back(x, n);
                    mass = mass + x;
                    ++nCross;
                }
                if (nCross == 0) continue;
                mass = mass * (1.0 / nCross);

                const Vec3 lo = pc[0];                       // (0,0,0) corner
                const Vec3 hi = pc[6];                       // (1,1,1) corner
                const Vec3 v = solveQEF(planes, mass, lo, hi);

                const int idx = static_cast<int>(mesh.positions.size());
                mesh.positions.push_back(v);
                cellVert[cidx(i, j, k)] = idx;
            }
        }
    }

    // --- Dual quads: one per INTERIOR grid edge that changes sign. ----------
    // For each axis-aligned grid edge in the interior, the four cells sharing it
    // own the corners of the dual quad. Wind the quad so its normal follows the
    // field (from inside f<0 to outside f>0). Triangulate each quad into two
    // triangles. Only interior edges (those with all four incident cells in the
    // grid) are used, so no quad touches the sampling-box boundary → closed.
    auto emitQuad = [&](int a, int b, int c, int d, bool flip) {
        if (a < 0 || b < 0 || c < 0 || d < 0) return; // a sharing cell had no vertex
        if (!flip) {
            mesh.triangles.push_back({a, b, c});
            mesh.triangles.push_back({a, c, d});
        } else {
            mesh.triangles.push_back({a, c, b});
            mesh.triangles.push_back({a, d, c});
        }
    };

    // X-edges: edge from grid vertex (i,j,k) to (i+1,j,k). Shared by the 4 cells
    // offset in (j,k): cells (i, j-1, k-1),(i, j, k-1),(i, j, k),(i, j-1, k).
    for (int k = 1; k < Nz; ++k)
        for (int j = 1; j < Ny; ++j)
            for (int i = 0; i < Nx; ++i) {
                const double f0 = field[vidx(i, j, k)];
                const double f1 = field[vidx(i + 1, j, k)];
                if ((f0 < 0.0) == (f1 < 0.0)) continue;
                const int c0 = cellVert[cidx(i, j - 1, k - 1)];
                const int c1 = cellVert[cidx(i, j, k - 1)];
                const int c2 = cellVert[cidx(i, j, k)];
                const int c3 = cellVert[cidx(i, j - 1, k)];
                // flip so the quad faces outward (toward increasing f).
                emitQuad(c0, c1, c2, c3, !(f0 < 0.0));
            }

    // Y-edges: (i,j,k)->(i,j+1,k). Shared by cells offset in (i,k).
    for (int k = 1; k < Nz; ++k)
        for (int j = 0; j < Ny; ++j)
            for (int i = 1; i < Nx; ++i) {
                const double f0 = field[vidx(i, j, k)];
                const double f1 = field[vidx(i, j + 1, k)];
                if ((f0 < 0.0) == (f1 < 0.0)) continue;
                const int c0 = cellVert[cidx(i - 1, j, k - 1)];
                const int c1 = cellVert[cidx(i, j, k - 1)];
                const int c2 = cellVert[cidx(i, j, k)];
                const int c3 = cellVert[cidx(i - 1, j, k)];
                emitQuad(c0, c1, c2, c3, f0 < 0.0);
            }

    // Z-edges: (i,j,k)->(i,j,k+1). Shared by cells offset in (i,j).
    for (int k = 0; k < Nz; ++k)
        for (int j = 1; j < Ny; ++j)
            for (int i = 1; i < Nx; ++i) {
                const double f0 = field[vidx(i, j, k)];
                const double f1 = field[vidx(i, j, k + 1)];
                if ((f0 < 0.0) == (f1 < 0.0)) continue;
                const int c0 = cellVert[cidx(i - 1, j - 1, k)];
                const int c1 = cellVert[cidx(i, j - 1, k)];
                const int c2 = cellVert[cidx(i, j, k)];
                const int c3 = cellVert[cidx(i - 1, j, k)];
                emitQuad(c0, c1, c2, c3, !(f0 < 0.0));
            }

    return mesh;
}

Mesh DualContour::contourCubic(const Sdf& sdf, const Vec3& min, const Vec3& max,
                               int n, double isovalue, double gradH) {
    GridSpec g;
    g.min = min;
    g.max = max;
    g.nx = g.ny = g.nz = n;
    return contour(sdf, g, isovalue, gradH);
}

} // namespace implicit
} // namespace native
} // namespace forge
