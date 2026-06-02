#include "forge/Airfoil.hpp"

#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <GeomAPI_PointsToBSpline.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Precision.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax1.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstring>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace forge { namespace airfoil {

namespace {

constexpr double PI = 3.14159265358979323846;

// Cosine x-distribution on [0,1] with N sample points, clustering near 0 and 1.
//   x_i = 0.5 * (1 - cos( pi * i / (N-1) ))   for i = 0..N-1
std::vector<double> cosineX(std::size_t n) {
    std::vector<double> x(n);
    if (n == 0) return x;
    if (n == 1) { x[0] = 0.0; return x; }
    for (std::size_t i = 0; i < n; ++i) {
        x[i] = 0.5 * (1.0 - std::cos(PI * static_cast<double>(i) /
                                          static_cast<double>(n - 1)));
    }
    return x;
}

// NACA 4-digit half-thickness distribution (closed trailing edge variant
// uses the 0.1036 coefficient on the x^4 term so yt(1) = 0). We pick the
// open-TE form (0.1015) for industry-standard agreement; the e2e/loft
// adds a tiny pinch at the trailing edge if needed.
double nacaThickness4(double xc, double t) {
    if (xc < 0.0) xc = 0.0;
    if (xc > 1.0) xc = 1.0;
    const double sx = std::sqrt(xc);
    return (t / 0.20) * ( 0.2969 * sx
                        - 0.1260 * xc
                        - 0.3516 * xc * xc
                        + 0.2843 * xc * xc * xc
                        - 0.1015 * xc * xc * xc * xc);
}

void nacaCamber4(double xc, double m, double p,
                 double& yc, double& dycdx) {
    if (m == 0.0 || p == 0.0) { yc = 0.0; dycdx = 0.0; return; }
    if (xc < p) {
        yc    = (m / (p * p)) * (2.0 * p * xc - xc * xc);
        dycdx = (m / (p * p)) * (2.0 * p - 2.0 * xc);
    } else {
        const double q = 1.0 - p;
        yc    = (m / (q * q)) * ((1.0 - 2.0 * p) + 2.0 * p * xc - xc * xc);
        dycdx = (m / (q * q)) * (2.0 * p - 2.0 * xc);
    }
}

// NACA 5-digit non-reflex mean-camber line.
//   x < m :  yc = (k1/6) * ( x^3 - 3 m x^2 + m^2 (3 - m) x )
//   x >= m:  yc = (k1 m^3 / 6) * (1 - x)
// Slope derived by direct differentiation.
void nacaCamber5(double xc, double m, double k1,
                 double& yc, double& dycdx) {
    if (xc < m) {
        yc    = (k1 / 6.0) * (xc * xc * xc
                            - 3.0 * m * xc * xc
                            + m * m * (3.0 - m) * xc);
        dycdx = (k1 / 6.0) * (3.0 * xc * xc
                            - 6.0 * m * xc
                            + m * m * (3.0 - m));
    } else {
        yc    = (k1 * m * m * m / 6.0) * (1.0 - xc);
        dycdx = -(k1 * m * m * m / 6.0);
    }
}

// Rotate a thickness vector around the camber line so upper/lower surfaces
// follow the camber slope theta = atan(dyc/dx).
void offsetSurfaces(double xc, double yc, double yt, double dycdx,
                    double& xu, double& yu, double& xl, double& yl) {
    const double theta = std::atan(dycdx);
    const double s = std::sin(theta);
    const double c = std::cos(theta);
    xu = xc - yt * s;
    yu = yc + yt * c;
    xl = xc + yt * s;
    yl = yc - yt * c;
}

// Build a closed Profile from independent upper + lower point lists.
// Upper goes from trailing-edge to leading-edge (descending x), then lower
// from leading-edge to trailing-edge (ascending x). Caller passes the upper
// stations in ascending-x order; this helper reverses appropriately.
Profile assembleClosed(const std::vector<ProfilePoint>& upperAscX,
                       const std::vector<ProfilePoint>& lowerAscX,
                       std::string source) {
    Profile out;
    out.source = std::move(source);
    // upper: walk in descending x: from xa[N-1] (TE) → xa[0] (LE)
    for (std::size_t i = upperAscX.size(); i-- > 0; ) {
        out.points.push_back(upperAscX[i]);
    }
    // lower: walk in ascending x: from xa[0] (LE, skip — already added) → xa[N-1] (TE)
    // Skip the first lower point if it shares the leading edge with the
    // last upper point we appended (xc=0, both interpolate to the same x).
    std::size_t startLower = 0;
    if (!lowerAscX.empty() && !out.points.empty()
        && std::abs(lowerAscX[0].x - out.points.back().x) < 1e-12
        && std::abs(lowerAscX[0].y - out.points.back().y) < 1e-12) {
        startLower = 1;
    }
    for (std::size_t i = startLower; i < lowerAscX.size(); ++i) {
        out.points.push_back(lowerAscX[i]);
    }
    // Close: append a duplicate of the first point.
    if (!out.points.empty()
        && (std::abs(out.points.front().x - out.points.back().x) > 1e-12
         || std::abs(out.points.front().y - out.points.back().y) > 1e-12)) {
        out.points.push_back(out.points.front());
    }
    return out;
}

bool isDigit(char c) { return c >= '0' && c <= '9'; }

void parseNaca4Code(const std::string& code, double& m, double& p, double& t) {
    if (code.size() != 4 || !std::all_of(code.begin(), code.end(), isDigit)) {
        throw std::invalid_argument(
            "forge.airfoil.naca4: code must be exactly 4 digits, got '" + code + "'");
    }
    m = (code[0] - '0') / 100.0;
    p = (code[1] - '0') / 10.0;
    t = ((code[2] - '0') * 10 + (code[3] - '0')) / 100.0;
    if (t <= 0.0) {
        throw std::invalid_argument(
            "forge.airfoil.naca4: thickness must be > 0, got '" + code + "'");
    }
    // A symmetric airfoil (camber=0) needs p ignored — accept p=0 in that case.
    if (m > 0.0 && p <= 0.0) {
        throw std::invalid_argument(
            "forge.airfoil.naca4: cambered code requires non-zero p, got '" + code + "'");
    }
}

void parseNaca5Code(const std::string& code, double& m, double& k1, double& t) {
    if (code.size() != 5 || !std::all_of(code.begin(), code.end(), isDigit)) {
        throw std::invalid_argument(
            "forge.airfoil.naca5: code must be exactly 5 digits, got '" + code + "'");
    }
    // First three digits → mean line family. Only non-reflex (third = 0) here.
    const int firstThree = (code[0] - '0') * 100 + (code[1] - '0') * 10 + (code[2] - '0');
    if (code[2] != '0') {
        throw std::invalid_argument(
            "forge.airfoil.naca5: only non-reflex camber lines (third-digit = 0) "
            "are supported in this slice; got '" + code + "'");
    }
    switch (firstThree) {
        case 210: m = 0.0580;  k1 =  361.4;   break;
        case 220: m = 0.1260;  k1 =   51.640; break;
        case 230: m = 0.2025;  k1 =   15.957; break;
        case 240: m = 0.2900;  k1 =    6.643; break;
        case 250: m = 0.3910;  k1 =    3.230; break;
        default:
            throw std::invalid_argument(
                "forge.airfoil.naca5: unsupported first-three-digit family '"
                + code.substr(0, 3) + "'; supported: 210, 220, 230, 240, 250");
    }
    t = ((code[3] - '0') * 10 + (code[4] - '0')) / 100.0;
    if (t <= 0.0) {
        throw std::invalid_argument(
            "forge.airfoil.naca5: thickness must be > 0, got '" + code + "'");
    }
}

} // anonymous namespace

