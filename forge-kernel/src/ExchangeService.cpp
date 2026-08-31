#include "forge/ExchangeService.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <exception>
#include <fstream>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "forge/DirectEdit.hpp"
#include "forge/DirectModeling.hpp"
#include "forge/Healing.hpp"
#include "forge/IoExchange.hpp"
#include "forge/MassProps.hpp"
#include "forge/ShapeRegistry.hpp"
#include "forge/Tessellate.hpp"
#include "forge/Topology.hpp"

#ifdef FORGE_NATIVE_BREP
#include "forge/NativeOcctBridge.hpp"
#include "forge/native/brep/MeshExchange.hpp"
#include "forge/native/brep/SolidTessellate.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"
#endif

// OCCT is reachable from this .cpp and from nowhere else in the exchange layer:
// the scale transform and the bounding box are the only two things here that
// have no forge:: wrapper yet.
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <Bnd_Box.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>

namespace forge::exchange {

const char* toString(Format f) noexcept {
    switch (f) {
        case Format::Unknown: return "unknown";
        case Format::Step:    return "step";
        case Format::Iges:    return "iges";
        case Format::Brep:    return "brep";
        case Format::Stl:     return "stl";
        case Format::Obj:     return "obj";
    }
    return "unknown";
}

Format formatFromString(const std::string& s) noexcept {
    if (s == "step") return Format::Step;
    if (s == "iges") return Format::Iges;
    if (s == "brep") return Format::Brep;
    if (s == "stl")  return Format::Stl;
    if (s == "obj")  return Format::Obj;
    return Format::Unknown;
}

namespace {

// ── the diagnostic sink ─────────────────────────────────────────────────────
// A cap that lied about the total would be worse than no cap: a 400-face part
// with a systemic defect produces one diagnostic per face, and a caller asking
// "were there errors" must not get a false negative on exactly those files. So
// the sink DROPS strings and COUNTS everything.
struct Sink {
    std::vector<Diagnostic>* items = nullptr;
    std::size_t cap = 0;
    std::size_t dropped = 0;

