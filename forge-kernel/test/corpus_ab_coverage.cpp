// corpus_ab_coverage.cpp — THE COVERAGE A/B for the OCCT drop options.
//
// WHAT THIS IS. Every one of the ten default-OFF drop options in
// forge-kernel/CMakeLists.txt names the SAME flip gate:
//
//     "native success rate >= the measured OCCT baseline"
//
// (reports/TKOFFSET_DECOMPOSITION.md §5 step 6, quoted at CMakeLists.txt:432,
// :475 and :555). The seven live-OCCT A/B harnesses already in test/ answer
// CORRECTNESS — "where both engines answer, do they answer the same thing" —
// and they answer it on hand-built cases. NONE of them answers COVERAGE: how
// often the native engine DECLINES on a real part where OCCT would have built
// something. That middle bucket is the capability the drop deletes, and it is
// what this file measures.
//
// METHOD — a PAIRED count, per family, on the SAME input.
//   For one STEP part and one family we derive ONE deterministic operation from
//   the part's own geometry (see DERIVATION below), then run BOTH arms on it:
//       native arm : the forge::occt* engine the drop routes to. A null
//                    TopoDS_Shape is that engine's documented HONEST DEFER.
//       occt arm   : the exact OCCT call src/Features.cpp / src/Cam.cpp /
//                    src/Healing.cpp makes today, with the same arguments and
//                    the same sign conventions (each call is quoted at its site
//                    below, with the file:line it was copied from).
//   and bucket the pair:
//       BOTH_OK      both produced a result the call site would accept
//       NATIVE_ONLY  native built, OCCT did not          (a capability ADD)
//       OCCT_ONLY    OCCT built, native declined         <- THE DELETION
//       NEITHER      neither built
//       N/A          this part cannot furnish an input for this family
//   NOT_APPLICABLE parts are excluded from the family's denominator and the
//   count is reported, because a rate over an unstated denominator is not a
//   measurement.
//
// SUCCESS IS THE CALL SITE'S OWN ACCEPTANCE TEST, deliberately: OCCT
//   `IsDone() && !Shape().IsNull()` plus a non-empty result, native `!IsNull()`
//   plus a non-empty result. Validity is NOT in the predicate —
//   reports/TKOFFSET_DECOMPOSITION.md §4.2 and the loft/pipe A/B both measured
//   OCCT returning IsDone()==true on an INVALID or outright wrong shape, so
//   folding validity into "success" would silently re-score OCCT's baseline
//   down and flatter the native side. Validity is measured and reported
//   SEPARATELY, per arm, so the gate can be read both ways.
//
// AND, FOR FREE, AN AGREEMENT CHECK. In the BOTH_OK bucket the two shapes are
//   compared on a VECTOR of observables — volume, area, centre of mass (3),
//   bounding box (6), face/edge/vertex/shell/solid counts — never on volume
//   alone (this repo has four measured cases where a wrong solid matched the
//   right volume; in one of them no single observable caught it). Disagreement
//   there is a CORRECTNESS finding, not a coverage one, and is reported in its
//   own column so it cannot be mistaken for either.
//
// CRASH / HANG CONTAINMENT. Every arm runs in a FORKED CHILD that writes a
//   fixed-size POD back over a pipe and _exit()s. A SIGSEGV or an infinite loop
//   in one arm is therefore recorded as CRASH / TIMEOUT for THAT ARM ONLY and
//   costs neither the other arm's answer nor the rest of the corpus. This is
//   not defensive decoration: OCCT's offset and thicken engines do die on real
//   imported NURBS parts, and a harness that died with them would report
//   silence, which reads exactly like a clean zero. --selftest in the driver
//   feeds this same path a deliberate segfault and a deliberate spin and
//   requires CRASH and TIMEOUT back — the positive control for the containment.
//
// DERIVATION — how one operation is derived from one part. Stated in full
//   because the derivation IS the input distribution, and a coverage number is
//   only as honest as the distribution it was measured over. All picks are
//   deterministic (no RNG); ties break on the candidate's centroid ordered
//   lexicographically, so the same part always yields the same operation.
//     FILLET        longest LINE edge; radius 0.05 * min bbox extent
//     MAKEOFFSET    outer wire of the largest PLANAR face; inward 0.05*sqrt(area)
//     THICKSOLID    remove the largest PLANAR face; wall 0.05 * min extent
//     OFFSETSHAPE   grow the whole solid by 0.02 * min extent
//     THRUSECTIONS  loft the outer wires of the two largest planar faces that
//                   do NOT share a plane (a coplanar pair is a degenerate loft)
//     PIPE          sweep the largest planar FACE along a 2-leg polyline that
//                   starts at that face's centroid, runs along its normal for
//                   0.5*diag, then turns 30 degrees for another 0.5*diag
//     PIPESHELL     the same spine, profile passed as the WIRE (what
//                   forge::part::sweep passes MakePipeShell), no guides
//     FILLING       outer wire of the largest face of any type
//     THICKEN       the largest face, skinned by 0.05 * min extent
//     DRAFT         the largest planar SIDE WALL (|n.z| < 0.1), pull +Z,
//                   neutral plane z = zmin, angle 3 degrees
//
//   ONE DELIBERATE DEPARTURE, named because it changes a number. Family A's
//   native path (src/Cam.cpp:257 tryNativeInwardOffset) projects the wire onto
//   XY, because every Cam.cpp call site feeds an XY-planar toolpath wire. The
//   corpus's faces are arbitrarily oriented, and an XY projection would make
//   the native arm fail for a reason that is about the CALL SITE, not the
//   engine. So the replication here takes the wire into its OWN plane's frame,
//   offsets, and maps back. Same engine (PolygonOffset2D::offsetLoop), same
//   options, same inward-sign rule; different frame.
//
// NOT COVERED, and why — the other two of the twelve options:
//     FORGE_SHHEAL_DROP_NATIVE and FORGE_GEOM_DROP_NATIVE both DEFAULT ON and
//     already shipped. Neither is a single op with a defer contract: they are
//     replacements for low-level routines (ValueOfUV, curve projection, free
//     bounds, ShapeFix_Solid; the R1/R2/R3 geom primitives) called from inside
//     other ops. There is no "native declined where OCCT would have built it"
//     event to count, so the paired-coverage question this file answers does
//     not apply to them. They are governed by their own A/B gates, not by this
//     one.
//
// OUTPUT. One JSON object per (part, family) on stdout, one per line.
//   test/corpus_ab_aggregate.mjs turns a JSONL of these into the per-family
//   table, with McNemar's exact test and a 95% CI on the paired difference — a
//   difference without an interval is not a result.
//
// BUILD: test/build_corpus_ab_coverage.sh      RUN: test/run_corpus_ab_coverage.sh
// Exit 0 iff the part imported and every requested family was attempted.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <errno.h>
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>

// ── OCCT: import ────────────────────────────────────────────────────────────
#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>

// ── OCCT: topology / geometry ───────────────────────────────────────────────
#include <BRepAdaptor_Curve.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Plane.hxx>
#include <Geom_Surface.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

// ── OCCT: the baseline arms, one per family ─────────────────────────────────
#include <BRepFilletAPI_MakeFillet.hxx>          // FILLET       (TKFillet)
#include <BRepOffsetAPI_MakeOffset.hxx>          // MAKEOFFSET   (family A)
#include <BRepOffsetAPI_MakeFilling.hxx>         // FILLING      (family B/C)
#include <BRepOffsetAPI_DraftAngle.hxx>          // DRAFT        (family J)
#include <BRepOffsetAPI_ThruSections.hxx>        // THRUSECTIONS (family D)
#include <BRepOffsetAPI_MakePipe.hxx>            // PIPE         (family E)
#include <BRepBuilderAPI_TransitionMode.hxx>     // PIPESHELL_RC (family F, mitre)
#include <BRepOffsetAPI_MakePipeShell.hxx>       // PIPESHELL    (family F)
#include <BRepOffsetAPI_MakeThickSolid.hxx>      // THICKSOLID   (family G)
#include <BRepOffsetAPI_MakeOffsetShape.hxx>     // OFFSETSHAPE  (family H)
#include <BRepOffset_MakeOffset.hxx>             // THICKEN      (family I)
#include <BRepOffset_Mode.hxx>
#include <GeomAbs_JoinType.hxx>
#include <GeomAbs_Shape.hxx>

// ── the native engines under test ───────────────────────────────────────────
#include "forge/native/brep/NativeThickSolid.hpp"      // families G, H
#include "forge/native/brep/NativeLoftPipe.hpp"        // families D, E, F
#include "forge/native/brep/NativeThickenShell.hpp"    // family  I
#include "forge/native/brep/NativeDraft.hpp"           // family  J
#include "forge/native/brep/NativeFilling.hpp"         // family  B/C
#include "forge/native/brep/NativeFilletChamfer.hpp"   // TKFillet
#include "forge/native/geom/PolygonOffset2D.hpp"       // family  A

