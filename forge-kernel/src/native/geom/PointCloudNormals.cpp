// forge/native/geom/PointCloudNormals.cpp
//
// Implementation of forge::native::geom::estimatePointCloudNormals.
// Pure C++20 + standard library. Depends (by #include + link) on KdTree3D and
// Geom.hpp's Point3; no external libs. See the header for the full contract.

#include "forge/native/geom/PointCloudNormals.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <vector>

namespace forge {
namespace native {
namespace geom {

namespace {

constexpr std::uint32_t kNoEdge = 0xFFFFFFFFu;

bool finite3(const Point3& p) {
    return std::isfinite(p.x) && std::isfinite(p.y) && std::isfinite(p.z);
}

// ---------------------------------------------------------------------------
// Symmetric 3x3 eigensolver via classical cyclic Jacobi rotations.
//   Input  A : symmetric 3x3 (row-major, A[r][c]).
//   Output eval[i], evec[i] (column i is the i-th eigenvector), sorted so that
//          eval[0] <= eval[1] <= eval[2] (ascending). Eigenvectors are unit and
//          mutually orthonormal (Jacobi guarantees this to working precision).
// This converges quadratically for 3x3; we cap sweeps for safety and the cap is
// never hit on well-formed symmetric input (documented honest bound).
// ---------------------------------------------------------------------------
void jacobiEigen3(const double Ain[3][3], double eval[3], double evec[3][3]) {
    double A[3][3];
    for (int r = 0; r < 3; ++r)
        for (int c = 0; c < 3; ++c) A[r][c] = Ain[r][c];

    // V accumulates the rotations -> columns are eigenvectors. Start = identity.
    double V[3][3] = { {1, 0, 0}, {0, 1, 0}, {0, 0, 1} };

    for (int sweep = 0; sweep < 64; ++sweep) {
        // Sum of |off-diagonal|; converged when it is essentially zero.
        const double off = std::fabs(A[0][1]) + std::fabs(A[0][2]) + std::fabs(A[1][2]);
        if (off <= 1e-300) break;  // exactly diagonal (e.g. all-coincident -> zero matrix)

        // Tolerance scaled to the matrix magnitude (relative convergence).
        const double scale = std::fabs(A[0][0]) + std::fabs(A[1][1]) + std::fabs(A[2][2]);
        if (off <= 1e-18 * (scale > 0 ? scale : 1.0)) break;

        // Rotate out each off-diagonal (p,q) in turn: (0,1),(0,2),(1,2).
        for (int p = 0; p < 2; ++p) {
            for (int q = p + 1; q < 3; ++q) {
                const double apq = A[p][q];
                if (std::fabs(apq) <= 1e-300) continue;
                const double app = A[p][p];
                const double aqq = A[q][q];
                // Jacobi angle: solve for c,s zeroing A[p][q].
                const double phi = 0.5 * (aqq - app) / apq;
                const double sign = (phi >= 0.0) ? 1.0 : -1.0;
                const double t = sign / (std::fabs(phi) + std::sqrt(phi * phi + 1.0));
                const double c = 1.0 / std::sqrt(t * t + 1.0);
                const double s = t * c;

                // Apply the rotation G^T A G (only rows/cols p,q change).
                const double app2 = c * c * app - 2.0 * s * c * apq + s * s * aqq;
                const double aqq2 = s * s * app + 2.0 * s * c * apq + c * c * aqq;
                A[p][p] = app2;
                A[q][q] = aqq2;
                A[p][q] = 0.0;
                A[q][p] = 0.0;
                for (int i = 0; i < 3; ++i) {
                    if (i != p && i != q) {
                        const double aip = A[i][p];
                        const double aiq = A[i][q];
                        A[i][p] = c * aip - s * aiq;
                        A[p][i] = A[i][p];
                        A[i][q] = s * aip + c * aiq;
                        A[q][i] = A[i][q];
                    }
                }
                // Accumulate the eigenvectors: V <- V G.
                for (int i = 0; i < 3; ++i) {
                    const double vip = V[i][p];
                    const double viq = V[i][q];
                    V[i][p] = c * vip - s * viq;
                    V[i][q] = s * vip + c * viq;
                }
            }
        }
    }

    eval[0] = A[0][0];
    eval[1] = A[1][1];
    eval[2] = A[2][2];

    // Sort ascending by eigenvalue, carrying the eigenvector columns of V.
    int idx[3] = { 0, 1, 2 };
    std::sort(idx, idx + 3, [&](int a, int b) { return eval[a] < eval[b]; });

    double evalS[3];
    double evecS[3][3];
    for (int j = 0; j < 3; ++j) {
        evalS[j] = eval[idx[j]];
        for (int i = 0; i < 3; ++i) evecS[i][j] = V[i][idx[j]];
    }
    for (int j = 0; j < 3; ++j) {
        eval[j] = evalS[j];
        for (int i = 0; i < 3; ++i) evec[i][j] = evecS[i][j];
    }
}

} // namespace

NormalEstimation estimatePointCloudNormals(const std::vector<Point3>& points,
                                           int k,
                                           OrientMode mode) {
    NormalEstimation out;

    const std::size_t n = points.size();
    if (n == 0) {
        out.reason = "empty point cloud";
        return out;
    }
    for (const Point3& p : points) {
        if (!finite3(p)) {
            out.reason = "non-finite coordinate in input";
            return out;
        }
    }
    if (k < 2) {
        out.reason = "k < 2: a tangent plane needs at least two neighbours";
        return out;
    }

    // Honest clamp: cannot use more neighbours than there are points.
    const int kEff = (static_cast<std::size_t>(k) > n) ? static_cast<int>(n) : k;
    out.kEffective = kEff;

    // Build the kd-tree once over the whole cloud (exact k-NN, reused header).
    KdTree3D tree;
    if (!tree.build(points)) {
        // Should not happen (finiteness already checked) — surface honestly.
        out.reason = "kd-tree build failed";
        return out;
    }

    out.normals.assign(n, Normal3{});
    out.degenerate.assign(n, false);

    // Neighbour index lists, retained for the optional MST orientation pass.
    std::vector<std::vector<std::uint32_t>> nbrs(n);

    for (std::size_t i = 0; i < n; ++i) {
        const KnnResult kn = tree.kNearest(points[i], kEff);
        if (!kn.ok || kn.neighbors.empty()) {
            // Tree was built successfully, so this cannot legitimately fail; if
            // it ever did we flag the point degenerate rather than fabricate.
            out.degenerate[i] = true;
            continue;
        }
        const std::size_t m = kn.neighbors.size();

        // Centroid of the neighbourhood.
        double cx = 0, cy = 0, cz = 0;
        nbrs[i].reserve(m);
        for (const Neighbor& nb : kn.neighbors) {
            const Point3& q = points[nb.index];
            cx += q.x; cy += q.y; cz += q.z;
            nbrs[i].push_back(static_cast<std::uint32_t>(nb.index));
        }
        const double inv = 1.0 / static_cast<double>(m);
        cx *= inv; cy *= inv; cz *= inv;

        // Covariance (symmetric); accumulate the 6 unique entries.
        double cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0;
        for (const Neighbor& nb : kn.neighbors) {
            const Point3& q = points[nb.index];
            const double dx = q.x - cx, dy = q.y - cy, dz = q.z - cz;
            cxx += dx * dx; cyy += dy * dy; czz += dz * dz;
            cxy += dx * dy; cxz += dx * dz; cyz += dy * dz;
        }
        cxx *= inv; cyy *= inv; czz *= inv;
        cxy *= inv; cxz *= inv; cyz *= inv;

        const double C[3][3] = {
            { cxx, cxy, cxz },
            { cxy, cyy, cyz },
            { cxz, cyz, czz }
        };

        double eval[3];
        double evec[3][3];
        jacobiEigen3(C, eval, evec);

        // Smallest-eigenvalue eigenvector (column 0) is the normal direction.
        double nx = evec[0][0], ny = evec[1][0], nz = evec[2][0];
        const double len = std::sqrt(nx * nx + ny * ny + nz * nz);

        // A ZERO covariance (every neighbour coincident) leaves Jacobi at the
        // identity, whose column 0 is the *arbitrary* axis {1,0,0}. That is not
        // a real direction — surface it honestly as {0,0,0}, never a fabricated
        // axis. We detect it from the eigenvalues, not the (unit) eigenvector.
        const double largest = eval[2];
        const bool zeroCovariance = (largest <= 0.0);

        if (zeroCovariance || len == 0.0) {
            nx = ny = nz = 0.0;  // genuinely undefined direction
        } else {
            nx /= len; ny /= len; nz /= len;
        }

        // Degeneracy: zero covariance (coincident) OR the second-smallest
        // eigenvalue is (near-)zero relative to the largest (collinear), so the
        // tangent PLANE (hence the normal) is not well defined. We flag it but
        // still return the honest least-variance direction (or {0,0,0}).
        const bool degenerate =
            zeroCovariance || (eval[1] <= 1e-12 * largest) || (len == 0.0);
        if (degenerate) {
            out.degenerate[i] = true;
            ++out.numDegenerate;
        }

        out.normals[i] = Normal3{ nx, ny, nz };
    }

    // -----------------------------------------------------------------------
    // Orientation (sign resolution).
    // -----------------------------------------------------------------------
    if (mode == OrientMode::AwayFromCentroid) {
        // Global centroid of the cloud.
        double gx = 0, gy = 0, gz = 0;
        for (const Point3& p : points) { gx += p.x; gy += p.y; gz += p.z; }
        const double inv = 1.0 / static_cast<double>(n);
        gx *= inv; gy *= inv; gz *= inv;
        for (std::size_t i = 0; i < n; ++i) {
            Normal3& nrm = out.normals[i];
            const double vx = points[i].x - gx;
            const double vy = points[i].y - gy;
            const double vz = points[i].z - gz;
            if (nrm.x * vx + nrm.y * vy + nrm.z * vz < 0.0) {
                nrm.x = -nrm.x; nrm.y = -nrm.y; nrm.z = -nrm.z;
            }
        }
    } else { // OrientMode::MstPropagation
        // Build an undirected neighbour graph (symmetrised k-NN), take a Prim
        // MST weighted by (1 - |n_a . n_b|), then flood the orientation from the
        // top-most (+Z) seed, flipping any normal anti-aligned with its parent.
        //
        // Edge list per node: union of i's neighbours and the reverse links.
        std::vector<std::vector<std::uint32_t>> adj(n);
        for (std::size_t i = 0; i < n; ++i) {
            for (std::uint32_t j : nbrs[i]) {
                if (static_cast<std::size_t>(j) == i) continue;
                adj[i].push_back(j);
                adj[j].push_back(static_cast<std::uint32_t>(i));
            }
        }
        for (auto& a : adj) {
            std::sort(a.begin(), a.end());
            a.erase(std::unique(a.begin(), a.end()), a.end());
        }

        auto edgeWeight = [&](std::size_t a, std::size_t b) {
            const Normal3& na = out.normals[a];
            const Normal3& nb = out.normals[b];
            const double d = na.x * nb.x + na.y * nb.y + na.z * nb.z;
            return 1.0 - std::fabs(d);  // parallel normals -> cheapest edge
        };

        // Prim MST over each connected component. inMst marks finalized nodes.
        std::vector<bool> inMst(n, false);
        std::vector<double> key(n, std::numeric_limits<double>::infinity());
        std::vector<std::uint32_t> parent(n, kNoEdge);

        // We seed components by the largest +Z point so the global field has a
        // deterministic, convention-driven anchor (Hoppe et al. 1992).
        // Process all nodes; whenever we start a fresh component we re-seed.
        std::vector<std::uint32_t> order(n);
        for (std::size_t i = 0; i < n; ++i) order[i] = static_cast<std::uint32_t>(i);
        std::sort(order.begin(), order.end(), [&](std::uint32_t a, std::uint32_t b) {
            if (points[a].z != points[b].z) return points[a].z > points[b].z;
            return a < b;  // deterministic tie-break
        });

        std::vector<std::uint32_t> mstOrder;  // nodes in the order finalized
        mstOrder.reserve(n);

        for (std::uint32_t seed : order) {
            if (inMst[seed]) continue;
            key[seed] = 0.0;
            parent[seed] = kNoEdge;
            // Grow this component greedily (Prim) — O(comp^2) on the component,
            // adequate for the validated envelope; graph is sparse (k-NN).
            for (;;) {
                // Pick the not-yet-finalized node with the smallest key that is
                // reachable (finite key) within the current frontier.
                long long best = -1;
                double bestKey = std::numeric_limits<double>::infinity();
                for (std::size_t v = 0; v < n; ++v) {
                    if (!inMst[v] && key[v] < bestKey) {
                        bestKey = key[v];
                        best = static_cast<long long>(v);
                    }
                }
                if (best < 0 || !std::isfinite(bestKey)) break;
                const std::size_t u = static_cast<std::size_t>(best);
                inMst[u] = true;
                mstOrder.push_back(static_cast<std::uint32_t>(u));
                for (std::uint32_t w : adj[u]) {
                    if (!inMst[w]) {
                        const double wgt = edgeWeight(u, w);
                        if (wgt < key[w]) {
                            key[w] = wgt;
                            parent[w] = static_cast<std::uint32_t>(u);
                        }
                    }
                }
            }
        }

        // Flood sign-propagation in MST-finalization order. Each component's
        // seed (parent == kNoEdge) is anchored to n . +Z >= 0; every child is
        // flipped to agree with its parent.
        for (std::uint32_t node : mstOrder) {
            Normal3& nn = out.normals[node];
            if (parent[node] == kNoEdge) {
                if (nn.z < 0.0) { nn.x = -nn.x; nn.y = -nn.y; nn.z = -nn.z; }
            } else {
                const Normal3& np = out.normals[parent[node]];
                const double d = nn.x * np.x + nn.y * np.y + nn.z * np.z;
                if (d < 0.0) { nn.x = -nn.x; nn.y = -nn.y; nn.z = -nn.z; }
            }
        }
    }

    out.ok = true;
    return out;
}

} // namespace geom
} // namespace native
} // namespace forge
