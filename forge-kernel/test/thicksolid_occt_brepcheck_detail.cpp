// ─────────────────────────────────────────────────────────────────────────────
// thicksolid_occt_brepcheck_detail.cpp — WHAT KIND of invalid?
//
// "BRepCheck_Analyzer::IsValid() == false on 133/133" is a single bit, and a
// single bit cannot distinguish a tolerance nit inherited from a STEP import
// from a self-intersecting wall. The ledger argument ("there is no correct
// capability to lose") depends entirely on which of those it is, so this probe
// walks the analyzer's per-subshape RESULT LISTS and reports the actual
// BRepCheck_Status enumerators, per part and in aggregate.
//
// It also re-checks the SOURCE with the identical walk, so an enumerator that
// appears on both sides is visibly inherited rather than caused.
//
// Links NO forge source. OCCT only.
// ─────────────────────────────────────────────────────────────────────────────
#include <cstdio>
#include <cstring>
#include <cmath>
#include <string>
#include <vector>
#include <map>
#include <algorithm>
#include <unistd.h>
#include <signal.h>
#include <sys/wait.h>
#include <dirent.h>
#include <errno.h>

#include <STEPControl_Reader.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <BRep_Tool.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepCheck_Result.hxx>
#include <BRepCheck_ListOfStatus.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <Geom_Plane.hxx>
#include <gp_Pln.hxx>
#include <Standard_Failure.hxx>

static const char* stat(BRepCheck_Status s) {
    switch (s) {
        case BRepCheck_NoError: return "NoError";
        case BRepCheck_InvalidPointOnCurve: return "InvalidPointOnCurve";
        case BRepCheck_InvalidPointOnCurveOnSurface: return "InvalidPointOnCurveOnSurface";
        case BRepCheck_InvalidPointOnSurface: return "InvalidPointOnSurface";
        case BRepCheck_No3DCurve: return "No3DCurve";
        case BRepCheck_Multiple3DCurve: return "Multiple3DCurve";
        case BRepCheck_Invalid3DCurve: return "Invalid3DCurve";
        case BRepCheck_NoCurveOnSurface: return "NoCurveOnSurface";
        case BRepCheck_InvalidCurveOnSurface: return "InvalidCurveOnSurface";
        case BRepCheck_InvalidCurveOnClosedSurface: return "InvalidCurveOnClosedSurface";
        case BRepCheck_InvalidSameRangeFlag: return "InvalidSameRangeFlag";
        case BRepCheck_InvalidSameParameterFlag: return "InvalidSameParameterFlag";
        case BRepCheck_InvalidDegeneratedFlag: return "InvalidDegeneratedFlag";
        case BRepCheck_FreeEdge: return "FreeEdge";
        case BRepCheck_InvalidMultiConnexity: return "InvalidMultiConnexity";
        case BRepCheck_InvalidRange: return "InvalidRange";
        case BRepCheck_EmptyWire: return "EmptyWire";
        case BRepCheck_RedundantEdge: return "RedundantEdge";
        case BRepCheck_SelfIntersectingWire: return "SelfIntersectingWire";
        case BRepCheck_NoSurface: return "NoSurface";
        case BRepCheck_InvalidWire: return "InvalidWire";
        case BRepCheck_RedundantWire: return "RedundantWire";
        case BRepCheck_IntersectingWires: return "IntersectingWires";
        case BRepCheck_InvalidImbricationOfWires: return "InvalidImbricationOfWires";
        case BRepCheck_EmptyShell: return "EmptyShell";
        case BRepCheck_RedundantFace: return "RedundantFace";
        case BRepCheck_InvalidImbricationOfShells: return "InvalidImbricationOfShells";
        case BRepCheck_UnorientableShape: return "UnorientableShape";
        case BRepCheck_NotClosed: return "NotClosed";
        case BRepCheck_NotConnected: return "NotConnected";
        case BRepCheck_SubshapeNotInShape: return "SubshapeNotInShape";
        case BRepCheck_BadOrientation: return "BadOrientation";
        case BRepCheck_BadOrientationOfSubshape: return "BadOrientationOfSubshape";
        case BRepCheck_InvalidPolygonOnTriangulation: return "InvalidPolygonOnTriangulation";
        case BRepCheck_InvalidToleranceValue: return "InvalidToleranceValue";
        case BRepCheck_EnclosedRegion: return "EnclosedRegion";
        case BRepCheck_CheckFail: return "CheckFail";
        default: return "UNKNOWN";
    }
}

