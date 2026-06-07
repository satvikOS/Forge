import React from 'react';
import { ForgeShellV4 } from './forge-v4/ForgeShellV4.jsx';
import { DirectEditPanelHost } from './forge-v4/DirectEditPanel.jsx';
import { HealPanelHost } from './forge-v4/HealPanel.jsx';
import { SurfacingPanelHost } from './forge-v4/SurfacingPanel.jsx';
import { FlatPatternHost } from './forge-v4/FlatPatternView.jsx';
import { SurfaceAnalysisOverlayHost } from './forge-v4/SurfaceAnalysisOverlay.jsx';
import { ManufacturingWorkbenchHost } from './forge-v4/ManufacturingWorkbench.jsx';
import { WeldmentsWorkbenchHost } from './forge-v4/WeldmentsWorkbench.jsx';
import { StandardPartsLibraryHost } from './forge-v4/StandardPartsLibrary.jsx';
import { ProjectBundlePanelHost } from './forge-v4/ProjectBundlePanel.jsx';
import { ProjectFilePanelHost } from './forge-v4/ProjectFilePanel.jsx';
import { IfcExportPanelHost } from './forge-v4/IfcExportPanel.jsx';
import { ViewportEnvironmentProvider } from './forge-v4/ViewportEnvironment.jsx';
import { PerfStatsHUD } from './forge-v4/PerfStatsHUD.jsx';
import { HoverTooltip } from './forge-v4/HoverTooltip.jsx';
import { SectionControlHost } from './forge-v4/SectionControl.jsx';
import { AssemblyTreePanelHost } from './forge-v4/AssemblyTreePanel.jsx';
import { AssemblyPanelHost } from './forge-v4/AssemblyPanel.jsx';
import { BomPanelHost } from './forge-v4/BomPanel.jsx';
import { PdmPanelHost } from './forge-v4/PdmPanel.jsx';
// PUSH-14: real PDM vault (JSON-backed via pdm:* IPC). Coexists with the
// legacy PdmPanel cosmetic UI.
import { PDMWorkbenchHost } from './forge-v4/PDMWorkbench.jsx';
// PUSH-16: macro recorder + playback (window.forge.macros surface).
import { MacroRecorderHost } from './forge-v4/MacroRecorder.jsx';
// PUSH-17: materials library + exploded view (window.forge.materials surface).
import { MaterialsLibraryHost, ExplodedViewHost } from './forge-v4/MaterialsLibrary.jsx';
// PUSH-13: standard parts browser (ISO / ANSI / DIN / SKF / AISC / ASME / AGMA).
import './forge-v4/StandardPartsCatalog.js';
import { StandardPartsBrowserHost } from './forge-v4/StandardPartsBrowser.jsx';
// PUSH-12: PMI / GD&T workbench (window.forge.pmi surface).
import { PMIWorkbenchHost } from './forge-v4/PMIAnnotations.jsx';
// PUSH-09: Routing (piping + cable) workbench (window.forge.routing surface).
import { RoutingWorkbenchHost } from './forge-v4/RoutingWorkbench.jsx';
// PUSH-04: Assembly mate solver (forge::matelib).
import MateSolverWorkbenchHost from './forge-v4/MateSolverWorkbench.jsx';
// PUSH-10: Extended CAM (forge::camx).
import CAMExtendedWorkbenchHost from './forge-v4/CAMExtendedWorkbench.jsx';
// PUSH-15: SIMP topology optimisation.
import TopologyWorkbenchHost from './forge-v4/TopologyWorkbench.jsx';
// PUSH-02: Solid modelling ops (varfillet, loftguide, booleantol).
import SolidOpsWorkbenchHost from './forge-v4/SolidOpsWorkbench.jsx';
// PUSH-03: Sketch constraints (planegcs-backed).
import SketchConstraintsWorkbenchHost from './forge-v4/SketchConstraintsWorkbench.jsx';
// PUSH-05: Drawings HLR + DXF/SVG emit (forge::drawings).
import DrawingsHLRWorkbenchHost from './forge-v4/DrawingsHLRWorkbench.jsx';
// PUSH-08: Mold tooling (forge::mold).
import MoldWorkbenchHost from './forge-v4/MoldWorkbench.jsx';
// PUSH-11: Tet4 FEA (forge::fea::tet).
import FEATetWorkbenchHost from './forge-v4/FEATetWorkbench.jsx';
import { ScenarioRunnerHost } from './forge-v4/ScenarioRunner.jsx';
import { VideoCaptureHUD } from './forge-v4/VideoCaptureHUD.jsx';
import { StressTestPanelHost } from './forge-v4/StressTestPanel.jsx';
import { ProgressStripPortal } from './forge-v4/ProgressStrip.jsx';
import SnapStatusChip from './forge-v4/SnapStatusChip.jsx';
import { ConvergenceChartHost } from './forge-v4/ConvergenceChart.jsx';
import { SkeletonPanelHost } from './forge-v4/SkeletonPanel.jsx';
import { ActionWheelHost } from './forge-v4/ActionWheel.jsx';
import { DemoProjectHost } from './forge-v4/DemoProject.jsx';
import { ShipWorkbenchHost } from './forge-v4/ShipWorkbench.jsx';
import { GenerativeDesignPanelHost } from './forge-v4/GenerativeDesignPanel.jsx';
import { SheetMetalWorkbenchHost } from './forge-v4/SheetMetalWorkbench.jsx';
import { PluginManagerPanelHost } from './forge-v4/PluginManagerPanel.jsx';
import { installForgeAPI } from './forge-v4/forgeAPI.js';
// Forge-135 / 137 / 139 — render room + role switcher + ribbon
// customiser + universal command palette.
import { PathTracedRenderHost } from './forge-v4/PathTracedRender.jsx';
import { RoleSwitcherHost } from './forge-v4/RoleSwitcher.jsx';
import { RibbonCustomiserHost } from './forge-v4/RibbonCustomiser.jsx';
import { CommandPaletteHost } from './forge-v4/CommandPalette.jsx';
// Forge-149 — Draft workbench (FreeCAD Draft parity).
import { DraftWorkbenchHost } from './forge-v4/DraftWorkbench.jsx';
// Forge-153 — Spreadsheet workbench (FreeCAD parametric spreadsheet).
import { SpreadsheetWorkbenchHost } from './forge-v4/SpreadsheetWorkbench.jsx';
// Forge-151 — Mesh workbench (polygonal mesh tools).
import { MeshWorkbenchHost } from './forge-v4/MeshWorkbench.jsx';
// Forge-163 — Slicer workbench (3D-printing Marlin G-code emitter).
import { SlicerWorkbenchHost } from './forge-v4/SlicerWorkbench.jsx';
// Forge-165 — Lattice / metamaterial workbench (TPMS + strut + Gibson-Ashby).
import { LatticeWorkbenchHost } from './forge-v4/LatticeWorkbench.jsx';
// Forge-150 — Arch/BIM workbench (FreeCAD Arch parity).
import { ArchWorkbenchHost } from './forge-v4/ArchWorkbench.jsx';
import { SiteHierarchyHost } from './forge-v4/SiteHierarchy.jsx';
// Forge-152 — Industrial 6-axis robot workbench (KUKA / ABB / FANUC).
import { RobotWorkbenchHost } from './forge-v4/RobotWorkbench.jsx';
// Forge-171 — Aerospace airfoil & wing designer (NACA / Selig / loft).
import { AerospaceWorkbenchHost } from './forge-v4/AerospaceWorkbench.jsx';
// Forge-176 — Geotechnical slope stability (Bishop + Janbu).
import { GeotechWorkbenchHost } from './forge-v4/GeotechWorkbench.jsx';
// Forge-173 — Casting solidification (enthalpy FDM).
import { CastingWorkbenchHost } from './forge-v4/CastingWorkbench.jsx';
// Forge-172 — Injection mould flow (Hele-Shaw + Cross-WLF).
import { MoldFlowWorkbenchHost } from './forge-v4/MoldFlowWorkbench.jsx';
// Forge-175 — Acoustic room simulator (image-source method + Eyring).
import { AcousticsWorkbenchHost } from './forge-v4/AcousticsWorkbench.jsx';
// Forge-174 — Welding distortion FEA (Goldak + thermo-mechanical).
import { WeldingDistortionWorkbenchHost } from './forge-v4/WeldingDistortionWorkbench.jsx';
// Forge-179 — Cost estimation (material × machining × labour).
import { CostWorkbenchHost } from './forge-v4/CostWorkbench.jsx';
// Forge-180 — Carbon-footprint LCA (cradle-to-gate).
import { CarbonLcaWorkbenchHost } from './forge-v4/CarbonLcaWorkbench.jsx';
// Forge-181 — Sun-path + daylight (NOAA SPA).
import { SunPathWorkbenchHost } from './forge-v4/SunPathWorkbench.jsx';
// Forge-185 — Tolerance stack-up (worst-case + RSS + Monte-Carlo).
import { ToleranceStackWorkbenchHost } from './forge-v4/ToleranceStackWorkbench.jsx';
// Forge-186 — HVAC ductwork designer.
import { DuctworkWorkbenchHost } from './forge-v4/DuctworkWorkbench.jsx';
// Forge-187 — Generative variant explorer.
import { VariantExplorerWorkbenchHost } from './forge-v4/VariantExplorerWorkbench.jsx';
// Forge-192 — HVAC psychrometric chart.
import { PsychrometricWorkbenchHost } from './forge-v4/PsychrometricWorkbench.jsx';
// Forge-190 — Electrical schematic + MNA.
import { CircuitWorkbenchHost } from './forge-v4/CircuitWorkbench.jsx';
// Forge-191 — Civil terrain (Delaunay + cut/fill).
import { TerrainWorkbenchHost } from './forge-v4/TerrainWorkbench.jsx';
// Forge-194 — Reverse-engineering NURBS surface fit.
import { NurbsFitWorkbenchHost } from './forge-v4/NurbsFitWorkbench.jsx';
// Forge-193 — Time-series log viewer (FEA / CFD / acoustics).
import { TimeSeriesViewerWorkbenchHost } from './forge-v4/TimeSeriesViewerWorkbench.jsx';
// Forge-195 — Multi-window helper (new-window button + hash hydration).
import { MultiWindowHost } from './forge-v4/MultiWindow.jsx';
// Forge-196 — Accessibility audit workbench.
import { A11yAuditWorkbenchHost } from './forge-v4/A11yAudit.jsx';
// Forge-197 — Webhook receiver workbench.
import { WebhookWorkbenchHost } from './forge-v4/WebhookWorkbench.jsx';
// Forge-198 — Streaming glTF publish workbench.
import { GltfPublishWorkbenchHost } from './forge-v4/GltfPublishWorkbench.jsx';
// Forge-200 — Mesh repair toolkit workbench.
import { MeshRepairWorkbenchHost } from './forge-v4/MeshRepairWorkbench.jsx';
// Forge-201 — Sheet metal flat-pattern unfold workbench.
import { SheetMetalUnfoldWorkbenchHost } from './forge-v4/SheetMetalUnfoldWorkbench.jsx';
// Forge-202 — Point cloud / reverse engineering workbench.
import { PointCloudWorkbenchHost } from './forge-v4/PointCloudWorkbench.jsx';
// Forge-203 — CPU path tracer preview workbench.
import { PathTracePreviewWorkbenchHost } from './forge-v4/PathTracePreviewWorkbench.jsx';
// Forge-204 — Standard parts library workbench.
import { StdPartsLibraryWorkbenchHost } from './forge-v4/StdPartsLibraryWorkbench.jsx';
// Forge-205 — Frame / truss FEA workbench.
import { FrameTrussWorkbenchHost } from './forge-v4/FrameTrussWorkbench.jsx';
// Forge-206 — Pipe routing workbench.
import { PipeRouteWorkbenchHost } from './forge-v4/PipeRouteWorkbench.jsx';
// Forge-207 — DXF round-trip workbench.
import { DxfRoundtripWorkbenchHost } from './forge-v4/DxfRoundtripWorkbench.jsx';
// Forge-208 — Sketch DOF audit workbench.
import { SketchDofAuditWorkbenchHost } from './forge-v4/SketchDofAuditWorkbench.jsx';
// Forge-209 — Animation timeline workbench.
import { AnimationTimelineWorkbenchHost } from './forge-v4/AnimationTimelineWorkbench.jsx';
// Forge-210 — Modal analysis workbench.
import { ModalAnalysisWorkbenchHost } from './forge-v4/ModalAnalysisWorkbench.jsx';
// Forge-211 — Thermal network workbench.
import { ThermalNetworkWorkbenchHost } from './forge-v4/ThermalNetworkWorkbench.jsx';
// Forge-212 — Fatigue life workbench.
import { FatigueLifeWorkbenchHost } from './forge-v4/FatigueLifeWorkbench.jsx';
// Forge-214 — Bolt joint preload + MoS workbench.
import { BoltJointWorkbenchHost } from './forge-v4/BoltJointWorkbench.jsx';
// Forge-215 — Column buckling workbench.
import { BucklingWorkbenchHost } from './forge-v4/BucklingWorkbench.jsx';
// Forge-219 — Material properties database workbench.
import { MaterialDatabaseWorkbenchHost } from './forge-v4/MaterialDatabaseWorkbench.jsx';
// Forge-216 — Beam deflection workbench.
import { BeamDeflectionWorkbenchHost } from './forge-v4/BeamDeflectionWorkbench.jsx';
// Forge-217 — Compression spring design workbench.
import { SpringDesignWorkbenchHost } from './forge-v4/SpringDesignWorkbench.jsx';
// Forge-218 — Heat exchanger LMTD workbench.
import { HeatExchangerWorkbenchHost } from './forge-v4/HeatExchangerWorkbench.jsx';
// Forge-220 — Mohr's circle workbench.
import { MohrsCircleWorkbenchHost } from './forge-v4/MohrsCircleWorkbench.jsx';
// Forge-224 — Polygon section workbench.
import { PolygonSectionWorkbenchHost } from './forge-v4/PolygonSectionWorkbench.jsx';
// Forge-221 — Spur gear pair workbench.
import { GearPairWorkbenchHost } from './forge-v4/GearPairWorkbench.jsx';
// Forge-222 — Hydraulic cylinder sizing workbench.
import { HydraulicCylinderWorkbenchHost } from './forge-v4/HydraulicCylinderWorkbench.jsx';
// Forge-223 — Wind load (ASCE 7) workbench.
import { WindLoadWorkbenchHost } from './forge-v4/WindLoadWorkbench.jsx';
// Forge-225 — Snow load (ASCE 7) workbench.
import { SnowLoadWorkbenchHost } from './forge-v4/SnowLoadWorkbench.jsx';
// Forge-226 — Bearing L10 life workbench.
import { BearingLifeWorkbenchHost } from './forge-v4/BearingLifeWorkbench.jsx';
// Forge-227 — V-belt drive workbench.
import { VBeltWorkbenchHost } from './forge-v4/VBeltWorkbench.jsx';
// Forge-228 — Pressure vessel workbench.
import { PressureVesselWorkbenchHost } from './forge-v4/PressureVesselWorkbench.jsx';
// Forge-229 — Pump head workbench.
import { PumpHeadWorkbenchHost } from './forge-v4/PumpHeadWorkbench.jsx';
// Forge-230 — Refrigeration COP workbench.
import { RefrigerationWorkbenchHost } from './forge-v4/RefrigerationWorkbench.jsx';
// Forge-231 — Fan / blower workbench.
import { FanBlowerWorkbenchHost } from './forge-v4/FanBlowerWorkbench.jsx';
// Forge-232 — Steel column workbench.
import { SteelColumnWorkbenchHost } from './forge-v4/SteelColumnWorkbench.jsx';
// Forge-234 — Seismic load (ASCE 7) workbench.
import { SeismicLoadWorkbenchHost } from './forge-v4/SeismicLoadWorkbench.jsx';
// Forge-235 — Shaft design workbench.
import { ShaftWorkbenchHost } from './forge-v4/ShaftWorkbench.jsx';
// Forge-236 — Bolted connection workbench.
import { BoltedConnectionWorkbenchHost } from './forge-v4/BoltedConnectionWorkbench.jsx';
// Forge-237 — Fillet weld workbench.
import { FilletWeldWorkbenchHost } from './forge-v4/FilletWeldWorkbench.jsx';
// Forge-238 — RC beam flexure workbench.
import { RcBeamWorkbenchHost } from './forge-v4/RcBeamWorkbench.jsx';
// Forge-239 — Soil bearing capacity workbench.
import { BearingCapacityWorkbenchHost } from './forge-v4/BearingCapacityWorkbench.jsx';
// Forge-240 — Retaining wall workbench.
import { RetainingWallWorkbenchHost } from './forge-v4/RetainingWallWorkbench.jsx';
// Forge-241 — Pile capacity workbench.
import { PileCapacityWorkbenchHost } from './forge-v4/PileCapacityWorkbench.jsx';
// Forge-242 — Open-channel workbench.
import { OpenChannelWorkbenchHost } from './forge-v4/OpenChannelWorkbench.jsx';
// Forge-243 — Weir / V-notch / orifice workbench.
import { WeirOrificeWorkbenchHost } from './forge-v4/WeirOrificeWorkbench.jsx';
// Forge-244 — Three-phase power workbench.
import { ThreePhaseWorkbenchHost } from './forge-v4/ThreePhaseWorkbench.jsx';
// Forge-245 — Transformer workbench.
import { TransformerWorkbenchHost } from './forge-v4/TransformerWorkbench.jsx';
// Forge-246 — Induction motor workbench.
import { InductionMotorWorkbenchHost } from './forge-v4/InductionMotorWorkbench.jsx';
// Forge-247 — Symmetrical components workbench.
import { SymComponentsWorkbenchHost } from './forge-v4/SymComponentsWorkbench.jsx';
// Forge-248 — Transmission line workbench.
import { TransmissionLineWorkbenchHost } from './forge-v4/TransmissionLineWorkbench.jsx';
// Forge-249 — Synchronous machine workbench.
import { SyncMachineWorkbenchHost } from './forge-v4/SyncMachineWorkbench.jsx';
// Forge-250 — Newton-Raphson power-flow workbench.
import { PowerFlowWorkbenchHost } from './forge-v4/PowerFlowWorkbench.jsx';
// Forge-251 — Short-circuit study workbench.
import { ShortCircuitWorkbenchHost } from './forge-v4/ShortCircuitWorkbench.jsx';
// Forge-252 — Cable sizing workbench.
import { CableSizingWorkbenchHost } from './forge-v4/CableSizingWorkbench.jsx';
// Forge-253 — Lighting design workbench.
import { LightingWorkbenchHost } from './forge-v4/LightingWorkbench.jsx';
// Forge-254 — Battery sizing workbench.
import { BatteryWorkbenchHost } from './forge-v4/BatteryWorkbench.jsx';
// Forge-255 — Solar PV sizing workbench.
import { SolarPvWorkbenchHost } from './forge-v4/SolarPvWorkbench.jsx';
// Forge-256 — Hydrology workbench.
import { HydrologyWorkbenchHost } from './forge-v4/HydrologyWorkbench.jsx';
// Forge-257 — RC column workbench.
import { RcColumnWorkbenchHost } from './forge-v4/RcColumnWorkbench.jsx';
// Forge-258 — Machining workbench.
import { MachiningWorkbenchHost } from './forge-v4/MachiningWorkbench.jsx';
// Forge-259 — Combustion analysis workbench.
import { CombustionWorkbenchHost } from './forge-v4/CombustionWorkbench.jsx';
// Forge-260 — Vibration isolation workbench.
import { VibIsolationWorkbenchHost } from './forge-v4/VibIsolationWorkbench.jsx';
// Forge-261 — Fin efficiency workbench.
import { FinEfficiencyWorkbenchHost } from './forge-v4/FinEfficiencyWorkbench.jsx';
// Forge-262 — Boiler efficiency workbench.
import { BoilerEfficiencyWorkbenchHost } from './forge-v4/BoilerEfficiencyWorkbench.jsx';
// Forge-263 — Sound TL workbench.
import { SoundTLWorkbenchHost } from './forge-v4/SoundTLWorkbench.jsx';
// Forge-264 — PID tuning workbench.
import { PIDTuningWorkbenchHost } from './forge-v4/PIDTuningWorkbench.jsx';
// Forge-265 — Tuned mass damper workbench.
import { TunedMassDamperWorkbenchHost } from './forge-v4/TunedMassDamperWorkbench.jsx';
// Forge-266 — Orifice plate workbench.
import { OrificePlateWorkbenchHost } from './forge-v4/OrificePlateWorkbench.jsx';
// Forge-267 — RC slab punching shear (ACI 318-19 §22.6.5).
import { RcPunchingWorkbenchHost } from './forge-v4/RcPunchingWorkbench.jsx';
// Forge-268 — Anchor bolt tension capacity (ACI 318-19 Ch.17).
import { AnchorBoltWorkbenchHost } from './forge-v4/AnchorBoltWorkbench.jsx';
// Forge-269 — Power screw torque & efficiency (Shigley §8-2).
import { PowerScrewWorkbenchHost } from './forge-v4/PowerScrewWorkbench.jsx';
// Forge-270 — Steel beam LTB (AISC 360-22 §F2).
import { SteelBeamLtbWorkbenchHost } from './forge-v4/SteelBeamLtbWorkbench.jsx';
// Forge-271 — Anchor bolt shear (ACI 318-19 §17.7).
import { AnchorShearWorkbenchHost } from './forge-v4/AnchorShearWorkbench.jsx';
// Forge-272 — Wood beam bending (NDS 2018 §3.3 + §4.3).
import { WoodBeamWorkbenchHost } from './forge-v4/WoodBeamWorkbench.jsx';
// Forge-273 — Pump NPSH available (ANSI/HI 9.6).
import { PumpNpshWorkbenchHost } from './forge-v4/PumpNpshWorkbench.jsx';
// Forge-274 — Wood column buckling (NDS 2018 §3.7).
import { WoodColumnWorkbenchHost } from './forge-v4/WoodColumnWorkbench.jsx';
// Forge-275 — Janssen silo wall pressure.
import { SiloPressureWorkbenchHost } from './forge-v4/SiloPressureWorkbench.jsx';
// Forge-276 — Air-standard Otto cycle.
import { OttoCycleWorkbenchHost } from './forge-v4/OttoCycleWorkbench.jsx';
// Forge-277 — Air-standard Diesel cycle.
import { DieselCycleWorkbenchHost } from './forge-v4/DieselCycleWorkbench.jsx';
// Forge-278 — Air-standard Brayton cycle.
import { BraytonCycleWorkbenchHost } from './forge-v4/BraytonCycleWorkbench.jsx';
// Forge-279 — DC shunt motor.
import { DcMotorWorkbenchHost } from './forge-v4/DcMotorWorkbench.jsx';
// Forge-280 — Wire rope sling capacity (ASME B30.9).
import { WireRopeSlingWorkbenchHost } from './forge-v4/WireRopeSlingWorkbench.jsx';
// Forge-281 — Disc clutch / brake (Shigley §16-2).
import { DiscBrakeWorkbenchHost } from './forge-v4/DiscBrakeWorkbench.jsx';
// Forge-282 — Reciprocating compressor (polytropic + η_v).
import { ReciprocatingCompressorWorkbenchHost } from './forge-v4/ReciprocatingCompressorWorkbench.jsx';
// Forge-283 — Roller chain drive (ANSI B29.1).
import { ChainDriveWorkbenchHost } from './forge-v4/ChainDriveWorkbench.jsx';
// Forge-284 — Stopping sight distance (AASHTO Green Book).
import { StoppingSightDistanceWorkbenchHost } from './forge-v4/StoppingSightDistanceWorkbench.jsx';
// Forge-285 — AASHTO 93 flexible pavement design (SN).
import { AashtoPavementWorkbenchHost } from './forge-v4/AashtoPavementWorkbench.jsx';
// Forge-286 — Capstan / bollard friction (Eytelwein).
import { CapstanFrictionWorkbenchHost } from './forge-v4/CapstanFrictionWorkbench.jsx';
// Forge-287 — Earthwork prismoidal volume (Simpson 1/3).
import { PrismoidalWorkbenchHost } from './forge-v4/PrismoidalWorkbench.jsx';
// Forge-288 — Pitot tube velocity (incompressible).
import { PitotTubeWorkbenchHost } from './forge-v4/PitotTubeWorkbench.jsx';
// Forge-289 — Storm sewer / circular pipe Manning partial flow.
import { CircularPipeFlowWorkbenchHost } from './forge-v4/CircularPipeFlowWorkbench.jsx';
// Forge-290 — Worm gear drive (Shigley §13 / AGMA).
import { WormGearWorkbenchHost } from './forge-v4/WormGearWorkbench.jsx';
// Forge-291 — Bevel gear pair (Tredgold + AGMA 2003).
import { BevelGearWorkbenchHost } from './forge-v4/BevelGearWorkbench.jsx';
// Forge-292 — Wood shear wall (NDS + SDPWS-21 §4).
import { WoodShearWallWorkbenchHost } from './forge-v4/WoodShearWallWorkbench.jsx';
// Forge-293 — Crane hook (DIN 15400 / ASME B30.10).
import { CraneHookWorkbenchHost } from './forge-v4/CraneHookWorkbench.jsx';
// Forge-294 — Air filter Δp + fan energy (ASHRAE 52.2).
import { AirFilterWorkbenchHost } from './forge-v4/AirFilterWorkbench.jsx';
// Forge-295 — Heat sink fin array (Incropera Ch.3).
import { FinArrayWorkbenchHost } from './forge-v4/FinArrayWorkbench.jsx';
// Forge-296 — Headed shear stud connector (AISC 360-22 §I8).
import { HeadedStudWorkbenchHost } from './forge-v4/HeadedStudWorkbench.jsx';
// Forge-297 — 1D consolidation settlement (Terzaghi).
import { ConsolidationWorkbenchHost } from './forge-v4/ConsolidationWorkbench.jsx';
// Forge-298 — Vehicle braking energy + brake heat.
import { VehicleBrakingWorkbenchHost } from './forge-v4/VehicleBrakingWorkbench.jsx';
// Forge-299 — Catenary cable sag-tension.
import { CatenaryWorkbenchHost } from './forge-v4/CatenaryWorkbench.jsx';
// Forge-300 — Drum brake (Shigley §16-3 short-shoe).
import { DrumBrakeWorkbenchHost } from './forge-v4/DrumBrakeWorkbench.jsx';
// Forge-301 — Wire rope FOS + bending fatigue (Shigley §17-7).
import { WireRopeWorkbenchHost } from './forge-v4/WireRopeWorkbench.jsx';
// Forge-302 — Steel beam web shear (AISC 360 §G2).
import { WebShearWorkbenchHost } from './forge-v4/WebShearWorkbench.jsx';
// Forge-303 — Hazen-Williams pipe friction (NFPA 13 / AWWA).
import { HazenWilliamsWorkbenchHost } from './forge-v4/HazenWilliamsWorkbench.jsx';
// Forge-304 — Cable voltage drop (NEC 215.2 / IEC 60364).
import { VoltageDropWorkbenchHost } from './forge-v4/VoltageDropWorkbench.jsx';
// Forge-305 — Hertz point contact (Shigley §3-19).
import { HertzPointWorkbenchHost } from './forge-v4/HertzPointWorkbench.jsx';
// Forge-306 — HVAC sensible + latent coil load.
import { CoolingLoadWorkbenchHost } from './forge-v4/CoolingLoadWorkbench.jsx';
// Forge-307 — RC shear (ACI 318-19 §22.5).
import { RCShearWorkbenchHost } from './forge-v4/RCShearWorkbench.jsx';
// Forge-308 — Cooling tower performance (ASHRAE).
import { CoolingTowerWorkbenchHost } from './forge-v4/CoolingTowerWorkbench.jsx';
// Forge-309 — Mononobe-Okabe seismic earth pressure.
import { MononobeOkabeWorkbenchHost } from './forge-v4/MononobeOkabeWorkbench.jsx';
// Forge-310 — Block-shear rupture (AISC 360-22 §J4.3).
import { BlockShearWorkbenchHost } from './forge-v4/BlockShearWorkbench.jsx';
// Forge-311 — Steel section classification (AISC 360-22 Table B4.1b).
import { SectionClassWorkbenchHost } from './forge-v4/SectionClassWorkbench.jsx';
// Forge-312 — Concrete mix design (ACI 211.1).
import { ConcreteMixWorkbenchHost } from './forge-v4/ConcreteMixWorkbench.jsx';
// Forge-313 — Steam pipe sizing (Spirax Sarco).
import { SteamPipeWorkbenchHost } from './forge-v4/SteamPipeWorkbench.jsx';
// Forge-314 — Compressed-air pipe sizing (CAGI).
import { AirPipeWorkbenchHost } from './forge-v4/AirPipeWorkbench.jsx';
// Forge-315 — Wind turbine BEM / Betz.
import { WindTurbineWorkbenchHost } from './forge-v4/WindTurbineWorkbench.jsx';
// Forge-316 — Concrete creep + shrinkage (ACI 209R-92).
import { ConcreteCreepWorkbenchHost } from './forge-v4/ConcreteCreepWorkbench.jsx';
// Forge-317 — Stormwater detention basin (Modified Rational).
import { DetentionBasinWorkbenchHost } from './forge-v4/DetentionBasinWorkbench.jsx';
// Forge-318 — Steel column base plate (AISC §J9 + DG1).
import { BasePlateWorkbenchHost } from './forge-v4/BasePlateWorkbench.jsx';
// Forge-319 5-calc bundle: hydraulic jump + Marston + IEEE 80 + pile group + buoyancy.
import {
  HydraulicJumpWorkbenchHost,
  BuriedPipeWorkbenchHost,
  SubstationGroundWorkbenchHost,
  PileGroupWorkbenchHost,
  BasementUpliftWorkbenchHost,
} from './forge-v4/Forge319BundleWorkbenches.jsx';
// Forge-320 5-calc bundle: rebar dev + ChW pump + genset + RO + U-value.
import {
  RebarDevWorkbenchHost,
  ChilledWaterPumpWorkbenchHost,
  GensetWorkbenchHost,
  ReverseOsmosisWorkbenchHost,
  EnvelopeWorkbenchHost,
} from './forge-v4/Forge320BundleWorkbenches.jsx';
// Forge-321 5-calc bundle: vent + fire pump + septic + cyclone + stack.
import {
  VentilationWorkbenchHost,
  FirePumpWorkbenchHost,
  SepticWorkbenchHost,
  CycloneWorkbenchHost,
  StackEffectWorkbenchHost,
} from './forge-v4/Forge321BundleWorkbenches.jsx';
// Forge-322 5-calc bundle.
import {
  MasonryWallWorkbenchHost,
  AsphaltMixWorkbenchHost,
  CathodicWorkbenchHost,
  HeatTraceWorkbenchHost,
  LightningWorkbenchHost,
} from './forge-v4/Forge322BundleWorkbenches.jsx';
// Forge-323 5-calc bundle.
import {
  StaticMarginWorkbenchHost,
  RefrigerantPipeWorkbenchHost,
  BusBarWorkbenchHost,
  DuctLeakageWorkbenchHost,
  DustVentWorkbenchHost,
} from './forge-v4/Forge323BundleWorkbenches.jsx';
// Forge-324 5-calc bundle.
import {
  IPLVWorkbenchHost,
  SnowDriftWorkbenchHost,
  SlabOneWayWorkbenchHost,
  CraneRunwayWorkbenchHost,
  CMUCompressionWorkbenchHost,
} from './forge-v4/Forge324BundleWorkbenches.jsx';
// Forge-325 5-calc bundle.
import {
  PRVWorkbenchHost,
  ExpansionTankWorkbenchHost,
  PlateBucklingWorkbenchHost,
  Ashrae62RWorkbenchHost,
  WeldElectrodeWorkbenchHost,
} from './forge-v4/Forge325BundleWorkbenches.jsx';
// Forge-326 5-calc bundle.
import {
  ConcreteCoverWorkbenchHost,
  MSEWallWorkbenchHost,
  HunterWorkbenchHost,
  SolarCollectorWorkbenchHost,
  ChimneyDraftWorkbenchHost,
} from './forge-v4/Forge326BundleWorkbenches.jsx';
// Forge-327 5-calc bundle.
import {
  MohrCoulombWorkbenchHost,
  StairWorkbenchHost,
  SnowOnPVWorkbenchHost,
  NRCWorkbenchHost,
  AdiabaticCompressorWorkbenchHost,
} from './forge-v4/Forge327BundleWorkbenches.jsx';
// Forge-328 5-calc bundle.
import {
  MullionWorkbenchHost,
  SprinklerWorkbenchHost,
  SoundPropWorkbenchHost,
  ISAWorkbenchHost,
  LPDWorkbenchHost,
} from './forge-v4/Forge328BundleWorkbenches.jsx';
import {
  GeothermalWorkbenchHost,
  TensionMemberWorkbenchHost,
  BoltedTimberWorkbenchHost,
  ConveyorWorkbenchHost,
  DriftWorkbenchHost,
} from './forge-v4/Forge329BundleWorkbenches.jsx';
import {
  SlopeWorkbenchHost,
  EnginePerfWorkbenchHost,
  DaylightWorkbenchHost,
  MassHaulWorkbenchHost,
  RailBeamWorkbenchHost,
} from './forge-v4/Forge330BundleWorkbenches.jsx';
import {
  BeamReactionsWorkbenchHost,
  TankAnchorWorkbenchHost,
  HeatPumpWorkbenchHost,
  BaseShearWorkbenchHost,
  PVShadeWorkbenchHost,
} from './forge-v4/Forge331BundleWorkbenches.jsx';
import {
  PadEyeWorkbenchHost,
  HSDWorkbenchHost,
  WeldGroupWorkbenchHost,
  BoltPreloadWorkbenchHost,
  PrestressWorkbenchHost,
} from './forge-v4/Forge332BundleWorkbenches.jsx';
import {
  BoltedFlangeWorkbenchHost,
  OgeeWorkbenchHost,
  GroundGridWorkbenchHost,
  ResponseSpectrumWorkbenchHost,
  BuoyancyWorkbenchHost,
} from './forge-v4/Forge333BundleWorkbenches.jsx';
import {
  VCurveWorkbenchHost,
  ClarifierWorkbenchHost,
  PVBattWorkbenchHost,
  SilencerWorkbenchHost,
  ThrustBlockWorkbenchHost,
} from './forge-v4/Forge334BundleWorkbenches.jsx';
import {
  CorbelWorkbenchHost,
  WindTowerWorkbenchHost,
  AirReceiverWorkbenchHost,
  ButterworthWorkbenchHost,
  PedVibWorkbenchHost,
} from './forge-v4/Forge335BundleWorkbenches.jsx';
import {
  PipeNetWorkbenchHost,
  TorVibWorkbenchHost,
  PierScourWorkbenchHost,
  EconomizerWorkbenchHost,
  FiberLinkWorkbenchHost,
} from './forge-v4/Forge336BundleWorkbenches.jsx';
import {
  BiaxFootWorkbenchHost,
  ADMWorkbenchHost,
  MorisonWorkbenchHost,
  FourierWorkbenchHost,
  SAWorkbenchHost,
} from './forge-v4/Forge337BundleWorkbenches.jsx';
import {
  CompSlabWorkbenchHost,
  ReverbWorkbenchHost,
  FlameWorkbenchHost,
  MSEPullWorkbenchHost,
  BayesWorkbenchHost,
} from './forge-v4/Forge338BundleWorkbenches.jsx';
import {
  CNWorkbenchHost,
  WaveguideWorkbenchHost,
  SluiceWorkbenchHost,
  KnockWorkbenchHost,
  NPVWorkbenchHost,
} from './forge-v4/Forge339BundleWorkbenches.jsx';
import {
  CMUShearWorkbenchHost,
  SlipCritWorkbenchHost,
  ChBeamWorkbenchHost,
  WeldHIWorkbenchHost,
  MarkovWorkbenchHost,
} from './forge-v4/Forge340BundleWorkbenches.jsx';
import {
  SoldierPileWorkbenchHost,
  RoundHSSWorkbenchHost,
  PlateHXWorkbenchHost,
  FOSMWorkbenchHost,
  FlutterWorkbenchHost,
} from './forge-v4/Forge341BundleWorkbenches.jsx';
// Forge-233 — Hierarchical Tools menu (groups 30+ calculators).
import { HierarchicalToolsMenuHost } from './forge-v4/HierarchicalToolsMenu.jsx';
// Forge-183 — Autosave + crash recovery banner.
import { AutoSaveRecoveryHost } from './forge-v4/AutoSaveRecoveryBanner.jsx';
// Forge-184 — Drag-drop file import (STEP / IGES / STL / BREP).
import { DragDropImportHost } from './forge-v4/DragDropImport.jsx';
// Forge-189 — Onboarding tutorial (guided tooltips).
import { OnboardingTourHost } from './forge-v4/OnboardingTour.jsx';
// Forge-188 — Localisation picker + sample strip.
import { LocalePickerHost } from './forge-v4/LocalePicker.jsx';
// Forge-154 — engineering material catalogue picker.
import { MaterialPickerHost } from './forge-v4/MaterialPicker.jsx';
// Forge-158 — AIS-style subshape selection highlight overlay.
import { SelectionHighlightHost } from './forge-v4/SelectionHighlight.jsx';
// Forge-166 — ISO/UNC/UNF/NPT thread designer (real helical sweep).
import { ThreadDesignerPanelHost } from './forge-v4/ThreadDesignerPanel.jsx';
// Forge-160 — OpenSCAD-style CSG scripting workbench.
import { CsgScriptingWorkbenchHost } from './forge-v4/CsgScriptingWorkbench.jsx';
// Forge-167 — Spring Designer (Wahl / Goodman / ASTM materials).
import { SpringDesignerPanelHost } from './forge-v4/SpringDesignerPanel.jsx';
// Forge-168 — Wiring Harness workbench (Catmull-Rom + bend radius).
import { HarnessWorkbenchHost } from './forge-v4/HarnessWorkbench.jsx';
// Forge-169 — Process P&ID schematic editor (ISA-5.1-2009).
import { PidEditorHost } from './forge-v4/pidEditor.jsx';
// Forge-161 — Reverse Engineering workbench (PLY / PCD / XYZ / E57).
import { ReverseEngWorkbenchHost } from './forge-v4/ReverseEngWorkbench.jsx';
// Forge-162 — Inspection / FAI workbench (CMM heatmap + AS9102 PDF).
import { InspectionWorkbenchHost } from './forge-v4/InspectionWorkbench.jsx';
import { SimulationWorkbenchHost } from './forge-v4/SimulationWorkbench.jsx';
// PUSH-58 — Mass Properties panel (density picker + computed mass).
import { MassPropsHost } from './forge-v4/MassPropsPanel.jsx';
// PUSH-59 — Assembly Interference Detection panel (pairwise OCCT scan).
import { InterferenceHost } from './forge-v4/InterferencePanel.jsx';
// PUSH-61 — Materials Browser (persistent body→material assignments).
import { MaterialsBrowserHost } from './forge-v4/MaterialsBrowserPanel.jsx';
// PUSH-63 — Entity Properties panel (face/edge/body inspector driven by
// window.__forgeSelection + forge.direct.inferFeature / edgeSegments /
// forge.massProps).
import { EntityPropsHost } from './forge-v4/EntityPropsPanel.jsx';
// PUSH-67 — Point-to-Point Measure tool (distance + dx/dy/dz + 3-point
// angle, driven by window.__forgeSelection like the entity panel).
import { MeasureToolPanelHost } from './forge-v4/MeasureToolPanel.jsx';
// PUSH-65 — Section Plane control panel (toggle / axis radio /
// body-bbox-aware offset slider, publishes window.__forgeSectionPlane
// + forge:section-update for the live viewport clipping).
import { SectionPlanePanelHost } from './forge-v4/SectionPlanePanel.jsx';
// PUSH-69 — Layers / Body visibility groups panel (named layer
// membership, per-layer visibility + lock toggles, body→layer map
// persisted in localStorage key `forge.v4.bodyLayers`).
import { LayersPanelHost } from './forge-v4/LayersPanel.jsx';
// PUSH-71 — Body Colours override panel (per-body colour picker +
// reset + auto-derive from material, mirrored into window.__forgeBodyColors
// Map; persisted in localStorage key `forge.v4.bodyColors`).
import { BodyColorsPanelHost } from './forge-v4/BodyColorsPanel.jsx';
// PUSH-70 — Display State QuickBar (bottom-right always-on HUD;
// shaded/wireframe/transparent buttons + axis indicator + live FPS;
// publishes window.__forgeDisplayState + forge:display-state-changed).
import { DisplayStateQuickBar } from './forge-v4/DisplayStateQuickBar.jsx';
// PUSH-68 — Camera Bookmarks panel (save / restore named camera views,
// persists to localStorage key `forge.v4.cameraBookmarks`).
import { CameraBookmarksPanelHost } from './forge-v4/CameraBookmarksPanel.jsx';
// PUSH-73 — Activity Log panel (single subscriber to ALL forge:* window
// events, bounded ring buffer of last 500 entries, filter + clear +
// JSON export via forge.dialog.saveFile, reachable via tools.activityLog).
import { ActivityLogPanelHost } from './forge-v4/ActivityLogPanel.jsx';
// PUSH-72 (Slice-40) — Sketch Constraints quick-add toolbar (5 most
// common kinds — Coincident / Parallel / Perpendicular / Equal / Tangent —
// bound to the live window.__forgeSelection + window.__forgeCurrentSketch
// state; clicking a button calls window.forge.sketcher.addConstraint and
// dispatches forge:sketch-constraint-add for downstream subscribers).
import { SketchConstraintsToolbar } from './forge-v4/SketchConstraintsToolbar.jsx';