namespace {

constexpr double kPi = 3.14159265358979323846;

// ───────────────────────────────────────────────────────────── arm results
// Fixed-size POD: it crosses a pipe from a forked child in ONE write, well
// under PIPE_BUF, so no framing and no partial-read handling is needed.
enum ArmStatus : int {
    ARM_OK      = 0,   // built something the call site would accept
    ARM_DEFER   = 1,   // native returned null / OCCT !IsDone() — an honest no
    ARM_EMPTY   = 2,   // returned non-null but with nothing in it
    ARM_THREW   = 3,   // Standard_Failure / std::exception / unknown throw
    ARM_CRASH   = 4,   // died on a signal (SIGSEGV, SIGABRT, ...)
    ARM_TIMEOUT = 5,   // exceeded the per-arm deadline and was killed
    ARM_NOTRUN  = 6
};

struct ArmResult {
    int    status   = ARM_NOTRUN;
    int    valid    = -1;        // BRepCheck_Analyzer; -1 = not evaluated
    int    nfaces   = 0, nedges = 0, nverts = 0, nshells = 0, nsolids = 0;
    double volume   = 0.0, area = 0.0, length = 0.0;
    double com[3]   = {0, 0, 0};
    double bb[6]    = {0, 0, 0, 0, 0, 0};   // vertex-derived, not Bnd_Box
    char   note[192] = {0};
};

const char* statusName(int s) {
    switch (s) {
        case ARM_OK: return "OK";
        case ARM_DEFER: return "DEFER";
        case ARM_EMPTY: return "EMPTY";
        case ARM_THREW: return "THREW";
        case ARM_CRASH: return "CRASH";
        case ARM_TIMEOUT: return "TIMEOUT";
        default: return "NOTRUN";
    }
}

// ───────────────────────────────────────────────────────── shape measurement
// Bounding box from VERTICES, not Bnd_Box: Bnd_Box inflates by the shape
// tolerance and would blur exactly the disagreement the comparison exists to
// see (the same choice ab_native_thicken_occt.cpp makes and states).
void measure(const TopoDS_Shape& s, ArmResult& r) {
    TopTools_IndexedMapOfShape m;
    TopExp::MapShapes(s, TopAbs_FACE, m);   r.nfaces  = m.Extent(); m.Clear();
    TopExp::MapShapes(s, TopAbs_EDGE, m);   r.nedges  = m.Extent(); m.Clear();
    TopExp::MapShapes(s, TopAbs_VERTEX, m); r.nverts  = m.Extent(); m.Clear();
    TopExp::MapShapes(s, TopAbs_SHELL, m);  r.nshells = m.Extent(); m.Clear();
    TopExp::MapShapes(s, TopAbs_SOLID, m);  r.nsolids = m.Extent(); m.Clear();

    bool first = true;
    for (TopExp_Explorer ex(s, TopAbs_VERTEX); ex.More(); ex.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
        if (first) {
            r.bb[0] = r.bb[3] = p.X(); r.bb[1] = r.bb[4] = p.Y();
            r.bb[2] = r.bb[5] = p.Z(); first = false;
        } else {
            r.bb[0] = std::min(r.bb[0], p.X()); r.bb[3] = std::max(r.bb[3], p.X());
            r.bb[1] = std::min(r.bb[1], p.Y()); r.bb[4] = std::max(r.bb[4], p.Y());
            r.bb[2] = std::min(r.bb[2], p.Z()); r.bb[5] = std::max(r.bb[5], p.Z());
        }
    }

    if (r.nsolids > 0 || r.nshells > 0) {
        GProp_GProps g;
        try { BRepGProp::VolumeProperties(s, g); r.volume = g.Mass(); } catch (...) { r.volume = 0.0; }
    }
    if (r.nfaces > 0) {
        GProp_GProps ga;
        try {
            BRepGProp::SurfaceProperties(s, ga);
            r.area = ga.Mass();
            const gp_Pnt c = ga.CentreOfMass();
            r.com[0] = c.X(); r.com[1] = c.Y(); r.com[2] = c.Z();
        } catch (...) {}
    } else {
        GProp_GProps gl;
        try {
            BRepGProp::LinearProperties(s, gl);
            r.length = gl.Mass();
            const gp_Pnt c = gl.CentreOfMass();
            r.com[0] = c.X(); r.com[1] = c.Y(); r.com[2] = c.Z();
        } catch (...) {}
    }
    // For a genuine solid the VOLUME centroid is the more discriminating of the
    // two (the area centroid of a shell can sit where no material is).
    if (r.nsolids > 0 && std::fabs(r.volume) > 0.0) {
        GProp_GProps gv;
        try {
            BRepGProp::VolumeProperties(s, gv);
            const gp_Pnt c = gv.CentreOfMass();
            r.com[0] = c.X(); r.com[1] = c.Y(); r.com[2] = c.Z();
        } catch (...) {}
    }
    try { BRepCheck_Analyzer an(s); r.valid = an.IsValid() ? 1 : 0; }
    catch (...) { r.valid = -1; }
}

// ───────────────────────────────────────────────────────────── the arm runner
// One arm = one callable returning a TopoDS_Shape, with a NULL shape meaning
// DEFER. It runs in a forked child so a crash or a hang is scoped to this arm;
// the parent enforces the deadline by polling waitpid.
// `reasonFn`, when given, is read ONLY on a DEFER and only to fill `note`. It
// changes no status and no bucket; it exists because a bare null shape cannot
// say WHICH precondition declined, and the PIPE family's 598-part deletion
// bucket was unattributable without it.
template <class Fn>
ArmResult runArm(Fn&& fn, bool needFace, int deadlineSec, bool noFork,
                 const char* (*reasonFn)() = nullptr) {
    ArmResult r;

    auto compute = [&](ArmResult& out) {
        TopoDS_Shape sh;
        try {
            sh = fn();
            if (sh.IsNull()) {
                out.status = ARM_DEFER;
                if (reasonFn) {
                    const char* why = reasonFn();
                    if (why && *why) std::snprintf(out.note, sizeof out.note, "%s", why);
                }
                return;
            }
            measure(sh, out);
            const bool nonEmpty = needFace ? (out.nfaces > 0) : (out.nedges > 0);
            out.status = nonEmpty ? ARM_OK : ARM_EMPTY;
        } catch (const Standard_Failure& e) {
            out.status = ARM_THREW;
            std::snprintf(out.note, sizeof out.note, "%s",
                          e.GetMessageString() ? e.GetMessageString() : "Standard_Failure");
        } catch (const std::exception& e) {
            out.status = ARM_THREW;
            std::snprintf(out.note, sizeof out.note, "%s", e.what());
        } catch (...) {
            out.status = ARM_THREW;
            std::snprintf(out.note, sizeof out.note, "unknown throw");
        }
    };

    if (noFork) { compute(r); return r; }

    int fds[2];
    if (::pipe(fds) != 0) {
        r.status = ARM_CRASH;
        std::snprintf(r.note, sizeof r.note, "pipe() failed");
        return r;
    }

    const pid_t pid = ::fork();
    if (pid < 0) {
        ::close(fds[0]); ::close(fds[1]);
        r.status = ARM_CRASH;
        std::snprintf(r.note, sizeof r.note, "fork() failed");
        return r;
    }
    if (pid == 0) {
        // CHILD. No atexit, no stdio flush: write the POD and _exit.
        ::close(fds[0]);
        ArmResult c;
        compute(c);
        const ssize_t w = ::write(fds[1], &c, sizeof c);
        (void)w;
        ::close(fds[1]);
        ::_exit(0);
    }

    // PARENT.
    ::close(fds[1]);
    int wstatus = 0;
    bool reaped = false;
    const int pollUs = 2000;
    const long budgetUs = static_cast<long>(deadlineSec) * 1000000L;
    for (long spent = 0; spent <= budgetUs; spent += pollUs) {
        const pid_t got = ::waitpid(pid, &wstatus, WNOHANG);
        if (got == pid) { reaped = true; break; }
        if (got < 0 && errno != EINTR) break;
        ::usleep(pollUs);
    }
    if (!reaped) {
        ::kill(pid, SIGKILL);
        ::waitpid(pid, &wstatus, 0);
        ::close(fds[0]);
        r.status = ARM_TIMEOUT;
        std::snprintf(r.note, sizeof r.note, "killed after %ds", deadlineSec);
        return r;
    }

    ArmResult got;
    const ssize_t n = ::read(fds[0], &got, sizeof got);
    ::close(fds[0]);
    if (n == static_cast<ssize_t>(sizeof got)) return got;

    // Nothing (or a partial POD) came back: the child died before writing.
    r.status = ARM_CRASH;
    if (WIFSIGNALED(wstatus)) std::snprintf(r.note, sizeof r.note, "signal %d", WTERMSIG(wstatus));
    else std::snprintf(r.note, sizeof r.note, "exit %d, no result", WEXITSTATUS(wstatus));
    return r;
}

// ───────────────────────────────────────────────────────────── part features
struct PartInfo {
    TopoDS_Shape shape;
    double bb[6] = {0, 0, 0, 0, 0, 0};
    double minExt = 0.0, diag = 0.0;
    bool   hasSolid = false;
};

bool boundsOf(const TopoDS_Shape& s, double bb[6]) {
    bool first = true;
    for (TopExp_Explorer ex(s, TopAbs_VERTEX); ex.More(); ex.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
        if (first) {
            bb[0] = bb[3] = p.X(); bb[1] = bb[4] = p.Y(); bb[2] = bb[5] = p.Z();
            first = false;
        } else {
            bb[0] = std::min(bb[0], p.X()); bb[3] = std::max(bb[3], p.X());
            bb[1] = std::min(bb[1], p.Y()); bb[4] = std::max(bb[4], p.Y());
            bb[2] = std::min(bb[2], p.Z()); bb[5] = std::max(bb[5], p.Z());
        }
    }
    return !first;
}

double faceArea(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return 0.0; }
    return g.Mass();
}

