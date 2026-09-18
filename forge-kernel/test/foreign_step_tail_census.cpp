// ─────────────────────────────────────────────────────────────────────────────
// foreign_step_tail_census.cpp — T-149. MEASURE the tail of STEP entity types
// that make forge::native::brep::readForeignStep() decline, over the foreign
// STEP corpus on this disk.
//
// WHAT THIS IS NOT. It is not a gate, not a migration, and it changes no
// production code. It is an INSTRUMENT: it calls the SHIPPED readForeignStep()
// with the SHIPPED automatic sew tolerance (sewTol = -1.0) on every file of a
// list and prints one JSON object per file. The report generator downstream
// turns those lines into three histograms.
//
// THE ACCEPTANCE TEST IT MIRRORS. IoExchange.cpp::importStep accepts the native
// foreign read ONLY when
//     fr.ok && fr.solid && fr.owner && fr.unsupported.empty() && fr.closed
// so this census calls a file NATIVE_ACCEPTED under exactly that conjunction.
// A file with unsupported.empty() but closed==false is NOT accepted by the
// product and is NOT counted as supported here. That distinction is the whole
// reason the census exists: the two halves of the conjunction fail on different
// files, and a census that reports only the unsupported map would overstate how
// close the native reader is.
//
// EVERY FILE LANDS IN EXACTLY ONE BUCKET
//   NATIVE_ACCEPTED       ok && solid && unsupported.empty() && closed
//   DECLINED_UNSUPPORTED  ok, closed, but the unsupported map is non-empty
//   DECLINED_OPEN         ok, unsupported map empty, but the sew did not close
//   DECLINED_BOTH         ok, unsupported non-empty AND not closed
//   READ_FAILED           readForeignStep returned ok == false (reason recorded)
//   THREW                 the read threw a C++ exception (what() recorded)
//   CRASH                 the child process died on a signal or wrote nothing
//   TIMEOUT               the child exceeded --timeout-ms (the file is named)
//   UNREADABLE            the file could not be opened / slurped
// There is no silent skip. The parent process accounts for every input line.
//
// CRASH AND HANG CONTAINMENT. Each file is read in a FORKED CHILD writing its
// one JSON line down a pipe. A segfault or an infinite loop inside the reader
// therefore becomes a BUCKET with the file named, not a dead census. This is
// the only reason a 60k-file run can be trusted to have looked at every file.
//
// SEW TOLERANCE. --sew-tol defaults to -1.0, the automatic default the product
// uses. Any other value produces a SEPARATE run and must be labelled as such in
// the report; it is never the headline number. Widening the tolerance raises the
// closed rate without reconstructing a single entity.
//
// usage:
//   foreign_step_tail_census --selftest [--invert]
//   foreign_step_tail_census --list FILE [--out NDJSON] [--timeout-ms N]
//                            [--jobs N] [--sew-tol X]
// exit: 0 ok / 1 a selftest assertion failed / 2 usage or I/O error
// ─────────────────────────────────────────────────────────────────────────────
#include <forge/native/brep/StepRead.hpp>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>

namespace fnb = forge::native::brep;