// walk every subshape type the analyzer keeps a Result for
static void walk(const BRepCheck_Analyzer& an, const TopoDS_Shape& s,
                 std::map<std::string,int>& hits, std::map<std::string,int>& parts) {
    std::map<std::string,int> local;
    const TopAbs_ShapeEnum kinds[] = {TopAbs_VERTEX, TopAbs_EDGE, TopAbs_WIRE,
                                      TopAbs_FACE, TopAbs_SHELL, TopAbs_SOLID};
    for (TopAbs_ShapeEnum k : kinds) {
        TopTools_IndexedMapOfShape m; TopExp::MapShapes(s, k, m);
        for (int i = 1; i <= m.Extent(); ++i) {
            Handle(BRepCheck_Result) r;
            try { r = an.Result(m(i)); } catch (...) { continue; }
            if (r.IsNull()) continue;
            // Status() is the subshape's OWN status list; StatusOnShape() needs a
            // valid context iterator and raises NCollection_DataMap::Iterator::Value
            // when there is no context — which is every subshape here, and which
            // silently emptied the first version of this census (0 parts reported).
            try {
                const BRepCheck_ListOfStatus& L = r->Status();
                for (BRepCheck_ListIteratorOfListOfStatus it(L); it.More(); it.Next()) {
                    if (it.Value() == BRepCheck_NoError) continue;
                    local[stat(it.Value())]++;
                }
            } catch (...) {}
            // and the in-context statuses (an edge bad only inside one face, etc.)
            try {
                for (r->InitContextIterator(); r->MoreShapeInContext(); r->NextShapeInContext()) {
                    const BRepCheck_ListOfStatus& L2 = r->StatusOnShape();
                    for (BRepCheck_ListIteratorOfListOfStatus it(L2); it.More(); it.Next()) {
                        if (it.Value() == BRepCheck_NoError) continue;
                        local["ctx:" + std::string(stat(it.Value()))]++;
                    }
                }
            } catch (...) {}
        }
    }
    // also the whole-shape result
    for (auto& kv : local) { hits[kv.first] += kv.second; parts[kv.first]++; }
}

struct Out { int status = 0; };  // 0 defer, 1 ok

