// forge/native/geom/Voronoi3D.cpp
//
// Implementation of the in-house 3D Voronoi diagram declared in
// forge/native/geom/Voronoi3D.hpp. See that header for the algorithm,
// duality argument, robustness posture, and the TARGETED remainder.
//
// The diagram is the COMBINATORIAL DUAL of the Delaunay tetrahedralization
// produced by forge::native::geom::delaunay3D — that routine is reused verbatim
// (this file never re-implements a triangulation). Every COMBINATORIAL decision
// (which tets touch a site, which sites are on the hull, which cells are
// bounded) is inherited from that exact-predicate Delaunay. Only the Voronoi-
// vertex coordinates (circumcenters) and the cell volumes are ordinary doubles.
//
// Pure C++20 + stdlib only. No OCCT, no WASM, no third-party libs.

#include "forge/native/geom/Voronoi3D.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <unordered_set>
#include <utility>
#include <vector>

namespace forge {
namespace native {
namespace geom {

namespace {

// Solve the 3x3 linear system M x = r by Cramer's rule. Returns false (no x set)
// iff the matrix is singular (|det| not provably nonzero relative to the row
// scale). For a non-degenerate tetrahedron the three perpendicular-bisector
// planes are linearly independent, so this never fails on Delaunay input.
inline bool solve3x3(const double M[3][3], const double r[3], double x[3]) {
    const double det =
        M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
        M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
        M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);

    // Scale-relative singularity guard: compare |det| to the product of row
    // norms (the Hadamard bound scale). A truly independent triple clears it by
    // many orders of magnitude; a coplanar/degenerate triple collapses to ~0.
    double rowScale = 1.0;
    for (int i = 0; i < 3; ++i) {
        const double rn = std::sqrt(M[i][0] * M[i][0] +
                                    M[i][1] * M[i][1] +
                                    M[i][2] * M[i][2]);
        rowScale *= (rn > 0.0 ? rn : 1.0);
    }
    if (!(std::fabs(det) > 1e-12 * rowScale)) return false;

