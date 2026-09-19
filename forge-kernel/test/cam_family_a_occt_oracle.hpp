// cam_family_a_occt_oracle.hpp — the OCCT wire offset, kept alive IN THE TESTS
// after it was deleted from src/Cam.cpp.
//
// TKOffset family A's production call site (src/Cam.cpp, forge::cam::inwardOffset)
// no longer contains BRepOffsetAPI_MakeOffset: the class, its header and the
// compile flag that used to gate it are gone, which is what takes those four
// symbols out of libforge_kernel_core. OCCT does not stop being the ORACLE
// because it stopped being the implementation, so the block below is the
// deleted production code, verbatim, in a TEST-ONLY header.
//
// KEEP IT VERBATIM. Its value is that it is bit-for-bit what shipped, so an A/B
// against it is an A/B against the previous behaviour and not against a
// re-derivation of it. The one thing that changed is the surrounding context:
// `plane` is unused by the OCCT path and is therefore not a parameter here.
//
// Nothing in src/ may include this header. It is the only file under test/ that
// names BRepOffsetAPI_MakeOffset, and a test binary linking TKOffset says
// nothing about the shipped library — see test/run_cam_family_a_offset_ab.sh,
// which asserts the split (oracle TU 4 symbols, src/Cam.cpp object 0).
#ifndef FORGE_TEST_CAM_FAMILY_A_OCCT_ORACLE_HPP
#define FORGE_TEST_CAM_FAMILY_A_OCCT_ORACLE_HPP

#include <BRepOffsetAPI_MakeOffset.hxx>
#include <GeomAbs_JoinType.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>

namespace forge {
namespace camtest {

// The deleted src/Cam.cpp body, verbatim:
//
//     try {
//         BRepOffsetAPI_MakeOffset off(wire, GeomAbs_Arc);
//         off.Init(GeomAbs_Arc);
//         // Negate so the offset moves *into* the closed wire.
//         off.Perform(-offsetMm);
//         if (off.IsDone()) {
//             TopoDS_Shape sh = off.Shape();
//             if (!sh.IsNull()) return sh;
//         }
//     } catch (...) {
//         // fall through — return empty.
//     }
//     return TopoDS_Shape();
inline TopoDS_Shape occtInwardOffset(const TopoDS_Wire& wire, double offsetMm) {
    try {
        BRepOffsetAPI_MakeOffset off(wire, GeomAbs_Arc);
        off.Init(GeomAbs_Arc);
        // Negate so the offset moves *into* the closed wire.
        off.Perform(-offsetMm);
        if (off.IsDone()) {
            TopoDS_Shape sh = off.Shape();
            if (!sh.IsNull()) return sh;
        }
    } catch (...) {
        // fall through — return empty.
    }
    return TopoDS_Shape();
}

}  // namespace camtest
}  // namespace forge

#endif  // FORGE_TEST_CAM_FAMILY_A_OCCT_ORACLE_HPP
