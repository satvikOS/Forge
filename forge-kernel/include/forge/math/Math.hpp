// forge/math/Math.hpp — umbrella for the unified native math substrate.
//
// This is the SINGLE canonical forge::math header the OCCT-zero assessment found
// missing. Include it (or the individual headers) to get the whole substitution
// boundary the fragmented per-module Vec3s and the OCCT math trio migrate onto:
//
//   Vec3        — canonical 3-vector / direction            (gp_Vec/gp_Dir/gp_XYZ)
//   Point3      — canonical 3-point, a DISTINCT type        (gp_Pnt)
//   Mat3        — 3x3 value matrix                          (gp_Mat)
//   Quaternion  — Hamilton (w,x,y,z) rotation quaternion    (gp_Quaternion)
//   Ax1/Ax2/Ax3 — axis + right/left-handed frames           (gp_Ax1/Ax2/Ax3)
//   Transform   — general affine (non-uniform scale) + rigid (gp_GTrsf/gp_Trsf)
//
// ADOPTED, not additive. That sentence used to read "It does NOT replace any
// existing per-module type; migration onto it is a separate, later wave", and it
// stopped being true: Vec3's ten per-module declarations and Point3's three are
// now aliases of these types, and tools/kernel/vec3_unification_gate.py fails if
// an eleventh or a fourth appears.
//
// Vec3 and Point3 are DELIBERATELY DISTINCT, which is also a correction: this
// header used to describe Vec3 as "3-vector / point / direction". It cannot serve
// as both -- forge/native/geom/AABBTree.hpp overloads rayIntersect and
// closestPoint on BOTH spellings, so one type is a redeclaration error. OCCT
// keeps gp_Pnt and gp_Vec separate for the same reason.
//
// Header-only, namespace forge::math, no dependency beyond the C++ standard
// library.

#ifndef FORGE_MATH_MATH_HPP
#define FORGE_MATH_MATH_HPP

#include "forge/math/Vec3.hpp"
#include "forge/math/Point3.hpp"
#include "forge/math/Mat3.hpp"
#include "forge/math/Quaternion.hpp"
#include "forge/math/Axis.hpp"
#include "forge/math/Transform.hpp"

#endif // FORGE_MATH_MATH_HPP
