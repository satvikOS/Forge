// forge-kernel/test/golden_corpus_measure.cpp
//
// GOLDEN-CORPUS measure TU — the per-model C++ measurement back-end for the
// PD-10 keystone tool test/golden_corpus.mjs. It is invoked ONCE PER MODEL by
// the .mjs driver (one STEP file per call) and emits a single JSON line of
// measurements to stdout. Two modes:
//
//   --mode occt   --step <f.step>    Read the STEP file with OCCT, measure the
//                                    FROZEN GROUND TRUTH directly off the OCCT
//                                    shape (BRepGProp / BRepBndLib::AddOptimal /
//                                    BRepCheck_Analyzer) — the truth-oracle the
//                                    native kernel is forever checked against.
//
//   --mode native --step <f.step>    Read the SAME STEP with OCCT, IMPORT it to a
//                                    pure native::brep::Solid via forge::importOcctSolid
//                                    (the in-house substrate), then measure with the
//                                    NATIVE measurers ONLY (massProperties / computeAabb
//                                    / computeBetti / checkBRep / tessellateSolid). NO
//                                    OCCT measurement is read in this mode — it proves
//                                    the native path stands alone.
//
// Why STEP as the carrier: the corpus models are model-built (cadgen_v3 call-programs)
// or analytic fixtures. The .mjs FREEZE step builds each once with the live addon and
// exports a canonical STEP; both the OCCT oracle and the native importer then re-read
// the SAME STEP, so the two measurements are of byte-identical geometry. (Models the
// importer cannot take — e.g. surface-of-revolution faces — are honestly excluded from
// the native gate by the .mjs, which records the named deferral reason instead.)
//
// MEASUREMENTS EMITTED (both modes, JSON keys):
//   ok            : bool          measurement succeeded (native: import ok too)
//   reason        : string        deferral / failure cause when ok=false
//   volume,area   : double        BRepGProp (occt) / massProperties (native)
//   com           : [x,y,z]       centre of mass
//   inertiaPrincipal : [I1,I2,I3] sorted eigenvalues of the COM inertia tensor
//                                  (rotation-invariant; unit-density == mass==volume,
//                                   so directly comparable occt-vs-native)
//   bbox          : {min:[3],max:[3]}  TIGHT box (occt AddOptimal / native exact AABB)
//   valid         : bool          BRepCheck_Analyzer (occt) / checkBRep all-pass (native)
//   tess          : {triCount, vertHash}   ONLY in native mode — fixed-deflection tess
//                                  signature (sorted-quantised-vertex FNV-1a hash + tri
//                                  count). The OCCT side's tess signature is computed in
//                                  JS by the driver from the addon's tessellate(), so the
//                                  occt mode does not duplicate it here.
//
// LINKS OCCT (it is the truth oracle + the importer's input reader) — NOT a pure-native
// run_native.sh gate. Built by build_golden_corpus_measure.sh (mirrors
// build_occt_import_test.sh's native-object + OCCT-link assembly, plus TKDESTEP/TKXSBase
// for the STEP reader). C++20, no new deps.

#include "forge/OcctImport.hpp"

#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Aabb.hpp"
#include "forge/native/brep/CadScoreGates.hpp"   // BettiNumbers, computeBetti
#include "forge/native/brep/Check.hpp"           // checkBRep — native validator
#include "forge/native/brep/SolidTessellate.hpp" // tessellateSolid — tess signature

// --- OCCT --------------------------------------------------------------------
#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Solid.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <GProp_PrincipalProps.hxx>
#include <Bnd_Box.hxx>
#include <BRepBndLib.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <Standard_Version.hxx>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

using namespace forge;

