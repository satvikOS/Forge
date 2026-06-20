// forge/native/mesh/HalfEdgeMesh.cpp
//
// Implementation of the in-house half-edge triangle mesh — Stage 2 of
// KERNEL_INHOUSE_ROADMAP.md. Pure C++20, no external dependencies.
//
// See HalfEdgeMesh.hpp for the honest scope statement. This file owns the
// data-structure builder, the validity audit, and the geometric measures
// (volume / area). The single boolean op (planeClip) lives in MeshBoolean.cpp.

#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <cstdint>
#include <cstddef>
#include <cmath>
#include <unordered_map>
#include <utility>
#include <vector>

namespace forge {
namespace native {
namespace mesh {

namespace {

// Pack an ordered (a,b) directed-edge key into a single 64-bit value.
inline std::uint64_t edgeKey(std::uint32_t a, std::uint32_t b) {
    return (static_cast<std::uint64_t>(a) << 32) | static_cast<std::uint64_t>(b);
}

} // namespace

bool HalfEdgeMesh::buildFromSoup(const std::vector<double>& positions,
                                 const std::vector<std::uint32_t>& indices) {
    verts_.clear();
    halfEdges_.clear();
    faces_.clear();

    if (positions.size() % 3 != 0) return false;
    if (indices.size() % 3 != 0)   return false;

    const std::uint32_t numV =
        static_cast<std::uint32_t>(positions.size() / 3);
    const std::uint32_t numF =
        static_cast<std::uint32_t>(indices.size() / 3);

    verts_.resize(numV);
    for (std::uint32_t v = 0; v < numV; ++v) {
        verts_[v].position = Vec3{positions[3 * v + 0],
                                  positions[3 * v + 1],
                                  positions[3 * v + 2]};
        verts_[v].halfEdge = kInvalid;
    }

    faces_.resize(numF);
    halfEdges_.resize(static_cast<std::size_t>(numF) * 3);

    // Map a directed edge (a->b) to the index of the half-edge whose origin is
    // a and that lies on the same triangle. A repeat of the SAME directed edge
    // means inconsistent winding / non-manifold input -> build failure.
    std::unordered_map<std::uint64_t, std::uint32_t> directed;
    directed.reserve(static_cast<std::size_t>(numF) * 3 * 2);

    for (std::uint32_t f = 0; f < numF; ++f) {
        const std::uint32_t i0 = indices[3 * f + 0];
        const std::uint32_t i1 = indices[3 * f + 1];
        const std::uint32_t i2 = indices[3 * f + 2];

        if (i0 >= numV || i1 >= numV || i2 >= numV) { verts_.clear(); halfEdges_.clear(); faces_.clear(); return false; }
        if (i0 == i1 || i1 == i2 || i0 == i2)        { verts_.clear(); halfEdges_.clear(); faces_.clear(); return false; }

        const std::uint32_t he0 = 3 * f + 0;
        const std::uint32_t he1 = 3 * f + 1;
        const std::uint32_t he2 = 3 * f + 2;

        // CCW: he0 = i0->i1, he1 = i1->i2, he2 = i2->i0.
        halfEdges_[he0] = HalfEdge{ i0, kInvalid, he1, he2, f };
        halfEdges_[he1] = HalfEdge{ i1, kInvalid, he2, he0, f };
        halfEdges_[he2] = HalfEdge{ i2, kInvalid, he0, he1, f };

        faces_[f].halfEdge = he0;

        if (verts_[i0].halfEdge == kInvalid) verts_[i0].halfEdge = he0;
        if (verts_[i1].halfEdge == kInvalid) verts_[i1].halfEdge = he1;
        if (verts_[i2].halfEdge == kInvalid) verts_[i2].halfEdge = he2;

        const std::array<std::pair<std::uint32_t, std::uint32_t>, 3> dirs = {{
            {i0, i1}, {i1, i2}, {i2, i0}
        }};
        const std::array<std::uint32_t, 3> hes = {{ he0, he1, he2 }};
        for (int k = 0; k < 3; ++k) {
            const std::uint64_t key = edgeKey(dirs[k].first, dirs[k].second);
            if (directed.find(key) != directed.end()) {
                // Same directed edge twice -> non-manifold / bad winding.
                verts_.clear(); halfEdges_.clear(); faces_.clear();
                return false;
            }
            directed.emplace(key, hes[k]);
        }
    }

    // Wire twins: for each directed edge (a->b), its twin is the half-edge of
    // the opposite directed edge (b->a). A missing opposite means a boundary
    // (open mesh) — left as kInvalid (validate() will mark it not-watertight).
    for (auto& [key, heIdx] : directed) {
        const std::uint32_t a = static_cast<std::uint32_t>(key >> 32);
        const std::uint32_t b = static_cast<std::uint32_t>(key & 0xFFFFFFFFu);
        auto it = directed.find(edgeKey(b, a));
        if (it != directed.end()) {
            halfEdges_[heIdx].twin = it->second;
        }
    }

    return true;
}

ValidityReport HalfEdgeMesh::validate() const {
    ValidityReport r;
    r.numVertices = static_cast<std::uint32_t>(verts_.size());
    r.numFaces    = static_cast<std::uint32_t>(faces_.size());

    const std::size_t H = halfEdges_.size();

    // Twin consistency: twin.twin == self and the twin runs the opposite way
    // (twin.origin == this.next.origin). Boundary half-edges (twin==kInvalid)
    // are not a twin-consistency failure on their own — they fail watertight.
    bool twinsOk = true;
    bool watertight = true;
    for (std::size_t h = 0; h < H; ++h) {
        const HalfEdge& he = halfEdges_[h];
        if (he.twin == kInvalid) { watertight = false; continue; }
        if (he.twin >= H) { twinsOk = false; break; }
        const HalfEdge& tw = halfEdges_[he.twin];
        if (tw.twin != h) { twinsOk = false; break; }
        // tw must point opposite: tw.origin == origin of he.next.
        if (he.next >= H) { twinsOk = false; break; }
        if (tw.origin != halfEdges_[he.next].origin) { twinsOk = false; break; }
        if (halfEdges_[tw.next].origin != he.origin) { twinsOk = false; break; }
    }
    r.twinsConsistent = twinsOk;
    r.watertight = watertight;

    // Undirected edge count: each undirected edge is one unordered pair {a,b}.
    // Count distinct unordered pairs and check each is incident to exactly 2
    // faces (2-manifold edge condition).
    std::unordered_map<std::uint64_t, int> edgeFaceCount;
    edgeFaceCount.reserve(H);
    bool manifoldEdges = true;
    for (std::size_t h = 0; h < H; ++h) {
        const HalfEdge& he = halfEdges_[h];
        if (he.next >= H) { manifoldEdges = false; break; }
        std::uint32_t a = he.origin;
        std::uint32_t b = halfEdges_[he.next].origin;
        std::uint32_t lo = a < b ? a : b;
        std::uint32_t hi = a < b ? b : a;
        edgeFaceCount[edgeKey(lo, hi)] += 1;
    }
    r.numEdges = static_cast<std::uint32_t>(edgeFaceCount.size());
    if (manifoldEdges) {
        for (auto& [k, c] : edgeFaceCount) {
            if (c != 2) { manifoldEdges = false; break; }
        }
    }

    // Vertex-fan manifoldness: the half-edges around each vertex must form a
    // single cycle when the mesh is closed. We verify by walking the outgoing
    // half-edges around each vertex via twin/next and checking the walk visits
    // every outgoing half-edge of that vertex exactly once. Only meaningful for
    // watertight meshes; for open meshes we skip (boundary fans are valid).
    bool fanOk = true;
    if (watertight && twinsOk) {
        // Count outgoing half-edges per vertex.
        std::vector<std::uint32_t> outCount(verts_.size(), 0);
        for (std::size_t h = 0; h < H; ++h) outCount[halfEdges_[h].origin] += 1;

        for (std::uint32_t v = 0; v < verts_.size() && fanOk; ++v) {
            if (verts_[v].halfEdge == kInvalid) continue;
            // Walk the fan: from an outgoing he, the next outgoing he around v
            // is twin(he).next? No — it is he.prev.twin (rotate around v).
            std::uint32_t start = verts_[v].halfEdge;
            std::uint32_t cur = start;
            std::uint32_t walked = 0;
            do {
                ++walked;
                // rotate: next outgoing half-edge around v
                std::uint32_t tw = halfEdges_[cur].twin;
                if (tw == kInvalid) { fanOk = false; break; }
                cur = halfEdges_[tw].next;
                if (walked > outCount[v] + 1) { fanOk = false; break; }
            } while (cur != start);
            if (fanOk && walked != outCount[v]) fanOk = false;
        }
    }

    r.manifold = manifoldEdges && fanOk;
    r.eulerChar = static_cast<int>(r.numVertices) - static_cast<int>(r.numEdges)
                + static_cast<int>(r.numFaces);
    return r;
}

double HalfEdgeMesh::signedVolume() const {
    // Sum over faces of the signed tetra volume (O, a, b, c) with O = origin.
    // V = (1/6) sum  a · (b × c).
    double vol6 = 0.0;
    for (const Face& f : faces_) {
        if (f.halfEdge == kInvalid) continue;
        const HalfEdge& h0 = halfEdges_[f.halfEdge];
        const HalfEdge& h1 = halfEdges_[h0.next];
        const HalfEdge& h2 = halfEdges_[h1.next];
        const Vec3& a = verts_[h0.origin].position;
        const Vec3& b = verts_[h1.origin].position;
        const Vec3& c = verts_[h2.origin].position;
        const double cx = b.y * c.z - b.z * c.y;
        const double cy = b.z * c.x - b.x * c.z;
        const double cz = b.x * c.y - b.y * c.x;
        vol6 += a.x * cx + a.y * cy + a.z * cz;
    }
    return vol6 / 6.0;
}

double HalfEdgeMesh::surfaceArea() const {
    double area = 0.0;
    for (const Face& f : faces_) {
        if (f.halfEdge == kInvalid) continue;
        const HalfEdge& h0 = halfEdges_[f.halfEdge];
        const HalfEdge& h1 = halfEdges_[h0.next];
        const HalfEdge& h2 = halfEdges_[h1.next];
        const Vec3& a = verts_[h0.origin].position;
        const Vec3& b = verts_[h1.origin].position;
        const Vec3& c = verts_[h2.origin].position;
        const double ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
        const double vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
        const double nx = uy * vz - uz * vy;
        const double ny = uz * vx - ux * vz;
        const double nz = ux * vy - uy * vx;
        area += 0.5 * std::sqrt(nx * nx + ny * ny + nz * nz);
    }
    return area;
}

void HalfEdgeMesh::toSoup(std::vector<double>& positions,
                          std::vector<std::uint32_t>& indices) const {
    positions.clear();
    indices.clear();
    positions.reserve(verts_.size() * 3);
    for (const Vertex& v : verts_) {
        positions.push_back(v.position.x);
        positions.push_back(v.position.y);
        positions.push_back(v.position.z);
    }
    indices.reserve(faces_.size() * 3);
    for (const Face& f : faces_) {
        if (f.halfEdge == kInvalid) continue;
        const HalfEdge& h0 = halfEdges_[f.halfEdge];
        const HalfEdge& h1 = halfEdges_[h0.next];
        const HalfEdge& h2 = halfEdges_[h1.next];
        indices.push_back(h0.origin);
        indices.push_back(h1.origin);
        indices.push_back(h2.origin);
    }
}

} // namespace mesh
} // namespace native
} // namespace forge