gp_Pnt faceCentroid(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return gp_Pnt(0, 0, 0); }
    return g.CentreOfMass();
}

// The face's plane with the OUTWARD normal (flipped for TopAbs_REVERSED).
bool planeOf(const TopoDS_Face& f, gp_Pln& out) {
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

double edgeLength(const TopoDS_Edge& e) {
    GProp_GProps g;
    try { BRepGProp::LinearProperties(e, g); } catch (...) { return 0.0; }
    return g.Mass();
}

// Deterministic ordering so a tie never depends on OCCT's internal map order.
bool betterFace(const TopoDS_Face& cand, double candArea,
                const TopoDS_Face& best, double bestArea) {
    if (best.IsNull()) return candArea > 0.0;
    if (candArea > bestArea * (1.0 + 1e-12)) return true;
    if (candArea < bestArea * (1.0 - 1e-12)) return false;
    const gp_Pnt a = faceCentroid(cand), b = faceCentroid(best);
    if (a.X() != b.X()) return a.X() < b.X();
    if (a.Y() != b.Y()) return a.Y() < b.Y();
    return a.Z() < b.Z();
}

struct Picks {
    TopoDS_Face  planarBig;     double planarBigArea = 0.0;   gp_Pln planarBigPln;
    TopoDS_Face  planarSecond;  double planarSecondArea = 0.0;
    TopoDS_Face  anyBig;        double anyBigArea = 0.0;
    TopoDS_Face  sideWall;      double sideWallArea = 0.0;
    TopoDS_Edge  lineEdge;      double lineEdgeLen = 0.0;
    int          nPlanar = 0, nFaces = 0;
};

Picks pickInputs(const PartInfo& part) {
    Picks p;
    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(part.shape, TopAbs_FACE, fm);
    p.nFaces = fm.Extent();
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm(i));
        const double a = faceArea(f);
        if (!(a > 0.0)) continue;
        if (betterFace(f, a, p.anyBig, p.anyBigArea)) { p.anyBig = f; p.anyBigArea = a; }
        gp_Pln pl;
        if (planeOf(f, pl)) {
            ++p.nPlanar;
            if (betterFace(f, a, p.planarBig, p.planarBigArea)) {
                p.planarBig = f; p.planarBigArea = a; p.planarBigPln = pl;
            }
            if (std::fabs(pl.Axis().Direction().Z()) < 0.1 &&
                betterFace(f, a, p.sideWall, p.sideWallArea)) {
                p.sideWall = f; p.sideWallArea = a;
            }
        }
    }
    // Second loft section: the largest planar face that does NOT share
    // planarBig's plane. A coplanar pair is a degenerate loft and would score
    // both engines as failures for a reason that is about neither engine.
    if (!p.planarBig.IsNull()) {
        for (int i = 1; i <= fm.Extent(); ++i) {
            const TopoDS_Face f = TopoDS::Face(fm(i));
            if (f.IsSame(p.planarBig)) continue;
            gp_Pln pl;
            if (!planeOf(f, pl)) continue;
            const double a = faceArea(f);
            if (!(a > 0.0)) continue;
            const bool sameNormal =
                pl.Axis().Direction().IsParallel(p.planarBigPln.Axis().Direction(), 1e-6);
            const bool samePlane = sameNormal &&
                std::fabs(p.planarBigPln.Distance(pl.Location())) < 1e-7 * std::max(1.0, part.diag);
            if (samePlane) continue;
            if (betterFace(f, a, p.planarSecond, p.planarSecondArea)) {
                p.planarSecond = f; p.planarSecondArea = a;
            }
        }
    }
    TopTools_IndexedMapOfShape em;
    TopExp::MapShapes(part.shape, TopAbs_EDGE, em);
    for (int i = 1; i <= em.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(em(i));
        BRepAdaptor_Curve ad;
        try { ad.Initialize(e); } catch (...) { continue; }
        if (ad.GetType() != GeomAbs_Line) continue;
        const double L = edgeLength(e);
        if (L > p.lineEdgeLen * (1.0 + 1e-12)) { p.lineEdge = e; p.lineEdgeLen = L; }
    }
    return p;
}

// A per-wire curve census of a face, outer wire (largest |Newell| area) first:
//     wires=<n> [e<edges>L<lines>C<circles>O<other> c<distinct circles> t<turns>]
// where `turns` is the summed arc parameter span over 2*pi, so a wire that is
// ONE full circle reads c1 t1.000 -- and a two-arc split of the same circle
// reads c1 t1.000 too -- while a slot cut from two different circles reads
// c2 t1.8xx. Purely descriptive: it is written into the row's free-text `op`
// field, and it is what turned "PIPE defers on 598 parts" into an attributable
// answer.
std::string faceWireCensus(const TopoDS_Face& f) {
    struct W { double a = 0.0; int ne = 0, nl = 0, nc = 0, no = 0, ncirc = 0;
               double span = 0.0; };
    std::vector<W> ws;
    for (TopExp_Explorer wx(f, TopAbs_WIRE); wx.More(); wx.Next()) {
        W w;
        double nx = 0, ny = 0, nz = 0;
        std::vector<gp_Pnt> pts;
        std::vector<gp_Circ> circs;
        double span = 0.0;
        for (TopExp_Explorer ex(wx.Current(), TopAbs_EDGE); ex.More(); ex.Next()) {
            ++w.ne;
            BRepAdaptor_Curve ad;
            try { ad.Initialize(TopoDS::Edge(ex.Current())); } catch (...) { ++w.no; continue; }
            if (ad.GetType() == GeomAbs_Line) ++w.nl;
            else if (ad.GetType() == GeomAbs_Circle) {
                ++w.nc;
                const gp_Circ ci = ad.Circle();
                span += std::fabs(ad.LastParameter() - ad.FirstParameter());
                bool seen = false;
                for (const gp_Circ& q : circs)
                    if (q.Location().Distance(ci.Location()) < 1.0e-6 &&
                        std::fabs(q.Radius() - ci.Radius()) < 1.0e-6) { seen = true; break; }
                if (!seen) circs.push_back(ci);
            }
            else ++w.no;
        }
        w.ncirc = static_cast<int>(circs.size());
        w.span = span;
        for (TopExp_Explorer vx(wx.Current(), TopAbs_VERTEX); vx.More(); vx.Next())
            pts.push_back(BRep_Tool::Pnt(TopoDS::Vertex(vx.Current())));
        for (std::size_t i = 0; i < pts.size(); ++i) {
            const gp_Pnt& a = pts[i];
            const gp_Pnt& b = pts[(i + 1) % pts.size()];
            nx += (a.Y() - b.Y()) * (a.Z() + b.Z());
            ny += (a.Z() - b.Z()) * (a.X() + b.X());
            nz += (a.X() - b.X()) * (a.Y() + b.Y());
        }
        w.a = 0.5 * std::sqrt(nx * nx + ny * ny + nz * nz);
        ws.push_back(w);
    }
    std::sort(ws.begin(), ws.end(), [](const W& x, const W& y) { return x.a > y.a; });
    std::string out = "wires=" + std::to_string(ws.size());
    for (const W& w : ws) {
        char b[96];
        std::snprintf(b, sizeof b, " [e%dL%dC%dO%d c%d t%.3f]",
                      w.ne, w.nl, w.nc, w.no, w.ncirc, w.span / 6.283185307179586);
        // HARD CAP. The row is assembled into a fixed buffer; an unbounded census
        // truncated the JSON mid-object and cost 88 of 600 rows on one run --
        // which reads as a smaller N, not as an error. Never let it grow.
        if (out.size() + std::strlen(b) > 220u) { out += " ..."; break; }
        out += b;
    }
    return out;
}

// A 2-leg polyline spine anchored on a face: leg 1 along the face normal (so a
// profile lying IN that face is perpendicular to leg 1, which is exactly the
// precondition forge::occtloft::pipe documents), leg 2 turned 30 degrees.
TopoDS_Wire spineFromFace(const gp_Pnt& origin, const gp_Dir& n, double len) {
    gp_Dir perp(1, 0, 0);
    if (std::fabs(n.Dot(gp_Dir(1, 0, 0))) > 0.9) perp = gp_Dir(0, 1, 0);
    const gp_Dir axis = n.Crossed(perp);
    gp_Trsf rot;
    rot.SetRotation(gp_Ax1(origin, axis), 30.0 * kPi / 180.0);
    gp_Dir n2 = n;
    n2.Transform(rot);
    const gp_Pnt p1 = origin.Translated(gp_Vec(n) * len);
    const gp_Pnt p2 = p1.Translated(gp_Vec(n2) * len);
    BRepBuilderAPI_MakePolygon mp;
    mp.Add(origin); mp.Add(p1); mp.Add(p2);
    if (!mp.IsDone()) return TopoDS_Wire();
    return mp.Wire();
}