// ── the FABRICATED fixtures for --selftest ───────────────────────────────────
// A 6-PLANE closed box, emitted verbatim so the selftest depends on NO file on
// disk. If the reader ever stops accepting this, the selftest says so loudly
// rather than the census quietly reporting a lower native rate.
static const char* kBoxStep = R"FSTEP(ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('forge analytic B-rep solid (AP242, analytic surfaces)'),'2;1');
FILE_NAME('forge_analytic_solid','2026-01-01T00:00:00',(''),(''),'forge::native::brep::StepAnalytic','forge','');
FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 4 }'));
ENDSEC;
DATA;
#1=CARTESIAN_POINT('',(0.,0.,0.));
#2=VERTEX_POINT('',#1);
#3=CARTESIAN_POINT('',(0.,20.,0.));
#4=VERTEX_POINT('',#3);
#5=CARTESIAN_POINT('',(0.,0.,0.));
#6=DIRECTION('',(0.,1.,0.));
#7=VECTOR('',#6,20.);
#8=LINE('',#5,#7);
#9=EDGE_CURVE('',#2,#4,#8,.T.);
#10=ORIENTED_EDGE('',*,*,#9,.T.);
#11=CARTESIAN_POINT('',(10.,20.,0.));
#12=VERTEX_POINT('',#11);
#13=CARTESIAN_POINT('',(0.,20.,0.));
#14=DIRECTION('',(1.,0.,0.));
#15=VECTOR('',#14,10.);
#16=LINE('',#13,#15);
#17=EDGE_CURVE('',#4,#12,#16,.T.);
#18=ORIENTED_EDGE('',*,*,#17,.T.);
#19=CARTESIAN_POINT('',(10.,0.,0.));
#20=VERTEX_POINT('',#19);
#21=CARTESIAN_POINT('',(10.,20.,0.));
#22=DIRECTION('',(0.,-1.,0.));
#23=VECTOR('',#22,20.);
#24=LINE('',#21,#23);
#25=EDGE_CURVE('',#12,#20,#24,.T.);
#26=ORIENTED_EDGE('',*,*,#25,.T.);
#27=CARTESIAN_POINT('',(10.,0.,0.));
#28=DIRECTION('',(-1.,0.,0.));
#29=VECTOR('',#28,10.);
#30=LINE('',#27,#29);
#31=EDGE_CURVE('',#20,#2,#30,.T.);
#32=ORIENTED_EDGE('',*,*,#31,.T.);
#33=EDGE_LOOP('',(#10,#18,#26,#32));
#34=FACE_OUTER_BOUND('',#33,.T.);
#35=CARTESIAN_POINT('',(0.,0.,0.));
#36=DIRECTION('',(0.,0.,-1.));
#37=DIRECTION('',(0.,1.,0.));
#38=AXIS2_PLACEMENT_3D('',#35,#36,#37);
#39=PLANE('',#38);
#40=ADVANCED_FACE('',(#34),#39,.T.);
#41=CARTESIAN_POINT('',(0.,0.,30.));
#42=VERTEX_POINT('',#41);
#43=CARTESIAN_POINT('',(10.,0.,30.));
#44=VERTEX_POINT('',#43);
#45=CARTESIAN_POINT('',(0.,0.,30.));
#46=DIRECTION('',(1.,0.,0.));
#47=VECTOR('',#46,10.);
#48=LINE('',#45,#47);
#49=EDGE_CURVE('',#42,#44,#48,.T.);
#50=ORIENTED_EDGE('',*,*,#49,.T.);
#51=CARTESIAN_POINT('',(10.,20.,30.));
#52=VERTEX_POINT('',#51);
#53=CARTESIAN_POINT('',(10.,0.,30.));
#54=DIRECTION('',(0.,1.,0.));
#55=VECTOR('',#54,20.);
#56=LINE('',#53,#55);
#57=EDGE_CURVE('',#44,#52,#56,.T.);
#58=ORIENTED_EDGE('',*,*,#57,.T.);
#59=CARTESIAN_POINT('',(0.,20.,30.));
#60=VERTEX_POINT('',#59);
#61=CARTESIAN_POINT('',(10.,20.,30.));
#62=DIRECTION('',(-1.,0.,0.));
#63=VECTOR('',#62,10.);
#64=LINE('',#61,#63);
#65=EDGE_CURVE('',#52,#60,#64,.T.);
#66=ORIENTED_EDGE('',*,*,#65,.T.);
#67=CARTESIAN_POINT('',(0.,20.,30.));
#68=DIRECTION('',(0.,-1.,0.));
#69=VECTOR('',#68,20.);
#70=LINE('',#67,#69);
#71=EDGE_CURVE('',#60,#42,#70,.T.);
#72=ORIENTED_EDGE('',*,*,#71,.T.);
#73=EDGE_LOOP('',(#50,#58,#66,#72));
#74=FACE_OUTER_BOUND('',#73,.T.);
#75=CARTESIAN_POINT('',(0.,0.,30.));
#76=DIRECTION('',(0.,0.,1.));
#77=DIRECTION('',(1.,0.,0.));
#78=AXIS2_PLACEMENT_3D('',#75,#76,#77);
#79=PLANE('',#78);
#80=ADVANCED_FACE('',(#74),#79,.T.);
#81=ORIENTED_EDGE('',*,*,#31,.F.);
#82=CARTESIAN_POINT('',(10.,0.,0.));
#83=DIRECTION('',(0.,0.,1.));
#84=VECTOR('',#83,30.);
#85=LINE('',#82,#84);
#86=EDGE_CURVE('',#20,#44,#85,.T.);
#87=ORIENTED_EDGE('',*,*,#86,.T.);
#88=ORIENTED_EDGE('',*,*,#49,.F.);
#89=CARTESIAN_POINT('',(0.,0.,30.));
#90=DIRECTION('',(0.,0.,-1.));
#91=VECTOR('',#90,30.);
#92=LINE('',#89,#91);
#93=EDGE_CURVE('',#42,#2,#92,.T.);
#94=ORIENTED_EDGE('',*,*,#93,.T.);
#95=EDGE_LOOP('',(#81,#87,#88,#94));
#96=FACE_OUTER_BOUND('',#95,.T.);
#97=CARTESIAN_POINT('',(0.,0.,0.));
#98=DIRECTION('',(0.,-1.,0.));
#99=DIRECTION('',(1.,0.,0.));
#100=AXIS2_PLACEMENT_3D('',#97,#98,#99);
#101=PLANE('',#100);
#102=ADVANCED_FACE('',(#96),#101,.T.);
#103=ORIENTED_EDGE('',*,*,#17,.F.);
#104=CARTESIAN_POINT('',(0.,20.,0.));
#105=DIRECTION('',(0.,0.,1.));
#106=VECTOR('',#105,30.);
#107=LINE('',#104,#106);
#108=EDGE_CURVE('',#4,#60,#107,.T.);
#109=ORIENTED_EDGE('',*,*,#108,.T.);
#110=ORIENTED_EDGE('',*,*,#65,.F.);
#111=CARTESIAN_POINT('',(10.,20.,30.));
#112=DIRECTION('',(0.,0.,-1.));
#113=VECTOR('',#112,30.);
#114=LINE('',#111,#113);
#115=EDGE_CURVE('',#52,#12,#114,.T.);
#116=ORIENTED_EDGE('',*,*,#115,.T.);
#117=EDGE_LOOP('',(#103,#109,#110,#116));
#118=FACE_OUTER_BOUND('',#117,.T.);
#119=CARTESIAN_POINT('',(10.,20.,0.));
#120=DIRECTION('',(0.,1.,-0.));
#121=DIRECTION('',(-1.,0.,0.));
#122=AXIS2_PLACEMENT_3D('',#119,#120,#121);
#123=PLANE('',#122);
#124=ADVANCED_FACE('',(#118),#123,.T.);
#125=ORIENTED_EDGE('',*,*,#93,.F.);
#126=ORIENTED_EDGE('',*,*,#71,.F.);
#127=ORIENTED_EDGE('',*,*,#108,.F.);
#128=ORIENTED_EDGE('',*,*,#9,.F.);
#129=EDGE_LOOP('',(#125,#126,#127,#128));
#130=FACE_OUTER_BOUND('',#129,.T.);
#131=CARTESIAN_POINT('',(0.,0.,0.));
#132=DIRECTION('',(-1.,0.,0.));
#133=DIRECTION('',(0.,0.,1.));
#134=AXIS2_PLACEMENT_3D('',#131,#132,#133);
#135=PLANE('',#134);
#136=ADVANCED_FACE('',(#130),#135,.T.);
#137=ORIENTED_EDGE('',*,*,#25,.F.);
#138=ORIENTED_EDGE('',*,*,#115,.F.);
#139=ORIENTED_EDGE('',*,*,#57,.F.);
#140=ORIENTED_EDGE('',*,*,#86,.F.);
#141=EDGE_LOOP('',(#137,#138,#139,#140));
#142=FACE_OUTER_BOUND('',#141,.T.);
#143=CARTESIAN_POINT('',(10.,0.,0.));
#144=DIRECTION('',(1.,0.,0.));
#145=DIRECTION('',(0.,1.,0.));
#146=AXIS2_PLACEMENT_3D('',#143,#144,#145);
#147=PLANE('',#146);
#148=ADVANCED_FACE('',(#142),#147,.T.);
#149=CLOSED_SHELL('',(#40,#80,#102,#124,#136,#148));
#150=MANIFOLD_SOLID_BREP('forge_solid',#149);
#151=APPLICATION_CONTEXT('core data for automotive mechanical design processes');
#152=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2010,#151);
#153=PRODUCT_DEFINITION_CONTEXT('part definition',#151,'design');
#154=PRODUCT_CONTEXT('',#151,'mechanical');
#155=PRODUCT('forge_part','forge_part','',(#154));
#156=PRODUCT_DEFINITION_FORMATION('','',#155);
#157=PRODUCT_DEFINITION('design','',#156,#153);
#158=PRODUCT_DEFINITION_SHAPE('','',#157);
#159=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));
#160=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));
#161=(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT());
#162=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),#159,'distance_accuracy_value','confusion accuracy');
#163=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#162))GLOBAL_UNIT_ASSIGNED_CONTEXT((#159,#160,#161))REPRESENTATION_CONTEXT('Context','3D'));
#164=ADVANCED_BREP_SHAPE_REPRESENTATION('',(#150),#163);
#165=SHAPE_DEFINITION_REPRESENTATION(#158,#164);
ENDSEC;
END-ISO-10303-21;
)FSTEP";