    // det of M with column k replaced by r.
    auto detCol = [&](int k) {
        double A[3][3];
        for (int i = 0; i < 3; ++i)
            for (int j = 0; j < 3; ++j)
                A[i][j] = (j == k) ? r[i] : M[i][j];
        return A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
               A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
               A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
    };
    x[0] = detCol(0) / det;
    x[1] = detCol(1) / det;
    x[2] = detCol(2) / det;
    return true;
}

// Divergence-theorem volume of a closed, outward-CCW triangle surface whose
// faces index into `verts`. V = (1/6) * sum dot(a, cross(b, c)).
inline double surfaceVolume(const std::vector<Point3>& verts,
                            const std::vector<std::array<int,3>>& faces) {
    double vol = 0.0;
    for (const auto& f : faces) {
        const Point3& a = verts[f[0]];
        const Point3& b = verts[f[1]];
        const Point3& c = verts[f[2]];
        const double cx = b.y * c.z - b.z * c.y;
        const double cy = b.z * c.x - b.x * c.z;
        const double cz = b.x * c.y - b.y * c.x;
        vol += (a.x * cx + a.y * cy + a.z * cz);
    }
    return vol / 6.0;
}

// A half-space  n.x <= d  (interior is the side where n.x <= d).
struct HalfSpace { double nx, ny, nz, d; };

// ---------------------------------------------------------------------------
// A bounded convex polyhedron, stored as a vertex list + a face list (each face
// an ORDERED loop of vertex indices, wound CCW seen from OUTSIDE so its normal
// points out). It is clipped, plane by plane, against bisector half-spaces. A
// half-space clip of a convex polyhedron is exact in the combinatorial sense
// (each face is split by Sutherland-Hodgman; the new opening is capped by one
// new face), and the result ALWAYS contains every point that is inside every
// clip half-space — in particular the Voronoi site, which is on the interior
// side of every bisector by construction. This is what makes the site provably
// contained, unlike free vertex enumeration with a feasibility tolerance.
// ---------------------------------------------------------------------------
struct Poly {
    std::vector<Point3>           verts;
    std::vector<std::vector<int>> faces;   // each: CCW-outward loop of vert idx
};

// Signed distance of a point to a plane (n.x - d): >0 outside, <0 inside, ~0 on.
inline double planeEval(const HalfSpace& h, const Point3& p) {
    return h.nx * p.x + h.ny * p.y + h.nz * p.z - h.d;
}

// Build an axis-aligned box [cx±r] as a closed convex Poly with outward faces.
inline Poly makeBox(double cx, double cy, double cz, double r) {
    Poly P;
    P.verts = {
        {cx - r, cy - r, cz - r}, {cx + r, cy - r, cz - r},
        {cx + r, cy + r, cz - r}, {cx - r, cy + r, cz - r},
        {cx - r, cy - r, cz + r}, {cx + r, cy - r, cz + r},
        {cx + r, cy + r, cz + r}, {cx - r, cy + r, cz + r},
    };
    // Each face CCW as seen from OUTSIDE (outward normal).
    P.faces = {
        {0, 3, 2, 1},   // -z (normal -z)
        {4, 5, 6, 7},   // +z
        {0, 1, 5, 4},   // -y
        {2, 3, 7, 6},   // +y
        {1, 2, 6, 5},   // +x
        {0, 4, 7, 3},   // -x
    };
    return P;
}

// Clip a convex Poly by the half-space  h.n . x <= h.d  (keep the inside).
// Returns the clipped Poly. `eps` is a small absolute on-plane tolerance scaled
// by the caller to the geometry. Sets `touched=true` iff the clip plane actually
// contributed a new face (the polyhedron reached that plane). Standard convex-
// polyhedron clipping: for each existing face, keep the inside portion (splitting
// edges that cross the plane); collect the cut points and close them into one new
// face on the clip plane.
Poly clipByHalfSpace(const Poly& in, const HalfSpace& h, double eps, bool& touched) {
    touched = false;
    Poly out;
    if (in.verts.empty()) return out;

    // Classify vertices.
    std::vector<double> sd(in.verts.size());
    std::vector<int>    side(in.verts.size());  // -1 inside, 0 on, +1 outside
    for (std::size_t i = 0; i < in.verts.size(); ++i) {
        const double v = planeEval(h, in.verts[i]);
        sd[i] = v;
        side[i] = (v > eps) ? 1 : (v < -eps ? -1 : 0);
    }
    bool anyOut = false, anyIn = false;
    for (int s : side) { if (s > 0) anyOut = true; if (s < 0) anyIn = true; }
    if (!anyOut) { return in; }          // wholly inside (or on) — unchanged
    if (!anyIn)  { return out; }         // wholly outside — clipped to nothing

    // New vertex index map: old vertex i (kept if side<=0) -> new index.
    std::vector<int> remap(in.verts.size(), -1);
    auto addVert = [&](const Point3& p) {
        out.verts.push_back(p);
        return static_cast<int>(out.verts.size()) - 1;
    };
    for (std::size_t i = 0; i < in.verts.size(); ++i)
        if (side[i] <= 0) remap[i] = addVert(in.verts[i]);

    // Cut-point cache, keyed by the (ordered) edge that was split, so the two
    // faces sharing an edge get the SAME new vertex.
    std::vector<std::vector<int>> cutOnFace;   // collects cut verts per new opening
    auto edgeKey = [&](int a, int b) {
        return (static_cast<std::uint64_t>(static_cast<std::uint32_t>(a)) << 32) |
                static_cast<std::uint32_t>(b);
    };
    std::vector<std::pair<std::uint64_t,int>> cutCache;
    auto findCut = [&](std::uint64_t k) -> int {
        for (auto& e : cutCache) if (e.first == k) return e.second;
        return -1;
    };
    auto interp = [&](int a, int b) {
        // Intersection of segment a-b with the plane.
        const double da = sd[a], db = sd[b];
        const double t = da / (da - db);
        const Point3& A = in.verts[a];
        const Point3& B = in.verts[b];
        return Point3{ A.x + t * (B.x - A.x),
                       A.y + t * (B.y - A.y),
                       A.z + t * (B.z - A.z) };
    };
    auto getCut = [&](int a, int b) {
        // Symmetric key (smaller index first) so both directions share the vertex.
        int lo = std::min(a, b), hi = std::max(a, b);
        std::uint64_t k = edgeKey(lo, hi);
        int idx = findCut(k);
        if (idx >= 0) return idx;
        int ni = addVert(interp(lo, hi));
        cutCache.emplace_back(k, ni);
        return ni;
    };

    std::vector<int> capLoop;  // new vertices on the clip plane (the cap face)
    for (const auto& f : in.faces) {
        std::vector<int> nf;
        const int m = static_cast<int>(f.size());
        for (int e = 0; e < m; ++e) {
            const int a = f[e];
            const int b = f[(e + 1) % m];
            const int sa = side[a], sb = side[b];
            if (sa <= 0) nf.push_back(remap[a]);   // keep inside/on start vertex
            // Edge crosses strictly between inside and outside -> add cut vertex.
            if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
                int c = getCut(a, b);
                nf.push_back(c);
                capLoop.push_back(c);
            } else if (sa == 0 && sb > 0) {
                // start ON the plane, going outside: the on-plane vertex is a cap pt
                capLoop.push_back(remap[a]);
            } else if (sa > 0 && sb == 0) {
                // entering from outside to an on-plane vertex: it is a cap point
                // (added when that vertex is the start of the next kept edge)
            }
        }
        // Remove consecutive duplicates that can arise from on-plane vertices.
        std::vector<int> cf;
        for (int idx : nf) if (cf.empty() || cf.back() != idx) cf.push_back(idx);
        if (!cf.empty() && cf.size() >= 3 && cf.front() == cf.back()) cf.pop_back();
        if (cf.size() >= 3) out.faces.push_back(cf);
    }
    (void)cutOnFace;