// -- DIAGNOSTIC-ONLY DEFER-REASON CHANNEL for family A (behaviour-neutral) ---
// The same device NativeLoftPipe.cpp uses for PIPE/PIPESHELL (its FK_DEFER
// macro, src/native/brep/NativeLoftPipe.cpp:149-169), reproduced here because
// family A's native path is not a library function -- it is nativeInwardOffset
// below, in this file -- so there is no forge::occt* symbol to read a reason
// out of. Every MO_DEFER expands to "record a label, then do EXACTLY what the
// bare `return TopoDS_Shape()` did". No predicate, no tolerance, no branch and
// no engine argument changes; the buffer is written and is never read by
// anything but runArm's reasonFn, and only on a DEFER. It exists because all 33
// of this family's native declines came back as a bare null shape, which made
// the 27-part deletion bucket -- the closest any family has come to parity --
// unattributable.
thread_local char g_moReason[192] = {0};
void moReasonClear() { g_moReason[0] = '\0'; }
void moReasonAdd(const char* label) {
    const std::size_t n = std::strlen(g_moReason);
    // Collapse an immediately repeated label, for the reason NativeLoftPipe
    // states: a wire with forty edges that all fail the same test says the same
    // thing forty times and overflows the buffer, hiding the label that differs.
    const std::size_t k = std::strlen(label);
    if (n >= k && std::strcmp(g_moReason + n - k, label) == 0 &&
        (n == k || g_moReason[n - k - 1] == '|')) return;
    if (n + 2 >= sizeof g_moReason) return;
    std::snprintf(g_moReason + n, sizeof g_moReason - n, "%s%s", n ? "|" : "", label);
}
#define MO_DEFER(label) do { moReasonAdd(label); return TopoDS_Shape(); } while (0)

// Read by runArm ONLY on a DEFER, to fill ArmResult::note. Stale (meaningless)
// after a call that succeeded, exactly like occtloft::lastDeferReason.
const char* makeOffsetDeferReason() { return g_moReason; }

// Family A's native path, replicated from src/Cam.cpp:257 tryNativeInwardOffset
// (that function is in an anonymous namespace and cannot be linked). The wire
// walk, the inward-sign rule and the default OffsetOptions are copied from that
// site; the engine called is the same forge::native::geom::PolygonOffset2D.
// The ONE departure — working in the face's own plane frame instead of
// projecting to XY — is stated in the banner and is why it is not a verbatim
// copy.
TopoDS_Shape nativeInwardOffset(const TopoDS_Wire& wire, double offsetMm, const gp_Pln& plane) {
    using forge::native::geom::Loop2;
    using forge::native::geom::OffsetOptions;
    using forge::native::geom::OffsetResult;
    using forge::native::geom::Point2;
    using forge::native::geom::PolygonOffset2D;

    moReasonClear();
    if (wire.IsNull()) MO_DEFER("wire_null");
    if (offsetMm <= 0.0) MO_DEFER("offset_le_zero");

    const gp_Ax3 ax(plane.Location(), plane.Axis().Direction());
    gp_Trsf toLocal;
    toLocal.SetTransformation(ax);

    // Is every edge a straight segment? Then the exact vertex walk (Cam.cpp).
    bool allLines = true;
    for (BRepTools_WireExplorer ex(wire); ex.More(); ex.Next()) {
        BRepAdaptor_Curve ad;
        try { ad.Initialize(ex.Current()); } catch (...) { allLines = false; break; }
        if (ad.GetType() != GeomAbs_Line) { allLines = false; break; }
    }

    Loop2 loop;
    auto push = [&](gp_Pnt p) {
        p.Transform(toLocal);
        const Point2 q{p.X(), p.Y()};
        if (!loop.pts.empty()) {
            const Point2& b = loop.pts.back();
            if (std::fabs(b.x - q.x) < 1e-9 && std::fabs(b.y - q.y) < 1e-9) return;
        }
        loop.pts.push_back(q);
    };
    if (allLines) {
        for (BRepTools_WireExplorer ex(wire); ex.More(); ex.Next())
            push(BRep_Tool::Pnt(ex.CurrentVertex()));
    } else {
        // Curved wire: sample each edge along its own parameter range, head to
        // tail, honouring the edge orientation — the same job Cam.cpp's
        // sampleWireXY does, minus the XY projection.
        for (BRepTools_WireExplorer ex(wire); ex.More(); ex.Next()) {
            const TopoDS_Edge e = ex.Current();
            BRepAdaptor_Curve ad;
            try { ad.Initialize(e); } catch (...) { MO_DEFER("curve_init_throw"); }
            const double f = ad.FirstParameter(), l = ad.LastParameter();
            const int N = (ad.GetType() == GeomAbs_Line) ? 1 : 24;
            const bool rev = (e.Orientation() == TopAbs_REVERSED);
            for (int i = 0; i < N; ++i) {
                const double t = static_cast<double>(i) / static_cast<double>(N);
                const double u = rev ? (l + (f - l) * t) : (f + (l - f) * t);
                gp_Pnt p;
                try { p = ad.Value(u); } catch (...) { MO_DEFER("curve_value_throw"); }
                push(p);
            }
        }
    }
    if (loop.pts.size() >= 2) {
        const Point2& fr = loop.pts.front();
        const Point2& la = loop.pts.back();
        if (std::fabs(fr.x - la.x) < 1e-9 && std::fabs(fr.y - la.y) < 1e-9) loop.pts.pop_back();
    }
    if (loop.pts.size() < 3) {
        char b[48];
        std::snprintf(b, sizeof b, "lt3_pts_n%zu", loop.pts.size());
        MO_DEFER(b);
    }

    // INVESTIGATION HOOK, off unless FORGE_MO_DUMP is set in the environment:
    // print the ring this function actually handed the offset engine so a
    // standalone probe can replay it. Writes to stderr only; no predicate,
    // branch or argument depends on it.
    if (std::getenv("FORGE_MO_DUMP")) {
        std::fprintf(stderr, "MOLOOP n=%zu d=%.17g allLines=%d ccw=%d\n",
                     loop.pts.size(), offsetMm, allLines ? 1 : 0,
                     loop.isCCW() ? 1 : 0);
        for (const Point2& q : loop.pts)
            std::fprintf(stderr, "MOPT %.17g %.17g\n", q.x, q.y);
    }

    const double signedDist = loop.isCCW() ? -offsetMm : offsetMm;
    OffsetOptions opts;                       // Round joins, auto arc tolerance
    OffsetResult res = PolygonOffset2D::offsetLoop(loop, signedDist, opts);
    if (!res.ok) {
        char b[144];
        std::snprintf(b, sizeof b, "engine_not_ok:%s", res.reason.c_str());
        moReasonAdd(b);
    } else if (res.loops.empty()) {
        char b[64];
        std::snprintf(b, sizeof b, "all_loops_collapsed_dropped%zu", res.droppedLoops);
        moReasonAdd(b);
    }
    if (!res.ok || res.loops.empty()) {
        // The census the attribution is actually made from: how the ring was
        // walked, how big it is, which way it wound, and how far in it was
        // pushed relative to its own size. Appended AFTER the label so a
        // truncated buffer loses the numbers, never the cause.
        char c[112];
        std::snprintf(c, sizeof c, "walk=%s|pts=%zu|ccw=%d|d=%.4g|sqrtA=%.4g",
                      allLines ? "lines" : "sampled", loop.pts.size(),
                      loop.isCCW() ? 1 : 0, offsetMm,
                      std::sqrt(std::fabs(loop.signedArea())));
        moReasonAdd(c);
        return TopoDS_Shape();
    }

    const gp_Trsf toWorld = toLocal.Inverted();
    std::vector<TopoDS_Wire> outWires;
    for (const Loop2& L : res.loops) {
        if (L.pts.size() < 3) continue;
        BRepBuilderAPI_MakePolygon poly;
        for (const Point2& pt : L.pts) {
            gp_Pnt w(pt.x, pt.y, 0.0);
            w.Transform(toWorld);
            poly.Add(w);
        }
        poly.Close();
        if (poly.IsDone()) outWires.push_back(poly.Wire());
    }
    if (outWires.empty()) {
        char b[64];
        std::snprintf(b, sizeof b, "no_wire_from_%zu_loops", res.loops.size());
        MO_DEFER(b);
    }
    if (outWires.size() == 1) return outWires.front();
    TopoDS_Compound comp;
    BRep_Builder bb;
    bb.MakeCompound(comp);
    for (const TopoDS_Wire& w : outWires) bb.Add(comp, w);
    return comp;
}

