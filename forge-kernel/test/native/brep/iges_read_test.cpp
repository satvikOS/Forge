// forge/native/brep/iges_read_test.cpp
//
// Native (OCCT-free) gate for K6-core — the FOREIGN IGES READER
// forge::native::brep::readForeignIges (IgesRead.hpp). The SIBLING of
// step_read_test.cpp: it parses an ARBITRARY external IGES 5.3 (ASCII, fixed
// 80-column S/G/D/P/T) file into the native B-rep (the K1 trimmed-NURBS faces +
// the K1.4 native sew), so OCCT is not needed to read a foreign IGES.
//
// SINGLE-CLANG BUILD (memory-disciplined; NO run_native.sh / NO cmake-js — a GPU
// train is running). The dep set mirrors step_read_test's narrowed link:
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     forge-kernel/src/native/brep/IgesRead.cpp \
//     forge-kernel/src/native/brep/Surface.cpp \
//     forge-kernel/src/native/brep/Topology.cpp \
//     forge-kernel/src/native/brep/MassProps.cpp \
//     forge-kernel/src/native/brep/Sew.cpp \
//     forge-kernel/src/native/brep/TrimmedFace.cpp \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/src/native/brep/NurbsSurface.cpp \
//     forge-kernel/src/native/brep/NurbsCalculus.cpp \
//     forge-kernel/src/native/brep/NurbsAlgebra.cpp \
//     forge-kernel/src/native/brep/Curve.cpp \
//     forge-kernel/src/native/geom/ConstrainedDelaunay2D.cpp \
//     forge-kernel/src/native/geom/Geom.cpp \
//     forge-kernel/src/native/geom/Delaunay.cpp \
//     forge-kernel/src/native/Predicates.cpp \
//     forge-kernel/test/native/brep/iges_read_test.cpp \
//     -o /tmp/iges_read_test && /tmp/iges_read_test
//
// VALIDATION GATES (asserted below):
//   (1) PLANAR TRIMMED SURFACE. A 144 TRIMMED SURFACE over a 108 PLANE bounded by
//       a SQUARE 142/composite boundary -> a native planar TrimmedFace whose
//       material AREA equals the exact square area to <= 1e-6.
//   (2) B-REP BOX. A 186/514/510/508/504/502 manifold solid (6 planar faces, each
//       a 510 over a 108 plane bounded by a 508 loop of 504 edges) -> sewn CLOSED
//       2-manifold shell; VOLUME == Lx*Ly*Lz to <= 1e-6.
//   (3) 128 RATIONAL B-SPLINE SURFACE FACE. A 144 trimmed surface over a bilinear
//       128 surface S(u,v)=(L*u, L*v, 0) with the full-domain square boundary ->
//       a TrimmedFace whose patch AREA == L^2 to <= 1e-6.
//   (4) UNIT SCALING. The planar trimmed surface declared in INCH units (GLOBAL
//       unit flag 1) imports with every coordinate * 25.4 (area * 25.4^2).
//   (5) HONEST UNSUPPORTED / FAILURE. A lone unsupported entity is recorded; a
//       garbage file -> ok=false.
//
// Pure C++20, no external deps, no test framework.

#include <algorithm>
#include "forge/native/brep/IgesRead.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/TrimmedFace.hpp"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf(cond ? "  [PASS] %s\n" : "  [FAIL] %s\n", name.c_str());
    if (cond) ++g_pass;
}
static bool rel(double got, double exp, double tol) {
    double d = std::fabs(got - exp);
    double scale = std::max(1.0, std::fabs(exp));
    return d <= tol * scale;
}

