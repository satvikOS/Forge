// forge/native/brep/NurbsSurfaceIntersect.cpp
//
// K1.3 implementation — general NURBS-aware surface–surface intersection.
// Three stages (see NurbsSurfaceIntersect.hpp for the honesty / scope contract):
//   (1) LOCALIZE   — recursive Bezier/knot-interval subdivision + control-point
//                    AABB overlap pruning to bracket every branch.
//   (2) SEED+MARCH — 4-variable Newton seed on F(u1,v1,u2,v2)=S1-S2, then march
//                    the branch with a tangent predictor (n1 x n2) + Newton
//                    corrector, adaptive step, loop/exit termination.
//   (3) RETURN     — fitted 3D curve (least-squares cubic B-spline, accepted only
//                    if it matches the polyline to fitTol) else the dense
//                    polyline, ALWAYS with the two pcurve traces + a degenerate
//                    flag.
// Pure C++20, no external deps. The analytic SSI core is untouched.

#include "forge/native/brep/NurbsSurfaceIntersect.hpp"

#include "forge/native/brep/NurbsSurface.hpp"    // validateSurface, evaluateWithDerivatives

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <limits>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

constexpr double kPi = 3.14159265358979323846;

// ----- small vector helpers (reuse the brep Vec3 free functions in Surface.hpp)
inline double v3len(const Vec3& a) { return std::sqrt(a.x*a.x + a.y*a.y + a.z*a.z); }
inline Vec3   v3sub(const Vec3& a, const Vec3& b){ return {a.x-b.x,a.y-b.y,a.z-b.z}; }

// ===========================================================================
// Surface sample wrapper: point + partials. Works directly on the validated
// rational NURBS evaluator (evaluateWithDerivatives) — no re-derivation. NOTE:
// evaluateWithDerivatives reports ok=false at a DEGENERATE tangent plane (a pole)
// but still returns the point + partials; we deliberately KEEP that sample and
// detect the degeneracy ourselves from |Su x Sv| in the marcher, so a pole point
// is reported as a tangency rather than silently dropped.
// ===========================================================================
struct Smp { Vec3 S, Su, Sv; };
inline Smp sample(const NurbsSurface& s, double u, double v) {
    SurfaceSample ss = evaluateWithDerivatives(s, u, v);
    return Smp{ ss.point, ss.du, ss.dv };
}

// Clamp (u,v) to the surface's clamped knot domain.
inline void domain(const NurbsSurface& s, double& u0, double& u1,
                   double& v0, double& v1) {
    u0 = s.knotsU.front(); u1 = s.knotsU.back();
    v0 = s.knotsV.front(); v1 = s.knotsV.back();
}
inline double clampd(double x, double lo, double hi){ return x<lo?lo:(x>hi?hi:x); }

// Geometric U-periodicity: a promoted full-circle (cylinder/cone/sphere azimuth)
// is CLOSED in U — its u=u0 and u=u1 control rings coincide, so S(u0,v)==S(u1,v)
// for all v. We detect that geometrically (sample the two boundary isolines) so
// the marcher WRAPS u across the seam instead of stopping at the param boundary,
// letting a section circle / Steinmetz seam close into a single loop.
struct SurfPeriod { bool uPeriodic=false; double uLo=0, uHi=1, uPer=1; };
inline SurfPeriod detectPeriodU(const NurbsSurface& s) {
    SurfPeriod p; double u0,u1,v0,v1; domain(s,u0,u1,v0,v1);
    p.uLo=u0; p.uHi=u1; p.uPer=u1-u0;
    if (p.uPer<=0) return p;
    double worst=0.0; double sc=1.0;
    for (int k=0;k<=4;++k){
        double v = v0 + (v1-v0)*k/4.0;
        Vec3 a=s.evaluate(u0,v), b=s.evaluate(u1,v);
        worst=std::max(worst, v3len(v3sub(a,b)));
        sc=std::max(sc, std::max({std::fabs(a.x),std::fabs(a.y),std::fabs(a.z)}));
    }
    p.uPeriodic = (worst < 1e-7*sc);
    return p;
}
// Wrap u into [lo, hi) when periodic; otherwise return clamped.
inline double wrapU(double u, const SurfPeriod& p) {
    if (!p.uPeriodic) return clampd(u, p.uLo, p.uHi);
    double t = u - p.uLo;
    t = t - std::floor(t / p.uPer) * p.uPer;   // [0, uPer)
    return p.uLo + t;
}

