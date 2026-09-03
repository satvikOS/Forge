// ─────────────────────────────────────────────────────────────────────────────
// thicksolid_occt_validity_probe.cpp — an INDEPENDENT re-measurement of the
// OCCT THICKSOLID baseline that reports/corpus_ab/THICKSOLID_ATTRIBUTION.md §4
// rests on: "OCCT succeeds on 133/600, and BRepCheck_Analyzer says ZERO of the
// 133 are valid, six of them larger than the body they hollowed."
//
// ★ WHY A SECOND INSTRUMENT AT ALL. That claim comes out of
//   test/corpus_ab_coverage.cpp, which links the forge native engines into the
//   same process as the OCCT arm. Nothing in that design is wrong, but a probe
//   that shares an address space (and static initialisation order, and OCCT
//   Standard_Failure handlers) with the engine under test cannot be the
//   independent check on that engine's baseline. THIS FILE LINKS NO FORGE
//   SOURCE. Its only dependency is OCCT itself. If it reproduces the numbers,
//   they are a property of OCCT and the corpus, not of the harness.
//
// It re-derives the SAME inputs the A/B derives, from the A/B's own source, so
// the two are comparable part for part:
//   scale = flat ? diag*0.05 : minExt        (corpus_ab_coverage.cpp:1108)
//   wall  = 0.05 * scale                     (corpus_ab_coverage.cpp:1208)
//   face  = largest-area PLANAR face, ties broken by centroid x,y,z
//                                            (corpus_ab_coverage.cpp:445-483)
//   call  = mk.MakeThickSolidByJoin(src, {face}, -wall, 1e-3); mk.Build()
//                                            (corpus_ab_coverage.cpp:1221-1226)
//   ok    = IsDone() && !Shape().IsNull() && faces > 0
//                                            (corpus_ab_coverage.cpp:312-313)
// Bounding boxes come from VERTICES, never Bnd_Box, for the same reason the
// A/B states: Bnd_Box inflates by the shape tolerance.
//
// ★ VOLUME ALONE CANNOT VALIDATE GEOMETRY, so every part reports the whole
//   observable vector — volume, area, face/edge/vertex/shell/solid census,
//   centre of mass, vertex bbox — for BOTH the source and the result, and the
//   source's own BRepCheck verdict beside the result's. "The result is invalid"
//   means nothing unless the input was valid; that column is measured here, not
//   assumed from another report.
//
// CRASH / HANG CONTAINMENT with a POSITIVE CONTROL. Each part runs in a forked
// child that writes a fixed-size POD back over a pipe. --selftest feeds that
// same path a deliberate SIGSEGV and a deliberate spin and REQUIRES CRASH and
// TIMEOUT back, so a silent zero cannot be mistaken for a clean zero.
//
// ★ AND THE BASELINE IS NOT A FIXED NUMBER. --repeat=N runs every part N times
//   and reports the parts whose STATUS is not constant across the N. OCCT's
//   MakeThickSolid SIGSEGVs nondeterministically on some of these solids, so a
//   single full-corpus pass can read 133 or 132; a baseline quoted without
//   knowing that is quoting a coin flip. (CMakeLists.txt records the same for
//   ho317 from the paired A/B; this reproduces it from a binary that links no
//   forge code, and finds a second part, ho377.)
//
//   ★★ AND REPEATING IS NOT THE SAME AS RE-RUNNING. The first version of this
//   mode repeated the fork inside ONE process and reported 0/7 unstable on the
//   very parts a shell loop over the same binary had just shown crashing 2-3
//   times in 10. Every fork inherits the parent's already-initialised OCCT
//   globals and its address-space layout, so N forks sample ONE draw N times.
//   --repeat therefore fork+EXECVs a fresh process image per iteration
//   (--one <file>, the single-part mode below). An instrument that cannot see
//   the effect it was built to measure reports a confident zero.
//
// usage:  thicksolid_occt_validity_probe --selftest
//         thicksolid_occt_validity_probe <corpus-dir> [--timeout=SEC] [--repeat=N]
// Emits one JSON object per line on stdout. Exit 0 iff every part was attempted.
// ─────────────────────────────────────────────────────────────────────────────
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <cmath>
#include <string>
#include <vector>
#include <algorithm>
#include <map>
#include <unistd.h>
#include <signal.h>
#include <sys/wait.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Face.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <BRep_Tool.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <Geom_Plane.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <Standard_Failure.hxx>

