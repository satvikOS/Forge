// forge/native/brep/CadScoreGates.cpp
//
// Implementation of the CADGenBench PRE-SUBMIT GATES (CadScoreGates.hpp):
// in-kernel Betti numbers, watertight/manifold validity self-check, and the
// interface keep-in/keep-out IoU evaluator. Pure C++20, no external deps.
//
// REUSE (no re-derivation):
//   * tessellateSolid (SolidTessellate.cpp) — Solid boundary -> triangle soup,
//   * mesh::HalfEdgeMesh::validate / signedVolume / surfaceArea — the mesh audit.
//
// The boundary soup may contain MULTIPLE disjoint closed shells (two bodies, an
// internal void's inner shell, ...). We partition it into connected components,
// compute V-E+F (hence genus) per shell, decide which shells are voids by spatial
// nesting + winding sign, and assemble the (b0,b1,b2) triple.

#include "forge/native/brep/CadScoreGates.hpp"
#include "forge/native/brep/SolidTessellate.hpp"   // tessellateSolid

#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <unordered_map>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

// ── union-find over triangles (for connected-shell partitioning). ──────────
struct DSU {
    std::vector<int> p;
    void init(std::size_t n) { p.resize(n); for (std::size_t i = 0; i < n; ++i) p[i] = (int)i; }
    int find(int a) { while (p[a] != a) { p[a] = p[p[a]]; a = p[a]; } return a; }
    void unite(int a, int b) { int ra = find(a), rb = find(b); if (ra != rb) p[ra] = rb; }
};

inline std::uint64_t undirKey(std::uint32_t a, std::uint32_t b) {
    std::uint32_t lo = a < b ? a : b, hi = a < b ? b : a;
    return (static_cast<std::uint64_t>(lo) << 32) | static_cast<std::uint64_t>(hi);
}

// One connected boundary shell extracted from the soup, with its own local mesh
// measures and a representative interior-probe origin.
struct ShellMesh {
    std::vector<std::uint32_t> tris;   // triangle indices (into the global soup)
    long long V = 0, E = 0, F = 0;
    long long eulerChar = 0;
    long long genus = 0;
    double    signedVol6 = 0.0;        // x6 signed volume (sign = winding)
    // axis-aligned bounds (for cheap nesting pre-filter)
    double bmin[3] = {0, 0, 0}, bmax[3] = {0, 0, 0};
    bool   isVoid = false;
};

// Even-odd ray cast: is point p inside the closed shell formed by `tris` (triplets
// of indices into `pos`)? Shoot a +X ray and count proper triangle crossings.
// Robust enough for the gate's axis-aligned / parametric meshes (a tiny jitter on
// the ray direction avoids edge-grazing); not an exact construction kernel.
bool pointInShell(const std::vector<double>& pos,
                  const std::vector<std::uint32_t>& tris,
                  double px, double py, double pz) {
    // Ray direction: mostly +X with a tiny generic tilt so it does not lie in any
    // axis-aligned face plane nor pass exactly through a shared edge/vertex.
    const double dx = 1.0, dy = 0.0009134, dz = 0.0004271;
    int crossings = 0;
    const std::size_t nt = tris.size() / 3;
    for (std::size_t t = 0; t < nt; ++t) {
        const std::uint32_t i0 = tris[3 * t + 0];
        const std::uint32_t i1 = tris[3 * t + 1];
        const std::uint32_t i2 = tris[3 * t + 2];
        const double ax = pos[3 * i0], ay = pos[3 * i0 + 1], az = pos[3 * i0 + 2];
        const double bx = pos[3 * i1], by = pos[3 * i1 + 1], bz = pos[3 * i1 + 2];
        const double cx = pos[3 * i2], cy = pos[3 * i2 + 1], cz = pos[3 * i2 + 2];
        // Möller–Trumbore ray/triangle, accept t>0 (one-sided count, any facing).
        const double e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const double e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        const double hx = dy * e2z - dz * e2y;
        const double hy = dz * e2x - dx * e2z;
        const double hz = dx * e2y - dy * e2x;
        const double a = e1x * hx + e1y * hy + e1z * hz;
        if (std::fabs(a) < 1e-15) continue;          // ray parallel to triangle
        const double f = 1.0 / a;
        const double sx = px - ax, sy = py - ay, sz = pz - az;
        const double u = f * (sx * hx + sy * hy + sz * hz);
        if (u < 0.0 || u > 1.0) continue;
        const double qx = sy * e1z - sz * e1y;
        const double qy = sz * e1x - sx * e1z;
        const double qz = sx * e1y - sy * e1x;
        const double v = f * (dx * qx + dy * qy + dz * qz);
        if (v < 0.0 || u + v > 1.0) continue;
        const double tt = f * (e2x * qx + e2y * qy + e2z * qz);
        if (tt > 1e-12) ++crossings;
    }
    return (crossings & 1) != 0;
}