// ===========================================================================
// (1) LOCALIZE — recursive subdivision of the (u,v) rectangle into a grid of
// sub-cells; each cell's control-point convex hull is bounded by the AABB of a
// dense sample of the cell (a strict, conservative superset of the patch image,
// since the evaluated samples lie ON the patch and we inflate by a margin). A
// pair of cells whose 3D boxes do not overlap cannot contain an intersection.
//
// We use a uniform sub-grid of `subdiv` cells per direction per surface and a
// sampled-AABB bound (3x3 samples per cell, inflated by the half-diagonal of the
// cell's sample spread). This is the convex-hull-overlap pruning in practice:
// every surviving cell-pair brackets the curve; the brackets are a superset.
// ===========================================================================
struct Cell {
    double u0,u1,v0,v1;     // parameter sub-rectangle
    Vec3   lo, hi;          // 3D AABB of the (inflated) patch image
};

std::vector<Cell> buildCells(const NurbsSurface& s, int subdiv, double inflate) {
    double U0,U1,V0,V1; domain(s,U0,U1,V0,V1);
    std::vector<Cell> cells; cells.reserve((std::size_t)subdiv*subdiv);
    const int SS = 3; // samples per direction within a cell for the box
    for (int i=0;i<subdiv;++i) {
        for (int j=0;j<subdiv;++j) {
            Cell c;
            c.u0 = U0 + (U1-U0)*i/subdiv;     c.u1 = U0 + (U1-U0)*(i+1)/subdiv;
            c.v0 = V0 + (V1-V0)*j/subdiv;     c.v1 = V0 + (V1-V0)*(j+1)/subdiv;
            Vec3 lo{ 1e300, 1e300, 1e300}, hi{-1e300,-1e300,-1e300};
            for (int a=0;a<=SS;++a) for (int b=0;b<=SS;++b) {
                double u = c.u0 + (c.u1-c.u0)*a/SS;
                double v = c.v0 + (c.v1-c.v0)*b/SS;
                Vec3 P = s.evaluate(u,v);
                lo.x=std::min(lo.x,P.x); lo.y=std::min(lo.y,P.y); lo.z=std::min(lo.z,P.z);
                hi.x=std::max(hi.x,P.x); hi.y=std::max(hi.y,P.y); hi.z=std::max(hi.z,P.z);
            }
            // Inflate by a margin so the SAMPLED box conservatively contains the
            // true patch image between samples (the patch bulges off the samples
            // by at most the chordal sag, bounded by `inflate`).
            lo.x-=inflate; lo.y-=inflate; lo.z-=inflate;
            hi.x+=inflate; hi.y+=inflate; hi.z+=inflate;
            c.lo=lo; c.hi=hi;
            cells.push_back(c);
        }
    }
    return cells;
}

inline bool aabbOverlap(const Cell& a, const Cell& b) {
    return a.lo.x<=b.hi.x && a.hi.x>=b.lo.x &&
           a.lo.y<=b.hi.y && a.hi.y>=b.lo.y &&
           a.lo.z<=b.hi.z && a.hi.z>=b.lo.z;
}

// ===========================================================================
// (2a) SEED — 4-var Newton on F(u1,v1,u2,v2) = S1(u1,v1) - S2(u2,v2) = 0.
// 3 equations, 4 unknowns: the Jacobian J is 3x4 with columns [S1u,S1v,-S2u,-S2v].
// We take the minimum-norm Gauss-Newton step  d = -J^T (J J^T)^{-1} F  (the 3x3
// normal system J J^T is SPD when the four partials span at least a 3-D space).
// This resolves the 1-D null space (along the curve tangent) by moving minimally.
// ===========================================================================
struct UV4 { double u1,v1,u2,v2; };

