// forge/native/mesh/MeshBoolean2.cpp
//
// GENERAL mesh boolean (union / intersection / difference). See
// forge/native/mesh/MeshBoolean2.hpp for the honest scope + robustness ceiling.
//
// This file is NEW; it does NOT modify the plane-clip-only MeshBoolean.cpp.
// It reuses, by #include only (no duplicate types / predicates):
//   * forge/native/mesh/HalfEdgeMesh.hpp   (Vec3, HalfEdgeMesh, validate)
//   * forge/native/mesh/TriTriIntersect.hpp(exact triangle-triangle segments)
//   * forge/native/Predicates.hpp          (exact orient3d / orient2d)
//
// Pure C++20, no external dependencies.

#include "forge/native/mesh/MeshBoolean2.hpp"
#include "forge/native/mesh/TriTriIntersect.hpp"
#include "forge/native/Predicates.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstddef>
#include <map>
#include <unordered_map>
#include <vector>
#ifdef FORGE_MB2_DEBUG
#include <cstdio>
#endif

namespace forge {
namespace native {
namespace mesh {

namespace {

// ----------------------------------------------------------------------------
// tiny double-vector helpers (private scratch; the public type stays Vec3)
// ----------------------------------------------------------------------------
inline Vec3 sub(const Vec3& a, const Vec3& b) { return {a.x-b.x, a.y-b.y, a.z-b.z}; }
inline Vec3 add(const Vec3& a, const Vec3& b) { return {a.x+b.x, a.y+b.y, a.z+b.z}; }
inline Vec3 mul(const Vec3& a, double s)      { return {a.x*s, a.y*s, a.z*s}; }
inline double dot(const Vec3& a, const Vec3& b){ return a.x*b.x + a.y*b.y + a.z*b.z; }
inline Vec3 cross(const Vec3& a, const Vec3& b){
    return { a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x };
}
inline double norm2(const Vec3& a){ return dot(a,a); }

inline int sgn(Sign s) { return signValue(s); }

// ----------------------------------------------------------------------------
// Snap / weld grid. New intersection vertices are quantized onto a uniform grid
// (cell = kWeld * sceneExtent) so a point produced twice — once on A's cut and
// once on B's cut — lands on the SAME welded vertex. This is the snap-rounding
// that makes the two surfaces meet along a shared polyline (robust-in-practice;
// NOT CGAL-exact). Welding is keyed on the SNAPPED coordinate.
// ----------------------------------------------------------------------------
constexpr double kWeld = 1e-9;   // relative weld quantum

struct VertexPool {
    std::vector<Vec3>                          pts;
    std::unordered_map<std::uint64_t, std::uint32_t> grid; // snapped-cell -> id
    double inv = 1.0; // 1 / (kWeld * extent)

    void setScale(double extent) { inv = 1.0 / (kWeld * (extent > 0.0 ? extent : 1.0)); }

    static std::uint64_t mix(std::int64_t a, std::int64_t b, std::int64_t c) {
        // order-independent? no — order matters; deterministic 3-coord hash.
        std::uint64_t h = 1469598103934665603ull;
        auto put = [&](std::int64_t v){
            std::uint64_t u = static_cast<std::uint64_t>(v);
            for (int i=0;i<8;++i){ h ^= (u & 0xFF); h *= 1099511628211ull; u >>= 8; }
        };
        put(a); put(b); put(c);
        return h;
    }

    std::uint32_t add(const Vec3& p) {
        std::int64_t ix = static_cast<std::int64_t>(std::llround(p.x * inv));
        std::int64_t iy = static_cast<std::int64_t>(std::llround(p.y * inv));
        std::int64_t iz = static_cast<std::int64_t>(std::llround(p.z * inv));
        std::uint64_t key = mix(ix, iy, iz);
        auto it = grid.find(key);
        if (it != grid.end()) return it->second;
        std::uint32_t id = static_cast<std::uint32_t>(pts.size());
        // Store the snapped coordinate so every reference to this weld id is
        // bit-identical (a shared exact vertex), which keeps the two surfaces
        // stitch-coincident.
        pts.push_back(Vec3{ static_cast<double>(ix) / inv,
                            static_cast<double>(iy) / inv,
                            static_cast<double>(iz) / inv });
        grid.emplace(key, id);
        return id;
    }
};

// ----------------------------------------------------------------------------
// 2D constrained triangulation of one triangle that received intersection
// segments. We work in the triangle's dominant-axis projection (drop the
// largest |normal| coordinate) so the 2D problem is non-degenerate, run a
// constrained Delaunay triangulation (Bowyer-Watson incremental insert +
// constraint-edge recovery by flips), then lift the resulting 2D triangles back
// to 3D and keep the original triangle's winding.
// ----------------------------------------------------------------------------
struct V2 { double x, y; std::uint32_t id; };  // id = weld-pool index (3D vertex)

inline int orient2dSign(const V2& a, const V2& b, const V2& c) {
    return sgn(orient2d(a.x,a.y, b.x,b.y, c.x,c.y));
}
inline int inCircleSign(const V2& a, const V2& b, const V2& c, const V2& d) {
    // incircle expects a,b,c CCW; caller passes CCW triangles.
    return sgn(incircle(a.x,a.y, b.x,b.y, c.x,c.y, d.x,d.y));
}

inline V2 project2D(const Vec3& p, int drop, std::uint32_t id, bool flip) {
    // `flip` keeps the projected winding CCW-consistent with the 3D normal so
    // the lifted triangles inherit the correct orientation.
    double x, y;
    switch (drop) {
        case 0:  x = p.y; y = p.z; break;   // dropped X
        case 1:  x = p.z; y = p.x; break;   // dropped Y
        default: x = p.x; y = p.y; break;   // dropped Z
    }
    if (flip) std::swap(x, y);
    return V2{ x, y, id };
}

// A triangle in the 2D CDT, as indices into a local point array.
struct Tri2 { int a, b, c; };

// Robust point-in-triangle (closed) using exact orient2d. Returns true if p is
// inside or on triangle (t0,t1,t2) of either winding.
inline bool inTri2(const V2& p, const V2& t0, const V2& t1, const V2& t2) {
    int s0 = orient2dSign(t0, t1, p);
    int s1 = orient2dSign(t1, t2, p);
    int s2 = orient2dSign(t2, t0, p);
    bool hasNeg = (s0 < 0) || (s1 < 0) || (s2 < 0);
    bool hasPos = (s0 > 0) || (s1 > 0) || (s2 > 0);
    return !(hasNeg && hasPos);
}

// Constrained Delaunay triangulation of a set of 2D points known to lie inside
// (or on) one super-triangle (the original triangle corners are points 0,1,2),
// honoring a set of constraint edges. Returns triangles as index triples into
// `pts`. Robust-in-practice (orient2d/incircle exact).
struct CDT {
    std::vector<V2> pts;
    std::vector<std::array<int,2>> constraints; // required edges (i<j by id usage)
    std::vector<Tri2> tris;