    // Build the single cap face from the cut/on-plane vertices, ordered CCW about
    // the clip-plane normal (which is the outward normal of the new face).
    // De-duplicate cap vertices.
    std::vector<int> cap;
    for (int v : capLoop) if (std::find(cap.begin(), cap.end(), v) == cap.end())
        cap.push_back(v);
    if (cap.size() >= 3) {
        // Centroid of the cap.
        Point3 c{0, 0, 0};
        for (int v : cap) { c.x += out.verts[v].x; c.y += out.verts[v].y; c.z += out.verts[v].z; }
        const double inv = 1.0 / static_cast<double>(cap.size());
        c.x *= inv; c.y *= inv; c.z *= inv;
        // Reference axes in the clip plane.
        const double nlen = std::sqrt(h.nx*h.nx + h.ny*h.ny + h.nz*h.nz);
        const double ux0 = out.verts[cap[0]].x - c.x;
        const double uy0 = out.verts[cap[0]].y - c.y;
        const double uz0 = out.verts[cap[0]].z - c.z;
        const double ul = std::sqrt(ux0*ux0 + uy0*uy0 + uz0*uz0);
        if (ul > 0 && nlen > 0) {
            const double ux = ux0/ul, uy = uy0/ul, uz = uz0/ul;
            // w = n x u (the other in-plane axis), n normalized.
            const double nx = h.nx/nlen, ny = h.ny/nlen, nz = h.nz/nlen;
            const double wx = ny*uz - nz*uy;
            const double wy = nz*ux - nx*uz;
            const double wz = nx*uy - ny*ux;
            std::sort(cap.begin(), cap.end(), [&](int A, int B) {
                const double ax = out.verts[A].x - c.x, ay = out.verts[A].y - c.y, az = out.verts[A].z - c.z;
                const double bx = out.verts[B].x - c.x, by = out.verts[B].y - c.y, bz = out.verts[B].z - c.z;
                const double aA = std::atan2(ax*wx+ay*wy+az*wz, ax*ux+ay*uy+az*uz);
                const double aB = std::atan2(bx*wx+by*wy+bz*wz, bx*ux+by*uy+bz*uz);
                return aA < aB;
            });
            // The cap's outward normal is +n (clip plane normal points outside).
            // Ensure the loop is CCW as seen from outside (along +n): the sorted
            // order around +n via atan2(.,w / .,u) is already CCW about +n.
            out.faces.push_back(cap);
            touched = true;
        }
    }
    return out;
}

// Triangulate a convex polygon face (fan) into outward-CCW triangles, appending
// to `triFaces` (indices into the SAME vertex array the face uses).
inline void triangulateFace(const std::vector<int>& f,
                            std::vector<std::array<int,3>>& triFaces) {
    for (std::size_t i = 1; i + 1 < f.size(); ++i)
        triFaces.push_back({f[0], f[static_cast<int>(i)], f[static_cast<int>(i) + 1]});
}

} // namespace

// ---------------------------------------------------------------------------
// Circumcenter of a tetrahedron.
//
// The circumcenter O is equidistant from a,b,c,d, so it lies on the three
// perpendicular-bisector planes of the edges (a,b), (a,c), (a,d):
//   2 (b-a) . O = |b|^2 - |a|^2     (and similarly for c, d)
// which is the linear system M O = r with the row vectors b-a, c-a, d-a.
// ---------------------------------------------------------------------------
Circumcenter tetCircumcenter(const Point3& a, const Point3& b,
                             const Point3& c, const Point3& d) {
    Circumcenter out;
    const double na = a.x * a.x + a.y * a.y + a.z * a.z;
    const double nb = b.x * b.x + b.y * b.y + b.z * b.z;
    const double nc = c.x * c.x + c.y * c.y + c.z * c.z;
    const double nd = d.x * d.x + d.y * d.y + d.z * d.z;

    double M[3][3] = {
        {2.0 * (b.x - a.x), 2.0 * (b.y - a.y), 2.0 * (b.z - a.z)},
        {2.0 * (c.x - a.x), 2.0 * (c.y - a.y), 2.0 * (c.z - a.z)},
        {2.0 * (d.x - a.x), 2.0 * (d.y - a.y), 2.0 * (d.z - a.z)},
    };
    double r[3] = { nb - na, nc - na, nd - na };
    double x[3];
    if (!solve3x3(M, r, x)) { out.ok = false; return out; }
    out.ok = true;
    out.center = Point3{x[0], x[1], x[2]};
    return out;
}

// ---------------------------------------------------------------------------
// nearest-site point location — exact linear scan over squared distance.
// ---------------------------------------------------------------------------
int nearestSite(const Voronoi3DResult& v, const Point3& query) {
    int best = -1;
    double bestD = std::numeric_limits<double>::infinity();
    for (int i = 0; i < static_cast<int>(v.sites.size()); ++i) {
        const Point3& s = v.sites[i];
        const double dx = s.x - query.x;
        const double dy = s.y - query.y;
        const double dz = s.z - query.z;
        const double d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { bestD = d; best = i; }  // strict < => smallest index on tie
    }
    return best;
}

double totalBoundedCellVolume(const Voronoi3DResult& v) {
    double sum = 0.0;
    for (const auto& cell : v.cells)
        if (cell.bounded) sum += cell.volume;
    return sum;
}

// ---------------------------------------------------------------------------
// voronoi3D — build the diagram from the Delaunay dual.
// ---------------------------------------------------------------------------
Voronoi3DResult voronoi3D(const std::vector<Point3>& pts, std::uint64_t seed) {
    Voronoi3DResult V;

    // ---- 1. Delaunay tetrahedralization (the dual). ------------------------
    Delaunay3DResult D = delaunay3D(pts, seed);
    if (!D.ok) {
        V.ok = false;
        V.reason = D.reason;        // forward the honest Delaunay diagnosis
        return V;
    }

    V.sites      = D.points;        // unique, deduped sites (Delaunay-local order)
    V.inputIndex = D.inputIndex;
    const int nSites = static_cast<int>(V.sites.size());
    const int nTets  = static_cast<int>(D.tetrahedra.size());

    // ---- 2. Voronoi vertices = circumcenter of each Delaunay tet. ----------
    V.voronoiVertices.reserve(nTets);
    for (const auto& t : D.tetrahedra) {
        Circumcenter cc = tetCircumcenter(V.sites[t[0]], V.sites[t[1]],
                                          V.sites[t[2]], V.sites[t[3]]);
        // Every Delaunay tet is POSITIVE-oriented (non-degenerate), so cc.ok is
        // always true here. If a near-degenerate sliver ever defeated the
        // singularity guard we record a NaN vertex so the bug is loud, never a
        // silently fabricated coordinate.
        if (cc.ok) {
            V.voronoiVertices.push_back(cc.center);
        } else {
            const double q = std::numeric_limits<double>::quiet_NaN();
            V.voronoiVertices.push_back(Point3{q, q, q});
        }
    }

    // ---- 3. Per-site incidence and Delaunay adjacency. ----------------------
    //         tetsAtSite[s] = tets whose quad contains site s (its circumcenters
    //         are the Voronoi cell's corners, used for the cell-corner report).
    //         neighbors[s]  = the SET of sites sharing a Delaunay edge with s
    //         (its Delaunay neighbors). The Voronoi cell of s is exactly the
    //         intersection of the half-spaces bounded by the perpendicular
    //         bisector of s and each neighbor — this is the EXACT cell and always
    //         contains s, unlike the convex hull of incident circumcenters, which
    //         a sliver-tet circumcenter from a robust-in-practice (not proven-
    //         exact) Delaunay can distort. The bisector planes themselves are
    //         immune to that distortion, so we build the cell from them.
    std::vector<std::vector<int>> tetsAtSite(nSites);
    std::vector<std::unordered_set<int>> neighborSet(nSites);
    for (int t = 0; t < nTets; ++t) {
        const auto& q = D.tetrahedra[t];
        for (int k = 0; k < 4; ++k) {
            tetsAtSite[q[k]].push_back(t);
            for (int m = 0; m < 4; ++m)
                if (m != k) neighborSet[q[k]].insert(q[m]);
        }
    }

    // ---- 4. Hull sites (appear in any Delaunay hull face) have an UNBOUNDED
    //         Voronoi cell. We use this exact combinatorial fact to decide
    //         boundedness; the geometric clip below corroborates it. -----------
    std::unordered_set<int> hullSites;
    hullSites.reserve(D.hullFaces.size() * 3 + 1);
    for (const auto& f : D.hullFaces) {
        hullSites.insert(f[0]);
        hullSites.insert(f[1]);
        hullSites.insert(f[2]);
    }

    // A clip box far larger than the cloud: used to detect unboundedness. If the
    // bisector half-spaces alone do not bound the cell, the cell touches this box
    // and is reported unbounded (we never return the clipped-to-box volume as if
    // it were finite). The box is centered on the cloud, sized to its extent.
    double minx = V.sites[0].x, maxx = V.sites[0].x;
    double miny = V.sites[0].y, maxy = V.sites[0].y;
    double minz = V.sites[0].z, maxz = V.sites[0].z;
    for (int i = 1; i < nSites; ++i) {
        minx = std::min(minx, V.sites[i].x); maxx = std::max(maxx, V.sites[i].x);
        miny = std::min(miny, V.sites[i].y); maxy = std::max(maxy, V.sites[i].y);
        minz = std::min(minz, V.sites[i].z); maxz = std::max(maxz, V.sites[i].z);
    }
    const double ext = std::max(maxx - minx,
                                std::max(maxy - miny, maxz - minz));
    const double extScale = (ext > 0.0 ? ext : 1.0);
    // Clip box: a generous cube around the cloud. A bounded cell never reaches
    // it; an unbounded cell's clip leaves a face ON one of these six planes,
    // which we detect to mark the cell unbounded (we never return the box-clipped
    // volume as if it were finite).
    const double R = extScale * 8.0;                     // box half-extent
    const double bcx = 0.5 * (minx + maxx);
    const double bcy = 0.5 * (miny + maxy);
    const double bcz = 0.5 * (minz + maxz);
    const HalfSpace boxHS[6] = {
        { 1, 0, 0, bcx + R}, {-1, 0, 0, -(bcx - R)},
        { 0, 1, 0, bcy + R}, { 0,-1, 0, -(bcy - R)},
        { 0, 0, 1, bcz + R}, { 0, 0,-1, -(bcz - R)},
    };
    // On-plane tolerance for clipping, scaled to the geometry.
    const double clipEps = 1e-9 * extScale;

    // ---- 5. Assemble one cell per site by clipping the box with the bisector
    //         half-spaces between the site and its Delaunay neighbors. ----------
    V.cells.resize(nSites);
    V.boundedCellCount = 0;
    for (int s = 0; s < nSites; ++s) {
        VoronoiCell& cell = V.cells[s];
        cell.site = s;
        cell.vertexCount = static_cast<int>(tetsAtSite[s].size());

        const Point3& P = V.sites[s];

        // The bisector of P and a neighbor Q is the plane of points equidistant
        // from both; the side closer to P (where the cell lives) is the half-space
        // n.x <= d with n = (Q-P) and d = n . midpoint(P,Q). P satisfies this with
        // strict slack (it is the closest point to itself), so every clip KEEPS P.
        std::vector<HalfSpace> bis;
        bis.reserve(neighborSet[s].size());
        for (int q : neighborSet[s]) {
            const Point3& Q = V.sites[q];
            const double nx = Q.x - P.x, ny = Q.y - P.y, nz = Q.z - P.z;
            const double mx = 0.5 * (P.x + Q.x);
            const double my = 0.5 * (P.y + Q.y);
            const double mz = 0.5 * (P.z + Q.z);
            const double d = nx * mx + ny * my + nz * mz;
            bis.push_back(HalfSpace{nx, ny, nz, d});
        }

        // Start from the box, clip by every bisector. Track which box planes are
        // still load-bearing AFTER all clips: if the final polyhedron still has a
        // face lying on a box plane, the bisectors did not bound the cell in that
        // direction => the cell is UNBOUNDED.
        Poly poly = makeBox(bcx, bcy, bcz, R);
        bool empty = false;
        for (const auto& h : bis) {
            bool touched = false;
            poly = clipByHalfSpace(poly, h, clipEps, touched);
            if (poly.verts.empty() || poly.faces.empty()) { empty = true; break; }
        }

        const bool combinatoriallyHull = (hullSites.find(s) != hullSites.end());

        // Detect whether any face still lies on a box plane (cell reaches the box).
        bool onBox = false;
        if (!empty) {
            for (const auto& f : poly.faces) {
                bool faceOnBox = false;
                for (const auto& b : boxHS) {
                    bool all = true;
                    for (int vi : f) {
                        if (std::fabs(planeEval(b, poly.verts[vi])) > 1e-6 * std::max(1.0, R)) {
                            all = false; break;
                        }
                    }
                    if (all) { faceOnBox = true; break; }
                }
                if (faceOnBox) { onBox = true; break; }
            }
        }

        if (empty || combinatoriallyHull || onBox || poly.verts.size() < 4) {
            // Unbounded (hull site, or the clip still touches the box) or
            // degenerate: report honestly, no fabricated finite volume.
            cell.bounded = false;
            cell.volume  = 0.0;
            cell.vertices.clear();
            cell.hullFaces.clear();
            continue;
        }

        // Bounded cell: emit the clipped polyhedron's vertices and triangulated
        // outward-CCW faces, with the divergence-theorem volume.
        cell.bounded  = true;
        cell.vertices = poly.verts;
        cell.hullFaces.clear();
        for (const auto& f : poly.faces) triangulateFace(f, cell.hullFaces);
        cell.volume = std::fabs(surfaceVolume(cell.vertices, cell.hullFaces));
        ++V.boundedCellCount;
    }

    V.ok = true;
    if (V.boundedCellCount == 0) {
        // The diagram exists but has no finite cell (e.g. every site on the
        // hull — a single tetrahedron, or fewer than 5 points). Honest, ok=true.
        V.reason = "no interior site: all Voronoi cells are unbounded "
                   "(ok with the bounded subset, which is empty)";
    } else {
        V.reason = "";
    }
    return V;
}

} // namespace geom
} // namespace native
} // namespace forge