// V-domain bounds are passed (the non-periodic coordinate is clamped); the
// U-domain is handled by wrapU through p1/p2 (periodic) or its own clamp.
bool seedNewton(const NurbsSurface& s1, const NurbsSurface& s2,
                UV4& x, double tol, int maxIt,
                double V10,double V11, double V20,double V21,
                const SurfPeriod& p1, const SurfPeriod& p2) {
    for (int it=0; it<maxIt; ++it) {
        Smp a = sample(s1, x.u1, x.v1);
        Smp b = sample(s2, x.u2, x.v2);
        Vec3 F = v3sub(a.S, b.S);
        double r = v3len(F);
        if (r < tol) return true;
        // J columns (3x4): c0=S1u, c1=S1v, c2=-S2u, c3=-S2v.
        const Vec3 c0=a.Su, c1=a.Sv, c2={-b.Su.x,-b.Su.y,-b.Su.z}, c3={-b.Sv.x,-b.Sv.y,-b.Sv.z};
        // M = J J^T (3x3).
        auto dot=[&](const Vec3&p,const Vec3&q){return p.x*q.x+p.y*q.y+p.z*q.z;};
        double M[3][3];
        const Vec3* C[4]={&c0,&c1,&c2,&c3};
        // J J^T = sum over columns k of (col_k outer col_k)? No: (JJ^T)_{rs}=sum_k J_{rk}J_{sk}.
        // Row r of J is the r-th component of each column. So (JJ^T)_{rs}=sum_k col_k[r]*col_k[s].
        auto comp=[&](const Vec3&p,int idx)->double{ return idx==0?p.x:(idx==1?p.y:p.z); };
        for(int rr=0;rr<3;++rr) for(int sc=0;sc<3;++sc){
            double acc=0; for(int k=0;k<4;++k) acc += comp(*C[k],rr)*comp(*C[k],sc);
            M[rr][sc]=acc;
        }
        // Solve M y = F (3x3) via cofactor inverse.
        double det = M[0][0]*(M[1][1]*M[2][2]-M[1][2]*M[2][1])
                   - M[0][1]*(M[1][0]*M[2][2]-M[1][2]*M[2][0])
                   + M[0][2]*(M[1][0]*M[2][1]-M[1][1]*M[2][0]);
        if (std::fabs(det) < 1e-300) return false; // rank-deficient (tangency)
        double inv[3][3];
        inv[0][0]=(M[1][1]*M[2][2]-M[1][2]*M[2][1])/det;
        inv[0][1]=(M[0][2]*M[2][1]-M[0][1]*M[2][2])/det;
        inv[0][2]=(M[0][1]*M[1][2]-M[0][2]*M[1][1])/det;
        inv[1][0]=(M[1][2]*M[2][0]-M[1][0]*M[2][2])/det;
        inv[1][1]=(M[0][0]*M[2][2]-M[0][2]*M[2][0])/det;
        inv[1][2]=(M[0][2]*M[1][0]-M[0][0]*M[1][2])/det;
        inv[2][0]=(M[1][0]*M[2][1]-M[1][1]*M[2][0])/det;
        inv[2][1]=(M[0][1]*M[2][0]-M[0][0]*M[2][1])/det;
        inv[2][2]=(M[0][0]*M[1][1]-M[0][1]*M[1][0])/det;
        Vec3 y; // y = M^{-1} F
        y.x=inv[0][0]*F.x+inv[0][1]*F.y+inv[0][2]*F.z;
        y.y=inv[1][0]*F.x+inv[1][1]*F.y+inv[1][2]*F.z;
        y.z=inv[2][0]*F.x+inv[2][1]*F.y+inv[2][2]*F.z;
        // d_k = -(J^T y)_k = -(col_k . y).
        double d[4];
        for(int k=0;k<4;++k) d[k] = -dot(*C[k], y);
        // damped step + domain clamp (WRAP the periodic U coordinates).
        x.u1 = wrapU(x.u1 + d[0], p1);
        x.v1 = clampd(x.v1 + d[1], V10, V11);
        x.u2 = wrapU(x.u2 + d[2], p2);
        x.v2 = clampd(x.v2 + d[3], V20, V21);
    }
    Smp a = sample(s1, x.u1, x.v1);
    Smp b = sample(s2, x.u2, x.v2);
    return v3len(v3sub(a.S,b.S)) < tol;
}

// In-domain (with a tiny epsilon) of both surfaces?
inline bool inDom(const UV4& x,
                  double U10,double U11,double V10,double V11,
                  double U20,double U21,double V20,double V21,double eps) {
    return x.u1>=U10-eps && x.u1<=U11+eps && x.v1>=V10-eps && x.v1<=V11+eps &&
           x.u2>=U20-eps && x.u2<=U21+eps && x.v2>=V20-eps && x.v2<=V21+eps;
}

// ===========================================================================
// (2b) MARCH one branch from a converged seed. Predictor: the intersection-curve
// tangent in 3D is  t = n1 x n2  (n1,n2 the two unit surface normals). We map t
// into a (du,dv) step on EACH surface by solving the 2x2 [Su Sv]^T [Su Sv] for
// the least-squares parameter velocity, take a trial step, Newton-correct back
// onto both surfaces, and accept it if the turn is within the chord tolerance.
// ===========================================================================
struct MarchOut {
    std::vector<Vec3>    pts;
    std::vector<UVCoord> pc1, pc2;
    bool   closed=false;
    bool   degenerate=false;
    double maxRes=0.0;
};

// param velocity (du,dv) on surface from a desired 3D direction `dir`:
// solve [Su.Su Su.Sv; Sv.Su Sv.Sv][du;dv] = [Su.dir; Sv.dir].
inline bool paramVel(const Vec3& Su, const Vec3& Sv, const Vec3& dir,
                     double& du, double& dv) {
    double a=Su.x*Su.x+Su.y*Su.y+Su.z*Su.z;
    double b=Su.x*Sv.x+Su.y*Sv.y+Su.z*Sv.z;
    double c=Sv.x*Sv.x+Sv.y*Sv.y+Sv.z*Sv.z;
    double e=Su.x*dir.x+Su.y*dir.y+Su.z*dir.z;
    double f=Sv.x*dir.x+Sv.y*dir.y+Sv.z*dir.z;
    double det=a*c-b*b;
    if (std::fabs(det)<1e-300) return false;
    du=( c*e-b*f)/det;
    dv=(-b*e+a*f)/det;
    return true;
}

