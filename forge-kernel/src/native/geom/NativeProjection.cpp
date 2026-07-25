// forge/native/geom/NativeProjection.cpp
//
// R1 — native point-projection (OCCT-zero) — see NativeProjection.hpp.
//
// Replaces the TKGeomAlgo Extrema-backed projectors with an in-house
// coarse-seed + Gauss-Newton march that uses ONLY the surviving Geom_Surface /
// Geom2d_Curve evaluators (D0, D1, Bounds, IsUPeriodic/UPeriod...). It
// generalises the existing native SurfaceProjector (src/native/mesh/Remesh.cpp:220,
// closest-point-on-triangle-soup with an expanding grid seed) and evalSurface
// (src/native/geom/Bezier.cpp:169, tensor point+dS/du+dS/dv) to the analytic /
// NURBS Geom_Surface: a global coarse (u,v) seed grid picks the basin, then
// Gauss-Newton refines the footpoint to full precision. No Extrema_*, no
// TKGeomAlgo, no TKGeomBase symbols are referenced.
//
// ===========================================================================
//  ALGORITHM (point -> surface)
// ===========================================================================
//  Minimise f(u,v) = 1/2 |S(u,v) - P|^2.  Footpoint condition (r := S - P):
//        g1 = dS/du . r = 0        (r perpendicular to the u-tangent)
//        g2 = dS/dv . r = 0        (r perpendicular to the v-tangent)
//  Gauss-Newton step (drops the 2nd-derivative curvature term  d2S . r, so we
//  need D1 only — NOT D2; the dropped term -> 0 as the footpoint residual
//  becomes normal to both tangents, i.e. near convergence, and is contained by
//  step-halving + the global seed grid):
//        a=Su.Su  b=Su.Sv  c=Sv.Sv    det=ac-b^2
//        [du]   1  [ c -b ] [-g1]
//        [dv] = - -[      ] [   ]
//              det [-b  a ] [-g2]
//  =>    du = (-g1*c + g2*b)/det,  dv = (g1*b - g2*a)/det.
//  This is the "project the residual into the tangent plane and march" step; it
//  is EXACT (one iteration, any seed) for a plane because Su,Sv are constant.
//  Periodic u/v are wrapped into the fundamental period nearest the box centre;
//  hard-finite non-periodic params are clamped to [u1,u2]/[v1,v2]; artificially
//  clamped infinite params roam free (Gauss-Newton is globally convergent in a
//  linear direction, so the seed window there is immaterial).
//
// ===========================================================================
//  MATH VERIFICATION (reasoned, NOT run — build is single-track / RAM-gated)
// ===========================================================================
//  Case: project the ORIGIN P=(0,0,0) onto the plane z=5.
//   A Geom_Plane(origin=(0,0,5), normal=+Z) parameterises S(u,v)=(u, v, 5),
//   with the constant derivatives Su=(1,0,0), Sv=(0,1,0).
//   Take any seed (u0,v0). Residual r = S-P = (u0, v0, 5).
//     a=Su.Su=1, b=Su.Sv=0, c=Sv.Sv=1, det=1.
//     g1=Su.r=u0, g2=Sv.r=v0.
//     du=(-g1*c+g2*b)/det = -u0.   dv=(g1*b-g2*a)/det = -v0.
//   Update: u=u0-u0=0, v=v0-v0=0  -> converges in ONE step (plane is linear).
//   Footpoint S(0,0)=(0,0,5) == nearest (x=0,y=0,z=5).  ✓
//   distance = |(0,0,5)-(0,0,0)| = 5.  ✓
//   General P=(x,y,0): by the same algebra u->x, v->y, footpoint (x,y,5),
//   distance 5.  ✓  (residual r=(0,0,5) is exactly the +Z surface normal, so
//   g1=g2=0 at the solution — the footpoint condition holds, as required.)
//
// ===========================================================================
//  PER-CALL-SITE WIRING PLAN  (orchestrator applies; keep OCCT as an #ifdef
//  fallback behind FORGE_NATIVE_PROJECTION so nothing breaks before the drop.
//  Only the CONSTRUCTION line changes at each site — the struct exposes the
//  same NbPoints()/LowerDistance*()/NearestPoint()/IsDone() method names.)
//
//  gate macro:  FORGE_NATIVE_PROJECTION (define -> native path; undef -> OCCT).
//  add to CMakeLists.txt sources (native/geom block, ~line 585):
//        src/native/geom/NativeProjection.cpp
//
//  (S1) src/ClassASurfacing.cpp:482,485  (point->surf, unbounded ctor)
//       OCCT:    GeomAPI_ProjectPointOnSurf projA(edgePt, sA);
//                GeomAPI_ProjectPointOnSurf projB(edgePt, sB);
//       NATIVE:  auto projA = forge::occtproj::projectPointOnSurface(edgePt, sA);
//                auto projB = forge::occtproj::projectPointOnSurface(edgePt, sB);
//       (following projX.NbPoints()<1 / projX.LowerDistanceParameters(u,v) lines
//        UNCHANGED.)  #include "forge/native/geom/NativeProjection.hpp"
//
//  (S2) src/OcctImport.cpp:939-947  (point->surf, bounded Init + unbounded
//       fallback, reused object `faceProj`)
//       OCCT:    GeomAPI_ProjectPointOnSurf faceProj;               // decl (delete)
//                faceProj.Init(q, faceSurf, umin,umax,vmin,vmax);
//                if (!faceProj.IsDone()||faceProj.NbPoints()<1){ faceProj.Init(q,faceSurf); ... }
//                faceProj.LowerDistanceParameters(uo, vo);
//       NATIVE (inside the projectOcctUV lambda; drop the outer `faceProj` decl):
//                auto r = forge::occtproj::projectPointOnSurface(q, faceSurf, umin,umax,vmin,vmax);
//                if (!r.IsDone()||r.NbPoints()<1){
//                    r = forge::occtproj::projectPointOnSurface(q, faceSurf);
//                    if (!r.IsDone()||r.NbPoints()<1) return false; }
//                r.LowerDistanceParameters(uo, vo); return true;
//
//  (S3) src/OcctNativeMesh.cpp:236,266-271  (identical bounded-Init +
//       unbounded-fallback pattern, reused object `projector`)
//       OCCT:    GeomAPI_ProjectPointOnSurf projector;              // decl (delete)
//                projector.Init(lp, surf, umin,umax,vmin,vmax);
//                if(!projector.IsDone()||projector.NbPoints()<1){ projector.Init(lp,surf); ... }
//                projector.LowerDistanceParameters(u, v);
//       NATIVE:  auto projector = forge::occtproj::projectPointOnSurface(lp, surf, umin,umax,vmin,vmax);
//                if(!projector.IsDone()||projector.NbPoints()<1){
//                    projector = forge::occtproj::projectPointOnSurface(lp, surf);
//                    if(!projector.IsDone()||projector.NbPoints()<1) return false; }
//                projector.LowerDistanceParameters(u, v);
//       (move the decl INTO the loop body since native returns by value rather
//        than being re-Init'd; the `.Init(...)` calls become the two assignments.)
//
//  (S4) src/Nurbs.cpp:716-728  (point->surf, unbounded ctor; uses NbPoints,
//       LowerDistanceParameters, NearestPoint, LowerDistance)
//       OCCT:    GeomAPI_ProjectPointOnSurf proj(P, s);
//       NATIVE:  auto proj = forge::occtproj::projectPointOnSurface(P, s);
//       (proj.NbPoints()<1 / LowerDistanceParameters / NearestPoint() /
//        LowerDistance() lines UNCHANGED — NearestPoint() returns gp_Pnt so
//        q.X()/Y()/Z() still work.)
//
//  (S5) src/native/brep/StepReadOcct.cpp:1305,1306  (point->2D-curve ctor;
//       uses NbPoints, LowerDistanceParameter)
//       OCCT:    Geom2dAPI_ProjectPointOnCurve pF(shiftToAnchor(uvF), c2);
//                Geom2dAPI_ProjectPointOnCurve pL(shiftToAnchor(uvL), c2);
//       NATIVE:  auto pF = forge::occtproj::projectPointOnCurve2d(shiftToAnchor(uvF), c2);
//                auto pL = forge::occtproj::projectPointOnCurve2d(shiftToAnchor(uvL), c2);
//       (pF.NbPoints()<1 / pF.LowerDistanceParameter() lines UNCHANGED.)
//
//  Each site keeps the OCCT branch compiled under #ifndef FORGE_NATIVE_PROJECTION
//  so the drop can be validated (Models-OS 13/13) before TKGeomAlgo/TKGeomBase
//  are removed from OCCT_LIBS; revert-if-red just undefines the macro.
// ===========================================================================

