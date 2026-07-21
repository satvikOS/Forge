// forge/OcctPrimBuilder.hpp — TKPrim-free analytic OCCT primitive solids.
//
// Builds each canonical OCCT primitive SOLID DIRECTLY on the surviving modeling
// toolkits (Geom_ analytic surfaces on TKG3d + BRepBuilderAPI on TKBRep/TKTopAlgo)
// instead of BRepPrimAPI (TKPrim). Same watertight, analytic, outward-oriented
// TopoDS_Solid a BRepPrimAPI_Make{Box,Cylinder,Cone,Sphere,Torus,Wedge} would
// produce — sphere/torus as the single periodic face, cylinder/cone as one
// lateral surface + planar caps — so downstream booleans / mass-props / STEP write
// see the identical minimal analytic B-rep. This is the OCCT-zero (TKPrim-drop)
// re-implementation: NO BRepPrimAPI symbol is referenced from these builders.
#pragma once

#include <TopoDS_Solid.hxx>
#include <gp_Ax2.hxx>
#include <gp_Pnt.hxx>

namespace forge {

// Sphere: ONE Geom_SphericalSurface periodic face (seam meridian + 2 degenerate
// poles) wrapped in a closed shell — exactly BRepPrimAPI_MakeSphere's topology.
TopoDS_Solid occtSphereSolid(const gp_Ax2& ax, double r);
TopoDS_Solid occtSphereSolid(double r);  // centred at origin, +Z/+X frame

// Torus: ONE Geom_ToroidalSurface doubly-periodic face (genus 1, 2 seams).
TopoDS_Solid occtTorusSolid(const gp_Ax2& ax, double majorR, double minorR);
TopoDS_Solid occtTorusSolid(double majorR, double minorR);

// Cylinder: one Geom_CylindricalSurface lateral over [0,2pi]x[0,h] + 2 planar
// circular caps, sewn into a closed solid. `ax` base circle centre / axis / refDir.
TopoDS_Solid occtCylinderSolid(const gp_Ax2& ax, double r, double h);
TopoDS_Solid occtCylinderSolid(double r, double h);  // base at origin, axis +Z

// Cone / frustum: one Geom_ConicalSurface lateral + planar caps (2 for a frustum;
// the apex end contributes no cap). Base radius r1 at `ax` origin, top radius r2 at
// origin + h*axis — matching BRepPrimAPI_MakeCone(ax, r1, r2, h). r1==r2 -> cylinder.
TopoDS_Solid occtConeSolid(const gp_Ax2& ax, double r1, double r2, double h);
TopoDS_Solid occtConeSolid(double r1, double r2, double h);

// Box: 6 planar Geom_Plane faces on 12 shared edges / 8 shared vertices (exact
// 6F/12E canonical B-rep). Axis-aligned min/max corner form + origin dx/dy/dz form.
TopoDS_Solid occtBoxSolid(const gp_Pnt& lo, const gp_Pnt& hi);
TopoDS_Solid occtBoxSolid(double dx, double dy, double dz);  // min corner at origin

// Right-angular wedge: a box dx*dy*dz whose +Y face is shrunk in X to length ltx,
// min corner at the origin. Matches BRepPrimAPI_MakeWedge(dx,dy,dz,ltx). 6F/12E.
TopoDS_Solid occtWedgeSolid(double dx, double dy, double dz, double ltx);

}  // namespace forge
