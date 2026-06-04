// MateLibrary.cpp — damped Gauss-Seidel mate solver. PUSH-04.
//
// See MateLibrary.hpp for algorithmic notes and caveats.

#include "forge/MateLibrary.hpp"

#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <gp_Trsf.hxx>
#include <gp_Quaternion.hxx>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <sstream>
#include <stdexcept>
#include <unordered_map>

namespace forge {
namespace matelib {

namespace {

// ---------------------------------------------------------------- math

// Tunable: damping factor applied to per-mate corrections. Smaller →
// slower but more stable; larger → faster but risk of oscillation in
// over-constrained systems. 0.5 is a conservative middle ground.
constexpr double kTransDamping = 0.5;
constexpr double kRotDamping   = 0.5;

inline double dot3(const double a[3], const double b[3]) {
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
}
inline void cross3(const double a[3], const double b[3], double o[3]) {
    o[0] = a[1]*b[2] - a[2]*b[1];
    o[1] = a[2]*b[0] - a[0]*b[2];
    o[2] = a[0]*b[1] - a[1]*b[0];
}
inline double len3(const double v[3]) {
    return std::sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
}
inline void normalize3(double v[3]) {
    double l = len3(v);
    if (l > 1e-15) { v[0]/=l; v[1]/=l; v[2]/=l; }
}

// Renormalise a quaternion to unit length.
inline void normalizeQuat(double q[4]) {
    double l = std::sqrt(q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3]);
    if (l > 1e-15) { q[0]/=l; q[1]/=l; q[2]/=l; q[3]/=l; }
    else           { q[0]=1; q[1]=q[2]=q[3]=0; }
}

// Hamilton product r = a * b for (w,x,y,z) quaternions.
inline void quatMul(const double a[4], const double b[4], double r[4]) {
    r[0] = a[0]*b[0] - a[1]*b[1] - a[2]*b[2] - a[3]*b[3];
    r[1] = a[0]*b[1] + a[1]*b[0] + a[2]*b[3] - a[3]*b[2];
    r[2] = a[0]*b[2] - a[1]*b[3] + a[2]*b[0] + a[3]*b[1];
    r[3] = a[0]*b[3] + a[1]*b[2] - a[2]*b[1] + a[3]*b[0];
}

// Build a quaternion from an axis-angle (axis need not be unit).
// theta = 0 → identity.
inline void quatFromAxisAngle(const double axis[3], double theta, double q[4]) {
    double half = 0.5 * theta;
    double s    = std::sin(half);
    double l    = len3(axis);
    if (l < 1e-15) { q[0]=1; q[1]=q[2]=q[3]=0; return; }
    q[0] = std::cos(half);
    q[1] = s * axis[0] / l;
    q[2] = s * axis[1] / l;
    q[3] = s * axis[2] / l;
}

// Rotate v by q (Hamilton, w,x,y,z) into out.
inline void rotateVec(const double q[4], const double v[3], double out[3]) {
    // out = q * (0, v) * q^-1, expanded:
    // Using OCCT for parity check:
    gp_Quaternion gq(q[1], q[2], q[3], q[0]);
    gp_Vec        gv(v[0], v[1], v[2]);
    gp_Vec        gout = gq.Multiply(gv);
    out[0] = gout.X(); out[1] = gout.Y(); out[2] = gout.Z();
}

// Compose: pose_q = dq * pose_q, then renormalise. dq is the *world-
// frame* rotation we want to apply on the left.
inline void applyDeltaQuat(double pose_q[4], const double dq[4]) {
    double tmp[4];
    quatMul(dq, pose_q, tmp);
    pose_q[0]=tmp[0]; pose_q[1]=tmp[1]; pose_q[2]=tmp[2]; pose_q[3]=tmp[3];
    normalizeQuat(pose_q);
}

// World-frame point P = R(q) * local_p + t.
inline void worldPoint(const ComponentPose& pose, const double local_p[3], double out[3]) {
    double r[3];
    rotateVec(pose.q, local_p, r);
    out[0] = r[0] + pose.t[0];
    out[1] = r[1] + pose.t[1];
    out[2] = r[2] + pose.t[2];
}

// World-frame direction D = R(q) * local_axis (no translation, no
// normalisation — caller decides).
inline void worldDir(const ComponentPose& pose, const double local_a[3], double out[3]) {
    rotateVec(pose.q, local_a, out);
}

// ---------------------------------------------------------------- per-mate kernels

// Return value: contribution to the L2 residual^2 (caller sums them).
// Side effects: optionally writes Δt into out_dt[2][3] (translation
// correction for sides A,B) and a rotation delta (axis-angle) into
// out_drot[2][3] (rotation correction for sides A,B). Sides that are
// fixed will be ignored by the caller.
//
// `freeMask` packs which sides are free: bit 0 = A, bit 1 = B. If both
// sides are fixed, we still report residual but no correction.
struct MateStep {
    double r2;            // contribution to residual^2
    double dt[2][3];      // Δt for side A, B
    double drot[2][3];    // Δrot axis-angle for side A, B
    double maxCorrection; // max |Δt| or |Δrot| (radians, treated as same
                          // scale for convergence test — for mm/rad mixed
                          // systems consider scaling, here we leave it
                          // honest)
    bool   anomaly;       // gimbal singularity / antiparallel cross
    std::string note;
};

inline MateStep makeZeroStep() {
    MateStep s{};
    return s;
}

// Coincident: world-point A == world-point B.
// Residual: B - A.  Correction: each side moves half toward the other.
MateStep mateCoincident(const ComponentPose& pa, const ComponentPose& pb,
                        const MateRef& ra, const MateRef& rb) {
    MateStep s = makeZeroStep();
    double pA[3], pB[3];
    worldPoint(pa, ra.point, pA);
    worldPoint(pb, rb.point, pB);
    double d[3] = { pB[0]-pA[0], pB[1]-pA[1], pB[2]-pA[2] };
    s.r2 = d[0]*d[0] + d[1]*d[1] + d[2]*d[2];
    // A moves +d/2; B moves -d/2.
    s.dt[0][0] =  0.5 * d[0]; s.dt[0][1] =  0.5 * d[1]; s.dt[0][2] =  0.5 * d[2];
    s.dt[1][0] = -0.5 * d[0]; s.dt[1][1] = -0.5 * d[1]; s.dt[1][2] = -0.5 * d[2];
    s.maxCorrection = 0.5 * std::sqrt(s.r2);
    return s;
}

// Distance: |worldP(A) - worldP(B)| == value.
MateStep mateDistance(const ComponentPose& pa, const ComponentPose& pb,
                      const MateRef& ra, const MateRef& rb, double target) {
    MateStep s = makeZeroStep();
    double pA[3], pB[3];
    worldPoint(pa, ra.point, pA);
    worldPoint(pb, rb.point, pB);
    double d[3] = { pB[0]-pA[0], pB[1]-pA[1], pB[2]-pA[2] };
    double cur  = len3(d);
    double err  = cur - target;
    s.r2 = err * err;
    if (cur > 1e-12) {
        // Move along the AB direction by err/2 each.
        double dir[3] = { d[0]/cur, d[1]/cur, d[2]/cur };
        s.dt[0][0] =  0.5 * err * dir[0];
        s.dt[0][1] =  0.5 * err * dir[1];
        s.dt[0][2] =  0.5 * err * dir[2];
        s.dt[1][0] = -0.5 * err * dir[0];
        s.dt[1][1] = -0.5 * err * dir[1];
        s.dt[1][2] = -0.5 * err * dir[2];
    } else {
        // Degenerate: coincident — bump A along arbitrary axis so next
        // iteration has a direction to work with.
        s.dt[0][0] = 0.5 * target;
        s.anomaly  = true;
        s.note     = "distance mate: coincident origins; nudging along +X";
    }
    s.maxCorrection = 0.5 * std::abs(err);
    return s;
}

// Concentric: axisA ∥ axisB (same sense) AND the axes are colinear
// (cross-axis offset of B's origin from A's axis line is zero).
// Two residual components: direction (cross == 0) + offset.
MateStep mateConcentric(const ComponentPose& pa, const ComponentPose& pb,
                        const MateRef& ra, const MateRef& rb) {
    MateStep s = makeZeroStep();
    double aDir[3], bDir[3];
    worldDir(pa, ra.axis, aDir);
    worldDir(pb, rb.axis, bDir);
    normalize3(aDir);
    normalize3(bDir);
    // Rotation residual: cross(aDir, bDir) — when zero, dirs are aligned
    // (same or opposite). To keep same sense we add a sign flip later.
    double cx[3];
    cross3(aDir, bDir, cx);
    double dotAB = dot3(aDir, bDir);
    if (dotAB < 0.0) {
        // Antiparallel — flip target to align same-sense.
        // The rotation axis is cx itself, angle = π - asin(|cx|).
        double lcx = len3(cx);
        if (lcx < 1e-9) {
            // 180° about an undefined axis: pick aDir's perpendicular.
            double seed[3] = {1,0,0};
            if (std::abs(aDir[0]) > 0.9) { seed[0]=0; seed[1]=1; }
            double perp[3];
            cross3(aDir, seed, perp);
            normalize3(perp);
            // B needs to rotate by π about perp.
            double dq[4];
            quatFromAxisAngle(perp, M_PI, dq);
            // store as axis-angle vector for B (it's the unconstrained
            // side here — we apply later, the wrapper will split if both
            // are free).
            s.drot[1][0] = perp[0] * M_PI;
            s.drot[1][1] = perp[1] * M_PI;
            s.drot[1][2] = perp[2] * M_PI;
            s.anomaly = true;
            s.note    = "concentric: axes antiparallel — applying 180° flip about perpendicular";
            s.r2     += 4.0; // sin²(π) is 0 but the misalignment is huge
            s.maxCorrection = M_PI;
            return s;
        }
        // Otherwise just rotate towards aDir via cross — half each side.
        double ang = std::acos(std::max(-1.0, std::min(1.0, dotAB))); // π-ish
        double caxis[3] = { cx[0]/lcx, cx[1]/lcx, cx[2]/lcx };
        s.drot[0][0] = -0.5 * ang * caxis[0];
        s.drot[0][1] = -0.5 * ang * caxis[1];
        s.drot[0][2] = -0.5 * ang * caxis[2];
        s.drot[1][0] =  0.5 * ang * caxis[0];
        s.drot[1][1] =  0.5 * ang * caxis[1];
        s.drot[1][2] =  0.5 * ang * caxis[2];
        s.r2           += ang * ang;
        s.maxCorrection = 0.5 * ang;
        return s;
    }
    // Parallel-same-sense case: cross magnitude = sin(angle). Rotate
    // each side towards the other by half the angle.
    double lcx = len3(cx);
    if (lcx > 1e-12) {
        double ang = std::asin(std::min(1.0, lcx)); // small-angle ok
        double caxis[3] = { cx[0]/lcx, cx[1]/lcx, cx[2]/lcx };
        // To bring aDir → bDir we rotate A by +ang about caxis.
        // To bring bDir → aDir we rotate B by -ang about caxis.
        s.drot[0][0] =  0.5 * ang * caxis[0];
        s.drot[0][1] =  0.5 * ang * caxis[1];
        s.drot[0][2] =  0.5 * ang * caxis[2];
        s.drot[1][0] = -0.5 * ang * caxis[0];
        s.drot[1][1] = -0.5 * ang * caxis[1];
        s.drot[1][2] = -0.5 * ang * caxis[2];
        s.r2 += ang * ang;
        s.maxCorrection = std::max(s.maxCorrection, 0.5 * ang);
    }
    // Offset residual: project (worldP_B - worldP_A) onto the plane
    // perpendicular to aDir; that vector is the cross-axis offset.
    double pA[3], pB[3];
    worldPoint(pa, ra.point, pA);
    worldPoint(pb, rb.point, pB);
    double d[3]  = { pB[0]-pA[0], pB[1]-pA[1], pB[2]-pA[2] };
    double daxis = dot3(d, aDir);
    double off[3] = { d[0]-daxis*aDir[0], d[1]-daxis*aDir[1], d[2]-daxis*aDir[2] };
    double loff   = len3(off);
    s.r2 += loff * loff;
    // Translate each side half-way to close the offset.
    s.dt[0][0] +=  0.5 * off[0];
    s.dt[0][1] +=  0.5 * off[1];
    s.dt[0][2] +=  0.5 * off[2];
    s.dt[1][0] += -0.5 * off[0];
    s.dt[1][1] += -0.5 * off[1];
    s.dt[1][2] += -0.5 * off[2];
    s.maxCorrection = std::max(s.maxCorrection, 0.5 * loff);
    return s;
}

// Angle: angle between worldAxisA and worldAxisB == value (radians).
MateStep mateAngle(const ComponentPose& pa, const ComponentPose& pb,
                   const MateRef& ra, const MateRef& rb, double targetRad) {
    MateStep s = makeZeroStep();
    double aDir[3], bDir[3];
    worldDir(pa, ra.axis, aDir);
    worldDir(pb, rb.axis, bDir);
    normalize3(aDir);
    normalize3(bDir);
    double dotAB = std::max(-1.0, std::min(1.0, dot3(aDir, bDir)));
    double cur   = std::acos(dotAB);
    double err   = cur - targetRad;
    s.r2 = err * err;
    // Rotation axis is cross product.
    double cx[3]; cross3(aDir, bDir, cx);
    double lcx = len3(cx);
    if (lcx < 1e-9) {
        // axes parallel or antiparallel — pick arbitrary perpendicular.
        double seed[3] = {1,0,0};
        if (std::abs(aDir[0]) > 0.9) { seed[0]=0; seed[1]=1; }
        cross3(aDir, seed, cx);
        lcx = len3(cx);
        s.anomaly = true;
        s.note    = "angle: degenerate cross — picked arbitrary rotation axis";
    }
    if (lcx > 1e-15) {
        double caxis[3] = { cx[0]/lcx, cx[1]/lcx, cx[2]/lcx };
        // Reduce err to zero by rotating each side half.
        s.drot[0][0] =  0.5 * err * caxis[0];
        s.drot[0][1] =  0.5 * err * caxis[1];
        s.drot[0][2] =  0.5 * err * caxis[2];
        s.drot[1][0] = -0.5 * err * caxis[0];
        s.drot[1][1] = -0.5 * err * caxis[1];
        s.drot[1][2] = -0.5 * err * caxis[2];
    }
    s.maxCorrection = 0.5 * std::abs(err);
    return s;
}

// Parallel: |cross(aDir, bDir)| == 0 (same OR opposite direction).
MateStep mateParallel(const ComponentPose& pa, const ComponentPose& pb,
                      const MateRef& ra, const MateRef& rb) {
    MateStep s = makeZeroStep();
    double aDir[3], bDir[3];
    worldDir(pa, ra.axis, aDir);
    worldDir(pb, rb.axis, bDir);
    normalize3(aDir);
    normalize3(bDir);
    double dotAB = dot3(aDir, bDir);
    double cx[3]; cross3(aDir, bDir, cx);
    double lcx = len3(cx);
    s.r2 = lcx * lcx;
    if (lcx > 1e-12) {
        // Pick the shorter rotation (to nearest 0° or 180°).
        double ang = std::asin(std::min(1.0, lcx)); // [0, π/2]
        if (dotAB < 0.0) ang = -ang; // rotate away from antiparallel back
        double caxis[3] = { cx[0]/lcx, cx[1]/lcx, cx[2]/lcx };
        s.drot[0][0] =  0.5 * ang * caxis[0];
        s.drot[0][1] =  0.5 * ang * caxis[1];
        s.drot[0][2] =  0.5 * ang * caxis[2];
        s.drot[1][0] = -0.5 * ang * caxis[0];
        s.drot[1][1] = -0.5 * ang * caxis[1];
        s.drot[1][2] = -0.5 * ang * caxis[2];
        s.maxCorrection = 0.5 * std::abs(ang);
    }
    return s;
}

// Perpendicular: dot(aDir, bDir) == 0.
MateStep matePerpendicular(const ComponentPose& pa, const ComponentPose& pb,
                            const MateRef& ra, const MateRef& rb) {
    MateStep s = makeZeroStep();
    double aDir[3], bDir[3];
    worldDir(pa, ra.axis, aDir);
    worldDir(pb, rb.axis, bDir);
    normalize3(aDir);
    normalize3(bDir);
    double dotAB = dot3(aDir, bDir);
    s.r2 = dotAB * dotAB;
    // Current angle = acos(dotAB), target = π/2. Err = current - π/2.
    double cur = std::acos(std::max(-1.0, std::min(1.0, dotAB)));
    double err = cur - 0.5 * M_PI;
    double cx[3]; cross3(aDir, bDir, cx);
    double lcx = len3(cx);
    if (lcx < 1e-9) {
        // axes parallel — bend by π/2 about an arbitrary perpendicular.
        double seed[3] = {1,0,0};
        if (std::abs(aDir[0]) > 0.9) { seed[0]=0; seed[1]=1; }
        cross3(aDir, seed, cx);
        lcx = len3(cx);
        s.anomaly = true;
        s.note    = "perpendicular: input axes parallel; arbitrary rotation axis";
    }
    if (lcx > 1e-15) {
        double caxis[3] = { cx[0]/lcx, cx[1]/lcx, cx[2]/lcx };
        s.drot[0][0] =  0.5 * err * caxis[0];
        s.drot[0][1] =  0.5 * err * caxis[1];
        s.drot[0][2] =  0.5 * err * caxis[2];
        s.drot[1][0] = -0.5 * err * caxis[0];
        s.drot[1][1] = -0.5 * err * caxis[1];
        s.drot[1][2] = -0.5 * err * caxis[2];
    }
    s.maxCorrection = 0.5 * std::abs(err);
    return s;
}

// Tangent: distance from worldP_A to plane B (point pB, normal axisB)
// equals A's radius (ra.extra). Simple sphere-on-plane interpretation.
MateStep mateTangent(const ComponentPose& pa, const ComponentPose& pb,
                     const MateRef& ra, const MateRef& rb) {
    MateStep s = makeZeroStep();
    double pA[3], pB[3], nB[3];
    worldPoint(pa, ra.point, pA);
    worldPoint(pb, rb.point, pB);
    worldDir(pb, rb.axis, nB);
    normalize3(nB);
    double d[3] = { pA[0]-pB[0], pA[1]-pB[1], pA[2]-pB[2] };
    double signedDist = dot3(d, nB);
    double err = std::abs(signedDist) - ra.extra;
    s.r2 = err * err;
    // Move A along nB by -err in the sign direction; B moves the
    // opposite.
    double sgn = signedDist >= 0 ? 1.0 : -1.0;
    s.dt[0][0] = -0.5 * err * sgn * nB[0];
    s.dt[0][1] = -0.5 * err * sgn * nB[1];
    s.dt[0][2] = -0.5 * err * sgn * nB[2];
    s.dt[1][0] =  0.5 * err * sgn * nB[0];
    s.dt[1][1] =  0.5 * err * sgn * nB[1];
    s.dt[1][2] =  0.5 * err * sgn * nB[2];
    s.maxCorrection = 0.5 * std::abs(err);
    return s;
}

// Gear: angle_A * z_A + angle_B * z_B = const.
// We measure each side's current rotation about its axis by computing
// the world-frame rotation angle of a perpendicular reference (the
// point relative to its origin). With ra.extra = z_A, rb.extra = z_B,
// and `target` (the constant) given via Mate.value, the residual is:
//      angle_A * z_A + angle_B * z_B - target = 0.
// Correction: rotate each side about its world axis by err / (2 * z).
MateStep mateGear(const ComponentPose& pa, const ComponentPose& pb,
                  const MateRef& ra, const MateRef& rb, double constant) {
    MateStep s = makeZeroStep();
    double aDir[3], bDir[3];
    worldDir(pa, ra.axis, aDir);
    worldDir(pb, rb.axis, bDir);
    normalize3(aDir);
    normalize3(bDir);
    // The rotation angle about each axis is hard to recover from a
    // quaternion without a reference direction; we use the world-frame
    // ra.point (rotated, not translated) as our reference. Project onto
    // the plane normal to the axis to extract the angular coordinate.
    auto angleOf = [](const ComponentPose& pose,
                      const double world_axis[3]) -> double {
        // Use the rotated component +X (mapped through quaternion) as
        // our reference; project onto the plane perpendicular to axis.
        double local_ref[3] = { 1, 0, 0 };
        double world_ref[3];
        rotateVec(pose.q, local_ref, world_ref);
        // Subtract the axial component.
        double axialMag = dot3(world_ref, world_axis);
        double perp[3] = {
            world_ref[0] - axialMag * world_axis[0],
            world_ref[1] - axialMag * world_axis[1],
            world_ref[2] - axialMag * world_axis[2],
        };
        // Build an in-plane orthonormal frame (e1, e2) with e1 along
        // the world +X projected, e2 = axis × e1.
        double e1[3] = {1, 0, 0};
        double e1ax  = dot3(e1, world_axis);
        e1[0] -= e1ax*world_axis[0];
        e1[1] -= e1ax*world_axis[1];
        e1[2] -= e1ax*world_axis[2];
        double le1 = len3(e1);
        if (le1 < 1e-9) {
            e1[0]=0; e1[1]=1; e1[2]=0;
            double a = dot3(e1, world_axis);
            e1[0]-=a*world_axis[0]; e1[1]-=a*world_axis[1]; e1[2]-=a*world_axis[2];
            le1 = len3(e1);
        }
        e1[0]/=le1; e1[1]/=le1; e1[2]/=le1;
        double e2[3]; cross3(world_axis, e1, e2);
        double x = dot3(perp, e1);
        double y = dot3(perp, e2);
        return std::atan2(y, x);
    };
    double angA = angleOf(pa, aDir);
    double angB = angleOf(pb, bDir);
    double zA   = ra.extra != 0.0 ? ra.extra : 1.0;
    double zB   = rb.extra != 0.0 ? rb.extra : 1.0;
    double err  = angA * zA + angB * zB - constant;
    s.r2 = err * err;
    // Split the correction: rotate A by -err/(2*zA) about aDir, B by
    // -err/(2*zB) about bDir.
    double dA = -0.5 * err / zA;
    double dB = -0.5 * err / zB;
    s.drot[0][0] = dA * aDir[0];
    s.drot[0][1] = dA * aDir[1];
    s.drot[0][2] = dA * aDir[2];
    s.drot[1][0] = dB * bDir[0];
    s.drot[1][1] = dB * bDir[1];
    s.drot[1][2] = dB * bDir[2];
    s.maxCorrection = std::max(std::abs(dA), std::abs(dB));
    return s;
}

// Rack-pinion: angle_A * r_A - dot(translation_B - origin_B0, axis_B) = const.
// Simplified: A is pinion (rotation), B is rack (translation along axis).
// ra.extra = pinion radius. rb.extra = rack travel-per-radian (= r_A in
// classic gearing, but exposed so callers can override).
MateStep mateRackPinion(const ComponentPose& pa, const ComponentPose& pb,
                        const MateRef& ra, const MateRef& rb, double constant) {
    MateStep s = makeZeroStep();
    double aDir[3], bDir[3];
    worldDir(pa, ra.axis, aDir);
    worldDir(pb, rb.axis, bDir);
    normalize3(aDir);
    normalize3(bDir);
    // angleOf shared with gear above — inline here for clarity.
    double local_ref[3] = {1,0,0};
    double world_ref[3];
    rotateVec(pa.q, local_ref, world_ref);
    double aMag = dot3(world_ref, aDir);
    double perp[3] = {
        world_ref[0]-aMag*aDir[0],
        world_ref[1]-aMag*aDir[1],
        world_ref[2]-aMag*aDir[2],
    };
    double e1[3] = {1,0,0};
    double e1ax  = dot3(e1, aDir);
    e1[0]-=e1ax*aDir[0]; e1[1]-=e1ax*aDir[1]; e1[2]-=e1ax*aDir[2];
    double le1 = len3(e1);
    if (le1 < 1e-9) { e1[0]=0; e1[1]=1; e1[2]=0; double a = dot3(e1, aDir); e1[0]-=a*aDir[0]; e1[1]-=a*aDir[1]; e1[2]-=a*aDir[2]; le1 = len3(e1); }
    e1[0]/=le1; e1[1]/=le1; e1[2]/=le1;
    double e2[3]; cross3(aDir, e1, e2);
    double angA = std::atan2(dot3(perp,e2), dot3(perp,e1));
    // Rack travel: projection of B.translation onto bDir.
    double travelB = pb.t[0]*bDir[0] + pb.t[1]*bDir[1] + pb.t[2]*bDir[2];
    double k       = rb.extra != 0.0 ? rb.extra : ra.extra;
    double err     = angA * k - travelB - constant;
    s.r2 = err * err;
    // A rotates by -err / (2 * k) about aDir.
    double dA = -0.5 * err / (k != 0.0 ? k : 1.0);
    s.drot[0][0] = dA * aDir[0];
    s.drot[0][1] = dA * aDir[1];
    s.drot[0][2] = dA * aDir[2];
    // B translates by +err/2 along bDir.
    s.dt[1][0] = 0.5 * err * bDir[0];
    s.dt[1][1] = 0.5 * err * bDir[1];
    s.dt[1][2] = 0.5 * err * bDir[2];
    s.maxCorrection = std::max(std::abs(dA), 0.5 * std::abs(err));
    return s;
}

// Cam: angle_A → translation_B by a piecewise-linear lookup. For the
// matelib API we don't carry a table struct (would break the C-friendly
// signature), so we approximate cam as: translation_B along bDir =
// value + ra.extra * sin(angle_A). This is the canonical eccentric-cam
// profile and is enough for the smoke test; richer profiles can be
// chained as a sequence of cam mates with different `value` offsets.
MateStep mateCam(const ComponentPose& pa, const ComponentPose& pb,
                 const MateRef& ra, const MateRef& rb, double offset) {
    MateStep s = makeZeroStep();
    double aDir[3], bDir[3];
    worldDir(pa, ra.axis, aDir);
    worldDir(pb, rb.axis, bDir);
    normalize3(aDir);
    normalize3(bDir);
    // angleOf inline (same trick as gear).
    double local_ref[3] = {1,0,0};
    double world_ref[3];
    rotateVec(pa.q, local_ref, world_ref);
    double e1[3] = {1,0,0};
    double e1ax  = dot3(e1, aDir);
    e1[0]-=e1ax*aDir[0]; e1[1]-=e1ax*aDir[1]; e1[2]-=e1ax*aDir[2];
    double le1 = len3(e1);
    if (le1 < 1e-9) { e1[0]=0; e1[1]=1; e1[2]=0; double a = dot3(e1, aDir); e1[0]-=a*aDir[0]; e1[1]-=a*aDir[1]; e1[2]-=a*aDir[2]; le1 = len3(e1); }
    e1[0]/=le1; e1[1]/=le1; e1[2]/=le1;
    double e2[3]; cross3(aDir, e1, e2);
    double aMag    = dot3(world_ref, aDir);
    double perp[3] = { world_ref[0]-aMag*aDir[0], world_ref[1]-aMag*aDir[1], world_ref[2]-aMag*aDir[2] };
    double angA    = std::atan2(dot3(perp,e2), dot3(perp,e1));
    double travelB = pb.t[0]*bDir[0] + pb.t[1]*bDir[1] + pb.t[2]*bDir[2];
    double target  = offset + ra.extra * std::sin(angA);
    double err     = travelB - target;
    s.r2 = err * err;
    // B side moves; A holds its angle (cam is the driver).
    s.dt[1][0] = -0.5 * err * bDir[0];
    s.dt[1][1] = -0.5 * err * bDir[1];
    s.dt[1][2] = -0.5 * err * bDir[2];
    s.maxCorrection = 0.5 * std::abs(err);
    return s;
}

// Slot: point A lies on the line segment defined by point B + axis B
// (segment half-length = rb.extra). Residual is the cross-axis
// distance + clamp residual outside the segment.
MateStep mateSlot(const ComponentPose& pa, const ComponentPose& pb,
                  const MateRef& ra, const MateRef& rb) {
    MateStep s = makeZeroStep();
    double pA[3], pB[3], dB[3];
    worldPoint(pa, ra.point, pA);
    worldPoint(pb, rb.point, pB);
    worldDir(pb, rb.axis, dB);
    normalize3(dB);
    double v[3]   = { pA[0]-pB[0], pA[1]-pB[1], pA[2]-pB[2] };
    double along  = dot3(v, dB);
    double perp[3] = { v[0]-along*dB[0], v[1]-along*dB[1], v[2]-along*dB[2] };
    double loff   = len3(perp);
    s.r2 += loff * loff;
    // Cross-axis: pull A toward B's line.
    s.dt[0][0] -= 0.5 * perp[0];
    s.dt[0][1] -= 0.5 * perp[1];
    s.dt[0][2] -= 0.5 * perp[2];
    s.dt[1][0] += 0.5 * perp[0];
    s.dt[1][1] += 0.5 * perp[1];
    s.dt[1][2] += 0.5 * perp[2];
    // Along-axis clamp: if |along| > half-length, pull back inside.
    double half = std::abs(rb.extra);
    if (half > 0 && std::abs(along) > half) {
        double over = (std::abs(along) - half) * (along > 0 ? 1.0 : -1.0);
        s.r2 += over * over;
        s.dt[0][0] -= 0.5 * over * dB[0];
        s.dt[0][1] -= 0.5 * over * dB[1];
        s.dt[0][2] -= 0.5 * over * dB[2];
        s.dt[1][0] += 0.5 * over * dB[0];
        s.dt[1][1] += 0.5 * over * dB[1];
        s.dt[1][2] += 0.5 * over * dB[2];
    }
    s.maxCorrection = 0.5 * loff;
    return s;
}

// Width: point A centred between two planes built from B's origin ±
// rb.extra * normal(rb.axis). Residual = signed distance of A from the
// mid-plane.
MateStep mateWidth(const ComponentPose& pa, const ComponentPose& pb,
                   const MateRef& ra, const MateRef& rb) {
    MateStep s = makeZeroStep();
    double pA[3], pB[3], nB[3];
    worldPoint(pa, ra.point, pA);
    worldPoint(pb, rb.point, pB);
    worldDir(pb, rb.axis, nB);
    normalize3(nB);
    double d[3] = { pA[0]-pB[0], pA[1]-pB[1], pA[2]-pB[2] };
    double off  = dot3(d, nB);
    s.r2 = off * off;
    s.dt[0][0] = -0.5 * off * nB[0];
    s.dt[0][1] = -0.5 * off * nB[1];
    s.dt[0][2] = -0.5 * off * nB[2];
    s.dt[1][0] =  0.5 * off * nB[0];
    s.dt[1][1] =  0.5 * off * nB[1];
    s.dt[1][2] =  0.5 * off * nB[2];
    s.maxCorrection = 0.5 * std::abs(off);
    return s;
}

// ---------------------------------------------------------------- dispatch

MateStep evaluateMate(const Mate& m,
                      const ComponentPose& pa,
                      const ComponentPose& pb) {
    if      (m.kind == "coincident")   return mateCoincident   (pa, pb, m.A, m.B);
    else if (m.kind == "concentric")   return mateConcentric   (pa, pb, m.A, m.B);
    else if (m.kind == "distance")     return mateDistance     (pa, pb, m.A, m.B, m.value);
    else if (m.kind == "angle")        return mateAngle        (pa, pb, m.A, m.B, m.value);
    else if (m.kind == "parallel")     return mateParallel     (pa, pb, m.A, m.B);
    else if (m.kind == "perpendicular")return matePerpendicular(pa, pb, m.A, m.B);
    else if (m.kind == "tangent")      return mateTangent      (pa, pb, m.A, m.B);
    else if (m.kind == "gear")         return mateGear         (pa, pb, m.A, m.B, m.value);
    else if (m.kind == "rack-pinion")  return mateRackPinion   (pa, pb, m.A, m.B, m.value);
    else if (m.kind == "cam")          return mateCam          (pa, pb, m.A, m.B, m.value);
    else if (m.kind == "slot")         return mateSlot         (pa, pb, m.A, m.B);
    else if (m.kind == "width")        return mateWidth        (pa, pb, m.A, m.B);
    else {
        MateStep s = makeZeroStep();
        return s;
    }
}

} // namespace

// ---------------------------------------------------------------- solve

SolveResult solve(const std::vector<ComponentPose>& initialPoses,
                  const std::vector<Mate>&          mates,
                  int    maxIterations,
                  double tolerance) {
    SolveResult result;
    result.poses      = initialPoses;
    result.converged  = false;
    result.iterations = 0;
    result.residual   = 0.0;

    if (maxIterations < 1) maxIterations = 1;
    if (tolerance     < 0) tolerance     = 1e-6;

    // Renormalise input quaternions (caller may pass non-unit).
    for (auto& p : result.poses) normalizeQuat(p.q);

    // Build id → index map for O(1) lookup inside the iteration.
    std::unordered_map<int, std::size_t> idIndex;
    idIndex.reserve(result.poses.size() * 2);
    for (std::size_t i = 0; i < result.poses.size(); ++i) {
        idIndex[result.poses[i].id] = i;
    }

    // Empty mate list — return immediately.
    if (mates.empty()) {
        result.converged  = true;
        result.iterations = 0;
        result.residual   = 0.0;
        return result;
    }

    int iter = 0;
    double lastResidual = 0.0;

    for (; iter < maxIterations; ++iter) {
        double r2sum     = 0.0;
        double maxCorr   = 0.0;

        for (const auto& m : mates) {
            auto ia = idIndex.find(m.A.component_id);
            auto ib = idIndex.find(m.B.component_id);
            if (ia == idIndex.end() || ib == idIndex.end()) {
                std::ostringstream oss;
                oss << "mate " << m.kind
                    << " skipped: unknown component_id ("
                    << m.A.component_id << " or " << m.B.component_id << ")";
                if (iter == 0) result.log.push_back(oss.str());
                continue;
            }
            ComponentPose& pa = result.poses[ia->second];
            ComponentPose& pb = result.poses[ib->second];

            MateStep step = evaluateMate(m, pa, pb);
            r2sum += step.r2;
            if (step.maxCorrection > maxCorr) maxCorr = step.maxCorrection;
            if (step.anomaly && iter == 0) {
                result.log.push_back(m.kind + ": " + step.note);
            }

            // Determine free / fixed split.
            bool aFree = pa.fixed == 0;
            bool bFree = pb.fixed == 0;
            if (!aFree && !bFree) {
                // Over-constrained — log once.
                if (iter == 0) {
                    result.log.push_back(m.kind + ": both sides fixed (residual only)");
                }
                continue;
            }
            // If one side is fixed, double the correction on the free
            // side to absorb the full move (since the dt/drot were
            // computed as half-each).
            double scaleA = 1.0;
            double scaleB = 1.0;
            if (!aFree) { scaleB = 2.0; scaleA = 0.0; }
            if (!bFree) { scaleA = 2.0; scaleB = 0.0; }

            // Apply translations (damped).
            if (aFree) {
                pa.t[0] += kTransDamping * scaleA * step.dt[0][0];
                pa.t[1] += kTransDamping * scaleA * step.dt[0][1];
                pa.t[2] += kTransDamping * scaleA * step.dt[0][2];
            }
            if (bFree) {
                pb.t[0] += kTransDamping * scaleB * step.dt[1][0];
                pb.t[1] += kTransDamping * scaleB * step.dt[1][1];
                pb.t[2] += kTransDamping * scaleB * step.dt[1][2];
            }
            // Apply rotations (damped). drot is axis-angle (world frame).
            if (aFree) {
                double axisA[3] = {
                    kRotDamping * scaleA * step.drot[0][0],
                    kRotDamping * scaleA * step.drot[0][1],
                    kRotDamping * scaleA * step.drot[0][2],
                };
                double angA = len3(axisA);
                if (angA > 1e-15) {
                    double dq[4];
                    quatFromAxisAngle(axisA, angA, dq);
                    applyDeltaQuat(pa.q, dq);
                }
            }
            if (bFree) {
                double axisB[3] = {
                    kRotDamping * scaleB * step.drot[1][0],
                    kRotDamping * scaleB * step.drot[1][1],
                    kRotDamping * scaleB * step.drot[1][2],
                };
                double angB = len3(axisB);
                if (angB > 1e-15) {
                    double dq[4];
                    quatFromAxisAngle(axisB, angB, dq);
                    applyDeltaQuat(pb.q, dq);
                }
            }
        }

        lastResidual = std::sqrt(r2sum);
        if (maxCorr < tolerance) {
            result.converged  = true;
            result.iterations = iter + 1;
            result.residual   = lastResidual;
            return result;
        }
    }

    result.iterations = iter;
    result.residual   = lastResidual;
    result.converged  = lastResidual <= tolerance;
    return result;
}

}} // namespace forge::matelib