// Signed volume x6 of a triangle set (divergence theorem; sign = global winding).
double shellSignedVol6(const std::vector<double>& pos,
                       const std::vector<std::uint32_t>& tris) {
    double vol6 = 0.0;
    const std::size_t nt = tris.size() / 3;
    for (std::size_t t = 0; t < nt; ++t) {
        const std::uint32_t i0 = tris[3 * t + 0];
        const std::uint32_t i1 = tris[3 * t + 1];
        const std::uint32_t i2 = tris[3 * t + 2];
        const double ax = pos[3 * i0], ay = pos[3 * i0 + 1], az = pos[3 * i0 + 2];
        const double bx = pos[3 * i1], by = pos[3 * i1 + 1], bz = pos[3 * i1 + 2];
        const double cx = pos[3 * i2], cy = pos[3 * i2 + 1], cz = pos[3 * i2 + 2];
        const double crx = by * cz - bz * cy;
        const double cry = bz * cx - bx * cz;
        const double crz = bx * cy - by * cx;
        vol6 += ax * crx + ay * cry + az * crz;
    }
    return vol6;
}

// Partition a (welded) triangle soup into connected shells and fill per-shell V/E/F,
// Euler characteristic, genus, signed volume and bounds. Vertices are shared by
// index (the tessellator already welded coincident positions), so two triangles
// are in the same shell iff they share an undirected vertex-index edge.
std::vector<ShellMesh> partitionShells(const std::vector<double>& pos,
                                       const std::vector<std::uint32_t>& idx) {
    std::vector<ShellMesh> out;
    const std::size_t nt = idx.size() / 3;
    if (nt == 0) return out;

    // 1. union-find triangles via shared undirected edges.
    std::unordered_map<std::uint64_t, int> firstTriOfEdge;
    firstTriOfEdge.reserve(nt * 3 * 2);
    DSU dsu; dsu.init(nt);
    for (std::size_t t = 0; t < nt; ++t) {
        const std::uint32_t a = idx[3 * t + 0], b = idx[3 * t + 1], c = idx[3 * t + 2];
        const std::array<std::uint64_t, 3> ek = {undirKey(a, b), undirKey(b, c), undirKey(c, a)};
        for (std::uint64_t k : ek) {
            auto it = firstTriOfEdge.find(k);
            if (it == firstTriOfEdge.end()) firstTriOfEdge.emplace(k, (int)t);
            else dsu.unite((int)t, it->second);
        }
    }

    // 2. bucket triangles by component root.
    std::unordered_map<int, std::size_t> rootToShell;
    for (std::size_t t = 0; t < nt; ++t) {
        const int r = dsu.find((int)t);
        auto it = rootToShell.find(r);
        std::size_t si;
        if (it == rootToShell.end()) { si = out.size(); rootToShell.emplace(r, si); out.emplace_back(); }
        else si = it->second;
        out[si].tris.push_back(idx[3 * t + 0]);
        out[si].tris.push_back(idx[3 * t + 1]);
        out[si].tris.push_back(idx[3 * t + 2]);
    }

    // 3. per-shell V/E/F + Euler + genus + signed volume + bounds.
    for (ShellMesh& sm : out) {
        std::unordered_map<std::uint32_t, char> vset;
        std::unordered_map<std::uint64_t, char> eset;
        vset.reserve(sm.tris.size());
        eset.reserve(sm.tris.size() * 2);
        const std::size_t f = sm.tris.size() / 3;
        for (std::size_t t = 0; t < f; ++t) {
            const std::uint32_t a = sm.tris[3 * t + 0], b = sm.tris[3 * t + 1], c = sm.tris[3 * t + 2];
            vset[a] = 1; vset[b] = 1; vset[c] = 1;
            eset[undirKey(a, b)] = 1; eset[undirKey(b, c)] = 1; eset[undirKey(c, a)] = 1;
        }
        sm.V = (long long)vset.size();
        sm.E = (long long)eset.size();
        sm.F = (long long)f;
        sm.eulerChar = sm.V - sm.E + sm.F;
        // Closed orientable surface: chi = 2 - 2g  ->  g = (2 - chi)/2.
        sm.genus = (2 - sm.eulerChar) / 2;
        if (sm.genus < 0) sm.genus = 0;
        sm.signedVol6 = shellSignedVol6(pos, sm.tris);

        // axis-aligned bounds.
        double lo[3] = { std::numeric_limits<double>::infinity(),
                         std::numeric_limits<double>::infinity(),
                         std::numeric_limits<double>::infinity() };
        double hi[3] = { -std::numeric_limits<double>::infinity(),
                         -std::numeric_limits<double>::infinity(),
                         -std::numeric_limits<double>::infinity() };
        for (std::uint32_t vi : ([&] {
                 std::vector<std::uint32_t> vs; vs.reserve(vset.size());
                 for (auto& kv : vset) vs.push_back(kv.first); return vs; })()) {
            for (int d = 0; d < 3; ++d) {
                const double val = pos[3 * vi + d];
                if (val < lo[d]) lo[d] = val;
                if (val > hi[d]) hi[d] = val;
            }
        }
        for (int d = 0; d < 3; ++d) { sm.bmin[d] = lo[d]; sm.bmax[d] = hi[d]; }
    }
    return out;
}

