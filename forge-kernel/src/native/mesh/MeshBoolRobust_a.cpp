// forge/native/mesh/MeshBoolRobust_a.cpp
//
// ROBUST GENERAL mesh boolean — VARIANT A. See MeshBoolRobust_a.hpp for the
// honest scope + the CORE FIX (a GLOBAL shared intersection-vertex map keyed on
// the (mesh-edge, face-plane) provenance of every cut point, so A's cut and B's
// cut land on the SAME vertex ids → identical shared polyline → manifold).
//
// NEW file. Modifies nothing committed. Unique symbol meshBoolRobust_a.
// Reuses by #include only: HalfEdgeMesh.hpp, TriTriIntersect.hpp, Predicates.hpp.
//
// Pure C++20, no external dependencies, no WASM, no OCCT.

#include "forge/native/mesh/MeshBoolRobust_a.hpp"
#include "forge/native/mesh/TriTriIntersect.hpp"
#include "forge/native/Predicates.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <map>
#include <unordered_map>
#include <utility>
#include <vector>
#ifdef FORGE_BRA_DEBUG
#include <cstdio>
#endif

namespace forge {
namespace native {
namespace mesh {

namespace {

// ───────────────────────────── tiny vector scratch ──────────────────────────
inline Vec3 sub(const Vec3& a, const Vec3& b) { return {a.x-b.x, a.y-b.y, a.z-b.z}; }
inline Vec3 add(const Vec3& a, const Vec3& b) { return {a.x+b.x, a.y+b.y, a.z+b.z}; }
inline Vec3 mul(const Vec3& a, double s)      { return {a.x*s, a.y*s, a.z*s}; }
inline double dot(const Vec3& a, const Vec3& b){ return a.x*b.x + a.y*b.y + a.z*b.z; }
inline Vec3 cross(const Vec3& a, const Vec3& b){
    return { a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x };
}
inline double norm2(const Vec3& a){ return dot(a,a); }
inline int sgn(Sign s) { return signValue(s); }

constexpr std::uint32_t kBad = 0xFFFFFFFFu;

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL SHARED VERTEX POOL.
//
// Holds:
//   * the ORIGINAL vertices of A and B (each welded by EXACT coordinate equality
//     only — identical doubles → one id; we never lossy-snap originals);
//   * every INTERSECTION point, each created EXACTLY ONCE and addressed by a
//     stable provenance key  (edgeU, edgeV, faceA, faceB, faceC)  = "the point
//     where the mesh edge {edgeU,edgeV} meets the plane of the original triangle
//     {faceA,faceB,faceC}".  Any later request with the same key returns the SAME
//     id (and the SAME stored coordinate), so BOTH surfaces' re-triangulations
//     reference an identical vertex along the shared cut. THIS is the fix.
// ─────────────────────────────────────────────────────────────────────────────
struct Pool {
    std::vector<Vec3> pts;

    // exact-coordinate weld for original vertices (and any vertex we want to
    // address by coordinate). Key = the three raw bit patterns.
    std::unordered_map<std::uint64_t, std::uint32_t> coordMap;

    // provenance weld for intersection points. Key = (edgeU, edgeV, planeId):
    // "the point where mesh edge {edgeU,edgeV} meets canonical plane `planeId`".
    std::map<std::array<std::uint32_t,3>, std::uint32_t> isectMap;

    static std::uint64_t bits(double d){ std::uint64_t u; std::memcpy(&u,&d,sizeof u); return u; }
    static std::uint64_t coordKey(const Vec3& p){
        std::uint64_t h = 1469598103934665603ull;
        for (std::uint64_t u : { bits(p.x), bits(p.y), bits(p.z) })
            for (int i=0;i<8;++i){ h ^= (u & 0xFF); h *= 1099511628211ull; u >>= 8; }
        return h;
    }

    std::uint32_t addCoord(const Vec3& p){
        std::uint64_t k = coordKey(p);
        auto it = coordMap.find(k);
        if (it != coordMap.end()) return it->second;
        std::uint32_t id = static_cast<std::uint32_t>(pts.size());
        pts.push_back(p);
        coordMap.emplace(k, id);
        return id;
    }

    // Address (and create-once) the intersection of mesh edge {eu,ev} with the
    // CANONICAL plane `planeId`. `compute` lazily provides the coordinate the
    // first time. Because the plane is canonical (all coplanar faces share it),
    // the SAME crossing tested against any coplanar face resolves to ONE id.
    template <class F>
    std::uint32_t addIsect(std::uint32_t eu, std::uint32_t ev,
                           std::uint32_t planeId, F&& compute){
        if (eu > ev) std::swap(eu, ev);              // undirected edge
        std::array<std::uint32_t,3> key{eu, ev, planeId};
        auto it = isectMap.find(key);
        if (it != isectMap.end()) return it->second;
        Vec3 p = compute();
        // Secondary unification by EXACT coordinate: a point reachable by two
        // different (edge,plane) routes that compute bit-identical coordinates is
        // collapsed to one id (no lossy grid snap — the canonical plane key
        // already removes the dominant duplication; this catches the rest).
        std::uint32_t cid = addCoord(p);
        isectMap.emplace(key, cid);
        return cid;
    }

    // Edge-edge crossing weld (used by the coplanar-overlap clip, where two
    // mesh edges in a shared plane cross). Keyed by the two UNORDERED edges, so
    // the SAME crossing computed on either coplanar face resolves to one id.
    std::map<std::array<std::uint32_t,4>, std::uint32_t> edgeEdgeMap;
    template <class F>
    std::uint32_t addEdgeEdge(std::uint32_t a0, std::uint32_t a1,
                              std::uint32_t b0, std::uint32_t b1, F&& compute){
        if (a0>a1) std::swap(a0,a1);
        if (b0>b1) std::swap(b0,b1);
        std::array<std::uint32_t,2> ea{a0,a1}, eb{b0,b1};
        if (ea > eb) std::swap(ea, eb);                  // unordered pair of edges
        std::array<std::uint32_t,4> key{ea[0],ea[1],eb[0],eb[1]};
        auto it = edgeEdgeMap.find(key);
        if (it != edgeEdgeMap.end()) return it->second;
        Vec3 p = compute();
        std::uint32_t cid = addCoord(p);
        edgeEdgeMap.emplace(key, cid);
        return cid;
    }
};

// A triangle of an input mesh, expressed in shared-pool ids + cached geometry.
struct TriFace {
    std::uint32_t v[3];          // shared pool vertex ids (original corners)
    Vec3 nrm;                    // (v1-v0)x(v2-v0), un-normalized, outward
    Vec3 bbMin, bbMax;
    std::uint32_t planeId = kBad;// canonical plane-group id (coplanar faces share)
};

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL PLANE REGISTRY.
//
// Every face lies on a supporting plane. MANY faces are coplanar (e.g. the two
// triangles of one cube facet, or all the facets sharing a plane). If a cut
// point is keyed by a SPECIFIC triangle's 3 corners, then the SAME geometric
// crossing computed against two coplanar faces gets two different keys → two
// coincident-but-distinct vertices → a within-face T-junction that breaks the
// CDT (observed in the rotated-cube probe). Keying by a CANONICAL PLANE id
// instead collapses all coplanar faces to one identity, so "edge E crosses this
// plane" yields ONE shared vertex regardless of which coplanar face was tested.
//
// Two faces are the same plane iff their four defining points are exactly
// coplanar by orient3d AND their normals are parallel — but to get a stable
// canonical KEY we register a representative plane and match new faces against
// it with exact orient3d (a face joins an existing plane group iff all 3 of its
// corners are exactly ON that group's representative plane). The representative
// is the FIRST face of the group, so the key is order-deterministic.
// ─────────────────────────────────────────────────────────────────────────────
struct PlaneRegistry {
    // representative face corner ids per group (for the exact orient3d test).
    std::vector<std::array<std::uint32_t,3>> reps;

