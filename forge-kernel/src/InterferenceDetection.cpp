#include "forge/InterferenceDetection.hpp"

#include "forge/AssemblyHierarchy.hpp"
#include "forge/ShapeRegistry.hpp"

#include <BRepAlgoAPI_Common.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <gp_GTrsf.hxx>
#include <gp_Trsf.hxx>
#include <gp_Mat.hxx>
#include <gp_XYZ.hxx>
#include <TopoDS_Shape.hxx>

#include <algorithm>
#include <stdexcept>

namespace forge {

namespace {

// Inflate an AABB by `tol` on every face. We use this to widen the
// broad-phase so near-touches inside `tolerance` still get evaluated by
// the exact boolean engine.
AABB inflated(const AABB& a, double tol) {
    return AABB{
        a.minX - tol, a.minY - tol, a.minZ - tol,
        a.maxX + tol, a.maxY + tol, a.maxZ + tol,
    };
}

// Convert our row-major 4×4 into an OCCT gp_Trsf, when the upper-left 3×3
// is an orthonormal rotation. Forge's assembly transforms are built that
// way (Rodrigues × translation) so this is always safe inside the
// assembly subsystem.
gp_Trsf toOcctTrsf(const Transform4x4& m) {
    gp_Trsf t;
    // SetValues takes row-major 3×4: (a11..a14 / a21..a24 / a31..a34)
    t.SetValues(
        m.m[0],  m.m[1],  m.m[2],  m.m[3],
        m.m[4],  m.m[5],  m.m[6],  m.m[7],
        m.m[8],  m.m[9],  m.m[10], m.m[11]);
    return t;
}

TopoDS_Shape worldShape(InstanceId id) {
    const auto compHandle = ComponentRegistry::instance().getComponent(id);
    const auto& shape = ShapeRegistry::instance().get(compHandle);
    const auto x = AssemblyHierarchy::instance().worldTransform(id);
    gp_Trsf tr = toOcctTrsf(x);
    BRepBuilderAPI_Transform mover(shape, tr, /*copy*/ Standard_True);
    return mover.Shape();
}

double solidVolume(const TopoDS_Shape& s) {
    if (s.IsNull()) return 0.0;
    GProp_GProps props;
    BRepGProp::VolumeProperties(s, props);
    const double v = props.Mass();
    return std::abs(v);
}

} // namespace

std::vector<InterferencePair> detectInterference(
    const std::vector<InstanceId>& instances,
    double tolerance) {
    std::vector<InterferencePair> out;
    if (instances.size() < 2) return out;

    // ---- broad phase: cache inflated world AABBs ------------------
    std::vector<AABB> boxes;
    boxes.reserve(instances.size());
    for (auto id : instances) {
        if (!ComponentRegistry::instance().exists(id)) {
            throw std::invalid_argument(
                "detectInterference: instance does not exist");
        }
        boxes.push_back(inflated(ComponentRegistry::instance().getAABB(id),
                                 std::max(0.0, tolerance)));
    }

    // ---- pair enumeration ------------------------------------------
    // The general assembly target for Forge-35 is small (≤ a few hundred
    // moving parts at a time). A direct O(N²) AABB sweep on this scale
    // beats the cost of building a one-shot BVH for what is typically a
    // < 100-instance subset. Larger subsets fall back through the same
    // overlap test — the worst case is still milliseconds.
    for (std::size_t i = 0; i + 1 < instances.size(); ++i) {
        for (std::size_t j = i + 1; j < instances.size(); ++j) {
            if (!boxes[i].intersects(boxes[j])) continue;
            // ---- narrow phase: exact solid intersection -----------
            TopoDS_Shape sa = worldShape(instances[i]);
            TopoDS_Shape sb = worldShape(instances[j]);
            BRepAlgoAPI_Common op(sa, sb);
            op.Build();
            if (!op.IsDone()) continue;
            TopoDS_Shape inter = op.Shape();
            if (inter.IsNull()) continue;
            const double v = solidVolume(inter);
            if (v < kInterferenceMinVolume) continue;
            out.push_back({instances[i], instances[j], v});
        }
    }

    std::sort(out.begin(), out.end(),
              [](const InterferencePair& a, const InterferencePair& b) {
                  if (a.instA != b.instA) return a.instA < b.instA;
                  return a.instB < b.instB;
              });
    return out;
}

} // namespace forge