enum St : int { S_OK = 0, S_DEFER = 1, S_EMPTY = 2, S_THREW = 3, S_CRASH = 4, S_TIMEOUT = 5, S_NOTRUN = 6 };
static const char* stName(int s) {
    switch (s) {
        case S_OK: return "OK";  case S_DEFER: return "DEFER"; case S_EMPTY: return "EMPTY";
        case S_THREW: return "THREW"; case S_CRASH: return "CRASH"; case S_TIMEOUT: return "TIMEOUT";
        default: return "NOTRUN";
    }
}

struct Obs {                       // one shape's full observable vector
    int    valid = -1;             // BRepCheck_Analyzer; -1 = not evaluated
    int    nf = 0, ne = 0, nv = 0, nsh = 0, nso = 0;
    double volume = 0.0, area = 0.0;
    double com[3] = {0, 0, 0};
    double bb[6]  = {0, 0, 0, 0, 0, 0};
};

struct Row {                       // POD written back over the pipe — no pointers
    int    status = S_NOTRUN;
    int    err = 0;                // 1 read fail, 2 empty transfer, 3 no verts, 4 no solid, 5 no planar face
    int    flat = 0;
    double minExt = 0, diag = 0, scale = 0, wall = 0, faceArea = 0;
    int    nPlanar = 0, nFacesSrc = 0;
    Obs    src, res;
    char   note[192] = {0};
};

static void measure(const TopoDS_Shape& s, Obs& o) {
    TopTools_IndexedMapOfShape m;
    TopExp::MapShapes(s, TopAbs_FACE,   m); o.nf  = m.Extent(); m.Clear();
    TopExp::MapShapes(s, TopAbs_EDGE,   m); o.ne  = m.Extent(); m.Clear();
    TopExp::MapShapes(s, TopAbs_VERTEX, m); o.nv  = m.Extent(); m.Clear();
    TopExp::MapShapes(s, TopAbs_SHELL,  m); o.nsh = m.Extent(); m.Clear();
    TopExp::MapShapes(s, TopAbs_SOLID,  m); o.nso = m.Extent(); m.Clear();
    bool first = true;
    for (TopExp_Explorer ex(s, TopAbs_VERTEX); ex.More(); ex.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
        if (first) { o.bb[0]=o.bb[3]=p.X(); o.bb[1]=o.bb[4]=p.Y(); o.bb[2]=o.bb[5]=p.Z(); first=false; }
        else {
            o.bb[0]=std::min(o.bb[0],p.X()); o.bb[3]=std::max(o.bb[3],p.X());
            o.bb[1]=std::min(o.bb[1],p.Y()); o.bb[4]=std::max(o.bb[4],p.Y());
            o.bb[2]=std::min(o.bb[2],p.Z()); o.bb[5]=std::max(o.bb[5],p.Z());
        }
    }
    if (o.nso > 0 || o.nsh > 0) {
        GProp_GProps g;
        try { BRepGProp::VolumeProperties(s, g); o.volume = g.Mass(); } catch (...) { o.volume = 0.0; }
    }
    if (o.nf > 0) {
        GProp_GProps ga;
        try { BRepGProp::SurfaceProperties(s, ga); o.area = ga.Mass();
              const gp_Pnt c = ga.CentreOfMass(); o.com[0]=c.X(); o.com[1]=c.Y(); o.com[2]=c.Z(); }
        catch (...) {}
    }
    if (o.nso > 0 && std::fabs(o.volume) > 0.0) {
        GProp_GProps gv;
        try { BRepGProp::VolumeProperties(s, gv);
              const gp_Pnt c = gv.CentreOfMass(); o.com[0]=c.X(); o.com[1]=c.Y(); o.com[2]=c.Z(); }
        catch (...) {}
    }
    try { BRepCheck_Analyzer an(s); o.valid = an.IsValid() ? 1 : 0; } catch (...) { o.valid = -1; }
}

