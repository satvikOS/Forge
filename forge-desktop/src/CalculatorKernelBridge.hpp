// forge-desktop/src/CalculatorKernelBridge.hpp
//
// GENERATED FILE -- DO NOT EDIT BY HAND.
//   written by implementation/sacrosanct/tools/gen_calculator_schema.py
//
// The one place a kernel calculator's struct members are named in the
// application, and it is DERIVED: every assignment below is read out of the
// kernel header that declares it, in declaration order, so a member that is
// renamed or reordered cannot be silently paired with the wrong number. CI
// runs the generator's --check, so a header that moves and leaves this file
// behind is red.
//
// evaluate() THROWS whatever the kernel throws. The kernel reports a bad
// input in its own notation, which is not something a user can act on, so
// the caller catches it and answers with a sentence instead.
#ifndef FORGE_DESKTOP_CALCULATORKERNELBRIDGE_HPP
#define FORGE_DESKTOP_CALCULATORKERNELBRIDGE_HPP

#include <optional>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/CircularPipeFlow.hpp"
#include "forge/PitotTube.hpp"
#include "forge/PumpNpsh.hpp"

namespace forge::desktop::calcbridge {

// Fills `out` with one value per declared output, in declaration order, and
// returns true. False means this build carries no calculator by that id, or
// a declared input was absent from `params`.
inline bool evaluate(const std::string& calculatorId,
                     const forge::ui::CommandParams& params,
                     std::vector<double>& out) {
  bool complete = true;
  const auto num = [&](const char* field) -> double {
    const std::optional<double> v = params.number(field);
    if (!v.has_value()) { complete = false; return 0.0; }
    return *v;
  };
  const auto flag = [&](const char* field) -> bool {
    const std::optional<bool> v = params.flag(field);
    if (!v.has_value()) { complete = false; return false; }
    return *v;
  };
  (void)num;
  (void)flag;
  out.clear();

  if (calculatorId == "flow_circular_pipe") {
    forge::circpipe::Input in{};
    in.pipeDiameterM = num("pipeDiameterM");
    in.waterDepthM = num("waterDepthM");
    in.manningN = num("manningN");
    in.slope = num("slope");
    if (!complete) return false;
    const forge::circpipe::Result r = forge::circpipe::analyse(in);
    out.reserve(11);
    out.push_back(r.depthRatio);
    out.push_back(r.centralAngleRad);
    out.push_back(r.flowAreaM2);
    out.push_back(r.wettedPerimeterM);
    out.push_back(r.hydraulicRadiusM);
    out.push_back(r.velocityMs);
    out.push_back(r.dischargeM3S);
    out.push_back(r.dischargeLs);
    out.push_back(r.areaRatio);
    out.push_back(r.velocityRatio);
    out.push_back(r.dischargeRatio);
    return true;
  }

  if (calculatorId == "flow_pitot_tube") {
    forge::pitot::Input in{};
    in.dynamicPressurePa = num("dynamicPressurePa");
    in.densityKgM3 = num("densityKgM3");
    in.pitotCoefficient = num("pitotCoefficient");
    in.flowAreaM2 = num("flowAreaM2");
    if (!complete) return false;
    const forge::pitot::Result r = forge::pitot::analyse(in);
    out.reserve(4);
    out.push_back(r.velocityMs);
    out.push_back(r.velocityHeadM);
    out.push_back(r.volumeFlowM3S);
    out.push_back(r.massFlowKgS);
    return true;
  }

  if (calculatorId == "pump_suction_margin") {
    forge::pumpnpsh::Input in{};
    in.atmosphericPressurePa = num("atmosphericPressurePa");
    in.vapourPressurePa = num("vapourPressurePa");
    in.densityKgM3 = num("densityKgM3");
    in.staticSuctionHeadM = num("staticSuctionHeadM");
    in.frictionHeadM = num("frictionHeadM");
    in.requiredNpshM = num("requiredNpshM");
    if (!complete) return false;
    const forge::pumpnpsh::Result r = forge::pumpnpsh::analyse(in);
    out.reserve(6);
    out.push_back(r.pressureHeadM);
    out.push_back(r.availableNpshM);
    out.push_back(r.marginM);
    out.push_back(r.marginPct);
    out.push_back(r.cavitating ? 1.0 : 0.0);
    out.push_back(r.marginalPerHi ? 1.0 : 0.0);
    return true;
  }

  return false;
}

}  // namespace forge::desktop::calcbridge

#endif  // FORGE_DESKTOP_CALCULATORKERNELBRIDGE_HPP
