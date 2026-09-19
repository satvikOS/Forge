// forge-desktop/test/calculator_value_gate.cpp
//
// A3: DISPATCHING THE COMMAND RETURNS THE SAME VALUE AS CALLING THE KERNEL.
//
// This is the only claim T-169 makes that cannot be checked in ui/test: nothing
// under ui/ links the kernel, which is exactly what lets that suite run
// headless. So the comparison lives here, where both arms are linked at once.
//
// ── why the right-hand arm is written out by hand ───────────────────────────
// Everywhere else in this subsystem a hand-written field list is the defect --
// the form schema and the kernel bridge are both GENERATED from the kernel
// headers so that no field name exists twice. Here it is the requirement. A
// gate whose two arms are produced by the same generator compares that generator
// against itself and would stay green through any consistent mistake it made.
// The left arm goes through the registry, the command id, the generated bridge
// and the bench; the right arm names forge::circpipe::Input and its members
// directly, the way a user of the kernel would. They are independent, and they
// must agree.
//
// ── the tolerance, and why it is what it is ─────────────────────────────────
// Both arms call the SAME function on the SAME doubles, so the honest
// expectation is bit-equality, and the gate reports the largest difference it
// actually saw. kTolerance is a relative 1e-12 rather than 0 only so that a
// future arm which re-associates an arithmetic expression fails for being
// WRONG rather than for being rounded; a run that needs any of it prints the
// number it needed.
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <string>
#include <vector>

#include "CalculatorHost.hpp"
#include "forge/CircularPipeFlow.hpp"
#include "forge/PitotTube.hpp"
#include "forge/PumpNpsh.hpp"
#include "forge/ui/CalculatorSchema.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/EngineeringCalculators.hpp"
#include "forge/ui/SelectionService.hpp"

namespace {

constexpr double kTolerance = 1.0e-12;

std::size_t g_checks = 0;
std::size_t g_failures = 0;
double g_worstRelative = 0.0;

void check(bool ok, const std::string& what) {
  ++g_checks;
  if (ok) return;
  ++g_failures;
  std::printf("  FAIL %s\n", what.c_str());
}

// Compare one number from the dispatched answer against the same number from the
// direct call, and remember the worst relative gap the run saw.
void sameValue(const forge::ui::CalculatorOutcome& answer, std::size_t index, double direct,
               const char* calculator, const char* field) {
  ++g_checks;
  if (index >= answer.readings.size()) {
    ++g_failures;
    std::printf("  FAIL %s: no reading at position %zu for %s\n", calculator, index, field);
    return;
  }
  const double dispatched = answer.readings[index].value;
  const double scale = std::fabs(direct) > 1.0 ? std::fabs(direct) : 1.0;
  const double relative = std::fabs(dispatched - direct) / scale;
  if (relative > g_worstRelative) g_worstRelative = relative;
  if (relative <= kTolerance) return;
  ++g_failures;
  std::printf("  FAIL %s.%s: dispatched %.17g, kernel %.17g, relative %.3g\n", calculator, field,
              dispatched, direct, relative);
}

// Run a command through the ONE registry every menu, shortcut and agent call
// goes through, and hand back what the bench recorded.
const forge::ui::CalculatorOutcome& dispatched(forge::ui::CommandRegistry& registry,
                                               forge::ui::CalculatorBench& bench,
                                               const forge::ui::SelectionService& selection,
                                               const char* commandId,
                                               const forge::ui::CommandParams& params) {
  const forge::ui::DispatchResult r = registry.dispatch(commandId, selection, params);
  check(r.ok(), std::string("dispatch ") + commandId + " -- " + r.detail);
  check(bench.lastOutcome().computed, std::string("an answer came back from ") + commandId);
  return bench.lastOutcome();
}

}  // namespace

