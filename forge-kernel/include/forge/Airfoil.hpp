#pragma once

// Forge-171 — Aerospace airfoil designer.
//
// Native parametric airfoil + 3D wing geometry on the OCCT B-rep kernel.
// Supports:
//   * NACA 4-digit profiles (Jacobs/NACA-TR-460 thickness + camber form)
//   * NACA 5-digit profiles (NACA-TR-537 design-lift form; non-reflex line)
//   * UIUC Selig DAT file parser (text-format airfoil database)
//   * Cosine point distribution (clusters at LE/TE for accuracy)
//   * BRep face from a closed profile via Geom_BSplineCurve interpolation
//   * Trapezoidal wing loft (multi-station ThruSections with twist, sweep,
//     dihedral, taper)

#include <string>
#include <vector>

#include "forge/ShapeRegistry.hpp"

namespace forge { namespace airfoil {

struct ProfilePoint { double x, y; };

// A profile is a closed, CCW-ordered polyline that starts and ends at the
// trailing edge (x=1) and walks upper→leading-edge→lower in chord-normalised
// units (x in [0,1]). The first and last entries are identical (closure).
struct Profile {
    std::vector<ProfilePoint> points;
    std::string               source; // "NACA-4: 2412", "Selig: NACA0012-IL", etc.
};

// NACA 4-digit. Code is exactly 4 digits, e.g. "2412".
//   m = first digit  / 100   (max camber as fraction of chord)
//   p = second digit / 10    (chord position of max camber)
//   t = last two     / 100   (max thickness as fraction of chord)
// `nPts` is the total number of points on the closed polyline; the
// upper/lower surfaces each get nPts/2 cosine-spaced stations between
// trailing- and leading-edges. Even values round down by one to keep the
// closure point unique.
Profile naca4(const std::string& code, std::size_t nPts);

// NACA 5-digit. Only the non-reflex (third-digit = 0) family is implemented
// in this slice — e.g. "23012", "24015". Three-digit reflex codes
// (third-digit = 1) throw std::invalid_argument.
//
//   First-three-digit table (mean camber line constants):
//     210: m=0.0580,  k1=361.4
//     220: m=0.1260,  k1= 51.64
//     230: m=0.2025,  k1= 15.957
//     240: m=0.2900,  k1=  6.643
//     250: m=0.3910,  k1=  3.230
//   Last two digits = thickness (same as 4-digit).
Profile naca5(const std::string& code, std::size_t nPts);

// Parse a Selig-format DAT file. Format:
//   Line 1: airfoil name (free text)
//   Line 2..K: "x y" pairs, walking upper-trailing → leading-edge → lower-trailing.
// Tolerates blank lines and extra whitespace. Rejects unnormalised files
// (x outside [-0.01, 1.01]) with std::invalid_argument.
// The returned Profile is closed (last point duplicated as first).
Profile parseSelig(const std::string& text);

// Re-sample a profile onto a cosine x-distribution of `nPts` (or keep the
// original if `nPts == 0`). Useful before lofting so two profiles have
// the same number of corresponding points.
Profile resampleCosine(const Profile& p, std::size_t nPts);

// Build a closed planar face from the profile, scaled to `chordMm`
// millimetres on the X axis. The face sits in the XY plane at Z=0,
// nose at X=0, tail at X=chordMm. Returns a ShapeHandle.
ShapeHandle profileToFace(const Profile& p, double chordMm);

// A single station along the span for a multi-section wing loft.
struct WingStation {
    Profile profile;
    double  chordMm;   // chord length at this station
    double  yMm;       // spanwise position (root = 0, tip = +halfSpan)
    double  twistDeg;  // washout (nose-down positive)
    double  sweepMm;   // chord-line LE offset along +X
    double  zMm;       // vertical offset (dihedral × y)
};

// Loft a list of stations into a solid wing using BRepOffsetAPI_ThruSections
// in solid mode. Stations must be sorted by yMm ascending. If capTips,
// the two end faces are closed (default true so the result is watertight).
// Returns a ShapeHandle to the solid TopoDS_Compound (or TopoDS_Solid).
ShapeHandle loftWing(const std::vector<WingStation>& stations, bool capTips);

// Trapezoidal-wing convenience spec.
struct TrapezoidalWingSpec {
    Profile rootProfile;
    Profile tipProfile;   // if empty, reuses rootProfile
    double  rootChordMm;
    double  taperRatio;   // tipChord = rootChord * taperRatio  (0 < taper ≤ 1)
    double  halfSpanMm;
    double  sweepDeg;     // quarter-chord sweep (Λ_c/4)
    double  dihedralDeg;
    double  twistDeg;     // total washout root → tip (applied linearly)
    int     spanStations; // ≥ 2; interpolates intermediate stations
};

// Build a trapezoidal wing in one call. Internally distributes
// `spanStations` evenly along the half-span, interpolating chord, twist,
// and (root, tip) profile blends. Tip is capped; root face is left open
// so the user can mirror it to the other half-span outside the kernel.
ShapeHandle trapezoidalWing(const TrapezoidalWingSpec& spec);

// Planform metric pack — useful for the workbench result card.
struct PlanformMetrics {
    double areaMm2;        // projected planform area (top view)
    double aspectRatio;    // span² / area  (full span = 2·halfSpan)
    double meanAeroChordMm;// MAC = (2/S)·∫c²(y)dy
    double rootChordMm;
    double tipChordMm;
    double halfSpanMm;
};

PlanformMetrics planformMetrics(const TrapezoidalWingSpec& spec);

}} // namespace forge::airfoil