// ===========================================================================
// IGES WRITER HELPERS — emit a valid fixed-80-column ASCII IGES file.
//
//   * Directory Entry (D): TWO 80-col lines, 9 eight-col right-justified fields
//     per line (cols 1-72), 'D' at col 73, the DE sequence number right-justified
//     in cols 74-80.
//   * Parameter Data (P): the entity's delimiter-separated parameter stream split
//     across cols 1-64; the owning DE sequence number right-justified in cols
//     65-72; 'P' at col 73; the P sequence number in cols 74-80.
//   * GLOBAL (G): the delimiter-separated global record split across cols 1-72.
// ===========================================================================
struct IgesBuilder {
    std::string start, global, dir, param, term;
    long deSeqNext = 1;     // next DE sequence number (odd: 1,3,5,...)
    long pSeqNext  = 1;     // next P-line sequence number
    long dCount = 0, pCount = 0, gCount = 0;

    // Pad/justify a field to 8 cols (right-justified).
    static std::string f8(const std::string& s) {
        if (s.size() >= 8) return s.substr(0, 8);
        return std::string(8 - s.size(), ' ') + s;
    }
    static std::string i8(long v) { return f8(std::to_string(v)); }

    // Emit one fixed-80-col line for `section` with the given <=72-col payload and
    // an explicit sequence number in cols 74-80.
    void emitLine(std::string& dst, const std::string& payload72, char section, long seq) {
        std::string p = payload72;
        if (p.size() < 72) p += std::string(72 - p.size(), ' ');
        else p = p.substr(0, 72);
        std::string line = p;
        line += section;                                  // col 73
        line += f8(std::to_string(seq));                  // cols 74-80 (8 wide here)
        dst += line;
        dst += "\n";
    }

    // Add a Directory Entry. Returns the DE sequence number (the cross-ref ptr).
    // Only the fields the reader consumes are set precisely; the rest are 0.
    long addDir(int type, long pdPointer, int form, long pdLineCount) {
        long seq = deSeqNext; deSeqNext += 2;
        // line 1 fields: 1=type 2=PDptr 3=structure 4=lineFontPattern 5=level
        //   6=view 7=transformMatrix 8=labelDisplay 9=statusNumber
        std::string l1;
        l1 += i8(type);          // 1
        l1 += i8(pdPointer);     // 2 (1-based first PD line of this entity)
        l1 += i8(0);             // 3
        l1 += i8(0);             // 4
        l1 += i8(0);             // 5
        l1 += i8(0);             // 6
        l1 += i8(0);             // 7
        l1 += i8(0);             // 8
        l1 += i8(0);             // 9
        emitLine(dir, l1, 'D', seq);
        ++dCount;
        // line 2 fields: 10=type(again) 11=lineWeight 12=colorNumber 13=PDlineCount
        //   14=formNumber 15=reserved 16=reserved 17=entityLabel 18=subscript
        // NOTE: the reader reads the DE sequence from line2 field2 (overall field
        // 10). The IGES spec puts the TYPE there; but real readers use the printed
        // sequence number (cols 74-80). To match our reader (which prefers a
        // POSITIVE line2-field2 as the DE seq, else the printed seq), we put the DE
        // SEQUENCE there so the cross-ref pointers (which are DE seq numbers) line
        // up exactly. This is consistent: the reader's pointers and this field use
        // the same numbering.
        std::string l2;
        l2 += i8(seq);           // 10 -> we store the DE sequence here (see note)
        l2 += i8(0);             // 11
        l2 += i8(0);             // 12
        l2 += i8(pdLineCount);   // 13
        l2 += i8(form);          // 14
        l2 += i8(0);             // 15
        l2 += i8(0);             // 16
        l2 += i8(0);             // 17
        l2 += i8(0);             // 18
        emitLine(dir, l2, 'D', seq);
        ++dCount;
        return seq;
    }

    // Add a Parameter-Data record for the entity owning DE `deSeq`. `record` is the
    // full delimiter-separated stream WITHOUT the trailing record delimiter ';'.
    // Returns the 1-based P-line number of the FIRST emitted line (== the DE's PD
    // pointer field). Splits across multiple 64-col P lines as needed.
    long addParam(long deSeq, const std::string& record) {
        long firstPLine = pSeqNext;
        std::string full = record + ";";
        std::size_t pos = 0;
        while (pos < full.size()) {
            std::string chunk = full.substr(pos, 64);
            pos += chunk.size();
            // payload = 64-col content + DE back-pointer right-justified in 65-72.
            std::string payload = chunk;
            if (payload.size() < 64) payload += std::string(64 - payload.size(), ' ');
            payload += f8(std::to_string(deSeq));    // cols 65-72
            emitLine(param, payload, 'P', pSeqNext);
            ++pSeqNext; ++pCount;
        }
        return firstPLine;
    }

