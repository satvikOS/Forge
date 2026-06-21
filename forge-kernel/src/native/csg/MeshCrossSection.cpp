// forge/native/csg/MeshCrossSection.cpp
//
// Implementation of forge::native::csg::CrossSection — see MeshCrossSection.hpp
// for the scope / honesty / envelope statement. All combinatorial decisions go
// through the adaptive-exact predicate forge::native::orient2d
// (forge/native/Predicates.hpp); nothing here re-derives it.
//
// ALGORITHM (boolean ops) — a winding/arrangement clipper:
//   1. Each operand is a bag of directed edges (CCW outer, CW hole; the
//      direction encodes inside-is-on-the-left).
//   2. Build the full arrangement: split every directed edge of A at every exact
//      crossing with every directed edge of B, and vice-versa. Crossings are
//      found with the exact orient2d sign test; the crossing COORDINATE is the
//      double meet point, then SNAPPED onto any pre-existing vertex within an
//      exact-equality / tiny-eps weld so coincident vertices collapse and no
//      zero-length fake edge survives.
//   3. Classify each resulting sub-edge by testing its MIDPOINT against the OTHER
//      operand with an even-odd ray rule (pointInRegion). For
//        UNION       keep A-subedges OUTSIDE B  + B-subedges OUTSIDE A
//        INTERSECT   keep A-subedges INSIDE  B  + B-subedges INSIDE  A
//        DIFFERENCE  keep A-subedges OUTSIDE B  + B-subedges INSIDE  A (reversed)
//      Sub-edges whose midpoint lands ON the other boundary (coincident edges)
//      are kept/dropped by a coincidence rule so shared borders are not doubled.
//   4. Stitch surviving directed sub-edges head-to-tail into closed loops, then
//      normalize() re-signs into CCW-outer / CW-hole form.
//
// This is robust-in-practice (topology decided by exact orient2d) over double
// coordinates — the honest Manifold-class ceiling, not EPECK.

#include "forge/native/csg/MeshCrossSection.hpp"

#include <algorithm>
#include <cmath>
#include <map>
#include <unordered_map>
#include <vector>