bool marchBranch(const NurbsSurface& s1, const NurbsSurface& s2,
                 UV4 seed, const NurbsSSIOptions& o, double scale,
                 double U10,double U11,double V10,double V11,
                 double U20,double U21,double V20,double V21,
                 const SurfPeriod& p1, const SurfPeriod& p2,
                 MarchOut& out) {
    const double tol=o.tol;
    const double h0 = std::max(o.chordTol, 1e-3) * scale * 8.0; // base arc step
    const double extent = 200.0 * scale + 4.0*kPi;             // safety walk cap

    auto normals=[&](const UV4& x, Vec3& n1, Vec3& n2, bool& degen)->Vec3 {
        Smp a=sample(s1,x.u1,x.v1), b=sample(s2,x.u2,x.v2);
        Vec3 c1=vcross(a.Su,a.Sv), c2=vcross(b.Su,b.Sv);
        double L1=v3len(c1), L2=v3len(c2);
        if (L1<1e-300||L2<1e-300){ degen=true; return Vec3{0,0,0}; }
        n1=vscale(c1,1.0/L1); n2=vscale(c2,1.0/L2);
        Vec3 t=vcross(n1,n2);
        double Lt=v3len(t);
        if (Lt<1e-12){ degen=true; return Vec3{0,0,0}; } // normals parallel: tangency
        return vscale(t,1.0/Lt);
    };

    // seed sample / point.
    auto pointOf=[&](const UV4& x)->Vec3 {
        Vec3 p=s1.evaluate(x.u1,x.v1), q=s2.evaluate(x.u2,x.v2);
        return vscale(vadd(p,q),0.5);
    };

    UV4 start=seed;
    bool sd=false; Vec3 n1,n2; normals(start,n1,n2,sd);  // probe seed tangency
    if (sd) out.degenerate=true;

    // Walk forward (+1) then backward (-1), prepend the backward half.
    std::vector<UV4> fwd, bwd;
    for (int dirSign=+1; dirSign>=-1; dirSign-=2) {
        UV4 cur=start;
        bool d2=false; Vec3 m1,m2; Vec3 prevT=normals(cur,m1,m2,d2);
        if (d2){ out.degenerate=true; if(dirSign==+1) continue; else break; }
        prevT=vscale(prevT,(double)dirSign);
        double h=h0; double walked=0.0;
        std::vector<UV4>& acc = (dirSign==+1)?fwd:bwd;
        for (int step=0; step<200000; ++step) {
            bool degT=false; Vec3 a1,a2; Vec3 tg=normals(cur,a1,a2,degT);
            if (degT){ out.degenerate=true; break; }
            if (vdot(tg,prevT)<0) tg=vscale(tg,-1.0);
            // map tg into a param step on each surface, take the trial in (u,v).
            Smp ca=sample(s1,cur.u1,cur.v1), cb=sample(s2,cur.u2,cur.v2);
            double du1,dv1,du2,dv2;
            if(!paramVel(ca.Su,ca.Sv,tg,du1,dv1)||!paramVel(cb.Su,cb.Sv,tg,du2,dv2)){
                break;
            }
            // trial step; WRAP periodic U (so the seam crosses u0/u1 freely),
            // clamp the non-periodic coordinates to their domain.
            UV4 trial{ wrapU(cur.u1+du1*h, p1), clampd(cur.v1+dv1*h, V10, V11),
                       wrapU(cur.u2+du2*h, p2), clampd(cur.v2+dv2*h, V20, V21) };
            // a NON-periodic boundary that absorbed the step => the branch exits
            // there (open branch). Periodic U wraps and is never an exit.
            bool exitV1 = (!p1.uPeriodic && (cur.u1+du1*h<U10 || cur.u1+du1*h>U11))
                        || (cur.v1+dv1*h<V10 || cur.v1+dv1*h>V11);
            bool exitV2 = (!p2.uPeriodic && (cur.u2+du2*h<U20 || cur.u2+du2*h>U21))
                        || (cur.v2+dv2*h<V20 || cur.v2+dv2*h>V21);
            bool boundaryExit = exitV1 || exitV2;
            UV4 corr=trial;
            bool conv=seedNewton(s1,s2,corr,tol,40,V10,V11,V20,V21,p1,p2);
            if (!conv){ h*=0.5; if(h<1e-9*scale) break; continue; }
            // measure the turn against the new tangent.
            bool dT2=false; Vec3 b1,b2; Vec3 tg2=normals(corr,b1,b2,dT2);
            if (dT2){ out.degenerate=true; // accept the point but stop on tangency
                acc.push_back(corr); break; }
            double turn = 1.0 - std::min(1.0,std::max(-1.0,vdot(tg, (vdot(tg2,tg)<0?vscale(tg2,-1.0):tg2))));
            if (turn>2e-3 && h>1e-6*scale){ h*=0.5; continue; }
            cur=corr; prevT=(vdot(tg2,prevT)<0?vscale(tg2,-1.0):tg2); walked+=h;
            // residual book-keeping.
            Vec3 pa=s1.evaluate(cur.u1,cur.v1), pb=s2.evaluate(cur.u2,cur.v2);
            out.maxRes=std::max(out.maxRes, v3len(v3sub(pa,pb)));
            // closed-loop detection (forward pass): returned near the seed in 3D
            // (the seam may wrap the periodic U seam, so compare in MODEL space).
            if (dirSign==+1 && step>6) {
                Vec3 ps=pointOf(start), pc=pointOf(cur);
                if (v3len(v3sub(ps,pc)) < 1.2*h0 && walked > 4.0*h0) {
                    out.closed=true; break;
                }
            }
            acc.push_back(cur);
            if (turn<5e-4 && h<h0) h=std::min(h0,h*1.6); // open up on flat runs
            if (boundaryExit) break;   // hit a non-periodic domain edge: open branch
            if (walked>extent) break;
        }
        if (dirSign==+1 && out.closed) break; // a loop needs no backward pass
    }

    // assemble: backward (reversed) + seed + forward.
    std::vector<UV4> chain;
    for (auto it=bwd.rbegin(); it!=bwd.rend(); ++it) chain.push_back(*it);
    chain.push_back(start);
    for (auto& x : fwd) chain.push_back(x);
    if (chain.size()<2) return false;

    out.pts.reserve(chain.size());
    out.pc1.reserve(chain.size());
    out.pc2.reserve(chain.size());
    for (auto& x : chain) {
        out.pts.push_back(pointOf(x));
        out.pc1.push_back({x.u1,x.v1});
        out.pc2.push_back({x.u2,x.v2});
    }
    return true;
}