int main(int argc, char** argv) {
    if (argc < 2) { std::fprintf(stderr, "usage: %s <corpus-dir>\n", argv[0]); return 2; }
    const std::string dir = argv[1];
    std::vector<std::string> files;
    DIR* d = ::opendir(dir.c_str());
    if (!d) { std::fprintf(stderr, "FATAL: %s\n", dir.c_str()); return 2; }
    while (struct dirent* e = ::readdir(d)) {
        const std::string n = e->d_name;
        if (n.size() > 5 && n.compare(n.size()-5, 5, ".step") == 0) files.push_back(n);
    }
    ::closedir(d);
    std::sort(files.begin(), files.end());

    std::map<std::string,int> resHits, resParts, srcHits, srcParts;
    int nOK = 0, nInvalid = 0;

    for (const std::string& f : files) {
        const std::string path = dir + "/" + f;
        // one child per part: a SIGSEGV in the offset engine must not end the census
        int fds[2]; if (::pipe(fds)) return 2;
        const pid_t pid = ::fork();
        if (pid == 0) {
            ::close(fds[0]);
            std::string payload;
            try {
                STEPControl_Reader rd;
                if (rd.ReadFile(path.c_str()) != IFSelect_RetDone) { ::_exit(0); }
                rd.TransferRoots();
                TopoDS_Shape src = rd.OneShape();
                if (src.IsNull()) ::_exit(0);
                double bb[6]; bool first = true;
                for (TopExp_Explorer ex(src, TopAbs_VERTEX); ex.More(); ex.Next()) {
                    const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
                    if (first) { bb[0]=bb[3]=p.X(); bb[1]=bb[4]=p.Y(); bb[2]=bb[5]=p.Z(); first=false; }
                    else { bb[0]=std::min(bb[0],p.X()); bb[3]=std::max(bb[3],p.X());
                           bb[1]=std::min(bb[1],p.Y()); bb[4]=std::max(bb[4],p.Y());
                           bb[2]=std::min(bb[2],p.Z()); bb[5]=std::max(bb[5],p.Z()); }
                }
                if (first) ::_exit(0);
                const double dx=bb[3]-bb[0], dy=bb[4]-bb[1], dz=bb[5]-bb[2];
                const double minExt=std::min(dx,std::min(dy,dz));
                const double diag=std::sqrt(dx*dx+dy*dy+dz*dz);
                const bool flat = !(minExt > 1e-9*diag);
                const double wall = 0.05 * (flat ? diag*0.05 : minExt);
                TopTools_IndexedMapOfShape fm; TopExp::MapShapes(src, TopAbs_FACE, fm);
                TopoDS_Face big; double bigA = 0;
                for (int i=1;i<=fm.Extent();++i) {
                    TopoDS_Face fc = TopoDS::Face(fm(i));
                    Handle(Geom_Surface) su = BRep_Tool::Surface(fc);
                    if (Handle(Geom_Plane)::DownCast(su).IsNull()) continue;
                    GProp_GProps g; BRepGProp::SurfaceProperties(fc, g);
                    const double a = g.Mass();
                    if (a > bigA*(1.0+1e-12)) { big = fc; bigA = a; }
                }
                if (big.IsNull()) { std::fprintf(stderr, "[%s] NO PLANAR FACE\n", path.c_str()); ::_exit(0); }
                TopTools_ListOfShape rm; rm.Append(big);
                BRepOffsetAPI_MakeThickSolid mk;
                mk.MakeThickSolidByJoin(src, rm, -wall, 1.0e-3);
                mk.Build();
                if (!mk.IsDone() || mk.Shape().IsNull()) { std::fprintf(stderr, "[%s] NOT DONE\n", path.c_str()); ::_exit(0); }
                std::map<std::string,int> rh, rp, sh, sp;
                { BRepCheck_Analyzer an(mk.Shape()); walk(an, mk.Shape(), rh, rp); }
                { BRepCheck_Analyzer an(src);        walk(an, src,        sh, sp); }
                payload = "OK";
                for (auto& kv : rp) payload += "|R:" + kv.first;
                for (auto& kv : sp) payload += "|S:" + kv.first;
                payload += "\n";
            } catch (const Standard_Failure& e) { std::fprintf(stderr, "[%s] THREW %s\n", path.c_str(), e.GetMessageString()?e.GetMessageString():"?"); ::_exit(0); }
              catch (const std::exception& e) { std::fprintf(stderr, "[%s] std %s\n", path.c_str(), e.what()); ::_exit(0); }
              catch (...) { std::fprintf(stderr, "[%s] unknown throw\n", path.c_str()); ::_exit(0); }
            const ssize_t w = ::write(fds[1], payload.c_str(), payload.size()); (void)w;
            ::close(fds[1]); ::_exit(0);
        }
        ::close(fds[1]);
        std::string buf; char tmp[4096]; ssize_t n;
        while ((n = ::read(fds[0], tmp, sizeof tmp)) > 0) buf.append(tmp, n);
        ::close(fds[0]); int ws; ::waitpid(pid, &ws, 0);
        if (buf.rfind("OK", 0) != 0) continue;
        ++nOK;
        bool anyR = false;
        size_t pos = 0;
        while ((pos = buf.find('|', pos)) != std::string::npos) {
            size_t end = buf.find_first_of("|\n", pos+1);
            std::string tok = buf.substr(pos+1, end - pos - 1);
            pos = end == std::string::npos ? buf.size() : end;
            if (tok.rfind("R:",0)==0) { resParts[tok.substr(2)]++; anyR = true; }
            else if (tok.rfind("S:",0)==0) srcParts[tok.substr(2)]++;
        }
        if (anyR) ++nInvalid;
    }

    std::printf("parts where OCCT THICKSOLID returned a shape : %d\n", nOK);
    std::printf("of those, at least one BRepCheck error       : %d\n\n", nInvalid);
    std::printf("RESULT-side BRepCheck enumerators (parts carrying each):\n");
    std::vector<std::pair<std::string,int>> v(resParts.begin(), resParts.end());
    std::sort(v.begin(), v.end(), [](auto&a,auto&b){return a.second>b.second;});
    for (auto& kv : v) std::printf("  %-36s %4d / %d\n", kv.first.c_str(), kv.second, nOK);
    std::printf("\nSOURCE-side BRepCheck enumerators on the SAME parts (inherited?):\n");
    std::vector<std::pair<std::string,int>> s(srcParts.begin(), srcParts.end());
    std::sort(s.begin(), s.end(), [](auto&a,auto&b){return a.second>b.second;});
    if (s.empty()) std::printf("  (none — every source is clean under the identical walk)\n");
    for (auto& kv : s) std::printf("  %-36s %4d / %d\n", kv.first.c_str(), kv.second, nOK);
    return 0;
}