// Representative interior probe point of a shell: the centroid of its first
// triangle nudged slightly along the inward direction so it lands strictly inside
// (used for nesting tests). For nesting we only need a point ON/near the shell, so
// the bounds centre is sufficient and robust.
void shellCentre(const ShellMesh& s, double& cx, double& cy, double& cz) {
    cx = 0.5 * (s.bmin[0] + s.bmax[0]);
    cy = 0.5 * (s.bmin[1] + s.bmax[1]);
    cz = 0.5 * (s.bmin[2] + s.bmax[2]);
}

// Build a BettiNumbers from an already-partitioned set of shells + the soup. The
// global index buffer is unused here (each shell carries its own `tris`); it is
// kept in the signature for symmetry with the partition step.
BettiNumbers assembleBetti(const std::vector<double>& pos,
                           [[maybe_unused]] const std::vector<std::uint32_t>& idx,
                           std::vector<ShellMesh>& shells) {
    BettiNumbers b;
    if (shells.empty()) { b.ok = false; return b; }

    // Nesting: a shell S is a VOID (internal cavity) when it is CONTAINED inside
    // some other shell T -- T's boundary encloses S. We require (a) S's whole AABB
    // lies STRICTLY inside T's AABB (an ASYMMETRIC pre-filter, so the larger outer
    // shell can never be flagged as nested inside the smaller inner one even though
    // they share a centre), AND (b) S's centre classifies INSIDE T by the even-odd
    // ray cast (true containment, not just a bounds overlap). This tags only the
    // inner void shell of a cube-with-cavity, leaving the outer body shell top-level.
    auto aabbStrictlyInside = [](const ShellMesh& S, const ShellMesh& T) -> bool {
        for (int d = 0; d < 3; ++d) {
            if (!(S.bmin[d] > T.bmin[d] && S.bmax[d] < T.bmax[d])) return false;
        }
        return true;
    };
    for (std::size_t i = 0; i < shells.size(); ++i) {
        double cx, cy, cz; shellCentre(shells[i], cx, cy, cz);
        bool nested = false;
        for (std::size_t j = 0; j < shells.size(); ++j) {
            if (j == i) continue;
            const ShellMesh& T = shells[j];
            if (!aabbStrictlyInside(shells[i], T)) continue;   // asymmetric pre-filter
            if (pointInShell(pos, T.tris, cx, cy, cz)) { nested = true; break; }
        }
        shells[i].isVoid = nested;
    }

    // b0 = number of TOP-LEVEL (non-void) shells == number of solid bodies.
    // b1 = sum of 2*genus over ALL closed boundary shells (tunnels).
    // b2 = total number of closed shells == number of enclosed regions.
    long long b0 = 0, b1 = 0, b2 = 0;
    for (const ShellMesh& s : shells) {
        if (!s.isVoid) ++b0;
        b1 += 2 * s.genus;
        ++b2;
    }
    b.b0 = b0; b.b1 = b1; b.b2 = b2;

    b.shells.reserve(shells.size());
    for (const ShellMesh& s : shells) {
        BettiNumbers::ShellInfo si;
        si.V = s.V; si.E = s.E; si.F = s.F;
        si.eulerChar = s.eulerChar;
        si.genus = s.genus;
        si.isVoid = s.isVoid;
        si.signedVolume = s.signedVol6 / 6.0;
        b.shells.push_back(si);
    }
    b.ok = true;
    return b;
}

} // anonymous namespace

// ===========================================================================
// (1) BETTI
// ===========================================================================
BettiNumbers computeBettiFromSoup(const std::vector<double>& positions,
                                  const std::vector<std::uint32_t>& indices) {
    std::vector<ShellMesh> shells = partitionShells(positions, indices);
    return assembleBetti(positions, indices, shells);
}

BettiNumbers computeBetti(const Solid& solid, double weldTol) {
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    tessellateSolid(solid, pos, idx, weldTol);
    return computeBettiFromSoup(pos, idx);
}