namespace forge {
namespace native {
namespace csg {

using geom::Point2;

// ===========================================================================
// Small exact / numeric helpers
// ===========================================================================
namespace {

inline Sign orient(const Point2& a, const Point2& b, const Point2& c) {
    return orient2d(a.x, a.y, b.x, b.y, c.x, c.y);
}

inline bool isFinite(double v) { return std::isfinite(v); }
inline bool finiteP(const Point2& p) { return isFinite(p.x) && isFinite(p.y); }

inline bool sameP(const Point2& a, const Point2& b) {
    return a.x == b.x && a.y == b.y;
}

// Weld tolerance: two computed points closer than this are treated as the same
// vertex. Chosen relative-scaled at the call site; this is the absolute floor.
constexpr double kWeldEps = 1e-9;

inline double dist2(const Point2& a, const Point2& b) {
    const double dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
}

// Given p,q,r KNOWN collinear (orient==ZERO), is q within the bounding box of
// p-r (i.e. on the closed segment)? Exact on doubles.
inline bool onSegBox(const Point2& p, const Point2& q, const Point2& r) {
    return std::min(p.x, r.x) <= q.x && q.x <= std::max(p.x, r.x) &&
           std::min(p.y, r.y) <= q.y && q.y <= std::max(p.y, r.y);
}

// Robust proper-crossing point of segments a->b and c->d, when one exists.
// Returns true and fills `out` for a PROPER interior crossing (both orient
// signs straddle). Endpoint / collinear contacts are handled by the caller via
// vertex splitting, so they are deliberately NOT reported here.
bool properCross(const Point2& a, const Point2& b,
                 const Point2& c, const Point2& d, Point2& out) {
    const Sign o1 = orient(a, b, c);
    const Sign o2 = orient(a, b, d);
    const Sign o3 = orient(c, d, a);
    const Sign o4 = orient(c, d, b);
    // Proper crossing: c,d on opposite strict sides of ab AND a,b on opposite
    // strict sides of cd. (No ZERO allowed here — those are touch/collinear,
    // resolved by inserting the touching vertex during the split pass.)
    if (o1 != Sign::ZERO && o2 != Sign::ZERO && o3 != Sign::ZERO &&
        o4 != Sign::ZERO && o1 != o2 && o3 != o4) {
        // Compute meet point in double (classification above was exact).
        const double a1 = b.y - a.y, b1 = a.x - b.x;
        const double c1 = a1 * a.x + b1 * a.y;
        const double a2 = d.y - c.y, b2 = c.x - d.x;
        const double c2 = a2 * c.x + b2 * c.y;
        const double det = a1 * b2 - a2 * b1;
        if (det == 0.0) return false;  // numerically parallel; treat as no cross
        out.x = (b2 * c1 - b1 * c2) / det;
        out.y = (a1 * c2 - a2 * c1) / det;
        return finiteP(out);
    }
    return false;
}

} // namespace

// ===========================================================================
// Public free helpers
// ===========================================================================

double signedAreaOf(const std::vector<Point2>& r) {
    const std::size_t n = r.size();
    if (n < 3) return 0.0;
    double s = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        const Point2& a = r[i];
        const Point2& b = r[(i + 1) % n];
        s += a.x * b.y - b.x * a.y;
    }
    return 0.5 * s;
}

// Crossing-number point-in-ring with exact boundary classification.
// Returns +1 inside, 0 on boundary, -1 outside.
int pointInRing(const Point2& q, const std::vector<Point2>& ring) {
    const std::size_t n = ring.size();
    if (n < 3) return -1;
    // Boundary test first (exact): q on any edge?
    for (std::size_t i = 0; i < n; ++i) {
        const Point2& a = ring[i];
        const Point2& b = ring[(i + 1) % n];
        if (orient(a, b, q) == Sign::ZERO && onSegBox(a, q, b)) return 0;
    }
    // Crossing-number ray cast (ray to +x). Standard half-open edge rule.
    bool inside = false;
    for (std::size_t i = 0, j = n - 1; i < n; j = i++) {
        const Point2& a = ring[i];
        const Point2& b = ring[j];
        const bool cond = (a.y > q.y) != (b.y > q.y);
        if (cond) {
            const double xCross =
                (b.x - a.x) * (q.y - a.y) / (b.y - a.y) + a.x;
            if (q.x < xCross) inside = !inside;
        }
    }
    return inside ? +1 : -1;
}

// Even-odd point-in-region across all contours of a CrossSection. A region is
// "inside" if the point is inside an odd number of rings (outer adds, hole
// subtracts under even-odd). Returns +1 inside, 0 on boundary, -1 outside.
static int pointInRegion(const Point2& q, const std::vector<Contour>& cs) {
    int crossings = 0;
    for (const auto& c : cs) {
        const int r = pointInRing(q, c.pts);
        if (r == 0) return 0;          // on a boundary edge
        if (r == +1) ++crossings;      // inside this ring
    }
    return (crossings % 2 == 1) ? +1 : -1;
}

// ===========================================================================
// CrossSection: construction / queries / normalization
// ===========================================================================

CrossSection CrossSection::fromPolygon(const std::vector<Point2>& ccwOuter) {
    Contour c;
    c.pts = ccwOuter;
    CrossSection cs(std::vector<Contour>{std::move(c)});
    cs.normalize();
    return cs;
}

double CrossSection::area() const {
    double a = 0.0;
    for (const auto& c : contours_) a += signedAreaOf(c.pts);
    return a;
}

// Remove consecutive duplicate / collinear-redundant vertices from a ring.
static std::vector<Point2> cleanRing(const std::vector<Point2>& in) {
    std::vector<Point2> r;
    r.reserve(in.size());
    for (const auto& p : in) {
        if (r.empty() || !sameP(r.back(), p)) r.push_back(p);
    }
    if (r.size() >= 2 && sameP(r.front(), r.back())) r.pop_back();
    if (r.size() < 3) return {};
    // Drop spikes / exactly-collinear redundant middle vertices.
    bool changed = true;
    while (changed && r.size() >= 3) {
        changed = false;
        std::vector<Point2> out;
        out.reserve(r.size());
        const std::size_t n = r.size();
        for (std::size_t i = 0; i < n; ++i) {
            const Point2& prev = r[(i + n - 1) % n];
            const Point2& cur = r[i];
            const Point2& nxt = r[(i + 1) % n];
            if (orient(prev, cur, nxt) == Sign::ZERO) { changed = true; continue; }
            out.push_back(cur);
        }
        if (out.size() < 3) return {};
        r.swap(out);
    }
    return r;
}

void CrossSection::normalize() {
    // 1. Clean each ring; drop zero-area.
    std::vector<std::vector<Point2>> rings;
    for (auto& c : contours_) {
        auto cl = cleanRing(c.pts);
        if (cl.size() >= 3 && std::fabs(signedAreaOf(cl)) > 0.0) rings.push_back(std::move(cl));
    }
    // 2. Compute nesting depth of each ring (how many other rings contain it).
    //    Outer rings have even depth -> CCW; holes odd depth -> CW.
    //
    //    The rep point of ring i MUST lie just inside ring i's OWN boundary, NOT
    //    deep in its interior — otherwise for concentric rings (a hole nested in
    //    an outer) the outer's centroid can fall inside the inner ring and the
    //    depth parity inverts (the classic "centroid lands in the hole" bug).
    //    So we take an edge midpoint pulled inward by a tiny fraction of that
    //    edge's own length: that point is inside ring i but, for any other ring
    //    nested strictly inside the gap, lands outside it.
    const std::size_t m = rings.size();
    std::vector<Point2> reps(m);
    for (std::size_t i = 0; i < m; ++i) {
        const auto& R = rings[i];
        const std::size_t rn = R.size();
        Point2 rep = R[0];
        for (std::size_t k = 0; k < rn; ++k) {
            const Point2& a = R[k];
            const Point2& b = R[(k + 1) % rn];
            Point2 mid{(a.x + b.x) * 0.5, (a.y + b.y) * 0.5};
            double ex = b.x - a.x, ey = b.y - a.y;
            const double len = std::sqrt(ex * ex + ey * ey);
            if (len == 0) continue;
            // Inward normal candidates (both perpendiculars); pull in by a small
            // fraction of THIS edge so we stay close to ring i's boundary.
            const double step = len * 1e-4;
            double nx = -ey / len, ny = ex / len;
            Point2 t1{mid.x + nx * step, mid.y + ny * step};
            Point2 t2{mid.x - nx * step, mid.y - ny * step};
            if (pointInRing(t1, R) == +1) { rep = t1; break; }
            if (pointInRing(t2, R) == +1) { rep = t2; break; }
        }
        reps[i] = rep;
    }
    std::vector<int> depth(m, 0);
    for (std::size_t i = 0; i < m; ++i)
        for (std::size_t j = 0; j < m; ++j)
            if (i != j && pointInRing(reps[i], rings[j]) == +1) ++depth[i];

    // 3. Re-sign per parity and rebuild contour list.
    std::vector<Contour> out;
    out.reserve(m);
    for (std::size_t i = 0; i < m; ++i) {
        const bool wantCCW = (depth[i] % 2 == 0);  // outer
        double sa = signedAreaOf(rings[i]);
        const bool isCCW = sa > 0.0;
        if (isCCW != wantCCW) std::reverse(rings[i].begin(), rings[i].end());
        out.push_back(Contour{std::move(rings[i])});
    }
    contours_.swap(out);
}

// ===========================================================================
// Validity guard — reject self-intersecting operands honestly (envelope).
// ===========================================================================
namespace {

bool ringSimple(const std::vector<Point2>& r) {
    const std::size_t n = r.size();
    if (n < 3) return false;
    for (const auto& p : r) if (!finiteP(p)) return false;
    // O(n^2) proper-crossing check between non-adjacent edges.
    for (std::size_t i = 0; i < n; ++i) {
        const Point2& a0 = r[i];
        const Point2& a1 = r[(i + 1) % n];
        for (std::size_t j = i + 1; j < n; ++j) {
            // Skip adjacent / shared-vertex edge pairs.
            if (j == i) continue;
            if ((j + 1) % n == i || (i + 1) % n == j) continue;
            const Point2& b0 = r[j];
            const Point2& b1 = r[(j + 1) % n];
            Point2 ip;
            if (properCross(a0, a1, b0, b1, ip)) return false;
        }
    }
    return true;
}

bool regionSimple(const std::vector<Contour>& cs) {
    for (const auto& c : cs) if (!ringSimple(c.pts)) return false;
    return true;
}

} // namespace

// ===========================================================================
// Core arrangement clipper
// ===========================================================================
namespace {

enum class BoolOp { UNION, INTERSECT, DIFFERENCE };

// A directed edge in the working arrangement, tagged by which operand (A/B) it
// came from so the keep-rule can be applied per operand.
struct DEdge {
    Point2 p, q;
    int operand;  // 0 = A, 1 = B
};

// Split all edges of one operand at crossings with all edges of the other.
// Inserts split points (proper crossings + endpoint-on-edge touches) so every
// resulting sub-edge is interior-disjoint from the other operand's edges.
std::vector<Point2> splitParams(const Point2& p, const Point2& q,
                                const std::vector<std::pair<Point2, Point2>>& others) {
    // Collect split points as parameters t in (0,1) along p->q.
    std::vector<double> ts;
    const double dx = q.x - p.x, dy = q.y - p.y;
    const double len2 = dx * dx + dy * dy;
    auto paramOf = [&](const Point2& x) -> double {
        if (len2 == 0.0) return 0.0;
        return ((x.x - p.x) * dx + (x.y - p.y) * dy) / len2;
    };
    for (const auto& e : others) {
        const Point2& c = e.first;
        const Point2& d = e.second;
        Point2 ip;
        if (properCross(p, q, c, d, ip)) {
            ts.push_back(paramOf(ip));
            continue;
        }
        // Endpoint-on-edge touches: if c or d lies strictly inside p->q, split.
        if (orient(p, q, c) == Sign::ZERO && onSegBox(p, c, q) &&
            !sameP(c, p) && !sameP(c, q)) {
            ts.push_back(paramOf(c));
        }
        if (orient(p, q, d) == Sign::ZERO && onSegBox(p, d, q) &&
            !sameP(d, p) && !sameP(d, q)) {
            ts.push_back(paramOf(d));
        }
    }
    std::sort(ts.begin(), ts.end());
    std::vector<Point2> pts;
    pts.push_back(p);
    for (double t : ts) {
        if (t <= 1e-12 || t >= 1.0 - 1e-12) continue;
        Point2 x{p.x + t * dx, p.y + t * dy};
        if (!sameP(x, pts.back())) pts.push_back(x);
    }
    if (!sameP(q, pts.back())) pts.push_back(q);
    return pts;
}

// Welds a point onto an existing vertex from a master list if within eps,
// returning the canonical index. Builds a stable shared vertex set so coincident
// vertices from both operands collapse to one.
struct VertexWeld {
    std::vector<Point2> verts;
    int add(const Point2& p) {
        for (int i = 0; i < static_cast<int>(verts.size()); ++i)
            if (dist2(verts[i], p) <= kWeldEps * kWeldEps) return i;
        verts.push_back(p);
        return static_cast<int>(verts.size()) - 1;
    }
};

// Run one boolean op. Returns the stitched result; sets ok=false on a true
// unsupported case (self-intersecting input is rejected before calling here).
CrossSection runBoolean(const std::vector<Contour>& A,
                        const std::vector<Contour>& B,
                        BoolOp op, bool& ok) {
    ok = true;
    CrossSection result;

    // Gather all edges of B and A for cross-splitting.
    std::vector<std::pair<Point2, Point2>> edgesA, edgesB;
    auto gather = [](const std::vector<Contour>& cs,
                     std::vector<std::pair<Point2, Point2>>& out) {
        for (const auto& c : cs) {
            const std::size_t n = c.pts.size();
            for (std::size_t i = 0; i < n; ++i)
                out.emplace_back(c.pts[i], c.pts[(i + 1) % n]);
        }
    };
    gather(A, edgesA);
    gather(B, edgesB);

    // Build split sub-edges, tagged by operand.
    std::vector<DEdge> subs;
    auto emit = [&](const std::vector<Contour>& cs, int operand,
                    const std::vector<std::pair<Point2, Point2>>& others) {
        for (const auto& c : cs) {
            const std::size_t n = c.pts.size();
            for (std::size_t i = 0; i < n; ++i) {
                const Point2& p = c.pts[i];
                const Point2& q = c.pts[(i + 1) % n];
                auto chain = splitParams(p, q, others);
                for (std::size_t k = 0; k + 1 < chain.size(); ++k) {
                    if (!sameP(chain[k], chain[k + 1]))
                        subs.push_back(DEdge{chain[k], chain[k + 1], operand});
                }
            }
        }
    };
    emit(A, 0, edgesB);
    emit(B, 1, edgesA);

    // Keep rule per operand using midpoint classification.
    std::vector<DEdge> kept;
    for (const auto& e : subs) {
        Point2 mid{(e.p.x + e.q.x) * 0.5, (e.p.y + e.q.y) * 0.5};
        const std::vector<Contour>& other = (e.operand == 0) ? B : A;
        const int cls = pointInRegion(mid, other);  // +1 in,0 on,-1 out

        bool keep = false;
        bool reverse = false;
        if (cls == 0) {
            // Coincident edge (the sub-edge lies on the other boundary). Resolve
            // by the standard same-direction rule: keep ONE copy. We keep the
            // A-operand coincident edge for UNION/DIFFERENCE outer-merge and
            // drop the B duplicate; for INTERSECT keep A copy as well. This
            // prevents doubled shared borders. Only the A operand's coincident
            // edge is kept (and only when its outward side is consistent).
            keep = (e.operand == 0);
            // Determine if the coincident edge bounds the result: probe both
            // normal sides slightly off the edge.
            if (keep) {
                double nx = -(e.q.y - e.p.y), ny = (e.q.x - e.p.x);
                const double L = std::sqrt(nx * nx + ny * ny);
                if (L > 0) { nx /= L; ny /= L; }
                Point2 left{mid.x + nx * 1e-7, mid.y + ny * 1e-7};
                Point2 right{mid.x - nx * 1e-7, mid.y - ny * 1e-7};
                const int la = pointInRegion(left, A), lb = pointInRegion(left, B);
                const int ra = pointInRegion(right, A), rb = pointInRegion(right, B);
                auto inResult = [&](int ina, int inb) {
                    switch (op) {
                        case BoolOp::UNION:      return ina == +1 || inb == +1;
                        case BoolOp::INTERSECT:  return ina == +1 && inb == +1;
                        case BoolOp::DIFFERENCE: return ina == +1 && inb != +1;
                    }
                    return false;
                };
                const bool leftIn = inResult(la, lb);
                const bool rightIn = inResult(ra, rb);
                // The edge bounds the result iff exactly one side is inside.
                keep = (leftIn != rightIn);
                // Orient so the inside is on the LEFT of the directed edge.
                // For the directed edge p->q, left side is +normal direction.
                reverse = rightIn && !leftIn;
            }
        } else {
            switch (op) {
                case BoolOp::UNION:
                    keep = (cls == -1);   // sub-edge outside the other operand
                    break;
                case BoolOp::INTERSECT:
                    keep = (cls == +1);   // inside the other operand
                    break;
                case BoolOp::DIFFERENCE:
                    if (e.operand == 0) keep = (cls == -1);  // A outside B
                    else { keep = (cls == +1); reverse = true; }  // B inside A, flipped
                    break;
            }
        }
        if (keep) {
            DEdge ke = e;
            if (reverse) std::swap(ke.p, ke.q);
            kept.push_back(ke);
        }
    }

    if (kept.empty()) { ok = true; return result; }  // empty is a valid answer

    // Stitch kept directed edges head-to-tail into closed loops, welding
    // endpoints to a shared vertex set so coincident points connect.
    VertexWeld weld;
    struct IE { int a, b; bool used; };
    std::vector<IE> ies;
    ies.reserve(kept.size());
    for (const auto& e : kept) {
        int a = weld.add(e.p), b = weld.add(e.q);
        if (a != b) ies.push_back(IE{a, b, false});
    }
    // Adjacency: from each vertex, the outgoing edges.
    std::unordered_multimap<int, int> out;  // vertex -> edge index
    for (int i = 0; i < static_cast<int>(ies.size()); ++i)
        out.emplace(ies[i].a, i);

    std::vector<Contour> loops;
    for (int s = 0; s < static_cast<int>(ies.size()); ++s) {
        if (ies[s].used) continue;
        std::vector<Point2> ring;
        int cur = s;
        int guard = 0;
        const int maxSteps = static_cast<int>(ies.size()) + 5;
        bool closed = false;
        const int start = ies[s].a;
        while (cur >= 0 && !ies[cur].used && guard++ <= maxSteps) {
            ies[cur].used = true;
            ring.push_back(weld.verts[ies[cur].a]);
            const int nextV = ies[cur].b;
            if (nextV == start) { closed = true; break; }
            // Pick an unused outgoing edge from nextV.
            int chosen = -1;
            auto range = out.equal_range(nextV);
            for (auto it = range.first; it != range.second; ++it) {
                if (!ies[it->second].used) { chosen = it->second; break; }
            }
            cur = chosen;
        }
        if (closed && ring.size() >= 3) loops.push_back(Contour{std::move(ring)});
    }

    result = CrossSection(std::move(loops));
    result.normalize();
    return result;
}

} // namespace

// ===========================================================================
// Public boolean ops
// ===========================================================================

CrossSection CrossSection::unionWith(const CrossSection& other, bool& ok) const {
    if (!regionSimple(contours_) || !regionSimple(other.contours_)) {
        ok = false; return CrossSection();
    }
    return runBoolean(contours_, other.contours_, BoolOp::UNION, ok);
}

CrossSection CrossSection::intersectWith(const CrossSection& other, bool& ok) const {
    if (!regionSimple(contours_) || !regionSimple(other.contours_)) {
        ok = false; return CrossSection();
    }
    return runBoolean(contours_, other.contours_, BoolOp::INTERSECT, ok);
}

CrossSection CrossSection::differenceWith(const CrossSection& other, bool& ok) const {
    if (!regionSimple(contours_) || !regionSimple(other.contours_)) {
        ok = false; return CrossSection();
    }
    return runBoolean(contours_, other.contours_, BoolOp::DIFFERENCE, ok);
}

// ===========================================================================
// Offset (Minkowski sum with a disc)
// ===========================================================================
//
// For each directed edge of each ring, emit the edge pushed OUT along its
// outward normal by |delta| (outward = right of the directed edge for a CCW
// ring, since inside is on the left). Consecutive offset edges are joined with a
// MITER or ROUND join at each vertex. The raw offset polygons may self-overlap;
// they are cleaned by unioning all the resulting loops together via the boolean
// engine, which is exactly how Clipper/Manifold produce a clean offset.

CrossSection CrossSection::offset(double delta, JoinType join, bool& ok,
                                  int roundSegments, double miterLimit) const {
    ok = true;
    if (!regionSimple(contours_)) { ok = false; return CrossSection(); }
    if (delta == 0.0) { CrossSection c(contours_); c.normalize(); return c; }
    if (roundSegments < 4) roundSegments = 4;
    if (miterLimit < 1.0) miterLimit = 1.0;

    // Normalize a copy so outer=CCW, hole=CW; outward normal sign follows that.
    CrossSection base(contours_);
    base.normalize();

    const double r = std::fabs(delta);

    // Build one offset loop per input ring. A CCW outer ring with delta>0 grows
    // (offset along +outward normal); a CW hole grows the void the same way
    // (offset to the right of its direction), which our union/normalize handles.
    std::vector<Contour> pieces;

    for (const auto& c : base.contours()) {
        const std::vector<Point2>& ring = c.pts;
        const std::size_t n = ring.size();
        if (n < 3) continue;
        const double sa = signedAreaOf(ring);
        // sign of "outward" push for delta>0: for CCW ring outward is the RIGHT
        // normal of the directed edge; for CW ring (hole) the geometric outward
        // (into the solid) is the LEFT normal. We encode via the ring's winding
        // and the sign of delta: pushDir = (delta>0 ? +1 : -1) * (CCW? +1 : -1).
        const bool ccw = sa > 0.0;
        const double dirSign = (delta > 0 ? 1.0 : -1.0) * (ccw ? 1.0 : -1.0);

        std::vector<Point2> off;
        off.reserve(n * 3);

        for (std::size_t i = 0; i < n; ++i) {
            const Point2& prev = ring[(i + n - 1) % n];
            const Point2& cur = ring[i];
            const Point2& nxt = ring[(i + 1) % n];

            // Outward unit normals of the two incident edges (right normal of a
            // CCW-directed edge points outward).
            auto rightNormal = [](const Point2& a, const Point2& b) -> Point2 {
                double ex = b.x - a.x, ey = b.y - a.y;
                double L = std::sqrt(ex * ex + ey * ey);
                if (L == 0) return Point2{0, 0};
                // right normal of (ex,ey) is (ey,-ex)
                return Point2{ey / L, -ex / L};
            };
            Point2 nPrev = rightNormal(prev, cur);
            Point2 nNext = rightNormal(cur, nxt);
            nPrev.x *= dirSign; nPrev.y *= dirSign;
            nNext.x *= dirSign; nNext.y *= dirSign;

            // Offset positions of cur along each incident edge's outward normal.
            Point2 oPrev{cur.x + nPrev.x * r, cur.y + nPrev.y * r};
            Point2 oNext{cur.x + nNext.x * r, cur.y + nNext.y * r};

            // Turn direction at cur (exact). For a CCW ring an outward-convex
            // corner (where the offset edges spread apart and leave a gap to fill
            // on a GROW) is a left turn; for a CW ring the sense flips.
            const Sign turn = orient(prev, cur, nxt);
            const bool isCCWturn = (turn == Sign::POSITIVE);
            const bool convexCorner = ccw ? isCCWturn : (turn == Sign::NEGATIVE);
            const bool growing = (delta > 0);

            if (sameP(oPrev, oNext)) {  // straight-through (collinear) corner
                off.push_back(oPrev);
                continue;
            }

            // The miter APEX is the intersection of the two offset lines (each
            // offset edge extended). It is the correct single corner point
            // whenever the offset edges actually meet there — true for every
            // corner EXCEPT a convex corner on a GROW (where the apex juts out
            // past the miter limit and must be capped by a round arc or bevel)
            // and a reflex corner on a SHRINK (the symmetric case).
            Point2 dPrev{cur.x - prev.x, cur.y - prev.y};
            Point2 dNext{nxt.x - cur.x, nxt.y - cur.y};
            const double det = dPrev.x * (-dNext.y) - dPrev.y * (-dNext.x);
            bool haveApex = false;
            Point2 apex{};
            double miterLen = 0.0;
            if (std::fabs(det) > 1e-15) {
                const double rx = oNext.x - oPrev.x;
                const double ry = oNext.y - oPrev.y;
                const double s = (rx * (-dNext.y) - ry * (-dNext.x)) / det;
                apex = Point2{oPrev.x + s * dPrev.x, oPrev.y + s * dPrev.y};
                miterLen = std::sqrt(dist2(apex, cur));
                haveApex = finiteP(apex);
            }

            // A corner needs a "fill" (arc/bevel for ROUND, or bevel past the
            // miter limit for MITER) only when it is the spreading kind:
            // convex+grow or reflex+shrink.
            const bool spreading = (convexCorner == growing);

            if (!spreading) {
                // Concave/inner corner: the apex is the clean meet point. Emit it
                // (fall back to the two offsets if the lines were parallel). Any
                // residual self-overlap is removed by the union-clean below.
                if (haveApex) off.push_back(apex);
                else { off.push_back(oPrev); off.push_back(oNext); }
                continue;
            }

            // Spreading corner: ROUND fills with an arc; MITER uses the apex if
            // within the limit, else bevels.
            if (join == JoinType::ROUND) {
                off.push_back(oPrev);
                double a0 = std::atan2(oPrev.y - cur.y, oPrev.x - cur.x);
                double a1 = std::atan2(oNext.y - cur.y, oNext.x - cur.x);
                double da = a1 - a0;
                while (da <= -M_PI) da += 2 * M_PI;
                while (da > M_PI) da -= 2 * M_PI;
                const int steps =
                    std::max(1, (int)std::ceil(std::fabs(da) /
                                               (2 * M_PI / roundSegments)));
                for (int s = 1; s < steps; ++s) {
                    double a = a0 + da * (double(s) / steps);
                    off.push_back(Point2{cur.x + r * std::cos(a),
                                         cur.y + r * std::sin(a)});
                }
                off.push_back(oNext);
            } else {  // MITER
                if (haveApex && miterLen <= miterLimit * r) {
                    off.push_back(oPrev);
                    off.push_back(apex);
                    off.push_back(oNext);
                } else {  // bevel past the miter limit
                    off.push_back(oPrev);
                    off.push_back(oNext);
                }
            }
        }

        auto cleaned = cleanRing(off);
        if (cleaned.size() >= 3) pieces.push_back(Contour{std::move(cleaned)});
    }

    if (pieces.empty()) { return CrossSection(); }

    // Union all offset pieces together to remove self-overlap. Fold pairwise.
    CrossSection acc = CrossSection(std::vector<Contour>{pieces[0]});
    acc.normalize();
    for (std::size_t i = 1; i < pieces.size(); ++i) {
        CrossSection nxt = CrossSection(std::vector<Contour>{pieces[i]});
        nxt.normalize();
        bool uok = true;
        CrossSection merged = acc.unionWith(nxt, uok);
        if (uok) acc = merged;
        else {
            // Fallback: append the piece directly; normalize resolves nesting.
            auto all = acc.contours();
            for (auto& cc : pieces[i].pts.empty() ? std::vector<Contour>{}
                                                  : std::vector<Contour>{pieces[i]})
                all.push_back(cc);
            acc = CrossSection(std::move(all));
            acc.normalize();
        }
    }
    return acc;
}

} // namespace csg
} // namespace native
} // namespace forge