// ── small helpers ────────────────────────────────────────────────────────────
static std::string jesc(const std::string& s) {
    std::string o;
    o.reserve(s.size() + 8);
    for (unsigned char c : s) {
        switch (c) {
            case '"':  o += "\\\""; break;
            case '\\': o += "\\\\"; break;
            case '\n': o += "\\n";  break;
            case '\r': o += "\\r";  break;
            case '\t': o += "\\t";  break;
            default:
                if (c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); o += b; }
                else o += static_cast<char>(c);
        }
    }
    return o;
}

static bool slurp(const std::string& path, std::string& out) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;
    std::ostringstream ss;
    ss << f.rdbuf();
    if (!f && !f.eof()) return false;
    out = ss.str();
    return true;
}

// ── the measurement of ONE file, as it runs inside the forked child ──────────
struct OneResult {
    std::string bucket;
    bool   ok = false;
    bool   closed = false;
    std::size_t faces = 0, vertices = 0, edges = 0, shells = 0, trimmed = 0;
    long long euler = 0;
    double scale = 1.0;
    std::string unit;
    std::string reason;
    std::map<std::string, std::size_t> unsupported;
    double ms = 0.0;
};

// Classify EXACTLY as IoExchange::importStep does, then split the decline.
static std::string classify(const fnb::ForeignReadResult& fr) {
    if (!fr.ok || !fr.solid || !fr.owner) return "READ_FAILED";
    const bool gap  = !fr.unsupported.empty();
    const bool open = !fr.closed;
    if (!gap && !open) return "NATIVE_ACCEPTED";
    if (gap && open)   return "DECLINED_BOTH";
    if (gap)           return "DECLINED_UNSUPPORTED";
    return "DECLINED_OPEN";
}