    std::uint32_t classify(const std::array<std::uint32_t,3>& corners,
                           const std::vector<Vec3>& P){
        for (std::uint32_t g=0; g<reps.size(); ++g){
            const Vec3& R0=P[reps[g][0]]; const Vec3& R1=P[reps[g][1]]; const Vec3& R2=P[reps[g][2]];
            bool on=true;
            for (int k=0;k<3;++k){
                const Vec3& Q=P[corners[k]];
                if (sgn(orient3d(R0.x,R0.y,R0.z, R1.x,R1.y,R1.z, R2.x,R2.y,R2.z,
                                 Q.x,Q.y,Q.z)) != 0){ on=false; break; }
            }
            if (on) return g;
        }
        std::uint32_t g = static_cast<std::uint32_t>(reps.size());
        reps.push_back(corners);
        return g;
    }
};

// Build the faces of one input soup, welding corners into the shared pool.
std::vector<TriFace> ingest(const std::vector<double>& pos,
                         const std::vector<std::uint32_t>& idx,
                         Pool& pool){
    std::vector<TriFace> faces;
    const std::size_t nf = idx.size()/3;
    faces.reserve(nf);
    for (std::size_t f=0; f<nf; ++f){
        Vec3 p0{pos[3*idx[3*f+0]+0], pos[3*idx[3*f+0]+1], pos[3*idx[3*f+0]+2]};
        Vec3 p1{pos[3*idx[3*f+1]+0], pos[3*idx[3*f+1]+1], pos[3*idx[3*f+1]+2]};
        Vec3 p2{pos[3*idx[3*f+2]+0], pos[3*idx[3*f+2]+1], pos[3*idx[3*f+2]+2]};
        TriFace fc;
        fc.v[0]=pool.addCoord(p0); fc.v[1]=pool.addCoord(p1); fc.v[2]=pool.addCoord(p2);
        fc.nrm = cross(sub(p1,p0), sub(p2,p0));
        fc.bbMin = { std::min({p0.x,p1.x,p2.x}), std::min({p0.y,p1.y,p2.y}), std::min({p0.z,p1.z,p2.z}) };
        fc.bbMax = { std::max({p0.x,p1.x,p2.x}), std::max({p0.y,p1.y,p2.y}), std::max({p0.z,p1.z,p2.z}) };
        faces.push_back(fc);
    }
    return faces;
}

inline bool aabbOverlap(const Vec3& aMin,const Vec3& aMax,
                        const Vec3& bMin,const Vec3& bMax, double eps){
    return aMin.x<=bMax.x+eps && aMax.x>=bMin.x-eps &&
           aMin.y<=bMax.y+eps && aMax.y>=bMin.y-eps &&
           aMin.z<=bMax.z+eps && aMax.z>=bMin.z-eps;
}

// Double-precision intersection point of segment [A,B] with plane through
// (fa,fb,fc). Used ONLY inside Pool::addIsect's lazy compute (computed once).
inline Vec3 edgePlanePoint(const Vec3& A, const Vec3& B,
                           const Vec3& fa, const Vec3& fb, const Vec3& fc){
    Vec3 n = cross(sub(fb,fa), sub(fc,fa));
    double nd = dot(n, fa);
    double da = dot(n,A) - nd;
    double db = dot(n,B) - nd;
    double denom = da - db;
    if (denom == 0.0) return A;
    double t = da / denom;
    if (t < 0.0) t = 0.0; else if (t > 1.0) t = 1.0;
    return add(A, mul(sub(B,A), t));
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED-VERTEX intersection of triangle A_i (pool ids ai[3]) with triangle B_j
// (pool ids bj[3]). Returns the cut segment as a pair of SHARED pool ids. Each
// endpoint is resolved to a shared id by its exact provenance:
//   * a vertex of one triangle lying ON the other's plane  → that vertex's id;
//   * an edge of one triangle crossing the other's plane    → addIsect(edge,face).
// Both A_i↔B_j and B_j↔A_i resolve to the SAME ids by construction, so the cut
// polyline is identical on both surfaces.
//
// Returns true and fills (s0,s1) for a non-degenerate crossing segment we should
// imprint; false if the pair contributes no constraint edge (disjoint / single
// point / coplanar — coplanar contact is handled separately by the caller).
// `coplanar` is set when the two faces are exactly coplanar (orient3d all zero).
// ─────────────────────────────────────────────────────────────────────────────
struct CutSeg { std::uint32_t s0, s1; };

// Resolve the chord endpoints of triangle T (ids t[3]) on the plane of face F
// (ids f[3], canonical plane `fPlane`) into shared pool ids, using exact orient3d
// side signs. Mirrors TriTriIntersect's triPlaneChord but RETURNS IDS (shared)
// not coordinates. `outIds` receives up to 3 ids (a vertex on the plane, or an
// edge×plane point keyed canonically by (edge, fPlane)).
int chordIds(const std::uint32_t t[3], const std::uint32_t f[3], std::uint32_t fPlane,
             Pool& pool, std::uint32_t outIds[3]){
    const Vec3 V[3] = { pool.pts[t[0]], pool.pts[t[1]], pool.pts[t[2]] };
    const Vec3 F0=pool.pts[f[0]], F1=pool.pts[f[1]], F2=pool.pts[f[2]];
    int S[3];
    for (int i=0;i<3;++i)
        S[i] = sgn(orient3d(F0.x,F0.y,F0.z, F1.x,F1.y,F1.z, F2.x,F2.y,F2.z,
                            V[i].x,V[i].y,V[i].z));
    int nh = 0;
    // vertices exactly on the plane are chord endpoints (use their own ids)
    for (int i=0;i<3 && nh<3;++i) if (S[i]==0) outIds[nh++] = t[i];
    // edges with strictly opposite-sign endpoints cross the plane once
    for (int i=0;i<3 && nh<3;++i){
        int a=i, b=(i+1)%3;
        if (S[a]!=0 && S[b]!=0 && S[a]!=S[b]){
            std::uint32_t ea=t[a], eb=t[b];
            outIds[nh++] = pool.addIsect(ea, eb, fPlane,
                [&]{ return edgePlanePoint(pool.pts[ea], pool.pts[eb], F0,F1,F2); });
        }
    }
    return nh;
}

// Full shared-id tri-tri cut. We re-derive the combinatorial relation with the
// shared exact primitive (so coplanar/disjoint are handled identically to the
// kernel), then build the shared-id chord for the generic crossing case.
bool sharedCut(const std::uint32_t ai[3], std::uint32_t aPlane,
               const std::uint32_t bj[3], std::uint32_t bPlane,
               Pool& pool, bool& coplanar, CutSeg& out){
    coplanar = false;
    const Vec3 A0=pool.pts[ai[0]], A1=pool.pts[ai[1]], A2=pool.pts[ai[2]];
    const Vec3 B0=pool.pts[bj[0]], B1=pool.pts[bj[1]], B2=pool.pts[bj[2]];

    TriTriResult tt = triTriIntersect(A0,A1,A2,B0,B1,B2);
    if (tt.degenerate) return false;
    switch (tt.relation){
        case TriTriRelation::DISJOINT:
        case TriTriRelation::POINT_TOUCH:
            return false;
        case TriTriRelation::COPLANAR_OVERLAP:
            coplanar = true;
            return false;                   // handled by coplanar path in caller
        case TriTriRelation::EDGE_TOUCH:
        case TriTriRelation::PROPER_CROSS:
            break;
    }

    // Generic crossing. Build shared chords for A on B's plane and B on A's plane.
    std::uint32_t aHit[3], bHit[3];
    int na = chordIds(ai, bj, bPlane, pool, aHit);   // A's edges/verts vs B's plane
    int nb = chordIds(bj, ai, aPlane, pool, bHit);   // B's edges/verts vs A's plane
    if (na < 1 || nb < 1) return false;

    // The shared intersection segment is the overlap of A's chord and B's chord
    // along the common line. To stay on the SHARED-ID rail, we order the (up to)
    // four endpoint ids by their parameter along the common line direction and
    // take the inner two — but we ONLY accept ids that are present in BOTH
    // chords' provenance OR are a vertex shared on the line. In practice the
    // overlap's two endpoints are: max of the two chord lows and min of the two
    // chord highs. We pick the ids whose coordinates realize those, preferring an
    // id that appears in both chords (an exact coincidence) for perfect sharing.
    auto lineParamOf = [&](std::uint32_t id, const Vec3& O, const Vec3& dir)->double{
        return dot(sub(pool.pts[id], O), dir) / dot(dir,dir);
    };
    Vec3 nA = cross(sub(A1,A0), sub(A2,A0));
    Vec3 nB = cross(sub(B1,B0), sub(B2,B0));
    Vec3 L  = cross(nA, nB);
    if (norm2(L) == 0.0) return false;
    Vec3 O = pool.pts[aHit[0]];

    // Collect candidate endpoint ids from both chords, ordered along L.
    std::vector<std::pair<double,std::uint32_t>> ca, cb;
    for (int i=0;i<na;++i) ca.push_back({lineParamOf(aHit[i],O,L), aHit[i]});
    for (int i=0;i<nb;++i) cb.push_back({lineParamOf(bHit[i],O,L), bHit[i]});
    std::sort(ca.begin(),ca.end()); std::sort(cb.begin(),cb.end());
    double aLo=ca.front().first, aHi=ca.back().first;
    double bLo=cb.front().first, bHi=cb.back().first;
    double span=std::max(aHi-aLo, bHi-bLo);
    double eps = 1e-12 * (span>0?span:1.0);

    // The shared segment is the overlap [lo,hi] = [max(aLo,bLo), min(aHi,bHi)].
    // Each overlap endpoint is the chord endpoint of the chord that DEFINES that
    // bound (the inner one) — NOT a nearest-parameter guess. Choosing the
    // defining chord's actual endpoint id keeps the endpoint EXACTLY on both
    // triangles' boundary and on the shared rail (a real edge×plane vertex), so
    // the segment never inherits a stray coordinate from the wrong chord.
    std::uint32_t s0, s1; double lo, hi;
    if (aLo >= bLo){ lo=aLo; s0=ca.front().second; } else { lo=bLo; s0=cb.front().second; }
    if (aHi <= bHi){ hi=aHi; s1=ca.back().second;  } else { hi=bHi; s1=cb.back().second;  }
    if (hi <= lo + eps) return false;            // touch only / no real segment
    if (s0==kBad || s1==kBad || s0==s1) return false;
    out.s0=s0; out.s1=s1;
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2D Constrained Delaunay triangulation of ONE original triangle that received
// intersection segments. Points are SHARED pool ids projected to the triangle's
// dominant-axis plane. Exact orient2d + incircle drive every decision. The
// imprinted segments + the (possibly split) boundary are required constraints.
// Domain-based incremental insert (seed = the triangle corners), Lawson legalize,
// then Sloan flip-recovery of constraint edges. Returns triangles as shared-id
// triples (winding fixed by the caller to match the face normal).
// ─────────────────────────────────────────────────────────────────────────────
struct V2 { double x, y; std::uint32_t id; };  // id = shared pool id
struct Tri2 { int a,b,c; };

inline int o2(const V2& a,const V2& b,const V2& c){ return sgn(orient2d(a.x,a.y,b.x,b.y,c.x,c.y)); }
inline int ic(const V2& a,const V2& b,const V2& c,const V2& d){ return sgn(incircle(a.x,a.y,b.x,b.y,c.x,c.y,d.x,d.y)); }

inline V2 proj(const Vec3& p, int drop, std::uint32_t id, bool flip){
    double x,y;
    switch(drop){ case 0: x=p.y; y=p.z; break; case 1: x=p.z; y=p.x; break; default: x=p.x; y=p.y; break; }
    if (flip) std::swap(x,y);
    return V2{x,y,id};
}

struct CDT {
    std::vector<V2> pts;
    std::vector<std::array<int,2>> cons;
    std::vector<Tri2> tris;

    static int apex(const Tri2& t,int a,int b){
        if (t.a!=a && t.a!=b){ if((t.b==a&&t.c==b)||(t.b==b&&t.c==a)) return t.a; }
        if (t.b!=a && t.b!=b){ if((t.a==a&&t.c==b)||(t.a==b&&t.c==a)) return t.b; }
        if (t.c!=a && t.c!=b){ if((t.a==a&&t.b==b)||(t.a==b&&t.b==a)) return t.c; }
        return -1;
    }
    bool hasEdge(int u,int v) const {
        for (auto& t:tris){ if(t.a<0)continue;
            if((t.a==u&&t.b==v)||(t.b==u&&t.c==v)||(t.c==u&&t.a==v)||
               (t.a==v&&t.b==u)||(t.b==v&&t.c==u)||(t.c==v&&t.a==u)) return true; }
        return false;
    }

    bool build(){
        const int n = static_cast<int>(pts.size());
        if (n < 3) return false;
        tris.clear();
        if (o2(pts[0],pts[1],pts[2])>0) tris.push_back({0,1,2});
        else                            tris.push_back({0,2,1});
        for (int ip=3; ip<n; ++ip){
            bool dup=false;
            for (int q=0;q<ip;++q) if (pts[q].x==pts[ip].x && pts[q].y==pts[ip].y){ dup=true; break; }
            if (dup) continue;
            if (!insertPoint(ip)){
#ifdef FORGE_BRA_DEBUG
                std::printf("[CDT] insertPoint failed ip=%d of %d pts\n", ip, n);
#endif
                return false;
            }
        }
        if (!recover()){
#ifdef FORGE_BRA_DEBUG
            std::printf("[CDT] recover failed; %zu pts, %zu cons, %zu tris\n",
                        pts.size(), cons.size(), tris.size());
            for (size_t i=0;i<pts.size();++i)
                std::printf("    pt[%zu]=(%.6f,%.6f) id=%u\n", i, pts[i].x, pts[i].y, pts[i].id);
            for (auto& c:cons) std::printf("    cons (%d,%d)\n", c[0],c[1]);
#endif
            return false;
        }
        std::vector<Tri2> kept; for (auto& t:tris) if (t.a>=0) kept.push_back(t);
        tris.swap(kept);
        return true;
    }

    bool insertPoint(int ip){
        V2 P=pts[ip];
        int host=-1, ea=-1, eb=-1;
        for (int t=0;t<(int)tris.size();++t){
            if (tris[t].a<0) continue;
            int v[3]={tris[t].a,tris[t].b,tris[t].c};
            int s0=o2(pts[v[0]],pts[v[1]],P), s1=o2(pts[v[1]],pts[v[2]],P), s2=o2(pts[v[2]],pts[v[0]],P);
            bool neg=(s0<0)||(s1<0)||(s2<0), pos=(s0>0)||(s1>0)||(s2>0);
            if (neg&&pos) continue;
            host=t;
            if (s0==0){ea=v[0];eb=v[1];} else if(s1==0){ea=v[1];eb=v[2];} else if(s2==0){ea=v[2];eb=v[0];}
            break;
        }
        if (host<0){
            // tolerant on-edge clamp (double-precision endpoint a hair outside)
            double bestD=1e300; int bt=-1,ba=-1,bb=-1; V2 bp{};
            for (int t=0;t<(int)tris.size();++t){
                if (tris[t].a<0) continue;
                int v[3]={tris[t].a,tris[t].b,tris[t].c};
                for (int k=0;k<3;++k){
                    const V2&U=pts[v[k]]; const V2&W=pts[v[(k+1)%3]];
                    double dx=W.x-U.x, dy=W.y-U.y, L2=dx*dx+dy*dy; if(L2<=0)continue;
                    double tt=((P.x-U.x)*dx+(P.y-U.y)*dy)/L2; tt=std::max(0.0,std::min(1.0,tt));
                    double px=U.x+tt*dx, py=U.y+tt*dy, d=std::hypot(P.x-px,P.y-py);
                    if (d<bestD){bestD=d;bt=t;ba=v[k];bb=v[(k+1)%3];bp={px,py,P.id};}
                }
            }
            if (bt<0) return false;
            pts[ip].x=bp.x; pts[ip].y=bp.y; P=pts[ip]; host=bt; ea=ba; eb=bb;
            if ((P.x==pts[ba].x&&P.y==pts[ba].y)||(P.x==pts[bb].x&&P.y==pts[bb].y)) return true;
        }
        std::vector<std::array<int,2>> leg;
        if (ea<0){
            int a=tris[host].a,b=tris[host].b,c=tris[host].c;
            tris[host]={a,b,ip}; tris.push_back({b,c,ip}); tris.push_back({c,a,ip});
            leg.push_back({a,b}); leg.push_back({b,c}); leg.push_back({c,a});
        } else {
            std::vector<int> inc;
            for (int t=0;t<(int)tris.size();++t){ if(tris[t].a<0)continue;
                int v[3]={tris[t].a,tris[t].b,tris[t].c}; bool ha=false,hb=false;
                for(int k=0;k<3;++k){ if(v[k]==ea)ha=true; if(v[k]==eb)hb=true; }
                if(ha&&hb) inc.push_back(t); }
            for (int t:inc){
                int apx=apex(tris[t],ea,eb); if(apx<0)continue;
                int a=tris[t].a,b=tris[t].b,c=tris[t].c; int cyc[3]={a,b,c};
                tris[t]={-1,-1,-1};
                for (int k=0;k<3;++k){ int x=cyc[k],y=cyc[(k+1)%3],z=cyc[(k+2)%3];
                    if((x==ea&&y==eb)||(x==eb&&y==ea)){ tris.push_back({x,ip,z}); tris.push_back({ip,y,z}); break; } }
                leg.push_back({ea,apx}); leg.push_back({eb,apx});
            }
        }
        legalize(leg, ip);
        return true;
    }

    void legalize(std::vector<std::array<int,2>> st, int ip){
        int guard=0;
        while(!st.empty()){
            if(++guard>200000) break;
            auto e=st.back(); st.pop_back(); int a=e[0],b=e[1];
            int t0=-1,t1=-1;
            for (int t=0;t<(int)tris.size();++t){ if(tris[t].a<0)continue;
                int v[3]={tris[t].a,tris[t].b,tris[t].c}; bool ha=false,hb=false;
                for(int k=0;k<3;++k){if(v[k]==a)ha=true;if(v[k]==b)hb=true;}
                if(ha&&hb){ if(t0<0)t0=t; else t1=t; } }
            if(t0<0||t1<0) continue;
            int p=apex(tris[t0],a,b), q=apex(tris[t1],a,b);
            if(p<0||q<0||p==q) continue;
            int newp=(p==ip)?p:((q==ip)?q:-1); if(newp<0)continue;
            int other=(newp==p)?q:p;
            const V2&A=pts[a]; const V2&B=pts[b]; const V2&Np=pts[newp];
            int o=o2(A,B,Np), inc;
            if(o>0) inc=ic(A,B,Np,pts[other]); else if(o<0) inc=ic(A,Np,B,pts[other]); else continue;
            if(inc>0){
                int pa=o2(pts[newp],pts[other],A), pb=o2(pts[newp],pts[other],B);
                if(pa==0||pb==0||pa==pb) continue;
                tris[t0]={a,newp,other}; tris[t1]={newp,b,other};
                st.push_back({a,other}); st.push_back({other,b});
            }
        }
    }

    bool segmentCovered(int u,int v) const {
        const V2&U=pts[u]; const V2&Vv=pts[v];
        std::vector<std::pair<double,int>> on={{0.0,u},{1.0,v}};
        double dx=Vv.x-U.x, dy=Vv.y-U.y, L2=dx*dx+dy*dy; if(L2==0)return false;
        for (int i=0;i<(int)pts.size();++i){ if(i==u||i==v)continue;
            if(o2(U,Vv,pts[i])!=0) continue;
            double t=((pts[i].x-U.x)*dx+(pts[i].y-U.y)*dy)/L2;
            if(t>0.0&&t<1.0) on.push_back({t,i}); }
        if(on.size()<=2) return false;
        std::sort(on.begin(),on.end());
        for(size_t i=0;i+1<on.size();++i) if(!hasEdge(on[i].second,on[i+1].second)) return false;
        return true;
    }

    bool recoverEdge(int u,int v){
        const V2&U=pts[u]; const V2&Vv=pts[v];
        int guard=0; const int maxIter=8*(int)tris.size()+200;
        while(!hasEdge(u,v)){
            if(++guard>maxIter) return false;
            std::map<std::pair<int,int>,std::array<int,2>> adj;
            for (int t=0;t<(int)tris.size();++t){ if(tris[t].a<0)continue;
                std::array<std::array<int,2>,3> es={{{tris[t].a,tris[t].b},{tris[t].b,tris[t].c},{tris[t].c,tris[t].a}}};
                for(auto&e:es){ auto key=std::make_pair(std::min(e[0],e[1]),std::max(e[0],e[1]));
                    auto it=adj.find(key); if(it==adj.end())adj[key]={t,-1}; else it->second[1]=t; } }
            bool flipped=false;
            for (auto&kv:adj){
                if(kv.second[1]<0) continue;
                int a=kv.first.first,b=kv.first.second;
                if(a==u||a==v||b==u||b==v) continue;
                int o1=o2(U,Vv,pts[a]),o2_=o2(U,Vv,pts[b]),o3=o2(pts[a],pts[b],U),o4=o2(pts[a],pts[b],Vv);
                bool crosses=(o1!=0&&o2_!=0&&o3!=0&&o4!=0)&&(o1!=o2_)&&(o3!=o4);
                if(!crosses) continue;
                int t0=kv.second[0],t1=kv.second[1];
                int p=apex(tris[t0],a,b), q=apex(tris[t1],a,b);
                if(p<0||q<0||p==q) continue;
                int pa=o2(pts[p],pts[q],pts[a]), pb=o2(pts[p],pts[q],pts[b]);
                int ap=o2(pts[a],pts[b],pts[p]), aq=o2(pts[a],pts[b],pts[q]);
                if(pa==0||pb==0||ap==0||aq==0) continue;
                if(pa==pb||ap==aq) continue;
                tris[t0]={a,p,q}; tris[t1]={b,q,p}; flipped=true; break;
            }
            if(!flipped) return cavityInsert(u,v);   // robust fallback for slivers
        }
        return true;
    }

    // ROBUST segment insertion by CAVITY RE-TRIANGULATION (the standard CDT
    // primitive, far more robust than flip-only recovery on slivers). Remove every
    // triangle whose interior the segment (u,v) crosses; the removed triangles
    // form a simple polygonal cavity with (u,v) as a chord. Split the cavity
    // boundary into the LEFT and RIGHT chains of (u,v) and ear-clip each chain into
    // triangles. No new vertices are added (so the shared-vertex invariant holds);
    // we only re-triangulate the existing cavity vertices, guaranteeing the chord
    // (u,v) becomes an edge. Exact orient2d throughout.
    bool cavityInsert(int u, int v){
        const V2&U=pts[u]; const V2&Vv=pts[v];
        // 1. collect crossed triangles + the cavity's boundary edges (those NOT
        //    shared by two crossed triangles).
        std::vector<int> crossed;
        for (int t=0;t<(int)tris.size();++t){ if(tris[t].a<0)continue;
            int w[3]={tris[t].a,tris[t].b,tris[t].c};
            // a triangle is crossed if segment (u,v) passes through its interior:
            // its centroid is on a crossed path — robust test: (u,v) separates two
            // of its vertices AND the triangle straddles. Use: triangle intersects
            // the open segment if any of its edges properly crosses (u,v) OR a
            // vertex of the triangle lies strictly on the open segment, OR u/v is
            // strictly inside. We detect membership by edge-crossing with (u,v).
            bool cross=false;
            for (int k=0;k<3 && !cross;++k){
                int a=w[k], b=w[(k+1)%3];
                if(a==u||a==v||b==u||b==v) continue;
                int o1=o2(U,Vv,pts[a]),o2_=o2(U,Vv,pts[b]),o3=o2(pts[a],pts[b],U),o4=o2(pts[a],pts[b],Vv);
                if(o1!=0&&o2_!=0&&o3!=0&&o4!=0&&(o1!=o2_)&&(o3!=o4)) cross=true;
            }
            // also include triangles that have u or v as a vertex and straddle.
            if(!cross){
                bool hasU=(w[0]==u||w[1]==u||w[2]==u), hasV=(w[0]==v||w[1]==v||w[2]==v);
                if(hasU&&!hasV){ // does (u,v) enter this triangle's interior from u?
                    int oo=0; for(int k=0;k<3;++k){ if(w[k]==u)continue;
                        int s=o2(U,Vv,pts[w[k]]); if(s!=0){ if(oo==0)oo=s; else if(oo!=s) cross=true; } }
                }
            }
            if(cross) crossed.push_back(t);
        }
        if(crossed.empty()) return false;

        // 2. boundary edges of the cavity = edges appearing once among crossed tris.
        std::map<std::pair<int,int>,int> edgeCount;
        std::map<std::pair<int,int>,std::array<int,2>> dir; // ordered edge per key
        for (int t:crossed){ int w[3]={tris[t].a,tris[t].b,tris[t].c};
            for(int k=0;k<3;++k){ int a=w[k],b=w[(k+1)%3];
                auto key=std::make_pair(std::min(a,b),std::max(a,b));
                edgeCount[key]++; dir[key]={a,b}; } }
        std::vector<std::array<int,2>> bnd;
        for (auto&kv:edgeCount) if(kv.second==1) bnd.push_back(dir[kv.first]);
        if(bnd.empty()) return false;

        // 3. order the boundary into a closed loop.
        std::vector<int> loop;
        {
            std::map<int,int> nxt; for(auto&e:bnd) nxt[e[0]]=e[1];
            if(nxt.find(u)==nxt.end()) return false;
            int cur=u, guard=0;
            do { loop.push_back(cur); auto it=nxt.find(cur); if(it==nxt.end()) return false; cur=it->second;
                 if(++guard> (int)bnd.size()+2) return false; } while(cur!=u);
            if((int)loop.size()!=(int)bnd.size()) return false;
        }
        // the loop must contain both u and v.
        int ui=-1,vi=-1; for(int i=0;i<(int)loop.size();++i){ if(loop[i]==u)ui=i; if(loop[i]==v)vi=i; }
        if(ui<0||vi<0) return false;

        // 4. split loop into two chains from u to v.
        std::vector<int> chain1, chain2;
        for(int i=ui;;i=(i+1)%loop.size()){ chain1.push_back(loop[i]); if(loop[i]==v) break; }
        for(int i=vi;;i=(i+1)%loop.size()){ chain2.push_back(loop[i]); if(loop[i]==u) break; }
        if((int)chain1.size()<2||(int)chain2.size()<2) return false;

        // 5. remove crossed triangles.
        for(int t:crossed) tris[t]={-1,-1,-1};

        // 6. ear-clip each chain (a simple polygon: chain + the chord) into tris.
        auto earClip=[&](std::vector<int> poly)->bool{
            // poly is a simple polygon (CCW or CW) given as vertex indices.
            if(poly.size()<3) return true;
            // ensure CCW
            double area=0; for(size_t i=0;i<poly.size();++i){ const V2&p=pts[poly[i]]; const V2&q=pts[poly[(i+1)%poly.size()]]; area+=p.x*q.y-q.x*p.y; }
            if(area<0) std::reverse(poly.begin(),poly.end());
            int guard=0;
            while(poly.size()>3){
                if(++guard> 4*(int)poly.size()+50) return false;
                bool clipped=false; int n=(int)poly.size();
                for(int i=0;i<n;++i){
                    int ia=poly[(i+n-1)%n], ib=poly[i], ic=poly[(i+1)%n];
                    if(o2(pts[ia],pts[ib],pts[ic])<=0) continue;   // reflex/collinear
                    bool ear=true;
                    for(int j=0;j<n;++j){ int pj=poly[j]; if(pj==ia||pj==ib||pj==ic)continue;
                        if(inTriStrict(pts[pj],pts[ia],pts[ib],pts[ic])){ ear=false; break; } }
                    if(!ear) continue;
                    tris.push_back({ia,ib,ic}); poly.erase(poly.begin()+i); clipped=true; break;
                }
                if(!clipped) return false;
            }
            if(poly.size()==3 && o2(pts[poly[0]],pts[poly[1]],pts[poly[2]])!=0)
                tris.push_back({poly[0],poly[1],poly[2]});
            return true;
        };
        if(!earClip(chain1)) return false;
        if(!earClip(chain2)) return false;
        return hasEdge(u,v);
    }

    static bool inTriStrict(const V2&p,const V2&a,const V2&b,const V2&c){
        int s0=o2(a,b,p),s1=o2(b,c,p),s2=o2(c,a,p);
        return (s0>0&&s1>0&&s2>0); // strictly inside a CCW triangle
    }

    bool recover(){
        // Recover SHORTEST constraints first. A long constraint edge flipped into
        // place can fence off a tiny sliver constraint (the thin (4,5) wedge seen
        // on tilted general-position contact), leaving it unrecoverable. Doing the
        // short ones first lets the sliver settle before the long fences appear.
        std::vector<std::array<int,2>> order(cons.begin(), cons.end());
        std::sort(order.begin(), order.end(), [&](const std::array<int,2>& A, const std::array<int,2>& B){
            double la=(pts[A[0]].x-pts[A[1]].x)*(pts[A[0]].x-pts[A[1]].x)+(pts[A[0]].y-pts[A[1]].y)*(pts[A[0]].y-pts[A[1]].y);
            double lb=(pts[B[0]].x-pts[B[1]].x)*(pts[B[0]].x-pts[B[1]].x)+(pts[B[0]].y-pts[B[1]].y)*(pts[B[0]].y-pts[B[1]].y);
            return la < lb;
        });
        for (auto&c:order){ int u=c[0],v=c[1];
            if(u==v) continue;
            if(hasEdge(u,v)) continue;
            if(segmentCovered(u,v)) continue;
            if(!recoverEdge(u,v)){
#ifdef FORGE_BRA_DEBUG
                std::printf("[CDT]   --> failed to recover constraint local(%d,%d) = id(%u,%u)\n",
                            u,v,pts[u].id,pts[v].id);
#endif
                return false;
            }
        }
        return true;
    }
};

inline bool inTri2(const V2&p,const V2&t0,const V2&t1,const V2&t2){
    int s0=o2(t0,t1,p),s1=o2(t1,t2,p),s2=o2(t2,t0,p);
    bool neg=(s0<0)||(s1<0)||(s2<0), pos=(s0>0)||(s1>0)||(s2>0);
    return !(neg&&pos);
}

// ─────────────────────────────────────────────────────────────────────────────
// Coplanar overlap: clip face A by face B in their shared plane and imprint the
// overlap polygon boundary as constraint segments. Endpoints are addressed by
// the SHARED pool: a corner keeps its id; a boundary-crossing point is welded by
// (edge-of-A, plane-of-B) provenance just like the generic case so the two
// surfaces' coplanar contact agrees. (Handles the axis-aligned cube-cube wall.)
// ─────────────────────────────────────────────────────────────────────────────
struct PolyPt { double x,y; std::uint32_t id; };
inline int side2(const PolyPt&a,const PolyPt&b,const PolyPt&c){ return sgn(orient2d(a.x,a.y,b.x,b.y,c.x,c.y)); }

// returns boundary segments of the overlap as shared-id pairs.
void coplanarOverlap(const std::uint32_t ai[3], const std::uint32_t bj[3],
                     Pool& pool, int drop, bool flip,
                     std::vector<std::array<std::uint32_t,2>>& segOut){
    auto pr=[&](std::uint32_t id)->PolyPt{
        const Vec3&p=pool.pts[id]; double x,y;
        switch(drop){case 0:x=p.y;y=p.z;break;case 1:x=p.z;y=p.x;break;default:x=p.x;y=p.y;break;}
        if(flip) std::swap(x,y); return PolyPt{x,y,id};
    };
    std::vector<PolyPt> poly={pr(ai[0]),pr(ai[1]),pr(ai[2])};
    if (side2(poly[0],poly[1],poly[2])<0) std::reverse(poly.begin(),poly.end());
    PolyPt W[3]={pr(bj[0]),pr(bj[1]),pr(bj[2])};
    if (side2(W[0],W[1],W[2])<0) std::swap(W[1],W[2]);

    // Sutherland-Hodgman clip; new boundary points are welded by (A-edge,B-face)
    // provenance so both sides share them.
    auto clip=[&](std::vector<PolyPt>& P, const PolyPt& e0, const PolyPt& e1){
        if(P.empty()) return; std::vector<PolyPt> res; int N=(int)P.size();
        for(int i=0;i<N;++i){ const PolyPt&cur=P[i]; const PolyPt&nxt=P[(i+1)%N];
            int sc=side2(e0,e1,cur), sn=side2(e0,e1,nxt);
            if(sc>=0) res.push_back(cur);
            if((sc>0&&sn<0)||(sc<0&&sn>0)){
                // crossing point = A-edge (cur,nxt) ∩ B-edge (e0,e1), both in the
                // shared plane. Welded canonically by the unordered pair of edges
                // so both coplanar faces' passes agree on the same vertex id.
                std::uint32_t id = pool.addEdgeEdge(cur.id, nxt.id, e0.id, e1.id,
                    [&]{
                        // exact 2D line-line in the projection, lifted to 3D
                        double a1=e1.y-e0.y, b1=e0.x-e1.x, c1=a1*e0.x+b1*e0.y;
                        double a2=nxt.y-cur.y, b2=cur.x-nxt.x, c2=a2*cur.x+b2*cur.y;
                        double det=a1*b2-a2*b1;
                        const Vec3&pc=pool.pts[cur.id]; const Vec3&pn=pool.pts[nxt.id];
                        if(det==0.0) return pc;
                        double X=(c1*b2-c2*b1)/det, Y=(a1*c2-a2*c1)/det;
                        double dx=nxt.x-cur.x, dy=nxt.y-cur.y, L2=dx*dx+dy*dy;
                        double t = L2>0?((X-cur.x)*dx+(Y-cur.y)*dy)/L2 : 0.0;
                        return add(pc, mul(sub(pn,pc), t));
                    });
                const Vec3&q=pool.pts[id]; double x,y;
                switch(drop){case 0:x=q.y;y=q.z;break;case 1:x=q.z;y=q.x;break;default:x=q.x;y=q.y;break;}
                if(flip) std::swap(x,y);
                res.push_back(PolyPt{x,y,id});
            }
        }
        P.swap(res);
    };
    clip(poly,W[0],W[1]); clip(poly,W[1],W[2]); clip(poly,W[2],W[0]);
    int M=(int)poly.size(); if(M<3) return;
    for(int i=0;i<M;++i){ std::uint32_t u=poly[i].id, v=poly[(i+1)%M].id;
        if(u!=v) segOut.push_back({u,v}); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Split a face's imprinted constraint segments (already shared ids) at their
// mutual interior crossings, welding each crossing by (segA, segB) endpoint-id
// provenance, so the arrangement is NON-CROSSING (required by the CDT recovery).
// The split point is addressed in the shared pool by the four endpoint ids that
// produced it (order-independent), so BOTH surfaces agree on it too.
// ─────────────────────────────────────────────────────────────────────────────
void splitConstraints(std::vector<std::array<std::uint32_t,2>>& segs,
                      Pool& pool, int drop, bool flip){
    auto pr=[&](std::uint32_t id)->V2{
        const Vec3&p=pool.pts[id]; double x,y;
        switch(drop){case 0:x=p.y;y=p.z;break;case 1:x=p.z;y=p.x;break;default:x=p.x;y=p.y;break;}
        if(flip) std::swap(x,y); return V2{x,y,id};
    };
    int N=(int)segs.size();
    std::vector<std::vector<std::pair<double,std::uint32_t>>> cut(N);
    for(int i=0;i<N;++i){ cut[i].push_back({0.0,segs[i][0]}); cut[i].push_back({1.0,segs[i][1]}); }
    for(int i=0;i<N;++i){ V2 a=pr(segs[i][0]),b=pr(segs[i][1]);
        for(int j=i+1;j<N;++j){ V2 c=pr(segs[j][0]),d=pr(segs[j][1]);
            int o1=o2(a,b,c),o2_=o2(a,b,d),o3=o2(c,d,a),o4=o2(c,d,b);
            if(o1!=0&&o2_!=0&&o3!=0&&o4!=0&&(o1!=o2_)&&(o3!=o4)){
                // weld the segment-segment split point by the unordered pair of
                // constraint segments (order-independent in the 4 endpoint ids),
                // so the SAME crossing is one shared vertex on both surfaces.
                std::uint32_t id = pool.addEdgeEdge(segs[i][0],segs[i][1], segs[j][0],segs[j][1],
                    [&]{
                        double a1=b.y-a.y, b1=a.x-b.x, c1=a1*a.x+b1*a.y;
                        double a2=d.y-c.y, b2=c.x-d.x, c2=a2*c.x+b2*c.y;
                        double det=a1*b2-a2*b1;
                        const Vec3&pa=pool.pts[segs[i][0]]; const Vec3&pb=pool.pts[segs[i][1]];
                        if(det==0.0) return pa;
                        double X=(c1*b2-c2*b1)/det, Y=(a1*c2-a2*c1)/det;
                        double dx=b.x-a.x, dy=b.y-a.y, L2=dx*dx+dy*dy;
                        double t=L2>0?((X-a.x)*dx+(Y-a.y)*dy)/L2:0.0;
                        return add(pa, mul(sub(pb,pa), t));
                    });
                V2 P=pr(id);
                double dxi=b.x-a.x,dyi=b.y-a.y,Li=dxi*dxi+dyi*dyi;
                double dxj=d.x-c.x,dyj=d.y-c.y,Lj=dxj*dxj+dyj*dyj;
                if(Li>0) cut[i].push_back({((P.x-a.x)*dxi+(P.y-a.y)*dyi)/Li, id});
                if(Lj>0) cut[j].push_back({((P.x-c.x)*dxj+(P.y-c.y)*dyj)/Lj, id});
            }
        }
    }
    std::vector<std::array<std::uint32_t,2>> out;
    for(int i=0;i<N;++i){ std::sort(cut[i].begin(),cut[i].end());
        for(size_t k=0;k+1<cut[i].size();++k){
            if(cut[i][k+1].first - cut[i][k].first < 1e-12) continue;
            std::uint32_t u=cut[i][k].second, v=cut[i][k+1].second;
            if(u!=v) out.push_back({u,v});
        }
    }
    segs.swap(out);
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL coincident-vertex unification.
//
// After the cut segments are collected, the SAME geometric cut point may carry
// two distinct pool ids whose coordinates differ in the last bits (e.g. a chord
// endpoint computed as B-edge×A-plane vs the SAME corner reached through a
// neighbouring face's cut). Left distinct, two 2D-coincident ids on one planar
// face create a T-junction that makes the CDT non-recoverable — the exact failure
// mode of prior rotated/tilted-cube attempts. Here we build a UNION-FIND over all
// referenced ids, merging any pair whose 3D coordinates are within a tight
// RELATIVE tolerance, and map every id to the group's MINIMUM id. The merge is
// applied UNIFORMLY to every face's segment list, so the shared polyline keeps
// IDENTICAL ids on both surfaces (the cross-surface match is preserved). Distinct
// ids that are NOT geometrically coincident are never merged (tolerance is
// ~1e-9·extent — far below any real feature, above last-bit jitter).
// Returns a canon map; segment lists are rewritten by the caller.
std::unordered_map<std::uint32_t,std::uint32_t>
canonicalizeCoincident(const std::vector<std::vector<std::array<std::uint32_t,2>>>& aSegs,
                       const std::vector<std::vector<std::array<std::uint32_t,2>>>& bSegs,
                       const std::vector<Vec3>& P, double extent){
    std::vector<std::uint32_t> ids;
    auto gather=[&](const std::vector<std::vector<std::array<std::uint32_t,2>>>& S){
        for (auto& v:S) for (auto& s:v){ ids.push_back(s[0]); ids.push_back(s[1]); } };
    gather(aSegs); gather(bSegs);
    std::sort(ids.begin(),ids.end());
    ids.erase(std::unique(ids.begin(),ids.end()), ids.end());

    std::unordered_map<std::uint32_t,std::uint32_t> canon;
    double tol = 1e-9 * (extent>0?extent:1.0);
    double tol2 = tol*tol;
    // O(k^2) over the (small) set of cut-vertex ids: merge coincident, map to min.
    for (std::size_t a=0;a<ids.size();++a){
        std::uint32_t ia=ids[a];
        if (canon.count(ia)) continue;
        canon[ia]=ia;
        for (std::size_t b=a+1;b<ids.size();++b){
            std::uint32_t ib=ids[b];
            if (canon.count(ib)) continue;
            if (norm2(sub(P[ia],P[ib])) <= tol2) canon[ib]=ia;  // ia<ib (min id)
        }
    }
    return canon;
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-triangulate ONE original face `f` of mesh `me` given its imprinted
// constraint segments (shared ids), producing sub-triangles (shared ids,
// correctly wound). Returns false on a non-recoverable CDT (honest failure).
// ─────────────────────────────────────────────────────────────────────────────
struct SubFace { std::uint32_t v[3]; };

bool retriangulate(const TriFace& f, std::vector<std::array<std::uint32_t,2>>& segs,
                   const std::vector<std::uint32_t>& edgePts,
                   Pool& pool, std::vector<SubFace>& out){
    if (segs.empty() && edgePts.empty()){ out.push_back({f.v[0],f.v[1],f.v[2]}); return true; }

    Vec3 n=f.nrm; double ax=std::fabs(n.x),ay=std::fabs(n.y),az=std::fabs(n.z);
    int drop=(ax>=ay&&ax>=az)?0:(ay>=az?1:2);
    double ncomp=(drop==0)?n.x:(drop==1)?n.y:n.z; bool flip=(ncomp<0.0);

    // de-cross the constraints first. (Coincident-vertex unification is done
    // GLOBALLY by the caller, BEFORE this, so every face sees the same canonical
    // ids along a shared cut — see canonicalizeCoincident() in the entry point.)
    splitConstraints(segs, pool, drop, flip);

    // Triangle corner projections, for snapping near-boundary cut points exactly
    // onto an edge (a cut point computed in double precision can land a hair off
    // a triangle edge → orient2d≠0 → the boundary won't split there → the
    // boundary edge cannot be recovered). Snapping restores exact collinearity.
    V2 C0=proj(pool.pts[f.v[0]],drop,kBad,flip),
       C1=proj(pool.pts[f.v[1]],drop,kBad,flip),
       C2=proj(pool.pts[f.v[2]],drop,kBad,flip);
    double escale=std::sqrt(std::max({
        (C1.x-C0.x)*(C1.x-C0.x)+(C1.y-C0.y)*(C1.y-C0.y),
        (C2.x-C1.x)*(C2.x-C1.x)+(C2.y-C1.y)*(C2.y-C1.y),
        (C0.x-C2.x)*(C0.x-C2.x)+(C0.y-C2.y)*(C0.y-C2.y)}));
    double snapTol=1e-7*(escale>0?escale:1.0);
    auto snapEdge=[&](V2 q)->V2{
        const V2 E[3][2]={{C0,C1},{C1,C2},{C2,C0}};
        for (int e=0;e<3;++e){ const V2&U=E[e][0]; const V2&W=E[e][1];
            double dx=W.x-U.x, dy=W.y-U.y, L2=dx*dx+dy*dy; if(L2<=0)continue;
            double t=((q.x-U.x)*dx+(q.y-U.y)*dy)/L2; if(t<=0||t>=1)continue;
            double px=U.x+t*dx, py=U.y+t*dy;
            if(std::hypot(q.x-px,q.y-py)<snapTol){ q.x=px; q.y=py; }
        }
        return q;
    };

    CDT cdt;
    std::unordered_map<std::uint32_t,int> local;
    auto addPt=[&](std::uint32_t id, bool snap)->int{
        auto it=local.find(id); if(it!=local.end()) return it->second;
        int li=(int)cdt.pts.size();
        V2 q=proj(pool.pts[id],drop,id,flip);
        if (snap) q=snapEdge(q);
        cdt.pts.push_back(q);
        local.emplace(id,li); return li;
    };
    int l0=addPt(f.v[0],false), l1=addPt(f.v[1],false), l2=addPt(f.v[2],false);
    for (auto& s : segs){ int la=addPt(s[0],true), lb=addPt(s[1],true); if(la!=lb) cdt.cons.push_back({la,lb}); }
    // Force on-boundary points required for adjacent-face seam consistency (no
    // constraint segment — just a vertex the boundary chain must pass through).
    for (std::uint32_t id : edgePts) addPt(id, true);

    // Boundary edges split at any cut point lying on them. We use a GEOMETRIC
    // on-edge test (perpendicular distance < snapTol AND inside the span), not an
    // exact orient2d==0 — because a snapped point's coordinate is U+t·(W−U) in
    // double, whose orient2d need not round to exactly zero. Any point we accept
    // here is snapped EXACTLY onto the chord between its neighbours below, so the
    // boundary becomes a recoverable chain of sub-edges (no near-collinear sliver).
    auto addBoundary=[&](int e0,int e1){
        V2 U=cdt.pts[e0]; V2 Vv=cdt.pts[e1];
        double dx=Vv.x-U.x,dy=Vv.y-U.y,L2=dx*dx+dy*dy; if(L2<=0)return;
        std::vector<std::pair<double,int>> on={{0.0,e0},{1.0,e1}};
        for(int li=0;li<(int)cdt.pts.size();++li){ if(li==e0||li==e1)continue;
            const V2&Q=cdt.pts[li];
            double t=((Q.x-U.x)*dx+(Q.y-U.y)*dy)/L2;
            if(t<=1e-12||t>=1.0-1e-12) continue;
            double px=U.x+t*dx, py=U.y+t*dy;
            if(std::hypot(Q.x-px,Q.y-py) >= snapTol) continue;   // not on this edge
            // snap the point's stored coordinate EXACTLY onto the edge chord so
            // the sub-edges are exactly collinear for the CDT.
            cdt.pts[li].x=px; cdt.pts[li].y=py;
            on.push_back({t,li});
        }
        std::sort(on.begin(),on.end());
        for(size_t k=0;k+1<on.size();++k) cdt.cons.push_back({on[k].second,on[k+1].second});
    };
    addBoundary(l0,l1); addBoundary(l1,l2); addBoundary(l2,l0);

    if(!cdt.build()) return false;

    int NP=(int)cdt.pts.size();
    V2 A0=proj(pool.pts[f.v[0]],drop,kBad,flip),
       A1=proj(pool.pts[f.v[1]],drop,kBad,flip),
       A2=proj(pool.pts[f.v[2]],drop,kBad,flip);
    for (auto& t : cdt.tris){
        if(t.a<0||t.b<0||t.c<0) continue;
        if(t.a>=NP||t.b>=NP||t.c>=NP) continue;
        std::uint32_t i0=cdt.pts[t.a].id,i1=cdt.pts[t.b].id,i2=cdt.pts[t.c].id;
        if(i0==kBad||i1==kBad||i2==kBad) continue;
        if(i0==i1||i1==i2||i0==i2) continue;
        const Vec3&P0=pool.pts[i0]; const Vec3&P1=pool.pts[i1]; const Vec3&P2=pool.pts[i2];
        Vec3 cen=mul(add(add(P0,P1),P2),1.0/3.0);
        if(!inTri2(proj(cen,drop,kBad,flip),A0,A1,A2)) continue;
        Vec3 sn=cross(sub(P1,P0),sub(P2,P0));
        double scomp=(drop==0)?sn.x:(drop==1)?sn.y:sn.z;
        if((scomp<0.0)!=(ncomp<0.0)) out.push_back({i0,i2,i1});
        else                         out.push_back({i0,i1,i2});
    }
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exact ray-parity point-in-solid (orient3d). +1 inside, -1 outside.
// ─────────────────────────────────────────────────────────────────────────────
int rayParity(const Vec3& pt, const Vec3& dir, const std::vector<TriFace>& solid,
              const std::vector<Vec3>& P, bool& amb){
    amb=false; Vec3 far=add(pt,dir); int cr=0;
    for (auto& f:solid){
        const Vec3&A=P[f.v[0]]; const Vec3&B=P[f.v[1]]; const Vec3&C=P[f.v[2]];
        int sPt=sgn(orient3d(A.x,A.y,A.z,B.x,B.y,B.z,C.x,C.y,C.z, pt.x,pt.y,pt.z));
        int sFar=sgn(orient3d(A.x,A.y,A.z,B.x,B.y,B.z,C.x,C.y,C.z, far.x,far.y,far.z));
        if(sPt==0||sFar==0){ amb=true; return 0; }
        if(sPt==sFar) continue;
        int s1=sgn(orient3d(pt.x,pt.y,pt.z,far.x,far.y,far.z,A.x,A.y,A.z,B.x,B.y,B.z));
        int s2=sgn(orient3d(pt.x,pt.y,pt.z,far.x,far.y,far.z,B.x,B.y,B.z,C.x,C.y,C.z));
        int s3=sgn(orient3d(pt.x,pt.y,pt.z,far.x,far.y,far.z,C.x,C.y,C.z,A.x,A.y,A.z));
        if(s1==0||s2==0||s3==0){ amb=true; return 0; }
        if(s1==s2&&s2==s3) ++cr;
    }
    return (cr&1)?+1:-1;
}

int pointInSolid(const Vec3& pt, const std::vector<TriFace>& solid,
                 const std::vector<Vec3>& P, double extent){
    static const Vec3 dirs[]={
        {1,0,0},{0.7,0.5,0.31},{-0.33,0.91,0.17},{0.41,-0.27,0.87},
        {-0.6,-0.55,0.58},{0.13,0.27,-0.95},{0.91,-0.31,0.27},{-0.71,0.13,-0.69},
        {0.27,-0.83,0.49},{-0.49,-0.21,-0.85}};
    double Lr=4.0*(extent>0?extent:1.0);
    for (const Vec3& d:dirs){ bool a=false; int r=rayParity(pt,mul(d,Lr),solid,P,a); if(!a) return r; }
    return -1;
}

// Coincident-coplanar wall test (exact orient3d + 2D containment). +1 aligned,
// -1 opposed, 0 not coincident. A sub-triangle (its 3 vertices v3[3], centroid
// `cen`, normal `nrm`) is a coincident wall ONLY if ALL THREE of its vertices lie
// EXACTLY on the other face's supporting plane (it is genuinely coplanar with it),
// not merely if its centroid happens to be coplanar — that false positive made a
// proper-crossing sub-triangle whose centroid grazed another plane get mis-kept,
// doubling walls (the count=3/4 edges on rotated INTERSECTION / DIFFERENCE).
int coincidentWall(const std::uint32_t v3[3], const Vec3& cen, const Vec3& nrm,
                   const std::vector<TriFace>& other, const std::vector<Vec3>& P){
    const Vec3&Va=P[v3[0]]; const Vec3&Vb=P[v3[1]]; const Vec3&Vc=P[v3[2]];
    for (auto& fb:other){
        const Vec3&B0=P[fb.v[0]]; const Vec3&B1=P[fb.v[1]]; const Vec3&B2=P[fb.v[2]];
        // require the WHOLE sub-triangle coplanar with this other face's plane.
        if(sgn(orient3d(B0.x,B0.y,B0.z,B1.x,B1.y,B1.z,B2.x,B2.y,B2.z,Va.x,Va.y,Va.z))!=0) continue;
        if(sgn(orient3d(B0.x,B0.y,B0.z,B1.x,B1.y,B1.z,B2.x,B2.y,B2.z,Vb.x,Vb.y,Vb.z))!=0) continue;
        if(sgn(orient3d(B0.x,B0.y,B0.z,B1.x,B1.y,B1.z,B2.x,B2.y,B2.z,Vc.x,Vc.y,Vc.z))!=0) continue;
        double ax=std::fabs(fb.nrm.x),ay=std::fabs(fb.nrm.y),az=std::fabs(fb.nrm.z);
        int drop=(ax>=ay&&ax>=az)?0:(ay>=az?1:2);
        auto pr=[&](const Vec3&p)->V2{ double x,y;
            switch(drop){case 0:x=p.y;y=p.z;break;case 1:x=p.z;y=p.x;break;default:x=p.x;y=p.y;break;}
            return V2{x,y,kBad}; };
        if(!inTri2(pr(cen),pr(B0),pr(B1),pr(B2))) continue;
        return dot(nrm,fb.nrm)>=0.0 ? +1 : -1;
    }
    return 0;
}

// Per-op face selection (mirrors the standard arrangement boolean).
void selectFaces(const std::vector<SubFace>& faces, const std::vector<TriFace>& otherSolid,
                 const std::vector<Vec3>& P, double extent, BoolOpA op, bool primary,
                 std::vector<SubFace>& out){
    bool keepInside, flipW;
    if(op==BoolOpA::UNION){ keepInside=false; flipW=false; }
    else if(op==BoolOpA::INTERSECTION){ keepInside=true; flipW=false; }
    else { keepInside=!primary; flipW=!primary; }
    double push=1e-7*(extent>0?extent:1.0);
    for (auto& f:faces){
        const Vec3&A=P[f.v[0]]; const Vec3&B=P[f.v[1]]; const Vec3&C=P[f.v[2]];
        Vec3 cen=mul(add(add(A,B),C),1.0/3.0);
        Vec3 n=cross(sub(B,A),sub(C,A)); double nl=std::sqrt(norm2(n));
        Vec3 un=(nl>0)?mul(n,1.0/nl):n;
        int cs=coincidentWall(f.v,cen,un,otherSolid,P);
        if(cs!=0){
            if(!primary) continue;
            bool keep=false;
            if(op==BoolOpA::UNION||op==BoolOpA::INTERSECTION) keep=(cs>0);
            else keep=(cs<0);
            if(!keep) continue;
            out.push_back({f.v[0],f.v[1],f.v[2]});
            continue;
        }
        Vec3 probe=(nl>0)?add(cen,mul(un,push)):cen;
        int s=pointInSolid(probe,otherSolid,P,extent);
        bool inside=(s>0);
        if(inside!=keepInside) continue;
        if(flipW) out.push_back({f.v[0],f.v[2],f.v[1]});
        else      out.push_back({f.v[0],f.v[1],f.v[2]});
    }
}

double sceneExtent(const std::vector<double>& a, const std::vector<double>& b){
    Vec3 mn{1e300,1e300,1e300}, mx{-1e300,-1e300,-1e300};
    auto acc=[&](const std::vector<double>& v){ for(std::size_t i=0;i+2<v.size();i+=3){
        mn.x=std::min(mn.x,v[i]); mx.x=std::max(mx.x,v[i]);
        mn.y=std::min(mn.y,v[i+1]); mx.y=std::max(mx.y,v[i+1]);
        mn.z=std::min(mn.z,v[i+2]); mx.z=std::max(mx.z,v[i+2]); } };
    acc(a); acc(b); return std::sqrt(norm2(sub(mx,mn)));
}

// Stitch selected faces into one closed mesh; net-cancel coincident walls; build
// + validate. ok=true ONLY for a genuine closed 2-manifold.
BoolResultA assemble(const std::vector<SubFace>& faces, const std::vector<Vec3>& pool){
    BoolResultA R;
    std::map<std::array<std::uint32_t,3>,int> net;
    std::map<std::array<std::uint32_t,3>,std::array<std::uint32_t,3>> rep;
    auto permSign=[&](std::array<std::uint32_t,3> p)->int{ int sw=0;
        for(int i=0;i<3;++i)for(int j=i+1;j<3;++j) if(p[i]>p[j])++sw; return (sw%2==0)?+1:-1; };
    for (auto& f:faces){ std::uint32_t a=f.v[0],b=f.v[1],c=f.v[2];
        if(a==b||b==c||a==c) continue;
        std::array<std::uint32_t,3> srt{a,b,c}; std::sort(srt.begin(),srt.end());
        net[srt]+=permSign({a,b,c}); if(rep.find(srt)==rep.end()) rep[srt]={a,b,c}; }
    std::vector<SubFace> kept;
    for (auto& kv:net){ if(kv.second==0) continue; auto base=rep[kv.first];
        bool wantPlus=(kv.second>0);
        if((permSign(base)>0)==wantPlus) kept.push_back({base[0],base[1],base[2]});
        else                             kept.push_back({base[0],base[2],base[1]}); }
    if(kept.empty()){ R.ok=false; R.reason="empty result"; return R; }
    std::unordered_map<std::uint32_t,std::uint32_t> remap;
    std::vector<double> pos; std::vector<std::uint32_t> idx;
    auto getv=[&](std::uint32_t id)->std::uint32_t{ auto it=remap.find(id);
        if(it!=remap.end()) return it->second;
        std::uint32_t ni=(std::uint32_t)(pos.size()/3);
        pos.push_back(pool[id].x); pos.push_back(pool[id].y); pos.push_back(pool[id].z);
        remap.emplace(id,ni); return ni; };
    for (auto& f:kept){ idx.push_back(getv(f.v[0])); idx.push_back(getv(f.v[1])); idx.push_back(getv(f.v[2])); }
#ifdef FORGE_BRA_DEBUG
    {
        std::map<std::pair<std::uint32_t,std::uint32_t>,int> ec;
        for (std::size_t f=0; f<idx.size()/3; ++f){
            std::uint32_t a=idx[3*f],b=idx[3*f+1],c=idx[3*f+2];
            auto e=[&](std::uint32_t u,std::uint32_t v){ ec[{std::min(u,v),std::max(u,v)}]++; };
            e(a,b); e(b,c); e(c,a);
        }
        std::printf("[ASM] faces=%zu verts=%zu\n", idx.size()/3, pos.size()/3);
        int bad=0;
        for (auto& kv:ec) if(kv.second!=2){ if(bad<32) std::printf("  edge(%u,%u) count=%d  v0=(%.5f,%.5f,%.5f) v1=(%.5f,%.5f,%.5f)\n",
            kv.first.first,kv.first.second,kv.second,
            pos[3*kv.first.first],pos[3*kv.first.first+1],pos[3*kv.first.first+2],
            pos[3*kv.first.second],pos[3*kv.first.second+1],pos[3*kv.first.second+2]); ++bad; }
        std::printf("[ASM] non-2 edges = %d\n", bad);
    }
#endif
    HalfEdgeMesh m;
    if(!m.buildFromSoup(pos,idx)){ R.ok=false; R.reason="non-manifold result (build failed)"; return R; }
    ValidityReport vr=m.validate();
    if(!vr.isValid()){ R.ok=false; R.reason="result not a closed 2-manifold"; return R; }
    R.ok=true; R.mesh=std::move(m); R.reason="ok";
    return R;
}

} // namespace

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC ENTRY — meshBoolRobust_a
// ═════════════════════════════════════════════════════════════════════════════
BoolResultA meshBoolRobust_a(const std::vector<double>&        aPos,
                             const std::vector<std::uint32_t>& aIdx,
                             const std::vector<double>&        bPos,
                             const std::vector<std::uint32_t>& bIdx,
                             BoolOpA op){
    BoolResultA R;
    if (aIdx.size()<3 || bIdx.size()<3 || aIdx.size()%3 || bIdx.size()%3){
        R.ok=false; R.reason="empty/invalid input soup"; return R;
    }

    double extent = sceneExtent(aPos,bPos);
    double eps = 1e-9 * (extent>0?extent:1.0);

    // Shared pool + faces (original corners welded by exact coordinate).
    Pool pool;
    std::vector<TriFace> A = ingest(aPos,aIdx,pool);
    std::vector<TriFace> B = ingest(bPos,bIdx,pool);

    // Canonical plane ids: all coplanar faces (across BOTH meshes) share one id,
    // so a cut point keyed by (edge, planeId) is unique — no coincident-but-
    // distinct vertices from two coplanar faces producing two keys. THIS is what
    // removes the within-face T-junction that broke prior attempts on rotated /
    // tilted cubes (the cut polyline meets identical vertices on both surfaces).
    PlaneRegistry planes;
    for (auto& f : A) f.planeId = planes.classify({f.v[0],f.v[1],f.v[2]}, pool.pts);
    for (auto& f : B) f.planeId = planes.classify({f.v[0],f.v[1],f.v[2]}, pool.pts);

    // Per-face constraint segment lists (shared ids), one bucket per A-face and
    // per B-face. Built by walking every AABB-overlapping pair ONCE and feeding
    // the SAME shared cut to both faces.
    std::vector<std::vector<std::array<std::uint32_t,2>>> aSegs(A.size()), bSegs(B.size());

    for (std::size_t i=0;i<A.size();++i){
        const TriFace& fa=A[i];
        double fax=std::fabs(fa.nrm.x),fay=std::fabs(fa.nrm.y),faz=std::fabs(fa.nrm.z);
        int adrop=(fax>=fay&&fax>=faz)?0:(fay>=faz?1:2);
        double ancomp=(adrop==0)?fa.nrm.x:(adrop==1)?fa.nrm.y:fa.nrm.z; bool aflip=(ancomp<0.0);
        for (std::size_t j=0;j<B.size();++j){
            const TriFace& fb=B[j];
            if(!aabbOverlap(fa.bbMin,fa.bbMax,fb.bbMin,fb.bbMax,eps)) continue;
            bool coplanar=false; CutSeg cs;
            if (sharedCut(fa.v,fa.planeId, fb.v,fb.planeId, pool,coplanar,cs)){
                aSegs[i].push_back({cs.s0,cs.s1});
                bSegs[j].push_back({cs.s0,cs.s1});   // SAME shared ids on both
            } else if (coplanar){
                // imprint the coplanar overlap boundary on BOTH faces (shared ids)
                std::vector<std::array<std::uint32_t,2>> ov;
                coplanarOverlap(fa.v,fb.v,pool,adrop,aflip,ov);
                for (auto& e:ov){ aSegs[i].push_back(e); bSegs[j].push_back(e); }
            }
        }
    }

    // GLOBAL coincident-vertex unification (the within-face T-junction fix).
    // Map every cut-vertex id to its coincidence-group minimum, uniformly across
    // ALL faces, then rewrite every segment. Also canonicalize the face corners
    // (a cut vertex can coincide with an original corner). After this, the shared
    // cut polyline has IDENTICAL ids on A and B, and no face carries two distinct
    // ids at one point.
    {
        std::unordered_map<std::uint32_t,std::uint32_t> canon =
            canonicalizeCoincident(aSegs, bSegs, pool.pts, extent);
        auto cv=[&](std::uint32_t id)->std::uint32_t{
            auto it=canon.find(id); return it!=canon.end()? it->second : id; };
        auto rewrite=[&](std::vector<std::vector<std::array<std::uint32_t,2>>>& S){
            for (auto& v:S){
                std::vector<std::array<std::uint32_t,2>> out;
                for (auto& s:v){ std::uint32_t u=cv(s[0]), w=cv(s[1]); if(u!=w) out.push_back({u,w}); }
                v.swap(out);
            } };
        rewrite(aSegs); rewrite(bSegs);
        for (auto& f:A){ f.v[0]=cv(f.v[0]); f.v[1]=cv(f.v[1]); f.v[2]=cv(f.v[2]); }
        for (auto& f:B){ f.v[0]=cv(f.v[0]); f.v[1]=cv(f.v[1]); f.v[2]=cv(f.v[2]); }
    }

    // ── ADJACENT-FACE EDGE CONSISTENCY ───────────────────────────────────────
    // A cut point can land exactly ON a shared mesh EDGE of two same-mesh faces
    // (e.g. where the other solid's face, or its internal triangulation diagonal,
    // pierces that edge). BOTH adjacent faces must split there, else one keeps a
    // T-junction → non-manifold. We collect, per mesh, every cut vertex that lies
    // on each undirected mesh edge, and hand each face the list of on-its-boundary
    // points to force into its CDT (so addBoundary chains through them on BOTH
    // sides). This closes the adjacent-face seam for general rotated/tilted cuts.
    auto buildEdgePoints = [&](const std::vector<TriFace>& F,
                               const std::vector<std::vector<std::array<std::uint32_t,2>>>& segs,
                               std::vector<std::vector<std::uint32_t>>& facePts){
        facePts.assign(F.size(), {});
        // map: undirected original edge (minId,maxId) -> set of on-edge point ids.
        std::map<std::pair<std::uint32_t,std::uint32_t>, std::vector<std::uint32_t>> edgePts;
        // gather all cut points referenced anywhere in this mesh's segs.
        std::vector<std::uint32_t> pts;
        for (auto& v:segs) for (auto& s:v){ pts.push_back(s[0]); pts.push_back(s[1]); }
        std::sort(pts.begin(),pts.end()); pts.erase(std::unique(pts.begin(),pts.end()),pts.end());
        // for each original edge of each face, find which collected points lie on it
        // (exact collinear by orient3d-as-area=0 in 3D via cross-product ~0, plus
        // strictly between the endpoints). Record under the undirected edge key.
        for (auto& f:F){
            for (int e=0;e<3;++e){
                std::uint32_t u=f.v[e], w=f.v[(e+1)%3];
                auto key=std::make_pair(std::min(u,w),std::max(u,w));
                if (edgePts.count(key)) continue;            // already done this edge
                const Vec3 U=pool.pts[u], W=pool.pts[w];
                Vec3 d=sub(W,U); double L2=norm2(d);
                std::vector<std::uint32_t> on;
                for (std::uint32_t pid:pts){ if(pid==u||pid==w)continue;
                    Vec3 q=sub(pool.pts[pid],U);
                    // collinear if cross(d,q) ~ 0 relative to L2, and 0<t<1.
                    Vec3 c=cross(d,q); if (norm2(c) > 1e-18*L2*L2) continue;
                    double t=dot(q,d)/(L2>0?L2:1.0);
                    if (t>1e-9 && t<1.0-1e-9) on.push_back(pid);
                }
                edgePts[key]=on;
            }
        }
        for (std::size_t i=0;i<F.size();++i){
            for (int e=0;e<3;++e){
                std::uint32_t u=F[i].v[e], w=F[i].v[(e+1)%3];
                auto key=std::make_pair(std::min(u,w),std::max(u,w));
                auto it=edgePts.find(key);
                if(it==edgePts.end()) continue;
                for (std::uint32_t pid:it->second) facePts[i].push_back(pid);
            }
        }
    };
    std::vector<std::vector<std::uint32_t>> aEdgePts, bEdgePts;
    buildEdgePoints(A, aSegs, aEdgePts);
    buildEdgePoints(B, bSegs, bEdgePts);

    // Re-triangulate every cut face of A and B.
    std::vector<SubFace> aSub, bSub;
    for (std::size_t i=0;i<A.size();++i)
        if(!retriangulate(A[i],aSegs[i],aEdgePts[i],pool,aSub)){ R.ok=false; R.reason="CDT failure on A face (honest)"; return R; }
    for (std::size_t j=0;j<B.size();++j)
        if(!retriangulate(B[j],bSegs[j],bEdgePts[j],pool,bSub)){ R.ok=false; R.reason="CDT failure on B face (honest)"; return R; }

    // Classify + select per op. Re-extract TriFace views over the imprinted sub-
    // triangles only for the IN/OUT solids (we test against the ORIGINAL closed
    // solids A and B, which are unchanged closed manifolds — exact ray parity).
    std::vector<SubFace> selected;
    selectFaces(aSub, B, pool.pts, extent, op, /*primary=*/true,  selected);
    selectFaces(bSub, A, pool.pts, extent, op, /*primary=*/false, selected);

    // Stitch + validate (honest ok).
    R = assemble(selected, pool.pts);
    return R;
}

} // namespace mesh
} // namespace native
} // namespace forge