    void add(int sev, const char* code, std::string msg, std::string entity = std::string()) {
        if (items == nullptr) return;
        if (cap != 0 && items->size() >= cap) { ++dropped; return; }
        Diagnostic d;
        d.severity = sev;
        d.code = code;
        d.message = std::move(msg);
        d.entity = std::move(entity);
        items->push_back(std::move(d));
    }
    void info(const char* c, std::string m, std::string e = std::string()) { add(0, c, std::move(m), std::move(e)); }
    void warn(const char* c, std::string m, std::string e = std::string()) { add(1, c, std::move(m), std::move(e)); }
    void error(const char* c, std::string m, std::string e = std::string()) { add(2, c, std::move(m), std::move(e)); }
};

double nowSeconds() {
    using clock = std::chrono::steady_clock;
    return std::chrono::duration<double>(clock::now().time_since_epoch()).count();
}

std::uint64_t fileSize(const std::string& path) {
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f) return 0;
    const std::streamoff sz = f.tellg();
    return sz < 0 ? 0 : static_cast<std::uint64_t>(sz);
}

std::string fmt(double v) {
    char buf[48];
    std::snprintf(buf, sizeof buf, "%g", v);
    return std::string(buf);
}

// The scale transform. A units factor of exactly 1.0 is a NO-OP and returns the
// handle unchanged — running a body through BRepBuilderAPI_Transform to multiply
// it by one moves vertices by an ulp and re-issues every face id for nothing.
Handle applyScale(Handle h, double scale, Sink& sink) {
    if (scale == 1.0) return h;
    if (!(scale > 0.0) || std::isnan(scale)) {
        sink.error("unit_scale_invalid",
                   "a scale factor of " + fmt(scale) + " is not usable; the body was "
                   "imported at its own scale");
        return h;
    }
    Handle src = h;
#ifdef FORGE_NATIVE_BREP
    // A native analytic solid has no OCCT shape to transform. The validated
    // analytic STEP round-trip bridges it; a native FACETED body (a fillet
    // result) has no bridge yet, and that is an honest deferral, not a silent
    // no-op — the diagnostic says the geometry is at the file's own scale.
    try {
        src = forge::toOcctBackedHandle(h);
    } catch (const std::exception& e) {
        sink.warn("unit_scale_deferred",
                  std::string("the unit scale x") + fmt(scale) +
                      " was NOT applied: this body has no OCCT form to transform (" +
                      e.what() + "). The geometry is at the file's own scale.");
        return h;
    }
#endif
    try {
        gp_Trsf t;
        t.SetScale(gp_Pnt(0.0, 0.0, 0.0), scale);
        BRepBuilderAPI_Transform xf(ShapeRegistry::instance().get(src), t, Standard_True);
        if (!xf.IsDone()) {
            sink.warn("unit_scale_deferred",
                      "the unit scale x" + fmt(scale) + " could not be applied; the "
                      "geometry is at the file's own scale");
            return h;
        }
        const Handle scaled = ShapeRegistry::instance().add(xf.Shape());
        sink.info("unit_scale_applied",
                  "every coordinate was multiplied by " + fmt(scale) +
                      " to bring the file into the document's unit");
        return scaled;
    } catch (const std::exception& e) {
        sink.warn("unit_scale_deferred",
                  std::string("the unit scale x") + fmt(scale) + " could not be applied (" +
                      e.what() + "); the geometry is at the file's own scale");
        return h;
    }
}

// ── healing ─────────────────────────────────────────────────────────────────
// Each step is INDEPENDENTLY defended and independently reported. A sew that
// throws must not cost the caller the normal harmonisation that would have
// worked, and a step that ran must say what it changed — "healing applied" with
// no numbers is not a report, it is a reassurance.
Handle applyHealing(Handle h, const ImportRequest& req, Sink& sink) {
    if (req.sew) {
        try {
            const forge::heal::SewResult r = forge::heal::sewShape(h, req.tolerance);
            if (r.handle != forge::kInvalidHandle) {
                if (r.report.openEdgesBefore != r.report.openEdgesAfter ||
                    r.report.facesBefore != r.report.facesAfter) {
                    sink.info("sew_applied",
                              "sewing at " + fmt(req.tolerance) + " mm closed " +
                                  std::to_string(r.report.openEdgesBefore) + " -> " +
                                  std::to_string(r.report.openEdgesAfter) +
                                  " free edges over " + std::to_string(r.report.facesAfter) +
                                  " faces");
                }
                h = r.handle;
            }
        } catch (const std::exception& e) {
            sink.warn("sew_failed", std::string("sewing did not run: ") + e.what());
        }
    }
    if (req.fillMissingFaces) {
        try {
            const forge::heal::AutoFillResult r =
                forge::heal::autoFillMissingFaces(h, req.tolerance);
            if (r.handle != forge::kInvalidHandle) {
                if (r.report.facesAdded > 0) {
                    sink.info("faces_filled",
                              std::to_string(r.report.facesAdded) +
                                  " missing face(s) were capped across free boundaries");
                }
                h = r.handle;
            }
        } catch (const std::exception& e) {
            sink.warn("fill_failed", std::string("gap filling did not run: ") + e.what());
        }
    }
    if (req.repairSelfIntersections) {
        try {
            const forge::heal::RepairResult r =
                forge::heal::autoRepairSelfIntersection(h, req.tolerance);
            if (r.handle != forge::kInvalidHandle) {
                if (r.report.fixersFired > 0) {
                    sink.info("repair_applied",
                              std::to_string(r.report.fixersFired) +
                                  " shape fixer(s) fired on tolerance / self-intersection / "
                                  "orientation");
                }
                h = r.handle;
            }
        } catch (const std::exception& e) {
            sink.warn("repair_failed", std::string("self-intersection repair did not run: ") +
                                           e.what());
        }
    }
    if (req.harmoniseNormals) {
        try {
            const Handle r = forge::heal::harmonizeNormals(h);
            if (r != forge::kInvalidHandle) h = r;
        } catch (const std::exception& e) {
            sink.warn("harmonise_failed",
                      std::string("normal harmonisation did not run: ") + e.what());
        }
    }
    if (req.unifyCoplanarFaces) {
        // unifyFaces is what makes "the bore" ONE face rather than a strip of
        // faceted panels, which is what every face selector downstream assumes.
        try {
            const Handle r = forge::unifyFaces(h);
            if (r != forge::kInvalidHandle) h = r;
        } catch (const std::exception& e) {
            sink.warn("unify_failed", std::string("coplanar face unification did not run: ") +
                                          e.what());
        }
    }
    return h;
}

// ── the validity check, and the TOLERATE rule ───────────────────────────────
// Every bad face and bad edge is reported BY ID. That is the whole difference
// between "this file is broken" and a repair loop that can act: the caller gets
// face#12, not a boolean.
void reportValidity(Handle h, const ImportRequest& req, Observed& obs, Sink& sink) {
    forge::heal::ValidityReport v;
    try {
        v = forge::heal::checkValidity(h);
    } catch (const std::exception& e) {
        sink.warn("validity_unavailable",
                  std::string("the validity check did not run: ") + e.what());
        return;
    }
    obs.closed = v.isClosed;
    obs.manifold = v.isManifold;
    obs.oriented = v.isOriented;
    obs.valid = v.isClosed && v.isManifold && v.isOriented;

    if (!v.isClosed) {
        sink.warn("body_not_closed",
                  "the imported body is not watertight; it is kept as an open shell");
    }
    if (v.hasNonManifoldEdge) {
        sink.warn("non_manifold_edge", "the body has at least one non-manifold edge");
    }
    if (v.hasSelfIntersect) {
        sink.warn("self_intersection", "the body self-intersects");
    }
    for (std::uint32_t f : v.badFaces) {
        // ★ Severity Error, and the import STILL SUCCEEDS. `ok` means a body
        // exists; the severity says this face needs attention. A refusal here is
        // the capability gate the owner's constraint forbids, and it would fire
        // hardest on exactly the dense real parts this app exists for.
        sink.error("degenerate_face",
                   req.tolerateDegenerate
                       ? "the face failed the validity check and was kept as imported"
                       : "the face failed the validity check",
                   "face#" + std::to_string(f));
    }
    for (std::uint32_t e : v.badEdges) {
        sink.error("degenerate_edge",
                   req.tolerateDegenerate
                       ? "the edge failed the validity check and was kept as imported"
                       : "the edge failed the validity check",
                   "edge#" + std::to_string(e));
    }
}

#ifdef FORGE_NATIVE_BREP
// The triangle soup for ANY handle kind. A native solid tessellates natively; a
// native mesh already IS one; an OCCT-backed body goes through the same
// forge::tessellate the STEP faceted route uses. This is the function that makes
// "import a STEP, export an STL" reachable at all.
bool soupOf(Handle h, double linearTol, double angularTol,
            std::vector<double>& pos, std::vector<std::uint32_t>& idx, bool& viaOcct) {
    auto& reg = ShapeRegistry::instance();
    const ShapeKind k = reg.kindOf(h);
    viaOcct = false;
    if (k == ShapeKind::NativeSolid) {
        forge::native::brep::tessellateSolid(reg.getNativeSolid(h), pos, idx, /*weldTol*/ 1e-7);
        return !idx.empty();
    }
    if (k == ShapeKind::NativeMesh) {
        reg.getNativeMesh(h).toSoup(pos, idx);
        return !idx.empty();
    }
    viaOcct = true;
    const forge::Mesh m = forge::tessellate(h, linearTol, angularTol);
    if (m.indices.empty()) return false;
    pos.assign(m.positions.begin(), m.positions.end());  // float -> double
    idx = m.indices;
    return true;
}
#endif

#ifdef FORGE_NATIVE_BREP
// ── the NATIVE B-rep census ─────────────────────────────────────────────────
// ★ WHY THIS EXISTS, MEASURED. forge::direct::topoCounts walks a TopoDS_Shape,
// so on a NATIVE handle it goes through the native->OCCT bridge — and on a
// faceted native solid that bridge refuses ("faceted solid mis-integrates").
// The result was that the round-trip experiment could measure the body it
// imported (OCCT-backed, via the foreign-STEP transfer) and NOT the body it read
// back (native, because the analytic STEP we write is Forge's own dialect and
// the native reader claims it). Half a comparison is not a comparison: every
// count came back -1 and the deltas were arithmetic on a sentinel.
//
// So the census is taken from the native topology graph directly: faces and
// shells off the Solid, edges and vertices as the UNIQUE sets reached by walking
// every loop's coedge ring. Same definition as the OCCT census — a shared edge
// is one edge — so the two are comparable, which is the whole point.
bool nativeCensus(const forge::native::brep::Solid& s, Observed& o) {
    std::vector<const void*> edgeSet;
    std::vector<const void*> vertSet;
    std::size_t faces = 0;
    const auto insert = [](std::vector<const void*>& v, const void* p) {
        if (p == nullptr) return;
        const auto it = std::lower_bound(v.begin(), v.end(), p);
        if (it == v.end() || *it != p) v.insert(it, p);
    };
    for (const forge::native::brep::Shell* sh : s.shells) {
        if (sh == nullptr) continue;
        for (const forge::native::brep::Face* f : sh->faces) {
            if (f == nullptr) continue;
            ++faces;
            std::vector<const forge::native::brep::Loop*> loops;
            if (f->outerLoop != nullptr) loops.push_back(f->outerLoop);
            for (const forge::native::brep::Loop* il : f->innerLoops) {
                if (il != nullptr) loops.push_back(il);
            }
            for (const forge::native::brep::Loop* lp : loops) {
                const forge::native::brep::Coedge* ce = lp->first;
                // Bound the walk by the loop's own declared size: a corrupt ring
                // must cost this measurement, never the process.
                for (std::size_t k = 0; k < lp->coedgeCount && ce != nullptr; ++k) {
                    if (ce->edge != nullptr) {
                        insert(edgeSet, ce->edge);
                        insert(vertSet, ce->edge->start);
                        insert(vertSet, ce->edge->end);
                    }
                    ce = ce->next;
                }
            }
        }
    }
    if (faces == 0) return false;
    o.solidCount = 1;
    o.shellCount = static_cast<long>(s.shells.size());
    o.faceCount = static_cast<long>(faces);
    o.edgeCount = static_cast<long>(edgeSet.size());
    o.vertexCount = static_cast<long>(vertSet.size());
    return true;
}
#endif

}  // namespace