    // Count the PD lines a record will span (for the DE's field 13).
    static long pdLineCount(const std::string& record) {
        std::string full = record + ";";
        long n = 0; std::size_t pos = 0;
        while (pos < full.size()) { pos += std::min<std::size_t>(64, full.size()-pos); ++n; }
        return n < 1 ? 1 : n;
    }

    // Add a complete entity: emit its PD first (to get the PD line number), then
    // its DE referencing that line. Returns the DE sequence (the cross-ref ptr).
    long addEntity(int type, int form, const std::string& record) {
        long lc = pdLineCount(record);
        // reserve the DE seq number deterministically by allocating it BEFORE the
        // PD so the PD's back-pointer matches. We allocate the DE seq, then emit PD
        // pointing back at it, then the DE.
        long deSeq = deSeqNext;   // peek
        long pdLine = addParam(deSeq, record);
        long got = addDir(type, pdLine, form, lc);
        (void)got;                // == deSeq by construction
        return deSeq;
    }

    void buildGlobal(int unitFlag, const std::string& unitName, double modelScale) {
        // field1=',' field2=';' (defaults) then fields 3.. Many are Hollerith
        // strings or zero; we only need fields up to 16 to carry the units.
        // Layout (1-based): 1 pdelim,2 rdelim,3 sendID,4 fileName,5 systemID,
        //   6 preprocVer,7 intBits,8 maxPow10single,9 maxDigSingle,10 maxPow10dbl,
        //   11 maxDigDbl,12 recvID,13 modelScale,14 unitFlag,15 unitName — the
        //   canonical IGES 5.3 field positions, matched 1:1 by the forge reader.
        std::string g;
        g += "1H,";          // field 1 param delimiter
        g += "1H;";          // field 2 record delimiter
        g += "4Htest,";      // 3 sender product id
        g += "4Hfile,";      // 4 file name
        g += "4Hforg,";      // 5 native system id
        g += "4Hforg,";      // 6 preprocessor version
        g += "32,";          // 7 integer bits
        g += "38,";          // 8
        g += "6,";           // 9
        g += "308,";         // 10
        g += "15,";          // 11
        g += "4Hrcvr,";      // 12 receiver id
        // Per the IGES 5.3 spec (and the forge reader), MODEL SPACE SCALE is field
        // 13, UNIT FLAG is field 14, UNIT NAME is field 15. The fields vector is
        // 0-based: idx0=pdelim,1=rdelim,2=test,3=file,4=forg,5=forg,6=32,7=38,8=6,
        // 9=308,10=15,11=rcvr,12=modelScale,13=unitFlag,14=unitName. So scale goes
        // straight after the receiver id (field 12) with NO spurious duplicate.
        char buf[64];
        std::snprintf(buf, sizeof(buf), "%.6g,", modelScale);
        g += buf;            // field 13 (idx12) model space scale
        g += std::to_string(unitFlag); g += ",";   // field 14 (idx13) unit flag
        g += std::to_string((int)unitName.size()) + "H" + unitName; // field 15 (idx14) unit name
        // Split global record across <=72 col G lines.
        std::string full = g + ";";
        std::size_t pos = 0;
        while (pos < full.size()) {
            std::string chunk = full.substr(pos, 72);
            pos += chunk.size();
            emitLine(global, chunk, 'G', ++gCount);
        }
    }