static double faceAreaOf(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return 0.0; }
    return g.Mass();
}
static gp_Pnt faceCentroid(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return gp_Pnt(0,0,0); }
    return g.CentreOfMass();
}
static bool planeOf(const TopoDS_Face& f, gp_Pln& out) {
    Handle(Geom_Surface) s = BRep_Tool::Surface(f);
    if (s.IsNull()) return false;
    Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(s);
    if (pl.IsNull()) return false;
    const gp_Pln p = pl->Pln();
    gp_Dir n = p.Axis().Direction();
    if (f.Orientation() == TopAbs_REVERSED) n.Reverse();
    out = gp_Pln(p.Location(), n);
    return true;
}
// byte-for-byte the A/B's deterministic tiebreak (corpus_ab_coverage.cpp:445)
static bool betterFace(const TopoDS_Face& cand, double candArea,
                       const TopoDS_Face& best, double bestArea) {
    if (best.IsNull()) return candArea > 0.0;
    if (candArea > bestArea * (1.0 + 1e-12)) return true;
    if (candArea < bestArea * (1.0 - 1e-12)) return false;
    const gp_Pnt a = faceCentroid(cand), b = faceCentroid(best);
    if (a.X() != b.X()) return a.X() < b.X();
    if (a.Y() != b.Y()) return a.Y() < b.Y();
    return a.Z() < b.Z();
}

static void doPart(const char* path, Row& r) {
    TopoDS_Shape shape;
    {
        STEPControl_Reader rd;
        IFSelect_ReturnStatus st = IFSelect_RetFail;
        try { st = rd.ReadFile(path); } catch (...) { st = IFSelect_RetFail; }
        if (st != IFSelect_RetDone) { r.err = 1; return; }
        try { rd.TransferRoots(); } catch (...) {}
        try { shape = rd.OneShape(); } catch (...) {}
        if (shape.IsNull()) { r.err = 2; return; }
    }
    double bb[6]; bool first = true;
    for (TopExp_Explorer ex(shape, TopAbs_VERTEX); ex.More(); ex.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
        if (first) { bb[0]=bb[3]=p.X(); bb[1]=bb[4]=p.Y(); bb[2]=bb[5]=p.Z(); first=false; }
        else {
            bb[0]=std::min(bb[0],p.X()); bb[3]=std::max(bb[3],p.X());
            bb[1]=std::min(bb[1],p.Y()); bb[4]=std::max(bb[4],p.Y());
            bb[2]=std::min(bb[2],p.Z()); bb[5]=std::max(bb[5],p.Z());
        }
    }
    if (first) { r.err = 3; return; }
    const double dx = bb[3]-bb[0], dy = bb[4]-bb[1], dz = bb[5]-bb[2];
    r.minExt = std::min(dx, std::min(dy, dz));
    r.diag   = std::sqrt(dx*dx + dy*dy + dz*dz);
    if (!(r.diag > 0.0)) { r.err = 3; return; }
    r.flat  = !(r.minExt > 1e-9 * r.diag) ? 1 : 0;
    r.scale = r.flat ? r.diag * 0.05 : r.minExt;
    r.wall  = 0.05 * r.scale;

    measure(shape, r.src);
    r.nFacesSrc = r.src.nf;
    if (r.src.nso <= 0) { r.err = 4; return; }

    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(shape, TopAbs_FACE, fm);
    TopoDS_Face big; double bigA = 0.0;
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm(i));
        const double a = faceAreaOf(f);
        if (!(a > 0.0)) continue;
        gp_Pln pl;
        if (!planeOf(f, pl)) continue;
        ++r.nPlanar;
        if (betterFace(f, a, big, bigA)) { big = f; bigA = a; }
    }
    if (big.IsNull()) { r.err = 5; return; }
    r.faceArea = bigA;

    try {
        TopTools_ListOfShape faces; faces.Append(big);
        BRepOffsetAPI_MakeThickSolid mk;
        mk.MakeThickSolidByJoin(shape, faces, -r.wall, 1.0e-3);
        mk.Build();
        if (!mk.IsDone()) { r.status = S_DEFER; return; }
        TopoDS_Shape out = mk.Shape();
        if (out.IsNull()) { r.status = S_DEFER; return; }
        measure(out, r.res);
        r.status = (r.res.nf > 0) ? S_OK : S_EMPTY;
    } catch (const Standard_Failure& e) {
        r.status = S_THREW;
        std::snprintf(r.note, sizeof r.note, "%s", e.GetMessageString() ? e.GetMessageString() : "Standard_Failure");
    } catch (const std::exception& e) {
        r.status = S_THREW; std::snprintf(r.note, sizeof r.note, "%s", e.what());
    } catch (...) { r.status = S_THREW; std::snprintf(r.note, sizeof r.note, "unknown throw"); }
}