// ── measurement ─────────────────────────────────────────────────────────────
Observed measure(Handle h) {
    Observed o;
    if (h == kNoHandle) return o;

    try {
        const forge::MassProperties mp = forge::massProperties(h);
        o.volume = mp.volume;
        o.area = mp.area;
        o.com[0] = mp.cx;
        o.com[1] = mp.cy;
        o.com[2] = mp.cz;
        o.measured = true;
    } catch (...) { /* additive: a body that cannot be weighed can still be counted */ }

    // The B-rep census. The NATIVE route is tried FIRST for a native handle,
    // because the OCCT route on such a handle goes through a bridge that refuses
    // a faceted body — and a -1 in a count is a hole in the comparison, not a
    // small inaccuracy.
    bool counted = false;
#ifdef FORGE_NATIVE_BREP
    try {
        if (ShapeRegistry::instance().kindOf(h) == ShapeKind::NativeSolid) {
            counted = nativeCensus(ShapeRegistry::instance().getNativeSolid(h), o);
        }
    } catch (...) { /* additive */ }
#endif
    if (!counted) {
        try {
            const forge::direct::TopoCounts c = forge::direct::topoCounts(h);
            o.solidCount = static_cast<long>(c.solids);
            o.shellCount = static_cast<long>(c.shells);
            o.faceCount = static_cast<long>(c.faces);
            o.edgeCount = static_cast<long>(c.edges);
            o.vertexCount = static_cast<long>(c.vertices);
            counted = true;
        } catch (...) { /* additive */ }
    }
    if (counted) o.measured = true;

    try {
        Bnd_Box box;
        BRepBndLib::Add(ShapeRegistry::instance().get(h), box);
        if (!box.IsVoid()) {
            box.Get(o.bboxMin[0], o.bboxMin[1], o.bboxMin[2],
                    o.bboxMax[0], o.bboxMax[1], o.bboxMax[2]);
        }
    } catch (...) {
        // Fall back to the tessellation's own extent, which is what the feature
        // compiler reports. A body with no OCCT form still has a bounding box.
        try {
            const forge::Mesh m = forge::tessellate(h, 0.3, 0.6);
            double mn[3] = {1e300, 1e300, 1e300};
            double mx[3] = {-1e300, -1e300, -1e300};
            for (std::size_t i = 0; i + 2 < m.positions.size(); i += 3) {
                for (int k = 0; k < 3; ++k) {
                    const double v = m.positions[i + k];
                    if (v < mn[k]) mn[k] = v;
                    if (v > mx[k]) mx[k] = v;
                }
            }
            if (mn[0] <= mx[0]) {
                for (int k = 0; k < 3; ++k) { o.bboxMin[k] = mn[k]; o.bboxMax[k] = mx[k]; }
            }
        } catch (...) { /* additive */ }
    }

    try {
        forge::TopoSignature t;
        if (forge::topologySignature(h, t)) {
            o.genus = t.genus;
            o.meshShellCount = t.shellCount;
            o.meshVertexCount = t.vertexCount;
        }
    } catch (...) { /* additive */ }

    return o;
}