// ============================================================ NACA 4-digit
Profile naca4(const std::string& code, std::size_t nPts) {
    double m, p, t;
    parseNaca4Code(code, m, p, t);
    // Force an even number of surface stations so upper + lower can pair up.
    // Total closed-polyline points ≈ nPts; per-surface station count = nPts/2 + 1.
    if (nPts < 6) nPts = 6;
    const std::size_t nStations = nPts / 2 + 1;
    const auto xc = cosineX(nStations);
    std::vector<ProfilePoint> upper(nStations), lower(nStations);
    for (std::size_t i = 0; i < nStations; ++i) {
        const double x = xc[i];
        double yc, dycdx;
        nacaCamber4(x, m, p, yc, dycdx);
        const double yt = nacaThickness4(x, t);
        double xu, yu, xl, yl;
        offsetSurfaces(x, yc, yt, dycdx, xu, yu, xl, yl);
        upper[i] = ProfilePoint{ xu, yu };
        lower[i] = ProfilePoint{ xl, yl };
    }
    return assembleClosed(upper, lower, "NACA-4: " + code);
}

// ============================================================ NACA 5-digit
Profile naca5(const std::string& code, std::size_t nPts) {
    double m, k1, t;
    parseNaca5Code(code, m, k1, t);
    if (nPts < 6) nPts = 6;
    const std::size_t nStations = nPts / 2 + 1;
    const auto xc = cosineX(nStations);
    std::vector<ProfilePoint> upper(nStations), lower(nStations);
    for (std::size_t i = 0; i < nStations; ++i) {
        const double x = xc[i];
        double yc, dycdx;
        nacaCamber5(x, m, k1, yc, dycdx);
        const double yt = nacaThickness4(x, t); // 5-digit reuses 4-digit thickness form
        double xu, yu, xl, yl;
        offsetSurfaces(x, yc, yt, dycdx, xu, yu, xl, yl);
        upper[i] = ProfilePoint{ xu, yu };
        lower[i] = ProfilePoint{ xl, yl };
    }
    return assembleClosed(upper, lower, "NACA-5: " + code);
}