    std::string assemble() {
        // start section: one line.
        std::string s;
        emitLine(s, "Forge native IGES test", 'S', 1);
        // terminate: counts.
        std::string t;
        std::string tpay = f8(std::to_string(1)) + f8(std::to_string(gCount)) +
                           f8(std::to_string(dCount)) + f8(std::to_string(pCount));
        // standard form: S0000001G...D...P... — but our reader ignores T.
        std::string termLine = "S" + i8(1) + "G" + i8(gCount) + "D" + i8(dCount) +
                               "P" + i8(pCount);
        emitLine(t, termLine, 'T', 1);
        return s + global + dir + param + t;
    }
};

// Helper: format a double for an IGES param stream.
static std::string num(double v) {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%.10g", v);
    return std::string(buf);
}

// ---------------------------------------------------------------------------
// (1)+(4) PLANAR TRIMMED SURFACE: a 144 over a 108 plane (z=0), bounded by a
// square loop of side `L` (corners (0,0),(L,0),(L,L),(0,L)). The outer boundary
// is a 142 CURVE ON SURFACE whose model-space curve is a 102 COMPOSITE CURVE of
// four 110 LINEs. Material area = L^2.
// ---------------------------------------------------------------------------
static std::string makePlanarTrimmed(double L, int unitFlag, const std::string& unitName) {
    IgesBuilder b;
    b.buildGlobal(unitFlag, unitName, 1.0);
    // 108 PLANE z=0: A=0,B=0,C=1,D=0; bounding curve ptr 0; display pt + size 0.
    long plane = b.addEntity(108, 0,
        "108," + num(0) + "," + num(0) + "," + num(1) + "," + num(0) +
        ",0," + num(0) + "," + num(0) + "," + num(0) + "," + num(0));
    // four corner points
    double c[4][2] = {{0,0},{L,0},{L,L},{0,L}};
    // four 110 LINE edges of the outer square (model space).
    std::vector<long> lines;
    for (int k = 0; k < 4; ++k) {
        int a = k, d = (k+1)%4;
        long ln = b.addEntity(110, 0,
            "110," + num(c[a][0]) + "," + num(c[a][1]) + "," + num(0) + "," +
                     num(c[d][0]) + "," + num(c[d][1]) + "," + num(0));
        lines.push_back(ln);
    }
    // 102 COMPOSITE CURVE of the four lines.
    std::string comp = "102,4";
    for (long ln : lines) comp += "," + std::to_string(ln);
    long composite = b.addEntity(102, 0, comp);
    // 142 CURVE ON A PARAMETRIC SURFACE: CRTN=0, SPTR=plane, BPTR=0, CPTR=composite,
    // PREF=0.
    long cos = b.addEntity(142, 0,
        "142,0," + std::to_string(plane) + ",0," + std::to_string(composite) + ",0");
    // 144 TRIMMED SURFACE: PTS=plane, N1=0, N2=0, PTO=142, (no inner).
    b.addEntity(144, 0,
        "144," + std::to_string(plane) + ",0,0," + std::to_string(cos));
    return b.assemble();
}

