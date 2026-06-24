// forge/native/brep/IgesWrite.cpp
//
// Implementation of the NATIVE IGES writer (IgesWrite.hpp). Pure C++20, standard
// library + forge native headers only. No OCCT, no WASM. Round-trip INVERSE of
// IgesRead.cpp: it emits the same 108/128/110 geometry + 502/504/508/510/514/186
// topology zoo the reader consumes, in the fixed-80-column ASCII IGES 5.3 grammar.
//
// FIXED-COLUMN LAYOUT (exactly what IgesRead.cpp parses):
//   * Each line is 80 columns; column 73 (index 72) is the SECTION letter
//     (S/G/D/P/T); columns 74-80 carry the line's sequence number.
//   * DIRECTORY ENTRY: two 80-col lines per entity (20 eight-column fields). We
//     write field 1 = entity type, field 2 = the 1-based PD line where the entity's
//     parameter record starts; on line 2, field 2 (overall field 10) = this DE's
//     ODD sequence number, field 6 (overall field 14) = form number.
//   * PARAMETER DATA: a delimiter-separated stream (',' / ';') of the entity's
//     fields, the FIRST being the entity type number (repeated, as the spec wants).
//     The payload occupies cols 1-64; cols 66-72 back-reference the owning DE's
//     ODD sequence number (the DE<->PD pairing). Long records wrap across P lines.
//
// HONEST SCOPE: face base surfaces are PLANE (108) + NURBS (128); a quadric face
// -> ok=false (the IGES reader has no 510 quadric base surface). 0 fakes.

#include "forge/native/brep/IgesWrite.hpp"

#include "forge/native/brep/Surface.hpp"   // Surface / NurbsSurface / vec helpers
#include "forge/native/brep/Nurbs.hpp"

#include <cstdint>
#include <cstdio>
#include <string>
#include <unordered_map>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

IgesWriteResult writeFail(const std::string& reason) {
    IgesWriteResult r; r.ok = false; r.reason = reason; return r;
}

inline Vec3 PV(const Point3& p) { return Vec3{p.x, p.y, p.z}; }

// Format a double with enough precision for an exact round-trip. IGES is ASCII;
// %.17g is the shortest round-trippable double form (strtod inverts it exactly).
std::string num(double v) {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%.17g", v);
    return std::string(buf);
}

// ---------------------------------------------------------------------------
// An entity staged for emission: its type number, its parameter-token list (the
// FIRST token must be the type number), and its form number. The DE sequence
// number is assigned by position when the entities are laid out.
// ---------------------------------------------------------------------------
struct Entity {
    int                      type = 0;
    int                      form = 0;
    std::vector<std::string> params;   // params[0] == std::to_string(type)
};

// The staging buffer + a stable handle (1-based index) for cross-references. The
// DE SEQUENCE NUMBER of entity i is (2*i + 1) — the odd numbering the reader uses
// (each DE occupies two lines, so DE k starts at line 2k+1 -> odd seq 2i+1).
struct Builder {
    std::vector<Entity> ents;

    // Add an entity; return its 0-based index (handle).
    std::size_t add(int type, int form, std::vector<std::string> params) {
        Entity e; e.type = type; e.form = form; e.params = std::move(params);
        ents.push_back(std::move(e));
        return ents.size() - 1;
    }
    // DE sequence number (1-based, ODD) of the entity at 0-based index `h`.
    long deSeq(std::size_t h) const { return static_cast<long>(2 * h + 1); }
};

} // namespace

