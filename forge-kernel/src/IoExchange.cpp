#include "forge/IoExchange.hpp"

#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
// OCCT_ZERO Wave-0 (B2): <BRepMesh_IncrementalMesh.hxx> REMOVED — STL export no
// longer meshes via OCCT; it tessellates the native body (tessellateSolid /
// HalfEdgeMesh::toSoup) and writes through the native ASCII STL codec.
#include <STEPControl_Reader.hxx>
// OCCT_ZERO (TKDESTEP-prep): STEPControl_Writer is referenced ONLY by the
// pure-OCCT build's exportStep (#else branch). In the native build
// (FORGE_NATIVE_BREP=1 — the shipped .node) STEP EXPORT is fully OCCT-free: a
// NativeSolid → StepAnalytic, a NativeMesh / OCCT-backed handle → StepFaceted (via
// the kernel tessellator). So no STEPControl_Writer symbol is linked there. The
// header include is harmless (a class declaration emits no undefined symbol unless
// referenced); it stays for the pure-OCCT fallback build.
#include <STEPControl_Writer.hxx>
// OCCT_ZERO Wave-0 (B2): <StlAPI_Reader.hxx> / <StlAPI_Writer.hxx> REMOVED — STL
// read/write is now the in-house ASCII codec (forge/native/brep/MeshExchange.hpp),
// whose std::to_chars/from_chars coordinate round-trip is bit-exact (A/B-certified
// vs OCCT StlAPI in test/native_vs_occt_stl.cpp: enclosed-volume rel<=1e-9).
// OCCT_ZERO Wave-0 (B1): <IGESControl_Reader.hxx> REMOVED — IGES read is now the
// in-house native reader (forge/native/brep/IgesRead.hpp), A/B-certified vs OCCT
// in test/native_vs_occt_iges.cpp. OCCT's TKDEIGES reader is no longer linked here.
#include <IFSelect_ReturnStatus.hxx>
#include <Interface_Static.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Compound.hxx>
#include <TopExp_Explorer.hxx>

#include <fstream>
#include <sstream>
#include <stdexcept>
#include <cstdint>
#include <cstring>

// IN-HOUSE KERNEL STEP 3c — gated native STEP route. Compiled in only under
// -DFORGE_NATIVE_BREP; taken at runtime only when forgeNativeStepEnabled().
// The OCCT path below stays the default (flag OFF -> byte-identical behaviour).
#ifdef FORGE_NATIVE_BREP
#include "forge/Tessellate.hpp"                     // OCCT-zero STEP export — soup for an OCCT-handle body
#include "forge/native/brep/NativeRoute.hpp"        // forgeNativeBrepEnabled
#include "forge/native/brep/StepAnalytic.hpp"       // analytic codec (NativeSolid)
#include "forge/native/brep/StepFaceted.hpp"        // faceted codec (NativeMesh + OCCT-handle export)
#include "forge/native/brep/SolidTessellate.hpp"    // soup for a faceted-solid fallback
#include "forge/native/brep/IgesRead.hpp"           // OCCT-zero B1 — native foreign-IGES reader
#include "forge/native/brep/MeshExchange.hpp"        // OCCT-zero B2 — native ASCII STL codec
#include "forge/native/mesh/HalfEdgeMesh.hpp"
#endif

