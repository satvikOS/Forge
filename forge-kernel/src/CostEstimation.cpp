#include "forge/CostEstimation.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge { namespace cost {

namespace {

const MaterialCatalogueEntry* findMaterial(
        const std::vector<MaterialCatalogueEntry>& catalogue,
        const std::string& name) {
    for (const auto& m : catalogue) {
        if (m.name == name) return &m;
    }
    return nullptr;
}

const ProcessEntry* findProcess(
        const std::vector<ProcessEntry>& cat, const std::string& name) {
    for (const auto& p : cat) {
        if (p.name == name) return &p;
    }
    return nullptr;
}

double pickMrr(const MaterialCatalogueEntry& m, int family) {
    if (family == 0) return m.mrrEndmillCm3Min;
    if (family == 1) return m.mrrDrillCm3Min;
    return m.mrrTurnCm3Min;
}

CostResult coreCompute(const CostInputs& in) {
    if (in.body.volumeCm3 <= 0) {
        throw std::invalid_argument("forge.cost: body volume must be > 0");
    }
    if (in.body.qty <= 0) {
        throw std::invalid_argument("forge.cost: qty must be ≥ 1");
    }
    if (in.body.stockVolumeCm3 < in.body.volumeCm3) {
        throw std::invalid_argument("forge.cost: stockVolume must be ≥ body volume");
    }
    const auto* mat = findMaterial(in.materials, in.body.materialName);
    if (!mat) {
        throw std::invalid_argument(
            "forge.cost: material '" + in.body.materialName + "' not in catalogue");
    }
    const auto* proc = findProcess(in.processes, in.body.processName);
    if (!proc) {
        throw std::invalid_argument(
            "forge.cost: process '" + in.body.processName + "' not in catalogue");
    }
    const double rho = mat->densityKgM3;
    const double massKg = (in.body.volumeCm3 / 1.0e6) * rho;
    const double materialUsd = massKg * mat->pricePerKgUSD;
    const double mrr = std::max(0.001, pickMrr(*mat, in.body.toolFamily));
    const double removalCm3 = in.body.stockVolumeCm3 - in.body.volumeCm3;
    const double machiningMin = removalCm3 / mrr;
    const double machiningUsd = machiningMin * proc->labourUsdMin;
    const double setupUsd = proc->setupMin * proc->labourUsdMin;
    const double labourUsd = 0.0;  // already folded into machining + setup
    const double unit = materialUsd + machiningUsd + setupUsd + labourUsd;
    const double batchUsd = unit * in.body.qty;

    CostResult R;
    R.unitMaterialUsd  = materialUsd;
    R.unitMachiningUsd = machiningUsd;
    R.unitSetupUsd     = setupUsd;
    R.unitLabourUsd    = labourUsd;
    R.unitUsd          = unit;
    R.batchUsd         = batchUsd;
    R.machiningTimeMin = machiningMin;
    R.massKg           = massKg;
    return R;
}

} // anonymous namespace

CostResult computeUnitCost(const CostInputs& in) {
    CostResult R = coreCompute(in);

    // Tornado: perturb each input ±20 %, compute Δunit, sort by |Δ|.
    auto perturb = [&](double scale, auto mutator) {
        CostInputs copy = in;
        mutator(copy);
        try {
            const CostResult p = coreCompute(copy);
            return p.unitUsd - R.unitUsd;
        } catch (...) { return 0.0; }
        (void)scale;
    };
    std::vector<CostBreakdownLine> trn;
    trn.push_back({"material +20%",  perturb(1.2, [&](CostInputs& c){ c.materials[0].pricePerKgUSD *= 1.2; })});
    trn.push_back({"volume +20%",    perturb(1.2, [&](CostInputs& c){ c.body.volumeCm3 *= 1.2; c.body.stockVolumeCm3 *= 1.2; })});
    trn.push_back({"stock +20%",     perturb(1.2, [&](CostInputs& c){ c.body.stockVolumeCm3 *= 1.2; })});
    trn.push_back({"MRR -20%",       perturb(0.8, [&](CostInputs& c){ c.materials[0].mrrEndmillCm3Min *= 0.8;
                                                                       c.materials[0].mrrDrillCm3Min   *= 0.8;
                                                                       c.materials[0].mrrTurnCm3Min    *= 0.8; })});
    trn.push_back({"labour +20%",    perturb(1.2, [&](CostInputs& c){ c.processes[0].labourUsdMin *= 1.2; })});
    trn.push_back({"setup +20%",     perturb(1.2, [&](CostInputs& c){ c.processes[0].setupMin *= 1.2; })});

    std::sort(trn.begin(), trn.end(), [](const CostBreakdownLine& a, const CostBreakdownLine& b){
        return std::abs(a.usd) > std::abs(b.usd);
    });
    R.tornado = std::move(trn);
    return R;
}

ProjectCostResult computeProjectCost(const std::vector<CostInputs>& inputs) {
    ProjectCostResult P{};
    P.perBody.reserve(inputs.size());
    for (const auto& in : inputs) {
        const CostResult r = computeUnitCost(in);
        P.totalMaterialUsd  += r.unitMaterialUsd  * in.body.qty;
        P.totalMachiningUsd += r.unitMachiningUsd * in.body.qty;
        P.totalSetupUsd     += r.unitSetupUsd     * in.body.qty;
        P.totalLabourUsd    += r.unitLabourUsd    * in.body.qty;
        P.totalUsd          += r.batchUsd;
        P.totalQty          += in.body.qty;
        P.perBody.push_back(r);
    }
    return P;
}

}} // namespace forge::cost