static OneResult readOne(const std::string& text, double sewTol) {
    OneResult r;
    const auto t0 = std::chrono::steady_clock::now();
    try {
        fnb::ForeignReadResult fr = fnb::readForeignStep(text, sewTol);
        r.bucket      = classify(fr);
        r.ok          = fr.ok;
        r.closed      = fr.closed;
        r.faces       = fr.faces;
        r.vertices    = fr.vertices;
        r.edges       = fr.edges;
        r.shells      = fr.shells.size();
        r.trimmed     = fr.trimmedFaces.size();
        r.euler       = fr.eulerCharacteristic;
        r.scale       = fr.lengthScaleToMm;
        r.unit        = fr.unitName;
        r.reason      = fr.reason;
        r.unsupported = fr.unsupported;
    } catch (const std::exception& e) {
        r.bucket = "THREW";
        r.reason = e.what();
    } catch (...) {
        r.bucket = "THREW";
        r.reason = "(non-std exception)";
    }
    const auto t1 = std::chrono::steady_clock::now();
    r.ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
    return r;
}

static std::string toJson(const std::string& path, std::size_t bytes, const OneResult& r) {
    std::ostringstream o;
    o.setf(std::ios::fixed);
    o << "{\"path\":\"" << jesc(path) << "\""
      << ",\"bytes\":" << bytes
      << ",\"bucket\":\"" << r.bucket << "\""
      << ",\"ok\":" << (r.ok ? "true" : "false")
      << ",\"closed\":" << (r.closed ? "true" : "false")
      << ",\"faces\":" << r.faces
      << ",\"vertices\":" << r.vertices
      << ",\"edges\":" << r.edges
      << ",\"shells\":" << r.shells
      << ",\"trimmed_faces\":" << r.trimmed
      << ",\"euler\":" << r.euler
      << ",\"length_scale_to_mm\":" << r.scale
      << ",\"unit\":\"" << jesc(r.unit) << "\""
      << ",\"reason\":\"" << jesc(r.reason) << "\""
      << ",\"ms\":" << r.ms
      << ",\"unsupported\":{";
    bool first = true;
    for (const auto& kv : r.unsupported) {
        if (!first) o << ",";
        first = false;
        o << "\"" << jesc(kv.first) << "\":" << kv.second;
    }
    o << "}}";
    return o.str();
}