// ─────────────────────────────────────────────────────────────── JSON output
void emitArm(std::string& out, const char* key, const ArmResult& r) {
    char buf[768];
    std::snprintf(buf, sizeof buf,
        "\"%s\":{\"status\":\"%s\",\"valid\":%d,\"f\":%d,\"e\":%d,\"v\":%d,\"sh\":%d,\"so\":%d,"
        "\"vol\":%.10g,\"area\":%.10g,\"len\":%.10g,"
        "\"com\":[%.10g,%.10g,%.10g],\"bb\":[%.10g,%.10g,%.10g,%.10g,%.10g,%.10g],\"note\":\"",
        key, statusName(r.status), r.valid, r.nfaces, r.nedges, r.nverts, r.nshells, r.nsolids,
        r.volume, r.area, r.length, r.com[0], r.com[1], r.com[2],
        r.bb[0], r.bb[1], r.bb[2], r.bb[3], r.bb[4], r.bb[5]);
    out += buf;
    for (const char* p = r.note; *p; ++p) {
        if (*p == '"' || *p == '\\') { out += '\\'; out += *p; }
        else if (static_cast<unsigned char>(*p) < 0x20) out += ' ';
        else out += *p;
    }
    out += "\"}";
}

bool close_(double a, double b, double scale) {
    return std::fabs(a - b) <= 1e-6 * std::max(1.0, std::fabs(scale));
}

// Agreement on a VECTOR of observables. Volume alone ratifies a wrong solid —
// this repo has four measured cases, one where no single observable caught it.
//
// `signedVolume=false` compares |volume| instead of volume, which separates the
// two things a plain volume comparison conflates: a solid built with the
// OPPOSITE ORIENTATION (same geometry, negated volume — MEASURED on the very
// first corpus part, where OCCT's thicken returned -114690.606 against the
// native +114690.606 with every other observable identical to 10 figures) from
// a solid of genuinely DIFFERENT geometry. Both are reported, in separate
// columns, because they need different fixes and must not be summed.
bool agree(const ArmResult& a, const ArmResult& b, double diag, bool signedVolume = true) {
    if (a.status != ARM_OK || b.status != ARM_OK) return false;
    const double va = signedVolume ? a.volume : std::fabs(a.volume);
    const double vb = signedVolume ? b.volume : std::fabs(b.volume);
    if (!close_(va, vb, std::max(std::fabs(va), std::fabs(vb)))) return false;
    if (!close_(a.area, b.area, std::max(a.area, b.area))) return false;
    for (int i = 0; i < 3; ++i) if (!close_(a.com[i], b.com[i], diag)) return false;
    for (int i = 0; i < 6; ++i) if (!close_(a.bb[i], b.bb[i], diag)) return false;
    if (a.nfaces != b.nfaces || a.nedges != b.nedges || a.nverts != b.nverts ||
        a.nshells != b.nshells || a.nsolids != b.nsolids) return false;
    return true;
}

const char* bucketOf(const ArmResult& nat, const ArmResult& oc) {
    const bool n = nat.status == ARM_OK, o = oc.status == ARM_OK;
    if (n && o) return "BOTH_OK";
    if (n && !o) return "NATIVE_ONLY";
    if (!n && o) return "OCCT_ONLY";
    return "NEITHER";
}

struct Cfg {
    int         armTimeout = 20;
    int         partTimeout = 300;   // whole-process alarm(); see main()
    bool        noFork = false;
    std::string only;    // comma list, empty = all families
};

bool wanted(const Cfg& c, const char* fam) {
    if (c.only.empty()) return true;
    const std::string hay = "," + c.only + ",";
    return hay.find(std::string(",") + fam + ",") != std::string::npos;
}

// --selftest: the POSITIVE CONTROL for the crash/hang containment. A harness
// whose containment silently swallowed everything would look exactly like a
// clean run, so the containment is made to FIRE on demand and the expected
// verdicts are asserted here rather than assumed.
int selftest(const Cfg& cfg) {
    int bad = 0;
    auto expect = [&](const char* what, int got, int want) {
        const bool okv = (got == want);
        std::printf("  %-28s got %-8s want %-8s  %s\n", what, statusName(got), statusName(want),
                    okv ? "ok" : "MISMATCH");
        if (!okv) ++bad;
    };
    // 1. a deliberate SIGSEGV must come back as CRASH, not as a defer.
    expect("deliberate SIGSEGV", runArm([]() -> TopoDS_Shape {
        volatile int* p = reinterpret_cast<volatile int*>(1);
        *p = 42;
        return TopoDS_Shape();
    }, true, cfg.armTimeout, false).status, ARM_CRASH);
    // 2. a deliberate spin must come back as TIMEOUT, not as a defer.
    expect("deliberate spin", runArm([]() -> TopoDS_Shape {
        for (;;) { }
        return TopoDS_Shape();
    }, true, 2, false).status, ARM_TIMEOUT);
    // 3. a deliberate throw must come back as THREW.
    expect("deliberate throw", runArm([]() -> TopoDS_Shape {
        throw std::runtime_error("selftest throw");
    }, true, cfg.armTimeout, false).status, ARM_THREW);
    // 4. a null return must come back as DEFER.
    expect("null return", runArm([]() -> TopoDS_Shape {
        return TopoDS_Shape();
    }, true, cfg.armTimeout, false).status, ARM_DEFER);
    // 5. a real solid must come back as OK, so DEFER is not the only answer the
    //    plumbing can produce (a channel that always says DEFER would pass 1-4).
    expect("real box", runArm([]() -> TopoDS_Shape {
        BRepBuilderAPI_MakePolygon mp;
        mp.Add(gp_Pnt(0, 0, 0)); mp.Add(gp_Pnt(10, 0, 0));
        mp.Add(gp_Pnt(10, 10, 0)); mp.Add(gp_Pnt(0, 10, 0));
        mp.Close();
        if (!mp.IsDone()) return TopoDS_Shape();
        std::vector<TopoDS_Shape> secs;
        secs.push_back(mp.Wire());
        BRepBuilderAPI_MakePolygon mp2;
        mp2.Add(gp_Pnt(0, 0, 10)); mp2.Add(gp_Pnt(10, 0, 10));
        mp2.Add(gp_Pnt(10, 10, 10)); mp2.Add(gp_Pnt(0, 10, 10));
        mp2.Close();
        if (!mp2.IsDone()) return TopoDS_Shape();
        secs.push_back(mp2.Wire());
        return forge::occtloft::thruSections(secs, true, true, 1.0e-6);
    }, true, cfg.armTimeout, false).status, ARM_OK);

    std::printf("  -- containment %d/5 --\n", 5 - bad);

    // ─────────────────────────────────────────────────────────────────────
    // PER-FAMILY POSITIVE CONTROLS.
    //
    // WHY THIS SECTION EXISTS AND IS NOT OPTIONAL. The corpus run reports some
    // families at a native success rate of ZERO. A zero is exactly what a
    // MIS-WIRED ARM also produces: the wrong argument order, a profile the
    // engine was never going to look at, an engine that is not in the binary at
    // all. nm/grep on a missing file yields a false zero the same way. So each
    // native engine is fed, HERE, an input its own header documents as IN
    // SCOPE, and is required to return OK. If a family's control is red, that
    // family's corpus number is a HARNESS result and must not be read as an
    // engine result.
    //
    // The control geometry is a 10 mm box built by the native ruled loft
    // itself (control 5 above already proved that path returns OK), so nothing
    // in this section depends on an OCCT modelling call.
    // ─────────────────────────────────────────────────────────────────────
    auto square = [](double z, double h) {
        BRepBuilderAPI_MakePolygon mp;
        mp.Add(gp_Pnt(0, 0, z)); mp.Add(gp_Pnt(h, 0, z));
        mp.Add(gp_Pnt(h, h, z)); mp.Add(gp_Pnt(0, h, z));
        mp.Close();
        return mp.IsDone() ? mp.Wire() : TopoDS_Wire();
    };
    const double H = 10.0;
    const TopoDS_Wire w0 = square(0.0, H), w1 = square(H, H);
    TopoDS_Shape box;
    if (!w0.IsNull() && !w1.IsNull()) {
        std::vector<TopoDS_Shape> secs;
        secs.push_back(w0);
        secs.push_back(w1);
        box = forge::occtloft::thruSections(secs, true, true, 1.0e-6);
    }
    if (box.IsNull()) {
        std::printf("  FATAL: the control box could not be built natively — every "
                    "per-family control below is unrunnable\n");
        std::printf("FAIL: self-test\n");
        return 1;
    }

    // Pick the control box's parts by geometry, never by index.
    TopoDS_Face topFace, bottomFace, sideFace;
    for (TopExp_Explorer ex(box, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face f = TopoDS::Face(ex.Current());
        gp_Pln pl;
        if (!planeOf(f, pl)) continue;
        const double nz = pl.Axis().Direction().Z();
        const gp_Pnt c = faceCentroid(f);
        if (nz > 0.9 && c.Z() > H - 1e-6) topFace = f;
        else if (nz < -0.9 && c.Z() < 1e-6) bottomFace = f;
        else if (std::fabs(nz) < 0.1 && sideFace.IsNull()) sideFace = f;
    }
    TopoDS_Edge vertEdge;
    for (TopExp_Explorer ex(box, TopAbs_EDGE); ex.More(); ex.Next()) {
        const TopoDS_Edge e = TopoDS::Edge(ex.Current());
        TopoDS_Vertex a, b;
        TopExp::Vertices(e, a, b);
        if (a.IsNull() || b.IsNull()) continue;
        const gp_Pnt pa = BRep_Tool::Pnt(a), pb = BRep_Tool::Pnt(b);
        if (std::fabs(pa.Z() - pb.Z()) > H - 1e-6) { vertEdge = e; break; }
    }
    BRepBuilderAPI_MakePolygon spineMk;
    spineMk.Add(gp_Pnt(H / 2, H / 2, 0));
    spineMk.Add(gp_Pnt(H / 2, H / 2, 30));
    spineMk.Add(gp_Pnt(H / 2 + 20, H / 2, 30));
    const TopoDS_Wire ctlSpine = spineMk.IsDone() ? spineMk.Wire() : TopoDS_Wire();

    auto ctl = [&](const char* fam, int got) {
        const bool okv = (got == ARM_OK);
        std::printf("  %-28s native control %-8s %s\n", fam, statusName(got),
                    okv ? "ok" : "MISWIRED — this family's corpus zero is NOT an engine result");
        if (!okv) ++bad;
    };
    const int CT = cfg.armTimeout;

    ctl("FILLET", vertEdge.IsNull() ? ARM_NOTRUN : runArm([&]() -> TopoDS_Shape {
        std::vector<forge::occtfillet::FilletSpec> sp(1);
        sp[0].edge = vertEdge;
        sp[0].radius = 1.0;
        const forge::occtfillet::Result r2 = forge::occtfillet::makeFillet(box, sp);
        return r2.ok ? r2.shape : TopoDS_Shape();
    }, true, CT, false).status);

    ctl("MAKEOFFSET", runArm([&]() -> TopoDS_Shape {
        return nativeInwardOffset(w0, 1.0, gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(0, 0, -1)));
    }, false, CT, false).status);

    ctl("THICKSOLID", topFace.IsNull() ? ARM_NOTRUN : runArm([&]() -> TopoDS_Shape {
        TopTools_ListOfShape rm;
        rm.Append(topFace);
        return forge::occtoffset::makeThickSolid(box, 1.0, rm, 1.0e-3);
    }, true, CT, false).status);

    ctl("OFFSETSHAPE", runArm([&]() -> TopoDS_Shape {
        return forge::occtoffset::offsetSolidShape(box, 1.0, 1.0e-7);
    }, true, CT, false).status);

    ctl("THRUSECTIONS", runArm([&]() -> TopoDS_Shape {
        std::vector<TopoDS_Shape> secs;
        secs.push_back(w0);
        secs.push_back(w1);
        return forge::occtloft::thruSections(secs, true, true, 1.0e-6);
    }, true, CT, false).status);

    ctl("PIPE", (ctlSpine.IsNull() || bottomFace.IsNull()) ? ARM_NOTRUN
        : runArm([&]() -> TopoDS_Shape {
            return forge::occtloft::pipe(ctlSpine, bottomFace, 1.0e-6);
        }, true, CT, false).status);

    ctl("PIPESHELL", ctlSpine.IsNull() ? ARM_NOTRUN : runArm([&]() -> TopoDS_Shape {
        const std::vector<TopoDS_Wire> g;
        return forge::occtloft::pipeShell(ctlSpine, w0, g, true, 1.0e-6);
    }, true, CT, false).status);

    ctl("FILLING", runArm([&]() -> TopoDS_Shape {
        return forge::occtfill::fillC0Boundary(w0, 1.0e-6);
    }, true, CT, false).status);

    ctl("THICKEN", bottomFace.IsNull() ? ARM_NOTRUN : runArm([&]() -> TopoDS_Shape {
        return forge::occtthicken::thickenShell(bottomFace, 1.0, 1.0e-4);
    }, true, CT, false).status);

    ctl("DRAFT", sideFace.IsNull() ? ARM_NOTRUN : runArm([&]() -> TopoDS_Shape {
        TopTools_ListOfShape fs;
        fs.Append(sideFace);
        return forge::occtdraft::draftFaces(box, fs, gp_Dir(0, 0, 1), 5.0 * kPi / 180.0,
                                            gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 1.0e-6);
    }, true, CT, false).status);

    std::printf("%s: self-test, %d check(s) red of 15\n", bad ? "FAIL" : "PASS", bad);
    return bad ? 1 : 0;
}

}  // namespace

