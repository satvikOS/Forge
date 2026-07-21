// forge/native/brep/StepReadOcct.hpp
//
// OCCT-ZERO (TKDESTEP drop) — FOREIGN STEP -> OCCT B-rep transfer WITHOUT
// STEPControl_Reader / TKDESTEP / TKXSBase.
//
// Reads an ARBITRARY external AP203 / AP214 / AP242 STEP (ISO-10303-21) instance
// file and builds the corresponding OCCT TopoDS_Solid DIRECTLY via the OCCT
// MODELING toolkits (TKBRep / TKG3d / TKGeomBase / TKTopAlgo / TKShHealing) —
// the Data-Exchange schema layer (TKDESTEP/TKXSBase) is NOT used. The transfer
// mirrors what STEPControl_Reader's TransferRoots produces for the analytic +
// b-spline core: ONE shared TopoDS_Edge per EDGE_CURVE (its exact analytic 3D
// curve, LINE/CIRCLE/ELLIPSE/B_SPLINE), ONE TopoDS_Vertex per VERTEX_POINT, and
// each ADVANCED_FACE rebuilt on its analytic Geom_Surface (PLANE / CYLINDRICAL /
// CONICAL / SPHERICAL / TOROIDAL / B_SPLINE) with the file's real trim loops.
// The result is the SAME clean topology OCCT reports (e.g. part 135 -> 38F/81E),
// so a native import measures byte-for-byte identically to the OCCT reader.
//
// HONESTY (Bible §0/§9): the ISO-10303-21 lexer (StepPart21.hpp) is shared, not
// re-derived. A surface / curve entity the transfer does not reconstruct is an
// HONEST throw (never a silent drop / faked geometry), so importStep can fall
// through or surface the truth. Compiled only under FORGE_NATIVE_BREP (it links
// OCCT modeling headers).

#ifndef FORGE_NATIVE_BREP_STEPREADOCCT_HPP
#define FORGE_NATIVE_BREP_STEPREADOCCT_HPP

#ifdef FORGE_NATIVE_BREP

#include <string>
#include <TopoDS_Shape.hxx>

namespace forge {
namespace native {
namespace brep {

// Parse the ISO-10303-21 `text` and build the OCCT B-rep solid directly (no
// TKDESTEP). Throws std::runtime_error with an honest reason on any parse
// failure or unsupported entity. On success returns a non-null TopoDS_Shape
// (a solid, or a shell when the file has no MANIFOLD_SOLID_BREP root).
TopoDS_Shape foreignStepToOcct(const std::string& text);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP
#endif // FORGE_NATIVE_BREP_STEPREADOCCT_HPP
