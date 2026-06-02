#include "forge/SketchDof.hpp"

#include <unordered_map>

namespace forge { namespace sketchdof {

namespace {

std::unordered_map<std::string, std::int32_t> entityTable() {
    return {
        {"point",  2},
        {"line",   4},
        {"circle", 3},
        {"arc",    5},
    };
}

std::unordered_map<std::string, std::int32_t> constraintTable() {
    return {
        {"fix",           2},
        {"coincident",    2},
        {"horizontal",    1},
        {"vertical",      1},
        {"distance",      1},
        {"radius",        1},
        {"diameter",      1},
        {"angle",         1},
        {"parallel",      1},
        {"perpendicular", 1},
        {"tangent",       1},
        {"equal",         1},
        {"concentric",    2},
        {"symmetric",     2},
        {"midpoint",      2},
    };
}

void applyOverrides(std::unordered_map<std::string, std::int32_t>& tbl,
                    const std::vector<CustomDof>& overrides) {
    for (const auto& o : overrides) tbl[o.kind] = o.dof;
}

} // namespace

Outputs audit(const Inputs& in) {
    auto eTbl = entityTable();
    auto cTbl = constraintTable();
    applyOverrides(eTbl, in.entityOverrides);
    applyOverrides(cTbl, in.constraintOverrides);

    Outputs out{};
    out.totalEntities    = static_cast<std::uint32_t>(in.entities.size());
    out.totalConstraints = static_cast<std::uint32_t>(in.constraints.size());

    for (const auto& e : in.entities) {
        auto it = eTbl.find(e.kind);
        if (it != eTbl.end()) out.totalDof += it->second;
    }
    for (const auto& c : in.constraints) {
        auto it = cTbl.find(c.kind);
        if (it != cTbl.end()) out.constrainedDof += it->second;
    }
    out.freeDof = out.totalDof - out.constrainedDof;
    if      (out.freeDof > 0) out.status = "under";
    else if (out.freeDof < 0) out.status = "over";
    else                      out.status = "fully";
    return out;
}

}} // namespace forge::sketchdof