// ── SELFTEST ─────────────────────────────────────────────────────────────────
// PROVES THE INSTRUMENT FIRES before any corpus number exists.
//   negative control : the untouched 6-PLANE box must land in NO bucket at all
//                      (unsupported empty AND closed -> NATIVE_ACCEPTED).
//   positive control : the SAME box with its first ADVANCED_FACE re-pointed at a
//                      fabricated OFFSET_SURFACE — a type the dispatcher in
//                      StepRead.cpp has no branch for — must land in the bucket
//                      keyed "OFFSET_SURFACE".
//   positive control : the same mutation with a SURFACE_OF_REVOLUTION. This one
//                      is deliberately NOT an unhandled type (StepRead.cpp has a
//                      torus fast path and a general NURBS-of-revolution path);
//                      it declines on its degenerate generatrix. It is kept
//                      because T-149 names it and because it is the evidence
//                      that the "canonical unsupported surface" comment in
//                      IoExchange.cpp is stale.
// --invert flips EVERY assertion, so `--selftest --invert` MUST exit non-zero.
// That is the demonstration that a green --selftest is evidence and not silence.
static std::string makeUnsupportedSurfaceStep(const std::string& box, const std::string& extraRecords) {
    // Re-point the FIRST ADVANCED_FACE's face_geometry at #900001 and append
    // `extraRecords` (which must define #900001) just before ENDSEC. Nothing else
    // changes, so any behaviour difference is attributable to that ONE surface
    // record — the fixture is a controlled single-variable mutation of a file the
    // reader is known to accept.
    std::string s = box;
    const std::string faceTok = "ADVANCED_FACE('',(";
    const std::size_t fpos = s.find(faceTok);
    if (fpos == std::string::npos) return std::string();
    // the face record reads: #40=ADVANCED_FACE('',(#34),#39,.T.);
    const std::size_t close = s.find(')', fpos + faceTok.size());   // after (#34
    if (close == std::string::npos) return std::string();
    const std::size_t comma = s.find(',', close);                    // the ,#39
    if (comma == std::string::npos) return std::string();
    const std::size_t comma2 = s.find(',', comma + 1);               // the ,.T.
    if (comma2 == std::string::npos) return std::string();
    s = s.substr(0, comma + 1) + "#900001" + s.substr(comma2);
    const std::size_t endsec = s.rfind("ENDSEC;");
    if (endsec == std::string::npos) return std::string();
    return s.substr(0, endsec) + extraRecords + s.substr(endsec);
}