void release(Handle h) {
    if (h == kNoHandle) return;
    try { ShapeRegistry::instance().release(h); } catch (...) { /* a double release is not
        worth taking a caller down for; the registry already refuses it */ }
}

// ── import ──────────────────────────────────────────────────────────────────
ImportResult importFile(const ImportRequest& req) {
    ImportResult out;
    out.format = req.format;
    out.scaleApplied = req.scale;
    const double t0 = nowSeconds();
    Sink sink{&out.diagnostics, req.maxDiagnostics, 0};

    out.fileBytes = fileSize(req.path);
    if (out.fileBytes == 0) {
        // Distinguish "no such file" from "empty file" — a caller chasing a path
        // bug and a caller chasing a truncated export need different sentences.
        std::ifstream probe(req.path, std::ios::binary);
        out.error = probe ? ("the file is empty: " + req.path)
                          : ("cannot open " + req.path);
        sink.error("file_unreadable", out.error);
        out.seconds = nowSeconds() - t0;
        out.diagnosticsDropped = sink.dropped;
        return out;
    }

    if (req.format == Format::Unknown) {
        out.error =
            "the caller did not determine the file's format. This service does not sniff: "
            "forge::ui::sniffFormat is the one sniffer in this system, and a second one here "
            "would be a second answer to the same question.";
        sink.error("format_not_determined", out.error);
        out.seconds = nowSeconds() - t0;
        out.diagnosticsDropped = sink.dropped;
        return out;
    }

    Handle h = kNoHandle;
    try {
        switch (req.format) {
            case Format::Step: h = forge::io::importStep(req.path); break;
            case Format::Iges: h = forge::io::importIges(req.path); break;
            case Format::Brep: h = forge::io::importBrep(req.path); break;
            case Format::Stl:  h = forge::io::importStl(req.path);  break;
            case Format::Obj:  h = kNoHandle; break;  // handled below
            case Format::Unknown: break;              // unreachable, guarded above
        }
#ifdef FORGE_NATIVE_BREP
        if (req.format == Format::Obj) {
            // OBJ was a codec with no door: MeshExchange::readOBJ exists and is
            // unit-tested, and NO forge::io entry point reached it, so the
            // application could not open a .obj at all. This is that door.
            std::ifstream in(req.path, std::ios::binary);
            std::ostringstream all;
            all << in.rdbuf();
            const std::string text = all.str();
            const forge::native::brep::ReadResult rr =
                forge::native::brep::MeshExchange::readOBJ(text);
            if (!rr.ok) {
                out.error = "OBJ read failed: " + rr.reason;
            } else {
                auto hem = std::make_shared<forge::native::mesh::HalfEdgeMesh>();
                if (!hem->buildFromSoup(rr.mesh.positions, rr.mesh.indices)) {
                    out.error =
                        "the OBJ triangle mesh is not a consistently-wound 2-manifold "
                        "(non-manifold edge, inconsistent winding, or a degenerate face)";
                } else {
                    h = ShapeRegistry::instance().addNativeMesh(std::move(hem));
                }
            }
        }
#else
        if (req.format == Format::Obj) {
            out.error = "OBJ import requires the native B-rep build (FORGE_NATIVE_BREP)";
        }
#endif
    } catch (const std::exception& e) {
        out.error = e.what();
    } catch (...) {
        out.error = "the reader threw a non-standard exception";
    }

    if (h == kNoHandle || h == forge::kInvalidHandle) {
        if (out.error.empty()) out.error = "the reader produced no body";
        sink.error("no_body", out.error);
        out.seconds = nowSeconds() - t0;
        out.diagnosticsDropped = sink.dropped;
        return out;
    }

    h = applyScale(h, req.scale, sink);
    h = applyHealing(h, req, sink);

    out.handle = h;
    out.ok = true;  // ★ A BODY EXISTS. Everything below is description, not a veto.

    if (req.measure) {
        out.observed = measure(h);
        reportValidity(h, req, out.observed, sink);
    }

    out.seconds = nowSeconds() - t0;
    out.diagnosticsDropped = sink.dropped;
    return out;
}