// ============================================================ Selig parser
Profile parseSelig(const std::string& text) {
    Profile out;
    std::istringstream is(text);
    std::string line;
    bool sawName = false;
    while (std::getline(is, line)) {
        // Strip CR + leading/trailing whitespace.
        if (!line.empty() && line.back() == '\r') line.pop_back();
        std::size_t a = 0;
        while (a < line.size() && std::isspace(static_cast<unsigned char>(line[a]))) ++a;
        std::size_t b = line.size();
        while (b > a && std::isspace(static_cast<unsigned char>(line[b-1]))) --b;
        const std::string trimmed = line.substr(a, b - a);
        if (trimmed.empty()) continue;
        // Try to parse two floats. If that fails AND we haven't named yet, treat as name.
        std::istringstream ls(trimmed);
        double x, y;
        if (ls >> x >> y) {
            // Lednicer format files sometimes start with "N N" header pair
            // (counts of upper and lower stations); reject by checking
            // x or y is way outside [0,1].
            const bool plausible = (x >= -0.01 && x <= 1.01)
                                && (y >= -0.5  && y <= 0.5);
            if (!plausible) {
                if (!sawName) { out.source = trimmed; sawName = true; continue; }
                throw std::invalid_argument(
                    "forge.airfoil.parseSelig: out-of-range coordinate at '" + trimmed + "'");
            }
            out.points.push_back(ProfilePoint{ x, y });
        } else {
            if (!sawName) { out.source = trimmed; sawName = true; continue; }
            throw std::invalid_argument(
                "forge.airfoil.parseSelig: cannot parse '" + trimmed + "' as x y");
        }
    }
    if (out.points.size() < 5) {
        throw std::invalid_argument(
            "forge.airfoil.parseSelig: too few points (need ≥ 5)");
    }
    // Close if open.
    if (std::abs(out.points.front().x - out.points.back().x) > 1e-6
     || std::abs(out.points.front().y - out.points.back().y) > 1e-6) {
        out.points.push_back(out.points.front());
    }
    if (out.source.empty()) out.source = "Selig (unnamed)";
    else                    out.source = "Selig: " + out.source;
    return out;
}

// ============================================================ resampleCosine
Profile resampleCosine(const Profile& p, std::size_t nPts) {
    if (nPts == 0 || p.points.size() < 4) return p;
    // Split the closed polyline at the leading edge (smallest x).
    std::size_t leIdx = 0;
    double minX = p.points[0].x;
    for (std::size_t i = 0; i < p.points.size(); ++i) {
        if (p.points[i].x < minX) { minX = p.points[i].x; leIdx = i; }
    }
    // Upper: from start(TE) → LE; lower: from LE → end(TE)
    std::vector<ProfilePoint> upperDesc(p.points.begin(),
                                         p.points.begin() + leIdx + 1);
    std::vector<ProfilePoint> lowerAsc(p.points.begin() + leIdx,
                                        p.points.end());
    // upperDesc is in descending x (TE → LE). Reverse for ascending.
    std::vector<ProfilePoint> upperAsc(upperDesc.rbegin(), upperDesc.rend());
    auto resampleSurface = [](const std::vector<ProfilePoint>& src,
                              const std::vector<double>& xs) {
        std::vector<ProfilePoint> out;
        out.reserve(xs.size());
        for (double x : xs) {
            // Linear interpolation in x (src is ascending in x).
            if (x <= src.front().x) { out.push_back(src.front()); continue; }
            if (x >= src.back().x ) { out.push_back(src.back());  continue; }
            for (std::size_t i = 1; i < src.size(); ++i) {
                if (src[i].x >= x) {
                    const double dx = src[i].x - src[i-1].x;
                    const double t = (dx > 1e-12) ? (x - src[i-1].x) / dx : 0.0;
                    out.push_back(ProfilePoint{
                        x, src[i-1].y + t * (src[i].y - src[i-1].y) });
                    break;
                }
            }
        }
        return out;
    };
    const std::size_t nStations = nPts / 2 + 1;
    const auto xs = cosineX(nStations);
    auto upperRes = resampleSurface(upperAsc, xs);
    auto lowerRes = resampleSurface(lowerAsc, xs);
    return assembleClosed(upperRes, lowerRes, p.source + " (resampled)");
}