namespace {

// ----- minimal JSON string escape (paths/reasons only) -----------------------
std::string jesc(const std::string& s) {
    std::string o;
    for (char c : s) {
        switch (c) {
            case '"':  o += "\\\""; break;
            case '\\': o += "\\\\"; break;
            case '\n': o += "\\n";  break;
            case '\r': o += "\\r";  break;
            case '\t': o += "\\t";  break;
            default:   o += c;
        }
    }
    return o;
}

// Format a double with enough digits to be a faithful oracle (17 sig figs).
std::string num(double v) {
    if (!std::isfinite(v)) return "null";
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%.17g", v);
    return std::string(buf);
}

std::string arr3(const double v[3]) {
    return "[" + num(v[0]) + "," + num(v[1]) + "," + num(v[2]) + "]";
}

// ----- principal moments: eigenvalues of a symmetric 3x3 (row-major[9]) ------
// Analytic symmetric-3x3 eigenvalues (Smith / Deledalle closed form). Returned
// SORTED ascending so the triple is canonical regardless of axis labelling — the
// rotation-invariant comparable between OCCT's GProp_PrincipalProps and the native
// inertia tensor (which carries arbitrary principal-axis order).
std::array<double, 3> symEig3(const double m[9]) {
    const double a = m[0], b = m[4], c = m[8];          // diagonal
    const double d = m[1], e = m[5], f = m[2];          // off-diag (sym): m01,m12,m02
    const double p1 = d * d + e * e + f * f;
    std::array<double, 3> eig{};
    if (p1 <= 1e-300) {                                  // already diagonal
        eig = {a, b, c};
    } else {
        const double q = (a + b + c) / 3.0;
        const double p2 = (a - q) * (a - q) + (b - q) * (b - q) + (c - q) * (c - q) + 2.0 * p1;
        const double p = std::sqrt(p2 / 6.0);
        // B = (1/p)(A - qI)
        double B[9];
        const double ip = 1.0 / p;
        B[0] = ip * (a - q); B[4] = ip * (b - q); B[8] = ip * (c - q);
        B[1] = B[3] = ip * d; B[5] = B[7] = ip * e; B[2] = B[6] = ip * f;
        // detB / 2
        const double detB =
            B[0] * (B[4] * B[8] - B[5] * B[7]) -
            B[1] * (B[3] * B[8] - B[5] * B[6]) +
            B[2] * (B[3] * B[7] - B[4] * B[6]);
        double r = detB / 2.0;
        r = std::max(-1.0, std::min(1.0, r));
        const double phi = std::acos(r) / 3.0;
        const double e1 = q + 2.0 * p * std::cos(phi);
        const double e3 = q + 2.0 * p * std::cos(phi + 2.0 * M_PI / 3.0);
        const double e2 = 3.0 * q - e1 - e3;
        eig = {e1, e2, e3};
    }
    std::sort(eig.begin(), eig.end());
    return eig;
}

// FNV-1a 64-bit over the SORTED, quantised vertex coordinate triples. A geometry
// FINGERPRINT that is invariant to triangle/vertex ENUMERATION order (we sort the
// quantised vertex list first) so it is stable across runs but moves the instant a
// vertex moves past the quantum. Quantum 1e-3 mm (1 micron) — well under the 0.1%
// bbox tolerance, so identical geometry hashes identically yet a real edit shifts it.
std::string tessVertHash(const std::vector<double>& positions) {
    const double Q = 1e3;  // 1/quantum: snap to 1e-3 mm
    const std::size_t nV = positions.size() / 3;
    std::vector<std::array<long long, 3>> qv;
    qv.reserve(nV);
    for (std::size_t i = 0; i < nV; ++i) {
        qv.push_back({
            static_cast<long long>(std::llround(positions[i * 3 + 0] * Q)),
            static_cast<long long>(std::llround(positions[i * 3 + 1] * Q)),
            static_cast<long long>(std::llround(positions[i * 3 + 2] * Q)),
        });
    }
    std::sort(qv.begin(), qv.end());
    std::uint64_t h = 1469598103934665603ull;  // FNV offset basis
    auto mix = [&](long long v) {
        std::uint64_t u = static_cast<std::uint64_t>(v);
        for (int k = 0; k < 8; ++k) {
            h ^= (u & 0xff);
            h *= 1099511628211ull;             // FNV prime
            u >>= 8;
        }
    };
    for (const auto& v : qv) { mix(v[0]); mix(v[1]); mix(v[2]); }
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%016llx", static_cast<unsigned long long>(h));
    return std::string(buf);
}

// Read the FIRST solid (or the whole shape) from a STEP file.
bool readStep(const std::string& fp, TopoDS_Shape& out, std::string& reason) {
    STEPControl_Reader rd;
    IFSelect_ReturnStatus st = rd.ReadFile(fp.c_str());
    if (st != IFSelect_RetDone) { reason = "STEP ReadFile failed"; return false; }
    rd.TransferRoots();
    if (rd.NbShapes() < 1) { reason = "STEP carries no shape"; return false; }
    out = rd.OneShape();
    if (out.IsNull()) { reason = "STEP OneShape null"; return false; }
    return true;
}

// ----- OCCT mode: measure the frozen ground truth ----------------------------
int measureOcct(const TopoDS_Shape& s) {
    GProp_GProps vp; BRepGProp::VolumeProperties(s, vp);
    GProp_GProps sp; BRepGProp::SurfaceProperties(s, sp);
    const double volume = vp.Mass();
    const double area   = sp.Mass();
    gp_Pnt com = vp.CentreOfMass();
    double comA[3] = { com.X(), com.Y(), com.Z() };

    // Principal moments straight from OCCT (already the eigenvalues, unit density).
    GProp_PrincipalProps pp = vp.PrincipalProperties();
    double Ix, Iy, Iz; pp.Moments(Ix, Iy, Iz);
    std::array<double, 3> eig = { Ix, Iy, Iz };
    std::sort(eig.begin(), eig.end());

    // TIGHT bounding box (AddOptimal samples the real surface — see native_occt_import_test).
    Bnd_Box bb; BRepBndLib::AddOptimal(s, bb, Standard_False, Standard_False);
    double mn[3], mx[3];
    bb.Get(mn[0], mn[1], mn[2], mx[0], mx[1], mx[2]);

    bool valid = BRepCheck_Analyzer(s, Standard_True).IsValid();

    std::printf(
        "{\"ok\":true,\"mode\":\"occt\","
        "\"volume\":%s,\"area\":%s,\"com\":%s,"
        "\"inertiaPrincipal\":[%s,%s,%s],"
        "\"bbox\":{\"min\":%s,\"max\":%s},"
        "\"valid\":%s}\n",
        num(volume).c_str(), num(area).c_str(), arr3(comA).c_str(),
        num(eig[0]).c_str(), num(eig[1]).c_str(), num(eig[2]).c_str(),
        arr3(mn).c_str(), arr3(mx).c_str(),
        valid ? "true" : "false");
    return 0;
}

// ----- native mode: import to native, measure with native measurers ONLY -----
int measureNative(const TopoDS_Shape& s) {
    ImportResult ir = importOcctSolid(s);
    if (!ir.ok || !ir.solid) {
        std::printf("{\"ok\":false,\"mode\":\"native\",\"reason\":\"%s\"}\n",
                    jesc(ir.reason.empty() ? "import failed" : ir.reason).c_str());
        return 0;  // a clean deferral is NOT a process error — the driver records it
    }

    native::brep::MassProps mp = native::brep::massProperties(*ir.solid, 10);
    std::array<double, 3> eig = symEig3(mp.inertiaCom);

    native::brep::Aabb3 bb = native::brep::computeAabb(*ir.solid);
    double mn[3] = { bb.minX, bb.minY, bb.minZ };
    double mx[3] = { bb.maxX, bb.maxY, bb.maxZ };

    native::brep::BettiNumbers be = native::brep::computeBetti(*ir.solid);

    native::brep::CheckReport cr = native::brep::checkBRep(ir.solid);

    // Fixed-deflection tessellation signature (the SolidTessellate weld is the
    // canonical native tess — same one Betti consumes).
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    native::brep::tessellateSolid(*ir.solid, pos, idx);
    const long long triCount = static_cast<long long>(idx.size() / 3);
    const std::string vh = tessVertHash(pos);

    std::printf(
        "{\"ok\":true,\"mode\":\"native\","
        "\"volume\":%s,\"area\":%s,\"com\":%s,"
        "\"inertiaPrincipal\":[%s,%s,%s],"
        "\"bbox\":{\"min\":%s,\"max\":%s},"
        "\"betti\":{\"ok\":%s,\"b0\":%lld,\"b1\":%lld,\"b2\":%lld},"
        "\"valid\":%s,"
        "\"tess\":{\"triCount\":%lld,\"vertHash\":\"%s\"}}\n",
        num(mp.volume).c_str(), num(mp.area).c_str(), arr3(mp.com).c_str(),
        num(eig[0]).c_str(), num(eig[1]).c_str(), num(eig[2]).c_str(),
        arr3(mn).c_str(), arr3(mx).c_str(),
        be.ok ? "true" : "false",
        static_cast<long long>(be.b0), static_cast<long long>(be.b1),
        static_cast<long long>(be.b2),
        cr.valid ? "true" : "false",
        triCount, vh.c_str());
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    std::string mode, step;
    bool wantVersion = false;
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--mode") == 0 && i + 1 < argc) mode = argv[++i];
        else if (std::strcmp(argv[i], "--step") == 0 && i + 1 < argc) step = argv[++i];
        else if (std::strcmp(argv[i], "--occt-version") == 0) wantVersion = true;
    }

    if (wantVersion) {
        // Emit the linked OCCT version so the driver can stamp golden_corpus.json.
        std::printf("{\"occtVersion\":\"%s\"}\n", OCC_VERSION_COMPLETE);
        return 0;
    }

    if (step.empty() || (mode != "occt" && mode != "native")) {
        std::fprintf(stderr,
            "usage: golden_corpus_measure --mode <occt|native> --step <file.step>\n"
            "       golden_corpus_measure --occt-version\n");
        return 2;
    }

    TopoDS_Shape shape;
    std::string reason;
    if (!readStep(step, shape, reason)) {
        std::printf("{\"ok\":false,\"mode\":\"%s\",\"reason\":\"%s\"}\n",
                    jesc(mode).c_str(), jesc(reason).c_str());
        return 0;  // unreadable STEP is a per-model record, not a tool crash
    }

    return (mode == "occt") ? measureOcct(shape) : measureNative(shape);
}