int main(int argc, char** argv) {
    Cfg cfg;
    std::string stepPath, partName;
    bool wantSelftest = false;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a.rfind("--families=", 0) == 0) cfg.only = a.substr(11);
        else if (a.rfind("--arm-timeout=", 0) == 0) cfg.armTimeout = std::atoi(a.c_str() + 14);
        else if (a.rfind("--part-timeout=", 0) == 0) cfg.partTimeout = std::atoi(a.c_str() + 15);
        else if (a == "--no-fork") cfg.noFork = true;
        else if (a == "--selftest") wantSelftest = true;
        else if (a.rfind("--name=", 0) == 0) partName = a.substr(7);
        else if (a.rfind("--", 0) == 0) { std::fprintf(stderr, "unknown flag %s\n", a.c_str()); return 2; }
        else stepPath = a;
    }
    if (wantSelftest) return selftest(cfg);

    // Whole-process deadline. The per-arm forks are covered by runArm's own
    // waitpid deadline; this alarm covers everything OUTSIDE them — chiefly the
    // STEP import, which is the one step that runs in this process and can hang
    // on a malformed file. alarm() is NOT inherited by fork()ed children, so it
    // cannot silently shorten an arm's budget. The default SIGALRM disposition
    // terminates the process; the driver records the missing row rather than
    // losing the part silently.
    if (cfg.partTimeout > 0) ::alarm(static_cast<unsigned>(cfg.partTimeout));

    if (stepPath.empty()) {
        std::fprintf(stderr,
            "usage: corpus_ab_coverage <part.step> [--families=A,B] [--arm-timeout=SEC]"
            " [--no-fork] [--name=ID]\n"
            "       corpus_ab_coverage --selftest\n");
        return 2;
    }
    if (partName.empty()) {
        const size_t slash = stepPath.find_last_of('/');
        partName = (slash == std::string::npos) ? stepPath : stepPath.substr(slash + 1);
        const size_t dot = partName.find_last_of('.');
        if (dot != std::string::npos) partName = partName.substr(0, dot);
    }

    // ── import ─────────────────────────────────────────────────────────────
    PartInfo part;
    {
        STEPControl_Reader rd;
        IFSelect_ReturnStatus st = IFSelect_RetFail;
        try { st = rd.ReadFile(stepPath.c_str()); } catch (...) { st = IFSelect_RetFail; }
        if (st != IFSelect_RetDone) {
            std::printf("{\"part\":\"%s\",\"error\":\"step_read_failed\"}\n", partName.c_str());
            return 1;
        }
        try { rd.TransferRoots(); } catch (...) {}
        try { part.shape = rd.OneShape(); } catch (...) {}
        if (part.shape.IsNull()) {
            std::printf("{\"part\":\"%s\",\"error\":\"step_transfer_empty\"}\n", partName.c_str());
            return 1;
        }
    }
    if (!boundsOf(part.shape, part.bb)) {
        std::printf("{\"part\":\"%s\",\"error\":\"no_vertices\"}\n", partName.c_str());
        return 1;
    }
    {
        const double dx = part.bb[3] - part.bb[0];
        const double dy = part.bb[4] - part.bb[1];
        const double dz = part.bb[5] - part.bb[2];
        part.minExt = std::min(dx, std::min(dy, dz));
        part.diag = std::sqrt(dx * dx + dy * dy + dz * dz);
        TopTools_IndexedMapOfShape sm;
        TopExp::MapShapes(part.shape, TopAbs_SOLID, sm);
        part.hasSolid = sm.Extent() > 0;
    }
    if (!(part.diag > 0.0)) {
        std::printf("{\"part\":\"%s\",\"error\":\"degenerate_bbox\"}\n", partName.c_str());
        return 1;
    }
    // A zero minimum extent (a flat sheet) makes every size-derived argument
    // zero, which would score as a defer for a reason that is about the
    // derivation and not about either engine. Fall back to a fraction of the
    // diagonal and FLAG it in the record, rather than silently emitting a
    // zero-thickness op.
    const bool flat = !(part.minExt > 1e-9 * part.diag);
    const double scale = flat ? part.diag * 0.05 : part.minExt;

    const Picks pk = pickInputs(part);

    auto emit = [&](const char* fam, bool applicable, const char* naReason,
                    const ArmResult& nat, const ArmResult& oc, const char* opDesc) {
        std::string line;
        char head[1024];
        std::snprintf(head, sizeof head,
            "{\"part\":\"%s\",\"family\":\"%s\",\"applicable\":%s,\"na_reason\":\"%s\","
            "\"op\":\"%s\",\"diag\":%.10g,\"min_ext\":%.10g,\"flat\":%s,\"nfaces_part\":%d,",
            partName.c_str(), fam, applicable ? "true" : "false", naReason ? naReason : "",
            opDesc ? opDesc : "", part.diag, part.minExt, flat ? "true" : "false", pk.nFaces);
        line += head;
        if (applicable) {
            emitArm(line, "native", nat); line += ",";
            emitArm(line, "occt", oc);    line += ",";
            char tail[192];
            std::snprintf(tail, sizeof tail,
                          "\"bucket\":\"%s\",\"agree\":%s,\"agree_upto_orientation\":%s}",
                          bucketOf(nat, oc),
                          agree(nat, oc, part.diag, true) ? "true" : "false",
                          agree(nat, oc, part.diag, false) ? "true" : "false");
            line += tail;
        } else {
            line += "\"bucket\":\"NOT_APPLICABLE\",\"agree\":false,\"agree_upto_orientation\":false}";
        }
        line += "\n";
        std::fputs(line.c_str(), stdout);
        std::fflush(stdout);
    };

    const int T = cfg.armTimeout;
    const bool NF = cfg.noFork;
    const ArmResult none;

    // ══════════════════════════════════════════════════════ FILLET (TKFillet)
    // native  forge::occtfillet::makeFillet             src/Features.cpp:1546
    // occt    BRepFilletAPI_MakeFillet mk(src); Add(r,e) src/Features.cpp (baseline)
    if (wanted(cfg, "FILLET")) {
        if (pk.lineEdge.IsNull()) emit("FILLET", false, "no_line_edge", none, none, "");
        else {
            const double r = 0.05 * scale;
            const TopoDS_Edge e = pk.lineEdge;
            const TopoDS_Shape src = part.shape;
            char od[112];
            std::snprintf(od, sizeof od, "fillet r=%.6g on the longest line edge", r);
            const ArmResult nat = runArm([&]() -> TopoDS_Shape {
                std::vector<forge::occtfillet::FilletSpec> sp(1);
                sp[0].edge = e;
                sp[0].radius = r;
                const forge::occtfillet::Result res = forge::occtfillet::makeFillet(src, sp);
                return res.ok ? res.shape : TopoDS_Shape();
            }, true, T, NF);
            const ArmResult oc = runArm([&]() -> TopoDS_Shape {
                BRepFilletAPI_MakeFillet mk(src);
                mk.Add(r, e);
                mk.Build();
                if (!mk.IsDone()) return TopoDS_Shape();
                return mk.Shape();
            }, true, T, NF);
            emit("FILLET", true, "", nat, oc, od);
        }
    }

    // ══════════════════════════════════════ MAKEOFFSET (TKOffset family A)
    // native  PolygonOffset2D, via src/Cam.cpp:257 (replicated, see banner)
    // occt    MakeOffset(wire, Arc); Init(Arc); Perform(-d)   src/Cam.cpp:374
    if (wanted(cfg, "MAKEOFFSET")) {
        if (pk.planarBig.IsNull()) emit("MAKEOFFSET", false, "no_planar_face", none, none, "");
        else {
            const TopoDS_Wire w = BRepTools::OuterWire(pk.planarBig);
            if (w.IsNull()) emit("MAKEOFFSET", false, "no_outer_wire", none, none, "");
            else {
                const double d = 0.05 * std::sqrt(pk.planarBigArea);
                const gp_Pln pl = pk.planarBigPln;
                char od[112];
                std::snprintf(od, sizeof od, "inward wire offset d=%.6g", d);
                const ArmResult nat = runArm([&]() -> TopoDS_Shape {
                    return nativeInwardOffset(w, d, pl);
                }, false, T, NF, &makeOffsetDeferReason);
                const ArmResult oc = runArm([&]() -> TopoDS_Shape {
                    BRepOffsetAPI_MakeOffset off(w, GeomAbs_Arc);
                    off.Init(GeomAbs_Arc);
                    off.Perform(-d);
                    if (!off.IsDone()) return TopoDS_Shape();
                    return off.Shape();
                }, false, T, NF);
                emit("MAKEOFFSET", true, "", nat, oc, od);
            }
        }
    }

    // ═══════════════════════════════════════ THICKSOLID (TKOffset family G)
    // native  occtoffset::makeThickSolid(src, +wall, faces, 1e-3)  Features.cpp:1126
    // occt    mk.MakeThickSolidByJoin(src, faces, -wall, 1e-3)     Features.cpp:1144
    if (wanted(cfg, "THICKSOLID")) {
        if (!part.hasSolid) emit("THICKSOLID", false, "not_a_solid", none, none, "");
        else if (pk.planarBig.IsNull()) emit("THICKSOLID", false, "no_planar_face", none, none, "");
        else {
            const double wall = 0.05 * scale;
            const TopoDS_Shape src = part.shape;
            const TopoDS_Face rm = pk.planarBig;
            char od[128];
            std::snprintf(od, sizeof od, "shell wall=%.6g removing the largest planar face", wall);
            const ArmResult nat = runArm([&]() -> TopoDS_Shape {
                TopTools_ListOfShape faces;
                faces.Append(rm);
                return forge::occtoffset::makeThickSolid(src, wall, faces, 1.0e-3);
            }, true, T, NF, &forge::occtoffset::lastThickSolidDeferReason);
            const ArmResult oc = runArm([&]() -> TopoDS_Shape {
                TopTools_ListOfShape faces;
                faces.Append(rm);
                BRepOffsetAPI_MakeThickSolid mk;
                mk.MakeThickSolidByJoin(src, faces, -wall, 1.0e-3);
                mk.Build();
                if (!mk.IsDone()) return TopoDS_Shape();
                return mk.Shape();
            }, true, T, NF);
            emit("THICKSOLID", true, "", nat, oc, od);
        }
    }

    // ══════════════════════════════════════ OFFSETSHAPE (TKOffset family H)
    // native  occtoffset::offsetSolidShape(src, dist)                Features.cpp
    // occt    PerformByJoin(src,d,1e-7,Skin,false,false,Intersection) Features.cpp:1344
    if (wanted(cfg, "OFFSETSHAPE")) {
        if (!part.hasSolid) emit("OFFSETSHAPE", false, "not_a_solid", none, none, "");
        else {
            const double d = 0.02 * scale;
            const TopoDS_Shape src = part.shape;
            char od[112];
            std::snprintf(od, sizeof od, "whole-solid grow d=%.6g", d);
            const ArmResult nat = runArm([&]() -> TopoDS_Shape {
                return forge::occtoffset::offsetSolidShape(src, d, 1.0e-7);
            }, true, T, NF);
            const ArmResult oc = runArm([&]() -> TopoDS_Shape {
                BRepOffsetAPI_MakeOffsetShape mk;
                mk.PerformByJoin(src, d, 1.0e-7, BRepOffset_Skin,
                                 Standard_False, Standard_False, GeomAbs_Intersection);
                if (!mk.IsDone()) return TopoDS_Shape();
                TopoDS_Shape off = mk.Shape();
                if (off.IsNull()) return off;
                if (off.ShapeType() == TopAbs_SHELL) {
                    BRepBuilderAPI_MakeSolid ms(TopoDS::Shell(off));
                    if (ms.IsDone()) off = ms.Solid();
                } else if (off.ShapeType() == TopAbs_COMPOUND) {
                    TopExp_Explorer ex(off, TopAbs_SHELL);
                    if (ex.More()) {
                        BRepBuilderAPI_MakeSolid ms(TopoDS::Shell(ex.Current()));
                        if (ms.IsDone()) off = ms.Solid();
                    }
                }
                return off;
            }, true, T, NF);
            emit("OFFSETSHAPE", true, "", nat, oc, od);
        }
    }

    // ════════════════════════════════════ THRUSECTIONS (TKOffset family D)
    // native  occtloft::thruSections(secs, solid=true, ruled=true)   Features.cpp:1001
    // occt    ThruSections(true, ruled, 1e-6); AddWire x2; Build     Features.cpp:1007
    if (wanted(cfg, "THRUSECTIONS")) {
        if (pk.planarBig.IsNull() || pk.planarSecond.IsNull())
            emit("THRUSECTIONS", false, "need_two_non_coplanar_planar_faces", none, none, "");
        else {
            const TopoDS_Wire w1 = BRepTools::OuterWire(pk.planarBig);
            const TopoDS_Wire w2 = BRepTools::OuterWire(pk.planarSecond);
            if (w1.IsNull() || w2.IsNull()) emit("THRUSECTIONS", false, "no_outer_wire", none, none, "");
            else {
                const ArmResult nat = runArm([&]() -> TopoDS_Shape {
                    std::vector<TopoDS_Shape> secs;
                    secs.push_back(w1);
                    secs.push_back(w2);
                    return forge::occtloft::thruSections(secs, true, true, 1.0e-6);
                }, true, T, NF);
                const ArmResult oc = runArm([&]() -> TopoDS_Shape {
                    BRepOffsetAPI_ThruSections mk(Standard_True, Standard_True, 1.0e-6);
                    mk.AddWire(w1);
                    mk.AddWire(w2);
                    mk.Build();
                    if (!mk.IsDone()) return TopoDS_Shape();
                    return mk.Shape();
                }, true, T, NF);
                emit("THRUSECTIONS", true, "", nat, oc,
                     "ruled solid loft of two non-coplanar planar-face wires");
            }
        }
    }

    // ═══════════════════════════ PIPE (family E) and PIPESHELL (family F)
    // native  occtloft::pipe(spine, profileFace)                   Features.cpp:2170
    // occt    BRepOffsetAPI_MakePipe(spine, profileFace); Build    Features.cpp:700
    // native  occtloft::pipeShell(spine, profileWire, {}, true)    Features.cpp
    // occt    MakePipeShell(spine); Add(w); Build; MakeSolid       Features.cpp:730
    if (wanted(cfg, "PIPE") || wanted(cfg, "PIPESHELL")) {
        TopoDS_Wire spine, prof;
        bool haveInput = false;
        if (!pk.planarBig.IsNull()) {
            const TopoDS_Wire w = BRepTools::OuterWire(pk.planarBig);
            if (!w.IsNull()) {
                spine = spineFromFace(faceCentroid(pk.planarBig),
                                      pk.planarBigPln.Axis().Direction(),
                                      0.5 * part.diag);
                prof = w;
                haveInput = !spine.IsNull();
            }
        }
        if (wanted(cfg, "PIPE")) {
            if (!haveInput) emit("PIPE", false, "no_planar_face_or_spine", none, none, "");
            else {
                const TopoDS_Face pf = pk.planarBig;
                const TopoDS_Wire sp = spine;
                const ArmResult nat = runArm([&]() -> TopoDS_Shape {
                    return forge::occtloft::pipe(sp, pf, 1.0e-6);
                }, true, T, NF, &forge::occtloft::lastDeferReason);
                const ArmResult oc = runArm([&]() -> TopoDS_Shape {
                    BRepOffsetAPI_MakePipe mk(sp, pf);
                    mk.Build();
                    if (!mk.IsDone()) return TopoDS_Shape();
                    return mk.Shape();
                }, true, T, NF);
                const std::string opd =
                    std::string("sweep the largest planar face along a 2-leg spine "
                                "on its normal; ") + faceWireCensus(pk.planarBig);
                emit("PIPE", true, "", nat, oc, opd.c_str());
            }
        }
        if (wanted(cfg, "PIPESHELL")) {
            if (!haveInput) emit("PIPESHELL", false, "no_planar_face_or_spine", none, none, "");
            else {
                const TopoDS_Wire pw = prof;
                const TopoDS_Wire sp = spine;
                const ArmResult nat = runArm([&]() -> TopoDS_Shape {
                    const std::vector<TopoDS_Wire> guides;
                    return forge::occtloft::pipeShell(sp, pw, guides, true, 1.0e-6);
                }, true, T, NF, &forge::occtloft::lastDeferReason);
                const ArmResult oc = runArm([&]() -> TopoDS_Shape {
                    BRepOffsetAPI_MakePipeShell mk(sp);
                    mk.Add(pw);
                    mk.Build();
                    if (!mk.IsDone()) return TopoDS_Shape();
                    mk.MakeSolid();
                    return mk.Shape();
                }, true, T, NF);
                emit("PIPESHELL", true, "", nat, oc,
                     "unguided pipe-shell of the same wire along the same spine");

                // PIPESHELL_RC — the SAME native arm against the SAME OCCT call
                // with ONE line added: SetTransitionMode(BRepBuilderAPI_RightCorner).
                // The PIPESHELL row above mirrors the production call site
                // (src/Features.cpp:728) exactly, and that site leaves the
                // transition mode at OCCT's default BRepBuilderAPI_Transformed.
                // Measured (test/ps_convention_probe, 45 synthetic cases, 3
                // profiles x 5 turn angles x 3 leg ratios): under Transformed
                // OCCT does NOT carry the section through the spine corner, so
                // the section perpendicular to leg 2 has area A*cos(theta), and
                // the enclosed volume is A*(L1 + L2*cos theta) rather than
                // A*(L1+L2). Native implements the MITRE, which is what
                // RightCorner asks OCCT for. This row measures how much of the
                // PIPESHELL disagreement is that one convention.
                const ArmResult ocRc = runArm([&]() -> TopoDS_Shape {
                    BRepOffsetAPI_MakePipeShell mk(sp);
                    mk.SetTransitionMode(BRepBuilderAPI_RightCorner);
                    mk.Add(pw);
                    mk.Build();
                    if (!mk.IsDone()) return TopoDS_Shape();
                    mk.MakeSolid();
                    return mk.Shape();
                }, true, T, NF);
                emit("PIPESHELL_RC", true, "", nat, ocRc,
                     "same, with OCCT SetTransitionMode(RightCorner)");
            }
        }
    }

    // ════════════════════════════════════════ FILLING (TKOffset family B/C)
    // native  occtfill::fillC0Boundary(w, tol)                  src/Healing.cpp:478
    // occt    MakeFilling; Add(edge, GeomAbs_C0) per edge       src/Healing.cpp:487
    if (wanted(cfg, "FILLING")) {
        if (pk.anyBig.IsNull()) emit("FILLING", false, "no_face", none, none, "");
        else {
            const TopoDS_Wire w = BRepTools::OuterWire(pk.anyBig);
            if (w.IsNull()) emit("FILLING", false, "no_outer_wire", none, none, "");
            else {
                const double tol = 1.0e-6 * std::max(1.0, part.diag);
                const ArmResult nat = runArm([&]() -> TopoDS_Shape {
                    return forge::occtfill::fillC0Boundary(w, tol);
                }, true, T, NF);
                const ArmResult oc = runArm([&]() -> TopoDS_Shape {
                    BRepOffsetAPI_MakeFilling filling;
                    for (TopExp_Explorer ex(w, TopAbs_EDGE); ex.More(); ex.Next())
                        filling.Add(TopoDS::Edge(ex.Current()), GeomAbs_C0);
                    filling.Build();
                    if (!filling.IsDone()) return TopoDS_Shape();
                    return filling.Shape();
                }, true, T, NF);
                emit("FILLING", true, "", nat, oc, "C0 cap over the largest face's outer wire");
            }
        }
    }

    // ═════════════════════════════════════════ THICKEN (TKOffset family I)
    // native  occtthicken::thickenShell(src, t, 1e-4)                Features.cpp:1212
    // occt    BRepOffset_MakeOffset Initialize(Skin,Arc,thick=true)  Features.cpp:1219
    if (wanted(cfg, "THICKEN")) {
        if (pk.anyBig.IsNull()) emit("THICKEN", false, "no_face", none, none, "");
        else {
            const double t = 0.05 * scale;
            const TopoDS_Face f = pk.anyBig;
            char od[112];
            std::snprintf(od, sizeof od, "skin the largest face t=%.6g", t);
            const ArmResult nat = runArm([&]() -> TopoDS_Shape {
                return forge::occtthicken::thickenShell(f, t, 1.0e-4);
            }, true, T, NF);
            const ArmResult oc = runArm([&]() -> TopoDS_Shape {
                BRepOffset_MakeOffset mk;
                mk.Initialize(f, t, 1.0e-4, BRepOffset_Skin,
                              Standard_False, Standard_False, GeomAbs_Arc, Standard_True);
                mk.MakeThickSolid();
                if (!mk.IsDone()) return TopoDS_Shape();
                return mk.Shape();
            }, true, T, NF);
            emit("THICKEN", true, "", nat, oc, od);
        }
    }

    // ═══════════════════════════════════════════ DRAFT (TKOffset family J)
    // native  occtdraft::draftFaces(src, faces, pull, ang, plane)  Features.cpp:2171
    // occt    DraftAngle(src); Add/AddDone/Remove; Build           Features.cpp:2177
    if (wanted(cfg, "DRAFT")) {
        if (pk.sideWall.IsNull()) emit("DRAFT", false, "no_planar_side_wall", none, none, "");
        else {
            const double ang = 3.0 * kPi / 180.0;
            const gp_Dir pull(0, 0, 1);
            const gp_Pln neutral(gp_Pnt(0, 0, part.bb[2]), gp_Dir(0, 0, 1));
            const TopoDS_Shape src = part.shape;
            const TopoDS_Face f = pk.sideWall;
            const ArmResult nat = runArm([&]() -> TopoDS_Shape {
                TopTools_ListOfShape faces;
                faces.Append(f);
                return forge::occtdraft::draftFaces(src, faces, pull, ang, neutral, 1.0e-6);
            }, true, T, NF);
            const ArmResult oc = runArm([&]() -> TopoDS_Shape {
                BRepOffsetAPI_DraftAngle mk(src);
                mk.Add(f, pull, ang, neutral);
                if (!mk.AddDone()) mk.Remove(f);
                mk.Build();
                if (!mk.IsDone()) return TopoDS_Shape();
                return mk.Shape();
            }, true, T, NF);
            emit("DRAFT", true, "", nat, oc,
                 "draft the largest planar side wall 3 deg, neutral plane z=zmin");
        }
    }

    return 0;
}