// ===========================================================================
// (2) VALIDITY
// ===========================================================================
ValiditySelfCheck checkValidity(const mesh::HalfEdgeMesh& meshIn) {
    ValiditySelfCheck c;
    const mesh::ValidityReport r = meshIn.validate();
    c.tessellated     = (meshIn.faceCount() > 0);
    c.twinsConsistent = r.twinsConsistent;
    c.manifold        = r.manifold;
    c.watertight      = r.watertight;
    c.numVertices     = r.numVertices;
    c.numEdges        = r.numEdges;
    c.numFaces        = r.numFaces;
    c.eulerChar       = r.eulerChar;
    c.signedVolume    = meshIn.signedVolume();
    c.surfaceArea     = meshIn.surfaceArea();
    c.positiveVolume  = (c.signedVolume > 0.0);
    return c;
}

ValiditySelfCheck checkValidity(const Solid& solid, double weldTol) {
    bool ok = false;
    mesh::HalfEdgeMesh m = tessellateSolidToMesh(solid, ok, weldTol);
    ValiditySelfCheck c = checkValidity(m);
    if (!ok) { c.tessellated = false; }
    return c;
}

// ===========================================================================
// (3) INTERFACE IoU
// ===========================================================================
double interfaceRamp(double iou) {
    if (iou >= 0.95) return 1.0;
    if (iou <= 0.80) return 0.0;
    return (iou - 0.80) / (0.95 - 0.80);
}

InterfaceIoU interfaceIoUFromSoup(const std::vector<double>& positions,
                                  const std::vector<std::uint32_t>& indices,
                                  const AABBox& keepIn,
                                  const AABBox& keepOut,
                                  std::size_t gridN) {
    InterfaceIoU r;
    if (indices.empty() || gridN == 0) { r.ok = false; return r; }
    const std::size_t N = gridN;

    // KEEP-IN: fraction of the required box that is material.
    if (keepIn.valid()) {
        long long total = 0, filled = 0;
        for (std::size_t ix = 0; ix < N; ++ix)
            for (std::size_t iy = 0; iy < N; ++iy)
                for (std::size_t iz = 0; iz < N; ++iz) {
                    const double x = keepIn.min[0] + (keepIn.max[0] - keepIn.min[0]) * (ix + 0.5) / N;
                    const double y = keepIn.min[1] + (keepIn.max[1] - keepIn.min[1]) * (iy + 0.5) / N;
                    const double z = keepIn.min[2] + (keepIn.max[2] - keepIn.min[2]) * (iz + 0.5) / N;
                    ++total;
                    if (pointInShell(positions, indices, x, y, z)) ++filled;
                }
        r.samplesKeepIn = total;
        r.filledKeepIn  = filled;
        // intersection (filled) / union; union == keepIn since material∩keepIn ⊆ keepIn.
        r.keepInIoU = (total > 0) ? (double)filled / (double)total : 0.0;
    } else {
        r.keepInIoU = 1.0;  // no keep-in constraint -> trivially satisfied
    }

    // KEEP-OUT: fraction of the forbidden box that is (wrongly) material.
    if (keepOut.valid()) {
        long long total = 0, filled = 0;
        for (std::size_t ix = 0; ix < N; ++ix)
            for (std::size_t iy = 0; iy < N; ++iy)
                for (std::size_t iz = 0; iz < N; ++iz) {
                    const double x = keepOut.min[0] + (keepOut.max[0] - keepOut.min[0]) * (ix + 0.5) / N;
                    const double y = keepOut.min[1] + (keepOut.max[1] - keepOut.min[1]) * (iy + 0.5) / N;
                    const double z = keepOut.min[2] + (keepOut.max[2] - keepOut.min[2]) * (iz + 0.5) / N;
                    ++total;
                    if (pointInShell(positions, indices, x, y, z)) ++filled;
                }
        r.samplesKeepOut = total;
        r.filledKeepOut  = filled;
        r.keepOutOverlap = (total > 0) ? (double)filled / (double)total : 0.0;
        r.keepOutIoU = 1.0 - r.keepOutOverlap;
    } else {
        r.keepOutOverlap = 0.0;
        r.keepOutIoU = 1.0;  // no keep-out constraint -> trivially clean
    }

    // Group / feature score = WORST (min) of the two sub-IoUs, ramped.
    const double worst = (r.keepInIoU < r.keepOutIoU) ? r.keepInIoU : r.keepOutIoU;
    r.rampedScore = interfaceRamp(worst);
    r.ok = true;
    return r;
}

InterfaceIoU interfaceIoU(const Solid& solid,
                          const AABBox& keepIn,
                          const AABBox& keepOut,
                          std::size_t gridN,
                          double weldTol) {
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    tessellateSolid(solid, pos, idx, weldTol);
    return interfaceIoUFromSoup(pos, idx, keepIn, keepOut, gridN);
}

} // namespace brep
} // namespace native
} // namespace forge