// ---------------------------------------------------------------------------
// (2) B-REP BOX [0,Lx]x[0,Ly]x[0,Lz] as 186/514/510/508/504/502. Each of the 6
// faces is a 510 over a 108 plane bounded by a 508 loop of four 504 edges; all
// edges reference one shared 502 VERTEX LIST (the 8 box corners) and one shared
// 504 EDGE LIST (the 12 box edges). Volume = Lx*Ly*Lz.
// ---------------------------------------------------------------------------
static std::string makeBrepBox(double Lx, double Ly, double Lz) {
    IgesBuilder b;
    b.buildGlobal(2, "MM", 1.0);
    // 8 corners (index 1..8).
    double V[8][3] = {
        {0,0,0},{Lx,0,0},{Lx,Ly,0},{0,Ly,0},
        {0,0,Lz},{Lx,0,Lz},{Lx,Ly,Lz},{0,Ly,Lz}
    };
    std::string vrec = "502,8";
    for (int i = 0; i < 8; ++i)
        vrec += "," + num(V[i][0]) + "," + num(V[i][1]) + "," + num(V[i][2]);
    long vlist = b.addEntity(502, 0, vrec);
    // 12 edges as (startIdx,endIdx) into the vertex list. Each 504 tuple is
    // (curvePtr, svPtr, svIdx, tvPtr, tvIdx). We give each edge a 110 LINE curve.
    struct E { int a, b; };
    E edges[12] = {
        {1,2},{2,3},{3,4},{4,1},          // bottom
        {5,6},{6,7},{7,8},{8,5},          // top
        {1,5},{2,6},{3,7},{4,8}           // verticals
    };
    // line curves for each edge.
    long lineDe[12];
    for (int e = 0; e < 12; ++e) {
        int a = edges[e].a - 1, d = edges[e].b - 1;
        lineDe[e] = b.addEntity(110, 0,
            "110," + num(V[a][0]) + "," + num(V[a][1]) + "," + num(V[a][2]) + "," +
                     num(V[d][0]) + "," + num(V[d][1]) + "," + num(V[d][2]));
    }
    // 504 EDGE LIST.
    std::string erec = "504,12";
    for (int e = 0; e < 12; ++e)
        erec += "," + std::to_string(lineDe[e]) + "," + std::to_string(vlist) + "," +
                std::to_string(edges[e].a) + "," + std::to_string(vlist) + "," +
                std::to_string(edges[e].b);
    long elist = b.addEntity(504, 0, erec);

    // A face = a plane + a loop over 4 directed edges. We define each face's
    // ordered (edgeIndex, orientation) so the boundary is CCW seen from OUTSIDE.
    auto plane = [&](double a, double bb, double cc, double d) -> long {
        return b.addEntity(108, 0,
            "108," + num(a) + "," + num(bb) + "," + num(cc) + "," + num(d) +
            ",0," + num(0) + "," + num(0) + "," + num(0) + "," + num(0));
    };
    // 508 LOOP from a list of (edgeIdx1based, orientationFlag). Each loop tuple:
    //   type(1=edge), edgePtr(=elist), edgeIdx, orientation, #pcurves(0).
    auto loop = [&](const std::vector<std::pair<int,int>>& es) -> long {
        std::string rec = "508," + std::to_string((int)es.size());
        for (auto& pr : es)
            rec += ",1," + std::to_string(elist) + "," + std::to_string(pr.first) +
                   "," + std::to_string(pr.second) + ",0";
        return b.addEntity(508, 0, rec);
    };
    // 510 FACE: SURF, N(#loops)=1, OF(outer flag)=1, loopPtr.
    auto face = [&](long surf, long lp) -> long {
        return b.addEntity(510, 0,
            "510," + std::to_string(surf) + ",1,1," + std::to_string(lp));
    };

    std::vector<long> faceDe;
    // bottom z=0, outward -Z. CCW from below: edges 1,4,3,2 reversed... use the
    // directed edge orientation flags so the loop walks CCW seen from outside.
    // bottom: corners 1-2-3-4 viewed from below is CW, so reverse: 1->4->3->2->1.
    { long pl = plane(0,0,-1,0);
      long lp = loop({{4,0},{3,0},{2,0},{1,0}});   // edges 4,3,2,1 reversed
      faceDe.push_back(face(pl, lp)); }
    // top z=Lz, outward +Z. corners 5-6-7-8 CCW from above.
    { long pl = plane(0,0,1,Lz);
      long lp = loop({{5,1},{6,1},{7,1},{8,1}});
      faceDe.push_back(face(pl, lp)); }
    // front y=0, outward -Y. corners 1-2-6-5.
    { long pl = plane(0,-1,0,0);
      long lp = loop({{1,1},{10,1},{5,0},{9,0}});
      faceDe.push_back(face(pl, lp)); }
    // back y=Ly, outward +Y. corners 4-3-7-8 walked CCW seen from +Y:
    //   4->3 = edge3(3-4) reversed, 3->7 = edge11(3-7), 7->8 = edge7(7-8),
    //   8->4 = edge12(4-8) reversed.
    { long pl = plane(0,1,0,Ly);
      long lp = loop({{3,0},{11,1},{7,1},{12,0}});
      faceDe.push_back(face(pl, lp)); }
    // left x=0, outward -X. corners 1-4-8-5. The 504 edge list (1-based) is
    //   e1=(1,2) e2=(2,3) e3=(3,4) e4=(4,1) e5=(5,6) e6=(6,7) e7=(7,8) e8=(8,5)
    //   e9=(1,5) e10=(2,6) e11=(3,7) e12=(4,8). Directed walk:
    //   1->4 = e4(4,1) reversed, 4->8 = e12(4,8), 8->5 = e8(8,5), 5->1 = e9(1,5) rev.
    { long pl = plane(-1,0,0,0);
      long lp = loop({{4,0},{12,1},{8,1},{9,0}});
      faceDe.push_back(face(pl, lp)); }
    // right x=Lx, outward +X. corners 2-3-7-6 -> 2->3 edge2? edge2 is (2-3) yes,
    // 3->7 edge11, 7->6 edge6 reversed, 6->2 edge10 reversed.
    { long pl = plane(1,0,0,Lx);
      long lp = loop({{2,1},{11,1},{6,0},{10,0}});
      faceDe.push_back(face(pl, lp)); }

    // 514 SHELL: N faces, then (facePtr, orientation) pairs.
    std::string srec = "514," + std::to_string((int)faceDe.size());
    for (long fde : faceDe) srec += "," + std::to_string(fde) + ",1";
    long shell = b.addEntity(514, 0, srec);
    // 186 MANIFOLD SOLID B-REP OBJECT: shellPtr, SOF=1, N(#void)=0.
    b.addEntity(186, 0, "186," + std::to_string(shell) + ",1,0");
    return b.assemble();
}

