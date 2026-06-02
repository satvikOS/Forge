#pragma once

// Forge-179 — Cost estimation engine.
//
// Per-body cost model:
//   unit_cost  = material_cost + machining_cost + setup_cost + labour_cost
//   material   = mass_kg × $/kg
//   machining  = (stock_volume_cm3 − final_volume_cm3) / MRR × $/min
//   setup      = per-process setup minutes × $/min (one-shot)
//   labour     = (machining_time + setup_time) × labour_rate (overhead)
//   batch      = qty × unit  −  volume discount curve
//
// Tornado-chart sensitivity: vary each independent input by ±20 %, rank
// the resulting unit-cost deltas to identify the top driver.

#include <cstdint>
#include <string>
#include <vector>

namespace forge { namespace cost {

struct MaterialCatalogueEntry {
    std::string name;
    double densityKgM3;
    double pricePerKgUSD;
    // Material-removal rate per tool family (cm³/min)
    double mrrEndmillCm3Min;
    double mrrDrillCm3Min;
    double mrrTurnCm3Min;
    double co2PerKg;     // kgCO2e per kg material — placeholder for Forge-180
};

struct ProcessEntry {
    std::string name;
    double setupMin;
    double labourUsdMin;
};

struct BodyCost {
    std::string materialName;
    double      volumeCm3;          // finished body volume
    double      stockVolumeCm3;     // raw stock volume (≥ finished)
    std::string processName;        // 'CNC mill', 'lathe', etc.
    // Optional override of tool: 0 = endmill, 1 = drill, 2 = turn
    int         toolFamily;
    int         qty;
};

struct CostBreakdownLine {
    std::string label;
    double      usd;
};

struct CostResult {
    double unitMaterialUsd;
    double unitMachiningUsd;
    double unitSetupUsd;
    double unitLabourUsd;
    double unitUsd;
    double batchUsd;
    double machiningTimeMin;
    double massKg;
    // Cost-driver tornado: sorted descending by absolute delta when each
    // input is perturbed ±20 %.
    std::vector<CostBreakdownLine> tornado;
};

struct CostInputs {
    BodyCost                              body;
    std::vector<MaterialCatalogueEntry>   materials;
    std::vector<ProcessEntry>             processes;
};

CostResult computeUnitCost(const CostInputs& inputs);

// Convenience: aggregate across a list of bodies in one project.
struct ProjectCostResult {
    double totalMaterialUsd;
    double totalMachiningUsd;
    double totalSetupUsd;
    double totalLabourUsd;
    double totalUsd;
    int    totalQty;
    std::vector<CostResult> perBody;
};

ProjectCostResult computeProjectCost(const std::vector<CostInputs>& inputs);

}} // namespace forge::cost
