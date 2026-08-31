// forge/native/geom/PolygonOffset2D.cpp
//
// Implementation of forge::native::geom::PolygonOffset2D — see the header for
// the contract, the validated area law, and the honest robustness posture.
//
// Pure C++20, standard library only. The COMBINATORIAL decisions (winding,
// self-intersection split, loop pruning) lean on forge::native::orient2d so a
// reflex notch cannot be mis-classified by rounding; the COORDINATE placement
// (edge displacement, arc tessellation) is plain double, as a construction.

#include "forge/native/geom/PolygonOffset2D.hpp"

// Explicit standard-header hygiene (libstdc++ on CI does not transitively pull
// these the way the Mac's libc++ does — name every header we actually use).
#include <algorithm>   // std::sort, std::min, std::max, std::reverse, std::find
#include <cmath>       // std::sqrt, std::atan2, std::cos, std::sin, std::ceil,
                       // std::fabs, std::hypot, std::isfinite, M_PI alt below
#include <cstddef>     // std::size_t
#include <cstdint>     // (kernel-wide integer vocabulary)
#include <limits>      // std::numeric_limits
#include <string>      // std::string
#include <utility>     // std::pair, std::move, std::swap
#include <vector>      // std::vector

namespace forge {
namespace native {
namespace geom {

namespace {

// pi without relying on the non-standard M_PI macro (which CI may not define).
constexpr double kPi = 3.14159265358979323846264338327950288;

struct V2 {
    double x{0.0};
    double y{0.0};
};

inline V2 sub(const V2& a, const V2& b) { return {a.x - b.x, a.y - b.y}; }
inline double dot(const V2& a, const V2& b) { return a.x * b.x + a.y * b.y; }
inline double cross(const V2& a, const V2& b) { return a.x * b.y - a.y * b.x; }
inline double len(const V2& a) { return std::hypot(a.x, a.y); }

inline bool finite2(const Point2& p) {
    return std::isfinite(p.x) && std::isfinite(p.y);
}

inline V2 toV2(const Point2& p) { return {p.x, p.y}; }

// Robust orientation sign of (a,b,c) via the kernel's exact predicate.
inline int orientSign(const Point2& a, const Point2& b, const Point2& c) {
    return signValue(orient2d(a.x, a.y, b.x, b.y, c.x, c.y));
}

// Twice the signed (shoelace) area of a ring (no repeated last vertex).
double shoelace2(const std::vector<Point2>& p) {
    const std::size_t n = p.size();
    if (n < 3) return 0.0;
    double s = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        const Point2& a = p[i];
        const Point2& b = p[(i + 1) % n];
        s += a.x * b.y - b.x * a.y;
    }
    return s;
}

// Squared distance between two points.
inline double dist2(const Point2& a, const Point2& b) {
    const double dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
}

// Strip consecutive duplicate / near-duplicate vertices from a ring. `tol2` is a
// squared distance threshold. Also drops a closing duplicate of the first.
std::vector<Point2> dedupRing(const std::vector<Point2>& in, double tol2) {
    std::vector<Point2> out;
    out.reserve(in.size());
    for (const Point2& q : in) {
        if (!out.empty() && dist2(out.back(), q) <= tol2) continue;
        out.push_back(q);
    }
    // close-the-loop duplicate
    while (out.size() >= 2 && dist2(out.front(), out.back()) <= tol2)
        out.pop_back();
    return out;
}

// The arc-chord tolerance this operation tessellates its own round joins to.
// One definition, read by rawOffset and by the sub-tolerance retry, so the two
// can never drift apart.
double arcToleranceFor(double signedDist, const OffsetOptions& opts) {
    double arcTol = opts.arcTolerance;
    if (!(arcTol > 0.0)) arcTol = std::max(1e-6, std::fabs(signedDist) * 1e-3);
    return arcTol;
}

// Remove the ring vertices that carry no geometry AT THIS TOLERANCE. This is
// the same class of degeneracy dedupRing already removes (a zero-LENGTH edge
// leaves the edge normal undefined; a zero-TURN vertex leaves the corner type --
// gap or overlap -- undefined, and the two offset lines meeting there then cross
// at a near-zero angle, which is the ill-conditioned intersection that breaks
// the arrangement in cleanRawLoop).
//
// THE BOUND IS GLOBAL, not per-vertex: this is the perpendicular-distance
// (Reumann-Witkam) simplification, so every REMOVED vertex lies within `tol` of
// the chord of the two vertices that were KEPT around it -- never within tol of
// its immediate neighbours in a ring that has already been thinned, which is how
// an iterated per-vertex filter silently drifts. The walk starts at the vertex
// of maximum chord deviation, which is therefore always retained, so the result
// does not depend on where index 0 happens to fall.
std::vector<Point2> dropSubToleranceVertices(const std::vector<Point2>& in, double tol) {
    const std::size_t n = in.size();
    if (n < 4 || !(tol > 0.0)) return in;

    // Anchor: the vertex that deviates most from its neighbours' chord. It is
    // the one this filter would never want to drop, so starting there makes the
    // result independent of the ring's arbitrary starting index.
    std::size_t anchor = 0;
    double best = -1.0;
    for (std::size_t i = 0; i < n; ++i) {
        const Point2& a = in[(i + n - 1) % n];
        const Point2& b = in[i];
        const Point2& c = in[(i + 1) % n];
        const double L = std::hypot(c.x - a.x, c.y - a.y);
        const double dev = (L > 0.0)
            ? std::fabs((c.x - a.x) * (a.y - b.y) - (a.x - b.x) * (c.y - a.y)) / L
            : 0.0;
        if (dev > best) { best = dev; anchor = i; }
    }

    // Perpendicular distance of q from the infinite line through (a,b).
    auto perp = [](const Point2& a, const Point2& b, const Point2& q) {
        const double dx = b.x - a.x, dy = b.y - a.y;
        const double L = std::hypot(dx, dy);
        if (L <= 0.0) return std::hypot(q.x - a.x, q.y - a.y);
        return std::fabs(dx * (a.y - q.y) - (a.x - q.x) * dy) / L;
    };

    std::vector<Point2> out;
    out.reserve(n);
    std::size_t kept = anchor;           // index of the last retained vertex
    out.push_back(in[anchor]);
    std::size_t consumed = 1;
    while (consumed < n) {
        // Extend the chord from `kept` as far as every skipped vertex stays
        // within tol of it.
        std::size_t take = 1;
        while (consumed + take < n) {
            const std::size_t cand = (kept + take + 1) % n;
            bool okAll = true;
            for (std::size_t m = 1; m <= take; ++m) {
                if (perp(in[kept], in[cand], in[(kept + m) % n]) > tol) { okAll = false; break; }
            }
            if (!okAll) break;
            ++take;
        }
        const std::size_t next = (kept + take) % n;
        out.push_back(in[next]);
        consumed += take;
        kept = next;
    }
    // The walk emits the anchor once and then every retained vertex; the last
    // one may coincide with the anchor when the final run swallowed the wrap.
    if (out.size() >= 2 && out.front().x == out.back().x && out.front().y == out.back().y)
        out.pop_back();
    if (out.size() < 3) return in;       // never hand back a degenerate ring
    return out;
}

} // namespace

// ---------------------------------------------------------------------------
// Loop2 / Polygon2 / OffsetResult small members
// ---------------------------------------------------------------------------
double Loop2::signedArea2() const { return shoelace2(pts); }

double Polygon2::netArea() const {
    double a = outer.signedArea();
    for (const Loop2& h : holes) a += h.signedArea();
    return a;
}

double OffsetResult::netArea() const {
    double a = 0.0;
    for (const Loop2& l : loops) a += l.signedArea();
    return a;
}

// ---------------------------------------------------------------------------
// Robust winding number of `loop` about `q` (ray-crossing via orient2d).
//
// Classic Dan Sunday winding number, but every "is q left/right of edge" test
// that decides a crossing is taken from the EXACT orient2d sign, so the parity
// can never flip due to rounding on a near-grazing edge.
// ---------------------------------------------------------------------------
int PolygonOffset2D::windingNumber(const Loop2& loop, const Point2& q) {
    const std::vector<Point2>& p = loop.pts;
    const std::size_t n = p.size();
    if (n < 3) return 0;
    int wn = 0;
    for (std::size_t i = 0; i < n; ++i) {
        const Point2& a = p[i];
        const Point2& b = p[(i + 1) % n];
        if (a.y <= q.y) {
            if (b.y > q.y) {                       // upward crossing
                if (orientSign(a, b, q) > 0) ++wn; // q strictly left of a->b
            }
        } else {
            if (b.y <= q.y) {                      // downward crossing
                if (orientSign(a, b, q) < 0) --wn; // q strictly right of a->b
            }
        }
    }
    return wn;
}

// ---------------------------------------------------------------------------
// rawOffset — per-edge displacement + corner joins, BEFORE cleanup.
//
// `signedDist` > 0 expands the region enclosed by the loop along its OWN
// orientation; < 0 shrinks it. We work in the loop's given orientation:
//   - CCW loop, signedDist>0 : edges pushed to the RIGHT of travel (outward),
//     CONVEX (left-turn) corners open a gap that is filled with an arc / miter,
//     REFLEX (right-turn) corners overlap (removed in cleanup).
//   - The same code is orientation-correct for a CW loop because it derives the
//     turn sign from orient2d on the actual vertices.
//
// For a convex corner the arc is centered at the ORIGINAL vertex with radius
// |signedDist|, swept from the incoming edge's offset endpoint to the outgoing
// edge's offset start; it is tessellated so the chord sagitta <= arcTolerance.
// For a reflex corner we simply join the two offset edge-endpoints with a
// segment (the overlap they create is pruned later) — this is the standard
// Clipper "square the inner corner then clean" behaviour and keeps the raw ring
// a single closed polyline.
// ---------------------------------------------------------------------------
Loop2 PolygonOffset2D::rawOffset(const Loop2& loop, double signedDist,
                                 const OffsetOptions& opts) {
    Loop2 out;
    const std::vector<Point2>& p = loop.pts;
    const std::size_t n = p.size();
    if (n < 3) return out;

    const double d = signedDist;
    const double absd = std::fabs(d);

    // Orientation of the source loop: +1 CCW, -1 CW. For a CCW loop, the outward
    // (area-growing for d>0) normal of edge e=(p1-p0) is the RIGHT normal
    // (e.y, -e.x); for a CW loop it is the LEFT normal. We fold that into a sign.
    const double area2 = shoelace2(p);
    const double orientSignF = (area2 >= 0.0) ? 1.0 : -1.0;
    // Displacement sense: a CCW loop grown by d>0 moves edges along +(e.y,-e.x).
    // A CW loop grown by d>0 moves edges along -(e.y,-e.x). So scale by
    // orientSignF: dispDir = orientSignF * (e.y,-e.x)/|e| * d.
    const double sgn = orientSignF;

    const double arcTol = arcToleranceFor(d, opts);

    // Per-edge offset endpoints: edge i is p[i]->p[i+1], offset by its own normal.
    struct OffEdge { Point2 a, b; V2 dir; };
    std::vector<OffEdge> oe;
    oe.reserve(n);
    for (std::size_t i = 0; i < n; ++i) {
        const Point2& A = p[i];
        const Point2& B = p[(i + 1) % n];
        V2 e = sub(toV2(B), toV2(A));
        double L = len(e);
        if (L <= 0.0) continue;            // zero-length edge: skip (deduped upstream)
        V2 u = {e.x / L, e.y / L};
        // right-normal of travel = (u.y, -u.x); scaled by sgn*d.
        V2 nrm = {u.y * sgn * d, -u.x * sgn * d};
        OffEdge o;
        o.a = Point2{A.x + nrm.x, A.y + nrm.y};
        o.b = Point2{B.x + nrm.x, B.y + nrm.y};
        o.dir = u;
        oe.push_back(o);
    }
    const std::size_t m = oe.size();
    if (m < 3) return out;

    out.pts.reserve(m * 2);
    for (std::size_t i = 0; i < m; ++i) {
        const OffEdge& cur = oe[i];
        const OffEdge& nxt = oe[(i + 1) % m];

        // Emit the offset endpoint of the current edge.
        out.pts.push_back(cur.a);
        out.pts.push_back(cur.b);

        // The original shared vertex between cur and nxt is p[(i+1)%n]'s position;
        // recover it from cur.b minus its normal so corner geometry is exact.
        // The shared vertex V is the un-offset point both edges meet at.
        // cur goes ...->V, nxt goes V->...  We reconstruct V from cur:
        //   V = cur.b - normal_cur. But we only stored the offset; recompute from p.
        // Find V directly: it's p[(i+1) % n] — but indices into p and oe differ if
        // any zero-length edge was skipped. To stay correct we instead derive the
        // corner type from the offset directions, and place the arc center at the
        // intersection-free original corner reconstructed below.

        // Does an angular GAP open at this corner (needing an arc to fill it), or
        // does the offset OVERLAP here (handled by the cleanup's trim)?
        //
        // A gap opens iff the corner turns the SAME way the offset pushes. The
        // displacement of each edge is along sgn*d*(dir.y,-dir.x); the corner turn
        // is cross(cur.dir, nxt.dir). The invariant gap test is therefore
        //   cross(cur.dir, nxt.dir) * sgn * d > 0
        // which is true for an OUTWARD (d>0) convex corner of either winding AND
        // for an INWARD (d<0) reflex corner — exactly the cases where the two
        // offset edges diverge and leave a circular gap. The OTHER cases
        // (outward reflex, inward convex) overlap and are trimmed in cleanup, so
        // we add NO arc and let the offset edges cross.
        const double gap = cross(cur.dir, nxt.dir) * sgn * d;
        // gap > 0 : divergent corner -> fill with arc.
        // gap <= 0 : convergent / collinear -> straight bridge, trimmed later.

        if (absd <= 0.0) continue;

        // Scale-relative threshold so near-collinear corners add no degenerate arc.
        if (gap > 1e-15 * absd) {
            // Reconstruct the original corner vertex V = endpoint of cur in the
            // ORIGINAL polygon. cur.b is V displaced by cur's normal; the normal
            // is perpendicular to cur.dir with length absd. So:
            V2 nrmCur = {cur.dir.y * sgn * d, -cur.dir.x * sgn * d};
            Point2 V{cur.b.x - nrmCur.x, cur.b.y - nrmCur.y};

            // Arc from cur.b to nxt.a, center V, radius absd.
            V2 v0 = sub(toV2(cur.b), toV2(V));
            V2 v1 = sub(toV2(nxt.a), toV2(V));
            double a0 = std::atan2(v0.y, v0.x);
            double a1 = std::atan2(v1.y, v1.x);
            // Sweep in the direction matching the growth orientation.
            // For sgn>0 (CCW grown / CW grown likewise via sgn) the gap is swept
            // CCW when sgn>0... fold orientation: positive sweep = CCW.
            double sweep = a1 - a0;
            // Choose the SHORT convex sweep (|sweep| < pi). Normalize to (-pi,pi].
            while (sweep <= -kPi) sweep += 2.0 * kPi;
            while (sweep > kPi)   sweep -= 2.0 * kPi;
            // Number of segments so chord sagitta <= arcTol:
            //   sagitta = r*(1-cos(half-step)) <= arcTol.
            int steps = 1;
            {
                double maxStep;
                if (arcTol >= absd) {
                    maxStep = kPi;        // tolerance looser than radius: 1 seg ok
                } else {
                    maxStep = 2.0 * std::acos(1.0 - arcTol / absd);
                }
                if (maxStep <= 0.0) maxStep = kPi;
                steps = static_cast<int>(std::ceil(std::fabs(sweep) / maxStep));
                if (steps < 1) steps = 1;
            }
            for (int k = 1; k < steps; ++k) {
                double t = static_cast<double>(k) / static_cast<double>(steps);
                double ang = a0 + sweep * t;
                out.pts.push_back(Point2{V.x + absd * std::cos(ang),
                                         V.y + absd * std::sin(ang)});
            }
            // nxt.a is pushed at the top of the next iteration.
        }
        // reflex / collinear: straight bridge cur.b -> nxt.a is implicit (nxt.a is
        // emitted next iteration); the spurious overlap is removed in cleanup.
    }

    // De-duplicate the assembled raw ring.
    double tol2 = std::max(1e-18, (absd * 1e-9) * (absd * 1e-9));
    out.pts = dedupRing(out.pts, tol2);
    return out;
}

// ---------------------------------------------------------------------------
// cleanRawLoop — turn a (possibly self-intersecting) raw ring into clean,
// non-self-intersecting, correctly-oriented simple loops, pruning the invalid
// ones (the overlap that reflex corners / inward collapse produce).
//
// METHOD (the standard non-zero-winding region extraction, made robust with the
// kernel's exact orient2d):
//   1. Split the raw ring's segments at every mutual intersection point, keeping
//      each fragment's DIRECTION (the raw ring is a directed closed curve).
//   2. Build a tiny DCEL: snap fragment endpoints to shared nodes; at each node
//      collect the outgoing directed half-edges sorted by angle. Trace FACES by
//      following, at each arrival, the next outgoing half-edge in clockwise order
//      (this enumerates every minimal face of the planar arrangement exactly
//      once). Termination is guaranteed: each directed half-edge is consumed by
//      exactly one face.
//   3. For each traced face, sample an interior point (robustly, off any vertex)
//      and take its winding number against the SOURCE-ORIENTED raw ring. Keep
//      the face iff that winding has the EXPECTED sign and magnitude >= 1 (the
//      non-zero rule restricted to the offset's orientation). A reflex-corner
//      overlap lobe gets winding 0 (or wrong sign) and is dropped; a collapsed
//      inward offset leaves NO face with the right winding -> droppedAll.
//
// This is exact in its combinatorial core (which faces survive) because both the
// face tracing turn-order and the winding test are decided by orient2d signs;
// only the coordinates of the intersection vertices are plain double.
// ---------------------------------------------------------------------------
std::vector<Loop2> PolygonOffset2D::cleanRawLoop(const Loop2& raw,
                                                 double expectedSign,
                                                 bool& droppedAll) {
    droppedAll = false;
    std::vector<Loop2> result;

    std::vector<Point2> ring = raw.pts;
    const std::size_t n0 = ring.size();
    if (n0 < 3) { droppedAll = true; return result; }

    // Characteristic length for snap / split tolerances, from the ring extent.
    double minx = ring[0].x, maxx = minx, miny = ring[0].y, maxy = miny;
    for (const Point2& q : ring) {
        minx = std::min(minx, q.x); maxx = std::max(maxx, q.x);
        miny = std::min(miny, q.y); maxy = std::max(maxy, q.y);
    }
    const double ext = std::max(maxx - minx, maxy - miny);
    const double snapDist = std::max(1e-12, ext * 1e-9);
    const double snap2 = snapDist * snapDist;

    // --- 1. Split the directed ring at every mutual proper crossing. ----------
    struct Seg { Point2 a, b; };
    std::vector<Seg> segs;
    segs.reserve(n0);
    for (std::size_t i = 0; i < n0; ++i)
        segs.push_back({ring[i], ring[(i + 1) % n0]});

    std::vector<std::vector<std::pair<double, Point2>>> splits(segs.size());
    auto paramOnSeg = [](const Point2& a, const Point2& b, const Point2& q) {
        V2 ab = sub(toV2(b), toV2(a));
        double L2 = dot(ab, ab);
        if (L2 <= 0.0) return 0.0;
        V2 aq = sub(toV2(q), toV2(a));
        return dot(aq, ab) / L2;
    };
    for (std::size_t i = 0; i < segs.size(); ++i) {
        for (std::size_t j = i + 1; j < segs.size(); ++j) {
            // NOTE: we do NOT skip index-adjacent segments. After offsetting, two
            // consecutive raw-offset edges of a REFLEX corner genuinely CROSS at
            // the trimmed inner corner (they no longer share an endpoint), and
            // that crossing is exactly what clips the over-long offset edges. A
            // pair that truly shares an endpoint classifies as ENDPOINT_TOUCH (not
            // PROPER_CROSS) and the param guard below excludes near-endpoint hits,
            // so removing the adjacency skip is safe and necessary.
            SegIntersection si = segmentIntersect(segs[i].a, segs[i].b,
                                                  segs[j].a, segs[j].b);
            if (si.relation == SegRelation::PROPER_CROSS) {
                const Point2& X = si.point;
                double ti = paramOnSeg(segs[i].a, segs[i].b, X);
                double tj = paramOnSeg(segs[j].a, segs[j].b, X);
                if (ti > 1e-9 && ti < 1.0 - 1e-9) splits[i].push_back({ti, X});
                if (tj > 1e-9 && tj < 1.0 - 1e-9) splits[j].push_back({tj, X});
            }
        }
    }

    // Refined directed polyline (still a single closed curve, now with explicit
    // vertices at every crossing).
    std::vector<Point2> refined;
    refined.reserve(n0 * 2);
    for (std::size_t i = 0; i < segs.size(); ++i) {
        refined.push_back(segs[i].a);
        auto& sp = splits[i];
        std::sort(sp.begin(), sp.end(),
                  [](const std::pair<double, Point2>& A,
                     const std::pair<double, Point2>& B) { return A.first < B.first; });
        for (auto& s : sp) refined.push_back(s.second);
    }
    refined = dedupRing(refined, snap2);
    const std::size_t R = refined.size();
    if (R < 3) { droppedAll = true; return result; }

    // The closed source-oriented winding reference is `refined` itself.
    Loop2 rawClosed; rawClosed.pts = refined;

    // --- 2. Build the DCEL: nodes + directed half-edges. ----------------------
    std::vector<Point2> nodes;
    auto nodeOf = [&](const Point2& q) -> int {
        for (std::size_t k = 0; k < nodes.size(); ++k)
            if (dist2(nodes[k], q) <= snap2) return static_cast<int>(k);
        nodes.push_back(q);
        return static_cast<int>(nodes.size()) - 1;
    };
    std::vector<int> nid(R);
    for (std::size_t i = 0; i < R; ++i) nid[i] = nodeOf(refined[i]);

    // --- 2b. Excise the closed sub-chains this arrangement CANNOT RESOLVE. ----
    // A convergent corner (an inward offset of a convex vertex) makes the raw
    // ring double back: the current edge's offset end P overshoots the corner,
    // the next edge's offset start Q sits before it, and the crossing X of the
    // two offset lines splits the ring into the closed sub-chain X -> P -> Q -> X.
    // At a well-conditioned corner that sub-chain is the overshoot TRIANGLE and
    // the winding test in step 3 prunes it correctly. When the corner's turn is
    // microradians -- which is what a ring sampled off a near-straight spline is
    // made of -- X, P and Q become COLLINEAR and the sub-chain encloses nothing:
    // its three sub-edges then all lie ON the region's true boundary, each is
    // independently classified as a boundary edge, and the SAME piece of that
    // boundary is emitted three times with inconsistent orientations. That is
    // exactly what leaves the kept set unbalanced (measured: on ho13 all 14
    // unbalanced nodes, in 7 pairs of in=2/out=0 and in=0/out=2, are the interior
    // vertices of 7 such sub-chains, and every chain walk then dead-ends).
    //
    // THE TEST IS THIS ARRANGEMENT'S OWN RESOLUTION, not a new constant: a closed
    // sub-chain is unresolvable iff EVERY one of its vertices lies within
    // `snapDist` of one straight line -- the very distance at which nodeOf above
    // already welds two points into ONE node. A chain that flat cannot separate
    // any two points this arrangement can tell apart, so it adds ZERO to the
    // winding number everywhere that matters, and dropping its sub-edges removes
    // only the duplicated boundary -- the two long edges that meet at X still
    // carry it. Flatness, not signed area, is the test on purpose: a figure-eight
    // sub-chain has |signed area| ~ 0 with real geometry on both lobes, and an
    // area test would excise it. Flatness cannot cancel.
    //
    // MEASURED on the four failing arrangements: the flattest NON-flat chain is
    // 987x ABOVE snapDist and the least flat excised chain is 134x BELOW it, so
    // the band the threshold sits in is empty over five orders of magnitude.
    //
    // `rawClosed` is deliberately NOT rebuilt: the region {winding == expectedSign}
    // stays bit-for-bit the one this function has always extracted, and the only
    // thing that changes is which sub-edges are offered to step 3 as candidates.
    std::vector<int> ringNid = nid;
    {
        std::vector<int> occ(nodes.size(), 0);
        for (std::size_t i = 0; i < R; ++i) ++occ[nid[i]];
        // Start the walk at a node visited exactly once, so no sub-chain can
        // straddle the seam. If every node repeats, leave the ring untouched.
        std::size_t start = R;
        for (std::size_t i = 0; i < R; ++i) if (occ[nid[i]] == 1) { start = i; break; }
        if (start < R) {
            std::vector<Point2> keepPt;
            std::vector<int>    keepNid;
            keepPt.reserve(R);
            keepNid.reserve(R);
            std::vector<int> lastAt(nodes.size(), -1);
            for (std::size_t t = 0; t < R; ++t) {
                const std::size_t i = (start + t) % R;
                const int nd = nid[i];
                const int j  = lastAt[nd];
                const int m  = (j >= 0) ? static_cast<int>(keepPt.size()) - j : 0;
                if (j >= 0 && m >= 2) {
                    // Max perpendicular deviation of the chain from the line
                    // through its two extreme vertices (the standard two-pass
                    // diameter walk: farthest from the first, then farthest from
                    // that). A zero-extent chain is flat by definition. The walk
                    // only APPROXIMATES the diameter, and it errs the safe way:
                    // a shorter chord divides the deviations by less, so the
                    // chain looks LESS flat and is kept, never wrongly excised.
                    const Point2* base = &keepPt[static_cast<std::size_t>(j)];
                    const Point2* endA = base;
                    for (int k = 1; k < m; ++k)
                        if (dist2(base[k], *base) > dist2(*endA, *base)) endA = base + k;
                    const Point2* endB = base;
                    for (int k = 0; k < m; ++k)
                        if (dist2(base[k], *endA) > dist2(*endB, *endA)) endB = base + k;
                    const double ux = endB->x - endA->x, uy = endB->y - endA->y;
                    const double span = std::hypot(ux, uy);
                    double flat = 0.0;
                    if (span > 0.0)
                        for (int k = 0; k < m; ++k)
                            flat = std::max(flat,
                                            std::fabs((base[k].x - endA->x) * uy -
                                                      (base[k].y - endA->y) * ux) / span);
                    if (flat <= snapDist) {
                        for (std::size_t k = static_cast<std::size_t>(j) + 1;
                             k < keepNid.size(); ++k)
                            if (lastAt[keepNid[k]] >= j + 1) lastAt[keepNid[k]] = -1;
                        keepPt.resize(static_cast<std::size_t>(j) + 1);
                        keepNid.resize(static_cast<std::size_t>(j) + 1);
                        continue;            // node nd already sits at keepPt[j]
                    }
                }
                lastAt[nd] = static_cast<int>(keepPt.size());
                keepPt.push_back(refined[i]);
                keepNid.push_back(nd);
            }
            // Fewer than 3 nodes left means the WHOLE ring was flat. That is a
            // real collapse, but reporting it from here would be a new failure
            // mode; the un-excised ring is handed on instead, so such an input
            // fails exactly the way it always did.
            if (keepNid.size() >= 3) ringNid = std::move(keepNid);
        }
    }
    const std::size_t Rr = ringNid.size();

    // Directed half-edges of the closed curve: he k goes ringNid[k] -> ringNid[k+1].
    struct HEdge { int from; int to; };
    std::vector<HEdge> he;
    he.reserve(Rr);
    for (std::size_t i = 0; i < Rr; ++i) {
        int a = ringNid[i];
        int b = ringNid[(i + 1) % Rr];
        if (a == b) continue;                          // degenerate (snapped) edge
        he.push_back({a, b});
    }
    const std::size_t H = he.size();
    if (H < 3) { droppedAll = true; return result; }

    // --- 3. Classify each directed sub-edge by the WINDING on its two sides. ---
    // The kept region is { x : winding(rawClosed, x) has expectedSign, |w|>=1 }.
    // A directed sub-edge a->b is a BOUNDARY edge of that region iff exactly one
    // of its two flanks (a tiny step to the left / right of the edge midpoint) is
    // inside. We emit it oriented so the INSIDE lies on its LEFT — i.e. CCW for a
    // positive region, CW for a negative one — which makes the chained loops come
    // out with the expected orientation directly. A dangling spur edge (both
    // flanks the SAME) is dropped here, which is exactly why this is immune to the
    // raw-corner overhangs that a naive face trace would absorb.
    auto insideW = [&](int w) {
        return (expectedSign > 0) ? (w >= 1) : (w <= -1);
    };

    struct KEdge { int from, to; };
    std::vector<KEdge> kept;
    kept.reserve(H);
    for (std::size_t k = 0; k < H; ++k) {
        const Point2& A = nodes[he[k].from];
        const Point2& B = nodes[he[k].to];
        V2 e = sub(toV2(B), toV2(A));
        double L = len(e);
        if (L <= 0.0) continue;
        Point2 mid{(A.x + B.x) * 0.5, (A.y + B.y) * 0.5};
        V2 leftN  = {-e.y / L, e.x / L};                 // left normal of a->b
        double eps = std::max(snapDist, L * 1e-6);
        Point2 pl{mid.x + leftN.x * eps, mid.y + leftN.y * eps};
        Point2 pr{mid.x - leftN.x * eps, mid.y - leftN.y * eps};
        bool inL = insideW(windingNumber(rawClosed, pl));
        bool inR = insideW(windingNumber(rawClosed, pr));
        if (inL == inR) continue;                        // not a region boundary
        if (inL) kept.push_back({he[k].from, he[k].to}); // inside already on left
        else     kept.push_back({he[k].to, he[k].from}); // flip so inside is left
    }
    if (kept.empty()) { droppedAll = true; return result; }

    // --- 4. Chain the kept directed edges into closed loops. ------------------
    // At each node, gather kept out-edges. Since the boundary is a set of simple
    // closed curves, each node has matched in/out degree; we walk, consuming an
    // out-edge per visit. A small angular tie-break (turn most sharply left, i.e.
    // hug the inside) keeps nested boundaries from cross-linking.
    std::vector<std::vector<int>> koutAt(nodes.size());
    for (std::size_t k = 0; k < kept.size(); ++k)
        koutAt[kept[k].from].push_back(static_cast<int>(k));
    std::vector<char> kused(kept.size(), 0);

    auto edgeAngle = [&](int ke) {
        V2 d = sub(toV2(nodes[kept[ke].to]), toV2(nodes[kept[ke].from]));
        return std::atan2(d.y, d.x);
    };

    for (std::size_t s = 0; s < kept.size(); ++s) {
        if (kused[s]) continue;
        std::vector<Point2> loop;
        const int startNode = kept[s].from;
        int cur = static_cast<int>(s);
        std::size_t guard = 0;
        bool ok = true;
        for (;;) {
            kused[cur] = 1;
            loop.push_back(nodes[kept[cur].from]);
            int v = kept[cur].to;
            if (v == startNode) break;                    // loop closed cleanly
            // choose the next unused out-edge at v that turns most sharply LEFT
            // relative to the incoming direction (keeps interior on the left).
            double inAng = edgeAngle(cur);
            int pick = -1; double bestTurn = -1e300;
            for (int oe : koutAt[v]) {
                if (kused[oe]) continue;
                double outAng = edgeAngle(oe);
                double turn = outAng - (inAng + kPi);     // 0 == straight through
                while (turn <= -kPi) turn += 2.0 * kPi;
                while (turn > kPi)   turn -= 2.0 * kPi;
                if (turn > bestTurn) { bestTurn = turn; pick = oe; }
            }
            if (pick < 0) { ok = false; break; }
            cur = pick;
            if (++guard > kept.size() + 4) { ok = false; break; }
        }
        if (ok && loop.size() >= 3) {
            Loop2 out; out.pts = dedupRing(loop, snap2);
            if (out.pts.size() < 3) continue;
            double a2 = shoelace2(out.pts);
            if (std::fabs(a2) < snap2 * 4.0) continue;    // sliver
            // Ensure expected orientation (chaining already targets it).
            double sgnA = (a2 >= 0 ? 1.0 : -1.0);
            if (sgnA != expectedSign) std::reverse(out.pts.begin(), out.pts.end());
            result.push_back(std::move(out));
        }
    }

    if (result.empty()) droppedAll = true;
    return result;
}

// ---------------------------------------------------------------------------
// offsetLoop — public entry for a single loop.
// ---------------------------------------------------------------------------
OffsetResult PolygonOffset2D::offsetLoop(const Loop2& loop, double d,
                                         const OffsetOptions& opts) {
    OffsetResult res;

    // --- validate input (0 FAKES: refuse degenerate / non-finite honestly) ---
    if (!std::isfinite(d)) { res.reason = "offset distance not finite"; return res; }
    if (opts.miterLimit < 1.0) { res.reason = "miterLimit must be >= 1"; return res; }
    if (loop.pts.size() < 3) { res.reason = "loop has fewer than 3 vertices"; return res; }
    for (const Point2& q : loop.pts)
        if (!finite2(q)) { res.reason = "non-finite vertex"; return res; }

    // Dedup the source ring; a zero-length edge would make a normal undefined.
    double srcTol2 = 0.0;
    {
        // tolerance scaled to the loop's extent
        double minx = loop.pts[0].x, maxx = minx, miny = loop.pts[0].y, maxy = miny;
        for (const Point2& q : loop.pts) {
            minx = std::min(minx, q.x); maxx = std::max(maxx, q.x);
            miny = std::min(miny, q.y); maxy = std::max(maxy, q.y);
        }
        double ext = std::max(maxx - minx, maxy - miny);
        srcTol2 = std::max(1e-20, (ext * 1e-12) * (ext * 1e-12));
    }
    Loop2 src; src.pts = dedupRing(loop.pts, srcTol2);
    if (src.pts.size() < 3) { res.reason = "loop degenerate after dedup (collinear/zero-area)"; return res; }
    if (shoelace2(src.pts) == 0.0) { res.reason = "loop has zero area (degenerate)"; return res; }

    if (d == 0.0) {                       // identity offset: return the source ring
        res.ok = true;
        res.loops.push_back(src);
        return res;
    }

    // ONE attempt = raw displacement + arrangement cleanup. Returns false for
    // the two collapse conditions, which are byte-for-byte the ones this
    // function has always reported: a raw ring under 3 vertices, and a cleanup
    // that kept nothing.
    auto attempt = [&opts, d](const Loop2& ring, std::vector<Loop2>& out) -> bool {
        out.clear();
        Loop2 raw = rawOffset(ring, d, opts);
        if (raw.pts.size() < 3) return false;
        // The offset preserves orientation: every surviving loop must carry the
        // SOURCE loop's orientation sign. (An inward offset only shrinks the
        // region until the feature collapses; it never inverts a surviving loop.)
        const double expectedSign = (shoelace2(ring.pts) >= 0.0) ? 1.0 : -1.0;
        bool droppedAll = false;
        out = cleanRawLoop(raw, expectedSign, droppedAll);
        if (droppedAll || out.empty()) { out.clear(); return false; }
        return true;
    };

    std::vector<Loop2> clean;
    if (attempt(src, clean)) {
        res.ok = true;
        res.loops = std::move(clean);
        return res;
    }

    // COLLAPSE PATH ONLY — see the header's SUB-TOLERANCE RETRY note. Reached
    // only when the line above already failed, so no input that succeeds can
    // reach it and no succeeding answer can change.
    Loop2 relaxed;
    relaxed.pts = dropSubToleranceVertices(src.pts, arcToleranceFor(d, opts));
    if (relaxed.pts.size() >= 3 && relaxed.pts.size() < src.pts.size() &&
        shoelace2(relaxed.pts) != 0.0 && attempt(relaxed, clean)) {
        res.ok = true;
        res.loops = std::move(clean);
        res.relaxedCollinear = true;
        return res;
    }

    res.ok = true;
    res.droppedLoops = 1;
    res.reason = "loop collapsed under inward offset";
    return res;
}

// ---------------------------------------------------------------------------
// offsetPolygon — outer + holes. d>0 grows the solid, d<0 shrinks it.
// ---------------------------------------------------------------------------
OffsetResult PolygonOffset2D::offsetPolygon(const Polygon2& poly, double d,
                                            const OffsetOptions& opts) {
    OffsetResult res;
    if (!std::isfinite(d)) { res.reason = "offset distance not finite"; return res; }

    // Offset the outer loop by +d (grow along its CCW orientation when d>0).
    OffsetResult outerR = offsetLoop(poly.outer, d, opts);
    if (!outerR.ok) { res.reason = "outer: " + outerR.reason; return res; }
    res.droppedLoops += outerR.droppedLoops;
    for (Loop2& l : outerR.loops) res.loops.push_back(std::move(l));

    // Each CW hole is grown along ITS orientation by +d when d>0 means the SOLID
    // grows, which SHRINKS the hole. A CW loop with the same signed `d` in
    // offsetLoop expands along the CW (negative) orientation — i.e. the hole's
    // void grows. We want the void to SHRINK when the solid grows, so the hole is
    // offset by -d in its own-orientation sense. offsetLoop already folds the
    // orientation sign, so passing -d to a CW hole shrinks the void as required.
    for (const Loop2& hole : poly.holes) {
        OffsetResult hr = offsetLoop(hole, -d, opts);
        if (!hr.ok) { res.reason = "hole: " + hr.reason; res.ok = false; res.loops.clear(); return res; }
        res.droppedLoops += hr.droppedLoops;     // a shrunk-away hole is dropped honestly
        for (Loop2& l : hr.loops) res.loops.push_back(std::move(l));
    }

    res.ok = true;
    return res;
}

} // namespace geom
} // namespace native
} // namespace forge