int main() {
  forge::ui::CommandRegistry registry;
  forge::ui::CalculatorBench bench;
  bench.bind(forge::desktop::kernelCalculatorEvaluator());
  const std::size_t added = forge::ui::registerCalculatorCommands(registry, bench);
  std::printf("[calcvalue] %zu calculator commands registered into a registry of %zu\n", added,
              registry.size());
  check(added == forge::ui::kCalculatorSchemaCount, "every compiled calculator registered");
  check(added > 0, "the family is not empty");

  forge::ui::SelectionService selection;

  // ── partly full circular pipe ────────────────────────────────────────────
  {
    struct Case {
      double diameter, depth, manning, slope;
    };
    const Case cases[] = {
        {0.600, 0.300, 0.0130, 0.00200},  // half-full concrete storm drain
        {0.300, 0.075, 0.0240, 0.01000},  // quarter-full corrugated metal, steep
        {1.200, 1.050, 0.0110, 0.00050},  // nearly full, smooth, nearly flat
    };
    for (const Case& c : cases) {
      forge::ui::CommandParams p;
      p.setNumber("pipeDiameterM", c.diameter);
      p.setNumber("waterDepthM", c.depth);
      p.setNumber("manningN", c.manning);
      p.setNumber("slope", c.slope);
      const forge::ui::CalculatorOutcome& a =
          dispatched(registry, bench, selection, "sim.flow_circular_pipe", p);

      forge::circpipe::Input in{};
      in.pipeDiameterM = c.diameter;
      in.waterDepthM = c.depth;
      in.manningN = c.manning;
      in.slope = c.slope;
      const forge::circpipe::Result k = forge::circpipe::analyse(in);

      sameValue(a, 0, k.depthRatio, "flow_circular_pipe", "depthRatio");
      sameValue(a, 1, k.centralAngleRad, "flow_circular_pipe", "centralAngleRad");
      sameValue(a, 2, k.flowAreaM2, "flow_circular_pipe", "flowAreaM2");
      sameValue(a, 3, k.wettedPerimeterM, "flow_circular_pipe", "wettedPerimeterM");
      sameValue(a, 4, k.hydraulicRadiusM, "flow_circular_pipe", "hydraulicRadiusM");
      sameValue(a, 5, k.velocityMs, "flow_circular_pipe", "velocityMs");
      sameValue(a, 6, k.dischargeM3S, "flow_circular_pipe", "dischargeM3S");
      sameValue(a, 7, k.dischargeLs, "flow_circular_pipe", "dischargeLs");
      sameValue(a, 8, k.areaRatio, "flow_circular_pipe", "areaRatio");
      sameValue(a, 9, k.velocityRatio, "flow_circular_pipe", "velocityRatio");
      sameValue(a, 10, k.dischargeRatio, "flow_circular_pipe", "dischargeRatio");
      // A run in which every number is zero would pass every comparison above.
      check(k.dischargeM3S > 0.0, "the pipe carries water");
    }
  }

  // ── Pitot tube ───────────────────────────────────────────────────────────
  {
    struct Case {
      double dynamicPressure, density, coefficient, area;
    };
    const Case cases[] = {
        {250.0, 1.204, 1.00, 0.0500},   // room air through a small duct
        {2500.0, 998.0, 0.98, 0.0314},  // water in a 200 mm main
        {40.0, 1.225, 1.00, 0.0000},    // slow air, area left out on purpose
    };
    for (const Case& c : cases) {
      forge::ui::CommandParams p;
      p.setNumber("dynamicPressurePa", c.dynamicPressure);
      p.setNumber("densityKgM3", c.density);
      p.setNumber("pitotCoefficient", c.coefficient);
      p.setNumber("flowAreaM2", c.area);
      const forge::ui::CalculatorOutcome& a =
          dispatched(registry, bench, selection, "sim.flow_pitot_tube", p);

      forge::pitot::Input in{};
      in.dynamicPressurePa = c.dynamicPressure;
      in.densityKgM3 = c.density;
      in.pitotCoefficient = c.coefficient;
      in.flowAreaM2 = c.area;
      const forge::pitot::Result k = forge::pitot::analyse(in);

      sameValue(a, 0, k.velocityMs, "flow_pitot_tube", "velocityMs");
      sameValue(a, 1, k.velocityHeadM, "flow_pitot_tube", "velocityHeadM");
      sameValue(a, 2, k.volumeFlowM3S, "flow_pitot_tube", "volumeFlowM3S");
      sameValue(a, 3, k.massFlowKgS, "flow_pitot_tube", "massFlowKgS");
      check(k.velocityMs > 0.0, "the stream is moving");
    }
  }

  // ── pump suction margin ──────────────────────────────────────────────────
  {
    struct Case {
      double atmospheric, vapour, density, staticHead, friction, required;
    };
    const Case cases[] = {
        {101325.0, 2339.0, 998.0, -2.00, 1.20, 3.0},   // suction lift, comfortable
        {101325.0, 84550.0, 962.0, -1.00, 1.50, 3.0},  // 95 C water on a suction lift
        {90000.0, 2339.0, 998.0, 4.00, 0.40, 2.0},     // flooded suction at altitude
    };
    // The two verdicts this calculator exists to give. A gate in which every
    // case comes back the same way has not tested the boolean at all -- the
    // first version of this file had all three healthy and said so.
    bool sawCavitating = false;
    bool sawHealthy = false;
    for (const Case& c : cases) {
      forge::ui::CommandParams p;
      p.setNumber("atmosphericPressurePa", c.atmospheric);
      p.setNumber("vapourPressurePa", c.vapour);
      p.setNumber("densityKgM3", c.density);
      p.setNumber("staticSuctionHeadM", c.staticHead);
      p.setNumber("frictionHeadM", c.friction);
      p.setNumber("requiredNpshM", c.required);
      const forge::ui::CalculatorOutcome& a =
          dispatched(registry, bench, selection, "sim.pump_suction_margin", p);

      forge::pumpnpsh::Input in{};
      in.atmosphericPressurePa = c.atmospheric;
      in.vapourPressurePa = c.vapour;
      in.densityKgM3 = c.density;
      in.staticSuctionHeadM = c.staticHead;
      in.frictionHeadM = c.friction;
      in.requiredNpshM = c.required;
      const forge::pumpnpsh::Result k = forge::pumpnpsh::analyse(in);

      sameValue(a, 0, k.pressureHeadM, "pump_suction_margin", "pressureHeadM");
      sameValue(a, 1, k.availableNpshM, "pump_suction_margin", "availableNpshM");
      sameValue(a, 2, k.marginM, "pump_suction_margin", "marginM");
      sameValue(a, 3, k.marginPct, "pump_suction_margin", "marginPct");
      // The two booleans travel as 1 and 0 and must arrive as the same verdict.
      sameValue(a, 4, k.cavitating ? 1.0 : 0.0, "pump_suction_margin", "cavitating");
      sameValue(a, 5, k.marginalPerHi ? 1.0 : 0.0, "pump_suction_margin", "marginalPerHi");
      check(a.readings.size() > 4 && a.readings[4].isFlag, "a verdict arrives as a yes/no");
      if (k.cavitating) sawCavitating = true;
      if (!k.cavitating) sawHealthy = true;
    }
    // A boolean that is false in every case is a boolean this gate never tested.
    check(sawCavitating, "one case cavitates");
    check(sawHealthy, "one case does not");
  }

  std::printf("[calcvalue] %zu checks, %zu failures, worst relative difference %.3g (tolerance "
              "%.1g)\n",
              g_checks, g_failures, g_worstRelative, kTolerance);
  // A run that compared nothing is not a pass. 3 calculators x 3 cases x their
  // outputs is 63 value comparisons; the floor is deliberately well under that
  // so it catches "compared nothing" rather than pinning a number that a new
  // case would have to chase.
  if (g_checks < 40) {
    std::printf("[calcvalue] FAIL -- only %zu checks ran; this gate compared almost nothing\n",
                g_checks);
    return 1;
  }
  std::printf("[calcvalue] %s\n", g_failures == 0 ? "PASS" : "FAIL");
  return g_failures == 0 ? 0 : 1;
}