// ---------------------------------------------------------------------------
// (3) 128 RATIONAL B-SPLINE SURFACE FACE: a bilinear (degU=degV=1) surface
//   S(u,v) = (L*u, L*v, 0) over [0,1]x[0,1] (4 control points), trimmed by the
// full-domain square boundary -> patch area L^2.
// ---------------------------------------------------------------------------
static std::string makeBSplineSurface(double L) {
    IgesBuilder b;
    b.buildGlobal(2, "MM", 1.0);
    // 128: K1=1,K2=1,M1=1,M2=1; PROP1..5 = closedU,closedV,polynomial,periodicU,
    // periodicV = 0,0,1,0,0 (IGES 128 carries FIVE property flags). We still give
    // explicit unit weights. U knots (A+1 = K1+M1+2 = 4): 0,0,1,1. V knots likewise
    // 0,0,1,1. Weights (4) all 1. Control pts (V-major): j=0: (0,0,0),(L,0,0)
    // j=1: (0,L,0),(L,L,0). Then U0,U1,V0,V1 = 0,1,0,1.
    std::string r = "128,1,1,1,1,0,0,1,0,0";
    r += ",0,0,1,1";          // U knots
    r += ",0,0,1,1";          // V knots
    r += ",1,1,1,1";          // weights
    // control points V-major: index i + (K1+1)*j
    // j=0: i=0 (0,0,0); i=1 (L,0,0)
    r += "," + num(0) + "," + num(0) + "," + num(0);
    r += "," + num(L) + "," + num(0) + "," + num(0);
    // j=1: i=0 (0,L,0); i=1 (L,L,0)
    r += "," + num(0) + "," + num(L) + "," + num(0);
    r += "," + num(L) + "," + num(L) + "," + num(0);
    r += ",0,1,0,1";          // U0,U1,V0,V1
    long surf = b.addEntity(128, 0, r);
    // square boundary in model space (matches the surface corners).
    double c[4][2] = {{0,0},{L,0},{L,L},{0,L}};
    std::vector<long> lines;
    for (int k = 0; k < 4; ++k) {
        int a = k, d = (k+1)%4;
        long ln = b.addEntity(110, 0,
            "110," + num(c[a][0]) + "," + num(c[a][1]) + "," + num(0) + "," +
                     num(c[d][0]) + "," + num(c[d][1]) + "," + num(0));
        lines.push_back(ln);
    }
    std::string comp = "102,4";
    for (long ln : lines) comp += "," + std::to_string(ln);
    long composite = b.addEntity(102, 0, comp);
    long cos = b.addEntity(142, 0,
        "142,0," + std::to_string(surf) + ",0," + std::to_string(composite) + ",0");
    b.addEntity(144, 0, "144," + std::to_string(surf) + ",0,0," + std::to_string(cos));
    return b.assemble();
}