#include "forge/native/geom/NativeProjection.hpp"

// CI portability: name EVERY standard header used (libstdc++ is stricter than
// the transitive libc++ include graph on macOS).
#include <algorithm>
#include <cmath>
#include <limits>

#include <gp_Vec.hxx>
#include <gp_Vec2d.hxx>
#include <Standard_Failure.hxx>   // OCCT evaluators throw Standard_Failure on non-C1 domains

namespace forge {
namespace occtproj {

namespace {

constexpr double kBig       = 1e98;    // treat |bound| beyond this as infinite
constexpr int    kSeed      = 12;      // seed samples per direction (30 deg on a 2*pi period)
constexpr int    kMaxIter   = 64;      // Gauss-Newton cap
constexpr int    kMaxHalve  = 8;       // step back-tracking cap
constexpr double kParamTol  = 1e-11;   // parametric-step convergence
constexpr double kGradTol   = 1e-12;   // footpoint (r . tangent) convergence

inline bool isFinite(double x) { return std::fabs(x) < kBig && std::isfinite(x); }

// param clamp mode per direction
enum class Mode { Free, Clamp, Periodic };

// shift `val` by k*period to land nearest `target` (continuity / box-pin), same
// idea as OcctNativeMesh.cpp:238 shiftNear — used to canonicalise a periodic
// footpoint into the face's own parameter window.
inline double wrapNear(double val, double period, double target) {
    if (period <= 0.0) return val;
    return val + period * std::round((target - val) / period);
}

// ---------------------------------------------------------------------------
//  surface: one Gauss-Newton refinement from a seed (u,v). Returns whether a
//  finite footpoint was produced; fills u,v,dist,S.
// ---------------------------------------------------------------------------
struct RefineOut { bool ok=false; double u=0, v=0, dist=0; gp_Pnt S; };

RefineOut refineSurface(const opencascade::handle<Geom_Surface>& surf,
                        const gp_Pnt& P,
                        double u, double v,
                        Mode um, Mode vm,
                        double u1, double u2, double uPeriod, double uCentre,
                        double v1, double v2, double vPeriod, double vCentre) {
    RefineOut out;
    auto applyDomain = [&](double& uu, double& vv) {
        if (um == Mode::Periodic)      uu = wrapNear(uu, uPeriod, uCentre);
        else if (um == Mode::Clamp)    uu = std::min(std::max(uu, u1), u2);
        if (vm == Mode::Periodic)      vv = wrapNear(vv, vPeriod, vCentre);
        else if (vm == Mode::Clamp)    vv = std::min(std::max(vv, v1), v2);
    };
    applyDomain(u, v);

    gp_Pnt S; gp_Vec Su, Sv;
    double prevDist = std::numeric_limits<double>::max();
    for (int it = 0; it < kMaxIter; ++it) {
        try { surf->D1(u, v, S, Su, Sv); }
        catch (const Standard_Failure&) { return out; }   // non-C1 here: seed unusable

        gp_Vec r(P, S);                        // gp_Vec(from,to) = to-from = S - P
        const double dist = r.Magnitude();
        const double g1 = Su.Dot(r);
        const double g2 = Sv.Dot(r);
        // converged: residual normal to both tangents.
        if (std::fabs(g1) <= kGradTol && std::fabs(g2) <= kGradTol) {
            out.ok = true; out.u = u; out.v = v; out.dist = dist; out.S = S; return out;
        }
        const double a = Su.Dot(Su), b = Su.Dot(Sv), c = Sv.Dot(Sv);
        const double det = a * c - b * b;
        double du, dv;
        if (std::fabs(det) > 1e-300) {
            du = (-g1 * c + g2 * b) / det;     // Gauss-Newton normal-equation solve
            dv = ( g1 * b - g2 * a) / det;
        } else {
            // degenerate tangent frame (pole / cusp): 1-D steepest descent on
            // whichever tangent is non-degenerate so we still make progress.
            du = (a > 1e-300) ? -g1 / a : 0.0;
            dv = (c > 1e-300) ? -g2 / c : 0.0;
        }
        // step-halving guard for curved surfaces: never accept a step that
        // increases the residual (keeps Gauss-Newton monotone without D2).
        double alpha = 1.0; double nu = u, nv = v; bool moved = false;
        for (int h = 0; h < kMaxHalve; ++h) {
            nu = u + alpha * du; nv = v + alpha * dv;
            applyDomain(nu, nv);
            gp_Pnt St;
            try { surf->D0(nu, nv, St); }
            catch (const Standard_Failure&) { alpha *= 0.5; continue; }
            if (gp_Vec(P, St).Magnitude() <= dist + 1e-15) { moved = true; break; }
            alpha *= 0.5;
        }
        if (!moved) {   // cannot improve: accept current as the footpoint
            out.ok = true; out.u = u; out.v = v; out.dist = dist; out.S = S; return out;
        }
        const double step = std::fabs(nu - u) + std::fabs(nv - v);
        u = nu; v = nv;
        if (step <= kParamTol) {
            try { surf->D0(u, v, S); } catch (const Standard_Failure&) { return out; }
            out.ok = true; out.u = u; out.v = v; out.dist = gp_Vec(P, S).Magnitude(); out.S = S; return out;
        }
        prevDist = dist; (void)prevDist;
    }
    // hit the iteration cap: report the last finite footpoint (still useful).
    try { surf->D0(u, v, S); } catch (const Standard_Failure&) { return out; }
    out.ok = true; out.u = u; out.v = v; out.dist = gp_Vec(P, S).Magnitude(); out.S = S;
    return out;
}

SurfProjResult projectSurfaceImpl(const gp_Pnt& P,
                                  const opencascade::handle<Geom_Surface>& surf,
                                  double bu1, double bu2, double bv1, double bv2,
                                  bool haveBounds) {
    SurfProjResult out;
    if (surf.IsNull()) return out;

    // periodicity (guarded — some surfaces raise if asked).
    bool uPer = false, vPer = false; double uPeriod = 0.0, vPeriod = 0.0;
    try { uPer = surf->IsUPeriodic() == Standard_True; if (uPer) uPeriod = surf->UPeriod(); } catch (const Standard_Failure&) {}
    try { vPer = surf->IsVPeriodic() == Standard_True; if (vPer) vPeriod = surf->VPeriod(); } catch (const Standard_Failure&) {}

    // domain: caller bounds if given, else the surface's own Bounds().
    double u1 = bu1, u2 = bu2, v1 = bv1, v2 = bv2;
    if (!haveBounds) {
        try { surf->Bounds(u1, u2, v1, v2); }
        catch (const Standard_Failure&) { u1 = 0; u2 = 1; v1 = 0; v2 = 1; }
    }
    if (u2 < u1) std::swap(u1, u2);
    if (v2 < v1) std::swap(v1, v2);

    // per-direction mode + finite seed window.
    Mode um, vm; double su1, su2, sv1, sv2;
    if (uPer && uPeriod > 0.0) { um = Mode::Periodic; su1 = u1; su2 = u1 + uPeriod; }
    else if (isFinite(u1) && isFinite(u2)) { um = Mode::Clamp; su1 = u1; su2 = u2; }
    else { um = Mode::Free; su1 = isFinite(u1) ? u1 : -1e3; su2 = isFinite(u2) ? u2 : 1e3; }
    if (vPer && vPeriod > 0.0) { vm = Mode::Periodic; sv1 = v1; sv2 = v1 + vPeriod; }
    else if (isFinite(v1) && isFinite(v2)) { vm = Mode::Clamp; sv1 = v1; sv2 = v2; }
    else { vm = Mode::Free; sv1 = isFinite(v1) ? v1 : -1e3; sv2 = isFinite(v2) ? v2 : 1e3; }

    const double uCentre = 0.5 * (su1 + su2);
    const double vCentre = 0.5 * (sv1 + sv2);

    // A periodic direction's last seed == first (wrap), so sample kSeed points
    // over the HALF-OPEN period; a bounded/free direction samples the closed span.
    auto seedAt = [](double lo, double hi, int i, int n, bool halfOpen) {
        const int denom = halfOpen ? n : (n - 1 <= 0 ? 1 : n - 1);
        return lo + (hi - lo) * (static_cast<double>(i) / static_cast<double>(denom));
    };
    const bool uHalf = (um == Mode::Periodic);
    const bool vHalf = (vm == Mode::Periodic);

    // (1) global coarse seed: cheapest D0 grid picks the basin of the nearest
    //     footpoint (mirrors SurfaceProjector's expanding-grid nearest search).
    double bestSeedD = std::numeric_limits<double>::max();
    double seedU = uCentre, seedV = vCentre;
    for (int i = 0; i < kSeed; ++i) {
        const double u = seedAt(su1, su2, i, kSeed, uHalf);
        for (int j = 0; j < kSeed; ++j) {
            const double v = seedAt(sv1, sv2, j, kSeed, vHalf);
            gp_Pnt S;
            try { surf->D0(u, v, S); } catch (const Standard_Failure&) { continue; }
            const double d = gp_Vec(P, S).Magnitude();
            if (d < bestSeedD) { bestSeedD = d; seedU = u; seedV = v; }
        }
    }

    // (2) Gauss-Newton from the best seed, plus a couple of neighbouring seeds
    //     as insurance against a coarse grid straddling two basins.
    double bestD = std::numeric_limits<double>::max();
    auto consider = [&](double u0, double v0) {
        RefineOut r = refineSurface(surf, P, u0, v0, um, vm,
                                    su1, su2, uPeriod, uCentre,
                                    sv1, sv2, vPeriod, vCentre);
        if (r.ok && r.dist < bestD) {
            bestD = r.dist;
            out.done = true; out.points = 1;
            out.uParam = r.u; out.vParam = r.v; out.nearest = r.S; out.distance = r.dist;
        }
    };
    consider(seedU, seedV);
    // neighbours of the winning seed (one grid cell in each param).
    const double du = (su2 - su1) / static_cast<double>(uHalf ? kSeed : (kSeed - 1 > 0 ? kSeed - 1 : 1));
    const double dv = (sv2 - sv1) / static_cast<double>(vHalf ? kSeed : (kSeed - 1 > 0 ? kSeed - 1 : 1));
    consider(seedU + du, seedV);
    consider(seedU - du, seedV);
    consider(seedU, seedV + dv);
    consider(seedU, seedV - dv);

    return out;
}

// ---------------------------------------------------------------------------
//  2D curve: 1-D Gauss-Newton  t <- t - (C'.r)/(C'.C')  with r = C(t)-P.
//  Same tangent-line-projection march, exact for a straight 2D line.
// ---------------------------------------------------------------------------
struct RefineCurveOut { bool ok=false; double t=0, dist=0; gp_Pnt2d C; };

RefineCurveOut refineCurve2d(const opencascade::handle<Geom2d_Curve>& crv,
                             const gp_Pnt2d& P, double t,
                             bool periodic, double t1, double t2, double period, double centre) {
    RefineCurveOut out;
    auto applyDomain = [&](double& tt) {
        if (periodic && period > 0.0) tt = wrapNear(tt, period, centre);
        else tt = std::min(std::max(tt, t1), t2);
    };
    applyDomain(t);
    gp_Pnt2d C; gp_Vec2d Ct;
    for (int it = 0; it < kMaxIter; ++it) {
        try { crv->D1(t, C, Ct); } catch (const Standard_Failure&) { return out; }
        gp_Vec2d r(P, C);                       // C - P
        const double dist = r.Magnitude();
        const double g = Ct.Dot(r);
        const double h = Ct.Dot(Ct);
        if (std::fabs(g) <= kGradTol) { out.ok = true; out.t = t; out.dist = dist; out.C = C; return out; }
        if (h <= 1e-300) { out.ok = true; out.t = t; out.dist = dist; out.C = C; return out; } // cusp
        double dt = -g / h, alpha = 1.0, nt = t; bool moved = false;
        for (int hlv = 0; hlv < kMaxHalve; ++hlv) {
            nt = t + alpha * dt; applyDomain(nt);
            gp_Pnt2d Ctmp;
            try { crv->D0(nt, Ctmp); } catch (const Standard_Failure&) { alpha *= 0.5; continue; }
            if (gp_Vec2d(P, Ctmp).Magnitude() <= dist + 1e-15) { moved = true; break; }
            alpha *= 0.5;
        }
        if (!moved) { out.ok = true; out.t = t; out.dist = dist; out.C = C; return out; }
        const double step = std::fabs(nt - t); t = nt;
        if (step <= kParamTol) {
            try { crv->D0(t, C); } catch (const Standard_Failure&) { return out; }
            out.ok = true; out.t = t; out.dist = gp_Vec2d(P, C).Magnitude(); out.C = C; return out;
        }
    }
    try { crv->D0(t, C); } catch (const Standard_Failure&) { return out; }
    out.ok = true; out.t = t; out.dist = gp_Vec2d(P, C).Magnitude(); out.C = C;
    return out;
}

} // namespace

// ============================================================ public surface API
SurfProjResult projectPointOnSurface(const gp_Pnt& P,
                                     const opencascade::handle<Geom_Surface>& surf) {
    return projectSurfaceImpl(P, surf, 0, 0, 0, 0, /*haveBounds=*/false);
}

SurfProjResult projectPointOnSurface(const gp_Pnt& P,
                                     const opencascade::handle<Geom_Surface>& surf,
                                     double u1, double u2, double v1, double v2) {
    return projectSurfaceImpl(P, surf, u1, u2, v1, v2, /*haveBounds=*/true);
}

// ============================================================ public 2D curve API
Curve2dProjResult projectPointOnCurve2d(const gp_Pnt2d& P,
                                        const opencascade::handle<Geom2d_Curve>& crv) {
    Curve2dProjResult out;
    if (crv.IsNull()) return out;

    double t1 = 0.0, t2 = 1.0;
    try { t1 = crv->FirstParameter(); t2 = crv->LastParameter(); } catch (const Standard_Failure&) {}
    bool periodic = false; double period = 0.0;
    try { periodic = crv->IsPeriodic() == Standard_True; if (periodic) period = crv->Period(); }
    catch (const Standard_Failure&) {}

    // finite seed span (a full/unbounded periodic curve seeds over one period).
    double s1 = t1, s2 = t2;
    if (!isFinite(s1) || !isFinite(s2)) {
        if (periodic && period > 0.0) { s1 = 0.0; s2 = period; }
        else { s1 = isFinite(t1) ? t1 : -1e3; s2 = isFinite(t2) ? t2 : 1e3; }
    }
    if (s2 < s1) std::swap(s1, s2);
    const double centre = 0.5 * (s1 + s2);
    const bool halfOpen = periodic && period > 0.0;
    const int nSeed = kSeed * 2;   // curves are 1-D and cheap: sample denser.

    // (1) coarse seed.
    double bestSeedD = std::numeric_limits<double>::max(), seedT = centre;
    for (int i = 0; i < nSeed; ++i) {
        const int denom = halfOpen ? nSeed : (nSeed - 1 > 0 ? nSeed - 1 : 1);
        const double t = s1 + (s2 - s1) * (static_cast<double>(i) / static_cast<double>(denom));
        gp_Pnt2d C;
        try { crv->D0(t, C); } catch (const Standard_Failure&) { continue; }
        const double d = gp_Vec2d(P, C).Magnitude();
        if (d < bestSeedD) { bestSeedD = d; seedT = t; }
    }

    // (2) refine from the winning seed + its two neighbours.
    const double dt = (s2 - s1) / static_cast<double>(halfOpen ? nSeed : (nSeed - 1 > 0 ? nSeed - 1 : 1));
    double bestD = std::numeric_limits<double>::max();
    auto consider = [&](double t0) {
        RefineCurveOut r = refineCurve2d(crv, P, t0, periodic, s1, s2, period, centre);
        if (r.ok && r.dist < bestD) {
            bestD = r.dist; out.done = true; out.points = 1;
            out.tParam = r.t; out.nearest = r.C; out.distance = r.dist;
        }
    };
    consider(seedT); consider(seedT + dt); consider(seedT - dt);
    return out;
}

} // namespace forge::occtproj
} // namespace forge