// Forge-134 — install the public plugin API surface as `window.Forge`
// at app-bootstrap time, BEFORE the React tree mounts. PluginManagerPanelHost
// calls installForgeAPI again on mount (idempotent), but doing it up here
// means modules that probe `window.Forge` synchronously during the first
// render (e.g. Menus.jsx's usePluginMenuExtras) find the surface ready.
if (typeof window !== 'undefined') {
  try { installForgeAPI(); }
  catch (err) { console.warn('[forge.app] installForgeAPI failed:', err.message); }
}

// Forge-65: v4 shell is the only entry. App.jsx is one line — no hash
// routes, no legacy fallback. Per user mandate: "Full rewrite of
// App.jsx, retire WorkbenchContainer entirely".
//
// Forge-93: direct-edit / heal / surfacing panel hosts mounted as
// siblings to the shell so they can self-show via the
// `forge:open-direct-heal-surf-panel` custom event (or the imperative
// window.__forgeOpen{DirectEdit,Heal,Surfacing}() entry points) without
// modifying ForgeShellV4.jsx.
function App() {
  return (
    <ViewportEnvironmentProvider>
      <ForgeShellV4 />
      <DirectEditPanelHost />
      <HealPanelHost />
      <SurfacingPanelHost />
      <FlatPatternHost />
      <SurfaceAnalysisOverlayHost />
      <ManufacturingWorkbenchHost />
      <WeldmentsWorkbenchHost />
      <StandardPartsLibraryHost />
      <ProjectBundlePanelHost />
      <ProjectFilePanelHost />
      <IfcExportPanelHost />
      <AssemblyTreePanelHost />
      <AssemblyPanelHost />
      <BomPanelHost />
      <PdmPanelHost />
      <PDMWorkbenchHost />
      <MacroRecorderHost />
      <MaterialsLibraryHost />
      <ExplodedViewHost />
      <StandardPartsBrowserHost />
      <PMIWorkbenchHost />
      <RoutingWorkbenchHost />
      <MateSolverWorkbenchHost />
      <CAMExtendedWorkbenchHost />
      <TopologyWorkbenchHost />
      <SolidOpsWorkbenchHost />
      <SketchConstraintsWorkbenchHost />
      <DrawingsHLRWorkbenchHost />
      <MoldWorkbenchHost />
      <FEATetWorkbenchHost />
      <ScenarioRunnerHost />
      <VideoCaptureHUD />
      <PerfStatsHUD />
      <HoverTooltip />
      <SectionControlHost />
      <StressTestPanelHost />
      <ProgressStripPortal />
      <SnapStatusChip />
      <ConvergenceChartHost />
      <SkeletonPanelHost />
      <ActionWheelHost />
      <DemoProjectHost />
      <ShipWorkbenchHost />
      <GenerativeDesignPanelHost />
      <SheetMetalWorkbenchHost />
      <PluginManagerPanelHost />
      <PathTracedRenderHost />
      <RoleSwitcherHost />
      <RibbonCustomiserHost />
      <CommandPaletteHost />
      <DraftWorkbenchHost />
      <SpreadsheetWorkbenchHost />
      <MeshWorkbenchHost />
      <SlicerWorkbenchHost />
      <LatticeWorkbenchHost />
      <ArchWorkbenchHost />
      <SiteHierarchyHost />
      <RobotWorkbenchHost />
      <AerospaceWorkbenchHost />
      <GeotechWorkbenchHost />
      <CastingWorkbenchHost />
      <MoldFlowWorkbenchHost />
      <AcousticsWorkbenchHost />
      <WeldingDistortionWorkbenchHost />
      <CostWorkbenchHost />
      <CarbonLcaWorkbenchHost />
      <SunPathWorkbenchHost />
      <ToleranceStackWorkbenchHost />
      <DuctworkWorkbenchHost />
      <VariantExplorerWorkbenchHost />
      <PsychrometricWorkbenchHost />
      <CircuitWorkbenchHost />
      <TerrainWorkbenchHost />
      <NurbsFitWorkbenchHost />
      <TimeSeriesViewerWorkbenchHost />
      <MultiWindowHost />
      <A11yAuditWorkbenchHost />
      <WebhookWorkbenchHost />
      <GltfPublishWorkbenchHost />
      <MeshRepairWorkbenchHost />
      <SheetMetalUnfoldWorkbenchHost />
      <PointCloudWorkbenchHost />
      <PathTracePreviewWorkbenchHost />
      <StdPartsLibraryWorkbenchHost />
      <FrameTrussWorkbenchHost />
      <PipeRouteWorkbenchHost />
      <DxfRoundtripWorkbenchHost />
      <SketchDofAuditWorkbenchHost />
      <AnimationTimelineWorkbenchHost />
      <ModalAnalysisWorkbenchHost />
      <ThermalNetworkWorkbenchHost />
      <FatigueLifeWorkbenchHost />
      <BoltJointWorkbenchHost />
      <BucklingWorkbenchHost />
      <MaterialDatabaseWorkbenchHost />
      <BeamDeflectionWorkbenchHost />
      <SpringDesignWorkbenchHost />
      <HeatExchangerWorkbenchHost />
      <MohrsCircleWorkbenchHost />
      <PolygonSectionWorkbenchHost />
      <GearPairWorkbenchHost />
      <HydraulicCylinderWorkbenchHost />
      <WindLoadWorkbenchHost />
      <SnowLoadWorkbenchHost />
      <BearingLifeWorkbenchHost />
      <VBeltWorkbenchHost />
      <PressureVesselWorkbenchHost />
      <PumpHeadWorkbenchHost />
      <RefrigerationWorkbenchHost />
      <FanBlowerWorkbenchHost />
      <SteelColumnWorkbenchHost />
      <SeismicLoadWorkbenchHost />
      <ShaftWorkbenchHost />
      <BoltedConnectionWorkbenchHost />
      <FilletWeldWorkbenchHost />
      <RcBeamWorkbenchHost />
      <BearingCapacityWorkbenchHost />
      <RetainingWallWorkbenchHost />
      <PileCapacityWorkbenchHost />
      <OpenChannelWorkbenchHost />
      <WeirOrificeWorkbenchHost />
      <ThreePhaseWorkbenchHost />
      <TransformerWorkbenchHost />
      <InductionMotorWorkbenchHost />
      <SymComponentsWorkbenchHost />
      <TransmissionLineWorkbenchHost />
      <SyncMachineWorkbenchHost />
      <PowerFlowWorkbenchHost />
      <ShortCircuitWorkbenchHost />
      <CableSizingWorkbenchHost />
      <LightingWorkbenchHost />
      <BatteryWorkbenchHost />
      <SolarPvWorkbenchHost />
      <HydrologyWorkbenchHost />
      <RcColumnWorkbenchHost />
      <MachiningWorkbenchHost />
      <CombustionWorkbenchHost />
      <VibIsolationWorkbenchHost />
      <FinEfficiencyWorkbenchHost />
      <BoilerEfficiencyWorkbenchHost />
      <SoundTLWorkbenchHost />
      <PIDTuningWorkbenchHost />
      <TunedMassDamperWorkbenchHost />
      <OrificePlateWorkbenchHost />
      <RcPunchingWorkbenchHost />
      <AnchorBoltWorkbenchHost />
      <PowerScrewWorkbenchHost />
      <SteelBeamLtbWorkbenchHost />
      <AnchorShearWorkbenchHost />
      <WoodBeamWorkbenchHost />
      <PumpNpshWorkbenchHost />
      <WoodColumnWorkbenchHost />
      <SiloPressureWorkbenchHost />
      <OttoCycleWorkbenchHost />
      <DieselCycleWorkbenchHost />
      <BraytonCycleWorkbenchHost />
      <DcMotorWorkbenchHost />
      <WireRopeSlingWorkbenchHost />
      <DiscBrakeWorkbenchHost />
      <ReciprocatingCompressorWorkbenchHost />
      <ChainDriveWorkbenchHost />
      <StoppingSightDistanceWorkbenchHost />
      <AashtoPavementWorkbenchHost />
      <CapstanFrictionWorkbenchHost />
      <PrismoidalWorkbenchHost />
      <PitotTubeWorkbenchHost />
      <CircularPipeFlowWorkbenchHost />
      <WormGearWorkbenchHost />
      <BevelGearWorkbenchHost />
      <WoodShearWallWorkbenchHost />
      <CraneHookWorkbenchHost />
      <AirFilterWorkbenchHost />
      <FinArrayWorkbenchHost />
      <HeadedStudWorkbenchHost />
      <ConsolidationWorkbenchHost />
      <VehicleBrakingWorkbenchHost />
      <CatenaryWorkbenchHost />
      <DrumBrakeWorkbenchHost />
      <WireRopeWorkbenchHost />
      <WebShearWorkbenchHost />
      <HazenWilliamsWorkbenchHost />
      <VoltageDropWorkbenchHost />
      <HertzPointWorkbenchHost />
      <CoolingLoadWorkbenchHost />
      <RCShearWorkbenchHost />
      <CoolingTowerWorkbenchHost />
      <MononobeOkabeWorkbenchHost />
      <BlockShearWorkbenchHost />
      <SectionClassWorkbenchHost />
      <ConcreteMixWorkbenchHost />
      <SteamPipeWorkbenchHost />
      <AirPipeWorkbenchHost />
      <WindTurbineWorkbenchHost />
      <ConcreteCreepWorkbenchHost />
      <DetentionBasinWorkbenchHost />
      <BasePlateWorkbenchHost />
      <HydraulicJumpWorkbenchHost />
      <BuriedPipeWorkbenchHost />
      <SubstationGroundWorkbenchHost />
      <PileGroupWorkbenchHost />
      <BasementUpliftWorkbenchHost />
      <RebarDevWorkbenchHost />
      <ChilledWaterPumpWorkbenchHost />
      <GensetWorkbenchHost />
      <ReverseOsmosisWorkbenchHost />
      <EnvelopeWorkbenchHost />
      <VentilationWorkbenchHost />
      <FirePumpWorkbenchHost />
      <SepticWorkbenchHost />
      <CycloneWorkbenchHost />
      <StackEffectWorkbenchHost />
      <MasonryWallWorkbenchHost />
      <AsphaltMixWorkbenchHost />
      <CathodicWorkbenchHost />
      <HeatTraceWorkbenchHost />
      <LightningWorkbenchHost />
      <StaticMarginWorkbenchHost />
      <RefrigerantPipeWorkbenchHost />
      <BusBarWorkbenchHost />
      <DuctLeakageWorkbenchHost />
      <DustVentWorkbenchHost />
      <IPLVWorkbenchHost />
      <SnowDriftWorkbenchHost />
      <SlabOneWayWorkbenchHost />
      <CraneRunwayWorkbenchHost />
      <CMUCompressionWorkbenchHost />
      <PRVWorkbenchHost />
      <ExpansionTankWorkbenchHost />
      <PlateBucklingWorkbenchHost />
      <Ashrae62RWorkbenchHost />
      <WeldElectrodeWorkbenchHost />
      <ConcreteCoverWorkbenchHost />
      <MSEWallWorkbenchHost />
      <HunterWorkbenchHost />
      <SolarCollectorWorkbenchHost />
      <ChimneyDraftWorkbenchHost />
      <MohrCoulombWorkbenchHost />
      <StairWorkbenchHost />
      <SnowOnPVWorkbenchHost />
      <NRCWorkbenchHost />
      <AdiabaticCompressorWorkbenchHost />
      <MullionWorkbenchHost />
      <SprinklerWorkbenchHost />
      <SoundPropWorkbenchHost />
      <ISAWorkbenchHost />
      <LPDWorkbenchHost />
      <GeothermalWorkbenchHost />
      <TensionMemberWorkbenchHost />
      <BoltedTimberWorkbenchHost />
      <ConveyorWorkbenchHost />
      <DriftWorkbenchHost />
      <SlopeWorkbenchHost />
      <EnginePerfWorkbenchHost />
      <DaylightWorkbenchHost />
      <MassHaulWorkbenchHost />
      <RailBeamWorkbenchHost />
      <BeamReactionsWorkbenchHost />
      <TankAnchorWorkbenchHost />
      <HeatPumpWorkbenchHost />
      <BaseShearWorkbenchHost />
      <PVShadeWorkbenchHost />
      <PadEyeWorkbenchHost />
      <HSDWorkbenchHost />
      <WeldGroupWorkbenchHost />
      <BoltPreloadWorkbenchHost />
      <PrestressWorkbenchHost />
      <BoltedFlangeWorkbenchHost />
      <OgeeWorkbenchHost />
      <GroundGridWorkbenchHost />
      <ResponseSpectrumWorkbenchHost />
      <BuoyancyWorkbenchHost />
      <VCurveWorkbenchHost />
      <ClarifierWorkbenchHost />
      <PVBattWorkbenchHost />
      <SilencerWorkbenchHost />
      <ThrustBlockWorkbenchHost />
      <CorbelWorkbenchHost />
      <WindTowerWorkbenchHost />
      <AirReceiverWorkbenchHost />
      <ButterworthWorkbenchHost />
      <PedVibWorkbenchHost />
      <PipeNetWorkbenchHost />
      <TorVibWorkbenchHost />
      <PierScourWorkbenchHost />
      <EconomizerWorkbenchHost />
      <FiberLinkWorkbenchHost />
      <BiaxFootWorkbenchHost />
      <ADMWorkbenchHost />
      <MorisonWorkbenchHost />
      <FourierWorkbenchHost />
      <SAWorkbenchHost />
      <CompSlabWorkbenchHost />
      <ReverbWorkbenchHost />
      <FlameWorkbenchHost />
      <MSEPullWorkbenchHost />
      <BayesWorkbenchHost />
      <CNWorkbenchHost />
      <WaveguideWorkbenchHost />
      <SluiceWorkbenchHost />
      <KnockWorkbenchHost />
      <NPVWorkbenchHost />
      <CMUShearWorkbenchHost />
      <SlipCritWorkbenchHost />
      <ChBeamWorkbenchHost />
      <WeldHIWorkbenchHost />
      <MarkovWorkbenchHost />
      <SoldierPileWorkbenchHost />
      <RoundHSSWorkbenchHost />
      <PlateHXWorkbenchHost />
      <FOSMWorkbenchHost />
      <FlutterWorkbenchHost />
      <HierarchicalToolsMenuHost />
      <AutoSaveRecoveryHost />
      <DragDropImportHost />
      <OnboardingTourHost />
      <LocalePickerHost />
      <MaterialPickerHost />
      <SelectionHighlightHost />
      <ThreadDesignerPanelHost />
      <CsgScriptingWorkbenchHost />
      <SpringDesignerPanelHost />
      <HarnessWorkbenchHost />
      <PidEditorHost />
      <ReverseEngWorkbenchHost />
      <InspectionWorkbenchHost />
      <SimulationWorkbenchHost />
      <MassPropsHost />
      <InterferenceHost />
      <MaterialsBrowserHost />
      <EntityPropsHost />
      <MeasureToolPanelHost />
      <SectionPlanePanelHost />
      <LayersPanelHost />
      <BodyColorsPanelHost />
      <DisplayStateQuickBar />
      <CameraBookmarksPanelHost />
      <ActivityLogPanelHost />
      <SketchConstraintsToolbar />
    </ViewportEnvironmentProvider>
  );
}

export default App;