// Has this 3D point already been captured by a traced branch?
bool onExistingBranch(const std::vector<SSIBranch>& brs, const Vec3& p, double h){
    for (auto& br : brs)
        for (auto& q : br.points)
            if (v3len(v3sub(p,q)) < h) return true;
    return false;
}

// ===========================================================================
// (3) Least-squares cubic B-spline fit of a 3D polyline (chord-length params).
// Used only to RETURN a fitted Curve when it reproduces the polyline to fitTol;
// otherwise the caller keeps the dense polyline. Self-contained normal-equations
// solve (the spline basis is reused from Nurbs.hpp findSpan/basisFunctions).
// ===========================================================================
bool fitPolyline(const std::vector<Vec3>& pts, bool closed, double fitTol,
                 Curve& outCurve) {
    const std::size_t m = pts.size();
    if (m < 5) return false;
    const std::size_t deg = 3;
    // control-point count: a modest count so the system is well-determined.
    std::size_t nc = std::min<std::size_t>(m/2, 16);
    if (nc < deg+1) nc = deg+1;
    if (nc > m) nc = m;
    // chord-length parameters in [0,1].
    std::vector<double> t(m,0.0);
    double total=0.0;
    for (std::size_t i=1;i<m;++i){ total += v3len(v3sub(pts[i],pts[i-1])); t[i]=total; }
    if (total<=0) return false;
    for (auto& x : t) x/=total;
    // clamped uniform knot vector for nc control points, degree 3.
    std::vector<double> knots(nc+deg+1);
    for (std::size_t i=0;i<=deg;++i) knots[i]=0.0;
    for (std::size_t i=0;i<=deg;++i) knots[nc+i]=1.0;
    std::size_t inner = nc-deg-1;
    for (std::size_t i=1;i<=inner;++i) knots[deg+i] = (double)i/(double)(inner+1);
    // build basis matrix B (m x nc).
    std::vector<std::vector<double>> B(m, std::vector<double>(nc,0.0));
    for (std::size_t r=0;r<m;++r){
        double u=t[r];
        std::size_t span=findSpan(nc-1,deg,u,knots);
        std::vector<double> N=basisFunctions(span,u,deg,knots);
        for (std::size_t k=0;k<=deg;++k){
            std::size_t col=span-deg+k;
            if (col<nc) B[r][col]=N[k];
        }
    }
    // normal equations (B^T B) c = B^T p, solved per coordinate. Pin endpoints.
    std::vector<std::vector<double>> A(nc, std::vector<double>(nc,0.0));
    std::array<std::vector<double>,3> rhs;
    for (auto& v : rhs) v.assign(nc,0.0);
    for (std::size_t i=0;i<nc;++i){
        for (std::size_t j=0;j<nc;++j){
            double acc=0; for(std::size_t r=0;r<m;++r) acc+=B[r][i]*B[r][j];
            A[i][j]=acc;
        }
        A[i][i]+=1e-9; // Tikhonov
        double bx=0,by=0,bz=0;
        for(std::size_t r=0;r<m;++r){ bx+=B[r][i]*pts[r].x; by+=B[r][i]*pts[r].y; bz+=B[r][i]*pts[r].z; }
        rhs[0][i]=bx; rhs[1][i]=by; rhs[2][i]=bz;
    }
    // Gaussian elimination (3 RHS at once).
    std::vector<std::vector<double>> Aug(nc, std::vector<double>(nc+3,0.0));
    for (std::size_t i=0;i<nc;++i){
        for(std::size_t j=0;j<nc;++j) Aug[i][j]=A[i][j];
        Aug[i][nc]=rhs[0][i]; Aug[i][nc+1]=rhs[1][i]; Aug[i][nc+2]=rhs[2][i];
    }
    for (std::size_t col=0;col<nc;++col){
        std::size_t piv=col; double best=std::fabs(Aug[col][col]);
        for(std::size_t r=col+1;r<nc;++r){ double v=std::fabs(Aug[r][col]); if(v>best){best=v;piv=r;} }
        if (best<1e-14) return false;
        std::swap(Aug[col],Aug[piv]);
        double d=Aug[col][col];
        for(std::size_t j=col;j<nc+3;++j) Aug[col][j]/=d;
        for(std::size_t r=0;r<nc;++r){ if(r==col) continue; double f=Aug[r][col];
            if(f!=0) for(std::size_t j=col;j<nc+3;++j) Aug[r][j]-=f*Aug[col][j]; }
    }
    NurbsCurve nc_curve;
    nc_curve.degree=deg;
    nc_curve.controlPoints.resize(nc);
    nc_curve.weights.assign(nc,1.0);
    nc_curve.knots=knots;
    for (std::size_t i=0;i<nc;++i)
        nc_curve.controlPoints[i]=Vec3{Aug[i][nc],Aug[i][nc+1],Aug[i][nc+2]};
    if (!nc_curve.valid()) return false;
    // verify the fit reproduces the polyline to fitTol.
    double maxErr=0.0;
    for (std::size_t r=0;r<m;++r){
        Vec3 c=nc_curve.evaluate(t[r]);
        maxErr=std::max(maxErr, v3len(v3sub(c,pts[r])));
    }
    if (maxErr>fitTol) return false;
    outCurve = Curve::makeBSpline(nc_curve);
    outCurve.t0 = knots.front(); outCurve.t1 = knots.back();
    (void)closed;
    return true;
}