    // DOMAIN-based incremental Delaunay (no super-triangle). The domain IS the
    // triangle whose corners are points 0,1,2; every other point lies inside or
    // on it. We seed with that single triangle (made CCW) and insert each further
    // point by point-location + split (1->3 inside, or split the two edge-adjacent
    // triangles when on an edge) followed by Lawson edge-legalization. Then we
    // enforce the constraint edges by flips. This avoids the super-triangle
    // cavity pathologies entirely. All sidedness/incircle via exact predicates.
    bool build() {
        const int n = static_cast<int>(pts.size());
        if (n < 3) return false;

        // Seed triangle = corners 0,1,2, oriented CCW.
        tris.clear();
        if (orient2dSign(pts[0],pts[1],pts[2])>0) tris.push_back(Tri2{0,1,2});
        else                                      tris.push_back(Tri2{0,2,1});

        for (int ip=3; ip<n; ++ip) {
            const V2& P = pts[ip];
            // skip exact 2D duplicate of an already-present point.
            bool dup=false;
            for (int q=0;q<ip;++q) if (pts[q].x==P.x && pts[q].y==P.y){ dup=true; break; }
            if (dup) continue;
            insertPoint(ip);
        }

        // Enforce constraint edges (boundary + imprinted segments) by flips.
        if (!recoverConstraints()) return false;
        // Final defensive compaction (remove any deleted slots).
        std::vector<Tri2> kept;
        for (auto& t : tris) if (t.a>=0) kept.push_back(t);
        tris.swap(kept);
        return true;
    }

    // Insert point ip by locating its containing triangle and splitting, then
    // legalizing the affected edges (Lawson). Returns false only on a hard
    // location failure (point outside the domain — should not happen).
    bool insertPoint(int ip) {
        V2 P = pts[ip];
        int host=-1, ea=-1, eb=-1;
        for (int t=0;t<static_cast<int>(tris.size());++t){
            if (tris[t].a<0) continue;
            int v[3]={tris[t].a,tris[t].b,tris[t].c};
            int s0=orient2dSign(pts[v[0]],pts[v[1]],P);
            int s1=orient2dSign(pts[v[1]],pts[v[2]],P);
            int s2=orient2dSign(pts[v[2]],pts[v[0]],P);
            bool neg=(s0<0)||(s1<0)||(s2<0);
            bool pos=(s0>0)||(s1>0)||(s2>0);
            if (neg&&pos) continue;             // outside this triangle
            host=t;
            if (s0==0){ ea=v[0]; eb=v[1]; }
            else if (s1==0){ ea=v[1]; eb=v[2]; }
            else if (s2==0){ ea=v[2]; eb=v[0]; }
            break;
        }
        if (host<0) {
            // Tolerant fallback: a constraint endpoint computed in double
            // precision can land a hair OUTSIDE the domain triangle. Locate the
            // closest triangle edge and project the point exactly onto it, then
            // treat it as an on-edge insertion. The 3D weld id is unchanged (so
            // the lifted position stays welded with the neighbour face); only the
            // 2D triangulation coordinate is clamped. This is the snap-rounding
            // ceiling — robust-in-practice.
            double bestD=1e300; int bt=-1, ba=-1, bb=-1; V2 bestProj{};
            for (int t=0;t<static_cast<int>(tris.size());++t){
                if (tris[t].a<0) continue;
                int v[3]={tris[t].a,tris[t].b,tris[t].c};
                for (int k=0;k<3;++k){
                    const V2& U=pts[v[k]]; const V2& W=pts[v[(k+1)%3]];
                    double dx=W.x-U.x, dy=W.y-U.y, L2=dx*dx+dy*dy;
                    if (L2<=0) continue;
                    double tt=((P.x-U.x)*dx+(P.y-U.y)*dy)/L2;
                    tt=std::max(0.0,std::min(1.0,tt));
                    double px=U.x+tt*dx, py=U.y+tt*dy;
                    double d=std::hypot(P.x-px,P.y-py);
                    if (d<bestD){ bestD=d; bt=t; ba=v[k]; bb=v[(k+1)%3]; bestProj={px,py,P.id}; }
                }
            }
            if (bt<0) return false;
            // overwrite the stored coordinate with the clamped projection.
            pts[ip].x=bestProj.x; pts[ip].y=bestProj.y;
            P=pts[ip];
            // recompute on-edge status against the chosen edge.
            host=bt; ea=ba; eb=bb;
            // if the projection landed at a vertex, it's a duplicate -> skip.
            if ((P.x==pts[ba].x&&P.y==pts[ba].y)||(P.x==pts[bb].x&&P.y==pts[bb].y)) return true;
        }

        std::vector<std::array<int,2>> toLegalize;
        if (ea<0) {
            // Strictly inside: 1 -> 3 split.
            int a=tris[host].a,b=tris[host].b,c=tris[host].c;
            tris[host]=Tri2{a,b,ip};
            tris.push_back(Tri2{b,c,ip});
            tris.push_back(Tri2{c,a,ip});
            toLegalize.push_back({a,b}); toLegalize.push_back({b,c}); toLegalize.push_back({c,a});
        } else {
            // On edge (ea,eb): split BOTH triangles sharing that edge (2 -> 4).
            std::vector<int> incident;
            for (int t=0;t<static_cast<int>(tris.size());++t){
                if (tris[t].a<0) continue;
                int v[3]={tris[t].a,tris[t].b,tris[t].c};
                bool ha=false,hb=false;
                for(int k=0;k<3;++k){ if(v[k]==ea)ha=true; if(v[k]==eb)hb=true; }
                if (ha&&hb) incident.push_back(t);
            }
            for (int t : incident){
                int apx=apex(tris[t],ea,eb);
                if (apx<0) continue;
                // replace t with (ea,apx,ip)?? keep CCW: original tri winding.
                int a=tris[t].a,b=tris[t].b,c=tris[t].c;
                // Rebuild as two tris splitting edge (ea,eb) at ip, preserving CCW.
                // Find the cyclic order and substitute.
                int cyc[3]={a,b,c};
                // locate ea,eb consecutive in cyc.
                tris[t]=Tri2{-1,-1,-1};
                for (int k=0;k<3;++k){
                    int x=cyc[k], y=cyc[(k+1)%3], z=cyc[(k+2)%3];
                    if ((x==ea&&y==eb)||(x==eb&&y==ea)){
                        tris.push_back(Tri2{x,ip,z});
                        tris.push_back(Tri2{ip,y,z});
                        break;
                    }
                }
                toLegalize.push_back({ea,apx}); toLegalize.push_back({eb,apx});
            }
        }
        // Lawson legalization of the affected edges.
        legalize(toLegalize, ip);
        return true;
    }

    // Lawson: for each edge incident to the new point's surrounding, if the
    // opposite vertex of the adjacent triangle is inside the circumcircle, flip.
    void legalize(std::vector<std::array<int,2>> stack, int ip) {
        int guard=0;
        while (!stack.empty()) {
            if (++guard > 50000) break; // defensive
            auto e=stack.back(); stack.pop_back();
            int a=e[0], b=e[1];
            // find the two triangles sharing (a,b); one should contain ip.
            int t0=-1,t1=-1;
            for (int t=0;t<static_cast<int>(tris.size());++t){
                if (tris[t].a<0) continue;
                int v[3]={tris[t].a,tris[t].b,tris[t].c};
                bool ha=false,hb=false; for(int k=0;k<3;++k){if(v[k]==a)ha=true;if(v[k]==b)hb=true;}
                if (ha&&hb){ if(t0<0)t0=t; else t1=t; }
            }
            if (t0<0||t1<0) continue; // boundary edge
            int p=apex(tris[t0],a,b), q=apex(tris[t1],a,b);
            if (p<0||q<0||p==q) continue;
            int newp = (p==ip)?p:((q==ip)?q:-1);
            if (newp<0) continue;        // neither triangle has the new point
            int other = (newp==p)?q:p;   // the far apex
            // Is `other` inside circumcircle of (a,b,newp)? Need CCW order.
            const V2& A=pts[a]; const V2& B=pts[b]; const V2& Np=pts[newp];
            int o=orient2dSign(A,B,Np);
            int inc;
            if (o>0) inc=inCircleSign(A,B,Np,pts[other]);
            else if (o<0) inc=inCircleSign(A,Np,B,pts[other]);
            else continue;               // degenerate
            if (inc>0) {
                // illegal -> flip (a,b) to (newp,other), if convex quad.
                int pa=orient2dSign(pts[newp],pts[other],A);
                int pb=orient2dSign(pts[newp],pts[other],B);
                if (pa==0||pb==0||pa==pb) continue; // not a convex flip
                tris[t0]=Tri2{a,newp,other};
                tris[t1]=Tri2{newp,b,other};
                stack.push_back({a,other});
                stack.push_back({other,b});
            }
        }
    }