// ── export ──────────────────────────────────────────────────────────────────
ExportResult exportFile(const ExportRequest& req) {
    ExportResult out;
    out.format = req.format;
    out.scaleApplied = req.scale;
    const double t0 = nowSeconds();
    Sink sink{&out.diagnostics, req.maxDiagnostics, 0};

    if (req.handle == kNoHandle) {
        out.error = "there is no body to export";
        sink.error("no_body", out.error);
        out.seconds = nowSeconds() - t0;
        return out;
    }

    Handle h = req.handle;
    Handle scaled = kNoHandle;
    if (req.scale != 1.0) {
        scaled = applyScale(h, req.scale, sink);
        h = scaled;
    }

    try {
        switch (req.format) {
            case Format::Step:
                forge::io::exportStep(h, req.path);
                out.ok = true;
                // The STEP writer takes the analytic route for a native solid and
                // for an OCCT-backed body, and falls back to a tessellated
                // MANIFOLD_SOLID_BREP only when neither can serialise. It reports
                // that fallback on stderr; what we can state here without lying is
                // that analytic was REQUESTED.
                out.analytic = req.preferAnalytic;
                break;
            case Format::Brep:
                forge::io::exportBrep(h, req.path);
                out.ok = true;
                out.analytic = true;
                break;
            case Format::Iges:
                // HONEST DEFERRAL. There is no IGES writer in this build. The
                // capability table says so and names STEP; writing STEP bytes to
                // the .igs path the user chose would be worse than saying no.
                out.error =
                    "IGES export is not available in this build: no IGES writer is linked "
                    "(OCCT's TKDEIGES is read-only, and the native kernel ships an analytic "
                    "STEP writer rather than an IGES 5.3 writer). Export STEP (AP242) "
                    "instead — it is exact-precision and analytic.";
                sink.error("export_format_unavailable", out.error, "iges");
                break;
            case Format::Stl:
            case Format::Obj: {
#ifdef FORGE_NATIVE_BREP
                std::vector<double> pos;
                std::vector<std::uint32_t> idx;
                bool viaOcct = false;
                if (!soupOf(h, req.linearTolerance, req.angularTolerance, pos, idx, viaOcct)) {
                    out.error = "the body produced an empty tessellation, so there is nothing "
                                "to write";
                    sink.error("empty_tessellation", out.error);
                    break;
                }
                forge::native::brep::TriMesh tm;
                tm.positions = std::move(pos);
                tm.indices = std::move(idx);
                const std::string text =
                    req.format == Format::Stl
                        ? forge::native::brep::MeshExchange::writeSTL(tm, "forge")
                        : forge::native::brep::MeshExchange::writeOBJ(tm);
                std::ofstream of(req.path, std::ios::binary | std::ios::trunc);
                if (!of) {
                    out.error = "cannot write " + req.path;
                    sink.error("write_failed", out.error);
                    break;
                }
                of.write(text.data(), static_cast<std::streamsize>(text.size()));
                if (!of) {
                    out.error = "write error on " + req.path;
                    sink.error("write_failed", out.error);
                    break;
                }
                out.ok = true;
                out.analytic = false;
                if (viaOcct) {
                    // ★ THE IMPEDIMENT THIS REMOVES, STATED. forge::io::exportStl
                    // throws on an OCCT-backed handle, and every imported foreign
                    // STEP is OCCT-backed — so this was unreachable. It is a
                    // tessellation and the caller is told so, in a diagnostic, not
                    // in a comment.
                    sink.info("tessellated_export",
                              std::string("the body is OCCT-backed, so it was tessellated at "
                                          "chord ") + fmt(req.linearTolerance) + " mm / " +
                                  fmt(req.angularTolerance) +
                                  " rad before writing. The written file is a triangle mesh, "
                                  "not analytic surfaces.");
                }
                if (req.format == Format::Stl && !req.ascii) {
                    sink.info("stl_ascii_only",
                              "binary STL was requested; the native codec writes ASCII, whose "
                              "exact-double text is what makes its volume round-trip to 1e-9. "
                              "An ASCII file was written.");
                }
#else
                out.error = "mesh export requires the native B-rep build (FORGE_NATIVE_BREP)";
                sink.error("export_format_unavailable", out.error);
#endif
                break;
            }
            case Format::Unknown:
                out.error = "no export format was chosen";
                sink.error("format_not_determined", out.error);
                break;
        }
    } catch (const std::exception& e) {
        out.ok = false;
        out.error = e.what();
        sink.error("writer_threw", out.error);
    } catch (...) {
        out.ok = false;
        out.error = "the writer threw a non-standard exception";
        sink.error("writer_threw", out.error);
    }

    if (scaled != kNoHandle && scaled != req.handle) release(scaled);
    if (out.ok) out.fileBytes = fileSize(req.path);
    out.seconds = nowSeconds() - t0;
    out.diagnosticsDropped = sink.dropped;
    return out;
}

}  // namespace forge::exchange