// ============================================================ profileToFace
ShapeHandle profileToFace(const Profile& p, double chordMm) {
    if (p.points.size() < 5) {
        throw std::invalid_argument(
            "forge.airfoil.profileToFace: profile has fewer than 5 points");
    }
    if (!(chordMm > Precision::Confusion())) {
        throw std::invalid_argument("forge.airfoil.profileToFace: chord must be > 0");
    }
    // Drop the closure duplicate for BSpline interpolation; we add a closing
    // segment via a sharp final edge to keep the trailing-edge corner crisp.
    std::vector<ProfilePoint> pts(p.points.begin(),
                                   p.points.end() - 1); // drop closure
    const std::size_t n = pts.size();
    TColgp_Array1OfPnt arr(1, static_cast<Standard_Integer>(n));
    for (std::size_t i = 0; i < n; ++i) {
        arr.SetValue(static_cast<Standard_Integer>(i + 1),
                     gp_Pnt(pts[i].x * chordMm, pts[i].y * chordMm, 0.0));
    }
    GeomAPI_PointsToBSpline interp(arr,
                                   /*deg min*/ 3,
                                   /*deg max*/ 3,
                                   /*continuity*/ GeomAbs_C2,
                                   /*tol*/ 1.0e-6 * chordMm);
    Handle(Geom_BSplineCurve) bspl = interp.Curve();
    if (bspl.IsNull()) {
        throw std::runtime_error("forge.airfoil.profileToFace: BSpline interpolation failed");
    }
    TopoDS_Edge edgeMain = BRepBuilderAPI_MakeEdge(bspl).Edge();
    // Close with a straight TE segment from last → first if they differ.
    const gp_Pnt last(pts.back().x  * chordMm, pts.back().y  * chordMm, 0.0);
    const gp_Pnt first(pts.front().x * chordMm, pts.front().y * chordMm, 0.0);
    BRepBuilderAPI_MakeWire wireMaker;
    wireMaker.Add(edgeMain);
    if (last.Distance(first) > 1.0e-9 * chordMm) {
        TopoDS_Edge edgeClose = BRepBuilderAPI_MakeEdge(last, first).Edge();
        wireMaker.Add(edgeClose);
    }
    if (!wireMaker.IsDone()) {
        throw std::runtime_error("forge.airfoil.profileToFace: wire assembly failed");
    }
    TopoDS_Wire wire = wireMaker.Wire();
    BRepBuilderAPI_MakeFace mkFace(gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), wire);
    if (!mkFace.IsDone()) {
        throw std::runtime_error("forge.airfoil.profileToFace: face build failed");
    }
    return ShapeRegistry::instance().add(mkFace.Shape());
}

