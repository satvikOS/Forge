#pragma once

// DirectEdit — face-level direct modelling on an existing solid.
//
// Motivation (CADGenBench editing family): every one of the benchmark's 32
// editing fixtures is a localised parametric change to a solid that already
// exists — "remove these three holes", "extend the +Z face by 10mm", "shrink
// the largest bore by 5mm", "remove the fillet from the boss". None of these
// can be expressed as a feature-tree rebuild, because there is no tree: the
// input is a naked STEP file.
//
// The kernel could not do any of it. It had 323 exported ops and no way to
// enumerate a face, let alone remove one. This module supplies the four
// primitives that the whole family reduces to:
//
//   faceInventory  — enumerate faces with the geometry needed to select one
//                    (kind, area, centroid, normal/axis, radius, concavity)
//   defeature      — delete faces and heal the wound (BRepAlgoAPI_Defeaturing)
//   pushPullFace   — translate a planar face along its normal, adding or
//                    removing material
//   resizeBore     — change a cylindrical bore's radius exactly
//
// Face indices are 1-based into TopExp::MapShapes(shape, TopAbs_FACE), which is
// deterministic for a given TopoDS_Shape. They are stable for the lifetime of a
// handle and are invalidated by any op that returns a new handle.

#include <array>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ShapeRegistry.hpp"

namespace forge {

struct FaceInfo {
    int index = 0;                       // 1-based, into the shape's face map
    std::string kind;                    // plane|cylinder|cone|sphere|torus|bspline|bezier|revolution|other
    double area = 0.0;
    std::array<double, 3> centroid{{0, 0, 0}};

    // plane: outward normal (orientation-corrected).
    // cylinder/cone/torus: the surface axis direction.
    std::array<double, 3> direction{{0, 0, 0}};

    // cylinder/cone/torus/sphere. torus: radius = major, minorRadius = blend radius.
    double radius = 0.0;
    double minorRadius = 0.0;

    // A point on the axis (cylinder/cone/torus).
    std::array<double, 3> axisLocation{{0, 0, 0}};

    // Parametric extent along the axis (cylinder), i.e. the bore's length span.
    double vMin = 0.0;
    double vMax = 0.0;

    // True when material lies OUTSIDE the surface: a bore, a hole, a concave
    // blend. False for a boss, a shaft, a convex fillet.
    bool concave = false;
};

// Merge faces that lie on the same underlying surface into one face.
//
// REQUIRED before face-level editing of any solid built on the native B-rep
// path. The native->OCCT bridge emits an analytic cylinder as N angular strips
// (makeCylinder(7,25) arrives as 128 cylindrical faces of radius 7, not one).
// Volume and area are exact, but face identity is destroyed, so "select the
// bore and resize it" has no meaning until the strips are merged back.
// On a shape imported from STEP this is normally a no-op.
ShapeHandle unifyFaces(ShapeHandle body);

// Enumerate every face of `body` with the geometry needed to select one.
std::vector<FaceInfo> faceInventory(ShapeHandle body);

// Remove `faceIndices` and extend the neighbouring faces to close the gap.
// This is the workhorse for every "remove the X" edit: holes, grooves, blends,
// bosses. Throws std::runtime_error if OCCT cannot heal the result.
ShapeHandle defeature(ShapeHandle body, const std::vector<int>& faceIndices);

// Translate planar face `faceIndex` by `distance` along `dir`. Positive
// distance adds material (the face moves outward), negative removes it.
// Throws if the face is not planar.
ShapeHandle pushPullFace(ShapeHandle body, int faceIndex,
                         const std::array<double, 3>& dir, double distance);

// Set cylindrical face `faceIndex` to `newRadius` exactly. Widening cuts the
// annulus [oldR, newR]; shrinking fuses the annulus [newR, oldR]. The axial
// span is taken from the face's own parametric extent. Throws if the face is
// not cylindrical, or if newRadius <= 0.
ShapeHandle resizeBore(ShapeHandle body, int faceIndex, double newRadius);

} // namespace forge