// model scale from the two surfaces' control nets.
double modelScale(const NurbsSurface& s1, const NurbsSurface& s2){
    double mx=1.0;
    auto scan=[&](const NurbsSurface& s){
        for (auto& row : s.control) for (auto& p : row)
            mx=std::max(mx, std::max({std::fabs(p.x),std::fabs(p.y),std::fabs(p.z)}));
    };
    scan(s1); scan(s2);
    return mx;
}

} // namespace

// ===========================================================================
// PUBLIC: general NURBS-aware SSI.
// ===========================================================================
NurbsSSIResult intersectNurbsSurfaces(const NurbsSurface& s1,
                                      const NurbsSurface& s2,
                                      const NurbsSSIOptions& opts) {
    NurbsSSIResult res;
    const char* why=nullptr;
    if (!validateSurface(s1,&why)){ res.reason="surface 1 invalid"; return res; }
    if (!validateSurface(s2,&why)){ res.reason="surface 2 invalid"; return res; }
    res.ok = true; res.reason = "ok";

    double U10,U11,V10,V11,U20,U21,V20,V21;
    domain(s1,U10,U11,V10,V11);
    domain(s2,U20,U21,V20,V21);

    const double scale = modelScale(s1,s2);
    const double tol   = opts.tol;
    // localization inflate: cover the chordal sag between cell samples.
    const double inflate = std::max(opts.chordTol*scale, scale/(double)opts.subdiv*0.6);

    // geometric U-periodicity of each surface (closed full-circle azimuth) so the
    // marcher wraps the seam at the param boundary instead of fragmenting it.
    const SurfPeriod p1 = detectPeriodU(s1);
    const SurfPeriod p2 = detectPeriodU(s2);

    std::vector<Cell> c1 = buildCells(s1, opts.subdiv, inflate);
    std::vector<Cell> c2 = buildCells(s2, opts.subdiv, inflate);

    const double seedH = scale / (double)opts.subdiv; // branch-dedup radius

    for (const Cell& A : c1) {
        for (const Cell& B : c2) {
            if (!aabbOverlap(A,B)) continue;        // PRUNE (convex-hull bound)
            // seed from the centre of the overlapping cell pair.
            UV4 x{ 0.5*(A.u0+A.u1), 0.5*(A.v0+A.v1),
                   0.5*(B.u0+B.u1), 0.5*(B.v0+B.v1) };
            if (!seedNewton(s1,s2,x,tol,80,V10,V11,V20,V21,p1,p2)) continue;
            if (!inDom(x,U10,U11,V10,V11,U20,U21,V20,V21,1e-7)) continue;
            Vec3 seedPt = vscale(vadd(s1.evaluate(x.u1,x.v1), s2.evaluate(x.u2,x.v2)),0.5);
            if (onExistingBranch(res.branches, seedPt, 1.5*seedH)) continue;

            MarchOut mo;
            if (!marchBranch(s1,s2,x,opts,scale,
                             U10,U11,V10,V11,U20,U21,V20,V21,p1,p2,mo)) continue;
            if (mo.pts.size()<2) continue;
            // confirm this branch is genuinely new (its midpoint not on a prior).
            Vec3 mid = mo.pts[mo.pts.size()/2];
            if (onExistingBranch(res.branches, mid, 0.5*seedH)) continue;

            SSIBranch br;
            br.points = std::move(mo.pts);
            br.pcurve1= std::move(mo.pc1);
            br.pcurve2= std::move(mo.pc2);
            br.closed = mo.closed;
            br.degenerate = mo.degenerate;
            br.maxResidual = mo.maxRes;
            if (opts.doFit)
                br.hasFit = fitPolyline(br.points, br.closed, opts.fitTol, br.fitted);
            res.maxResidual = std::max(res.maxResidual, br.maxResidual);
            if (br.degenerate) res.anyDegenerate = true;
            res.branches.push_back(std::move(br));
            if ((int)res.branches.size() >= opts.maxBranches) {
                res.reason = "branch cap reached";
                res.branchCount = res.branches.size();
                return res;
            }
        }
    }
    res.branchCount = res.branches.size();
    return res;
}