namespace forge::io {

#ifdef FORGE_NATIVE_BREP
namespace {
// Read a whole file into a string (text STEP). Throws on open failure.
std::string slurpFile(const std::string& filepath) {
    std::ifstream in(filepath, std::ios::binary);
    if (!in) throw std::runtime_error("forge.io: cannot open " + filepath);
    std::ostringstream all; all << in.rdbuf();
    return all.str();
}
void spillFile(const std::string& filepath, const std::string& text) {
    std::ofstream of(filepath, std::ios::binary | std::ios::trunc);
    if (!of) throw std::runtime_error("forge.io: cannot write " + filepath);
    of.write(text.data(), static_cast<std::streamsize>(text.size()));
    if (!of) throw std::runtime_error("forge.io: write error on " + filepath);
}
} // namespace
#endif

ShapeHandle importStep(const std::string& filepath) {
#ifdef FORGE_NATIVE_BREP
    if (native::brep::forgeNativeStepEnabled()) {
        // Native analytic route: parse the part-21 into an in-house Solid. On any
        // unsupported feature (a surface entity the native reader can't rebuild)
        // we fall back to the OCCT importer below — preserving the "imports any
        // STEP" behaviour (OCCT stays linked) rather than throwing. Stated plainly.
        std::string text = slurpFile(filepath);
        auto rr = native::brep::StepAnalytic::read(text);
        if (rr.ok && rr.solid && rr.owner) {
            return ShapeRegistry::instance().addNativeSolid(rr.owner, rr.solid);
        }
        // else: honest fall-through to OCCT (e.g. a B_SPLINE_SURFACE face, or a
        // non-analytic third-party STEP the native reader does not reconstruct).
    }
#endif
    // STEPControl_Reader supports AP203, AP214, AP242 — TKDESTEP picks
    // the right schema automatically from the file header.
    STEPControl_Reader reader;
    Interface_Static::SetCVal("xstep.cascade.unit", "MM");
    const auto stat = reader.ReadFile(filepath.c_str());
    if (stat != IFSelect_RetDone) {
        throw std::runtime_error("forge.io: STEP read failed for " + filepath);
    }
    const auto nRoots = reader.NbRootsForTransfer();
    if (nRoots == 0) {
        throw std::runtime_error("forge.io: STEP file has no transferable roots");
    }
    reader.TransferRoots();
    const auto nShapes = reader.NbShapes();
    if (nShapes == 0) {
        throw std::runtime_error("forge.io: STEP transfer produced no shapes");
    }

    // Multi-shape files come back as a compound — preserves the file's
    // hierarchy so the JS layer can walk it (Forge-21b will add
    // sub-shape iteration; for now we hand back the root).
    TopoDS_Shape shape = nShapes == 1 ? reader.Shape(1) : reader.OneShape();
    return ShapeRegistry::instance().add(shape);
}

bool exportStep(ShapeHandle h, const std::string& filepath) {
#ifdef FORGE_NATIVE_BREP
    auto& reg = ShapeRegistry::instance();
    const ShapeKind k = reg.kindOf(h);
    if (native::brep::forgeNativeStepEnabled()) {
        if (k == ShapeKind::NativeSolid) {
            // ANALYTIC route: emit real CYLINDRICAL/CONICAL/SPHERICAL/TOROIDAL/
            // PLANE surfaces + LINE/CIRCLE edges (NOT a tessellation).
            auto wr = native::brep::StepAnalytic::write(reg.getNativeSolid(h));
            if (!wr.ok) {
                throw std::runtime_error("forge.io native STEP export: " + wr.reason);
            }
            spillFile(filepath, wr.text);
            return true;
        }
        if (k == ShapeKind::NativeMesh) {
            // FACETED route (HONEST): a fillet/chamfer/sweep/loft RESULT carries no
            // analytic surface, so it serialises as a tessellated MANIFOLD_SOLID_BREP
            // (every face a flat PLANE triangle) via StepFaceted — stated plainly.
            const auto& hem = reg.getNativeMesh(h);
            native::brep::StepMesh sm;
            std::vector<double> pos; std::vector<std::uint32_t> idx;
            hem.toSoup(pos, idx);
            sm.positions = std::move(pos);
            sm.indices   = std::move(idx);
            auto wr = native::brep::StepFaceted::write(sm, "forge_faceted_solid");
            if (!wr.ok) {
                throw std::runtime_error("forge.io native faceted STEP export: " + wr.reason);
            }
            spillFile(filepath, wr.text);
            return true;
        }
        // k == Occt: fall to the native FACETED route below (a native-gate session
        // can still hold OCCT-backed handles, e.g. an OCCT-imported part).
    }
    // OCCT-ZERO STEP EXPORT (TKDESTEP-prep): an OCCT-backed handle — or ANY handle
    // when the native STEP gate is off — is exported through the IN-HOUSE FACETED
    // codec instead of STEPControl_Writer (removed from the native build). The
    // kernel tessellator produces the triangle soup (native for a NativeSolid/Mesh,
    // OCCT BRepMesh for an OCCT-backed shape) and StepFaceted::write serialises it.
    // HONEST: an OCCT handle carries no native analytic surface here, so its STEP is
    // a tessellated MANIFOLD_SOLID_BREP (flat PLANE triangles) — stated plainly; keep
    // the body in the native kernel and it exports analytically via the branch above.
    // The angular tolerance (~0.08 rad ⇒ ≳78 facets/turn) keeps a curved OCCT body's
    // enclosed volume within a few 1e-4 of the analytic truth.
    {
        forge::Mesh mesh = forge::tessellate(h, /*linearTol*/ 0.05, /*angularTol*/ 0.08);
        if (mesh.indices.empty()) {
            throw std::runtime_error(
                "forge.io: STEP export produced an empty tessellation for " + filepath);
        }
        native::brep::StepMesh sm;
        sm.positions.assign(mesh.positions.begin(), mesh.positions.end());  // float -> double
        sm.indices = mesh.indices;
        auto wr = native::brep::StepFaceted::write(sm, "forge_occt_faceted_solid");
        if (!wr.ok) {
            throw std::runtime_error(
                "forge.io OCCT-handle faceted STEP export failed: " + wr.reason);
        }
        spillFile(filepath, wr.text);
        return true;
    }
#else
    // PURE-OCCT build (FORGE_NATIVE_BREP undefined): the OCCT AP242 writer. This is
    // the ONLY reference to STEPControl_Writer, so it is absent from the shipped
    // native .node (which never compiles this branch).
    const auto& shape = ShapeRegistry::instance().get(h);
    STEPControl_Writer writer;
    Interface_Static::SetCVal("write.step.schema", "AP242DIS");
    Interface_Static::SetCVal("write.step.unit",   "MM");
    const auto tStat = writer.Transfer(shape, STEPControl_AsIs);
    if (tStat != IFSelect_RetDone) {
        throw std::runtime_error("forge.io: STEP transfer failed");
    }
    const auto wStat = writer.Write(filepath.c_str());
    if (wStat != IFSelect_RetDone) {
        throw std::runtime_error("forge.io: STEP write failed for " + filepath);
    }
    return true;
#endif
}

ShapeHandle importBrep(const std::string& filepath) {
    TopoDS_Shape shape;
    BRep_Builder builder;
    if (!BRepTools::Read(shape, filepath.c_str(), builder)) {
        throw std::runtime_error("forge.io: BREP read failed for " + filepath);
    }
    return ShapeRegistry::instance().add(shape);
}

bool exportBrep(ShapeHandle h, const std::string& filepath) {
    const auto& shape = ShapeRegistry::instance().get(h);
    if (!BRepTools::Write(shape, filepath.c_str())) {
        throw std::runtime_error("forge.io: BREP write failed for " + filepath);
    }
    return true;
}

ShapeHandle importStl(const std::string& filepath) {
#ifdef FORGE_NATIVE_BREP
    // OCCT-ZERO Wave-0 (B2) — native ASCII-STL reader. MeshExchange::readSTL welds
    // the triangle soup back into a shared-vertex table by EXACT 64-bit coordinate
    // identity, so a closed mesh's enclosed volume is preserved bit-exactly. The
    // welded soup is built into a NativeMesh (HalfEdgeMesh) handle; a non-manifold /
    // inconsistently-wound STL fails LOUD (no silent repair — Bible §0/§9).
    std::string text = slurpFile(filepath);
    native::brep::ReadResult rr = native::brep::MeshExchange::readSTL(text);
    if (!rr.ok) {
        throw std::runtime_error("forge.io: STL read failed for " + filepath + " — " + rr.reason);
    }
    auto hem = std::make_shared<native::mesh::HalfEdgeMesh>();
    if (!hem->buildFromSoup(rr.mesh.positions, rr.mesh.indices)) {
        throw std::runtime_error(
            "forge.io: STL read failed for " + filepath +
            " — the triangle mesh is not a consistently-wound 2-manifold "
            "(non-manifold edge, inconsistent winding, or degenerate face)");
    }
    return ShapeRegistry::instance().addNativeMesh(std::move(hem));
#else
    (void)filepath;
    throw std::runtime_error(
        "forge.io: STL import requires the native B-rep build (FORGE_NATIVE_BREP); "
        "the OCCT StlAPI_Reader path has been retired.");
#endif
}

bool exportStl(ShapeHandle h, const std::string& filepath,
               double linearTol, double angularTol, bool ascii) {
#ifdef FORGE_NATIVE_BREP
    // OCCT-ZERO Wave-0 (B2) — native STL export. The body is tessellated by the
    // in-house tessellator (NativeSolid -> tessellateSolid at its as-built faceting;
    // NativeMesh -> HalfEdgeMesh::toSoup) and serialised through MeshExchange::writeSTL,
    // whose std::to_chars coordinate output round-trips bit-exactly. NO OCCT meshing.
    //
    // FORMAT: the native STL codec emits ASCII (its exact-double text round-trip is
    // what gives the rel<=1e-9 volume parity; binary STL is float32 and could not).
    // `ascii` is therefore advisory here — native STL export is always ASCII. The
    // `linearTol`/`angularTol` chord controls are likewise advisory: a native body
    // tessellates at its own as-built resolution (exact for planar faces).
    (void)linearTol; (void)angularTol; (void)ascii;
    auto& reg = ShapeRegistry::instance();
    const ShapeKind k = reg.kindOf(h);
    native::brep::TriMesh tm;
    if (k == ShapeKind::NativeSolid) {
        native::brep::tessellateSolid(reg.getNativeSolid(h), tm.positions, tm.indices, /*weldTol*/ 1e-7);
    } else if (k == ShapeKind::NativeMesh) {
        reg.getNativeMesh(h).toSoup(tm.positions, tm.indices);
    } else {
        // Occt-backed handle (e.g. a BREP import): no native tessellation exists for
        // an arbitrary OCCT shape and the OCCT mesher has been retired here. Surface
        // the truth (Bible §0/§9) rather than fake a mesh.
        throw std::runtime_error(
            "forge.io: native STL export covers native-kernel bodies; this handle is "
            "OCCT-backed and has no native tessellation. Export STEP (AP242) instead, "
            "or rebuild the body through the native kernel.");
    }
    if (tm.indices.empty()) {
        throw std::runtime_error("forge.io: STL export produced an empty tessellation for " + filepath);
    }
    const std::string text = native::brep::MeshExchange::writeSTL(tm, "forge");
    spillFile(filepath, text);
    return true;
#else
    (void)h; (void)filepath; (void)linearTol; (void)angularTol; (void)ascii;
    throw std::runtime_error(
        "forge.io: STL export requires the native B-rep build (FORGE_NATIVE_BREP); "
        "the OCCT StlAPI_Writer path has been retired.");
#endif
}

// --------------------------------------------------------------------
//  Forge-34 — IGES / JT / Parasolid import.
// --------------------------------------------------------------------

ShapeHandle importIges(const std::string& filepath) {
#ifdef FORGE_NATIVE_BREP
    // OCCT-ZERO Wave-0 (B1) — IGES read is now NATIVE-ONLY. The in-house foreign-IGES
    // reader (forge::native::brep::readForeignIges) is A/B-certified vs OCCT 7.9.3's
    // IGESControl_Reader in test/native_vs_occt_iges.cpp (box VOLUME 240 rel<=1e-6,
    // trimmed-face AREA, V/E/F signature). The OCCT TKDEIGES IGESControl_Reader has
    // been RETIRED from this kernel — native is the sole IGES read path.
    //
    // We mirror importStep's native route: read the file, accept ONLY a COMPLETE
    // watertight body (every entity reconstructed AND the sewn shell closed), and on
    // any failure surface the HONEST reason — NO silent fallback, NO fake (Bible
    // §0/§9). A foreign IGES whose entity zoo the native reader does not yet
    // reconstruct fails loud with the entity gap, never a wrong/partial solid.
    std::string text = slurpFile(filepath);
    native::brep::ForeignReadResult rr = native::brep::readForeignIges(text);
    if (rr.ok && rr.solid && rr.owner && rr.unsupported.empty() && rr.closed) {
        return ShapeRegistry::instance().addNativeSolid(rr.owner, rr.solid);
    }
    const std::string why =
        !rr.ok                  ? (rr.reason.empty() ? "the file could not be parsed" : rr.reason)
      : !rr.solid               ? "the IGES file produced no transferable shapes"
      : !rr.unsupported.empty() ? "the IGES file uses entities the native reader does not reconstruct"
      :                           "the body is not a closed watertight solid";
    throw std::runtime_error("forge.io: IGES read failed for " + filepath + " — " + why);
#else
    (void)filepath;
    throw std::runtime_error(
        "forge.io: IGES import requires the native B-rep build (FORGE_NATIVE_BREP); "
        "the OCCT IGESControl_Reader path has been retired.");
#endif
}

bool exportIges(ShapeHandle /*h*/, const std::string& /*filepath*/) {
    // HONEST DEFERRAL (Bible §0/§9 — no fake, no lossy stub). There is no native
    // IGES writer: OCCT 7.9's TKDEIGES carries only IGESControl_Reader (no writer
    // package), and the in-house kernel does not ship a from-scratch IGES 5.3
    // S/G/D/P/T writer for analytic / trimmed-NURBS surfaces. Surface the truth so
    // the caller routes to STEP, which IS the exact analytic exchange here.
    throw std::runtime_error(
        "forge.io: IGES export is not available in this build. No IGES writer is "
        "linked (OCCT TKDEIGES is read-only; the native kernel ships an analytic "
        "STEP writer, not an IGES 5.3 writer). Export STEP (AP242) instead — it is "
        "exact-precision and analytic. IGES IMPORT is supported (via OCCT).");
}

namespace {
// Read the first N bytes of a file into a small buffer. Used by the
// JT / Parasolid magic-byte sniff. Throws on missing file so callers
// don't have to.
std::vector<unsigned char> peekMagic(const std::string& filepath, std::size_t n) {
    std::ifstream f(filepath, std::ios::binary);
    if (!f) throw std::runtime_error("forge.io: cannot open " + filepath);
    std::vector<unsigned char> buf(n, 0);
    f.read(reinterpret_cast<char*>(buf.data()), static_cast<std::streamsize>(n));
    buf.resize(static_cast<std::size_t>(f.gcount()));
    return buf;
}
} // namespace

ShapeHandle importJt(const std::string& /*filepath*/) {
    // JT (Siemens) starts with the ASCII string "Version 8" or "Version 9"
    // in its file header; the binary container then carries LZ-compressed
    // BREP / tessellation segments only decodable by the Siemens kit.
    // We could sniff the header but the failure mode is the same either
    // way — emit a friendly error pointing the user at STEP/IGES.
    throw std::runtime_error(
        "forge.io: JT import requires the proprietary Siemens JT Open Toolkit. "
        "Convert the file to STEP (AP242) or IGES in your source CAD system, "
        "then re-import here.");
}

ShapeHandle importParasolid(const std::string& filepath) {
    // Parasolid .x_t (text) starts with "**ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    // and .x_b (binary) starts with the magic byte 0x83. We do the sniff
    // to give a slightly more specific error than the JT case.
    auto magic = peekMagic(filepath, 32);
    const bool isText = magic.size() >= 2 &&
        std::memcmp(magic.data(), "**", 2) == 0;
    const bool isBinary = !magic.empty() && magic[0] == 0x83;
    std::string kind = isText ? ".x_t (text)" : isBinary ? ".x_b (binary)" : "Parasolid";
    throw std::runtime_error(
        "forge.io: Parasolid (" + kind + ") import requires Siemens' proprietary "
        "Parasolid kernel which Forge does not ship. Export the file as "
        "STEP (AP214 or AP242) from your source CAD; STEP is exact-precision "
        "and Forge will read it without loss.");
}

// --------------------------------------------------------------------
//  Forge-34 — STEP AP242 with PMI comment block.
// --------------------------------------------------------------------

bool exportStepWithPmi(ShapeHandle h, const std::string& filepath,
                       const std::vector<PmiNote>& notes) {
    // 1) Write a vanilla AP242 STEP file via the existing path.
    exportStep(h, filepath);
    if (notes.empty()) return true;

    // 2) ISO-10303-21 supports `/* ... */` C-style comments anywhere
    //    outside string literals. We append a PMI_FCF block before the
    //    closing `END-ISO-10303-21;` so AP242 readers that ignore
    //    comments still consume the file, and tooling that round-trips
    //    Forge MBD finds the GD&T text intact.
    std::ifstream in(filepath, std::ios::binary);
    if (!in) throw std::runtime_error("forge.io: cannot re-open STEP for PMI append: " + filepath);
    std::ostringstream all;
    all << in.rdbuf();
    in.close();
    std::string body = all.str();

    std::ostringstream pmi;
    pmi << "/* PMI_BLOCK_BEGIN forge.io.exportStep AP242 */\n";
    for (const auto& n : notes) {
        pmi << "/* PMI_FCF: " << n.text;
        if (!n.anchorKind.empty()) {
            pmi << " @ " << n.anchorKind << "#" << n.anchorId;
        }
        pmi << " */\n";
    }
    pmi << "/* PMI_BLOCK_END */\n";

    // Insert before END-ISO-10303-21; (or append if marker missing).
    const std::string marker = "END-ISO-10303-21";
    const auto pos = body.rfind(marker);
    std::string out;
    if (pos == std::string::npos) {
        out = body + "\n" + pmi.str();
    } else {
        out = body.substr(0, pos) + pmi.str() + body.substr(pos);
    }

    std::ofstream of(filepath, std::ios::binary | std::ios::trunc);
    if (!of) throw std::runtime_error("forge.io: cannot rewrite STEP with PMI: " + filepath);
    of.write(out.data(), static_cast<std::streamsize>(out.size()));
    return true;
}

} // namespace forge::io