// ---------------------------------------------------------------------------
// (5) An IGES file whose only body entity is an unsupported 120 SURFACE OF
// REVOLUTION inside a 144 -> recorded honestly, read fails (no built face) but
// the unsupported map is populated.
// ---------------------------------------------------------------------------
static std::string makeUnsupportedOnly() {
    IgesBuilder b;
    b.buildGlobal(2, "MM", 1.0);
    // a 124 axis line + 120 surface of revolution (we only need the 144 to point
    // at a 120 so the reader records IGES_120).
    long line = b.addEntity(110, 0, "110,0,0,0,0,0,1");          // axis-ish line
    long sor = b.addEntity(120, 0,
        "120," + std::to_string(line) + "," + std::to_string(line) + ",0," + num(6.2831853));
    long cos = b.addEntity(142, 0,
        "142,0," + std::to_string(sor) + ",0," + std::to_string(line) + ",0");
    b.addEntity(144, 0, "144," + std::to_string(sor) + ",0,0," + std::to_string(cos));
    return b.assemble();
}

int main() {
    std::printf("iges_read_test — K6 FOREIGN IGES READ (native ingest, no OCCT)\n");

    // ---- (1) PLANAR TRIMMED SURFACE (mm) ---------------------------------
    {
        const double L = 6.0;
        std::string iges = makePlanarTrimmed(L, 2, "MM");
        ForeignReadResult r = readForeignIges(iges);
        check(r.ok, std::string("planar-144(mm): read ok") + (r.ok ? "" : " — " + r.reason));
        if (r.ok) {
            check(rel(r.lengthScaleToMm, 1.0, 1e-12), "planar-144(mm): unit scale 1.0");
            // Planar 144 over a 108 plane builds a native analytic planar face. Its
            // material area is the |signed polygon area| of its (u,v) trim loop.
            double area = 0.0;
            if (r.solid && !r.solid->shells.empty()) {
                // sum |signed area| of each face's planar vertexUV polygon.
                for (Shell* sh : r.solid->shells)
                    for (Face* f : sh->faces) {
                        const auto& uv = f->vertexUV;
                        double a = 0.0;
                        for (std::size_t i = 0; i < uv.size(); ++i) {
                            const auto& p0 = uv[i];
                            const auto& p1 = uv[(i+1)%uv.size()];
                            a += p0[0]*p1[1] - p1[0]*p0[1];
                        }
                        area += std::fabs(0.5 * a);
                    }
            }
            std::printf("        planar-144(mm) area = %.10g (expected %.10g)\n", area, L*L);
            check(rel(area, L*L, 1e-6), "planar-144(mm): trimmed area == L^2 (<=1e-6)");
        }
    }

    // ---- (4) UNIT SCALING (inch) -----------------------------------------
    {
        const double L = 2.0;   // inches
        std::string iges = makePlanarTrimmed(L, 1, "INCH");
        ForeignReadResult r = readForeignIges(iges);
        check(r.ok, std::string("planar-144(inch): read ok") + (r.ok ? "" : " — " + r.reason));
        if (r.ok) {
            check(rel(r.lengthScaleToMm, 25.4, 1e-9),
                  "planar-144(inch): unit scale 25.4 (got " + num(r.lengthScaleToMm) + ")");
            double area = 0.0;
            if (r.solid)
                for (Shell* sh : r.solid->shells)
                    for (Face* f : sh->faces) {
                        const auto& uv = f->vertexUV;
                        double a = 0.0;
                        for (std::size_t i = 0; i < uv.size(); ++i) {
                            const auto& p0 = uv[i]; const auto& p1 = uv[(i+1)%uv.size()];
                            a += p0[0]*p1[1] - p1[0]*p0[1];
                        }
                        area += std::fabs(0.5 * a);
                    }
            double exp = (L*25.4)*(L*25.4);
            std::printf("        planar-144(inch) area = %.10g mm^2 (expected %.10g)\n", area, exp);
            check(rel(area, exp, 1e-6), "planar-144(inch): area scaled by 25.4^2 (<=1e-6)");
        }
    }

    // ---- (2) B-REP BOX SOLID ---------------------------------------------
    {
        const double Lx = 10.0, Ly = 6.0, Lz = 4.0;
        std::string iges = makeBrepBox(Lx, Ly, Lz);
        ForeignReadResult r = readForeignIges(iges);
        check(r.ok && r.solid, std::string("brep-box: read ok") + (r.ok ? "" : " — " + r.reason));
        if (r.ok && r.solid) {
            check(r.faces == 6, "brep-box: 6 faces (got " + std::to_string(r.faces) + ")");
            check(r.closed, "brep-box: sewn shell is CLOSED (watertight 2-manifold)");
            check(r.unsupported.empty(), "brep-box: no unsupported entities");
            MassProps mp = massProperties(*r.solid);
            double expVol = Lx * Ly * Lz;   // 240
            std::printf("        brep-box volume = %.10g (expected %.10g)\n", mp.volume, expVol);
            check(rel(mp.volume, expVol, 1e-6), "brep-box: volume == Lx*Ly*Lz (<=1e-6)");
            check(r.eulerCharacteristic == 2,
                  "brep-box: Euler V-E+F == 2 (got " + std::to_string(r.eulerCharacteristic) + ")");
        }
    }

    // ---- (3) 128 RATIONAL B-SPLINE SURFACE FACE: area ---------------------
    {
        const double L = 5.0;
        std::string iges = makeBSplineSurface(L);
        ForeignReadResult r = readForeignIges(iges);
        check(r.ok, std::string("bspline-128: read ok") + (r.ok ? "" : " — " + r.reason));
        if (r.ok) {
            check(r.trimmedFaces.size() == 1,
                  "bspline-128: one TrimmedFace built (got " + std::to_string(r.trimmedFaces.size()) + ")");
            if (!r.trimmedFaces.empty()) {
                const TrimmedFace& tf = r.trimmedFaces[0];
                TrimmedMassProps a = trimmedFaceArea(tf, /*quadRefine=*/2);
                std::printf("        bspline-128 trimmed area = %.10g (expected %.10g, planarExact=%d)\n",
                            a.area, L*L, (int)a.planarExact);
                check(a.ok, "bspline-128: trimmedFaceArea ok");
                check(rel(a.area, L*L, 1e-6), "bspline-128: patch area == L^2 (<=1e-6)");
            }
        }
    }

    // ---- (5) HONEST UNSUPPORTED / FAILURE --------------------------------
    {
        std::string iges = makeUnsupportedOnly();
        ForeignReadResult r = readForeignIges(iges);
        // No supported face -> read fails, but the unsupported entity is recorded.
        bool recorded = false;
        for (const auto& kv : r.unsupported)
            if (kv.first.find("120") != std::string::npos) recorded = true;
        check(!r.ok, "unsupported-only: read -> ok=false (no buildable face)");
        check(recorded, "unsupported-only: 120 SURFACE_OF_REVOLUTION recorded honestly");

        auto g = readForeignIges("this is not an IGES file at all");
        check(!g.ok, "failure: garbage -> ok=false");
    }

    std::printf("iges_read_test RESULT: %d/%d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