// fork a child, deadline-poll it, read the POD back.
template <class Fn>
static Row runForked(Fn&& fn, int deadlineSec) {
    Row r;
    int fds[2];
    if (::pipe(fds) != 0) { r.status = S_CRASH; std::snprintf(r.note, sizeof r.note, "pipe() failed"); return r; }
    const pid_t pid = ::fork();
    if (pid < 0) { ::close(fds[0]); ::close(fds[1]); r.status = S_CRASH;
                   std::snprintf(r.note, sizeof r.note, "fork() failed"); return r; }
    if (pid == 0) {
        ::close(fds[0]);
        Row c; fn(c);
        const ssize_t w = ::write(fds[1], &c, sizeof c); (void)w;
        ::close(fds[1]); ::_exit(0);
    }
    ::close(fds[1]);
    int wstatus = 0; bool reaped = false;
    const int pollUs = 2000;
    const long budgetUs = static_cast<long>(deadlineSec) * 1000000L;
    for (long spent = 0; spent <= budgetUs; spent += pollUs) {
        const pid_t got = ::waitpid(pid, &wstatus, WNOHANG);
        if (got == pid) { reaped = true; break; }
        if (got < 0 && errno != EINTR) break;
        ::usleep(pollUs);
    }
    if (!reaped) {
        ::kill(pid, SIGKILL); ::waitpid(pid, &wstatus, 0); ::close(fds[0]);
        r.status = S_TIMEOUT; std::snprintf(r.note, sizeof r.note, "killed after %ds", deadlineSec);
        return r;
    }
    Row got;
    const ssize_t n = ::read(fds[0], &got, sizeof got);
    ::close(fds[0]);
    if (n == static_cast<ssize_t>(sizeof got)) return got;
    r.status = S_CRASH;
    if (WIFSIGNALED(wstatus)) std::snprintf(r.note, sizeof r.note, "signal %d", WTERMSIG(wstatus));
    else std::snprintf(r.note, sizeof r.note, "exit %d, no result", WEXITSTATUS(wstatus));
    return r;
}

// ── the positive control ────────────────────────────────────────────────────
// A containment path that has never been seen to fire is indistinguishable from
// one that cannot fire, and silence from a dead harness reads exactly like a
// clean zero. Three requirements, all asserted.
static int selftest() {
    int bad = 0;
    Row seg = runForked([](Row& o){ volatile int* p = nullptr; *p = 1; o.status = S_OK; }, 5);
    std::printf("  deliberate SIGSEGV  -> %s %s\n", stName(seg.status), seg.note);
    if (seg.status != S_CRASH) { std::printf("  FAIL: expected CRASH\n"); bad = 1; }
    Row spin = runForked([](Row& o){ for(;;){} o.status = S_OK; }, 2);
    std::printf("  deliberate spin     -> %s %s\n", stName(spin.status), spin.note);
    if (spin.status != S_TIMEOUT) { std::printf("  FAIL: expected TIMEOUT\n"); bad = 1; }
    // and a shape whose observables are known in closed form, so `measure`
    // itself is under test rather than trusted.
    Row box = runForked([](Row& o){
        TopoDS_Shape b = BRepPrimAPI_MakeBox(2.0, 3.0, 4.0).Shape();
        measure(b, o.res); o.status = S_OK;
    }, 10);
    std::printf("  box 2x3x4           -> V=%.9g A=%.9g f=%d so=%d valid=%d\n",
                box.res.volume, box.res.area, box.res.nf, box.res.nso, box.res.valid);
    if (std::fabs(box.res.volume - 24.0) > 1e-9) { std::printf("  FAIL: volume != 24\n"); bad = 1; }
    if (std::fabs(box.res.area - 52.0) > 1e-9)   { std::printf("  FAIL: area != 52\n"); bad = 1; }
    if (box.res.nf != 6 || box.res.nso != 1)     { std::printf("  FAIL: census\n"); bad = 1; }
    if (box.res.valid != 1)                      { std::printf("  FAIL: box not valid\n"); bad = 1; }
    std::printf(bad ? "SELFTEST FAIL\n" : "SELFTEST PASS\n");
    return bad;
}

