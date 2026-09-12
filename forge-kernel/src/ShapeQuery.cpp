// ShapeQuery.cpp — the OCCT side of the Forge Kernel API's topology queries.
//
// This file is where OCCT is allowed to be: below the Kernel API, during the
// migration. The code here is a direct port of what forge-desktop/src/ModelQuality.cpp
// used to do inline, moved across the boundary unchanged in behaviour.
#include "forge/ShapeQuery.hpp"
#include "forge/ShapeRegistry.hpp"

#include "forge/Mold.hpp"

#include <BRepBndLib.hxx>
#include <Bnd_Box.hxx>
#include <TopAbs.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Dir.hxx>

namespace forge {
namespace {

// Every entry point here is wrapped: OCCT signals failure by throwing, and a query
// that throws across the Kernel API would make "ask the shape a question" a
// crash risk for the caller. A query answers, or says it could not.
const TopoDS_Shape* shapeOf(ShapeHandle h) {
  if (h == kInvalidHandle) return nullptr;
  try {
    return &ShapeRegistry::instance().get(h);
  } catch (...) {
    return nullptr;
  }
}

}  // namespace

bool shapeBounds(ShapeHandle body, ShapeBounds& out) {
  const TopoDS_Shape* s = shapeOf(body);
  if (s == nullptr) return false;
  try {
    Bnd_Box box;
    BRepBndLib::Add(*s, box);
    if (box.IsVoid()) return false;
    box.Get(out.lo[0], out.lo[1], out.lo[2], out.hi[0], out.hi[1], out.hi[2]);
    return true;
  } catch (...) {
    return false;
  }
}

std::size_t shapeFaceCount(ShapeHandle body) {
  const TopoDS_Shape* s = shapeOf(body);
  if (s == nullptr) return 0;
  try {
    TopTools_IndexedMapOfShape faces;
    TopExp::MapShapes(*s, TopAbs_FACE, faces);
    return static_cast<std::size_t>(faces.Extent());
  } catch (...) {
    return 0;
  }
}

std::vector<ShapeHandle> shapeSolids(ShapeHandle body) {
  std::vector<ShapeHandle> out;
  const TopoDS_Shape* s = shapeOf(body);
  if (s == nullptr) return out;
  try {
    for (TopExp_Explorer e(*s, TopAbs_SOLID); e.More(); e.Next()) {
      try {
        out.push_back(ShapeRegistry::instance().add(e.Current()));
      } catch (...) {
        // One solid that cannot be registered must not lose the others.
      }
    }
  } catch (...) {
  }
  return out;
}

std::vector<ShapeHandle> shapeFaces(ShapeHandle body) {
  std::vector<ShapeHandle> out;
  const TopoDS_Shape* s = shapeOf(body);
  if (s == nullptr) return out;
  try {
    TopTools_IndexedMapOfShape faces;
    TopExp::MapShapes(*s, TopAbs_FACE, faces);
    // 1-based, and in map order, so out[i] IS face i+1 everywhere else here.
    for (int k = 1; k <= faces.Extent(); ++k) {
      try {
        out.push_back(ShapeRegistry::instance().add(faces(k)));
      } catch (...) {
        // A face that cannot be registered would silently shift every index after
        // it, which is worse than returning nothing: the caller would read face
        // k+1's curvature and report it against face k.
        for (ShapeHandle h : out) {
          try { ShapeRegistry::instance().release(h); } catch (...) {}
        }
        return {};
      }
    }
  } catch (...) {
    return {};
  }
  return out;
}

std::vector<DraftFaceIndexed> shapeDraftFaces(ShapeHandle body,
                                             const double pullDir[3],
                                             double draftThresholdDeg) {
  std::vector<DraftFaceIndexed> out;
  const TopoDS_Shape* s = shapeOf(body);
  if (s == nullptr || pullDir == nullptr) return out;
  try {
    TopTools_IndexedMapOfShape faceMap;
    TopExp::MapShapes(*s, TopAbs_FACE, faceMap);
    const gp_Dir pull(pullDir[0], pullDir[1], pullDir[2]);
    for (const mold::DraftFace& d : mold::analyseDraft(*s, pull, draftThresholdDeg)) {
      DraftFaceIndexed r;
      r.faceIndex = faceMap.Contains(d.face)
                        ? static_cast<std::size_t>(faceMap.FindIndex(d.face)) : 0;
      r.angleDeg = d.angleDeg;
      r.isPositive = d.isPositive;
      r.isNegative = d.isNegative;
      r.isVertical = d.isVertical;
      out.push_back(r);
    }
  } catch (...) {
    // A pull direction of zero length is the usual cause; gp_Dir refuses it.
  }
  return out;
}

std::vector<EdgeJoin> shapeEdgeJoins(ShapeHandle body) {
  std::vector<EdgeJoin> out;
  const TopoDS_Shape* s = shapeOf(body);
  if (s == nullptr) return out;
  try {
    TopTools_IndexedMapOfShape faceMap;
    TopExp::MapShapes(*s, TopAbs_FACE, faceMap);

    TopTools_IndexedDataMapOfShapeListOfShape edgeFaces;
    TopExp::MapShapesAndAncestors(*s, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
    for (int k = 1; k <= edgeFaces.Extent(); ++k) {
      const TopTools_ListOfShape& adjacent = edgeFaces.FindFromIndex(k);
      // Exactly two faces is what makes an edge a JOIN. One is a free edge, more
      // is non-manifold, and neither is a place two surfaces meet.
      if (adjacent.Extent() != 2) continue;
      auto it = adjacent.begin();
      const TopoDS_Face faceA = TopoDS::Face(*it);
      ++it;
      const TopoDS_Face faceB = TopoDS::Face(*it);

      EdgeJoin j;
      j.seam = faceA.IsSame(faceB) == Standard_True;
      j.indexA = faceMap.Contains(faceA)
                     ? static_cast<std::size_t>(faceMap.FindIndex(faceA)) : 0;
      j.indexB = faceMap.Contains(faceB)
                     ? static_cast<std::size_t>(faceMap.FindIndex(faceB)) : 0;
      try {
        j.faceA = ShapeRegistry::instance().add(faceA);
        j.faceB = ShapeRegistry::instance().add(faceB);
        j.edge = ShapeRegistry::instance().add(TopoDS::Edge(edgeFaces.FindKey(k)));
      } catch (...) {
        // Partial registration would hand the caller handles it cannot pair.
        // Release whatever was taken and drop this join rather than return a
        // half-built one.
        for (ShapeHandle h : {j.faceA, j.faceB, j.edge}) {
          if (h != kInvalidHandle) {
            try { ShapeRegistry::instance().release(h); } catch (...) {}
          }
        }
        continue;
      }
      out.push_back(j);
    }
  } catch (...) {
  }
  return out;
}

}  // namespace forge
