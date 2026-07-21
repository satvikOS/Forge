// forge/math/Math.hpp — umbrella for the unified native math substrate.
//
// This is the SINGLE canonical forge::math header the OCCT-zero assessment found
// missing. Include it (or the individual headers) to get the whole substitution
// boundary the fragmented per-module Vec3s and the OCCT math trio migrate onto:
//
//   Vec3        — canonical 3-vector / point / direction   (gp_Pnt/Vec/Dir/XYZ)
//   Mat3        — 3x3 value matrix                          (gp_Mat)
//   Quaternion  — Hamilton (w,x,y,z) rotation quaternion    (gp_Quaternion)
//   Ax1/Ax2/Ax3 — axis + right/left-handed frames           (gp_Ax1/Ax2/Ax3)
//   Transform   — general affine (non-uniform scale) + rigid (gp_GTrsf/gp_Trsf)
//
// ADDITIVE: header-only, namespace forge::math, no external dependencies beyond
// the C++ standard library. It does NOT replace any existing per-module type;
// migration onto it is a separate, later wave.

#ifndef FORGE_MATH_MATH_HPP
#define FORGE_MATH_MATH_HPP

#include "forge/math/Vec3.hpp"
#include "forge/math/Mat3.hpp"
#include "forge/math/Quaternion.hpp"
#include "forge/math/Axis.hpp"
#include "forge/math/Transform.hpp"

#endif // FORGE_MATH_MATH_HPP
