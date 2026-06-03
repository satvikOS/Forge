import React from 'react';
import { ForgeShellV4 } from './forge-v4/ForgeShellV4.jsx';
import { DirectEditPanelHost } from './forge-v4/DirectEditPanel.jsx';
import { HealPanelHost } from './forge-v4/HealPanel.jsx';
import { SurfacingPanelHost } from './forge-v4/SurfacingPanel.jsx';
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
    </ViewportEnvironmentProvider>
  );
}

export default App;
