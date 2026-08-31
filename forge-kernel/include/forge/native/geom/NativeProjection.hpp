// forge/native/geom/NativeProjection.hpp
//
// R1 — native point-projection routines that replace OCCT's Extrema-backed
// GeomAPI_ProjectPointOnSurf (TKGeomAlgo) and Geom2dAPI_ProjectPointOnCurve
// (TKGeomAlgo). These use ONLY the surviving Geom_Surface / Geom2d_Curve
// evaluators (D0/D1, Bounds, periodicity) — no Extrema_*, no TKGeomAlgo, no
// TKGeomBase — so once every call site is switched to these routines those two
// toolkits lose their exclusive symbols and can be dropped from OCCT_LIBS.
//
// The result structs deliberately expose OCCT-named accessors (IsDone /
// NbPoints / NearestPoint / LowerDistance / LowerDistanceParameters /
// LowerDistanceParameter) so a call-site swap is textual: only the CONSTRUCTION
// line changes; every downstream `.NbPoints()`, `.LowerDistanceParameters(u,v)`
// etc. line is left byte-for-byte identical.
//
// See NativeProjection.cpp for the algorithm, the per-call-site wiring plan and
// the math-verification note.

#pragma once

#include <gp_Pnt.hxx>
#include <gp_Pnt2d.hxx>
#include <Geom_Surface.hxx>
#include <Geom2d_Curve.hxx>

namespace forge {
namespace occtproj {

// Result of a point -> surface projection. Nearest extremum only (all our call
// sites use exactly {NbPoints()<1 ? fail : nearest}), which is a faithful 1:1
// with how GeomAPI_ProjectPointOnSurf is CONSUMED in this repo.
struct SurfProjResult {
    bool   done         = false;   // algorithm produced a footpoint
    int    points       = 0;       // 1 on success, 0 on failure
    double uParam       = 0.0;     // footpoint u
    double vParam       = 0.0;     // footpoint v
    gp_Pnt nearest;                // S(u,v) — nearest point on the surface
    double distance     = 0.0;     // |P - nearest|

    // ---- OCCT-name-compatible accessors (keep call-site lines unchanged) ----
    bool          IsDone()        const { return done; }
    int           NbPoints()      const { return points; }
    const gp_Pnt& NearestPoint()  const { return nearest; }
    double        LowerDistance() const { return distance; }
    void LowerDistanceParameters(double& u, double& v) const { u = uParam; v = vParam; }
};

// Result of a point -> 2D-curve projection (single nearest footpoint).
struct Curve2dProjResult {
    bool     done      = false;
    int      points    = 0;
    double   tParam    = 0.0;      // footpoint parameter
    gp_Pnt2d nearest;              // C(t) — nearest point on the curve
    double   distance  = 0.0;      // |P - nearest|

    bool            IsDone()               const { return done; }
    int             NbPoints()             const { return points; }
    const gp_Pnt2d& NearestPoint()         const { return nearest; }
    double          LowerDistance()        const { return distance; }
    double          LowerDistanceParameter() const { return tParam; }
};

// Point -> surface projection over the surface's own (possibly infinite/periodic)
// parametric domain. Replacement for `GeomAPI_ProjectPointOnSurf(P, surf)`.
SurfProjResult projectPointOnSurface(const gp_Pnt&                  P,
                                     const opencascade::handle<Geom_Surface>& surf);

// Bounded variant — restricts the coarse seed grid and clamping to the given
// [u1,u2]x[v1,v2] box (e.g. a face's BRepTools::UVBounds). Replacement for
// `GeomAPI_ProjectPointOnSurf::Init(P, surf, u1,u2,v1,v2)`.
SurfProjResult projectPointOnSurface(const gp_Pnt&                  P,
                                     const opencascade::handle<Geom_Surface>& surf,
                                     double u1, double u2, double v1, double v2);

// Point -> 2D curve projection over the curve's parameter range. Replacement
// for `Geom2dAPI_ProjectPointOnCurve(P2d, curve2d)`.
Curve2dProjResult projectPointOnCurve2d(const gp_Pnt2d&                 P,
                                        const opencascade::handle<Geom2d_Curve>& curve);

} // namespace occtproj
} // namespace forge
