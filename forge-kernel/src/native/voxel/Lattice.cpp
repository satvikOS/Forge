// forge/native/voxel/Lattice.cpp
//
// Implementation of the periodic strut-lattice SDF / voxelization / meshing
// declared in forge/native/voxel/Lattice.hpp. See that header for the honest
// scope, the exact capsule-SDF definition, the thin-strut volume oracle, and the
// TARGETED remainder.
//
// This file owns ONLY: the unit-cell strut-graph geometry (which segments make
// up cubic / BCC / FCC), the exact capsule signed-distance, the O(1)-per-query
// min-field, and the closed-form analytic volume fraction. Everything heavy —
// the dense grid + sampler + volume + connectivity (VoxelGrid), the marching-
// cubes mesher + half-edge mesh + validity audit (VoxelMesh -> IsoMesher ->
// HalfEdgeMesh) — is reused by #include, never re-implemented here.
//
// Pure C++20. No external dependencies. No OCCT, no WASM.

#include "forge/native/voxel/Lattice.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <functional>
#include <limits>
#include <set>

namespace forge {
namespace native {
namespace voxel {

namespace {

// --- tiny vector helpers on native::Vec3 (local; no shared math header yet) ---
inline native::Vec3 sub(const native::Vec3& a, const native::Vec3& b) {
    return native::Vec3{a.x - b.x, a.y - b.y, a.z - b.z};
}
inline double dot3(const native::Vec3& a, const native::Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
inline double clamp01(double t) { return t < 0.0 ? 0.0 : (t > 1.0 ? 1.0 : t); }

// EXACT capsule signed distance: distance from p to segment A..B, minus radius.
// Negative inside the round-capped cylinder, zero on its surface, positive out.
inline double capsuleSdf(const native::Vec3& p, const native::Vec3& A,
                         const native::Vec3& B, double radius) {
    const native::Vec3 ab = sub(B, A);
    const native::Vec3 ap = sub(p, A);
    const double len2 = dot3(ab, ab);
    double t = 0.0;
    if (len2 > 0.0) t = clamp01(dot3(ap, ab) / len2);
    const native::Vec3 c{A.x + ab.x * t, A.y + ab.y * t, A.z + ab.z * t};
    const native::Vec3 d = sub(p, c);
    return std::sqrt(dot3(d, d)) - radius;
}

// ---------------------------------------------------------------------------
// Unit-cell strut TEMPLATE in cell-local coordinates [0,1]^3.
//
// Each template entry is an undirected edge (A,B) in local units plus an
// ownership weight = the fraction of this edge attributed to ONE cell under the
// periodic half-open tiling (so summing weight*length over the template, then
// multiplying by cellSize and the cell count, counts every physical strut
// exactly once with no double counting across shared cells).
//
//   * Cube-frame edges run along the 12 cube edges; each is shared by 4 cells
//     in the infinite tiling -> weight 1/4. (We list all 12 with weight 1/4;
//     sum = 12 * a * 1/4 = 3a per cell.)
//   * BCC body-diagonals join the body center (1/2,1/2,1/2) to the 8 corners;
//     each lies wholly inside ONE cell -> weight 1 (8 struts, length sqrt(3)/2*a).
//   * FCC face-diagonals join each face center to that face's 4 corners; each
//     face is shared by 2 cells -> weight 1/2 (24 struts, length sqrt(2)/2*a).
// ---------------------------------------------------------------------------
struct LocalEdge {
    native::Vec3 a;
    native::Vec3 b;
    double weight;  // ownership fraction for the per-cell length budget
};

const std::array<native::Vec3, 8>& cubeCorners() {
    static const std::array<native::Vec3, 8> c = {{
        {0, 0, 0}, {1, 0, 0}, {1, 1, 0}, {0, 1, 0},
        {0, 0, 1}, {1, 0, 1}, {1, 1, 1}, {0, 1, 1},
    }};
    return c;
}

// The 12 cube-frame edges as corner-index pairs.
const std::array<std::array<int, 2>, 12>& cubeFrameEdges() {
    static const std::array<std::array<int, 2>, 12> e = {{
        {0, 1}, {1, 2}, {2, 3}, {3, 0}, // bottom
        {4, 5}, {5, 6}, {6, 7}, {7, 4}, // top
        {0, 4}, {1, 5}, {2, 6}, {3, 7}, // verticals
    }};
    return e;
}

// The 6 faces, each as the 4 corner indices around it (winding irrelevant here).
const std::array<std::array<int, 4>, 6>& cubeFaces() {
    static const std::array<std::array<int, 4>, 6> f = {{
        {0, 1, 2, 3}, // z = 0
        {4, 5, 6, 7}, // z = 1
        {0, 1, 5, 4}, // y = 0
        {3, 2, 6, 7}, // y = 1
        {0, 3, 7, 4}, // x = 0
        {1, 2, 6, 5}, // x = 1
    }};
    return f;
}

native::Vec3 faceCenter(const std::array<int, 4>& f) {
    const auto& c = cubeCorners();
    native::Vec3 m{0, 0, 0};
    for (int idx : f) { m.x += c[idx].x; m.y += c[idx].y; m.z += c[idx].z; }
    return native::Vec3{m.x * 0.25, m.y * 0.25, m.z * 0.25};
}

// Build the local-edge template for a family (cell-local [0,1]^3 coordinates).
std::vector<LocalEdge> localTemplate(LatticeType type) {
    std::vector<LocalEdge> edges;
    const auto& c = cubeCorners();

    // Cube frame is part of all three families.
    for (const auto& e : cubeFrameEdges())
        edges.push_back(LocalEdge{c[e[0]], c[e[1]], 0.25});

    if (type == LatticeType::BCC) {
        const native::Vec3 center{0.5, 0.5, 0.5};
        for (int i = 0; i < 8; ++i)
            edges.push_back(LocalEdge{center, c[i], 1.0});
    } else if (type == LatticeType::FCC) {
        for (const auto& f : cubeFaces()) {
            const native::Vec3 fc = faceCenter(f);
            for (int idx : f)
                edges.push_back(LocalEdge{fc, c[idx], 0.5});
        }
    }
    return edges;
}

inline double edgeLen(const native::Vec3& a, const native::Vec3& b) {
    const native::Vec3 d = sub(b, a);
    return std::sqrt(dot3(d, d));
}

} // namespace

// ---------------------------------------------------------------------------
// Closed-form per-cell strut length budget (EXACT).
// ---------------------------------------------------------------------------
double unitCellStrutLength(LatticeType type, double cellSize) {
    if (!(cellSize > 0.0)) return 0.0;
    const std::vector<LocalEdge> tmpl = localTemplate(type);
    double L = 0.0;
    for (const LocalEdge& e : tmpl)
        L += e.weight * edgeLen(e.a, e.b);    // local length (cell of side 1)
    return L * cellSize;                        // scale to world units
}

double totalStrutLength(const LatticeSpec& spec) {
    // The ACTUAL rendered struts (de-duplicated) — exactly the geometry the field
    // represents. At a finite box boundary the frame edges are not shared with an
    // outside neighbour, so this exceeds unitCellStrutLength * cellCount; that is
    // correct, because the field draws those full boundary struts.
    const std::vector<Strut> struts = enumerateStruts(spec);
    double L = 0.0;
    for (const Strut& s : struts) L += edgeLen(s.a, s.b);
    return L;
}

double analyticStrutVolume(const LatticeSpec& spec) {
    if (!(spec.radius > 0.0)) return 0.0;       // honest empty
    if (!(spec.cellSize > 0.0)) return 0.0;
    if (spec.nx == 0 || spec.ny == 0 || spec.nz == 0) return 0.0;
    const double r = spec.radius;
    // Sum of cap-free cylinder volumes over the actual rendered struts. The
    // standard AM/PicoGK thin-strut fraction; asymptotically tight as r/a -> 0.
    // (It is the tight, cap-free quantity; analyticCapsuleVolume is the strict,
    // always-true union upper bound that adds the caps.) See header.
    return M_PI * r * r * totalStrutLength(spec);
}

double analyticCapsuleVolume(const LatticeSpec& spec) {
    if (!(spec.radius > 0.0)) return 0.0;       // honest empty
    if (!(spec.cellSize > 0.0)) return 0.0;
    if (spec.nx == 0 || spec.ny == 0 || spec.nz == 0) return 0.0;
    const double r = spec.radius;
    const std::size_t nStruts = enumerateStruts(spec).size();
    // Sum of individual capsule volumes (cylinder + one sphere of caps each).
    // By sub-additivity this is a GUARANTEED upper bound on the union volume.
    return M_PI * r * r * totalStrutLength(spec)
         + double(nStruts) * (4.0 / 3.0) * M_PI * r * r * r;
}

// ---------------------------------------------------------------------------
// Enumerate concrete world struts tiling the box, de-duplicated by a canonical
// quantized endpoint key so shared edges appear once. (Dedup is cosmetic for the
// min-SDF — duplicates would not change the min — but keeps the segment list and
// any caller iteration clean.)
// ---------------------------------------------------------------------------
std::vector<Strut> enumerateStruts(const LatticeSpec& spec) {
    std::vector<Strut> out;
    if (spec.nx == 0 || spec.ny == 0 || spec.nz == 0) return out;
    if (!(spec.cellSize > 0.0)) return out;

    const std::vector<LocalEdge> tmpl = localTemplate(spec.type);
    const double a = spec.cellSize;

    // Quantize a world coordinate to an integer key to dedup shared endpoints.
    // All template endpoints sit on the a/2 sublattice (corners, face-centers,
    // body-center), so a quantization step of a/4 resolves every one exactly
    // while tolerating float round-off.
    const double step = a * 0.25;
    auto keyOf = [&](const native::Vec3& p) {
        auto ri = [&](double v) { return std::llround(v / step); };
        return std::array<long long, 3>{ri(p.x), ri(p.y), ri(p.z)};
    };
    auto edgeKey = [&](const native::Vec3& A, const native::Vec3& B) {
        auto ka = keyOf(A), kb = keyOf(B);
        if (kb < ka) std::swap(ka, kb);
        return std::array<long long, 6>{ka[0], ka[1], ka[2], kb[0], kb[1], kb[2]};
    };
    std::set<std::array<long long, 6>> seen;

    for (std::size_t cz = 0; cz < spec.nz; ++cz)
      for (std::size_t cy = 0; cy < spec.ny; ++cy)
        for (std::size_t cx = 0; cx < spec.nx; ++cx) {
            const native::Vec3 base{
                spec.origin.x + double(cx) * a,
                spec.origin.y + double(cy) * a,
                spec.origin.z + double(cz) * a};
            for (const LocalEdge& e : tmpl) {
                native::Vec3 A{base.x + e.a.x * a, base.y + e.a.y * a, base.z + e.a.z * a};
                native::Vec3 B{base.x + e.b.x * a, base.y + e.b.y * a, base.z + e.b.z * a};
                if (seen.insert(edgeKey(A, B)).second)
                    out.push_back(Strut{A, B});
            }
        }
    return out;
}

// ---------------------------------------------------------------------------
// O(1)-per-query lattice SDF: only consult the struts of the cells touching p's
// cell (a 3x3x3 neighbourhood). Valid as long as radius < cellSize (enforced by
// the voxelize resolve guard) so no strut from farther away can be the nearest.
// ---------------------------------------------------------------------------
double latticeSdf(const LatticeSpec& spec, const native::Vec3& p) {
    if (!(spec.cellSize > 0.0) || spec.nx == 0 || spec.ny == 0 || spec.nz == 0)
        return 1.0;  // no struts: everywhere "far outside" (no solid)

    const double a = spec.cellSize;
    const std::vector<LocalEdge> tmpl = localTemplate(spec.type);

    // Index of the cell containing p (clamped into the lattice range).
    auto cellIndex = [&](double coord, double o, std::size_t n) -> long long {
        long long idx = (long long)std::floor((coord - o) / a);
        if (idx < 0) idx = 0;
        if (idx >= (long long)n) idx = (long long)n - 1;
        return idx;
    };
    const long long cix = cellIndex(p.x, spec.origin.x, spec.nx);
    const long long ciy = cellIndex(p.y, spec.origin.y, spec.ny);
    const long long ciz = cellIndex(p.z, spec.origin.z, spec.nz);

    double best = std::numeric_limits<double>::infinity();
    for (long long dz = -1; dz <= 1; ++dz)
      for (long long dy = -1; dy <= 1; ++dy)
        for (long long dx = -1; dx <= 1; ++dx) {
            const long long ccx = cix + dx, ccy = ciy + dy, ccz = ciz + dz;
            if (ccx < 0 || ccx >= (long long)spec.nx) continue;
            if (ccy < 0 || ccy >= (long long)spec.ny) continue;
            if (ccz < 0 || ccz >= (long long)spec.nz) continue;
            const native::Vec3 base{
                spec.origin.x + double(ccx) * a,
                spec.origin.y + double(ccy) * a,
                spec.origin.z + double(ccz) * a};
            for (const LocalEdge& e : tmpl) {
                const native::Vec3 A{base.x + e.a.x * a, base.y + e.a.y * a, base.z + e.a.z * a};
                const native::Vec3 B{base.x + e.b.x * a, base.y + e.b.y * a, base.z + e.b.z * a};
                const double d = capsuleSdf(p, A, B, spec.radius);
                if (d < best) best = d;
            }
        }
    if (!std::isfinite(best)) return 1.0;
    return best;
}

// ---------------------------------------------------------------------------
// Voxelize the lattice SDF into a dense grid, padding margin cells of empty
// space so the solid stays strictly interior (=> the contoured surface closes).
// ---------------------------------------------------------------------------
VoxelizeResult voxelize(const LatticeSpec& spec, std::size_t samplesPerCell) {
    VoxelizeResult vr;

    if (!(spec.cellSize > 0.0)) { vr.reason = "cellSize must be > 0"; return vr; }
    if (spec.nx == 0 || spec.ny == 0 || spec.nz == 0) {
        vr.reason = "lattice must have >= 1 cell per axis"; return vr;
    }
    if (samplesPerCell < 2) { vr.reason = "samplesPerCell must be >= 2"; return vr; }
    if (!(spec.radius > 0.0)) {
        // HONEST EMPTY: zero (or negative) radius is zero-volume — no solid. We do
        // NOT fabricate a field; the caller gets ok=false and an empty grid.
        vr.reason = "radius <= 0 gives an empty solid (honest)"; return vr;
    }

    const double spacing = spec.cellSize / double(samplesPerCell);

    // Resolve guard: the strut diameter must span at least ~one grid spacing or
    // the field cannot represent the strut (it would alias to nothing). Also keep
    // radius < cellSize so the 3x3x3 neighbourhood SDF is exact.
    if (spec.radius < spacing) {
        vr.reason = "radius smaller than grid spacing — cannot resolve strut";
        return vr;
    }
    if (spec.radius >= spec.cellSize) {
        vr.reason = "radius >= cellSize — outside the thin-strut envelope";
        return vr;
    }

    // Margin cells of empty grid on every side so no strut is clipped by a box
    // face -> contoured surface is closed. >= 2 spacings of margin past the strut.
    const std::size_t margin =
        std::max<std::size_t>(2, (std::size_t)std::ceil(spec.radius / spacing) + 1);

    const std::size_t spanX = spec.nx * samplesPerCell;  // cells of lattice field
    const std::size_t spanY = spec.ny * samplesPerCell;
    const std::size_t spanZ = spec.nz * samplesPerCell;

    // Node counts: lattice span + margin on each side, +1 to close last cell.
    const std::size_t nxNodes = spanX + 2 * margin + 1;
    const std::size_t nyNodes = spanY + 2 * margin + 1;
    const std::size_t nzNodes = spanZ + 2 * margin + 1;

    const native::Vec3 gorigin{
        spec.origin.x - double(margin) * spacing,
        spec.origin.y - double(margin) * spacing,
        spec.origin.z - double(margin) * spacing};

    VoxelGrid<float> g(nxNodes, nyNodes, nzNodes, gorigin, spacing);
    LatticeSpec localSpec = spec;  // capture by value
    g.fillFromField([&](double x, double y, double z) {
        return latticeSdf(localSpec, native::Vec3{x, y, z});
    });

    vr.grid = std::move(g);
    vr.marginCells = margin;
    vr.ok = true;
    vr.reason = "";
    return vr;
}

LatticeMesh buildLatticeMesh(const LatticeSpec& spec, std::size_t samplesPerCell) {
    LatticeMesh lm;
    lm.voxels = voxelize(spec, samplesPerCell);
    if (!lm.voxels.ok) {
        lm.ok = false;
        lm.reason = lm.voxels.reason;
        return lm;
    }
    // Contour the {f = 0} iso-surface via the SHARED mesher (no duplicate mesher).
    lm.contour = VoxelMesh::contour(lm.voxels.grid, 0.0);
    lm.ok = lm.contour.ok;
    lm.reason = lm.contour.ok ? "" : "non-manifold marching-cubes soup (REJECTED, not faked)";
    return lm;
}

double measuredOccupiedVolume(const VoxelizeResult& vr) {
    if (!vr.ok) return 0.0;
    if (vr.grid.nodeCount() == 0) return 0.0;
    // Absolute solid volume of { f <= 0 } (negative inside), midpoint cell-center
    // rule over the whole padded grid (every capsule lies inside it).
    return vr.grid.occupiedVolumeByCenter(0.0, /*insideIsLeq=*/true);
}

} // namespace voxel
} // namespace native
} // namespace forge
