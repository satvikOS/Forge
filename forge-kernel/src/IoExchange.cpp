#include "forge/IoExchange.hpp"

#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <STEPControl_Reader.hxx>
#include <STEPControl_Writer.hxx>
#include <StlAPI_Reader.hxx>
#include <StlAPI_Writer.hxx>
#include <IGESControl_Reader.hxx>
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

namespace forge::io {

ShapeHandle importStep(const std::string& filepath) {
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
    StlAPI_Reader reader;
    TopoDS_Shape shape;
    if (!reader.Read(shape, filepath.c_str())) {
        throw std::runtime_error("forge.io: STL read failed for " + filepath);
    }
    return ShapeRegistry::instance().add(shape);
}

bool exportStl(ShapeHandle h, const std::string& filepath,
               double linearTol, double angularTol, bool ascii) {
    auto shape = ShapeRegistry::instance().get(h);
    // STL needs a triangulation first — BRepMesh_IncrementalMesh fills
    // it onto the existing shape (mutating its sub-shape triangulations).
    BRepMesh_IncrementalMesh mesher(shape, linearTol, /*isRelative*/ Standard_False,
                                    angularTol, /*isInParallel*/ Standard_True);
    mesher.Perform();
    StlAPI_Writer writer;
    writer.ASCIIMode() = ascii ? Standard_True : Standard_False;
    if (!writer.Write(shape, filepath.c_str())) {
        throw std::runtime_error("forge.io: STL write failed for " + filepath);
    }
    return true;
}

// --------------------------------------------------------------------
//  Forge-34 — IGES / JT / Parasolid import.
// --------------------------------------------------------------------

ShapeHandle importIges(const std::string& filepath) {
    // OCCT 7.9's TKDEIGES toolkit ships IGESControl_Reader; ReadFile()
    // returns IFSelect_RetDone on success. Same multi-root → compound
    // strategy as STEP.
    IGESControl_Reader reader;
    Interface_Static::SetCVal("xstep.cascade.unit", "MM");
    const auto stat = reader.ReadFile(filepath.c_str());
    if (stat != IFSelect_RetDone) {
        throw std::runtime_error("forge.io: IGES read failed for " + filepath);
    }
    reader.TransferRoots();
    const auto nShapes = reader.NbShapes();
    if (nShapes == 0) {
        throw std::runtime_error("forge.io: IGES transfer produced no shapes");
    }
    TopoDS_Shape shape = nShapes == 1 ? reader.Shape(1) : reader.OneShape();
    return ShapeRegistry::instance().add(shape);
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