// ===========================================================================
// writeIges
// ===========================================================================
IgesWriteResult writeIges(const Solid& solid, const std::string& name) {
    if (solid.shells.empty())
        return writeFail("writeIges: solid has no shells");

    Builder B;

    // ---- 1) Collect the distinct vertices + edges over every face loop -------
    // The reader's manifold path keys edges by a 504 EDGE LIST + 502 VERTEX LIST;
    // we mirror that: one 502 entry per topological Vertex, one 504 entry per Edge.
    std::unordered_map<const Vertex*, long> vIndex;   // Vertex* -> 1-based vert idx
    std::vector<const Vertex*>              verts;
    std::unordered_map<const Edge*, long>   eIndex;   // Edge* -> 1-based edge idx
    std::vector<const Edge*>                edges;

    auto vIdxOf = [&](const Vertex* v) -> long {
        auto it = vIndex.find(v);
        if (it != vIndex.end()) return it->second;
        verts.push_back(v);
        long idx = static_cast<long>(verts.size());   // 1-based
        vIndex.emplace(v, idx);
        return idx;
    };
    auto eIdxOf = [&](const Edge* e) -> long {
        auto it = eIndex.find(e);
        if (it != eIndex.end()) return it->second;
        edges.push_back(e);
        long idx = static_cast<long>(edges.size());   // 1-based
        eIndex.emplace(e, idx);
        return idx;
    };

    // Walk every face's outer + inner loops, registering vertices and edges. Also
    // validate the surface kinds up front (fail honestly before emitting anything).
    auto registerLoop = [&](const Loop* lp) -> bool {
        if (!lp || !lp->first) return false;
        const Coedge* start = lp->first;
        const Coedge* ce = start;
        std::size_t guard = 0;
        const std::size_t maxRing = lp->coedgeCount + 4;
        do {
            if (!ce || !ce->edge) return false;
            vIdxOf(ce->edge->start);
            vIdxOf(ce->edge->end);
            eIdxOf(ce->edge);
            ce = ce->next;
            if (++guard > maxRing) return false;
        } while (ce && ce != start);
        return true;
    };

    std::vector<const Face*> faces;
    for (const Shell* sh : solid.shells) {
        if (!sh) continue;
        for (const Face* f : sh->faces) {
            if (!f) continue;
            if (!f->surface)
                return writeFail("writeIges: face has no analytic surface");
            const SurfaceKind k = f->surface->kind;
            if (k != SurfaceKind::Plane && k != SurfaceKind::Nurbs)
                return writeFail("writeIges: quadric face surface is not exportable "
                                 "to IGES (only PLANE/NURBS base surfaces); use the "
                                 "STEP analytic writer for quadrics");
            if (!registerLoop(f->outerLoop))
                return writeFail("writeIges: face outer loop is broken / non-closing");
            for (const Loop* hole : f->innerLoops)
                if (!registerLoop(hole))
                    return writeFail("writeIges: face inner (hole) loop is broken");
            faces.push_back(f);
        }
    }
    if (faces.empty()) return writeFail("writeIges: solid produced no faces");
    if (verts.empty() || edges.empty())
        return writeFail("writeIges: solid has no edges/vertices");

    // ---- 2) 502 VERTEX LIST (all welded vertices) ----------------------------
    // PD: [0]=502 [1]=N then N (x,y,z) triples (1-based index in declaration order).
    {
        std::vector<std::string> p;
        p.push_back("502");
        p.push_back(std::to_string(verts.size()));
        for (const Vertex* v : verts) {
            p.push_back(num(v->point.x));
            p.push_back(num(v->point.y));
            p.push_back(num(v->point.z));
        }
        B.add(502, 1, std::move(p));
    }
    const std::size_t hVList = 0;   // the 502 is the FIRST entity (index 0)

    // ---- 3) 110 LINE per edge (the edge's 3D curve) --------------------------
    // 110 PD: [0]=110 [1..3]=P1 (start) [4..6]=P2 (end). One per topological Edge,
    // oriented start->end (the reader re-orients per loop coedge sense). The 504
    // edge list references this curve DE.
    std::vector<std::size_t> lineHandle(edges.size());
    for (std::size_t i = 0; i < edges.size(); ++i) {
        const Edge* e = edges[i];
        const Vec3 a = PV(e->start->point), b = PV(e->end->point);
        std::vector<std::string> p = {"110",
            num(a.x), num(a.y), num(a.z), num(b.x), num(b.y), num(b.z)};
        lineHandle[i] = B.add(110, 0, std::move(p));
    }

    // ---- 4) 504 EDGE LIST ----------------------------------------------------
    // PD: [0]=504 [1]=N then N tuples (curveDePtr, svListPtr, svIdx, tvListPtr,
    //     tvIdx). The vertex pointers are the 502 VERTEX LIST's DE sequence number;
    //     svIdx/tvIdx are 1-based indices into that list.
    const long vListSeq = B.deSeq(hVList);
    std::size_t hEList;
    {
        std::vector<std::string> p;
        p.push_back("504");
        p.push_back(std::to_string(edges.size()));
        for (std::size_t i = 0; i < edges.size(); ++i) {
            const Edge* e = edges[i];
            p.push_back(std::to_string(B.deSeq(lineHandle[i])));  // curve DE ptr
            p.push_back(std::to_string(vListSeq));                // start vtx list
            p.push_back(std::to_string(vIdxOf(e->start)));        // start vtx idx
            p.push_back(std::to_string(vListSeq));                // end vtx list
            p.push_back(std::to_string(vIdxOf(e->end)));          // end vtx idx
        }
        hEList = B.add(504, 1, std::move(p));
    }
    const long eListSeq = B.deSeq(hEList);

    // ---- 5) base surfaces (108 PLANE / 128 NURBS) per face -------------------
    // Emit one surface entity per face (in `faces` order); the 510 FACE references
    // it. A PLANE is A*x+B*y+C*z=D (normal = face axis, D = n·origin). A NURBS is
    // a 128 RATIONAL B-SPLINE SURFACE with the full control/knot/weight grid.
    std::vector<std::size_t> surfHandle(faces.size());
    for (std::size_t fi = 0; fi < faces.size(); ++fi) {
        const Surface& s = *faces[fi]->surface;
        if (s.kind == SurfaceKind::Plane) {
            // 108 PD: [0]=108 [1..4]=A,B,C,D, [5]=bounding-curve ptr (0=unbounded),
            //         [6..8]=display point, [9]=display size. The reader consumes
            //         A,B,C,D only; the rest are display hints (0).
            const Vec3 n = vnorm(s.axis);
            const double D = vdot(n, s.origin);
            std::vector<std::string> p = {"108",
                num(n.x), num(n.y), num(n.z), num(D),
                "0", num(s.origin.x), num(s.origin.y), num(s.origin.z), "0"};
            surfHandle[fi] = B.add(108, 0, std::move(p));
        } else {
            // 128 PD: [0]=128 [1]=K1 [2]=K2 [3]=M1(degU) [4]=M2(degV) [5..8]=PROP1..4
            //         then (K1+M1+2) U knots, (K2+M2+2) V knots,
            //         then (K1+1)(K2+1) weights (V-major), then the same count of
            //         xyz control points (V-major), then U0,U1,V0,V1.
            const NurbsSurface& nb = s.nurbs;
            if (!nb.valid() || nb.control.empty() || nb.control[0].empty())
                return writeFail("writeIges: NURBS face has invalid surface data");
            const long nU = static_cast<long>(nb.control.size());
            const long nV = static_cast<long>(nb.control[0].size());
            const long K1 = nU - 1, K2 = nV - 1;
            const long M1 = static_cast<long>(nb.degreeU);
            const long M2 = static_cast<long>(nb.degreeV);
            if (static_cast<long>(nb.knotsU.size()) != K1 + M1 + 2 ||
                static_cast<long>(nb.knotsV.size()) != K2 + M2 + 2)
                return writeFail("writeIges: NURBS knot vector size mismatch");
            std::vector<std::string> p;
            p.push_back("128");
            p.push_back(std::to_string(K1));
            p.push_back(std::to_string(K2));
            p.push_back(std::to_string(M1));
            p.push_back(std::to_string(M2));
            // PROP1..4: closedU, closedV, polynomial(=1 if all weights 1), periodic.
            bool allUnitW = true;
            for (const auto& row : nb.weights)
                for (double w : row) if (w != 1.0) { allUnitW = false; break; }
            p.push_back("0"); p.push_back("0");
            p.push_back(allUnitW ? "1" : "0"); p.push_back("0");
            for (double k : nb.knotsU) p.push_back(num(k));
            for (double k : nb.knotsV) p.push_back(num(k));
            // weights V-major: for j in 0..K2, for i in 0..K1.
            for (long j = 0; j <= K2; ++j)
                for (long i = 0; i <= K1; ++i)
                    p.push_back(num(nb.weights[i][j]));
            // control points V-major.
            for (long j = 0; j <= K2; ++j)
                for (long i = 0; i <= K1; ++i) {
                    const Vec3& c = nb.control[i][j];
                    p.push_back(num(c.x)); p.push_back(num(c.y)); p.push_back(num(c.z));
                }
            p.push_back(num(nb.knotsU.front())); p.push_back(num(nb.knotsU.back()));
            p.push_back(num(nb.knotsV.front())); p.push_back(num(nb.knotsV.back()));
            surfHandle[fi] = B.add(128, 0, std::move(p));
        }
    }

    // ---- 6) 508 LOOP per face boundary loop ----------------------------------
    // PD: [0]=508 [1]=N then per-edge tuples (type=1, edgeListPtr, edgeIdx,
    //     orientationFlag, #pcurves=0). type 1 = an edge from a 504 EDGE LIST. The
    //     orientation flag is 1 when the coedge runs the edge start->end (forward),
    //     0 otherwise (the reader swaps the directed endpoints on 0).
    auto emitLoop = [&](const Loop* lp) -> std::size_t {
        std::vector<const Coedge*> ring;
        const Coedge* start = lp->first;
        const Coedge* ce = start;
        do { ring.push_back(ce); ce = ce->next; } while (ce && ce != start);
        std::vector<std::string> p;
        p.push_back("508");
        p.push_back(std::to_string(ring.size()));
        for (const Coedge* c : ring) {
            p.push_back("1");                                       // type: edge
            p.push_back(std::to_string(eListSeq));                  // edge list ptr
            p.push_back(std::to_string(eIdxOf(c->edge)));           // edge index
            p.push_back(c->forward ? "1" : "0");                    // orientation
            p.push_back("0");                                       // #pcurves
        }
        return B.add(508, 1, std::move(p));
    };

    // ---- 7) 510 FACE per face ------------------------------------------------
    // PD: [0]=510 [1]=surfacePtr [2]=N(#loops) [3]=outerFlag then N loop ptrs
    //     (first = outer). The reader takes loops[0] as outer, the rest as holes.
    std::vector<std::size_t> faceHandle(faces.size());
    for (std::size_t fi = 0; fi < faces.size(); ++fi) {
        const Face* f = faces[fi];
        std::vector<std::size_t> loopHandles;
        loopHandles.push_back(emitLoop(f->outerLoop));
        for (const Loop* hole : f->innerLoops) loopHandles.push_back(emitLoop(hole));
        std::vector<std::string> p;
        p.push_back("510");
        p.push_back(std::to_string(B.deSeq(surfHandle[fi])));   // base surface ptr
        p.push_back(std::to_string(loopHandles.size()));        // loop count
        p.push_back("1");                                       // outer-loop present
        for (std::size_t lh : loopHandles)
            p.push_back(std::to_string(B.deSeq(lh)));
        faceHandle[fi] = B.add(510, 1, std::move(p));
    }

    // ---- 8) 514 SHELL --------------------------------------------------------
    // PD: [0]=514 [1]=N then N (facePtr, orientationFlag) pairs.
    std::size_t hShell;
    {
        std::vector<std::string> p;
        p.push_back("514");
        p.push_back(std::to_string(faces.size()));
        for (std::size_t fi = 0; fi < faces.size(); ++fi) {
            p.push_back(std::to_string(B.deSeq(faceHandle[fi])));   // face ptr
            p.push_back("1");                                       // orientation
        }
        hShell = B.add(514, 1, std::move(p));
    }

    // ---- 9) 186 MANIFOLD SOLID B-REP OBJECT ----------------------------------
    // PD: [0]=186 [1]=shellPtr [2]=shellOrientationFlag (no void shells).
    {
        std::vector<std::string> p = {"186",
            std::to_string(B.deSeq(hShell)), "1"};
        B.add(186, 0, std::move(p));
    }

    // =======================================================================
    // LAYOUT — emit the fixed-80-column S/G/D/P/T sections.
    // =======================================================================
    auto col80 = [](const std::string& payload, char section, long seq) -> std::string {
        std::string line = payload;
        if (line.size() < 72) line.resize(72, ' ');
        else                  line = line.substr(0, 72);
        line += section;
        char sn[16];
        std::snprintf(sn, sizeof(sn), "%7ld", seq);
        line += sn;                       // cols 74-80 (7 chars)
        return line;
    };

    std::string S, G, Dsec, Psec;
    long sSeq = 0, gSeq = 0, dSeq = 0, pSeq = 0;

    // START section: one human-readable line.
    S += col80("Forge native IGES export (forge::native::brep::writeIges).",
               'S', ++sSeq) + "\n";

    // GLOBAL section: a delimiter-separated record. Fields 1,2 = delimiters; 14 =
    // model space scale (1.0); 15 = unit flag (2 = mm); 16 = unit name. Hollerith
    // strings are <len>H<chars>. We pack the record then wrap to 72-col G lines.
    auto hol = [](const std::string& s) {
        return std::to_string(s.size()) + "H" + s;
    };
    std::string gname = name.empty() ? std::string("forge_native_solid") : name;
    // The IGES GLOBAL record is a flat list of fields f1..f25. IgesRead reads the
    // 0-based field index 13 (== 1-based f14) as MODEL SPACE SCALE, index 14 (f15)
    // as the UNIT FLAG, and index 15 (f16) as the UNIT NAME — so f1..f13 must be
    // exactly thirteen fields ahead of the scale/units triple. Emit them in order.
    std::string grec;
    grec += "1H,";                       // f1  param delim
    grec += "1H;";                       // f2  record delim
    grec += hol("forge") + ",";          // f3
    grec += hol(gname) + ",";            // f4
    grec += hol("forge::native::brep::writeIges") + ",";  // f5
    grec += hol("forge IGES 5.3") + ",";                  // f6
    grec += "32,";                       // f7
    grec += "38,";                       // f8
    grec += "6,";                        // f9
    grec += "308,";                      // f10
    grec += "15,";                       // f11
    grec += hol(gname) + ",";            // f12
    grec += "1.0,";                      // f13
    grec += "1.0,";                      // f14  MODEL SPACE SCALE  (reader idx 13)
    grec += "2,";                        // f15  UNIT FLAG = mm     (reader idx 14)
    grec += hol("MM") + ",";             // f16  UNIT NAME          (reader idx 15)
    grec += "1000,";                     // f17  max line weight grad
    grec += "1.0,";                      // f18  max line weight
    grec += hol("20260101.000000") + ",";// f19  timestamp
    grec += "1E-07,";                    // f20  min resolution
    grec += "0.0,";                      // f21  max coord
    grec += hol("forge") + ",";          // f22  author
    grec += hol("forge") + ",";          // f23  organisation
    grec += "11,";                       // f24  IGES version (5.3)
    grec += "0;";                        // f25  drafting standard + record delim
    // wrap grec into 72-col G lines.
    for (std::size_t i = 0; i < grec.size(); i += 72) {
        std::string chunk = grec.substr(i, 72);
        G += col80(chunk, 'G', ++gSeq) + "\n";
    }

    // DIRECTORY + PARAMETER sections. The PD record for entity h starts at the
    // current P line count + 1; we emit the PD lines first (to know the start
    // line), then the DE pair referencing it. To keep the two in lock-step we
    // build the PD section AND record each entity's PD start line, then build the
    // DE section in entity order.
    std::vector<long> pdStartLine(B.ents.size(), 0);   // 1-based P-line of each PD
    for (std::size_t h = 0; h < B.ents.size(); ++h) {
        const Entity& e = B.ents[h];
        const long mySeq = B.deSeq(h);
        // Join the params with ',' and terminate with ';'.
        std::string rec;
        for (std::size_t k = 0; k < e.params.size(); ++k) {
            if (k) rec += ',';
            rec += e.params[k];
        }
        rec += ';';
        pdStartLine[h] = pSeq + 1;       // first P line for this entity (1-based)
        // wrap into <=64-col content chunks; cols 66-72 carry the owning DE seq.
        for (std::size_t i = 0; i < rec.size(); i += 64) {
            std::string content = rec.substr(i, 64);
            // payload = content padded to 64, a space at 65, then the DE back-ptr.
            std::string payload = content;
            if (payload.size() < 65) payload.resize(65, ' ');
            char ptr[16];
            std::snprintf(ptr, sizeof(ptr), "%7ld", mySeq);
            payload += ptr;              // cols 66-72
            Psec += col80(payload, 'P', ++pSeq) + "\n";
        }
    }

    // DE pairs (two lines each, in entity order -> odd sequence numbers 1,3,5,...).
    auto deField8 = [](const std::string& v) -> std::string {
        std::string f = v;
        if (f.size() < 8) f = std::string(8 - f.size(), ' ') + f;  // right-justified
        else f = f.substr(0, 8);
        return f;
    };
    for (std::size_t h = 0; h < B.ents.size(); ++h) {
        const Entity& e = B.ents[h];
        const long mySeq = B.deSeq(h);
        // line 1 fields (idx 0..8): type, PDptr, structure, lineFontPattern, level,
        //   view, transform, labelDisp, statusNumber.
        std::string l1;
        l1 += deField8(std::to_string(e.type));        // f1 type
        l1 += deField8(std::to_string(pdStartLine[h]));// f2 PD pointer (1-based P line)
        l1 += deField8("0");                           // f3 structure
        l1 += deField8("0");                           // f4 line font
        l1 += deField8("0");                           // f5 level
        l1 += deField8("0");                           // f6 view
        l1 += deField8("0");                           // f7 transform matrix
        l1 += deField8("0");                           // f8 label display
        l1 += deField8("0");                           // f9 status number
        Dsec += col80(l1, 'D', ++dSeq) + "\n";
        // line 2 fields (idx 0..8): type, lineWeight, color, paramLineCount, form,
        //   reserved, reserved, entityLabel, entitySubscript. The reader reads
        //   field idx 1 (overall f10) = DE sequence number, idx 5 (overall f14) =
        //   form. We put `mySeq` in idx 1 and `form` in idx 5.
        std::string l2;
        l2 += deField8(std::to_string(e.type));        // f1 (type repeated)
        l2 += deField8(std::to_string(mySeq));         // f2 (overall f10) DE seq
        l2 += deField8("0");                           // f3 color
        l2 += deField8("0");                           // f4 param line count
        l2 += deField8(std::to_string(e.form));        // f5 (overall f14) form
        l2 += deField8("0");                           // f6
        l2 += deField8("0");                           // f7
        l2 += deField8("0");                           // f8 entity label
        l2 += deField8("0");                           // f9 entity subscript
        Dsec += col80(l2, 'D', ++dSeq) + "\n";
    }

    // TERMINATE section: S,G,D,P line counts.
    {
        char t[80];
        std::snprintf(t, sizeof(t), "S%7ldG%7ldD%7ldP%7ld",
                      sSeq, gSeq, dSeq, pSeq);
        Psec += col80(std::string(t), 'T', 1) + "\n";   // appended after P (section T)
    }

    IgesWriteResult r;
    r.ok = true;
    r.text = S + G + Dsec + Psec;
    return r;
}

} // namespace brep
} // namespace native
} // namespace forge