static void emit(const std::string& name, const Row& r) {
    char b[3072];
    std::snprintf(b, sizeof b,
        "{\"part\":\"%s\",\"status\":\"%s\",\"err\":%d,"
        "\"flat\":%d,\"minExt\":%.9g,\"diag\":%.9g,\"scale\":%.9g,\"wall\":%.9g,"
        "\"nPlanar\":%d,\"faceArea\":%.9g,"
        "\"src\":{\"valid\":%d,\"V\":%.12g,\"A\":%.12g,\"f\":%d,\"e\":%d,\"v\":%d,\"sh\":%d,\"so\":%d,"
        "\"com\":[%.12g,%.12g,%.12g],\"bb\":[%.9g,%.9g,%.9g,%.9g,%.9g,%.9g]},"
        "\"res\":{\"valid\":%d,\"V\":%.12g,\"A\":%.12g,\"f\":%d,\"e\":%d,\"v\":%d,\"sh\":%d,\"so\":%d,"
        "\"com\":[%.12g,%.12g,%.12g],\"bb\":[%.9g,%.9g,%.9g,%.9g,%.9g,%.9g]},"
        "\"note\":\"%s\"}",
        name.c_str(), stName(r.status), r.err,
        r.flat, r.minExt, r.diag, r.scale, r.wall, r.nPlanar, r.faceArea,
        r.src.valid, r.src.volume, r.src.area, r.src.nf, r.src.ne, r.src.nv, r.src.nsh, r.src.nso,
        r.src.com[0], r.src.com[1], r.src.com[2],
        r.src.bb[0], r.src.bb[1], r.src.bb[2], r.src.bb[3], r.src.bb[4], r.src.bb[5],
        r.res.valid, r.res.volume, r.res.area, r.res.nf, r.res.ne, r.res.nv, r.res.nsh, r.res.nso,
        r.res.com[0], r.res.com[1], r.res.com[2],
        r.res.bb[0], r.res.bb[1], r.res.bb[2], r.res.bb[3], r.res.bb[4], r.res.bb[5],
        r.note);
    std::printf("%s\n", b);
    std::fflush(stdout);
}


// Run ONE part in a FRESH PROCESS IMAGE (fork + execv of this same binary in
// --one mode) and parse the single JSON line it prints. This is what --repeat
// needs: a plain fork inherits the parent's warm OCCT globals and address-space
// layout, so N forks are one draw sampled N times.
static Row runExeced(const char* self, const std::string& path,
                     const std::string& timeoutArg, int deadlineSec) {
    Row r;
    int fds[2];
    if (::pipe(fds) != 0) { r.status = S_CRASH; std::snprintf(r.note, sizeof r.note, "pipe() failed"); return r; }
    const pid_t pid = ::fork();
    if (pid < 0) { ::close(fds[0]); ::close(fds[1]); r.status = S_CRASH;
                   std::snprintf(r.note, sizeof r.note, "fork() failed"); return r; }
    if (pid == 0) {
        ::close(fds[0]);
        ::dup2(fds[1], 1);
        ::close(fds[1]);
        const int devnull = ::open("/dev/null", O_WRONLY);
        if (devnull >= 0) { ::dup2(devnull, 2); ::close(devnull); }
        char* av[5];
        av[0] = const_cast<char*>(self);
        av[1] = const_cast<char*>("--one");
        av[2] = const_cast<char*>(path.c_str());
        av[3] = const_cast<char*>(timeoutArg.c_str());
        av[4] = nullptr;
        ::execv(self, av);
        ::_exit(127);
    }
    ::close(fds[1]);
    std::string buf; char tmp[4096]; ssize_t n;
    while ((n = ::read(fds[0], tmp, sizeof tmp)) > 0) buf.append(tmp, n);
    ::close(fds[0]);
    int ws = 0; ::waitpid(pid, &ws, 0);
    (void)deadlineSec;
    if (WIFSIGNALED(ws)) {
        r.status = S_CRASH;
        std::snprintf(r.note, sizeof r.note, "signal %d", WTERMSIG(ws));
        return r;
    }
    // parse only the fields --repeat reads: the status word.
    const size_t k = buf.find("\"status\":\"");
    if (k == std::string::npos) { r.status = S_CRASH;
        std::snprintf(r.note, sizeof r.note, "no row from --one (exit %d)", WEXITSTATUS(ws)); return r; }
    const size_t a = k + 10, b = buf.find('"', a);
    const std::string st = buf.substr(a, b - a);
    r.status = (st=="OK")?S_OK:(st=="DEFER")?S_DEFER:(st=="EMPTY")?S_EMPTY:
               (st=="THREW")?S_THREW:(st=="CRASH")?S_CRASH:(st=="TIMEOUT")?S_TIMEOUT:S_NOTRUN;
    std::snprintf(r.note, sizeof r.note, "%s", st.c_str());
    return r;
}

