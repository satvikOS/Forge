// forge/OcctNativeMesh.hpp
//
// K5 — NATIVE meshing that replaces OCCT's BRepMesh_IncrementalMesh (TKMesh) at
// the remaining runtime tessellation sites: the mixed-operand boolean soup
// (src/Booleans.cpp GAP-A + src/BooleanTol.cpp), and the Drawings HLR retry.
//
// -------------------------- HONESTY (Bible s0/s9) ---------------------------
// What is NATIVE here: the TRIANGULATION of every face is done in-house — the
// face's trimming wire is discretised (adaptive chord/angle deflection), the
// interior is filled with an adaptive UV grid, and the whole planar straight-line
// graph is triangulated by the in-house constrained Delaunay
// (forge::native::geom::constrainedDelaunay2D), keeping only the trimmed-interior
// triangles. NO BRepMesh_IncrementalMesh, NO TKMesh symbol is referenced.
//
// What still READS OCCT: the surface point/derivative evaluation and the wire
// pcurves are read through BRep_Tool / Geom_Surface / Geom2d_Curve (TKBRep /
// TKG3d / TKG2d / TKTopAlgo — NONE of them TKMesh). This is exactly the K5
// posture (drop TKMesh; the gp_/Geom_ surface substrate is migrated later by K6).
// An OCCT face the native path cannot read (a boundary edge with no pcurve) is an
// HONEST DEFERRAL (tessellateShapeToSoup returns false) — never a faked or partial
// mesh — so the caller falls back to OCCT for that shape only.
//
// This TU is part of the OCCT boundary layer (top-level src/, like Booleans.cpp /
// Tessellate.cpp): it is the one place native triangulation meets an OCCT
// TopoDS_Shape. The triangulation ALGEBRA lives in the pure-native geom/ engine.

#ifndef FORGE_OCCTNATIVEMESH_HPP
#define FORGE_OCCTNATIVEMESH_HPP

#include <cstdint>
#include <vector>

class TopoDS_Shape;

namespace forge {
namespace occtmesh {

// Native-triangulate an OCCT B-rep `shape` into a WELDED double-precision triangle
// soup (flat xyz `pos`, flat tri `idx`) — the SAME interface the native mesh-operand
// boolean engine (meshBooleanExact / booleanMeshOperand) consumes. Coordinates are
// GLOBAL (face location applied). Triangles are wound outward-consistent (the face
// orientation is honoured). `linDefl` is the absolute chord tolerance (mm) and
// `angDefl` the angular tolerance (rad) used to refine curved faces.
//
// Returns false (and does not guarantee a usable soup) when NO face could be
// triangulated OR any boundary edge lacks a pcurve — an honest deferral so the
// caller can fall back to OCCT. NEVER references BRepMesh / TKMesh.
bool tessellateShapeToSoup(const TopoDS_Shape& shape,
                           std::vector<double>& pos,
                           std::vector<std::uint32_t>& idx,
                           double linDefl,
                           double angDefl);

// Native-triangulate `shape` and ATTACH a Poly_Triangulation to every face
// in-place (BRep_Builder::UpdateFace) — the drop-in replacement for the
// BRepMesh_IncrementalMesh call that the OCCT HLR retry uses to give a curved
// shape a polyhedral facing before re-running hidden-line removal. Nodes are in
// each face's LOCAL frame (as OCCT expects an attached triangulation to be).
// Returns true if at least one face was triangulated and attached. NEVER
// references BRepMesh / TKMesh.
bool triangulateShapeInPlace(const TopoDS_Shape& shape,
                             double linDefl,
                             double angDefl);

}  // namespace occtmesh
}  // namespace forge

#endif  // FORGE_OCCTNATIVEMESH_HPP