// ------------------------------------------------------------ helpers for loft
namespace {

// Convert a 2D profile to a 3D wire in the *world* frame at a station.
// The profile is laid down in its own XY plane, then:
//   1. scaled by chord
//   2. rotated about Y by twistDeg (about the y-axis at LE; positive = washout)
//   3. translated by (sweepMm in X, yMm in Y, zMm in Z)
TopoDS_Wire stationToWorldWire(const WingStation& st) {
    if (st.profile.points.size() < 5) {
        throw std::invalid_argument(
            "forge.airfoil.loftWing: station has fewer than 5 profile points");
    }
    if (!(st.chordMm > Precision::Confusion())) {
        throw std::invalid_argument("forge.airfoil.loftWing: chord must be > 0");
    }
    // Build the profile in local frame, oriented in XZ plane (so the wing
    // extends along Y between stations) — common aerospace convention:
    // X = chord, Y = span, Z = thickness.
    const auto& pts = st.profile.points;
    const std::size_t n = pts.size() - 1; // drop closure for BSpline
    TColgp_Array1OfPnt arr(1, static_cast<Standard_Integer>(n));
    for (std::size_t i = 0; i < n; ++i) {
        arr.SetValue(static_cast<Standard_Integer>(i + 1),
                     gp_Pnt(pts[i].x * st.chordMm, 0.0, pts[i].y * st.chordMm));
    }
    GeomAPI_PointsToBSpline interp(arr, 3, 3, GeomAbs_C2, 1.0e-6 * st.chordMm);
    Handle(Geom_BSplineCurve) bspl = interp.Curve();
    if (bspl.IsNull()) {
        throw std::runtime_error("forge.airfoil.loftWing: BSpline interp failed");
    }
    TopoDS_Edge edge = BRepBuilderAPI_MakeEdge(bspl).Edge();
    const gp_Pnt last (pts[n-1].x * st.chordMm, 0.0, pts[n-1].y * st.chordMm);
    const gp_Pnt first(pts[0  ].x * st.chordMm, 0.0, pts[0  ].y * st.chordMm);
    BRepBuilderAPI_MakeWire mw;
    mw.Add(edge);
    if (last.Distance(first) > 1.0e-9 * st.chordMm) {
        mw.Add(BRepBuilderAPI_MakeEdge(last, first).Edge());
    }
    TopoDS_Wire localWire = mw.Wire();

    // Rotate around the LE (origin) about Y for twist (positive = nose down).
    gp_Trsf rot;
    rot.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0)),
                    -st.twistDeg * PI / 180.0);
    // Translate to the spanwise station + sweep + dihedral height.
    gp_Trsf tr;
    tr.SetTranslation(gp_Vec(st.sweepMm, st.yMm, st.zMm));
    BRepBuilderAPI_Transform t1(localWire, rot, /*copy*/ Standard_True);
    BRepBuilderAPI_Transform t2(t1.Shape(), tr, /*copy*/ Standard_True);
    return TopoDS::Wire(t2.Shape());
}

} // anonymous namespace

// ============================================================ loftWing
ShapeHandle loftWing(const std::vector<WingStation>& stations, bool capTips) {
    if (stations.size() < 2) {
        throw std::invalid_argument("forge.airfoil.loftWing: need ≥ 2 stations");
    }
    // Each profile must have the same point count (the loft must match
    // corresponding stations). Resample to the largest count if not.
    std::size_t maxN = 0;
    for (const auto& s : stations) {
        if (s.profile.points.size() > maxN) maxN = s.profile.points.size();
    }
    std::vector<WingStation> normalised = stations;
    for (auto& s : normalised) {
        if (s.profile.points.size() != maxN) {
            // Resample to maxN-1 stations on the closed polyline (rounded).
            const std::size_t targetClosedPts = maxN;
            s.profile = resampleCosine(s.profile, targetClosedPts);
        }
    }

    BRepOffsetAPI_ThruSections mk(/*solid*/ capTips ? Standard_True : Standard_False,
                                  /*ruled*/ Standard_False,
                                  /*pres*/ 1.0e-6);
    for (const auto& st : normalised) {
        mk.AddWire(stationToWorldWire(st));
    }
    mk.Build();
    if (!mk.IsDone()) {
        throw std::runtime_error("forge.airfoil.loftWing: ThruSections failed");
    }
    return ShapeRegistry::instance().add(mk.Shape());
}

