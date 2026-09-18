// ui/include/forge/ui/CalculatorSchema.hpp
//
// GENERATED FILE -- DO NOT EDIT BY HAND.
//   written by implementation/sacrosanct/tools/gen_calculator_schema.py
//   from       implementation/sacrosanct/forge_calculator_schema.json
//
// Every field below is READ OUT OF THE KERNEL'S OWN HEADER: the names, the
// C++ types and the order are the declaration's, not a second list kept
// beside it. Regenerate with --write; CI runs --check, so a kernel header
// that moves and leaves this file behind is red rather than quietly wrong.
#ifndef FORGE_UI_CALCULATORSCHEMA_HPP
#define FORGE_UI_CALCULATORSCHEMA_HPP

#include <cstddef>
#include <cstdint>

namespace forge::ui {

// What kind of box a field gets, and what kind of number comes back.
enum class CalculatorValueKind : std::uint8_t { Number, Flag };

// One number the calculation consumes or produces.
struct CalculatorFieldSchema {
  // The kernel's own member name. It is a MACHINE key -- it addresses the
  // parameter in a CommandParams and is what a macro stores. It is never
  // drawn; `label` is what a person reads.
  const char* name;
  const char* label;
  // The unit as a person writes it, or "" when the quantity has none.
  const char* unit;
  CalculatorValueKind kind;
};

// One calculator: a command id, what it is called, and the two field lists.
struct CalculatorSchema {
  const char* id;
  const char* commandId;
  const char* label;
  const char* summary;
  // ── A MACHINE FIELD. NEVER DRAWN. ─────────────────────────────────
  // The kernel header this calculator was derived FROM, so a gate can open
  // it and re-derive the field list in C++ -- a SECOND derivation of the
  // same fact, which is the only way a generator's output is evidence
  // rather than a promise. It is a file path: scanUserFacingProse() reports
  // it as one, and ui/test/engineering_calculator_test.cpp asserts that it
  // does, so drawing this string anywhere is a red gate.
  const char* kernelHeaderPath;
  const CalculatorFieldSchema* inputs;
  std::size_t inputCount;
  const CalculatorFieldSchema* outputs;
  std::size_t outputCount;
};

inline constexpr CalculatorFieldSchema kFlowCircularPipe_Inputs[] = {
    {"pipeDiameterM", "Pipe bore", "m", CalculatorValueKind::Number},
    {"waterDepthM", "Water depth", "m", CalculatorValueKind::Number},
    {"manningN", "Manning roughness coefficient", "", CalculatorValueKind::Number},
    {"slope", "Slope of the pipe", "m/m", CalculatorValueKind::Number},
};
inline constexpr CalculatorFieldSchema kFlowCircularPipe_Outputs[] = {
    {"depthRatio", "Depth against the bore", "", CalculatorValueKind::Number},
    {"centralAngleRad", "Angle the water surface subtends", "rad", CalculatorValueKind::Number},
    {"flowAreaM2", "Area carrying water", "m2", CalculatorValueKind::Number},
    {"wettedPerimeterM", "Wetted perimeter", "m", CalculatorValueKind::Number},
    {"hydraulicRadiusM", "Hydraulic radius", "m", CalculatorValueKind::Number},
    {"velocityMs", "Velocity", "m/s", CalculatorValueKind::Number},
    {"dischargeM3S", "Volume flow", "m3/s", CalculatorValueKind::Number},
    {"dischargeLs", "Volume flow", "L/s", CalculatorValueKind::Number},
    {"areaRatio", "Area against a full pipe", "", CalculatorValueKind::Number},
    {"velocityRatio", "Velocity against a full pipe", "", CalculatorValueKind::Number},
    {"dischargeRatio", "Flow against a full pipe", "", CalculatorValueKind::Number},
};

inline constexpr CalculatorFieldSchema kFlowPitotTube_Inputs[] = {
    {"dynamicPressurePa", "Pressure the probe reads", "Pa", CalculatorValueKind::Number},
    {"densityKgM3", "Density of the fluid", "kg/m3", CalculatorValueKind::Number},
    {"pitotCoefficient", "Probe coefficient", "", CalculatorValueKind::Number},
    {"flowAreaM2", "Area of the duct", "m2", CalculatorValueKind::Number},
};
inline constexpr CalculatorFieldSchema kFlowPitotTube_Outputs[] = {
    {"velocityMs", "Velocity", "m/s", CalculatorValueKind::Number},
    {"velocityHeadM", "Velocity head", "m", CalculatorValueKind::Number},
    {"volumeFlowM3S", "Volume flow", "m3/s", CalculatorValueKind::Number},
    {"massFlowKgS", "Mass flow", "kg/s", CalculatorValueKind::Number},
};

inline constexpr CalculatorFieldSchema kPumpSuctionMargin_Inputs[] = {
    {"atmosphericPressurePa", "Pressure above the liquid", "Pa", CalculatorValueKind::Number},
    {"vapourPressurePa", "Pressure at which it boils", "Pa", CalculatorValueKind::Number},
    {"densityKgM3", "Density of the liquid", "kg/m3", CalculatorValueKind::Number},
    {"staticSuctionHeadM", "Height of the liquid above the pump", "m", CalculatorValueKind::Number},
    {"frictionHeadM", "Head lost in the suction pipe", "m", CalculatorValueKind::Number},
    {"requiredNpshM", "Suction head the pump needs", "m", CalculatorValueKind::Number},
};
inline constexpr CalculatorFieldSchema kPumpSuctionMargin_Outputs[] = {
    {"pressureHeadM", "Head from the pressure above the liquid", "m", CalculatorValueKind::Number},
    {"availableNpshM", "Suction head available", "m", CalculatorValueKind::Number},
    {"marginM", "Margin over what the pump needs", "m", CalculatorValueKind::Number},
    {"marginPct", "Margin over what the pump needs", "%", CalculatorValueKind::Number},
    {"cavitating", "The liquid would boil at the inlet", "", CalculatorValueKind::Flag},
    {"marginalPerHi", "The margin is under the recommended minimum", "", CalculatorValueKind::Flag},
};

inline constexpr CalculatorSchema kCalculatorSchemas[] = {
    {"flow_circular_pipe",
     "sim.flow_circular_pipe",
     "Partly Full Pipe Flow",
     "How much water a round pipe carries when it is not running full, from its bore, its slope and how deep the water is.",
     "forge-kernel/include/forge/CircularPipeFlow.hpp",
     kFlowCircularPipe_Inputs, 4, kFlowCircularPipe_Outputs, 11},
    {"flow_pitot_tube",
     "sim.flow_pitot_tube",
     "Pitot Tube Velocity",
     "How fast a stream is moving, from the pressure a Pitot tube reads in it, and the flow that carries through a duct of known area.",
     "forge-kernel/include/forge/PitotTube.hpp",
     kFlowPitotTube_Inputs, 4, kFlowPitotTube_Outputs, 4},
    {"pump_suction_margin",
     "sim.pump_suction_margin",
     "Pump Suction Margin",
     "Whether a pump has enough suction pressure to run without the liquid boiling at its inlet.",
     "forge-kernel/include/forge/PumpNpsh.hpp",
     kPumpSuctionMargin_Inputs, 6, kPumpSuctionMargin_Outputs, 6},
};

inline constexpr std::size_t kCalculatorSchemaCount =
    sizeof(kCalculatorSchemas) / sizeof(kCalculatorSchemas[0]);

}  // namespace forge::ui

#endif  // FORGE_UI_CALCULATORSCHEMA_HPP
