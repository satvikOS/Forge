#include "forge/simulation/MechanismCase.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace forge {
namespace simulation {
namespace {

// Slender-rod inertia about the COM for a planar link: Izz = m L^2 / 12. The
// in-plane terms are small but strictly non-zero so the world inertia stays
// invertible (identical to the physics harness's planarI helper).
std::array<double, 9> planarInertia(double m, double len) {
    const double Izz = m * len * len / 12.0;
    const double Ip  = std::max(Izz * 1e-3, m * 1e-6);
    return {Ip, 0, 0, 0, Ip, 0, 0, 0, Izz};
}

// Read a named probe out of a frame. Returns false when absent.
bool probeValue(const AnimationFrame& f, const char* name, double& out) {
    for (const auto& p : f.probes) {
        if (p.name == name) { out = p.value; return true; }
    }
    return false;
}

}  // namespace

// ---------------------------------------------------------------------------
// Slider-crank
// ---------------------------------------------------------------------------

MechanismModel buildSliderCrank(const SliderCrankSpec& spec) {
    const double rC = spec.crankRadius;
    const double lR = spec.conrodLength;
    // Body COMs at t = 0 (theta = 0): crank pin at (rC, 0); slider pin at xs0.
    const double xs0 = rC + lR;

    MechanismModel m;
    m.gravity.g = {0, 0, 0};   // frictionless coasting flywheel: no gravity

    MbdBody crank;
    crank.mass = 50.0;                                  // heavy flywheel
    crank.inertia = {1, 0, 0, 0, 1, 0, 0, 0, 2.0};
    crank.position = {rC / 2.0, 0, 0};
    crank.angVel   = {0, 0, spec.crankOmega0};
    m.bodies.push_back(crank);

    MbdBody conrod;
    conrod.mass = 0.5;
    conrod.inertia  = planarInertia(0.5, lR);
    conrod.position = {(rC + xs0) / 2.0, 0, 0};
    m.bodies.push_back(conrod);

    MbdBody slider;
    slider.mass = 1.0;
    slider.inertia  = {1e-3, 0, 0, 0, 1e-3, 0, 0, 0, 1e-3};
    slider.position = {xs0, 0, 0};
    m.bodies.push_back(slider);

    if (spec.consistentInitialVelocities) {
        // Velocity loop at theta = 0 (crank and conrod collinear along +X).
        //   v_A     = w2 k x (r,0)       = (0, w2 r)          crank pin
        //   v_S     = (dx/dtheta) w2     = (0, 0)             dx/dtheta = 0 at theta=0
        //   v_S     = v_A + w3 k x (l,0) => w3 = -w2 r / l    conrod spin
        //   v_conrod COM = v_A + w3 k x (l/2,0) = (0, w2 r/2)
        //   v_crank  COM = w2 k x (r/2,0)       = (0, w2 r/2)
        const double w2 = spec.crankOmega0;
        const double w3 = -w2 * rC / lR;
        m.bodies[0].linVel = {0.0, w2 * rC / 2.0, 0.0};
        m.bodies[1].linVel = {0.0, w2 * rC / 2.0, 0.0};
        m.bodies[1].angVel = {0.0, 0.0, w3};
        m.bodies[2].linVel = {0.0, 0.0, 0.0};   // dead centre: slider at rest
    }

    MbdConstraint groundPin;                     // crank pinned to the origin
    groundPin.kind   = MbdConstraintKind::BallJoint;
    groundPin.bodyA  = 0;
    groundPin.pointA = {-rC / 2.0, 0, 0};
    groundPin.anchor = {0, 0, 0};
    m.constraints.push_back(groundPin);

    MbdConstraint crankPin;                      // crank pin <-> conrod near end
    crankPin.kind   = MbdConstraintKind::Spherical;
    crankPin.bodyA  = 0;
    crankPin.bodyB  = 1;
    crankPin.pointA = {rC / 2.0, 0, 0};
    crankPin.pointB = {-lR / 2.0, 0, 0};
    m.constraints.push_back(crankPin);

    MbdConstraint wristPin;                      // conrod far end <-> slider (closes the loop)
    wristPin.kind   = MbdConstraintKind::Spherical;
    wristPin.bodyA  = 1;
    wristPin.bodyB  = 2;
    wristPin.pointA = {lR / 2.0, 0, 0};
    wristPin.pointB = {0, 0, 0};
    m.constraints.push_back(wristPin);

    MbdConstraint rail;                          // slider confined to the X axis
    rail.kind   = MbdConstraintKind::PointOnLine;
    rail.bodyA  = 2;
    rail.pointA = {0, 0, 0};
    rail.anchor = {0, 0, 0};
    rail.axis   = {1, 0, 0};
    m.constraints.push_back(rail);

    for (std::uint32_t b = 0; b < 3; ++b) {      // keep the linkage planar
        MbdConstraint lock;
        lock.kind  = MbdConstraintKind::AxisLock;
        lock.bodyA = b;
        lock.axis  = {0, 0, 1};
        m.constraints.push_back(lock);
    }
    return m;
}

double sliderCrankAnalyticX(const SliderCrankSpec& spec, double theta) {
    const double r = spec.crankRadius;
    const double l = spec.conrodLength;
    const double s = std::sin(theta);
    return r * std::cos(theta) + std::sqrt(l * l - r * r * s * s);
}

void sliderCrankProbes(const MbdSample& s, std::vector<Probe>& out) {
    out.clear();
    if (s.orientation.size() < 3 || s.position.size() < 3) return;
    out.push_back({"crank_theta_rad", s.orientation[0][2]});
    out.push_back({"slider_x_m",      s.position[2][0]});
    out.push_back({"slider_y_m",      s.position[2][1]});
    out.push_back({"crank_omega_rad_s", s.angVel[0][2]});
}

AnalyticCheck checkSliderCrankFrames(const SliderCrankSpec& spec,
                                     const std::vector<AnimationFrame>& frames) {
    AnalyticCheck c;
    const double stroke = spec.crankRadius + spec.conrodLength;
    for (const auto& f : frames) {
        double th = 0.0, x = 0.0, y = 0.0;
        if (!probeValue(f, "crank_theta_rad", th) ||
            !probeValue(f, "slider_x_m", x) ||
            !probeValue(f, "slider_y_m", y)) {
            ++c.skippedFrames;
            continue;
        }
        const double err = std::abs(x - sliderCrankAnalyticX(spec, th));
        c.maxAbsError  = std::max(c.maxAbsError, err);
        c.maxOffAxis   = std::max(c.maxOffAxis, std::abs(y));
        c.sweptAngleRad = std::abs(th);
        ++c.comparedFrames;
    }
    c.maxErrorPct = (stroke > 0.0) ? 100.0 * c.maxAbsError / stroke : 0.0;
    return c;
}

// ---------------------------------------------------------------------------
// Four-bar
// ---------------------------------------------------------------------------

bool fourBarCouplerPin(const FourBarSpec& spec, double th2,
                       std::array<double, 2>& out) {
    const double r1 = spec.ground, r2 = spec.crank, r3 = spec.coupler, r4 = spec.rocker;
    const double Ax = r2 * std::cos(th2), Ay = r2 * std::sin(th2);
    const double dx = Ax - r1, dy = Ay;
    const double d  = std::hypot(dx, dy);
    if (!(d > 0.0)) return false;
    const double cosg = (d * d + r4 * r4 - r3 * r3) / (2.0 * d * r4);
    if (std::abs(cosg) > 1.0) return false;
    const double g   = std::acos(cosg);
    const double th4 = std::atan2(dy, dx) + g;   // open branch
    out = {r1 + r4 * std::cos(th4), r4 * std::sin(th4)};
    return true;
}

MechanismModel buildFourBar(const FourBarSpec& spec) {
    const double r1 = spec.ground, r2 = spec.crank, r3 = spec.coupler, r4 = spec.rocker;

    std::array<double, 2> B0{0, 0};
    MechanismModel m;
    m.gravity.g = {0, 0, 0};
    if (!fourBarCouplerPin(spec, 0.0, B0)) return m;  // not assemblable: empty model

    const std::array<double, 2> A0{r2, 0.0};
    const double couplerCx  = (A0[0] + B0[0]) / 2.0;
    const double couplerCy  = (A0[1] + B0[1]) / 2.0;
    const double couplerAng = std::atan2(B0[1] - A0[1], B0[0] - A0[0]);
    const double rockCx     = (r1 + B0[0]) / 2.0;
    const double rockCy     = B0[1] / 2.0;
    const double rockAng    = std::atan2(B0[1], B0[0] - r1);

    MbdBody crank;
    crank.mass     = 80.0;                            // heavy flywheel
    crank.inertia  = {1, 0, 0, 0, 1, 0, 0, 0, 3.0};
    crank.position = {r2 / 2.0, 0, 0};
    crank.angVel   = {0, 0, spec.crankOmega0};
    m.bodies.push_back(crank);

    MbdBody coupler;
    coupler.mass        = 0.4;
    coupler.inertia     = planarInertia(0.4, r3);
    coupler.position    = {couplerCx, couplerCy, 0};
    coupler.orientation = {0, 0, couplerAng};
    m.bodies.push_back(coupler);

    MbdBody rocker;
    rocker.mass        = 0.5;
    rocker.inertia     = planarInertia(0.5, r4);
    rocker.position    = {rockCx, rockCy, 0};
    rocker.orientation = {0, 0, rockAng};
    m.bodies.push_back(rocker);

    if (spec.consistentInitialVelocities) {
        // Four-bar velocity loop at theta2 = 0, with k x (x,y) = (-y, x):
        //     v_A + w3 k x (B-A) = w4 k x (B-O4)
        // Two scalar equations in (w3, w4):
        //     [ -u3y   +u4y ] [w3]   [ -vAx ]
        //     [ +u3x   -u4x ] [w4] = [ -vAy ]
        const double w2  = spec.crankOmega0;
        const double vAx = 0.0, vAy = w2 * r2;          // v_A = w2 k x (r2,0)
        const double u3x = B0[0] - A0[0], u3y = B0[1] - A0[1];
        const double u4x = B0[0] - r1,    u4y = B0[1];
        const double det = (-u3y) * (-u4x) - (u4y) * (u3x);
        if (std::abs(det) > 1e-12) {
            const double b1 = -vAx, b2 = -vAy;
            const double w3 = (b1 * (-u4x) - (u4y) * b2) / det;
            const double w4 = ((-u3y) * b2 - b1 * (u3x)) / det;
            // Crank COM at (r2/2, 0).
            m.bodies[0].linVel = {0.0, w2 * r2 / 2.0, 0.0};
            // Coupler COM = midpoint(A,B): v = v_A + w3 k x (C3 - A).
            m.bodies[1].linVel = {vAx - w3 * (couplerCy - A0[1]),
                                  vAy + w3 * (couplerCx - A0[0]), 0.0};
            m.bodies[1].angVel = {0.0, 0.0, w3};
            // Rocker COM = midpoint(O4,B): v = w4 k x (C4 - O4).
            m.bodies[2].linVel = {-w4 * (rockCy - 0.0), w4 * (rockCx - r1), 0.0};
            m.bodies[2].angVel = {0.0, 0.0, w4};
        }
    }

    MbdConstraint pinO2;                     // ground pin O2 (crank)
    pinO2.kind   = MbdConstraintKind::BallJoint;
    pinO2.bodyA  = 0;
    pinO2.pointA = {-r2 / 2.0, 0, 0};
    pinO2.anchor = {0, 0, 0};
    m.constraints.push_back(pinO2);

    MbdConstraint pinO4;                     // ground pin O4 (rocker)
    pinO4.kind   = MbdConstraintKind::BallJoint;
    pinO4.bodyA  = 2;
    pinO4.pointA = {-r4 / 2.0, 0, 0};
    pinO4.anchor = {r1, 0, 0};
    m.constraints.push_back(pinO4);

    MbdConstraint pinA;                      // crank pin A <-> coupler near end
    pinA.kind   = MbdConstraintKind::Spherical;
    pinA.bodyA  = 0;
    pinA.bodyB  = 1;
    pinA.pointA = {r2 / 2.0, 0, 0};
    pinA.pointB = {-r3 / 2.0, 0, 0};
    m.constraints.push_back(pinA);

    MbdConstraint pinB;                      // coupler far end <-> rocker far end (loop closure)
    pinB.kind   = MbdConstraintKind::Spherical;
    pinB.bodyA  = 1;
    pinB.bodyB  = 2;
    pinB.pointA = {r3 / 2.0, 0, 0};
    pinB.pointB = {r4 / 2.0, 0, 0};
    m.constraints.push_back(pinB);

    for (std::uint32_t b = 0; b < 3; ++b) {
        MbdConstraint lock;
        lock.kind  = MbdConstraintKind::AxisLock;
        lock.bodyA = b;
        lock.axis  = {0, 0, 1};
        m.constraints.push_back(lock);
    }
    return m;
}

void fourBarProbes(const MbdSample& s, std::vector<Probe>& out) {
    out.clear();
    if (s.orientation.size() < 3 || s.position.size() < 3) return;
    out.push_back({"crank_theta_rad", s.orientation[0][2]});
    // Joint B is the rocker's FAR end: the measured loop-closing pin.
    out.push_back({"rocker_theta_rad", s.orientation[2][2]});
    out.push_back({"rocker_cx_m", s.position[2][0]});
    out.push_back({"rocker_cy_m", s.position[2][1]});
    out.push_back({"crank_omega_rad_s", s.angVel[0][2]});
}

AnalyticCheck checkFourBarFrames(const FourBarSpec& spec,
                                 const std::vector<AnimationFrame>& frames) {
    AnalyticCheck c;
    const double half = spec.rocker / 2.0;
    for (const auto& f : frames) {
        double th2 = 0.0, thR = 0.0, cx = 0.0, cy = 0.0;
        if (!probeValue(f, "crank_theta_rad", th2) ||
            !probeValue(f, "rocker_theta_rad", thR) ||
            !probeValue(f, "rocker_cx_m", cx) ||
            !probeValue(f, "rocker_cy_m", cy)) {
            ++c.skippedFrames;
            continue;
        }
        std::array<double, 2> ref{0, 0};
        if (!fourBarCouplerPin(spec, th2, ref)) {   // crank angle admits no assembly
            ++c.skippedFrames;
            continue;
        }
        // Measured joint B = rocker COM + half the rocker along its own axis.
        const double bx = cx + half * std::cos(thR);
        const double by = cy + half * std::sin(thR);
        const double err = std::hypot(bx - ref[0], by - ref[1]);
        c.maxAbsError = std::max(c.maxAbsError, err);
        c.sweptAngleRad = std::abs(th2);
        ++c.comparedFrames;
    }
    c.maxErrorPct = (spec.rocker > 0.0) ? 100.0 * c.maxAbsError / spec.rocker : 0.0;
    return c;
}

// ---------------------------------------------------------------------------
// Confirmation run
// ---------------------------------------------------------------------------

ConfirmationReport runConfirmation(const MechanismModel& model,
                                   const RealtimeLoopConfig& liveCfg,
                                   const ProbeFn& probeFn,
                                   std::uint32_t refinement,
                                   double declaredEnvelopeMetres,
                                   double declaredProbeEnvelope) {
    ConfirmationReport rep;
    rep.refinement            = std::max<std::uint32_t>(2, refinement);
    rep.liveDt                = liveCfg.solverDt;
    rep.confirmationDt        = liveCfg.solverDt / static_cast<double>(rep.refinement);
    rep.declaredEnvelope      = declaredEnvelopeMetres;
    rep.declaredProbeEnvelope = declaredProbeEnvelope;

    FrameSink liveSink;
    const RealtimeRun live = driveRealtime(model.bodies, model.constraints, model.loads,
                                           model.gravity, liveCfg, probeFn, liveSink);

    RealtimeLoopConfig confCfg = liveCfg;
    confCfg.solverDt       = rep.confirmationDt;
    confCfg.stepsPerFrame  = liveCfg.stepsPerFrame * rep.refinement;
    confCfg.paceToRealtime = false;   // a confirmation run is offline by definition

    FrameSink confSink;
    const RealtimeRun conf = driveRealtime(model.bodies, model.constraints, model.loads,
                                           model.gravity, confCfg, probeFn, confSink);

    rep.liveSequenceHash         = live.sequenceHash;
    rep.confirmationSequenceHash = conf.sequenceHash;
    rep.bothRunsComplete         = live.completed && conf.completed;

    const auto& A = liveSink.frames();
    const auto& B = confSink.frames();
    const std::size_t n = std::min(A.size(), B.size());
    for (std::size_t i = 0; i < n; ++i) {
        // Frame i of both runs lands on the SAME simulated time by construction
        // (dt / k with k * stepsPerFrame), so the comparison is state-to-state.
        const std::size_t nb = std::min(A[i].bodies.size(), B[i].bodies.size());
        for (std::size_t b = 0; b < nb; ++b) {
            for (int k = 0; k < 3; ++k) {
                rep.maxPositionDelta = std::max(
                    rep.maxPositionDelta,
                    std::abs(A[i].bodies[b].position[k] - B[i].bodies[b].position[k]));
            }
        }
        for (const auto& p : A[i].probes) {
            double q = 0.0;
            if (probeValue(B[i], p.name.c_str(), q)) {
                const double d = std::abs(p.value - q);
                if (d > rep.maxProbeDelta) {
                    rep.maxProbeDelta = d;
                    rep.maxProbeName  = p.name;
                }
            }
        }
        ++rep.comparedFrames;
    }
    // BOTH declared bounds gate the verdict. Leaving the probe delta out would
    // mean the mechanism's own output -- the number the animation exists to
    // show -- had no live-vs-confirmation envelope at all.
    rep.withinEnvelope = rep.bothRunsComplete && rep.comparedFrames > 0 &&
                         rep.maxPositionDelta <= declaredEnvelopeMetres &&
                         rep.maxProbeDelta    <= declaredProbeEnvelope;
    return rep;
}

}  // namespace simulation
}  // namespace forge