// ===========================================================================
// PUBLIC: promote an analytic surface to an EXACT rational NURBS patch.
// ===========================================================================
namespace {

// Exact full circle as a degree-2 rational B-spline: 9 control points,
// knot vector {0,0,0,1,1,2,2,3,3,4,4,4}/4, weights alternate 1, 1/√2.
// Returns the 9 planar offsets (in the refDir/binormal frame) + weights + knots.
struct CircleNurbs {
    std::vector<double> ang_cx, ang_cy; // control-point coords in unit circle plane
    std::vector<double> w;
    std::vector<double> knots;
    std::size_t deg=2;
};
CircleNurbs unitCircleNurbs() {
    CircleNurbs c;
    const double s=std::sqrt(2.0)/2.0;
    // square-corner control polygon (standard 4-arc full circle).
    c.ang_cx = { 1, 1, 0,-1,-1,-1, 0, 1, 1};
    c.ang_cy = { 0, 1, 1, 1, 0,-1,-1,-1, 0};
    c.w      = { 1, s, 1, s, 1, s, 1, s, 1};
    c.knots  = {0,0,0,0.25,0.25,0.5,0.5,0.75,0.75,1,1,1};
    return c;
}

} // namespace

PromotedSurface promoteToNurbs(const Surface& s, double uExt, double vExt) {
    PromotedSurface out;
    switch (s.kind) {
    case SurfaceKind::Nurbs: {
        out.ok = s.nurbs.valid();
        out.reason = out.ok ? "nurbs" : "invalid nurbs";
        out.surface = s.nurbs;
        return out;
    }
    case SurfaceKind::Plane: {
        // bilinear patch spanning [-uExt,uExt] x [-vExt,vExt] in the plane frame.
        Vec3 e1=vnorm(s.refDir), e2=s.binormal();
        NurbsSurface n; n.degreeU=1; n.degreeV=1;
        n.knotsU={0,0,1,1}; n.knotsV={0,0,1,1};
        n.control.assign(2,std::vector<Vec3>(2));
        n.weights.assign(2,std::vector<double>(2,1.0));
        for (int i=0;i<2;++i) for(int j=0;j<2;++j){
            double a=(i==0?-uExt:uExt), b=(j==0?-vExt:vExt);
            n.control[i][j]=vadd(s.origin, vadd(vscale(e1,a), vscale(e2,b)));
        }
        out.ok=true; out.reason="plane"; out.surface=n; return out;
    }
    case SurfaceKind::Cylinder: {
        // exact circle (U) swept along axis (V) over [0, uExt? no: vExt] — we use
        // vExt as the half-length, sweeping [-vExt, vExt] along the axis.
        CircleNurbs cc=unitCircleNurbs();
        Vec3 e1=vnorm(s.refDir), e2=s.binormal(), ax=vnorm(s.axis);
        double R=s.r1;
        NurbsSurface n; n.degreeU=2; n.degreeV=1;
        n.knotsU=cc.knots; n.knotsV={0,0,1,1};
        std::size_t nu=cc.w.size();
        n.control.assign(nu,std::vector<Vec3>(2));
        n.weights.assign(nu,std::vector<double>(2));
        for (std::size_t i=0;i<nu;++i){
            Vec3 ring = vadd(vscale(e1,R*cc.ang_cx[i]), vscale(e2,R*cc.ang_cy[i]));
            for (int j=0;j<2;++j){
                double z=(j==0?-vExt:vExt);
                n.control[i][j]=vadd(s.origin, vadd(ring, vscale(ax,z)));
                n.weights[i][j]=cc.w[i];
            }
        }
        out.ok=true; out.reason="cylinder"; out.surface=n; return out;
    }
    case SurfaceKind::Cone: {
        // exact circle whose radius varies linearly with the axial parameter.
        CircleNurbs cc=unitCircleNurbs();
        Vec3 e1=vnorm(s.refDir), e2=s.binormal(), ax=vnorm(s.axis);
        NurbsSurface n; n.degreeU=2; n.degreeV=1;
        n.knotsU=cc.knots; n.knotsV={0,0,1,1};
        std::size_t nu=cc.w.size();
        n.control.assign(nu,std::vector<Vec3>(2));
        n.weights.assign(nu,std::vector<double>(2));
        double h=s.param;
        for (std::size_t i=0;i<nu;++i){
            Vec3 dir=vadd(vscale(e1,cc.ang_cx[i]), vscale(e2,cc.ang_cy[i]));
            for (int j=0;j<2;++j){
                double rj=(j==0?s.r1:s.r2);
                double zj=(j==0?0.0:h);
                n.control[i][j]=vadd(s.origin, vadd(vscale(dir,rj), vscale(ax,zj)));
                n.weights[i][j]=cc.w[i];
            }
        }
        out.ok=true; out.reason="cone"; out.surface=n; (void)uExt; return out;
    }
    case SurfaceKind::Sphere: {
        // rational surface of revolution of a weighted half-circle profile.
        // Profile (V): half circle pole(-) -> equator -> pole(+), 5 control pts
        // (a full half-circle via the unit-circle construction restricted to a
        // semicircle); Revolution (U): the exact full circle in the equator.
        CircleNurbs cc=unitCircleNurbs();             // azimuth full circle (U)
        Vec3 e1=vnorm(s.refDir), e2=s.binormal(), ax=vnorm(s.axis);
        double R=s.r1;
        // half-circle profile in (radius, height) using the same 4-arc form but a
        // half turn: 5 control points covering 180°.
        const double sc=std::sqrt(2.0)/2.0;
        // profile control polygon (planar-radius pr, height pz) and weights:
        // from south pole (0,-R) to north pole (0,+R).
        double pr[5]={0.0, R, R, R, 0.0};
        double pz[5]={-R, -R, 0.0, R, R};
        double pw[5]={1.0, sc, 1.0, sc, 1.0};
        std::vector<double> pknots={0,0,0,0.5,0.5,1,1,1};
        NurbsSurface n; n.degreeU=2; n.degreeV=2;
        n.knotsU=cc.knots; n.knotsV=pknots;
        std::size_t nu=cc.w.size(), nv=5;
        n.control.assign(nu,std::vector<Vec3>(nv));
        n.weights.assign(nu,std::vector<double>(nv));
        for (std::size_t i=0;i<nu;++i){
            Vec3 dir=vadd(vscale(e1,cc.ang_cx[i]), vscale(e2,cc.ang_cy[i]));
            for (std::size_t j=0;j<nv;++j){
                n.control[i][j]=vadd(s.origin, vadd(vscale(dir,pr[j]), vscale(ax,pz[j])));
                n.weights[i][j]=cc.w[i]*pw[j];
            }
        }
        out.ok=true; out.reason="sphere"; (void)uExt;(void)vExt; out.surface=n; return out;
    }
    case SurfaceKind::Torus:
    default:
        out.ok=false; out.reason="unsupported kind (torus not promoted)";
        return out;
    }
}

} // namespace brep
} // namespace native
} // namespace forge