// A surface entity the reader has NO handler for at all. Verified against the
// dispatcher in src/native/brep/StepRead.cpp: PLANE / CYLINDRICAL / CONICAL /
// SPHERICAL / TOROIDAL / B_SPLINE_SURFACE_WITH_KNOTS / SURFACE_OF_REVOLUTION /
// SURFACE_OF_LINEAR_EXTRUSION each have a branch; OFFSET_SURFACE has none, so it
// falls through to `surfType = ins.type` and is recorded verbatim.
static const char* kOffsetSurfaceRecord =
    "#900001=OFFSET_SURFACE('',#39,1.0,.T.);\n";

// SURFACE_OF_REVOLUTION. NOTE — this is NOT an unhandled type: StepRead.cpp has
// a torus fast path and a general NURBS-of-revolution path for it. This fixture
// declines because its generatrix (#8, a LINE lying ON the axis) cannot be
// revolved into a usable surface, and the reader records the STEP keyword. The
// fixture is kept because T-149 names it, and because its behaviour is the
// evidence that "SURFACE_OF_REVOLUTION is the canonical unsupported surface" —
// still asserted by the comment at IoExchange.cpp:106 — is out of date.
static const char* kRevolutionRecord =
    "#900000=AXIS1_PLACEMENT('',#1,#6);\n"
    "#900001=SURFACE_OF_REVOLUTION('',#8,#900000);\n";

static int selftest(bool invert, double sewTol) {
    int rc = 0;
    const std::string box = kBoxStep;
    std::printf("[selftest] fixture bytes=%zu  sewTol=%g  invert=%d\n", box.size(), sewTol, invert ? 1 : 0);

    // negative control -------------------------------------------------------
    const OneResult clean = readOne(box, sewTol);
    const bool cleanWant  = (clean.bucket == "NATIVE_ACCEPTED" && clean.unsupported.empty());
    const bool cleanPass  = invert ? !cleanWant : cleanWant;
    std::printf("[selftest] clean quadric box -> bucket=%s faces=%zu closed=%d unsupported=%zu  %s\n",
                clean.bucket.c_str(), clean.faces, clean.closed ? 1 : 0,
                clean.unsupported.size(), cleanPass ? "PASS" : "FAIL");
    if (!cleanPass) {
        rc = 1;
        for (const auto& kv : clean.unsupported)
            std::printf("[selftest]   unexpected unsupported: %s x%zu\n", kv.first.c_str(), kv.second);
        if (!clean.reason.empty()) std::printf("[selftest]   reason: %s\n", clean.reason.c_str());
    }

    // positive controls ------------------------------------------------------
    struct Fixture { const char* entity; const char* records; const char* note; };
    const Fixture fixtures[2] = {
        {"OFFSET_SURFACE",        kOffsetSurfaceRecord, "no handler in the dispatcher at all"},
        {"SURFACE_OF_REVOLUTION", kRevolutionRecord,    "HAS a handler; declines on this generatrix"},
    };
    for (const Fixture& fx : fixtures) {
        const std::string mutated = makeUnsupportedSurfaceStep(box, fx.records);
        if (mutated.empty()) {
            std::printf("[selftest] FATAL: could not fabricate the %s fixture\n", fx.entity);
            return 2;
        }
        const OneResult m = readOne(mutated, sewTol);
        const auto it = m.unsupported.find(fx.entity);
        const bool want = (it != m.unsupported.end() && it->second >= 1);
        const bool pass = invert ? !want : want;
        std::printf("[selftest] %-22s face -> bucket=%s faces=%zu closed=%d unsupported=%zu  %s   (%s)\n",
                    fx.entity, m.bucket.c_str(), m.faces, m.closed ? 1 : 0,
                    m.unsupported.size(), pass ? "PASS" : "FAIL", fx.note);
        for (const auto& kv : m.unsupported)
            std::printf("[selftest]   bucket hit: %s x%zu\n", kv.first.c_str(), kv.second);
        if (!pass) {
            rc = 1;
            if (!m.reason.empty()) std::printf("[selftest]   reason: %s\n", m.reason.c_str());
        }
    }

    std::printf("[selftest] %s (rc=%d)\n", rc == 0 ? "ALL ASSERTIONS HELD" : "ASSERTION FAILED", rc);
    return rc;
}