    // Is edge (u,v) present as a triangle edge?
    bool hasEdge(int u, int v) const {
        for (const auto& t : tris) {
            if ((t.a==u&&t.b==v)||(t.b==u&&t.c==v)||(t.c==u&&t.a==v)||
                (t.a==v&&t.b==u)||(t.b==v&&t.c==u)||(t.c==v&&t.a==u)) return true;
        }
        return false;
    }

    // Recover every required constraint edge by Sloan flip-recovery. Because the
    // constraints have been pre-split into a NON-CROSSING arrangement (segments
    // split at mutual crossings; boundary split at on-edge points), each required
    // edge crosses only DIAGONALS of the current triangulation, never another
    // constraint — so flipping those diagonals is guaranteed to terminate and
    // recover the edge. Any edge already split by an intermediate collinear vertex
    // is recovered as the chain of sub-edges instead.
    bool recoverConstraints() {
        // de-duplicate constraints (sorted endpoints).
        for (auto& c : constraints) {
            int u=c[0], v=c[1];
            if (u==v) continue;
            if (hasEdge(u,v)) continue;
            // A collinear vertex on (u,v) means it is represented as a chain.
            if (segmentCoveredByVerts(u,v)) continue;
            if (!recoverEdgeByFlips(u,v)) {
#ifdef FORGE_MB2_DEBUG
                std::printf("[CDT] FAIL recover constraint (%d,%d) of %zu pts, %zu cons\n",
                            u,v,pts.size(),constraints.size());
                for (int i=0;i<(int)pts.size();++i)
                    std::printf("    pt[%d]=(%.6f,%.6f) id=%u\n", i, pts[i].x, pts[i].y, pts[i].id);
                for (auto& cc : constraints)
                    std::printf("    cons (%d,%d)\n", cc[0], cc[1]);
                for (int t=0;t<(int)tris.size();++t) if (tris[t].a>=0)
                    std::printf("    tri (%d,%d,%d)\n", tris[t].a,tris[t].b,tris[t].c);
#endif
                return false; // honest, non-recoverable
            }
        }
        return true;
    }

    // Sloan: collect the diagonals crossing (u,v) and flip them until (u,v) exists.
    bool recoverEdgeByFlips(int u, int v) {
        const V2& U=pts[u]; const V2& Vv=pts[v];
        int guard = 0;
        const int maxIter = 8*static_cast<int>(tris.size())+200;
        while (!hasEdge(u,v)) {
            if (++guard > maxIter) return false;
            // Build edge->(two triangles) adjacency for diagonals crossing (u,v).
            std::map<std::pair<int,int>, std::array<int,2>> adj;
            for (int t=0;t<static_cast<int>(tris.size());++t){
                if (tris[t].a<0) continue;
                std::array<std::array<int,2>,3> es={{
                    {tris[t].a,tris[t].b},{tris[t].b,tris[t].c},{tris[t].c,tris[t].a}}};
                for (auto& e:es){
                    auto key=std::make_pair(std::min(e[0],e[1]),std::max(e[0],e[1]));
                    auto it=adj.find(key);
                    if (it==adj.end()) adj[key]={t,-1};
                    else it->second[1]=t;
                }
            }
            bool flipped=false;
            for (auto& kv : adj) {
                if (kv.second[1]<0) continue;          // boundary edge
                int a=kv.first.first, b=kv.first.second;
                if (a==u||a==v||b==u||b==v) continue;  // shares an endpoint, can't block
                int o1=orient2dSign(U,Vv,pts[a]);
                int o2=orient2dSign(U,Vv,pts[b]);
                int o3=orient2dSign(pts[a],pts[b],U);
                int o4=orient2dSign(pts[a],pts[b],Vv);
                bool crosses=(o1!=0&&o2!=0&&o3!=0&&o4!=0)&&(o1!=o2)&&(o3!=o4);
                if (!crosses) continue;
                int t0=kv.second[0], t1=kv.second[1];
                int p=apex(tris[t0],a,b), q=apex(tris[t1],a,b);
                if (p<0||q<0||p==q) continue;
                // Flip only if (a,p,b,q) is a strictly-convex quad (so (p,q) is a
                // valid diagonal); else skip — another crossing diagonal will be
                // flipped first (Sloan re-queue, here just the next loop pass).
                int pa=orient2dSign(pts[p],pts[q],pts[a]);
                int pb=orient2dSign(pts[p],pts[q],pts[b]);
                int ap=orient2dSign(pts[a],pts[b],pts[p]);
                int aq=orient2dSign(pts[a],pts[b],pts[q]);
                if (pa==0||pb==0||ap==0||aq==0) continue;
                if (pa==pb || ap==aq) continue;        // non-convex quad
                tris[t0]=Tri2{a,p,q};
                tris[t1]=Tri2{b,q,p};
                flipped=true;
                break;
            }
            if (!flipped) return false; // no flippable crossing diagonal -> stuck
        }
        return true;
    }

    // True if the straight segment (u,v) is covered by collinear intermediate
    // pts forming a chain of existing edges (constraint split by a midpoint).
    bool segmentCoveredByVerts(int u, int v) const {
        const V2& U=pts[u]; const V2& V=pts[v];
        std::vector<std::pair<double,int>> on;
        on.push_back({0.0,u}); on.push_back({1.0,v});
        double dx=V.x-U.x, dy=V.y-U.y, L2=dx*dx+dy*dy;
        if (L2==0.0) return false;
        for (int i=0;i<static_cast<int>(pts.size());++i){
            if (pts[i].id==kInvalid) continue;
            if (i==u||i==v) continue;
            if (orient2dSign(U,V,pts[i])!=0) continue; // exact collinear only
            double t=((pts[i].x-U.x)*dx+(pts[i].y-U.y)*dy)/L2;
            if (t>0.0 && t<1.0) on.push_back({t,i});
        }
        if (on.size()<=2) return false;                 // no intermediate vertex
        std::sort(on.begin(), on.end());
        for (size_t i=0;i+1<on.size();++i)
            if (!hasEdge(on[i].second, on[i+1].second)) return false;
        return true;
    }