// ============================================================ trapezoidalWing
ShapeHandle trapezoidalWing(const TrapezoidalWingSpec& spec) {
    if (!(spec.rootChordMm > Precision::Confusion())) {
        throw std::invalid_argument(
            "forge.airfoil.trapezoidalWing: rootChordMm must be > 0");
    }
    if (!(spec.halfSpanMm > Precision::Confusion())) {
        throw std::invalid_argument(
            "forge.airfoil.trapezoidalWing: halfSpanMm must be > 0");
    }
    if (spec.taperRatio <= 0.0 || spec.taperRatio > 1.0) {
        throw std::invalid_argument(
            "forge.airfoil.trapezoidalWing: taperRatio must be in (0, 1]");
    }
    if (spec.spanStations < 2) {
        throw std::invalid_argument(
            "forge.airfoil.trapezoidalWing: spanStations must be ≥ 2");
    }
    const Profile& root = spec.rootProfile;
    const Profile& tip  = spec.tipProfile.points.empty() ? spec.rootProfile
                                                         : spec.tipProfile;
    if (root.points.size() < 5 || tip.points.size() < 5) {
        throw std::invalid_argument(
            "forge.airfoil.trapezoidalWing: profile must have ≥ 5 points");
    }
    // Resample both profiles to a common cosine grid so blending is well-defined.
    const std::size_t commonN = std::max(root.points.size(), tip.points.size());
    Profile rootR = resampleCosine(root, commonN);
    Profile tipR  = resampleCosine(tip,  commonN);
    if (rootR.points.size() != tipR.points.size()) {
        // Re-resample with the smaller count to guarantee match.
        const std::size_t safe = std::min(rootR.points.size(), tipR.points.size());
        rootR = resampleCosine(rootR, safe);
        tipR  = resampleCosine(tipR,  safe);
    }

    // Quarter-chord sweep — LE offset at the tip relative to the root.
    // Quarter-chord X at root: rootChord/4. At tip (with sweep): swept_qc_tip_x = qc_tip_x_unswept + halfSpan * tan(sweep)
    // We position the LE so the quarter-chord line is straight. tipQcX = rootChord/4 + halfSpan*tan(sweep).
    // tipLeX = tipQcX - tipChord/4.
    const double tanSweep    = std::tan(spec.sweepDeg    * PI / 180.0);
    const double tanDihedral = std::tan(spec.dihedralDeg * PI / 180.0);
    const double tipChord    = spec.rootChordMm * spec.taperRatio;
    const double rootQcX     = spec.rootChordMm * 0.25;

    std::vector<WingStation> stations;
    stations.reserve(static_cast<std::size_t>(spec.spanStations));
    for (int i = 0; i < spec.spanStations; ++i) {
        const double t = static_cast<double>(i) /
                          static_cast<double>(spec.spanStations - 1);
        const double y     = spec.halfSpanMm * t;
        const double chord = spec.rootChordMm * (1.0 - t)
                           + tipChord       * t;
        // Linear-blend profile between root and tip.
        Profile blended;
        blended.source = "blend " + rootR.source + " ↔ " + tipR.source;
        blended.points.resize(rootR.points.size());
        for (std::size_t k = 0; k < rootR.points.size(); ++k) {
            blended.points[k].x = rootR.points[k].x * (1.0 - t) + tipR.points[k].x * t;
            blended.points[k].y = rootR.points[k].y * (1.0 - t) + tipR.points[k].y * t;
        }
        const double qcX  = rootQcX + y * tanSweep; // straight quarter-chord line
        const double leX  = qcX - 0.25 * chord;
        WingStation st;
        st.profile  = std::move(blended);
        st.chordMm  = chord;
        st.yMm      = y;
        st.twistDeg = spec.twistDeg * t;  // linear washout
        st.sweepMm  = leX;
        st.zMm      = y * tanDihedral;
        stations.push_back(std::move(st));
    }
    return loftWing(stations, /*capTips*/ true);
}

// ============================================================ planformMetrics
PlanformMetrics planformMetrics(const TrapezoidalWingSpec& spec) {
    if (!(spec.rootChordMm > 0) || !(spec.halfSpanMm > 0)
        || spec.taperRatio <= 0.0 || spec.taperRatio > 1.0) {
        throw std::invalid_argument(
            "forge.airfoil.planformMetrics: invalid spec");
    }
    const double cr = spec.rootChordMm;
    const double ct = cr * spec.taperRatio;
    const double b  = 2.0 * spec.halfSpanMm;          // full span
    // Trapezoidal area: S = (cr + ct)/2 * b
    const double S = 0.5 * (cr + ct) * b;
    const double AR = b * b / S;
    // MAC = (2/3) * cr * (1 + λ + λ²) / (1 + λ)
    const double lam = spec.taperRatio;
    const double mac = (2.0 / 3.0) * cr * (1.0 + lam + lam * lam) / (1.0 + lam);
    return PlanformMetrics{ S, AR, mac, cr, ct, spec.halfSpanMm };
}

}} // namespace forge::airfoil