// ── the census: one forked child per file, poll()-driven pool ────────────────
struct Slot {
    bool   active = false;
    pid_t  pid = -1;
    int    fd = -1;
    std::string buf;
    std::string path;
    std::size_t bytes = 0;
    std::chrono::steady_clock::time_point deadline;
};

static void emit(std::ostream& out, const std::string& line, std::size_t& n) {
    out << line << "\n";
    ++n;
    if ((n % 500) == 0) out.flush();
}

int main(int argc, char** argv) {
    std::string listPath, outPath;
    double sewTol = -1.0;
    int timeoutMs = 60000;
    int jobs = 1;
    bool doSelftest = false, invert = false;

    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        auto need = [&](const char* what) -> std::string {
            if (i + 1 >= argc) { std::fprintf(stderr, "%s needs a value\n", what); std::exit(2); }
            return argv[++i];
        };
        if (a == "--selftest")        doSelftest = true;
        else if (a == "--invert")     invert = true;
        else if (a == "--list")       listPath = need("--list");
        else if (a == "--out")        outPath = need("--out");
        else if (a == "--sew-tol")    sewTol = std::atof(need("--sew-tol").c_str());
        else if (a == "--timeout-ms") timeoutMs = std::atoi(need("--timeout-ms").c_str());
        else if (a == "--jobs")       jobs = std::atoi(need("--jobs").c_str());
        else { std::fprintf(stderr, "unknown argument: %s\n", a.c_str()); return 2; }
    }
    if (jobs < 1) jobs = 1;
    if (timeoutMs < 1) timeoutMs = 1;

    if (doSelftest) return selftest(invert, sewTol);

    if (listPath.empty()) { std::fprintf(stderr, "usage: --list FILE | --selftest\n"); return 2; }

    std::vector<std::string> files;
    {
        std::ifstream lf(listPath);
        if (!lf) { std::fprintf(stderr, "cannot open list %s\n", listPath.c_str()); return 2; }
        std::string line;
        while (std::getline(lf, line)) {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (!line.empty()) files.push_back(line);
        }
    }
    std::ofstream of;
    std::ostream* out = &std::cout;
    if (!outPath.empty()) {
        of.open(outPath, std::ios::binary | std::ios::trunc);
        if (!of) { std::fprintf(stderr, "cannot write %s\n", outPath.c_str()); return 2; }
        out = &of;
    }

    std::fprintf(stderr, "[census] files=%zu jobs=%d timeout_ms=%d sew_tol=%g\n",
                 files.size(), jobs, timeoutMs, sewTol);

    std::vector<Slot> slots(static_cast<std::size_t>(jobs));
    std::size_t next = 0, done = 0, emitted = 0;
    std::map<std::string, std::size_t> tally;

    auto finish = [&](Slot& s, const std::string& forcedBucket, const std::string& note) {
        // A child that wrote a complete line is authoritative; otherwise the
        // PARENT writes the row, so the file is never silently dropped.
        std::string line;
        const std::size_t nl = s.buf.find('\n');
        if (forcedBucket.empty() && nl != std::string::npos) {
            line = s.buf.substr(0, nl);
        } else {
            OneResult r;
            r.bucket = forcedBucket.empty() ? std::string("CRASH") : forcedBucket;
            r.reason = note;
            line = toJson(s.path, s.bytes, r);
        }
        // tally the bucket by re-reading the field we just wrote / the child wrote
        const std::size_t bp = line.find("\"bucket\":\"");
        if (bp != std::string::npos) {
            const std::size_t b0 = bp + 10;
            const std::size_t b1 = line.find('"', b0);
            if (b1 != std::string::npos) tally[line.substr(b0, b1 - b0)]++;
        }
        emit(*out, line, emitted);
        ++done;
        if (s.fd >= 0) { ::close(s.fd); s.fd = -1; }
        s.active = false;
        s.buf.clear();
    };

    while (done < files.size()) {
        // 1. fill free slots
        for (auto& s : slots) {
            if (s.active || next >= files.size()) continue;
            const std::string path = files[next++];
            std::string text;
            if (!slurp(path, text)) {
                Slot tmp; tmp.path = path; tmp.bytes = 0; tmp.fd = -1;
                finish(tmp, "UNREADABLE", "cannot open or read the file");
                continue;
            }
            int fds[2];
            if (::pipe(fds) != 0) {
                Slot tmp; tmp.path = path; tmp.bytes = text.size(); tmp.fd = -1;
                finish(tmp, "CRASH", "pipe() failed");
                continue;
            }
            const pid_t pid = ::fork();
            if (pid < 0) {
                ::close(fds[0]); ::close(fds[1]);
                Slot tmp; tmp.path = path; tmp.bytes = text.size(); tmp.fd = -1;
                finish(tmp, "CRASH", "fork() failed");
                continue;
            }
            if (pid == 0) {
                ::close(fds[0]);
                const OneResult r = readOne(text, sewTol);
                const std::string line = toJson(path, text.size(), r) + "\n";
                std::size_t off = 0;
                while (off < line.size()) {
                    const ssize_t w = ::write(fds[1], line.data() + off, line.size() - off);
                    if (w <= 0) break;
                    off += static_cast<std::size_t>(w);
                }
                ::close(fds[1]);
                ::_exit(0);
            }
            ::close(fds[1]);
            ::fcntl(fds[0], F_SETFL, O_NONBLOCK);
            s.active = true;
            s.pid = pid;
            s.fd = fds[0];
            s.path = path;
            s.bytes = text.size();
            s.buf.clear();
            s.deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
        }

        // 2. poll the active children
        std::vector<struct pollfd> pfds;
        std::vector<std::size_t> idx;
        auto now = std::chrono::steady_clock::now();
        int waitMs = timeoutMs;
        for (std::size_t i = 0; i < slots.size(); ++i) {
            if (!slots[i].active) continue;
            pfds.push_back(pollfd{slots[i].fd, POLLIN, 0});
            idx.push_back(i);
            const auto rem = std::chrono::duration_cast<std::chrono::milliseconds>(slots[i].deadline - now).count();
            waitMs = std::min<int>(waitMs, rem < 0 ? 0 : static_cast<int>(rem));
        }
        if (pfds.empty()) { if (next >= files.size()) break; else continue; }
        const int pr = ::poll(pfds.data(), static_cast<nfds_t>(pfds.size()), waitMs + 1);
        (void)pr;

        // 3. drain / reap
        now = std::chrono::steady_clock::now();
        for (std::size_t k = 0; k < pfds.size(); ++k) {
            Slot& s = slots[idx[k]];
            if (!s.active) continue;
            bool eof = false;
            if (pfds[k].revents & (POLLIN | POLLHUP | POLLERR)) {
                char tmp[8192];
                for (;;) {
                    const ssize_t n = ::read(s.fd, tmp, sizeof tmp);
                    if (n > 0) { s.buf.append(tmp, static_cast<std::size_t>(n)); continue; }
                    if (n == 0) { eof = true; break; }
                    break;  // EAGAIN
                }
            }
            if (eof) {
                int st = 0;
                ::waitpid(s.pid, &st, 0);
                if (s.buf.find('\n') != std::string::npos) {
                    finish(s, "", "");
                } else {
                    std::ostringstream why;
                    if (WIFSIGNALED(st)) why << "child died on signal " << WTERMSIG(st);
                    else                 why << "child exited " << WEXITSTATUS(st) << " with no output";
                    finish(s, "CRASH", why.str());
                }
                continue;
            }
            if (now >= s.deadline) {
                ::kill(s.pid, SIGKILL);
                int st = 0;
                ::waitpid(s.pid, &st, 0);
                std::ostringstream why;
                why << "exceeded --timeout-ms " << timeoutMs;
                finish(s, "TIMEOUT", why.str());
            }
        }
    }

    out->flush();
    std::fprintf(stderr, "[census] emitted=%zu of %zu input path(s)\n", emitted, files.size());
    for (const auto& kv : tally)
        std::fprintf(stderr, "[census]   %-22s %zu\n", kv.first.c_str(), kv.second);
    if (emitted != files.size()) {
        std::fprintf(stderr, "[census] FATAL: %zu input paths but %zu rows emitted — a file was dropped\n",
                     files.size(), emitted);
        return 2;
    }
    return 0;
}