int main(int argc, char** argv) {
    std::string dir, onePath;
    int deadline = 60;
    int repeat = 1;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--selftest") return selftest();
        else if (a == "--one" && i + 1 < argc) onePath = argv[++i];
        else if (a.rfind("--timeout=", 0) == 0) deadline = std::atoi(a.c_str() + 10);
        else if (a.rfind("--repeat=", 0) == 0) repeat = std::max(1, std::atoi(a.c_str() + 9));
        else dir = a;
    }

    // SINGLE-PART MODE. One part, IN THIS PROCESS, one JSON line, exit 0. It is
    // the unit --repeat re-execs, so each iteration gets a fresh process image
    // (fresh OCCT static initialisation, fresh ASLR) rather than a fork of an
    // already-warm parent. A crash here is the process dying, which is exactly
    // what the caller needs to see.
    if (!onePath.empty()) {
        Row r; doPart(onePath.c_str(), r);
        std::string nm = onePath;
        const size_t sl = nm.find_last_of('/');
        if (sl != std::string::npos) nm = nm.substr(sl + 1);
        const size_t dt = nm.find_last_of('.');
        if (dt != std::string::npos) nm = nm.substr(0, dt);
        emit(nm, r);
        return 0;
    }
    if (dir.empty()) { std::fprintf(stderr, "usage: %s <corpus-dir> [--timeout=SEC] | --selftest\n", argv[0]); return 2; }

    // WHOLE corpus, sorted LC_ALL=C-style (plain byte compare) so the order is
    // reproducible. No sampling at all — a stride would still be a sample, and
    // this corpus is 600 files.
    std::vector<std::string> files;
    DIR* d = ::opendir(dir.c_str());
    if (!d) { std::fprintf(stderr, "FATAL: cannot open %s\n", dir.c_str()); return 2; }
    while (struct dirent* e = ::readdir(d)) {
        const std::string n = e->d_name;
        if (n.size() > 5 && n.compare(n.size()-5, 5, ".step") == 0) files.push_back(n);
    }
    ::closedir(d);
    std::sort(files.begin(), files.end());
    if (files.empty()) { std::fprintf(stderr, "FATAL: no .step in %s\n", dir.c_str()); return 2; }
    std::fprintf(stderr, "[probe] %zu parts, deadline %ds/part\n", files.size(), deadline);

    size_t n = 0;
    size_t unstable = 0;
    for (const std::string& f : files) {
        const std::string path = dir + "/" + f;
        std::string name = f.substr(0, f.size() - 5);
        if (repeat == 1) {
            Row r = runForked([&](Row& o){ doPart(path.c_str(), o); }, deadline);
            emit(name, r);
        } else {
            // REPEAT MODE: the same binary on the same file, N times. Only the
            // FIRST row is emitted as data; the point of the rest is whether the
            // status is constant. A part that is not constant is reported on
            // stderr with its counts, because "OCCT succeeds on this part" is
            // not a fact about the part if it is only true some of the time.
            std::map<int,int> counts;
            Row first; bool haveFirst = false;
            const std::string to = "--timeout=" + std::to_string(deadline);
            for (int k = 0; k < repeat; ++k) {
                Row r = runExeced(argv[0], path, to, deadline);
                if (!haveFirst && r.status != S_CRASH) { first = r; haveFirst = true; }
                if (k == 0 && !haveFirst) first = r;
                counts[r.status]++;
            }
            emit(name, first);
            if (counts.size() > 1) {
                ++unstable;
                std::string desc;
                for (auto& kv : counts) {
                    if (!desc.empty()) desc += " ";
                    desc += std::string(stName(kv.first)) + "x" + std::to_string(kv.second);
                }
                std::fprintf(stderr, "[probe] UNSTABLE %s over %d runs: %s\n",
                             name.c_str(), repeat, desc.c_str());
            }
        }
        if (++n % 50 == 0) std::fprintf(stderr, "[probe] %zu/%zu\n", n, files.size());
    }
    std::fprintf(stderr, "[probe] done %zu/%zu\n", n, files.size());
    if (repeat > 1)
        std::fprintf(stderr, "[probe] parts whose status is NOT constant over %d runs: %zu/%zu\n",
                     repeat, unstable, files.size());
    return 0;
}
