#include "forge/IoExchange.hpp"

#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <STEPControl_Reader.hxx>
#include <STEPControl_Writer.hxx>
#include <StlAPI_Reader.hxx>
#include <StlAPI_Writer.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Interface_Static.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Compound.hxx>
#include <TopExp_Explorer.hxx>

#include <fstream>
#include <stdexcept>

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

} // namespace forge::io