    static int apex(const Tri2& t, int a, int b) {
        // Return the vertex of t that is not a and not b (t must contain both).
        if (t.a!=a && t.a!=b) { if ((t.b==a&&t.c==b)||(t.b==b&&t.c==a)) return t.a; }
        if (t.b!=a && t.b!=b) { if ((t.a==a&&t.c==b)||(t.a==b&&t.c==a)) return t.b; }
        if (t.c!=a && t.c!=b) { if ((t.a==a&&t.b==b)||(t.a==b&&t.b==a)) return t.c; }
        return -1;
    }
};

// ----------------------------------------------------------------------------
// One mesh prepared for booleaning: welded vertices + faces (as weld ids) +
// per-face plane + AABB. Faces are the ORIGINAL triangles (pre-imprint).
// ----------------------------------------------------------------------------
struct PreparedFace {
    std::uint32_t v[3];        // weld-pool vertex ids
    Vec3 nrm;                  // un-normalized normal (a1-a0)x(a2-a0)
    Vec3 bbMin, bbMax;
};

struct Prepared {
    std::vector<PreparedFace> faces;
};

// Build a Prepared from a soup, welding every vertex into the shared pool.
Prepared prepare(const std::vector<double>& pos,
                 const std::vector<std::uint32_t>& idx,
                 VertexPool& pool) {
    Prepared P;
    const std::size_t nf = idx.size()/3;
    P.faces.reserve(nf);
    for (std::size_t f=0; f<nf; ++f) {
        Vec3 p0{pos[3*idx[3*f+0]+0], pos[3*idx[3*f+0]+1], pos[3*idx[3*f+0]+2]};
        Vec3 p1{pos[3*idx[3*f+1]+0], pos[3*idx[3*f+1]+1], pos[3*idx[3*f+1]+2]};
        Vec3 p2{pos[3*idx[3*f+2]+0], pos[3*idx[3*f+2]+1], pos[3*idx[3*f+2]+2]};
        PreparedFace pf;
        pf.v[0]=pool.add(p0); pf.v[1]=pool.add(p1); pf.v[2]=pool.add(p2);
        pf.nrm = cross(sub(p1,p0), sub(p2,p0));
        pf.bbMin = { std::min({p0.x,p1.x,p2.x}), std::min({p0.y,p1.y,p2.y}), std::min({p0.z,p1.z,p2.z}) };
        pf.bbMax = { std::max({p0.x,p1.x,p2.x}), std::max({p0.y,p1.y,p2.y}), std::max({p0.z,p1.z,p2.z}) };
        P.faces.push_back(pf);
    }
    return P;
}

inline bool aabbOverlap(const Vec3& aMin,const Vec3& aMax,
                        const Vec3& bMin,const Vec3& bMax, double eps) {
    return aMin.x<=bMax.x+eps && aMax.x>=bMin.x-eps &&
           aMin.y<=bMax.y+eps && aMax.y>=bMin.y-eps &&
           aMin.z<=bMax.z+eps && aMax.z>=bMin.z-eps;
}

// ----------------------------------------------------------------------------
// Coplanar overlap polygon. Two triangles A,B lie in the SAME plane and their
// 2D regions overlap. We clip A against B (Sutherland-Hodgman, both wound CCW
// in the dominant-axis projection) and return the boundary edges of the
// resulting convex overlap polygon, lifted back to 3D. These boundary edges are
// imprinted as constraints so the coincident-coplanar region is bounded
// exactly, then resolved by the coincident-wall rule in assemble(). This is the
// honest coplanar-contact handling (robust-in-practice) that replaces the
// earlier blanket TARGETED bail for the common axis-aligned case.
// ----------------------------------------------------------------------------
struct PolyPt { double x, y; Vec3 p3; };

inline int side2(const PolyPt& a, const PolyPt& b, const PolyPt& c) {
    return sgn(orient2d(a.x,a.y, b.x,b.y, c.x,c.y));
}

// Clip convex/simple polygon `poly` by the half-plane LEFT of directed edge
// (e0->e1) (keep points with orient2d(e0,e1,p) >= 0).
void clipHalf(std::vector<PolyPt>& poly, const PolyPt& e0, const PolyPt& e1) {
    if (poly.empty()) return;
    std::vector<PolyPt> res;
    const int N = static_cast<int>(poly.size());
    for (int i=0;i<N;++i){
        const PolyPt& cur = poly[i];
        const PolyPt& nxt = poly[(i+1)%N];
        int sc = side2(e0,e1,cur);
        int sn = side2(e0,e1,nxt);
        if (sc>=0) res.push_back(cur);
        if ((sc>0 && sn<0) || (sc<0 && sn>0)) {
            // intersect edge cur->nxt with line e0->e1 (double-precision coords)
            double a1=e1.y-e0.y, b1=e0.x-e1.x, c1=a1*e0.x+b1*e0.y;
            double a2=nxt.y-cur.y, b2=cur.x-nxt.x, c2=a2*cur.x+b2*cur.y;
            double det=a1*b2-a2*b1;
            if (det!=0.0){
                double X=(c1*b2-c2*b1)/det, Y=(a1*c2-a2*c1)/det;
                // interpolate 3D point along cur->nxt by the 2D parameter
                double dx=nxt.x-cur.x, dy=nxt.y-cur.y, L2=dx*dx+dy*dy;
                double t = L2>0.0 ? ((X-cur.x)*dx+(Y-cur.y)*dy)/L2 : 0.0;
                Vec3 p3 = add(cur.p3, mul(sub(nxt.p3,cur.p3), t));
                res.push_back(PolyPt{X,Y,p3});
            }
        }
    }
    poly.swap(res);
}

// Return the boundary edges (as 3D segment pairs) of the overlap of coplanar
// triangles A=(a0,a1,a2) and B=(b0,b1,b2). `drop`/`flip` define the shared 2D
// projection. Empty if the overlap degenerates to a point/segment.
std::vector<std::array<Vec3,2>> coplanarOverlapEdges(
        const Vec3& a0,const Vec3& a1,const Vec3& a2,
        const Vec3& b0,const Vec3& b1,const Vec3& b2,
        int drop, bool flip) {
    auto pr=[&](const Vec3& p)->PolyPt{
        double x,y;
        switch(drop){case 0:x=p.y;y=p.z;break;case 1:x=p.z;y=p.x;break;default:x=p.x;y=p.y;break;}
        if (flip) std::swap(x,y);
        return PolyPt{x,y,p};
    };
    PolyPt A0=pr(a0),A1=pr(a1),A2=pr(a2);
    PolyPt B0=pr(b0),B1=pr(b1),B2=pr(b2);
    // ensure both clip subject (A) and clip window (B) are CCW.
    std::vector<PolyPt> poly={A0,A1,A2};
    if (side2(A0,A1,A2)<0) std::reverse(poly.begin(),poly.end());
    std::array<PolyPt,3> W={B0,B1,B2};
    if (side2(B0,B1,B2)<0) std::swap(W[1],W[2]);
    // clip A by each CCW edge of B (keep left side).
    clipHalf(poly, W[0], W[1]);
    clipHalf(poly, W[1], W[2]);
    clipHalf(poly, W[2], W[0]);
    std::vector<std::array<Vec3,2>> edges;
    const int M=static_cast<int>(poly.size());
    if (M<3) return edges; // overlap is a point/segment -> no area patch
    for (int i=0;i<M;++i){
        const Vec3& p=poly[i].p3; const Vec3& q=poly[(i+1)%M].p3;
        if (norm2(sub(p,q))>0.0) edges.push_back({p,q});
    }
    return edges;
}

// ----------------------------------------------------------------------------
// EXACT ray-cast parity point-in-solid. Returns +1 inside, -1 outside.
// Cast a ray from `pt` along `dir` (need not be unit) and count crossings with
// the closed mesh `solid` (faces given as weld-id triples into `pool.pts`). Each
// crossing is decided by exact orient3d signs (the ray's two endpoints far apart
// straddle the triangle plane, and the point projects inside the triangle by 3
// orient3d half-space tests). If the ray grazes an edge/vertex (an orient3d
// ZERO appears in a decisive test), we signal `ambiguous` and the caller re-casts
// with a different direction. This makes the parity exact-in-practice.
// ----------------------------------------------------------------------------
int rayParity(const Vec3& pt, const Vec3& dir,
              const std::vector<PreparedFace>& solid,
              const std::vector<Vec3>& P,
              bool& ambiguous) {
    ambiguous = false;
    // A far endpoint guaranteed outside any bounded solid.
    Vec3 far = add(pt, mul(dir, 1.0));   // dir already scaled large by caller
    int crossings = 0;
    for (const auto& f : solid) {
        const Vec3& A=P[f.v[0]]; const Vec3& B=P[f.v[1]]; const Vec3& C=P[f.v[2]];
        // Sides of the segment endpoints vs the triangle plane.
        int sPt  = sgn(orient3d(A.x,A.y,A.z,B.x,B.y,B.z,C.x,C.y,C.z, pt.x,pt.y,pt.z));
        int sFar = sgn(orient3d(A.x,A.y,A.z,B.x,B.y,B.z,C.x,C.y,C.z, far.x,far.y,far.z));
        if (sPt==0) { ambiguous=true; return 0; }     // ray origin on a plane: re-cast
        if (sFar==0){ ambiguous=true; return 0; }
        if (sPt==sFar) continue;                       // segment doesn't cross plane
        // Segment crosses the triangle's plane. Does it pass through the
        // triangle interior? Test the orientation of the tetrahedra
        // (pt,far,edge) for each edge — all three same sign => inside.
        int s1=sgn(orient3d(pt.x,pt.y,pt.z, far.x,far.y,far.z, A.x,A.y,A.z, B.x,B.y,B.z));
        int s2=sgn(orient3d(pt.x,pt.y,pt.z, far.x,far.y,far.z, B.x,B.y,B.z, C.x,C.y,C.z));
        int s3=sgn(orient3d(pt.x,pt.y,pt.z, far.x,far.y,far.z, C.x,C.y,C.z, A.x,A.y,A.z));
        if (s1==0||s2==0||s3==0) { ambiguous=true; return 0; } // ray hits an edge: re-cast
        if (s1==s2 && s2==s3) ++crossings;             // strictly through interior
    }
    return (crossings & 1) ? +1 : -1;
}

// Classify a point as inside (+1) / outside (-1) the closed solid using parity,
// re-casting along jittered directions until non-ambiguous.
int pointInSolid(const Vec3& pt,
                 const std::vector<PreparedFace>& solid,
                 const std::vector<Vec3>& P,
                 double extent) {
    static const Vec3 dirs[] = {
        {1.0, 0.0, 0.0}, {0.7, 0.5, 0.31}, {-0.33, 0.91, 0.17},
        {0.41,-0.27, 0.87}, {-0.6,-0.55, 0.58}, {0.13, 0.27,-0.95},
        {0.91,-0.31, 0.27}, {-0.71, 0.13,-0.69}
    };
    double L = 4.0 * (extent>0.0?extent:1.0);
    for (const Vec3& d : dirs) {
        bool amb=false;
        int r = rayParity(pt, mul(d, L), solid, P, amb);
        if (!amb) return r;
    }
    return -1; // pathological: treat as outside (HONEST fallback; rare)
}

// Split a bundle of coplanar constraint segments (lying in one face's plane) at
// all their mutual crossings, so the result is a set of NON-CROSSING sub-
// segments meeting only at shared endpoints. Working in the face's 2D
// projection with exact orient2d for the crossing test; the 3D split point is
// the double-precision line-line intersection, snap-welded into the shared
// pool. Pre-splitting crossing constraints is what makes the constrained
// triangulation recover reliably (no two constraints cross an interior).
std::vector<std::array<Vec3,2>> splitSegments(
        const std::vector<std::array<Vec3,2>>& in, int drop, bool flip,
        VertexPool& pool) {
    auto pr=[&](const Vec3& p)->V2{
        double x,y; switch(drop){case 0:x=p.y;y=p.z;break;case 1:x=p.z;y=p.x;break;default:x=p.x;y=p.y;break;}
        if (flip) std::swap(x,y);
        return V2{x,y,kInvalid};
    };
    // Collect, for each segment, the parameters t at which it is cut.
    const int N=static_cast<int>(in.size());
    std::vector<std::vector<double>> cuts(N);
    for (int i=0;i<N;++i){ cuts[i].push_back(0.0); cuts[i].push_back(1.0); }
    for (int i=0;i<N;++i){
        V2 a=pr(in[i][0]), b=pr(in[i][1]);
        for (int j=i+1;j<N;++j){
            V2 c=pr(in[j][0]), d=pr(in[j][1]);
            int o1=sgn(orient2d(a.x,a.y,b.x,b.y,c.x,c.y));
            int o2=sgn(orient2d(a.x,a.y,b.x,b.y,d.x,d.y));
            int o3=sgn(orient2d(c.x,c.y,d.x,d.y,a.x,a.y));
            int o4=sgn(orient2d(c.x,c.y,d.x,d.y,b.x,b.y));
            if (o1!=0&&o2!=0&&o3!=0&&o4!=0&&(o1!=o2)&&(o3!=o4)) {
                // proper interior crossing: split both at the intersection.
                double a1=b.y-a.y, b1=a.x-b.x, c1=a1*a.x+b1*a.y;
                double a2=d.y-c.y, b2=c.x-d.x, c2=a2*c.x+b2*c.y;
                double det=a1*b2-a2*b1;
                if (det==0.0) continue;
                double X=(c1*b2-c2*b1)/det, Y=(a1*c2-a2*c1)/det;
                double dxi=b.x-a.x, dyi=b.y-a.y, Li=dxi*dxi+dyi*dyi;
                double dxj=d.x-c.x, dyj=d.y-c.y, Lj=dxj*dxj+dyj*dyj;
                if (Li>0) cuts[i].push_back(((X-a.x)*dxi+(Y-a.y)*dyi)/Li);
                if (Lj>0) cuts[j].push_back(((X-c.x)*dxj+(Y-c.y)*dyj)/Lj);
            }
        }
    }
    std::vector<std::array<Vec3,2>> out;
    for (int i=0;i<N;++i){
        std::sort(cuts[i].begin(), cuts[i].end());
        const Vec3& A=in[i][0]; const Vec3& B=in[i][1];
        for (size_t k=0;k+1<cuts[i].size();++k){
            double t0=cuts[i][k], t1=cuts[i][k+1];
            if (t1-t0 < 1e-12) continue;
            Vec3 p0=add(A, mul(sub(B,A), t0));
            Vec3 p1=add(A, mul(sub(B,A), t1));
            // snap to pool so endpoints weld with corners/other segments
            std::uint32_t id0=pool.add(p0), id1=pool.add(p1);
            if (id0==id1) continue;
            out.push_back({pool.pts[id0], pool.pts[id1]});
        }
    }
    return out;
}

// ----------------------------------------------------------------------------
// Imprint: re-triangulate every face of `me` that is crossed by faces of the
// `other`, inserting the intersection segments as constraint edges. Produces a
// new face list (weld-id triples) for `me` whose union still tiles the same
// surface but now has vertices/edges coincident with `other`'s cut.
// ----------------------------------------------------------------------------
struct ImprintedFace { std::uint32_t v[3]; };

bool imprint(const Prepared& me, const Prepared& other,
             VertexPool& pool, double extent,
             std::vector<ImprintedFace>& out,
             bool& coplanarContact) {
    coplanarContact = false;
    const double eps = 1e-9 * (extent>0?extent:1.0);

    // For each face of `me`, the list of constraint segments (as snapped 3D
    // points) it must imprint.
    std::vector<std::vector<std::array<Vec3,2>>> segs(me.faces.size());

    for (std::size_t i=0;i<me.faces.size();++i){
        const PreparedFace& fa = me.faces[i];
        const Vec3& a0=pool.pts[fa.v[0]]; const Vec3& a1=pool.pts[fa.v[1]]; const Vec3& a2=pool.pts[fa.v[2]];
        // dominant projection axis for THIS face (used for coplanar clipping).
        double fax=std::fabs(fa.nrm.x), fay=std::fabs(fa.nrm.y), faz=std::fabs(fa.nrm.z);
        int fdrop=(fax>=fay&&fax>=faz)?0:(fay>=faz?1:2);
        double fncomp=(fdrop==0)?fa.nrm.x:(fdrop==1)?fa.nrm.y:fa.nrm.z;
        bool fflip=(fncomp<0.0);
        for (std::size_t j=0;j<other.faces.size();++j){
            const PreparedFace& fb = other.faces[j];
            if (!aabbOverlap(fa.bbMin,fa.bbMax, fb.bbMin,fb.bbMax, eps)) continue;
            const Vec3& b0=pool.pts[fb.v[0]]; const Vec3& b1=pool.pts[fb.v[1]]; const Vec3& b2=pool.pts[fb.v[2]];
            TriTriResult tt = triTriIntersect(a0,a1,a2,b0,b1,b2);
            switch (tt.relation) {
                case TriTriRelation::PROPER_CROSS:
                case TriTriRelation::EDGE_TOUCH:
                    if (norm2(sub(tt.p,tt.q))>0.0)
                        segs[i].push_back({tt.p, tt.q});
                    break;
                case TriTriRelation::COPLANAR_OVERLAP: {
                    // Coincident-coplanar patch: imprint the overlap polygon's
                    // boundary so the shared region is bounded exactly; the
                    // coincident-wall is then resolved in assemble() by net
                    // winding. (Robust for the axis-aligned coplanar case that
                    // the cube-cube gate needs.)
                    auto edges = coplanarOverlapEdges(a0,a1,a2,b0,b1,b2,fdrop,fflip);
                    for (auto& e : edges)
                        segs[i].push_back({e[0], e[1]});
                    break;
                }
                default: break; // DISJOINT / POINT_TOUCH contribute no edge
            }
        }
    }

    out.clear();
    out.reserve(me.faces.size()*2);
    for (std::size_t i=0;i<me.faces.size();++i){
        const PreparedFace& fa = me.faces[i];
        if (segs[i].empty()) {
            out.push_back({fa.v[0],fa.v[1],fa.v[2]});  // untouched
            continue;
        }
        // Re-triangulate face i with its constraint segments. Copy the corner
        // coordinates BY VALUE: the loop below calls pool.add(), which may
        // reallocate pool.pts and would dangle any reference into it.
        const Vec3 a0=pool.pts[fa.v[0]]; const Vec3 a1=pool.pts[fa.v[1]]; const Vec3 a2=pool.pts[fa.v[2]];

        // dominant axis from face normal; sign of normal decides flip so the
        // 2D winding stays CCW relative to the outward 3D normal.
        Vec3 n = fa.nrm;
        double ax=std::fabs(n.x), ay=std::fabs(n.y), az=std::fabs(n.z);
        int drop = (ax>=ay&&ax>=az)?0:(ay>=az?1:2);
        double ncomp = (drop==0)?n.x:(drop==1)?n.y:n.z;
        bool flip = (ncomp < 0.0);

        CDT cdt;
        // Pool ids of the 3 corners.
        std::uint32_t c0=fa.v[0], c1=fa.v[1], c2=fa.v[2];
        // The 3 corner projections (for 2D edge-snapping of near-edge points).
        V2 C0=project2D(a0,drop,kInvalid,flip),
           C1=project2D(a1,drop,kInvalid,flip),
           C2=project2D(a2,drop,kInvalid,flip);
        // Snap tolerance in 2D, relative to the triangle's edge scale. Points
        // computed by double-precision plane-line solves can land a hair OFF a
        // triangle edge; snapping them exactly onto the nearest edge removes the
        // near-collinear sliver that would otherwise break the triangulation.
        double escale = std::sqrt(std::max({
            (C1.x-C0.x)*(C1.x-C0.x)+(C1.y-C0.y)*(C1.y-C0.y),
            (C2.x-C1.x)*(C2.x-C1.x)+(C2.y-C1.y)*(C2.y-C1.y),
            (C0.x-C2.x)*(C0.x-C2.x)+(C0.y-C2.y)*(C0.y-C2.y)}));
        double snapTol = 1e-7 * (escale>0?escale:1.0);
        auto snapToEdges=[&](V2 q)->V2{
            const V2 E[3][2]={{C0,C1},{C1,C2},{C2,C0}};
            for (int e=0;e<3;++e){
                const V2& U=E[e][0]; const V2& W=E[e][1];
                double dx=W.x-U.x, dy=W.y-U.y, L2=dx*dx+dy*dy;
                if (L2<=0) continue;
                double t=((q.x-U.x)*dx+(q.y-U.y)*dy)/L2;
                if (t<=0||t>=1) continue;             // beyond the edge span
                double px=U.x+t*dx, py=U.y+t*dy;
                double d=std::hypot(q.x-px, q.y-py);
                if (d<snapTol){ q.x=px; q.y=py; }     // snap exactly onto the edge
            }
            return q;
        };
        // local index map weld-id -> local cdt index.
        std::unordered_map<std::uint32_t,int> local;
        auto addPt=[&](std::uint32_t id, const Vec3& p, bool snap)->int{
            auto it=local.find(id);
            if (it!=local.end()) return it->second;
            int li=static_cast<int>(cdt.pts.size());
            V2 q=project2D(p,drop,id,flip);
            if (snap) q=snapToEdges(q);
            cdt.pts.push_back(q);
            local.emplace(id,li);
            return li;
        };
        int l0=addPt(c0,a0,false), l1=addPt(c1,a1,false), l2=addPt(c2,a2,false);

        // Split crossing constraints into a NON-CROSSING arrangement first; this
        // is what makes the constrained triangulation recover reliably.
        std::vector<std::array<Vec3,2>> arr = splitSegments(segs[i], drop, flip, pool);

        // Add each arrangement endpoint as a CDT point.
        for (auto& sg : arr) {
            std::uint32_t id0=pool.add(sg[0]);
            std::uint32_t id1=pool.add(sg[1]);
            if (id0==id1) continue;
            const Vec3 p0=pool.pts[id0], p1=pool.pts[id1];
            int la=addPt(id0,p0,true);
            int lb=addPt(id1,p1,true);
            cdt.constraints.push_back({la,lb});
        }

        // Boundary edges of the triangle, SPLIT at any constraint endpoint that
        // lies exactly on them (so the boundary conforms with the neighbour
        // face's cut and no T-junction is introduced). Each boundary edge is
        // emitted as a chain of sub-edge constraints through the on-edge points.
        auto addBoundary=[&](int e0,int e1){
            const V2& U=cdt.pts[e0]; const V2& Vv=cdt.pts[e1];
            double dx=Vv.x-U.x, dy=Vv.y-U.y, L2=dx*dx+dy*dy;
            std::vector<std::pair<double,int>> on={{0.0,e0},{1.0,e1}};
            for (int li=0; li<static_cast<int>(cdt.pts.size()); ++li){
                if (li==e0||li==e1) continue;
                if (sgn(orient2d(U.x,U.y,Vv.x,Vv.y, cdt.pts[li].x,cdt.pts[li].y))!=0) continue;
                if (L2<=0) continue;
                double t=((cdt.pts[li].x-U.x)*dx+(cdt.pts[li].y-U.y)*dy)/L2;
                if (t>1e-12 && t<1.0-1e-12) on.push_back({t,li});
            }
            std::sort(on.begin(),on.end());
            for (size_t k=0;k+1<on.size();++k)
                cdt.constraints.push_back({on[k].second,on[k+1].second});
        };
        addBoundary(l0,l1); addBoundary(l1,l2); addBoundary(l2,l0);

        if (!cdt.build()) return false; // honest failure (non-recoverable CDT)

        // Lift CDT triangles back to 3D, keep only those strictly inside the
        // original face (drop the few spurious ones outside, if any), in the
        // ORIGINAL winding. We re-derive winding from the 3D corners' normal.
        const int NP=static_cast<int>(cdt.pts.size());
        for (auto& t : cdt.tris) {
            if (t.a<0||t.b<0||t.c<0) continue;             // deleted slot
            if (t.a>=NP||t.b>=NP||t.c>=NP) continue;       // stray index (defensive)
            std::uint32_t i0=cdt.pts[t.a].id, i1=cdt.pts[t.b].id, i2=cdt.pts[t.c].id;
            if (i0==kInvalid||i1==kInvalid||i2==kInvalid) continue;
            if (i0==i1||i1==i2||i0==i2) continue;
            // centroid must lie inside the original triangle (closed).
            const Vec3& P0=pool.pts[i0]; const Vec3& P1=pool.pts[i1]; const Vec3& P2=pool.pts[i2];
            Vec3 cen = mul(add(add(P0,P1),P2), 1.0/3.0);
            // inside test in 2D projection of the ORIGINAL triangle.
            V2 q  = project2D(cen,drop,kInvalid,flip);
            V2 A0=project2D(a0,drop,kInvalid,flip),
               A1=project2D(a1,drop,kInvalid,flip),
               A2=project2D(a2,drop,kInvalid,flip);
            if (!inTri2(q,A0,A1,A2)) continue;
            // orient the sub-triangle to match the face normal (same sign as
            // the original 3D normal along `drop`).
            Vec3 sn = cross(sub(P1,P0),sub(P2,P0));
            double scomp=(drop==0)?sn.x:(drop==1)?sn.y:sn.z;
            if ((scomp<0.0) != (ncomp<0.0))
                out.push_back({i0,i2,i1}); // flip to match
            else
                out.push_back({i0,i1,i2});
        }
    }
    return true;
}

// Is the sub-triangle (centroid `cen`, unit-ish normal `nrm`) COINCIDENT with a
// face of `other` — i.e. does it lie in a coplanar-overlap patch shared by both
// solids? Returns: +1 if a coincident other-face exists with an ALIGNED normal,
// -1 if OPPOSED, 0 if not coincident. Decided by exact orient3d (cen and the 3
// other-face corners coplanar) + a 2D containment test.
int coincidentWall(const Vec3& cen, const Vec3& nrm,
                   const std::vector<PreparedFace>& other,
                   const std::vector<Vec3>& P, double extent) {
    const double eps = 1e-9 * (extent>0?extent:1.0);
    for (const auto& fb : other) {
        const Vec3& B0=P[fb.v[0]]; const Vec3& B1=P[fb.v[1]]; const Vec3& B2=P[fb.v[2]];
        // centroid coplanar with the other face? (exact orient3d ZERO)
        if (sgn(orient3d(B0.x,B0.y,B0.z,B1.x,B1.y,B1.z,B2.x,B2.y,B2.z, cen.x,cen.y,cen.z))!=0)
            continue;
        // is cen inside the other triangle (2D, dominant axis of fb)?
        double ax=std::fabs(fb.nrm.x),ay=std::fabs(fb.nrm.y),az=std::fabs(fb.nrm.z);
        int drop=(ax>=ay&&ax>=az)?0:(ay>=az?1:2);
        auto pr=[&](const Vec3& p)->V2{
            double x,y; switch(drop){case 0:x=p.y;y=p.z;break;case 1:x=p.z;y=p.x;break;default:x=p.x;y=p.y;break;}
            return V2{x,y,kInvalid};
        };
        if (!inTri2(pr(cen), pr(B0),pr(B1),pr(B2))) continue;
        (void)eps;
        // coincident — compare normals.
        double d = dot(nrm, fb.nrm);
        return d>=0.0 ? +1 : -1;
    }
    return 0;
}

// ----------------------------------------------------------------------------
// Select kept faces from one imprinted side against the OTHER solid for `op`.
// Non-coincident faces use a robust ray-parity in/out test of the centroid.
// COINCIDENT-COPLANAR walls (shared boundary surfaces of the two solids) follow
// the standard coplanar rule and are emitted ONLY from the primary (A) pass so
// each shared wall appears exactly once:
//     aligned  coincident (normals agree)  -> on UNION and INTERSECTION
//     opposed  coincident (normals oppose) -> on DIFFERENCE (kept as A's facing)
// `isPrimary` is true for the A-side pass, false for the B-side pass.
// ----------------------------------------------------------------------------
void selectFaces(const std::vector<ImprintedFace>& faces,
                 const std::vector<PreparedFace>& otherSolid,
                 const std::vector<Vec3>& P,
                 double extent, BoolOp op, bool isPrimary,
                 std::vector<ImprintedFace>& out) {
    // keepInside / flipWinding for NON-coincident faces of this side per op.
    //   UNION        : keep faces OUTSIDE the other; no flip.
    //   INTERSECTION : keep faces INSIDE  the other; no flip.
    //   DIFFERENCE   : A-side keep OUTSIDE B, no flip; B-side keep INSIDE A, flip.
    bool keepInside, flipWinding;
    if (op==BoolOp::UNION)        { keepInside=false; flipWinding=false; }
    else if (op==BoolOp::INTERSECTION) { keepInside=true; flipWinding=false; }
    else /* DIFFERENCE */        { keepInside = !isPrimary; flipWinding = !isPrimary; }

    const double push = 1e-7 * (extent>0.0?extent:1.0);
    for (const auto& f : faces) {
        const Vec3& A=P[f.v[0]]; const Vec3& B=P[f.v[1]]; const Vec3& C=P[f.v[2]];
        Vec3 cen = mul(add(add(A,B),C), 1.0/3.0);
        Vec3 n = cross(sub(B,A), sub(C,A));
        double nl = std::sqrt(norm2(n));
        Vec3 un = (nl>0.0)? mul(n,1.0/nl) : n;

        int cs = coincidentWall(cen, un, otherSolid, P, extent);
        if (cs != 0) {
            // Shared wall: emit only once (primary pass).
            if (!isPrimary) continue;
            bool keep=false; bool flip=false;
            if (op==BoolOp::UNION || op==BoolOp::INTERSECTION) {
                keep = (cs>0);                 // aligned wall bounds both ∪ and ∩
            } else { // DIFFERENCE
                keep = (cs<0);                 // opposed wall bounds A−B
            }
            if (!keep) continue;
            if (flip) out.push_back({f.v[0],f.v[2],f.v[1]});
            else      out.push_back({f.v[0],f.v[1],f.v[2]});
            continue;
        }

        // Non-coincident: robust ray parity of a point pushed just off-plane.
        Vec3 probe = (nl>0.0) ? add(cen, mul(un, push)) : cen;
        int s = pointInSolid(probe, otherSolid, P, extent);
        bool inside = (s>0);
        if (inside != keepInside) continue;
        if (flipWinding) out.push_back({f.v[0],f.v[2],f.v[1]});
        else             out.push_back({f.v[0],f.v[1],f.v[2]});
    }
}

// Compute scene extent (max bbox diagonal of A∪B) for tolerances + ray length.
double sceneExtent(const std::vector<double>& a, const std::vector<double>& b) {
    Vec3 mn{ 1e300, 1e300, 1e300}, mx{-1e300,-1e300,-1e300};
    auto acc=[&](const std::vector<double>& v){
        for (std::size_t i=0;i+2<v.size();i+=3){
            mn.x=std::min(mn.x,v[i]); mx.x=std::max(mx.x,v[i]);
            mn.y=std::min(mn.y,v[i+1]); mx.y=std::max(mx.y,v[i+1]);
            mn.z=std::min(mn.z,v[i+2]); mx.z=std::max(mx.z,v[i+2]);
        }
    };
    acc(a); acc(b);
    Vec3 d=sub(mx,mn);
    return std::sqrt(norm2(d));
}

// ----------------------------------------------------------------------------
// Build the final HalfEdgeMesh from a face list of weld ids. Re-indexes used
// vertices, drops exact-duplicate faces (same 3 ids any rotation, same orient)
// and exact-opposite face pairs (a coincident wall that cancels), then rebuilds
// and validates.
// ----------------------------------------------------------------------------
BoolResult assemble(const std::vector<ImprintedFace>& faces,
                    const std::vector<Vec3>& pool) {
    BoolResult R;

    // Coincident-wall resolution. Two sub-triangles on the SAME 3 vertices are a
    // coincident wall (e.g. the shared interface of two unioned cubes shows up
    // once from each side). We track a NET winding sign per sorted-vertex triple:
    //   net == 0  -> opposite-facing walls cancel (an internal partition that is
    //               not on the result boundary) — drop entirely.
    //   net  > 0  -> keep ONE face with the '+' winding.
    //   net  < 0  -> keep ONE face with the '-' winding.
    // Clamping to a single face (not |net| copies) is the standard coplanar
    // boolean rule; it prevents a doubled same-orientation wall (which would be
    // non-manifold).
    std::map<std::array<std::uint32_t,3>, int> net;
    std::map<std::array<std::uint32_t,3>, std::array<std::uint32_t,3>> rep; // sorted->one oriented rep
    for (const auto& f : faces) {
        std::uint32_t a=f.v[0],b=f.v[1],c=f.v[2];
        if (a==b||b==c||a==c) continue;
        std::array<std::uint32_t,3> srt{a,b,c};
        std::sort(srt.begin(),srt.end());
        // Winding sign = parity of the permutation taking (a,b,c) -> sorted.
        auto permSign=[&](std::array<std::uint32_t,3> p)->int{
            int swaps=0;
            for (int i=0;i<3;++i) for(int j=i+1;j<3;++j) if (p[i]>p[j]) ++swaps;
            return (swaps%2==0)?+1:-1;
        };
        int sgnW = permSign({a,b,c});
        net[srt]+=sgnW;
        if (rep.find(srt)==rep.end()) rep[srt]={a,b,c};
    }

    std::vector<ImprintedFace> kept;
    for (auto& kv : net) {
        if (kv.second==0) continue; // cancelled coincident wall (internal partition)
        auto base = rep[kv.first];
        // permSign of `base` tells which winding `base` already is; emit exactly
        // ONE face matching the sign of net.
        auto permSign=[&](std::array<std::uint32_t,3> p)->int{
            int swaps=0;
            for (int i=0;i<3;++i) for(int j=i+1;j<3;++j) if (p[i]>p[j]) ++swaps;
            return (swaps%2==0)?+1:-1;
        };
        int baseSign = permSign(base);
        bool wantPlus = (kv.second>0);
        if ((baseSign>0)==wantPlus) kept.push_back({base[0],base[1],base[2]});
        else                        kept.push_back({base[0],base[2],base[1]});
    }

    if (kept.empty()) { R.ok=false; R.reason="empty result"; return R; }

    // Re-index used vertices.
    std::unordered_map<std::uint32_t,std::uint32_t> remap;
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    auto getv=[&](std::uint32_t id)->std::uint32_t{
        auto it=remap.find(id);
        if (it!=remap.end()) return it->second;
        std::uint32_t ni=static_cast<std::uint32_t>(pos.size()/3);
        pos.push_back(pool[id].x); pos.push_back(pool[id].y); pos.push_back(pool[id].z);
        remap.emplace(id,ni);
        return ni;
    };
    for (auto& f : kept) {
        idx.push_back(getv(f.v[0]));
        idx.push_back(getv(f.v[1]));
        idx.push_back(getv(f.v[2]));
    }

#ifdef FORGE_MB2_DEBUG
    {
        // Diagnostic: print every undirected edge with !=2 incident faces.
        std::map<std::pair<std::uint32_t,std::uint32_t>,int> ec;
        for (std::size_t f=0; f<idx.size()/3; ++f){
            std::uint32_t a=idx[3*f],b=idx[3*f+1],c=idx[3*f+2];
            auto e=[&](std::uint32_t u,std::uint32_t v){ ec[{std::min(u,v),std::max(u,v)}]++; };
            e(a,b); e(b,c); e(c,a);
        }
        std::printf("[MB2] faces=%zu verts=%zu\n", idx.size()/3, pos.size()/3);
        int bad=0;
        for (auto& kv: ec) if (kv.second!=2){ if(bad<24) std::printf("  edge(%u,%u) count=%d\n",kv.first.first,kv.first.second,kv.second); ++bad; }
        std::printf("[MB2] non-2 edges = %d\n", bad);
    }
#endif
    HalfEdgeMesh m;
    if (!m.buildFromSoup(pos, idx)) { R.ok=false; R.reason="non-manifold result (build failed)"; return R; }
    ValidityReport vr = m.validate();
    if (!vr.isValid()) { R.ok=false; R.reason="result not a closed 2-manifold"; return R; }
    R.ok=true; R.mesh=std::move(m); R.reason="ok";
    return R;
}

} // namespace

// ============================================================================
BoolResult meshBoolean(const std::vector<double>&        aPositions,
                       const std::vector<std::uint32_t>& aIndices,
                       const std::vector<double>&        bPositions,
                       const std::vector<std::uint32_t>& bIndices,
                       BoolOp                            op) {
    BoolResult R;

    // Precondition: both inputs are valid closed 2-manifolds (verified).
    {
        HalfEdgeMesh ma, mb;
        if (!ma.buildFromSoup(aPositions, aIndices) || !ma.validate().isValid()) {
            R.ok=false; R.reason="input A is not a valid closed 2-manifold"; return R;
        }
        if (!mb.buildFromSoup(bPositions, bIndices) || !mb.validate().isValid()) {
            R.ok=false; R.reason="input B is not a valid closed 2-manifold"; return R;
        }
    }

    double extent = sceneExtent(aPositions, bPositions);
    VertexPool pool; pool.setScale(extent);

    Prepared A = prepare(aPositions, aIndices, pool);
    Prepared B = prepare(bPositions, bIndices, pool);

    // Imprint each side with the other's cut.
    std::vector<ImprintedFace> impA, impB;
    bool coplanarA=false, coplanarB=false;
    if (!imprint(A, B, pool, extent, impA, coplanarA)) {
        R.ok=false;
        R.reason = coplanarA ? "TARGETED: coincident coplanar faces (in/out undefined on shared surface)"
                             : "imprint failed on A (constrained re-triangulation not recoverable)";
        return R;
    }
    if (!imprint(B, A, pool, extent, impB, coplanarB)) {
        R.ok=false;
        R.reason = coplanarB ? "TARGETED: coincident coplanar faces (in/out undefined on shared surface)"
                             : "imprint failed on B (constrained re-triangulation not recoverable)";
        return R;
    }

    // Select per op. The ORIGINAL solids define in/out (imprint preserves the
    // surface). A is the primary side (coincident shared walls are emitted once
    // from here), B the secondary.
    std::vector<ImprintedFace> out;
    selectFaces(impA, B.faces, pool.pts, extent, op, /*isPrimary*/true,  out);
    selectFaces(impB, A.faces, pool.pts, extent, op, /*isPrimary*/false, out);

    R = assemble(out, pool.pts);
    return R;
}

BoolResult meshBoolean(const HalfEdgeMesh& A, const HalfEdgeMesh& B, BoolOp op) {
    std::vector<double> ap, bp; std::vector<std::uint32_t> ai, bi;
    A.toSoup(ap, ai); B.toSoup(bp, bi);
    return meshBoolean(ap, ai, bp, bi, op);
}

} // namespace mesh
} // namespace native
} // namespace forge
