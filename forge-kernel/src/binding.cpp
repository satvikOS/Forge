// forge-kernel binding.cpp — N-API entry point.
//
// Exposes the Forge native C++ kernel to V8. Handles are uint32_t so they
// fit losslessly in a JS number; the actual TopoDS_Shape stays in C++.
// All functions check their argument types; type errors throw JS
// TypeError so the frontend can catch them in a uniform way.

#include <napi.h>

#include "forge/ShapeRegistry.hpp"
#include "forge/Primitives.hpp"
#include "forge/Booleans.hpp"
#include "forge/DirectEdit.hpp"
#include "forge/Tessellate.hpp"
#include "forge/MassProps.hpp"
#include "forge/Transform.hpp"
#include "forge/ComponentRegistry.hpp"
#include "forge/BVH.hpp"
#include "forge/LOD.hpp"
#include "forge/AssemblySolver.hpp"
#include "forge/AssemblyHierarchy.hpp"
#include "forge/InterferenceDetection.hpp"
#include "forge/MotionStudy.hpp"
#include "forge/MultibodyDynamics.hpp"
#include "forge/MateLibrary.hpp"
#include "forge/Drawings.hpp"
#include "forge/Sketcher.hpp"
#include "forge/Fea.hpp"
#include "forge/Emag.hpp"
#include "forge/FeaContact.hpp"
#include "forge/FeaTet.hpp"
#include "forge/Cam.hpp"
#include "forge/CamAdvanced.hpp"
#include "forge/CamExtended.hpp"
#include "forge/GcodePost.hpp"
#include "forge/Cfd.hpp"
#include "forge/CfdCompressible.hpp"
#include "forge/IoExchange.hpp"
#include "forge/DirectModeling.hpp"
#include "forge/Healing.hpp"
#include "forge/Features.hpp"
#include "forge/SheetMetal.hpp"
#include "forge/SheetMetalExtended.hpp"
#include "forge/Weldments.hpp"
#include "forge/Nurbs.hpp"
#include "forge/ClassASurfacing.hpp"
#include "forge/LineageRegistry.hpp"
#include "forge/Airfoil.hpp"
#include "forge/SlopeStability.hpp"
#include "forge/Casting.hpp"
#include "forge/MoldFlow.hpp"
#include "forge/Mold.hpp"
#include "forge/Acoustics.hpp"
#include "forge/WeldingFea.hpp"
#include "forge/GltfExport.hpp"
#include "forge/CostEstimation.hpp"
#include "forge/CarbonLca.hpp"
#include "forge/SunPath.hpp"
#include "forge/Tolerance.hpp"
#include "forge/Ductwork.hpp"
#include "forge/Variants.hpp"
#include "forge/Psychrometric.hpp"
#include "forge/Circuit.hpp"
#include "forge/Terrain.hpp"
#include "forge/NurbsFit.hpp"
#include "forge/MeshRepair.hpp"
#include "forge/SheetMetalFlatPattern.hpp"
#include "forge/PointCloud.hpp"
#include "forge/PathTrace.hpp"
#include "forge/StdParts.hpp"
#include "forge/FrameTruss.hpp"
#include "forge/PipeRoute.hpp"
#include "forge/Dxf.hpp"
#include "forge/SketchDof.hpp"
#include "forge/Animation.hpp"
#include "forge/ThermalNetwork.hpp"
#include "forge/Fatigue.hpp"
#include "forge/BoltJoint.hpp"
#include "forge/Buckling.hpp"
#include "forge/BeamDeflection.hpp"
#include "forge/Spring.hpp"
#include "forge/HeatExchanger.hpp"
#include "forge/Mohr.hpp"
#include "forge/PolygonSection.hpp"
#include "forge/GearPair.hpp"
#include "forge/HydraulicCylinder.hpp"
#include "forge/WindLoad.hpp"
#include "forge/SnowLoad.hpp"
#include "forge/Bearing.hpp"
#include "forge/VBelt.hpp"
#include "forge/PressureVessel.hpp"
#include "forge/PumpHead.hpp"
#include "forge/Refrigeration.hpp"
#include "forge/FanBlower.hpp"
#include "forge/SteelColumn.hpp"
#include "forge/SeismicLoad.hpp"
#include "forge/Shaft.hpp"
#include "forge/BoltedConnection.hpp"
#include "forge/FilletWeld.hpp"
#include "forge/RcBeam.hpp"
#include "forge/BearingCapacity.hpp"
#include "forge/RetainingWall.hpp"
#include "forge/PileCapacity.hpp"
#include "forge/OpenChannel.hpp"
#include "forge/WeirOrifice.hpp"
#include "forge/ThreePhase.hpp"
#include "forge/Transformer.hpp"
#include "forge/InductionMotor.hpp"
#include "forge/SymComponents.hpp"
#include "forge/TransmissionLine.hpp"
#include "forge/SyncMachine.hpp"
#include "forge/PowerFlow.hpp"
#include "forge/ShortCircuit.hpp"
#include "forge/CableSizing.hpp"
#include "forge/Lighting.hpp"
#include "forge/Battery.hpp"
#include "forge/SolarPv.hpp"
#include "forge/Hydrology.hpp"
#include "forge/RcColumn.hpp"
#include "forge/Machining.hpp"
#include "forge/Combustion.hpp"
#include "forge/VibIsolation.hpp"
#include "forge/FinEfficiency.hpp"
#include "forge/BoilerEfficiency.hpp"
#include "forge/SoundTL.hpp"
#include "forge/PIDTuning.hpp"
#include "forge/TunedMassDamper.hpp"
#include "forge/OrificePlate.hpp"
#include "forge/RcPunching.hpp"
#include "forge/AnchorBolt.hpp"
#include "forge/PowerScrew.hpp"
#include "forge/SteelBeamLtb.hpp"
#include "forge/AnchorShear.hpp"
#include "forge/WoodBeam.hpp"
#include "forge/PumpNpsh.hpp"
#include "forge/WoodColumn.hpp"
#include "forge/SiloPressure.hpp"
#include "forge/OttoCycle.hpp"
#include "forge/DieselCycle.hpp"
#include "forge/BraytonCycle.hpp"
#include "forge/DcMotor.hpp"
#include "forge/WireRopeSling.hpp"
#include "forge/DiscBrake.hpp"
#include "forge/ReciprocatingCompressor.hpp"
#include "forge/ChainDrive.hpp"
#include "forge/StoppingSightDistance.hpp"
#include "forge/AashtoPavement.hpp"
#include "forge/CapstanFriction.hpp"
#include "forge/Prismoidal.hpp"
#include "forge/PitotTube.hpp"
#include "forge/CircularPipeFlow.hpp"
#include "forge/WormGear.hpp"
#include "forge/BevelGear.hpp"
#include "forge/WoodShearWall.hpp"
#include "forge/CraneHook.hpp"
#include "forge/AirFilter.hpp"
#include "forge/FinArray.hpp"
#include "forge/HeadedStud.hpp"
#include "forge/Consolidation.hpp"
#include "forge/VehicleBraking.hpp"
#include "forge/Catenary.hpp"
#include "forge/DrumBrake.hpp"
#include "forge/WireRope.hpp"
#include "forge/WebShear.hpp"
#include "forge/HazenWilliams.hpp"
#include "forge/VoltageDrop.hpp"
#include "forge/HertzPoint.hpp"
#include "forge/CoolingLoad.hpp"
#include "forge/RCShear.hpp"
#include "forge/CoolingTower.hpp"
#include "forge/MononobeOkabe.hpp"
#include "forge/BlockShear.hpp"
#include "forge/SectionClass.hpp"
#include "forge/ConcreteMix.hpp"
#include "forge/SteamPipe.hpp"
#include "forge/AirPipe.hpp"
#include "forge/WindTurbine.hpp"
#include "forge/ConcreteCreep.hpp"
#include "forge/DetentionBasin.hpp"
#include "forge/BasePlate.hpp"
#include "forge/HydraulicJump.hpp"
#include "forge/BuriedPipe.hpp"
#include "forge/SubstationGround.hpp"
#include "forge/PileGroup.hpp"
#include "forge/BasementUplift.hpp"
#include "forge/RebarDevelopment.hpp"
#include "forge/ChilledWaterPump.hpp"
#include "forge/DieselGenset.hpp"
#include "forge/ReverseOsmosis.hpp"
#include "forge/Ventilation.hpp"
#include "forge/FirePump.hpp"
#include "forge/SepticTank.hpp"
#include "forge/Cyclone.hpp"
#include "forge/StackEffect.hpp"
#include "forge/EnvelopeUValue.hpp"
#include "forge/MasonryWall.hpp"
#include "forge/AsphaltMix.hpp"
#include "forge/CathodicProtection.hpp"
#include "forge/HeatTrace.hpp"
#include "forge/LightningProtection.hpp"
#include "forge/StaticMargin.hpp"
#include "forge/RefrigerantPipe.hpp"
#include "forge/BusBarForce.hpp"
#include "forge/DuctLeakage.hpp"
#include "forge/DustExplosionVent.hpp"
#include "forge/ChillerIPLV.hpp"
#include "forge/SnowDrift.hpp"
#include "forge/SlabOneWay.hpp"
#include "forge/CraneRunway.hpp"
#include "forge/CMUCompression.hpp"
#include "forge/ReliefValve.hpp"
#include "forge/ExpansionTank.hpp"
#include "forge/PlateBucklingLocal.hpp"
#include "forge/Ashrae62Residential.hpp"
#include "forge/WeldElectrode.hpp"
#include "forge/ConcreteCover.hpp"
#include "forge/MSEWall.hpp"
#include "forge/HunterFlow.hpp"
#include "forge/SolarCollector.hpp"
#include "forge/ChimneyDraft.hpp"
#include "forge/MohrCoulomb.hpp"
#include "forge/StairDesign.hpp"
#include "forge/SnowOnPV.hpp"
#include "forge/NRCAcoustic.hpp"
#include "forge/AdiabaticCompressor.hpp"
#include "forge/MullionDeflection.hpp"
#include "forge/SprinklerK.hpp"
#include "forge/SoundPropagation.hpp"
#include "forge/StandardAtmosphere.hpp"
#include "forge/Lighting901LPD.hpp"
#include "forge/GeothermalLoop.hpp"
#include "forge/TensionMember.hpp"
#include "forge/BoltedTimber.hpp"
#include "forge/ConveyorPower.hpp"
#include "forge/DriftIndex.hpp"
#include "forge/SlopeInfinite.hpp"
#include "forge/EnginePerformance.hpp"
#include "forge/DaylightFactor.hpp"
#include "forge/MassHaul.hpp"
#include "forge/RailBeam.hpp"
#include "forge/BeamReactions.hpp"
#include "forge/TankAnchor.hpp"
#include "forge/HeatPump.hpp"
#include "forge/BaseShear.hpp"
#include "forge/PVShade.hpp"
#include "forge/PadEye.hpp"
#include "forge/HorizontalSight.hpp"
#include "forge/WeldGroup.hpp"
#include "forge/BoltPreload.hpp"
#include "forge/PrestressLosses.hpp"
#include "forge/BoltedFlange.hpp"
#include "forge/SpillwayOgee.hpp"
#include "forge/GroundGrid.hpp"
#include "forge/ResponseSpectrum.hpp"
#include "forge/BuoyantStability.hpp"
#include "forge/VerticalCurve.hpp"
#include "forge/Clarifier.hpp"
#include "forge/PVBattery.hpp"
#include "forge/DuctSilencer.hpp"
#include "forge/ThrustBlock.hpp"
#include "forge/Corbel.hpp"
#include "forge/WindTowerFoundation.hpp"
#include "forge/AirReceiver.hpp"
#include "forge/ButterworthFilter.hpp"
#include "forge/PedestrianBridge.hpp"
#include "forge/PipeNetwork.hpp"
#include "forge/TorsionalVibration.hpp"
#include "forge/PierScour.hpp"
#include "forge/Economizer.hpp"
#include "forge/FiberLink.hpp"
#include "forge/BiaxialFooting.hpp"
#include "forge/AluminumExtrusion.hpp"
#include "forge/MorisonForce.hpp"
#include "forge/FourierHeat.hpp"
#include "forge/SimulatedAnnealing.hpp"
#include "forge/CompositeSlab.hpp"
#include "forge/Reverberation.hpp"
#include "forge/AdiabaticFlame.hpp"
#include "forge/MSEPullout.hpp"
#include "forge/BayesUpdate.hpp"
#include "forge/RunoffCN.hpp"
#include "forge/Waveguide.hpp"
#include "forge/SluiceGate.hpp"
#include "forge/Knock.hpp"
#include "forge/ProjectNPV.hpp"
#include "forge/CMUShearWall.hpp"
#include "forge/SlipCritical.hpp"
#include "forge/ChilledBeam.hpp"
#include "forge/WeldHeatInput.hpp"
#include "forge/MarkovChain.hpp"
#include "forge/SoldierPile.hpp"
#include "forge/HSSRoundBending.hpp"
#include "forge/PlateHX.hpp"
#include "forge/FOSMReliability.hpp"
#include "forge/BridgeFlutter.hpp"
#include "forge/BooleanTol.hpp"
#include "forge/ShapeCheck.hpp"
#include "forge/ShapeFix.hpp"
#include "forge/Sewing.hpp"
#include "forge/VarFillet.hpp"
#include "forge/LoftGuide.hpp"

// ---------------------------------------------------------------- forge::native
// In-house, pure-C++20 unified-kernel modules (NO OCCT / WASM / external deps).
// These are the VALIDATED increments compiled by test/native/run_native.sh and,
// from this slice, INTO forge-kernel.node — exposed below under exports.native.
#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"
#include "forge/native/gdt/Gdt.hpp"
#include "forge/native/implicit/SdfTree.hpp"
#include "forge/native/implicit/IsoMesher.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"
#include "forge/native/brep/Query.hpp"
#include "forge/native/mesh/MeshBooleanNative.hpp"
// Task #46 — the remaining forge::native engines, bound below under exports.native
// so Archie can call them via CUA. Pure C++20 stdlib (no OCCT/WASM/external deps).
#include "forge/native/tolstack/Tolstack.hpp"
#include "forge/native/vvuq/Vvuq.hpp"
#include "forge/native/materials/Materials.hpp"
#include "forge/native/am/Am.hpp"
#include "forge/native/composites/Composites.hpp"
#include "forge/native/surfit/Surfit.hpp"
#include "forge/native/cam/Cam.hpp"
#include <cmath>       // std::fabs (composites Bmax / cam reporting)
#include <algorithm>   // std::max  (composites Bmax)

#include <array>

#include <Standard_Version.hxx>
#include <Standard_Failure.hxx>
#include <cstring>

// IN-HOUSE KERNEL STEP 1 — the OCCT-free native B-rep path. Headers are pure
// C++20 (no OCCT), but only pulled in when the addon is built with
// -DFORGE_NATIVE_BREP so the default build is byte-for-byte unchanged.
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/SolidTessellate.hpp"
#include "forge/native/brep/Boolean.hpp"          // IN-HOUSE KERNEL STEP 2 — native boolean
#include "forge/native/brep/NativeRoute.hpp"      // IN-HOUSE KERNEL STEP 3a — live-op routing/gate
#endif

using namespace forge;

namespace {

// safe() wraps a binding body so that std::exceptions from the C++
// kernel surface as JS Errors instead of crashing the V8 isolate.
// NAPI_CPP_EXCEPTIONS only converts Napi::Error; anything else (e.g.
// std::invalid_argument from ShapeRegistry::get on a stale handle)
// would otherwise abort the process.
template <typename Fn>
Napi::Value safe(const Napi::CallbackInfo& info, Fn&& fn) {
    try {
        return fn();
    } catch (const Napi::Error&) {
        throw;
    } catch (const Standard_Failure& f) {
        // OCCT exceptions don't always derive from std::exception in
        // OCCT 7.9 (they do on most builds but not all); catch them
        // explicitly so we surface the real OCCT message to JS.
        const char* msg = f.GetMessageString();
        throw Napi::Error::New(info.Env(),
            std::string("forge (OCCT): ") + (msg ? msg : f.DynamicType()->Name()));
    } catch (const std::exception& e) {
        throw Napi::Error::New(info.Env(), e.what());
    } catch (...) {
        throw Napi::Error::New(info.Env(), "forge: unknown native exception");
    }
}

uint32_t requireHandle(const Napi::CallbackInfo& info, std::size_t idx) {
    if (info.Length() <= idx || !info[idx].IsNumber()) {
        throw Napi::TypeError::New(info.Env(),
            "forge: expected handle (uint32) at arg " + std::to_string(idx));
    }
    return info[idx].As<Napi::Number>().Uint32Value();
}

double requireNumber(const Napi::CallbackInfo& info, std::size_t idx, const char* what) {
    if (info.Length() <= idx || !info[idx].IsNumber()) {
        throw Napi::TypeError::New(info.Env(),
            std::string("forge: expected number for ") + what);
    }
    return info[idx].As<Napi::Number>().DoubleValue();
}

Transform4x4 readTransform(const Napi::CallbackInfo& info, std::size_t idx) {
    if (info.Length() <= idx || !info[idx].IsTypedArray()) {
        throw Napi::TypeError::New(info.Env(),
            "forge: transform must be a Float64Array of 16 row-major doubles");
    }
    auto arr = info[idx].As<Napi::Float64Array>();
    if (arr.ElementLength() != 16) {
        throw Napi::TypeError::New(info.Env(), "forge: transform must have 16 elements");
    }
    Transform4x4 t;
    std::copy(arr.Data(), arr.Data() + 16, t.m.begin());
    return t;
}

AABB readAABB(const Napi::CallbackInfo& info, std::size_t idx) {
    if (info.Length() <= idx || !info[idx].IsTypedArray()) {
        throw Napi::TypeError::New(info.Env(),
            "forge: AABB must be a Float64Array [minX,minY,minZ,maxX,maxY,maxZ]");
    }
    auto arr = info[idx].As<Napi::Float64Array>();
    if (arr.ElementLength() != 6) {
        throw Napi::TypeError::New(info.Env(), "forge: AABB must have 6 elements");
    }
    return AABB{
        arr.Data()[0], arr.Data()[1], arr.Data()[2],
        arr.Data()[3], arr.Data()[4], arr.Data()[5],
    };
}

// ----------------------------------------------------------- primitives
Napi::Value MakeBox(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(),
            makeBox(requireNumber(info,0,"dx"), requireNumber(info,1,"dy"), requireNumber(info,2,"dz")));
    });
}
Napi::Value MakeCylinder(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(),
            makeCylinder(requireNumber(info,0,"radius"), requireNumber(info,1,"height")));
    });
}
Napi::Value MakeSphere(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(), makeSphere(requireNumber(info,0,"radius")));
    });
}
Napi::Value MakeCone(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(),
            makeCone(requireNumber(info,0,"r1"), requireNumber(info,1,"r2"), requireNumber(info,2,"h")));
    });
}
Napi::Value MakeTorus(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(),
            makeTorus(requireNumber(info,0,"majorR"), requireNumber(info,1,"minorR")));
    });
}

// Task #16 — canonical solid primitives.
Napi::Value MakePrism(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(),
            makePrism(static_cast<int>(requireNumber(info,0,"nSides")),
                      requireNumber(info,1,"circumRadius"),
                      requireNumber(info,2,"height")));
    });
}
Napi::Value MakeWedge(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(),
            makeWedge(requireNumber(info,0,"dx"), requireNumber(info,1,"dy"),
                      requireNumber(info,2,"dz"), requireNumber(info,3,"ltx")));
    });
}
Napi::Value MakePyramid(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(),
            makePyramid(requireNumber(info,0,"dx"), requireNumber(info,1,"dy"),
                        requireNumber(info,2,"height")));
    });
}
Napi::Value MakeEllipsoid(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(),
            makeEllipsoid(requireNumber(info,0,"rx"), requireNumber(info,1,"ry"),
                          requireNumber(info,2,"rz")));
    });
}
Napi::Value MakeTube(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(),
            makeTube(requireNumber(info,0,"rOuter"), requireNumber(info,1,"rInner"),
                     requireNumber(info,2,"height")));
    });
}

// ----------------------------------------------------------- booleans
Napi::Value Fuse(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(), fuse(requireHandle(info,0), requireHandle(info,1)));
    });
}
Napi::Value Cut(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(), cut(requireHandle(info,0), requireHandle(info,1)));
    });
}
Napi::Value Common(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(), common(requireHandle(info,0), requireHandle(info,1)));
    });
}

// ---------------------------------------------------------------- DirectEdit
// Face-level direct modelling: enumerate faces, delete features and heal, push
// or pull a planar face, resize a cylindrical bore. See forge/DirectEdit.hpp.

Napi::Value UnifyFaces(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(), unifyFaces(requireHandle(info, 0)));
    });
}

Napi::Value FaceInventory(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        // NOTE: kept OCCT-indexed for native handles so its face indices stay
        // CONSISTENT with direct.moveFace/pushPullFace (which address the OCCT
        // faceMap). The canonical analytic face identity is available separately via
        // forge.nativeFaceInventory; routing THIS query native must wait until
        // direct-edit face ADDRESSING is native too (else index-based edits desync).
        const std::vector<FaceInfo> faces = faceInventory(requireHandle(info, 0));
        Napi::Array out = Napi::Array::New(env, faces.size());
        for (std::size_t i = 0; i < faces.size(); ++i) {
            const FaceInfo& f = faces[i];
            Napi::Object o = Napi::Object::New(env);
            o.Set("index",    Napi::Number::New(env, f.index));
            o.Set("kind",     Napi::String::New(env, f.kind));
            o.Set("area",     Napi::Number::New(env, f.area));
            o.Set("radius",   Napi::Number::New(env, f.radius));
            o.Set("minorRadius", Napi::Number::New(env, f.minorRadius));
            o.Set("concave",  Napi::Boolean::New(env, f.concave));
            o.Set("vMin",     Napi::Number::New(env, f.vMin));
            o.Set("vMax",     Napi::Number::New(env, f.vMax));
            auto vec3 = [&](const std::array<double,3>& v) {
                Napi::Array a = Napi::Array::New(env, 3);
                for (uint32_t k = 0; k < 3; ++k) a.Set(k, Napi::Number::New(env, v[k]));
                return a;
            };
            o.Set("centroid",     vec3(f.centroid));
            o.Set("direction",    vec3(f.direction));
            o.Set("axisLocation", vec3(f.axisLocation));
            out.Set(static_cast<uint32_t>(i), o);
        }
        return out;
    });
}

Napi::Value Defeature(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        ShapeHandle h = requireHandle(info, 0);
        if (info.Length() < 2 || !info[1].IsArray()) {
            throw Napi::TypeError::New(env, "forge.defeature: expected face index array at arg 1");
        }
        Napi::Array arr = info[1].As<Napi::Array>();
        std::vector<int> idx;
        idx.reserve(arr.Length());
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            idx.push_back(arr.Get(i).As<Napi::Number>().Int32Value());
        }
        return Napi::Number::New(env, defeature(h, idx));
    });
}

Napi::Value PushPullFace(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        ShapeHandle h = requireHandle(info, 0);
        int face = static_cast<int>(requireNumber(info, 1, "faceIndex"));
        std::array<double,3> dir{{requireNumber(info, 2, "dx"),
                                  requireNumber(info, 3, "dy"),
                                  requireNumber(info, 4, "dz")}};
        double dist = requireNumber(info, 5, "distance");
        return Napi::Number::New(env, pushPullFace(h, face, dir, dist));
    });
}

Napi::Value ResizeBore(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        ShapeHandle h = requireHandle(info, 0);
        int face = static_cast<int>(requireNumber(info, 1, "faceIndex"));
        double r = requireNumber(info, 2, "newRadius");
        return Napi::Number::New(env, resizeBore(h, face, r));
    });
}

// ----------------------------------------------------------- transform
Napi::Value Translate(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(),
            translate(requireHandle(info,0),
                      requireNumber(info,1,"dx"),
                      requireNumber(info,2,"dy"),
                      requireNumber(info,3,"dz")));
    });
}
Napi::Value Rotate(const Napi::CallbackInfo& info) {
    return safe(info, [&]() {
        return Napi::Number::New(info.Env(),
            rotate(requireHandle(info,0),
                   requireNumber(info,1,"ax"),
                   requireNumber(info,2,"ay"),
                   requireNumber(info,3,"az"),
                   requireNumber(info,4,"angleRad")));
    });
}

// ----------------------------------------------------------- tessellate
Napi::Value Tessellate(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        double linTol = info.Length() > 1 && info[1].IsNumber() ? info[1].As<Napi::Number>().DoubleValue() : 0.1;
        double angTol = info.Length() > 2 && info[2].IsNumber() ? info[2].As<Napi::Number>().DoubleValue() : 0.5;

        Mesh m = tessellate(h, linTol, angTol);
        auto env = info.Env();
        auto out = Napi::Object::New(env);

        auto positions = Napi::Float32Array::New(env, m.positions.size());
        std::copy(m.positions.begin(), m.positions.end(), positions.Data());
        out.Set("positions", positions);

        auto normals = Napi::Float32Array::New(env, m.normals.size());
        std::copy(m.normals.begin(), m.normals.end(), normals.Data());
        out.Set("normals", normals);

        auto indices = Napi::Uint32Array::New(env, m.indices.size());
        std::copy(m.indices.begin(), m.indices.end(), indices.Data());
        out.Set("indices", indices);

        // Per-triangle 1-based BREP face id — enables viewport raycast →
        // face picking (sketch-on-face, direct edit, selection).
        auto faceIds = Napi::Uint32Array::New(env, m.faceIds.size());
        std::copy(m.faceIds.begin(), m.faceIds.end(), faceIds.Data());
        out.Set("faceIds", faceIds);

        out.Set("triangleCount", Napi::Number::New(env, static_cast<double>(m.indices.size() / 3)));
        return out;
    });
}

// ----------------------------------------------------------- mass props
Napi::Value MassProps(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        ShapeHandle h = requireHandle(info, 0);
        // NATIVE handle: exact analytic mass properties via the native divergence-
        // theorem integrator — no OCCT (verified identical to the OCCT bridge:
        // cylinder vol/com/area match to round-off). Same JS shape as the OCCT path.
        if (ShapeRegistry::instance().kindOf(h) == ShapeKind::NativeSolid) {
            const forge::native::brep::MassProps mp =
                forge::native::brep::massProperties(ShapeRegistry::instance().getNativeSolid(h));
            auto out = Napi::Object::New(env);
            out.Set("volume", mp.volume);
            out.Set("area", mp.area);
            auto com = Napi::Array::New(env, 3);
            com.Set(uint32_t{0}, mp.com[0]);
            com.Set(uint32_t{1}, mp.com[1]);
            com.Set(uint32_t{2}, mp.com[2]);
            out.Set("centerOfMass", com);
            auto inertiaCom = Napi::Array::New(env, 9);
            for (uint32_t k = 0; k < 9; ++k) inertiaCom.Set(k, mp.inertiaCom[k]);
            out.Set("inertiaCom", inertiaCom);
            return out;
        }
        auto p = massProperties(h);
        auto out = Napi::Object::New(env);
        out.Set("volume", p.volume);
        out.Set("area", p.area);
        auto com = Napi::Array::New(env, 3);
        com.Set(uint32_t{0}, p.cx);
        com.Set(uint32_t{1}, p.cy);
        com.Set(uint32_t{2}, p.cz);
        out.Set("centerOfMass", com);
        // Inertia tensor about the COM, unit density, row-major 9
        // [Ixx,Ixy,Ixz, Iyx,Iyy,Iyz, Izx,Izy,Izz] (mass·mm² at mass==volume).
        auto inertiaCom = Napi::Array::New(env, 9);
        for (uint32_t k = 0; k < 9; ++k) {
            inertiaCom.Set(k, p.inertiaCom[k]);
        }
        out.Set("inertiaCom", inertiaCom);
        return out;
    });
}

// ============================================================================
// IN-HOUSE KERNEL STEP 1 — parallel OCCT-FREE native B-rep surface.
//   These run forge::native::brep (pure C++20, no OCCT) and are exposed as
//   nativeMakeBox/.../nativeMassProps ONLY when the addon is compiled with
//   -DFORGE_NATIVE_BREP. Every existing OCCT binding (makeBox/massProps/...)
//   is left completely unchanged; this is additive (Bible §0/§9).
//
//   The native solid is built fresh per call (the in-house lineage/registry for
//   native solids is a later increment), and the JS surface returns the exact
//   mass-properties + a watertight tessellation so the path is verifiable
//   end-to-end through the addon, mirroring the OCCT massProps/ tessellate shape.
// ============================================================================
#ifdef FORGE_NATIVE_BREP
namespace {

// Build the native primitive named by info[0] from info[1..] and return its
// owning factory (which owns the topology/surfaces). The returned Solid* is
// written through `outSolid` and is valid for the factory's lifetime. Pure
// in-house forge::native::brep — no OCCT.
std::unique_ptr<forge::native::brep::SolidFactory>
buildNativePrimitive(const Napi::CallbackInfo& info,
                     forge::native::brep::Solid** outSolid) {
    using namespace forge::native::brep;
    std::string kind = info[0].As<Napi::String>().Utf8Value();
    auto fac = std::make_unique<SolidFactory>();
    auto N = [&](int i, const char* what) { return requireNumber(info, i + 1, what); };
    Solid* s = nullptr;
    if (kind == "box")           s = fac->buildBox(N(0,"dx"), N(1,"dy"), N(2,"dz"));
    else if (kind == "cylinder") s = fac->buildCylinder(N(0,"r"), N(1,"h"));
    else if (kind == "cone")     s = fac->buildCone(N(0,"r1"), N(1,"r2"), N(2,"h"));
    else if (kind == "sphere")   s = fac->buildSphere(N(0,"r"));
    else if (kind == "torus")    s = fac->buildTorus(N(0,"R"), N(1,"r"));
    else if (kind == "prism")    s = fac->buildPrism((int)N(0,"n"), N(1,"R"), N(2,"h"));
    else if (kind == "wedge")    s = fac->buildWedge(N(0,"dx"), N(1,"dy"), N(2,"dz"), N(3,"ltx"));
    else if (kind == "pyramid")  s = fac->buildPyramid(N(0,"dx"), N(1,"dy"), N(2,"h"));
    else if (kind == "ellipsoid")s = fac->buildEllipsoid(N(0,"rx"), N(1,"ry"), N(2,"rz"));
    else if (kind == "tube")     s = fac->buildTube(N(0,"rO"), N(1,"rI"), N(2,"h"));
    else throw std::invalid_argument("forge: unknown native primitive kind '" + kind + "'");
    *outSolid = s;
    return fac;
}

// nativeMassProps(kind, ...args) -> { volume, area, centerOfMass[3], inertiaCom[9] }
// mirrors the OCCT massProps JS shape, computed entirely in-house.
Napi::Value NativeMassProps(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        using namespace forge::native::brep;
        Solid* s = nullptr;
        auto fac = buildNativePrimitive(info, &s);
        // Fully qualify the struct: the unqualified name `MassProps` would
        // resolve to the OCCT N-API function `MassProps` in this scope.
        forge::native::brep::MassProps mp = massProperties(*s);

        auto env = info.Env();
        auto out = Napi::Object::New(env);
        out.Set("volume", mp.volume);
        out.Set("area", mp.area);
        auto com = Napi::Array::New(env, 3);
        com.Set(uint32_t{0}, mp.com[0]);
        com.Set(uint32_t{1}, mp.com[1]);
        com.Set(uint32_t{2}, mp.com[2]);
        out.Set("centerOfMass", com);
        auto inertiaCom = Napi::Array::New(env, 9);
        for (uint32_t k = 0; k < 9; ++k) inertiaCom.Set(k, mp.inertiaCom[k]);
        out.Set("inertiaCom", inertiaCom);
        return out;
    });
}

// nativeTessellate(kind, ...args) -> { positions, indices, watertight, triangleCount }
Napi::Value NativeTessellate(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        using namespace forge::native::brep;
        Solid* s = nullptr;
        auto fac = buildNativePrimitive(info, &s);

        std::vector<double> pos; std::vector<std::uint32_t> idx;
        tessellateSolid(*s, pos, idx);
        bool ok = false;
        auto m = tessellateSolidToMesh(*s, ok);
        auto rep = m.validate();

        auto env = info.Env();
        auto out = Napi::Object::New(env);
        auto jp = Napi::Array::New(env, pos.size());
        for (uint32_t i = 0; i < pos.size(); ++i) jp.Set(i, pos[i]);
        auto ji = Napi::Array::New(env, idx.size());
        for (uint32_t i = 0; i < idx.size(); ++i) ji.Set(i, idx[i]);
        out.Set("positions", jp);
        out.Set("indices", ji);
        out.Set("watertight", rep.isValid());
        out.Set("triangleCount", (double)(idx.size() / 3));
        return out;
    });
}

// nativeFaceInventory(handle) -> [{index,kind,radius,minorRadius,axisLocation[3],
// direction[3],stripFaceCount}] — the native G1 face-identity query. Groups the
// native Solid's strip faces by shared Surface into canonical analytic faces
// (cylinder=3, box=6, torus=1), matching OCCT's faceInventory WITHOUT OCCT.
Napi::Value NativeFaceInventory(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        using namespace forge::native::brep;
        auto env = info.Env();
        ShapeHandle h = requireHandle(info, 0);
        auto& reg = ShapeRegistry::instance();
        if (reg.kindOf(h) != ShapeKind::NativeSolid) {
            throw std::runtime_error(
                "forge.nativeFaceInventory: handle is not a native analytic solid");
        }
        const Solid& s = reg.getNativeSolid(h);
        const std::vector<AnalyticFaceInfo> faces = analyticFaceInventory(s);
        Napi::Array outArr = Napi::Array::New(env, faces.size());
        auto vec3 = [&](const Vec3& v) {
            Napi::Array a = Napi::Array::New(env, 3);
            a.Set(uint32_t(0), Napi::Number::New(env, v.x));
            a.Set(uint32_t(1), Napi::Number::New(env, v.y));
            a.Set(uint32_t(2), Napi::Number::New(env, v.z));
            return a;
        };
        for (std::size_t i = 0; i < faces.size(); ++i) {
            const AnalyticFaceInfo& af = faces[i];
            Napi::Object o = Napi::Object::New(env);
            o.Set("index", Napi::Number::New(env, double(i + 1)));
            o.Set("kind", Napi::String::New(env, af.kind));
            o.Set("radius", Napi::Number::New(env, af.radius));
            o.Set("minorRadius", Napi::Number::New(env, af.minorRadius));
            o.Set("area", Napi::Number::New(env, af.area));
            o.Set("stripFaceCount", Napi::Number::New(env, double(af.stripFaceCount)));
            o.Set("axisLocation", vec3(af.origin));
            o.Set("direction", vec3(af.axis));
            o.Set("centroid", vec3(af.centroid));
            outArr.Set(uint32_t(i), o);
        }
        return outArr;
    });
}

// nativeEdgeCount(handle) -> canonical analytic edge count (face-pair grouping), no
// OCCT. cyl 3 / cone 3 / torus 2 / box 12.
Napi::Value NativeEdgeCount(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        using namespace forge::native::brep;
        ShapeHandle h = requireHandle(info, 0);
        auto& reg = ShapeRegistry::instance();
        if (reg.kindOf(h) != ShapeKind::NativeSolid) {
            throw std::runtime_error(
                "forge.nativeEdgeCount: handle is not a native analytic solid");
        }
        return Napi::Number::New(info.Env(),
                                 double(analyticEdgeCount(reg.getNativeSolid(h))));
    });
}

// nativeBoolean(op, kindA, ...argsA, "|", kindB, ...argsB) — IN-HOUSE KERNEL
// STEP 2. Builds two native primitives, runs the OCCT-free native boolean
// (forge::native::brep::booleanSolid), and returns the result's exact mass-props
// + a watertight tessellation (mirroring NativeMassProps/NativeTessellate). The
// argument vector is split on a "|" string token: everything before it is the
// kind+args for A, everything after is for B. `op` is "fuse" | "cut" | "common".
// Returns { ok, reason, volume, area, centerOfMass[3], triangleCount, watertight }.
Napi::Value NativeBoolean(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        using namespace forge::native::brep;
        auto env = info.Env();
        if (info.Length() < 2 || !info[0].IsString())
            throw std::invalid_argument("forge: nativeBoolean(op, A.. , '|', B..)");
        std::string opName = info[0].As<Napi::String>().Utf8Value();
        BoolOp op;
        if      (opName == "fuse")   op = BoolOp::Fuse;
        else if (opName == "cut")    op = BoolOp::Cut;
        else if (opName == "common") op = BoolOp::Common;
        else throw std::invalid_argument("forge: nativeBoolean op must be fuse|cut|common");

        // Find the "|" splitter among the remaining args.
        std::size_t split = 0;
        for (std::size_t i = 1; i < info.Length(); ++i) {
            if (info[i].IsString() && info[i].As<Napi::String>().Utf8Value() == "|") {
                split = i; break;
            }
        }
        if (split == 0)
            throw std::invalid_argument("forge: nativeBoolean needs a '|' between A and B args");

        // Build a primitive from a contiguous slice [begin,end) of info (info[begin]
        // is the kind string). Reuses the canonical placement of buildNativePrimitive
        // semantics but indexes a sub-range of the call args.
        auto buildFromRange = [&](std::size_t begin, std::size_t end,
                                  std::unique_ptr<SolidFactory>& facOut) -> Solid* {
            if (begin >= end || !info[begin].IsString())
                throw std::invalid_argument("forge: nativeBoolean operand missing kind");
            std::string kind = info[begin].As<Napi::String>().Utf8Value();
            auto fac = std::make_unique<SolidFactory>(PrimitiveOptions{});
            auto N = [&](std::size_t k, const char* what) -> double {
                std::size_t idx = begin + 1 + k;
                if (idx >= end || !info[idx].IsNumber())
                    throw std::invalid_argument(std::string("forge: nativeBoolean missing ") + what);
                return info[idx].As<Napi::Number>().DoubleValue();
            };
            Solid* s = nullptr;
            if (kind == "box")           s = fac->buildBox(N(0,"dx"), N(1,"dy"), N(2,"dz"));
            else if (kind == "cylinder") s = fac->buildCylinder(N(0,"r"), N(1,"h"));
            else if (kind == "cone")     s = fac->buildCone(N(0,"r1"), N(1,"r2"), N(2,"h"));
            else if (kind == "sphere")   s = fac->buildSphere(N(0,"r"));
            else if (kind == "prism")    s = fac->buildPrism((int)N(0,"n"), N(1,"R"), N(2,"h"));
            else if (kind == "wedge")    s = fac->buildWedge(N(0,"dx"), N(1,"dy"), N(2,"dz"), N(3,"ltx"));
            else if (kind == "pyramid")  s = fac->buildPyramid(N(0,"dx"), N(1,"dy"), N(2,"h"));
            else throw std::invalid_argument("forge: nativeBoolean unsupported operand kind '" + kind + "'");
            facOut = std::move(fac);
            return s;
        };

        std::unique_ptr<SolidFactory> facA, facB;
        Solid* A = buildFromRange(1, split, facA);
        Solid* B = buildFromRange(split + 1, info.Length(), facB);

        BooleanResult r = booleanSolid(*A, *B, op);
        auto out = Napi::Object::New(env);
        out.Set("ok", r.ok);
        out.Set("reason", Napi::String::New(env, r.reason ? r.reason : ""));
        out.Set("usedMeshFallback", r.usedMeshFallback);
        if (!r.ok) {
            out.Set("volume", 0.0);
            out.Set("triangleCount", 0.0);
            out.Set("watertight", false);
            return out;
        }
        // Exact mass-props of the result solid.
        forge::native::brep::MassProps mp = massProperties(*r.solid);
        out.Set("volume", mp.volume);
        out.Set("area", mp.area);
        auto com = Napi::Array::New(env, 3);
        com.Set(uint32_t{0}, mp.com[0]);
        com.Set(uint32_t{1}, mp.com[1]);
        com.Set(uint32_t{2}, mp.com[2]);
        out.Set("centerOfMass", com);
        // Watertight tessellation of the result.
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        tessellateSolid(*r.solid, pos, idx);
        bool tok = false;
        auto m = tessellateSolidToMesh(*r.solid, tok);
        auto rep = m.validate();
        out.Set("triangleCount", (double)(idx.size() / 3));
        out.Set("watertight", rep.isValid());
        return out;
    });
}

// IN-HOUSE KERNEL STEP 3a — toggle the live-op backend at runtime (the A/B
// gate). setNativeBrep(true) routes makeBox/cut/fillet/massProps/tessellate/...
// through forge::native; setNativeBrep(false) restores OCCT. Overrides the
// FORGE_NATIVE_BREP env var for the rest of the process.
Napi::Value SetNativeBrep(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        bool on = info.Length() > 0 && info[0].IsBoolean()
                      ? info[0].As<Napi::Boolean>().Value() : true;
        forge::native::brep::setForgeNativeBrepEnabled(on);
        return Napi::Boolean::New(info.Env(), on);
    });
}
Napi::Value NativeBrepEnabled(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Boolean::New(info.Env(),
            forge::native::brep::forgeNativeBrepEnabled());
    });
}

// kindOf(handle) -> "occt" | "nativeSolid" | "nativeMesh" — lets the A/B gate
// assert which backend a handle is actually riding on.
Napi::Value KindOf(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        ShapeHandle h = requireHandle(info, 0);
        ShapeKind k = ShapeRegistry::instance().kindOf(h);
        const char* s = (k == ShapeKind::NativeSolid) ? "nativeSolid"
                      : (k == ShapeKind::NativeMesh)   ? "nativeMesh" : "occt";
        return Napi::String::New(info.Env(), s);
    });
}

} // namespace
#endif // FORGE_NATIVE_BREP

// ----------------------------------------------------------- shape lifecycle
Napi::Value Retain(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        ShapeRegistry::instance().retain(requireHandle(info, 0));
        return info.Env().Undefined();
    });
}
Napi::Value Release(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        ShapeRegistry::instance().release(requireHandle(info, 0));
        return info.Env().Undefined();
    });
}
Napi::Value LiveCount(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(ShapeRegistry::instance().liveCount()));
    });
}

// ----------------------------------------------------------- components
Napi::Value AddInstance(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto comp = requireHandle(info, 0);
        auto xform = readTransform(info, 1);
        return Napi::Number::New(info.Env(),
            ComponentRegistry::instance().addInstance(comp, xform));
    });
}
Napi::Value RemoveInstance(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        ComponentRegistry::instance().removeInstance(requireHandle(info, 0));
        return info.Env().Undefined();
    });
}
Napi::Value UpdateTransform(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto id = requireHandle(info, 0);
        auto xform = readTransform(info, 1);
        ComponentRegistry::instance().updateTransform(id, xform);
        return info.Env().Undefined();
    });
}
Napi::Value InstanceCount(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(ComponentRegistry::instance().count()));
    });
}
Napi::Value QueryAABB(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        AABB box = readAABB(info, 0);
        auto hits = ComponentRegistry::instance().queryAABB(box);
        auto arr = Napi::Uint32Array::New(info.Env(), hits.size());
        std::copy(hits.begin(), hits.end(), arr.Data());
        return arr;
    });
}
Napi::Value GetInstanceAABB(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto id = requireHandle(info, 0);
        auto a = ComponentRegistry::instance().getAABB(id);
        auto arr = Napi::Float64Array::New(info.Env(), 6);
        arr.Data()[0] = a.minX; arr.Data()[1] = a.minY; arr.Data()[2] = a.minZ;
        arr.Data()[3] = a.maxX; arr.Data()[4] = a.maxY; arr.Data()[5] = a.maxZ;
        return arr;
    });
}
Napi::Value InstanceExists(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Boolean::New(info.Env(),
            ComponentRegistry::instance().exists(requireHandle(info, 0)));
    });
}
Napi::Value ReserveInstances(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        if (info.Length() < 1 || !info[0].IsNumber()) {
            throw Napi::TypeError::New(info.Env(), "forge: reserveInstances expects a number");
        }
        ComponentRegistry::instance().reserve(info[0].As<Napi::Number>().Uint32Value());
        return info.Env().Undefined();
    });
}
Napi::Value InstanceBytesUsed(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(ComponentRegistry::instance().bytesUsed()));
    });
}

// ----------------------------------------------------------- BVH (Forge-25)
//
// Spatial index over instance AABBs. Build is O(N log N) SAH-binned;
// queries are O(log N + k). Build is lazy — queryAABB falls back to the
// linear scan when the BVH is dirty so callers that never call buildBvh()
// keep the historical semantics.
Napi::Value BuildBvh(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(ComponentRegistry::instance().buildBvh()));
    });
}
Napi::Value IsBvhFresh(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Boolean::New(info.Env(),
            ComponentRegistry::instance().isBvhFresh());
    });
}
Napi::Value QueryRay(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        if (info.Length() < 2 || !info[0].IsTypedArray() || !info[1].IsTypedArray()) {
            throw Napi::TypeError::New(info.Env(),
                "forge.queryRay(origin: Float64Array[3], dir: Float64Array[3])");
        }
        auto o = info[0].As<Napi::Float64Array>();
        auto d = info[1].As<Napi::Float64Array>();
        if (o.ElementLength() != 3 || d.ElementLength() != 3) {
            throw Napi::TypeError::New(info.Env(),
                "forge.queryRay: origin and dir must each be Float64Array[3]");
        }
        auto hits = ComponentRegistry::instance().queryRay(
            o.Data()[0], o.Data()[1], o.Data()[2],
            d.Data()[0], d.Data()[1], d.Data()[2]);
        auto arr = Napi::Uint32Array::New(info.Env(), hits.size());
        std::copy(hits.begin(), hits.end(), arr.Data());
        return arr;
    });
}
Napi::Value QueryFrustum(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        if (info.Length() < 1 || !info[0].IsTypedArray()) {
            throw Napi::TypeError::New(info.Env(),
                "forge.queryFrustum(planes: Float64Array[24])");
        }
        auto p = info[0].As<Napi::Float64Array>();
        if (p.ElementLength() != 24) {
            throw Napi::TypeError::New(info.Env(),
                "forge.queryFrustum: planes must have 24 elements (6 × (a,b,c,d))");
        }
        std::array<double,24> arrIn{};
        std::copy(p.Data(), p.Data() + 24, arrIn.begin());
        auto hits = ComponentRegistry::instance().queryFrustum(arrIn);
        auto arr = Napi::Uint32Array::New(info.Env(), hits.size());
        std::copy(hits.begin(), hits.end(), arr.Data());
        return arr;
    });
}

// ----------------------------------------------------------- LOD (Forge-25)
Napi::Value TessellateLOD(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        const auto lvlInt = requireHandle(info, 1);
        if (lvlInt > 2) {
            throw Napi::TypeError::New(info.Env(),
                "forge.tessellateLOD: level must be 0|1|2 (Low|Med|High)");
        }
        const auto& m = tessellateLOD(h, static_cast<LODLevel>(lvlInt));
        auto env = info.Env();
        auto out = Napi::Object::New(env);
        auto positions = Napi::Float32Array::New(env, m.positions.size());
        std::copy(m.positions.begin(), m.positions.end(), positions.Data());
        out.Set("positions", positions);
        auto normals = Napi::Float32Array::New(env, m.normals.size());
        std::copy(m.normals.begin(), m.normals.end(), normals.Data());
        out.Set("normals", normals);
        auto indices = Napi::Uint32Array::New(env, m.indices.size());
        std::copy(m.indices.begin(), m.indices.end(), indices.Data());
        out.Set("indices", indices);
        out.Set("triangleCount", Napi::Number::New(env, static_cast<double>(m.indices.size() / 3)));
        out.Set("level", Napi::Number::New(env, lvlInt));
        return out;
    });
}
Napi::Value SelectLOD(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto id = requireHandle(info, 0);
        const double ex = requireNumber(info, 1, "eyeX");
        const double ey = requireNumber(info, 2, "eyeY");
        const double ez = requireNumber(info, 3, "eyeZ");
        const double fov = requireNumber(info, 4, "fovRad");
        const double sh  = requireNumber(info, 5, "screenHeightPx");
        return Napi::Number::New(info.Env(),
            static_cast<double>(selectLOD(id, ex, ey, ez, fov, sh)));
    });
}
Napi::Value ClearLODCache(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        clearLODCache();
        return info.Env().Undefined();
    });
}
Napi::Value LODCacheEntries(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(), static_cast<double>(lodCacheEntries()));
    });
}

// ----------------------------------------------------------- async tessellate
//
// Returns a JS Promise that resolves to { positions, normals, indices,
// triangleCount } once a worker thread finishes the OCCT mesh. We use a
// Napi::ThreadSafeFunction so the worker thread can hand the result back
// to V8 from the main JS thread.
Napi::Value TessellateAsync(const Napi::CallbackInfo& info) {
    auto env = info.Env();
    auto h = requireHandle(info, 0);
    double linTol = info.Length() > 1 && info[1].IsNumber()
        ? info[1].As<Napi::Number>().DoubleValue() : 0.1;
    double angTol = info.Length() > 2 && info[2].IsNumber()
        ? info[2].As<Napi::Number>().DoubleValue() : 0.5;

    auto deferred = Napi::Promise::Deferred::New(env);

    struct Box { Mesh mesh; bool ok; std::string err; };
    auto* slot = new Box{};

    auto tsfn = Napi::ThreadSafeFunction::New(
        env, Napi::Function(), "forge.tessellateAsync", 0, 1);

    tessellateAsync(h, linTol, angTol, [slot, tsfn, deferred](Mesh m) mutable {
        slot->mesh = std::move(m);
        slot->ok = true;
        tsfn.BlockingCall([slot, deferred](Napi::Env env, Napi::Function) {
            auto out = Napi::Object::New(env);
            auto positions = Napi::Float32Array::New(env, slot->mesh.positions.size());
            std::copy(slot->mesh.positions.begin(), slot->mesh.positions.end(), positions.Data());
            out.Set("positions", positions);
            auto normals = Napi::Float32Array::New(env, slot->mesh.normals.size());
            std::copy(slot->mesh.normals.begin(), slot->mesh.normals.end(), normals.Data());
            out.Set("normals", normals);
            auto indices = Napi::Uint32Array::New(env, slot->mesh.indices.size());
            std::copy(slot->mesh.indices.begin(), slot->mesh.indices.end(), indices.Data());
            out.Set("indices", indices);
            out.Set("triangleCount", Napi::Number::New(env,
                static_cast<double>(slot->mesh.indices.size() / 3)));
            deferred.Resolve(out);
            delete slot;
        });
        tsfn.Release();
    });

    return deferred.Promise();
}

Napi::Value TessellationPoolSize(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(tessellationPoolSize()));
    });
}
Napi::Value TessellationWaitIdle(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        waitForTessellationIdle();
        return info.Env().Undefined();
    });
}

// ----------------------------------------------------------- assembly solver
//
// Wraps AssemblySolver under the `forge.assembly` namespace. The kind code
// is the integer value of MateKind; topo ids are the schematic 0..3
// described in AssemblySolver.hpp. `value` is optional for kinds that
// don't use it (defaults to 0).
Napi::Value AddMate(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto kind = static_cast<MateKind>(requireHandle(info, 0));
        MateRef a{static_cast<InstanceId>(requireHandle(info, 1)),
                  static_cast<std::uint32_t>(requireHandle(info, 2))};
        MateRef b{static_cast<InstanceId>(requireHandle(info, 3)),
                  static_cast<std::uint32_t>(requireHandle(info, 4))};
        const double value = info.Length() > 5 && info[5].IsNumber()
            ? info[5].As<Napi::Number>().DoubleValue() : 0.0;
        const auto id = AssemblySolver::instance().addMate(kind, a, b, value);
        return Napi::Number::New(info.Env(), id);
    });
}

Napi::Value RemoveMate(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        AssemblySolver::instance().removeMate(requireHandle(info, 0));
        return info.Env().Undefined();
    });
}

Napi::Value SetMateActive(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto id = requireHandle(info, 0);
        if (info.Length() < 2 || !info[1].IsBoolean()) {
            throw Napi::TypeError::New(info.Env(),
                "forge.assembly.setMateActive: expected (id, bool)");
        }
        AssemblySolver::instance().setActive(id, info[1].As<Napi::Boolean>().Value());
        return info.Env().Undefined();
    });
}

Napi::Value SetFixed(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto id = requireHandle(info, 0);
        if (info.Length() < 2 || !info[1].IsBoolean()) {
            throw Napi::TypeError::New(info.Env(),
                "forge.assembly.setFixed: expected (instanceId, bool)");
        }
        AssemblySolver::instance().setFixed(id, info[1].As<Napi::Boolean>().Value());
        return info.Env().Undefined();
    });
}

Napi::Value SolveAssembly(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto rep = AssemblySolver::instance().solve();
        auto env = info.Env();
        auto out = Napi::Object::New(env);
        out.Set("converged",  Napi::Boolean::New(env, rep.converged));
        out.Set("iterations", Napi::Number::New(env, rep.iterations));
        out.Set("residual",   Napi::Number::New(env, rep.residual));
        return out;
    });
}

Napi::Value MateCount(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(AssemblySolver::instance().mateCount()));
    });
}

Napi::Value ClearMates(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        AssemblySolver::instance().clearAll();
        return info.Env().Undefined();
    });
}

// ----------------------------------------------------------- hierarchy (Forge-35)
namespace {
Napi::Float64Array transformToTypedArray(Napi::Env env, const Transform4x4& x) {
    auto arr = Napi::Float64Array::New(env, 16);
    std::copy(x.m.begin(), x.m.end(), arr.Data());
    return arr;
}
} // namespace

Napi::Value ClearHierarchy(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        AssemblyHierarchy::instance().clearAll();
        return info.Env().Undefined();
    });
}

Napi::Value SetParent(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto child = static_cast<InstanceId>(requireHandle(info, 0));
        // parent may be 0 (root) — accept directly.
        if (info.Length() < 2 || !info[1].IsNumber()) {
            throw Napi::TypeError::New(info.Env(),
                "forge.assembly.setParent: expected (childId, parentId)");
        }
        const auto parent = static_cast<InstanceId>(
            info[1].As<Napi::Number>().Uint32Value());
        AssemblyHierarchy::instance().setParent(child, parent);
        return info.Env().Undefined();
    });
}

Napi::Value GetChildren(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        if (info.Length() < 1 || !info[0].IsNumber()) {
            throw Napi::TypeError::New(info.Env(),
                "forge.assembly.getChildren: expected (parentId)");
        }
        const auto parent = static_cast<InstanceId>(
            info[0].As<Napi::Number>().Uint32Value());
        auto kids = AssemblyHierarchy::instance().getChildren(parent);
        auto arr = Napi::Uint32Array::New(info.Env(), kids.size());
        std::copy(kids.begin(), kids.end(), arr.Data());
        return arr;
    });
}

Napi::Value WorldTransform(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto id = static_cast<InstanceId>(requireHandle(info, 0));
        auto x = AssemblyHierarchy::instance().worldTransform(id);
        return transformToTypedArray(info.Env(), x);
    });
}

Napi::Value DetectInterference(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (info.Length() < 1 || !info[0].IsArray()) {
            throw Napi::TypeError::New(env,
                "forge.assembly.detectInterference: arg 0 must be an InstanceId array");
        }
        auto idArr = info[0].As<Napi::Array>();
        std::vector<InstanceId> ids;
        ids.reserve(idArr.Length());
        for (std::uint32_t i = 0; i < idArr.Length(); ++i) {
            auto v = idArr.Get(i);
            if (!v.IsNumber()) {
                throw Napi::TypeError::New(env,
                    "forge.assembly.detectInterference: instance ids must be numbers");
            }
            ids.push_back(static_cast<InstanceId>(v.As<Napi::Number>().Uint32Value()));
        }
        const double tol = info.Length() > 1 && info[1].IsNumber()
            ? info[1].As<Napi::Number>().DoubleValue() : 0.0;

        auto pairs = detectInterference(ids, tol);
        auto out = Napi::Array::New(env, pairs.size());
        for (std::size_t i = 0; i < pairs.size(); ++i) {
            auto o = Napi::Object::New(env);
            o.Set("instA",  Napi::Number::New(env, pairs[i].instA));
            o.Set("instB",  Napi::Number::New(env, pairs[i].instB));
            o.Set("volume", Napi::Number::New(env, pairs[i].volume));
            out.Set(static_cast<std::uint32_t>(i), o);
        }
        return out;
    });
}

Napi::Value RunMotionStudy(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        const auto motor = static_cast<InstanceId>(requireHandle(info, 0));
        const auto axis  = static_cast<std::uint32_t>(requireHandle(info, 1));
        const double totalAngle = requireNumber(info, 2, "totalAngleRad");
        const auto steps = static_cast<std::uint32_t>(requireHandle(info, 3));

        auto run = runMotionStudy(motor, axis, totalAngle, steps);

        auto out = Napi::Object::New(env);
        auto framesArr = Napi::Array::New(env, run.frames.size());
        for (std::size_t i = 0; i < run.frames.size(); ++i) {
            const auto& f = run.frames[i];
            auto fo = Napi::Object::New(env);
            fo.Set("t", Napi::Number::New(env, f.t));
            fo.Set("value", Napi::Number::New(env, f.value));
            fo.Set("converged", Napi::Boolean::New(env, f.converged));
            auto transforms = Napi::Object::New(env);
            for (const auto& [id, xform] : f.transforms) {
                transforms.Set(std::to_string(id),
                    transformToTypedArray(env, xform));
            }
            fo.Set("transforms", transforms);
            framesArr.Set(static_cast<std::uint32_t>(i), fo);
        }
        out.Set("frames", framesArr);
        out.Set("allConverged", Napi::Boolean::New(env, run.allConverged));
        out.Set("maxResidual",  Napi::Number::New(env, run.maxResidual));
        out.Set("stepCount",
            Napi::Number::New(env, static_cast<double>(run.frames.size())));
        return out;
    });
}

// ----------------------------------------------------------- drawings
//
// projectShape(handle, presetName?: string)
//   → { visible:Float32Array, visibleStarts:Uint32Array,
//        hidden:Float32Array,  hiddenStarts:Uint32Array,
//        outline:Float32Array, outlineStarts:Uint32Array,
//        direction:[dx,dy,dz] }
//
// The Float32Array packs every polyline's vertices as x0,y0,x1,y1,...
// `*Starts[i]` is the *vertex index* (i.e. byte offset / 8) of polyline i's
// first vertex. `*Starts[polylineCount]` is the total vertex count, so
// polyline i runs from starts[i] to starts[i+1].
//
// View direction comes from either:
//   * arg[1] string preset: "front" | "top" | "right" | "iso"
//   * else arg[1] Float64Array [dx, dy, dz]
//   * else default to "front".
Napi::Value ProjectShape(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        ShapeHandle h = requireHandle(info, 0);

        ProjectionDirection dir = frontView();
        if (info.Length() > 1 && info[1].IsString()) {
            std::string name = info[1].As<Napi::String>();
            if      (name == "front")     dir = frontView();
            else if (name == "top")       dir = topView();
            else if (name == "right")     dir = rightView();
            else if (name == "iso"
                  || name == "isometric") dir = isometricView();
            else {
                throw Napi::TypeError::New(env,
                    "forge.drawings.projectShape: unknown preset '" + name + "'");
            }
        } else if (info.Length() > 1 && info[1].IsTypedArray()) {
            auto arr = info[1].As<Napi::Float64Array>();
            if (arr.ElementLength() != 3) {
                throw Napi::TypeError::New(env,
                    "forge.drawings.projectShape: direction must be Float64Array[3]");
            }
            dir = { arr.Data()[0], arr.Data()[1], arr.Data()[2] };
        }

        ProjectedView pv = projectShape(h, dir);

        // ---- packer ----
        auto pack = [&](const std::vector<Polyline2D>& polys) -> Napi::Object {
            std::size_t totalVerts = 0;
            for (const auto& p : polys) totalVerts += p.size();

            auto verts  = Napi::Float32Array::New(env, totalVerts * 2);
            auto starts = Napi::Uint32Array::New(env, polys.size() + 1);

            std::size_t vIdx = 0;
            for (std::size_t i = 0; i < polys.size(); ++i) {
                starts.Data()[i] = static_cast<std::uint32_t>(vIdx);
                for (const auto& xy : polys[i]) {
                    verts.Data()[2 * vIdx + 0] = static_cast<float>(xy.first);
                    verts.Data()[2 * vIdx + 1] = static_cast<float>(xy.second);
                    ++vIdx;
                }
            }
            starts.Data()[polys.size()] = static_cast<std::uint32_t>(vIdx);

            auto out = Napi::Object::New(env);
            out.Set("verts",  verts);
            out.Set("starts", starts);
            out.Set("count",  Napi::Number::New(env, static_cast<double>(polys.size())));
            return out;
        };

        auto vis = pack(pv.visible);
        auto hid = pack(pv.hidden);
        auto out_ = pack(pv.outline);

        auto out = Napi::Object::New(env);
        out.Set("visible",       vis.Get("verts"));
        out.Set("visibleStarts", vis.Get("starts"));
        out.Set("visibleCount",  vis.Get("count"));
        out.Set("hidden",        hid.Get("verts"));
        out.Set("hiddenStarts",  hid.Get("starts"));
        out.Set("hiddenCount",   hid.Get("count"));
        out.Set("outline",       out_.Get("verts"));
        out.Set("outlineStarts", out_.Get("starts"));
        out.Set("outlineCount",  out_.Get("count"));

        auto d = Napi::Array::New(env, 3);
        d.Set(uint32_t{0}, dir.dx);
        d.Set(uint32_t{1}, dir.dy);
        d.Set(uint32_t{2}, dir.dz);
        out.Set("direction", d);
        return out;
    });
}

// projectShapePerspective(handle, cam?)
//   cam = { eye:[x,y,z], target:[x,y,z], up:[x,y,z], fovY:number(radians) }
//   -> { visible, visibleStarts, visibleCount, hidden, hiddenStarts, hiddenCount,
//        outline, outlineStarts, outlineCount }  (same packing as projectShape,
//        minus `direction` — a perspective camera has no single parallel direction).
//
// Runs the NATIVE analytic perspective HLR (forge::projectShapePerspective ->
// brep::hlrPerspective). Native-only: throws for a mesh / non-importable input or a
// degenerate camera (the honest error surfaces to JS; no fabricated view).
Napi::Value ProjectShapePerspective(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        ShapeHandle h = requireHandle(info, 0);

        // Defaults: eye (4,4,4) looking at the origin, world-up +Z, 60deg vertical fov.
        PerspectiveCamera cam{ 4.0, 4.0, 4.0,  0.0, 0.0, 0.0,  0.0, 0.0, 1.0,
                               1.0471975511965976 };
        auto readVec3 = [&](Napi::Value v, double& x, double& y, double& z) {
            if (v.IsTypedArray()) {
                auto a = v.As<Napi::Float64Array>();
                if (a.ElementLength() >= 3) { x = a.Data()[0]; y = a.Data()[1]; z = a.Data()[2]; }
            } else if (v.IsArray()) {
                auto a = v.As<Napi::Array>();
                if (a.Length() >= 3) {
                    x = a.Get(uint32_t{0}).As<Napi::Number>().DoubleValue();
                    y = a.Get(uint32_t{1}).As<Napi::Number>().DoubleValue();
                    z = a.Get(uint32_t{2}).As<Napi::Number>().DoubleValue();
                }
            }
        };
        if (info.Length() > 1 && info[1].IsObject()) {
            auto o = info[1].As<Napi::Object>();
            if (o.Has("eye"))    readVec3(o.Get("eye"),    cam.eyeX,    cam.eyeY,    cam.eyeZ);
            if (o.Has("target")) readVec3(o.Get("target"), cam.targetX, cam.targetY, cam.targetZ);
            if (o.Has("up"))     readVec3(o.Get("up"),     cam.upX,     cam.upY,     cam.upZ);
            if (o.Has("fovY"))
                cam.fovYRadians = o.Get("fovY").As<Napi::Number>().DoubleValue();
            else if (o.Has("fovYRadians"))
                cam.fovYRadians = o.Get("fovYRadians").As<Napi::Number>().DoubleValue();
        }

        ProjectedView pv = projectShapePerspective(h, cam);

        auto pack = [&](const std::vector<Polyline2D>& polys) -> Napi::Object {
            std::size_t totalVerts = 0;
            for (const auto& p : polys) totalVerts += p.size();
            auto verts  = Napi::Float32Array::New(env, totalVerts * 2);
            auto starts = Napi::Uint32Array::New(env, polys.size() + 1);
            std::size_t vIdx = 0;
            for (std::size_t i = 0; i < polys.size(); ++i) {
                starts.Data()[i] = static_cast<std::uint32_t>(vIdx);
                for (const auto& xy : polys[i]) {
                    verts.Data()[2 * vIdx + 0] = static_cast<float>(xy.first);
                    verts.Data()[2 * vIdx + 1] = static_cast<float>(xy.second);
                    ++vIdx;
                }
            }
            starts.Data()[polys.size()] = static_cast<std::uint32_t>(vIdx);
            auto out = Napi::Object::New(env);
            out.Set("verts",  verts);
            out.Set("starts", starts);
            out.Set("count",  Napi::Number::New(env, static_cast<double>(polys.size())));
            return out;
        };

        auto vis  = pack(pv.visible);
        auto hid  = pack(pv.hidden);
        auto out_ = pack(pv.outline);

        auto out = Napi::Object::New(env);
        out.Set("visible",       vis.Get("verts"));
        out.Set("visibleStarts", vis.Get("starts"));
        out.Set("visibleCount",  vis.Get("count"));
        out.Set("hidden",        hid.Get("verts"));
        out.Set("hiddenStarts",  hid.Get("starts"));
        out.Set("hiddenCount",   hid.Get("count"));
        out.Set("outline",       out_.Get("verts"));
        out.Set("outlineStarts", out_.Get("starts"));
        out.Set("outlineCount",  out_.Get("count"));
        return out;
    });
}

// ----------------------------------------------------------- drawings (Forge-32)
//
// Helpers shared by projectSection / projectDetail / projectBroken — they
// each return a richer ProjectedView (Section adds `cut` + `hatch`).

namespace drawings_bind {

Napi::Object packBucket(const Napi::Env& env, const std::vector<Polyline2D>& polys) {
    std::size_t totalVerts = 0;
    for (const auto& p : polys) totalVerts += p.size();
    auto verts  = Napi::Float32Array::New(env, totalVerts * 2);
    auto starts = Napi::Uint32Array::New(env, polys.size() + 1);
    std::size_t vIdx = 0;
    for (std::size_t i = 0; i < polys.size(); ++i) {
        starts.Data()[i] = static_cast<std::uint32_t>(vIdx);
        for (const auto& xy : polys[i]) {
            verts.Data()[2 * vIdx + 0] = static_cast<float>(xy.first);
            verts.Data()[2 * vIdx + 1] = static_cast<float>(xy.second);
            ++vIdx;
        }
    }
    starts.Data()[polys.size()] = static_cast<std::uint32_t>(vIdx);
    auto out = Napi::Object::New(env);
    out.Set("verts",  verts);
    out.Set("starts", starts);
    out.Set("count",  Napi::Number::New(env, static_cast<double>(polys.size())));
    return out;
}

Napi::Object viewToObj(const Napi::Env& env, const ProjectedView& pv) {
    auto vis = packBucket(env, pv.visible);
    auto hid = packBucket(env, pv.hidden);
    auto ol  = packBucket(env, pv.outline);
    auto cut = packBucket(env, pv.cut);
    auto htc = packBucket(env, pv.hatch);
    auto out = Napi::Object::New(env);
    out.Set("visible",       vis.Get("verts"));
    out.Set("visibleStarts", vis.Get("starts"));
    out.Set("visibleCount",  vis.Get("count"));
    out.Set("hidden",        hid.Get("verts"));
    out.Set("hiddenStarts",  hid.Get("starts"));
    out.Set("hiddenCount",   hid.Get("count"));
    out.Set("outline",       ol.Get("verts"));
    out.Set("outlineStarts", ol.Get("starts"));
    out.Set("outlineCount",  ol.Get("count"));
    out.Set("cut",           cut.Get("verts"));
    out.Set("cutStarts",     cut.Get("starts"));
    out.Set("cutCount",      cut.Get("count"));
    out.Set("hatch",         htc.Get("verts"));
    out.Set("hatchStarts",   htc.Get("starts"));
    out.Set("hatchCount",    htc.Get("count"));
    return out;
}

ProjectionDirection parseDirection(const Napi::Env& env, const Napi::Value& v) {
    if (v.IsString()) {
        std::string name = v.As<Napi::String>();
        if      (name == "front")     return frontView();
        else if (name == "top")       return topView();
        else if (name == "right")     return rightView();
        else if (name == "iso"
              || name == "isometric") return isometricView();
        throw Napi::TypeError::New(env,
            "forge.drawings: unknown view preset '" + name + "'");
    }
    if (v.IsTypedArray()) {
        auto arr = v.As<Napi::Float64Array>();
        if (arr.ElementLength() != 3) {
            throw Napi::TypeError::New(env,
                "forge.drawings: direction must be Float64Array[3]");
        }
        return { arr.Data()[0], arr.Data()[1], arr.Data()[2] };
    }
    return frontView();
}

double objNum(const Napi::Object& o, const char* k, double fallback) {
    if (!o.Has(k)) return fallback;
    auto v = o.Get(k);
    if (!v.IsNumber()) return fallback;
    return v.As<Napi::Number>().DoubleValue();
}

} // namespace drawings_bind

Napi::Value ProjectShapeSection(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        ShapeHandle h = requireHandle(info, 0);
        ProjectionDirection dir = drawings_bind::parseDirection(env,
            info.Length() > 1 ? info[1] : env.Undefined());

        if (info.Length() < 3 || !info[2].IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.drawings.projectSection: expected sectionPlane object {origin:[x,y,z], normal:[x,y,z]}");
        }
        auto planeObj = info[2].As<Napi::Object>();
        SectionPlane plane{};
        auto readVec3 = [&](const char* k, double& a, double& b, double& c) {
            auto v = planeObj.Get(k);
            if (v.IsArray()) {
                auto arr = v.As<Napi::Array>();
                if (arr.Length() >= 3) {
                    a = arr.Get(uint32_t{0}).As<Napi::Number>().DoubleValue();
                    b = arr.Get(uint32_t{1}).As<Napi::Number>().DoubleValue();
                    c = arr.Get(uint32_t{2}).As<Napi::Number>().DoubleValue();
                    return;
                }
            }
            if (v.IsTypedArray()) {
                auto arr = v.As<Napi::Float64Array>();
                if (arr.ElementLength() >= 3) {
                    a = arr.Data()[0]; b = arr.Data()[1]; c = arr.Data()[2];
                    return;
                }
            }
            throw Napi::TypeError::New(env,
                std::string("forge.drawings.projectSection: plane.") + k + " must be a 3-element array");
        };
        readVec3("origin", plane.ox, plane.oy, plane.oz);
        readVec3("normal", plane.nx, plane.ny, plane.nz);

        HatchSpec hatch{ 2.5, 45.0 };
        if (info.Length() > 3 && info[3].IsObject()) {
            auto h2 = info[3].As<Napi::Object>();
            hatch.spacing  = drawings_bind::objNum(h2, "spacing",  hatch.spacing);
            hatch.angleDeg = drawings_bind::objNum(h2, "angleDeg", hatch.angleDeg);
        }

        ProjectedView pv = projectShapeSection(h, dir, plane, hatch);
        auto out = drawings_bind::viewToObj(env, pv);
        auto d = Napi::Array::New(env, 3);
        d.Set(uint32_t{0}, dir.dx);
        d.Set(uint32_t{1}, dir.dy);
        d.Set(uint32_t{2}, dir.dz);
        out.Set("direction", d);
        return out;
    });
}

Napi::Value ProjectShapeDetail(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        ShapeHandle h = requireHandle(info, 0);
        ProjectionDirection dir = drawings_bind::parseDirection(env,
            info.Length() > 1 ? info[1] : env.Undefined());

        if (info.Length() < 3 || !info[2].IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.drawings.projectDetail: expected focusCircle {x,y,r}");
        }
        auto fc = info[2].As<Napi::Object>();
        FocusCircle focus{
            drawings_bind::objNum(fc, "x", 0.0),
            drawings_bind::objNum(fc, "y", 0.0),
            drawings_bind::objNum(fc, "r", 0.0),
        };
        double scale = info.Length() > 3 && info[3].IsNumber()
            ? info[3].As<Napi::Number>().DoubleValue() : 2.0;

        ProjectedView pv = projectShapeDetail(h, dir, focus, scale);
        auto out = drawings_bind::viewToObj(env, pv);
        out.Set("scale", Napi::Number::New(env, scale));
        return out;
    });
}

Napi::Value ProjectShapeBroken(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        ShapeHandle h = requireHandle(info, 0);
        ProjectionDirection dir = drawings_bind::parseDirection(env,
            info.Length() > 1 ? info[1] : env.Undefined());

        if (info.Length() < 3 || !info[2].IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.drawings.projectBroken: expected breakRegion {axis, start, end}");
        }
        auto br = info[2].As<Napi::Object>();
        BreakRegion region{};
        if (br.Has("axis")) {
            auto av = br.Get("axis");
            if (av.IsString()) {
                std::string s = av.As<Napi::String>();
                region.axis = (s == "y" || s == "Y" || s == "vertical") ? 1 : 0;
            } else if (av.IsNumber()) {
                region.axis = av.As<Napi::Number>().Int32Value();
            }
        }
        region.start = drawings_bind::objNum(br, "start", 0.0);
        region.end   = drawings_bind::objNum(br, "end",   0.0);

        ProjectedView pv = projectShapeBroken(h, dir, region);
        auto out = drawings_bind::viewToObj(env, pv);
        return out;
    });
}

// ----------------------------------------------------------- drawings (PUSH-05)
//
// Stricter View2D / SectionView surface + DXF / SVG text emitters.
// These live alongside the legacy projectShape / projectSection bindings
// rather than replacing them — same HLR pipeline, different output
// shape (per-polyline gp_Pnt2d arrays + bbox vs. packed Float32 +
// starts).
//
// JS shape:
//   forge.drawings.projectView(handle, "front" | "top" | "right" | "iso")
//     → { visibleEdges: [[{x,y}, ...], ...],
//          hiddenEdges:  [[{x,y}, ...], ...],
//          bbox: { minX, minY, maxX, maxY } }
//
//   forge.drawings.sectionView(handle, { origin:[x,y,z], normal:[x,y,z] })
//     → { sectionEdges, behindEdges }
//
//   forge.drawings.emitDXF([viewObj, ...], [ [start, end], ... ])
//     → string  (AutoCAD R12 ASCII DXF)
//
//   forge.drawings.emitSVG(viewObj) → string

namespace drawings_v2_bind {

forge::drawings::ViewDirection parseViewDirection(Napi::Env env, const Napi::Value& v) {
    if (!v.IsString()) {
        throw Napi::TypeError::New(env,
            "forge.drawings.projectView: direction must be 'front'|'top'|'right'|'iso'");
    }
    const std::string name = v.As<Napi::String>();
    if (name == "front") return forge::drawings::ViewDirection::FRONT;
    if (name == "top")   return forge::drawings::ViewDirection::TOP;
    if (name == "right") return forge::drawings::ViewDirection::RIGHT;
    if (name == "iso" || name == "isometric") return forge::drawings::ViewDirection::ISO;
    throw Napi::TypeError::New(env,
        "forge.drawings.projectView: unknown direction '" + name + "'");
}

Napi::Array polylineToArray(Napi::Env env, const forge::drawings::Polyline& pl) {
    auto arr = Napi::Array::New(env, pl.size());
    for (std::size_t i = 0; i < pl.size(); ++i) {
        auto pt = Napi::Object::New(env);
        pt.Set("x", Napi::Number::New(env, pl[i].X()));
        pt.Set("y", Napi::Number::New(env, pl[i].Y()));
        arr.Set(static_cast<uint32_t>(i), pt);
    }
    return arr;
}

Napi::Array bucketToArray(Napi::Env env, const std::vector<forge::drawings::Polyline>& bucket) {
    auto arr = Napi::Array::New(env, bucket.size());
    for (std::size_t i = 0; i < bucket.size(); ++i) {
        arr.Set(static_cast<uint32_t>(i), polylineToArray(env, bucket[i]));
    }
    return arr;
}

Napi::Object view2DToObj(Napi::Env env, const forge::drawings::View2D& v) {
    auto out = Napi::Object::New(env);
    out.Set("visibleEdges", bucketToArray(env, v.visibleEdges));
    out.Set("hiddenEdges",  bucketToArray(env, v.hiddenEdges));
    auto bb = Napi::Object::New(env);
    bb.Set("minX", Napi::Number::New(env, v.minX));
    bb.Set("minY", Napi::Number::New(env, v.minY));
    bb.Set("maxX", Napi::Number::New(env, v.maxX));
    bb.Set("maxY", Napi::Number::New(env, v.maxY));
    out.Set("bbox", bb);
    return out;
}

// Reverse: read a JS view object (the same shape we emit above) back
// into a forge::drawings::View2D so emitDXF can ingest an array of
// pre-computed views without re-running HLR.
forge::drawings::View2D objToView2D(Napi::Env env, const Napi::Object& obj) {
    forge::drawings::View2D v;
    auto readBucket = [&](const char* key, std::vector<forge::drawings::Polyline>& dst) {
        if (!obj.Has(key)) return;
        auto val = obj.Get(key);
        if (!val.IsArray()) return;
        auto arr = val.As<Napi::Array>();
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            auto plv = arr.Get(i);
            if (!plv.IsArray()) continue;
            auto pla = plv.As<Napi::Array>();
            forge::drawings::Polyline pl;
            pl.reserve(pla.Length());
            for (uint32_t j = 0; j < pla.Length(); ++j) {
                auto ptv = pla.Get(j);
                if (!ptv.IsObject()) continue;
                auto pto = ptv.As<Napi::Object>();
                const double x = pto.Get("x").As<Napi::Number>().DoubleValue();
                const double y = pto.Get("y").As<Napi::Number>().DoubleValue();
                pl.emplace_back(x, y);
            }
            if (pl.size() >= 2) dst.push_back(std::move(pl));
        }
    };
    readBucket("visibleEdges", v.visibleEdges);
    readBucket("hiddenEdges",  v.hiddenEdges);
    if (obj.Has("bbox") && obj.Get("bbox").IsObject()) {
        auto bb = obj.Get("bbox").As<Napi::Object>();
        v.minX = bb.Get("minX").As<Napi::Number>().DoubleValue();
        v.minY = bb.Get("minY").As<Napi::Number>().DoubleValue();
        v.maxX = bb.Get("maxX").As<Napi::Number>().DoubleValue();
        v.maxY = bb.Get("maxY").As<Napi::Number>().DoubleValue();
    }
    return v;
}

} // namespace drawings_v2_bind

Napi::Value ProjectView2D(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        ShapeHandle h = requireHandle(info, 0);
        auto dir = drawings_v2_bind::parseViewDirection(env,
            info.Length() > 1 ? info[1] : env.Undefined());
        const TopoDS_Shape& shape = ShapeRegistry::instance().get(h);
        auto v = forge::drawings::projectView(shape, dir);
        return drawings_v2_bind::view2DToObj(env, v);
    });
}

Napi::Value SectionView2D(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        ShapeHandle h = requireHandle(info, 0);
        if (info.Length() < 2 || !info[1].IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.drawings.sectionView: expected plane object {origin:[x,y,z], normal:[x,y,z]}");
        }
        auto planeObj = info[1].As<Napi::Object>();
        auto readVec3 = [&](const char* k, double& a, double& b, double& c) {
            auto v = planeObj.Get(k);
            if (v.IsArray()) {
                auto arr = v.As<Napi::Array>();
                if (arr.Length() >= 3) {
                    a = arr.Get(uint32_t{0}).As<Napi::Number>().DoubleValue();
                    b = arr.Get(uint32_t{1}).As<Napi::Number>().DoubleValue();
                    c = arr.Get(uint32_t{2}).As<Napi::Number>().DoubleValue();
                    return;
                }
            }
            if (v.IsTypedArray()) {
                auto arr = v.As<Napi::Float64Array>();
                if (arr.ElementLength() >= 3) {
                    a = arr.Data()[0]; b = arr.Data()[1]; c = arr.Data()[2];
                    return;
                }
            }
            throw Napi::TypeError::New(env,
                std::string("forge.drawings.sectionView: plane.") + k + " must be a 3-element array");
        };
        double ox, oy, oz, nx, ny, nz;
        readVec3("origin", ox, oy, oz);
        readVec3("normal", nx, ny, nz);
        const double nlen = std::sqrt(nx * nx + ny * ny + nz * nz);
        if (nlen < 1e-12) {
            throw Napi::TypeError::New(env,
                "forge.drawings.sectionView: plane normal cannot be zero");
        }
        gp_Pln plane(gp_Pnt(ox, oy, oz),
                     gp_Dir(nx / nlen, ny / nlen, nz / nlen));
        const TopoDS_Shape& shape = ShapeRegistry::instance().get(h);
        auto s = forge::drawings::sectionView(shape, plane);

        auto out = Napi::Object::New(env);
        out.Set("sectionEdges", drawings_v2_bind::bucketToArray(env, s.sectionEdges));
        out.Set("behindEdges",  drawings_v2_bind::bucketToArray(env, s.behindEdges));
        return out;
    });
}

Napi::Value EmitDXF(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (info.Length() < 1 || !info[0].IsArray()) {
            throw Napi::TypeError::New(env,
                "forge.drawings.emitDXF: expected array of views as arg 0");
        }
        auto viewsArr = info[0].As<Napi::Array>();
        std::vector<forge::drawings::View2D> views;
        views.reserve(viewsArr.Length());
        for (uint32_t i = 0; i < viewsArr.Length(); ++i) {
            auto v = viewsArr.Get(i);
            if (!v.IsObject()) continue;
            views.push_back(drawings_v2_bind::objToView2D(env, v.As<Napi::Object>()));
        }

        std::vector<std::pair<gp_Pnt2d, gp_Pnt2d>> dims;
        if (info.Length() > 1 && info[1].IsArray()) {
            auto dimsArr = info[1].As<Napi::Array>();
            for (uint32_t i = 0; i < dimsArr.Length(); ++i) {
                auto d = dimsArr.Get(i);
                if (!d.IsArray()) continue;
                auto da = d.As<Napi::Array>();
                if (da.Length() < 2) continue;
                auto readPt = [&](Napi::Value v, gp_Pnt2d& out) {
                    if (v.IsArray()) {
                        auto a = v.As<Napi::Array>();
                        if (a.Length() >= 2) {
                            out.SetCoord(
                                a.Get(uint32_t{0}).As<Napi::Number>().DoubleValue(),
                                a.Get(uint32_t{1}).As<Napi::Number>().DoubleValue());
                            return true;
                        }
                    } else if (v.IsObject()) {
                        auto o = v.As<Napi::Object>();
                        if (o.Has("x") && o.Has("y")) {
                            out.SetCoord(
                                o.Get("x").As<Napi::Number>().DoubleValue(),
                                o.Get("y").As<Napi::Number>().DoubleValue());
                            return true;
                        }
                    }
                    return false;
                };
                gp_Pnt2d a, b;
                if (readPt(da.Get(uint32_t{0}), a) && readPt(da.Get(uint32_t{1}), b)) {
                    dims.emplace_back(a, b);
                }
            }
        }

        const std::string s = forge::drawings::emitDXF(views, dims);
        return Napi::String::New(env, s);
    });
}

Napi::Value EmitSVG(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (info.Length() < 1 || !info[0].IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.drawings.emitSVG: expected view object as arg 0");
        }
        auto v = drawings_v2_bind::objToView2D(env, info[0].As<Napi::Object>());
        const std::string s = forge::drawings::emitSVG(v);
        return Napi::String::New(env, s);
    });
}

// ----------------------------------------------------------- sketcher
Napi::Value SketcherCreate(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(forge::createSketch()));
    });
}
Napi::Value SketcherDestroy(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        forge::destroySketch(requireHandle(info, 0));
        return info.Env().Undefined();
    });
}
Napi::Value SketcherAddPoint(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(forge::addPoint(
                requireHandle(info, 0),
                requireNumber(info, 1, "x"),
                requireNumber(info, 2, "y"))));
    });
}
Napi::Value SketcherAddLine(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(forge::addLine(
                requireHandle(info, 0),
                requireHandle(info, 1),
                requireHandle(info, 2))));
    });
}
Napi::Value SketcherAddCircle(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(forge::addCircle(
                requireHandle(info, 0),
                requireHandle(info, 1),
                requireNumber(info, 2, "radius"))));
    });
}
Napi::Value SketcherAddArc(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(forge::addArc(
                requireHandle(info, 0),
                requireHandle(info, 1),
                requireHandle(info, 2),
                requireHandle(info, 3))));
    });
}
Napi::Value SketcherAddConstraint(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h    = requireHandle(info, 0);
        auto kind = static_cast<forge::SketchConstraintKind>(requireHandle(info, 1));
        if (info.Length() < 3 || !info[2].IsArray()) {
            throw Napi::TypeError::New(info.Env(),
                "forge: addConstraint expects refs array at arg 2");
        }
        auto arr = info[2].As<Napi::Array>();
        std::vector<std::uint32_t> refs;
        refs.reserve(arr.Length());
        for (std::uint32_t i = 0; i < arr.Length(); ++i) {
            auto v = arr.Get(i);
            if (!v.IsNumber()) {
                throw Napi::TypeError::New(info.Env(),
                    "forge: addConstraint refs must be numbers");
            }
            refs.push_back(v.As<Napi::Number>().Uint32Value());
        }
        double value = (info.Length() > 3 && info[3].IsNumber())
                       ? info[3].As<Napi::Number>().DoubleValue()
                       : 0.0;
        return Napi::Number::New(info.Env(),
            static_cast<double>(forge::addConstraint(h, kind, refs, value)));
    });
}
Napi::Value SketcherSolve(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto r = forge::solve(requireHandle(info, 0));
        auto env = info.Env();
        auto out = Napi::Object::New(env);
        out.Set("status", Napi::Number::New(env, static_cast<double>(r.status)));
        out.Set("dof",        Napi::Number::New(env, r.dof));
        out.Set("iterations", Napi::Number::New(env, r.iterations));
        return out;
    });
}
Napi::Value SketcherReadPoint(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h   = requireHandle(info, 0);
        auto pid = requireHandle(info, 1);
        auto p = forge::readPoint(h, pid);
        auto env = info.Env();
        auto out = Napi::Object::New(env);
        out.Set("x", p.x);
        out.Set("y", p.y);
        return out;
    });
}
Napi::Value SketcherWritePoint(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        forge::writePoint(
            requireHandle(info, 0),
            requireHandle(info, 1),
            requireNumber(info, 2, "x"),
            requireNumber(info, 3, "y"));
        return info.Env().Undefined();
    });
}
Napi::Value SketcherLiveCount(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            static_cast<double>(forge::SketchRegistry::instance().liveCount()));
    });
}

// ----------------------------------------------------------- FEA (Forge-12)
//
// JS surface — under `forge.fea`:
//   meshFromBrep(handle, targetElemSize)
//     → { nodes: Float64Array, tets: Uint32Array,
//         nodeToFace: Uint32Array, elemNodeCount: 8, nodeCount, elemCount }
//   solveStatic(meshObj, materialObj, loadsArr, pressureLoadsArr, bcsArr)
//     → { u: Float64Array, vonMises: Float64Array,
//         maxVonMises, maxAtElem, residual }
//   solveModal(meshObj, materialObj, bcsArr, nModes)
//     → { eigenvalues: Float64Array, eigenvectors: [Float64Array...], nModes }
//   solveDynamic(meshObj, materialObj, loadsArr, bcsArr,
//                tEnd, dt, rayleighAlpha, rayleighBeta,
//                opts?={ u0?:Float64Array, v0?:Float64Array,
//                        useConsistentMass?:bool })
//     → { displacements: [Float64Array...], velocities: [Float64Array...],
//         times: Float64Array, maxStressEnvelope: Float64Array,
//         maxDisp: Float64Array, kineticEnergy: Float64Array,
//         potentialEnergy: Float64Array, totalEnergy: Float64Array,
//         cpuMs, stepCount }
//     Newmark-β (β=¼, γ=½) average-acceleration, unconditionally stable
//     (Newmark 1959; Hughes, *The Finite Element Method* §9; Chopra,
//     *Dynamics of Structures* §5). opts.u0/v0 set the initial state;
//     opts.useConsistentMass uses the modal M (period matches modal f1).
//
// The mesh object can be the literal output of meshFromBrep — we read its
// `nodes`/`tets`/`nodeToFace`/`elemNodeCount` fields back into the C++
// `forge::fea::Mesh` struct. Materials, loads and BCs are plain JS objects.

namespace {

forge::fea::Mesh readMesh(const Napi::Env& env, const Napi::Value& v) {
    if (!v.IsObject()) {
        throw Napi::TypeError::New(env, "forge.fea: mesh must be an object");
    }
    auto obj = v.As<Napi::Object>();
    if (!obj.Has("nodes") || !obj.Get("nodes").IsTypedArray()) {
        throw Napi::TypeError::New(env, "forge.fea: mesh.nodes must be Float64Array");
    }
    if (!obj.Has("tets") || !obj.Get("tets").IsTypedArray()) {
        throw Napi::TypeError::New(env, "forge.fea: mesh.tets must be Uint32Array");
    }
    forge::fea::Mesh m;
    auto nodesArr = obj.Get("nodes").As<Napi::Float64Array>();
    m.nodes.assign(nodesArr.Data(), nodesArr.Data() + nodesArr.ElementLength());
    auto tetsArr = obj.Get("tets").As<Napi::Uint32Array>();
    m.tets.assign(tetsArr.Data(), tetsArr.Data() + tetsArr.ElementLength());
    if (obj.Has("nodeToFace") && obj.Get("nodeToFace").IsTypedArray()) {
        auto nf = obj.Get("nodeToFace").As<Napi::Uint32Array>();
        m.nodeToFace.assign(nf.Data(), nf.Data() + nf.ElementLength());
    }
    if (obj.Has("elemNodeCount") && obj.Get("elemNodeCount").IsNumber()) {
        m.elemNodeCount = obj.Get("elemNodeCount").As<Napi::Number>().Uint32Value();
    }
    return m;
}

forge::fea::Material readMaterial(const Napi::Env& env, const Napi::Value& v) {
    if (!v.IsObject()) {
        throw Napi::TypeError::New(env, "forge.fea: material must be an object");
    }
    auto obj = v.As<Napi::Object>();
    forge::fea::Material mat{};
    auto reqNum = [&](const char* k) {
        if (!obj.Has(k) || !obj.Get(k).IsNumber()) {
            throw Napi::TypeError::New(env,
                std::string("forge.fea: material.") + k + " required (number)");
        }
        return obj.Get(k).As<Napi::Number>().DoubleValue();
    };
    mat.E   = reqNum("E");
    mat.nu  = reqNum("nu");
    mat.rho = reqNum("rho");
    if (obj.Has("alpha") && obj.Get("alpha").IsNumber()) {   // Inc1c: optional CTE
        mat.alpha = obj.Get("alpha").As<Napi::Number>().DoubleValue();
    }
    return mat;
}

std::vector<forge::fea::LoadNodal>
readNodalLoads(const Napi::Env& env, const Napi::Value& v) {
    std::vector<forge::fea::LoadNodal> out;
    if (v.IsUndefined() || v.IsNull()) return out;
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.fea: loads must be an array");
    }
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (uint32_t i = 0; i < arr.Length(); ++i) {
        auto el = arr.Get(i);
        if (!el.IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.fea: each load entry must be {nodeId, fx, fy, fz}");
        }
        auto o = el.As<Napi::Object>();
        forge::fea::LoadNodal L{};
        L.nodeId = o.Has("nodeId") ? o.Get("nodeId").As<Napi::Number>().Uint32Value() : 0u;
        L.fx     = o.Has("fx") ? o.Get("fx").As<Napi::Number>().DoubleValue() : 0.0;
        L.fy     = o.Has("fy") ? o.Get("fy").As<Napi::Number>().DoubleValue() : 0.0;
        L.fz     = o.Has("fz") ? o.Get("fz").As<Napi::Number>().DoubleValue() : 0.0;
        out.push_back(L);
    }
    return out;
}

std::vector<forge::fea::LoadPressure>
readPressureLoads(const Napi::Env& env, const Napi::Value& v) {
    std::vector<forge::fea::LoadPressure> out;
    if (v.IsUndefined() || v.IsNull()) return out;
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.fea: pressureLoads must be an array");
    }
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (uint32_t i = 0; i < arr.Length(); ++i) {
        auto el = arr.Get(i);
        if (!el.IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.fea: each pressure entry must be {faceId, pressure}");
        }
        auto o = el.As<Napi::Object>();
        forge::fea::LoadPressure P{};
        P.faceId   = o.Has("faceId") ? o.Get("faceId").As<Napi::Number>().Uint32Value() : 0u;
        P.pressure = o.Has("pressure") ? o.Get("pressure").As<Napi::Number>().DoubleValue() : 0.0;
        out.push_back(P);
    }
    return out;
}

std::vector<forge::fea::BCPinned>
readBCs(const Napi::Env& env, const Napi::Value& v) {
    std::vector<forge::fea::BCPinned> out;
    if (v.IsUndefined() || v.IsNull()) return out;
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.fea: bcs must be an array");
    }
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (uint32_t i = 0; i < arr.Length(); ++i) {
        auto el = arr.Get(i);
        if (!el.IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.fea: each BC entry must be {nodeId, fx, fy, fz}");
        }
        auto o = el.As<Napi::Object>();
        forge::fea::BCPinned B{};
        B.nodeId = o.Has("nodeId") ? o.Get("nodeId").As<Napi::Number>().Uint32Value() : 0u;
        B.fx     = o.Has("fx") ? o.Get("fx").As<Napi::Boolean>().Value() : false;
        B.fy     = o.Has("fy") ? o.Get("fy").As<Napi::Boolean>().Value() : false;
        B.fz     = o.Has("fz") ? o.Get("fz").As<Napi::Boolean>().Value() : false;
        // Inc1c — optional non-zero prescribed displacement per DOF (default 0 = pin).
        B.ux     = o.Has("ux") ? o.Get("ux").As<Napi::Number>().DoubleValue() : 0.0;
        B.uy     = o.Has("uy") ? o.Get("uy").As<Napi::Number>().DoubleValue() : 0.0;
        B.uz     = o.Has("uz") ? o.Get("uz").As<Napi::Number>().DoubleValue() : 0.0;
        out.push_back(B);
    }
    return out;
}

Napi::Object meshToJs(const Napi::Env& env, const forge::fea::Mesh& m) {
    auto out = Napi::Object::New(env);
    auto nodes = Napi::Float64Array::New(env, m.nodes.size());
    std::copy(m.nodes.begin(), m.nodes.end(), nodes.Data());
    out.Set("nodes", nodes);
    auto tets = Napi::Uint32Array::New(env, m.tets.size());
    std::copy(m.tets.begin(), m.tets.end(), tets.Data());
    out.Set("tets", tets);
    auto nodeToFace = Napi::Uint32Array::New(env, m.nodeToFace.size());
    std::copy(m.nodeToFace.begin(), m.nodeToFace.end(), nodeToFace.Data());
    out.Set("nodeToFace", nodeToFace);
    out.Set("elemNodeCount", Napi::Number::New(env, m.elemNodeCount));
    out.Set("nodeCount", Napi::Number::New(env,
        static_cast<double>(m.nodes.size() / 3)));
    out.Set("elemCount", Napi::Number::New(env,
        static_cast<double>(m.tets.size() / m.elemNodeCount)));
    return out;
}

} // namespace

Napi::Value FeaMeshFromBrep(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        const double targetSize = requireNumber(info, 1, "targetElemSize");
        auto mesh = forge::fea::meshFromBRep(h, targetSize);
        return meshToJs(info.Env(), mesh);
    });
}

Napi::Value FeaSolveStatic(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto mesh     = readMesh(env, info[0]);
        auto material = readMaterial(env, info[1]);
        auto loads    = readNodalLoads(env, info.Length() > 2 ? info[2] : env.Undefined());
        auto pres     = readPressureLoads(env, info.Length() > 3 ? info[3] : env.Undefined());
        auto bcs      = readBCs(env, info.Length() > 4 ? info[4] : env.Undefined());
        // Inc1c — optional 6th arg: per-node ΔT (Float64Array, length nNodes) for
        // the thermoelastic initial-strain load. Absent ⇒ isothermal solve.
        std::vector<double> nodeDeltaT;
        if (info.Length() > 5 && info[5].IsTypedArray()) {
            auto ta = info[5].As<Napi::Float64Array>();
            nodeDeltaT.assign(ta.Data(), ta.Data() + ta.ElementLength());
        }

        auto r = forge::fea::solveStatic(mesh, material, loads, pres, bcs, nodeDeltaT);
        auto out = Napi::Object::New(env);
        auto u = Napi::Float64Array::New(env, r.u.size());
        std::copy(r.u.begin(), r.u.end(), u.Data());
        out.Set("u", u);
        auto vm = Napi::Float64Array::New(env, r.vonMises.size());
        std::copy(r.vonMises.begin(), r.vonMises.end(), vm.Data());
        out.Set("vonMises", vm);
        out.Set("maxVonMises", Napi::Number::New(env, r.maxVonMises));
        out.Set("maxAtElem",   Napi::Number::New(env, r.maxAtElem));
        out.Set("residual",    Napi::Number::New(env, r.residual));
        // Inc1b — full Cauchy stress tensor + principal, per-element AND
        // nodal-recovered, as named Float64Arrays (length nElems / nNodes).
        auto emit6 = [&](const char* nm, const std::vector<std::array<double,6>>& v, int c) {
            auto a = Napi::Float64Array::New(env, v.size());
            for (std::size_t i = 0; i < v.size(); ++i) a.Data()[i] = v[i][c];
            out.Set(nm, a);
        };
        auto emit3 = [&](const char* nm, const std::vector<std::array<double,3>>& v, int c) {
            auto a = Napi::Float64Array::New(env, v.size());
            for (std::size_t i = 0; i < v.size(); ++i) a.Data()[i] = v[i][c];
            out.Set(nm, a);
        };
        emit6("sxx", r.elemStress, 0); emit6("syy", r.elemStress, 1); emit6("szz", r.elemStress, 2);
        emit6("sxy", r.elemStress, 3); emit6("syz", r.elemStress, 4); emit6("szx", r.elemStress, 5);
        emit3("s1", r.elemPrincipal, 0); emit3("s2", r.elemPrincipal, 1); emit3("s3", r.elemPrincipal, 2);
        emit6("nodeSxx", r.nodalStress, 0); emit6("nodeSyy", r.nodalStress, 1); emit6("nodeSzz", r.nodalStress, 2);
        emit6("nodeSxy", r.nodalStress, 3); emit6("nodeSyz", r.nodalStress, 4); emit6("nodeSzx", r.nodalStress, 5);
        emit3("nodeS1", r.nodalPrincipal, 0); emit3("nodeS2", r.nodalPrincipal, 1); emit3("nodeS3", r.nodalPrincipal, 2);
        auto nvm = Napi::Float64Array::New(env, r.nodalVonMises.size());
        std::copy(r.nodalVonMises.begin(), r.nodalVonMises.end(), nvm.Data());
        out.Set("nodeVonMises", nvm);
        return out;
    });
}

Napi::Value FeaSolveModal(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto mesh     = readMesh(env, info[0]);
        auto material = readMaterial(env, info[1]);
        auto bcs      = readBCs(env, info.Length() > 2 ? info[2] : env.Undefined());
        const int nModes = info.Length() > 3 && info[3].IsNumber()
            ? info[3].As<Napi::Number>().Int32Value() : 3;

        auto r = forge::fea::solveModal(mesh, material, bcs, nModes);
        auto out = Napi::Object::New(env);
        auto vals = Napi::Float64Array::New(env, r.eigenvalues.size());
        std::copy(r.eigenvalues.begin(), r.eigenvalues.end(), vals.Data());
        out.Set("eigenvalues", vals);
        auto vecsArr = Napi::Array::New(env, r.eigenvectors.size());
        for (std::size_t i = 0; i < r.eigenvectors.size(); ++i) {
            auto& phi = r.eigenvectors[i];
            auto ta = Napi::Float64Array::New(env, phi.size());
            std::copy(phi.begin(), phi.end(), ta.Data());
            vecsArr.Set(static_cast<uint32_t>(i), ta);
        }
        out.Set("eigenvectors", vecsArr);
        out.Set("nModes", Napi::Number::New(env, r.nModes));
        return out;
    });
}

Napi::Value FeaSolveDynamic(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto mesh     = readMesh(env, info[0]);
        auto material = readMaterial(env, info[1]);
        auto loads    = readNodalLoads(env, info.Length() > 2 ? info[2] : env.Undefined());
        auto bcs      = readBCs(env, info.Length() > 3 ? info[3] : env.Undefined());
        const double tEnd  = requireNumber(info, 4, "tEnd");
        const double dt    = requireNumber(info, 5, "dt");
        const double alpha = info.Length() > 6 && info[6].IsNumber()
            ? info[6].As<Napi::Number>().DoubleValue() : 0.0;
        const double betaR = info.Length() > 7 && info[7].IsNumber()
            ? info[7].As<Napi::Number>().DoubleValue() : 0.0;

        // Optional 9th argument: { u0?, v0?, useConsistentMass? } for initial
        // conditions and the consistent-mass integration path. Omitting it
        // reproduces the historical zero-IC / lumped-mass behaviour exactly.
        forge::fea::DynamicOptions opts;
        if (info.Length() > 8 && info[8].IsObject()) {
            auto o = info[8].As<Napi::Object>();
            auto readVec = [&](const char* key, std::vector<double>& dst) {
                if (o.Has(key) && o.Get(key).IsTypedArray()) {
                    auto ta = o.Get(key).As<Napi::Float64Array>();
                    dst.assign(ta.Data(), ta.Data() + ta.ElementLength());
                } else if (o.Has(key) && o.Get(key).IsArray()) {
                    auto arr = o.Get(key).As<Napi::Array>();
                    dst.resize(arr.Length());
                    for (uint32_t i = 0; i < arr.Length(); ++i)
                        dst[i] = arr.Get(i).As<Napi::Number>().DoubleValue();
                }
            };
            readVec("u0", opts.u0);
            readVec("v0", opts.v0);
            if (o.Has("useConsistentMass"))
                opts.useConsistentMass =
                    o.Get("useConsistentMass").ToBoolean().Value();
        }

        auto r = forge::fea::solveDynamic(mesh, material, loads, bcs,
                                          tEnd, dt, alpha, betaR, opts);
        auto out = Napi::Object::New(env);
        auto times = Napi::Float64Array::New(env, r.times.size());
        std::copy(r.times.begin(), r.times.end(), times.Data());
        out.Set("times", times);

        auto disps = Napi::Array::New(env, r.displacements.size());
        for (std::size_t i = 0; i < r.displacements.size(); ++i) {
            auto& u = r.displacements[i];
            auto ta = Napi::Float64Array::New(env, u.size());
            std::copy(u.begin(), u.end(), ta.Data());
            disps.Set(static_cast<uint32_t>(i), ta);
        }
        out.Set("displacements", disps);

        auto vels = Napi::Array::New(env, r.velocities.size());
        for (std::size_t i = 0; i < r.velocities.size(); ++i) {
            auto& vv = r.velocities[i];
            auto ta = Napi::Float64Array::New(env, vv.size());
            std::copy(vv.begin(), vv.end(), ta.Data());
            vels.Set(static_cast<uint32_t>(i), ta);
        }
        out.Set("velocities", vels);

        auto env_ = Napi::Float64Array::New(env, r.maxStressEnvelope.size());
        std::copy(r.maxStressEnvelope.begin(), r.maxStressEnvelope.end(), env_.Data());
        out.Set("maxStressEnvelope", env_);

        auto copyArr = [&](const char* key, const std::vector<double>& src) {
            auto ta = Napi::Float64Array::New(env, src.size());
            std::copy(src.begin(), src.end(), ta.Data());
            out.Set(key, ta);
        };
        copyArr("maxDisp", r.maxDisp);
        copyArr("kineticEnergy", r.kineticEnergy);
        copyArr("potentialEnergy", r.potentialEnergy);
        copyArr("totalEnergy", r.totalEnergy);

        out.Set("cpuMs", Napi::Number::New(env, r.cpuMs));
        out.Set("stepCount", Napi::Number::New(env,
            static_cast<double>(r.displacements.size())));
        return out;
    });
}

// ----------------------------------------------------------- cam (Forge-13)
//
// All CAM operations take a Tool {} and CuttingParams {} as plain JS
// objects. The Tool fields map 1:1 onto forge::cam::Tool; type strings are
// translated to the enum at the boundary so JS callers can write
// `{ type: 'EndMill' }` rather than memorising integer codes.
namespace cam_bind {

forge::cam::Tool::Type parseToolType(Napi::Env env, const std::string& s) {
    if (s == "EndMill")  return forge::cam::Tool::EndMill;
    if (s == "BallNose") return forge::cam::Tool::BallNose;
    if (s == "Drill")    return forge::cam::Tool::Drill;
    if (s == "Chamfer")  return forge::cam::Tool::Chamfer;
    throw Napi::TypeError::New(env, "forge.cam: unknown tool type '" + s + "'");
}

forge::cam::Tool readTool(Napi::Env env, Napi::Value val) {
    if (!val.IsObject()) {
        throw Napi::TypeError::New(env, "forge.cam: tool must be an object");
    }
    Napi::Object obj = val.As<Napi::Object>();
    forge::cam::Tool t{};
    t.id          = obj.Has("id")          ? obj.Get("id").As<Napi::Number>().Uint32Value() : 0u;
    t.name        = obj.Has("name")        ? std::string(obj.Get("name").As<Napi::String>()) : std::string("tool");
    t.diameter    = obj.Has("diameter")    ? obj.Get("diameter").As<Napi::Number>().DoubleValue() : 0.0;
    t.fluteLength = obj.Has("fluteLength") ? obj.Get("fluteLength").As<Napi::Number>().DoubleValue() : 0.0;
    t.helix       = obj.Has("helix")       ? obj.Get("helix").As<Napi::Number>().DoubleValue() : 0.0;
    t.flutes      = obj.Has("flutes")      ? obj.Get("flutes").As<Napi::Number>().Int32Value()   : 2;
    if (obj.Has("type")) {
        Napi::Value tv = obj.Get("type");
        if (tv.IsString()) {
            t.type = parseToolType(env, std::string(tv.As<Napi::String>()));
        } else if (tv.IsNumber()) {
            t.type = static_cast<forge::cam::Tool::Type>(tv.As<Napi::Number>().Int32Value());
        } else {
            throw Napi::TypeError::New(env, "forge.cam: tool.type must be string or number");
        }
    } else {
        t.type = forge::cam::Tool::EndMill;
    }
    return t;
}

forge::cam::CuttingParams readParams(Napi::Env env, Napi::Value val) {
    if (!val.IsObject()) {
        throw Napi::TypeError::New(env, "forge.cam: params must be an object");
    }
    Napi::Object obj = val.As<Napi::Object>();
    forge::cam::CuttingParams p{};
    p.feedXY     = obj.Has("feedXY")     ? obj.Get("feedXY").As<Napi::Number>().DoubleValue()     : 600.0;
    p.feedZ      = obj.Has("feedZ")      ? obj.Get("feedZ").As<Napi::Number>().DoubleValue()      : 200.0;
    p.spindleRPM = obj.Has("spindleRPM") ? obj.Get("spindleRPM").As<Napi::Number>().DoubleValue() : 12000.0;
    p.stepover   = obj.Has("stepover")   ? obj.Get("stepover").As<Napi::Number>().DoubleValue()   : 1.0;
    p.stepdown   = obj.Has("stepdown")   ? obj.Get("stepdown").As<Napi::Number>().DoubleValue()   : 2.0;
    p.coolant    = obj.Has("coolant")    ? obj.Get("coolant").As<Napi::Number>().DoubleValue()    : 0.0;
    return p;
}

Napi::Value packToolpath(Napi::Env env, const forge::cam::Toolpath& tp) {
    auto out = Napi::Object::New(env);
    out.Set("toolId", Napi::Number::New(env, tp.toolId));

    // 5 floats per move: x, y, z, cutting (0/1), feedrate.
    auto moves = Napi::Float32Array::New(env, tp.moves.size() * 5);
    float* d = moves.Data();
    for (std::size_t i = 0; i < tp.moves.size(); ++i) {
        const auto& m = tp.moves[i];
        d[i * 5 + 0] = static_cast<float>(m.x);
        d[i * 5 + 1] = static_cast<float>(m.y);
        d[i * 5 + 2] = static_cast<float>(m.z);
        d[i * 5 + 3] = m.cutting ? 1.0f : 0.0f;
        d[i * 5 + 4] = static_cast<float>(m.feedrate);
    }
    out.Set("moves", moves);
    out.Set("moveCount",    Napi::Number::New(env, static_cast<double>(tp.moves.size())));
    out.Set("cycleTimeSec", Napi::Number::New(env, tp.cycleTimeSec));
    out.Set("estCuttingMm", Napi::Number::New(env, tp.estCuttingMm));
    return out;
}

std::uint32_t readFaceArg(const Napi::CallbackInfo& info, std::size_t idx) {
    if (info.Length() <= idx) return forge::cam::kAutoFaceId;
    Napi::Value v = info[idx];
    if (v.IsNull() || v.IsUndefined()) return forge::cam::kAutoFaceId;
    if (v.IsNumber()) return v.As<Napi::Number>().Uint32Value();
    throw Napi::TypeError::New(info.Env(), "forge.cam: faceId must be a number or null");
}

forge::cam::gcode::Dialect parseDialect(Napi::Env env, Napi::Value v) {
    if (v.IsNumber()) {
        return static_cast<forge::cam::gcode::Dialect>(v.As<Napi::Number>().Int32Value());
    }
    if (v.IsString()) {
        std::string s = v.As<Napi::String>();
        if (s == "Fanuc")    return forge::cam::gcode::Fanuc;
        if (s == "Haas")     return forge::cam::gcode::Haas;
        if (s == "LinuxCNC") return forge::cam::gcode::LinuxCNC;
        if (s == "Grbl")     return forge::cam::gcode::Grbl;
        throw Napi::TypeError::New(env, "forge.cam.gcode: unknown dialect '" + s + "'");
    }
    throw Napi::TypeError::New(env, "forge.cam.gcode: dialect must be string or number");
}

forge::cam::Toolpath readToolpathFromObject(Napi::Env env, Napi::Object obj) {
    forge::cam::Toolpath tp{};
    tp.toolId       = obj.Has("toolId") ? obj.Get("toolId").As<Napi::Number>().Uint32Value() : 0u;
    tp.cycleTimeSec = obj.Has("cycleTimeSec") ? obj.Get("cycleTimeSec").As<Napi::Number>().DoubleValue() : 0.0;
    tp.estCuttingMm = obj.Has("estCuttingMm") ? obj.Get("estCuttingMm").As<Napi::Number>().DoubleValue() : 0.0;
    if (!obj.Has("moves")) {
        throw Napi::TypeError::New(env, "forge.cam.gcode.toGcode: toolpath.moves missing");
    }
    auto arr = obj.Get("moves").As<Napi::Float32Array>();
    const std::size_t n = arr.ElementLength() / 5;
    tp.moves.reserve(n);
    const float* d = arr.Data();
    for (std::size_t i = 0; i < n; ++i) {
        forge::cam::Move m{};
        m.x        = d[i * 5 + 0];
        m.y        = d[i * 5 + 1];
        m.z        = d[i * 5 + 2];
        m.cutting  = d[i * 5 + 3] > 0.5f;
        m.feedrate = d[i * 5 + 4];
        tp.moves.push_back(m);
    }
    return tp;
}

} // namespace cam_bind

Napi::Value CamProfile(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto shape = requireHandle(info, 0);
        auto faceId = cam_bind::readFaceArg(info, 1);
        auto tool   = cam_bind::readTool(info.Env(), info[2]);
        auto params = cam_bind::readParams(info.Env(), info[3]);
        double zTop    = requireNumber(info, 4, "zTop");
        double zBottom = requireNumber(info, 5, "zBottom");
        double leadIn  = info.Length() > 6 && info[6].IsNumber()
                            ? info[6].As<Napi::Number>().DoubleValue() : 0.0;
        auto tp = forge::cam::profile(shape, faceId, tool, params, zTop, zBottom, leadIn);
        return cam_bind::packToolpath(info.Env(), tp);
    });
}

Napi::Value CamPocket(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto shape  = requireHandle(info, 0);
        auto faceId = cam_bind::readFaceArg(info, 1);
        auto tool   = cam_bind::readTool(info.Env(), info[2]);
        auto params = cam_bind::readParams(info.Env(), info[3]);
        double zTop    = requireNumber(info, 4, "zTop");
        double zBottom = requireNumber(info, 5, "zBottom");
        auto tp = forge::cam::pocket(shape, faceId, tool, params, zTop, zBottom);
        return cam_bind::packToolpath(info.Env(), tp);
    });
}

Napi::Value CamDrill(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto shape = requireHandle(info, 0);
        if (!info[1].IsArray()) {
            throw Napi::TypeError::New(info.Env(),
                "forge.cam.drill: expected holes array [[x,y,z], ...]");
        }
        auto arr = info[1].As<Napi::Array>();
        std::vector<std::array<double, 3>> holes;
        holes.reserve(arr.Length());
        for (std::uint32_t i = 0; i < arr.Length(); ++i) {
            auto el = arr.Get(i);
            if (!el.IsArray()) {
                throw Napi::TypeError::New(info.Env(),
                    "forge.cam.drill: hole element must be [x,y,z]");
            }
            auto a = el.As<Napi::Array>();
            std::array<double, 3> h{0.0, 0.0, 0.0};
            for (std::uint32_t j = 0; j < a.Length() && j < 3; ++j) {
                h[j] = a.Get(j).As<Napi::Number>().DoubleValue();
            }
            holes.push_back(h);
        }
        auto tool   = cam_bind::readTool(info.Env(), info[2]);
        auto params = cam_bind::readParams(info.Env(), info[3]);
        double zTop    = requireNumber(info, 4, "zTop");
        double zBottom = requireNumber(info, 5, "zBottom");
        bool   peck    = info.Length() > 6 && info[6].IsBoolean()
                            ? info[6].As<Napi::Boolean>().Value() : false;
        auto tp = forge::cam::drill(shape, holes, tool, params, zTop, zBottom, peck);
        return cam_bind::packToolpath(info.Env(), tp);
    });
}

Napi::Value CamFaceMill(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto shape  = requireHandle(info, 0);
        auto faceId = cam_bind::readFaceArg(info, 1);
        auto tool   = cam_bind::readTool(info.Env(), info[2]);
        auto params = cam_bind::readParams(info.Env(), info[3]);
        double zTop  = requireNumber(info, 4, "zTop");
        double depth = requireNumber(info, 5, "depth");
        auto tp = forge::cam::faceMill(shape, faceId, tool, params, zTop, depth);
        return cam_bind::packToolpath(info.Env(), tp);
    });
}

// ----------------------------------------------------------- cam advanced (Forge-33)
namespace camadv_bind {

forge::cam::StockAABB readStock(Napi::Env env, Napi::Value v) {
    if (!v.IsObject()) {
        throw Napi::TypeError::New(env, "forge.cam.adv: stock must be { aabb: Float64Array[6] } or Float64Array[6]");
    }
    forge::cam::StockAABB s{};
    if (v.IsTypedArray()) {
        auto a = v.As<Napi::Float64Array>();
        if (a.ElementLength() != 6) {
            throw Napi::TypeError::New(env, "forge.cam.adv: stock AABB must have 6 elements");
        }
        s.minX = a.Data()[0]; s.minY = a.Data()[1]; s.minZ = a.Data()[2];
        s.maxX = a.Data()[3]; s.maxY = a.Data()[4]; s.maxZ = a.Data()[5];
        return s;
    }
    auto obj = v.As<Napi::Object>();
    Napi::Value av = obj.Has("aabb") ? obj.Get("aabb") : obj.Get("bbox");
    if (!av.IsTypedArray()) {
        throw Napi::TypeError::New(env, "forge.cam.adv: stock.aabb must be Float64Array[6]");
    }
    auto a = av.As<Napi::Float64Array>();
    if (a.ElementLength() != 6) {
        throw Napi::TypeError::New(env, "forge.cam.adv: stock.aabb must have 6 elements");
    }
    s.minX = a.Data()[0]; s.minY = a.Data()[1]; s.minZ = a.Data()[2];
    s.maxX = a.Data()[3]; s.maxY = a.Data()[4]; s.maxZ = a.Data()[5];
    return s;
}

forge::cam::AdaptiveParams readAdaptive(Napi::Env env, Napi::Value v) {
    if (!v.IsObject()) {
        throw Napi::TypeError::New(env, "forge.cam.adv: adaptive params must be an object");
    }
    auto obj = v.As<Napi::Object>();
    forge::cam::AdaptiveParams ap{};
    ap.stepover   = obj.Has("stepover")   ? obj.Get("stepover").As<Napi::Number>().DoubleValue()   : 1.0;
    ap.zMax       = obj.Has("zMax")       ? obj.Get("zMax").As<Napi::Number>().DoubleValue()       : 0.0;
    ap.zMin       = obj.Has("zMin")       ? obj.Get("zMin").As<Napi::Number>().DoubleValue()       : 0.0;
    ap.helixAngle = obj.Has("helixAngle") ? obj.Get("helixAngle").As<Napi::Number>().DoubleValue() : 5.0;
    ap.minRadius  = obj.Has("minRadius")  ? obj.Get("minRadius").As<Napi::Number>().DoubleValue()  : 1.0;
    return ap;
}

} // namespace camadv_bind

Napi::Value CamAdaptiveClear(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto shape  = requireHandle(info, 0);
        auto stock  = camadv_bind::readStock(env, info[1]);
        auto tool   = cam_bind::readTool(env, info[2]);
        auto params = cam_bind::readParams(env, info[3]);
        auto adapt  = camadv_bind::readAdaptive(env, info[4]);
        auto tp = forge::cam::adaptiveClear3Axis(shape, stock, tool, params, adapt);
        return cam_bind::packToolpath(env, tp);
    });
}

Napi::Value CamMultiAxisIndexed(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto shape  = requireHandle(info, 0);
        auto tool   = cam_bind::readTool(env, info[1]);
        auto params = cam_bind::readParams(env, info[2]);
        if (!info[3].IsArray()) {
            throw Napi::TypeError::New(env, "forge.cam.multiAxisIndexed: orientations must be Array of [A,B,C]");
        }
        auto arr = info[3].As<Napi::Array>();
        std::vector<std::array<double, 3>> orient;
        orient.reserve(arr.Length());
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            auto el = arr.Get(i);
            if (!el.IsArray()) {
                throw Napi::TypeError::New(env, "forge.cam.multiAxisIndexed: orientation entry must be [A,B,C]");
            }
            auto a = el.As<Napi::Array>();
            std::array<double, 3> abc{0.0, 0.0, 0.0};
            for (uint32_t j = 0; j < a.Length() && j < 3; ++j) {
                abc[j] = a.Get(j).As<Napi::Number>().DoubleValue();
            }
            orient.push_back(abc);
        }
        double zTop = requireNumber(info, 4, "zTop");
        double zBottom = requireNumber(info, 5, "zBottom");
        std::vector<forge::cam::OrientedToolpath> per;
        auto tp = forge::cam::multiAxisIndexed(shape, tool, params, orient, zTop, zBottom, &per);
        auto out = cam_bind::packToolpath(env, tp).As<Napi::Object>();
        auto perArr = Napi::Array::New(env, per.size());
        for (uint32_t i = 0; i < per.size(); ++i) {
            auto o = Napi::Object::New(env);
            auto ab = Napi::Array::New(env, 3);
            ab.Set(uint32_t{0}, per[i].abc[0]);
            ab.Set(uint32_t{1}, per[i].abc[1]);
            ab.Set(uint32_t{2}, per[i].abc[2]);
            o.Set("abc", ab);
            o.Set("startMove", Napi::Number::New(env, static_cast<double>(per[i].startMove)));
            perArr.Set(i, o);
        }
        out.Set("perOrientation", perArr);
        return out;
    });
}

Napi::Value CamMultiAxisContinuous(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto shape  = requireHandle(info, 0);
        auto tool   = cam_bind::readTool(env, info[1]);
        auto params = cam_bind::readParams(env, info[2]);
        if (!info[3].IsArray()) {
            throw Napi::TypeError::New(env, "forge.cam.multiAxisContinuous: path must be Array of {x,y,z,nx,ny,nz}");
        }
        auto arr = info[3].As<Napi::Array>();
        std::vector<forge::cam::SurfaceStation> path;
        path.reserve(arr.Length());
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            auto el = arr.Get(i).As<Napi::Object>();
            forge::cam::SurfaceStation s{};
            s.x  = el.Has("x")  ? el.Get("x").As<Napi::Number>().DoubleValue()  : 0.0;
            s.y  = el.Has("y")  ? el.Get("y").As<Napi::Number>().DoubleValue()  : 0.0;
            s.z  = el.Has("z")  ? el.Get("z").As<Napi::Number>().DoubleValue()  : 0.0;
            s.nx = el.Has("nx") ? el.Get("nx").As<Napi::Number>().DoubleValue() : 0.0;
            s.ny = el.Has("ny") ? el.Get("ny").As<Napi::Number>().DoubleValue() : 0.0;
            s.nz = el.Has("nz") ? el.Get("nz").As<Napi::Number>().DoubleValue() : 1.0;
            path.push_back(s);
        }
        auto out = forge::cam::multiAxisContinuous(shape, tool, params, path);
        auto outObj = cam_bind::packToolpath(env, out.tp).As<Napi::Object>();
        auto orient = Napi::Float32Array::New(env, out.axisOrientations.size() * 3);
        for (std::size_t i = 0; i < out.axisOrientations.size(); ++i) {
            orient.Data()[i * 3 + 0] = static_cast<float>(out.axisOrientations[i][0]);
            orient.Data()[i * 3 + 1] = static_cast<float>(out.axisOrientations[i][1]);
            orient.Data()[i * 3 + 2] = static_cast<float>(out.axisOrientations[i][2]);
        }
        outObj.Set("axisOrientations", orient);
        return outObj;
    });
}

Napi::Value CamSimulateStock(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto stock = camadv_bind::readStock(env, info[0]);
        if (!info[1].IsObject()) {
            throw Napi::TypeError::New(env, "forge.cam.simulateStock: toolpath must be an object");
        }
        auto tp = cam_bind::readToolpathFromObject(env, info[1].As<Napi::Object>());
        auto tool = cam_bind::readTool(env, info[2]);
        std::uint32_t gridN = info.Length() > 3 && info[3].IsNumber()
            ? info[3].As<Napi::Number>().Uint32Value() : 50u;
        auto rep = forge::cam::simulateStock(stock, tp, tool, gridN);
        auto out = Napi::Object::New(env);
        out.Set("remainingVolume", Napi::Number::New(env, rep.remainingVolume));
        out.Set("initialVolume",   Napi::Number::New(env, rep.initialVolume));
        out.Set("maxCutDepth",     Napi::Number::New(env, rep.maxCutDepth));
        out.Set("collisionCount",  Napi::Number::New(env, rep.collisionCount));
        out.Set("gridResolution",  Napi::Number::New(env, rep.gridResolution));
        auto hist = Napi::Float64Array::New(env, rep.residueDistribution.size());
        std::copy(rep.residueDistribution.begin(), rep.residueDistribution.end(), hist.Data());
        out.Set("residueDistribution", hist);
        return out;
    });
}

Napi::Value CamGenerateCmm(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto shape = requireHandle(info, 0);
        if (!info[1].IsArray()) {
            throw Napi::TypeError::New(env, "forge.cam.generateCmm: features must be Array");
        }
        auto arr = info[1].As<Napi::Array>();
        std::vector<forge::cam::InspectionFeature> features;
        features.reserve(arr.Length());
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            auto el = arr.Get(i).As<Napi::Object>();
            forge::cam::InspectionFeature f{};
            std::string k = el.Has("kind") ? el.Get("kind").As<Napi::String>().Utf8Value() : "point";
            if      (k == "plane")    f.kind = forge::cam::InspectionFeatureKind::Plane;
            else if (k == "cylinder") f.kind = forge::cam::InspectionFeatureKind::Cylinder;
            else                      f.kind = forge::cam::InspectionFeatureKind::Point;
            f.topo  = el.Has("topo")  ? el.Get("topo").As<Napi::Number>().Uint32Value() : forge::cam::kAutoFaceId;
            f.label = el.Has("label") ? el.Get("label").As<Napi::String>().Utf8Value()  : ("F" + std::to_string(i));
            features.push_back(f);
        }
        if (!info[2].IsObject()) {
            throw Napi::TypeError::New(env, "forge.cam.generateCmm: gauge must be { stepover, probeRadius }");
        }
        auto gObj = info[2].As<Napi::Object>();
        forge::cam::CmmGauge g{};
        g.stepover    = gObj.Has("stepover")    ? gObj.Get("stepover").As<Napi::Number>().DoubleValue()    : 5.0;
        g.probeRadius = gObj.Has("probeRadius") ? gObj.Get("probeRadius").As<Napi::Number>().DoubleValue() : 1.0;
        auto prog = forge::cam::generateCmm(shape, features, g);
        auto out = Napi::Object::New(env);
        auto pts = Napi::Float64Array::New(env, prog.points.size() * 6);
        for (std::size_t i = 0; i < prog.points.size(); ++i) {
            const auto& p = prog.points[i];
            pts.Data()[i * 6 + 0] = p.x;  pts.Data()[i * 6 + 1] = p.y;  pts.Data()[i * 6 + 2] = p.z;
            pts.Data()[i * 6 + 3] = p.nx; pts.Data()[i * 6 + 4] = p.ny; pts.Data()[i * 6 + 5] = p.nz;
        }
        out.Set("points", pts);
        out.Set("pointCount", Napi::Number::New(env, static_cast<double>(prog.points.size())));
        auto per = Napi::Uint32Array::New(env, prog.pointsPerFeature.size());
        std::copy(prog.pointsPerFeature.begin(), prog.pointsPerFeature.end(), per.Data());
        out.Set("pointsPerFeature", per);
        out.Set("text", Napi::String::New(env, prog.text));
        return out;
    });
}

Napi::Value CamToGcode(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        if (info.Length() < 1 || !info[0].IsObject()) {
            throw Napi::TypeError::New(info.Env(),
                "forge.cam.gcode.toGcode: expected toolpath object");
        }
        auto env = info.Env();
        auto tp = cam_bind::readToolpathFromObject(env, info[0].As<Napi::Object>());
        auto dialect = cam_bind::parseDialect(env, info[1]);
        double safeZ = info.Length() > 2 && info[2].IsNumber()
                          ? info[2].As<Napi::Number>().DoubleValue() : 25.0;
        std::string gcode = forge::cam::gcode::toGcode(tp, dialect, safeZ);
        return Napi::String::New(env, gcode);
    });
}

// ----------------------------------------------------------- FEA extras (Forge-12b)
//
// JS surface — under `forge.fea`:
//   solveThermal(meshObj, materialObj, dirichletArr, sourcesArr, convectionArr)
//     → { T: Float64Array, elemFluxMag: Float64Array, maxT, minT, residual }
//   solveNonlinearStatic(meshObj, materialObj, loadsArr, bcsArr, cfgObj)
//     → { stepDisplacements: [Float64Array...], stepResiduals: Float64Array,
//         stepIterations: Uint32Array, converged: bool, cpuMs }
//   fatigueLife(stressHistory: Float64Array, nElem, nSteps, cfgObj)
//     → { cyclesToFailure: Float64Array, minLife, minLifeElem, maxAmplitude }

namespace {

std::vector<forge::fea::ThermalNodalT>
readDirichlet(const Napi::Env& env, const Napi::Value& v) {
    std::vector<forge::fea::ThermalNodalT> out;
    if (v.IsUndefined() || v.IsNull()) return out;
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.fea.solveThermal: dirichlet must be array");
    }
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (uint32_t i = 0; i < arr.Length(); ++i) {
        auto o = arr.Get(i).As<Napi::Object>();
        forge::fea::ThermalNodalT d{};
        d.nodeId = o.Get("nodeId").As<Napi::Number>().Uint32Value();
        d.T      = o.Get("T").As<Napi::Number>().DoubleValue();
        out.push_back(d);
    }
    return out;
}

std::vector<forge::fea::ThermalElemSource>
readSources(const Napi::Env& env, const Napi::Value& v) {
    std::vector<forge::fea::ThermalElemSource> out;
    if (v.IsUndefined() || v.IsNull()) return out;
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.fea.solveThermal: sources must be array");
    }
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (uint32_t i = 0; i < arr.Length(); ++i) {
        auto o = arr.Get(i).As<Napi::Object>();
        forge::fea::ThermalElemSource s{};
        s.elemId = o.Get("elemId").As<Napi::Number>().Uint32Value();
        s.q      = o.Get("q").As<Napi::Number>().DoubleValue();
        out.push_back(s);
    }
    return out;
}

std::vector<forge::fea::ThermalConvection>
readConvection(const Napi::Env& env, const Napi::Value& v) {
    std::vector<forge::fea::ThermalConvection> out;
    if (v.IsUndefined() || v.IsNull()) return out;
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.fea.solveThermal: convection must be array");
    }
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (uint32_t i = 0; i < arr.Length(); ++i) {
        auto o = arr.Get(i).As<Napi::Object>();
        forge::fea::ThermalConvection c{};
        c.faceId = o.Get("faceId").As<Napi::Number>().Uint32Value();
        c.h      = o.Get("h").As<Napi::Number>().DoubleValue();
        c.Tinf   = o.Get("Tinf").As<Napi::Number>().DoubleValue();
        out.push_back(c);
    }
    return out;
}

} // namespace

Napi::Value FeaSolveThermal(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto mesh = readMesh(env, info[0]);
        if (!info[1].IsObject()) {
            throw Napi::TypeError::New(env, "forge.fea.solveThermal: material must be {k}");
        }
        auto matObj = info[1].As<Napi::Object>();
        forge::fea::ThermalMaterial mat{};
        if (!matObj.Has("k")) {
            throw Napi::TypeError::New(env, "forge.fea.solveThermal: material.k required");
        }
        mat.k = matObj.Get("k").As<Napi::Number>().DoubleValue();
        auto dirichlet  = readDirichlet (env, info.Length() > 2 ? info[2] : env.Undefined());
        auto sources    = readSources   (env, info.Length() > 3 ? info[3] : env.Undefined());
        auto convection = readConvection(env, info.Length() > 4 ? info[4] : env.Undefined());
        auto r = forge::fea::solveThermal(mesh, mat, dirichlet, sources, convection);
        auto out = Napi::Object::New(env);
        auto T = Napi::Float64Array::New(env, r.T.size());
        std::copy(r.T.begin(), r.T.end(), T.Data());
        out.Set("T", T);
        auto fm = Napi::Float64Array::New(env, r.elemFluxMag.size());
        std::copy(r.elemFluxMag.begin(), r.elemFluxMag.end(), fm.Data());
        out.Set("elemFluxMag", fm);
        out.Set("maxT", Napi::Number::New(env, r.maxT));
        out.Set("minT", Napi::Number::New(env, r.minT));
        out.Set("residual", Napi::Number::New(env, r.residual));
        return out;
    });
}

// solveTransientThermal(meshObj, materialObj, cfgObj, dirichletArr, sourcesArr,
//                        convectionArr, initialT?: Float64Array)
//   cfgObj = { rhoC, dt, nSteps, T0?, snapshotEvery? }
//   → { T: Float64Array, snapshots: [Float64Array...], snapshotTimes: Float64Array,
//       maxT, minT, steps }
Napi::Value FeaSolveTransientThermal(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto mesh = readMesh(env, info[0]);
        if (!info[1].IsObject()) {
            throw Napi::TypeError::New(env, "forge.fea.solveTransientThermal: material must be {k}");
        }
        auto matObj = info[1].As<Napi::Object>();
        forge::fea::ThermalMaterial mat{};
        if (!matObj.Has("k")) {
            throw Napi::TypeError::New(env, "forge.fea.solveTransientThermal: material.k required");
        }
        mat.k = matObj.Get("k").As<Napi::Number>().DoubleValue();
        if (!info[2].IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.fea.solveTransientThermal: config must be {rhoC, dt, nSteps}");
        }
        auto cfgObj = info[2].As<Napi::Object>();
        forge::fea::TransientThermalConfig cfg{};
        if (!cfgObj.Has("rhoC") || !cfgObj.Has("dt") || !cfgObj.Has("nSteps")) {
            throw Napi::TypeError::New(env,
                "forge.fea.solveTransientThermal: config.rhoC, config.dt, config.nSteps required");
        }
        cfg.rhoC   = cfgObj.Get("rhoC").As<Napi::Number>().DoubleValue();
        cfg.dt     = cfgObj.Get("dt").As<Napi::Number>().DoubleValue();
        cfg.nSteps = cfgObj.Get("nSteps").As<Napi::Number>().Int32Value();
        if (cfgObj.Has("T0"))            cfg.T0            = cfgObj.Get("T0").As<Napi::Number>().DoubleValue();
        if (cfgObj.Has("snapshotEvery")) cfg.snapshotEvery = cfgObj.Get("snapshotEvery").As<Napi::Number>().Int32Value();
        auto dirichlet  = readDirichlet (env, info.Length() > 3 ? info[3] : env.Undefined());
        auto sources    = readSources   (env, info.Length() > 4 ? info[4] : env.Undefined());
        auto convection = readConvection(env, info.Length() > 5 ? info[5] : env.Undefined());
        std::vector<double> initialT;
        if (info.Length() > 6 && info[6].IsTypedArray()) {
            auto ta = info[6].As<Napi::Float64Array>();
            initialT.assign(ta.Data(), ta.Data() + ta.ElementLength());
        }
        auto r = forge::fea::solveTransientThermal(mesh, mat, cfg, dirichlet, sources,
                                                   convection, initialT);
        auto out = Napi::Object::New(env);
        auto T = Napi::Float64Array::New(env, r.T.size());
        std::copy(r.T.begin(), r.T.end(), T.Data());
        out.Set("T", T);
        auto snaps = Napi::Array::New(env, r.snapshots.size());
        for (std::size_t i = 0; i < r.snapshots.size(); ++i) {
            auto ta = Napi::Float64Array::New(env, r.snapshots[i].size());
            std::copy(r.snapshots[i].begin(), r.snapshots[i].end(), ta.Data());
            snaps.Set(static_cast<uint32_t>(i), ta);
        }
        out.Set("snapshots", snaps);
        auto stimes = Napi::Float64Array::New(env, r.snapshotTimes.size());
        std::copy(r.snapshotTimes.begin(), r.snapshotTimes.end(), stimes.Data());
        out.Set("snapshotTimes", stimes);
        out.Set("maxT", Napi::Number::New(env, r.maxT));
        out.Set("minT", Napi::Number::New(env, r.minT));
        out.Set("steps", Napi::Number::New(env, r.steps));
        return out;
    });
}

Napi::Value FeaSolveNonlinearStatic(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto mesh     = readMesh(env, info[0]);
        auto material = readMaterial(env, info[1]);
        auto loads    = readNodalLoads(env, info.Length() > 2 ? info[2] : env.Undefined());
        auto bcs      = readBCs(env, info.Length() > 3 ? info[3] : env.Undefined());
        forge::fea::NonlinearConfig cfg;
        if (info.Length() > 4 && info[4].IsObject()) {
            auto co = info[4].As<Napi::Object>();
            if (co.Has("loadSteps"))   cfg.loadSteps   = co.Get("loadSteps").As<Napi::Number>().Int32Value();
            if (co.Has("maxNewton"))   cfg.maxNewton   = co.Get("maxNewton").As<Napi::Number>().Int32Value();
            if (co.Has("residualTol")) cfg.residualTol = co.Get("residualTol").As<Napi::Number>().DoubleValue();
        }
        auto r = forge::fea::solveNonlinearStatic(mesh, material, loads, bcs, cfg);
        auto out = Napi::Object::New(env);
        auto disps = Napi::Array::New(env, r.stepDisplacements.size());
        for (std::size_t i = 0; i < r.stepDisplacements.size(); ++i) {
            auto& u = r.stepDisplacements[i];
            auto ta = Napi::Float64Array::New(env, u.size());
            std::copy(u.begin(), u.end(), ta.Data());
            disps.Set(static_cast<uint32_t>(i), ta);
        }
        out.Set("stepDisplacements", disps);
        auto res = Napi::Float64Array::New(env, r.stepResiduals.size());
        std::copy(r.stepResiduals.begin(), r.stepResiduals.end(), res.Data());
        out.Set("stepResiduals", res);
        auto its = Napi::Uint32Array::New(env, r.stepIterations.size());
        for (std::size_t i = 0; i < r.stepIterations.size(); ++i) its.Data()[i] = r.stepIterations[i];
        out.Set("stepIterations", its);
        out.Set("converged", Napi::Boolean::New(env, r.converged));
        out.Set("cpuMs", Napi::Number::New(env, r.cpuMs));
        return out;
    });
}

Napi::Value FeaFatigueLife(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (!info[0].IsTypedArray()) {
            throw Napi::TypeError::New(env,
                "forge.fea.fatigueLife: stressHistory must be Float64Array");
        }
        auto sh = info[0].As<Napi::Float64Array>();
        std::vector<double> hist(sh.Data(), sh.Data() + sh.ElementLength());
        const auto nElem  = info[1].As<Napi::Number>().Uint32Value();
        const auto nSteps = info[2].As<Napi::Number>().Uint32Value();
        forge::fea::FatigueConfig cfg;
        if (!info[3].IsObject()) {
            throw Napi::TypeError::New(env, "forge.fea.fatigueLife: cfg must be an object");
        }
        auto co = info[3].As<Napi::Object>();
        if (!co.Has("sn") || !co.Get("sn").IsObject()) {
            throw Napi::TypeError::New(env, "forge.fea.fatigueLife: cfg.sn = { N, S }");
        }
        auto sn = co.Get("sn").As<Napi::Object>();
        auto Narr = sn.Get("N").As<Napi::Array>();
        auto Sarr = sn.Get("S").As<Napi::Array>();
        cfg.sn.N.resize(Narr.Length());
        cfg.sn.S.resize(Sarr.Length());
        for (uint32_t i = 0; i < Narr.Length(); ++i) cfg.sn.N[i] = Narr.Get(i).As<Napi::Number>().DoubleValue();
        for (uint32_t i = 0; i < Sarr.Length(); ++i) cfg.sn.S[i] = Sarr.Get(i).As<Napi::Number>().DoubleValue();
        if (co.Has("meanCorrection")) cfg.meanCorrection = co.Get("meanCorrection").As<Napi::Number>().Int32Value();
        if (co.Has("ultimateStress")) cfg.ultimateStress = co.Get("ultimateStress").As<Napi::Number>().DoubleValue();
        if (co.Has("yieldStress"))    cfg.yieldStress    = co.Get("yieldStress").As<Napi::Number>().DoubleValue();
        if (co.Has("cyclesPerSample"))cfg.cyclesPerSample= co.Get("cyclesPerSample").As<Napi::Number>().DoubleValue();
        auto r = forge::fea::fatigueLife(hist, nElem, nSteps, cfg);
        auto out = Napi::Object::New(env);
        auto cs = Napi::Float64Array::New(env, r.cyclesToFailure.size());
        std::copy(r.cyclesToFailure.begin(), r.cyclesToFailure.end(), cs.Data());
        out.Set("cyclesToFailure", cs);
        out.Set("minLife", Napi::Number::New(env, r.minLife));
        out.Set("minLifeElem", Napi::Number::New(env, r.minLifeElem));
        out.Set("maxAmplitude", Napi::Number::New(env, r.maxAmplitude));
        return out;
    });
}

// ----------------------------------------------------------- FEA Forge-31 — buckling/contact/plasticity
//
// JS surface — under `forge.fea`:
//   solveBuckling(meshObj, materialObj, staticLoadsArr, bcsArr, nModes)
//     → { loadFactors: Float64Array, modes: [Float64Array...],
//         firstCriticalLoad, nModes, cpuMs }
//   solveContact(meshA, meshB, materialObj, loadsA, loadsB, bcsA, bcsB,
//                contactPairsArr, normalPenalty)
//     → { uA: Float64Array, uB: Float64Array,
//         contactPressure: Float64Array, iterations, penaltyUsed,
//         converged, cpuMs }
//   solveNonlinearPlastic(meshObj, plasticMatObj, loadsArr, bcsArr, loadSteps)
//     → { stepDisplacements: [Float64Array...], stepPlasticStrain: [...],
//         stepStress: [...], stepIterations: Uint32Array,
//         stepResiduals: Float64Array, converged, cpuMs }

namespace {

std::vector<forge::fea::ContactPair>
readContactPairs(const Napi::Env& env, const Napi::Value& v) {
    std::vector<forge::fea::ContactPair> out;
    if (v.IsUndefined() || v.IsNull()) return out;
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env,
            "forge.fea.solveContact: contactPairs must be array");
    }
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (uint32_t i = 0; i < arr.Length(); ++i) {
        auto o = arr.Get(i).As<Napi::Object>();
        forge::fea::ContactPair p{};
        p.nodeA = o.Has("nodeA") ? o.Get("nodeA").As<Napi::Number>().Uint32Value() : 0u;
        p.faceB = o.Has("faceB") ? o.Get("faceB").As<Napi::Number>().Uint32Value() : 0u;
        out.push_back(p);
    }
    return out;
}

} // namespace

Napi::Value FeaSolveBuckling(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto mesh     = readMesh(env, info[0]);
        auto material = readMaterial(env, info[1]);
        auto loads    = readNodalLoads(env, info.Length() > 2 ? info[2] : env.Undefined());
        auto bcs      = readBCs(env, info.Length() > 3 ? info[3] : env.Undefined());
        const int nModes = info.Length() > 4 && info[4].IsNumber()
            ? info[4].As<Napi::Number>().Int32Value() : 3;
        auto r = forge::fea::solveBuckling(mesh, material, loads, bcs, nModes);
        auto out = Napi::Object::New(env);
        auto lf = Napi::Float64Array::New(env, r.loadFactors.size());
        std::copy(r.loadFactors.begin(), r.loadFactors.end(), lf.Data());
        out.Set("loadFactors", lf);
        auto modes = Napi::Array::New(env, r.modes.size());
        for (std::size_t i = 0; i < r.modes.size(); ++i) {
            auto& phi = r.modes[i];
            auto ta = Napi::Float64Array::New(env, phi.size());
            std::copy(phi.begin(), phi.end(), ta.Data());
            modes.Set(static_cast<uint32_t>(i), ta);
        }
        out.Set("modes", modes);
        out.Set("firstCriticalLoad", Napi::Number::New(env, r.firstCriticalLoad));
        out.Set("nModes", Napi::Number::New(env, r.nModes));
        out.Set("cpuMs",  Napi::Number::New(env, r.cpuMs));
        return out;
    });
}

Napi::Value FeaSolveContact(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto meshA    = readMesh(env, info[0]);
        auto meshB    = readMesh(env, info[1]);
        auto material = readMaterial(env, info[2]);
        auto loadsA   = readNodalLoads(env, info.Length() > 3 ? info[3] : env.Undefined());
        auto loadsB   = readNodalLoads(env, info.Length() > 4 ? info[4] : env.Undefined());
        auto bcsA     = readBCs(env, info.Length() > 5 ? info[5] : env.Undefined());
        auto bcsB     = readBCs(env, info.Length() > 6 ? info[6] : env.Undefined());
        auto pairs    = readContactPairs(env, info.Length() > 7 ? info[7] : env.Undefined());
        const double penalty = info.Length() > 8 && info[8].IsNumber()
            ? info[8].As<Napi::Number>().DoubleValue() : 0.0;
        auto r = forge::fea::solveContact(meshA, meshB, material,
                                          loadsA, loadsB, bcsA, bcsB,
                                          pairs, penalty);
        auto out = Napi::Object::New(env);
        auto uA = Napi::Float64Array::New(env, r.uA.size());
        std::copy(r.uA.begin(), r.uA.end(), uA.Data()); out.Set("uA", uA);
        auto uB = Napi::Float64Array::New(env, r.uB.size());
        std::copy(r.uB.begin(), r.uB.end(), uB.Data()); out.Set("uB", uB);
        auto cp = Napi::Float64Array::New(env, r.contactPressure.size());
        std::copy(r.contactPressure.begin(), r.contactPressure.end(), cp.Data());
        out.Set("contactPressure", cp);
        out.Set("iterations",  Napi::Number::New(env, r.iterations));
        out.Set("penaltyUsed", Napi::Number::New(env, r.penaltyUsed));
        out.Set("converged",   Napi::Boolean::New(env, r.converged));
        out.Set("cpuMs",       Napi::Number::New(env, r.cpuMs));
        return out;
    });
}

Napi::Value FeaSolveNonlinearPlastic(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto mesh  = readMesh(env, info[0]);
        if (!info[1].IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.fea.solveNonlinearPlastic: material must be {E, nu, rho, sigmaY, hardening}");
        }
        auto matObj = info[1].As<Napi::Object>();
        forge::fea::PlasticMaterial mat{};
        auto reqNum = [&](const char* k) {
            if (!matObj.Has(k) || !matObj.Get(k).IsNumber()) {
                throw Napi::TypeError::New(env,
                    std::string("forge.fea.solveNonlinearPlastic: material.") + k + " required (number)");
            }
            return matObj.Get(k).As<Napi::Number>().DoubleValue();
        };
        mat.E         = reqNum("E");
        mat.nu        = reqNum("nu");
        mat.rho       = reqNum("rho");
        mat.sigmaY    = reqNum("sigmaY");
        mat.hardening = matObj.Has("hardening") && matObj.Get("hardening").IsNumber()
            ? matObj.Get("hardening").As<Napi::Number>().DoubleValue() : 0.0;
        auto loads = readNodalLoads(env, info.Length() > 2 ? info[2] : env.Undefined());
        auto bcs   = readBCs(env, info.Length() > 3 ? info[3] : env.Undefined());
        const int loadSteps = info.Length() > 4 && info[4].IsNumber()
            ? info[4].As<Napi::Number>().Int32Value() : 5;
        auto r = forge::fea::solveNonlinearPlastic(mesh, mat, loads, bcs, loadSteps);
        auto out = Napi::Object::New(env);
        auto disps = Napi::Array::New(env, r.stepDisplacements.size());
        for (std::size_t i = 0; i < r.stepDisplacements.size(); ++i) {
            auto& u = r.stepDisplacements[i];
            auto ta = Napi::Float64Array::New(env, u.size());
            std::copy(u.begin(), u.end(), ta.Data());
            disps.Set(static_cast<uint32_t>(i), ta);
        }
        out.Set("stepDisplacements", disps);
        auto epArr = Napi::Array::New(env, r.stepPlasticStrain.size());
        for (std::size_t i = 0; i < r.stepPlasticStrain.size(); ++i) {
            auto& ep = r.stepPlasticStrain[i];
            auto ta = Napi::Float64Array::New(env, ep.size());
            std::copy(ep.begin(), ep.end(), ta.Data());
            epArr.Set(static_cast<uint32_t>(i), ta);
        }
        out.Set("stepPlasticStrain", epArr);
        auto sigArr = Napi::Array::New(env, r.stepStress.size());
        for (std::size_t i = 0; i < r.stepStress.size(); ++i) {
            auto& s = r.stepStress[i];
            auto ta = Napi::Float64Array::New(env, s.size());
            std::copy(s.begin(), s.end(), ta.Data());
            sigArr.Set(static_cast<uint32_t>(i), ta);
        }
        out.Set("stepStress", sigArr);
        auto its = Napi::Uint32Array::New(env, r.stepIterations.size());
        for (std::size_t i = 0; i < r.stepIterations.size(); ++i) its.Data()[i] = r.stepIterations[i];
        out.Set("stepIterations", its);
        auto resv = Napi::Float64Array::New(env, r.stepResiduals.size());
        std::copy(r.stepResiduals.begin(), r.stepResiduals.end(), resv.Data());
        out.Set("stepResiduals", resv);
        out.Set("converged", Napi::Boolean::New(env, r.converged));
        out.Set("cpuMs",     Napi::Number::New(env, r.cpuMs));
        return out;
    });
}

// ----------------------------------------------------------- FEA / Tet (PUSH-11)
//
// JS surface — under `forge.fea.tet`:
//   meshShape(handle, targetEdge)
//     → { nodes: Float64Array (flat xyz, length 3N),
//         ids:   Int32Array (length N),
//         tets:  Int32Array (flat a,b,c,d × E),
//         tetIds: Int32Array (length E),
//         nodeCount, tetCount, shellTetsOnly }
//   solveLinearStatic(meshObj, materialObj, bcObj)
//     → { displacement: Float64Array (3N),
//         vonMises:     Float64Array (E),
//         maxDisp, maxVonMises, converged, cgIterations, cgResidual }
//   solveModal(meshObj, materialObj, fixedNodesArr, nModes)
//     → { eigenfrequencies: Float64Array (M),
//         modeShapes: [Float64Array(3N)...], converged }
namespace {

Napi::Object feaTetMeshToJs(Napi::Env env, const forge::fea::tet::Mesh& m) {
    auto out = Napi::Object::New(env);
    auto nodes = Napi::Float64Array::New(env, m.nodes.size() * 3);
    auto ids   = Napi::Int32Array::New(env, m.nodes.size());
    for (std::size_t i = 0; i < m.nodes.size(); ++i) {
        nodes.Data()[3*i+0] = m.nodes[i].x;
        nodes.Data()[3*i+1] = m.nodes[i].y;
        nodes.Data()[3*i+2] = m.nodes[i].z;
        ids.Data()[i] = m.nodes[i].id;
    }
    out.Set("nodes", nodes);
    out.Set("ids", ids);
    auto tets   = Napi::Int32Array::New(env, m.tets.size() * 4);
    auto tetIds = Napi::Int32Array::New(env, m.tets.size());
    for (std::size_t i = 0; i < m.tets.size(); ++i) {
        tets.Data()[4*i+0] = m.tets[i].a;
        tets.Data()[4*i+1] = m.tets[i].b;
        tets.Data()[4*i+2] = m.tets[i].c;
        tets.Data()[4*i+3] = m.tets[i].d;
        tetIds.Data()[i]   = m.tets[i].id;
    }
    out.Set("tets", tets);
    out.Set("tetIds", tetIds);
    out.Set("nodeCount", Napi::Number::New(env, static_cast<double>(m.nodes.size())));
    out.Set("tetCount",  Napi::Number::New(env, static_cast<double>(m.tets.size())));
    out.Set("shellTetsOnly", Napi::Boolean::New(env, m.shellTetsOnly));
    return out;
}

forge::fea::tet::Mesh feaTetReadMesh(Napi::Env env, const Napi::Value& v) {
    if (!v.IsObject()) {
        throw Napi::TypeError::New(env, "forge.fea.tet: mesh must be an object");
    }
    auto obj = v.As<Napi::Object>();
    if (!obj.Has("nodes") || !obj.Get("nodes").IsTypedArray()) {
        throw Napi::TypeError::New(env, "forge.fea.tet: mesh.nodes must be Float64Array");
    }
    if (!obj.Has("tets") || !obj.Get("tets").IsTypedArray()) {
        throw Napi::TypeError::New(env, "forge.fea.tet: mesh.tets must be Int32Array");
    }
    forge::fea::tet::Mesh m;
    auto nArr = obj.Get("nodes").As<Napi::Float64Array>();
    std::size_t nN = nArr.ElementLength() / 3;
    m.nodes.resize(nN);
    Napi::Int32Array ids;
    bool haveIds = obj.Has("ids") && obj.Get("ids").IsTypedArray();
    if (haveIds) ids = obj.Get("ids").As<Napi::Int32Array>();
    for (std::size_t i = 0; i < nN; ++i) {
        m.nodes[i].x  = nArr.Data()[3*i+0];
        m.nodes[i].y  = nArr.Data()[3*i+1];
        m.nodes[i].z  = nArr.Data()[3*i+2];
        m.nodes[i].id = haveIds && i < ids.ElementLength()
            ? static_cast<int>(ids.Data()[i]) : static_cast<int>(i);
    }
    auto tArr = obj.Get("tets").As<Napi::Int32Array>();
    std::size_t nT = tArr.ElementLength() / 4;
    m.tets.resize(nT);
    Napi::Int32Array tIds;
    bool haveTIds = obj.Has("tetIds") && obj.Get("tetIds").IsTypedArray();
    if (haveTIds) tIds = obj.Get("tetIds").As<Napi::Int32Array>();
    for (std::size_t i = 0; i < nT; ++i) {
        m.tets[i].a  = tArr.Data()[4*i+0];
        m.tets[i].b  = tArr.Data()[4*i+1];
        m.tets[i].c  = tArr.Data()[4*i+2];
        m.tets[i].d  = tArr.Data()[4*i+3];
        m.tets[i].id = haveTIds && i < tIds.ElementLength()
            ? static_cast<int>(tIds.Data()[i]) : static_cast<int>(i);
    }
    if (obj.Has("shellTetsOnly") && obj.Get("shellTetsOnly").IsBoolean()) {
        m.shellTetsOnly = obj.Get("shellTetsOnly").As<Napi::Boolean>().Value();
    }
    return m;
}

forge::fea::tet::Material feaTetReadMaterial(Napi::Env env, const Napi::Value& v) {
    if (!v.IsObject()) {
        throw Napi::TypeError::New(env, "forge.fea.tet: material must be an object");
    }
    auto obj = v.As<Napi::Object>();
    auto req = [&](const char* k) {
        if (!obj.Has(k) || !obj.Get(k).IsNumber()) {
            throw Napi::TypeError::New(env,
                std::string("forge.fea.tet: material.") + k + " required (number)");
        }
        return obj.Get(k).As<Napi::Number>().DoubleValue();
    };
    forge::fea::tet::Material m{req("E"), req("nu"), req("rho")};
    if (obj.Has("alpha") && obj.Get("alpha").IsNumber()) {   // Inc1c: optional CTE
        m.alpha = obj.Get("alpha").As<Napi::Number>().DoubleValue();
    }
    return m;
}

forge::fea::tet::BC feaTetReadBC(Napi::Env env, const Napi::Value& v) {
    forge::fea::tet::BC bc;
    if (v.IsUndefined() || v.IsNull()) return bc;
    if (!v.IsObject()) {
        throw Napi::TypeError::New(env, "forge.fea.tet: bc must be an object");
    }
    auto obj = v.As<Napi::Object>();
    if (obj.Has("fixedNodes") && obj.Get("fixedNodes").IsArray()) {
        auto a = obj.Get("fixedNodes").As<Napi::Array>();
        for (uint32_t i = 0; i < a.Length(); ++i) {
            bc.fixedNodes.push_back(a.Get(i).As<Napi::Number>().Int32Value());
        }
    }
    if (obj.Has("nodalForces") && obj.Get("nodalForces").IsArray()) {
        auto a = obj.Get("nodalForces").As<Napi::Array>();
        for (uint32_t i = 0; i < a.Length(); ++i) {
            auto e = a.Get(i);
            if (!e.IsObject()) {
                throw Napi::TypeError::New(env,
                    "forge.fea.tet: each nodalForces entry must be {nodeId, fx, fy, fz}");
            }
            auto o = e.As<Napi::Object>();
            int nid = o.Has("nodeId") ? o.Get("nodeId").As<Napi::Number>().Int32Value() : 0;
            double fx = o.Has("fx") ? o.Get("fx").As<Napi::Number>().DoubleValue() : 0.0;
            double fy = o.Has("fy") ? o.Get("fy").As<Napi::Number>().DoubleValue() : 0.0;
            double fz = o.Has("fz") ? o.Get("fz").As<Napi::Number>().DoubleValue() : 0.0;
            bc.nodalForces.emplace_back(nid, std::array<double,3>{fx, fy, fz});
        }
    }
    // Inc1c — general per-DOF prescribed displacement / symmetry constraints:
    //   prescribed: [{ nodeId, fx?, fy?, fz?, ux?, uy?, uz? }]
    if (obj.Has("prescribed") && obj.Get("prescribed").IsArray()) {
        auto a = obj.Get("prescribed").As<Napi::Array>();
        for (uint32_t i = 0; i < a.Length(); ++i) {
            auto e = a.Get(i);
            if (!e.IsObject()) continue;
            auto o = e.As<Napi::Object>();
            forge::fea::tet::PrescribedDisp pd;
            pd.nodeId = o.Has("nodeId") ? o.Get("nodeId").As<Napi::Number>().Int32Value() : 0;
            pd.fx = o.Has("fx") ? o.Get("fx").As<Napi::Boolean>().Value() : false;
            pd.fy = o.Has("fy") ? o.Get("fy").As<Napi::Boolean>().Value() : false;
            pd.fz = o.Has("fz") ? o.Get("fz").As<Napi::Boolean>().Value() : false;
            pd.ux = o.Has("ux") ? o.Get("ux").As<Napi::Number>().DoubleValue() : 0.0;
            pd.uy = o.Has("uy") ? o.Get("uy").As<Napi::Number>().DoubleValue() : 0.0;
            pd.uz = o.Has("uz") ? o.Get("uz").As<Napi::Number>().DoubleValue() : 0.0;
            bc.prescribed.push_back(pd);
        }
    }
    // Inc1c — thermoelastic temperature field: nodeTemps: [{ nodeId, T }] (ΔT).
    if (obj.Has("nodeTemps") && obj.Get("nodeTemps").IsArray()) {
        auto a = obj.Get("nodeTemps").As<Napi::Array>();
        for (uint32_t i = 0; i < a.Length(); ++i) {
            auto e = a.Get(i);
            if (!e.IsObject()) continue;
            auto o = e.As<Napi::Object>();
            int nid = o.Has("nodeId") ? o.Get("nodeId").As<Napi::Number>().Int32Value() : 0;
            double T = o.Has("T") ? o.Get("T").As<Napi::Number>().DoubleValue() : 0.0;
            bc.nodeTemps.emplace_back(nid, T);
        }
    }
    return bc;
}

std::vector<int> feaTetReadIntArr(Napi::Env env, const Napi::Value& v) {
    std::vector<int> out;
    if (v.IsUndefined() || v.IsNull()) return out;
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.fea.tet: expected int array");
    }
    auto a = v.As<Napi::Array>();
    out.reserve(a.Length());
    for (uint32_t i = 0; i < a.Length(); ++i) {
        out.push_back(a.Get(i).As<Napi::Number>().Int32Value());
    }
    return out;
}

} // namespace

Napi::Value FeaTetMeshShape(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        double te = requireNumber(info, 1, "targetEdge");
        auto m = forge::fea::tet::meshShapeFromHandle(h, te);
        return feaTetMeshToJs(info.Env(), m);
    });
}

Napi::Value FeaTetSolveLinearStatic(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto m   = feaTetReadMesh(env, info[0]);
        auto mat = feaTetReadMaterial(env, info[1]);
        auto bc  = feaTetReadBC(env, info.Length() > 2 ? info[2] : env.Undefined());
        auto r = forge::fea::tet::solveLinearStatic(m, mat, bc);
        auto out = Napi::Object::New(env);
        auto disp = Napi::Float64Array::New(env, r.displacement.size() * 3);
        for (std::size_t i = 0; i < r.displacement.size(); ++i) {
            disp.Data()[3*i+0] = r.displacement[i][0];
            disp.Data()[3*i+1] = r.displacement[i][1];
            disp.Data()[3*i+2] = r.displacement[i][2];
        }
        out.Set("displacement", disp);
        auto vm = Napi::Float64Array::New(env, r.vonMises.size());
        std::copy(r.vonMises.begin(), r.vonMises.end(), vm.Data());
        out.Set("vonMises", vm);
        out.Set("maxDisp",      Napi::Number::New(env, r.maxDisp));
        out.Set("maxVonMises",  Napi::Number::New(env, r.maxVonMises));
        out.Set("converged",    Napi::Boolean::New(env, r.converged));
        out.Set("cgIterations", Napi::Number::New(env, r.cgIterations));
        out.Set("cgResidual",   Napi::Number::New(env, r.cgResidual));
        // Inc1b — full Cauchy stress tensor + principal, per-element AND
        // nodal-recovered, as named Float64Arrays (length elemCount / nodeCount).
        auto emit6 = [&](const char* nm, const std::vector<std::array<double,6>>& v, int c) {
            auto a = Napi::Float64Array::New(env, v.size());
            for (std::size_t i = 0; i < v.size(); ++i) a.Data()[i] = v[i][c];
            out.Set(nm, a);
        };
        auto emit3 = [&](const char* nm, const std::vector<std::array<double,3>>& v, int c) {
            auto a = Napi::Float64Array::New(env, v.size());
            for (std::size_t i = 0; i < v.size(); ++i) a.Data()[i] = v[i][c];
            out.Set(nm, a);
        };
        emit6("sxx", r.elemStress, 0); emit6("syy", r.elemStress, 1); emit6("szz", r.elemStress, 2);
        emit6("sxy", r.elemStress, 3); emit6("syz", r.elemStress, 4); emit6("szx", r.elemStress, 5);
        emit3("s1", r.elemPrincipal, 0); emit3("s2", r.elemPrincipal, 1); emit3("s3", r.elemPrincipal, 2);
        emit6("nodeSxx", r.nodalStress, 0); emit6("nodeSyy", r.nodalStress, 1); emit6("nodeSzz", r.nodalStress, 2);
        emit6("nodeSxy", r.nodalStress, 3); emit6("nodeSyz", r.nodalStress, 4); emit6("nodeSzx", r.nodalStress, 5);
        emit3("nodeS1", r.nodalPrincipal, 0); emit3("nodeS2", r.nodalPrincipal, 1); emit3("nodeS3", r.nodalPrincipal, 2);
        auto nvm = Napi::Float64Array::New(env, r.nodalVonMises.size());
        std::copy(r.nodalVonMises.begin(), r.nodalVonMises.end(), nvm.Data());
        out.Set("nodeVonMises", nvm);
        return out;
    });
}

Napi::Value FeaTetSolveModal(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto m   = feaTetReadMesh(env, info[0]);
        auto mat = feaTetReadMaterial(env, info[1]);
        auto fixedNodes = feaTetReadIntArr(env, info.Length() > 2 ? info[2] : env.Undefined());
        int nModes = info.Length() > 3 && info[3].IsNumber()
            ? info[3].As<Napi::Number>().Int32Value() : 3;
        auto r = forge::fea::tet::solveModal(m, mat, fixedNodes, nModes);
        auto out = Napi::Object::New(env);
        auto fr = Napi::Float64Array::New(env, r.eigenfrequencies.size());
        std::copy(r.eigenfrequencies.begin(), r.eigenfrequencies.end(), fr.Data());
        out.Set("eigenfrequencies", fr);
        auto shapes = Napi::Array::New(env, r.modeShapes.size());
        for (std::size_t k = 0; k < r.modeShapes.size(); ++k) {
            auto& s = r.modeShapes[k];
            auto ta = Napi::Float64Array::New(env, s.size() * 3);
            for (std::size_t i = 0; i < s.size(); ++i) {
                ta.Data()[3*i+0] = s[i][0];
                ta.Data()[3*i+1] = s[i][1];
                ta.Data()[3*i+2] = s[i][2];
            }
            shapes.Set(static_cast<uint32_t>(k), ta);
        }
        out.Set("modeShapes", shapes);
        out.Set("converged",  Napi::Boolean::New(env, r.converged));
        return out;
    });
}

// ----------------------------------------------------------- CFD (Forge-12b)
//
// JS surface — under `forge.cfd`:
//   solveSteadyNS(cfgObj)
//     → { u: Float64Array, v: Float64Array, w: Float64Array,
//         p: Float64Array, maxVelocity, reynolds, iterations,
//         finalResidual, initialResidual, cpuMs, Nx, Ny, Nz }

namespace {

std::vector<forge::cfd::BCFaceVelocity>
readInlets(const Napi::Env& env, const Napi::Value& v) {
    std::vector<forge::cfd::BCFaceVelocity> out;
    if (v.IsUndefined() || v.IsNull()) return out;
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.cfd: inlets must be array");
    }
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (uint32_t i = 0; i < arr.Length(); ++i) {
        auto o = arr.Get(i).As<Napi::Object>();
        forge::cfd::BCFaceVelocity in{};
        in.faceId = o.Get("faceId").As<Napi::Number>().Uint32Value();
        in.vx = o.Has("vx") ? o.Get("vx").As<Napi::Number>().DoubleValue() : 0.0;
        in.vy = o.Has("vy") ? o.Get("vy").As<Napi::Number>().DoubleValue() : 0.0;
        in.vz = o.Has("vz") ? o.Get("vz").As<Napi::Number>().DoubleValue() : 0.0;
        out.push_back(in);
    }
    return out;
}

std::vector<std::uint32_t> readFaceIdArray(const Napi::Env& env, const Napi::Value& v) {
    std::vector<std::uint32_t> out;
    if (v.IsUndefined() || v.IsNull()) return out;
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.cfd: face id list must be array");
    }
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (uint32_t i = 0; i < arr.Length(); ++i) {
        out.push_back(arr.Get(i).As<Napi::Number>().Uint32Value());
    }
    return out;
}

// Parse the shared CFD config (domain, grid, fluid props, velocity BCs) used by
// BOTH the isothermal solveSteadyNS and the natural-convection wrapper.
forge::cfd::CfdConfig readCfdConfig(const Napi::Env& env, const Napi::Object& co) {
    forge::cfd::CfdConfig cfg;
    if (!co.Has("domain")) throw Napi::TypeError::New(env, "forge.cfd: cfg.domain required");
    auto domain = co.Get("domain").As<Napi::Float64Array>();
    if (domain.ElementLength() != 6) {
        throw Napi::TypeError::New(env, "forge.cfd: domain must be Float64Array[6]");
    }
    cfg.domain = { domain.Data()[0], domain.Data()[1], domain.Data()[2],
                   domain.Data()[3], domain.Data()[4], domain.Data()[5] };
    cfg.Nx = co.Get("Nx").As<Napi::Number>().Int32Value();
    cfg.Ny = co.Get("Ny").As<Napi::Number>().Int32Value();
    cfg.Nz = co.Get("Nz").As<Napi::Number>().Int32Value();
    cfg.rho = co.Get("rho").As<Napi::Number>().DoubleValue();
    cfg.nu  = co.Get("nu").As<Napi::Number>().DoubleValue();
    if (co.Has("maxIter"))     cfg.maxIter     = co.Get("maxIter").As<Napi::Number>().Int32Value();
    if (co.Has("residualTol")) cfg.residualTol = co.Get("residualTol").As<Napi::Number>().DoubleValue();
    cfg.inlets  = readInlets(env, co.Has("inlets")  ? co.Get("inlets")  : env.Undefined());
    cfg.outlets = readFaceIdArray(env, co.Has("outlets") ? co.Get("outlets") : env.Undefined());
    cfg.walls   = readFaceIdArray(env, co.Has("walls")   ? co.Get("walls")   : env.Undefined());
    if (co.Has("lid") && co.Get("lid").IsObject()) {
        auto lo = co.Get("lid").As<Napi::Object>();
        cfg.lid.faceId = lo.Get("faceId").As<Napi::Number>().Uint32Value();
        cfg.lid.vx = lo.Has("vx") ? lo.Get("vx").As<Napi::Number>().DoubleValue() : 0.0;
        cfg.lid.vy = lo.Has("vy") ? lo.Get("vy").As<Napi::Number>().DoubleValue() : 0.0;
        cfg.lid.vz = lo.Has("vz") ? lo.Get("vz").As<Napi::Number>().DoubleValue() : 0.0;
        cfg.useLid = true;
    }
    return cfg;
}

// Parse the optional thermal / Boussinesq block (energy equation, task #61):
//   thermal: { alpha, beta, Tref, gx, gy, gz, Tinit,
//              bc: [ {type:'isothermal'|'adiabatic', value}, ... x6 ] }
// Sets cfg.useThermal = true. The per-face `bc` array maps to AABB faces 0..5
// (-X,+X,-Y,+Y,-Z,+Z); a missing entry defaults to adiabatic (insulated).
void readThermal(const Napi::Env& env, const Napi::Object& co, forge::cfd::CfdConfig& cfg) {
    if (!(co.Has("thermal") && co.Get("thermal").IsObject())) return;
    auto th = co.Get("thermal").As<Napi::Object>();
    cfg.useThermal = true;
    auto num = [&](const char* k, double def) {
        return (th.Has(k) && th.Get(k).IsNumber())
                   ? th.Get(k).As<Napi::Number>().DoubleValue() : def;
    };
    cfg.alpha = num("alpha", 0.0);
    cfg.beta  = num("beta", 0.0);
    cfg.Tref  = num("Tref", 0.0);
    cfg.gx    = num("gx", 0.0);
    cfg.gy    = num("gy", 0.0);
    cfg.gz    = num("gz", 0.0);
    cfg.Tinit = num("Tinit", cfg.Tref);
    if (th.Has("bc") && th.Get("bc").IsArray()) {
        auto arr = th.Get("bc").As<Napi::Array>();
        for (uint32_t f = 0; f < arr.Length() && f < 6; ++f) {
            if (!arr.Get(f).IsObject()) continue;
            auto fo = arr.Get(f).As<Napi::Object>();
            std::string ty = "adiabatic";
            if (fo.Has("type") && fo.Get("type").IsString())
                ty = fo.Get("type").As<Napi::String>().Utf8Value();
            else if (fo.Has("type") && fo.Get("type").IsNumber())
                ty = (fo.Get("type").As<Napi::Number>().Int32Value() == 1) ? "isothermal" : "adiabatic";
            cfg.thermalBC[f].type =
                (ty == "isothermal" || ty == "dirichlet" || ty == "iso") ? 1 : 0;
            cfg.thermalBC[f].value =
                (fo.Has("value") && fo.Get("value").IsNumber())
                    ? fo.Get("value").As<Napi::Number>().DoubleValue() : 0.0;
        }
    }
}

// Parse the optional passive-scalar / species block (advection-diffusion, #61):
//   species: { D | massDiff, Cinit, C0: Float64Array (optional initial field),
//              bc: [ {type:'dirichlet'|'neumann'|'zeroGradient', value}, ... x6 ] }
// Sets cfg.useSpecies = true. The per-face `bc` array maps to AABB faces 0..5
// (-X,+X,-Y,+Y,-Z,+Z); a missing entry defaults to zero-gradient (impermeable).
// The scalar is PASSIVE — advected by the velocity field with no back-coupling.
void readSpecies(const Napi::Env& env, const Napi::Object& co, forge::cfd::CfdConfig& cfg) {
    if (!(co.Has("species") && co.Get("species").IsObject())) return;
    auto sp = co.Get("species").As<Napi::Object>();
    cfg.useSpecies = true;
    auto num = [&](const char* k, double def) {
        return (sp.Has(k) && sp.Get(k).IsNumber())
                   ? sp.Get(k).As<Napi::Number>().DoubleValue() : def;
    };
    // mass diffusivity: accept either `D` or `massDiff` (D = 0 ⇒ pure advection).
    cfg.massDiff = (sp.Has("D") && sp.Get("D").IsNumber()) ? num("D", 0.0)
                                                           : num("massDiff", 0.0);
    cfg.Cinit = num("Cinit", 0.0);
    // optional explicit initial concentration field (e.g. an advected pulse /
    // restart); length must equal Nx·Ny·Nz or it is ignored in favour of the
    // ramp/uniform seed inside the solver.
    if (sp.Has("C0") && sp.Get("C0").IsTypedArray()) {
        auto a = sp.Get("C0").As<Napi::Float64Array>();
        cfg.Cinit0.assign(a.Data(), a.Data() + a.ElementLength());
    }
    if (sp.Has("bc") && sp.Get("bc").IsArray()) {
        auto arr = sp.Get("bc").As<Napi::Array>();
        for (uint32_t f = 0; f < arr.Length() && f < 6; ++f) {
            if (!arr.Get(f).IsObject()) continue;
            auto fo = arr.Get(f).As<Napi::Object>();
            std::string ty = "neumann";
            if (fo.Has("type") && fo.Get("type").IsString())
                ty = fo.Get("type").As<Napi::String>().Utf8Value();
            else if (fo.Has("type") && fo.Get("type").IsNumber())
                ty = (fo.Get("type").As<Napi::Number>().Int32Value() == 1) ? "dirichlet" : "neumann";
            cfg.speciesBC[f].type =
                (ty == "dirichlet" || ty == "fixed" || ty == "inlet" || ty == "iso") ? 1 : 0;
            cfg.speciesBC[f].value =
                (fo.Has("value") && fo.Get("value").IsNumber())
                    ? fo.Get("value").As<Napi::Number>().DoubleValue() : 0.0;
        }
    }
}

// Build the JS result object (shared by both entrypoints). The temperature
// Float64Array is attached only when the thermal solve produced one.
Napi::Value cfdResultToJS(const Napi::Env& env,
                          const forge::cfd::CfdResult& r,
                          const forge::cfd::CfdConfig& cfg) {
    auto out = Napi::Object::New(env);
    auto u = Napi::Float64Array::New(env, r.u.size()); std::copy(r.u.begin(), r.u.end(), u.Data()); out.Set("u", u);
    auto v = Napi::Float64Array::New(env, r.v.size()); std::copy(r.v.begin(), r.v.end(), v.Data()); out.Set("v", v);
    auto w = Napi::Float64Array::New(env, r.w.size()); std::copy(r.w.begin(), r.w.end(), w.Data()); out.Set("w", w);
    auto p = Napi::Float64Array::New(env, r.p.size()); std::copy(r.p.begin(), r.p.end(), p.Data()); out.Set("p", p);
    if (!r.T.empty()) {
        auto T = Napi::Float64Array::New(env, r.T.size());
        std::copy(r.T.begin(), r.T.end(), T.Data());
        out.Set("T", T);
    }
    if (!r.C.empty()) {
        auto C = Napi::Float64Array::New(env, r.C.size());
        std::copy(r.C.begin(), r.C.end(), C.Data());
        out.Set("C", C);
    }
    out.Set("simTime",     Napi::Number::New(env, r.simTime));
    out.Set("maxVelocity", Napi::Number::New(env, r.maxVelocity));
    out.Set("reynolds",    Napi::Number::New(env, r.reynolds));
    out.Set("iterations",  Napi::Number::New(env, r.iterations));
    out.Set("finalResidual",   Napi::Number::New(env, r.finalResidual));
    out.Set("initialResidual", Napi::Number::New(env, r.initialResidual));
    out.Set("cpuMs",       Napi::Number::New(env, r.cpuMs));
    out.Set("Nx", Napi::Number::New(env, cfg.Nx));
    out.Set("Ny", Napi::Number::New(env, cfg.Ny));
    out.Set("Nz", Napi::Number::New(env, cfg.Nz));
    return out;
}

} // namespace

Napi::Value CfdSolveSteadyNS(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (!info[0].IsObject()) {
            throw Napi::TypeError::New(env, "forge.cfd.solveSteadyNS: cfg must be an object");
        }
        auto co = info[0].As<Napi::Object>();
        forge::cfd::CfdConfig cfg = readCfdConfig(env, co);
        // solveSteadyNS also honours an optional thermal block (so the energy
        // equation is available through this entrypoint too); absent ⇒ pure
        // isothermal NS, identical to before.
        readThermal(env, co, cfg);
        // …and an optional passive-scalar / species block (advection-diffusion);
        // absent ⇒ no scalar transported, solution unchanged.
        readSpecies(env, co, cfg);
        auto r = forge::cfd::solveSteadyNS(cfg);
        return cfdResultToJS(env, r, cfg);
    });
}

// forge.cfd.solveNaturalConvection(cfg) — energy equation + Boussinesq buoyancy
// (task #61). Identical core solver as solveSteadyNS but REQUIRES the `thermal`
// block and forces the coupled natural-convection path on. Validated against de
// Vahl Davis (1983) — see test/cfd_natconv_gate.mjs.
Napi::Value CfdSolveNaturalConvection(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (!info[0].IsObject()) {
            throw Napi::TypeError::New(env, "forge.cfd.solveNaturalConvection: cfg must be an object");
        }
        auto co = info[0].As<Napi::Object>();
        forge::cfd::CfdConfig cfg = readCfdConfig(env, co);
        readThermal(env, co, cfg);
        readSpecies(env, co, cfg);  // a heated flow may also carry a passive tracer
        if (!cfg.useThermal) {
            throw Napi::TypeError::New(env,
                "forge.cfd.solveNaturalConvection: a `thermal` block "
                "{ alpha, beta, gx/gy/gz, bc[] } is required");
        }
        auto r = forge::cfd::solveSteadyNS(cfg);
        return cfdResultToJS(env, r, cfg);
    });
}

// forge.cfd.solveSpeciesTransport(cfg) — passive scalar / species advection-
// diffusion (task #61). Same core MAC/Chorin solver and the SAME van-Leer MUSCL
// advection as momentum + the energy equation, but REQUIRES a `species` block
// and transports a concentration field C with NO back-coupling onto the flow
// (passive). May co-exist with a thermal block. Validated against the exact 1D
// advection-diffusion profile — see test/cfd_species_gate.mjs.
Napi::Value CfdSolveSpeciesTransport(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (!info[0].IsObject()) {
            throw Napi::TypeError::New(env, "forge.cfd.solveSpeciesTransport: cfg must be an object");
        }
        auto co = info[0].As<Napi::Object>();
        forge::cfd::CfdConfig cfg = readCfdConfig(env, co);
        readThermal(env, co, cfg);   // optional — species can ride a heated flow
        readSpecies(env, co, cfg);
        if (!cfg.useSpecies) {
            throw Napi::TypeError::New(env,
                "forge.cfd.solveSpeciesTransport: a `species` block "
                "{ D, Cinit, bc[] } is required");
        }
        auto r = forge::cfd::solveSteadyNS(cfg);
        return cfdResultToJS(env, r, cfg);
    });
}

// ----------------------------------------- compressible 1D Euler (task #63 C0)
//
// JS surface — under `forge.cfd`:
//   solveCompressible1D(cfgObj)   (alias: sodShockTube)
//     → { x, rho, u, p, e, mach: Float64Array,
//         cells, steps, tFinal, dx, cpuMs }
//
// Native Roe approximate Riemann flux (Harten–Hyman entropy fix) + SSP-RK2 +
// optional MUSCL/van-Leer reconstruction. All cfg fields are optional and
// DEFAULT to the standard Sod shock tube (Toro): see CfdCompressible.hpp.
Napi::Value CfdSolveCompressible1D(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        forge::cfd::Compressible1DConfig cfg; // Sod defaults
        if (info.Length() > 0 && info[0].IsObject()) {
            auto co = info[0].As<Napi::Object>();
            auto num = [&](const char* k, double& dst) {
                if (co.Has(k) && co.Get(k).IsNumber())
                    dst = co.Get(k).As<Napi::Number>().DoubleValue();
            };
            auto inum = [&](const char* k, int& dst) {
                if (co.Has(k) && co.Get(k).IsNumber())
                    dst = co.Get(k).As<Napi::Number>().Int32Value();
            };
            num("xL", cfg.xL);   num("xR", cfg.xR);   num("x0", cfg.x0);
            inum("N", cfg.N);
            num("gamma", cfg.gamma);
            num("tEnd", cfg.tEnd);
            num("cfl", cfg.cfl);
            inum("order", cfg.order);
            num("rhoL", cfg.rhoL); num("uL", cfg.uL); num("pL", cfg.pL);
            num("rhoR", cfg.rhoR); num("uR", cfg.uR); num("pR", cfg.pR);
            inum("maxSteps", cfg.maxSteps);
        }
        auto r = forge::cfd::solveCompressible1D(cfg);
        auto out = Napi::Object::New(env);
        auto setF = [&](const char* k, const std::vector<double>& v) {
            auto a = Napi::Float64Array::New(env, v.size());
            std::copy(v.begin(), v.end(), a.Data());
            out.Set(k, a);
        };
        setF("x", r.x);
        setF("rho", r.rho);
        setF("u", r.u);
        setF("p", r.p);
        setF("e", r.e);
        setF("mach", r.mach);
        out.Set("cells",  Napi::Number::New(env, r.cells));
        out.Set("steps",  Napi::Number::New(env, r.steps));
        out.Set("tFinal", Napi::Number::New(env, r.tFinal));
        out.Set("dx",     Napi::Number::New(env, r.dx));
        out.Set("cpuMs",  Napi::Number::New(env, r.cpuMs));
        return out;
    });
}

// ----------------------------------------- compressible 2D Euler (task #63 C1)
//
// JS surface — under `forge.cfd`:
//   solveCompressible2D(cfgObj)   (alias: obliqueShock)
//     → { ni, nj, x, y, rho, u, v, p, mach: Float64Array,
//         rhoInf, uInf, vInf, pInf, aInf, machInf,
//         iters, resFinal, res0, order, cpuMs }
//
// Cell-centred finite volume on a body-fitted structured wedge mesh. The
// interface flux is the C0 Roe solver rotated into the face-normal frame plus
// a tangential shear wave (NOT a second Riemann solver). Slip-wall (flow
// tangency) on the wedge floor; supersonic inflow/far-field + outflow. All cfg
// fields are optional and DEFAULT to the canonical M₁=2, θ=15° wedge.
Napi::Value CfdSolveCompressible2D(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        forge::cfd::Compressible2DConfig cfg; // M=2, θ=15° wedge defaults
        if (info.Length() > 0 && info[0].IsObject()) {
            auto co = info[0].As<Napi::Object>();
            auto num = [&](const char* k, double& dst) {
                if (co.Has(k) && co.Get(k).IsNumber())
                    dst = co.Get(k).As<Napi::Number>().DoubleValue();
            };
            auto inum = [&](const char* k, int& dst) {
                if (co.Has(k) && co.Get(k).IsNumber())
                    dst = co.Get(k).As<Napi::Number>().Int32Value();
            };
            num("gamma", cfg.gamma);
            num("machInf", cfg.machInf);
            num("wedgeDeg", cfg.wedgeDeg);
            num("xInlet", cfg.xInlet); num("xRamp", cfg.xRamp);
            num("xOutlet", cfg.xOutlet); num("yTop", cfg.yTop);
            inum("ni", cfg.ni); inum("nj", cfg.nj);
            num("rhoInf", cfg.rhoInf); num("pInf", cfg.pInf);
            num("cfl", cfg.cfl);
            inum("order", cfg.order);
            inum("maxIter", cfg.maxIter);
            num("resTol", cfg.resTol);
        }
        auto r = forge::cfd::solveCompressible2D(cfg);
        auto out = Napi::Object::New(env);
        auto setF = [&](const char* k, const std::vector<double>& v) {
            auto a = Napi::Float64Array::New(env, v.size());
            std::copy(v.begin(), v.end(), a.Data());
            out.Set(k, a);
        };
        setF("x", r.x);     setF("y", r.y);
        setF("rho", r.rho); setF("u", r.u); setF("v", r.v);
        setF("p", r.p);     setF("mach", r.mach);
        out.Set("ni", Napi::Number::New(env, r.ni));
        out.Set("nj", Napi::Number::New(env, r.nj));
        out.Set("rhoInf",  Napi::Number::New(env, r.rhoInf));
        out.Set("uInf",    Napi::Number::New(env, r.uInf));
        out.Set("vInf",    Napi::Number::New(env, r.vInf));
        out.Set("pInf",    Napi::Number::New(env, r.pInf));
        out.Set("aInf",    Napi::Number::New(env, r.aInf));
        out.Set("machInf", Napi::Number::New(env, r.machInf));
        out.Set("iters",    Napi::Number::New(env, r.iters));
        out.Set("resFinal", Napi::Number::New(env, r.resFinal));
        out.Set("res0",     Napi::Number::New(env, r.res0));
        out.Set("order",    Napi::Number::New(env, r.order));
        out.Set("cpuMs",    Napi::Number::New(env, r.cpuMs));
        return out;
    });
}

// ------------------------------------------------- Multibody dynamics
// Real constrained inertial multibody integrator (HHT-α + Baumgarte) —
// supersedes the kinematic MotionStudy. Exposed as
// forge.simulate.multibodyDynamics(cfg). See MultibodyDynamics.hpp for the
// closed-form-validated equations of motion.
namespace mbd_bind {

// Read a fixed-length number array (JS Array or TypedArray) into a buffer.
// Missing/short -> zero-filled; extra entries ignored.
inline void readNums(const Napi::Env& env, const Napi::Value& v,
                     double* out, std::size_t n, const char* what) {
    for (std::size_t i = 0; i < n; ++i) out[i] = 0.0;
    if (v.IsUndefined() || v.IsNull()) return;
    if (!v.IsArray() && !v.IsTypedArray()) {
        throw Napi::TypeError::New(env,
            std::string("forge.simulate.multibodyDynamics: ") + what + " must be an array");
    }
    auto a = v.As<Napi::Array>();
    const uint32_t len = a.Length();
    for (std::size_t i = 0; i < n && i < len; ++i) {
        Napi::Value e = a.Get((uint32_t)i);
        out[i] = e.IsNumber() ? e.As<Napi::Number>().DoubleValue() : 0.0;
    }
}

inline std::array<double, 3> readVec3(const Napi::Env& env, const Napi::Object& o,
                                      const char* key) {
    std::array<double, 3> r{0, 0, 0};
    if (o.Has(key)) readNums(env, o.Get(key), r.data(), 3, key);
    return r;
}

inline Napi::Array vec3Array(const Napi::Env& env, const std::array<double, 3>& v) {
    auto a = Napi::Array::New(env, 3);
    a.Set((uint32_t)0, Napi::Number::New(env, v[0]));
    a.Set((uint32_t)1, Napi::Number::New(env, v[1]));
    a.Set((uint32_t)2, Napi::Number::New(env, v[2]));
    return a;
}

} // namespace mbd_bind

Napi::Value SimulateMultibodyDynamics(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (!info[0].IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.simulate.multibodyDynamics: cfg must be an object");
        }
        auto co = info[0].As<Napi::Object>();

        // --- bodies ---
        std::vector<forge::MbdBody> bodies;
        if (co.Has("bodies") && co.Get("bodies").IsArray()) {
            auto ba = co.Get("bodies").As<Napi::Array>();
            for (uint32_t i = 0; i < ba.Length(); ++i) {
                if (!ba.Get(i).IsObject()) {
                    throw Napi::TypeError::New(env,
                        "forge.simulate.multibodyDynamics: each body must be an object");
                }
                auto bo = ba.Get(i).As<Napi::Object>();
                forge::MbdBody b;
                b.mass = bo.Has("mass") ? bo.Get("mass").As<Napi::Number>().DoubleValue() : 1.0;
                mbd_bind::readNums(env, bo.Has("inertia") ? bo.Get("inertia") : env.Undefined(),
                                   b.inertia.data(), 9, "body.inertia");
                // Default identity inertia if none supplied.
                bool anyI = false;
                for (double x : b.inertia) if (x != 0.0) { anyI = true; break; }
                if (!anyI) b.inertia = {1,0,0, 0,1,0, 0,0,1};
                b.position    = mbd_bind::readVec3(env, bo, "position");
                b.orientation = mbd_bind::readVec3(env, bo, "orientation");
                b.linVel      = mbd_bind::readVec3(env, bo, "linVel");
                b.angVel      = mbd_bind::readVec3(env, bo, "angVel");
                bodies.push_back(b);
            }
        }
        if (bodies.empty()) {
            throw Napi::TypeError::New(env,
                "forge.simulate.multibodyDynamics: cfg.bodies must be a non-empty array");
        }

        // --- constraints ---
        std::vector<forge::MbdConstraint> constraints;
        if (co.Has("constraints") && co.Get("constraints").IsArray()) {
            auto ca = co.Get("constraints").As<Napi::Array>();
            for (uint32_t i = 0; i < ca.Length(); ++i) {
                auto cobj = ca.Get(i).As<Napi::Object>();
                forge::MbdConstraint c;
                std::string kind = cobj.Has("kind") && cobj.Get("kind").IsString()
                    ? cobj.Get("kind").As<Napi::String>().Utf8Value() : "ballJoint";
                if (kind == "ballJoint" || kind == "BallJoint")
                    c.kind = forge::MbdConstraintKind::BallJoint;
                else if (kind == "axisLock" || kind == "AxisLock")
                    c.kind = forge::MbdConstraintKind::AxisLock;
                else if (kind == "distance" || kind == "Distance")
                    c.kind = forge::MbdConstraintKind::Distance;
                else if (kind == "spherical" || kind == "Spherical" ||
                         kind == "ball"      || kind == "Ball")
                    // Two-moving-body ball joint: coincides pointA(bodyA) with
                    // pointB(bodyB). The closed-loop joint for four-bar /
                    // slider-crank mechanisms (Shabana spherical pair).
                    c.kind = forge::MbdConstraintKind::Spherical;
                else if (kind == "pointOnLine" || kind == "PointOnLine" ||
                         kind == "prismatic"   || kind == "Prismatic")
                    // Confine pointA(bodyA) to the world line through `anchor`
                    // along unit `axis` — the slider rail of a slider-crank.
                    c.kind = forge::MbdConstraintKind::PointOnLine;
                else
                    throw Napi::TypeError::New(env,
                        "forge.simulate.multibodyDynamics: unknown constraint kind '" + kind + "'");
                c.bodyA = cobj.Has("bodyA") ? cobj.Get("bodyA").As<Napi::Number>().Uint32Value() : 0;
                c.bodyB = cobj.Has("bodyB") ? cobj.Get("bodyB").As<Napi::Number>().Uint32Value() : 0;
                c.pointA = mbd_bind::readVec3(env, cobj, "pointA");
                c.pointB = mbd_bind::readVec3(env, cobj, "pointB");
                c.anchor = mbd_bind::readVec3(env, cobj, "anchor");
                c.axis   = mbd_bind::readVec3(env, cobj, "axis");
                if (cobj.Has("value")) c.value = cobj.Get("value").As<Napi::Number>().DoubleValue();
                constraints.push_back(c);
            }
        }

        // --- loads ---
        std::vector<forge::MbdLoad> loads;
        if (co.Has("loads") && co.Get("loads").IsArray()) {
            auto la = co.Get("loads").As<Napi::Array>();
            for (uint32_t i = 0; i < la.Length(); ++i) {
                auto lo = la.Get(i).As<Napi::Object>();
                forge::MbdLoad ld;
                ld.body   = lo.Has("body") ? lo.Get("body").As<Napi::Number>().Uint32Value() : 0;
                ld.force  = mbd_bind::readVec3(env, lo, "force");
                ld.torque = mbd_bind::readVec3(env, lo, "torque");
                loads.push_back(ld);
            }
        }

        // --- gravity ---
        forge::MbdGravity gravity;
        if (co.Has("gravity"))
            mbd_bind::readNums(env, co.Get("gravity"), gravity.g.data(), 3, "gravity");

        // --- config ---
        forge::MbdConfig cfg;
        if (co.Has("dt"))             cfg.dt             = co.Get("dt").As<Napi::Number>().DoubleValue();
        if (co.Has("steps"))          cfg.steps          = co.Get("steps").As<Napi::Number>().Uint32Value();
        if (co.Has("alpha"))          cfg.alpha          = co.Get("alpha").As<Napi::Number>().DoubleValue();
        if (co.Has("baumgarteOmega")) cfg.baumgarteOmega = co.Get("baumgarteOmega").As<Napi::Number>().DoubleValue();
        if (co.Has("baumgarteZeta"))  cfg.baumgarteZeta  = co.Get("baumgarteZeta").As<Napi::Number>().DoubleValue();
        if (co.Has("sampleStride"))   cfg.sampleStride   = co.Get("sampleStride").As<Napi::Number>().Uint32Value();

        auto r = forge::simulateMultibody(bodies, constraints, loads, gravity, cfg);

        // --- marshal result back to JS ---
        auto out = Napi::Object::New(env);
        auto samples = Napi::Array::New(env, r.samples.size());
        for (std::size_t s = 0; s < r.samples.size(); ++s) {
            const auto& sm = r.samples[s];
            auto so = Napi::Object::New(env);
            so.Set("t", Napi::Number::New(env, sm.t));
            auto pos = Napi::Array::New(env, sm.position.size());
            auto ori = Napi::Array::New(env, sm.orientation.size());
            auto lv  = Napi::Array::New(env, sm.linVel.size());
            auto av  = Napi::Array::New(env, sm.angVel.size());
            for (std::size_t b = 0; b < sm.position.size(); ++b)
                pos.Set((uint32_t)b, mbd_bind::vec3Array(env, sm.position[b]));
            for (std::size_t b = 0; b < sm.orientation.size(); ++b)
                ori.Set((uint32_t)b, mbd_bind::vec3Array(env, sm.orientation[b]));
            for (std::size_t b = 0; b < sm.linVel.size(); ++b)
                lv.Set((uint32_t)b, mbd_bind::vec3Array(env, sm.linVel[b]));
            for (std::size_t b = 0; b < sm.angVel.size(); ++b)
                av.Set((uint32_t)b, mbd_bind::vec3Array(env, sm.angVel[b]));
            so.Set("position", pos);
            so.Set("orientation", ori);
            so.Set("linVel", lv);
            so.Set("angVel", av);
            so.Set("constraintResidual", Napi::Number::New(env, sm.constraintResidual));
            so.Set("energy", Napi::Number::New(env, sm.energy));
            samples.Set((uint32_t)s, so);
        }
        out.Set("samples", samples);
        out.Set("maxConstraintDrift", Napi::Number::New(env, r.maxConstraintDrift));
        out.Set("energyDrift", Napi::Number::New(env, r.energyDrift));
        out.Set("stepsTaken", Napi::Number::New(env, r.stepsTaken));
        out.Set("stable", Napi::Boolean::New(env, r.stable));
        return out;
    });
}

// ----------------------------------------------------------- IO (Forge-21)
namespace io_bind {
std::string requirePath(const Napi::CallbackInfo& info, std::size_t idx) {
    if (info.Length() <= idx || !info[idx].IsString()) {
        throw Napi::TypeError::New(info.Env(),
            "forge.io: expected filepath string at arg " + std::to_string(idx));
    }
    return info[idx].As<Napi::String>().Utf8Value();
}
}

Napi::Value IoImportStep(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            forge::io::importStep(io_bind::requirePath(info, 0)));
    });
}
Napi::Value IoExportStep(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Boolean::New(info.Env(),
            forge::io::exportStep(requireHandle(info, 0), io_bind::requirePath(info, 1)));
    });
}
Napi::Value IoImportBrep(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            forge::io::importBrep(io_bind::requirePath(info, 0)));
    });
}
Napi::Value IoExportBrep(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Boolean::New(info.Env(),
            forge::io::exportBrep(requireHandle(info, 0), io_bind::requirePath(info, 1)));
    });
}
Napi::Value IoExportIges(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Boolean::New(info.Env(),
            forge::io::exportIges(requireHandle(info, 0), io_bind::requirePath(info, 1)));
    });
}
Napi::Value IoImportStl(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            forge::io::importStl(io_bind::requirePath(info, 0)));
    });
}
Napi::Value IoExportStl(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto handle = requireHandle(info, 0);
        const auto path = io_bind::requirePath(info, 1);
        const double linTol = info.Length() > 2 && info[2].IsNumber()
            ? info[2].As<Napi::Number>().DoubleValue() : 0.1;
        const double angTol = info.Length() > 3 && info[3].IsNumber()
            ? info[3].As<Napi::Number>().DoubleValue() : 0.5;
        const bool ascii = info.Length() > 4 && info[4].IsBoolean()
            ? info[4].As<Napi::Boolean>().Value() : false;
        return Napi::Boolean::New(info.Env(),
            forge::io::exportStl(handle, path, linTol, angTol, ascii));
    });
}

// Forge-34 — IGES / JT / Parasolid + PMI.
Napi::Value IoImportIges(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            forge::io::importIges(io_bind::requirePath(info, 0)));
    });
}
Napi::Value IoImportJt(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            forge::io::importJt(io_bind::requirePath(info, 0)));
    });
}
Napi::Value IoImportParasolid(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            forge::io::importParasolid(io_bind::requirePath(info, 0)));
    });
}
Napi::Value IoExportStepPmi(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto handle = requireHandle(info, 0);
        const auto path = io_bind::requirePath(info, 1);
        std::vector<forge::io::PmiNote> notes;
        if (info.Length() > 2 && info[2].IsArray()) {
            auto arr = info[2].As<Napi::Array>();
            notes.reserve(arr.Length());
            for (std::uint32_t i = 0; i < arr.Length(); ++i) {
                auto v = arr.Get(i);
                if (!v.IsObject()) {
                    throw Napi::TypeError::New(info.Env(),
                        "forge.io.exportStepWithPmi: notes[i] must be {text, anchorKind?, anchorId?}");
                }
                auto o = v.As<Napi::Object>();
                forge::io::PmiNote n{};
                n.text       = o.Has("text") && o.Get("text").IsString()
                               ? o.Get("text").As<Napi::String>().Utf8Value() : std::string();
                n.anchorKind = o.Has("anchorKind") && o.Get("anchorKind").IsString()
                               ? o.Get("anchorKind").As<Napi::String>().Utf8Value() : std::string();
                n.anchorId   = o.Has("anchorId") && o.Get("anchorId").IsNumber()
                               ? o.Get("anchorId").As<Napi::Number>().Uint32Value() : 0u;
                notes.push_back(std::move(n));
            }
        }
        return Napi::Boolean::New(info.Env(),
            forge::io::exportStepWithPmi(handle, path, notes));
    });
}

// ----------------------------------------------------------- direct modeling (Forge-23)
//
// JS surface — under `forge.direct`:
//   pushPullFace(handle, faceId, distance) → newHandle
//   moveFace(handle, faceId, [tx,ty,tz])    → newHandle
//   rotateFace(handle, faceId, [ox,oy,oz], [dx,dy,dz], angleRad) → newHandle
//   deleteFaceAndHeal(handle, [faceId, …])  → newHandle
//   replaceFace(handle, faceId, {kind, origin:[3], normal:[3], radius}) → newHandle
//   inferFeature(handle, faceId) → { kind, label, normal:[3], centroid:[3], area, radius }
//   faceCount(handle) → number
namespace direct_bind {

std::array<double, 3> readVec3(Napi::Env env, const Napi::Value& v, const char* what) {
    if (!v.IsArray()) {
        if (v.IsTypedArray()) {
            auto ta = v.As<Napi::Float64Array>();
            if (ta.ElementLength() != 3) {
                throw Napi::TypeError::New(env,
                    std::string("forge.direct: ") + what + " must be length 3");
            }
            return { ta.Data()[0], ta.Data()[1], ta.Data()[2] };
        }
        throw Napi::TypeError::New(env,
            std::string("forge.direct: expected array[3] for ") + what);
    }
    auto a = v.As<Napi::Array>();
    if (a.Length() != 3) {
        throw Napi::TypeError::New(env,
            std::string("forge.direct: ") + what + " must be length 3");
    }
    return { a.Get(uint32_t{0}).As<Napi::Number>().DoubleValue(),
             a.Get(uint32_t{1}).As<Napi::Number>().DoubleValue(),
             a.Get(uint32_t{2}).As<Napi::Number>().DoubleValue() };
}

Napi::Array vec3ToArr(Napi::Env env, const std::array<double, 3>& v) {
    auto a = Napi::Array::New(env, 3);
    a.Set(uint32_t{0}, v[0]);
    a.Set(uint32_t{1}, v[1]);
    a.Set(uint32_t{2}, v[2]);
    return a;
}

const char* featureKindName(forge::direct::FeatureKind k) {
    switch (k) {
        case forge::direct::FeatureKind::Boss:    return "boss";
        case forge::direct::FeatureKind::Hole:    return "hole";
        case forge::direct::FeatureKind::Fillet:  return "fillet";
        case forge::direct::FeatureKind::Blend:   return "blend";
        case forge::direct::FeatureKind::Chamfer: return "chamfer";
        case forge::direct::FeatureKind::Unknown:
        default:                                  return "unknown";
    }
}
} // namespace direct_bind

Napi::Value DirectPushPullFace(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto h     = requireHandle(info, 0);
        const auto faceId = requireHandle(info, 1);
        const double d   = requireNumber(info, 2, "distance");
        return Napi::Number::New(info.Env(),
            forge::direct::pushPullFace(h, faceId, d));
    });
}

Napi::Value DirectMoveFace(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto h     = requireHandle(info, 0);
        const auto faceId = requireHandle(info, 1);
        auto t = direct_bind::readVec3(info.Env(), info[2], "translation");
        return Napi::Number::New(info.Env(),
            forge::direct::moveFace(h, faceId, t));
    });
}

Napi::Value DirectRotateFace(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto h     = requireHandle(info, 0);
        const auto faceId = requireHandle(info, 1);
        auto o = direct_bind::readVec3(info.Env(), info[2], "axisOrigin");
        auto d = direct_bind::readVec3(info.Env(), info[3], "axisDir");
        const double ang = requireNumber(info, 4, "angleRad");
        return Napi::Number::New(info.Env(),
            forge::direct::rotateFace(h, faceId, o, d, ang));
    });
}

Napi::Value DirectDeleteFace(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto h = requireHandle(info, 0);
        if (!info[1].IsArray()) {
            throw Napi::TypeError::New(info.Env(),
                "forge.direct.deleteFaceAndHeal: expected array of face ids");
        }
        auto arr = info[1].As<Napi::Array>();
        std::vector<forge::direct::FaceId> ids;
        ids.reserve(arr.Length());
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            ids.push_back(arr.Get(i).As<Napi::Number>().Uint32Value());
        }
        return Napi::Number::New(info.Env(),
            forge::direct::deleteFaceAndHeal(h, ids));
    });
}

Napi::Value DirectReplaceFace(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto h     = requireHandle(info, 0);
        const auto faceId = requireHandle(info, 1);
        if (!info[2].IsObject()) {
            throw Napi::TypeError::New(info.Env(),
                "forge.direct.replaceFace: expected SurfaceSpec object");
        }
        auto spec = info[2].As<Napi::Object>();
        forge::direct::SurfaceSpec s{};
        if (spec.Has("kind")) {
            std::string k = spec.Get("kind").As<Napi::String>();
            if      (k == "plane")    s.kind = forge::direct::SurfaceSpec::Kind::Plane;
            else if (k == "cylinder") s.kind = forge::direct::SurfaceSpec::Kind::Cylinder;
            else if (k == "sphere")   s.kind = forge::direct::SurfaceSpec::Kind::Sphere;
            else throw Napi::TypeError::New(info.Env(),
                "forge.direct.replaceFace: kind must be plane/cylinder/sphere");
        }
        if (spec.Has("origin")) s.origin = direct_bind::readVec3(info.Env(), spec.Get("origin"), "origin");
        if (spec.Has("normal")) s.normal = direct_bind::readVec3(info.Env(), spec.Get("normal"), "normal");
        if (spec.Has("radius")) s.radius = spec.Get("radius").As<Napi::Number>().DoubleValue();
        return Napi::Number::New(info.Env(),
            forge::direct::replaceFace(h, faceId, s));
    });
}

Napi::Value DirectInferFeature(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        const auto h     = requireHandle(info, 0);
        const auto faceId = requireHandle(info, 1);
        const auto fi = forge::direct::inferFeature(h, faceId);
        auto out = Napi::Object::New(env);
        out.Set("kind",     Napi::String::New(env, direct_bind::featureKindName(fi.kind)));
        out.Set("label",    Napi::String::New(env, fi.label));
        out.Set("normal",   direct_bind::vec3ToArr(env, fi.normal));
        out.Set("centroid", direct_bind::vec3ToArr(env, fi.centroid));
        out.Set("area",     Napi::Number::New(env, fi.area));
        out.Set("radius",   Napi::Number::New(env, fi.radius));
        return out;
    });
}

Napi::Value DirectFaceCount(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        // OCCT-indexed for consistency with the OCCT-addressed direct-edit ops (see
        // FaceInventory note). Canonical count is forge.nativeFaceInventory().length.
        return Napi::Number::New(info.Env(),
            static_cast<double>(forge::direct::faceCount(requireHandle(info, 0))));
    });
}

// PUSH-31 — JS-callable edge count so the toolbar fillet/chamfer tools
// can default to "all edges" when no selection is supplied.
Napi::Value DirectEdgeCount(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        // OCCT-indexed for consistency with OCCT-addressed direct-edit ops. Canonical
        // native count is available via forge.nativeEdgeCount / analyticEdgeCount.
        return Napi::Number::New(info.Env(),
            static_cast<double>(forge::direct::edgeCount(requireHandle(info, 0))));
    });
}

// Slice-3 — edge polylines for viewport edge picking. Returns
// [{ id, points:Float32Array }] where id is the 0-based fillet/chamfer
// edge id and points are world-space x,y,z samples along the edge.
Napi::Value DirectEdgeSegments(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto h = requireHandle(info, 0);
        double defl = info.Length() > 1 && info[1].IsNumber()
                          ? info[1].As<Napi::Number>().DoubleValue() : 0.25;
        auto edges = forge::direct::edgeSegments(h, defl);
        auto arr = Napi::Array::New(env, edges.size());
        for (std::size_t i = 0; i < edges.size(); ++i) {
            auto o = Napi::Object::New(env);
            o.Set("id", Napi::Number::New(env, static_cast<double>(edges[i].id)));
            auto pts = Napi::Float32Array::New(env, edges[i].points.size());
            std::copy(edges[i].points.begin(), edges[i].points.end(), pts.Data());
            o.Set("points", pts);
            arr.Set(i, o);
        }
        return arr;
    });
}

// ----------------------------------------------------------- healing (Forge-23)
namespace heal_bind {
Napi::Object sewReportToJs(Napi::Env env, const forge::heal::SewReport& r) {
    auto o = Napi::Object::New(env);
    o.Set("closedBefore",    Napi::Boolean::New(env, r.closedBefore));
    o.Set("closedAfter",     Napi::Boolean::New(env, r.closedAfter));
    o.Set("facesBefore",     Napi::Number::New(env, static_cast<double>(r.facesBefore)));
    o.Set("facesAfter",      Napi::Number::New(env, static_cast<double>(r.facesAfter)));
    o.Set("openEdgesBefore", Napi::Number::New(env, static_cast<double>(r.openEdgesBefore)));
    o.Set("openEdgesAfter",  Napi::Number::New(env, static_cast<double>(r.openEdgesAfter)));
    return o;
}
} // namespace heal_bind

Napi::Value HealSew(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto h = requireHandle(info, 0);
        const double tol = info.Length() > 1 && info[1].IsNumber()
            ? info[1].As<Napi::Number>().DoubleValue() : 1e-3;
        auto env = info.Env();
        auto r = forge::heal::sewShape(h, tol);
        auto out = Napi::Object::New(env);
        out.Set("handle", Napi::Number::New(env, r.handle));
        out.Set("report", heal_bind::sewReportToJs(env, r.report));
        return out;
    });
}

Napi::Value HealSimplify(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto h = requireHandle(info, 0);
        forge::heal::SimplifyOptions opts{};
        if (info.Length() > 1 && info[1].IsObject()) {
            auto o = info[1].As<Napi::Object>();
            if (o.Has("unifyFaces"))     opts.unifyFaces = o.Get("unifyFaces").As<Napi::Boolean>().Value();
            if (o.Has("unifyEdges"))     opts.unifyEdges = o.Get("unifyEdges").As<Napi::Boolean>().Value();
            if (o.Has("concatBSplines")) opts.concatBSplines = o.Get("concatBSplines").As<Napi::Boolean>().Value();
            if (o.Has("angularTol"))     opts.angularTol = o.Get("angularTol").As<Napi::Number>().DoubleValue();
        }
        auto env = info.Env();
        auto r = forge::heal::simplifyShape(h, opts);
        auto out = Napi::Object::New(env);
        out.Set("handle",      Napi::Number::New(env, r.handle));
        out.Set("facesBefore", Napi::Number::New(env, static_cast<double>(r.facesBefore)));
        out.Set("facesAfter",  Napi::Number::New(env, static_cast<double>(r.facesAfter)));
        out.Set("edgesBefore", Napi::Number::New(env, static_cast<double>(r.edgesBefore)));
        out.Set("edgesAfter",  Napi::Number::New(env, static_cast<double>(r.edgesAfter)));
        return out;
    });
}

Napi::Value HealAutoFill(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto h = requireHandle(info, 0);
        const double tol = info.Length() > 1 && info[1].IsNumber()
            ? info[1].As<Napi::Number>().DoubleValue() : 1e-3;
        auto env = info.Env();
        auto r = forge::heal::autoFillMissingFaces(h, tol);
        auto out = Napi::Object::New(env);
        out.Set("handle", Napi::Number::New(env, r.handle));
        auto rep = Napi::Object::New(env);
        rep.Set("facesAdded",      Napi::Number::New(env, static_cast<double>(r.report.facesAdded)));
        rep.Set("closedAfter",     Napi::Boolean::New(env, r.report.closedAfter));
        rep.Set("openEdgesBefore", Napi::Number::New(env, static_cast<double>(r.report.openEdgesBefore)));
        rep.Set("openEdgesAfter",  Napi::Number::New(env, static_cast<double>(r.report.openEdgesAfter)));
        out.Set("report", rep);
        return out;
    });
}

Napi::Value HealAutoRepair(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        const auto h = requireHandle(info, 0);
        const double tol = info.Length() > 1 && info[1].IsNumber()
            ? info[1].As<Napi::Number>().DoubleValue() : 1e-3;
        auto env = info.Env();
        auto r = forge::heal::autoRepairSelfIntersection(h, tol);
        auto out = Napi::Object::New(env);
        out.Set("handle", Napi::Number::New(env, r.handle));
        auto rep = Napi::Object::New(env);
        rep.Set("fixedTolerance",        Napi::Boolean::New(env, r.report.fixedTolerance));
        rep.Set("fixedSelfIntersection", Napi::Boolean::New(env, r.report.fixedSelfIntersection));
        rep.Set("fixedSmallFaces",       Napi::Boolean::New(env, r.report.fixedSmallFaces));
        rep.Set("fixedOrientation",      Napi::Boolean::New(env, r.report.fixedOrientation));
        rep.Set("fixedWires",            Napi::Boolean::New(env, r.report.fixedWires));
        rep.Set("fixersFired",           Napi::Number::New(env, static_cast<double>(r.report.fixersFired)));
        out.Set("report", rep);
        return out;
    });
}

Napi::Value HealHarmonizeNormals(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        return Napi::Number::New(info.Env(),
            forge::heal::harmonizeNormals(requireHandle(info, 0)));
    });
}

Napi::Value HealCheckValidity(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto r = forge::heal::checkValidity(requireHandle(info, 0));
        auto out = Napi::Object::New(env);
        out.Set("isClosed",           Napi::Boolean::New(env, r.isClosed));
        out.Set("isManifold",         Napi::Boolean::New(env, r.isManifold));
        out.Set("isOriented",         Napi::Boolean::New(env, r.isOriented));
        out.Set("hasSelfIntersect",   Napi::Boolean::New(env, r.hasSelfIntersect));
        out.Set("hasNonManifoldEdge", Napi::Boolean::New(env, r.hasNonManifoldEdge));
        auto bf = Napi::Uint32Array::New(env, r.badFaces.size());
        std::copy(r.badFaces.begin(), r.badFaces.end(), bf.Data());
        out.Set("badFaces", bf);
        auto be = Napi::Uint32Array::New(env, r.badEdges.size());
        std::copy(r.badEdges.begin(), r.badEdges.end(), be.Data());
        out.Set("badEdges", be);
        return out;
    });
}

// ----------------------------------------------------------- part features (Forge-22)
namespace part_bind {

std::vector<double> readVec3(const Napi::CallbackInfo& info, std::size_t idx, const char* what) {
    auto env = info.Env();
    if (info.Length() <= idx) {
        throw Napi::TypeError::New(env,
            std::string("forge.part: missing ") + what + " (vec3)");
    }
    auto v = info[idx];
    if (v.IsTypedArray()) {
        auto a = v.As<Napi::Float64Array>();
        if (a.ElementLength() != 3) {
            throw Napi::TypeError::New(env,
                std::string("forge.part: ") + what + " must have 3 elements");
        }
        return {a.Data()[0], a.Data()[1], a.Data()[2]};
    }
    if (v.IsArray()) {
        auto a = v.As<Napi::Array>();
        if (a.Length() != 3) {
            throw Napi::TypeError::New(env,
                std::string("forge.part: ") + what + " must have 3 elements");
        }
        return {a.Get(uint32_t{0}).As<Napi::Number>().DoubleValue(),
                a.Get(uint32_t{1}).As<Napi::Number>().DoubleValue(),
                a.Get(uint32_t{2}).As<Napi::Number>().DoubleValue()};
    }
    throw Napi::TypeError::New(env,
        std::string("forge.part: ") + what + " must be Float64Array[3] or Array[3]");
}

std::vector<std::uint32_t> readU32Array(const Napi::CallbackInfo& info, std::size_t idx, const char* what) {
    auto env = info.Env();
    std::vector<std::uint32_t> out;
    if (info.Length() <= idx) return out;
    auto v = info[idx];
    if (v.IsNull() || v.IsUndefined()) return out;
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env,
            std::string("forge.part: ") + what + " must be an array of numbers");
    }
    auto a = v.As<Napi::Array>();
    out.reserve(a.Length());
    for (uint32_t i = 0; i < a.Length(); ++i) {
        out.push_back(a.Get(i).As<Napi::Number>().Uint32Value());
    }
    return out;
}

} // namespace part_bind

// ----------------------------------------------------------- sheet metal (Forge-24)
//
// JS surface — under `forge.sheetMetal`:
//   baseFlange(wireHandle, params)                 → handle
//   edgeFlange(handle, edgeId, params, len, ang, mode) → handle
//   miterFlange(handle, edgeIds[], params, len, ang)   → handle
//   hem(handle, edgeId, params, hemType, length)       → handle
//   sketchedBend(handle, lineHandle, params, ang, r)   → handle
//   jog(handle, edgeId, params, height, ang)           → handle
//   closedCorner(handle, vertexId, params, gap)        → handle
//   cornerRelief(handle, vertexId, params, mode, sz)   → handle
//   unfold(handle, params)                             → handle
//   flatPattern(handle, params)
//      → { wire, bbox: [minX,minY,maxX,maxY], formedHeight }
//   bends(handle) → [{ angleRad, radius, length, devLength, x0,y0,x1,y1 }, ...]
namespace sheet_bind {

forge::sheet::SheetMetalParams readParams(const Napi::Env& env, const Napi::Value& v) {
    forge::sheet::SheetMetalParams p{};
    if (!v.IsObject()) {
        throw Napi::TypeError::New(env, "forge.sheetMetal: params must be an object");
    }
    auto obj = v.As<Napi::Object>();
    auto numOr = [&](const char* k, double def) {
        if (!obj.Has(k) || !obj.Get(k).IsNumber()) return def;
        return obj.Get(k).As<Napi::Number>().DoubleValue();
    };
    p.thickness     = numOr("thickness", 1.0);
    p.kFactor       = numOr("kFactor",   0.44);
    p.minBendRadius = numOr("minBendRadius", 0.5);
    return p;
}

std::vector<std::uint32_t> readU32Array(const Napi::Env& env, const Napi::Value& v) {
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.sheetMetal: expected uint32 array");
    }
    std::vector<std::uint32_t> out;
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (std::uint32_t i = 0; i < arr.Length(); ++i) {
        out.push_back(arr.Get(i).As<Napi::Number>().Uint32Value());
    }
    return out;
}

}  // namespace part_bind

Napi::Value PartExtrudeProfile(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sk = requireHandle(info, 0);
        double dist = requireNumber(info, 1, "distance");
        auto d = part_bind::readVec3(info, 2, "direction");
        return Napi::Number::New(info.Env(),
            forge::part::extrudeProfile(sk, dist, d[0], d[1], d[2]));
    });
}

Napi::Value PartExtrudeProfileOnPlane(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sk = requireHandle(info, 0);
        double dist = requireNumber(info, 1, "distance");
        auto o = part_bind::readVec3(info, 2, "origin");
        auto n = part_bind::readVec3(info, 3, "normal");
        auto u = part_bind::readVec3(info, 4, "uDir");
        double sign = info.Length() > 5 && info[5].IsNumber()
                          ? info[5].As<Napi::Number>().DoubleValue() : 1.0;
        return Napi::Number::New(info.Env(),
            forge::part::extrudeProfileOnPlane(sk, dist,
                o[0], o[1], o[2], n[0], n[1], n[2], u[0], u[1], u[2], sign));
    });
}

Napi::Value PartRevolveProfile(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sk = requireHandle(info, 0);
        auto o = part_bind::readVec3(info, 1, "axisOrigin");
        auto d = part_bind::readVec3(info, 2, "axisDir");
        double ang = requireNumber(info, 3, "angleRad");
        return Napi::Number::New(info.Env(),
            forge::part::revolveProfile(sk, o[0], o[1], o[2], d[0], d[1], d[2], ang));
    });
}

Napi::Value PartSweep(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto prof = requireHandle(info, 0);
        auto path = requireHandle(info, 1);
        bool wg = info.Length() > 2 && info[2].IsBoolean()
                      ? info[2].As<Napi::Boolean>().Value() : false;
        return Napi::Number::New(info.Env(), forge::part::sweep(prof, path, wg));
    });
}

Napi::Value PartLoft(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (info.Length() < 1 || !info[0].IsArray()) {
            throw Napi::TypeError::New(env, "forge.part.loft: sections must be array of handles");
        }
        std::vector<forge::SketchHandle> sections;
        auto a = info[0].As<Napi::Array>();
        for (uint32_t i = 0; i < a.Length(); ++i) {
            sections.push_back(a.Get(i).As<Napi::Number>().Uint32Value());
        }
        std::vector<forge::SketchHandle> guides;
        if (info.Length() > 1 && info[1].IsArray()) {
            auto g = info[1].As<Napi::Array>();
            for (uint32_t i = 0; i < g.Length(); ++i) {
                guides.push_back(g.Get(i).As<Napi::Number>().Uint32Value());
            }
        }
        bool ruled  = info.Length() > 2 && info[2].IsBoolean() ? info[2].As<Napi::Boolean>().Value() : false;
        bool closed = info.Length() > 3 && info[3].IsBoolean() ? info[3].As<Napi::Boolean>().Value() : false;
        return Napi::Number::New(env, forge::part::loft(sections, guides, ruled, closed));
    });
}

Napi::Value PartShell(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        auto faces = part_bind::readU32Array(info, 1, "faceIdsToRemove");
        double t = requireNumber(info, 2, "thickness");
        std::vector<forge::part::FaceThickness> mt;
        if (info.Length() > 3 && info[3].IsArray()) {
            auto a = info[3].As<Napi::Array>();
            mt.reserve(a.Length());
            for (uint32_t i = 0; i < a.Length(); ++i) {
                auto o = a.Get(i).As<Napi::Object>();
                forge::part::FaceThickness ft{};
                ft.faceId    = o.Get("faceId").As<Napi::Number>().Uint32Value();
                ft.thickness = o.Get("thickness").As<Napi::Number>().DoubleValue();
                mt.push_back(ft);
            }
        }
        return Napi::Number::New(info.Env(), forge::part::shell(h, faces, t, mt));
    });
}

Napi::Value PartThickenSurface(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        double t = requireNumber(info, 1, "thickness");
        int side = 0;
        if (info.Length() > 2 && info[2].IsNumber()) {
            side = info[2].As<Napi::Number>().Int32Value();
        }
        return Napi::Number::New(info.Env(),
                                 forge::part::thickenSurface(h, t, side));
    });
}

Napi::Value PartPipeFromPolyline(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        // points: flat [x,y,z,…] array (Array or Float64Array); radius: number
        std::vector<double> pts;
        if (info[0].IsTypedArray()) {
            auto ta = info[0].As<Napi::Float64Array>();
            pts.assign(ta.Data(), ta.Data() + ta.ElementLength());
        } else if (info[0].IsArray()) {
            auto a = info[0].As<Napi::Array>();
            pts.reserve(a.Length());
            for (uint32_t i = 0; i < a.Length(); ++i)
                pts.push_back(a.Get(i).As<Napi::Number>().DoubleValue());
        } else {
            throw Napi::TypeError::New(env,
                "forge.part.pipeFromPolyline: points must be an Array or Float64Array");
        }
        double radius = requireNumber(info, 1, "radius");
        return Napi::Number::New(env, forge::part::pipeFromPolyline(pts, radius));
    });
}

namespace {
// Read a flat numeric array (Array or Float64Array) into std::vector<double>.
std::vector<double> readFlatDoubles(const Napi::CallbackInfo& info, int idx,
                                    const char* what) {
    auto env = info.Env();
    std::vector<double> out;
    if (info.Length() <= static_cast<size_t>(idx)) {
        throw Napi::TypeError::New(env, std::string("forge.part: ") + what + " missing");
    }
    const Napi::Value v = info[idx];
    if (v.IsTypedArray()) {
        auto ta = v.As<Napi::Float64Array>();
        out.assign(ta.Data(), ta.Data() + ta.ElementLength());
    } else if (v.IsArray()) {
        auto a = v.As<Napi::Array>();
        out.reserve(a.Length());
        for (uint32_t i = 0; i < a.Length(); ++i)
            out.push_back(a.Get(i).As<Napi::Number>().DoubleValue());
    } else {
        throw Napi::TypeError::New(env,
            std::string("forge.part: ") + what + " must be an Array or Float64Array");
    }
    return out;
}
} // namespace

Napi::Value PartProfileWire(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto pts = readFlatDoubles(info, 0, "profileWire points");
        bool closed = info.Length() > 1 && info[1].IsBoolean()
                          ? info[1].As<Napi::Boolean>().Value() : true;
        return Napi::Number::New(info.Env(), forge::part::profileWire(pts, closed));
    });
}

Napi::Value PartSweepPolyline(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto prof = readFlatDoubles(info, 0, "sweepPolyline profileXY");
        auto path = readFlatDoubles(info, 1, "sweepPolyline path");
        return Napi::Number::New(info.Env(), forge::part::sweepPolyline(prof, path));
    });
}

Napi::Value PartFilletEdges(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        auto edges = part_bind::readU32Array(info, 1, "edgeIds");
        double r = requireNumber(info, 2, "radius");
        return Napi::Number::New(info.Env(), forge::part::filletEdges(h, edges, r));
    });
}

Napi::Value PartVariableFillet(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto h = requireHandle(info, 0);
        auto e = requireHandle(info, 1);
        if (info.Length() < 3 || !info[2].IsArray()) {
            throw Napi::TypeError::New(env,
                "forge.part.variableFilletEdge: anchorRadii must be array of {u,r}");
        }
        auto a = info[2].As<Napi::Array>();
        std::vector<forge::part::VariableRadiusAnchor> anchors;
        anchors.reserve(a.Length());
        for (uint32_t i = 0; i < a.Length(); ++i) {
            auto o = a.Get(i).As<Napi::Object>();
            forge::part::VariableRadiusAnchor ar{};
            ar.u = o.Get("u").As<Napi::Number>().DoubleValue();
            ar.r = o.Get("r").As<Napi::Number>().DoubleValue();
            anchors.push_back(ar);
        }
        return Napi::Number::New(env, forge::part::variableFilletEdge(h, e, anchors));
    });
}

Napi::Value PartChamferEdges(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        auto edges = part_bind::readU32Array(info, 1, "edgeIds");
        double d = requireNumber(info, 2, "distance");
        double d2 = info.Length() > 3 && info[3].IsNumber()
                       ? info[3].As<Napi::Number>().DoubleValue() : -1.0;
        return Napi::Number::New(info.Env(), forge::part::chamferEdges(h, edges, d, d2));
    });
}

Napi::Value PartDraftFaces(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto h = requireHandle(info, 0);
        if (info.Length() < 2 || !info[1].IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.part.draftFaces: neutralPlane must be {origin, normal}");
        }
        auto pl = info[1].As<Napi::Object>();
        forge::part::DraftPlane plane{};
        auto o = pl.Get("origin");
        auto n = pl.Get("normal");
        auto rdV = [&](Napi::Value v, double* out) {
            if (v.IsTypedArray()) {
                auto a = v.As<Napi::Float64Array>();
                if (a.ElementLength() != 3) {
                    throw Napi::TypeError::New(env, "forge.part.draftFaces: vec3 expected");
                }
                out[0] = a.Data()[0]; out[1] = a.Data()[1]; out[2] = a.Data()[2];
            } else if (v.IsArray()) {
                auto a = v.As<Napi::Array>();
                if (a.Length() != 3) {
                    throw Napi::TypeError::New(env, "forge.part.draftFaces: vec3 expected");
                }
                out[0] = a.Get(uint32_t{0}).As<Napi::Number>().DoubleValue();
                out[1] = a.Get(uint32_t{1}).As<Napi::Number>().DoubleValue();
                out[2] = a.Get(uint32_t{2}).As<Napi::Number>().DoubleValue();
            } else {
                throw Napi::TypeError::New(env, "forge.part.draftFaces: vec3 expected");
            }
        };
        double oo[3], nn[3];
        rdV(o, oo); rdV(n, nn);
        plane.ox = oo[0]; plane.oy = oo[1]; plane.oz = oo[2];
        plane.nx = nn[0]; plane.ny = nn[1]; plane.nz = nn[2];
        auto faces = part_bind::readU32Array(info, 2, "faceIds");
        double ang = requireNumber(info, 3, "angleRad");
        return Napi::Number::New(env, forge::part::draftFaces(h, plane, faces, ang));
    });
}

Napi::Value PartHoleWizard(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto h = requireHandle(info, 0);
        auto p = part_bind::readVec3(info, 1, "position");
        auto a = part_bind::readVec3(info, 2, "axis");
        if (info.Length() < 4 || !info[3].IsString()) {
            throw Napi::TypeError::New(env,
                "forge.part.holeWizard: type must be 'simple'|'counterbore'|'countersink'|'tapped'");
        }
        std::string t = info[3].As<Napi::String>().Utf8Value();
        std::uint32_t kind = 0;
        if      (t == "simple")      kind = 0;
        else if (t == "counterbore") kind = 1;
        else if (t == "countersink") kind = 2;
        else if (t == "tapped")      kind = 3;
        else throw Napi::TypeError::New(env, "forge.part.holeWizard: unknown type '" + t + "'");
        forge::part::HoleSpec spec{};
        if (info.Length() > 4 && info[4].IsObject()) {
            auto so = info[4].As<Napi::Object>();
            auto rd = [&](const char* k, double& dst) {
                if (so.Has(k) && so.Get(k).IsNumber()) {
                    dst = so.Get(k).As<Napi::Number>().DoubleValue();
                }
            };
            rd("diameter",     spec.diameter);
            rd("depth",        spec.depth);
            rd("headDiameter", spec.headDiameter);
            rd("headDepth",    spec.headDepth);
            rd("headAngle",    spec.headAngle);
            rd("tappedPitch",  spec.tappedPitch);
        }
        return Napi::Number::New(env,
            forge::part::holeWizard(h, p[0], p[1], p[2], a[0], a[1], a[2], kind, spec));
    });
}

Napi::Value PartRib(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sk = requireHandle(info, 0);
        double depth = requireNumber(info, 1, "depth");
        double thk   = requireNumber(info, 2, "thickness");
        std::uint32_t neutral = info.Length() > 3 && info[3].IsNumber()
                                    ? info[3].As<Napi::Number>().Uint32Value() : 0u;
        return Napi::Number::New(info.Env(), forge::part::rib(sk, depth, thk, neutral));
    });
}

Napi::Value PartLinearPattern(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        auto n = requireHandle(info, 1);
        double dx = requireNumber(info, 2, "dx");
        double dy = requireNumber(info, 3, "dy");
        double dz = requireNumber(info, 4, "dz");
        return Napi::Number::New(info.Env(), forge::part::linearPattern(h, n, dx, dy, dz));
    });
}

Napi::Value PartCircularPattern(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        auto n = requireHandle(info, 1);
        auto o = part_bind::readVec3(info, 2, "axisOrigin");
        auto d = part_bind::readVec3(info, 3, "axisDir");
        double ang = requireNumber(info, 4, "totalAngleRad");
        return Napi::Number::New(info.Env(),
            forge::part::circularPattern(h, n, o[0], o[1], o[2], d[0], d[1], d[2], ang));
    });
}

Napi::Value PartMirrorPattern(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto h = requireHandle(info, 0);
        if (info.Length() < 2 || !info[1].IsObject()) {
            throw Napi::TypeError::New(env,
                "forge.part.mirrorPattern: plane must be {origin, normal}");
        }
        auto pl = info[1].As<Napi::Object>();
        auto rdV = [&](Napi::Value v, double* out) {
            if (v.IsTypedArray()) {
                auto a = v.As<Napi::Float64Array>();
                out[0] = a.Data()[0]; out[1] = a.Data()[1]; out[2] = a.Data()[2];
            } else if (v.IsArray()) {
                auto a = v.As<Napi::Array>();
                out[0] = a.Get(uint32_t{0}).As<Napi::Number>().DoubleValue();
                out[1] = a.Get(uint32_t{1}).As<Napi::Number>().DoubleValue();
                out[2] = a.Get(uint32_t{2}).As<Napi::Number>().DoubleValue();
            } else {
                throw Napi::TypeError::New(env, "forge.part.mirrorPattern: vec3 expected");
            }
        };
        double oo[3], nn[3];
        rdV(pl.Get("origin"), oo);
        rdV(pl.Get("normal"), nn);
        return Napi::Number::New(env,
            forge::part::mirrorPattern(h, oo[0], oo[1], oo[2], nn[0], nn[1], nn[2]));
    });
}

Napi::Value PartOnCurvePattern(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        auto sk = requireHandle(info, 1);
        auto n = requireHandle(info, 2);
        return Napi::Number::New(info.Env(), forge::part::onCurvePattern(h, sk, n));
    });
}

Napi::Value SmMakeWireRect(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        double w = requireNumber(info, 0, "w");
        double h = requireNumber(info, 1, "h");
        return Napi::Number::New(info.Env(), forge::sheet::makeWireRect(w, h));
    });
}
Napi::Value SmMakeLineEdge(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        double x0 = requireNumber(info, 0, "x0");
        double y0 = requireNumber(info, 1, "y0");
        double z0 = requireNumber(info, 2, "z0");
        double x1 = requireNumber(info, 3, "x1");
        double y1 = requireNumber(info, 4, "y1");
        double z1 = requireNumber(info, 5, "z1");
        return Napi::Number::New(info.Env(),
            forge::sheet::makeLineEdge(x0, y0, z0, x1, y1, z1));
    });
}
Napi::Value SmBaseFlange(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto wire = requireHandle(info, 0);
        auto params = sheet_bind::readParams(info.Env(), info[1]);
        return Napi::Number::New(info.Env(), forge::sheet::baseFlange(wire, params));
    });
}
Napi::Value SmEdgeFlange(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh = requireHandle(info, 0);
        auto eid = requireHandle(info, 1);
        auto params = sheet_bind::readParams(info.Env(), info[2]);
        double len = requireNumber(info, 3, "flangeLengthMm");
        double ang = requireNumber(info, 4, "angleRad");
        forge::sheet::ReliefMode mode = forge::sheet::ReliefMode::Rect;
        if (info.Length() > 5 && info[5].IsString()) {
            std::string s = info[5].As<Napi::String>();
            if      (s == "rect")    mode = forge::sheet::ReliefMode::Rect;
            else if (s == "obround") mode = forge::sheet::ReliefMode::Obround;
            else if (s == "tear")    mode = forge::sheet::ReliefMode::Tear;
        }
        return Napi::Number::New(info.Env(),
            forge::sheet::edgeFlange(sh, eid, params, len, ang, mode));
    });
}
Napi::Value SmMiterFlange(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh  = requireHandle(info, 0);
        auto ids = sheet_bind::readU32Array(info.Env(), info[1]);
        auto params = sheet_bind::readParams(info.Env(), info[2]);
        double len = requireNumber(info, 3, "flangeLengthMm");
        double ang = requireNumber(info, 4, "angleRad");
        return Napi::Number::New(info.Env(),
            forge::sheet::miterFlange(sh, ids, params, len, ang));
    });
}
Napi::Value SmHem(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh  = requireHandle(info, 0);
        auto eid = requireHandle(info, 1);
        auto params = sheet_bind::readParams(info.Env(), info[2]);
        forge::sheet::HemType ht = forge::sheet::HemType::Closed;
        if (info[3].IsString()) {
            std::string s = info[3].As<Napi::String>();
            if      (s == "closed")    ht = forge::sheet::HemType::Closed;
            else if (s == "open")      ht = forge::sheet::HemType::Open;
            else if (s == "tear-drop") ht = forge::sheet::HemType::TearDrop;
            else if (s == "rolled")    ht = forge::sheet::HemType::Rolled;
        }
        double len = requireNumber(info, 4, "length");
        return Napi::Number::New(info.Env(),
            forge::sheet::hem(sh, eid, params, ht, len));
    });
}
Napi::Value SmSketchedBend(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh   = requireHandle(info, 0);
        auto line = requireHandle(info, 1);
        auto params = sheet_bind::readParams(info.Env(), info[2]);
        double ang = requireNumber(info, 3, "bendAngleRad");
        double r   = requireNumber(info, 4, "bendRadius");
        return Napi::Number::New(info.Env(),
            forge::sheet::sketchedBend(sh, line, params, ang, r));
    });
}
Napi::Value SmJog(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh  = requireHandle(info, 0);
        auto eid = requireHandle(info, 1);
        auto params = sheet_bind::readParams(info.Env(), info[2]);
        double height = requireNumber(info, 3, "jogHeight");
        double ang    = requireNumber(info, 4, "angleRad");
        return Napi::Number::New(info.Env(),
            forge::sheet::jog(sh, eid, params, height, ang));
    });
}
Napi::Value SmClosedCorner(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh  = requireHandle(info, 0);
        auto vid = requireHandle(info, 1);
        auto params = sheet_bind::readParams(info.Env(), info[2]);
        double gap = requireNumber(info, 3, "gapMm");
        return Napi::Number::New(info.Env(),
            forge::sheet::closedCorner(sh, vid, params, gap));
    });
}
Napi::Value SmCornerRelief(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh  = requireHandle(info, 0);
        auto vid = requireHandle(info, 1);
        auto params = sheet_bind::readParams(info.Env(), info[2]);
        forge::sheet::CornerRelief mode = forge::sheet::CornerRelief::Circular;
        if (info[3].IsString()) {
            std::string s = info[3].As<Napi::String>();
            if      (s == "circular")    mode = forge::sheet::CornerRelief::Circular;
            else if (s == "oval")        mode = forge::sheet::CornerRelief::Oval;
            else if (s == "rectangular") mode = forge::sheet::CornerRelief::Rectangular;
        }
        double sz = requireNumber(info, 4, "sizeMm");
        return Napi::Number::New(info.Env(),
            forge::sheet::cornerRelief(sh, vid, params, mode, sz));
    });
}
Napi::Value SmUnfold(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh = requireHandle(info, 0);
        auto params = sheet_bind::readParams(info.Env(), info[1]);
        return Napi::Number::New(info.Env(), forge::sheet::unfold(sh, params));
    });
}
Napi::Value SmFlatPattern(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh = requireHandle(info, 0);
        auto params = sheet_bind::readParams(info.Env(), info[1]);
        auto fp = forge::sheet::flatPattern(sh, params);
        auto env = info.Env();
        auto out = Napi::Object::New(env);
        out.Set("wire", Napi::Number::New(env, fp.wire));
        auto bbox = Napi::Array::New(env, 4);
        bbox.Set(uint32_t{0}, fp.minX);
        bbox.Set(uint32_t{1}, fp.minY);
        bbox.Set(uint32_t{2}, fp.maxX);
        bbox.Set(uint32_t{3}, fp.maxY);
        out.Set("bbox", bbox);
        out.Set("formedHeight", Napi::Number::New(env, fp.formedHeight));
        return out;
    });
}
Napi::Value SmBends(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh = requireHandle(info, 0);
        auto env = info.Env();
        if (!forge::sheet::SheetMetalRegistry::instance().has(sh)) {
            return Napi::Array::New(env, 0);
        }
        const auto& p = forge::sheet::SheetMetalRegistry::instance().cget(sh);
        auto arr = Napi::Array::New(env, p.bends.size());
        for (std::size_t i = 0; i < p.bends.size(); ++i) {
            const auto& b = p.bends[i];
            auto o = Napi::Object::New(env);
            o.Set("angleRad",  Napi::Number::New(env, b.angleRad));
            o.Set("radius",    Napi::Number::New(env, b.radius));
            o.Set("length",    Napi::Number::New(env, b.length));
            o.Set("devLength", Napi::Number::New(env, b.devLength));
            o.Set("x0", Napi::Number::New(env, b.x0));
            o.Set("y0", Napi::Number::New(env, b.y0));
            o.Set("x1", Napi::Number::New(env, b.x1));
            o.Set("y1", Napi::Number::New(env, b.y1));
            arr.Set(static_cast<std::uint32_t>(i), o);
        }
        return arr;
    });
}

// ----------------------------------------------------------- weldments (Forge-24)
namespace weld_bind {

forge::weld::ProfileKind parseProfileKind(const Napi::Env& env, const std::string& s) {
    if (s == "IBeam")     return forge::weld::ProfileKind::IBeam;
    if (s == "CBeam")     return forge::weld::ProfileKind::CBeam;
    if (s == "RectTube")  return forge::weld::ProfileKind::RectTube;
    if (s == "RoundTube") return forge::weld::ProfileKind::RoundTube;
    if (s == "Angle")     return forge::weld::ProfileKind::Angle;
    if (s == "Channel")   return forge::weld::ProfileKind::Channel;
    if (s == "FlatBar")   return forge::weld::ProfileKind::FlatBar;
    throw Napi::TypeError::New(env, "forge.weldments: unknown profile kind '" + s + "'");
}

forge::weld::Alignment parseAlignment(const std::string& s) {
    if (s == "centroid")     return forge::weld::Alignment::Centroid;
    if (s == "top-left")     return forge::weld::Alignment::TopLeft;
    if (s == "top-right")    return forge::weld::Alignment::TopRight;
    if (s == "bottom-left")  return forge::weld::Alignment::BottomLeft;
    if (s == "bottom-right") return forge::weld::Alignment::BottomRight;
    if (s == "mid-left")     return forge::weld::Alignment::MidLeft;
    if (s == "mid-right")    return forge::weld::Alignment::MidRight;
    if (s == "top-center")   return forge::weld::Alignment::TopCenter;
    if (s == "bottom-center")return forge::weld::Alignment::BottomCenter;
    return forge::weld::Alignment::Centroid;
}

forge::weld::StructuralProfile readProfile(const Napi::Env& env, const Napi::Value& v) {
    if (!v.IsObject()) {
        throw Napi::TypeError::New(env, "forge.weldments: profile must be an object");
    }
    auto obj = v.As<Napi::Object>();
    forge::weld::StructuralProfile p{};
    if (obj.Has("kind")) {
        auto kv = obj.Get("kind");
        if (kv.IsString()) p.kind = parseProfileKind(env, kv.As<Napi::String>());
        else if (kv.IsNumber()) p.kind = static_cast<forge::weld::ProfileKind>(kv.As<Napi::Number>().Uint32Value());
    }
    if (obj.Has("name") && obj.Get("name").IsString()) {
        p.name = obj.Get("name").As<Napi::String>().Utf8Value();
    }
    if (obj.Has("dims") && obj.Get("dims").IsObject()) {
        auto d = obj.Get("dims").As<Napi::Object>();
        auto keys = d.GetPropertyNames();
        for (std::uint32_t i = 0; i < keys.Length(); ++i) {
            std::string k = keys.Get(i).As<Napi::String>().Utf8Value();
            p.dims[k] = d.Get(k).As<Napi::Number>().DoubleValue();
        }
    }
    return p;
}

forge::weld::TrimMode parseTrimMode(const std::string& s) {
    if (s == "butt")  return forge::weld::TrimMode::Butt;
    if (s == "miter") return forge::weld::TrimMode::Miter;
    if (s == "coped") return forge::weld::TrimMode::Coped;
    return forge::weld::TrimMode::Butt;
}

forge::weld::BeadKind parseBeadKind(const std::string& s) {
    if (s == "fillet")        return forge::weld::BeadKind::Fillet;
    if (s == "square-groove") return forge::weld::BeadKind::SquareGroove;
    if (s == "V-groove")      return forge::weld::BeadKind::VGroove;
    return forge::weld::BeadKind::Fillet;
}

std::vector<std::uint32_t> readU32Array(const Napi::Env& env, const Napi::Value& v) {
    if (!v.IsArray()) {
        throw Napi::TypeError::New(env, "forge.weldments: expected uint32 array");
    }
    std::vector<std::uint32_t> out;
    auto arr = v.As<Napi::Array>();
    out.reserve(arr.Length());
    for (std::uint32_t i = 0; i < arr.Length(); ++i) {
        out.push_back(arr.Get(i).As<Napi::Number>().Uint32Value());
    }
    return out;
}

} // namespace weld_bind

Napi::Value WdMakePathEdge(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        double x0 = requireNumber(info, 0, "x0");
        double y0 = requireNumber(info, 1, "y0");
        double z0 = requireNumber(info, 2, "z0");
        double x1 = requireNumber(info, 3, "x1");
        double y1 = requireNumber(info, 4, "y1");
        double z1 = requireNumber(info, 5, "z1");
        return Napi::Number::New(info.Env(),
            forge::weld::makePathEdge(x0, y0, z0, x1, y1, z1));
    });
}
Napi::Value WdStructuralMember(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto path = requireHandle(info, 0);
        auto profile = weld_bind::readProfile(info.Env(), info[1]);
        forge::weld::Alignment align = forge::weld::Alignment::Centroid;
        if (info.Length() > 2 && info[2].IsString()) {
            align = weld_bind::parseAlignment(info[2].As<Napi::String>().Utf8Value());
        }
        return Napi::Number::New(info.Env(),
            forge::weld::structuralMember(path, profile, align));
    });
}
Napi::Value WdEndCap(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh  = requireHandle(info, 0);
        auto eid = requireHandle(info, 1);
        double thk = requireNumber(info, 2, "capThickness");
        double off = info.Length() > 3 && info[3].IsNumber()
                       ? info[3].As<Napi::Number>().DoubleValue() : 0.0;
        return Napi::Number::New(info.Env(),
            forge::weld::endCap(sh, eid, thk, off));
    });
}
Napi::Value WdGusset(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh  = requireHandle(info, 0);
        auto vid = requireHandle(info, 1);
        double sz = requireNumber(info, 2, "gussetSize");
        double th = requireNumber(info, 3, "thickness");
        return Napi::Number::New(info.Env(),
            forge::weld::gusset(sh, vid, sz, th));
    });
}
Napi::Value WdWeldBead(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto sh  = requireHandle(info, 0);
        auto ids = weld_bind::readU32Array(info.Env(), info[1]);
        double size = requireNumber(info, 2, "beadSize");
        forge::weld::BeadKind kind = forge::weld::BeadKind::Fillet;
        if (info.Length() > 3 && info[3].IsString()) {
            kind = weld_bind::parseBeadKind(info[3].As<Napi::String>().Utf8Value());
        }
        return Napi::Number::New(info.Env(),
            forge::weld::weldBead(sh, ids, size, kind));
    });
}
Napi::Value WdTrimMember(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto a = requireHandle(info, 0);
        auto b = requireHandle(info, 1);
        forge::weld::TrimMode mode = forge::weld::TrimMode::Butt;
        if (info.Length() > 2 && info[2].IsString()) {
            mode = weld_bind::parseTrimMode(info[2].As<Napi::String>().Utf8Value());
        }
        return Napi::Number::New(info.Env(),
            forge::weld::trimMember(a, b, mode));
    });
}
Napi::Value WdCutList(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (info.Length() < 1) {
            throw Napi::TypeError::New(env, "forge.weldments.cutList: expected handle or handle array");
        }
        std::vector<forge::weld::MemberRecord> records;
        if (info[0].IsArray()) {
            auto arr = info[0].As<Napi::Array>();
            for (std::uint32_t i = 0; i < arr.Length(); ++i) {
                auto h = arr.Get(i).As<Napi::Number>().Uint32Value();
                auto recs = forge::weld::cutList(h);
                records.insert(records.end(), recs.begin(), recs.end());
            }
        } else {
            auto h = info[0].As<Napi::Number>().Uint32Value();
            records = forge::weld::cutList(h);
        }
        auto out = Napi::Array::New(env, records.size());
        for (std::size_t i = 0; i < records.size(); ++i) {
            const auto& r = records[i];
            auto o = Napi::Object::New(env);
            o.Set("memberId",    Napi::Number::New(env, r.memberId));
            o.Set("profileName", Napi::String::New(env, r.profileName));
            o.Set("length",      Napi::Number::New(env, r.length));
            o.Set("qty",         Napi::Number::New(env, r.qty));
            o.Set("weight",      Napi::Number::New(env, r.weight));
            std::string trim = "butt";
            if (r.trim == forge::weld::TrimMode::Miter) trim = "miter";
            else if (r.trim == forge::weld::TrimMode::Coped) trim = "coped";
            o.Set("trim",     Napi::String::New(env, trim));
            o.Set("miterDeg", Napi::Number::New(env, r.miterDeg));
            out.Set(static_cast<std::uint32_t>(i), o);
        }
        return out;
    });
}

// ----------------------------------------------------------- part features (Forge-36 closures)
//
// sweepWithGuides / loftWithGuides / shellMultiThickness — the three
// closures for §1's "Sweep with guides", "Loft with guides", and
// "Shell (multi-thickness)" partial rows.
Napi::Value PartSweepWithGuides(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto prof = requireHandle(info, 0);
        auto path = requireHandle(info, 1);
        std::vector<forge::SketchHandle> guides;
        if (info.Length() > 2 && info[2].IsArray()) {
            auto a = info[2].As<Napi::Array>();
            for (uint32_t i = 0; i < a.Length(); ++i) {
                guides.push_back(a.Get(i).As<Napi::Number>().Uint32Value());
            }
        }
        return Napi::Number::New(env, forge::part::sweepWithGuides(prof, path, guides));
    });
}

Napi::Value PartLoftWithGuides(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (info.Length() < 1 || !info[0].IsArray()) {
            throw Napi::TypeError::New(env,
                "forge.part.loftWithGuides: sections must be array of handles");
        }
        std::vector<forge::SketchHandle> sections;
        auto a = info[0].As<Napi::Array>();
        for (uint32_t i = 0; i < a.Length(); ++i) {
            sections.push_back(a.Get(i).As<Napi::Number>().Uint32Value());
        }
        std::vector<forge::SketchHandle> guides;
        if (info.Length() > 1 && info[1].IsArray()) {
            auto g = info[1].As<Napi::Array>();
            for (uint32_t i = 0; i < g.Length(); ++i) {
                guides.push_back(g.Get(i).As<Napi::Number>().Uint32Value());
            }
        }
        bool ruled  = info.Length() > 2 && info[2].IsBoolean() ? info[2].As<Napi::Boolean>().Value() : false;
        bool closed = info.Length() > 3 && info[3].IsBoolean() ? info[3].As<Napi::Boolean>().Value() : false;
        return Napi::Number::New(env,
            forge::part::loftWithGuides(sections, guides, ruled, closed));
    });
}

Napi::Value PartShellMultiThickness(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto h = requireHandle(info, 0);
        auto faces = part_bind::readU32Array(info, 1, "faceIdsToRemove");
        double t = requireNumber(info, 2, "baseThickness");
        std::vector<forge::part::FaceThickness> overrides;
        if (info.Length() > 3 && info[3].IsArray()) {
            auto a = info[3].As<Napi::Array>();
            overrides.reserve(a.Length());
            for (uint32_t i = 0; i < a.Length(); ++i) {
                auto o = a.Get(i).As<Napi::Object>();
                forge::part::FaceThickness ft{};
                ft.faceId    = o.Get("faceId").As<Napi::Number>().Uint32Value();
                ft.thickness = o.Get("thickness").As<Napi::Number>().DoubleValue();
                overrides.push_back(ft);
            }
        }
        return Napi::Number::New(env,
            forge::part::shellMultiThickness(h, faces, t, overrides));
    });
}

// ----------------------------------------------------------- NURBS surfacing (Forge-36)
//
// JS surface — under `forge.surfacing`:
//   buildPatch({ uCount, vCount, xyz: Float64Array }, uDegree?, vDegree?, uKnots?, vKnots?) → handle
//   trim(face, uvFlatArray) → handle
//   sew([face, …], tolerance?) → handle
//   refine(face, uTimes, vTimes) → handle
//   eval(face, u, v) → { point, du, dv, normal, gaussian, mean }
//   intersect(faceA, faceB) → handle
//   projectPoint(face, [px, py, pz]) → { uv, point, distance }
//   classAAnalyse(face, samples?) → { minK, maxK, avgK, isophoteCount }
namespace surf_bind {

forge::surfacing::ControlGrid readControlGrid(const Napi::Env& env, const Napi::Value& v) {
    if (!v.IsObject()) {
        throw Napi::TypeError::New(env,
            "forge.surfacing: control grid must be { uCount, vCount, xyz }");
    }
    auto obj = v.As<Napi::Object>();
    forge::surfacing::ControlGrid g{};
    g.uCount = obj.Get("uCount").As<Napi::Number>().Uint32Value();
    g.vCount = obj.Get("vCount").As<Napi::Number>().Uint32Value();
    auto xyz = obj.Get("xyz");
    if (!xyz.IsTypedArray()) {
        throw Napi::TypeError::New(env,
            "forge.surfacing: control grid .xyz must be a Float64Array");
    }
    auto ta = xyz.As<Napi::Float64Array>();
    g.xyz.assign(ta.Data(), ta.Data() + ta.ElementLength());
    return g;
}

std::vector<double> readF64Array(const Napi::Env& env, const Napi::Value& v) {
    std::vector<double> out;
    if (v.IsUndefined() || v.IsNull()) return out;
    if (v.IsTypedArray()) {
        auto ta = v.As<Napi::Float64Array>();
        out.assign(ta.Data(), ta.Data() + ta.ElementLength());
        return out;
    }
    if (v.IsArray()) {
        auto a = v.As<Napi::Array>();
        out.reserve(a.Length());
        for (uint32_t i = 0; i < a.Length(); ++i) {
            out.push_back(a.Get(i).As<Napi::Number>().DoubleValue());
        }
        return out;
    }
    throw Napi::TypeError::New(env, "forge.surfacing: expected Float64Array or Array of numbers");
}

Napi::Array vec3ToArr(Napi::Env env, const std::array<double, 3>& v) {
    auto a = Napi::Array::New(env, 3);
    a.Set(uint32_t{0}, v[0]);
    a.Set(uint32_t{1}, v[1]);
    a.Set(uint32_t{2}, v[2]);
    return a;
}

} // namespace surf_bind

// ============================================================ Airfoil (Forge-171)
//
// JS surface — under `forge.airfoil`:
//   naca4(code, nPts)           → Profile { source, points: Float64Array[2N] }
//   naca5(code, nPts)           → Profile
//   parseSelig(text)            → Profile
//   resampleCosine(profile, nPts)→ Profile
//   profileToFace(profile, chordMm)             → ShapeHandle (uint32)
//   loftWing(stations, capTips) → ShapeHandle
//   trapezoidalWing(spec)       → ShapeHandle
//   planformMetrics(spec)       → { areaMm2, aspectRatio, meanAeroChordMm,
//                                    rootChordMm, tipChordMm, halfSpanMm }
//
// Profiles round-trip as { source: string, points: Float64Array }; points
// are interleaved x0,y0,x1,y1,…,xN,yN of length 2N — first and last entries
// repeat for closure.
namespace airfoil_bind {

inline forge::airfoil::Profile readProfile(Napi::Env env, Napi::Value v) {
    if (!v.IsObject()) {
        throw Napi::TypeError::New(env, "forge.airfoil: profile must be an object");
    }
    auto o = v.As<Napi::Object>();
    if (!o.Has("points") || !o.Get("points").IsTypedArray()) {
        throw Napi::TypeError::New(env, "forge.airfoil: profile.points must be a Float64Array");
    }
    auto arr = o.Get("points").As<Napi::Float64Array>();
    if (arr.ElementLength() % 2 != 0) {
        throw Napi::TypeError::New(env, "forge.airfoil: profile.points length must be even");
    }
    forge::airfoil::Profile p;
    const std::size_t n = arr.ElementLength() / 2;
    p.points.resize(n);
    for (std::size_t i = 0; i < n; ++i) {
        p.points[i].x = arr.Data()[2 * i + 0];
        p.points[i].y = arr.Data()[2 * i + 1];
    }
    if (o.Has("source") && o.Get("source").IsString()) {
        p.source = o.Get("source").As<Napi::String>().Utf8Value();
    }
    return p;
}

inline Napi::Object writeProfile(Napi::Env env, const forge::airfoil::Profile& p) {
    auto o = Napi::Object::New(env);
    auto arr = Napi::Float64Array::New(env, p.points.size() * 2);
    for (std::size_t i = 0; i < p.points.size(); ++i) {
        arr.Data()[2 * i + 0] = p.points[i].x;
        arr.Data()[2 * i + 1] = p.points[i].y;
    }
    o.Set("points", arr);
    o.Set("source", Napi::String::New(env, p.source));
    return o;
}

inline forge::airfoil::WingStation readStation(Napi::Env env, Napi::Value v) {
    if (!v.IsObject()) {
        throw Napi::TypeError::New(env, "forge.airfoil.loftWing: station must be object");
    }
    auto o = v.As<Napi::Object>();
    forge::airfoil::WingStation st;
    st.profile  = readProfile(env, o.Get("profile"));
    st.chordMm  = o.Get("chordMm" ).As<Napi::Number>().DoubleValue();
    st.yMm      = o.Get("yMm"     ).As<Napi::Number>().DoubleValue();
    st.twistDeg = o.Has("twistDeg") ? o.Get("twistDeg").As<Napi::Number>().DoubleValue() : 0.0;
    st.sweepMm  = o.Has("sweepMm" ) ? o.Get("sweepMm" ).As<Napi::Number>().DoubleValue() : 0.0;
    st.zMm      = o.Has("zMm"     ) ? o.Get("zMm"     ).As<Napi::Number>().DoubleValue() : 0.0;
    return st;
}

inline forge::airfoil::TrapezoidalWingSpec readTrapSpec(Napi::Env env, Napi::Value v) {
    if (!v.IsObject()) {
        throw Napi::TypeError::New(env, "forge.airfoil.trapezoidalWing: spec must be object");
    }
    auto o = v.As<Napi::Object>();
    forge::airfoil::TrapezoidalWingSpec s;
    s.rootProfile = readProfile(env, o.Get("rootProfile"));
    if (o.Has("tipProfile") && o.Get("tipProfile").IsObject()) {
        s.tipProfile = readProfile(env, o.Get("tipProfile"));
    }
    s.rootChordMm = o.Get("rootChordMm").As<Napi::Number>().DoubleValue();
    s.taperRatio  = o.Get("taperRatio" ).As<Napi::Number>().DoubleValue();
    s.halfSpanMm  = o.Get("halfSpanMm" ).As<Napi::Number>().DoubleValue();
    s.sweepDeg    = o.Has("sweepDeg"   ) ? o.Get("sweepDeg"   ).As<Napi::Number>().DoubleValue() : 0.0;
    s.dihedralDeg = o.Has("dihedralDeg") ? o.Get("dihedralDeg").As<Napi::Number>().DoubleValue() : 0.0;
    s.twistDeg    = o.Has("twistDeg"   ) ? o.Get("twistDeg"   ).As<Napi::Number>().DoubleValue() : 0.0;
    s.spanStations= o.Has("spanStations") ? o.Get("spanStations").As<Napi::Number>().Int32Value() : 2;
    return s;
}

} // namespace airfoil_bind

Napi::Value AirfoilNaca4(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (info.Length() < 1 || !info[0].IsString()) {
            throw Napi::TypeError::New(env, "forge.airfoil.naca4: code must be string");
        }
        auto code = info[0].As<Napi::String>().Utf8Value();
        std::size_t n = (info.Length() > 1 && info[1].IsNumber())
            ? info[1].As<Napi::Number>().Uint32Value() : 160;
        return airfoil_bind::writeProfile(env, forge::airfoil::naca4(code, n));
    });
}

Napi::Value AirfoilNaca5(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (info.Length() < 1 || !info[0].IsString()) {
            throw Napi::TypeError::New(env, "forge.airfoil.naca5: code must be string");
        }
        auto code = info[0].As<Napi::String>().Utf8Value();
        std::size_t n = (info.Length() > 1 && info[1].IsNumber())
            ? info[1].As<Napi::Number>().Uint32Value() : 160;
        return airfoil_bind::writeProfile(env, forge::airfoil::naca5(code, n));
    });
}

Napi::Value AirfoilParseSelig(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (info.Length() < 1 || !info[0].IsString()) {
            throw Napi::TypeError::New(env, "forge.airfoil.parseSelig: text must be string");
        }
        auto text = info[0].As<Napi::String>().Utf8Value();
        return airfoil_bind::writeProfile(env, forge::airfoil::parseSelig(text));
    });
}

Napi::Value AirfoilResample(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto p = airfoil_bind::readProfile(env, info[0]);
        std::size_t n = (info.Length() > 1 && info[1].IsNumber())
            ? info[1].As<Napi::Number>().Uint32Value() : 160;
        return airfoil_bind::writeProfile(env, forge::airfoil::resampleCosine(p, n));
    });
}

Napi::Value AirfoilProfileToFace(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto p = airfoil_bind::readProfile(env, info[0]);
        double chord = requireNumber(info, 1, "chordMm");
        return Napi::Number::New(env, forge::airfoil::profileToFace(p, chord));
    });
}

Napi::Value AirfoilLoftWing(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (!info[0].IsArray()) {
            throw Napi::TypeError::New(env, "forge.airfoil.loftWing: stations must be array");
        }
        auto arr = info[0].As<Napi::Array>();
        std::vector<forge::airfoil::WingStation> stations;
        stations.reserve(arr.Length());
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            stations.push_back(airfoil_bind::readStation(env, arr.Get(i)));
        }
        bool capTips = (info.Length() > 1 && info[1].IsBoolean())
            ? info[1].As<Napi::Boolean>().Value() : true;
        return Napi::Number::New(env, forge::airfoil::loftWing(stations, capTips));
    });
}

Napi::Value AirfoilTrapezoidalWing(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto spec = airfoil_bind::readTrapSpec(env, info[0]);
        return Napi::Number::New(env, forge::airfoil::trapezoidalWing(spec));
    });
}

Napi::Value AirfoilPlanformMetrics(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto spec = airfoil_bind::readTrapSpec(env, info[0]);
        auto m = forge::airfoil::planformMetrics(spec);
        auto o = Napi::Object::New(env);
        o.Set("areaMm2",          Napi::Number::New(env, m.areaMm2));
        o.Set("aspectRatio",      Napi::Number::New(env, m.aspectRatio));
        o.Set("meanAeroChordMm",  Napi::Number::New(env, m.meanAeroChordMm));
        o.Set("rootChordMm",      Napi::Number::New(env, m.rootChordMm));
        o.Set("tipChordMm",       Napi::Number::New(env, m.tipChordMm));
        o.Set("halfSpanMm",       Napi::Number::New(env, m.halfSpanMm));
        return o;
    });
}

Napi::Value SurfBuildPatch(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto grid = surf_bind::readControlGrid(env, info[0]);
        std::uint32_t uDeg = (info.Length() > 1 && info[1].IsNumber())
            ? info[1].As<Napi::Number>().Uint32Value() : 3;
        std::uint32_t vDeg = (info.Length() > 2 && info[2].IsNumber())
            ? info[2].As<Napi::Number>().Uint32Value() : 3;
        auto uKnots = surf_bind::readF64Array(env, info.Length() > 3 ? info[3] : env.Undefined());
        auto vKnots = surf_bind::readF64Array(env, info.Length() > 4 ? info[4] : env.Undefined());
        return Napi::Number::New(env,
            forge::surfacing::buildNurbsPatch(grid, uDeg, vDeg, uKnots, vKnots));
    });
}

Napi::Value SurfTrim(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto h = requireHandle(info, 0);
        auto uv = surf_bind::readF64Array(env, info[1]);
        return Napi::Number::New(env, forge::surfacing::trimNurbsFace(h, uv));
    });
}

Napi::Value SurfSew(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (!info[0].IsArray()) {
            throw Napi::TypeError::New(env, "forge.surfacing.sew: expected handle array");
        }
        auto a = info[0].As<Napi::Array>();
        std::vector<forge::ShapeHandle> handles;
        handles.reserve(a.Length());
        for (uint32_t i = 0; i < a.Length(); ++i) {
            handles.push_back(a.Get(i).As<Napi::Number>().Uint32Value());
        }
        double tol = (info.Length() > 1 && info[1].IsNumber())
            ? info[1].As<Napi::Number>().DoubleValue() : 1e-3;
        return Napi::Number::New(env, forge::surfacing::sewNurbsFaces(handles, tol));
    });
}

Napi::Value SurfRefine(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto h = requireHandle(info, 0);
        std::uint32_t uTimes = info.Length() > 1 && info[1].IsNumber()
            ? info[1].As<Napi::Number>().Uint32Value() : 0;
        std::uint32_t vTimes = info.Length() > 2 && info[2].IsNumber()
            ? info[2].As<Napi::Number>().Uint32Value() : 0;
        return Napi::Number::New(info.Env(), forge::surfacing::refineNurbs(h, uTimes, vTimes));
    });
}

Napi::Value SurfEval(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto h = requireHandle(info, 0);
        double u = requireNumber(info, 1, "u");
        double v = requireNumber(info, 2, "v");
        auto r = forge::surfacing::evalSurface(h, u, v);
        auto out = Napi::Object::New(env);
        out.Set("point",  surf_bind::vec3ToArr(env, r.point));
        out.Set("du",     surf_bind::vec3ToArr(env, r.du));
        out.Set("dv",     surf_bind::vec3ToArr(env, r.dv));
        out.Set("normal", surf_bind::vec3ToArr(env, r.normal));
        out.Set("gaussian", Napi::Number::New(env, r.gaussian));
        out.Set("mean",     Napi::Number::New(env, r.mean));
        return out;
    });
}

Napi::Value SurfIntersect(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto a = requireHandle(info, 0);
        auto b = requireHandle(info, 1);
        return Napi::Number::New(info.Env(), forge::surfacing::intersectSurfaces(a, b));
    });
}

Napi::Value SurfProjectPoint(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto h = requireHandle(info, 0);
        if (info.Length() < 2 || (!info[1].IsTypedArray() && !info[1].IsArray())) {
            throw Napi::TypeError::New(env,
                "forge.surfacing.projectPoint: pt must be [x,y,z]");
        }
        double px = 0.0, py = 0.0, pz = 0.0;
        if (info[1].IsTypedArray()) {
            auto ta = info[1].As<Napi::Float64Array>();
            if (ta.ElementLength() < 3) {
                throw Napi::TypeError::New(env,
                    "forge.surfacing.projectPoint: pt array must have 3 elements");
            }
            px = ta.Data()[0]; py = ta.Data()[1]; pz = ta.Data()[2];
        } else {
            auto a = info[1].As<Napi::Array>();
            if (a.Length() < 3) {
                throw Napi::TypeError::New(env,
                    "forge.surfacing.projectPoint: pt array must have 3 elements");
            }
            px = a.Get(uint32_t{0}).As<Napi::Number>().DoubleValue();
            py = a.Get(uint32_t{1}).As<Napi::Number>().DoubleValue();
            pz = a.Get(uint32_t{2}).As<Napi::Number>().DoubleValue();
        }
        auto r = forge::surfacing::projectPointToSurface(h, px, py, pz);
        auto out = Napi::Object::New(env);
        auto uv = Napi::Array::New(env, 2);
        uv.Set(uint32_t{0}, r.u);
        uv.Set(uint32_t{1}, r.v);
        out.Set("uv", uv);
        out.Set("point", surf_bind::vec3ToArr(env, r.point));
        out.Set("distance", Napi::Number::New(env, r.distance));
        return out;
    });
}

Napi::Value SurfClassA(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto h = requireHandle(info, 0);
        std::uint32_t samples = (info.Length() > 1 && info[1].IsNumber())
            ? info[1].As<Napi::Number>().Uint32Value() : 16;
        auto r = forge::surfacing::classAAnalyse(h, samples);
        auto out = Napi::Object::New(env);
        out.Set("minK",          Napi::Number::New(env, r.minK));
        out.Set("maxK",          Napi::Number::New(env, r.maxK));
        out.Set("avgK",          Napi::Number::New(env, r.avgK));
        out.Set("isophoteCount", Napi::Number::New(env, static_cast<double>(r.isophoteCount)));
        return out;
    });
}

// ----------------------------------------------------------- diagnostics
Napi::Value Version(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        auto out = Napi::Object::New(env);
        out.Set("forgeKernel", "0.1.0");
        out.Set("occt", OCC_VERSION_STRING_EXT);
        out.Set("napiCpp", NAPI_VERSION);
        return out;
    });
}

} // namespace

// ----------------------------------------------------------- EM (Elmer-track E1)
//
// JS surface — under `forge.em`:
//   magnetostatics(cfgObj)
//     cfg: { rMax, zMin, zMax, nr, nz, mu, coils:[{rLo,rHi,zLo,zHi,Jphi}, ...] }
//     → { nr, nz, nodeR, nodeZ, Aphi, elemR, elemZ, Br, Bz, Bmag, energy, residual }
Napi::Value EmMagnetostatics(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (!info[0].IsObject()) {
            throw Napi::TypeError::New(env, "forge.em.magnetostatics: cfg must be an object");
        }
        auto o = info[0].As<Napi::Object>();
        forge::em::MagnetostaticsConfig cfg;
        if (o.Has("rMax")) cfg.rMax = o.Get("rMax").As<Napi::Number>().DoubleValue();
        if (o.Has("zMin")) cfg.zMin = o.Get("zMin").As<Napi::Number>().DoubleValue();
        if (o.Has("zMax")) cfg.zMax = o.Get("zMax").As<Napi::Number>().DoubleValue();
        if (o.Has("nr"))   cfg.nr   = o.Get("nr").As<Napi::Number>().Int32Value();
        if (o.Has("nz"))   cfg.nz   = o.Get("nz").As<Napi::Number>().Int32Value();
        if (o.Has("mu"))   cfg.mu   = o.Get("mu").As<Napi::Number>().DoubleValue();
        if (o.Has("coils")) {
            if (!o.Get("coils").IsArray()) {
                throw Napi::TypeError::New(env, "forge.em.magnetostatics: coils must be an array");
            }
            auto arr = o.Get("coils").As<Napi::Array>();
            cfg.coils.reserve(arr.Length());
            for (uint32_t i = 0; i < arr.Length(); ++i) {
                auto co = arr.Get(i).As<Napi::Object>();
                forge::em::CoilRegion c{};
                c.rLo  = co.Get("rLo").As<Napi::Number>().DoubleValue();
                c.rHi  = co.Get("rHi").As<Napi::Number>().DoubleValue();
                c.zLo  = co.Get("zLo").As<Napi::Number>().DoubleValue();
                c.zHi  = co.Get("zHi").As<Napi::Number>().DoubleValue();
                c.Jphi = co.Get("Jphi").As<Napi::Number>().DoubleValue();
                cfg.coils.push_back(c);
            }
        }
        auto r = forge::em::magnetostatics(cfg);
        auto out = Napi::Object::New(env);
        out.Set("nr", Napi::Number::New(env, r.nr));
        out.Set("nz", Napi::Number::New(env, r.nz));
        auto setF64 = [&](const char* key, const std::vector<double>& v) {
            auto a = Napi::Float64Array::New(env, v.size());
            std::copy(v.begin(), v.end(), a.Data());
            out.Set(key, a);
        };
        setF64("nodeR", r.nodeR);
        setF64("nodeZ", r.nodeZ);
        setF64("Aphi",  r.Aphi);
        setF64("elemR", r.elemR);
        setF64("elemZ", r.elemZ);
        setF64("Br",    r.Br);
        setF64("Bz",    r.Bz);
        setF64("Bmag",  r.Bmag);
        out.Set("energy",   Napi::Number::New(env, r.energy));
        out.Set("residual", Napi::Number::New(env, r.residual));
        return out;
    });
}

// ----------------------------------------------------------- EM E2 electrostatics
//
//   electrostatics(cfgObj)
//     cfg: { geometry:'planar'|'cylindrical'|'spherical', eps, rInner, rOuter,
//            V, n, area, length }
//     → { n, nodeR, phi, elemR, Efield, energy, capacitance, residual }
Napi::Value EmElectrostatics(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (!info[0].IsObject()) {
            throw Napi::TypeError::New(env, "forge.em.electrostatics: cfg must be an object");
        }
        auto o = info[0].As<Napi::Object>();
        forge::em::ElectrostaticsConfig cfg;
        if (o.Has("geometry")) {
            std::string g = o.Get("geometry").As<Napi::String>().Utf8Value();
            if      (g == "planar")      cfg.geometry = forge::em::ElectroGeometry::Planar;
            else if (g == "cylindrical") cfg.geometry = forge::em::ElectroGeometry::Cylindrical;
            else if (g == "spherical")   cfg.geometry = forge::em::ElectroGeometry::Spherical;
            else throw Napi::TypeError::New(env,
                "forge.em.electrostatics: geometry must be planar|cylindrical|spherical");
        }
        if (o.Has("eps"))    cfg.eps    = o.Get("eps").As<Napi::Number>().DoubleValue();
        if (o.Has("rInner")) cfg.rInner = o.Get("rInner").As<Napi::Number>().DoubleValue();
        if (o.Has("rOuter")) cfg.rOuter = o.Get("rOuter").As<Napi::Number>().DoubleValue();
        if (o.Has("V"))      cfg.V      = o.Get("V").As<Napi::Number>().DoubleValue();
        if (o.Has("n"))      cfg.n      = o.Get("n").As<Napi::Number>().Int32Value();
        if (o.Has("area"))   cfg.area   = o.Get("area").As<Napi::Number>().DoubleValue();
        if (o.Has("length")) cfg.length = o.Get("length").As<Napi::Number>().DoubleValue();
        auto r = forge::em::electrostatics(cfg);
        auto out = Napi::Object::New(env);
        out.Set("n", Napi::Number::New(env, r.n));
        auto setF64 = [&](const char* key, const std::vector<double>& v) {
            auto a = Napi::Float64Array::New(env, v.size());
            std::copy(v.begin(), v.end(), a.Data());
            out.Set(key, a);
        };
        setF64("nodeR",  r.nodeR);
        setF64("phi",    r.phi);
        setF64("elemR",  r.elemR);
        setF64("Efield", r.Efield);
        out.Set("energy",      Napi::Number::New(env, r.energy));
        out.Set("capacitance", Napi::Number::New(env, r.capacitance));
        out.Set("residual",    Napi::Number::New(env, r.residual));
        return out;
    });
}

// ------------------------------------------- EM E3 current-conduction + Joule→T
//
//   currentConduction(cfgObj)
//     cfg: { Lx, Ly, Lz, nx, ny, nz, sigma, V, k, T0 }
//     → { nNodes, nElems, nodeX, nodeY, nodeZ, V, Jmag, joule, T, elemVol,
//         dissipation, resistance, current, maxT, minT, residualV, residualT }
Napi::Value EmCurrentConduction(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (!info[0].IsObject()) {
            throw Napi::TypeError::New(env, "forge.em.currentConduction: cfg must be an object");
        }
        auto o = info[0].As<Napi::Object>();
        forge::em::CurrentConductionConfig cfg;
        if (o.Has("Lx")) cfg.Lx = o.Get("Lx").As<Napi::Number>().DoubleValue();
        if (o.Has("Ly")) cfg.Ly = o.Get("Ly").As<Napi::Number>().DoubleValue();
        if (o.Has("Lz")) cfg.Lz = o.Get("Lz").As<Napi::Number>().DoubleValue();
        if (o.Has("nx")) cfg.nx = o.Get("nx").As<Napi::Number>().Int32Value();
        if (o.Has("ny")) cfg.ny = o.Get("ny").As<Napi::Number>().Int32Value();
        if (o.Has("nz")) cfg.nz = o.Get("nz").As<Napi::Number>().Int32Value();
        if (o.Has("sigma")) cfg.sigma = o.Get("sigma").As<Napi::Number>().DoubleValue();
        if (o.Has("V"))     cfg.V     = o.Get("V").As<Napi::Number>().DoubleValue();
        if (o.Has("k"))     cfg.k     = o.Get("k").As<Napi::Number>().DoubleValue();
        if (o.Has("T0"))    cfg.T0    = o.Get("T0").As<Napi::Number>().DoubleValue();
        auto r = forge::em::currentConduction(cfg);
        auto out = Napi::Object::New(env);
        out.Set("nNodes", Napi::Number::New(env, r.nNodes));
        out.Set("nElems", Napi::Number::New(env, r.nElems));
        auto setF64 = [&](const char* key, const std::vector<double>& v) {
            auto a = Napi::Float64Array::New(env, v.size());
            std::copy(v.begin(), v.end(), a.Data());
            out.Set(key, a);
        };
        setF64("nodeX", r.nodeX);
        setF64("nodeY", r.nodeY);
        setF64("nodeZ", r.nodeZ);
        setF64("V",     r.V);
        setF64("Jmag",  r.Jmag);
        setF64("joule", r.joule);
        setF64("T",     r.T);
        out.Set("elemVol",     Napi::Number::New(env, r.elemVol));
        out.Set("dissipation", Napi::Number::New(env, r.dissipation));
        out.Set("resistance",  Napi::Number::New(env, r.resistance));
        out.Set("current",     Napi::Number::New(env, r.current));
        out.Set("maxT", Napi::Number::New(env, r.maxT));
        out.Set("minT", Napi::Number::New(env, r.minT));
        out.Set("residualV", Napi::Number::New(env, r.residualV));
        out.Set("residualT", Napi::Number::New(env, r.residualT));
        return out;
    });
}

// ----------------------------------------- EM E4 transient eddy-current / skin
//
//   magneticDiffusion(cfgObj)
//     cfg: { L, N, mu, sigma, freq, B0, stepsPerPeriod, periodsToSteady }
//     → { skinDepth, skinDepthAmp, skinDepthPhase, dt, nSteps, depth,
//         ampNum, ampAna, phaseNum, phaseAna, ok }
Napi::Value EmMagneticDiffusion(const Napi::CallbackInfo& info) {
    return safe(info, [&]() -> Napi::Value {
        auto env = info.Env();
        if (!info[0].IsObject()) {
            throw Napi::TypeError::New(env, "forge.em.magneticDiffusion: cfg must be an object");
        }
        auto o = info[0].As<Napi::Object>();
        forge::em::MagneticDiffusionConfig cfg;
        if (o.Has("L"))     cfg.L     = o.Get("L").As<Napi::Number>().DoubleValue();
        if (o.Has("N"))     cfg.N     = o.Get("N").As<Napi::Number>().Int32Value();
        if (o.Has("mu"))    cfg.mu    = o.Get("mu").As<Napi::Number>().DoubleValue();
        if (o.Has("sigma")) cfg.sigma = o.Get("sigma").As<Napi::Number>().DoubleValue();
        if (o.Has("freq"))  cfg.freq  = o.Get("freq").As<Napi::Number>().DoubleValue();
        if (o.Has("B0"))    cfg.B0    = o.Get("B0").As<Napi::Number>().DoubleValue();
        if (o.Has("stepsPerPeriod"))
            cfg.stepsPerPeriod  = o.Get("stepsPerPeriod").As<Napi::Number>().Int32Value();
        if (o.Has("periodsToSteady"))
            cfg.periodsToSteady = o.Get("periodsToSteady").As<Napi::Number>().Int32Value();
        auto r = forge::em::magneticDiffusion(cfg);
        auto out = Napi::Object::New(env);
        auto setF64 = [&](const char* key, const std::vector<double>& v) {
            auto a = Napi::Float64Array::New(env, v.size());
            std::copy(v.begin(), v.end(), a.Data());
            out.Set(key, a);
        };
        out.Set("skinDepth",      Napi::Number::New(env, r.skinDepth));
        out.Set("skinDepthAmp",   Napi::Number::New(env, r.skinDepthAmp));
        out.Set("skinDepthPhase", Napi::Number::New(env, r.skinDepthPhase));
        out.Set("dt",             Napi::Number::New(env, r.dt));
        out.Set("nSteps",         Napi::Number::New(env, r.nSteps));
        setF64("depth",    r.depth);
        setF64("ampNum",   r.ampNum);
        setF64("ampAna",   r.ampAna);
        setF64("phaseNum", r.phaseNum);
        setF64("phaseAna", r.phaseAna);
        out.Set("ok", Napi::Boolean::New(env, r.ok));
        return out;
    });
}

// Wave-0 dark-engine harvest — register the self-contained binding TUs that expose
// the native geom predicates, the implicit/voxel/F-rep field stack, and the
// PlaneGCS constraint diagnostics (binding_geom/field/sketchdiag.cpp).
namespace forge { namespace bind {
void InitGeom(Napi::Env, Napi::Object);
void InitField(Napi::Env, Napi::Object);
void InitSketchdiag(Napi::Env, Napi::Object);
} }  // namespace forge::bind

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("makeBox",      Napi::Function::New(env, MakeBox));
    exports.Set("makeCylinder", Napi::Function::New(env, MakeCylinder));
    exports.Set("makeSphere",   Napi::Function::New(env, MakeSphere));
    exports.Set("makeCone",     Napi::Function::New(env, MakeCone));
    exports.Set("makeTorus",    Napi::Function::New(env, MakeTorus));
    exports.Set("makePrism",     Napi::Function::New(env, MakePrism));
    exports.Set("makeWedge",     Napi::Function::New(env, MakeWedge));
    exports.Set("makePyramid",   Napi::Function::New(env, MakePyramid));
    exports.Set("makeEllipsoid", Napi::Function::New(env, MakeEllipsoid));
    exports.Set("makeTube",      Napi::Function::New(env, MakeTube));

    exports.Set("fuse",   Napi::Function::New(env, Fuse));
    exports.Set("cut",    Napi::Function::New(env, Cut));
    exports.Set("unifyFaces",    Napi::Function::New(env, UnifyFaces));
    exports.Set("faceInventory", Napi::Function::New(env, FaceInventory));
    exports.Set("defeature",     Napi::Function::New(env, Defeature));
    exports.Set("pushPullFace",  Napi::Function::New(env, PushPullFace));
    exports.Set("resizeBore",    Napi::Function::New(env, ResizeBore));
    exports.Set("common", Napi::Function::New(env, Common));

    // Forge-60 — Lineage emission from BRepAlgoAPI_*::Modified() /
    // Generated() / IsDeleted(). JS-side ForgeTopoIdRegistry consumes
    // the entries via `forge.lineageFor(handle)`.
    exports.Set("lineageFor", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          Napi::Env env2 = info.Env();
          if (info.Length() < 1 || !info[0].IsNumber()) {
            throw Napi::TypeError::New(env2, "lineageFor(handle): handle must be a number");
          }
          ShapeHandle h = info[0].As<Napi::Number>().Uint32Value();
          auto entries = LineageRegistry::instance().get(h);
          Napi::Array arr = Napi::Array::New(env2, entries.size());
          for (size_t i = 0; i < entries.size(); ++i) {
            const auto& e = entries[i];
            Napi::Object o = Napi::Object::New(env2);
            const char* kindStr = "survivor";
            switch (e.kind) {
              case LineageEntry::Kind::Survivor: kindStr = "survivor"; break;
              case LineageEntry::Kind::Split:    kindStr = "split";    break;
              case LineageEntry::Kind::Merge:    kindStr = "merge";    break;
              case LineageEntry::Kind::Birth:    kindStr = "birth";    break;
              case LineageEntry::Kind::Death:    kindStr = "death";    break;
            }
            o.Set("kind", Napi::String::New(env2, kindStr));
            o.Set("entityKind", Napi::String::New(env2, e.entityKind));
            o.Set("originOp",   Napi::String::New(env2, e.originOp));
            Napi::Array oldArr = Napi::Array::New(env2, e.oldIndices.size());
            for (size_t j = 0; j < e.oldIndices.size(); ++j) {
              oldArr.Set((uint32_t)j, Napi::Number::New(env2, e.oldIndices[j]));
            }
            Napi::Array newArr = Napi::Array::New(env2, e.newIndices.size());
            for (size_t j = 0; j < e.newIndices.size(); ++j) {
              newArr.Set((uint32_t)j, Napi::Number::New(env2, e.newIndices[j]));
            }
            o.Set("oldIndices", oldArr);
            o.Set("newIndices", newArr);
            arr.Set((uint32_t)i, o);
          }
          return arr;
        });
      }));

    exports.Set("translate", Napi::Function::New(env, Translate));
    exports.Set("rotate",    Napi::Function::New(env, Rotate));

    exports.Set("tessellate",   Napi::Function::New(env, Tessellate));
    exports.Set("massProps",    Napi::Function::New(env, MassProps));

    // IN-HOUSE KERNEL STEP 1 — parallel OCCT-free native B-rep surface, exposed
    // only when the addon is built with -DFORGE_NATIVE_BREP. The OCCT bindings
    // above stay the default; these are strictly additive.
#ifdef FORGE_NATIVE_BREP
    exports.Set("nativeMassProps",  Napi::Function::New(env, NativeMassProps));
    exports.Set("nativeTessellate", Napi::Function::New(env, NativeTessellate));
    exports.Set("nativeFaceInventory", Napi::Function::New(env, NativeFaceInventory));
    exports.Set("nativeEdgeCount", Napi::Function::New(env, NativeEdgeCount));
    exports.Set("nativeBoolean",    Napi::Function::New(env, NativeBoolean)); // STEP 2
    // STEP 3a — A/B backend toggle + introspection for the live ops.
    exports.Set("setNativeBrep",     Napi::Function::New(env, SetNativeBrep));
    exports.Set("nativeBrepEnabled", Napi::Function::New(env, NativeBrepEnabled));
    exports.Set("kindOf",            Napi::Function::New(env, KindOf));
#endif

    exports.Set("retain",    Napi::Function::New(env, Retain));
    exports.Set("release",   Napi::Function::New(env, Release));
    exports.Set("liveCount", Napi::Function::New(env, LiveCount));

    exports.Set("addInstance",      Napi::Function::New(env, AddInstance));
    exports.Set("removeInstance",   Napi::Function::New(env, RemoveInstance));
    exports.Set("updateTransform",  Napi::Function::New(env, UpdateTransform));
    exports.Set("instanceCount",    Napi::Function::New(env, InstanceCount));
    exports.Set("queryAABB",        Napi::Function::New(env, QueryAABB));
    exports.Set("getInstanceAABB",  Napi::Function::New(env, GetInstanceAABB));
    exports.Set("instanceExists",   Napi::Function::New(env, InstanceExists));
    exports.Set("reserveInstances", Napi::Function::New(env, ReserveInstances));
    exports.Set("instanceBytesUsed",Napi::Function::New(env, InstanceBytesUsed));

    // ---- BVH spatial index (Forge-25) ---------------------------------
    exports.Set("buildBvh",     Napi::Function::New(env, BuildBvh));
    exports.Set("isBvhFresh",   Napi::Function::New(env, IsBvhFresh));
    exports.Set("queryRay",     Napi::Function::New(env, QueryRay));
    exports.Set("queryFrustum", Napi::Function::New(env, QueryFrustum));

    // ---- LOD chain (Forge-25) -----------------------------------------
    exports.Set("tessellateLOD",   Napi::Function::New(env, TessellateLOD));
    exports.Set("selectLOD",       Napi::Function::New(env, SelectLOD));
    exports.Set("clearLODCache",   Napi::Function::New(env, ClearLODCache));
    exports.Set("lodCacheEntries", Napi::Function::New(env, LODCacheEntries));
    auto lodLevels = Napi::Object::New(env);
    lodLevels.Set("Low",  Napi::Number::New(env, 0));
    lodLevels.Set("Med",  Napi::Number::New(env, 1));
    lodLevels.Set("High", Napi::Number::New(env, 2));
    exports.Set("LODLevel", lodLevels);

    // ---- worker-thread tessellation (Forge-25) ------------------------
    exports.Set("tessellateAsync",       Napi::Function::New(env, TessellateAsync));
    exports.Set("tessellationPoolSize",  Napi::Function::New(env, TessellationPoolSize));
    exports.Set("tessellationWaitIdle",  Napi::Function::New(env, TessellationWaitIdle));

    // ---- assembly solver (Forge-7) — wrapped under "assembly" namespace.
    auto assembly = Napi::Object::New(env);
    assembly.Set("addMate",       Napi::Function::New(env, AddMate));
    assembly.Set("removeMate",    Napi::Function::New(env, RemoveMate));
    assembly.Set("setMateActive", Napi::Function::New(env, SetMateActive));
    assembly.Set("setFixed",      Napi::Function::New(env, SetFixed));
    assembly.Set("solve",         Napi::Function::New(env, SolveAssembly));
    assembly.Set("mateCount",     Napi::Function::New(env, MateCount));
    assembly.Set("clear",         Napi::Function::New(env, ClearMates));
    // Forge-35 — hierarchy + interference + motion.
    assembly.Set("clearHierarchy",     Napi::Function::New(env, ClearHierarchy));
    assembly.Set("setParent",          Napi::Function::New(env, SetParent));
    assembly.Set("getChildren",        Napi::Function::New(env, GetChildren));
    assembly.Set("worldTransform",     Napi::Function::New(env, WorldTransform));
    assembly.Set("detectInterference", Napi::Function::New(env, DetectInterference));
    assembly.Set("runMotionStudy",     Napi::Function::New(env, RunMotionStudy));
    // Mate-kind integer codes (must mirror MateKind in AssemblySolver.hpp).
    auto kinds = Napi::Object::New(env);
    kinds.Set("Coincident",    Napi::Number::New(env, 0));
    kinds.Set("Concentric",    Napi::Number::New(env, 1));
    kinds.Set("Parallel",      Napi::Number::New(env, 2));
    kinds.Set("Perpendicular", Napi::Number::New(env, 3));
    kinds.Set("Distance",      Napi::Number::New(env, 4));
    kinds.Set("Angle",         Napi::Number::New(env, 5));
    kinds.Set("Tangent",       Napi::Number::New(env, 6));
    kinds.Set("Fixed",         Napi::Number::New(env, 7));
    assembly.Set("MateKind", kinds);
    exports.Set("assembly", assembly);

    // ---- engineering drawings (Forge-10 + Forge-32) — HLR projection +
    // section / detail / broken views.
    auto drawings = Napi::Object::New(env);
    drawings.Set("projectShape",   Napi::Function::New(env, ProjectShape));
    drawings.Set("projectShapePerspective", Napi::Function::New(env, ProjectShapePerspective));
    drawings.Set("projectSection", Napi::Function::New(env, ProjectShapeSection));
    drawings.Set("projectDetail",  Napi::Function::New(env, ProjectShapeDetail));
    drawings.Set("projectBroken",  Napi::Function::New(env, ProjectShapeBroken));
    // ---- PUSH-05: View2D / SectionView surface + DXF / SVG emitters
    drawings.Set("projectView",    Napi::Function::New(env, ProjectView2D));
    drawings.Set("sectionView",    Napi::Function::New(env, SectionView2D));
    drawings.Set("emitDXF",        Napi::Function::New(env, EmitDXF));
    drawings.Set("emitSVG",        Napi::Function::New(env, EmitSVG));
    exports.Set("drawings", drawings);
    exports.Set("projectShape", Napi::Function::New(env, ProjectShape));

    exports.Set("version", Napi::Function::New(env, Version));

    // -------- sketcher (parametric 2D constraint solver) ----------------
    auto sketcher = Napi::Object::New(env);
    sketcher.Set("createSketch",  Napi::Function::New(env, SketcherCreate));
    sketcher.Set("destroySketch", Napi::Function::New(env, SketcherDestroy));
    sketcher.Set("addPoint",      Napi::Function::New(env, SketcherAddPoint));
    sketcher.Set("addLine",       Napi::Function::New(env, SketcherAddLine));
    sketcher.Set("addCircle",     Napi::Function::New(env, SketcherAddCircle));
    sketcher.Set("addArc",        Napi::Function::New(env, SketcherAddArc));
    sketcher.Set("addConstraint", Napi::Function::New(env, SketcherAddConstraint));
    sketcher.Set("solve",         Napi::Function::New(env, SketcherSolve));
    sketcher.Set("readPoint",     Napi::Function::New(env, SketcherReadPoint));
    sketcher.Set("writePoint",    Napi::Function::New(env, SketcherWritePoint));
    sketcher.Set("liveCount",     Napi::Function::New(env, SketcherLiveCount));

    auto sketchKinds = Napi::Object::New(env);
    sketchKinds.Set("Coincident",    Napi::Number::New(env, 1));
    sketchKinds.Set("Parallel",      Napi::Number::New(env, 2));
    sketchKinds.Set("Perpendicular", Napi::Number::New(env, 3));
    sketchKinds.Set("Distance",      Napi::Number::New(env, 4));
    sketchKinds.Set("Horizontal",    Napi::Number::New(env, 5));
    sketchKinds.Set("Vertical",      Napi::Number::New(env, 6));
    sketchKinds.Set("PointOnLine",   Napi::Number::New(env, 7));
    sketchKinds.Set("PointOnCircle", Napi::Number::New(env, 8));
    sketchKinds.Set("Equal",         Napi::Number::New(env, 9));
    sketchKinds.Set("Tangent",       Napi::Number::New(env, 10));
    sketcher.Set("kinds", sketchKinds);

    auto statuses = Napi::Object::New(env);
    statuses.Set("Success",      Napi::Number::New(env, 0));
    statuses.Set("Failed",       Napi::Number::New(env, 1));
    statuses.Set("Inconsistent", Napi::Number::New(env, 2));
    sketcher.Set("statuses", statuses);

    exports.Set("sketcher", sketcher);

    // -------- FEA (Forge-12 + Forge-12b) ---------------------------------
    auto fea = Napi::Object::New(env);
    fea.Set("meshFromBrep",        Napi::Function::New(env, FeaMeshFromBrep));
    fea.Set("solveStatic",         Napi::Function::New(env, FeaSolveStatic));
    fea.Set("solveModal",          Napi::Function::New(env, FeaSolveModal));
    fea.Set("solveDynamic",        Napi::Function::New(env, FeaSolveDynamic));
    fea.Set("solveThermal",        Napi::Function::New(env, FeaSolveThermal));
    fea.Set("solveTransientThermal",Napi::Function::New(env, FeaSolveTransientThermal));
    fea.Set("solveNonlinearStatic",Napi::Function::New(env, FeaSolveNonlinearStatic));
    fea.Set("fatigueLife",         Napi::Function::New(env, FeaFatigueLife));
    fea.Set("solveBuckling",          Napi::Function::New(env, FeaSolveBuckling));
    fea.Set("solveContact",           Napi::Function::New(env, FeaSolveContact));
    fea.Set("solveNonlinearPlastic",  Napi::Function::New(env, FeaSolveNonlinearPlastic));
    // Mean-stress correction enum mirrored to JS.
    auto fc = Napi::Object::New(env);
    fc.Set("None",      Napi::Number::New(env, 0));
    fc.Set("Goodman",   Napi::Number::New(env, 1));
    fc.Set("Soderberg", Napi::Number::New(env, 2));
    fea.Set("MeanStressCorrection", fc);

    // PUSH-11 — Tet4 path under `forge.fea.tet`.
    auto feaTet = Napi::Object::New(env);
    feaTet.Set("meshShape",         Napi::Function::New(env, FeaTetMeshShape));
    feaTet.Set("solveLinearStatic", Napi::Function::New(env, FeaTetSolveLinearStatic));
    feaTet.Set("solveModal",        Napi::Function::New(env, FeaTetSolveModal));
    fea.Set("tet", feaTet);

    exports.Set("fea", fea);

    // -------- em (Elmer-track native electromagnetic field solvers) ------
    auto em = Napi::Object::New(env);
    em.Set("magnetostatics",    Napi::Function::New(env, EmMagnetostatics));
    em.Set("electrostatics",    Napi::Function::New(env, EmElectrostatics));
    em.Set("currentConduction", Napi::Function::New(env, EmCurrentConduction));
    em.Set("magneticDiffusion", Napi::Function::New(env, EmMagneticDiffusion));
    exports.Set("em", em);

    // -------- cam (2.5D toolpath generators + G-code post) -------------
    auto cam = Napi::Object::New(env);
    cam.Set("profile",  Napi::Function::New(env, CamProfile));
    cam.Set("pocket",   Napi::Function::New(env, CamPocket));
    cam.Set("drill",    Napi::Function::New(env, CamDrill));
    cam.Set("faceMill", Napi::Function::New(env, CamFaceMill));
    cam.Set("adaptiveClear",       Napi::Function::New(env, CamAdaptiveClear));
    cam.Set("multiAxisIndexed",    Napi::Function::New(env, CamMultiAxisIndexed));
    cam.Set("multiAxisContinuous", Napi::Function::New(env, CamMultiAxisContinuous));
    cam.Set("simulateStock",       Napi::Function::New(env, CamSimulateStock));
    cam.Set("generateCmm",         Napi::Function::New(env, CamGenerateCmm));

    auto toolTypes = Napi::Object::New(env);
    toolTypes.Set("EndMill",  Napi::Number::New(env, forge::cam::Tool::EndMill));
    toolTypes.Set("BallNose", Napi::Number::New(env, forge::cam::Tool::BallNose));
    toolTypes.Set("Drill",    Napi::Number::New(env, forge::cam::Tool::Drill));
    toolTypes.Set("Chamfer",  Napi::Number::New(env, forge::cam::Tool::Chamfer));
    cam.Set("ToolType", toolTypes);
    cam.Set("kAutoFaceId", Napi::Number::New(env, forge::cam::kAutoFaceId));

    auto gcode = Napi::Object::New(env);
    gcode.Set("toGcode", Napi::Function::New(env, CamToGcode));
    auto dialects = Napi::Object::New(env);
    dialects.Set("Fanuc",    Napi::Number::New(env, forge::cam::gcode::Fanuc));
    dialects.Set("Haas",     Napi::Number::New(env, forge::cam::gcode::Haas));
    dialects.Set("LinuxCNC", Napi::Number::New(env, forge::cam::gcode::LinuxCNC));
    dialects.Set("Grbl",     Napi::Number::New(env, forge::cam::gcode::Grbl));
    gcode.Set("Dialect", dialects);
    cam.Set("gcode", gcode);
    exports.Set("cam", cam);

    // -------- CFD (Forge-12b) -------------------------------------------
    auto cfd = Napi::Object::New(env);
    cfd.Set("solveSteadyNS", Napi::Function::New(env, CfdSolveSteadyNS));
    cfd.Set("solveNaturalConvection",
            Napi::Function::New(env, CfdSolveNaturalConvection));
    cfd.Set("solveSpeciesTransport",
            Napi::Function::New(env, CfdSolveSpeciesTransport));
    cfd.Set("solveCompressible1D",
            Napi::Function::New(env, CfdSolveCompressible1D));
    cfd.Set("sodShockTube",
            Napi::Function::New(env, CfdSolveCompressible1D));
    cfd.Set("solveCompressible2D",
            Napi::Function::New(env, CfdSolveCompressible2D));
    cfd.Set("obliqueShock",
            Napi::Function::New(env, CfdSolveCompressible2D));
    exports.Set("cfd", cfd);

    // -------- multibody dynamics (real inertial DAE, HHT-α) -------------
    auto simulate = Napi::Object::New(env);
    simulate.Set("multibodyDynamics",
                 Napi::Function::New(env, SimulateMultibodyDynamics));
    exports.Set("simulate", simulate);

    // -------- part features (Forge-22) ----------------------------------
    auto part = Napi::Object::New(env);
    part.Set("extrudeProfile",      Napi::Function::New(env, PartExtrudeProfile));
    part.Set("extrudeProfileOnPlane", Napi::Function::New(env, PartExtrudeProfileOnPlane));
    part.Set("revolveProfile",      Napi::Function::New(env, PartRevolveProfile));
    part.Set("sweep",               Napi::Function::New(env, PartSweep));
    part.Set("loft",                Napi::Function::New(env, PartLoft));
    part.Set("shell",               Napi::Function::New(env, PartShell));
    part.Set("thickenSurface",      Napi::Function::New(env, PartThickenSurface));
    part.Set("pipeFromPolyline",    Napi::Function::New(env, PartPipeFromPolyline));
    part.Set("profileWire",         Napi::Function::New(env, PartProfileWire));
    part.Set("sweepPolyline",       Napi::Function::New(env, PartSweepPolyline));
    part.Set("filletEdges",         Napi::Function::New(env, PartFilletEdges));
    part.Set("variableFilletEdge",  Napi::Function::New(env, PartVariableFillet));
    part.Set("chamferEdges",        Napi::Function::New(env, PartChamferEdges));
    part.Set("draftFaces",          Napi::Function::New(env, PartDraftFaces));
    part.Set("holeWizard",          Napi::Function::New(env, PartHoleWizard));
    part.Set("rib",                 Napi::Function::New(env, PartRib));
    part.Set("linearPattern",       Napi::Function::New(env, PartLinearPattern));
    part.Set("circularPattern",     Napi::Function::New(env, PartCircularPattern));
    part.Set("mirrorPattern",       Napi::Function::New(env, PartMirrorPattern));
    part.Set("onCurvePattern",      Napi::Function::New(env, PartOnCurvePattern));
    // Forge-36 closures of the §1 partial rows.
    part.Set("sweepWithGuides",     Napi::Function::New(env, PartSweepWithGuides));
    part.Set("loftWithGuides",      Napi::Function::New(env, PartLoftWithGuides));
    part.Set("shellMultiThickness", Napi::Function::New(env, PartShellMultiThickness));
    exports.Set("part", part);

    // -------- NURBS surfacing (Forge-36) -------------------------------
    auto surfacing = Napi::Object::New(env);
    surfacing.Set("buildPatch",     Napi::Function::New(env, SurfBuildPatch));
    surfacing.Set("trim",           Napi::Function::New(env, SurfTrim));
    surfacing.Set("sew",            Napi::Function::New(env, SurfSew));
    surfacing.Set("refine",         Napi::Function::New(env, SurfRefine));
    surfacing.Set("eval",           Napi::Function::New(env, SurfEval));
    surfacing.Set("intersect",      Napi::Function::New(env, SurfIntersect));
    surfacing.Set("projectPoint",   Napi::Function::New(env, SurfProjectPoint));
    surfacing.Set("classAAnalyse",  Napi::Function::New(env, SurfClassA));
    exports.Set("surfacing", surfacing);

    // -------- IO exchange (Forge-21) — STEP / BREP / STL ----------------
    auto io = Napi::Object::New(env);
    io.Set("importStep", Napi::Function::New(env, IoImportStep));
    io.Set("exportStep", Napi::Function::New(env, IoExportStep));
    io.Set("importBrep", Napi::Function::New(env, IoImportBrep));
    io.Set("exportBrep", Napi::Function::New(env, IoExportBrep));
    io.Set("importStl",  Napi::Function::New(env, IoImportStl));
    io.Set("exportStl",  Napi::Function::New(env, IoExportStl));
    // Forge-34: IGES + JT/Parasolid stubs + PMI/MBD STEP AP242 export.
    io.Set("exportIges",       Napi::Function::New(env, IoExportIges));
    io.Set("importIges",       Napi::Function::New(env, IoImportIges));
    io.Set("importJt",         Napi::Function::New(env, IoImportJt));
    io.Set("importParasolid",  Napi::Function::New(env, IoImportParasolid));
    io.Set("exportStepWithPmi",Napi::Function::New(env, IoExportStepPmi));
    exports.Set("io", io);

    // -------- Direct modeling (Forge-23) — push/pull/move/delete face ---
    auto direct = Napi::Object::New(env);
    direct.Set("pushPullFace",      Napi::Function::New(env, DirectPushPullFace));
    direct.Set("moveFace",          Napi::Function::New(env, DirectMoveFace));
    direct.Set("rotateFace",        Napi::Function::New(env, DirectRotateFace));
    direct.Set("deleteFaceAndHeal", Napi::Function::New(env, DirectDeleteFace));
    direct.Set("replaceFace",       Napi::Function::New(env, DirectReplaceFace));
    direct.Set("inferFeature",      Napi::Function::New(env, DirectInferFeature));
    direct.Set("faceCount",         Napi::Function::New(env, DirectFaceCount));
    direct.Set("edgeCount",         Napi::Function::New(env, DirectEdgeCount));
    direct.Set("edgeSegments",      Napi::Function::New(env, DirectEdgeSegments));
    exports.Set("direct", direct);

    // -------- Healing (Forge-23) — sew / fill / validity ---------------
    auto healing = Napi::Object::New(env);
    healing.Set("sewShape",                    Napi::Function::New(env, HealSew));
    healing.Set("simplifyShape",               Napi::Function::New(env, HealSimplify));
    healing.Set("autoFillMissingFaces",        Napi::Function::New(env, HealAutoFill));
    healing.Set("autoRepairSelfIntersection",  Napi::Function::New(env, HealAutoRepair));
    healing.Set("harmonizeNormals",            Napi::Function::New(env, HealHarmonizeNormals));
    healing.Set("checkValidity",               Napi::Function::New(env, HealCheckValidity));
    exports.Set("heal", healing);
    // -------- Sheet metal (Forge-24) -----------------------------------
    auto sheetMetal = Napi::Object::New(env);
    sheetMetal.Set("makeWireRect", Napi::Function::New(env, SmMakeWireRect));
    sheetMetal.Set("makeLineEdge", Napi::Function::New(env, SmMakeLineEdge));
    sheetMetal.Set("baseFlange",   Napi::Function::New(env, SmBaseFlange));
    sheetMetal.Set("edgeFlange",   Napi::Function::New(env, SmEdgeFlange));
    sheetMetal.Set("miterFlange",  Napi::Function::New(env, SmMiterFlange));
    sheetMetal.Set("hem",          Napi::Function::New(env, SmHem));
    sheetMetal.Set("sketchedBend", Napi::Function::New(env, SmSketchedBend));
    sheetMetal.Set("jog",          Napi::Function::New(env, SmJog));
    sheetMetal.Set("closedCorner", Napi::Function::New(env, SmClosedCorner));
    sheetMetal.Set("cornerRelief", Napi::Function::New(env, SmCornerRelief));
    sheetMetal.Set("unfold",       Napi::Function::New(env, SmUnfold));
    sheetMetal.Set("flatPattern",  Napi::Function::New(env, SmFlatPattern));
    sheetMetal.Set("bends",        Napi::Function::New(env, SmBends));
    exports.Set("sheetMetal", sheetMetal);

    // -------- Weldments (Forge-24) -------------------------------------
    auto weldments = Napi::Object::New(env);
    weldments.Set("makePathEdge",     Napi::Function::New(env, WdMakePathEdge));
    weldments.Set("structuralMember", Napi::Function::New(env, WdStructuralMember));
    weldments.Set("endCap",           Napi::Function::New(env, WdEndCap));
    weldments.Set("gusset",           Napi::Function::New(env, WdGusset));
    weldments.Set("weldBead",         Napi::Function::New(env, WdWeldBead));
    weldments.Set("trimMember",       Napi::Function::New(env, WdTrimMember));
    weldments.Set("cutList",          Napi::Function::New(env, WdCutList));
    exports.Set("weldments", weldments);

    // -------- Airfoil (Forge-171) ---------------------------------------
    auto airfoil = Napi::Object::New(env);
    airfoil.Set("naca4",            Napi::Function::New(env, AirfoilNaca4));
    airfoil.Set("naca5",            Napi::Function::New(env, AirfoilNaca5));
    airfoil.Set("parseSelig",       Napi::Function::New(env, AirfoilParseSelig));
    airfoil.Set("resampleCosine",   Napi::Function::New(env, AirfoilResample));
    airfoil.Set("profileToFace",    Napi::Function::New(env, AirfoilProfileToFace));
    airfoil.Set("loftWing",         Napi::Function::New(env, AirfoilLoftWing));
    airfoil.Set("trapezoidalWing",  Napi::Function::New(env, AirfoilTrapezoidalWing));
    airfoil.Set("planformMetrics",  Napi::Function::New(env, AirfoilPlanformMetrics));
    exports.Set("airfoil", airfoil);

    // -------- Geotech slope stability (Forge-176) -----------------------
    auto geotech = Napi::Object::New(env);
    geotech.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 1 || !info[0].IsObject()) {
            throw Napi::TypeError::New(env2, "forge.geotech.analyse: cfg must be an object");
          }
          auto o = info[0].As<Napi::Object>();
          forge::geotech::SlopeConfig cfg{};

          auto readF64 = [&](const std::string& key) -> std::vector<double> {
            std::vector<double> out;
            if (!o.Has(key)) return out;
            auto v = o.Get(key);
            if (v.IsTypedArray()) {
              auto a = v.As<Napi::Float64Array>();
              out.assign(a.Data(), a.Data() + a.ElementLength());
            } else if (v.IsArray()) {
              auto a = v.As<Napi::Array>();
              for (uint32_t i = 0; i < a.Length(); ++i) {
                out.push_back(a.Get(i).As<Napi::Number>().DoubleValue());
              }
            }
            return out;
          };

          cfg.groundProfile = readF64("groundProfile");
          cfg.waterTable    = readF64("waterTable");

          if (!o.Has("layers") || !o.Get("layers").IsArray()) {
            throw Napi::TypeError::New(env2, "forge.geotech.analyse: layers must be array");
          }
          auto layersArr = o.Get("layers").As<Napi::Array>();
          for (uint32_t i = 0; i < layersArr.Length(); ++i) {
            auto lo = layersArr.Get(i).As<Napi::Object>();
            forge::geotech::SoilLayer L{};
            if (lo.Has("topProfile")) {
              auto tp = lo.Get("topProfile");
              if (tp.IsTypedArray()) {
                auto a = tp.As<Napi::Float64Array>();
                L.topProfile.assign(a.Data(), a.Data() + a.ElementLength());
              } else if (tp.IsArray()) {
                auto a = tp.As<Napi::Array>();
                for (uint32_t j = 0; j < a.Length(); ++j) {
                  L.topProfile.push_back(a.Get(j).As<Napi::Number>().DoubleValue());
                }
              }
            }
            L.gammaWet = lo.Has("gammaWet") ? lo.Get("gammaWet").As<Napi::Number>().DoubleValue() : 0.0;
            L.gammaSat = lo.Has("gammaSat") ? lo.Get("gammaSat").As<Napi::Number>().DoubleValue() : L.gammaWet;
            L.cPrime   = lo.Has("cPrime"  ) ? lo.Get("cPrime"  ).As<Napi::Number>().DoubleValue() : 0.0;
            L.phiPrime = lo.Has("phiPrime") ? lo.Get("phiPrime").As<Napi::Number>().DoubleValue() : 0.0;
            L.ru       = lo.Has("ru"      ) ? lo.Get("ru"      ).As<Napi::Number>().DoubleValue() : 0.0;
            if (lo.Has("name") && lo.Get("name").IsString()) {
              L.name = lo.Get("name").As<Napi::String>().Utf8Value();
            }
            cfg.layers.push_back(std::move(L));
          }

          cfg.xcMin = o.Get("xcMin").As<Napi::Number>().DoubleValue();
          cfg.xcMax = o.Get("xcMax").As<Napi::Number>().DoubleValue();
          cfg.ycMin = o.Get("ycMin").As<Napi::Number>().DoubleValue();
          cfg.ycMax = o.Get("ycMax").As<Napi::Number>().DoubleValue();
          cfg.rMin  = o.Get("rMin" ).As<Napi::Number>().DoubleValue();
          cfg.rMax  = o.Get("rMax" ).As<Napi::Number>().DoubleValue();
          cfg.nXc   = o.Get("nXc"  ).As<Napi::Number>().Int32Value();
          cfg.nYc   = o.Get("nYc"  ).As<Napi::Number>().Int32Value();
          cfg.nR    = o.Get("nR"   ).As<Napi::Number>().Int32Value();
          cfg.sliceCount      = o.Has("sliceCount"     ) ? o.Get("sliceCount"     ).As<Napi::Number>().Int32Value()  : 30;
          cfg.bishopMaxIters  = o.Has("bishopMaxIters" ) ? o.Get("bishopMaxIters" ).As<Napi::Number>().Int32Value()  : 50;
          cfg.bishopTol       = o.Has("bishopTol"      ) ? o.Get("bishopTol"      ).As<Napi::Number>().DoubleValue() : 1e-4;
          cfg.janbuF0         = o.Has("janbuF0"        ) ? o.Get("janbuF0"        ).As<Napi::Number>().DoubleValue() : 0.0;

          auto result = forge::geotech::analyse(cfg);

          auto out = Napi::Object::New(env2);
          out.Set("fosBishop",       Napi::Number::New(env2, result.fosBishop));
          out.Set("fosJanbu",        Napi::Number::New(env2, result.fosJanbu));
          out.Set("xcCritical",      Napi::Number::New(env2, result.xcCritical));
          out.Set("ycCritical",      Napi::Number::New(env2, result.ycCritical));
          out.Set("rCritical",       Napi::Number::New(env2, result.rCritical));
          out.Set("iterations",      Napi::Number::New(env2, result.iterations));
          out.Set("trialsEvaluated", Napi::Number::New(env2, result.trialsEvaluated));
          auto slip = Napi::Float64Array::New(env2, result.slipSurface.size());
          std::memcpy(slip.Data(), result.slipSurface.data(),
                      result.slipSurface.size() * sizeof(double));
          out.Set("slipSurface", slip);
          auto slicesArr = Napi::Array::New(env2, result.slices.size());
          for (size_t i = 0; i < result.slices.size(); ++i) {
            auto so = Napi::Object::New(env2);
            so.Set("xCentre",      Napi::Number::New(env2, result.slices[i].xCentre));
            so.Set("yBase",        Napi::Number::New(env2, result.slices[i].yBase));
            so.Set("width",        Napi::Number::New(env2, result.slices[i].width));
            so.Set("weight",       Napi::Number::New(env2, result.slices[i].weight));
            so.Set("baseAngle",    Napi::Number::New(env2, result.slices[i].baseAngle));
            so.Set("baseLength",   Napi::Number::New(env2, result.slices[i].baseLength));
            so.Set("porePressure", Napi::Number::New(env2, result.slices[i].porePressure));
            so.Set("cBase",        Napi::Number::New(env2, result.slices[i].cBase));
            so.Set("phiBase",      Napi::Number::New(env2, result.slices[i].phiBase));
            slicesArr.Set((uint32_t)i, so);
          }
          out.Set("slices", slicesArr);
          return out;
        });
      }));
    exports.Set("geotech", geotech);

    // -------- Casting solidification (Forge-173) ------------------------
    auto casting = Napi::Object::New(env);
    casting.Set("solidify", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 1 || !info[0].IsObject()) {
            throw Napi::TypeError::New(env2, "forge.casting.solidify: cfg must be an object");
          }
          auto o = info[0].As<Napi::Object>();
          forge::casting::CastingConfig cfg{};
          cfg.minX = o.Get("minX").As<Napi::Number>().DoubleValue();
          cfg.minY = o.Get("minY").As<Napi::Number>().DoubleValue();
          cfg.minZ = o.Get("minZ").As<Napi::Number>().DoubleValue();
          cfg.maxX = o.Get("maxX").As<Napi::Number>().DoubleValue();
          cfg.maxY = o.Get("maxY").As<Napi::Number>().DoubleValue();
          cfg.maxZ = o.Get("maxZ").As<Napi::Number>().DoubleValue();
          cfg.Nx = o.Get("Nx").As<Napi::Number>().Int32Value();
          cfg.Ny = o.Get("Ny").As<Napi::Number>().Int32Value();
          cfg.Nz = o.Get("Nz").As<Napi::Number>().Int32Value();
          cfg.Tpour     = o.Get("Tpour").As<Napi::Number>().DoubleValue();
          cfg.TambientK = o.Get("TambientK").As<Napi::Number>().DoubleValue();
          cfg.hWall     = o.Get("hWall").As<Napi::Number>().DoubleValue();
          auto a = o.Get("alloy").As<Napi::Object>();
          cfg.alloy.rho       = a.Get("rho").As<Napi::Number>().DoubleValue();
          cfg.alloy.cp        = a.Get("cp" ).As<Napi::Number>().DoubleValue();
          cfg.alloy.k         = a.Get("k"  ).As<Napi::Number>().DoubleValue();
          cfg.alloy.L         = a.Get("L"  ).As<Napi::Number>().DoubleValue();
          cfg.alloy.Tsolidus  = a.Get("Tsolidus" ).As<Napi::Number>().DoubleValue();
          cfg.alloy.Tliquidus = a.Get("Tliquidus").As<Napi::Number>().DoubleValue();
          cfg.endTimeSec  = o.Get("endTimeSec").As<Napi::Number>().DoubleValue();
          cfg.cflFactor   = o.Has("cflFactor"  ) ? o.Get("cflFactor"  ).As<Napi::Number>().DoubleValue() : 0.4;
          cfg.sampleEvery = o.Has("sampleEvery") ? o.Get("sampleEvery").As<Napi::Number>().Int32Value()  : 50;
          auto mask = o.Get("cavityMask").As<Napi::Uint8Array>();
          cfg.cavityMask.assign(mask.Data(), mask.Data() + mask.ElementLength());
          auto r = forge::casting::solidify(cfg);
          auto out = Napi::Object::New(env2);
          out.Set("Nx", Napi::Number::New(env2, r.Nx));
          out.Set("Ny", Napi::Number::New(env2, r.Ny));
          out.Set("Nz", Napi::Number::New(env2, r.Nz));
          auto cpyF64 = [&](const std::vector<double>& v) {
            auto arr = Napi::Float64Array::New(env2, v.size());
            std::memcpy(arr.Data(), v.data(), v.size() * sizeof(double));
            return arr;
          };
          out.Set("solidTimeSec",  cpyF64(r.solidTimeSec));
          out.Set("peakTempK",     cpyF64(r.peakTempK));
          out.Set("niyama",        cpyF64(r.niyama));
          out.Set("snapshotTimesSec", cpyF64(r.snapshotTimesSec));
          auto snaps = Napi::Array::New(env2, r.tempSnapshots.size());
          for (size_t i = 0; i < r.tempSnapshots.size(); ++i) {
            snaps.Set((uint32_t)i, cpyF64(r.tempSnapshots[i]));
          }
          out.Set("tempSnapshots", snaps);
          out.Set("totalSimTimeSec", Napi::Number::New(env2, r.totalSimTimeSec));
          out.Set("maxSolidTimeSec", Napi::Number::New(env2, r.maxSolidTimeSec));
          out.Set("avgSolidTimeSec", Napi::Number::New(env2, r.avgSolidTimeSec));
          out.Set("cellsSimulated",  Napi::Number::New(env2, r.cellsSimulated));
          out.Set("cellsSolidified", Napi::Number::New(env2, r.cellsSolidified));
          return out;
        });
      }));
    exports.Set("casting", casting);

    // -------- Mold flow (Forge-172) -------------------------------------
    auto mold = Napi::Object::New(env);
    mold.Set("heleShawFill", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 5) {
            throw Napi::TypeError::New(env2,
              "forge.mold.heleShawFill(mesh, gate, mat, moldTempK, maxTimeSec, maxSteps)");
          }
          auto m = info[0].As<Napi::Object>();
          forge::mold::MeshShell mesh{};
          auto vArr = m.Get("vertices").As<Napi::Float64Array>();
          mesh.vertices.assign(vArr.Data(), vArr.Data() + vArr.ElementLength());
          auto tArr = m.Get("triangles").As<Napi::Uint32Array>();
          mesh.triangles.assign(tArr.Data(), tArr.Data() + tArr.ElementLength());
          auto hArr = m.Get("thickness").As<Napi::Float64Array>();
          mesh.thickness.assign(hArr.Data(), hArr.Data() + hArr.ElementLength());

          auto gObj = info[1].As<Napi::Object>();
          forge::mold::InjectionGate gate{};
          gate.x           = gObj.Get("x").As<Napi::Number>().DoubleValue();
          gate.y           = gObj.Get("y").As<Napi::Number>().DoubleValue();
          gate.z           = gObj.Has("z") ? gObj.Get("z").As<Napi::Number>().DoubleValue() : 0.0;
          gate.flowRateM3s = gObj.Get("flowRateM3s").As<Napi::Number>().DoubleValue();
          gate.meltTempK   = gObj.Get("meltTempK").As<Napi::Number>().DoubleValue();

          auto cObj = info[2].As<Napi::Object>();
          forge::mold::CrossWLF mat{};
          mat.n        = cObj.Get("n"      ).As<Napi::Number>().DoubleValue();
          mat.tauStar  = cObj.Get("tauStar").As<Napi::Number>().DoubleValue();
          mat.D1       = cObj.Get("D1"     ).As<Napi::Number>().DoubleValue();
          mat.A1       = cObj.Get("A1"     ).As<Napi::Number>().DoubleValue();
          mat.A2       = cObj.Get("A2"     ).As<Napi::Number>().DoubleValue();
          mat.Tg       = cObj.Get("Tg"     ).As<Napi::Number>().DoubleValue();

          const double moldT     = info[3].As<Napi::Number>().DoubleValue();
          const double maxT      = info[4].As<Napi::Number>().DoubleValue();
          const int    maxSteps  = (info.Length() > 5 && info[5].IsNumber())
                                   ? info[5].As<Napi::Number>().Int32Value() : 200;

          auto r = forge::mold::heleShawFill(mesh, gate, mat, moldT, maxT, maxSteps);

          auto out = Napi::Object::New(env2);
          auto cpyF64 = [&](const std::vector<double>& v) {
            auto a = Napi::Float64Array::New(env2, v.size());
            std::memcpy(a.Data(), v.data(), v.size() * sizeof(double));
            return a;
          };
          auto cpyU32 = [&](const std::vector<uint32_t>& v) {
            auto a = Napi::Uint32Array::New(env2, v.size());
            std::memcpy(a.Data(), v.data(), v.size() * sizeof(uint32_t));
            return a;
          };
          out.Set("fillTimeSec",        cpyF64(r.fillTimeSec));
          out.Set("peakPressurePa",     cpyF64(r.peakPressurePa));
          out.Set("filledFraction",     cpyF64(r.filledFraction));
          out.Set("weldLineTriangles",  cpyU32(r.weldLineTriangles));
          out.Set("airTrapTriangles",   cpyU32(r.airTrapTriangles));
          out.Set("totalFillTimeSec",   Napi::Number::New(env2, r.totalFillTimeSec));
          out.Set("maxPressurePa",      Napi::Number::New(env2, r.maxPressurePa));
          out.Set("stepsTaken",         Napi::Number::New(env2, r.stepsTaken));
          out.Set("converged",          Napi::Boolean::New(env2, r.converged));
          return out;
        });
      }));

    // -------- PUSH-08 — Mold tooling (draft / parting / cavity / cooling) ---
    // analyseDraft(partHandle, pullDir[3], draftThresholdDeg)
    mold.Set("analyseDraft", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 3 || !info[0].IsNumber() ||
              !info[1].IsArray() || !info[2].IsNumber()) {
            throw Napi::TypeError::New(env2,
              "forge.mold.analyseDraft(partHandle, [dx,dy,dz], draftThresholdDeg)");
          }
          uint32_t h = info[0].As<Napi::Number>().Uint32Value();
          auto dirArr = info[1].As<Napi::Array>();
          if (dirArr.Length() < 3) {
            throw Napi::TypeError::New(env2,
              "forge.mold.analyseDraft: pullDir must be [dx,dy,dz]");
          }
          gp_Dir pullDir(
            dirArr.Get((uint32_t)0).As<Napi::Number>().DoubleValue(),
            dirArr.Get((uint32_t)1).As<Napi::Number>().DoubleValue(),
            dirArr.Get((uint32_t)2).As<Napi::Number>().DoubleValue());
          double thresh = info[2].As<Napi::Number>().DoubleValue();
          const TopoDS_Shape& part = forge::ShapeRegistry::instance().get(h);
          auto faces = forge::mold::analyseDraft(part, pullDir, thresh);
          auto arr = Napi::Array::New(env2, faces.size());
          int positive = 0, negative = 0, vertical = 0;
          for (uint32_t i = 0; i < faces.size(); ++i) {
            auto o = Napi::Object::New(env2);
            o.Set("angleDeg",   Napi::Number::New(env2, faces[i].angleDeg));
            o.Set("isPositive", Napi::Boolean::New(env2, faces[i].isPositive));
            o.Set("isNegative", Napi::Boolean::New(env2, faces[i].isNegative));
            o.Set("isVertical", Napi::Boolean::New(env2, faces[i].isVertical));
            if (faces[i].isPositive) ++positive;
            if (faces[i].isNegative) ++negative;
            if (faces[i].isVertical) ++vertical;
            arr.Set(i, o);
          }
          auto out = Napi::Object::New(env2);
          out.Set("faces",        arr);
          out.Set("count",        Napi::Number::New(env2, (double)faces.size()));
          out.Set("positiveCount",Napi::Number::New(env2, (double)positive));
          out.Set("negativeCount",Napi::Number::New(env2, (double)negative));
          out.Set("verticalCount",Napi::Number::New(env2, (double)vertical));
          return out;
        });
      }));

    // computeParting(partHandle, [dx,dy,dz]) -> { partingLineCount, partingSurface:handle }
    mold.Set("computeParting", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsArray()) {
            throw Napi::TypeError::New(env2,
              "forge.mold.computeParting(partHandle, [dx,dy,dz])");
          }
          uint32_t h = info[0].As<Napi::Number>().Uint32Value();
          auto dirArr = info[1].As<Napi::Array>();
          if (dirArr.Length() < 3) {
            throw Napi::TypeError::New(env2,
              "forge.mold.computeParting: pullDir must be [dx,dy,dz]");
          }
          gp_Dir pullDir(
            dirArr.Get((uint32_t)0).As<Napi::Number>().DoubleValue(),
            dirArr.Get((uint32_t)1).As<Napi::Number>().DoubleValue(),
            dirArr.Get((uint32_t)2).As<Napi::Number>().DoubleValue());
          const TopoDS_Shape& part = forge::ShapeRegistry::instance().get(h);
          auto r = forge::mold::computeParting(part, pullDir);
          uint32_t surfHandle =
            forge::ShapeRegistry::instance().add(r.partingSurface);
          auto out = Napi::Object::New(env2);
          out.Set("partingLineCount",
                  Napi::Number::New(env2, (double)r.partingLines.size()));
          out.Set("partingSurface", Napi::Number::New(env2, surfHandle));
          return out;
        });
      }));

    // splitCavityCore(moldBlockH, partH, partingSurfaceH) -> { cavity:h, core:h }
    mold.Set("splitCavityCore", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 3 || !info[0].IsNumber() ||
              !info[1].IsNumber() || !info[2].IsNumber()) {
            throw Napi::TypeError::New(env2,
              "forge.mold.splitCavityCore(moldBlock:h, part:h, partingSurface:h)");
          }
          uint32_t blockH  = info[0].As<Napi::Number>().Uint32Value();
          uint32_t partH   = info[1].As<Napi::Number>().Uint32Value();
          uint32_t surfH   = info[2].As<Napi::Number>().Uint32Value();
          const TopoDS_Shape& block = forge::ShapeRegistry::instance().get(blockH);
          const TopoDS_Shape& part  = forge::ShapeRegistry::instance().get(partH);
          const TopoDS_Shape& surf  = forge::ShapeRegistry::instance().get(surfH);
          auto r = forge::mold::splitCavityCore(block, part, surf);
          uint32_t cavityH = forge::ShapeRegistry::instance().add(r.cavity);
          uint32_t coreH   = forge::ShapeRegistry::instance().add(r.core);
          auto out = Napi::Object::New(env2);
          out.Set("cavity", Napi::Number::New(env2, cavityH));
          out.Set("core",   Napi::Number::New(env2, coreH));
          return out;
        });
      }));

    // insertCoolingChannels(moldBlockH, channels:Array<{start,end,diameter}>) -> handle
    mold.Set("insertCoolingChannels", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsArray()) {
            throw Napi::TypeError::New(env2,
              "forge.mold.insertCoolingChannels(moldBlock:h, channels:[{start:[x,y,z],end:[x,y,z],diameter}])");
          }
          uint32_t blockH = info[0].As<Napi::Number>().Uint32Value();
          auto arr = info[1].As<Napi::Array>();
          std::vector<forge::mold::CoolingChannel> channels;
          channels.reserve(arr.Length());
          for (uint32_t i = 0; i < arr.Length(); ++i) {
            auto o = arr.Get(i).As<Napi::Object>();
            auto sArr = o.Get("start").As<Napi::Array>();
            auto eArr = o.Get("end").As<Napi::Array>();
            forge::mold::CoolingChannel ch{
              gp_Pnt(
                sArr.Get((uint32_t)0).As<Napi::Number>().DoubleValue(),
                sArr.Get((uint32_t)1).As<Napi::Number>().DoubleValue(),
                sArr.Get((uint32_t)2).As<Napi::Number>().DoubleValue()),
              gp_Pnt(
                eArr.Get((uint32_t)0).As<Napi::Number>().DoubleValue(),
                eArr.Get((uint32_t)1).As<Napi::Number>().DoubleValue(),
                eArr.Get((uint32_t)2).As<Napi::Number>().DoubleValue()),
              o.Get("diameter").As<Napi::Number>().DoubleValue()
            };
            channels.push_back(ch);
          }
          const TopoDS_Shape& block = forge::ShapeRegistry::instance().get(blockH);
          auto r = forge::mold::insertCoolingChannels(block, channels);
          uint32_t outH = forge::ShapeRegistry::instance().add(r);
          return Napi::Number::New(env2, outH);
        });
      }));

    // buildRunnerSystem(sprueTop:[x,y,z], gateEntries:Array<[x,y,z]>,
    //                   sprueDia, runnerDia, gateDia)
    //   -> { sprue:h, runners:[h], gates:[h] }
    mold.Set("buildRunnerSystem", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 5 || !info[0].IsArray() || !info[1].IsArray() ||
              !info[2].IsNumber() || !info[3].IsNumber() || !info[4].IsNumber()) {
            throw Napi::TypeError::New(env2,
              "forge.mold.buildRunnerSystem(sprueTop:[x,y,z], gateEntries:[[x,y,z]],"
              " sprueDia, runnerDia, gateDia)");
          }
          auto sArr = info[0].As<Napi::Array>();
          gp_Pnt sprueTop(
            sArr.Get((uint32_t)0).As<Napi::Number>().DoubleValue(),
            sArr.Get((uint32_t)1).As<Napi::Number>().DoubleValue(),
            sArr.Get((uint32_t)2).As<Napi::Number>().DoubleValue());
          auto gArr = info[1].As<Napi::Array>();
          std::vector<gp_Pnt> gateEntries;
          gateEntries.reserve(gArr.Length());
          for (uint32_t i = 0; i < gArr.Length(); ++i) {
            auto p = gArr.Get(i).As<Napi::Array>();
            gateEntries.emplace_back(
              p.Get((uint32_t)0).As<Napi::Number>().DoubleValue(),
              p.Get((uint32_t)1).As<Napi::Number>().DoubleValue(),
              p.Get((uint32_t)2).As<Napi::Number>().DoubleValue());
          }
          double sprueDia  = info[2].As<Napi::Number>().DoubleValue();
          double runnerDia = info[3].As<Napi::Number>().DoubleValue();
          double gateDia   = info[4].As<Napi::Number>().DoubleValue();
          auto r = forge::mold::buildRunnerSystem(sprueTop, gateEntries,
                                                  sprueDia, runnerDia, gateDia);
          uint32_t sprueH =
            forge::ShapeRegistry::instance().add(r.sprue);
          auto runnersOut = Napi::Array::New(env2, r.runners.size());
          for (uint32_t i = 0; i < r.runners.size(); ++i) {
            uint32_t h = forge::ShapeRegistry::instance().add(r.runners[i]);
            runnersOut.Set(i, Napi::Number::New(env2, h));
          }
          auto gatesOut = Napi::Array::New(env2, r.gates.size());
          for (uint32_t i = 0; i < r.gates.size(); ++i) {
            uint32_t h = forge::ShapeRegistry::instance().add(r.gates[i]);
            gatesOut.Set(i, Napi::Number::New(env2, h));
          }
          auto out = Napi::Object::New(env2);
          out.Set("sprue",   Napi::Number::New(env2, sprueH));
          out.Set("runners", runnersOut);
          out.Set("gates",   gatesOut);
          return out;
        });
      }));

    exports.Set("mold", mold);

    // -------- Acoustics (Forge-175) -------------------------------------
    auto acoustics = Napi::Object::New(env);
    acoustics.Set("simulate", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 1 || !info[0].IsObject()) {
            throw Napi::TypeError::New(env2, "forge.acoustics.simulate: cfg required");
          }
          auto o = info[0].As<Napi::Object>();
          forge::acoustics::AcousticConfig cfg{};
          auto room = o.Get("room").As<Napi::Object>();
          cfg.room.Lx = room.Get("Lx").As<Napi::Number>().DoubleValue();
          cfg.room.Ly = room.Get("Ly").As<Napi::Number>().DoubleValue();
          cfg.room.Lz = room.Get("Lz").As<Napi::Number>().DoubleValue();
          auto wallsArr = room.Get("walls").As<Napi::Array>();
          for (uint32_t w = 0; w < 6 && w < wallsArr.Length(); ++w) {
            auto wb = wallsArr.Get(w).As<Napi::Float64Array>();
            for (std::size_t b = 0; b < forge::acoustics::NUM_BANDS && b < wb.ElementLength(); ++b) {
              cfg.room.walls[w][b] = wb.Data()[b];
            }
          }
          auto airArr = room.Get("airAtten").As<Napi::Float64Array>();
          for (std::size_t b = 0; b < forge::acoustics::NUM_BANDS && b < airArr.ElementLength(); ++b) {
            cfg.room.airAtten[b] = airArr.Data()[b];
          }
          cfg.sourceX = o.Get("sourceX").As<Napi::Number>().DoubleValue();
          cfg.sourceY = o.Get("sourceY").As<Napi::Number>().DoubleValue();
          cfg.sourceZ = o.Get("sourceZ").As<Napi::Number>().DoubleValue();
          cfg.recvX   = o.Get("recvX"  ).As<Napi::Number>().DoubleValue();
          cfg.recvY   = o.Get("recvY"  ).As<Napi::Number>().DoubleValue();
          cfg.recvZ   = o.Get("recvZ"  ).As<Napi::Number>().DoubleValue();
          cfg.maxOrder       = o.Get("maxOrder").As<Napi::Number>().Int32Value();
          cfg.speedOfSound   = o.Has("speedOfSound") ? o.Get("speedOfSound").As<Napi::Number>().DoubleValue() : 343.0;
          cfg.sampleRateHz   = o.Has("sampleRateHz") ? o.Get("sampleRateHz").As<Napi::Number>().DoubleValue() : 48000.0;
          cfg.irLengthSec    = o.Get("irLengthSec").As<Napi::Number>().DoubleValue();
          cfg.sourcePowerW   = o.Has("sourcePowerW") ? o.Get("sourcePowerW").As<Napi::Number>().DoubleValue() : 1e-3;
          cfg.randomSeed     = o.Has("randomSeed") ? static_cast<unsigned long>(o.Get("randomSeed").As<Napi::Number>().Int64Value()) : 1ul;

          auto r = forge::acoustics::simulate(cfg);

          auto out = Napi::Object::New(env2);
          out.Set("sampleRateHz", Napi::Number::New(env2, r.sampleRateHz));
          out.Set("samples",       Napi::Number::New(env2, r.samples));
          out.Set("imageSourcesEvaluated", Napi::Number::New(env2, r.imageSourcesEvaluated));
          out.Set("sabineRt60Mid", Napi::Number::New(env2, r.sabineRt60Mid));
          out.Set("edcStrideSamples", Napi::Number::New(env2, r.edcStrideSamples));

          auto cpyF64 = [&](const std::vector<double>& v) {
            auto a = Napi::Float64Array::New(env2, v.size());
            if (!v.empty()) std::memcpy(a.Data(), v.data(), v.size() * sizeof(double));
            return a;
          };
          out.Set("irCombined", cpyF64(r.irCombined));
          auto perBand = Napi::Array::New(env2, forge::acoustics::NUM_BANDS);
          auto edcArr  = Napi::Array::New(env2, forge::acoustics::NUM_BANDS);
          auto rt60Arr = Napi::Float64Array::New(env2, forge::acoustics::NUM_BANDS);
          auto c50Arr  = Napi::Float64Array::New(env2, forge::acoustics::NUM_BANDS);
          auto c80Arr  = Napi::Float64Array::New(env2, forge::acoustics::NUM_BANDS);
          auto d50Arr  = Napi::Float64Array::New(env2, forge::acoustics::NUM_BANDS);
          for (uint32_t b = 0; b < forge::acoustics::NUM_BANDS; ++b) {
            perBand.Set(b, cpyF64(r.irPerBand[b]));
            edcArr.Set(b,  cpyF64(r.edcDb[b]));
            rt60Arr.Data()[b] = r.rt60Sec[b];
            c50Arr.Data()[b]  = r.c50Db[b];
            c80Arr.Data()[b]  = r.c80Db[b];
            d50Arr.Data()[b]  = r.d50[b];
          }
          out.Set("irPerBand", perBand);
          out.Set("edcDb",     edcArr);
          out.Set("rt60Sec",   rt60Arr);
          out.Set("c50Db",     c50Arr);
          out.Set("c80Db",     c80Arr);
          out.Set("d50",       d50Arr);
          return out;
        });
      }));
    exports.Set("acoustics", acoustics);

    // -------- Welding distortion (Forge-174) ---------------------------
    auto welding = Napi::Object::New(env);
    welding.Set("simulateWeld", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 4) {
            throw Napi::TypeError::New(env2,
              "forge.welding.simulateWeld(mesh, mat, src, totalTimeSec, snapshotCount)");
          }
          auto mObj = info[0].As<Napi::Object>();
          forge::welding::TetMesh mesh{};
          auto na = mObj.Get("nodes").As<Napi::Float64Array>();
          mesh.nodes.assign(na.Data(), na.Data() + na.ElementLength());
          auto ta = mObj.Get("tets").As<Napi::Uint32Array>();
          mesh.tets.assign(ta.Data(), ta.Data() + ta.ElementLength());
          auto fa = mObj.Get("fixedDof").As<Napi::Uint8Array>();
          mesh.fixedDof.assign(fa.Data(), fa.Data() + fa.ElementLength());

          auto matObj = info[1].As<Napi::Object>();
          forge::welding::Material mat{};
          mat.rho     = matObj.Get("rho"    ).As<Napi::Number>().DoubleValue();
          mat.cp      = matObj.Get("cp"     ).As<Napi::Number>().DoubleValue();
          mat.k       = matObj.Get("k"      ).As<Napi::Number>().DoubleValue();
          mat.alpha   = matObj.Get("alpha"  ).As<Napi::Number>().DoubleValue();
          mat.E       = matObj.Get("E"      ).As<Napi::Number>().DoubleValue();
          mat.nu      = matObj.Get("nu"     ).As<Napi::Number>().DoubleValue();
          mat.sigmaY0 = matObj.Get("sigmaY0").As<Napi::Number>().DoubleValue();
          mat.Etan    = matObj.Get("Etan"   ).As<Napi::Number>().DoubleValue();
          mat.Tref    = matObj.Get("Tref"   ).As<Napi::Number>().DoubleValue();

          auto srcObj = info[2].As<Napi::Object>();
          forge::welding::GoldakSource src{};
          src.power = srcObj.Get("power").As<Napi::Number>().DoubleValue();
          src.a     = srcObj.Get("a"    ).As<Napi::Number>().DoubleValue();
          src.b     = srcObj.Get("b"    ).As<Napi::Number>().DoubleValue();
          src.cf    = srcObj.Get("cf"   ).As<Napi::Number>().DoubleValue();
          src.cr    = srcObj.Get("cr"   ).As<Napi::Number>().DoubleValue();
          src.ff    = srcObj.Get("ff"   ).As<Napi::Number>().DoubleValue();
          src.fr    = srcObj.Get("fr"   ).As<Napi::Number>().DoubleValue();
          src.speed = srcObj.Get("speed").As<Napi::Number>().DoubleValue();
          auto pa = srcObj.Get("pathXYZ").As<Napi::Float64Array>();
          src.pathXYZ.assign(pa.Data(), pa.Data() + pa.ElementLength());

          const double tt = info[3].As<Napi::Number>().DoubleValue();
          const int sc = (info.Length() > 4 && info[4].IsNumber())
                          ? info[4].As<Napi::Number>().Int32Value() : 4;
          auto r = forge::welding::simulateWeld(mesh, mat, src, tt, sc);

          auto out = Napi::Object::New(env2);
          auto cpyF64 = [&](const std::vector<double>& v) {
            auto a = Napi::Float64Array::New(env2, v.size());
            if (!v.empty()) std::memcpy(a.Data(), v.data(), v.size() * sizeof(double));
            return a;
          };
          out.Set("displacement",     cpyF64(r.displacement));
          out.Set("plasticStrain",    cpyF64(r.plasticStrain));
          out.Set("misesStressPa",    cpyF64(r.misesStressPa));
          out.Set("peakHazTempK",     cpyF64(r.peakHazTempK));
          out.Set("maxDisplacementMm",Napi::Number::New(env2, r.maxDisplacementMm));
          out.Set("maxMisesPa",       Napi::Number::New(env2, r.maxMisesPa));
          out.Set("maxTempK",         Napi::Number::New(env2, r.maxTempK));
          out.Set("snapshotsTaken",   Napi::Number::New(env2, r.snapshotsTaken));
          out.Set("thermalStepsTaken",Napi::Number::New(env2, r.thermalStepsTaken));
          return out;
        });
      }));
    exports.Set("welding", welding);

    // -------- glTF 2.0 export (Forge-178) ------------------------------
    auto gltfNs = Napi::Object::New(env);
    gltfNs.Set("exportGlb", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 2) {
            throw Napi::TypeError::New(env2,
              "forge.gltf.exportGlb(bodies, filepath, options?)");
          }
          if (!info[0].IsArray()) {
            throw Napi::TypeError::New(env2, "bodies must be an array");
          }
          auto arr = info[0].As<Napi::Array>();
          std::vector<forge::gltf::ExportBody> bodies;
          bodies.reserve(arr.Length());
          for (uint32_t i = 0; i < arr.Length(); ++i) {
            auto bo = arr.Get(i).As<Napi::Object>();
            forge::gltf::ExportBody b;
            b.handle = bo.Get("handle").As<Napi::Number>().Uint32Value();
            b.name   = bo.Has("name") && bo.Get("name").IsString()
                       ? bo.Get("name").As<Napi::String>().Utf8Value()
                       : ("body_" + std::to_string(i));
            if (bo.Has("baseColor") && bo.Get("baseColor").IsArray()) {
              auto c = bo.Get("baseColor").As<Napi::Array>();
              if (c.Length() >= 1) b.baseColorR = c.Get(uint32_t(0)).As<Napi::Number>().DoubleValue();
              if (c.Length() >= 2) b.baseColorG = c.Get(uint32_t(1)).As<Napi::Number>().DoubleValue();
              if (c.Length() >= 3) b.baseColorB = c.Get(uint32_t(2)).As<Napi::Number>().DoubleValue();
              if (c.Length() >= 4) b.baseColorA = c.Get(uint32_t(3)).As<Napi::Number>().DoubleValue();
            }
            if (bo.Has("metallic"))  b.metallicFactor  = bo.Get("metallic" ).As<Napi::Number>().DoubleValue();
            if (bo.Has("roughness")) b.roughnessFactor = bo.Get("roughness").As<Napi::Number>().DoubleValue();
            bodies.push_back(std::move(b));
          }
          const std::string filepath = info[1].As<Napi::String>().Utf8Value();
          forge::gltf::ExportOptions opts;
          if (info.Length() > 2 && info[2].IsObject()) {
            auto o = info[2].As<Napi::Object>();
            if (o.Has("deflection"))         opts.deflection         = o.Get("deflection").As<Napi::Number>().DoubleValue();
            if (o.Has("angularDeflection"))  opts.angularDeflection  = o.Get("angularDeflection").As<Napi::Number>().DoubleValue();
            if (o.Has("computeNormals"))     opts.computeNormals     = o.Get("computeNormals").As<Napi::Boolean>().Value();
            if (o.Has("generator") && o.Get("generator").IsString())
              opts.generator = o.Get("generator").As<Napi::String>().Utf8Value();
          }
          auto s = forge::gltf::writeGlb(bodies, filepath, opts);
          auto out = Napi::Object::New(env2);
          out.Set("bodiesWritten",   Napi::Number::New(env2, s.bodiesWritten));
          out.Set("verticesTotal",   Napi::Number::New(env2, s.verticesTotal));
          out.Set("trianglesTotal",  Napi::Number::New(env2, s.trianglesTotal));
          out.Set("fileSizeBytes",   Napi::Number::New(env2, static_cast<double>(s.fileSizeBytes)));
          out.Set("filepath",        Napi::String::New(env2, filepath));
          return out;
        });
      }));
    // Forge-198 — streaming variant
    gltfNs.Set("exportGlbStream", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 2) {
            throw Napi::TypeError::New(env2,
              "forge.gltf.exportGlbStream(bodies, filepath, options?)");
          }
          if (!info[0].IsArray()) {
            throw Napi::TypeError::New(env2, "bodies must be an array");
          }
          auto arr = info[0].As<Napi::Array>();
          std::vector<forge::gltf::ExportBody> bodies;
          bodies.reserve(arr.Length());
          for (uint32_t i = 0; i < arr.Length(); ++i) {
            auto bo = arr.Get(i).As<Napi::Object>();
            forge::gltf::ExportBody b;
            b.handle = bo.Get("handle").As<Napi::Number>().Uint32Value();
            b.name   = bo.Has("name") && bo.Get("name").IsString()
                       ? bo.Get("name").As<Napi::String>().Utf8Value()
                       : ("body_" + std::to_string(i));
            if (bo.Has("baseColor") && bo.Get("baseColor").IsArray()) {
              auto c = bo.Get("baseColor").As<Napi::Array>();
              if (c.Length() >= 1) b.baseColorR = c.Get(uint32_t(0)).As<Napi::Number>().DoubleValue();
              if (c.Length() >= 2) b.baseColorG = c.Get(uint32_t(1)).As<Napi::Number>().DoubleValue();
              if (c.Length() >= 3) b.baseColorB = c.Get(uint32_t(2)).As<Napi::Number>().DoubleValue();
              if (c.Length() >= 4) b.baseColorA = c.Get(uint32_t(3)).As<Napi::Number>().DoubleValue();
            }
            if (bo.Has("metallic"))  b.metallicFactor  = bo.Get("metallic" ).As<Napi::Number>().DoubleValue();
            if (bo.Has("roughness")) b.roughnessFactor = bo.Get("roughness").As<Napi::Number>().DoubleValue();
            bodies.push_back(std::move(b));
          }
          const std::string filepath = info[1].As<Napi::String>().Utf8Value();
          forge::gltf::ExportOptions opts;
          if (info.Length() > 2 && info[2].IsObject()) {
            auto o = info[2].As<Napi::Object>();
            if (o.Has("deflection"))         opts.deflection         = o.Get("deflection").As<Napi::Number>().DoubleValue();
            if (o.Has("angularDeflection"))  opts.angularDeflection  = o.Get("angularDeflection").As<Napi::Number>().DoubleValue();
            if (o.Has("computeNormals"))     opts.computeNormals     = o.Get("computeNormals").As<Napi::Boolean>().Value();
            if (o.Has("generator") && o.Get("generator").IsString())
              opts.generator = o.Get("generator").As<Napi::String>().Utf8Value();
          }
          auto s = forge::gltf::writeGlbStream(bodies, filepath, opts);
          auto out = Napi::Object::New(env2);
          out.Set("bodiesWritten",     Napi::Number::New(env2, s.bodiesWritten));
          out.Set("verticesTotal",     Napi::Number::New(env2, s.verticesTotal));
          out.Set("trianglesTotal",    Napi::Number::New(env2, s.trianglesTotal));
          out.Set("fileSizeBytes",     Napi::Number::New(env2, static_cast<double>(s.fileSizeBytes)));
          out.Set("peakBytesInMemory", Napi::Number::New(env2, static_cast<double>(s.peakBytesInMemory)));
          out.Set("filepath",          Napi::String::New(env2, filepath));
          return out;
        });
      }));
    exports.Set("gltf", gltfNs);

    // -------- Cost estimation (Forge-179) ------------------------------
    auto costNs = Napi::Object::New(env);
    auto readMaterials = [](Napi::Env e, Napi::Array arr) -> std::vector<forge::cost::MaterialCatalogueEntry> {
        std::vector<forge::cost::MaterialCatalogueEntry> out;
        out.reserve(arr.Length());
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            auto o = arr.Get(i).As<Napi::Object>();
            forge::cost::MaterialCatalogueEntry m{};
            m.name              = o.Get("name").As<Napi::String>().Utf8Value();
            m.densityKgM3       = o.Get("densityKgM3").As<Napi::Number>().DoubleValue();
            m.pricePerKgUSD     = o.Get("pricePerKgUSD").As<Napi::Number>().DoubleValue();
            m.mrrEndmillCm3Min  = o.Get("mrrEndmillCm3Min").As<Napi::Number>().DoubleValue();
            m.mrrDrillCm3Min    = o.Get("mrrDrillCm3Min").As<Napi::Number>().DoubleValue();
            m.mrrTurnCm3Min     = o.Get("mrrTurnCm3Min").As<Napi::Number>().DoubleValue();
            m.co2PerKg          = o.Has("co2PerKg")
                ? o.Get("co2PerKg").As<Napi::Number>().DoubleValue() : 0.0;
            out.push_back(std::move(m));
        }
        (void)e;
        return out;
    };
    auto readProcesses = [](Napi::Env e, Napi::Array arr) -> std::vector<forge::cost::ProcessEntry> {
        std::vector<forge::cost::ProcessEntry> out;
        out.reserve(arr.Length());
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            auto o = arr.Get(i).As<Napi::Object>();
            forge::cost::ProcessEntry p{};
            p.name         = o.Get("name").As<Napi::String>().Utf8Value();
            p.setupMin     = o.Get("setupMin").As<Napi::Number>().DoubleValue();
            p.labourUsdMin = o.Get("labourUsdMin").As<Napi::Number>().DoubleValue();
            out.push_back(std::move(p));
        }
        (void)e;
        return out;
    };
    auto readBody = [](Napi::Object o) -> forge::cost::BodyCost {
        forge::cost::BodyCost b{};
        b.materialName    = o.Get("materialName").As<Napi::String>().Utf8Value();
        b.volumeCm3       = o.Get("volumeCm3").As<Napi::Number>().DoubleValue();
        b.stockVolumeCm3  = o.Get("stockVolumeCm3").As<Napi::Number>().DoubleValue();
        b.processName     = o.Get("processName").As<Napi::String>().Utf8Value();
        b.toolFamily      = o.Has("toolFamily") ? o.Get("toolFamily").As<Napi::Number>().Int32Value() : 0;
        b.qty             = o.Has("qty") ? o.Get("qty").As<Napi::Number>().Int32Value() : 1;
        return b;
    };
    auto writeResult = [](Napi::Env e, const forge::cost::CostResult& r) {
        auto out = Napi::Object::New(e);
        out.Set("unitMaterialUsd",  Napi::Number::New(e, r.unitMaterialUsd));
        out.Set("unitMachiningUsd", Napi::Number::New(e, r.unitMachiningUsd));
        out.Set("unitSetupUsd",     Napi::Number::New(e, r.unitSetupUsd));
        out.Set("unitLabourUsd",    Napi::Number::New(e, r.unitLabourUsd));
        out.Set("unitUsd",          Napi::Number::New(e, r.unitUsd));
        out.Set("batchUsd",         Napi::Number::New(e, r.batchUsd));
        out.Set("machiningTimeMin", Napi::Number::New(e, r.machiningTimeMin));
        out.Set("massKg",           Napi::Number::New(e, r.massKg));
        auto trn = Napi::Array::New(e, r.tornado.size());
        for (size_t i = 0; i < r.tornado.size(); ++i) {
            auto t = Napi::Object::New(e);
            t.Set("label", Napi::String::New(e, r.tornado[i].label));
            t.Set("usd",   Napi::Number::New(e, r.tornado[i].usd));
            trn.Set((uint32_t)i, t);
        }
        out.Set("tornado", trn);
        return out;
    };
    costNs.Set("computeUnit", Napi::Function::New(env,
      [readMaterials, readProcesses, readBody, writeResult](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::cost::CostInputs in;
          in.body      = readBody(o.Get("body").As<Napi::Object>());
          in.materials = readMaterials(env2, o.Get("materials").As<Napi::Array>());
          in.processes = readProcesses(env2, o.Get("processes").As<Napi::Array>());
          auto r = forge::cost::computeUnitCost(in);
          return writeResult(env2, r);
        });
      }));
    costNs.Set("computeProject", Napi::Function::New(env,
      [readMaterials, readProcesses, readBody, writeResult](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (!info[0].IsArray()) {
            throw Napi::TypeError::New(env2, "forge.cost.computeProject: expected array of CostInputs");
          }
          auto arr = info[0].As<Napi::Array>();
          std::vector<forge::cost::CostInputs> inputs;
          inputs.reserve(arr.Length());
          for (uint32_t i = 0; i < arr.Length(); ++i) {
            auto o = arr.Get(i).As<Napi::Object>();
            forge::cost::CostInputs ci;
            ci.body      = readBody(o.Get("body").As<Napi::Object>());
            ci.materials = readMaterials(env2, o.Get("materials").As<Napi::Array>());
            ci.processes = readProcesses(env2, o.Get("processes").As<Napi::Array>());
            inputs.push_back(std::move(ci));
          }
          auto P = forge::cost::computeProjectCost(inputs);
          auto out = Napi::Object::New(env2);
          out.Set("totalMaterialUsd",  Napi::Number::New(env2, P.totalMaterialUsd));
          out.Set("totalMachiningUsd", Napi::Number::New(env2, P.totalMachiningUsd));
          out.Set("totalSetupUsd",     Napi::Number::New(env2, P.totalSetupUsd));
          out.Set("totalLabourUsd",    Napi::Number::New(env2, P.totalLabourUsd));
          out.Set("totalUsd",          Napi::Number::New(env2, P.totalUsd));
          out.Set("totalQty",          Napi::Number::New(env2, P.totalQty));
          auto pa = Napi::Array::New(env2, P.perBody.size());
          for (size_t i = 0; i < P.perBody.size(); ++i) {
            pa.Set((uint32_t)i, writeResult(env2, P.perBody[i]));
          }
          out.Set("perBody", pa);
          return out;
        });
      }));
    exports.Set("cost", costNs);

    // -------- Carbon-footprint LCA (Forge-180) -------------------------
    auto carbonNs = Napi::Object::New(env);
    carbonNs.Set("computeLca", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 1 || !info[0].IsObject()) {
            throw Napi::TypeError::New(env2, "forge.carbon.computeLca: cfg required");
          }
          auto o = info[0].As<Napi::Object>();
          forge::carbon::LcaInputs in{};
          auto m = o.Get("material").As<Napi::Object>();
          in.material.name             = m.Get("name").As<Napi::String>().Utf8Value();
          in.material.densityKgM3      = m.Get("densityKgM3").As<Napi::Number>().DoubleValue();
          in.material.co2PerKg         = m.Get("co2PerKg").As<Napi::Number>().DoubleValue();
          in.material.recycledContent  = m.Has("recycledContent")
              ? m.Get("recycledContent").As<Napi::Number>().DoubleValue() : 0.0;
          in.material.recyclingCredit  = m.Has("recyclingCredit")
              ? m.Get("recyclingCredit").As<Napi::Number>().DoubleValue() : 0.0;
          auto p = o.Get("process").As<Napi::Object>();
          in.process.name           = p.Get("name").As<Napi::String>().Utf8Value();
          in.process.spindleKW      = p.Get("spindleKW").As<Napi::Number>().DoubleValue();
          in.process.overheadFactor = p.Has("overheadFactor")
              ? p.Get("overheadFactor").As<Napi::Number>().DoubleValue() : 1.2;
          in.volumeCm3       = o.Get("volumeCm3").As<Napi::Number>().DoubleValue();
          in.stockVolumeCm3  = o.Has("stockVolumeCm3")
              ? o.Get("stockVolumeCm3").As<Napi::Number>().DoubleValue() : in.volumeCm3;
          in.machiningTimeMin = o.Has("machiningTimeMin")
              ? o.Get("machiningTimeMin").As<Napi::Number>().DoubleValue() : 0.0;
          in.gridCo2PerKwh   = o.Has("gridCo2PerKwh")
              ? o.Get("gridCo2PerKwh").As<Napi::Number>().DoubleValue() : 0.385;
          in.transportKm     = o.Has("transportKm")
              ? o.Get("transportKm").As<Napi::Number>().DoubleValue() : 500.0;
          in.transportEmissionsPerTkm = o.Has("transportEmissionsPerTkm")
              ? o.Get("transportEmissionsPerTkm").As<Napi::Number>().DoubleValue() : 0.062;
          in.qty             = o.Has("qty") ? o.Get("qty").As<Napi::Number>().Int32Value() : 1;
          auto R = forge::carbon::computeLca(in);
          auto out = Napi::Object::New(env2);
          out.Set("massKg",                  Napi::Number::New(env2, R.massKg));
          out.Set("unitMaterialKgCo2",       Napi::Number::New(env2, R.unitMaterialKgCo2));
          out.Set("unitManufKgCo2",          Napi::Number::New(env2, R.unitManufKgCo2));
          out.Set("unitTransportKgCo2",      Napi::Number::New(env2, R.unitTransportKgCo2));
          out.Set("unitRecyclingCreditKgCo2",Napi::Number::New(env2, R.unitRecyclingCreditKgCo2));
          out.Set("unitTotalKgCo2",          Napi::Number::New(env2, R.unitTotalKgCo2));
          out.Set("batchTotalKgCo2",         Napi::Number::New(env2, R.batchTotalKgCo2));
          out.Set("energyKwh",               Napi::Number::New(env2, R.energyKwh));
          return out;
        });
      }));
    exports.Set("carbon", carbonNs);

    // -------- Sun-path / daylight (Forge-181) --------------------------
    auto sunNs = Napi::Object::New(env);
    auto writeSolarPos = [](Napi::Env e, const forge::sun::SolarPosition& s) {
        auto o = Napi::Object::New(e);
        o.Set("altitudeDeg",      Napi::Number::New(e, s.altitudeDeg));
        o.Set("azimuthDeg",       Napi::Number::New(e, s.azimuthDeg));
        o.Set("zenithDeg",        Napi::Number::New(e, s.zenithDeg));
        o.Set("declinationDeg",   Napi::Number::New(e, s.declinationDeg));
        o.Set("eqOfTimeMin",      Napi::Number::New(e, s.eqOfTimeMin));
        o.Set("sunriseLocalHour", Napi::Number::New(e, s.sunriseLocalHour));
        o.Set("sunsetLocalHour",  Napi::Number::New(e, s.sunsetLocalHour));
        o.Set("daylightHours",    Napi::Number::New(e, s.daylightHours));
        o.Set("sunUp",            Napi::Boolean::New(e, s.sunUp));
        return o;
    };
    sunNs.Set("compute", Napi::Function::New(env,
      [writeSolarPos](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          const int year     = o.Get("year").As<Napi::Number>().Int32Value();
          const int dayOfYear= o.Get("dayOfYear").As<Napi::Number>().Int32Value();
          const double hour  = o.Get("localHour").As<Napi::Number>().DoubleValue();
          const double lat   = o.Get("latitudeDeg").As<Napi::Number>().DoubleValue();
          const double lon   = o.Get("longitudeDeg").As<Napi::Number>().DoubleValue();
          const double tz    = o.Get("tzOffsetHours").As<Napi::Number>().DoubleValue();
          auto s = forge::sun::compute(year, dayOfYear, hour, lat, lon, tz);
          return writeSolarPos(env2, s);
        });
      }));
    sunNs.Set("sweepHourly", Napi::Function::New(env,
      [writeSolarPos](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          const int year      = o.Get("year").As<Napi::Number>().Int32Value();
          const int dayOfYear = o.Get("dayOfYear").As<Napi::Number>().Int32Value();
          const double lat    = o.Get("latitudeDeg").As<Napi::Number>().DoubleValue();
          const double lon    = o.Get("longitudeDeg").As<Napi::Number>().DoubleValue();
          const double tz     = o.Get("tzOffsetHours").As<Napi::Number>().DoubleValue();
          auto samples = forge::sun::sweepHourly(year, dayOfYear, lat, lon, tz);
          auto arr = Napi::Array::New(env2, samples.size());
          for (size_t i = 0; i < samples.size(); ++i) {
            auto s = Napi::Object::New(env2);
            s.Set("localHour", Napi::Number::New(env2, samples[i].localHour));
            s.Set("pos", writeSolarPos(env2, samples[i].pos));
            arr.Set((uint32_t)i, s);
          }
          return arr;
        });
      }));
    sunNs.Set("annualNoon", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          const int year    = o.Get("year").As<Napi::Number>().Int32Value();
          const double lat  = o.Get("latitudeDeg").As<Napi::Number>().DoubleValue();
          const double lon  = o.Get("longitudeDeg").As<Napi::Number>().DoubleValue();
          const double tz   = o.Get("tzOffsetHours").As<Napi::Number>().DoubleValue();
          auto noons = forge::sun::annualNoon(year, lat, lon, tz);
          auto arr = Napi::Array::New(env2, noons.size());
          for (size_t i = 0; i < noons.size(); ++i) {
            auto s = Napi::Object::New(env2);
            s.Set("monthOneBased",  Napi::Number::New(env2, noons[i].monthOneBased));
            s.Set("dayOfYear",      Napi::Number::New(env2, noons[i].dayOfYear));
            s.Set("altitudeDeg",    Napi::Number::New(env2, noons[i].altitudeDeg));
            s.Set("azimuthDeg",     Napi::Number::New(env2, noons[i].azimuthDeg));
            s.Set("daylightHours",  Napi::Number::New(env2, noons[i].daylightHours));
            arr.Set((uint32_t)i, s);
          }
          return arr;
        });
      }));
    exports.Set("sun", sunNs);

    // -------- Tolerance stack-up (Forge-185) ---------------------------
    auto tolNs = Napi::Object::New(env);
    tolNs.Set("compute", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 1 || !info[0].IsObject()) {
            throw Napi::TypeError::New(env2, "forge.tolerance.compute: cfg required");
          }
          auto o = info[0].As<Napi::Object>();
          forge::tolerance::StackInputs in{};
          auto chain = o.Get("chain").As<Napi::Array>();
          for (uint32_t i = 0; i < chain.Length(); ++i) {
            auto co = chain.Get(i).As<Napi::Object>();
            forge::tolerance::Dimension d{};
            d.name     = co.Get("name").As<Napi::String>().Utf8Value();
            d.nominal  = co.Get("nominal").As<Napi::Number>().DoubleValue();
            d.tolPlus  = co.Get("tolPlus").As<Napi::Number>().DoubleValue();
            d.tolMinus = co.Get("tolMinus").As<Napi::Number>().DoubleValue();
            const int distInt = co.Has("dist")
                ? co.Get("dist").As<Napi::Number>().Int32Value() : 0;
            d.dist = static_cast<forge::tolerance::Distribution>(
                static_cast<std::uint8_t>(distInt));
            in.chain.push_back(std::move(d));
          }
          in.USL        = o.Get("USL").As<Napi::Number>().DoubleValue();
          in.LSL        = o.Get("LSL").As<Napi::Number>().DoubleValue();
          in.mcSamples  = o.Has("mcSamples")
              ? o.Get("mcSamples").As<Napi::Number>().Int32Value() : 10000;
          in.randomSeed = o.Has("randomSeed")
              ? static_cast<unsigned long>(o.Get("randomSeed").As<Napi::Number>().Int64Value()) : 42ul;
          auto r = forge::tolerance::compute(in);
          auto out = Napi::Object::New(env2);
          out.Set("worstCaseNominal", Napi::Number::New(env2, r.worstCaseNominal));
          out.Set("worstCaseHigh",    Napi::Number::New(env2, r.worstCaseHigh));
          out.Set("worstCaseLow",     Napi::Number::New(env2, r.worstCaseLow));
          out.Set("rssMu",            Napi::Number::New(env2, r.rssMu));
          out.Set("rssSigma",         Napi::Number::New(env2, r.rssSigma));
          out.Set("rssCp",            Napi::Number::New(env2, r.rssCp));
          out.Set("rssCpk",           Napi::Number::New(env2, r.rssCpk));
          out.Set("mcMu",             Napi::Number::New(env2, r.mcMu));
          out.Set("mcSigma",          Napi::Number::New(env2, r.mcSigma));
          out.Set("mcP05",            Napi::Number::New(env2, r.mcP05));
          out.Set("mcP50",            Napi::Number::New(env2, r.mcP50));
          out.Set("mcP95",            Napi::Number::New(env2, r.mcP95));
          out.Set("mcCp",             Napi::Number::New(env2, r.mcCp));
          out.Set("mcCpk",            Napi::Number::New(env2, r.mcCpk));
          out.Set("mcYieldPct",       Napi::Number::New(env2, r.mcYieldPct));
          return out;
        });
      }));
    exports.Set("tolerance", tolNs);

    // -------- HVAC ductwork (Forge-186) --------------------------------
    auto ductNs = Napi::Object::New(env);
    ductNs.Set("compute", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::duct::DuctInputs in{};
          in.flowRateM3s = o.Get("flowRateM3s").As<Napi::Number>().DoubleValue();
          auto a = o.Get("air").As<Napi::Object>();
          in.air.rhoKgM3   = a.Get("rhoKgM3").As<Napi::Number>().DoubleValue();
          in.air.nuM2s     = a.Get("nuM2s").As<Napi::Number>().DoubleValue();
          in.air.epsilonMm = a.Get("epsilonMm").As<Napi::Number>().DoubleValue();
          auto rt = o.Get("route").As<Napi::Array>();
          for (uint32_t i = 0; i < rt.Length(); ++i) {
            auto so = rt.Get(i).As<Napi::Object>();
            forge::duct::Segment s{};
            s.kind = static_cast<forge::duct::SegKind>(
                static_cast<std::uint8_t>(so.Get("kind").As<Napi::Number>().Int32Value()));
            s.diameterMm = so.Has("diameterMm") ? so.Get("diameterMm").As<Napi::Number>().DoubleValue() : 0;
            s.widthMm    = so.Has("widthMm"   ) ? so.Get("widthMm"   ).As<Napi::Number>().DoubleValue() : 0;
            s.heightMm   = so.Has("heightMm"  ) ? so.Get("heightMm"  ).As<Napi::Number>().DoubleValue() : 0;
            s.lengthM    = so.Has("lengthM"   ) ? so.Get("lengthM"   ).As<Napi::Number>().DoubleValue() : 0;
            s.rOverD     = so.Has("rOverD"    ) ? so.Get("rOverD"    ).As<Napi::Number>().DoubleValue() : 1.0;
            in.route.push_back(s);
          }
          auto r = forge::duct::compute(in);
          auto out = Napi::Object::New(env2);
          out.Set("totalDropPa",   Napi::Number::New(env2, r.totalDropPa));
          out.Set("maxVelocityMs", Napi::Number::New(env2, r.maxVelocityMs));
          out.Set("totalLengthM",  Napi::Number::New(env2, r.totalLengthM));
          auto sa = Napi::Array::New(env2, r.segments.size());
          for (size_t i = 0; i < r.segments.size(); ++i) {
            auto seg = Napi::Object::New(env2);
            seg.Set("kind",                Napi::Number::New(env2, static_cast<int>(r.segments[i].kind)));
            seg.Set("hydraulicDiameterMm", Napi::Number::New(env2, r.segments[i].hydraulicDiameterMm));
            seg.Set("areaMm2",             Napi::Number::New(env2, r.segments[i].areaMm2));
            seg.Set("velocityMs",          Napi::Number::New(env2, r.segments[i].velocityMs));
            seg.Set("reynolds",            Napi::Number::New(env2, r.segments[i].reynolds));
            seg.Set("frictionFactor",      Napi::Number::New(env2, r.segments[i].frictionFactor));
            seg.Set("lossCoefficientK",    Napi::Number::New(env2, r.segments[i].lossCoefficientK));
            seg.Set("frictionDropPa",      Napi::Number::New(env2, r.segments[i].frictionDropPa));
            seg.Set("fittingDropPa",       Napi::Number::New(env2, r.segments[i].fittingDropPa));
            seg.Set("totalDropPa",         Napi::Number::New(env2, r.segments[i].totalDropPa));
            seg.Set("lengthM",             Napi::Number::New(env2, r.segments[i].lengthM));
            sa.Set((uint32_t)i, seg);
          }
          out.Set("segments", sa);
          return out;
        });
      }));
    ductNs.Set("sizeRoundForFriction", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          const double Q   = info[0].As<Napi::Number>().DoubleValue();
          const double tgt = info[1].As<Napi::Number>().DoubleValue();
          auto a = info[2].As<Napi::Object>();
          forge::duct::DuctAir air{};
          air.rhoKgM3   = a.Get("rhoKgM3").As<Napi::Number>().DoubleValue();
          air.nuM2s     = a.Get("nuM2s").As<Napi::Number>().DoubleValue();
          air.epsilonMm = a.Get("epsilonMm").As<Napi::Number>().DoubleValue();
          return Napi::Number::New(env2, forge::duct::sizeRoundForFriction(Q, tgt, air));
        });
      }));
    exports.Set("duct", ductNs);

    // -------- Generative variants (Forge-187) --------------------------
    auto varNs = Napi::Object::New(env);
    varNs.Set("latinHypercube", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::variants::LhsInputs in{};
          auto dimsArr = o.Get("dims").As<Napi::Array>();
          for (uint32_t i = 0; i < dimsArr.Length(); ++i) {
            auto d = dimsArr.Get(i).As<Napi::Object>();
            forge::variants::DimSpec s{};
            s.name = d.Get("name").As<Napi::String>().Utf8Value();
            s.lo   = d.Get("lo").As<Napi::Number>().DoubleValue();
            s.hi   = d.Get("hi").As<Napi::Number>().DoubleValue();
            in.dims.push_back(std::move(s));
          }
          in.samples    = o.Get("samples").As<Napi::Number>().Int32Value();
          in.randomSeed = o.Has("randomSeed")
              ? static_cast<unsigned long>(o.Get("randomSeed").As<Napi::Number>().Int64Value())
              : 42ul;
          auto r = forge::variants::latinHypercube(in);
          auto out = Napi::Object::New(env2);
          out.Set("nDims",    Napi::Number::New(env2, r.nDims));
          out.Set("nSamples", Napi::Number::New(env2, r.nSamples));
          auto va = Napi::Float64Array::New(env2, r.values.size());
          if (!r.values.empty()) {
            std::memcpy(va.Data(), r.values.data(), r.values.size() * sizeof(double));
          }
          out.Set("values", va);
          return out;
        });
      }));
    varNs.Set("paretoFront", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto objArr = info[0].As<Napi::Float64Array>();
          const int nObj = info[1].As<Napi::Number>().Int32Value();
          std::vector<int> sign;
          auto signArr = info[2].As<Napi::Array>();
          for (uint32_t i = 0; i < signArr.Length(); ++i) {
            sign.push_back(signArr.Get(i).As<Napi::Number>().Int32Value());
          }
          std::vector<double> objs(objArr.Data(), objArr.Data() + objArr.ElementLength());
          auto idx = forge::variants::paretoFront(objs, nObj, sign);
          auto arr = Napi::Uint32Array::New(env2, idx.size());
          if (!idx.empty()) {
            std::memcpy(arr.Data(), idx.data(), idx.size() * sizeof(uint32_t));
          }
          return arr;
        });
      }));
    exports.Set("variants", varNs);

    // -------- HVAC psychrometric (Forge-192) ---------------------------
    auto psyNs = Napi::Object::New(env);
    psyNs.Set("saturationPressurePa", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          const double T = info[0].As<Napi::Number>().DoubleValue();
          return Napi::Number::New(info.Env(), forge::psychro::saturationPressurePa(T));
        });
      }));
    psyNs.Set("humidityRatio", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          const double pw = info[0].As<Napi::Number>().DoubleValue();
          const double pAtm = info[1].As<Napi::Number>().DoubleValue();
          return Napi::Number::New(info.Env(), forge::psychro::humidityRatio(pw, pAtm));
        });
      }));
    psyNs.Set("dewPointC", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          const double pw = info[0].As<Napi::Number>().DoubleValue();
          return Napi::Number::New(info.Env(), forge::psychro::dewPointC(pw));
        });
      }));
    psyNs.Set("wetBulbC", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          const double Tdb = info[0].As<Napi::Number>().DoubleValue();
          const double W = info[1].As<Napi::Number>().DoubleValue();
          const double pAtm = info[2].As<Napi::Number>().DoubleValue();
          return Napi::Number::New(info.Env(), forge::psychro::wetBulbC(Tdb, W, pAtm));
        });
      }));
    psyNs.Set("stateFromTwo", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          const int mask = info[0].As<Napi::Number>().Int32Value();
          const double a = info[1].As<Napi::Number>().DoubleValue();
          const double b = info[2].As<Napi::Number>().DoubleValue();
          const double pAtm = info[3].As<Napi::Number>().DoubleValue();
          auto s = forge::psychro::stateFromTwo(mask, a, b, pAtm);
          auto o = Napi::Object::New(env2);
          o.Set("tdbC",             Napi::Number::New(env2, s.tdbC));
          o.Set("rh",               Napi::Number::New(env2, s.rh));
          o.Set("humidityRatio",    Napi::Number::New(env2, s.humidityRatio));
          o.Set("tdpC",             Napi::Number::New(env2, s.tdpC));
          o.Set("twbC",             Napi::Number::New(env2, s.twbC));
          o.Set("enthalpyKJperKg",  Napi::Number::New(env2, s.enthalpyKJperKg));
          o.Set("vapourPressurePa", Napi::Number::New(env2, s.vapourPressurePa));
          o.Set("satPressurePa",    Napi::Number::New(env2, s.satPressurePa));
          o.Set("atmPressurePa",    Napi::Number::New(env2, s.atmPressurePa));
          return o;
        });
      }));
    exports.Set("psychro", psyNs);

    // -------- Electrical circuit analysis (Forge-190) ------------------
    auto cirNs = Napi::Object::New(env);
    auto readDcInputs = [](Napi::Env e, Napi::Object o) {
        forge::circuit::DCInputs in{};
        in.nodeCount = o.Get("nodeCount").As<Napi::Number>().Uint32Value();
        auto arr = o.Get("comps").As<Napi::Array>();
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            auto co = arr.Get(i).As<Napi::Object>();
            forge::circuit::Component c{};
            c.kind = static_cast<forge::circuit::Kind>(
                static_cast<std::uint8_t>(co.Get("kind").As<Napi::Number>().Int32Value()));
            c.name  = co.Has("name") && co.Get("name").IsString()
                ? co.Get("name").As<Napi::String>().Utf8Value() : "";
            c.nA    = co.Get("nA").As<Napi::Number>().Uint32Value();
            c.nB    = co.Get("nB").As<Napi::Number>().Uint32Value();
            c.value = co.Get("value").As<Napi::Number>().DoubleValue();
            in.comps.push_back(std::move(c));
        }
        (void)e;
        return in;
    };
    cirNs.Set("dcAnalysis", Napi::Function::New(env,
      [readDcInputs](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto in = readDcInputs(env2, info[0].As<Napi::Object>());
          auto r = forge::circuit::dcAnalysis(in);
          auto out = Napi::Object::New(env2);
          auto nv = Napi::Float64Array::New(env2, r.nodeVoltages.size());
          std::memcpy(nv.Data(), r.nodeVoltages.data(),
                      r.nodeVoltages.size() * sizeof(double));
          out.Set("nodeVoltages", nv);
          auto ic = Napi::Float64Array::New(env2, r.vSourceCurrents.size());
          if (!r.vSourceCurrents.empty()) {
            std::memcpy(ic.Data(), r.vSourceCurrents.data(),
                        r.vSourceCurrents.size() * sizeof(double));
          }
          out.Set("vSourceCurrents", ic);
          return out;
        });
      }));
    cirNs.Set("acAnalysis", Napi::Function::New(env,
      [readDcInputs](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto in = readDcInputs(env2, info[0].As<Napi::Object>());
          auto fArr = info[1].As<Napi::Float64Array>();
          std::vector<double> freqs(fArr.Data(), fArr.Data() + fArr.ElementLength());
          auto r = forge::circuit::acAnalysis(in, freqs);
          auto out = Napi::Object::New(env2);
          auto fa = Napi::Float64Array::New(env2, r.frequencies.size());
          std::memcpy(fa.Data(), r.frequencies.data(),
                      r.frequencies.size() * sizeof(double));
          out.Set("frequencies", fa);
          auto va = Napi::Array::New(env2, r.nodeVoltages.size());
          for (size_t i = 0; i < r.nodeVoltages.size(); ++i) {
            auto magArr = Napi::Float64Array::New(env2, r.nodeVoltages[i].size());
            auto phaseArr = Napi::Float64Array::New(env2, r.nodeVoltages[i].size());
            for (size_t k = 0; k < r.nodeVoltages[i].size(); ++k) {
              magArr.Data()[k]   = std::abs(r.nodeVoltages[i][k]);
              phaseArr.Data()[k] = std::arg(r.nodeVoltages[i][k]);
            }
            auto pair = Napi::Object::New(env2);
            pair.Set("magnitude", magArr);
            pair.Set("phase",     phaseArr);
            va.Set((uint32_t)i, pair);
          }
          out.Set("nodeVoltages", va);
          return out;
        });
      }));
    exports.Set("circuit", cirNs);

    // -------- Terrain (Forge-191) --------------------------------------
    auto terNs = Napi::Object::New(env);
    terNs.Set("delaunay", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          forge::terrain::DelaunayInputs in{};
          auto obj = info[0].As<Napi::Object>();
          auto p = obj.Get("points").As<Napi::Float64Array>();
          in.points.assign(p.Data(), p.Data() + p.ElementLength());
          auto r = forge::terrain::triangulate(in);
          auto out = Napi::Object::New(env2);
          out.Set("n", Napi::Number::New(env2, r.n));
          auto t = Napi::Uint32Array::New(env2, r.triangles.size());
          if (!r.triangles.empty()) {
            std::memcpy(t.Data(), r.triangles.data(),
                        r.triangles.size() * sizeof(uint32_t));
          }
          out.Set("triangles", t);
          return out;
        });
      }));
    terNs.Set("cutFillVsPlane", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::terrain::CutFillInputs in{};
          auto p = o.Get("points").As<Napi::Float64Array>();
          in.points.assign(p.Data(), p.Data() + p.ElementLength());
          auto t = o.Get("triangles").As<Napi::Uint32Array>();
          in.triangles.assign(t.Data(), t.Data() + t.ElementLength());
          in.a = o.Get("a").As<Napi::Number>().DoubleValue();
          in.b = o.Get("b").As<Napi::Number>().DoubleValue();
          in.c = o.Get("c").As<Napi::Number>().DoubleValue();
          auto r = forge::terrain::cutFillVsPlane(in);
          auto out = Napi::Object::New(env2);
          out.Set("cutVolume",  Napi::Number::New(env2, r.cutVolume));
          out.Set("fillVolume", Napi::Number::New(env2, r.fillVolume));
          out.Set("netVolume",  Napi::Number::New(env2, r.netVolume));
          out.Set("tinArea",    Napi::Number::New(env2, r.tinArea));
          return out;
        });
      }));
    exports.Set("terrain", terNs);

    // -------- NURBS surface fit (Forge-194) ----------------------------
    auto nfNs = Napi::Object::New(env);
    nfNs.Set("fitSurface", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::nurbsfit::FitInputs in{};
          auto p = o.Get("points").As<Napi::Float64Array>();
          in.points.assign(p.Data(), p.Data() + p.ElementLength());
          in.uCount = o.Get("uCount").As<Napi::Number>().Int32Value();
          in.vCount = o.Get("vCount").As<Napi::Number>().Int32Value();
          auto r = forge::nurbsfit::fitSurface(in);
          auto out = Napi::Object::New(env2);
          out.Set("uCount", Napi::Number::New(env2, r.uCount));
          out.Set("vCount", Napi::Number::New(env2, r.vCount));
          out.Set("xMin",   Napi::Number::New(env2, r.xMin));
          out.Set("xMax",   Napi::Number::New(env2, r.xMax));
          out.Set("yMin",   Napi::Number::New(env2, r.yMin));
          out.Set("yMax",   Napi::Number::New(env2, r.yMax));
          out.Set("samples",Napi::Number::New(env2, r.samples));
          out.Set("maxAbsResidual", Napi::Number::New(env2, r.maxAbsResidual));
          out.Set("rmsResidual",    Napi::Number::New(env2, r.rmsResidual));
          auto cz = Napi::Float64Array::New(env2, r.controlZ.size());
          std::memcpy(cz.Data(), r.controlZ.data(),
                      r.controlZ.size() * sizeof(double));
          out.Set("controlZ", cz);
          auto rs = Napi::Float64Array::New(env2, r.residuals.size());
          if (!r.residuals.empty()) {
            std::memcpy(rs.Data(), r.residuals.data(),
                        r.residuals.size() * sizeof(double));
          }
          out.Set("residuals", rs);
          return out;
        });
      }));
    exports.Set("nurbsfit", nfNs);

    // -------- Mesh repair (Forge-200) ----------------------------------
    auto mrNs = Napi::Object::New(env);

    auto unpackMesh = [](Napi::Env e, Napi::Object o) -> forge::meshrepair::Mesh {
        forge::meshrepair::Mesh m;
        auto pos = o.Get("positions").As<Napi::Float32Array>();
        auto idx = o.Get("indices").As<Napi::Uint32Array>();
        m.positions.assign(pos.Data(), pos.Data() + pos.ElementLength());
        m.indices.assign(idx.Data(), idx.Data() + idx.ElementLength());
        (void)e;
        return m;
    };
    auto packMesh = [](Napi::Env e, const forge::meshrepair::Mesh& m) -> Napi::Object {
        auto out = Napi::Object::New(e);
        auto pos = Napi::Float32Array::New(e, m.positions.size());
        if (!m.positions.empty())
            std::memcpy(pos.Data(), m.positions.data(), m.positions.size() * sizeof(float));
        auto idx = Napi::Uint32Array::New(e, m.indices.size());
        if (!m.indices.empty())
            std::memcpy(idx.Data(), m.indices.data(), m.indices.size() * sizeof(std::uint32_t));
        out.Set("positions", pos);
        out.Set("indices",   idx);
        return out;
    };
    auto packStats = [](Napi::Env e, const forge::meshrepair::Stats& s) -> Napi::Object {
        auto o = Napi::Object::New(e);
        o.Set("vertexCount",          Napi::Number::New(e, s.vertexCount));
        o.Set("triangleCount",        Napi::Number::New(e, s.triangleCount));
        o.Set("boundaryEdgeCount",    Napi::Number::New(e, s.boundaryEdgeCount));
        o.Set("nonManifoldEdgeCount", Napi::Number::New(e, s.nonManifoldEdgeCount));
        return o;
    };

    mrNs.Set("analyse", Napi::Function::New(env,
      [unpackMesh, packStats](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto in = unpackMesh(env2, info[0].As<Napi::Object>());
          return packStats(env2, forge::meshrepair::analyse(in));
        });
      }));
    mrNs.Set("dedupeVertices", Napi::Function::New(env,
      [unpackMesh, packMesh](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto in = unpackMesh(env2, info[0].As<Napi::Object>());
          const double eps = info.Length() > 1 && info[1].IsNumber()
              ? info[1].As<Napi::Number>().DoubleValue() : 1e-4;
          return packMesh(env2, forge::meshrepair::dedupeVertices(in, eps));
        });
      }));
    mrNs.Set("removeDegenerate", Napi::Function::New(env,
      [unpackMesh, packMesh](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto in = unpackMesh(env2, info[0].As<Napi::Object>());
          return packMesh(env2, forge::meshrepair::removeDegenerate(in));
        });
      }));
    mrNs.Set("fillHoles", Napi::Function::New(env,
      [unpackMesh, packMesh](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto in = unpackMesh(env2, info[0].As<Napi::Object>());
          const std::uint32_t mx = info.Length() > 1 && info[1].IsNumber()
              ? info[1].As<Napi::Number>().Uint32Value() : 512u;
          return packMesh(env2, forge::meshrepair::fillHoles(in, mx));
        });
      }));
    mrNs.Set("laplacianSmooth", Napi::Function::New(env,
      [unpackMesh, packMesh](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto in = unpackMesh(env2, info[0].As<Napi::Object>());
          const std::uint32_t it = info.Length() > 1 && info[1].IsNumber()
              ? info[1].As<Napi::Number>().Uint32Value() : 1u;
          const double lambda = info.Length() > 2 && info[2].IsNumber()
              ? info[2].As<Napi::Number>().DoubleValue() : 0.5;
          return packMesh(env2, forge::meshrepair::laplacianSmooth(in, it, lambda));
        });
      }));
    mrNs.Set("decimate", Napi::Function::New(env,
      [unpackMesh, packMesh](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto in = unpackMesh(env2, info[0].As<Napi::Object>());
          const std::uint32_t tgt = info.Length() > 1 && info[1].IsNumber()
              ? info[1].As<Napi::Number>().Uint32Value() : 100u;
          return packMesh(env2, forge::meshrepair::decimateEdgeCollapse(in, tgt));
        });
      }));
    exports.Set("meshrepair", mrNs);

    // -------- Sheet metal flat-pattern (Forge-201) ---------------------
    auto smNs = Napi::Object::New(env);

    auto readMaterial = [](Napi::Value v) -> forge::sheetmetal::Material {
        using M = forge::sheetmetal::Material;
        if (!v.IsString()) return M::MildSteel;
        const auto s = v.As<Napi::String>().Utf8Value();
        if (s == "aluminium" || s == "aluminum") return M::Aluminium;
        if (s == "mild-steel"     || s == "steel")     return M::MildSteel;
        if (s == "stainless-steel"|| s == "stainless") return M::StainlessSteel;
        if (s == "copper")    return M::Copper;
        if (s == "brass")     return M::Brass;
        if (s == "galvanised" || s == "galvanized") return M::Galvanised;
        return M::MildSteel;
    };

    smNs.Set("kFactor", Napi::Function::New(env,
      [readMaterial](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          const auto mat = readMaterial(info[0]);
          const double ratio = info[1].As<Napi::Number>().DoubleValue();
          return Napi::Number::New(env2, forge::sheetmetal::kFactor(mat, ratio));
        });
      }));
    smNs.Set("computeBend", Napi::Function::New(env,
      [readMaterial](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          const double a = o.Get("angleDeg").As<Napi::Number>().DoubleValue();
          const double r = o.Get("innerRadius").As<Napi::Number>().DoubleValue();
          const double t = o.Get("thickness").As<Napi::Number>().DoubleValue();
          const double k = o.Has("kOverride") ? o.Get("kOverride").As<Napi::Number>().DoubleValue() : 0.0;
          auto mat = o.Has("material") ? readMaterial(o.Get("material"))
                                       : forge::sheetmetal::Material::MildSteel;
          auto br = forge::sheetmetal::computeBend(a, r, t, k, mat);
          auto out = Napi::Object::New(env2);
          out.Set("bendAllowance", Napi::Number::New(env2, br.bendAllowance));
          out.Set("bendDeduction", Napi::Number::New(env2, br.bendDeduction));
          out.Set("neutralRadius", Napi::Number::New(env2, br.neutralRadius));
          out.Set("effectiveK",    Napi::Number::New(env2, br.effectiveK));
          return out;
        });
      }));
    smNs.Set("unfoldChain", Napi::Function::New(env,
      [readMaterial](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::sheetmetal::UnfoldInputs in{};
          auto fl = o.Get("flangeLengths").As<Napi::Array>();
          in.flangeLengths.reserve(fl.Length());
          for (std::uint32_t i = 0; i < fl.Length(); ++i)
            in.flangeLengths.push_back(fl.Get(i).As<Napi::Number>().DoubleValue());
          auto bn = o.Get("bends").As<Napi::Array>();
          in.bends.reserve(bn.Length());
          for (std::uint32_t i = 0; i < bn.Length(); ++i) {
            auto bo = bn.Get(i).As<Napi::Object>();
            forge::sheetmetal::BendSpec b{};
            b.angleDeg    = bo.Get("angleDeg"   ).As<Napi::Number>().DoubleValue();
            b.innerRadius = bo.Get("innerRadius").As<Napi::Number>().DoubleValue();
            b.kOverride   = bo.Has("kOverride")
                ? bo.Get("kOverride").As<Napi::Number>().DoubleValue() : 0.0;
            in.bends.push_back(b);
          }
          in.thickness = o.Get("thickness").As<Napi::Number>().DoubleValue();
          in.width     = o.Get("width"    ).As<Napi::Number>().DoubleValue();
          in.material  = o.Has("material") ? readMaterial(o.Get("material"))
                                           : forge::sheetmetal::Material::MildSteel;
          auto r = forge::sheetmetal::unfoldChain(in);
          auto out = Napi::Object::New(env2);
          out.Set("developedLength", Napi::Number::New(env2, r.developedLength));
          out.Set("sheetArea",       Napi::Number::New(env2, r.sheetArea));
          auto pb = Napi::Array::New(env2, r.perBend.size());
          for (std::size_t i = 0; i < r.perBend.size(); ++i) {
            auto eo = Napi::Object::New(env2);
            eo.Set("bendAllowance", Napi::Number::New(env2, r.perBend[i].bendAllowance));
            eo.Set("bendDeduction", Napi::Number::New(env2, r.perBend[i].bendDeduction));
            eo.Set("neutralRadius", Napi::Number::New(env2, r.perBend[i].neutralRadius));
            eo.Set("effectiveK",    Napi::Number::New(env2, r.perBend[i].effectiveK));
            pb.Set(static_cast<std::uint32_t>(i), eo);
          }
          out.Set("perBend", pb);
          auto fs = Napi::Array::New(env2, r.flangeStartX.size());
          for (std::size_t i = 0; i < r.flangeStartX.size(); ++i)
            fs.Set(static_cast<std::uint32_t>(i),
                   Napi::Number::New(env2, r.flangeStartX[i]));
          out.Set("flangeStartX", fs);
          return out;
        });
      }));
    exports.Set("sheetmetal", smNs);

    // -------- Point cloud (Forge-202) ----------------------------------
    auto pcNs = Napi::Object::New(env);

    auto readPoints = [](Napi::Value v) -> std::vector<float> {
        auto arr = v.As<Napi::Float32Array>();
        return std::vector<float>(arr.Data(), arr.Data() + arr.ElementLength());
    };
    auto packFloats = [](Napi::Env e, const std::vector<float>& v) -> Napi::Float32Array {
        auto out = Napi::Float32Array::New(e, v.size());
        if (!v.empty()) std::memcpy(out.Data(), v.data(), v.size() * sizeof(float));
        return out;
    };

    pcNs.Set("stats", Napi::Function::New(env,
      [readPoints](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto pts = readPoints(info[0]);
          auto s = forge::pointcloud::stats(pts);
          auto out = Napi::Object::New(env2);
          out.Set("pointCount", Napi::Number::New(env2, s.pointCount));
          auto bbMin = Napi::Float32Array::New(env2, 3);
          auto bbMax = Napi::Float32Array::New(env2, 3);
          auto cen   = Napi::Float32Array::New(env2, 3);
          for (int c = 0; c < 3; ++c) {
            bbMin.Data()[c] = s.bboxMin[c];
            bbMax.Data()[c] = s.bboxMax[c];
            cen.Data()[c]   = s.centroid[c];
          }
          out.Set("bboxMin",  bbMin);
          out.Set("bboxMax",  bbMax);
          out.Set("centroid", cen);
          out.Set("density",  Napi::Number::New(env2, s.density));
          return out;
        });
      }));
    pcNs.Set("voxelDownsample", Napi::Function::New(env,
      [readPoints, packFloats](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto pts = readPoints(info[0]);
          const double leaf = info[1].As<Napi::Number>().DoubleValue();
          return packFloats(env2, forge::pointcloud::voxelDownsample(pts, leaf));
        });
      }));
    pcNs.Set("estimateNormals", Napi::Function::New(env,
      [readPoints, packFloats](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto pts = readPoints(info[0]);
          const std::uint32_t k = info.Length() > 1 && info[1].IsNumber()
              ? info[1].As<Napi::Number>().Uint32Value() : 8u;
          double vp[3] = { 0, 0, 1e6 };
          if (info.Length() > 2 && info[2].IsArray()) {
            auto a = info[2].As<Napi::Array>();
            if (a.Length() >= 3) {
              vp[0] = a.Get(uint32_t(0)).As<Napi::Number>().DoubleValue();
              vp[1] = a.Get(uint32_t(1)).As<Napi::Number>().DoubleValue();
              vp[2] = a.Get(uint32_t(2)).As<Napi::Number>().DoubleValue();
            }
          }
          return packFloats(env2, forge::pointcloud::estimateNormals(pts, k, vp));
        });
      }));
    pcNs.Set("voxelMesh", Napi::Function::New(env,
      [readPoints](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto pts = readPoints(info[0]);
          const double leaf = info[1].As<Napi::Number>().DoubleValue();
          auto m = forge::pointcloud::voxelMesh(pts, leaf);
          auto out = Napi::Object::New(env2);
          auto pos = Napi::Float32Array::New(env2, m.positions.size());
          if (!m.positions.empty())
            std::memcpy(pos.Data(), m.positions.data(), m.positions.size() * sizeof(float));
          auto idx = Napi::Uint32Array::New(env2, m.indices.size());
          if (!m.indices.empty())
            std::memcpy(idx.Data(), m.indices.data(), m.indices.size() * sizeof(std::uint32_t));
          out.Set("positions", pos);
          out.Set("indices",   idx);
          return out;
        });
      }));
    exports.Set("pointcloud", pcNs);

    // -------- Path tracer preview (Forge-203) --------------------------
    auto ptNs = Napi::Object::New(env);
    ptNs.Set("render", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();

          forge::pathtrace::RenderInputs in{};
          auto meshO = o.Get("mesh").As<Napi::Object>();
          auto pos = meshO.Get("positions").As<Napi::Float32Array>();
          auto idx = meshO.Get("indices").As<Napi::Uint32Array>();
          in.mesh.positions.assign(pos.Data(), pos.Data() + pos.ElementLength());
          in.mesh.indices.assign(idx.Data(), idx.Data() + idx.ElementLength());
          if (meshO.Has("normals") && meshO.Get("normals").IsTypedArray()) {
            auto nrm = meshO.Get("normals").As<Napi::Float32Array>();
            in.mesh.normals.assign(nrm.Data(), nrm.Data() + nrm.ElementLength());
          }
          if (meshO.Has("materialIds") && meshO.Get("materialIds").IsTypedArray()) {
            auto m = meshO.Get("materialIds").As<Napi::Uint32Array>();
            in.mesh.materialIds.assign(m.Data(), m.Data() + m.ElementLength());
          }
          if (meshO.Has("materials") && meshO.Get("materials").IsArray()) {
            auto matsArr = meshO.Get("materials").As<Napi::Array>();
            in.mesh.materials.reserve(matsArr.Length());
            for (std::uint32_t i = 0; i < matsArr.Length(); ++i) {
              auto mo = matsArr.Get(i).As<Napi::Object>();
              forge::pathtrace::Material m{};
              auto a = mo.Get("albedo").As<Napi::Array>();
              m.albedo[0] = a.Get(uint32_t(0)).As<Napi::Number>().DoubleValue();
              m.albedo[1] = a.Get(uint32_t(1)).As<Napi::Number>().DoubleValue();
              m.albedo[2] = a.Get(uint32_t(2)).As<Napi::Number>().DoubleValue();
              if (mo.Has("emission")) {
                auto e = mo.Get("emission").As<Napi::Array>();
                m.emission[0] = e.Get(uint32_t(0)).As<Napi::Number>().DoubleValue();
                m.emission[1] = e.Get(uint32_t(1)).As<Napi::Number>().DoubleValue();
                m.emission[2] = e.Get(uint32_t(2)).As<Napi::Number>().DoubleValue();
              }
              in.mesh.materials.push_back(m);
            }
          }
          auto readVec3 = [&](Napi::Value v, double dst[3]) {
            auto a = v.As<Napi::Array>();
            dst[0] = a.Get(uint32_t(0)).As<Napi::Number>().DoubleValue();
            dst[1] = a.Get(uint32_t(1)).As<Napi::Number>().DoubleValue();
            dst[2] = a.Get(uint32_t(2)).As<Napi::Number>().DoubleValue();
          };
          auto camO = o.Get("camera").As<Napi::Object>();
          readVec3(camO.Get("position"), in.camera.position);
          readVec3(camO.Get("lookAt"),   in.camera.lookAt);
          readVec3(camO.Get("up"),       in.camera.up);
          in.camera.fovYDegrees = camO.Get("fovYDegrees").As<Napi::Number>().DoubleValue();
          auto sunO = o.Get("sun").As<Napi::Object>();
          readVec3(sunO.Get("direction"), in.sun.direction);
          readVec3(sunO.Get("colour"),    in.sun.colour);
          readVec3(o.Get("ambient"),    in.ambient);
          readVec3(o.Get("background"), in.background);
          in.width      = o.Get("width" ).As<Napi::Number>().Uint32Value();
          in.height     = o.Get("height").As<Napi::Number>().Uint32Value();
          in.aoSamples  = o.Has("aoSamples")
              ? o.Get("aoSamples").As<Napi::Number>().Uint32Value() : 8u;
          in.aoStrength = o.Has("aoStrength")
              ? o.Get("aoStrength").As<Napi::Number>().DoubleValue() : 0.7;
          in.aoMaxDistance = o.Has("aoMaxDistance")
              ? o.Get("aoMaxDistance").As<Napi::Number>().DoubleValue() : 1e6;
          in.randomSeed = o.Has("randomSeed")
              ? static_cast<unsigned long>(o.Get("randomSeed").As<Napi::Number>().Int64Value()) : 0ul;

          auto r = forge::pathtrace::render(in);
          auto out = Napi::Object::New(env2);
          auto rgb = Napi::Float32Array::New(env2, r.rgb.size());
          if (!r.rgb.empty())
            std::memcpy(rgb.Data(), r.rgb.data(), r.rgb.size() * sizeof(float));
          out.Set("rgb",        rgb);
          out.Set("width",      Napi::Number::New(env2, r.width));
          out.Set("height",     Napi::Number::New(env2, r.height));
          out.Set("rayCount",   Napi::Number::New(env2, static_cast<double>(r.rayCount)));
          out.Set("elapsedSec", Napi::Number::New(env2, r.elapsedSec));
          return out;
        });
      }));
    exports.Set("pathtrace", ptNs);

    // -------- Standard parts library (Forge-204) -----------------------
    auto spNs = Napi::Object::New(env);
    auto packStdMesh = [](Napi::Env e, const forge::stdparts::Mesh& m) -> Napi::Object {
        auto out = Napi::Object::New(e);
        auto pos = Napi::Float32Array::New(e, m.positions.size());
        if (!m.positions.empty())
            std::memcpy(pos.Data(), m.positions.data(), m.positions.size() * sizeof(float));
        auto idx = Napi::Uint32Array::New(e, m.indices.size());
        if (!m.indices.empty())
            std::memcpy(idx.Data(), m.indices.data(), m.indices.size() * sizeof(std::uint32_t));
        out.Set("positions", pos);
        out.Set("indices",   idx);
        return out;
    };
    auto readSegs = [](const Napi::CallbackInfo& info, std::uint32_t which, std::uint32_t fallback) {
        return (info.Length() > which && info[which].IsNumber())
            ? info[which].As<Napi::Number>().Uint32Value() : fallback;
    };
    spNs.Set("makeBolt", Napi::Function::New(env,
      [packStdMesh, readSegs](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::stdparts::BoltSpec s{};
          s.diameter   = o.Get("diameter"  ).As<Napi::Number>().DoubleValue();
          s.length     = o.Get("length"    ).As<Napi::Number>().DoubleValue();
          s.headHeight = o.Get("headHeight").As<Napi::Number>().DoubleValue();
          s.headWidth  = o.Get("headWidth" ).As<Napi::Number>().DoubleValue();
          return packStdMesh(env2, forge::stdparts::makeBolt(s, readSegs(info, 1, 24)));
        });
      }));
    spNs.Set("makeNut", Napi::Function::New(env,
      [packStdMesh, readSegs](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::stdparts::NutSpec s{};
          s.innerDiameter = o.Get("innerDiameter").As<Napi::Number>().DoubleValue();
          s.height        = o.Get("height"       ).As<Napi::Number>().DoubleValue();
          s.width         = o.Get("width"        ).As<Napi::Number>().DoubleValue();
          return packStdMesh(env2, forge::stdparts::makeNut(s, readSegs(info, 1, 24)));
        });
      }));
    spNs.Set("makeWasher", Napi::Function::New(env,
      [packStdMesh, readSegs](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::stdparts::WasherSpec s{};
          s.innerDiameter = o.Get("innerDiameter").As<Napi::Number>().DoubleValue();
          s.outerDiameter = o.Get("outerDiameter").As<Napi::Number>().DoubleValue();
          s.thickness     = o.Get("thickness"    ).As<Napi::Number>().DoubleValue();
          return packStdMesh(env2, forge::stdparts::makeWasher(s, readSegs(info, 1, 32)));
        });
      }));
    spNs.Set("makeBearing", Napi::Function::New(env,
      [packStdMesh, readSegs](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::stdparts::BearingSpec s{};
          s.innerDiameter = o.Get("innerDiameter").As<Napi::Number>().DoubleValue();
          s.outerDiameter = o.Get("outerDiameter").As<Napi::Number>().DoubleValue();
          s.width         = o.Get("width"        ).As<Napi::Number>().DoubleValue();
          return packStdMesh(env2, forge::stdparts::makeBearing(s, readSegs(info, 1, 32)));
        });
      }));
    spNs.Set("makeSpurGear", Napi::Function::New(env,
      [packStdMesh, readSegs](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::stdparts::SpurGearSpec s{};
          s.module        = o.Get("module"       ).As<Napi::Number>().DoubleValue();
          s.teeth         = o.Get("teeth"        ).As<Napi::Number>().Uint32Value();
          s.faceWidth     = o.Get("faceWidth"    ).As<Napi::Number>().DoubleValue();
          s.pressureAngle = o.Has("pressureAngle")
              ? o.Get("pressureAngle").As<Napi::Number>().DoubleValue() : 0.349;
          return packStdMesh(env2, forge::stdparts::makeSpurGear(s, readSegs(info, 1, 16)));
        });
      }));
    spNs.Set("specForMetricBolt", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          const std::uint32_t m = info[0].As<Napi::Number>().Uint32Value();
          const double L = info[1].As<Napi::Number>().DoubleValue();
          auto s = forge::stdparts::specForMetricBolt(m, L);
          auto out = Napi::Object::New(env2);
          out.Set("diameter",   Napi::Number::New(env2, s.diameter));
          out.Set("length",     Napi::Number::New(env2, s.length));
          out.Set("headHeight", Napi::Number::New(env2, s.headHeight));
          out.Set("headWidth",  Napi::Number::New(env2, s.headWidth));
          return out;
        });
      }));
    spNs.Set("specForMetricNut", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          const std::uint32_t m = info[0].As<Napi::Number>().Uint32Value();
          auto s = forge::stdparts::specForMetricNut(m);
          auto out = Napi::Object::New(env2);
          out.Set("innerDiameter", Napi::Number::New(env2, s.innerDiameter));
          out.Set("height",        Napi::Number::New(env2, s.height));
          out.Set("width",         Napi::Number::New(env2, s.width));
          return out;
        });
      }));
    exports.Set("stdparts", spNs);

    // -------- Frame / truss FEA (Forge-205) ----------------------------
    auto frNs = Napi::Object::New(env);
    frNs.Set("solve", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::frame::Inputs in{};
          auto ns = o.Get("nodes").As<Napi::Array>();
          in.nodes.reserve(ns.Length());
          for (std::uint32_t i = 0; i < ns.Length(); ++i) {
            auto no = ns.Get(i).As<Napi::Object>();
            forge::frame::Node n{};
            auto pos = no.Get("position").As<Napi::Array>();
            n.position[0] = pos.Get(uint32_t(0)).As<Napi::Number>().DoubleValue();
            n.position[1] = pos.Get(uint32_t(1)).As<Napi::Number>().DoubleValue();
            n.position[2] = pos.Get(uint32_t(2)).As<Napi::Number>().DoubleValue();
            auto fx = no.Get("fixed").As<Napi::Array>();
            n.fixed[0] = fx.Get(uint32_t(0)).As<Napi::Boolean>().Value();
            n.fixed[1] = fx.Get(uint32_t(1)).As<Napi::Boolean>().Value();
            n.fixed[2] = fx.Get(uint32_t(2)).As<Napi::Boolean>().Value();
            in.nodes.push_back(n);
          }
          auto es = o.Get("elements").As<Napi::Array>();
          in.elements.reserve(es.Length());
          for (std::uint32_t i = 0; i < es.Length(); ++i) {
            auto eo = es.Get(i).As<Napi::Object>();
            forge::frame::Element e{};
            e.a = eo.Get("a").As<Napi::Number>().Uint32Value();
            e.b = eo.Get("b").As<Napi::Number>().Uint32Value();
            e.E = eo.Get("E").As<Napi::Number>().DoubleValue();
            e.A = eo.Get("A").As<Napi::Number>().DoubleValue();
            in.elements.push_back(e);
          }
          if (o.Has("loads") && o.Get("loads").IsArray()) {
            auto ls = o.Get("loads").As<Napi::Array>();
            in.loads.reserve(ls.Length());
            for (std::uint32_t i = 0; i < ls.Length(); ++i) {
              auto lo = ls.Get(i).As<Napi::Object>();
              forge::frame::NodeLoad ld{};
              ld.node = lo.Get("node").As<Napi::Number>().Uint32Value();
              auto fa = lo.Get("force").As<Napi::Array>();
              ld.force[0] = fa.Get(uint32_t(0)).As<Napi::Number>().DoubleValue();
              ld.force[1] = fa.Get(uint32_t(1)).As<Napi::Number>().DoubleValue();
              ld.force[2] = fa.Get(uint32_t(2)).As<Napi::Number>().DoubleValue();
              in.loads.push_back(ld);
            }
          }
          auto r = forge::frame::solve(in);
          auto out = Napi::Object::New(env2);
          auto packF64 = [&](const std::vector<double>& v) {
            auto a = Napi::Float64Array::New(env2, v.size());
            if (!v.empty()) std::memcpy(a.Data(), v.data(), v.size() * sizeof(double));
            return a;
          };
          out.Set("displacements", packF64(r.displacements));
          out.Set("reactions",     packF64(r.reactions));
          out.Set("axialForce",    packF64(r.axialForce));
          out.Set("elementLength", packF64(r.elementLength));
          out.Set("singular",      Napi::Boolean::New(env2, r.singular));
          return out;
        });
      }));
    frNs.Set("modal", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::frame::ModalInputs in{};
          auto ns = o.Get("nodes").As<Napi::Array>();
          in.nodes.reserve(ns.Length());
          for (std::uint32_t i = 0; i < ns.Length(); ++i) {
            auto no = ns.Get(i).As<Napi::Object>();
            forge::frame::Node n{};
            auto pos = no.Get("position").As<Napi::Array>();
            n.position[0] = pos.Get(uint32_t(0)).As<Napi::Number>().DoubleValue();
            n.position[1] = pos.Get(uint32_t(1)).As<Napi::Number>().DoubleValue();
            n.position[2] = pos.Get(uint32_t(2)).As<Napi::Number>().DoubleValue();
            auto fx = no.Get("fixed").As<Napi::Array>();
            n.fixed[0] = fx.Get(uint32_t(0)).As<Napi::Boolean>().Value();
            n.fixed[1] = fx.Get(uint32_t(1)).As<Napi::Boolean>().Value();
            n.fixed[2] = fx.Get(uint32_t(2)).As<Napi::Boolean>().Value();
            in.nodes.push_back(n);
          }
          auto es = o.Get("elements").As<Napi::Array>();
          in.elements.reserve(es.Length());
          for (std::uint32_t i = 0; i < es.Length(); ++i) {
            auto eo = es.Get(i).As<Napi::Object>();
            forge::frame::ModalElement e{};
            e.a       = eo.Get("a").As<Napi::Number>().Uint32Value();
            e.b       = eo.Get("b").As<Napi::Number>().Uint32Value();
            e.E       = eo.Get("E").As<Napi::Number>().DoubleValue();
            e.A       = eo.Get("A").As<Napi::Number>().DoubleValue();
            e.density = eo.Get("density").As<Napi::Number>().DoubleValue();
            in.elements.push_back(e);
          }
          in.kModes = o.Get("kModes").As<Napi::Number>().Uint32Value();
          auto r = forge::frame::modal(in);
          auto out = Napi::Object::New(env2);
          auto freqs = Napi::Float64Array::New(env2, r.frequenciesHz.size());
          if (!r.frequenciesHz.empty())
            std::memcpy(freqs.Data(), r.frequenciesHz.data(),
                        r.frequenciesHz.size() * sizeof(double));
          out.Set("frequenciesHz", freqs);
          auto shapesArr = Napi::Array::New(env2, r.modeShapes.size());
          for (std::size_t i = 0; i < r.modeShapes.size(); ++i) {
            auto s = Napi::Float64Array::New(env2, r.modeShapes[i].size());
            if (!r.modeShapes[i].empty())
              std::memcpy(s.Data(), r.modeShapes[i].data(),
                          r.modeShapes[i].size() * sizeof(double));
            shapesArr.Set(static_cast<std::uint32_t>(i), s);
          }
          out.Set("modeShapes", shapesArr);
          return out;
        });
      }));
    exports.Set("frame", frNs);

    // -------- Pipe routing (Forge-206) ---------------------------------
    auto prNs = Napi::Object::New(env);
    prNs.Set("route", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::piperoute::Inputs in{};
          auto readPort = [&](Napi::Object po, forge::piperoute::Port& p) {
            auto pos = po.Get("position").As<Napi::Array>();
            auto dir = po.Get("direction").As<Napi::Array>();
            for (int c = 0; c < 3; ++c) {
              p.position[c]  = pos.Get(uint32_t(c)).As<Napi::Number>().DoubleValue();
              p.direction[c] = dir.Get(uint32_t(c)).As<Napi::Number>().DoubleValue();
            }
          };
          readPort(o.Get("start").As<Napi::Object>(), in.start);
          readPort(o.Get("end"  ).As<Napi::Object>(), in.end);
          if (o.Has("obstacles") && o.Get("obstacles").IsArray()) {
            auto arr = o.Get("obstacles").As<Napi::Array>();
            in.obstacles.reserve(arr.Length());
            for (std::uint32_t i = 0; i < arr.Length(); ++i) {
              auto bo = arr.Get(i).As<Napi::Object>();
              forge::piperoute::AABB b{};
              auto mn = bo.Get("min").As<Napi::Array>();
              auto mx = bo.Get("max").As<Napi::Array>();
              for (int c = 0; c < 3; ++c) {
                b.min[c] = mn.Get(uint32_t(c)).As<Napi::Number>().DoubleValue();
                b.max[c] = mx.Get(uint32_t(c)).As<Napi::Number>().DoubleValue();
              }
              in.obstacles.push_back(b);
            }
          }
          in.gridSpacing   = o.Get("gridSpacing"  ).As<Napi::Number>().DoubleValue();
          in.elbowPenalty  = o.Has("elbowPenalty")
              ? o.Get("elbowPenalty").As<Napi::Number>().DoubleValue() : in.gridSpacing;
          in.bbMargin      = o.Has("bbMargin")
              ? o.Get("bbMargin").As<Napi::Number>().DoubleValue() : in.gridSpacing * 4;
          in.maxIterations = o.Has("maxIterations")
              ? o.Get("maxIterations").As<Napi::Number>().Uint32Value() : 200000u;
          auto r = forge::piperoute::route(in);
          auto out = Napi::Object::New(env2);
          out.Set("found",          Napi::Boolean::New(env2, r.found));
          out.Set("totalLength",    Napi::Number::New(env2, r.totalLength));
          out.Set("elbowCount",     Napi::Number::New(env2, r.elbowCount));
          out.Set("iterationsUsed", Napi::Number::New(env2, r.iterationsUsed));
          auto pl = Napi::Float64Array::New(env2, r.polyline.size());
          if (!r.polyline.empty())
            std::memcpy(pl.Data(), r.polyline.data(), r.polyline.size() * sizeof(double));
          out.Set("polyline", pl);
          return out;
        });
      }));
    exports.Set("piperoute", prNs);

    // -------- DXF round-trip (Forge-207) -------------------------------
    auto dxNs = Napi::Object::New(env);
    auto packEntities = [](Napi::Env e, const std::vector<forge::dxf::Entity>& es) -> Napi::Array {
        auto arr = Napi::Array::New(e, es.size());
        for (std::size_t i = 0; i < es.size(); ++i) {
            const auto& en = es[i];
            auto eo = Napi::Object::New(e);
            const char* t = "line";
            switch (en.type) {
                case forge::dxf::EntityType::Line:       t = "line"; break;
                case forge::dxf::EntityType::Circle:     t = "circle"; break;
                case forge::dxf::EntityType::Arc:        t = "arc"; break;
                case forge::dxf::EntityType::LwPolyline: t = "lwpolyline"; break;
            }
            eo.Set("type",  Napi::String::New(e, t));
            eo.Set("layer", Napi::String::New(e, en.layer));
            eo.Set("x0",    Napi::Number::New(e, en.x0));
            eo.Set("y0",    Napi::Number::New(e, en.y0));
            eo.Set("x1",    Napi::Number::New(e, en.x1));
            eo.Set("y1",    Napi::Number::New(e, en.y1));
            eo.Set("radius",        Napi::Number::New(e, en.radius));
            eo.Set("startAngleDeg", Napi::Number::New(e, en.startAngleDeg));
            eo.Set("endAngleDeg",   Napi::Number::New(e, en.endAngleDeg));
            eo.Set("closed",        Napi::Boolean::New(e, en.closed));
            auto vs = Napi::Float64Array::New(e, en.vertices.size());
            if (!en.vertices.empty())
                std::memcpy(vs.Data(), en.vertices.data(),
                            en.vertices.size() * sizeof(double));
            eo.Set("vertices", vs);
            arr.Set(static_cast<std::uint32_t>(i), eo);
        }
        return arr;
    };
    dxNs.Set("parse", Napi::Function::New(env,
      [packEntities](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          const std::string text = info[0].As<Napi::String>().Utf8Value();
          auto doc = forge::dxf::parse(text);
          auto out = Napi::Object::New(env2);
          out.Set("entities", packEntities(env2, doc.entities));
          return out;
        });
      }));
    dxNs.Set("write", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          auto ents = o.Get("entities").As<Napi::Array>();
          forge::dxf::Document doc;
          doc.entities.reserve(ents.Length());
          for (std::uint32_t i = 0; i < ents.Length(); ++i) {
            auto eo = ents.Get(i).As<Napi::Object>();
            forge::dxf::Entity en{};
            const auto t = eo.Get("type").As<Napi::String>().Utf8Value();
            if      (t == "line")        en.type = forge::dxf::EntityType::Line;
            else if (t == "circle")      en.type = forge::dxf::EntityType::Circle;
            else if (t == "arc")         en.type = forge::dxf::EntityType::Arc;
            else if (t == "lwpolyline")  en.type = forge::dxf::EntityType::LwPolyline;
            else throw Napi::TypeError::New(env2, "unknown entity type");
            if (eo.Has("layer"))  en.layer  = eo.Get("layer").As<Napi::String>().Utf8Value();
            if (eo.Has("x0"))     en.x0     = eo.Get("x0").As<Napi::Number>().DoubleValue();
            if (eo.Has("y0"))     en.y0     = eo.Get("y0").As<Napi::Number>().DoubleValue();
            if (eo.Has("x1"))     en.x1     = eo.Get("x1").As<Napi::Number>().DoubleValue();
            if (eo.Has("y1"))     en.y1     = eo.Get("y1").As<Napi::Number>().DoubleValue();
            if (eo.Has("radius")) en.radius = eo.Get("radius").As<Napi::Number>().DoubleValue();
            if (eo.Has("startAngleDeg")) en.startAngleDeg = eo.Get("startAngleDeg").As<Napi::Number>().DoubleValue();
            if (eo.Has("endAngleDeg"))   en.endAngleDeg   = eo.Get("endAngleDeg"  ).As<Napi::Number>().DoubleValue();
            if (eo.Has("closed"))   en.closed = eo.Get("closed").As<Napi::Boolean>().Value();
            if (eo.Has("vertices") && eo.Get("vertices").IsTypedArray()) {
              auto vs = eo.Get("vertices").As<Napi::Float64Array>();
              en.vertices.assign(vs.Data(), vs.Data() + vs.ElementLength());
            }
            doc.entities.push_back(std::move(en));
          }
          return Napi::String::New(env2, forge::dxf::write(doc));
        });
      }));
    exports.Set("dxf", dxNs);

    // -------- Sketch DOF audit (Forge-208) -----------------------------
    auto sdNs = Napi::Object::New(env);
    sdNs.Set("audit", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::sketchdof::Inputs in{};
          auto es = o.Get("entities").As<Napi::Array>();
          in.entities.reserve(es.Length());
          for (std::uint32_t i = 0; i < es.Length(); ++i) {
            forge::sketchdof::Entity e{};
            e.kind = es.Get(i).As<Napi::Object>().Get("kind").As<Napi::String>().Utf8Value();
            in.entities.push_back(std::move(e));
          }
          auto cs = o.Get("constraints").As<Napi::Array>();
          in.constraints.reserve(cs.Length());
          for (std::uint32_t i = 0; i < cs.Length(); ++i) {
            forge::sketchdof::Constraint c{};
            c.kind = cs.Get(i).As<Napi::Object>().Get("kind").As<Napi::String>().Utf8Value();
            in.constraints.push_back(std::move(c));
          }
          auto readOverrides = [](Napi::Value v, std::vector<forge::sketchdof::CustomDof>& dst) {
            if (!v.IsArray()) return;
            auto a = v.As<Napi::Array>();
            for (std::uint32_t i = 0; i < a.Length(); ++i) {
              auto ro = a.Get(i).As<Napi::Object>();
              forge::sketchdof::CustomDof c{};
              c.kind = ro.Get("kind").As<Napi::String>().Utf8Value();
              c.dof  = ro.Get("dof" ).As<Napi::Number>().Int32Value();
              dst.push_back(std::move(c));
            }
          };
          if (o.Has("entityOverrides"))     readOverrides(o.Get("entityOverrides"),     in.entityOverrides);
          if (o.Has("constraintOverrides")) readOverrides(o.Get("constraintOverrides"), in.constraintOverrides);
          auto r = forge::sketchdof::audit(in);
          auto out = Napi::Object::New(env2);
          out.Set("totalEntities",    Napi::Number::New(env2, r.totalEntities));
          out.Set("totalConstraints", Napi::Number::New(env2, r.totalConstraints));
          out.Set("totalDof",         Napi::Number::New(env2, r.totalDof));
          out.Set("constrainedDof",   Napi::Number::New(env2, r.constrainedDof));
          out.Set("freeDof",          Napi::Number::New(env2, r.freeDof));
          out.Set("status",           Napi::String::New(env2, r.status));
          return out;
        });
      }));
    exports.Set("sketchdof", sdNs);

    // -------- Animation timeline (Forge-209) ---------------------------
    auto anNs = Napi::Object::New(env);
    auto readTracks = [](Napi::Env e, Napi::Array arr) -> forge::animation::Inputs {
      forge::animation::Inputs in{};
      in.tracks.reserve(arr.Length());
      for (std::uint32_t i = 0; i < arr.Length(); ++i) {
        auto to = arr.Get(i).As<Napi::Object>();
        forge::animation::Track t{};
        t.name = to.Get("name").As<Napi::String>().Utf8Value();
        const auto interp = to.Has("interpolation")
            ? to.Get("interpolation").As<Napi::String>().Utf8Value() : "linear";
        t.interpolation = (interp == "cubic")
            ? forge::animation::Interpolation::CubicHermite
            : forge::animation::Interpolation::Linear;
        auto ks = to.Get("keys").As<Napi::Array>();
        t.keys.reserve(ks.Length());
        for (std::uint32_t j = 0; j < ks.Length(); ++j) {
          auto ko = ks.Get(j).As<Napi::Object>();
          forge::animation::Keyframe k{};
          k.time = ko.Get("time").As<Napi::Number>().DoubleValue();
          auto va = ko.Get("value").As<Napi::Array>();
          k.value[0] = va.Get(uint32_t(0)).As<Napi::Number>().DoubleValue();
          k.value[1] = va.Get(uint32_t(1)).As<Napi::Number>().DoubleValue();
          k.value[2] = va.Get(uint32_t(2)).As<Napi::Number>().DoubleValue();
          t.keys.push_back(k);
        }
        in.tracks.push_back(std::move(t));
      }
      (void)e;
      return in;
    };
    auto packSamples = [](Napi::Env e, const std::vector<forge::animation::Sample>& s) -> Napi::Array {
      auto a = Napi::Array::New(e, s.size());
      for (std::size_t i = 0; i < s.size(); ++i) {
        auto o = Napi::Object::New(e);
        o.Set("name", Napi::String::New(e, s[i].name));
        auto v = Napi::Float64Array::New(e, 3);
        v.Data()[0] = s[i].value[0];
        v.Data()[1] = s[i].value[1];
        v.Data()[2] = s[i].value[2];
        o.Set("value", v);
        a.Set(static_cast<std::uint32_t>(i), o);
      }
      return a;
    };
    anNs.Set("duration", Napi::Function::New(env,
      [readTracks](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto in = readTracks(env2, info[0].As<Napi::Array>());
          return Napi::Number::New(env2, forge::animation::duration(in));
        });
      }));
    anNs.Set("evaluateAll", Napi::Function::New(env,
      [readTracks, packSamples](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto in = readTracks(env2, info[0].As<Napi::Array>());
          const double t = info[1].As<Napi::Number>().DoubleValue();
          return packSamples(env2, forge::animation::evaluateAll(in, t));
        });
      }));
    anNs.Set("sampleRange", Napi::Function::New(env,
      [readTracks, packSamples](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto in = readTracks(env2, info[0].As<Napi::Array>());
          const double t0 = info[1].As<Napi::Number>().DoubleValue();
          const double t1 = info[2].As<Napi::Number>().DoubleValue();
          const std::uint32_t n = info[3].As<Napi::Number>().Uint32Value();
          auto frames = forge::animation::sampleRange(in, t0, t1, n);
          auto out = Napi::Array::New(env2, frames.size());
          for (std::size_t i = 0; i < frames.size(); ++i) {
            auto fo = Napi::Object::New(env2);
            fo.Set("time",  Napi::Number::New(env2, frames[i].time));
            fo.Set("values", packSamples(env2, frames[i].values));
            out.Set(static_cast<std::uint32_t>(i), fo);
          }
          return out;
        });
      }));
    exports.Set("animation", anNs);

    // -------- Thermal network (Forge-211) ------------------------------
    auto tnNs = Napi::Object::New(env);
    tnNs.Set("solve", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::thermalnetwork::Inputs in{};
          auto ns = o.Get("nodes").As<Napi::Array>();
          in.nodes.reserve(ns.Length());
          for (std::uint32_t i = 0; i < ns.Length(); ++i) {
            auto no = ns.Get(i).As<Napi::Object>();
            forge::thermalnetwork::Node n{};
            n.fixed = no.Has("fixed") && no.Get("fixed").As<Napi::Boolean>().Value();
            n.prescribedTemperature = no.Has("prescribedTemperature")
                ? no.Get("prescribedTemperature").As<Napi::Number>().DoubleValue() : 0.0;
            in.nodes.push_back(n);
          }
          auto es = o.Get("edges").As<Napi::Array>();
          in.edges.reserve(es.Length());
          for (std::uint32_t i = 0; i < es.Length(); ++i) {
            auto eo = es.Get(i).As<Napi::Object>();
            forge::thermalnetwork::Edge e{};
            e.a           = eo.Get("a").As<Napi::Number>().Uint32Value();
            e.b           = eo.Get("b").As<Napi::Number>().Uint32Value();
            e.conductance = eo.Get("conductance").As<Napi::Number>().DoubleValue();
            in.edges.push_back(e);
          }
          if (o.Has("sources") && o.Get("sources").IsArray()) {
            auto ss = o.Get("sources").As<Napi::Array>();
            in.sources.reserve(ss.Length());
            for (std::uint32_t i = 0; i < ss.Length(); ++i) {
              auto so = ss.Get(i).As<Napi::Object>();
              forge::thermalnetwork::Source s{};
              s.node     = so.Get("node").As<Napi::Number>().Uint32Value();
              s.heatFlux = so.Get("heatFlux").As<Napi::Number>().DoubleValue();
              in.sources.push_back(s);
            }
          }
          auto r = forge::thermalnetwork::solve(in);
          auto out = Napi::Object::New(env2);
          auto packF64 = [&](const std::vector<double>& v) {
            auto a = Napi::Float64Array::New(env2, v.size());
            if (!v.empty()) std::memcpy(a.Data(), v.data(), v.size() * sizeof(double));
            return a;
          };
          out.Set("temperatures", packF64(r.temperatures));
          out.Set("reactions",    packF64(r.reactions));
          out.Set("edgeFluxes",   packF64(r.edgeFluxes));
          out.Set("singular",     Napi::Boolean::New(env2, r.singular));
          return out;
        });
      }));
    exports.Set("thermal", tnNs);

    // -------- Fatigue calculator (Forge-212) ---------------------------
    auto faNs = Napi::Object::New(env);
    faNs.Set("materialDefaults", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          const std::string n = info[0].As<Napi::String>().Utf8Value();
          auto m = forge::fatigue::materialDefaults(n);
          auto out = Napi::Object::New(env2);
          out.Set("sigmaFCoef", Napi::Number::New(env2, m.sigmaFCoef));
          out.Set("bExponent",  Napi::Number::New(env2, m.bExponent));
          return out;
        });
      }));
    faNs.Set("cyclesToFailure", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          const double sa = info[0].As<Napi::Number>().DoubleValue();
          const double sf = info[1].As<Napi::Number>().DoubleValue();
          const double b  = info[2].As<Napi::Number>().DoubleValue();
          return Napi::Number::New(env2, forge::fatigue::cyclesToFailure(sa, sf, b));
        });
      }));
    faNs.Set("cumulativeDamage", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::fatigue::Material mat{};
          auto mo = o.Get("material").As<Napi::Object>();
          mat.sigmaFCoef = mo.Get("sigmaFCoef").As<Napi::Number>().DoubleValue();
          mat.bExponent  = mo.Get("bExponent" ).As<Napi::Number>().DoubleValue();
          std::vector<forge::fatigue::LoadBlock> blocks;
          auto ba = o.Get("blocks").As<Napi::Array>();
          blocks.reserve(ba.Length());
          for (std::uint32_t i = 0; i < ba.Length(); ++i) {
            auto bo = ba.Get(i).As<Napi::Object>();
            forge::fatigue::LoadBlock bk{};
            bk.stressAmplitudeMPa = bo.Get("stressAmplitudeMPa").As<Napi::Number>().DoubleValue();
            bk.appliedCycles      = bo.Get("appliedCycles"     ).As<Napi::Number>().DoubleValue();
            blocks.push_back(bk);
          }
          auto r = forge::fatigue::cumulativeDamage(blocks, mat);
          auto out = Napi::Object::New(env2);
          auto perBlock = Napi::Array::New(env2, r.perBlock.size());
          for (std::size_t i = 0; i < r.perBlock.size(); ++i) {
            auto eo = Napi::Object::New(env2);
            eo.Set("cyclesToFailure",    Napi::Number::New(env2, r.perBlock[i].cyclesToFailure));
            eo.Set("damageContribution", Napi::Number::New(env2, r.perBlock[i].damageContribution));
            perBlock.Set(static_cast<std::uint32_t>(i), eo);
          }
          out.Set("perBlock",        perBlock);
          out.Set("totalDamage",     Napi::Number::New(env2, r.totalDamage));
          out.Set("failed",          Napi::Boolean::New(env2, r.failed));
          out.Set("cyclesRemaining", Napi::Number::New(env2, r.cyclesRemaining));
          return out;
        });
      }));
    exports.Set("fatigue", faNs);

    // -------- Bolt joint calculator (Forge-214) ------------------------
    auto bjNs = Napi::Object::New(env);
    bjNs.Set("computePreload", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::boltjoint::PreloadInputs in{};
          in.torque    = o.Get("torque"   ).As<Napi::Number>().DoubleValue();
          in.nutFactor = o.Get("nutFactor").As<Napi::Number>().DoubleValue();
          in.diameter  = o.Get("diameter" ).As<Napi::Number>().DoubleValue();
          return Napi::Number::New(env2, forge::boltjoint::computePreload(in));
        });
      }));
    bjNs.Set("jointStiffness", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::boltjoint::StiffnessInputs in{};
          in.boltE      = o.Get("boltE"     ).As<Napi::Number>().DoubleValue();
          in.boltAt     = o.Get("boltAt"    ).As<Napi::Number>().DoubleValue();
          in.gripLength = o.Get("gripLength").As<Napi::Number>().DoubleValue();
          in.memberE    = o.Get("memberE"   ).As<Napi::Number>().DoubleValue();
          in.memberArea = o.Get("memberArea").As<Napi::Number>().DoubleValue();
          auto r = forge::boltjoint::jointStiffness(in);
          auto out = Napi::Object::New(env2);
          out.Set("boltStiffness",   Napi::Number::New(env2, r.boltStiffness));
          out.Set("memberStiffness", Napi::Number::New(env2, r.memberStiffness));
          out.Set("loadFactor",      Napi::Number::New(env2, r.loadFactor));
          return out;
        });
      }));
    bjNs.Set("check", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::boltjoint::CheckInputs in{};
          in.preload       = o.Get("preload"      ).As<Napi::Number>().DoubleValue();
          in.externalLoad  = o.Get("externalLoad" ).As<Napi::Number>().DoubleValue();
          in.loadFactor    = o.Get("loadFactor"   ).As<Napi::Number>().DoubleValue();
          in.tensileArea   = o.Get("tensileArea"  ).As<Napi::Number>().DoubleValue();
          in.proofStrength = o.Get("proofStrength").As<Napi::Number>().DoubleValue();
          auto r = forge::boltjoint::check(in);
          auto out = Napi::Object::New(env2);
          out.Set("workingBoltForce", Napi::Number::New(env2, r.workingBoltForce));
          out.Set("workingStress",    Napi::Number::New(env2, r.workingStress));
          out.Set("proofLoad",        Napi::Number::New(env2, r.proofLoad));
          out.Set("marginOfSafety",   Napi::Number::New(env2, r.marginOfSafety));
          out.Set("adequate",         Napi::Boolean::New(env2, r.adequate));
          return out;
        });
      }));
    bjNs.Set("metricBolt", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          const std::string code = info[0].As<Napi::String>().Utf8Value();
          auto m = forge::boltjoint::metricBolt(code);
          auto out = Napi::Object::New(env2);
          out.Set("diameter",             Napi::Number::New(env2, m.diameter));
          out.Set("tensileArea",          Napi::Number::New(env2, m.tensileArea));
          out.Set("proofStrengthClass88", Napi::Number::New(env2, m.proofStrengthClass88));
          out.Set("proofStrengthClass109",Napi::Number::New(env2, m.proofStrengthClass109));
          out.Set("proofStrengthClass129",Napi::Number::New(env2, m.proofStrengthClass129));
          return out;
        });
      }));
    exports.Set("boltjoint", bjNs);

    // -------- Buckling (Forge-215) -------------------------------------
    auto bkNs = Napi::Object::New(env);
    auto readEnds = [](Napi::Value v) -> forge::buckling::EndCondition {
        const auto s = v.As<Napi::String>().Utf8Value();
        if (s == "fixed-fixed")  return forge::buckling::EndCondition::FixedFixed;
        if (s == "fixed-free")   return forge::buckling::EndCondition::FixedFree;
        if (s == "fixed-pinned") return forge::buckling::EndCondition::FixedPinned;
        return forge::buckling::EndCondition::PinnedPinned;
    };
    bkNs.Set("sectionRectangle", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto s = forge::buckling::sectionRectangle(
            info[0].As<Napi::Number>().DoubleValue(),
            info[1].As<Napi::Number>().DoubleValue());
          auto out = Napi::Object::New(env2);
          out.Set("area",          Napi::Number::New(env2, s.area));
          out.Set("secondMomentI", Napi::Number::New(env2, s.secondMomentI));
          return out;
        });
      }));
    bkNs.Set("sectionSolidCircle", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto s = forge::buckling::sectionSolidCircle(
            info[0].As<Napi::Number>().DoubleValue());
          auto out = Napi::Object::New(env2);
          out.Set("area",          Napi::Number::New(env2, s.area));
          out.Set("secondMomentI", Napi::Number::New(env2, s.secondMomentI));
          return out;
        });
      }));
    bkNs.Set("sectionHollowCircle", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto s = forge::buckling::sectionHollowCircle(
            info[0].As<Napi::Number>().DoubleValue(),
            info[1].As<Napi::Number>().DoubleValue());
          auto out = Napi::Object::New(env2);
          out.Set("area",          Napi::Number::New(env2, s.area));
          out.Set("secondMomentI", Napi::Number::New(env2, s.secondMomentI));
          return out;
        });
      }));
    bkNs.Set("analyse", Napi::Function::New(env,
      [readEnds](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::buckling::Inputs in{};
          in.area          = o.Get("area"         ).As<Napi::Number>().DoubleValue();
          in.secondMomentI = o.Get("secondMomentI").As<Napi::Number>().DoubleValue();
          in.length        = o.Get("length"       ).As<Napi::Number>().DoubleValue();
          in.youngsModulus = o.Get("youngsModulus").As<Napi::Number>().DoubleValue();
          in.yieldStrength = o.Get("yieldStrength").As<Napi::Number>().DoubleValue();
          in.ends          = readEnds(o.Get("ends"));
          auto r = forge::buckling::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("slenderness",           Napi::Number::New(env2, r.slenderness));
          out.Set("slendernessTransition", Napi::Number::New(env2, r.slendernessTransition));
          out.Set("criticalLoad",          Napi::Number::New(env2, r.criticalLoad));
          out.Set("allowableLoad",         Napi::Number::New(env2, r.allowableLoad));
          out.Set("radiusOfGyration",      Napi::Number::New(env2, r.radiusOfGyration));
          out.Set("mode",                  Napi::String::New(env2, r.mode));
          return out;
        });
      }));
    exports.Set("buckling", bkNs);

    // -------- Beam deflection (Forge-216) ------------------------------
    auto beamNs = Napi::Object::New(env);
    beamNs.Set("solve", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::beam::Inputs in{};
          in.config        = forge::beam::configFromString(
              o.Get("config").As<Napi::String>().Utf8Value());
          in.length        = o.Get("length"       ).As<Napi::Number>().DoubleValue();
          in.load          = o.Get("load"         ).As<Napi::Number>().DoubleValue();
          in.youngsModulus = o.Get("youngsModulus").As<Napi::Number>().DoubleValue();
          in.secondMomentI = o.Get("secondMomentI").As<Napi::Number>().DoubleValue();
          auto r = forge::beam::solve(in);
          auto out = Napi::Object::New(env2);
          out.Set("deflectionMax", Napi::Number::New(env2, r.deflectionMax));
          out.Set("slopeMax",      Napi::Number::New(env2, r.slopeMax));
          out.Set("momentMax",     Napi::Number::New(env2, r.momentMax));
          return out;
        });
      }));
    exports.Set("beam", beamNs);

    // -------- Spring design (Forge-217) --------------------------------
    auto spgNs = Napi::Object::New(env);
    spgNs.Set("design", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::spring::Inputs in{};
          in.wireDiameter = o.Get("wireDiameter").As<Napi::Number>().DoubleValue();
          in.meanDiameter = o.Get("meanDiameter").As<Napi::Number>().DoubleValue();
          in.activeCoils  = o.Get("activeCoils" ).As<Napi::Number>().DoubleValue();
          in.totalCoils   = o.Get("totalCoils"  ).As<Napi::Number>().DoubleValue();
          in.shearModulus = o.Get("shearModulus").As<Napi::Number>().DoubleValue();
          in.appliedForce = o.Get("appliedForce").As<Napi::Number>().DoubleValue();
          auto r = forge::spring::design(in);
          auto out = Napi::Object::New(env2);
          out.Set("rate",           Napi::Number::New(env2, r.rate));
          out.Set("springIndex",    Napi::Number::New(env2, r.springIndex));
          out.Set("wahlFactor",     Napi::Number::New(env2, r.wahlFactor));
          out.Set("maxShearStress", Napi::Number::New(env2, r.maxShearStress));
          out.Set("solidHeight",    Napi::Number::New(env2, r.solidHeight));
          out.Set("deflectionAtF",  Napi::Number::New(env2, r.deflectionAtF));
          return out;
        });
      }));
    exports.Set("spring", spgNs);

    // -------- Heat exchanger (Forge-218) -------------------------------
    auto hxNs = Napi::Object::New(env);
    hxNs.Set("lmtd", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::hxc::LmtdInputs in{};
          in.thIn  = o.Get("thIn" ).As<Napi::Number>().DoubleValue();
          in.thOut = o.Get("thOut").As<Napi::Number>().DoubleValue();
          in.tcIn  = o.Get("tcIn" ).As<Napi::Number>().DoubleValue();
          in.tcOut = o.Get("tcOut").As<Napi::Number>().DoubleValue();
          in.flow  = forge::hxc::flowFromString(
              o.Get("flow").As<Napi::String>().Utf8Value());
          auto r = forge::hxc::lmtd(in);
          auto out = Napi::Object::New(env2);
          out.Set("dT1", Napi::Number::New(env2, r.dT1));
          out.Set("dT2", Napi::Number::New(env2, r.dT2));
          out.Set("lmtd",Napi::Number::New(env2, r.lmtd));
          return out;
        });
      }));
    hxNs.Set("requiredArea", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::hxc::AreaInputs in{};
          in.Q    = o.Get("Q"   ).As<Napi::Number>().DoubleValue();
          in.U    = o.Get("U"   ).As<Napi::Number>().DoubleValue();
          in.lmtd = o.Get("lmtd").As<Napi::Number>().DoubleValue();
          in.F    = o.Has("F") ? o.Get("F").As<Napi::Number>().DoubleValue() : 1.0;
          return Napi::Number::New(env2, forge::hxc::requiredArea(in));
        });
      }));
    hxNs.Set("effectiveness", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::hxc::NtuInputs in{};
          in.UA   = o.Get("UA"  ).As<Napi::Number>().DoubleValue();
          in.cMin = o.Get("cMin").As<Napi::Number>().DoubleValue();
          in.cMax = o.Get("cMax").As<Napi::Number>().DoubleValue();
          in.flow = forge::hxc::flowFromString(
              o.Get("flow").As<Napi::String>().Utf8Value());
          return Napi::Number::New(env2, forge::hxc::effectiveness(in));
        });
      }));
    exports.Set("hxc", hxNs);

    // -------- Mohr's circle / principal stress (Forge-220) -------------
    auto mhNs = Napi::Object::New(env);
    auto readStress2D = [](Napi::Object o) -> forge::mohr::Stress2D {
        forge::mohr::Stress2D s{};
        s.sx  = o.Get("sx" ).As<Napi::Number>().DoubleValue();
        s.sy  = o.Get("sy" ).As<Napi::Number>().DoubleValue();
        s.txy = o.Get("txy").As<Napi::Number>().DoubleValue();
        return s;
    };
    mhNs.Set("principal2D", Napi::Function::New(env,
      [readStress2D](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto s = readStress2D(info[0].As<Napi::Object>());
          auto r = forge::mohr::principal2D(s);
          auto out = Napi::Object::New(env2);
          out.Set("sigma1",    Napi::Number::New(env2, r.sigma1));
          out.Set("sigma2",    Napi::Number::New(env2, r.sigma2));
          out.Set("tauMax",    Napi::Number::New(env2, r.tauMax));
          out.Set("thetaPRad", Napi::Number::New(env2, r.thetaPRad));
          return out;
        });
      }));
    mhNs.Set("stressAtAngle", Napi::Function::New(env,
      [readStress2D](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto s = readStress2D(info[0].As<Napi::Object>());
          const double th = info[1].As<Napi::Number>().DoubleValue();
          auto r = forge::mohr::stressAtAngle(s, th);
          auto out = Napi::Object::New(env2);
          out.Set("sigma", Napi::Number::New(env2, r.sigma));
          out.Set("tau",   Napi::Number::New(env2, r.tau));
          return out;
        });
      }));
    mhNs.Set("principal3D", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::mohr::Stress3D s{};
          s.sx  = o.Get("sx" ).As<Napi::Number>().DoubleValue();
          s.sy  = o.Get("sy" ).As<Napi::Number>().DoubleValue();
          s.sz  = o.Get("sz" ).As<Napi::Number>().DoubleValue();
          s.txy = o.Get("txy").As<Napi::Number>().DoubleValue();
          s.tyz = o.Get("tyz").As<Napi::Number>().DoubleValue();
          s.tzx = o.Get("tzx").As<Napi::Number>().DoubleValue();
          auto r = forge::mohr::principal3D(s);
          auto out = Napi::Object::New(env2);
          out.Set("sigma1", Napi::Number::New(env2, r.sigma1));
          out.Set("sigma2", Napi::Number::New(env2, r.sigma2));
          out.Set("sigma3", Napi::Number::New(env2, r.sigma3));
          return out;
        });
      }));
    exports.Set("mohr", mhNs);

    // -------- Polygon centroid + area moment (Forge-224) ---------------
    auto psNs = Napi::Object::New(env);
    auto readLoop = [](Napi::Array a) -> std::vector<forge::polysec::Vec2> {
        std::vector<forge::polysec::Vec2> out;
        out.reserve(a.Length());
        for (std::uint32_t i = 0; i < a.Length(); ++i) {
            auto o = a.Get(i).As<Napi::Array>();
            forge::polysec::Vec2 v{};
            v.x = o.Get(uint32_t(0)).As<Napi::Number>().DoubleValue();
            v.y = o.Get(uint32_t(1)).As<Napi::Number>().DoubleValue();
            out.push_back(v);
        }
        return out;
    };
    psNs.Set("analyse", Napi::Function::New(env,
      [readLoop](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::polysec::Inputs in{};
          in.outer = readLoop(o.Get("outer").As<Napi::Array>());
          if (o.Has("holes") && o.Get("holes").IsArray()) {
            auto hs = o.Get("holes").As<Napi::Array>();
            in.holes.reserve(hs.Length());
            for (std::uint32_t i = 0; i < hs.Length(); ++i) {
              in.holes.push_back(readLoop(hs.Get(i).As<Napi::Array>()));
            }
          }
          auto r = forge::polysec::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("area",              Napi::Number::New(env2, r.area));
          auto c = Napi::Object::New(env2);
          c.Set("x", Napi::Number::New(env2, r.centroid.x));
          c.Set("y", Napi::Number::New(env2, r.centroid.y));
          out.Set("centroid",          c);
          out.Set("IxxCentroid",       Napi::Number::New(env2, r.IxxCentroid));
          out.Set("IyyCentroid",       Napi::Number::New(env2, r.IyyCentroid));
          out.Set("IxyCentroid",       Napi::Number::New(env2, r.IxyCentroid));
          out.Set("radiusOfGyrationX", Napi::Number::New(env2, r.radiusOfGyrationX));
          out.Set("radiusOfGyrationY", Napi::Number::New(env2, r.radiusOfGyrationY));
          return out;
        });
      }));
    exports.Set("polysec", psNs);

    // -------- Gear pair (Forge-221) ------------------------------------
    auto gpNs = Napi::Object::New(env);
    gpNs.Set("lewisFormFactor", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          const double N = info[0].As<Napi::Number>().DoubleValue();
          return Napi::Number::New(env2, forge::gearpair::lewisFormFactor(N));
        });
      }));
    gpNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::gearpair::Inputs in{};
          in.module           = o.Get("module"          ).As<Napi::Number>().DoubleValue();
          in.teeth1           = o.Get("teeth1"          ).As<Napi::Number>().DoubleValue();
          in.teeth2           = o.Get("teeth2"          ).As<Napi::Number>().DoubleValue();
          in.faceWidth        = o.Get("faceWidth"       ).As<Napi::Number>().DoubleValue();
          in.torque1          = o.Get("torque1"         ).As<Napi::Number>().DoubleValue();
          in.pressureAngleDeg = o.Has("pressureAngleDeg")
              ? o.Get("pressureAngleDeg").As<Napi::Number>().DoubleValue() : 20.0;
          in.materialE1       = o.Get("materialE1"      ).As<Napi::Number>().DoubleValue();
          in.materialE2       = o.Get("materialE2"      ).As<Napi::Number>().DoubleValue();
          in.materialNu1      = o.Get("materialNu1"     ).As<Napi::Number>().DoubleValue();
          in.materialNu2      = o.Get("materialNu2"     ).As<Napi::Number>().DoubleValue();
          in.KO = o.Has("KO") ? o.Get("KO").As<Napi::Number>().DoubleValue() : 1.0;
          in.KV = o.Has("KV") ? o.Get("KV").As<Napi::Number>().DoubleValue() : 1.0;
          in.KS = o.Has("KS") ? o.Get("KS").As<Napi::Number>().DoubleValue() : 1.0;
          in.KH = o.Has("KH") ? o.Get("KH").As<Napi::Number>().DoubleValue() : 1.0;
          in.KB = o.Has("KB") ? o.Get("KB").As<Napi::Number>().DoubleValue() : 1.0;
          auto r = forge::gearpair::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("centreDistance",      Napi::Number::New(env2, r.centreDistance));
          out.Set("gearRatio",           Napi::Number::New(env2, r.gearRatio));
          out.Set("pitchDiameter1",      Napi::Number::New(env2, r.pitchDiameter1));
          out.Set("pitchDiameter2",      Napi::Number::New(env2, r.pitchDiameter2));
          out.Set("tangentialLoadN",     Napi::Number::New(env2, r.tangentialLoadN));
          out.Set("lewisFormFactor1",    Napi::Number::New(env2, r.lewisFormFactor1));
          out.Set("lewisFormFactor2",    Napi::Number::New(env2, r.lewisFormFactor2));
          out.Set("bendingStressLewis1", Napi::Number::New(env2, r.bendingStressLewis1));
          out.Set("bendingStressLewis2", Napi::Number::New(env2, r.bendingStressLewis2));
          out.Set("bendingStressAGMA1",  Napi::Number::New(env2, r.bendingStressAGMA1));
          out.Set("bendingStressAGMA2",  Napi::Number::New(env2, r.bendingStressAGMA2));
          out.Set("contactStressHertz",  Napi::Number::New(env2, r.contactStressHertz));
          return out;
        });
      }));
    exports.Set("gearpair", gpNs);

    // -------- Hydraulic cylinder (Forge-222) ---------------------------
    auto hcNs = Napi::Object::New(env);
    hcNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::hydcyl::Inputs in{};
          in.bore         = o.Get("bore"        ).As<Napi::Number>().DoubleValue();
          in.rodDiameter  = o.Get("rodDiameter" ).As<Napi::Number>().DoubleValue();
          in.pressure     = o.Get("pressure"    ).As<Napi::Number>().DoubleValue();
          in.flowRate     = o.Get("flowRate"    ).As<Napi::Number>().DoubleValue();
          in.strokeLength = o.Get("strokeLength").As<Napi::Number>().DoubleValue();
          in.rodE         = o.Get("rodE"        ).As<Napi::Number>().DoubleValue();
          in.bucklingK    = o.Has("bucklingK")
              ? o.Get("bucklingK").As<Napi::Number>().DoubleValue() : 1.0;
          auto r = forge::hydcyl::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("pistonArea",           Napi::Number::New(env2, r.pistonArea));
          out.Set("rodArea",              Napi::Number::New(env2, r.rodArea));
          out.Set("annulusArea",          Napi::Number::New(env2, r.annulusArea));
          out.Set("extendForce",          Napi::Number::New(env2, r.extendForce));
          out.Set("retractForce",         Napi::Number::New(env2, r.retractForce));
          out.Set("extendSpeed",          Napi::Number::New(env2, r.extendSpeed));
          out.Set("retractSpeed",         Napi::Number::New(env2, r.retractSpeed));
          out.Set("volumePerCycle",       Napi::Number::New(env2, r.volumePerCycle));
          out.Set("rodMomentI",           Napi::Number::New(env2, r.rodMomentI));
          out.Set("rodEulerCriticalLoad", Napi::Number::New(env2, r.rodEulerCriticalLoad));
          out.Set("bucklingSafetyFactor", Napi::Number::New(env2, r.bucklingSafetyFactor));
          return out;
        });
      }));
    exports.Set("hydcyl", hcNs);

    // -------- Wind load (Forge-223) ------------------------------------
    auto wlNs = Napi::Object::New(env);
    wlNs.Set("kzCoefficient", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          const double z = info[0].As<Napi::Number>().DoubleValue();
          const auto exp = forge::windload::exposureFromString(
              info[1].As<Napi::String>().Utf8Value());
          return Napi::Number::New(env2, forge::windload::kzCoefficient(z, exp));
        });
      }));
    wlNs.Set("velocityPressure", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::windload::VelocityPressureInputs in{};
          in.V        = o.Get("V"       ).As<Napi::Number>().DoubleValue();
          in.z        = o.Get("z"       ).As<Napi::Number>().DoubleValue();
          in.exposure = forge::windload::exposureFromString(
              o.Get("exposure").As<Napi::String>().Utf8Value());
          in.Kzt = o.Has("Kzt") ? o.Get("Kzt").As<Napi::Number>().DoubleValue() : 1.0;
          in.Kd  = o.Has("Kd")  ? o.Get("Kd" ).As<Napi::Number>().DoubleValue() : 0.85;
          in.Ke  = o.Has("Ke")  ? o.Get("Ke" ).As<Napi::Number>().DoubleValue() : 1.0;
          return Napi::Number::New(env2, forge::windload::velocityPressure(in));
        });
      }));
    wlNs.Set("designPressure", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::windload::DesignPressureInputs in{};
          in.qz   = o.Get("qz"  ).As<Napi::Number>().DoubleValue();
          in.G    = o.Has("G") ? o.Get("G").As<Napi::Number>().DoubleValue() : 0.85;
          in.Cp   = o.Get("Cp"  ).As<Napi::Number>().DoubleValue();
          in.qi   = o.Has("qi")   ? o.Get("qi"  ).As<Napi::Number>().DoubleValue() : 0.0;
          in.GCpi = o.Has("GCpi") ? o.Get("GCpi").As<Napi::Number>().DoubleValue() : 0.0;
          return Napi::Number::New(env2, forge::windload::designPressure(in));
        });
      }));
    exports.Set("windload", wlNs);

    // -------- Snow load (Forge-225) ------------------------------------
    auto slNs = Napi::Object::New(env);
    slNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::snowload::Inputs in{};
          in.groundSnowPa = o.Get("groundSnowPa").As<Napi::Number>().DoubleValue();
          in.exposure     = forge::snowload::exposureFromString(
              o.Get("exposure").As<Napi::String>().Utf8Value());
          in.thermal      = forge::snowload::thermalFromString(
              o.Get("thermal").As<Napi::String>().Utf8Value());
          in.risk         = forge::snowload::riskFromString(
              o.Get("risk").As<Napi::String>().Utf8Value());
          in.slopeDeg     = o.Get("slopeDeg").As<Napi::Number>().DoubleValue();
          auto r = forge::snowload::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("flatRoofPa",   Napi::Number::New(env2, r.flatRoofPa));
          out.Set("slopeFactor",  Napi::Number::New(env2, r.slopeFactor));
          out.Set("slopedRoofPa", Napi::Number::New(env2, r.slopedRoofPa));
          return out;
        });
      }));
    exports.Set("snowload", slNs);

    // -------- Bearing L10 life (Forge-226) -----------------------------
    auto brNs = Napi::Object::New(env);
    brNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::bearing::Inputs in{};
          in.C    = o.Get("C" ).As<Napi::Number>().DoubleValue();
          in.Fr   = o.Get("Fr").As<Napi::Number>().DoubleValue();
          in.Fa   = o.Has("Fa") ? o.Get("Fa").As<Napi::Number>().DoubleValue() : 0.0;
          in.X    = o.Has("X")  ? o.Get("X" ).As<Napi::Number>().DoubleValue() : 1.0;
          in.Y    = o.Has("Y")  ? o.Get("Y" ).As<Napi::Number>().DoubleValue() : 0.0;
          in.kind = forge::bearing::kindFromString(
              o.Get("kind").As<Napi::String>().Utf8Value());
          in.reliabilityPercent =
              o.Has("reliabilityPercent")
              ? o.Get("reliabilityPercent").As<Napi::Number>().DoubleValue() : 90.0;
          in.rpm = o.Has("rpm") ? o.Get("rpm").As<Napi::Number>().DoubleValue() : 0.0;
          auto r = forge::bearing::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("equivalentLoad",    Napi::Number::New(env2, r.equivalentLoad));
          out.Set("L10MegaRev",        Napi::Number::New(env2, r.L10MegaRev));
          out.Set("L10Hours",          Napi::Number::New(env2, r.L10Hours));
          out.Set("LnaMegaRev",        Napi::Number::New(env2, r.LnaMegaRev));
          out.Set("LnaHours",          Napi::Number::New(env2, r.LnaHours));
          out.Set("reliabilityFactor", Napi::Number::New(env2, r.reliabilityFactor));
          return out;
        });
      }));
    exports.Set("bearing", brNs);

    // -------- V-belt drive (Forge-227) ---------------------------------
    auto vbNs = Napi::Object::New(env);
    vbNs.Set("pitchLength", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          const double d1 = info[0].As<Napi::Number>().DoubleValue();
          const double d2 = info[1].As<Napi::Number>().DoubleValue();
          const double C  = info[2].As<Napi::Number>().DoubleValue();
          return Napi::Number::New(env2, forge::vbelt::pitchLength(d1, d2, C));
        });
      }));
    vbNs.Set("centreDistFromLength", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          const double d1 = info[0].As<Napi::Number>().DoubleValue();
          const double d2 = info[1].As<Napi::Number>().DoubleValue();
          const double Lp = info[2].As<Napi::Number>().DoubleValue();
          return Napi::Number::New(env2, forge::vbelt::centreDistFromLength(d1, d2, Lp));
        });
      }));
    vbNs.Set("wrapAngleSmallRad", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          const double d1 = info[0].As<Napi::Number>().DoubleValue();
          const double d2 = info[1].As<Napi::Number>().DoubleValue();
          const double C  = info[2].As<Napi::Number>().DoubleValue();
          return Napi::Number::New(env2, forge::vbelt::wrapAngleSmallRad(d1, d2, C));
        });
      }));
    vbNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::vbelt::Inputs in{};
          in.d1             = o.Get("d1"            ).As<Napi::Number>().DoubleValue();
          in.d2             = o.Get("d2"            ).As<Napi::Number>().DoubleValue();
          in.centreDist     = o.Get("centreDist"    ).As<Napi::Number>().DoubleValue();
          in.rpmSmall       = o.Get("rpmSmall"      ).As<Napi::Number>().DoubleValue();
          in.nominalPower   = o.Get("nominalPower"  ).As<Napi::Number>().DoubleValue();
          in.serviceFactor  = o.Get("serviceFactor" ).As<Napi::Number>().DoubleValue();
          in.ratingPerBelt  = o.Get("ratingPerBelt" ).As<Napi::Number>().DoubleValue();
          auto r = forge::vbelt::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("pitchLength",        Napi::Number::New(env2, r.pitchLength));
          out.Set("wrapAngleSmallDeg",  Napi::Number::New(env2, r.wrapAngleSmallDeg));
          out.Set("beltSpeed",          Napi::Number::New(env2, r.beltSpeed));
          out.Set("designPower",        Napi::Number::New(env2, r.designPower));
          out.Set("beltCount",          Napi::Number::New(env2, r.beltCount));
          return out;
        });
      }));
    exports.Set("vbelt", vbNs);

    // -------- Pressure vessel (Forge-228) ------------------------------
    auto pvNs = Napi::Object::New(env);
    pvNs.Set("stress", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::pvessel::StressInputs in{};
          in.pressure      = o.Get("pressure"     ).As<Napi::Number>().DoubleValue();
          in.diameter      = o.Get("diameter"     ).As<Napi::Number>().DoubleValue();
          in.wallThickness = o.Get("wallThickness").As<Napi::Number>().DoubleValue();
          in.geometry      = forge::pvessel::geometryFromString(
              o.Get("geometry").As<Napi::String>().Utf8Value());
          auto r = forge::pvessel::stress(in);
          auto out = Napi::Object::New(env2);
          out.Set("hoopStress",         Napi::Number::New(env2, r.hoopStress));
          out.Set("longitudinalStress", Napi::Number::New(env2, r.longitudinalStress));
          return out;
        });
      }));
    pvNs.Set("requiredThickness", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::pvessel::ThicknessInputs in{};
          in.pressure        = o.Get("pressure"       ).As<Napi::Number>().DoubleValue();
          in.insideRadius    = o.Get("insideRadius"   ).As<Napi::Number>().DoubleValue();
          in.allowableStress = o.Get("allowableStress").As<Napi::Number>().DoubleValue();
          in.jointEfficiency = o.Get("jointEfficiency").As<Napi::Number>().DoubleValue();
          in.geometry        = forge::pvessel::geometryFromString(
              o.Get("geometry").As<Napi::String>().Utf8Value());
          return Napi::Number::New(env2, forge::pvessel::requiredThickness(in));
        });
      }));
    exports.Set("pvessel", pvNs);

    // -------- Pump head / pipe flow (Forge-229) ------------------------
    auto phNs = Napi::Object::New(env);
    phNs.Set("reynoldsNumber", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          return Napi::Number::New(env2, forge::pumphead::reynoldsNumber(
              info[0].As<Napi::Number>().DoubleValue(),
              info[1].As<Napi::Number>().DoubleValue(),
              info[2].As<Napi::Number>().DoubleValue(),
              info[3].As<Napi::Number>().DoubleValue()));
        });
      }));
    phNs.Set("frictionFactor", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          return Napi::Number::New(env2, forge::pumphead::frictionFactor(
              info[0].As<Napi::Number>().DoubleValue(),
              info[1].As<Napi::Number>().DoubleValue(),
              info[2].As<Napi::Number>().DoubleValue()));
        });
      }));
    phNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::pumphead::Inputs in{};
          in.flowRate         = o.Get("flowRate"        ).As<Napi::Number>().DoubleValue();
          in.diameter         = o.Get("diameter"        ).As<Napi::Number>().DoubleValue();
          in.pipeLength       = o.Get("pipeLength"      ).As<Napi::Number>().DoubleValue();
          in.roughness        = o.Get("roughness"       ).As<Napi::Number>().DoubleValue();
          in.density          = o.Get("density"         ).As<Napi::Number>().DoubleValue();
          in.dynamicViscosity = o.Get("dynamicViscosity").As<Napi::Number>().DoubleValue();
          in.staticHead       = o.Get("staticHead"      ).As<Napi::Number>().DoubleValue();
          in.pumpEfficiency   = o.Get("pumpEfficiency"  ).As<Napi::Number>().DoubleValue();
          auto r = forge::pumphead::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("meanVelocity",   Napi::Number::New(env2, r.meanVelocity));
          out.Set("reynolds",       Napi::Number::New(env2, r.reynolds));
          out.Set("frictionFactor", Napi::Number::New(env2, r.frictionFactor));
          out.Set("frictionHead",   Napi::Number::New(env2, r.frictionHead));
          out.Set("totalHead",      Napi::Number::New(env2, r.totalHead));
          out.Set("hydraulicPower", Napi::Number::New(env2, r.hydraulicPower));
          out.Set("shaftPower",     Napi::Number::New(env2, r.shaftPower));
          return out;
        });
      }));
    exports.Set("pumphead", phNs);

    // -------- Refrigeration COP (Forge-230) ----------------------------
    auto rfNs = Napi::Object::New(env);
    rfNs.Set("carnotCOP", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          const double Th = info[0].As<Napi::Number>().DoubleValue();
          const double Tc = info[1].As<Napi::Number>().DoubleValue();
          auto m = forge::refrig::modeFromString(info[2].As<Napi::String>().Utf8Value());
          return Napi::Number::New(env2, forge::refrig::carnotCOP(Th, Tc, m));
        });
      }));
    rfNs.Set("vaporCycle", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::refrig::CycleInputs in{};
          in.h1   = o.Get("h1"  ).As<Napi::Number>().DoubleValue();
          in.h2   = o.Get("h2"  ).As<Napi::Number>().DoubleValue();
          in.h3   = o.Get("h3"  ).As<Napi::Number>().DoubleValue();
          in.mode = forge::refrig::modeFromString(o.Get("mode").As<Napi::String>().Utf8Value());
          auto r = forge::refrig::vaporCycle(in);
          auto out = Napi::Object::New(env2);
          out.Set("refrigerationEffect", Napi::Number::New(env2, r.refrigerationEffect));
          out.Set("condenserRejection",  Napi::Number::New(env2, r.condenserRejection));
          out.Set("compressorWork",      Napi::Number::New(env2, r.compressorWork));
          out.Set("cop",                 Napi::Number::New(env2, r.cop));
          return out;
        });
      }));
    rfNs.Set("compressorPower", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          return Napi::Number::New(env2, forge::refrig::compressorPower(
              info[0].As<Napi::Number>().DoubleValue(),
              info[1].As<Napi::Number>().DoubleValue()));
        });
      }));
    exports.Set("refrig", rfNs);

    // -------- Fan / blower (Forge-231) ---------------------------------
    auto fbNs = Napi::Object::New(env);
    fbNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::fanblower::SizeInputs in{};
          in.flowRate       = o.Get("flowRate"      ).As<Napi::Number>().DoubleValue();
          in.deltaPStatic   = o.Get("deltaPStatic"  ).As<Napi::Number>().DoubleValue();
          in.density        = o.Get("density"       ).As<Napi::Number>().DoubleValue();
          in.outletArea     = o.Get("outletArea"    ).As<Napi::Number>().DoubleValue();
          in.fanEfficiency  = o.Get("fanEfficiency" ).As<Napi::Number>().DoubleValue();
          auto r = forge::fanblower::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("velocityOutlet",   Napi::Number::New(env2, r.velocityOutlet));
          out.Set("velocityPressure", Napi::Number::New(env2, r.velocityPressure));
          out.Set("totalPressure",    Napi::Number::New(env2, r.totalPressure));
          out.Set("hydraulicPower",   Napi::Number::New(env2, r.hydraulicPower));
          out.Set("shaftPower",       Napi::Number::New(env2, r.shaftPower));
          return out;
        });
      }));
    fbNs.Set("scaleByAffinity", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::fanblower::AffinityInputs in{};
          in.Q1   = o.Get("Q1"  ).As<Napi::Number>().DoubleValue();
          in.dP1  = o.Get("dP1" ).As<Napi::Number>().DoubleValue();
          in.P1   = o.Get("P1"  ).As<Napi::Number>().DoubleValue();
          in.N1   = o.Get("N1"  ).As<Napi::Number>().DoubleValue();
          in.rho1 = o.Get("rho1").As<Napi::Number>().DoubleValue();
          in.N2   = o.Get("N2"  ).As<Napi::Number>().DoubleValue();
          in.rho2 = o.Get("rho2").As<Napi::Number>().DoubleValue();
          auto r = forge::fanblower::scaleByAffinity(in);
          auto out = Napi::Object::New(env2);
          out.Set("Q2",  Napi::Number::New(env2, r.Q2));
          out.Set("dP2", Napi::Number::New(env2, r.dP2));
          out.Set("P2",  Napi::Number::New(env2, r.P2));
          return out;
        });
      }));
    exports.Set("fan", fbNs);

    // -------- Steel column (Forge-232) ---------------------------------
    auto scNs = Napi::Object::New(env);
    scNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::steelcol::Inputs in{};
          in.effectiveLengthK  = o.Get("effectiveLengthK" ).As<Napi::Number>().DoubleValue();
          in.unbracedLength    = o.Get("unbracedLength"   ).As<Napi::Number>().DoubleValue();
          in.radiusOfGyration  = o.Get("radiusOfGyration" ).As<Napi::Number>().DoubleValue();
          in.area              = o.Get("area"             ).As<Napi::Number>().DoubleValue();
          in.youngsModulus     = o.Get("youngsModulus"    ).As<Napi::Number>().DoubleValue();
          in.yieldStress       = o.Get("yieldStress"      ).As<Napi::Number>().DoubleValue();
          auto r = forge::steelcol::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("slenderness",         Napi::Number::New(env2, r.slenderness));
          out.Set("slendernessLimit",    Napi::Number::New(env2, r.slendernessLimit));
          out.Set("eulerStress",         Napi::Number::New(env2, r.eulerStress));
          out.Set("criticalStress",      Napi::Number::New(env2, r.criticalStress));
          out.Set("nominalStrength",     Napi::Number::New(env2, r.nominalStrength));
          out.Set("designStrengthLRFD",  Napi::Number::New(env2, r.designStrengthLRFD));
          out.Set("allowableStrengthASD",Napi::Number::New(env2, r.allowableStrengthASD));
          out.Set("inelasticRegime",     Napi::Boolean::New(env2, r.inelasticRegime));
          return out;
        });
      }));
    exports.Set("steelcol", scNs);

    // -------- Seismic load (Forge-234) ---------------------------------
    auto seNs = Napi::Object::New(env);
    seNs.Set("approximateFundamentalPeriod", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          const auto sys = forge::seismic::systemFromString(
              info[0].As<Napi::String>().Utf8Value());
          const double h = info[1].As<Napi::Number>().DoubleValue();
          return Napi::Number::New(env2,
              forge::seismic::approximateFundamentalPeriod(sys, h));
        });
      }));
    seNs.Set("seismicResponseCoefficient", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::seismic::CsInputs in{};
          in.SDS = o.Get("SDS").As<Napi::Number>().DoubleValue();
          in.SD1 = o.Get("SD1").As<Napi::Number>().DoubleValue();
          in.T   = o.Get("T"  ).As<Napi::Number>().DoubleValue();
          in.TL  = o.Get("TL" ).As<Napi::Number>().DoubleValue();
          in.R   = o.Get("R"  ).As<Napi::Number>().DoubleValue();
          in.Ie  = o.Get("Ie" ).As<Napi::Number>().DoubleValue();
          auto r = forge::seismic::seismicResponseCoefficient(in);
          auto out = Napi::Object::New(env2);
          out.Set("CsBasic",     Napi::Number::New(env2, r.CsBasic));
          out.Set("CsMax",       Napi::Number::New(env2, r.CsMax));
          out.Set("CsMin",       Napi::Number::New(env2, r.CsMin));
          out.Set("CsGoverning", Napi::Number::New(env2, r.CsGoverning));
          return out;
        });
      }));
    seNs.Set("baseShear", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          return Napi::Number::New(env2, forge::seismic::baseShear(
              info[0].As<Napi::Number>().DoubleValue(),
              info[1].As<Napi::Number>().DoubleValue()));
        });
      }));
    exports.Set("seismic", seNs);

    // -------- Shaft design (Forge-235) ----------------------------------
    auto shNs = Napi::Object::New(env);
    shNs.Set("analyseStatic", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::shaft::StaticInput in{};
          in.diameterM       = o.Get("diameterM"      ).As<Napi::Number>().DoubleValue();
          in.bendingMomentNm = o.Get("bendingMomentNm").As<Napi::Number>().DoubleValue();
          in.torqueNm        = o.Get("torqueNm"       ).As<Napi::Number>().DoubleValue();
          in.yieldMPa        = o.Get("yieldMPa"       ).As<Napi::Number>().DoubleValue();
          auto r = forge::shaft::analyseStatic(in);
          auto out = Napi::Object::New(env2);
          out.Set("bendingStressMPa",  Napi::Number::New(env2, r.bendingStressMPa));
          out.Set("shearStressMPa",    Napi::Number::New(env2, r.shearStressMPa));
          out.Set("vonMisesStressMPa", Napi::Number::New(env2, r.vonMisesStressMPa));
          out.Set("safetyFactor",      Napi::Number::New(env2, r.safetyFactor));
          return out;
        });
      }));
    shNs.Set("analyseFatigue", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::shaft::FatigueInput in{};
          in.diameterM       = o.Get("diameterM"      ).As<Napi::Number>().DoubleValue();
          in.bendingMomentNm = o.Get("bendingMomentNm").As<Napi::Number>().DoubleValue();
          in.torqueNm        = o.Get("torqueNm"       ).As<Napi::Number>().DoubleValue();
          in.ultimateMPa     = o.Get("ultimateMPa"    ).As<Napi::Number>().DoubleValue();
          in.marinFactor     = o.Get("marinFactor"    ).As<Napi::Number>().DoubleValue();
          in.kfBending       = o.Get("kfBending"      ).As<Napi::Number>().DoubleValue();
          in.kfsTorsion      = o.Get("kfsTorsion"     ).As<Napi::Number>().DoubleValue();
          auto r = forge::shaft::analyseFatigue(in);
          auto out = Napi::Object::New(env2);
          out.Set("enduranceLimitMPa", Napi::Number::New(env2, r.enduranceLimitMPa));
          out.Set("alternatingMPa",    Napi::Number::New(env2, r.alternatingMPa));
          out.Set("meanMPa",           Napi::Number::New(env2, r.meanMPa));
          out.Set("safetyFactor",      Napi::Number::New(env2, r.safetyFactor));
          return out;
        });
      }));
    exports.Set("shaft", shNs);

    // -------- Bolted connection (Forge-236) -----------------------------
    auto bcNs = Napi::Object::New(env);
    bcNs.Set("analyseShear", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::boltconn::ShearInput in{};
          in.boltAreaM2       = o.Get("boltAreaM2"      ).As<Napi::Number>().DoubleValue();
          in.boltUltimatePa   = o.Get("boltUltimatePa"  ).As<Napi::Number>().DoubleValue();
          in.plateThicknessM  = o.Get("plateThicknessM" ).As<Napi::Number>().DoubleValue();
          in.boltNominalDiamM = o.Get("boltNominalDiamM").As<Napi::Number>().DoubleValue();
          in.edgeClearanceM   = o.Get("edgeClearanceM"  ).As<Napi::Number>().DoubleValue();
          in.plateUltimatePa  = o.Get("plateUltimatePa" ).As<Napi::Number>().DoubleValue();
          in.shearPlanes      = o.Get("shearPlanes"     ).As<Napi::Number>().Int32Value();
          in.phiShear         = o.Get("phiShear"        ).As<Napi::Number>().DoubleValue();
          in.phiBearing       = o.Get("phiBearing"      ).As<Napi::Number>().DoubleValue();
          auto r = forge::boltconn::analyseShear(in);
          auto out = Napi::Object::New(env2);
          out.Set("boltShearN",      Napi::Number::New(env2, r.boltShearN));
          out.Set("bearingN",        Napi::Number::New(env2, r.bearingN));
          out.Set("bearingLcN",      Napi::Number::New(env2, r.bearingLcN));
          out.Set("bearingDbN",      Napi::Number::New(env2, r.bearingDbN));
          out.Set("designShearN",    Napi::Number::New(env2, r.designShearN));
          out.Set("designBearingN",  Napi::Number::New(env2, r.designBearingN));
          out.Set("governingN",      Napi::Number::New(env2, r.governingN));
          out.Set("governedByShear", Napi::Boolean::New(env2, r.governedByShear));
          return out;
        });
      }));
    bcNs.Set("analyseTension", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::boltconn::TensionInput in{};
          in.grossAreaM2      = o.Get("grossAreaM2"     ).As<Napi::Number>().DoubleValue();
          in.yieldPa          = o.Get("yieldPa"         ).As<Napi::Number>().DoubleValue();
          in.ultimatePa       = o.Get("ultimatePa"      ).As<Napi::Number>().DoubleValue();
          in.plateWidthM      = o.Get("plateWidthM"     ).As<Napi::Number>().DoubleValue();
          in.plateThicknessM  = o.Get("plateThicknessM" ).As<Napi::Number>().DoubleValue();
          in.boltsAcross      = o.Get("boltsAcross"     ).As<Napi::Number>().Int32Value();
          in.holeDiameterM    = o.Get("holeDiameterM"   ).As<Napi::Number>().DoubleValue();
          in.shearLagU        = o.Get("shearLagU"       ).As<Napi::Number>().DoubleValue();
          in.phiYield         = o.Get("phiYield"        ).As<Napi::Number>().DoubleValue();
          in.phiRupture       = o.Get("phiRupture"      ).As<Napi::Number>().DoubleValue();
          auto r = forge::boltconn::analyseTension(in);
          auto out = Napi::Object::New(env2);
          out.Set("netAreaM2",         Napi::Number::New(env2, r.netAreaM2));
          out.Set("effectiveAreaM2",   Napi::Number::New(env2, r.effectiveAreaM2));
          out.Set("yieldingN",         Napi::Number::New(env2, r.yieldingN));
          out.Set("ruptureN",          Napi::Number::New(env2, r.ruptureN));
          out.Set("designYieldN",      Napi::Number::New(env2, r.designYieldN));
          out.Set("designRuptureN",    Napi::Number::New(env2, r.designRuptureN));
          out.Set("governingN",        Napi::Number::New(env2, r.governingN));
          out.Set("governedByRupture", Napi::Boolean::New(env2, r.governedByRupture));
          return out;
        });
      }));
    exports.Set("boltconn", bcNs);

    // -------- Fillet weld (Forge-237) -----------------------------------
    auto fwNs = Napi::Object::New(env);
    fwNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::filletweld::Input in{};
          in.legSizeM        = o.Get("legSizeM"       ).As<Napi::Number>().DoubleValue();
          in.weldLengthM     = o.Get("weldLengthM"    ).As<Napi::Number>().DoubleValue();
          in.electrodeFexxPa = o.Get("electrodeFexxPa").As<Napi::Number>().DoubleValue();
          in.thickerPlateM   = o.Get("thickerPlateM"  ).As<Napi::Number>().DoubleValue();
          in.edgePlateM      = o.Get("edgePlateM"     ).As<Napi::Number>().DoubleValue();
          in.phi             = o.Get("phi"            ).As<Napi::Number>().DoubleValue();
          auto r = forge::filletweld::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("effectiveThroatM",     Napi::Number::New(env2, r.effectiveThroatM));
          out.Set("nominalPerUnitNPerM",  Napi::Number::New(env2, r.nominalPerUnitNPerM));
          out.Set("designPerUnitNPerM",   Napi::Number::New(env2, r.designPerUnitNPerM));
          out.Set("totalDesignN",         Napi::Number::New(env2, r.totalDesignN));
          out.Set("awsMinLegM",           Napi::Number::New(env2, r.awsMinLegM));
          out.Set("aiscMaxLegM",          Napi::Number::New(env2, r.aiscMaxLegM));
          out.Set("legBelowAwsMin",       Napi::Boolean::New(env2, r.legBelowAwsMin));
          out.Set("legAboveAiscMax",      Napi::Boolean::New(env2, r.legAboveAiscMax));
          return out;
        });
      }));
    exports.Set("filletweld", fwNs);

    // -------- RC beam flexure (Forge-238) -------------------------------
    auto rcNs = Napi::Object::New(env);
    rcNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::rcbeam::Input in{};
          in.widthM          = o.Get("widthM"         ).As<Napi::Number>().DoubleValue();
          in.effectiveDepthM = o.Get("effectiveDepthM").As<Napi::Number>().DoubleValue();
          in.steelAreaM2     = o.Get("steelAreaM2"    ).As<Napi::Number>().DoubleValue();
          in.concreteFcPa    = o.Get("concreteFcPa"   ).As<Napi::Number>().DoubleValue();
          in.steelFyPa       = o.Get("steelFyPa"      ).As<Napi::Number>().DoubleValue();
          in.steelEPa        = o.Get("steelEPa"       ).As<Napi::Number>().DoubleValue();
          auto r = forge::rcbeam::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("beta1",              Napi::Number::New(env2, r.beta1));
          out.Set("stressBlockDepthM",  Napi::Number::New(env2, r.stressBlockDepthM));
          out.Set("neutralAxisDepthM",  Napi::Number::New(env2, r.neutralAxisDepthM));
          out.Set("steelStrain",        Napi::Number::New(env2, r.steelStrain));
          out.Set("phi",                Napi::Number::New(env2, r.phi));
          out.Set("nominalMomentNm",    Napi::Number::New(env2, r.nominalMomentNm));
          out.Set("designMomentNm",     Napi::Number::New(env2, r.designMomentNm));
          out.Set("rho",                Napi::Number::New(env2, r.rho));
          out.Set("rhoMin",             Napi::Number::New(env2, r.rhoMin));
          out.Set("rhoBalanced",        Napi::Number::New(env2, r.rhoBalanced));
          out.Set("rhoMax",             Napi::Number::New(env2, r.rhoMax));
          out.Set("tensionControlled",  Napi::Boolean::New(env2, r.tensionControlled));
          out.Set("belowRhoMin",        Napi::Boolean::New(env2, r.belowRhoMin));
          out.Set("aboveRhoMax",        Napi::Boolean::New(env2, r.aboveRhoMax));
          return out;
        });
      }));
    exports.Set("rcbeam", rcNs);

    // -------- Soil bearing capacity (Forge-239) -------------------------
    auto bgNs = Napi::Object::New(env);
    bgNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::bearingcap::Input in{};
          in.shape            = forge::bearingcap::shapeFromString(
              o.Get("shape").As<Napi::String>().Utf8Value().c_str());
          in.widthM           = o.Get("widthM"          ).As<Napi::Number>().DoubleValue();
          in.depthM           = o.Get("depthM"          ).As<Napi::Number>().DoubleValue();
          in.cohesionPa       = o.Get("cohesionPa"      ).As<Napi::Number>().DoubleValue();
          in.surchargeKnPerM3 = o.Get("surchargeKnPerM3").As<Napi::Number>().DoubleValue();
          in.frictionAngleDeg = o.Get("frictionAngleDeg").As<Napi::Number>().DoubleValue();
          in.factorOfSafety   = o.Get("factorOfSafety"  ).As<Napi::Number>().DoubleValue();
          auto r = forge::bearingcap::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("Nq",                 Napi::Number::New(env2, r.Nq));
          out.Set("Nc",                 Napi::Number::New(env2, r.Nc));
          out.Set("Ngamma",             Napi::Number::New(env2, r.Ngamma));
          out.Set("shapeFactorC",       Napi::Number::New(env2, r.shapeFactorC));
          out.Set("shapeFactorQ",       Napi::Number::New(env2, r.shapeFactorQ));
          out.Set("shapeFactorGamma",   Napi::Number::New(env2, r.shapeFactorGamma));
          out.Set("depthFactorC",       Napi::Number::New(env2, r.depthFactorC));
          out.Set("depthFactorQ",       Napi::Number::New(env2, r.depthFactorQ));
          out.Set("depthFactorGamma",   Napi::Number::New(env2, r.depthFactorGamma));
          out.Set("surchargePa",        Napi::Number::New(env2, r.surchargePa));
          out.Set("ultimateBearingPa",  Napi::Number::New(env2, r.ultimateBearingPa));
          out.Set("allowableBearingPa", Napi::Number::New(env2, r.allowableBearingPa));
          return out;
        });
      }));
    exports.Set("bearingcap", bgNs);

    // -------- Retaining wall (Forge-240) --------------------------------
    auto rwNs = Napi::Object::New(env);
    rwNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::retwall::Input in{};
          in.totalHeightM             = o.Get("totalHeightM"            ).As<Napi::Number>().DoubleValue();
          in.embedmentDepthM          = o.Get("embedmentDepthM"         ).As<Napi::Number>().DoubleValue();
          in.baseWidthM               = o.Get("baseWidthM"              ).As<Napi::Number>().DoubleValue();
          in.toeWidthM                = o.Get("toeWidthM"               ).As<Napi::Number>().DoubleValue();
          in.stemThicknessM           = o.Get("stemThicknessM"          ).As<Napi::Number>().DoubleValue();
          in.baseThicknessM           = o.Get("baseThicknessM"          ).As<Napi::Number>().DoubleValue();
          in.unitWeightSoilNPerM3     = o.Get("unitWeightSoilNPerM3"    ).As<Napi::Number>().DoubleValue();
          in.frictionAngleDeg         = o.Get("frictionAngleDeg"        ).As<Napi::Number>().DoubleValue();
          in.cohesionPa               = o.Get("cohesionPa"              ).As<Napi::Number>().DoubleValue();
          in.frictionCoeffBase        = o.Get("frictionCoeffBase"       ).As<Napi::Number>().DoubleValue();
          in.surchargePa              = o.Get("surchargePa"             ).As<Napi::Number>().DoubleValue();
          in.unitWeightConcreteNPerM3 = o.Get("unitWeightConcreteNPerM3").As<Napi::Number>().DoubleValue();
          in.allowableBearingPa       = o.Get("allowableBearingPa"      ).As<Napi::Number>().DoubleValue();
          auto r = forge::retwall::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("Ka",                      Napi::Number::New(env2, r.Ka));
          out.Set("Kp",                      Napi::Number::New(env2, r.Kp));
          out.Set("activeForceN",            Napi::Number::New(env2, r.activeForceN));
          out.Set("activeMomentNm",          Napi::Number::New(env2, r.activeMomentNm));
          out.Set("passiveForceN",           Napi::Number::New(env2, r.passiveForceN));
          out.Set("weightTotalN",            Napi::Number::New(env2, r.weightTotalN));
          out.Set("overturningMomentNm",     Napi::Number::New(env2, r.overturningMomentNm));
          out.Set("resistingMomentNm",       Napi::Number::New(env2, r.resistingMomentNm));
          out.Set("safetyFactorOverturning", Napi::Number::New(env2, r.safetyFactorOverturning));
          out.Set("safetyFactorSliding",     Napi::Number::New(env2, r.safetyFactorSliding));
          out.Set("resultantArmM",           Napi::Number::New(env2, r.resultantArmM));
          out.Set("eccentricityM",           Napi::Number::New(env2, r.eccentricityM));
          out.Set("toeBearingPa",            Napi::Number::New(env2, r.toeBearingPa));
          out.Set("heelBearingPa",           Napi::Number::New(env2, r.heelBearingPa));
          out.Set("safetyFactorBearing",     Napi::Number::New(env2, r.safetyFactorBearing));
          return out;
        });
      }));
    exports.Set("retwall", rwNs);

    // -------- Pile capacity (Forge-241) ---------------------------------
    auto plNs = Napi::Object::New(env);
    plNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::pilecap::Input in{};
          in.diameterM          = o.Get("diameterM"         ).As<Napi::Number>().DoubleValue();
          in.waterTableDepthM   = o.Get("waterTableDepthM"  ).As<Napi::Number>().DoubleValue();
          in.factorOfSafety     = o.Get("factorOfSafety"    ).As<Napi::Number>().DoubleValue();
          in.Nq_tip             = o.Get("Nq_tip"            ).As<Napi::Number>().DoubleValue();
          in.limitTipBearingPa  = o.Get("limitTipBearingPa" ).As<Napi::Number>().DoubleValue();
          auto layersArr = o.Get("layers").As<Napi::Array>();
          for (uint32_t i = 0; i < layersArr.Length(); ++i) {
            auto lo = layersArr.Get(i).As<Napi::Object>();
            forge::pilecap::Layer L{};
            std::string typeStr = lo.Get("type").As<Napi::String>().Utf8Value();
            if (typeStr == "clay")      L.type = forge::pilecap::SoilType::Clay;
            else if (typeStr == "sand") L.type = forge::pilecap::SoilType::Sand;
            else throw std::invalid_argument("layer type must be 'clay' or 'sand'");
            L.thicknessM                = lo.Get("thicknessM"               ).As<Napi::Number>().DoubleValue();
            L.effectiveUnitWeightNPerM3 = lo.Get("effectiveUnitWeightNPerM3").As<Napi::Number>().DoubleValue();
            L.undrainedShearStrengthPa  = lo.Get("undrainedShearStrengthPa" ).As<Napi::Number>().DoubleValue();
            L.alpha                     = lo.Get("alpha"                    ).As<Napi::Number>().DoubleValue();
            L.frictionAngleDeg          = lo.Get("frictionAngleDeg"         ).As<Napi::Number>().DoubleValue();
            L.beta                      = lo.Get("beta"                     ).As<Napi::Number>().DoubleValue();
            in.layers.push_back(L);
          }
          auto r = forge::pilecap::analyse(in);
          auto out = Napi::Object::New(env2);
          auto larr = Napi::Array::New(env2, r.layers.size());
          for (size_t i = 0; i < r.layers.size(); ++i) {
            auto lo = Napi::Object::New(env2);
            lo.Set("topDepthM",              Napi::Number::New(env2, r.layers[i].topDepthM));
            lo.Set("bottomDepthM",           Napi::Number::New(env2, r.layers[i].bottomDepthM));
            lo.Set("effectiveStressAtMidPa", Napi::Number::New(env2, r.layers[i].effectiveStressAtMidPa));
            lo.Set("skinFrictionPa",         Napi::Number::New(env2, r.layers[i].skinFrictionPa));
            lo.Set("skinForceN",             Napi::Number::New(env2, r.layers[i].skinForceN));
            larr.Set(static_cast<uint32_t>(i), lo);
          }
          out.Set("layers",                  larr);
          out.Set("effectiveStressAtTipPa",  Napi::Number::New(env2, r.effectiveStressAtTipPa));
          out.Set("tipBearingPa",            Napi::Number::New(env2, r.tipBearingPa));
          out.Set("tipForceN",               Napi::Number::New(env2, r.tipForceN));
          out.Set("shaftForceN",             Napi::Number::New(env2, r.shaftForceN));
          out.Set("ultimateCapacityN",       Napi::Number::New(env2, r.ultimateCapacityN));
          out.Set("allowableCapacityN",      Napi::Number::New(env2, r.allowableCapacityN));
          return out;
        });
      }));
    exports.Set("pilecap", plNs);

    // -------- Open channel flow (Forge-242) -----------------------------
    auto ocNs = Napi::Object::New(env);
    auto readGeom = [](const Napi::Object& o) {
      forge::openchannel::GeomInput g{};
      g.bottomWidthM = o.Get("bottomWidthM").As<Napi::Number>().DoubleValue();
      g.sideSlopeM   = o.Get("sideSlopeM"  ).As<Napi::Number>().DoubleValue();
      return g;
    };
    ocNs.Set("sectionAtDepth", Napi::Function::New(env,
      [readGeom](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          auto g = readGeom(o.Get("geom").As<Napi::Object>());
          const double y = o.Get("depthM").As<Napi::Number>().DoubleValue();
          auto r = forge::openchannel::sectionAtDepth(g, y);
          auto out = Napi::Object::New(env2);
          out.Set("area",             Napi::Number::New(env2, r.area));
          out.Set("wetPerim",         Napi::Number::New(env2, r.wetPerim));
          out.Set("hydraulicRadius",  Napi::Number::New(env2, r.hydraulicRadius));
          out.Set("topWidth",         Napi::Number::New(env2, r.topWidth));
          return out;
        });
      }));
    ocNs.Set("manningDischarge", Napi::Function::New(env,
      [readGeom](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::openchannel::UniformInput u{};
          u.geom      = readGeom(o.Get("geom").As<Napi::Object>());
          u.manningN  = o.Get("manningN").As<Napi::Number>().DoubleValue();
          u.slope     = o.Get("slope"   ).As<Napi::Number>().DoubleValue();
          u.depthM    = o.Get("depthM"  ).As<Napi::Number>().DoubleValue();
          return Napi::Number::New(env2, forge::openchannel::manningDischarge(u));
        });
      }));
    ocNs.Set("normalDepth", Napi::Function::New(env,
      [readGeom](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::openchannel::NormalDepthInput in{};
          in.geom            = readGeom(o.Get("geom").As<Napi::Object>());
          in.manningN        = o.Get("manningN"       ).As<Napi::Number>().DoubleValue();
          in.slope           = o.Get("slope"          ).As<Napi::Number>().DoubleValue();
          in.targetDischarge = o.Get("targetDischarge").As<Napi::Number>().DoubleValue();
          return Napi::Number::New(env2, forge::openchannel::normalDepth(in));
        });
      }));
    ocNs.Set("criticalDepth", Napi::Function::New(env,
      [readGeom](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::openchannel::CriticalDepthInput in{};
          in.geom        = readGeom(o.Get("geom").As<Napi::Object>());
          in.dischargeQ  = o.Get("dischargeQ").As<Napi::Number>().DoubleValue();
          in.gravityG    = o.Get("gravityG"  ).As<Napi::Number>().DoubleValue();
          return Napi::Number::New(env2, forge::openchannel::criticalDepth(in));
        });
      }));
    ocNs.Set("flowRegime", Napi::Function::New(env,
      [readGeom](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::openchannel::FlowRegimeInput in{};
          in.geom       = readGeom(o.Get("geom").As<Napi::Object>());
          in.depthM     = o.Get("depthM"    ).As<Napi::Number>().DoubleValue();
          in.dischargeQ = o.Get("dischargeQ").As<Napi::Number>().DoubleValue();
          in.gravityG   = o.Get("gravityG"  ).As<Napi::Number>().DoubleValue();
          auto r = forge::openchannel::flowRegime(in);
          auto out = Napi::Object::New(env2);
          out.Set("area",           Napi::Number::New(env2, r.area));
          out.Set("topWidth",       Napi::Number::New(env2, r.topWidth));
          out.Set("hydraulicDepth", Napi::Number::New(env2, r.hydraulicDepth));
          out.Set("velocity",       Napi::Number::New(env2, r.velocity));
          out.Set("froude",         Napi::Number::New(env2, r.froude));
          out.Set("regime",         Napi::Number::New(env2, r.regime));
          return out;
        });
      }));
    exports.Set("openchannel", ocNs);

    // -------- Weir / orifice (Forge-243) --------------------------------
    auto woNs = Napi::Object::New(env);
    woNs.Set("rectWeirDischarge", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::weir::RectInput in{};
          in.crestLengthM      = o.Get("crestLengthM"     ).As<Napi::Number>().DoubleValue();
          in.headM             = o.Get("headM"            ).As<Napi::Number>().DoubleValue();
          in.dischargeCoeff    = o.Get("dischargeCoeff"   ).As<Napi::Number>().DoubleValue();
          in.endContractions   = o.Get("endContractions"  ).As<Napi::Number>().Int32Value();
          in.gravityG          = o.Get("gravityG"         ).As<Napi::Number>().DoubleValue();
          return Napi::Number::New(env2, forge::weir::rectWeirDischarge(in));
        });
      }));
    woNs.Set("vNotchDischarge", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::weir::VNotchInput in{};
          in.notchAngleDeg     = o.Get("notchAngleDeg"    ).As<Napi::Number>().DoubleValue();
          in.headM             = o.Get("headM"            ).As<Napi::Number>().DoubleValue();
          in.dischargeCoeff    = o.Get("dischargeCoeff"   ).As<Napi::Number>().DoubleValue();
          in.gravityG          = o.Get("gravityG"         ).As<Napi::Number>().DoubleValue();
          return Napi::Number::New(env2, forge::weir::vNotchDischarge(in));
        });
      }));
    woNs.Set("orificeDischarge", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::weir::OrificeInput in{};
          in.areaM2            = o.Get("areaM2"           ).As<Napi::Number>().DoubleValue();
          in.headM             = o.Get("headM"            ).As<Napi::Number>().DoubleValue();
          in.dischargeCoeff    = o.Get("dischargeCoeff"   ).As<Napi::Number>().DoubleValue();
          in.gravityG          = o.Get("gravityG"         ).As<Napi::Number>().DoubleValue();
          return Napi::Number::New(env2, forge::weir::orificeDischarge(in));
        });
      }));
    exports.Set("weir", woNs);

    // -------- Three-phase power (Forge-244) -----------------------------
    auto tpNs = Napi::Object::New(env);
    tpNs.Set("balancedPower", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::threephase::PowerInput in{};
          std::string conn = o.Get("connection").As<Napi::String>().Utf8Value();
          in.connection = (conn == "delta") ? forge::threephase::Connection::Delta
                                            : forge::threephase::Connection::Star;
          in.lineLineVoltageV = o.Get("lineLineVoltageV").As<Napi::Number>().DoubleValue();
          in.lineCurrentA     = o.Get("lineCurrentA"    ).As<Napi::Number>().DoubleValue();
          in.powerFactor      = o.Get("powerFactor"     ).As<Napi::Number>().DoubleValue();
          in.leading          = o.Get("leading"         ).As<Napi::Boolean>().Value();
          auto r = forge::threephase::balancedPower(in);
          auto out = Napi::Object::New(env2);
          out.Set("phaseVoltageV",  Napi::Number::New(env2, r.phaseVoltageV));
          out.Set("phaseCurrentA",  Napi::Number::New(env2, r.phaseCurrentA));
          out.Set("apparentVA",     Napi::Number::New(env2, r.apparentVA));
          out.Set("realW",          Napi::Number::New(env2, r.realW));
          out.Set("reactiveVAR",    Napi::Number::New(env2, r.reactiveVAR));
          return out;
        });
      }));
    tpNs.Set("powerFactorCorrection", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::threephase::PfCorrInput in{};
          in.realPowerW       = o.Get("realPowerW"      ).As<Napi::Number>().DoubleValue();
          in.powerFactor1     = o.Get("powerFactor1"    ).As<Napi::Number>().DoubleValue();
          in.powerFactor2     = o.Get("powerFactor2"    ).As<Napi::Number>().DoubleValue();
          in.lineLineVoltageV = o.Get("lineLineVoltageV").As<Napi::Number>().DoubleValue();
          in.frequencyHz      = o.Get("frequencyHz"     ).As<Napi::Number>().DoubleValue();
          auto r = forge::threephase::powerFactorCorrection(in);
          auto out = Napi::Object::New(env2);
          out.Set("phi1Rad",            Napi::Number::New(env2, r.phi1Rad));
          out.Set("phi2Rad",            Napi::Number::New(env2, r.phi2Rad));
          out.Set("reactiveBeforeVAR",  Napi::Number::New(env2, r.reactiveBeforeVAR));
          out.Set("reactiveAfterVAR",   Napi::Number::New(env2, r.reactiveAfterVAR));
          out.Set("capacitorVAR",       Napi::Number::New(env2, r.capacitorVAR));
          out.Set("capacitanceF",       Napi::Number::New(env2, r.capacitanceF));
          return out;
        });
      }));
    tpNs.Set("perUnit", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::threephase::PerUnitInput in{};
          in.baseVA               = o.Get("baseVA"              ).As<Napi::Number>().DoubleValue();
          in.baseVoltageLineLineV = o.Get("baseVoltageLineLineV").As<Napi::Number>().DoubleValue();
          in.ohmicZ               = o.Get("ohmicZ"              ).As<Napi::Number>().DoubleValue();
          auto r = forge::threephase::perUnit(in);
          auto out = Napi::Object::New(env2);
          out.Set("baseImpedanceOhm", Napi::Number::New(env2, r.baseImpedanceOhm));
          out.Set("baseCurrentA",     Napi::Number::New(env2, r.baseCurrentA));
          out.Set("zpu",              Napi::Number::New(env2, r.zpu));
          return out;
        });
      }));
    exports.Set("threephase", tpNs);

    // -------- Transformer (Forge-245) -----------------------------------
    auto trNs = Napi::Object::New(env);
    trNs.Set("openCircuitTest", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::transformer::OcTestInput in{};
          in.openCircuitVoltageV = o.Get("openCircuitVoltageV").As<Napi::Number>().DoubleValue();
          in.openCircuitCurrentA = o.Get("openCircuitCurrentA").As<Napi::Number>().DoubleValue();
          in.openCircuitPowerW   = o.Get("openCircuitPowerW"  ).As<Napi::Number>().DoubleValue();
          auto r = forge::transformer::openCircuitTest(in);
          auto out = Napi::Object::New(env2);
          out.Set("cosPhiOc",                Napi::Number::New(env2, r.cosPhiOc));
          out.Set("coreResistanceOhm",       Napi::Number::New(env2, r.coreResistanceOhm));
          out.Set("magnetisingReactanceOhm", Napi::Number::New(env2, r.magnetisingReactanceOhm));
          return out;
        });
      }));
    trNs.Set("shortCircuitTest", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::transformer::ScTestInput in{};
          in.shortCircuitCurrentA = o.Get("shortCircuitCurrentA").As<Napi::Number>().DoubleValue();
          in.shortCircuitVoltageV = o.Get("shortCircuitVoltageV").As<Napi::Number>().DoubleValue();
          in.shortCircuitPowerW   = o.Get("shortCircuitPowerW"  ).As<Napi::Number>().DoubleValue();
          auto r = forge::transformer::shortCircuitTest(in);
          auto out = Napi::Object::New(env2);
          out.Set("equivalentResistanceOhm", Napi::Number::New(env2, r.equivalentResistanceOhm));
          out.Set("equivalentImpedanceOhm",  Napi::Number::New(env2, r.equivalentImpedanceOhm));
          out.Set("equivalentReactanceOhm",  Napi::Number::New(env2, r.equivalentReactanceOhm));
          return out;
        });
      }));
    trNs.Set("voltageRegulation", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::transformer::RegInput in{};
          in.equivalentResistanceOhm = o.Get("equivalentResistanceOhm").As<Napi::Number>().DoubleValue();
          in.equivalentReactanceOhm  = o.Get("equivalentReactanceOhm" ).As<Napi::Number>().DoubleValue();
          in.ratedHvCurrentA         = o.Get("ratedHvCurrentA"        ).As<Napi::Number>().DoubleValue();
          in.loadFraction            = o.Get("loadFraction"           ).As<Napi::Number>().DoubleValue();
          in.powerFactor             = o.Get("powerFactor"            ).As<Napi::Number>().DoubleValue();
          in.leading                 = o.Get("leading"                ).As<Napi::Boolean>().Value();
          in.ratedHvVoltageV         = o.Get("ratedHvVoltageV"        ).As<Napi::Number>().DoubleValue();
          auto r = forge::transformer::voltageRegulation(in);
          auto out = Napi::Object::New(env2);
          out.Set("voltageDropV",   Napi::Number::New(env2, r.voltageDropV));
          out.Set("regulationPct",  Napi::Number::New(env2, r.regulationPct));
          return out;
        });
      }));
    trNs.Set("efficiency", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::transformer::EffInput in{};
          in.ratedKva            = o.Get("ratedKva"           ).As<Napi::Number>().DoubleValue();
          in.openCircuitPowerW   = o.Get("openCircuitPowerW"  ).As<Napi::Number>().DoubleValue();
          in.shortCircuitPowerW  = o.Get("shortCircuitPowerW" ).As<Napi::Number>().DoubleValue();
          in.loadFraction        = o.Get("loadFraction"       ).As<Napi::Number>().DoubleValue();
          in.powerFactor         = o.Get("powerFactor"        ).As<Napi::Number>().DoubleValue();
          return Napi::Number::New(env2, forge::transformer::efficiency(in));
        });
      }));
    trNs.Set("maximumEfficiencyLoadFraction", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          return Napi::Number::New(env2,
              forge::transformer::maximumEfficiencyLoadFraction(
                  info[0].As<Napi::Number>().DoubleValue(),
                  info[1].As<Napi::Number>().DoubleValue()));
        });
      }));
    exports.Set("transformer", trNs);

    // -------- Induction motor (Forge-246) -------------------------------
    auto imNs = Napi::Object::New(env);
    imNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::inductionmotor::Input in{};
          in.phaseVoltageV = o.Get("phaseVoltageV").As<Napi::Number>().DoubleValue();
          in.frequencyHz   = o.Get("frequencyHz"  ).As<Napi::Number>().DoubleValue();
          in.poles         = o.Get("poles"        ).As<Napi::Number>().Int32Value();
          in.stator_R1     = o.Get("stator_R1"    ).As<Napi::Number>().DoubleValue();
          in.stator_X1     = o.Get("stator_X1"    ).As<Napi::Number>().DoubleValue();
          in.rotor_R2      = o.Get("rotor_R2"     ).As<Napi::Number>().DoubleValue();
          in.rotor_X2      = o.Get("rotor_X2"     ).As<Napi::Number>().DoubleValue();
          in.mag_Xm        = o.Get("mag_Xm"       ).As<Napi::Number>().DoubleValue();
          in.slip          = o.Get("slip"         ).As<Napi::Number>().DoubleValue();
          auto r = forge::inductionmotor::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("synchronousRadPerS",  Napi::Number::New(env2, r.synchronousRadPerS));
          out.Set("synchronousRpm",      Napi::Number::New(env2, r.synchronousRpm));
          out.Set("mechanicalRpm",       Napi::Number::New(env2, r.mechanicalRpm));
          out.Set("thevenin_V",          Napi::Number::New(env2, r.thevenin_V));
          out.Set("thevenin_R",          Napi::Number::New(env2, r.thevenin_R));
          out.Set("thevenin_X",          Napi::Number::New(env2, r.thevenin_X));
          out.Set("developedTorqueNm",   Napi::Number::New(env2, r.developedTorqueNm));
          out.Set("airGapPowerW",        Napi::Number::New(env2, r.airGapPowerW));
          out.Set("mechPowerW",          Napi::Number::New(env2, r.mechPowerW));
          out.Set("rotorCopperLossW",    Napi::Number::New(env2, r.rotorCopperLossW));
          out.Set("rotorCurrentA",       Napi::Number::New(env2, r.rotorCurrentA));
          out.Set("breakdownSlip",       Napi::Number::New(env2, r.breakdownSlip));
          out.Set("breakdownTorqueNm",   Napi::Number::New(env2, r.breakdownTorqueNm));
          out.Set("startingTorqueNm",    Napi::Number::New(env2, r.startingTorqueNm));
          out.Set("startingCurrentA",    Napi::Number::New(env2, r.startingCurrentA));
          return out;
        });
      }));
    exports.Set("inductionmotor", imNs);

    // -------- Symmetrical components (Forge-247) ------------------------
    auto syNs = Napi::Object::New(env);
    auto polarFromObj = [](const Napi::Object& o) {
      forge::symcomp::PhasorPolar p{};
      p.magnitude = o.Get("magnitude").As<Napi::Number>().DoubleValue();
      p.angleDeg  = o.Get("angleDeg" ).As<Napi::Number>().DoubleValue();
      return p;
    };
    auto polarToObj = [](Napi::Env env2, const forge::symcomp::PhasorPolar& p) {
      auto o = Napi::Object::New(env2);
      o.Set("magnitude", Napi::Number::New(env2, p.magnitude));
      o.Set("angleDeg",  Napi::Number::New(env2, p.angleDeg));
      return o;
    };
    syNs.Set("decompose", Napi::Function::New(env,
      [polarFromObj, polarToObj](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::symcomp::DecomposeInput in{
            polarFromObj(o.Get("Va").As<Napi::Object>()),
            polarFromObj(o.Get("Vb").As<Napi::Object>()),
            polarFromObj(o.Get("Vc").As<Napi::Object>()),
          };
          auto r = forge::symcomp::decompose(in);
          auto out = Napi::Object::New(env2);
          out.Set("zero",     polarToObj(env2, r.zero));
          out.Set("positive", polarToObj(env2, r.positive));
          out.Set("negative", polarToObj(env2, r.negative));
          return out;
        });
      }));
    syNs.Set("compose", Napi::Function::New(env,
      [polarFromObj, polarToObj](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::symcomp::DecomposeResult in{
            polarFromObj(o.Get("zero"    ).As<Napi::Object>()),
            polarFromObj(o.Get("positive").As<Napi::Object>()),
            polarFromObj(o.Get("negative").As<Napi::Object>()),
          };
          auto r = forge::symcomp::compose(in);
          auto out = Napi::Object::New(env2);
          out.Set("Va", polarToObj(env2, r.Va));
          out.Set("Vb", polarToObj(env2, r.Vb));
          out.Set("Vc", polarToObj(env2, r.Vc));
          return out;
        });
      }));
    syNs.Set("faultCurrents", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::symcomp::FaultInput in{};
          in.prefaultPhaseVoltage = o.Get("prefaultPhaseVoltage").As<Napi::Number>().DoubleValue();
          in.Z0_magnitude         = o.Get("Z0_magnitude"        ).As<Napi::Number>().DoubleValue();
          in.Z0_angleDeg          = o.Get("Z0_angleDeg"         ).As<Napi::Number>().DoubleValue();
          in.Z1_magnitude         = o.Get("Z1_magnitude"        ).As<Napi::Number>().DoubleValue();
          in.Z1_angleDeg          = o.Get("Z1_angleDeg"         ).As<Napi::Number>().DoubleValue();
          in.Z2_magnitude         = o.Get("Z2_magnitude"        ).As<Napi::Number>().DoubleValue();
          in.Z2_angleDeg          = o.Get("Z2_angleDeg"         ).As<Napi::Number>().DoubleValue();
          auto r = forge::symcomp::faultCurrents(in);
          auto out = Napi::Object::New(env2);
          out.Set("threePhaseFaultI",   Napi::Number::New(env2, r.threePhaseFaultI));
          out.Set("lineToGroundFaultI", Napi::Number::New(env2, r.lineToGroundFaultI));
          out.Set("lineToLineFaultI",   Napi::Number::New(env2, r.lineToLineFaultI));
          return out;
        });
      }));
    exports.Set("symcomp", syNs);

    // -------- Transmission line (Forge-248) -----------------------------
    auto tlNs = Napi::Object::New(env);
    auto modelFromStr = [](const std::string& s) {
      if (s == "short")    return forge::tline::Model::Short;
      if (s == "mediumPi") return forge::tline::Model::MediumPi;
      if (s == "long")     return forge::tline::Model::LongLine;
      throw std::invalid_argument("model must be short / mediumPi / long");
    };
    auto readLineParams = [](const Napi::Object& o) {
      forge::tline::LineParams p{};
      p.resistancePerKmOhm  = o.Get("resistancePerKmOhm" ).As<Napi::Number>().DoubleValue();
      p.reactancePerKmOhm   = o.Get("reactancePerKmOhm"  ).As<Napi::Number>().DoubleValue();
      p.conductancePerKmS   = o.Get("conductancePerKmS"  ).As<Napi::Number>().DoubleValue();
      p.susceptancePerKmS   = o.Get("susceptancePerKmS"  ).As<Napi::Number>().DoubleValue();
      p.lengthKm            = o.Get("lengthKm"           ).As<Napi::Number>().DoubleValue();
      return p;
    };
    auto abcdToObj = [](Napi::Env env2, const forge::tline::Abcd& a) {
      auto o = Napi::Object::New(env2);
      o.Set("A_mag", Napi::Number::New(env2, a.A_mag));
      o.Set("A_ang", Napi::Number::New(env2, a.A_ang));
      o.Set("B_mag", Napi::Number::New(env2, a.B_mag));
      o.Set("B_ang", Napi::Number::New(env2, a.B_ang));
      o.Set("C_mag", Napi::Number::New(env2, a.C_mag));
      o.Set("C_ang", Napi::Number::New(env2, a.C_ang));
      o.Set("D_mag", Napi::Number::New(env2, a.D_mag));
      o.Set("D_ang", Napi::Number::New(env2, a.D_ang));
      return o;
    };
    tlNs.Set("abcd", Napi::Function::New(env,
      [modelFromStr, readLineParams, abcdToObj](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          auto model = modelFromStr(o.Get("model").As<Napi::String>().Utf8Value());
          auto params = readLineParams(o.Get("params").As<Napi::Object>());
          return abcdToObj(env2, forge::tline::abcd(model, params));
        });
      }));
    tlNs.Set("analyse", Napi::Function::New(env,
      [modelFromStr, readLineParams, abcdToObj](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          auto model = modelFromStr(o.Get("model").As<Napi::String>().Utf8Value());
          auto params = readLineParams(o.Get("params").As<Napi::Object>());
          auto loadO = o.Get("load").As<Napi::Object>();
          forge::tline::LoadInput load{};
          load.receivingPhaseVoltageV = loadO.Get("receivingPhaseVoltageV").As<Napi::Number>().DoubleValue();
          load.receivingPowerW        = loadO.Get("receivingPowerW"       ).As<Napi::Number>().DoubleValue();
          load.receivingPowerFactor   = loadO.Get("receivingPowerFactor"  ).As<Napi::Number>().DoubleValue();
          load.leading                = loadO.Get("leading"               ).As<Napi::Boolean>().Value();
          auto r = forge::tline::analyse(model, params, load);
          auto out = Napi::Object::New(env2);
          out.Set("abcd",                  abcdToObj(env2, r.abcd));
          out.Set("sendingVoltageV",       Napi::Number::New(env2, r.sendingVoltageV));
          out.Set("sendingVoltageAngDeg",  Napi::Number::New(env2, r.sendingVoltageAngDeg));
          out.Set("sendingCurrentA",       Napi::Number::New(env2, r.sendingCurrentA));
          out.Set("sendingCurrentAngDeg",  Napi::Number::New(env2, r.sendingCurrentAngDeg));
          out.Set("sendingPowerFactor",    Napi::Number::New(env2, r.sendingPowerFactor));
          out.Set("sendingRealPowerW",     Napi::Number::New(env2, r.sendingRealPowerW));
          out.Set("sendingApparentVA",     Napi::Number::New(env2, r.sendingApparentVA));
          out.Set("regulationPct",         Napi::Number::New(env2, r.regulationPct));
          out.Set("efficiency",            Napi::Number::New(env2, r.efficiency));
          return out;
        });
      }));
    exports.Set("tline", tlNs);

    // -------- Synchronous machine (Forge-249) ---------------------------
    auto symNs = Napi::Object::New(env);
    symNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::syncmachine::Input in{};
          std::string mode = o.Get("mode").As<Napi::String>().Utf8Value();
          in.mode = (mode == "motor") ? forge::syncmachine::Mode::Motor
                                       : forge::syncmachine::Mode::Generator;
          in.terminalPhaseVoltageV   = o.Get("terminalPhaseVoltageV"  ).As<Napi::Number>().DoubleValue();
          in.synchronousReactanceOhm = o.Get("synchronousReactanceOhm").As<Napi::Number>().DoubleValue();
          in.armatureResistanceOhm   = o.Get("armatureResistanceOhm"  ).As<Napi::Number>().DoubleValue();
          in.realPowerPerPhaseW      = o.Get("realPowerPerPhaseW"     ).As<Napi::Number>().DoubleValue();
          in.powerFactor             = o.Get("powerFactor"            ).As<Napi::Number>().DoubleValue();
          in.leading                 = o.Get("leading"                ).As<Napi::Boolean>().Value();
          auto r = forge::syncmachine::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("armatureCurrentA",         Napi::Number::New(env2, r.armatureCurrentA));
          out.Set("armatureCurrentAngDeg",    Napi::Number::New(env2, r.armatureCurrentAngDeg));
          out.Set("inducedEmfV",              Napi::Number::New(env2, r.inducedEmfV));
          out.Set("inducedEmfAngDeg",         Napi::Number::New(env2, r.inducedEmfAngDeg));
          out.Set("reactivePowerPerPhaseVar", Napi::Number::New(env2, r.reactivePowerPerPhaseVar));
          out.Set("maxPullOutPowerW",         Napi::Number::New(env2, r.maxPullOutPowerW));
          return out;
        });
      }));
    exports.Set("syncmachine", symNs);

    // -------- Power flow Newton-Raphson (Forge-250) ---------------------
    auto pfNs = Napi::Object::New(env);
    pfNs.Set("solve", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();

          std::vector<forge::powerflow::Bus> buses;
          auto busArr = o.Get("buses").As<Napi::Array>();
          for (uint32_t i = 0; i < busArr.Length(); ++i) {
            auto bo = busArr.Get(i).As<Napi::Object>();
            forge::powerflow::Bus b{};
            std::string kind = bo.Get("kind").As<Napi::String>().Utf8Value();
            if      (kind == "slack") b.kind = forge::powerflow::BusKind::Slack;
            else if (kind == "pv")    b.kind = forge::powerflow::BusKind::PV;
            else if (kind == "pq")    b.kind = forge::powerflow::BusKind::PQ;
            else throw std::invalid_argument("bus kind must be slack/pv/pq");
            b.V_init       = bo.Get("V_init"      ).As<Napi::Number>().DoubleValue();
            b.angleDegInit = bo.Get("angleDegInit").As<Napi::Number>().DoubleValue();
            b.P_specified  = bo.Get("P_specified" ).As<Napi::Number>().DoubleValue();
            b.Q_specified  = bo.Get("Q_specified" ).As<Napi::Number>().DoubleValue();
            buses.push_back(b);
          }

          std::vector<forge::powerflow::Branch> branches;
          auto brArr = o.Get("branches").As<Napi::Array>();
          for (uint32_t i = 0; i < brArr.Length(); ++i) {
            auto bo = brArr.Get(i).As<Napi::Object>();
            forge::powerflow::Branch br{};
            br.from   = bo.Get("from"  ).As<Napi::Number>().Int32Value();
            br.to     = bo.Get("to"    ).As<Napi::Number>().Int32Value();
            br.R      = bo.Get("R"     ).As<Napi::Number>().DoubleValue();
            br.X      = bo.Get("X"     ).As<Napi::Number>().DoubleValue();
            br.halfB  = bo.Get("halfB" ).As<Napi::Number>().DoubleValue();
            branches.push_back(br);
          }

          auto sObj = o.Get("settings").As<Napi::Object>();
          forge::powerflow::Settings settings{};
          settings.tolerance     = sObj.Get("tolerance"    ).As<Napi::Number>().DoubleValue();
          settings.maxIterations = sObj.Get("maxIterations").As<Napi::Number>().Int32Value();

          auto r = forge::powerflow::solve(buses, branches, settings);
          auto out = Napi::Object::New(env2);
          auto barr = Napi::Array::New(env2, r.buses.size());
          for (size_t i = 0; i < r.buses.size(); ++i) {
            auto bo = Napi::Object::New(env2);
            bo.Set("V",        Napi::Number::New(env2, r.buses[i].V));
            bo.Set("angleDeg", Napi::Number::New(env2, r.buses[i].angleDeg));
            bo.Set("P",        Napi::Number::New(env2, r.buses[i].P));
            bo.Set("Q",        Napi::Number::New(env2, r.buses[i].Q));
            barr.Set(static_cast<uint32_t>(i), bo);
          }
          out.Set("buses",            barr);
          out.Set("iterations",       Napi::Number::New(env2, r.iterations));
          out.Set("finalMaxMismatch", Napi::Number::New(env2, r.finalMaxMismatch));
          out.Set("converged",        Napi::Boolean::New(env2, r.converged));
          return out;
        });
      }));
    exports.Set("powerflow", pfNs);

    // -------- Short-circuit (Forge-251) ---------------------------------
    auto scNs2 = Napi::Object::New(env);
    scNs2.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::shortcircuit::Input in{};
          in.numBuses            = o.Get("numBuses"           ).As<Napi::Number>().Int32Value();
          in.prefaultVoltagePu   = o.Get("prefaultVoltagePu"  ).As<Napi::Number>().DoubleValue();
          auto gArr = o.Get("generators").As<Napi::Array>();
          for (uint32_t i = 0; i < gArr.Length(); ++i) {
            auto go = gArr.Get(i).As<Napi::Object>();
            forge::shortcircuit::GenShunt g{};
            g.busIndex      = go.Get("busIndex"     ).As<Napi::Number>().Int32Value();
            g.subtransientX = go.Get("subtransientX").As<Napi::Number>().DoubleValue();
            in.generators.push_back(g);
          }
          auto brArr = o.Get("branches").As<Napi::Array>();
          for (uint32_t i = 0; i < brArr.Length(); ++i) {
            auto bo = brArr.Get(i).As<Napi::Object>();
            forge::shortcircuit::Branch br{};
            br.from = bo.Get("from").As<Napi::Number>().Int32Value();
            br.to   = bo.Get("to"  ).As<Napi::Number>().Int32Value();
            br.R    = bo.Get("R"   ).As<Napi::Number>().DoubleValue();
            br.X    = bo.Get("X"   ).As<Napi::Number>().DoubleValue();
            in.branches.push_back(br);
          }
          auto r = forge::shortcircuit::analyse(in);
          auto out = Napi::Object::New(env2);
          auto arr = Napi::Array::New(env2, r.buses.size());
          for (size_t i = 0; i < r.buses.size(); ++i) {
            auto bo = Napi::Object::New(env2);
            bo.Set("zDriveMag",      Napi::Number::New(env2, r.buses[i].zDriveMag));
            bo.Set("zDriveAngDeg",   Napi::Number::New(env2, r.buses[i].zDriveAngDeg));
            bo.Set("faultCurrentPu", Napi::Number::New(env2, r.buses[i].faultCurrentPu));
            bo.Set("faultMvaPu",     Napi::Number::New(env2, r.buses[i].faultMvaPu));
            arr.Set(static_cast<uint32_t>(i), bo);
          }
          out.Set("buses", arr);
          return out;
        });
      }));
    exports.Set("shortcircuit", scNs2);

    // -------- Cable sizing (Forge-252) ----------------------------------
    auto cbNs = Napi::Object::New(env);
    cbNs.Set("ampacityTable", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto table = forge::cable::nec31016Table();
          auto arr = Napi::Array::New(env2, table.size());
          for (size_t i = 0; i < table.size(); ++i) {
            auto o = Napi::Object::New(env2);
            o.Set("size",          Napi::String::New(env2, table[i].size));
            o.Set("xsecMm2",       Napi::Number::New(env2, table[i].xsecMm2));
            o.Set("ampacityCu75C", Napi::Number::New(env2, table[i].ampacityCu75C));
            arr.Set(static_cast<uint32_t>(i), o);
          }
          return arr;
        });
      }));
    cbNs.Set("ampacity", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::cable::AmpacityInput in{};
          in.conductorSize = o.Get("conductorSize").As<Napi::String>().Utf8Value();
          std::string m = o.Get("material").As<Napi::String>().Utf8Value();
          in.material = (m == "aluminum") ? forge::cable::Material::Aluminum
                                          : forge::cable::Material::Copper;
          in.ambientTempC                  = o.Get("ambientTempC"                ).As<Napi::Number>().DoubleValue();
          in.numCurrentCarryingConductors  = o.Get("numCurrentCarryingConductors").As<Napi::Number>().Int32Value();
          auto r = forge::cable::ampacity(in);
          auto out = Napi::Object::New(env2);
          out.Set("baseAmpacityA",      Napi::Number::New(env2, r.baseAmpacityA));
          out.Set("ambientFactor",      Napi::Number::New(env2, r.ambientFactor));
          out.Set("groupingFactor",     Napi::Number::New(env2, r.groupingFactor));
          out.Set("materialFactor",     Napi::Number::New(env2, r.materialFactor));
          out.Set("effectiveAmpacityA", Napi::Number::New(env2, r.effectiveAmpacityA));
          return out;
        });
      }));
    cbNs.Set("voltageDrop", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::cable::VoltageDropInput in{};
          std::string sys = o.Get("system").As<Napi::String>().Utf8Value();
          in.system = (sys == "threePhase") ? forge::cable::System::ThreePhase
                                            : forge::cable::System::SinglePhase;
          in.xsecMm2                          = o.Get("xsecMm2"                         ).As<Napi::Number>().DoubleValue();
          in.lengthMeters                     = o.Get("lengthMeters"                    ).As<Napi::Number>().DoubleValue();
          in.loadAmperes                      = o.Get("loadAmperes"                     ).As<Napi::Number>().DoubleValue();
          in.powerFactor                      = o.Get("powerFactor"                     ).As<Napi::Number>().DoubleValue();
          in.materialResistivityOhmMmSqPerM   = o.Get("materialResistivityOhmMmSqPerM"  ).As<Napi::Number>().DoubleValue();
          in.conductorReactanceOhmPerKm       = o.Get("conductorReactanceOhmPerKm"      ).As<Napi::Number>().DoubleValue();
          in.systemVoltage                    = o.Get("systemVoltage"                   ).As<Napi::Number>().DoubleValue();
          auto r = forge::cable::voltageDrop(in);
          auto out = Napi::Object::New(env2);
          out.Set("cableResistanceOhmPerKm", Napi::Number::New(env2, r.cableResistanceOhmPerKm));
          out.Set("voltageDropV",            Napi::Number::New(env2, r.voltageDropV));
          out.Set("voltageDropPct",          Napi::Number::New(env2, r.voltageDropPct));
          return out;
        });
      }));
    exports.Set("cable", cbNs);

    // -------- Lighting design (Forge-253) -------------------------------
    auto liNs = Napi::Object::New(env);
    auto readRoom = [](const Napi::Object& o) {
      forge::lighting::RoomGeom g{};
      g.lengthM         = o.Get("lengthM"        ).As<Napi::Number>().DoubleValue();
      g.widthM          = o.Get("widthM"         ).As<Napi::Number>().DoubleValue();
      g.mountingHeightM = o.Get("mountingHeightM").As<Napi::Number>().DoubleValue();
      return g;
    };
    liNs.Set("roomCavityRatio", Napi::Function::New(env,
      [readRoom](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto g = readRoom(info[0].As<Napi::Object>());
          return Napi::Number::New(env2, forge::lighting::roomCavityRatio(g));
        });
      }));
    liNs.Set("coefficientOfUtilization", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          return Napi::Number::New(env2,
              forge::lighting::coefficientOfUtilization(
                  info[0].As<Napi::Number>().DoubleValue()));
        });
      }));
    liNs.Set("lumenMethod", Napi::Function::New(env,
      [readRoom](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::lighting::LumenMethodInput in{};
          in.room                = readRoom(o.Get("room").As<Napi::Object>());
          in.lumensPerLuminaire   = o.Get("lumensPerLuminaire"  ).As<Napi::Number>().DoubleValue();
          in.luminaireCount       = o.Get("luminaireCount"      ).As<Napi::Number>().Int32Value();
          in.targetIlluminanceLux = o.Get("targetIlluminanceLux").As<Napi::Number>().DoubleValue();
          in.cuOverride           = o.Get("cuOverride"          ).As<Napi::Number>().DoubleValue();
          in.lightLossFactor      = o.Get("lightLossFactor"     ).As<Napi::Number>().DoubleValue();
          auto r = forge::lighting::lumenMethod(in);
          auto out = Napi::Object::New(env2);
          out.Set("rcr",                  Napi::Number::New(env2, r.rcr));
          out.Set("cu",                   Napi::Number::New(env2, r.cu));
          out.Set("illuminanceLux",       Napi::Number::New(env2, r.illuminanceLux));
          out.Set("requiredLuminaires",   Napi::Number::New(env2, r.requiredLuminaires));
          out.Set("computedTotalLumens",  Napi::Number::New(env2, r.computedTotalLumens));
          return out;
        });
      }));
    exports.Set("lighting", liNs);

    // -------- Battery sizing (Forge-254) --------------------------------
    auto baNs = Napi::Object::New(env);
    baNs.Set("runtime", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::battery::RuntimeInput in{};
          in.ratedCapacityAh  = o.Get("ratedCapacityAh" ).As<Napi::Number>().DoubleValue();
          in.ratedHours       = o.Get("ratedHours"      ).As<Napi::Number>().DoubleValue();
          in.peukertExponent  = o.Get("peukertExponent" ).As<Napi::Number>().DoubleValue();
          in.loadCurrentA     = o.Get("loadCurrentA"    ).As<Napi::Number>().DoubleValue();
          auto r = forge::battery::runtime(in);
          auto out = Napi::Object::New(env2);
          out.Set("effectiveCapacityAh", Napi::Number::New(env2, r.effectiveCapacityAh));
          out.Set("runtimeHours",        Napi::Number::New(env2, r.runtimeHours));
          return out;
        });
      }));
    baNs.Set("chargeTime", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::battery::ChargeInput in{};
          in.ratedCapacityAh  = o.Get("ratedCapacityAh" ).As<Napi::Number>().DoubleValue();
          in.chargeCurrentA   = o.Get("chargeCurrentA"  ).As<Napi::Number>().DoubleValue();
          in.initialSoc       = o.Get("initialSoc"      ).As<Napi::Number>().DoubleValue();
          in.targetSoc        = o.Get("targetSoc"       ).As<Napi::Number>().DoubleValue();
          in.cvPhaseFactor    = o.Get("cvPhaseFactor"   ).As<Napi::Number>().DoubleValue();
          auto r = forge::battery::chargeTime(in);
          auto out = Napi::Object::New(env2);
          out.Set("constantCurrentHours", Napi::Number::New(env2, r.constantCurrentHours));
          out.Set("constantVoltageHours", Napi::Number::New(env2, r.constantVoltageHours));
          out.Set("totalHours",           Napi::Number::New(env2, r.totalHours));
          return out;
        });
      }));
    baNs.Set("terminalState", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::battery::DropInput in{};
          in.openCircuitVoltage     = o.Get("openCircuitVoltage"    ).As<Napi::Number>().DoubleValue();
          in.internalResistanceOhm  = o.Get("internalResistanceOhm" ).As<Napi::Number>().DoubleValue();
          in.loadCurrentA           = o.Get("loadCurrentA"          ).As<Napi::Number>().DoubleValue();
          auto r = forge::battery::terminalState(in);
          auto out = Napi::Object::New(env2);
          out.Set("terminalVoltageV", Napi::Number::New(env2, r.terminalVoltageV));
          out.Set("dropV",            Napi::Number::New(env2, r.dropV));
          out.Set("stateOfCharge",    Napi::Number::New(env2, r.stateOfCharge));
          return out;
        });
      }));
    exports.Set("battery", baNs);

    // -------- Solar PV sizing (Forge-255) -------------------------------
    auto solNs = Napi::Object::New(env);
    solNs.Set("sizeArray", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::solarpv::ArrayInput in{};
          in.dailyEnergyAcWh     = o.Get("dailyEnergyAcWh"    ).As<Napi::Number>().DoubleValue();
          in.peakSunHours        = o.Get("peakSunHours"       ).As<Napi::Number>().DoubleValue();
          in.panelWattPeak       = o.Get("panelWattPeak"      ).As<Napi::Number>().DoubleValue();
          in.inverterEfficiency  = o.Get("inverterEfficiency" ).As<Napi::Number>().DoubleValue();
          in.batteryEfficiency   = o.Get("batteryEfficiency"  ).As<Napi::Number>().DoubleValue();
          in.arrayDeratingFactor = o.Get("arrayDeratingFactor").As<Napi::Number>().DoubleValue();
          auto r = forge::solarpv::sizeArray(in);
          auto out = Napi::Object::New(env2);
          out.Set("requiredArrayPowerWp",  Napi::Number::New(env2, r.requiredArrayPowerWp));
          out.Set("numberOfPanels",        Napi::Number::New(env2, r.numberOfPanels));
          out.Set("installedArrayPowerWp", Napi::Number::New(env2, r.installedArrayPowerWp));
          return out;
        });
      }));
    solNs.Set("sizeBatteryBank", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::solarpv::BatteryInput in{};
          in.dailyEnergyAcWh    = o.Get("dailyEnergyAcWh"   ).As<Napi::Number>().DoubleValue();
          in.autonomyDays       = o.Get("autonomyDays"      ).As<Napi::Number>().DoubleValue();
          in.depthOfDischarge   = o.Get("depthOfDischarge"  ).As<Napi::Number>().DoubleValue();
          in.batteryBankVoltage = o.Get("batteryBankVoltage").As<Napi::Number>().DoubleValue();
          in.batteryEfficiency  = o.Get("batteryEfficiency" ).As<Napi::Number>().DoubleValue();
          auto r = forge::solarpv::sizeBatteryBank(in);
          auto out = Napi::Object::New(env2);
          out.Set("storageEnergyWh",    Napi::Number::New(env2, r.storageEnergyWh));
          out.Set("batteryCapacityAh",  Napi::Number::New(env2, r.batteryCapacityAh));
          return out;
        });
      }));
    solNs.Set("sizeInverterVA", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::solarpv::InverterInput in{};
          in.peakAcLoadW  = o.Get("peakAcLoadW" ).As<Napi::Number>().DoubleValue();
          in.powerFactor  = o.Get("powerFactor" ).As<Napi::Number>().DoubleValue();
          in.sizingFactor = o.Get("sizingFactor").As<Napi::Number>().DoubleValue();
          return Napi::Number::New(env2, forge::solarpv::sizeInverterVA(in));
        });
      }));
    exports.Set("solarpv", solNs);

    // -------- Hydrology (Forge-256) -------------------------------------
    auto hyNs = Napi::Object::New(env);
    hyNs.Set("rationalDischarge", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::hydrology::RunoffInput in{};
          in.runoffCoefficient      = o.Get("runoffCoefficient"     ).As<Napi::Number>().DoubleValue();
          in.rainfallIntensityMmHr  = o.Get("rainfallIntensityMmHr" ).As<Napi::Number>().DoubleValue();
          in.drainageAreaM2         = o.Get("drainageAreaM2"        ).As<Napi::Number>().DoubleValue();
          return Napi::Number::New(env2, forge::hydrology::rationalDischarge(in));
        });
      }));
    hyNs.Set("kirpichTimeOfConcentrationMin", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          return Napi::Number::New(env2,
              forge::hydrology::kirpichTimeOfConcentrationMin(
                  info[0].As<Napi::Number>().DoubleValue(),
                  info[1].As<Napi::Number>().DoubleValue()));
        });
      }));
    hyNs.Set("idfIntensityMmHr", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::hydrology::IdfInput in{};
          in.a            = o.Get("a"           ).As<Napi::Number>().DoubleValue();
          in.b            = o.Get("b"           ).As<Napi::Number>().DoubleValue();
          in.c            = o.Get("c"           ).As<Napi::Number>().DoubleValue();
          in.durationMin  = o.Get("durationMin" ).As<Napi::Number>().DoubleValue();
          return Napi::Number::New(env2, forge::hydrology::idfIntensityMmHr(in));
        });
      }));
    exports.Set("hydrology", hyNs);

    // -------- RC column (Forge-257) -------------------------------------
    auto rclNs = Napi::Object::New(env);
    rclNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::rccolumn::Input in{};
          std::string tt = o.Get("tieType").As<Napi::String>().Utf8Value();
          in.tieType = (tt == "spiral") ? forge::rccolumn::TieType::Spiral
                                         : forge::rccolumn::TieType::Tied;
          in.grossAreaM2       = o.Get("grossAreaM2"      ).As<Napi::Number>().DoubleValue();
          in.effectiveDepthM   = o.Get("effectiveDepthM"  ).As<Napi::Number>().DoubleValue();
          in.overallDepthM     = o.Get("overallDepthM"    ).As<Napi::Number>().DoubleValue();
          in.widthM            = o.Get("widthM"           ).As<Napi::Number>().DoubleValue();
          in.coverM            = o.Get("coverM"           ).As<Napi::Number>().DoubleValue();
          in.steelAreaTotalM2  = o.Get("steelAreaTotalM2" ).As<Napi::Number>().DoubleValue();
          in.concreteFcPa      = o.Get("concreteFcPa"     ).As<Napi::Number>().DoubleValue();
          in.steelFyPa         = o.Get("steelFyPa"        ).As<Napi::Number>().DoubleValue();
          auto r = forge::rccolumn::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("phi",                    Napi::Number::New(env2, r.phi));
          out.Set("maxFactor",              Napi::Number::New(env2, r.maxFactor));
          out.Set("nominalAxialN",          Napi::Number::New(env2, r.nominalAxialN));
          out.Set("designMaxAxialN",        Napi::Number::New(env2, r.designMaxAxialN));
          out.Set("balancedAxialN",         Napi::Number::New(env2, r.balancedAxialN));
          out.Set("balancedMomentNm",       Napi::Number::New(env2, r.balancedMomentNm));
          out.Set("designBalancedAxialN",   Napi::Number::New(env2, r.designBalancedAxialN));
          out.Set("designBalancedMomentNm", Napi::Number::New(env2, r.designBalancedMomentNm));
          out.Set("beta1",                  Napi::Number::New(env2, r.beta1));
          return out;
        });
      }));
    exports.Set("rccolumn", rclNs);

    // -------- Machining (Forge-258) -------------------------------------
    auto mcNs = Napi::Object::New(env);
    mcNs.Set("turning", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::machining::TurningInput in{};
          in.diameterMm                  = o.Get("diameterMm"                 ).As<Napi::Number>().DoubleValue();
          in.cuttingSpeedM_min           = o.Get("cuttingSpeedM_min"          ).As<Napi::Number>().DoubleValue();
          in.feedPerRevMm                = o.Get("feedPerRevMm"               ).As<Napi::Number>().DoubleValue();
          in.depthOfCutMm                = o.Get("depthOfCutMm"               ).As<Napi::Number>().DoubleValue();
          in.specificCuttingForceN_mm2   = o.Get("specificCuttingForceN_mm2"  ).As<Napi::Number>().DoubleValue();
          in.machineEfficiency           = o.Get("machineEfficiency"          ).As<Napi::Number>().DoubleValue();
          in.leadAngleDeg                = o.Get("leadAngleDeg"               ).As<Napi::Number>().DoubleValue();
          auto r = forge::machining::turning(in);
          auto out = Napi::Object::New(env2);
          out.Set("spindleSpeedRpm",  Napi::Number::New(env2, r.spindleSpeedRpm));
          out.Set("mrrCm3Min",        Napi::Number::New(env2, r.mrrCm3Min));
          out.Set("cuttingForceN",    Napi::Number::New(env2, r.cuttingForceN));
          out.Set("powerKw",          Napi::Number::New(env2, r.powerKw));
          return out;
        });
      }));
    mcNs.Set("milling", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::machining::MillingInput in{};
          in.diameterMm                  = o.Get("diameterMm"                 ).As<Napi::Number>().DoubleValue();
          in.cuttingSpeedM_min           = o.Get("cuttingSpeedM_min"          ).As<Napi::Number>().DoubleValue();
          in.feedPerToothMm              = o.Get("feedPerToothMm"             ).As<Napi::Number>().DoubleValue();
          in.numberOfTeeth               = o.Get("numberOfTeeth"              ).As<Napi::Number>().Int32Value();
          in.axialDepthMm                = o.Get("axialDepthMm"               ).As<Napi::Number>().DoubleValue();
          in.radialDepthMm               = o.Get("radialDepthMm"              ).As<Napi::Number>().DoubleValue();
          in.specificCuttingForceN_mm2   = o.Get("specificCuttingForceN_mm2"  ).As<Napi::Number>().DoubleValue();
          in.machineEfficiency           = o.Get("machineEfficiency"          ).As<Napi::Number>().DoubleValue();
          auto r = forge::machining::milling(in);
          auto out = Napi::Object::New(env2);
          out.Set("spindleSpeedRpm",  Napi::Number::New(env2, r.spindleSpeedRpm));
          out.Set("feedRateMmMin",    Napi::Number::New(env2, r.feedRateMmMin));
          out.Set("mrrCm3Min",        Napi::Number::New(env2, r.mrrCm3Min));
          out.Set("cuttingForceN",    Napi::Number::New(env2, r.cuttingForceN));
          out.Set("powerKw",          Napi::Number::New(env2, r.powerKw));
          return out;
        });
      }));
    mcNs.Set("drilling", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::machining::DrillingInput in{};
          in.diameterMm                  = o.Get("diameterMm"                 ).As<Napi::Number>().DoubleValue();
          in.cuttingSpeedM_min           = o.Get("cuttingSpeedM_min"          ).As<Napi::Number>().DoubleValue();
          in.feedPerRevMm                = o.Get("feedPerRevMm"               ).As<Napi::Number>().DoubleValue();
          in.specificCuttingForceN_mm2   = o.Get("specificCuttingForceN_mm2"  ).As<Napi::Number>().DoubleValue();
          in.machineEfficiency           = o.Get("machineEfficiency"          ).As<Napi::Number>().DoubleValue();
          auto r = forge::machining::drilling(in);
          auto out = Napi::Object::New(env2);
          out.Set("spindleSpeedRpm",  Napi::Number::New(env2, r.spindleSpeedRpm));
          out.Set("feedRateMmMin",    Napi::Number::New(env2, r.feedRateMmMin));
          out.Set("mrrCm3Min",        Napi::Number::New(env2, r.mrrCm3Min));
          out.Set("thrustForceN",     Napi::Number::New(env2, r.thrustForceN));
          out.Set("torqueNm",         Napi::Number::New(env2, r.torqueNm));
          out.Set("powerKw",          Napi::Number::New(env2, r.powerKw));
          return out;
        });
      }));
    exports.Set("machining", mcNs);

    // -------- Combustion (Forge-259) ------------------------------------
    auto cmbNs = Napi::Object::New(env);
    cmbNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::combustion::Input in{};
          auto fo = o.Get("fuel").As<Napi::Object>();
          in.fuel.C = fo.Get("C").As<Napi::Number>().DoubleValue();
          in.fuel.H = fo.Get("H").As<Napi::Number>().DoubleValue();
          in.fuel.O = fo.Get("O").As<Napi::Number>().DoubleValue();
          in.fuel.N = fo.Get("N").As<Napi::Number>().DoubleValue();
          in.fuel.S = fo.Get("S").As<Napi::Number>().DoubleValue();
          in.excessAirRatio = o.Get("excessAirRatio").As<Napi::Number>().DoubleValue();
          auto r = forge::combustion::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("stoichiometricOxygenKgPerKgFuel", Napi::Number::New(env2, r.stoichiometricOxygenKgPerKgFuel));
          out.Set("stoichiometricAirKgPerKgFuel",    Napi::Number::New(env2, r.stoichiometricAirKgPerKgFuel));
          out.Set("actualAirKgPerKgFuel",            Napi::Number::New(env2, r.actualAirKgPerKgFuel));
          out.Set("co2KgPerKgFuel",                  Napi::Number::New(env2, r.co2KgPerKgFuel));
          out.Set("h2oKgPerKgFuel",                  Napi::Number::New(env2, r.h2oKgPerKgFuel));
          out.Set("so2KgPerKgFuel",                  Napi::Number::New(env2, r.so2KgPerKgFuel));
          out.Set("n2KgPerKgFuel",                   Napi::Number::New(env2, r.n2KgPerKgFuel));
          out.Set("excessO2KgPerKgFuel",             Napi::Number::New(env2, r.excessO2KgPerKgFuel));
          out.Set("dryFlueGasKgPerKgFuel",           Napi::Number::New(env2, r.dryFlueGasKgPerKgFuel));
          out.Set("dryCO2MassPct",                   Napi::Number::New(env2, r.dryCO2MassPct));
          out.Set("dryO2MassPct",                    Napi::Number::New(env2, r.dryO2MassPct));
          out.Set("dryN2MassPct",                    Napi::Number::New(env2, r.dryN2MassPct));
          return out;
        });
      }));
    exports.Set("combustion", cmbNs);

    // -------- Vibration isolation (Forge-260) ---------------------------
    auto viNs = Napi::Object::New(env);
    viNs.Set("response", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::vibiso::ResponseInput in{};
          in.massKg                  = o.Get("massKg"                 ).As<Napi::Number>().DoubleValue();
          in.stiffnessNPerM          = o.Get("stiffnessNPerM"         ).As<Napi::Number>().DoubleValue();
          in.dampingCoefficientNsm   = o.Get("dampingCoefficientNsm"  ).As<Napi::Number>().DoubleValue();
          in.drivingFrequencyHz      = o.Get("drivingFrequencyHz"     ).As<Napi::Number>().DoubleValue();
          auto r = forge::vibiso::response(in);
          auto out = Napi::Object::New(env2);
          out.Set("naturalFrequencyHz",  Napi::Number::New(env2, r.naturalFrequencyHz));
          out.Set("dampingRatio",        Napi::Number::New(env2, r.dampingRatio));
          out.Set("frequencyRatio",      Napi::Number::New(env2, r.frequencyRatio));
          out.Set("transmissibility",    Napi::Number::New(env2, r.transmissibility));
          out.Set("isolationPct",        Napi::Number::New(env2, r.isolationPct));
          return out;
        });
      }));
    viNs.Set("sizeIsolator", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::vibiso::SizingInput in{};
          in.massKg               = o.Get("massKg"              ).As<Napi::Number>().DoubleValue();
          in.drivingFrequencyHz   = o.Get("drivingFrequencyHz"  ).As<Napi::Number>().DoubleValue();
          in.targetIsolationPct   = o.Get("targetIsolationPct"  ).As<Napi::Number>().DoubleValue();
          in.dampingRatio         = o.Get("dampingRatio"        ).As<Napi::Number>().DoubleValue();
          auto r = forge::vibiso::sizeIsolator(in);
          auto out = Napi::Object::New(env2);
          out.Set("requiredFrequencyRatio",      Napi::Number::New(env2, r.requiredFrequencyRatio));
          out.Set("requiredNaturalFrequencyHz",  Napi::Number::New(env2, r.requiredNaturalFrequencyHz));
          out.Set("requiredStiffnessNPerM",      Napi::Number::New(env2, r.requiredStiffnessNPerM));
          return out;
        });
      }));
    exports.Set("vibiso", viNs);

    // -------- Fin efficiency (Forge-261) --------------------------------
    auto fnNs = Napi::Object::New(env);
    auto writeFinResult = [](Napi::Env env2, const forge::finefficiency::Result& r) {
      auto out = Napi::Object::New(env2);
      out.Set("parameter_m",      Napi::Number::New(env2, r.parameter_m));
      out.Set("correctedLength",  Napi::Number::New(env2, r.correctedLength));
      out.Set("finEfficiency",    Napi::Number::New(env2, r.finEfficiency));
      out.Set("finAreaM2",        Napi::Number::New(env2, r.finAreaM2));
      out.Set("heatRateW",        Napi::Number::New(env2, r.heatRateW));
      out.Set("finEffectiveness", Napi::Number::New(env2, r.finEffectiveness));
      return out;
    };
    fnNs.Set("rectangular", Napi::Function::New(env,
      [writeFinResult](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::finefficiency::RectInput in{};
          in.heightM             = o.Get("heightM"            ).As<Napi::Number>().DoubleValue();
          in.thicknessM          = o.Get("thicknessM"         ).As<Napi::Number>().DoubleValue();
          in.widthM              = o.Get("widthM"             ).As<Napi::Number>().DoubleValue();
          in.thermalConductivity = o.Get("thermalConductivity").As<Napi::Number>().DoubleValue();
          in.convectionH         = o.Get("convectionH"        ).As<Napi::Number>().DoubleValue();
          in.temperatureDiffK    = o.Get("temperatureDiffK"   ).As<Napi::Number>().DoubleValue();
          return writeFinResult(env2, forge::finefficiency::rectangular(in));
        });
      }));
    fnNs.Set("pin", Napi::Function::New(env,
      [writeFinResult](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::finefficiency::PinInput in{};
          in.lengthM             = o.Get("lengthM"            ).As<Napi::Number>().DoubleValue();
          in.diameterM           = o.Get("diameterM"          ).As<Napi::Number>().DoubleValue();
          in.thermalConductivity = o.Get("thermalConductivity").As<Napi::Number>().DoubleValue();
          in.convectionH         = o.Get("convectionH"        ).As<Napi::Number>().DoubleValue();
          in.temperatureDiffK    = o.Get("temperatureDiffK"   ).As<Napi::Number>().DoubleValue();
          return writeFinResult(env2, forge::finefficiency::pin(in));
        });
      }));
    exports.Set("fin", fnNs);

    // -------- Boiler efficiency (Forge-262) -----------------------------
    auto blNs = Napi::Object::New(env);
    blNs.Set("directMethod", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::boilereff::DirectInput in{};
          in.steamFlowKgPerS           = o.Get("steamFlowKgPerS"          ).As<Napi::Number>().DoubleValue();
          in.feedwaterEnthalpyKjPerKg  = o.Get("feedwaterEnthalpyKjPerKg" ).As<Napi::Number>().DoubleValue();
          in.steamEnthalpyKjPerKg      = o.Get("steamEnthalpyKjPerKg"     ).As<Napi::Number>().DoubleValue();
          in.fuelFlowKgPerS            = o.Get("fuelFlowKgPerS"           ).As<Napi::Number>().DoubleValue();
          in.heatingValueKjPerKg       = o.Get("heatingValueKjPerKg"      ).As<Napi::Number>().DoubleValue();
          auto r = forge::boilereff::directMethod(in);
          auto out = Napi::Object::New(env2);
          out.Set("heatOutputKw",    Napi::Number::New(env2, r.heatOutputKw));
          out.Set("heatInputKw",     Napi::Number::New(env2, r.heatInputKw));
          out.Set("efficiencyPct",   Napi::Number::New(env2, r.efficiencyPct));
          return out;
        });
      }));
    blNs.Set("indirectMethod", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::boilereff::IndirectInput in{};
          in.dryFlueGasKgPerKgFuel   = o.Get("dryFlueGasKgPerKgFuel"  ).As<Napi::Number>().DoubleValue();
          in.moistureKgPerKgFuel     = o.Get("moistureKgPerKgFuel"    ).As<Napi::Number>().DoubleValue();
          in.flueGasTempC            = o.Get("flueGasTempC"           ).As<Napi::Number>().DoubleValue();
          in.ambientTempC            = o.Get("ambientTempC"           ).As<Napi::Number>().DoubleValue();
          in.heatingValueKjPerKg     = o.Get("heatingValueKjPerKg"    ).As<Napi::Number>().DoubleValue();
          in.dryFlueGasCpKjPerKgK    = o.Get("dryFlueGasCpKjPerKgK"   ).As<Napi::Number>().DoubleValue();
          in.radiationLossPct        = o.Get("radiationLossPct"       ).As<Napi::Number>().DoubleValue();
          auto r = forge::boilereff::indirectMethod(in);
          auto out = Napi::Object::New(env2);
          out.Set("dryFlueGasLossPct",  Napi::Number::New(env2, r.dryFlueGasLossPct));
          out.Set("waterVapourLossPct", Napi::Number::New(env2, r.waterVapourLossPct));
          out.Set("radiationLossPct",   Napi::Number::New(env2, r.radiationLossPct));
          out.Set("totalLossesPct",     Napi::Number::New(env2, r.totalLossesPct));
          out.Set("efficiencyPct",      Napi::Number::New(env2, r.efficiencyPct));
          return out;
        });
      }));
    exports.Set("boilereff", blNs);

    // -------- Sound transmission loss (Forge-263) -----------------------
    auto stlNs = Napi::Object::New(env);
    stlNs.Set("massLawTL", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::soundtl::MassLawInput in{};
          in.surfaceDensityKgPerM2 = o.Get("surfaceDensityKgPerM2").As<Napi::Number>().DoubleValue();
          in.frequencyHz           = o.Get("frequencyHz"          ).As<Napi::Number>().DoubleValue();
          in.coincidenceLossDb     = o.Get("coincidenceLossDb"    ).As<Napi::Number>().DoubleValue();
          return Napi::Number::New(env2, forge::soundtl::massLawTL(in));
        });
      }));
    stlNs.Set("compositeTL", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::soundtl::CompositeInput in{};
          auto elArr = o.Get("elements").As<Napi::Array>();
          for (uint32_t i = 0; i < elArr.Length(); ++i) {
            auto eo = elArr.Get(i).As<Napi::Object>();
            forge::soundtl::CompositeElement el{};
            el.areaM2 = eo.Get("areaM2").As<Napi::Number>().DoubleValue();
            el.transmissionLossDb = eo.Get("transmissionLossDb").As<Napi::Number>().DoubleValue();
            in.elements.push_back(el);
          }
          return Napi::Number::New(env2, forge::soundtl::compositeTL(in));
        });
      }));
    exports.Set("soundtl", stlNs);

    // -------- PID tuning (Forge-264) ------------------------------------
    auto pdNs = Napi::Object::New(env);
    auto controllerFromStr = [](const std::string& s) {
      if (s == "P")   return forge::pidtuning::Controller::P;
      if (s == "PI")  return forge::pidtuning::Controller::PI;
      if (s == "PID") return forge::pidtuning::Controller::PID;
      throw std::invalid_argument("controller must be P / PI / PID");
    };
    pdNs.Set("zieglerNichols", Napi::Function::New(env,
      [controllerFromStr](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::pidtuning::ZieglerNicholsInput in{};
          in.controller             = controllerFromStr(o.Get("controller").As<Napi::String>().Utf8Value());
          in.ultimateGainKu         = o.Get("ultimateGainKu"        ).As<Napi::Number>().DoubleValue();
          in.ultimatePeriodPuSec    = o.Get("ultimatePeriodPuSec"   ).As<Napi::Number>().DoubleValue();
          auto r = forge::pidtuning::zieglerNichols(in);
          auto out = Napi::Object::New(env2);
          out.Set("Kp", Napi::Number::New(env2, r.Kp));
          out.Set("Ti", Napi::Number::New(env2, r.Ti));
          out.Set("Td", Napi::Number::New(env2, r.Td));
          return out;
        });
      }));
    pdNs.Set("cohenCoon", Napi::Function::New(env,
      [controllerFromStr](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::pidtuning::CohenCoonInput in{};
          in.controller      = controllerFromStr(o.Get("controller").As<Napi::String>().Utf8Value());
          in.processGainKp   = o.Get("processGainKp"  ).As<Napi::Number>().DoubleValue();
          in.timeConstantTau = o.Get("timeConstantTau").As<Napi::Number>().DoubleValue();
          in.deadTimeTheta   = o.Get("deadTimeTheta"  ).As<Napi::Number>().DoubleValue();
          auto r = forge::pidtuning::cohenCoon(in);
          auto out = Napi::Object::New(env2);
          out.Set("Kp", Napi::Number::New(env2, r.Kp));
          out.Set("Ti", Napi::Number::New(env2, r.Ti));
          out.Set("Td", Napi::Number::New(env2, r.Td));
          return out;
        });
      }));
    exports.Set("pidtuning", pdNs);

    // -------- Tuned mass damper (Forge-265) -----------------------------
    auto tmdNs = Napi::Object::New(env);
    tmdNs.Set("sizeAbsorber", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::tmd::SizingInput in{};
          in.primaryMassKg      = o.Get("primaryMassKg"     ).As<Napi::Number>().DoubleValue();
          in.primaryFrequencyHz = o.Get("primaryFrequencyHz").As<Napi::Number>().DoubleValue();
          in.massRatio          = o.Get("massRatio"         ).As<Napi::Number>().DoubleValue();
          auto r = forge::tmd::sizeAbsorber(in);
          auto out = Napi::Object::New(env2);
          out.Set("absorberMassKg",          Napi::Number::New(env2, r.absorberMassKg));
          out.Set("frequencyRatioOptimum",   Napi::Number::New(env2, r.frequencyRatioOptimum));
          out.Set("dampingRatioOptimum",     Napi::Number::New(env2, r.dampingRatioOptimum));
          out.Set("absorberStiffnessNPerM",  Napi::Number::New(env2, r.absorberStiffnessNPerM));
          out.Set("absorberDampingNsm",      Napi::Number::New(env2, r.absorberDampingNsm));
          out.Set("absorberFrequencyHz",     Napi::Number::New(env2, r.absorberFrequencyHz));
          out.Set("peakTransmissibility",    Napi::Number::New(env2, r.peakTransmissibility));
          return out;
        });
      }));
    exports.Set("tmd", tmdNs);

    // -------- Orifice plate (Forge-266) ---------------------------------
    auto opNs = Napi::Object::New(env);
    opNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::orificeplate::Input in{};
          in.pipeDiameterM         = o.Get("pipeDiameterM"        ).As<Napi::Number>().DoubleValue();
          in.orificeDiameterM      = o.Get("orificeDiameterM"     ).As<Napi::Number>().DoubleValue();
          in.upstreamDensityKgM3   = o.Get("upstreamDensityKgM3"  ).As<Napi::Number>().DoubleValue();
          in.dynamicViscosityPas   = o.Get("dynamicViscosityPas"  ).As<Napi::Number>().DoubleValue();
          in.differentialPressurePa = o.Get("differentialPressurePa").As<Napi::Number>().DoubleValue();
          in.compressible          = o.Get("compressible"         ).As<Napi::Boolean>().Value();
          in.kappaSpecHeatRatio    = o.Get("kappaSpecHeatRatio"   ).As<Napi::Number>().DoubleValue();
          in.upstreamPressurePa    = o.Get("upstreamPressurePa"   ).As<Napi::Number>().DoubleValue();
          auto r = forge::orificeplate::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("betaRatio",             Napi::Number::New(env2, r.betaRatio));
          out.Set("throatAreaM2",          Napi::Number::New(env2, r.throatAreaM2));
          out.Set("reynoldsNumberD",       Napi::Number::New(env2, r.reynoldsNumberD));
          out.Set("dischargeCoefficient",  Napi::Number::New(env2, r.dischargeCoefficient));
          out.Set("expansibilityFactor",   Napi::Number::New(env2, r.expansibilityFactor));
          out.Set("massFlowKgS",           Napi::Number::New(env2, r.massFlowKgS));
          out.Set("volumeFlowM3S",         Napi::Number::New(env2, r.volumeFlowM3S));
          return out;
        });
      }));
    exports.Set("orificeplate", opNs);

    // -------- RC slab punching shear (Forge-267) ------------------------
    auto punchNs = Napi::Object::New(env);
    punchNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::rcpunching::Input in{};
          in.concreteStrengthMPa = o.Get("concreteStrengthMPa").As<Napi::Number>().DoubleValue();
          in.effectiveDepthMm    = o.Get("effectiveDepthMm"   ).As<Napi::Number>().DoubleValue();
          in.columnWidthMm       = o.Get("columnWidthMm"      ).As<Napi::Number>().DoubleValue();
          in.columnDepthMm       = o.Get("columnDepthMm"      ).As<Napi::Number>().DoubleValue();
          std::string loc        = o.Get("location"           ).As<Napi::String>().Utf8Value();
          if (loc == "interior")      in.location = forge::rcpunching::Location::Interior;
          else if (loc == "edge")     in.location = forge::rcpunching::Location::Edge;
          else if (loc == "corner")   in.location = forge::rcpunching::Location::Corner;
          else throw std::runtime_error("location must be one of: interior, edge, corner");
          in.lambdaLightweight   = o.Get("lambdaLightweight"  ).As<Napi::Number>().DoubleValue();
          in.factoredShearN      = o.Get("factoredShearN"     ).As<Napi::Number>().DoubleValue();
          auto r = forge::rcpunching::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("betaC",                Napi::Number::New(env2, r.betaC));
          out.Set("alphaS",               Napi::Number::New(env2, r.alphaS));
          out.Set("criticalPerimeterMm",  Napi::Number::New(env2, r.criticalPerimeterMm));
          out.Set("sqrtFcMPa",            Napi::Number::New(env2, r.sqrtFcMPa));
          out.Set("vc1MPa",               Napi::Number::New(env2, r.vc1MPa));
          out.Set("vc2MPa",               Napi::Number::New(env2, r.vc2MPa));
          out.Set("vc3MPa",               Napi::Number::New(env2, r.vc3MPa));
          out.Set("vcMPa",                Napi::Number::New(env2, r.vcMPa));
          out.Set("VcN",                  Napi::Number::New(env2, r.VcN));
          out.Set("phiVcN",               Napi::Number::New(env2, r.phiVcN));
          out.Set("demandCapacityRatio",  Napi::Number::New(env2, r.demandCapacityRatio));
          out.Set("passes",               Napi::Boolean::New(env2, r.passes));
          return out;
        });
      }));
    exports.Set("rcpunching", punchNs);

    // -------- Anchor bolt tension (Forge-268) ---------------------------
    auto anchorNs = Napi::Object::New(env);
    anchorNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::anchorbolt::Input in{};
          in.effectiveTensileAreaMm2 = o.Get("effectiveTensileAreaMm2").As<Napi::Number>().DoubleValue();
          in.steelUltimateMPa        = o.Get("steelUltimateMPa"       ).As<Napi::Number>().DoubleValue();
          in.steelYieldMPa           = o.Get("steelYieldMPa"          ).As<Napi::Number>().DoubleValue();
          in.embedmentDepthMm        = o.Get("embedmentDepthMm"       ).As<Napi::Number>().DoubleValue();
          in.concreteStrengthMPa     = o.Get("concreteStrengthMPa"    ).As<Napi::Number>().DoubleValue();
          in.minEdgeDistanceMm       = o.Get("minEdgeDistanceMm"      ).As<Napi::Number>().DoubleValue();
          in.bearingAreaMm2          = o.Get("bearingAreaMm2"         ).As<Napi::Number>().DoubleValue();
          in.lambdaLightweight       = o.Get("lambdaLightweight"      ).As<Napi::Number>().DoubleValue();
          in.crackedConcrete         = o.Get("crackedConcrete"        ).As<Napi::Boolean>().Value();
          in.castInAnchor            = o.Get("castInAnchor"           ).As<Napi::Boolean>().Value();
          auto r = forge::anchorbolt::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("cappedFutaMPa",     Napi::Number::New(env2, r.cappedFutaMPa));
          out.Set("steelNominalN",     Napi::Number::New(env2, r.steelNominalN));
          out.Set("phiSteelN",         Napi::Number::New(env2, r.phiSteelN));
          out.Set("aNcoMm2",           Napi::Number::New(env2, r.aNcoMm2));
          out.Set("aNcMm2",            Napi::Number::New(env2, r.aNcMm2));
          out.Set("psiEdN",            Napi::Number::New(env2, r.psiEdN));
          out.Set("psiCN",             Napi::Number::New(env2, r.psiCN));
          out.Set("nBN",               Napi::Number::New(env2, r.nBN));
          out.Set("breakoutNominalN",  Napi::Number::New(env2, r.breakoutNominalN));
          out.Set("phiBreakoutN",      Napi::Number::New(env2, r.phiBreakoutN));
          out.Set("psiCP",             Napi::Number::New(env2, r.psiCP));
          out.Set("nPN",               Napi::Number::New(env2, r.nPN));
          out.Set("pulloutNominalN",   Napi::Number::New(env2, r.pulloutNominalN));
          out.Set("phiPulloutN",       Napi::Number::New(env2, r.phiPulloutN));
          out.Set("phiGoverningN",     Napi::Number::New(env2, r.phiGoverningN));
          out.Set("governingMode",     Napi::String::New(env2, r.governingMode));
          return out;
        });
      }));
    exports.Set("anchorbolt", anchorNs);

    // -------- Power screw torque (Forge-269) ----------------------------
    auto pscNs = Napi::Object::New(env);
    pscNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::powerscrew::Input in{};
          in.axialForceN         = o.Get("axialForceN"         ).As<Napi::Number>().DoubleValue();
          in.meanDiameterMm      = o.Get("meanDiameterMm"      ).As<Napi::Number>().DoubleValue();
          in.leadMm              = o.Get("leadMm"              ).As<Napi::Number>().DoubleValue();
          in.threadFriction      = o.Get("threadFriction"      ).As<Napi::Number>().DoubleValue();
          in.collarFriction      = o.Get("collarFriction"      ).As<Napi::Number>().DoubleValue();
          in.collarMeanDiameterMm = o.Get("collarMeanDiameterMm").As<Napi::Number>().DoubleValue();
          std::string tt         = o.Get("threadType"          ).As<Napi::String>().Utf8Value();
          if      (tt == "square") in.threadType = forge::powerscrew::ThreadType::Square;
          else if (tt == "acme"  ) in.threadType = forge::powerscrew::ThreadType::Acme;
          else throw std::runtime_error("threadType must be 'square' or 'acme'");
          auto r = forge::powerscrew::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("leadAngleDeg",       Napi::Number::New(env2, r.leadAngleDeg));
          out.Set("frictionAngleDeg",   Napi::Number::New(env2, r.frictionAngleDeg));
          out.Set("effectiveFriction",  Napi::Number::New(env2, r.effectiveFriction));
          out.Set("raiseTorqueNm",      Napi::Number::New(env2, r.raiseTorqueNm));
          out.Set("lowerTorqueNm",      Napi::Number::New(env2, r.lowerTorqueNm));
          out.Set("collarTorqueNm",     Napi::Number::New(env2, r.collarTorqueNm));
          out.Set("totalRaiseTorqueNm", Napi::Number::New(env2, r.totalRaiseTorqueNm));
          out.Set("totalLowerTorqueNm", Napi::Number::New(env2, r.totalLowerTorqueNm));
          out.Set("efficiencyPct",      Napi::Number::New(env2, r.efficiencyPct));
          out.Set("selfLocking",        Napi::Boolean::New(env2, r.selfLocking));
          return out;
        });
      }));
    exports.Set("powerscrew", pscNs);

    // -------- Steel beam LTB (Forge-270) --------------------------------
    auto sbNs = Napi::Object::New(env);
    sbNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::steelbeam::Input in{};
          in.yieldMPa            = o.Get("yieldMPa"           ).As<Napi::Number>().DoubleValue();
          in.elasticModulusMPa   = o.Get("elasticModulusMPa"  ).As<Napi::Number>().DoubleValue();
          in.sectionModulusXMm3  = o.Get("sectionModulusXMm3" ).As<Napi::Number>().DoubleValue();
          in.plasticModulusXMm3  = o.Get("plasticModulusXMm3" ).As<Napi::Number>().DoubleValue();
          in.torsionConstantMm4  = o.Get("torsionConstantMm4" ).As<Napi::Number>().DoubleValue();
          in.radiusYMm           = o.Get("radiusYMm"          ).As<Napi::Number>().DoubleValue();
          in.radiusTsMm          = o.Get("radiusTsMm"         ).As<Napi::Number>().DoubleValue();
          in.distanceBetweenFlangeCentroidsMm
                                 = o.Get("distanceBetweenFlangeCentroidsMm").As<Napi::Number>().DoubleValue();
          in.warpingCoefficient  = o.Get("warpingCoefficient" ).As<Napi::Number>().DoubleValue();
          in.unbracedLengthMm    = o.Get("unbracedLengthMm"   ).As<Napi::Number>().DoubleValue();
          in.cb                  = o.Get("cb"                 ).As<Napi::Number>().DoubleValue();
          auto r = forge::steelbeam::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("mPlasticNmm",    Napi::Number::New(env2, r.mPlasticNmm));
          out.Set("lpMm",           Napi::Number::New(env2, r.lpMm));
          out.Set("lrMm",           Napi::Number::New(env2, r.lrMm));
          out.Set("mNnominalNmm",   Napi::Number::New(env2, r.mNnominalNmm));
          out.Set("fCrMPa",         Napi::Number::New(env2, r.fCrMPa));
          out.Set("phiMnNmm",       Napi::Number::New(env2, r.phiMnNmm));
          out.Set("mnOverOmegaNmm", Napi::Number::New(env2, r.mnOverOmegaNmm));
          out.Set("regime",         Napi::String::New(env2, r.regime));
          return out;
        });
      }));
    exports.Set("steelbeam", sbNs);

    // -------- Anchor bolt shear (Forge-271) -----------------------------
    auto ashNs = Napi::Object::New(env);
    ashNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::anchorshear::Input in{};
          in.effectiveShearAreaMm2 = o.Get("effectiveShearAreaMm2").As<Napi::Number>().DoubleValue();
          in.steelUltimateMPa      = o.Get("steelUltimateMPa"     ).As<Napi::Number>().DoubleValue();
          in.steelYieldMPa         = o.Get("steelYieldMPa"        ).As<Napi::Number>().DoubleValue();
          in.anchorDiameterMm      = o.Get("anchorDiameterMm"     ).As<Napi::Number>().DoubleValue();
          in.loadBearingLengthMm   = o.Get("loadBearingLengthMm"  ).As<Napi::Number>().DoubleValue();
          in.concreteStrengthMPa   = o.Get("concreteStrengthMPa"  ).As<Napi::Number>().DoubleValue();
          in.edgeDistanceCa1Mm     = o.Get("edgeDistanceCa1Mm"    ).As<Napi::Number>().DoubleValue();
          in.edgeDistanceCa2Mm     = o.Get("edgeDistanceCa2Mm"    ).As<Napi::Number>().DoubleValue();
          in.memberThicknessHaMm   = o.Get("memberThicknessHaMm"  ).As<Napi::Number>().DoubleValue();
          in.lambdaLightweight     = o.Get("lambdaLightweight"    ).As<Napi::Number>().DoubleValue();
          in.crackedConcrete       = o.Get("crackedConcrete"      ).As<Napi::Boolean>().Value();
          auto r = forge::anchorshear::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("cappedFutaMPa",     Napi::Number::New(env2, r.cappedFutaMPa));
          out.Set("steelNominalN",     Napi::Number::New(env2, r.steelNominalN));
          out.Set("phiSteelN",         Napi::Number::New(env2, r.phiSteelN));
          out.Set("aVcoMm2",           Napi::Number::New(env2, r.aVcoMm2));
          out.Set("aVcMm2",            Napi::Number::New(env2, r.aVcMm2));
          out.Set("psiEdV",            Napi::Number::New(env2, r.psiEdV));
          out.Set("psiCV",             Napi::Number::New(env2, r.psiCV));
          out.Set("psiHV",             Napi::Number::New(env2, r.psiHV));
          out.Set("vBN",               Napi::Number::New(env2, r.vBN));
          out.Set("breakoutNominalN",  Napi::Number::New(env2, r.breakoutNominalN));
          out.Set("phiBreakoutN",      Napi::Number::New(env2, r.phiBreakoutN));
          out.Set("phiGoverningN",     Napi::Number::New(env2, r.phiGoverningN));
          out.Set("governingMode",     Napi::String::New(env2, r.governingMode));
          return out;
        });
      }));
    exports.Set("anchorshear", ashNs);

    // -------- Wood beam bending (Forge-272) -----------------------------
    auto wbNs = Napi::Object::New(env);
    wbNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::woodbeam::Input in{};
          in.referenceFbMPa     = o.Get("referenceFbMPa"   ).As<Napi::Number>().DoubleValue();
          in.emin_MPa           = o.Get("emin_MPa"         ).As<Napi::Number>().DoubleValue();
          in.widthMm            = o.Get("widthMm"          ).As<Napi::Number>().DoubleValue();
          in.depthMm            = o.Get("depthMm"          ).As<Napi::Number>().DoubleValue();
          in.effectiveLengthMm  = o.Get("effectiveLengthMm").As<Napi::Number>().DoubleValue();
          in.cD                 = o.Get("cD"               ).As<Napi::Number>().DoubleValue();
          in.cM                 = o.Get("cM"               ).As<Napi::Number>().DoubleValue();
          in.cT                 = o.Get("cT"               ).As<Napi::Number>().DoubleValue();
          in.cF                 = o.Get("cF"               ).As<Napi::Number>().DoubleValue();
          in.cFu                = o.Get("cFu"              ).As<Napi::Number>().DoubleValue();
          in.cI                 = o.Get("cI"               ).As<Napi::Number>().DoubleValue();
          in.cR                 = o.Get("cR"               ).As<Napi::Number>().DoubleValue();
          auto r = forge::woodbeam::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("sectionModulusMm3",  Napi::Number::New(env2, r.sectionModulusMm3));
          out.Set("fbStarMPa",          Napi::Number::New(env2, r.fbStarMPa));
          out.Set("slendernessRb",      Napi::Number::New(env2, r.slendernessRb));
          out.Set("fbEMPa",             Napi::Number::New(env2, r.fbEMPa));
          out.Set("alphaRatio",         Napi::Number::New(env2, r.alphaRatio));
          out.Set("cL",                 Napi::Number::New(env2, r.cL));
          out.Set("fbPrimeMPa",         Napi::Number::New(env2, r.fbPrimeMPa));
          out.Set("mAllowNmm",          Napi::Number::New(env2, r.mAllowNmm));
          return out;
        });
      }));
    exports.Set("woodbeam", wbNs);

    // -------- Pump NPSH available (Forge-273) ---------------------------
    auto npshNs = Napi::Object::New(env);
    npshNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::pumpnpsh::Input in{};
          in.atmosphericPressurePa = o.Get("atmosphericPressurePa").As<Napi::Number>().DoubleValue();
          in.vapourPressurePa      = o.Get("vapourPressurePa"     ).As<Napi::Number>().DoubleValue();
          in.densityKgM3           = o.Get("densityKgM3"          ).As<Napi::Number>().DoubleValue();
          in.staticSuctionHeadM    = o.Get("staticSuctionHeadM"   ).As<Napi::Number>().DoubleValue();
          in.frictionHeadM         = o.Get("frictionHeadM"        ).As<Napi::Number>().DoubleValue();
          in.requiredNpshM         = o.Get("requiredNpshM"        ).As<Napi::Number>().DoubleValue();
          auto r = forge::pumpnpsh::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("pressureHeadM",  Napi::Number::New(env2, r.pressureHeadM));
          out.Set("availableNpshM", Napi::Number::New(env2, r.availableNpshM));
          out.Set("marginM",        Napi::Number::New(env2, r.marginM));
          out.Set("marginPct",      Napi::Number::New(env2, r.marginPct));
          out.Set("cavitating",     Napi::Boolean::New(env2, r.cavitating));
          out.Set("marginalPerHi",  Napi::Boolean::New(env2, r.marginalPerHi));
          return out;
        });
      }));
    exports.Set("pumpnpsh", npshNs);

    // -------- Wood column buckling (Forge-274) --------------------------
    auto wcNs = Napi::Object::New(env);
    wcNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::woodcolumn::Input in{};
          in.referenceFcMPa    = o.Get("referenceFcMPa"   ).As<Napi::Number>().DoubleValue();
          in.emin_MPa          = o.Get("emin_MPa"         ).As<Napi::Number>().DoubleValue();
          in.areaMm2           = o.Get("areaMm2"          ).As<Napi::Number>().DoubleValue();
          in.effectiveLengthMm = o.Get("effectiveLengthMm").As<Napi::Number>().DoubleValue();
          in.leastDimensionMm  = o.Get("leastDimensionMm" ).As<Napi::Number>().DoubleValue();
          std::string ct       = o.Get("columnType"       ).As<Napi::String>().Utf8Value();
          if      (ct == "sawn"   ) in.columnType = forge::woodcolumn::ColumnType::SawnLumber;
          else if (ct == "round"  ) in.columnType = forge::woodcolumn::ColumnType::RoundTimber;
          else if (ct == "glulam" ) in.columnType = forge::woodcolumn::ColumnType::Glulam;
          else throw std::runtime_error("columnType must be 'sawn', 'round', or 'glulam'");
          in.cD = o.Get("cD").As<Napi::Number>().DoubleValue();
          in.cM = o.Get("cM").As<Napi::Number>().DoubleValue();
          in.cT = o.Get("cT").As<Napi::Number>().DoubleValue();
          in.cF = o.Get("cF").As<Napi::Number>().DoubleValue();
          in.cI = o.Get("cI").As<Napi::Number>().DoubleValue();
          auto r = forge::woodcolumn::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("slendernessLeOverD", Napi::Number::New(env2, r.slendernessLeOverD));
          out.Set("fStarCMPa",          Napi::Number::New(env2, r.fStarCMPa));
          out.Set("fcEMPa",             Napi::Number::New(env2, r.fcEMPa));
          out.Set("alphaRatio",         Napi::Number::New(env2, r.alphaRatio));
          out.Set("cFactor",            Napi::Number::New(env2, r.cFactor));
          out.Set("cP",                 Napi::Number::New(env2, r.cP));
          out.Set("fcPrimeMPa",         Napi::Number::New(env2, r.fcPrimeMPa));
          out.Set("pAllowN",            Napi::Number::New(env2, r.pAllowN));
          return out;
        });
      }));
    exports.Set("woodcolumn", wcNs);

    // -------- Janssen silo pressure (Forge-275) -------------------------
    auto siloNs = Napi::Object::New(env);
    siloNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::silopressure::Input in{};
          in.bulkUnitWeightKnM3      = o.Get("bulkUnitWeightKnM3"     ).As<Napi::Number>().DoubleValue();
          in.hydraulicRadiusM        = o.Get("hydraulicRadiusM"       ).As<Napi::Number>().DoubleValue();
          in.wallFrictionCoefficient = o.Get("wallFrictionCoefficient").As<Napi::Number>().DoubleValue();
          in.horizontalRatioK        = o.Get("horizontalRatioK"       ).As<Napi::Number>().DoubleValue();
          in.depthM                  = o.Get("depthM"                 ).As<Napi::Number>().DoubleValue();
          auto r = forge::silopressure::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("verticalPressureKPa",   Napi::Number::New(env2, r.verticalPressureKPa));
          out.Set("wallPressureKPa",       Napi::Number::New(env2, r.wallPressureKPa));
          out.Set("frictionStressKPa",     Napi::Number::New(env2, r.frictionStressKPa));
          out.Set("asymptoticVerticalKPa", Napi::Number::New(env2, r.asymptoticVerticalKPa));
          out.Set("asymptoticWallKPa",     Napi::Number::New(env2, r.asymptoticWallKPa));
          out.Set("asymptoticFrictionKPa", Napi::Number::New(env2, r.asymptoticFrictionKPa));
          out.Set("depthRatioToZc",        Napi::Number::New(env2, r.depthRatioToZc));
          return out;
        });
      }));
    exports.Set("silopressure", siloNs);

    // -------- Air-standard Otto cycle (Forge-276) -----------------------
    auto ottoNs = Napi::Object::New(env);
    ottoNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::ottocycle::Input in{};
          in.compressionRatio    = o.Get("compressionRatio"   ).As<Napi::Number>().DoubleValue();
          in.intakeTemperatureK  = o.Get("intakeTemperatureK" ).As<Napi::Number>().DoubleValue();
          in.intakePressureKPa   = o.Get("intakePressureKPa"  ).As<Napi::Number>().DoubleValue();
          in.peakTemperatureK    = o.Get("peakTemperatureK"   ).As<Napi::Number>().DoubleValue();
          in.specificHeatRatio   = o.Get("specificHeatRatio"  ).As<Napi::Number>().DoubleValue();
          auto r = forge::ottocycle::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("cVKJkgK",                  Napi::Number::New(env2, r.cVKJkgK));
          out.Set("t2K",                      Napi::Number::New(env2, r.t2K));
          out.Set("t3K",                      Napi::Number::New(env2, r.t3K));
          out.Set("t4K",                      Napi::Number::New(env2, r.t4K));
          out.Set("p2KPa",                    Napi::Number::New(env2, r.p2KPa));
          out.Set("p3KPa",                    Napi::Number::New(env2, r.p3KPa));
          out.Set("p4KPa",                    Napi::Number::New(env2, r.p4KPa));
          out.Set("v1OverV2",                 Napi::Number::New(env2, r.v1OverV2));
          out.Set("specificVolume1M3kg",      Napi::Number::New(env2, r.specificVolume1M3kg));
          out.Set("specificVolume2M3kg",      Napi::Number::New(env2, r.specificVolume2M3kg));
          out.Set("qInKJkg",                  Napi::Number::New(env2, r.qInKJkg));
          out.Set("qOutKJkg",                 Napi::Number::New(env2, r.qOutKJkg));
          out.Set("wNetKJkg",                 Napi::Number::New(env2, r.wNetKJkg));
          out.Set("thermalEfficiency",        Napi::Number::New(env2, r.thermalEfficiency));
          out.Set("meanEffectivePressureKPa", Napi::Number::New(env2, r.meanEffectivePressureKPa));
          return out;
        });
      }));
    exports.Set("otto", ottoNs);

    // -------- Air-standard Diesel cycle (Forge-277) ---------------------
    auto dieselNs = Napi::Object::New(env);
    dieselNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::dieselcycle::Input in{};
          in.compressionRatio   = o.Get("compressionRatio"  ).As<Napi::Number>().DoubleValue();
          in.cutoffRatio        = o.Get("cutoffRatio"       ).As<Napi::Number>().DoubleValue();
          in.intakeTemperatureK = o.Get("intakeTemperatureK").As<Napi::Number>().DoubleValue();
          in.intakePressureKPa  = o.Get("intakePressureKPa" ).As<Napi::Number>().DoubleValue();
          in.specificHeatRatio  = o.Get("specificHeatRatio" ).As<Napi::Number>().DoubleValue();
          auto r = forge::dieselcycle::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("cVKJkgK",                  Napi::Number::New(env2, r.cVKJkgK));
          out.Set("cPKJkgK",                  Napi::Number::New(env2, r.cPKJkgK));
          out.Set("t2K",                      Napi::Number::New(env2, r.t2K));
          out.Set("t3K",                      Napi::Number::New(env2, r.t3K));
          out.Set("t4K",                      Napi::Number::New(env2, r.t4K));
          out.Set("p2KPa",                    Napi::Number::New(env2, r.p2KPa));
          out.Set("p3KPa",                    Napi::Number::New(env2, r.p3KPa));
          out.Set("p4KPa",                    Napi::Number::New(env2, r.p4KPa));
          out.Set("specificVolume1M3kg",      Napi::Number::New(env2, r.specificVolume1M3kg));
          out.Set("specificVolume2M3kg",      Napi::Number::New(env2, r.specificVolume2M3kg));
          out.Set("qInKJkg",                  Napi::Number::New(env2, r.qInKJkg));
          out.Set("qOutKJkg",                 Napi::Number::New(env2, r.qOutKJkg));
          out.Set("wNetKJkg",                 Napi::Number::New(env2, r.wNetKJkg));
          out.Set("thermalEfficiency",        Napi::Number::New(env2, r.thermalEfficiency));
          out.Set("meanEffectivePressureKPa", Napi::Number::New(env2, r.meanEffectivePressureKPa));
          return out;
        });
      }));
    exports.Set("diesel", dieselNs);

    // -------- Air-standard Brayton cycle (Forge-278) --------------------
    auto brayNs = Napi::Object::New(env);
    brayNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::brayton::Input in{};
          in.pressureRatio            = o.Get("pressureRatio"           ).As<Napi::Number>().DoubleValue();
          in.intakeTemperatureK       = o.Get("intakeTemperatureK"      ).As<Napi::Number>().DoubleValue();
          in.intakePressureKPa        = o.Get("intakePressureKPa"       ).As<Napi::Number>().DoubleValue();
          in.turbineInletTemperatureK = o.Get("turbineInletTemperatureK").As<Napi::Number>().DoubleValue();
          in.specificHeatRatio        = o.Get("specificHeatRatio"       ).As<Napi::Number>().DoubleValue();
          in.compressorIsentropicEff  = o.Get("compressorIsentropicEff" ).As<Napi::Number>().DoubleValue();
          in.turbineIsentropicEff     = o.Get("turbineIsentropicEff"    ).As<Napi::Number>().DoubleValue();
          auto r = forge::brayton::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("cPKJkgK",            Napi::Number::New(env2, r.cPKJkgK));
          out.Set("t2sK",               Napi::Number::New(env2, r.t2sK));
          out.Set("t2K",                Napi::Number::New(env2, r.t2K));
          out.Set("t3K",                Napi::Number::New(env2, r.t3K));
          out.Set("t4sK",               Napi::Number::New(env2, r.t4sK));
          out.Set("t4K",                Napi::Number::New(env2, r.t4K));
          out.Set("p2KPa",              Napi::Number::New(env2, r.p2KPa));
          out.Set("p3KPa",              Napi::Number::New(env2, r.p3KPa));
          out.Set("p4KPa",              Napi::Number::New(env2, r.p4KPa));
          out.Set("compressorWorkKJkg", Napi::Number::New(env2, r.compressorWorkKJkg));
          out.Set("turbineWorkKJkg",    Napi::Number::New(env2, r.turbineWorkKJkg));
          out.Set("qInKJkg",            Napi::Number::New(env2, r.qInKJkg));
          out.Set("qOutKJkg",           Napi::Number::New(env2, r.qOutKJkg));
          out.Set("wNetKJkg",           Napi::Number::New(env2, r.wNetKJkg));
          out.Set("thermalEfficiency",  Napi::Number::New(env2, r.thermalEfficiency));
          out.Set("backWorkRatio",      Napi::Number::New(env2, r.backWorkRatio));
          return out;
        });
      }));
    exports.Set("brayton", brayNs);

    // -------- DC shunt motor (Forge-279) --------------------------------
    auto dcNs = Napi::Object::New(env);
    dcNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::dcmotor::Input in{};
          in.supplyVoltageV         = o.Get("supplyVoltageV"        ).As<Napi::Number>().DoubleValue();
          in.armatureResistanceOhms = o.Get("armatureResistanceOhms").As<Napi::Number>().DoubleValue();
          in.motorConstantVPerRadS  = o.Get("motorConstantVPerRadS" ).As<Napi::Number>().DoubleValue();
          in.loadTorqueNm           = o.Get("loadTorqueNm"          ).As<Napi::Number>().DoubleValue();
          in.fieldResistanceOhms    = o.Get("fieldResistanceOhms"   ).As<Napi::Number>().DoubleValue();
          auto r = forge::dcmotor::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("armatureCurrentA",     Napi::Number::New(env2, r.armatureCurrentA));
          out.Set("backEmfV",             Napi::Number::New(env2, r.backEmfV));
          out.Set("angularSpeedRadS",     Napi::Number::New(env2, r.angularSpeedRadS));
          out.Set("speedRpm",             Napi::Number::New(env2, r.speedRpm));
          out.Set("noLoadSpeedRpm",       Napi::Number::New(env2, r.noLoadSpeedRpm));
          out.Set("stallTorqueNm",        Napi::Number::New(env2, r.stallTorqueNm));
          out.Set("speedRegulationPct",   Napi::Number::New(env2, r.speedRegulationPct));
          out.Set("mechanicalPowerW",     Napi::Number::New(env2, r.mechanicalPowerW));
          out.Set("armatureInputPowerW",  Napi::Number::New(env2, r.armatureInputPowerW));
          out.Set("armatureCopperLossW",  Napi::Number::New(env2, r.armatureCopperLossW));
          out.Set("fieldCurrentA",        Napi::Number::New(env2, r.fieldCurrentA));
          out.Set("fieldCopperLossW",     Napi::Number::New(env2, r.fieldCopperLossW));
          out.Set("armatureEfficiency",   Napi::Number::New(env2, r.armatureEfficiency));
          return out;
        });
      }));
    exports.Set("dcmotor", dcNs);

    // -------- Wire rope sling (Forge-280) -------------------------------
    auto slingNs = Napi::Object::New(env);
    slingNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::wireropesling::Input in{};
          in.breakingStrengthN       = o.Get("breakingStrengthN"      ).As<Napi::Number>().DoubleValue();
          in.designFactor            = o.Get("designFactor"           ).As<Napi::Number>().DoubleValue();
          in.numberOfLegs            = o.Get("numberOfLegs"           ).As<Napi::Number>().Int32Value();
          in.legAngleFromVerticalDeg = o.Get("legAngleFromVerticalDeg").As<Napi::Number>().DoubleValue();
          std::string h              = o.Get("hitchType"              ).As<Napi::String>().Utf8Value();
          if      (h == "vertical") in.hitchType = forge::wireropesling::HitchType::Vertical;
          else if (h == "choker"  ) in.hitchType = forge::wireropesling::HitchType::Choker;
          else if (h == "basket"  ) in.hitchType = forge::wireropesling::HitchType::BasketDouble;
          else throw std::runtime_error("hitchType must be 'vertical', 'choker', or 'basket'");
          auto r = forge::wireropesling::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("singleLegWllN",             Napi::Number::New(env2, r.singleLegWllN));
          out.Set("hitchFactor",               Napi::Number::New(env2, r.hitchFactor));
          out.Set("cosTheta",                  Napi::Number::New(env2, r.cosTheta));
          out.Set("assemblyWllN",              Napi::Number::New(env2, r.assemblyWllN));
          out.Set("perLegLoadAtFullCapacityN", Napi::Number::New(env2, r.perLegLoadAtFullCapacityN));
          out.Set("angleStatus",               Napi::String::New(env2, r.angleStatus));
          return out;
        });
      }));
    exports.Set("sling", slingNs);

    // -------- Disc clutch / brake (Forge-281) ---------------------------
    auto dbNs = Napi::Object::New(env);
    dbNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::discbrake::Input in{};
          in.outerRadiusMm       = o.Get("outerRadiusMm"      ).As<Napi::Number>().DoubleValue();
          in.innerRadiusMm       = o.Get("innerRadiusMm"      ).As<Napi::Number>().DoubleValue();
          in.frictionCoefficient = o.Get("frictionCoefficient").As<Napi::Number>().DoubleValue();
          in.clampingForceN      = o.Get("clampingForceN"     ).As<Napi::Number>().DoubleValue();
          in.numberOfFaces       = o.Get("numberOfFaces"      ).As<Napi::Number>().Int32Value();
          std::string a          = o.Get("assumption"         ).As<Napi::String>().Utf8Value();
          if      (a == "uniform-wear"    ) in.assumption = forge::discbrake::Assumption::UniformWear;
          else if (a == "uniform-pressure") in.assumption = forge::discbrake::Assumption::UniformPressure;
          else throw std::runtime_error("assumption must be 'uniform-wear' or 'uniform-pressure'");
          auto r = forge::discbrake::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("meanRadiusMm",      Napi::Number::New(env2, r.meanRadiusMm));
          out.Set("contactAreaMm2",    Napi::Number::New(env2, r.contactAreaMm2));
          out.Set("torqueNm",          Napi::Number::New(env2, r.torqueNm));
          out.Set("averagePressureMPa", Napi::Number::New(env2, r.averagePressureMPa));
          out.Set("maxPressureMPa",    Napi::Number::New(env2, r.maxPressureMPa));
          out.Set("assumptionUsed",    Napi::String::New(env2, r.assumptionUsed));
          return out;
        });
      }));
    exports.Set("discbrake", dbNs);

    // -------- Reciprocating compressor (Forge-282) ----------------------
    auto compNs = Napi::Object::New(env);
    compNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::recipcompressor::Input in{};
          in.inletPressurePa       = o.Get("inletPressurePa"      ).As<Napi::Number>().DoubleValue();
          in.inletTemperatureK     = o.Get("inletTemperatureK"    ).As<Napi::Number>().DoubleValue();
          in.dischargePressurePa   = o.Get("dischargePressurePa"  ).As<Napi::Number>().DoubleValue();
          in.massFlowKgS           = o.Get("massFlowKgS"          ).As<Napi::Number>().DoubleValue();
          in.polytropicIndexN      = o.Get("polytropicIndexN"     ).As<Napi::Number>().DoubleValue();
          in.polytropicEfficiency  = o.Get("polytropicEfficiency" ).As<Napi::Number>().DoubleValue();
          in.clearanceRatioC       = o.Get("clearanceRatioC"      ).As<Napi::Number>().DoubleValue();
          in.gasConstantJkgK       = o.Get("gasConstantJkgK"      ).As<Napi::Number>().DoubleValue();
          auto r = forge::recipcompressor::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("pressureRatio",               Napi::Number::New(env2, r.pressureRatio));
          out.Set("dischargeTemperatureK",       Napi::Number::New(env2, r.dischargeTemperatureK));
          out.Set("temperatureRiseK",            Napi::Number::New(env2, r.temperatureRiseK));
          out.Set("polytropicHeadJkg",           Napi::Number::New(env2, r.polytropicHeadJkg));
          out.Set("volumetricEfficiency",        Napi::Number::New(env2, r.volumetricEfficiency));
          out.Set("brakePowerW",                 Napi::Number::New(env2, r.brakePowerW));
          out.Set("isothermalEquivalentHeadJkg", Napi::Number::New(env2, r.isothermalEquivalentHeadJkg));
          return out;
        });
      }));
    exports.Set("compressor", compNs);

    // -------- Roller chain drive (Forge-283) ----------------------------
    auto cdNs = Napi::Object::New(env);
    cdNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::chaindrive::Input in{};
          in.pitchMm          = o.Get("pitchMm"         ).As<Napi::Number>().DoubleValue();
          in.driverTeeth      = o.Get("driverTeeth"     ).As<Napi::Number>().Int32Value();
          in.drivenTeeth      = o.Get("drivenTeeth"     ).As<Napi::Number>().Int32Value();
          in.centerDistanceMm = o.Get("centerDistanceMm").As<Napi::Number>().DoubleValue();
          in.driverSpeedRpm   = o.Get("driverSpeedRpm"  ).As<Napi::Number>().DoubleValue();
          auto r = forge::chaindrive::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("driverPitchDiameterMm",   Napi::Number::New(env2, r.driverPitchDiameterMm));
          out.Set("drivenPitchDiameterMm",   Napi::Number::New(env2, r.drivenPitchDiameterMm));
          out.Set("speedRatio",              Napi::Number::New(env2, r.speedRatio));
          out.Set("drivenSpeedRpm",          Napi::Number::New(env2, r.drivenSpeedRpm));
          out.Set("chainVelocityMs",         Napi::Number::New(env2, r.chainVelocityMs));
          out.Set("approxLengthMm",          Napi::Number::New(env2, r.approxLengthMm));
          out.Set("lengthInPitches",         Napi::Number::New(env2, r.lengthInPitches));
          out.Set("lengthInPitchesRounded",  Napi::Number::New(env2, r.lengthInPitchesRounded));
          out.Set("finalCenterDistanceMm",   Napi::Number::New(env2, r.finalCenterDistanceMm));
          return out;
        });
      }));
    exports.Set("chain", cdNs);

    // -------- Stopping sight distance (Forge-284) -----------------------
    auto ssdNs = Napi::Object::New(env);
    ssdNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::ssd::Input in{};
          in.designSpeedKmH       = o.Get("designSpeedKmH"      ).As<Napi::Number>().DoubleValue();
          in.perceptionTimeS      = o.Get("perceptionTimeS"     ).As<Napi::Number>().DoubleValue();
          in.frictionCoefficient  = o.Get("frictionCoefficient" ).As<Napi::Number>().DoubleValue();
          in.gradePct             = o.Get("gradePct"            ).As<Napi::Number>().DoubleValue();
          auto r = forge::ssd::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("designSpeedMs",            Napi::Number::New(env2, r.designSpeedMs));
          out.Set("effectiveDecelerationMs2", Napi::Number::New(env2, r.effectiveDecelerationMs2));
          out.Set("perceptionDistanceM",      Napi::Number::New(env2, r.perceptionDistanceM));
          out.Set("brakingDistanceM",         Napi::Number::New(env2, r.brakingDistanceM));
          out.Set("totalSsdM",                Napi::Number::New(env2, r.totalSsdM));
          out.Set("totalSsdFt",               Napi::Number::New(env2, r.totalSsdFt));
          return out;
        });
      }));
    exports.Set("ssd", ssdNs);

    // -------- AASHTO pavement (Forge-285) -------------------------------
    auto pavNs = Napi::Object::New(env);
    pavNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::aashto::Input in{};
          in.w18Esals       = o.Get("w18Esals"      ).As<Napi::Number>().DoubleValue();
          in.reliabilityPct = o.Get("reliabilityPct").As<Napi::Number>().DoubleValue();
          in.overallStdDev  = o.Get("overallStdDev" ).As<Napi::Number>().DoubleValue();
          in.deltaPSI       = o.Get("deltaPSI"      ).As<Napi::Number>().DoubleValue();
          in.subgradeMrPsi  = o.Get("subgradeMrPsi" ).As<Napi::Number>().DoubleValue();
          auto r = forge::aashto::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("zR",               Napi::Number::New(env2, r.zR));
          out.Set("logW18",           Napi::Number::New(env2, r.logW18));
          out.Set("structuralNumber", Napi::Number::New(env2, r.structuralNumber));
          out.Set("iterations",       Napi::Number::New(env2, r.iterations));
          return out;
        });
      }));
    exports.Set("aashto", pavNs);

    // -------- Capstan / bollard friction (Forge-286) --------------------
    auto capNs = Napi::Object::New(env);
    capNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::capstan::Input in{};
          in.holdingForceN        = o.Get("holdingForceN"       ).As<Napi::Number>().DoubleValue();
          in.frictionCoefficient  = o.Get("frictionCoefficient" ).As<Napi::Number>().DoubleValue();
          in.wrapAngleDeg         = o.Get("wrapAngleDeg"        ).As<Napi::Number>().DoubleValue();
          auto r = forge::capstan::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("wrapAngleRad",        Napi::Number::New(env2, r.wrapAngleRad));
          out.Set("amplificationRatio",  Napi::Number::New(env2, r.amplificationRatio));
          out.Set("maxLoadN",            Napi::Number::New(env2, r.maxLoadN));
          out.Set("mechanicalAdvantage", Napi::Number::New(env2, r.mechanicalAdvantage));
          return out;
        });
      }));
    exports.Set("capstan", capNs);

    // -------- Prismoidal earthwork volume (Forge-287) -------------------
    auto prismNs = Napi::Object::New(env);
    prismNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::prismoidal::Input in{};
          in.lengthM       = o.Get("lengthM"      ).As<Napi::Number>().DoubleValue();
          in.areaStartM2   = o.Get("areaStartM2"  ).As<Napi::Number>().DoubleValue();
          in.areaMiddleM2  = o.Get("areaMiddleM2" ).As<Napi::Number>().DoubleValue();
          in.areaEndM2     = o.Get("areaEndM2"    ).As<Napi::Number>().DoubleValue();
          auto r = forge::prismoidal::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("prismoidalVolumeM3",         Napi::Number::New(env2, r.prismoidalVolumeM3));
          out.Set("averageEndAreaVolumeM3",     Napi::Number::New(env2, r.averageEndAreaVolumeM3));
          out.Set("differenceM3",               Napi::Number::New(env2, r.differenceM3));
          out.Set("aeaErrorPct",                Napi::Number::New(env2, r.aeaErrorPct));
          out.Set("prismoidalVolumeCubicYards", Napi::Number::New(env2, r.prismoidalVolumeCubicYards));
          return out;
        });
      }));
    exports.Set("prismoidal", prismNs);

    // -------- Pitot tube velocity (Forge-288) ---------------------------
    auto pitotNs = Napi::Object::New(env);
    pitotNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::pitot::Input in{};
          in.dynamicPressurePa = o.Get("dynamicPressurePa").As<Napi::Number>().DoubleValue();
          in.densityKgM3       = o.Get("densityKgM3"      ).As<Napi::Number>().DoubleValue();
          in.pitotCoefficient  = o.Get("pitotCoefficient" ).As<Napi::Number>().DoubleValue();
          in.flowAreaM2        = o.Get("flowAreaM2"       ).As<Napi::Number>().DoubleValue();
          auto r = forge::pitot::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("velocityMs",     Napi::Number::New(env2, r.velocityMs));
          out.Set("velocityHeadM",  Napi::Number::New(env2, r.velocityHeadM));
          out.Set("volumeFlowM3S",  Napi::Number::New(env2, r.volumeFlowM3S));
          out.Set("massFlowKgS",    Napi::Number::New(env2, r.massFlowKgS));
          return out;
        });
      }));
    exports.Set("pitot", pitotNs);

    // -------- Circular pipe Manning partial flow (Forge-289) ------------
    auto cpfNs = Napi::Object::New(env);
    cpfNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::circpipe::Input in{};
          in.pipeDiameterM = o.Get("pipeDiameterM").As<Napi::Number>().DoubleValue();
          in.waterDepthM   = o.Get("waterDepthM"  ).As<Napi::Number>().DoubleValue();
          in.manningN      = o.Get("manningN"     ).As<Napi::Number>().DoubleValue();
          in.slope         = o.Get("slope"        ).As<Napi::Number>().DoubleValue();
          auto r = forge::circpipe::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("depthRatio",        Napi::Number::New(env2, r.depthRatio));
          out.Set("centralAngleRad",   Napi::Number::New(env2, r.centralAngleRad));
          out.Set("flowAreaM2",        Napi::Number::New(env2, r.flowAreaM2));
          out.Set("wettedPerimeterM",  Napi::Number::New(env2, r.wettedPerimeterM));
          out.Set("hydraulicRadiusM",  Napi::Number::New(env2, r.hydraulicRadiusM));
          out.Set("velocityMs",        Napi::Number::New(env2, r.velocityMs));
          out.Set("dischargeM3S",      Napi::Number::New(env2, r.dischargeM3S));
          out.Set("dischargeLs",       Napi::Number::New(env2, r.dischargeLs));
          out.Set("areaRatio",         Napi::Number::New(env2, r.areaRatio));
          out.Set("velocityRatio",     Napi::Number::New(env2, r.velocityRatio));
          out.Set("dischargeRatio",    Napi::Number::New(env2, r.dischargeRatio));
          return out;
        });
      }));
    exports.Set("circpipe", cpfNs);

    // -------- Worm gear drive (Forge-290) -------------------------------
    auto wormNs = Napi::Object::New(env);
    wormNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::wormgear::Input in{};
          in.moduleMm            = o.Get("moduleMm"           ).As<Napi::Number>().DoubleValue();
          in.wormStarts          = o.Get("wormStarts"         ).As<Napi::Number>().Int32Value();
          in.gearTeeth           = o.Get("gearTeeth"          ).As<Napi::Number>().Int32Value();
          in.wormPitchDiameterMm = o.Get("wormPitchDiameterMm").As<Napi::Number>().DoubleValue();
          in.frictionCoefficient = o.Get("frictionCoefficient").As<Napi::Number>().DoubleValue();
          in.inputSpeedRpm       = o.Get("inputSpeedRpm"      ).As<Napi::Number>().DoubleValue();
          in.inputTorqueNm       = o.Get("inputTorqueNm"      ).As<Napi::Number>().DoubleValue();
          auto r = forge::wormgear::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("velocityRatio",       Napi::Number::New(env2, r.velocityRatio));
          out.Set("leadMm",              Napi::Number::New(env2, r.leadMm));
          out.Set("leadAngleDeg",        Napi::Number::New(env2, r.leadAngleDeg));
          out.Set("frictionAngleDeg",    Napi::Number::New(env2, r.frictionAngleDeg));
          out.Set("gearPitchDiameterMm", Napi::Number::New(env2, r.gearPitchDiameterMm));
          out.Set("centreDistanceMm",    Napi::Number::New(env2, r.centreDistanceMm));
          out.Set("slidingVelocityMs",   Napi::Number::New(env2, r.slidingVelocityMs));
          out.Set("efficiencyPct",       Napi::Number::New(env2, r.efficiencyPct));
          out.Set("outputSpeedRpm",      Napi::Number::New(env2, r.outputSpeedRpm));
          out.Set("outputTorqueNm",      Napi::Number::New(env2, r.outputTorqueNm));
          out.Set("selfLocking",         Napi::Boolean::New(env2, r.selfLocking));
          return out;
        });
      }));
    exports.Set("wormgear", wormNs);

    // -------- Bevel gear (Forge-291) ------------------------------------
    auto bevelNs = Napi::Object::New(env);
    bevelNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::bevelgear::Input in{};
          in.moduleMm         = o.Get("moduleMm"        ).As<Napi::Number>().DoubleValue();
          in.pinionTeeth      = o.Get("pinionTeeth"     ).As<Napi::Number>().Int32Value();
          in.gearTeeth        = o.Get("gearTeeth"       ).As<Napi::Number>().Int32Value();
          in.faceWidthMm      = o.Get("faceWidthMm"     ).As<Napi::Number>().DoubleValue();
          in.pressureAngleDeg = o.Get("pressureAngleDeg").As<Napi::Number>().DoubleValue();
          in.pinionTorqueNm   = o.Get("pinionTorqueNm"  ).As<Napi::Number>().DoubleValue();
          auto r = forge::bevelgear::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("gearRatio",                Napi::Number::New(env2, r.gearRatio));
          out.Set("pinionConeAngleDeg",       Napi::Number::New(env2, r.pinionConeAngleDeg));
          out.Set("gearConeAngleDeg",         Napi::Number::New(env2, r.gearConeAngleDeg));
          out.Set("pinionPitchDiameterMm",    Napi::Number::New(env2, r.pinionPitchDiameterMm));
          out.Set("gearPitchDiameterMm",      Napi::Number::New(env2, r.gearPitchDiameterMm));
          out.Set("coneDistanceMm",           Napi::Number::New(env2, r.coneDistanceMm));
          out.Set("pinionMeanRadiusMm",       Napi::Number::New(env2, r.pinionMeanRadiusMm));
          out.Set("equivalentPinionTeeth",    Napi::Number::New(env2, r.equivalentPinionTeeth));
          out.Set("equivalentGearTeeth",      Napi::Number::New(env2, r.equivalentGearTeeth));
          out.Set("tangentialForceN",         Napi::Number::New(env2, r.tangentialForceN));
          out.Set("radialForceN",             Napi::Number::New(env2, r.radialForceN));
          out.Set("axialForceN",              Napi::Number::New(env2, r.axialForceN));
          return out;
        });
      }));
    exports.Set("bevelgear", bevelNs);

    // -------- Wood shear wall (Forge-292) -------------------------------
    auto wswNs = Napi::Object::New(env);
    wswNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::woodshear::Input in{};
          in.shearLoadKN            = o.Get("shearLoadKN"           ).As<Napi::Number>().DoubleValue();
          in.wallLengthM            = o.Get("wallLengthM"           ).As<Napi::Number>().DoubleValue();
          in.wallHeightM            = o.Get("wallHeightM"           ).As<Napi::Number>().DoubleValue();
          in.allowableShearKNm      = o.Get("allowableShearKNm"     ).As<Napi::Number>().DoubleValue();
          in.chordAreaMm2           = o.Get("chordAreaMm2"          ).As<Napi::Number>().DoubleValue();
          in.chordAllowableStressMPa = o.Get("chordAllowableStressMPa").As<Napi::Number>().DoubleValue();
          auto r = forge::woodshear::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("unitShearKNm",    Napi::Number::New(env2, r.unitShearKNm));
          out.Set("shearDCR",        Napi::Number::New(env2, r.shearDCR));
          out.Set("aspectRatio",     Napi::Number::New(env2, r.aspectRatio));
          out.Set("aspectOK",        Napi::Boolean::New(env2, r.aspectOK));
          out.Set("chordForceKN",    Napi::Number::New(env2, r.chordForceKN));
          out.Set("chordStressMPa",  Napi::Number::New(env2, r.chordStressMPa));
          out.Set("chordDCR",        Napi::Number::New(env2, r.chordDCR));
          out.Set("shearOK",         Napi::Boolean::New(env2, r.shearOK));
          out.Set("chordOK",         Napi::Boolean::New(env2, r.chordOK));
          out.Set("overallOK",       Napi::Boolean::New(env2, r.overallOK));
          return out;
        });
      }));
    exports.Set("woodshear", wswNs);

    // -------- Crane hook (Forge-293) ------------------------------------
    auto hookNs = Napi::Object::New(env);
    hookNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::cranehook::Input in{};
          in.wllKN                    = o.Get("wllKN"                   ).As<Napi::Number>().DoubleValue();
          in.shankDiameterMm          = o.Get("shankDiameterMm"         ).As<Napi::Number>().DoubleValue();
          in.shankAllowableStressMPa  = o.Get("shankAllowableStressMPa" ).As<Napi::Number>().DoubleValue();
          in.throatSectionModulusMm3  = o.Get("throatSectionModulusMm3" ).As<Napi::Number>().DoubleValue();
          in.throatMomentArmMm        = o.Get("throatMomentArmMm"       ).As<Napi::Number>().DoubleValue();
          in.throatAllowableStressMPa = o.Get("throatAllowableStressMPa").As<Napi::Number>().DoubleValue();
          auto r = forge::cranehook::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("shankAreaMm2",      Napi::Number::New(env2, r.shankAreaMm2));
          out.Set("shankStressMPa",    Napi::Number::New(env2, r.shankStressMPa));
          out.Set("shankDCR",          Napi::Number::New(env2, r.shankDCR));
          out.Set("bendingMomentNmm",  Napi::Number::New(env2, r.bendingMomentNmm));
          out.Set("throatStressMPa",   Napi::Number::New(env2, r.throatStressMPa));
          out.Set("throatDCR",         Napi::Number::New(env2, r.throatDCR));
          out.Set("governingDCR",      Napi::Number::New(env2, r.governingDCR));
          out.Set("shankOK",           Napi::Boolean::New(env2, r.shankOK));
          out.Set("throatOK",          Napi::Boolean::New(env2, r.throatOK));
          out.Set("overallOK",         Napi::Boolean::New(env2, r.overallOK));
          return out;
        });
      }));
    exports.Set("hook", hookNs);

    // -------- Air filter (Forge-294) ------------------------------------
    auto afNs = Napi::Object::New(env);
    afNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::airfilter::Input in{};
          in.flowRateM3S            = o.Get("flowRateM3S"           ).As<Napi::Number>().DoubleValue();
          in.faceAreaM2             = o.Get("faceAreaM2"            ).As<Napi::Number>().DoubleValue();
          in.initialPressureDropPa  = o.Get("initialPressureDropPa" ).As<Napi::Number>().DoubleValue();
          in.finalPressureDropPa    = o.Get("finalPressureDropPa"   ).As<Napi::Number>().DoubleValue();
          in.runHours               = o.Get("runHours"              ).As<Napi::Number>().DoubleValue();
          in.fanEfficiency          = o.Get("fanEfficiency"         ).As<Napi::Number>().DoubleValue();
          in.electricityRatePerKWh  = o.Get("electricityRatePerKWh" ).As<Napi::Number>().DoubleValue();
          auto r = forge::airfilter::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("faceVelocityMs",        Napi::Number::New(env2, r.faceVelocityMs));
          out.Set("faceVelocityInRange",   Napi::Boolean::New(env2, r.faceVelocityInRange));
          out.Set("averagePressureDropPa", Napi::Number::New(env2, r.averagePressureDropPa));
          out.Set("fanPowerW",             Napi::Number::New(env2, r.fanPowerW));
          out.Set("energyKWh",             Napi::Number::New(env2, r.energyKWh));
          out.Set("energyCost",            Napi::Number::New(env2, r.energyCost));
          return out;
        });
      }));
    exports.Set("airfilter", afNs);

    // -------- Heat sink fin array (Forge-295) ---------------------------
    auto finarrNs = Napi::Object::New(env);
    finarrNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::finarray::Input in{};
          in.baseWidthMm               = o.Get("baseWidthMm"              ).As<Napi::Number>().DoubleValue();
          in.baseLengthMm              = o.Get("baseLengthMm"             ).As<Napi::Number>().DoubleValue();
          in.finCount                  = o.Get("finCount"                 ).As<Napi::Number>().Int32Value();
          in.finThicknessMm            = o.Get("finThicknessMm"           ).As<Napi::Number>().DoubleValue();
          in.finLengthMm               = o.Get("finLengthMm"              ).As<Napi::Number>().DoubleValue();
          in.materialConductivityWmK   = o.Get("materialConductivityWmK"  ).As<Napi::Number>().DoubleValue();
          in.convectionCoefficientWm2K = o.Get("convectionCoefficientWm2K").As<Napi::Number>().DoubleValue();
          in.baseTemperatureC          = o.Get("baseTemperatureC"         ).As<Napi::Number>().DoubleValue();
          in.ambientTemperatureC       = o.Get("ambientTemperatureC"      ).As<Napi::Number>().DoubleValue();
          auto r = forge::finarray::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("finParameterPerM",          Napi::Number::New(env2, r.finParameterPerM));
          out.Set("correctedLengthMm",         Napi::Number::New(env2, r.correctedLengthMm));
          out.Set("singleFinEfficiency",       Napi::Number::New(env2, r.singleFinEfficiency));
          out.Set("singleFinAreaMm2",          Napi::Number::New(env2, r.singleFinAreaMm2));
          out.Set("totalFinAreaMm2",           Napi::Number::New(env2, r.totalFinAreaMm2));
          out.Set("baseAreaMm2",               Napi::Number::New(env2, r.baseAreaMm2));
          out.Set("totalAreaMm2",              Napi::Number::New(env2, r.totalAreaMm2));
          out.Set("overallSurfaceEfficiency",  Napi::Number::New(env2, r.overallSurfaceEfficiency));
          out.Set("thermalResistanceKW",       Napi::Number::New(env2, r.thermalResistanceKW));
          out.Set("heatDissipatedW",           Napi::Number::New(env2, r.heatDissipatedW));
          return out;
        });
      }));
    exports.Set("finarray", finarrNs);

    // -------- Headed shear stud (Forge-296) -----------------------------
    auto hsNs = Napi::Object::New(env);
    hsNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::headedstud::Input in{};
          in.studDiameterMm           = o.Get("studDiameterMm"          ).As<Napi::Number>().DoubleValue();
          in.concreteStrengthMPa      = o.Get("concreteStrengthMPa"     ).As<Napi::Number>().DoubleValue();
          in.concreteUnitWeightKgM3   = o.Get("concreteUnitWeightKgM3"  ).As<Napi::Number>().DoubleValue();
          in.studUltimateStressMPa    = o.Get("studUltimateStressMPa"   ).As<Napi::Number>().DoubleValue();
          in.groupFactorRg            = o.Get("groupFactorRg"           ).As<Napi::Number>().DoubleValue();
          in.positionFactorRp         = o.Get("positionFactorRp"        ).As<Napi::Number>().DoubleValue();
          in.studCount                = o.Get("studCount"               ).As<Napi::Number>().Int32Value();
          in.requiredHorizShearKN     = o.Get("requiredHorizShearKN"    ).As<Napi::Number>().DoubleValue();
          auto r = forge::headedstud::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("studAreaMm2",         Napi::Number::New(env2, r.studAreaMm2));
          out.Set("concreteModulusMPa",  Napi::Number::New(env2, r.concreteModulusMPa));
          out.Set("qNominalConcreteN",   Napi::Number::New(env2, r.qNominalConcreteN));
          out.Set("qNominalSteelN",      Napi::Number::New(env2, r.qNominalSteelN));
          out.Set("qNominalSingleN",     Napi::Number::New(env2, r.qNominalSingleN));
          out.Set("totalCapacityKN",     Napi::Number::New(env2, r.totalCapacityKN));
          out.Set("demandCapacityRatio", Napi::Number::New(env2, r.demandCapacityRatio));
          out.Set("passes",              Napi::Boolean::New(env2, r.passes));
          return out;
        });
      }));
    exports.Set("headedstud", hsNs);

    // -------- Consolidation (Forge-297) ---------------------------------
    auto consolNs = Napi::Object::New(env);
    consolNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::consol::Input in{};
          in.soilDepthM                       = o.Get("soilDepthM"                      ).As<Napi::Number>().DoubleValue();
          in.doubleDrainage                   = o.Get("doubleDrainage"                  ).As<Napi::Boolean>().Value();
          in.coefficientOfConsolidationM2yr   = o.Get("coefficientOfConsolidationM2yr"  ).As<Napi::Number>().DoubleValue();
          in.volumeCompressibilityM2MN        = o.Get("volumeCompressibilityM2MN"       ).As<Napi::Number>().DoubleValue();
          in.pressureIncreaseKPa              = o.Get("pressureIncreaseKPa"             ).As<Napi::Number>().DoubleValue();
          in.timeYears                        = o.Get("timeYears"                       ).As<Napi::Number>().DoubleValue();
          auto r = forge::consol::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("drainagePathM",            Napi::Number::New(env2, r.drainagePathM));
          out.Set("timeFactor",               Napi::Number::New(env2, r.timeFactor));
          out.Set("degreeOfConsolidation",    Napi::Number::New(env2, r.degreeOfConsolidation));
          out.Set("degreeOfConsolidationPct", Napi::Number::New(env2, r.degreeOfConsolidationPct));
          out.Set("ultimateSettlementMm",     Napi::Number::New(env2, r.ultimateSettlementMm));
          out.Set("settlementAtTimeMm",       Napi::Number::New(env2, r.settlementAtTimeMm));
          out.Set("t90Years",                 Napi::Number::New(env2, r.t90Years));
          return out;
        });
      }));
    exports.Set("consol", consolNs);

    // -------- Vehicle braking energy (Forge-298) ------------------------
    auto vbrakeNs = Napi::Object::New(env);
    vbrakeNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::vehbrake::Input in{};
          in.vehicleMassKg          = o.Get("vehicleMassKg"         ).As<Napi::Number>().DoubleValue();
          in.initialSpeedKmH        = o.Get("initialSpeedKmH"       ).As<Napi::Number>().DoubleValue();
          in.decelerationMs2        = o.Get("decelerationMs2"       ).As<Napi::Number>().DoubleValue();
          in.brakeCount             = o.Get("brakeCount"            ).As<Napi::Number>().Int32Value();
          in.discMassKg             = o.Get("discMassKg"            ).As<Napi::Number>().DoubleValue();
          in.discSpecificHeatJkgK   = o.Get("discSpecificHeatJkgK"  ).As<Napi::Number>().DoubleValue();
          auto r = forge::vehbrake::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("initialSpeedMs",        Napi::Number::New(env2, r.initialSpeedMs));
          out.Set("initialKineticEnergyJ", Napi::Number::New(env2, r.initialKineticEnergyJ));
          out.Set("stopTimeS",             Napi::Number::New(env2, r.stopTimeS));
          out.Set("stopDistanceM",         Napi::Number::New(env2, r.stopDistanceM));
          out.Set("brakeForceTotalN",      Napi::Number::New(env2, r.brakeForceTotalN));
          out.Set("brakeForcePerBrakeN",   Napi::Number::New(env2, r.brakeForcePerBrakeN));
          out.Set("heatPerBrakeJ",         Napi::Number::New(env2, r.heatPerBrakeJ));
          out.Set("discTemperatureRiseK",  Napi::Number::New(env2, r.discTemperatureRiseK));
          out.Set("averagePowerW",         Napi::Number::New(env2, r.averagePowerW));
          return out;
        });
      }));
    exports.Set("vehbrake", vbrakeNs);

    // -------- Catenary cable sag-tension (Forge-299) --------------------
    auto catNs = Napi::Object::New(env);
    catNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::catenary::Input in{};
          in.spanM               = o.Get("spanM"              ).As<Napi::Number>().DoubleValue();
          in.horizontalTensionN  = o.Get("horizontalTensionN" ).As<Napi::Number>().DoubleValue();
          in.linearWeightNPerM   = o.Get("linearWeightNPerM"  ).As<Napi::Number>().DoubleValue();
          auto r = forge::catenary::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("catenaryParameterM",    Napi::Number::New(env2, r.catenaryParameterM));
          out.Set("sagM",                  Napi::Number::New(env2, r.sagM));
          out.Set("sagParabolicM",         Napi::Number::New(env2, r.sagParabolicM));
          out.Set("maxTensionN",           Napi::Number::New(env2, r.maxTensionN));
          out.Set("cableLengthM",          Napi::Number::New(env2, r.cableLengthM));
          out.Set("cableLengthParabolicM", Napi::Number::New(env2, r.cableLengthParabolicM));
          out.Set("sagRatio",              Napi::Number::New(env2, r.sagRatio));
          return out;
        });
      }));
    exports.Set("catenary", catNs);

    // -------- Drum brake short-shoe (Forge-300) -------------------------
    auto drumNs = Napi::Object::New(env);
    drumNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::drumbrake::Input in{};
          in.leverForceP_N    = o.Get("leverForceP_N"   ).As<Napi::Number>().DoubleValue();
          in.leverLength_c_m  = o.Get("leverLength_c_m" ).As<Napi::Number>().DoubleValue();
          in.contactArm_a_m   = o.Get("contactArm_a_m"  ).As<Napi::Number>().DoubleValue();
          in.drumRadius_r_m   = o.Get("drumRadius_r_m"  ).As<Napi::Number>().DoubleValue();
          in.friction_mu      = o.Get("friction_mu"     ).As<Napi::Number>().DoubleValue();
          in.selfEnergizing   = o.Get("selfEnergizing"  ).As<Napi::Boolean>().Value();
          auto r = forge::drumbrake::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("normalForceN",        Napi::Number::New(env2, r.normalForceN));
          out.Set("frictionForceN",      Napi::Number::New(env2, r.frictionForceN));
          out.Set("brakingTorqueNm",     Napi::Number::New(env2, r.brakingTorqueNm));
          out.Set("mechanicalAdvantage", Napi::Number::New(env2, r.mechanicalAdvantage));
          out.Set("selfLockingMargin",   Napi::Number::New(env2, r.selfLockingMargin));
          out.Set("selfLocked",          Napi::Boolean::New(env2, r.selfLocked));
          return out;
        });
      }));
    exports.Set("drumbrake", drumNs);

    // -------- Wire rope FOS + bending fatigue (Forge-301) ---------------
    auto wropeNs = Napi::Object::New(env);
    wropeNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::wirerope::Input in{};
          in.ropeClass         = o.Get("ropeClass"        ).As<Napi::String>().Utf8Value();
          in.applicationClass  = o.Get("applicationClass" ).As<Napi::String>().Utf8Value();
          in.nominalDiameterMm = o.Get("nominalDiameterMm").As<Napi::Number>().DoubleValue();
          in.workingLoadN      = o.Get("workingLoadN"     ).As<Napi::Number>().DoubleValue();
          in.sheaveDiameterMm  = o.Get("sheaveDiameterMm" ).As<Napi::Number>().DoubleValue();
          in.accelerationG     = o.Get("accelerationG"    ).As<Napi::Number>().DoubleValue();
          auto r = forge::wirerope::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("breakingStrengthN",         Napi::Number::New(env2, r.breakingStrengthN));
          out.Set("factorOfSafetyStatic",      Napi::Number::New(env2, r.factorOfSafetyStatic));
          out.Set("factorOfSafetyDynamic",     Napi::Number::New(env2, r.factorOfSafetyDynamic));
          out.Set("outerWireDiameterMm",       Napi::Number::New(env2, r.outerWireDiameterMm));
          out.Set("bendingStressMPa",          Napi::Number::New(env2, r.bendingStressMPa));
          out.Set("metallicAreaMm2",           Napi::Number::New(env2, r.metallicAreaMm2));
          out.Set("equivalentBendingTensionN", Napi::Number::New(env2, r.equivalentBendingTensionN));
          out.Set("totalEffectiveTensionN",    Napi::Number::New(env2, r.totalEffectiveTensionN));
          out.Set("factorOfSafetyTotal",       Napi::Number::New(env2, r.factorOfSafetyTotal));
          out.Set("sheaveRatio",               Napi::Number::New(env2, r.sheaveRatio));
          out.Set("recommendedMinSheaveRatio", Napi::Number::New(env2, r.recommendedMinSheaveRatio));
          out.Set("recommendedFOS",            Napi::Number::New(env2, r.recommendedFOS));
          out.Set("sheavePasses",              Napi::Boolean::New(env2, r.sheavePasses));
          out.Set("strengthPasses",            Napi::Boolean::New(env2, r.strengthPasses));
          out.Set("passes",                    Napi::Boolean::New(env2, r.passes));
          return out;
        });
      }));
    exports.Set("wirerope", wropeNs);

    // -------- Steel beam web shear AISC §G2 (Forge-302) -----------------
    auto wshNs = Napi::Object::New(env);
    wshNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::webshear::Input in{};
          in.overallDepthMm      = o.Get("overallDepthMm"     ).As<Napi::Number>().DoubleValue();
          in.webThicknessMm      = o.Get("webThicknessMm"     ).As<Napi::Number>().DoubleValue();
          in.flangeThicknessMm   = o.Get("flangeThicknessMm"  ).As<Napi::Number>().DoubleValue();
          in.Fy_MPa              = o.Get("Fy_MPa"             ).As<Napi::Number>().DoubleValue();
          in.E_MPa               = o.Get("E_MPa"              ).As<Napi::Number>().DoubleValue();
          in.stiffenerSpacingMm  = o.Get("stiffenerSpacingMm" ).As<Napi::Number>().DoubleValue();
          in.compactRolled       = o.Get("compactRolled"      ).As<Napi::Boolean>().Value();
          auto r = forge::webshear::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("clearWebDepthMm",  Napi::Number::New(env2, r.clearWebDepthMm));
          out.Set("webSlenderness",   Napi::Number::New(env2, r.webSlenderness));
          out.Set("limitCompact",     Napi::Number::New(env2, r.limitCompact));
          out.Set("limitInelastic",   Napi::Number::New(env2, r.limitInelastic));
          out.Set("limitElastic",     Napi::Number::New(env2, r.limitElastic));
          out.Set("k_v",              Napi::Number::New(env2, r.k_v));
          out.Set("C_v1",             Napi::Number::New(env2, r.C_v1));
          out.Set("regime",           Napi::Number::New(env2, r.regime));
          out.Set("nominalShearN",    Napi::Number::New(env2, r.nominalShearN));
          out.Set("LRFDshearN",       Napi::Number::New(env2, r.LRFDshearN));
          out.Set("ASDshearN",        Napi::Number::New(env2, r.ASDshearN));
          out.Set("phi",              Napi::Number::New(env2, r.phi));
          out.Set("omega",            Napi::Number::New(env2, r.omega));
          return out;
        });
      }));
    exports.Set("webshear", wshNs);

    // -------- Hazen-Williams pipe friction (Forge-303) ------------------
    auto hwNs = Napi::Object::New(env);
    hwNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::hazenwilliams::Input in{};
          in.pipeLengthM      = o.Get("pipeLengthM"     ).As<Napi::Number>().DoubleValue();
          in.innerDiameterMm  = o.Get("innerDiameterMm" ).As<Napi::Number>().DoubleValue();
          in.flowLpm          = o.Get("flowLpm"         ).As<Napi::Number>().DoubleValue();
          in.hazenWilliamsC   = o.Get("hazenWilliamsC"  ).As<Napi::Number>().DoubleValue();
          auto r = forge::hazenwilliams::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("velocityMs",              Napi::Number::New(env2, r.velocityMs));
          out.Set("reynoldsApprox",          Napi::Number::New(env2, r.reynoldsApprox));
          out.Set("regimeFlag",              Napi::Number::New(env2, r.regimeFlag));
          out.Set("frictionLossMPerM",       Napi::Number::New(env2, r.frictionLossMPerM));
          out.Set("pressureGradientKpaPerM", Napi::Number::New(env2, r.pressureGradientKpaPerM));
          out.Set("totalPressureLossKpa",    Napi::Number::New(env2, r.totalPressureLossKpa));
          out.Set("velocityHeadKpa",         Napi::Number::New(env2, r.velocityHeadKpa));
          return out;
        });
      }));
    exports.Set("hazenwilliams", hwNs);

    // -------- Voltage drop NEC 215.2 (Forge-304) ------------------------
    auto vdNs = Napi::Object::New(env);
    vdNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::voltagedrop::Input in{};
          in.conductor        = o.Get("conductor"       ).As<Napi::String>().Utf8Value();
          in.phaseSystem      = o.Get("phaseSystem"     ).As<Napi::String>().Utf8Value();
          in.crossSectionMm2  = o.Get("crossSectionMm2" ).As<Napi::Number>().DoubleValue();
          in.currentA         = o.Get("currentA"        ).As<Napi::Number>().DoubleValue();
          in.oneWayLengthM    = o.Get("oneWayLengthM"   ).As<Napi::Number>().DoubleValue();
          in.nominalVoltageV  = o.Get("nominalVoltageV" ).As<Napi::Number>().DoubleValue();
          in.powerFactor      = o.Get("powerFactor"     ).As<Napi::Number>().DoubleValue();
          in.conductorTempC   = o.Get("conductorTempC"  ).As<Napi::Number>().DoubleValue();
          in.reactancePerMOhm = o.Get("reactancePerMOhm").As<Napi::Number>().DoubleValue();
          auto r = forge::voltagedrop::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("resistancePerMOhm",     Napi::Number::New(env2, r.resistancePerMOhm));
          out.Set("reactancePerMOhmOut",   Napi::Number::New(env2, r.reactancePerMOhmOut));
          out.Set("impedanceVoltageDropV", Napi::Number::New(env2, r.impedanceVoltageDropV));
          out.Set("voltageDropV",          Napi::Number::New(env2, r.voltageDropV));
          out.Set("voltageDropPercent",    Napi::Number::New(env2, r.voltageDropPercent));
          out.Set("powerLossKw",           Napi::Number::New(env2, r.powerLossKw));
          out.Set("meetsFeederLimit",      Napi::Boolean::New(env2, r.meetsFeederLimit));
          out.Set("meetsCombinedLimit",    Napi::Boolean::New(env2, r.meetsCombinedLimit));
          return out;
        });
      }));
    exports.Set("voltagedrop", vdNs);

    // -------- Hertz point contact (Forge-305) ---------------------------
    auto hpNs = Napi::Object::New(env);
    hpNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::hertzpoint::Input in{};
          in.normalForceN = o.Get("normalForceN").As<Napi::Number>().DoubleValue();
          in.radius1Mm    = o.Get("radius1Mm"   ).As<Napi::Number>().DoubleValue();
          in.radius2Mm    = o.Get("radius2Mm"   ).As<Napi::Number>().DoubleValue();
          in.E1_MPa       = o.Get("E1_MPa"      ).As<Napi::Number>().DoubleValue();
          in.E2_MPa       = o.Get("E2_MPa"      ).As<Napi::Number>().DoubleValue();
          in.nu1          = o.Get("nu1"         ).As<Napi::Number>().DoubleValue();
          in.nu2          = o.Get("nu2"         ).As<Napi::Number>().DoubleValue();
          auto r = forge::hertzpoint::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("effectiveModulusMPa", Napi::Number::New(env2, r.effectiveModulusMPa));
          out.Set("effectiveRadiusMm",   Napi::Number::New(env2, r.effectiveRadiusMm));
          out.Set("contactRadiusMm",     Napi::Number::New(env2, r.contactRadiusMm));
          out.Set("maxPressureMPa",      Napi::Number::New(env2, r.maxPressureMPa));
          out.Set("meanPressureMPa",     Napi::Number::New(env2, r.meanPressureMPa));
          out.Set("mutualApproachMm",    Napi::Number::New(env2, r.mutualApproachMm));
          out.Set("maxShearStressMPa",   Napi::Number::New(env2, r.maxShearStressMPa));
          out.Set("depthOfMaxShearMm",   Napi::Number::New(env2, r.depthOfMaxShearMm));
          return out;
        });
      }));
    exports.Set("hertzpoint", hpNs);

    // -------- HVAC cooling/heating load (Forge-306) ---------------------
    auto clNs = Napi::Object::New(env);
    clNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::coolingload::Input in{};
          in.airflowLps        = o.Get("airflowLps"       ).As<Napi::Number>().DoubleValue();
          in.tSupplyC          = o.Get("tSupplyC"         ).As<Napi::Number>().DoubleValue();
          in.tReturnC          = o.Get("tReturnC"         ).As<Napi::Number>().DoubleValue();
          in.wSupplyKgPerKg    = o.Get("wSupplyKgPerKg"   ).As<Napi::Number>().DoubleValue();
          in.wReturnKgPerKg    = o.Get("wReturnKgPerKg"   ).As<Napi::Number>().DoubleValue();
          in.atmPressureKPa    = o.Get("atmPressureKPa"   ).As<Napi::Number>().DoubleValue();
          auto r = forge::coolingload::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("massFlowKgPerS",        Napi::Number::New(env2, r.massFlowKgPerS));
          out.Set("sensibleLoadKw",        Napi::Number::New(env2, r.sensibleLoadKw));
          out.Set("latentLoadKw",          Napi::Number::New(env2, r.latentLoadKw));
          out.Set("totalLoadKw",           Napi::Number::New(env2, r.totalLoadKw));
          out.Set("sensibleHeatRatio",     Napi::Number::New(env2, r.sensibleHeatRatio));
          out.Set("enthalpyDifferenceKjKg",Napi::Number::New(env2, r.enthalpyDifferenceKjKg));
          out.Set("modeName",              Napi::String::New(env2, r.modeName));
          return out;
        });
      }));
    exports.Set("coolingload", clNs);

    // -------- Reinforced concrete shear (Forge-307) ---------------------
    auto rcshNs = Napi::Object::New(env);
    rcshNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::rcshear::Input in{};
          in.widthMm             = o.Get("widthMm"            ).As<Napi::Number>().DoubleValue();
          in.effectiveDepthMm    = o.Get("effectiveDepthMm"   ).As<Napi::Number>().DoubleValue();
          in.fc_MPa              = o.Get("fc_MPa"             ).As<Napi::Number>().DoubleValue();
          in.shearReinfAreaMm2   = o.Get("shearReinfAreaMm2"  ).As<Napi::Number>().DoubleValue();
          in.stirrupSpacingMm    = o.Get("stirrupSpacingMm"   ).As<Napi::Number>().DoubleValue();
          in.fyt_MPa             = o.Get("fyt_MPa"            ).As<Napi::Number>().DoubleValue();
          in.lambda              = o.Get("lambda"             ).As<Napi::Number>().DoubleValue();
          auto r = forge::rcshear::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("Vc_kN",                Napi::Number::New(env2, r.Vc_kN));
          out.Set("Vs_kN",                Napi::Number::New(env2, r.Vs_kN));
          out.Set("Vn_kN",                Napi::Number::New(env2, r.Vn_kN));
          out.Set("VnMax_kN",             Napi::Number::New(env2, r.VnMax_kN));
          out.Set("phi",                  Napi::Number::New(env2, r.phi));
          out.Set("phiVn_kN",             Napi::Number::New(env2, r.phiVn_kN));
          out.Set("maxStirrupSpacingMm",  Napi::Number::New(env2, r.maxStirrupSpacingMm));
          out.Set("spacingMeetsLimit",    Napi::Boolean::New(env2, r.spacingMeetsLimit));
          out.Set("crushingControls",     Napi::Boolean::New(env2, r.crushingControls));
          return out;
        });
      }));
    exports.Set("rcshear", rcshNs);

    // -------- Cooling tower performance (Forge-308) ---------------------
    auto ctNs = Napi::Object::New(env);
    ctNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::coolingtower::Input in{};
          in.waterFlowLps          = o.Get("waterFlowLps"         ).As<Napi::Number>().DoubleValue();
          in.inletTempC            = o.Get("inletTempC"           ).As<Napi::Number>().DoubleValue();
          in.outletTempC           = o.Get("outletTempC"          ).As<Napi::Number>().DoubleValue();
          in.wetBulbTempC          = o.Get("wetBulbTempC"         ).As<Napi::Number>().DoubleValue();
          in.cyclesOfConcentration = o.Get("cyclesOfConcentration").As<Napi::Number>().DoubleValue();
          in.driftFraction         = o.Get("driftFraction"        ).As<Napi::Number>().DoubleValue();
          auto r = forge::coolingtower::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("rangeK",             Napi::Number::New(env2, r.rangeK));
          out.Set("approachK",          Napi::Number::New(env2, r.approachK));
          out.Set("heatRejectionKw",    Napi::Number::New(env2, r.heatRejectionKw));
          out.Set("evaporationLps",     Napi::Number::New(env2, r.evaporationLps));
          out.Set("bleedLps",           Napi::Number::New(env2, r.bleedLps));
          out.Set("driftLps",           Napi::Number::New(env2, r.driftLps));
          out.Set("makeupLps",          Napi::Number::New(env2, r.makeupLps));
          out.Set("evaporationPercent", Napi::Number::New(env2, r.evaporationPercent));
          out.Set("makeupPercent",      Napi::Number::New(env2, r.makeupPercent));
          return out;
        });
      }));
    exports.Set("coolingtower", ctNs);

    // -------- Mononobe-Okabe seismic earth pressure (Forge-309) ---------
    auto moNs = Napi::Object::New(env);
    moNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::mokabe::Input in{};
          in.soilFrictionAngleDeg   = o.Get("soilFrictionAngleDeg"  ).As<Napi::Number>().DoubleValue();
          in.wallFrictionAngleDeg   = o.Get("wallFrictionAngleDeg"  ).As<Napi::Number>().DoubleValue();
          in.backfillSlopeDeg       = o.Get("backfillSlopeDeg"      ).As<Napi::Number>().DoubleValue();
          in.wallTiltDeg            = o.Get("wallTiltDeg"           ).As<Napi::Number>().DoubleValue();
          in.horizontalSeismicCoeff = o.Get("horizontalSeismicCoeff").As<Napi::Number>().DoubleValue();
          in.verticalSeismicCoeff   = o.Get("verticalSeismicCoeff"  ).As<Napi::Number>().DoubleValue();
          in.soilUnitWeightKnPerM3  = o.Get("soilUnitWeightKnPerM3" ).As<Napi::Number>().DoubleValue();
          in.wallHeightM            = o.Get("wallHeightM"           ).As<Napi::Number>().DoubleValue();
          auto r = forge::mokabe::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("staticKa",                    Napi::Number::New(env2, r.staticKa));
          out.Set("seismicKae",                  Napi::Number::New(env2, r.seismicKae));
          out.Set("seismicInertiaAngleDeg",      Napi::Number::New(env2, r.seismicInertiaAngleDeg));
          out.Set("staticForceKnPerM",           Napi::Number::New(env2, r.staticForceKnPerM));
          out.Set("totalSeismicForceKnPerM",     Napi::Number::New(env2, r.totalSeismicForceKnPerM));
          out.Set("seismicIncrementKnPerM",      Napi::Number::New(env2, r.seismicIncrementKnPerM));
          out.Set("pointOfApplicationFromBaseM", Napi::Number::New(env2, r.pointOfApplicationFromBaseM));
          return out;
        });
      }));
    exports.Set("mokabe", moNs);

    // -------- Block-shear rupture AISC §J4.3 (Forge-310) ----------------
    auto bsNs = Napi::Object::New(env);
    bsNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::blockshear::Input in{};
          in.A_gv_mm2 = o.Get("A_gv_mm2").As<Napi::Number>().DoubleValue();
          in.A_nv_mm2 = o.Get("A_nv_mm2").As<Napi::Number>().DoubleValue();
          in.A_nt_mm2 = o.Get("A_nt_mm2").As<Napi::Number>().DoubleValue();
          in.U_bs     = o.Get("U_bs"    ).As<Napi::Number>().DoubleValue();
          in.Fy_MPa   = o.Get("Fy_MPa"  ).As<Napi::Number>().DoubleValue();
          in.Fu_MPa   = o.Get("Fu_MPa"  ).As<Napi::Number>().DoubleValue();
          auto r = forge::blockshear::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("shearRuptureCapN",  Napi::Number::New(env2, r.shearRuptureCapN));
          out.Set("shearYieldingCapN", Napi::Number::New(env2, r.shearYieldingCapN));
          out.Set("tensionRuptureN",   Napi::Number::New(env2, r.tensionRuptureN));
          out.Set("governingShearN",   Napi::Number::New(env2, r.governingShearN));
          out.Set("nominalCapN",       Napi::Number::New(env2, r.nominalCapN));
          out.Set("LRFDcapN",          Napi::Number::New(env2, r.LRFDcapN));
          out.Set("ASDcapN",           Napi::Number::New(env2, r.ASDcapN));
          out.Set("governingPath",     Napi::Number::New(env2, r.governingPath));
          return out;
        });
      }));
    exports.Set("blockshear", bsNs);

    // -------- Section classification AISC Table B4.1b (Forge-311) -------
    auto sclassNs = Napi::Object::New(env);
    sclassNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::sectclass::Input in{};
          in.bf_mm  = o.Get("bf_mm" ).As<Napi::Number>().DoubleValue();
          in.tf_mm  = o.Get("tf_mm" ).As<Napi::Number>().DoubleValue();
          in.d_mm   = o.Get("d_mm"  ).As<Napi::Number>().DoubleValue();
          in.tw_mm  = o.Get("tw_mm" ).As<Napi::Number>().DoubleValue();
          in.Fy_MPa = o.Get("Fy_MPa").As<Napi::Number>().DoubleValue();
          in.E_MPa  = o.Get("E_MPa" ).As<Napi::Number>().DoubleValue();
          auto r = forge::sectclass::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("flangeSlenderness", Napi::Number::New(env2, r.flangeSlenderness));
          out.Set("flangeLambda_p",    Napi::Number::New(env2, r.flangeLambda_p));
          out.Set("flangeLambda_r",    Napi::Number::New(env2, r.flangeLambda_r));
          out.Set("flangeClass",       Napi::String::New(env2, r.flangeClass));
          out.Set("webSlenderness",    Napi::Number::New(env2, r.webSlenderness));
          out.Set("webLambda_p",       Napi::Number::New(env2, r.webLambda_p));
          out.Set("webLambda_r",       Napi::Number::New(env2, r.webLambda_r));
          out.Set("webClass",          Napi::String::New(env2, r.webClass));
          out.Set("overallClass",      Napi::String::New(env2, r.overallClass));
          return out;
        });
      }));
    exports.Set("sectclass", sclassNs);

    // -------- Concrete mix design ACI 211.1 (Forge-312) -----------------
    auto cmixNs = Napi::Object::New(env);
    cmixNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::concretemix::Input in{};
          in.targetStrengthMPa       = o.Get("targetStrengthMPa"      ).As<Napi::Number>().DoubleValue();
          in.slumpMm                 = o.Get("slumpMm"                ).As<Napi::Number>().DoubleValue();
          in.maxAggregateSizeMm      = o.Get("maxAggregateSizeMm"     ).As<Napi::Number>().DoubleValue();
          in.airContentFraction      = o.Get("airContentFraction"     ).As<Napi::Number>().DoubleValue();
          in.cementSpecificGravity   = o.Get("cementSpecificGravity"  ).As<Napi::Number>().DoubleValue();
          in.sandSpecificGravity     = o.Get("sandSpecificGravity"    ).As<Napi::Number>().DoubleValue();
          in.coarseSpecificGravity   = o.Get("coarseSpecificGravity"  ).As<Napi::Number>().DoubleValue();
          in.coarseDryRoddedDensity  = o.Get("coarseDryRoddedDensity" ).As<Napi::Number>().DoubleValue();
          in.coarseFinenessModulus   = o.Get("coarseFinenessModulus"  ).As<Napi::Number>().DoubleValue();
          auto r = forge::concretemix::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("waterCementRatio",       Napi::Number::New(env2, r.waterCementRatio));
          out.Set("waterDemandKg",          Napi::Number::New(env2, r.waterDemandKg));
          out.Set("cementMassKg",           Napi::Number::New(env2, r.cementMassKg));
          out.Set("coarseAggregateMassKg",  Napi::Number::New(env2, r.coarseAggregateMassKg));
          out.Set("sandMassKg",             Napi::Number::New(env2, r.sandMassKg));
          out.Set("airVolumeM3",            Napi::Number::New(env2, r.airVolumeM3));
          out.Set("cementVolumeM3",         Napi::Number::New(env2, r.cementVolumeM3));
          out.Set("waterVolumeM3",          Napi::Number::New(env2, r.waterVolumeM3));
          out.Set("coarseVolumeM3",         Napi::Number::New(env2, r.coarseVolumeM3));
          out.Set("sandVolumeM3",           Napi::Number::New(env2, r.sandVolumeM3));
          out.Set("freshUnitWeightKgPerM3", Napi::Number::New(env2, r.freshUnitWeightKgPerM3));
          return out;
        });
      }));
    exports.Set("concretemix", cmixNs);

    // -------- Steam pipe sizing Spirax Sarco (Forge-313) ----------------
    auto stpNs = Napi::Object::New(env);
    stpNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::steampipe::Input in{};
          in.steamPressureBarGauge = o.Get("steamPressureBarGauge").As<Napi::Number>().DoubleValue();
          in.steamMassFlowKgPerH   = o.Get("steamMassFlowKgPerH"  ).As<Napi::Number>().DoubleValue();
          in.velocityLimitMs       = o.Get("velocityLimitMs"      ).As<Napi::Number>().DoubleValue();
          in.pipeLengthM           = o.Get("pipeLengthM"          ).As<Napi::Number>().DoubleValue();
          auto r = forge::steampipe::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("saturationTempC",         Napi::Number::New(env2, r.saturationTempC));
          out.Set("specificVolumeM3PerKg",   Napi::Number::New(env2, r.specificVolumeM3PerKg));
          out.Set("requiredAreaMm2",         Napi::Number::New(env2, r.requiredAreaMm2));
          out.Set("requiredDiameterMm",      Napi::Number::New(env2, r.requiredDiameterMm));
          out.Set("standardDN",              Napi::Number::New(env2, r.standardDN));
          out.Set("actualVelocityMs",        Napi::Number::New(env2, r.actualVelocityMs));
          out.Set("pressureDropBarPer100m",  Napi::Number::New(env2, r.pressureDropBarPer100m));
          out.Set("totalPressureDropBar",    Napi::Number::New(env2, r.totalPressureDropBar));
          return out;
        });
      }));
    exports.Set("steampipe", stpNs);

    // -------- Compressed-air pipe sizing CAGI (Forge-314) ---------------
    auto apNs = Napi::Object::New(env);
    apNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::airpipe::Input in{};
          in.supplyPressureBarGauge   = o.Get("supplyPressureBarGauge"  ).As<Napi::Number>().DoubleValue();
          in.freeAirDeliveryM3PerMin  = o.Get("freeAirDeliveryM3PerMin" ).As<Napi::Number>().DoubleValue();
          in.velocityLimitMs          = o.Get("velocityLimitMs"         ).As<Napi::Number>().DoubleValue();
          in.pipeLengthM              = o.Get("pipeLengthM"             ).As<Napi::Number>().DoubleValue();
          auto r = forge::airpipe::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("absolutePressureBar",     Napi::Number::New(env2, r.absolutePressureBar));
          out.Set("actualVolumeFlowM3PerS",  Napi::Number::New(env2, r.actualVolumeFlowM3PerS));
          out.Set("airDensityKgPerM3",       Napi::Number::New(env2, r.airDensityKgPerM3));
          out.Set("requiredAreaMm2",         Napi::Number::New(env2, r.requiredAreaMm2));
          out.Set("requiredDiameterMm",      Napi::Number::New(env2, r.requiredDiameterMm));
          out.Set("standardDN",              Napi::Number::New(env2, r.standardDN));
          out.Set("actualVelocityMs",        Napi::Number::New(env2, r.actualVelocityMs));
          out.Set("pressureDropBarPer100m",  Napi::Number::New(env2, r.pressureDropBarPer100m));
          out.Set("totalPressureDropBar",    Napi::Number::New(env2, r.totalPressureDropBar));
          return out;
        });
      }));
    exports.Set("airpipe", apNs);

    // -------- Wind turbine BEM / Betz (Forge-315) -----------------------
    auto wtNs = Napi::Object::New(env);
    wtNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::windturbine::Input in{};
          in.rotorDiameterM       = o.Get("rotorDiameterM"      ).As<Napi::Number>().DoubleValue();
          in.windSpeedMs          = o.Get("windSpeedMs"         ).As<Napi::Number>().DoubleValue();
          in.airDensityKgPerM3    = o.Get("airDensityKgPerM3"   ).As<Napi::Number>().DoubleValue();
          in.powerCoefficient     = o.Get("powerCoefficient"    ).As<Napi::Number>().DoubleValue();
          in.generatorEfficiency  = o.Get("generatorEfficiency" ).As<Napi::Number>().DoubleValue();
          in.rotorSpeedRpm        = o.Get("rotorSpeedRpm"       ).As<Napi::Number>().DoubleValue();
          in.capacityFactor       = o.Get("capacityFactor"      ).As<Napi::Number>().DoubleValue();
          auto r = forge::windturbine::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("sweptAreaM2",          Napi::Number::New(env2, r.sweptAreaM2));
          out.Set("availableWindPowerW",  Napi::Number::New(env2, r.availableWindPowerW));
          out.Set("betzCeilingPowerW",    Napi::Number::New(env2, r.betzCeilingPowerW));
          out.Set("mechanicalPowerW",     Napi::Number::New(env2, r.mechanicalPowerW));
          out.Set("electricalPowerW",     Napi::Number::New(env2, r.electricalPowerW));
          out.Set("tipSpeedRatio",        Napi::Number::New(env2, r.tipSpeedRatio));
          out.Set("annualEnergyMWh",      Napi::Number::New(env2, r.annualEnergyMWh));
          return out;
        });
      }));
    exports.Set("windturbine", wtNs);

    // -------- Concrete creep + shrinkage ACI 209 (Forge-316) ------------
    auto crpNs = Napi::Object::New(env);
    crpNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::creep::Input in{};
          in.sustainedStressMPa       = o.Get("sustainedStressMPa"      ).As<Napi::Number>().DoubleValue();
          in.concreteModulusMPa       = o.Get("concreteModulusMPa"      ).As<Napi::Number>().DoubleValue();
          in.ambientHumidityPercent   = o.Get("ambientHumidityPercent"  ).As<Napi::Number>().DoubleValue();
          in.loadingAgeDays           = o.Get("loadingAgeDays"          ).As<Napi::Number>().DoubleValue();
          in.timeAfterLoadingDays     = o.Get("timeAfterLoadingDays"    ).As<Napi::Number>().DoubleValue();
          in.ultimateCreepCoeff       = o.Get("ultimateCreepCoeff"      ).As<Napi::Number>().DoubleValue();
          in.ultimateShrinkageStrain  = o.Get("ultimateShrinkageStrain" ).As<Napi::Number>().DoubleValue();
          auto r = forge::creep::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("humidityFactorCreep",   Napi::Number::New(env2, r.humidityFactorCreep));
          out.Set("humidityFactorShrink",  Napi::Number::New(env2, r.humidityFactorShrink));
          out.Set("loadAgeFactor",         Napi::Number::New(env2, r.loadAgeFactor));
          out.Set("appliedUltimateCreep",  Napi::Number::New(env2, r.appliedUltimateCreep));
          out.Set("appliedUltimateShrink", Napi::Number::New(env2, r.appliedUltimateShrink));
          out.Set("creepCoefficient",      Napi::Number::New(env2, r.creepCoefficient));
          out.Set("shrinkageStrain",       Napi::Number::New(env2, r.shrinkageStrain));
          out.Set("instantaneousStrain",   Napi::Number::New(env2, r.instantaneousStrain));
          out.Set("totalLongTermStrain",   Napi::Number::New(env2, r.totalLongTermStrain));
          out.Set("creepStrain",           Napi::Number::New(env2, r.creepStrain));
          return out;
        });
      }));
    exports.Set("concretecreep", crpNs);

    // -------- Stormwater detention basin (Forge-317) --------------------
    auto detNs = Napi::Object::New(env);
    detNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::detention::Input in{};
          in.areaHa                  = o.Get("areaHa"                 ).As<Napi::Number>().DoubleValue();
          in.runoffCoeffPre          = o.Get("runoffCoeffPre"         ).As<Napi::Number>().DoubleValue();
          in.runoffCoeffPost         = o.Get("runoffCoeffPost"        ).As<Napi::Number>().DoubleValue();
          in.designIntensityMmHr     = o.Get("designIntensityMmHr"    ).As<Napi::Number>().DoubleValue();
          in.allowableReleaseRatio   = o.Get("allowableReleaseRatio"  ).As<Napi::Number>().DoubleValue();
          in.timeOfConcentrationMin  = o.Get("timeOfConcentrationMin" ).As<Napi::Number>().DoubleValue();
          in.designStormDurationMin  = o.Get("designStormDurationMin" ).As<Napi::Number>().DoubleValue();
          auto r = forge::detention::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("areaM2",                  Napi::Number::New(env2, r.areaM2));
          out.Set("preDevQM3PerS",           Napi::Number::New(env2, r.preDevQM3PerS));
          out.Set("postDevQM3PerS",          Napi::Number::New(env2, r.postDevQM3PerS));
          out.Set("allowableReleaseQM3PerS", Napi::Number::New(env2, r.allowableReleaseQM3PerS));
          out.Set("detentionVolumeM3",       Napi::Number::New(env2, r.detentionVolumeM3));
          out.Set("detentionVolumeAcreFt",   Napi::Number::New(env2, r.detentionVolumeAcreFt));
          out.Set("detentionRequired",       Napi::Boolean::New(env2, r.detentionRequired));
          return out;
        });
      }));
    exports.Set("detention", detNs);

    // -------- Steel column base plate AISC §J9 (Forge-318) --------------
    auto bpNs = Napi::Object::New(env);
    bpNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::baseplate::Input in{};
          in.appliedAxialKn      = o.Get("appliedAxialKn"     ).As<Napi::Number>().DoubleValue();
          in.plateWidthB_mm      = o.Get("plateWidthB_mm"     ).As<Napi::Number>().DoubleValue();
          in.plateLengthN_mm     = o.Get("plateLengthN_mm"    ).As<Napi::Number>().DoubleValue();
          in.columnDepthD_mm     = o.Get("columnDepthD_mm"    ).As<Napi::Number>().DoubleValue();
          in.columnFlangeBf_mm   = o.Get("columnFlangeBf_mm"  ).As<Napi::Number>().DoubleValue();
          in.supportWidthB2_mm   = o.Get("supportWidthB2_mm"  ).As<Napi::Number>().DoubleValue();
          in.supportLengthN2_mm  = o.Get("supportLengthN2_mm" ).As<Napi::Number>().DoubleValue();
          in.fc_MPa              = o.Get("fc_MPa"             ).As<Napi::Number>().DoubleValue();
          in.Fy_MPa              = o.Get("Fy_MPa"             ).As<Napi::Number>().DoubleValue();
          auto r = forge::baseplate::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("A_1_mm2",                   Napi::Number::New(env2, r.A_1_mm2));
          out.Set("A_2_mm2",                   Napi::Number::New(env2, r.A_2_mm2));
          out.Set("sqrtA2A1",                  Napi::Number::New(env2, r.sqrtA2A1));
          out.Set("bearingStrength_Pp_kN",     Napi::Number::New(env2, r.bearingStrength_Pp_kN));
          out.Set("LRFD_phiPp_kN",             Napi::Number::New(env2, r.LRFD_phiPp_kN));
          out.Set("ASD_PpOverOmega_kN",        Napi::Number::New(env2, r.ASD_PpOverOmega_kN));
          out.Set("projection_m_mm",           Napi::Number::New(env2, r.projection_m_mm));
          out.Set("projection_n_mm",           Napi::Number::New(env2, r.projection_n_mm));
          out.Set("thorntonLambda_nprime_mm",  Napi::Number::New(env2, r.thorntonLambda_nprime_mm));
          out.Set("governingProjection_mm",    Napi::Number::New(env2, r.governingProjection_mm));
          out.Set("requiredPlateThickness_mm", Napi::Number::New(env2, r.requiredPlateThickness_mm));
          out.Set("bearingPasses",             Napi::Boolean::New(env2, r.bearingPasses));
          return out;
        });
      }));
    exports.Set("baseplate", bpNs);

    // -------- Hydraulic jump Belanger (Forge-319) -----------------------
    auto hjNs = Napi::Object::New(env);
    hjNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::hydjump::Input in{};
          in.channelWidthB_m    = o.Get("channelWidthB_m"   ).As<Napi::Number>().DoubleValue();
          in.upstreamDepthY1_m  = o.Get("upstreamDepthY1_m" ).As<Napi::Number>().DoubleValue();
          in.dischargeQM3PerS   = o.Get("dischargeQM3PerS"  ).As<Napi::Number>().DoubleValue();
          in.gravityMs2         = o.Get("gravityMs2"        ).As<Napi::Number>().DoubleValue();
          auto r = forge::hydjump::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("upstreamVelocityV1_ms",     Napi::Number::New(env2, r.upstreamVelocityV1_ms));
          out.Set("upstreamFroudeNumber",      Napi::Number::New(env2, r.upstreamFroudeNumber));
          out.Set("sequentDepthY2_m",          Napi::Number::New(env2, r.sequentDepthY2_m));
          out.Set("downstreamVelocityV2_ms",   Napi::Number::New(env2, r.downstreamVelocityV2_ms));
          out.Set("downstreamFroudeNumber",    Napi::Number::New(env2, r.downstreamFroudeNumber));
          out.Set("upstreamSpecificEnergyM",   Napi::Number::New(env2, r.upstreamSpecificEnergyM));
          out.Set("downstreamSpecificEnergyM", Napi::Number::New(env2, r.downstreamSpecificEnergyM));
          out.Set("energyHeadLossM",           Napi::Number::New(env2, r.energyHeadLossM));
          out.Set("jumpEfficiencyPercent",     Napi::Number::New(env2, r.jumpEfficiencyPercent));
          out.Set("jumpLengthM",               Napi::Number::New(env2, r.jumpLengthM));
          out.Set("jumpType",                  Napi::String::New(env2, r.jumpType));
          return out;
        });
      }));
    exports.Set("hydjump", hjNs);

    // -------- Buried-pipe earth load Marston (Forge-319b) ---------------
    auto bpipeNs = Napi::Object::New(env);
    bpipeNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::buriedpipe::Input in{};
          in.trenchWidthBd_m       = o.Get("trenchWidthBd_m"      ).As<Napi::Number>().DoubleValue();
          in.fillHeightH_m         = o.Get("fillHeightH_m"        ).As<Napi::Number>().DoubleValue();
          in.soilFrictionAngleDeg  = o.Get("soilFrictionAngleDeg" ).As<Napi::Number>().DoubleValue();
          in.soilUnitWeightKnPerM3 = o.Get("soilUnitWeightKnPerM3").As<Napi::Number>().DoubleValue();
          auto r = forge::buriedpipe::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("K_Rankine",       Napi::Number::New(env2, r.K_Rankine));
          out.Set("mu_prime",        Napi::Number::New(env2, r.mu_prime));
          out.Set("C_d",             Napi::Number::New(env2, r.C_d));
          out.Set("earthLoadKnPerM", Napi::Number::New(env2, r.earthLoadKnPerM));
          return out;
        });
      }));
    exports.Set("buriedpipe", bpipeNs);

    // -------- Substation ground-grid IEEE 80 (Forge-319c) ---------------
    auto sgNs = Napi::Object::New(env);
    sgNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::subgnd::Input in{};
          in.soilResistivityOhmM    = o.Get("soilResistivityOhmM"   ).As<Napi::Number>().DoubleValue();
          in.gridAreaM2             = o.Get("gridAreaM2"            ).As<Napi::Number>().DoubleValue();
          in.totalConductorLengthM  = o.Get("totalConductorLengthM" ).As<Napi::Number>().DoubleValue();
          in.burialDepthM           = o.Get("burialDepthM"          ).As<Napi::Number>().DoubleValue();
          auto r = forge::subgnd::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("gridResistanceOhm",  Napi::Number::New(env2, r.gridResistanceOhm));
          out.Set("meetsIeee80Target",  Napi::Boolean::New(env2, r.meetsIeee80Target));
          return out;
        });
      }));
    exports.Set("subgnd", sgNs);

    // -------- Pile group efficiency Converse-Labarre (Forge-319d) -------
    auto pgNs = Napi::Object::New(env);
    pgNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::pilegroup::Input in{};
          in.pileDiameterMm       = o.Get("pileDiameterMm"      ).As<Napi::Number>().DoubleValue();
          in.spacingMm            = o.Get("spacingMm"           ).As<Napi::Number>().DoubleValue();
          in.rows_m               = o.Get("rows_m"              ).As<Napi::Number>().Int32Value();
          in.columns_n            = o.Get("columns_n"           ).As<Napi::Number>().Int32Value();
          in.singlePileCapacityKn = o.Get("singlePileCapacityKn").As<Napi::Number>().DoubleValue();
          auto r = forge::pilegroup::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("anglePhiDeg",     Napi::Number::New(env2, r.anglePhiDeg));
          out.Set("efficiency",      Napi::Number::New(env2, r.efficiency));
          out.Set("groupCapacityKn", Napi::Number::New(env2, r.groupCapacityKn));
          return out;
        });
      }));
    exports.Set("pilegroup", pgNs);

    // -------- Basement uplift / buoyancy (Forge-319e) -------------------
    auto byNs = Napi::Object::New(env);
    byNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::buoyancy::Input in{};
          in.basementWidthB_m         = o.Get("basementWidthB_m"        ).As<Napi::Number>().DoubleValue();
          in.basementLengthN_m        = o.Get("basementLengthN_m"       ).As<Napi::Number>().DoubleValue();
          in.waterHeadAboveSlabM      = o.Get("waterHeadAboveSlabM"     ).As<Napi::Number>().DoubleValue();
          in.slabSelfWeightKnPerM2    = o.Get("slabSelfWeightKnPerM2"   ).As<Napi::Number>().DoubleValue();
          in.overburdenKnPerM2        = o.Get("overburdenKnPerM2"       ).As<Napi::Number>().DoubleValue();
          in.waterUnitWeightKnPerM3   = o.Get("waterUnitWeightKnPerM3"  ).As<Napi::Number>().DoubleValue();
          auto r = forge::buoyancy::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("slabAreaM2",     Napi::Number::New(env2, r.slabAreaM2));
          out.Set("upliftForceKn",  Napi::Number::New(env2, r.upliftForceKn));
          out.Set("weightForceKn",  Napi::Number::New(env2, r.weightForceKn));
          out.Set("netUpliftKn",    Napi::Number::New(env2, r.netUpliftKn));
          out.Set("factorOfSafety", Napi::Number::New(env2, r.factorOfSafety));
          out.Set("passes",         Napi::Boolean::New(env2, r.passes));
          return out;
        });
      }));
    exports.Set("buoyancy", byNs);

    // -------- Forge-320 5-calc bundle -----------------------------------
    // Forge-320a Rebar development
    auto rdNs = Napi::Object::New(env);
    rdNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::rebardev::Input in{};
          in.barDiameter_db_mm = o.Get("barDiameter_db_mm").As<Napi::Number>().DoubleValue();
          in.fc_MPa            = o.Get("fc_MPa"           ).As<Napi::Number>().DoubleValue();
          in.fy_MPa            = o.Get("fy_MPa"           ).As<Napi::Number>().DoubleValue();
          in.psi_t             = o.Get("psi_t"            ).As<Napi::Number>().DoubleValue();
          in.psi_e             = o.Get("psi_e"            ).As<Napi::Number>().DoubleValue();
          in.psi_s             = o.Get("psi_s"            ).As<Napi::Number>().DoubleValue();
          in.lambda            = o.Get("lambda"           ).As<Napi::Number>().DoubleValue();
          in.clearCover_cb_mm  = o.Get("clearCover_cb_mm" ).As<Napi::Number>().DoubleValue();
          in.Ktr_mm            = o.Get("Ktr_mm"           ).As<Napi::Number>().DoubleValue();
          auto r = forge::rebardev::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("cbKtrOverDb",         Napi::Number::New(env2, r.cbKtrOverDb));
          out.Set("developmentLengthMm", Napi::Number::New(env2, r.developmentLengthMm));
          out.Set("rawLengthMm",         Napi::Number::New(env2, r.rawLengthMm));
          out.Set("minimumGoverned",     Napi::Boolean::New(env2, r.minimumGoverned));
          return out;
        });
      }));
    exports.Set("rebardev", rdNs);

    // Forge-320b Chilled-water pump
    auto chwNs = Napi::Object::New(env);
    chwNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::chwpump::Input in{};
          in.coolingLoadKw      = o.Get("coolingLoadKw"     ).As<Napi::Number>().DoubleValue();
          in.designDeltaTKelvin = o.Get("designDeltaTKelvin").As<Napi::Number>().DoubleValue();
          in.pumpHeadM          = o.Get("pumpHeadM"         ).As<Napi::Number>().DoubleValue();
          in.pumpEfficiency     = o.Get("pumpEfficiency"    ).As<Napi::Number>().DoubleValue();
          in.motorEfficiency    = o.Get("motorEfficiency"   ).As<Napi::Number>().DoubleValue();
          auto r = forge::chwpump::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("massFlowKgPerS",    Napi::Number::New(env2, r.massFlowKgPerS));
          out.Set("volumeFlowLPerS",   Napi::Number::New(env2, r.volumeFlowLPerS));
          out.Set("hydraulicPowerW",   Napi::Number::New(env2, r.hydraulicPowerW));
          out.Set("pumpShaftPowerW",   Napi::Number::New(env2, r.pumpShaftPowerW));
          out.Set("electricalPowerW",  Napi::Number::New(env2, r.electricalPowerW));
          out.Set("overallEfficiency", Napi::Number::New(env2, r.overallEfficiency));
          return out;
        });
      }));
    exports.Set("chwpump", chwNs);

    // Forge-320c Diesel genset
    auto gsNs = Napi::Object::New(env);
    gsNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::genset::Input in{};
          in.connectedLoadKw        = o.Get("connectedLoadKw"       ).As<Napi::Number>().DoubleValue();
          in.diversityFactor        = o.Get("diversityFactor"       ).As<Napi::Number>().DoubleValue();
          in.powerFactor            = o.Get("powerFactor"           ).As<Napi::Number>().DoubleValue();
          in.altitudeM              = o.Get("altitudeM"             ).As<Napi::Number>().DoubleValue();
          in.ambientTempC           = o.Get("ambientTempC"          ).As<Napi::Number>().DoubleValue();
          in.fuelConsumptionLPerKwh = o.Get("fuelConsumptionLPerKwh").As<Napi::Number>().DoubleValue();
          in.designRuntimeHr        = o.Get("designRuntimeHr"       ).As<Napi::Number>().DoubleValue();
          auto r = forge::genset::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("altitudeDerateFactor",   Napi::Number::New(env2, r.altitudeDerateFactor));
          out.Set("temperatureDerateFactor",Napi::Number::New(env2, r.temperatureDerateFactor));
          out.Set("demandKvaRaw",           Napi::Number::New(env2, r.demandKvaRaw));
          out.Set("requiredKvaNameplate",   Napi::Number::New(env2, r.requiredKvaNameplate));
          out.Set("fuelTankLiters",         Napi::Number::New(env2, r.fuelTankLiters));
          return out;
        });
      }));
    exports.Set("genset", gsNs);

    // Forge-320d Reverse osmosis
    auto roNs = Napi::Object::New(env);
    roNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::ro::Input in{};
          in.feedFlowLpm        = o.Get("feedFlowLpm"       ).As<Napi::Number>().DoubleValue();
          in.recoveryFraction   = o.Get("recoveryFraction"  ).As<Napi::Number>().DoubleValue();
          in.feedTdsPpm         = o.Get("feedTdsPpm"        ).As<Napi::Number>().DoubleValue();
          in.appliedPressureBar = o.Get("appliedPressureBar").As<Napi::Number>().DoubleValue();
          in.temperatureC       = o.Get("temperatureC"      ).As<Napi::Number>().DoubleValue();
          in.vantHoffFactorI    = o.Get("vantHoffFactorI"   ).As<Napi::Number>().DoubleValue();
          auto r = forge::ro::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("permeateFlowLpm",           Napi::Number::New(env2, r.permeateFlowLpm));
          out.Set("concentrateFlowLpm",        Napi::Number::New(env2, r.concentrateFlowLpm));
          out.Set("concentrationFactor",       Napi::Number::New(env2, r.concentrationFactor));
          out.Set("brineTdsPpm",               Napi::Number::New(env2, r.brineTdsPpm));
          out.Set("averageOsmoticPressureKpa", Napi::Number::New(env2, r.averageOsmoticPressureKpa));
          out.Set("netDrivingPressureKpa",     Napi::Number::New(env2, r.netDrivingPressureKpa));
          out.Set("pressureSufficient",        Napi::Boolean::New(env2, r.pressureSufficient));
          return out;
        });
      }));
    exports.Set("reverseosmosis", roNs);

    // Forge-320e Envelope U-value
    auto uvNs = Napi::Object::New(env);
    uvNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::uvalue::Input in{};
          auto layersArr = o.Get("layers").As<Napi::Array>();
          for (uint32_t i = 0; i < layersArr.Length(); ++i) {
            auto lo = layersArr.Get(i).As<Napi::Object>();
            forge::uvalue::Layer L{};
            L.thicknessMm     = lo.Get("thicknessMm"    ).As<Napi::Number>().DoubleValue();
            L.conductivityWmk = lo.Get("conductivityWmk").As<Napi::Number>().DoubleValue();
            in.layers.push_back(L);
          }
          in.interiorFilmRSI    = o.Get("interiorFilmRSI"   ).As<Napi::Number>().DoubleValue();
          in.exteriorFilmRSI    = o.Get("exteriorFilmRSI"   ).As<Napi::Number>().DoubleValue();
          in.areaM2             = o.Get("areaM2"            ).As<Napi::Number>().DoubleValue();
          in.designDeltaTKelvin = o.Get("designDeltaTKelvin").As<Napi::Number>().DoubleValue();
          auto r = forge::uvalue::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("layerSumRSI", Napi::Number::New(env2, r.layerSumRSI));
          out.Set("totalRSI",    Napi::Number::New(env2, r.totalRSI));
          out.Set("uValueWm2K",  Napi::Number::New(env2, r.uValueWm2K));
          out.Set("heatFlowW",   Napi::Number::New(env2, r.heatFlowW));
          return out;
        });
      }));
    exports.Set("envelope", uvNs);

    // -------- Forge-321 5-calc bundle -----------------------------------
    auto vtNs = Napi::Object::New(env);
    vtNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::ventilation::Input in{};
          in.occupantsP                 = o.Get("occupantsP"               ).As<Napi::Number>().DoubleValue();
          in.zoneAreaM2                 = o.Get("zoneAreaM2"               ).As<Napi::Number>().DoubleValue();
          in.R_p_LpsPerPerson           = o.Get("R_p_LpsPerPerson"         ).As<Napi::Number>().DoubleValue();
          in.R_a_LpsPerM2               = o.Get("R_a_LpsPerM2"             ).As<Napi::Number>().DoubleValue();
          in.zoneAirDistEffectivenessE_z= o.Get("zoneAirDistEffectivenessE_z").As<Napi::Number>().DoubleValue();
          auto r = forge::ventilation::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("breathingZoneFlowLps", Napi::Number::New(env2, r.breathingZoneFlowLps));
          out.Set("outdoorAirFlowLps",    Napi::Number::New(env2, r.outdoorAirFlowLps));
          out.Set("outdoorAirFlowCfm",    Napi::Number::New(env2, r.outdoorAirFlowCfm));
          out.Set("perPersonOAcfm",       Napi::Number::New(env2, r.perPersonOAcfm));
          return out;
        });
      }));
    exports.Set("ventilation", vtNs);

    auto fpNs = Napi::Object::New(env);
    fpNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::firepump::Input in{};
          in.sprinklerDemandLpm  = o.Get("sprinklerDemandLpm" ).As<Napi::Number>().DoubleValue();
          in.hoseAllowanceLpm    = o.Get("hoseAllowanceLpm"   ).As<Napi::Number>().DoubleValue();
          in.staticHeadM         = o.Get("staticHeadM"        ).As<Napi::Number>().DoubleValue();
          in.frictionLossM       = o.Get("frictionLossM"      ).As<Napi::Number>().DoubleValue();
          in.residualPressureBar = o.Get("residualPressureBar").As<Napi::Number>().DoubleValue();
          auto r = forge::firepump::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("ratedFlowLpm",                 Napi::Number::New(env2, r.ratedFlowLpm));
          out.Set("ratedHeadM",                   Napi::Number::New(env2, r.ratedHeadM));
          out.Set("ratedPressureBar",             Napi::Number::New(env2, r.ratedPressureBar));
          out.Set("pump150PercentFlowLpm",        Napi::Number::New(env2, r.pump150PercentFlowLpm));
          out.Set("pump150PercentMinPressureBar", Napi::Number::New(env2, r.pump150PercentMinPressureBar));
          return out;
        });
      }));
    exports.Set("firepump", fpNs);

    auto stNs = Napi::Object::New(env);
    stNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::septic::Input in{};
          in.occupants             = o.Get("occupants"            ).As<Napi::Number>().Int32Value();
          in.dailyFlowPerPersonL   = o.Get("dailyFlowPerPersonL"  ).As<Napi::Number>().DoubleValue();
          in.retentionDays         = o.Get("retentionDays"        ).As<Napi::Number>().DoubleValue();
          in.sludgeReserveFraction = o.Get("sludgeReserveFraction").As<Napi::Number>().DoubleValue();
          auto r = forge::septic::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("dailyInflowL",    Napi::Number::New(env2, r.dailyInflowL));
          out.Set("primaryStorageL", Napi::Number::New(env2, r.primaryStorageL));
          out.Set("sludgeReserveL",  Napi::Number::New(env2, r.sludgeReserveL));
          out.Set("totalVolumeL",    Napi::Number::New(env2, r.totalVolumeL));
          out.Set("totalVolumeM3",   Napi::Number::New(env2, r.totalVolumeM3));
          return out;
        });
      }));
    exports.Set("septic", stNs);

    auto cyNs = Napi::Object::New(env);
    cyNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::cyclone::Input in{};
          in.inletVelocityMs        = o.Get("inletVelocityMs"       ).As<Napi::Number>().DoubleValue();
          in.inletWidthM            = o.Get("inletWidthM"           ).As<Napi::Number>().DoubleValue();
          in.numberOfTurns          = o.Get("numberOfTurns"         ).As<Napi::Number>().DoubleValue();
          in.gasViscosityPaS        = o.Get("gasViscosityPaS"       ).As<Napi::Number>().DoubleValue();
          in.particleDensityKgPerM3 = o.Get("particleDensityKgPerM3").As<Napi::Number>().DoubleValue();
          in.gasDensityKgPerM3      = o.Get("gasDensityKgPerM3"     ).As<Napi::Number>().DoubleValue();
          auto r = forge::cyclone::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("cutDiameterUm", Napi::Number::New(env2, r.cutDiameterUm));
          out.Set("cutDiameterM",  Napi::Number::New(env2, r.cutDiameterM));
          return out;
        });
      }));
    exports.Set("cyclone", cyNs);

    auto stkNs = Napi::Object::New(env);
    stkNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::stackeffect::Input in{};
          in.stackHeightM    = o.Get("stackHeightM"   ).As<Napi::Number>().DoubleValue();
          in.indoorTempC     = o.Get("indoorTempC"    ).As<Napi::Number>().DoubleValue();
          in.outdoorTempC    = o.Get("outdoorTempC"   ).As<Napi::Number>().DoubleValue();
          in.atmPressureKPa  = o.Get("atmPressureKPa" ).As<Napi::Number>().DoubleValue();
          auto r = forge::stackeffect::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("indoorDensityKgPerM3",          Napi::Number::New(env2, r.indoorDensityKgPerM3));
          out.Set("outdoorDensityKgPerM3",         Napi::Number::New(env2, r.outdoorDensityKgPerM3));
          out.Set("stackPressurePa",               Napi::Number::New(env2, r.stackPressurePa));
          out.Set("stackPressurePascalAtMidHeight",Napi::Number::New(env2, r.stackPressurePascalAtMidHeight));
          out.Set("airflowDirection",              Napi::Number::New(env2, r.airflowDirection));
          return out;
        });
      }));
    exports.Set("stackeffect", stkNs);

    // -------- Forge-322 5-calc bundle -----------------------------------
    auto msNs = Napi::Object::New(env);
    msNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::masonry::Input in{};
          in.wallWidthB_mm        = o.Get("wallWidthB_mm"      ).As<Napi::Number>().DoubleValue();
          in.effectiveDepth_d_mm  = o.Get("effectiveDepth_d_mm").As<Napi::Number>().DoubleValue();
          in.steelAreaAs_mm2      = o.Get("steelAreaAs_mm2"    ).As<Napi::Number>().DoubleValue();
          in.factoredAxialPu_kN   = o.Get("factoredAxialPu_kN" ).As<Napi::Number>().DoubleValue();
          in.fm_MPa               = o.Get("fm_MPa"             ).As<Napi::Number>().DoubleValue();
          in.fy_MPa               = o.Get("fy_MPa"             ).As<Napi::Number>().DoubleValue();
          auto r = forge::masonry::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("aMm",                Napi::Number::New(env2, r.aMm));
          out.Set("Ase_mm2",            Napi::Number::New(env2, r.Ase_mm2));
          out.Set("nominalMoment_kNm",  Napi::Number::New(env2, r.nominalMoment_kNm));
          out.Set("designMoment_kNm",   Napi::Number::New(env2, r.designMoment_kNm));
          return out;
        });
      }));
    exports.Set("masonry", msNs);

    auto asNs = Napi::Object::New(env);
    asNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::asphalt::Input in{};
          in.aggregateSG         = o.Get("aggregateSG"        ).As<Napi::Number>().DoubleValue();
          in.asphaltSG           = o.Get("asphaltSG"          ).As<Napi::Number>().DoubleValue();
          in.asphaltContentPct   = o.Get("asphaltContentPct"  ).As<Napi::Number>().DoubleValue();
          in.bulkSG_Gmb          = o.Get("bulkSG_Gmb"         ).As<Napi::Number>().DoubleValue();
          auto r = forge::asphalt::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("theoreticalMaxSG",       Napi::Number::New(env2, r.theoreticalMaxSG));
          out.Set("airVoidsPct",            Napi::Number::New(env2, r.airVoidsPct));
          out.Set("vmaPct",                 Napi::Number::New(env2, r.vmaPct));
          out.Set("vfaPct",                 Napi::Number::New(env2, r.vfaPct));
          out.Set("meetsSuperpaveAirVoids", Napi::Boolean::New(env2, r.meetsSuperpaveAirVoids));
          return out;
        });
      }));
    exports.Set("asphalt", asNs);

    auto cpNs = Napi::Object::New(env);
    cpNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::cp::Input in{};
          in.protectedAreaM2            = o.Get("protectedAreaM2"           ).As<Napi::Number>().DoubleValue();
          in.currentDensityMaPerM2      = o.Get("currentDensityMaPerM2"     ).As<Napi::Number>().DoubleValue();
          in.designLifeYears            = o.Get("designLifeYears"           ).As<Napi::Number>().DoubleValue();
          in.anodeConsumptionKgPerAmpYr = o.Get("anodeConsumptionKgPerAmpYr").As<Napi::Number>().DoubleValue();
          in.anodeUtilizationFactor     = o.Get("anodeUtilizationFactor"    ).As<Napi::Number>().DoubleValue();
          auto r = forge::cp::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("totalCurrentRequiredA",      Napi::Number::New(env2, r.totalCurrentRequiredA));
          out.Set("anodeMassRequiredKg",        Napi::Number::New(env2, r.anodeMassRequiredKg));
          out.Set("currentDensityMaPerM2Echo",  Napi::Number::New(env2, r.currentDensityMaPerM2Echo));
          return out;
        });
      }));
    exports.Set("cathodic", cpNs);

    auto htNs = Napi::Object::New(env);
    htNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::heattrace::Input in{};
          in.pipeOuterDiameterMm        = o.Get("pipeOuterDiameterMm"      ).As<Napi::Number>().DoubleValue();
          in.insulationThicknessMm      = o.Get("insulationThicknessMm"    ).As<Napi::Number>().DoubleValue();
          in.insulationConductivityWmk  = o.Get("insulationConductivityWmk").As<Napi::Number>().DoubleValue();
          in.outdoorFilmCoefficientWm2K = o.Get("outdoorFilmCoefficientWm2K").As<Napi::Number>().DoubleValue();
          in.pipeTargetTempC            = o.Get("pipeTargetTempC"          ).As<Napi::Number>().DoubleValue();
          in.ambientTempC               = o.Get("ambientTempC"             ).As<Napi::Number>().DoubleValue();
          in.safetyFactor               = o.Get("safetyFactor"             ).As<Napi::Number>().DoubleValue();
          auto r = forge::heattrace::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("insulationOD_mm",       Napi::Number::New(env2, r.insulationOD_mm));
          out.Set("heatLossWPerM",         Napi::Number::New(env2, r.heatLossWPerM));
          out.Set("recommendedCableWperM", Napi::Number::New(env2, r.recommendedCableWperM));
          return out;
        });
      }));
    exports.Set("heattrace", htNs);

    auto lpNs = Napi::Object::New(env);
    lpNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::lightning::Input in{};
          in.rollingSphereRadiusM   = o.Get("rollingSphereRadiusM"  ).As<Napi::Number>().DoubleValue();
          in.mastHeightM            = o.Get("mastHeightM"           ).As<Napi::Number>().DoubleValue();
          in.protectedObjectHeightM = o.Get("protectedObjectHeightM").As<Napi::Number>().DoubleValue();
          auto r = forge::lightning::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("groundProtectedRadiusM",      Napi::Number::New(env2, r.groundProtectedRadiusM));
          out.Set("objectProtectedRadiusM",      Napi::Number::New(env2, r.objectProtectedRadiusM));
          out.Set("maximumProtectionConeRatio",  Napi::Number::New(env2, r.maximumProtectionConeRatio));
          return out;
        });
      }));
    exports.Set("lightning", lpNs);

    // -------- Forge-323 5-calc bundle -----------------------------------
    auto smarginNs = Napi::Object::New(env);
    smarginNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::staticmargin::Input in{};
          in.xCG_normalized          = o.Get("xCG_normalized"         ).As<Napi::Number>().DoubleValue();
          in.xACwing_normalized      = o.Get("xACwing_normalized"     ).As<Napi::Number>().DoubleValue();
          in.tailVolumeCoefficient   = o.Get("tailVolumeCoefficient"  ).As<Napi::Number>().DoubleValue();
          in.tailToWingCLalphaRatio  = o.Get("tailToWingCLalphaRatio" ).As<Napi::Number>().DoubleValue();
          in.downwashGradient        = o.Get("downwashGradient"       ).As<Napi::Number>().DoubleValue();
          auto r = forge::staticmargin::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("xNP_normalized",         Napi::Number::New(env2, r.xNP_normalized));
          out.Set("staticMargin",           Napi::Number::New(env2, r.staticMargin));
          out.Set("stable",                 Napi::Boolean::New(env2, r.stable));
          out.Set("meetsTypicalDesignTarget", Napi::Boolean::New(env2, r.meetsTypicalDesignTarget));
          return out;
        });
      }));
    exports.Set("staticmargin", smarginNs);

    auto rpNs = Napi::Object::New(env);
    rpNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::refpipe::Input in{};
          in.coolingDutyKw         = o.Get("coolingDutyKw"        ).As<Napi::Number>().DoubleValue();
          in.enthalpyChangeKJpkg   = o.Get("enthalpyChangeKJpkg"  ).As<Napi::Number>().DoubleValue();
          in.specificVolumeM3pkg   = o.Get("specificVolumeM3pkg"  ).As<Napi::Number>().DoubleValue();
          in.velocityLimitMs       = o.Get("velocityLimitMs"      ).As<Napi::Number>().DoubleValue();
          auto r = forge::refpipe::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("massFlowKgPerS",     Napi::Number::New(env2, r.massFlowKgPerS));
          out.Set("volumeFlowM3PerS",   Napi::Number::New(env2, r.volumeFlowM3PerS));
          out.Set("requiredAreaMm2",    Napi::Number::New(env2, r.requiredAreaMm2));
          out.Set("requiredDiameterMm", Napi::Number::New(env2, r.requiredDiameterMm));
          return out;
        });
      }));
    exports.Set("refpipe", rpNs);

    auto bbNs = Napi::Object::New(env);
    bbNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::busbar::Input in{};
          in.shortCircuitCurrentKaRms = o.Get("shortCircuitCurrentKaRms").As<Napi::Number>().DoubleValue();
          in.asymmetryFactorKappa     = o.Get("asymmetryFactorKappa"    ).As<Napi::Number>().DoubleValue();
          in.conductorSpacingMm       = o.Get("conductorSpacingMm"      ).As<Napi::Number>().DoubleValue();
          in.spanLengthM              = o.Get("spanLengthM"             ).As<Napi::Number>().DoubleValue();
          auto r = forge::busbar::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("peakCurrentKa",      Napi::Number::New(env2, r.peakCurrentKa));
          out.Set("forcePerLengthNm",   Napi::Number::New(env2, r.forcePerLengthNm));
          out.Set("totalForcePerSpanN", Napi::Number::New(env2, r.totalForcePerSpanN));
          out.Set("maxBendingMomentNm", Napi::Number::New(env2, r.maxBendingMomentNm));
          return out;
        });
      }));
    exports.Set("busbar", bbNs);

    auto dlNs = Napi::Object::New(env);
    dlNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::ductleak::Input in{};
          in.ductSurfaceAreaM2     = o.Get("ductSurfaceAreaM2"    ).As<Napi::Number>().DoubleValue();
          in.testPressureInchWC    = o.Get("testPressureInchWC"   ).As<Napi::Number>().DoubleValue();
          in.leakageClassCL        = o.Get("leakageClassCL"       ).As<Napi::Number>().DoubleValue();
          auto r = forge::ductleak::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("leakageRateCfmPer100ft2", Napi::Number::New(env2, r.leakageRateCfmPer100ft2));
          out.Set("leakageRateLPerSperM2",   Napi::Number::New(env2, r.leakageRateLPerSperM2));
          out.Set("totalLeakageLPerS",       Napi::Number::New(env2, r.totalLeakageLPerS));
          out.Set("totalLeakageCfm",         Napi::Number::New(env2, r.totalLeakageCfm));
          return out;
        });
      }));
    exports.Set("ductleakage", dlNs);

    auto dvNs = Napi::Object::New(env);
    dvNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::dustvent::Input in{};
          in.vesselVolumeM3              = o.Get("vesselVolumeM3"             ).As<Napi::Number>().DoubleValue();
          in.kstBarMperS                 = o.Get("kstBarMperS"                ).As<Napi::Number>().DoubleValue();
          in.maxAllowableOverpressureBar = o.Get("maxAllowableOverpressureBar").As<Napi::Number>().DoubleValue();
          in.ventReleasePressureBar      = o.Get("ventReleasePressureBar"     ).As<Napi::Number>().DoubleValue();
          auto r = forge::dustvent::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("ventAreaM2",        Napi::Number::New(env2, r.ventAreaM2));
          out.Set("pressureMarginBar", Napi::Number::New(env2, r.pressureMarginBar));
          return out;
        });
      }));
    exports.Set("dustvent", dvNs);

    // -------- Forge-324 5-calc bundle -----------------------------------
    auto iplvNs = Napi::Object::New(env);
    iplvNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::iplv::Input in{};
          in.cop100 = o.Get("cop100").As<Napi::Number>().DoubleValue();
          in.cop75  = o.Get("cop75" ).As<Napi::Number>().DoubleValue();
          in.cop50  = o.Get("cop50" ).As<Napi::Number>().DoubleValue();
          in.cop25  = o.Get("cop25" ).As<Napi::Number>().DoubleValue();
          auto r = forge::iplv::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("iplv",          Napi::Number::New(env2, r.iplv));
          out.Set("iplv_kWperTon", Napi::Number::New(env2, r.iplv_kWperTon));
          return out;
        });
      }));
    exports.Set("iplv", iplvNs);

    auto sndrNs = Napi::Object::New(env);
    sndrNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::snowdrift::Input in{};
          in.groundSnowLoad_kNm2  = o.Get("groundSnowLoad_kNm2").As<Napi::Number>().DoubleValue();
          in.upwindFetchLength_m  = o.Get("upwindFetchLength_m").As<Napi::Number>().DoubleValue();
          in.leewardDrift         = o.Get("leewardDrift"       ).As<Napi::Boolean>().Value();
          auto r = forge::snowdrift::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("snowUnitWeight_kNm3", Napi::Number::New(env2, r.snowUnitWeight_kNm3));
          out.Set("driftHeight_m",       Napi::Number::New(env2, r.driftHeight_m));
          out.Set("driftPressure_kNm2",  Napi::Number::New(env2, r.driftPressure_kNm2));
          return out;
        });
      }));
    exports.Set("snowdrift", sndrNs);

    auto solwNs = Napi::Object::New(env);
    solwNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::slaboneway::Input in{};
          in.spanLength_m         = o.Get("spanLength_m"        ).As<Napi::Number>().DoubleValue();
          in.slabThickness_mm     = o.Get("slabThickness_mm"    ).As<Napi::Number>().DoubleValue();
          in.effectiveDepth_d_mm  = o.Get("effectiveDepth_d_mm" ).As<Napi::Number>().DoubleValue();
          in.areaSteelMm2PerM     = o.Get("areaSteelMm2PerM"    ).As<Napi::Number>().DoubleValue();
          in.fc_MPa               = o.Get("fc_MPa"              ).As<Napi::Number>().DoubleValue();
          in.fy_MPa               = o.Get("fy_MPa"              ).As<Napi::Number>().DoubleValue();
          in.supportCondition     = o.Get("supportCondition"    ).As<Napi::String>().Utf8Value();
          auto r = forge::slaboneway::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("minimumThicknessMm",   Napi::Number::New(env2, r.minimumThicknessMm));
          out.Set("a_mm",                 Napi::Number::New(env2, r.a_mm));
          out.Set("nominalMoment_kNmPerM",Napi::Number::New(env2, r.nominalMoment_kNmPerM));
          out.Set("designMoment_kNmPerM", Napi::Number::New(env2, r.designMoment_kNmPerM));
          out.Set("thicknessAdequate",    Napi::Boolean::New(env2, r.thicknessAdequate));
          return out;
        });
      }));
    exports.Set("slaboneway", solwNs);

    auto crNs = Napi::Object::New(env);
    crNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::cranerunway::Input in{};
          in.maxWheelLoadKn  = o.Get("maxWheelLoadKn" ).As<Napi::Number>().DoubleValue();
          in.spanLengthM     = o.Get("spanLengthM"    ).As<Napi::Number>().DoubleValue();
          in.impactFactor    = o.Get("impactFactor"   ).As<Napi::Number>().DoubleValue();
          in.lateralFraction = o.Get("lateralFraction").As<Napi::Number>().DoubleValue();
          auto r = forge::cranerunway::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("wheelLoadWithImpactKn",  Napi::Number::New(env2, r.wheelLoadWithImpactKn));
          out.Set("lateralLoadKn",          Napi::Number::New(env2, r.lateralLoadKn));
          out.Set("verticalMomentKnm",      Napi::Number::New(env2, r.verticalMomentKnm));
          out.Set("lateralMomentKnm",       Napi::Number::New(env2, r.lateralMomentKnm));
          out.Set("combinedDesignMomentKnm",Napi::Number::New(env2, r.combinedDesignMomentKnm));
          return out;
        });
      }));
    exports.Set("cranerunway", crNs);

    auto cmuNs = Napi::Object::New(env);
    cmuNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::cmucomp::Input in{};
          in.netAreaMm2          = o.Get("netAreaMm2"         ).As<Napi::Number>().DoubleValue();
          in.radiusOfGyrationMm  = o.Get("radiusOfGyrationMm" ).As<Napi::Number>().DoubleValue();
          in.effectiveHeightMm   = o.Get("effectiveHeightMm"  ).As<Napi::Number>().DoubleValue();
          in.fm_MPa              = o.Get("fm_MPa"             ).As<Napi::Number>().DoubleValue();
          auto r = forge::cmucomp::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("slendernessRatio_h_r", Napi::Number::New(env2, r.slendernessRatio_h_r));
          out.Set("nominalCapacityKn",    Napi::Number::New(env2, r.nominalCapacityKn));
          out.Set("designCapacityKn",     Napi::Number::New(env2, r.designCapacityKn));
          out.Set("slenderRegime",        Napi::Boolean::New(env2, r.slenderRegime));
          return out;
        });
      }));
    exports.Set("cmucomp", cmuNs);

    // -------- Forge-325 5-calc bundle -----------------------------------
    auto prvNs = Napi::Object::New(env);
    prvNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::prv::Input in{};
          in.mode                = o.Get("mode"               ).As<Napi::String>().Utf8Value();
          in.inletPressureKpaAbs = o.Get("inletPressureKpaAbs").As<Napi::Number>().DoubleValue();
          in.dischargeCoeffKd    = o.Get("dischargeCoeffKd"   ).As<Napi::Number>().DoubleValue();
          in.massFlowKgPerH      = o.Get("massFlowKgPerH"     ).As<Napi::Number>().DoubleValue();
          in.inletTempK          = o.Get("inletTempK"         ).As<Napi::Number>().DoubleValue();
          in.molecularWeight     = o.Get("molecularWeight"    ).As<Napi::Number>().DoubleValue();
          in.kRatio              = o.Get("kRatio"             ).As<Napi::Number>().DoubleValue();
          in.volumeFlowLpm       = o.Get("volumeFlowLpm"      ).As<Napi::Number>().DoubleValue();
          in.backPressureKpaAbs  = o.Get("backPressureKpaAbs" ).As<Napi::Number>().DoubleValue();
          in.specificGravity     = o.Get("specificGravity"    ).As<Napi::Number>().DoubleValue();
          auto r = forge::prv::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("gasCoefficientC",         Napi::Number::New(env2, r.gasCoefficientC));
          out.Set("requiredOrificeAreaMm2",  Napi::Number::New(env2, r.requiredOrificeAreaMm2));
          out.Set("standardLetterOrificeMm2",Napi::Number::New(env2, r.standardLetterOrificeMm2));
          out.Set("nextStandardOrifice",     Napi::String::New(env2, r.nextStandardOrifice));
          return out;
        });
      }));
    exports.Set("prv", prvNs);

    auto extNs = Napi::Object::New(env);
    extNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::extank::Input in{};
          in.systemVolumeLiters = o.Get("systemVolumeLiters").As<Napi::Number>().DoubleValue();
          in.minTempC           = o.Get("minTempC"          ).As<Napi::Number>().DoubleValue();
          in.maxTempC           = o.Get("maxTempC"          ).As<Napi::Number>().DoubleValue();
          in.minPressureBarAbs  = o.Get("minPressureBarAbs" ).As<Napi::Number>().DoubleValue();
          in.maxPressureBarAbs  = o.Get("maxPressureBarAbs" ).As<Napi::Number>().DoubleValue();
          auto r = forge::extank::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("densityMinKgPerM3",     Napi::Number::New(env2, r.densityMinKgPerM3));
          out.Set("densityMaxKgPerM3",     Napi::Number::New(env2, r.densityMaxKgPerM3));
          out.Set("expansionFraction",     Napi::Number::New(env2, r.expansionFraction));
          out.Set("expansionVolumeLiters", Napi::Number::New(env2, r.expansionVolumeLiters));
          out.Set("pressureFactor",        Napi::Number::New(env2, r.pressureFactor));
          out.Set("tankVolumeLiters",      Napi::Number::New(env2, r.tankVolumeLiters));
          return out;
        });
      }));
    exports.Set("expansiontank", extNs);

    auto pbNs = Napi::Object::New(env);
    pbNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::platebuck::Input in{};
          in.elementType = o.Get("elementType").As<Napi::String>().Utf8Value();
          in.widthMm     = o.Get("widthMm"    ).As<Napi::Number>().DoubleValue();
          in.thicknessMm = o.Get("thicknessMm").As<Napi::Number>().DoubleValue();
          in.Fy_MPa      = o.Get("Fy_MPa"     ).As<Napi::Number>().DoubleValue();
          in.E_MPa       = o.Get("E_MPa"      ).As<Napi::Number>().DoubleValue();
          auto r = forge::platebuck::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("slenderness",    Napi::Number::New(env2, r.slenderness));
          out.Set("lambdaR",        Napi::Number::New(env2, r.lambdaR));
          out.Set("classification", Napi::String::New(env2, r.classification));
          out.Set("Qs",             Napi::Number::New(env2, r.Qs));
          return out;
        });
      }));
    exports.Set("platebuck", pbNs);

    auto a62rNs = Napi::Object::New(env);
    a62rNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::ashrae62r::Input in{};
          in.conditionedFloorAreaM2 = o.Get("conditionedFloorAreaM2").As<Napi::Number>().DoubleValue();
          in.bedroomCount           = o.Get("bedroomCount"          ).As<Napi::Number>().Int32Value();
          in.infiltrationCreditCfm  = o.Get("infiltrationCreditCfm" ).As<Napi::Number>().DoubleValue();
          auto r = forge::ashrae62r::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("requiredVentilationCfm", Napi::Number::New(env2, r.requiredVentilationCfm));
          out.Set("netVentilationCfm",      Napi::Number::New(env2, r.netVentilationCfm));
          out.Set("netVentilationLps",      Napi::Number::New(env2, r.netVentilationLps));
          out.Set("complies",               Napi::Boolean::New(env2, r.complies));
          return out;
        });
      }));
    exports.Set("ashrae62r", a62rNs);

    auto weNs = Napi::Object::New(env);
    weNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::weldelec::Input in{};
          in.weldType           = o.Get("weldType"          ).As<Napi::String>().Utf8Value();
          in.sizeMm             = o.Get("sizeMm"            ).As<Napi::Number>().DoubleValue();
          in.weldLengthM        = o.Get("weldLengthM"       ).As<Napi::Number>().DoubleValue();
          in.processEfficiency  = o.Get("processEfficiency" ).As<Napi::Number>().DoubleValue();
          in.electrodeCostPerKg = o.Get("electrodeCostPerKg").As<Napi::Number>().DoubleValue();
          in.bevelAngleDeg      = o.Get("bevelAngleDeg"     ).As<Napi::Number>().DoubleValue();
          in.rootGapMm          = o.Get("rootGapMm"         ).As<Napi::Number>().DoubleValue();
          auto r = forge::weldelec::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("weldAreaMm2",     Napi::Number::New(env2, r.weldAreaMm2));
          out.Set("weldVolumeM3",    Napi::Number::New(env2, r.weldVolumeM3));
          out.Set("depositMassKg",   Napi::Number::New(env2, r.depositMassKg));
          out.Set("electrodeMassKg", Napi::Number::New(env2, r.electrodeMassKg));
          out.Set("electrodeCost",   Napi::Number::New(env2, r.electrodeCost));
          return out;
        });
      }));
    exports.Set("weldelectrode", weNs);

    // -------- Forge-326 5-calc bundle -----------------------------------
    auto covNs = Napi::Object::New(env);
    covNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::cover::Input in{};
          in.exposureCondition = o.Get("exposureCondition").As<Napi::String>().Utf8Value();
          in.barSize           = o.Get("barSize"          ).As<Napi::String>().Utf8Value();
          auto r = forge::cover::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("minimumCoverMm",     Napi::Number::New(env2, r.minimumCoverMm));
          out.Set("exteriorFireRated",  Napi::Boolean::New(env2, r.exteriorFireRated));
          return out;
        });
      }));
    exports.Set("cover", covNs);

    auto mseNs = Napi::Object::New(env);
    mseNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::mse::Input in{};
          in.wallHeightH_m              = o.Get("wallHeightH_m"             ).As<Napi::Number>().DoubleValue();
          in.soilFrictionAngleDeg       = o.Get("soilFrictionAngleDeg"      ).As<Napi::Number>().DoubleValue();
          in.foundationFrictionAngleDeg = o.Get("foundationFrictionAngleDeg").As<Napi::Number>().DoubleValue();
          in.soilUnitWeightKnM3         = o.Get("soilUnitWeightKnM3"        ).As<Napi::Number>().DoubleValue();
          in.reinforcementLengthM       = o.Get("reinforcementLengthM"      ).As<Napi::Number>().DoubleValue();
          in.surchargeKnM2              = o.Get("surchargeKnM2"             ).As<Napi::Number>().DoubleValue();
          auto r = forge::mse::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("K_active",                      Napi::Number::New(env2, r.K_active));
          out.Set("drivingForceKnPerM",            Napi::Number::New(env2, r.drivingForceKnPerM));
          out.Set("effectiveReinforcementLengthM", Napi::Number::New(env2, r.effectiveReinforcementLengthM));
          out.Set("resistingForceKnPerM",          Napi::Number::New(env2, r.resistingForceKnPerM));
          out.Set("slidingFOS",                    Napi::Number::New(env2, r.slidingFOS));
          out.Set("meetsFOS",                      Napi::Boolean::New(env2, r.meetsFOS));
          return out;
        });
      }));
    exports.Set("mse", mseNs);

    auto hntNs = Napi::Object::New(env);
    hntNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::hunter::Input in{};
          in.totalFixtureUnits = o.Get("totalFixtureUnits").As<Napi::Number>().DoubleValue();
          in.flushValveMix     = o.Get("flushValveMix"    ).As<Napi::Boolean>().Value();
          auto r = forge::hunter::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("designFlowGpm", Napi::Number::New(env2, r.designFlowGpm));
          out.Set("designFlowLps", Napi::Number::New(env2, r.designFlowLps));
          return out;
        });
      }));
    exports.Set("hunter", hntNs);

    auto solcolNs = Napi::Object::New(env);
    solcolNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::solarcoll::Input in{};
          in.collectorAreaM2                 = o.Get("collectorAreaM2"               ).As<Napi::Number>().DoubleValue();
          in.opticalEfficiency_F_R_tau_alpha = o.Get("opticalEfficiency_F_R_tau_alpha").As<Napi::Number>().DoubleValue();
          in.overallLossCoeff_U_L            = o.Get("overallLossCoeff_U_L"          ).As<Napi::Number>().DoubleValue();
          in.F_R                             = o.Get("F_R"                           ).As<Napi::Number>().DoubleValue();
          in.globalIrradianceWm2             = o.Get("globalIrradianceWm2"           ).As<Napi::Number>().DoubleValue();
          in.inletTempC                      = o.Get("inletTempC"                    ).As<Napi::Number>().DoubleValue();
          in.ambientTempC                    = o.Get("ambientTempC"                  ).As<Napi::Number>().DoubleValue();
          auto r = forge::solarcoll::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("usefulHeatGainW",         Napi::Number::New(env2, r.usefulHeatGainW));
          out.Set("instantaneousEfficiency", Napi::Number::New(env2, r.instantaneousEfficiency));
          out.Set("reducedTemperature",      Napi::Number::New(env2, r.reducedTemperature));
          return out;
        });
      }));
    exports.Set("solarcollector", solcolNs);

    auto chmNs = Napi::Object::New(env);
    chmNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::chimney::Input in{};
          in.stackHeightM       = o.Get("stackHeightM"      ).As<Napi::Number>().DoubleValue();
          in.flueDiameterM      = o.Get("flueDiameterM"     ).As<Napi::Number>().DoubleValue();
          in.flueGasTempC       = o.Get("flueGasTempC"      ).As<Napi::Number>().DoubleValue();
          in.ambientTempC       = o.Get("ambientTempC"      ).As<Napi::Number>().DoubleValue();
          in.flueMassFlowKgPerS = o.Get("flueMassFlowKgPerS").As<Napi::Number>().DoubleValue();
          in.atmPressureKPa     = o.Get("atmPressureKPa"    ).As<Napi::Number>().DoubleValue();
          auto r = forge::chimney::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("rhoAmbient",        Napi::Number::New(env2, r.rhoAmbient));
          out.Set("rhoFlue",           Napi::Number::New(env2, r.rhoFlue));
          out.Set("availableDraftPa",  Napi::Number::New(env2, r.availableDraftPa));
          out.Set("flueVelocityMs",    Napi::Number::New(env2, r.flueVelocityMs));
          out.Set("frictionLossPa",    Napi::Number::New(env2, r.frictionLossPa));
          out.Set("netDraftPa",        Napi::Number::New(env2, r.netDraftPa));
          out.Set("draftAdequate",     Napi::Boolean::New(env2, r.draftAdequate));
          return out;
        });
      }));
    exports.Set("chimney", chmNs);

    // -------- Forge-327 5-calc bundle -----------------------------------
    auto mohrNs = Napi::Object::New(env);
    mohrNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::mc::Input in{};
          in.cohesionKpa       = o.Get("cohesionKpa"      ).As<Napi::Number>().DoubleValue();
          in.frictionAngleDeg  = o.Get("frictionAngleDeg" ).As<Napi::Number>().DoubleValue();
          in.normalStressKpa   = o.Get("normalStressKpa"  ).As<Napi::Number>().DoubleValue();
          auto r = forge::mc::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("cohesionContributionKpa", Napi::Number::New(env2, r.cohesionContributionKpa));
          out.Set("frictionContributionKpa", Napi::Number::New(env2, r.frictionContributionKpa));
          out.Set("shearStrengthKpa",        Napi::Number::New(env2, r.shearStrengthKpa));
          return out;
        });
      }));
    exports.Set("mohrcoulomb", mohrNs);

    auto stairNs = Napi::Object::New(env);
    stairNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::stair::Input in{};
          in.floorToFloorHeightMm = o.Get("floorToFloorHeightMm").As<Napi::Number>().DoubleValue();
          in.maxRiserMm           = o.Get("maxRiserMm"          ).As<Napi::Number>().DoubleValue();
          in.minTreadMm           = o.Get("minTreadMm"          ).As<Napi::Number>().DoubleValue();
          auto r = forge::stair::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("numberOfRisers",   Napi::Number::New(env2, r.numberOfRisers));
          out.Set("numberOfTreads",   Napi::Number::New(env2, r.numberOfTreads));
          out.Set("actualRiserMm",    Napi::Number::New(env2, r.actualRiserMm));
          out.Set("totalRunMm",       Napi::Number::New(env2, r.totalRunMm));
          out.Set("pitchAngleDeg",    Napi::Number::New(env2, r.pitchAngleDeg));
          out.Set("riserPlusTreadMm", Napi::Number::New(env2, r.riserPlusTreadMm));
          out.Set("riserCompliant",   Napi::Boolean::New(env2, r.riserCompliant));
          out.Set("treadCompliant",   Napi::Boolean::New(env2, r.treadCompliant));
          out.Set("blondelCompliant", Napi::Boolean::New(env2, r.blondelCompliant));
          out.Set("overallCompliant", Napi::Boolean::New(env2, r.overallCompliant));
          return out;
        });
      }));
    exports.Set("stair", stairNs);

    auto snowpvNs = Napi::Object::New(env);
    snowpvNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::snowpv::Input in{};
          in.groundSnowKnM2 = o.Get("groundSnowKnM2").As<Napi::Number>().DoubleValue();
          in.slopeAngleDeg  = o.Get("slopeAngleDeg" ).As<Napi::Number>().DoubleValue();
          in.thermalC_t     = o.Get("thermalC_t"    ).As<Napi::Number>().DoubleValue();
          in.exposureC_e    = o.Get("exposureC_e"   ).As<Napi::Number>().DoubleValue();
          in.importanceI_s  = o.Get("importanceI_s" ).As<Napi::Number>().DoubleValue();
          auto r = forge::snowpv::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("slopeCoefficient_C_s",  Napi::Number::New(env2, r.slopeCoefficient_C_s));
          out.Set("flatRoofSnowKnM2",      Napi::Number::New(env2, r.flatRoofSnowKnM2));
          out.Set("slopedRoofSnowKnM2",    Napi::Number::New(env2, r.slopedRoofSnowKnM2));
          out.Set("meetsMinimum",          Napi::Boolean::New(env2, r.meetsMinimum));
          return out;
        });
      }));
    exports.Set("snowpv", snowpvNs);

    auto nrcNs = Napi::Object::New(env);
    nrcNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::nrc::Input in{};
          in.alpha250  = o.Get("alpha250" ).As<Napi::Number>().DoubleValue();
          in.alpha500  = o.Get("alpha500" ).As<Napi::Number>().DoubleValue();
          in.alpha1000 = o.Get("alpha1000").As<Napi::Number>().DoubleValue();
          in.alpha2000 = o.Get("alpha2000").As<Napi::Number>().DoubleValue();
          auto r = forge::nrc::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("nrcRaw",              Napi::Number::New(env2, r.nrcRaw));
          out.Set("nrcRounded",          Napi::Number::New(env2, r.nrcRounded));
          out.Set("meetsAbsorbentClass", Napi::Boolean::New(env2, r.meetsAbsorbentClass));
          return out;
        });
      }));
    exports.Set("nrc", nrcNs);

    auto acompNs = Napi::Object::New(env);
    acompNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::adicomp::Input in{};
          in.inletTempC               = o.Get("inletTempC"              ).As<Napi::Number>().DoubleValue();
          in.inletPressureKpaAbs      = o.Get("inletPressureKpaAbs"     ).As<Napi::Number>().DoubleValue();
          in.dischargePressureKpaAbs  = o.Get("dischargePressureKpaAbs" ).As<Napi::Number>().DoubleValue();
          in.kRatio                   = o.Get("kRatio"                  ).As<Napi::Number>().DoubleValue();
          in.isentropicEfficiency     = o.Get("isentropicEfficiency"    ).As<Napi::Number>().DoubleValue();
          in.molecularWeight          = o.Get("molecularWeight"         ).As<Napi::Number>().DoubleValue();
          auto r = forge::adicomp::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("pressureRatio",            Napi::Number::New(env2, r.pressureRatio));
          out.Set("isentropicDischargeTempC", Napi::Number::New(env2, r.isentropicDischargeTempC));
          out.Set("actualDischargeTempC",     Napi::Number::New(env2, r.actualDischargeTempC));
          out.Set("specificHeatCpKJpkgK",     Napi::Number::New(env2, r.specificHeatCpKJpkgK));
          out.Set("specificWorkKJpkg",        Napi::Number::New(env2, r.specificWorkKJpkg));
          return out;
        });
      }));
    exports.Set("adiabatic", acompNs);

    // -------- Forge-328 5-calc bundle -----------------------------------
    auto mulNs = Napi::Object::New(env);
    mulNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::mullion::Input in{};
          in.spanLengthMm           = o.Get("spanLengthMm"          ).As<Napi::Number>().DoubleValue();
          in.windPressureKnM2       = o.Get("windPressureKnM2"      ).As<Napi::Number>().DoubleValue();
          in.tributaryWidthMm       = o.Get("tributaryWidthMm"      ).As<Napi::Number>().DoubleValue();
          in.E_MPa                  = o.Get("E_MPa"                 ).As<Napi::Number>().DoubleValue();
          in.momentOfInertiaMm4     = o.Get("momentOfInertiaMm4"    ).As<Napi::Number>().DoubleValue();
          in.deflectionLimitDivisor = o.Get("deflectionLimitDivisor").As<Napi::Number>().DoubleValue();
          auto r = forge::mullion::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("linearLoadKnPerM",       Napi::Number::New(env2, r.linearLoadKnPerM));
          out.Set("midspanDeflectionMm",    Napi::Number::New(env2, r.midspanDeflectionMm));
          out.Set("deflectionLimitMm",      Napi::Number::New(env2, r.deflectionLimitMm));
          out.Set("passes",                 Napi::Boolean::New(env2, r.passes));
          return out;
        });
      }));
    exports.Set("mullion", mulNs);

    auto sprkNs = Napi::Object::New(env);
    sprkNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::sprinkler::Input in{};
          in.kFactorUSorMetric     = o.Get("kFactorUSorMetric"    ).As<Napi::Number>().DoubleValue();
          in.metricInputs          = o.Get("metricInputs"         ).As<Napi::Boolean>().Value();
          in.pressurePsi_or_bar    = o.Get("pressurePsi_or_bar"   ).As<Napi::Number>().DoubleValue();
          in.designDensityMmPerMin = o.Get("designDensityMmPerMin").As<Napi::Number>().DoubleValue();
          in.operationAreaM2       = o.Get("operationAreaM2"      ).As<Napi::Number>().DoubleValue();
          auto r = forge::sprinkler::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("sprinklerFlowLpm",    Napi::Number::New(env2, r.sprinklerFlowLpm));
          out.Set("sprinklerFlowGpm",    Napi::Number::New(env2, r.sprinklerFlowGpm));
          out.Set("requiredAreaFlowLpm", Napi::Number::New(env2, r.requiredAreaFlowLpm));
          out.Set("sprinklerOK",         Napi::Boolean::New(env2, r.sprinklerOK));
          return out;
        });
      }));
    exports.Set("sprinkler", sprkNs);

    auto spropNs = Napi::Object::New(env);
    spropNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::soundprop::Input in{};
          in.soundPowerLevelDbW = o.Get("soundPowerLevelDbW").As<Napi::Number>().DoubleValue();
          in.distanceM          = o.Get("distanceM"         ).As<Napi::Number>().DoubleValue();
          in.directivityQ       = o.Get("directivityQ"      ).As<Napi::Number>().DoubleValue();
          auto r = forge::soundprop::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("soundPressureLevelDbA", Napi::Number::New(env2, r.soundPressureLevelDbA));
          out.Set("inverseSquareLossDb",   Napi::Number::New(env2, r.inverseSquareLossDb));
          return out;
        });
      }));
    exports.Set("soundprop", spropNs);

    auto isaNs = Napi::Object::New(env);
    isaNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::isa::Input in{};
          in.altitudeM = o.Get("altitudeM").As<Napi::Number>().DoubleValue();
          auto r = forge::isa::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("temperatureK",   Napi::Number::New(env2, r.temperatureK));
          out.Set("temperatureC",   Napi::Number::New(env2, r.temperatureC));
          out.Set("pressureKpa",    Napi::Number::New(env2, r.pressureKpa));
          out.Set("densityKgM3",    Napi::Number::New(env2, r.densityKgM3));
          out.Set("speedOfSoundMs", Napi::Number::New(env2, r.speedOfSoundMs));
          return out;
        });
      }));
    exports.Set("isa", isaNs);

    auto lpdNs = Napi::Object::New(env);
    lpdNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::lpd::Input in{};
          in.spaceType        = o.Get("spaceType"       ).As<Napi::String>().Utf8Value();
          in.floorAreaM2      = o.Get("floorAreaM2"     ).As<Napi::Number>().DoubleValue();
          in.installedPowerW  = o.Get("installedPowerW" ).As<Napi::Number>().DoubleValue();
          auto r = forge::lpd::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("allowanceWperM2",  Napi::Number::New(env2, r.allowanceWperM2));
          out.Set("allowedPowerW",    Napi::Number::New(env2, r.allowedPowerW));
          out.Set("overshootW",       Napi::Number::New(env2, r.overshootW));
          out.Set("overshootPercent", Napi::Number::New(env2, r.overshootPercent));
          out.Set("compliant",        Napi::Boolean::New(env2, r.compliant));
          return out;
        });
      }));
    exports.Set("lpd", lpdNs);

    // -------- Forge-329 5-calc bundle -----------------------------------
    auto geoNs = Napi::Object::New(env);
    geoNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::geothermal::Input in{};
          in.coolingLoadKw          = o.Get("coolingLoadKw"         ).As<Napi::Number>().DoubleValue();
          in.soilConductivityWmk    = o.Get("soilConductivityWmk"   ).As<Napi::Number>().DoubleValue();
          in.boreRadiusM            = o.Get("boreRadiusM"           ).As<Napi::Number>().DoubleValue();
          in.pipeOuterDiameterMm    = o.Get("pipeOuterDiameterMm"   ).As<Napi::Number>().DoubleValue();
          in.pipeConductivityWmk    = o.Get("pipeConductivityWmk"   ).As<Napi::Number>().DoubleValue();
          in.groutConductivityWmk   = o.Get("groutConductivityWmk"  ).As<Napi::Number>().DoubleValue();
          in.designTempDiffK        = o.Get("designTempDiffK"       ).As<Napi::Number>().DoubleValue();
          auto r = forge::geothermal::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("pipeResistanceMpwK",   Napi::Number::New(env2, r.pipeResistanceMpwK));
          out.Set("groutResistanceMpwK",  Napi::Number::New(env2, r.groutResistanceMpwK));
          out.Set("soilResistanceMpwK",   Napi::Number::New(env2, r.soilResistanceMpwK));
          out.Set("totalResistanceMpwK",  Napi::Number::New(env2, r.totalResistanceMpwK));
          out.Set("requiredBoreLengthM",  Napi::Number::New(env2, r.requiredBoreLengthM));
          out.Set("mPerTon",              Napi::Number::New(env2, r.mPerTon));
          return out;
        });
      }));
    exports.Set("geothermal", geoNs);

    auto tenNs = Napi::Object::New(env);
    tenNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::tension::Input in{};
          in.grossArea_mm2         = o.Get("grossArea_mm2"        ).As<Napi::Number>().DoubleValue();
          in.netArea_mm2           = o.Get("netArea_mm2"          ).As<Napi::Number>().DoubleValue();
          in.xBar_mm               = o.Get("xBar_mm"              ).As<Napi::Number>().DoubleValue();
          in.connectionLength_mm   = o.Get("connectionLength_mm"  ).As<Napi::Number>().DoubleValue();
          in.Fy_MPa                = o.Get("Fy_MPa"               ).As<Napi::Number>().DoubleValue();
          in.Fu_MPa                = o.Get("Fu_MPa"               ).As<Napi::Number>().DoubleValue();
          auto r = forge::tension::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("shearLag_U",         Napi::Number::New(env2, r.shearLag_U));
          out.Set("effectiveArea_mm2",  Napi::Number::New(env2, r.effectiveArea_mm2));
          out.Set("yieldCapacity_kN",   Napi::Number::New(env2, r.yieldCapacity_kN));
          out.Set("ruptureCapacity_kN", Napi::Number::New(env2, r.ruptureCapacity_kN));
          out.Set("designCapacity_kN",  Napi::Number::New(env2, r.designCapacity_kN));
          return out;
        });
      }));
    exports.Set("tension", tenNs);

    auto btNs = Napi::Object::New(env);
    btNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::boltedtimber::Input in{};
          in.boltDiameterMm         = o.Get("boltDiameterMm"        ).As<Napi::Number>().DoubleValue();
          in.mainMemberThicknessMm  = o.Get("mainMemberThicknessMm" ).As<Napi::Number>().DoubleValue();
          in.sideMemberThicknessMm  = o.Get("sideMemberThicknessMm" ).As<Napi::Number>().DoubleValue();
          in.mainEmbedmentMPa       = o.Get("mainEmbedmentMPa"      ).As<Napi::Number>().DoubleValue();
          in.sideEmbedmentMPa       = o.Get("sideEmbedmentMPa"      ).As<Napi::Number>().DoubleValue();
          in.loadDurationFactor     = o.Get("loadDurationFactor"    ).As<Napi::Number>().DoubleValue();
          auto r = forge::boltedtimber::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("Z_mainMode_kN", Napi::Number::New(env2, r.Z_mainMode_kN));
          out.Set("Z_sideMode_kN", Napi::Number::New(env2, r.Z_sideMode_kN));
          out.Set("governingZ_kN", Napi::Number::New(env2, r.governingZ_kN));
          out.Set("adjustedZ_kN",  Napi::Number::New(env2, r.adjustedZ_kN));
          return out;
        });
      }));
    exports.Set("boltedtimber", btNs);

    auto convNs = Napi::Object::New(env);
    convNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::conveyor::Input in{};
          in.horizontalLengthM        = o.Get("horizontalLengthM"      ).As<Napi::Number>().DoubleValue();
          in.liftHeightM              = o.Get("liftHeightM"            ).As<Napi::Number>().DoubleValue();
          in.beltSpeedMs              = o.Get("beltSpeedMs"            ).As<Napi::Number>().DoubleValue();
          in.materialMassFlowKgPerS   = o.Get("materialMassFlowKgPerS" ).As<Napi::Number>().DoubleValue();
          in.beltMassPerLengthKgM     = o.Get("beltMassPerLengthKgM"   ).As<Napi::Number>().DoubleValue();
          in.idlerMassPerLengthKgM    = o.Get("idlerMassPerLengthKgM"  ).As<Napi::Number>().DoubleValue();
          in.primaryFriction          = o.Get("primaryFriction"        ).As<Napi::Number>().DoubleValue();
          in.drivetrainEfficiency     = o.Get("drivetrainEfficiency"   ).As<Napi::Number>().DoubleValue();
          auto r = forge::conveyor::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("materialPerLengthKgM", Napi::Number::New(env2, r.materialPerLengthKgM));
          out.Set("effectiveTensionN",    Napi::Number::New(env2, r.effectiveTensionN));
          out.Set("powerRequiredKW",      Napi::Number::New(env2, r.powerRequiredKW));
          return out;
        });
      }));
    exports.Set("conveyor", convNs);

    auto drftNs = Napi::Object::New(env);
    drftNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::drift::Input in{};
          in.topDeflectionMm     = o.Get("topDeflectionMm"    ).As<Napi::Number>().DoubleValue();
          in.buildingHeightM     = o.Get("buildingHeightM"    ).As<Napi::Number>().DoubleValue();
          in.numberOfStories     = o.Get("numberOfStories"    ).As<Napi::Number>().Int32Value();
          in.driftLimitDivisor   = o.Get("driftLimitDivisor"  ).As<Napi::Number>().DoubleValue();
          auto r = forge::drift::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("overallDriftIndex",      Napi::Number::New(env2, r.overallDriftIndex));
          out.Set("overallLimit",           Napi::Number::New(env2, r.overallLimit));
          out.Set("storeyDriftAverageMm",   Napi::Number::New(env2, r.storeyDriftAverageMm));
          out.Set("meetsOverallLimit",      Napi::Boolean::New(env2, r.meetsOverallLimit));
          return out;
        });
      }));
    exports.Set("drift", drftNs);

    // ---- Forge-330a — Slope infinite stability ----------------------------
    auto slpNs = Napi::Object::New(env);
    slpNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::slope::Input in{};
          in.cohesion_kPa        = o.Get("cohesion_kPa").As<Napi::Number>().DoubleValue();
          in.unitWeight_kNm3     = o.Get("unitWeight_kNm3").As<Napi::Number>().DoubleValue();
          in.sliceDepth_m        = o.Get("sliceDepth_m").As<Napi::Number>().DoubleValue();
          in.slopeAngleDeg       = o.Get("slopeAngleDeg").As<Napi::Number>().DoubleValue();
          in.frictionAngleDeg    = o.Get("frictionAngleDeg").As<Napi::Number>().DoubleValue();
          in.waterTableDepth_m   = o.Get("waterTableDepth_m").As<Napi::Number>().DoubleValue();
          auto r = forge::slope::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("slipDepth_m",                 Napi::Number::New(env2, r.slipDepth_m));
          out.Set("effectiveNormalStress_kPa",   Napi::Number::New(env2, r.effectiveNormalStress_kPa));
          out.Set("mobilisedShearStress_kPa",    Napi::Number::New(env2, r.mobilisedShearStress_kPa));
          out.Set("resistingShearStress_kPa",    Napi::Number::New(env2, r.resistingShearStress_kPa));
          out.Set("factorOfSafety",              Napi::Number::New(env2, r.factorOfSafety));
          out.Set("stable",                      Napi::Boolean::New(env2, r.stable));
          return out;
        });
      }));
    exports.Set("slope", slpNs);

    // ---- Forge-330b — IC engine performance (Heywood) ---------------------
    auto engNs = Napi::Object::New(env);
    engNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::engperf::Input in{};
          in.displacement_L          = o.Get("displacement_L").As<Napi::Number>().DoubleValue();
          in.speed_rpm               = o.Get("speed_rpm").As<Napi::Number>().DoubleValue();
          in.brakeTorque_Nm          = o.Get("brakeTorque_Nm").As<Napi::Number>().DoubleValue();
          in.fuelMassFlow_kgPerH     = o.Get("fuelMassFlow_kgPerH").As<Napi::Number>().DoubleValue();
          in.airMassFlow_kgPerH      = o.Get("airMassFlow_kgPerH").As<Napi::Number>().DoubleValue();
          in.airDensity_kgM3         = o.Get("airDensity_kgM3").As<Napi::Number>().DoubleValue();
          in.stroke_mm               = o.Get("stroke_mm").As<Napi::Number>().DoubleValue();
          in.cycleType               = o.Get("cycleType").As<Napi::Number>().Int32Value();
          auto r = forge::engperf::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("bmep_kPa",                 Napi::Number::New(env2, r.bmep_kPa));
          out.Set("brakePower_kW",            Napi::Number::New(env2, r.brakePower_kW));
          out.Set("bsfc_g_per_kWh",           Napi::Number::New(env2, r.bsfc_g_per_kWh));
          out.Set("volumetricEfficiency",     Napi::Number::New(env2, r.volumetricEfficiency));
          out.Set("meanPistonSpeed_mPerS",    Napi::Number::New(env2, r.meanPistonSpeed_mPerS));
          out.Set("airFuelRatio",             Napi::Number::New(env2, r.airFuelRatio));
          return out;
        });
      }));
    exports.Set("engperf", engNs);

    // ---- Forge-330c — Daylight factor -------------------------------------
    auto dlfacNs = Napi::Object::New(env);
    dlfacNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::daylight::Input in{};
          in.visibleTransmittance   = o.Get("visibleTransmittance").As<Napi::Number>().DoubleValue();
          in.skyAngleDeg            = o.Get("skyAngleDeg").As<Napi::Number>().DoubleValue();
          in.glazingArea_m2         = o.Get("glazingArea_m2").As<Napi::Number>().DoubleValue();
          in.maintenanceFactor      = o.Get("maintenanceFactor").As<Napi::Number>().DoubleValue();
          in.totalSurfaceArea_m2    = o.Get("totalSurfaceArea_m2").As<Napi::Number>().DoubleValue();
          in.avgReflectance         = o.Get("avgReflectance").As<Napi::Number>().DoubleValue();
          auto r = forge::daylight::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("daylightFactorPct",   Napi::Number::New(env2, r.daylightFactorPct));
          out.Set("meetsLeed2pct",       Napi::Boolean::New(env2, r.meetsLeed2pct));
          out.Set("meetsLeed3pct",       Napi::Boolean::New(env2, r.meetsLeed3pct));
          return out;
        });
      }));
    exports.Set("daylight", dlfacNs);

    // ---- Forge-330d — Earthwork mass-haul ---------------------------------
    auto mhaulNs = Napi::Object::New(env);
    mhaulNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::masshaul::Input in{};
          in.swellFactor      = o.Get("swellFactor").As<Napi::Number>().DoubleValue();
          in.shrinkageFactor  = o.Get("shrinkageFactor").As<Napi::Number>().DoubleValue();
          auto stationsJs     = o.Get("stations").As<Napi::Array>();
          for (uint32_t i = 0; i < stationsJs.Length(); ++i) {
              auto s = stationsJs.Get(i).As<Napi::Object>();
              forge::masshaul::Station st{};
              st.station_m       = s.Get("station_m").As<Napi::Number>().DoubleValue();
              st.cutArea_m2      = s.Get("cutArea_m2").As<Napi::Number>().DoubleValue();
              st.fillArea_m2     = s.Get("fillArea_m2").As<Napi::Number>().DoubleValue();
              st.midCutArea_m2   = s.Has("midCutArea_m2")  ? s.Get("midCutArea_m2").As<Napi::Number>().DoubleValue()  : 0.0;
              st.midFillArea_m2  = s.Has("midFillArea_m2") ? s.Get("midFillArea_m2").As<Napi::Number>().DoubleValue() : 0.0;
              in.stations.push_back(st);
          }
          auto rmh = forge::masshaul::analyse(in);
          auto& r = rmh;
          auto out = Napi::Object::New(env2);
          auto arr = Napi::Array::New(env2, r.cumulativeOrdinate_m3.size());
          for (uint32_t i = 0; i < r.cumulativeOrdinate_m3.size(); ++i)
              arr.Set(i, Napi::Number::New(env2, r.cumulativeOrdinate_m3[i]));
          out.Set("cumulativeOrdinate_m3",  arr);
          out.Set("totalCut_m3",            Napi::Number::New(env2, r.totalCut_m3));
          out.Set("totalFillCompacted_m3",  Napi::Number::New(env2, r.totalFillCompacted_m3));
          out.Set("totalFillLoose_m3",      Napi::Number::New(env2, r.totalFillLoose_m3));
          out.Set("netBalance_m3",          Napi::Number::New(env2, r.netBalance_m3));
          out.Set("maxOrdinate_m3",         Napi::Number::New(env2, r.maxOrdinate_m3));
          out.Set("minOrdinate_m3",         Napi::Number::New(env2, r.minOrdinate_m3));
          return out;
        });
      }));
    exports.Set("masshaul", mhaulNs);

    // ---- Forge-330e — Rail beam-on-elastic-foundation ---------------------
    auto rblNs = Napi::Object::New(env);
    rblNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::railbeam::Input in{};
          in.wheelLoad_kN                  = o.Get("wheelLoad_kN").As<Napi::Number>().DoubleValue();
          in.railE_GPa                     = o.Get("railE_GPa").As<Napi::Number>().DoubleValue();
          in.railI_cm4                     = o.Get("railI_cm4").As<Napi::Number>().DoubleValue();
          in.railSectionModulusBase_cm3    = o.Get("railSectionModulusBase_cm3").As<Napi::Number>().DoubleValue();
          in.trackModulus_MPaPerM          = o.Get("trackModulus_MPaPerM").As<Napi::Number>().DoubleValue();
          auto r = forge::railbeam::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("characteristicLength_m",   Napi::Number::New(env2, r.characteristicLength_m));
          out.Set("maxRailDeflection_mm",     Napi::Number::New(env2, r.maxRailDeflection_mm));
          out.Set("maxBendingMoment_kNm",     Napi::Number::New(env2, r.maxBendingMoment_kNm));
          out.Set("maxRailStress_MPa",        Napi::Number::New(env2, r.maxRailStress_MPa));
          return out;
        });
      }));
    exports.Set("railbeam", rblNs);

    // ---- Forge-331a — Beam reactions / moments / deflection ---------------
    auto bmreactNs = Napi::Object::New(env);
    bmreactNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::beamreact::Input in{};
          in.span_m                 = o.Get("span_m").As<Napi::Number>().DoubleValue();
          in.pointLoad_kN           = o.Get("pointLoad_kN").As<Napi::Number>().DoubleValue();
          in.pointLoadPosition_m    = o.Get("pointLoadPosition_m").As<Napi::Number>().DoubleValue();
          in.udl_kNm                = o.Get("udl_kNm").As<Napi::Number>().DoubleValue();
          in.EI_kNm2                = o.Get("EI_kNm2").As<Napi::Number>().DoubleValue();
          auto r = forge::beamreact::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("leftReaction_kN",       Napi::Number::New(env2, r.leftReaction_kN));
          out.Set("rightReaction_kN",      Napi::Number::New(env2, r.rightReaction_kN));
          out.Set("maxBendingMoment_kNm",  Napi::Number::New(env2, r.maxBendingMoment_kNm));
          out.Set("maxShear_kN",           Napi::Number::New(env2, r.maxShear_kN));
          out.Set("maxDeflection_mm",      Napi::Number::New(env2, r.maxDeflection_mm));
          return out;
        });
      }));
    exports.Set("beamreact", bmreactNs);

    // ---- Forge-331b — API 650 tank wind anchorage --------------------------
    auto taNs = Napi::Object::New(env);
    taNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::tankanchor::Input in{};
          in.tankDiameter_m       = o.Get("tankDiameter_m").As<Napi::Number>().DoubleValue();
          in.tankHeight_m         = o.Get("tankHeight_m").As<Napi::Number>().DoubleValue();
          in.shellWeight_kN       = o.Get("shellWeight_kN").As<Napi::Number>().DoubleValue();
          in.fluidWeight_kN       = o.Get("fluidWeight_kN").As<Napi::Number>().DoubleValue();
          in.windSpeed_ms         = o.Get("windSpeed_ms").As<Napi::Number>().DoubleValue();
          in.anchorCount          = o.Get("anchorCount").As<Napi::Number>().Int32Value();
          in.importanceFactorKs   = o.Get("importanceFactorKs").As<Napi::Number>().DoubleValue();
          auto r = forge::tankanchor::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("windPressure_kPa",     Napi::Number::New(env2, r.windPressure_kPa));
          out.Set("overturningMoment_kNm",Napi::Number::New(env2, r.overturningMoment_kNm));
          out.Set("restoringMoment_kNm",  Napi::Number::New(env2, r.restoringMoment_kNm));
          out.Set("netUplift_kN",         Napi::Number::New(env2, r.netUplift_kN));
          out.Set("safetyFactor",         Napi::Number::New(env2, r.safetyFactor));
          out.Set("anchorageRequired",    Napi::Boolean::New(env2, r.anchorageRequired));
          return out;
        });
      }));
    exports.Set("tankanchor", taNs);

    // ---- Forge-331c — Heat-pump COP ----------------------------------------
    auto hpumpNs = Napi::Object::New(env);
    hpumpNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::heatpump::Input in{};
          in.sourceTemp_C          = o.Get("sourceTemp_C").As<Napi::Number>().DoubleValue();
          in.sinkTemp_C            = o.Get("sinkTemp_C").As<Napi::Number>().DoubleValue();
          in.secondLawEfficiency   = o.Get("secondLawEfficiency").As<Napi::Number>().DoubleValue();
          in.compressorPower_kW    = o.Get("compressorPower_kW").As<Napi::Number>().DoubleValue();
          in.mode                  = o.Get("mode").As<Napi::Number>().Int32Value();
          auto r = forge::heatpump::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("cop_carnot",     Napi::Number::New(env2, r.cop_carnot));
          out.Set("cop_actual",     Napi::Number::New(env2, r.cop_actual));
          out.Set("eer_btuhPerW",   Napi::Number::New(env2, r.eer_btuhPerW));
          out.Set("capacity_kW",    Napi::Number::New(env2, r.capacity_kW));
          out.Set("waste_kW",       Napi::Number::New(env2, r.waste_kW));
          return out;
        });
      }));
    exports.Set("heatpump", hpumpNs);

    // ---- Forge-331d — ASCE 7 base shear ------------------------------------
    auto bshearNs = Napi::Object::New(env);
    bshearNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::baseshear::Input in{};
          in.heightAboveBase_m   = o.Get("heightAboveBase_m").As<Napi::Number>().DoubleValue();
          in.seismicWeight_kN    = o.Get("seismicWeight_kN").As<Napi::Number>().DoubleValue();
          in.sds                 = o.Get("sds").As<Napi::Number>().DoubleValue();
          in.sd1                 = o.Get("sd1").As<Napi::Number>().DoubleValue();
          in.R                   = o.Get("R").As<Napi::Number>().DoubleValue();
          in.Ie                  = o.Get("Ie").As<Napi::Number>().DoubleValue();
          in.structuralSystem    = o.Get("structuralSystem").As<Napi::Number>().Int32Value();
          auto r = forge::baseshear::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("approximatePeriod_s",   Napi::Number::New(env2, r.approximatePeriod_s));
          out.Set("Cs",                    Napi::Number::New(env2, r.Cs));
          out.Set("CsMax",                 Napi::Number::New(env2, r.CsMax));
          out.Set("CsMin",                 Napi::Number::New(env2, r.CsMin));
          out.Set("baseShear_kN",          Napi::Number::New(env2, r.baseShear_kN));
          out.Set("baseShearCoeff",        Napi::Number::New(env2, r.baseShearCoeff));
          return out;
        });
      }));
    exports.Set("baseshear", bshearNs);

    // ---- Forge-331e — PV horizon shading -----------------------------------
    auto pvsNs = Napi::Object::New(env);
    pvsNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::pvshade::Input in{};
          in.sunAltitudeDeg = o.Get("sunAltitudeDeg").As<Napi::Number>().DoubleValue();
          in.sunAzimuthDeg  = o.Get("sunAzimuthDeg").As<Napi::Number>().DoubleValue();
          auto horizonJs    = o.Get("horizon").As<Napi::Array>();
          for (uint32_t i = 0; i < horizonJs.Length(); ++i) {
              auto p = horizonJs.Get(i).As<Napi::Object>();
              forge::pvshade::HorizonPoint pt{};
              pt.azimuthDeg  = p.Get("azimuthDeg").As<Napi::Number>().DoubleValue();
              pt.altitudeDeg = p.Get("altitudeDeg").As<Napi::Number>().DoubleValue();
              in.horizon.push_back(pt);
          }
          auto r = forge::pvshade::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("horizonAltitudeAtSunAz_deg",  Napi::Number::New(env2, r.horizonAltitudeAtSunAz_deg));
          out.Set("sunMarginDeg",                Napi::Number::New(env2, r.sunMarginDeg));
          out.Set("shaded",                      Napi::Boolean::New(env2, r.shaded));
          return out;
        });
      }));
    exports.Set("pvshade", pvsNs);

    // ---- Forge-332a — Pad-eye lug ASME BTH-1 -------------------------------
    auto peNs = Napi::Object::New(env);
    peNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::padeye::Input in{};
          in.designLoad_kN      = o.Get("designLoad_kN").As<Napi::Number>().DoubleValue();
          in.padThickness_mm    = o.Get("padThickness_mm").As<Napi::Number>().DoubleValue();
          in.padDiameter_mm     = o.Get("padDiameter_mm").As<Napi::Number>().DoubleValue();
          in.holeDiameter_mm    = o.Get("holeDiameter_mm").As<Napi::Number>().DoubleValue();
          in.pinDiameter_mm     = o.Get("pinDiameter_mm").As<Napi::Number>().DoubleValue();
          in.cheekToEdge_mm     = o.Get("cheekToEdge_mm").As<Napi::Number>().DoubleValue();
          in.yieldStrength_MPa  = o.Get("yieldStrength_MPa").As<Napi::Number>().DoubleValue();
          in.designCategory     = o.Get("designCategory").As<Napi::Number>().DoubleValue();
          auto r = forge::padeye::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("bearingStress_MPa",     Napi::Number::New(env2, r.bearingStress_MPa));
          out.Set("tensionAcrossHole_MPa", Napi::Number::New(env2, r.tensionAcrossHole_MPa));
          out.Set("shearTearOut_MPa",      Napi::Number::New(env2, r.shearTearOut_MPa));
          out.Set("allowableTensile_MPa",  Napi::Number::New(env2, r.allowableTensile_MPa));
          out.Set("allowableShear_MPa",    Napi::Number::New(env2, r.allowableShear_MPa));
          out.Set("governingUtilisation",  Napi::Number::New(env2, r.governingUtilisation));
          out.Set("passes",                Napi::Boolean::New(env2, r.passes));
          return out;
        });
      }));
    exports.Set("padeye", peNs);

    // ---- Forge-332b — Highway horizontal sight distance --------------------
    auto hsdNs = Napi::Object::New(env);
    hsdNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::hsd::Input in{};
          in.curveRadius_m      = o.Get("curveRadius_m").As<Napi::Number>().DoubleValue();
          in.sightDistance_m    = o.Get("sightDistance_m").As<Napi::Number>().DoubleValue();
          in.offsetAvailable_m  = o.Get("offsetAvailable_m").As<Napi::Number>().DoubleValue();
          auto r = forge::hsd::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("middleOrdinateRequired_m",  Napi::Number::New(env2, r.middleOrdinateRequired_m));
          out.Set("maxSafeSightDistance_m",    Napi::Number::New(env2, r.maxSafeSightDistance_m));
          out.Set("meetsAvailableClearance",   Napi::Boolean::New(env2, r.meetsAvailableClearance));
          return out;
        });
      }));
    exports.Set("hsd", hsdNs);

    // ---- Forge-332c — Welded fillet group elastic-vector -------------------
    auto wgNs = Napi::Object::New(env);
    wgNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::weldgroup::Input in{};
          in.loadP_kN          = o.Get("loadP_kN").As<Napi::Number>().DoubleValue();
          in.eccentricity_mm   = o.Get("eccentricity_mm").As<Napi::Number>().DoubleValue();
          in.legSize_mm        = o.Get("legSize_mm").As<Napi::Number>().DoubleValue();
          in.electrodeFu_MPa   = o.Get("electrodeFu_MPa").As<Napi::Number>().DoubleValue();
          auto segsJs = o.Get("segments").As<Napi::Array>();
          for (uint32_t i = 0; i < segsJs.Length(); ++i) {
              auto s = segsJs.Get(i).As<Napi::Object>();
              forge::weldgroup::WeldSegment seg{};
              seg.x0_mm = s.Get("x0_mm").As<Napi::Number>().DoubleValue();
              seg.y0_mm = s.Get("y0_mm").As<Napi::Number>().DoubleValue();
              seg.x1_mm = s.Get("x1_mm").As<Napi::Number>().DoubleValue();
              seg.y1_mm = s.Get("y1_mm").As<Napi::Number>().DoubleValue();
              in.segments.push_back(seg);
          }
          auto r = forge::weldgroup::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("centroidX_mm",            Napi::Number::New(env2, r.centroidX_mm));
          out.Set("centroidY_mm",            Napi::Number::New(env2, r.centroidY_mm));
          out.Set("totalLength_mm",          Napi::Number::New(env2, r.totalLength_mm));
          out.Set("polarSecondMoment_mm3",   Napi::Number::New(env2, r.polarSecondMoment_mm3));
          out.Set("maxStress_MPa",           Napi::Number::New(env2, r.maxStress_MPa));
          out.Set("allowableStress_MPa",     Napi::Number::New(env2, r.allowableStress_MPa));
          out.Set("utilisation",             Napi::Number::New(env2, r.utilisation));
          out.Set("passes",                  Napi::Boolean::New(env2, r.passes));
          return out;
        });
      }));
    exports.Set("weldgroup", wgNs);

    // ---- Forge-332d — Bolt preload (Shigley §8.8) --------------------------
    auto bpreNs = Napi::Object::New(env);
    bpreNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::boltpre::Input in{};
          in.proofStrength_MPa       = o.Get("proofStrength_MPa").As<Napi::Number>().DoubleValue();
          in.tensileArea_mm2         = o.Get("tensileArea_mm2").As<Napi::Number>().DoubleValue();
          in.boltDiameter_mm         = o.Get("boltDiameter_mm").As<Napi::Number>().DoubleValue();
          in.boltLengthGrip_mm       = o.Get("boltLengthGrip_mm").As<Napi::Number>().DoubleValue();
          in.memberGripThickness_mm  = o.Get("memberGripThickness_mm").As<Napi::Number>().DoubleValue();
          in.boltE_GPa               = o.Get("boltE_GPa").As<Napi::Number>().DoubleValue();
          in.memberE_GPa             = o.Get("memberE_GPa").As<Napi::Number>().DoubleValue();
          in.externalLoadP_kN        = o.Get("externalLoadP_kN").As<Napi::Number>().DoubleValue();
          in.torqueCoefficient       = o.Get("torqueCoefficient").As<Napi::Number>().DoubleValue();
          in.preloadFraction         = o.Get("preloadFraction").As<Napi::Number>().DoubleValue();
          auto r = forge::boltpre::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("recommendedPreload_kN",   Napi::Number::New(env2, r.recommendedPreload_kN));
          out.Set("tighteningTorque_Nm",     Napi::Number::New(env2, r.tighteningTorque_Nm));
          out.Set("bolt_stiffness_NperM",    Napi::Number::New(env2, r.bolt_stiffness_NperM));
          out.Set("member_stiffness_NperM",  Napi::Number::New(env2, r.member_stiffness_NperM));
          out.Set("jointStiffnessRatio_C",   Napi::Number::New(env2, r.jointStiffnessRatio_C));
          out.Set("boltLoad_kN",             Napi::Number::New(env2, r.boltLoad_kN));
          out.Set("memberLoad_kN",           Napi::Number::New(env2, r.memberLoad_kN));
          out.Set("separationLoad_kN",       Napi::Number::New(env2, r.separationLoad_kN));
          out.Set("staticSafetyFactor",      Napi::Number::New(env2, r.staticSafetyFactor));
          return out;
        });
      }));
    exports.Set("boltpre", bpreNs);

    // ---- Forge-332e — Prestress losses AASHTO LRFD §5.9 --------------------
    auto prsNs = Napi::Object::New(env);
    prsNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::prestress::Input in{};
          in.initialStress_fpj_MPa                = o.Get("initialStress_fpj_MPa").As<Napi::Number>().DoubleValue();
          in.concreteStrengthAtTransfer_fci_MPa   = o.Get("concreteStrengthAtTransfer_fci_MPa").As<Napi::Number>().DoubleValue();
          in.finalConcreteStrength_fc_MPa         = o.Get("finalConcreteStrength_fc_MPa").As<Napi::Number>().DoubleValue();
          in.fcgp_MPa                             = o.Get("fcgp_MPa").As<Napi::Number>().DoubleValue();
          in.fcdp_MPa                             = o.Get("fcdp_MPa").As<Napi::Number>().DoubleValue();
          in.strandModulus_GPa                    = o.Get("strandModulus_GPa").As<Napi::Number>().DoubleValue();
          in.humidityH_pct                        = o.Get("humidityH_pct").As<Napi::Number>().DoubleValue();
          in.shrinkageStrain_e6                   = o.Get("shrinkageStrain_e6").As<Napi::Number>().DoubleValue();
          auto r = forge::prestress::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("loss_ES_MPa",       Napi::Number::New(env2, r.loss_ES_MPa));
          out.Set("loss_SR_MPa",       Napi::Number::New(env2, r.loss_SR_MPa));
          out.Set("loss_CR_MPa",       Napi::Number::New(env2, r.loss_CR_MPa));
          out.Set("loss_RE_MPa",       Napi::Number::New(env2, r.loss_RE_MPa));
          out.Set("totalLoss_MPa",     Napi::Number::New(env2, r.totalLoss_MPa));
          out.Set("totalLossPercent",  Napi::Number::New(env2, r.totalLossPercent));
          out.Set("finalStress_MPa",   Napi::Number::New(env2, r.finalStress_MPa));
          return out;
        });
      }));
    exports.Set("prestress", prsNs);

    // ---- Forge-333a — ASME B16.5 bolted flange ----------------------------
    auto flgNs = Napi::Object::New(env);
    flgNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::flange::Input in{};
          in.designPressure_MPa                = o.Get("designPressure_MPa").As<Napi::Number>().DoubleValue();
          in.gasketOD_mm                       = o.Get("gasketOD_mm").As<Napi::Number>().DoubleValue();
          in.gasketID_mm                       = o.Get("gasketID_mm").As<Napi::Number>().DoubleValue();
          in.gasketFactorM                     = o.Get("gasketFactorM").As<Napi::Number>().DoubleValue();
          in.seatingStress_y_MPa               = o.Get("seatingStress_y_MPa").As<Napi::Number>().DoubleValue();
          in.allowableBoltStress_Sa_MPa        = o.Get("allowableBoltStress_Sa_MPa").As<Napi::Number>().DoubleValue();
          in.allowableBoltStressAtm_Satm_MPa   = o.Get("allowableBoltStressAtm_Satm_MPa").As<Napi::Number>().DoubleValue();
          in.singleBoltArea_mm2                = o.Get("singleBoltArea_mm2").As<Napi::Number>().DoubleValue();
          auto r = forge::flange::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("gasketWidth_b0_mm",      Napi::Number::New(env2, r.gasketWidth_b0_mm));
          out.Set("effectiveWidth_b_mm",    Napi::Number::New(env2, r.effectiveWidth_b_mm));
          out.Set("effectiveDiameter_G_mm", Napi::Number::New(env2, r.effectiveDiameter_G_mm));
          out.Set("Hd_kN",                  Napi::Number::New(env2, r.Hd_kN));
          out.Set("Hp_kN",                  Napi::Number::New(env2, r.Hp_kN));
          out.Set("Wm1_kN",                 Napi::Number::New(env2, r.Wm1_kN));
          out.Set("Wm2_kN",                 Napi::Number::New(env2, r.Wm2_kN));
          out.Set("Am_required_mm2",        Napi::Number::New(env2, r.Am_required_mm2));
          out.Set("boltCountRequired",      Napi::Number::New(env2, r.boltCountRequired));
          return out;
        });
      }));
    exports.Set("flange", flgNs);

    // ---- Forge-333b — Spillway ogee discharge ------------------------------
    auto ogNs = Napi::Object::New(env);
    ogNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::ogee::Input in{};
          in.headOverCrest_H_m       = o.Get("headOverCrest_H_m").As<Napi::Number>().DoubleValue();
          in.designHead_Hd_m         = o.Get("designHead_Hd_m").As<Napi::Number>().DoubleValue();
          in.crestLength_L_m         = o.Get("crestLength_L_m").As<Napi::Number>().DoubleValue();
          in.pierCount_N             = o.Get("pierCount_N").As<Napi::Number>().Int32Value();
          in.pierContraction_Kp      = o.Get("pierContraction_Kp").As<Napi::Number>().DoubleValue();
          in.abutmentContraction_Ka  = o.Get("abutmentContraction_Ka").As<Napi::Number>().DoubleValue();
          in.dischargeCoefficient_C  = o.Get("dischargeCoefficient_C").As<Napi::Number>().DoubleValue();
          in.profileSamples          = o.Get("profileSamples").As<Napi::Number>().Int32Value();
          auto r = forge::ogee::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("effectiveLength_Le_m",   Napi::Number::New(env2, r.effectiveLength_Le_m));
          out.Set("dischargeQ_m3s",         Napi::Number::New(env2, r.dischargeQ_m3s));
          out.Set("specificDischarge_q_m2s",Napi::Number::New(env2, r.specificDischarge_q_m2s));
          auto px = Napi::Array::New(env2, r.profileX_m.size());
          auto py = Napi::Array::New(env2, r.profileY_m.size());
          for (uint32_t i = 0; i < r.profileX_m.size(); ++i) px.Set(i, Napi::Number::New(env2, r.profileX_m[i]));
          for (uint32_t i = 0; i < r.profileY_m.size(); ++i) py.Set(i, Napi::Number::New(env2, r.profileY_m[i]));
          out.Set("profileX_m", px);
          out.Set("profileY_m", py);
          return out;
        });
      }));
    exports.Set("ogee", ogNs);

    // ---- Forge-333c — IEEE 80 grounding grid -------------------------------
    auto ggNs = Napi::Object::New(env);
    ggNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::groundgrid::Input in{};
          in.soilResistivity_rho_Ohmm           = o.Get("soilResistivity_rho_Ohmm").As<Napi::Number>().DoubleValue();
          in.surfaceLayerResistivity_rhos_Ohmm  = o.Get("surfaceLayerResistivity_rhos_Ohmm").As<Napi::Number>().DoubleValue();
          in.surfaceLayerDepth_hs_m             = o.Get("surfaceLayerDepth_hs_m").As<Napi::Number>().DoubleValue();
          in.gridDepth_h_m                      = o.Get("gridDepth_h_m").As<Napi::Number>().DoubleValue();
          in.gridArea_m2                        = o.Get("gridArea_m2").As<Napi::Number>().DoubleValue();
          in.totalConductorLength_m             = o.Get("totalConductorLength_m").As<Napi::Number>().DoubleValue();
          in.faultClearTime_s                   = o.Get("faultClearTime_s").As<Napi::Number>().DoubleValue();
          in.faultCurrent_kA                    = o.Get("faultCurrent_kA").As<Napi::Number>().DoubleValue();
          in.conductorKf                        = o.Get("conductorKf").As<Napi::Number>().DoubleValue();
          in.bodyWeight_kg                      = o.Get("bodyWeight_kg").As<Napi::Number>().Int32Value();
          auto r = forge::groundgrid::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("Cs_surface_derating",        Napi::Number::New(env2, r.Cs_surface_derating));
          out.Set("allowableStepVoltage_V",     Napi::Number::New(env2, r.allowableStepVoltage_V));
          out.Set("allowableTouchVoltage_V",    Napi::Number::New(env2, r.allowableTouchVoltage_V));
          out.Set("requiredConductorArea_mm2",  Napi::Number::New(env2, r.requiredConductorArea_mm2));
          out.Set("gridResistance_Ohm",         Napi::Number::New(env2, r.gridResistance_Ohm));
          out.Set("groundPotentialRise_V",      Napi::Number::New(env2, r.groundPotentialRise_V));
          return out;
        });
      }));
    exports.Set("groundgrid", ggNs);

    // ---- Forge-333d — Single-DOF response spectrum (Newmark) --------------
    auto rsNs = Napi::Object::New(env);
    rsNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::rspect::Input in{};
          in.dampingRatio      = o.Get("dampingRatio").As<Napi::Number>().DoubleValue();
          in.Tmin_s            = o.Get("Tmin_s").As<Napi::Number>().DoubleValue();
          in.Tmax_s            = o.Get("Tmax_s").As<Napi::Number>().DoubleValue();
          in.nSpectralPoints   = o.Get("nSpectralPoints").As<Napi::Number>().Int32Value();
          auto tJs = o.Get("time_s").As<Napi::Array>();
          auto aJs = o.Get("accel_ms2").As<Napi::Array>();
          for (uint32_t i = 0; i < tJs.Length(); ++i) {
              in.time_s.push_back(tJs.Get(i).As<Napi::Number>().DoubleValue());
              in.accel_ms2.push_back(aJs.Get(i).As<Napi::Number>().DoubleValue());
          }
          auto r = forge::rspect::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("peakGroundAccel_ms2",  Napi::Number::New(env2, r.peakGroundAccel_ms2));
          auto specArr = Napi::Array::New(env2, r.spectrum.size());
          for (uint32_t i = 0; i < r.spectrum.size(); ++i) {
              auto p = Napi::Object::New(env2);
              p.Set("T_s",     Napi::Number::New(env2, r.spectrum[i].T_s));
              p.Set("Sd_m",    Napi::Number::New(env2, r.spectrum[i].Sd_m));
              p.Set("Sv_mps",  Napi::Number::New(env2, r.spectrum[i].Sv_mps));
              p.Set("Sa_mps2", Napi::Number::New(env2, r.spectrum[i].Sa_mps2));
              specArr.Set(i, p);
          }
          out.Set("spectrum", specArr);
          return out;
        });
      }));
    exports.Set("rspect", rsNs);

    // ---- Forge-333e — Floating-body buoyancy + stability -------------------
    auto buoyNs = Napi::Object::New(env);
    buoyNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::buoyfloat::Input in{};
          in.bodyMass_kg        = o.Get("bodyMass_kg").As<Napi::Number>().DoubleValue();
          in.fluidDensity_kgM3  = o.Get("fluidDensity_kgM3").As<Napi::Number>().DoubleValue();
          in.length_m           = o.Get("length_m").As<Napi::Number>().DoubleValue();
          in.beam_m             = o.Get("beam_m").As<Napi::Number>().DoubleValue();
          in.KG_m               = o.Get("KG_m").As<Napi::Number>().DoubleValue();
          in.heelAngle_deg      = o.Get("heelAngle_deg").As<Napi::Number>().DoubleValue();
          auto r = forge::buoyfloat::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("displacedVolume_m3",  Napi::Number::New(env2, r.displacedVolume_m3));
          out.Set("draught_m",           Napi::Number::New(env2, r.draught_m));
          out.Set("KB_m",                Napi::Number::New(env2, r.KB_m));
          out.Set("BM_m",                Napi::Number::New(env2, r.BM_m));
          out.Set("GM_m",                Napi::Number::New(env2, r.GM_m));
          out.Set("rightingArm_GZ_m",    Napi::Number::New(env2, r.rightingArm_GZ_m));
          out.Set("rightingMoment_kNm",  Napi::Number::New(env2, r.rightingMoment_kNm));
          out.Set("stable",              Napi::Boolean::New(env2, r.stable));
          return out;
        });
      }));
    exports.Set("buoyfloat", buoyNs);

    // ---- Forge-334a — Vertical curve AASHTO §3.3.3 -------------------------
    auto vcNs = Napi::Object::New(env);
    vcNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::vcurve::Input in{};
          in.grade1_pct      = o.Get("grade1_pct").As<Napi::Number>().DoubleValue();
          in.grade2_pct      = o.Get("grade2_pct").As<Napi::Number>().DoubleValue();
          in.designSpeed_kmh = o.Get("designSpeed_kmh").As<Napi::Number>().DoubleValue();
          in.curveLength_m   = o.Get("curveLength_m").As<Napi::Number>().DoubleValue();
          in.Kvalue          = o.Get("Kvalue").As<Napi::Number>().DoubleValue();
          in.curveType       = o.Get("curveType").As<Napi::Number>().Int32Value();
          auto r = forge::vcurve::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("algebraicGradeChange_A_pct", Napi::Number::New(env2, r.algebraicGradeChange_A_pct));
          out.Set("computedLength_m",           Napi::Number::New(env2, r.computedLength_m));
          out.Set("Kvalue",                     Napi::Number::New(env2, r.Kvalue));
          out.Set("assumedSSD_m",               Napi::Number::New(env2, r.assumedSSD_m));
          out.Set("minLength_AASHTO_m",         Napi::Number::New(env2, r.minLength_AASHTO_m));
          out.Set("highOrLowPointStation_m",    Napi::Number::New(env2, r.highOrLowPointStation_m));
          out.Set("meetsSightDistance",         Napi::Boolean::New(env2, r.meetsSightDistance));
          return out;
        });
      }));
    exports.Set("vcurve", vcNs);

    // ---- Forge-334b — Wastewater clarifier sizing --------------------------
    auto clarNs = Napi::Object::New(env);
    clarNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::clarifier::Input in{};
          in.designFlow_m3d        = o.Get("designFlow_m3d").As<Napi::Number>().DoubleValue();
          in.tankDiameter_m        = o.Get("tankDiameter_m").As<Napi::Number>().DoubleValue();
          in.tankDepth_m           = o.Get("tankDepth_m").As<Napi::Number>().DoubleValue();
          in.weirLength_m          = o.Get("weirLength_m").As<Napi::Number>().DoubleValue();
          in.returnSludgeRatio     = o.Get("returnSludgeRatio").As<Napi::Number>().DoubleValue();
          in.mixedLiquorMLSS_kgM3  = o.Get("mixedLiquorMLSS_kgM3").As<Napi::Number>().DoubleValue();
          in.clarifierType         = o.Get("clarifierType").As<Napi::Number>().Int32Value();
          auto r = forge::clarifier::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("surfaceArea_m2",   Napi::Number::New(env2, r.surfaceArea_m2));
          out.Set("tankVolume_m3",    Napi::Number::New(env2, r.tankVolume_m3));
          out.Set("SOR_mPerD",        Napi::Number::New(env2, r.SOR_mPerD));
          out.Set("WLR_m3PerMpD",     Napi::Number::New(env2, r.WLR_m3PerMpD));
          out.Set("HRT_h",            Napi::Number::New(env2, r.HRT_h));
          out.Set("SLR_kgPerM2D",     Napi::Number::New(env2, r.SLR_kgPerM2D));
          out.Set("meetsSOR",         Napi::Boolean::New(env2, r.meetsSOR));
          out.Set("meetsWLR",         Napi::Boolean::New(env2, r.meetsWLR));
          return out;
        });
      }));
    exports.Set("clarifier", clarNs);

    // ---- Forge-334c — PV battery off-grid sizing ---------------------------
    auto pvbNs = Napi::Object::New(env);
    pvbNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::pvbatt::Input in{};
          in.dailyLoadWh         = o.Get("dailyLoadWh").As<Napi::Number>().DoubleValue();
          in.systemVoltage_V     = o.Get("systemVoltage_V").As<Napi::Number>().DoubleValue();
          in.daysOfAutonomy      = o.Get("daysOfAutonomy").As<Napi::Number>().DoubleValue();
          in.depthOfDischarge    = o.Get("depthOfDischarge").As<Napi::Number>().DoubleValue();
          in.inverterEfficiency  = o.Get("inverterEfficiency").As<Napi::Number>().DoubleValue();
          in.temperatureDerate   = o.Get("temperatureDerate").As<Napi::Number>().DoubleValue();
          in.ageingDerate        = o.Get("ageingDerate").As<Napi::Number>().DoubleValue();
          in.singleCellAh        = o.Get("singleCellAh").As<Napi::Number>().DoubleValue();
          in.singleCellV         = o.Get("singleCellV").As<Napi::Number>().DoubleValue();
          auto r = forge::pvbatt::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("bankCapacity_Ah",         Napi::Number::New(env2, r.bankCapacity_Ah));
          out.Set("bankCapacity_kWh",        Napi::Number::New(env2, r.bankCapacity_kWh));
          out.Set("seriesStringSize",        Napi::Number::New(env2, r.seriesStringSize));
          out.Set("parallelStringCount",     Napi::Number::New(env2, r.parallelStringCount));
          out.Set("totalCellCount",          Napi::Number::New(env2, r.totalCellCount));
          out.Set("effectiveAutonomyHours",  Napi::Number::New(env2, r.effectiveAutonomyHours));
          return out;
        });
      }));
    exports.Set("pvbatt", pvbNs);

    // ---- Forge-334d — HVAC duct silencer attenuation -----------------------
    auto silNs = Napi::Object::New(env);
    silNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::silencer::Input in{};
          in.length_m            = o.Get("length_m").As<Napi::Number>().DoubleValue();
          in.openCrossArea_m2    = o.Get("openCrossArea_m2").As<Napi::Number>().DoubleValue();
          in.linedPerimeter_m    = o.Get("linedPerimeter_m").As<Napi::Number>().DoubleValue();
          in.faceVelocity_mps    = o.Get("faceVelocity_mps").As<Napi::Number>().DoubleValue();
          in.airDensity_kgM3     = o.Get("airDensity_kgM3").As<Napi::Number>().DoubleValue();
          in.pressureLossK       = o.Get("pressureLossK").As<Napi::Number>().DoubleValue();
          in.Koct_dBPerMeter     = o.Get("Koct_dBPerMeter").As<Napi::Number>().DoubleValue();
          auto r = forge::silencer::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("insertionLoss_dB", Napi::Number::New(env2, r.insertionLoss_dB));
          out.Set("pressureDrop_Pa",  Napi::Number::New(env2, r.pressureDrop_Pa));
          out.Set("selfNoise_LwA_dB", Napi::Number::New(env2, r.selfNoise_LwA_dB));
          return out;
        });
      }));
    exports.Set("silencer", silNs);

    // ---- Forge-334e — Thrust block pipe restraint --------------------------
    auto tblkNs = Napi::Object::New(env);
    tblkNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::thrustblk::Input in{};
          in.pipeOuterDiameter_mm     = o.Get("pipeOuterDiameter_mm").As<Napi::Number>().DoubleValue();
          in.designPressure_MPa       = o.Get("designPressure_MPa").As<Napi::Number>().DoubleValue();
          in.bendAngleDeg             = o.Get("bendAngleDeg").As<Napi::Number>().DoubleValue();
          in.soilBearingPressure_kPa  = o.Get("soilBearingPressure_kPa").As<Napi::Number>().DoubleValue();
          in.safetyFactor             = o.Get("safetyFactor").As<Napi::Number>().DoubleValue();
          in.fittingType              = o.Get("fittingType").As<Napi::Number>().Int32Value();
          in.reducerOD2_mm            = o.Has("reducerOD2_mm")
                                       ? o.Get("reducerOD2_mm").As<Napi::Number>().DoubleValue()
                                       : 0.0;
          auto r = forge::thrustblk::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("pipeArea_mm2",            Napi::Number::New(env2, r.pipeArea_mm2));
          out.Set("thrustForce_kN",          Napi::Number::New(env2, r.thrustForce_kN));
          out.Set("requiredBearingArea_m2",  Napi::Number::New(env2, r.requiredBearingArea_m2));
          out.Set("squareBlockSide_m",       Napi::Number::New(env2, r.squareBlockSide_m));
          out.Set("blockMassEstimate_t",     Napi::Number::New(env2, r.blockMassEstimate_t));
          return out;
        });
      }));
    exports.Set("thrustblk", tblkNs);

    // ---- Forge-335a — RC corbel ACI 318-19 §16.5 ---------------------------
    auto crbNs = Napi::Object::New(env);
    crbNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::corbel::Input in{};
          in.Vu_kN        = o.Get("Vu_kN").As<Napi::Number>().DoubleValue();
          in.Nuc_kN       = o.Get("Nuc_kN").As<Napi::Number>().DoubleValue();
          in.a_mm         = o.Get("a_mm").As<Napi::Number>().DoubleValue();
          in.bw_mm        = o.Get("bw_mm").As<Napi::Number>().DoubleValue();
          in.d_mm         = o.Get("d_mm").As<Napi::Number>().DoubleValue();
          in.h_mm         = o.Get("h_mm").As<Napi::Number>().DoubleValue();
          in.fc_MPa       = o.Get("fc_MPa").As<Napi::Number>().DoubleValue();
          in.fy_MPa       = o.Get("fy_MPa").As<Napi::Number>().DoubleValue();
          in.frictionMu   = o.Get("frictionMu").As<Napi::Number>().DoubleValue();
          in.phi          = o.Get("phi").As<Napi::Number>().DoubleValue();
          auto r = forge::corbel::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("Vn_max_kN",         Napi::Number::New(env2, r.Vn_max_kN));
          out.Set("Avf_required_mm2",  Napi::Number::New(env2, r.Avf_required_mm2));
          out.Set("As_primary_mm2",    Napi::Number::New(env2, r.As_primary_mm2));
          out.Set("Ah_stirrups_mm2",   Napi::Number::New(env2, r.Ah_stirrups_mm2));
          out.Set("momentArm_jd_mm",   Napi::Number::New(env2, r.momentArm_jd_mm));
          out.Set("shearOK",           Napi::Boolean::New(env2, r.shearOK));
          return out;
        });
      }));
    exports.Set("corbel", crbNs);

    // ---- Forge-335b — Wind tower foundation overturning --------------------
    auto wtbNs = Napi::Object::New(env);
    wtbNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::wtbase::Input in{};
          in.thrustForce_kN        = o.Get("thrustForce_kN").As<Napi::Number>().DoubleValue();
          in.hubHeight_m           = o.Get("hubHeight_m").As<Napi::Number>().DoubleValue();
          in.towerWeight_kN        = o.Get("towerWeight_kN").As<Napi::Number>().DoubleValue();
          in.foundationWidth_m     = o.Get("foundationWidth_m").As<Napi::Number>().DoubleValue();
          in.foundationDepth_m     = o.Get("foundationDepth_m").As<Napi::Number>().DoubleValue();
          in.concreteDensity_kgM3  = o.Get("concreteDensity_kgM3").As<Napi::Number>().DoubleValue();
          in.soilDensity_kgM3      = o.Get("soilDensity_kgM3").As<Napi::Number>().DoubleValue();
          in.soilCapDepth_m        = o.Get("soilCapDepth_m").As<Napi::Number>().DoubleValue();
          in.allowableBearing_kPa  = o.Get("allowableBearing_kPa").As<Napi::Number>().DoubleValue();
          auto r = forge::wtbase::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("foundationWeight_kN",    Napi::Number::New(env2, r.foundationWeight_kN));
          out.Set("soilCapWeight_kN",       Napi::Number::New(env2, r.soilCapWeight_kN));
          out.Set("totalGravity_kN",        Napi::Number::New(env2, r.totalGravity_kN));
          out.Set("overturningMoment_kNm",  Napi::Number::New(env2, r.overturningMoment_kNm));
          out.Set("restoringMoment_kNm",    Napi::Number::New(env2, r.restoringMoment_kNm));
          out.Set("overturningSF",          Napi::Number::New(env2, r.overturningSF));
          out.Set("eccentricity_m",         Napi::Number::New(env2, r.eccentricity_m));
          out.Set("maxBearingPressure_kPa", Napi::Number::New(env2, r.maxBearingPressure_kPa));
          out.Set("sizeOK",                 Napi::Boolean::New(env2, r.sizeOK));
          return out;
        });
      }));
    exports.Set("wtbase", wtbNs);

    // ---- Forge-335c — Air receiver ASME UG-27 ------------------------------
    auto arNs = Napi::Object::New(env);
    arNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::airrcv::Input in{};
          in.internalPressure_MPa  = o.Get("internalPressure_MPa").As<Napi::Number>().DoubleValue();
          in.insideRadius_mm       = o.Get("insideRadius_mm").As<Napi::Number>().DoubleValue();
          in.allowableStress_S_MPa = o.Get("allowableStress_S_MPa").As<Napi::Number>().DoubleValue();
          in.jointEfficiency_E     = o.Get("jointEfficiency_E").As<Napi::Number>().DoubleValue();
          in.corrosionAllowance_mm = o.Get("corrosionAllowance_mm").As<Napi::Number>().DoubleValue();
          in.asBuiltThickness_mm   = o.Get("asBuiltThickness_mm").As<Napi::Number>().DoubleValue();
          in.volume_L              = o.Get("volume_L").As<Napi::Number>().DoubleValue();
          in.flowIn_LperS          = o.Get("flowIn_LperS").As<Napi::Number>().DoubleValue();
          in.pressureMax_MPa       = o.Get("pressureMax_MPa").As<Napi::Number>().DoubleValue();
          in.pressureMin_MPa       = o.Get("pressureMin_MPa").As<Napi::Number>().DoubleValue();
          auto r = forge::airrcv::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("tCirc_mm",              Napi::Number::New(env2, r.tCirc_mm));
          out.Set("tLong_mm",              Napi::Number::New(env2, r.tLong_mm));
          out.Set("requiredThickness_mm",  Napi::Number::New(env2, r.requiredThickness_mm));
          out.Set("MAWP_MPa",              Napi::Number::New(env2, r.MAWP_MPa));
          out.Set("chargeTime_s",          Napi::Number::New(env2, r.chargeTime_s));
          return out;
        });
      }));
    exports.Set("airrcv", arNs);

    // ---- Forge-335d — Butterworth IIR filter design ------------------------
    auto bwNs = Napi::Object::New(env);
    bwNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::butter::Input in{};
          in.sampleRate_Hz  = o.Get("sampleRate_Hz").As<Napi::Number>().DoubleValue();
          in.passEdge_Hz    = o.Get("passEdge_Hz").As<Napi::Number>().DoubleValue();
          in.stopEdge_Hz    = o.Get("stopEdge_Hz").As<Napi::Number>().DoubleValue();
          in.passRipple_dB  = o.Get("passRipple_dB").As<Napi::Number>().DoubleValue();
          in.stopAtten_dB   = o.Get("stopAtten_dB").As<Napi::Number>().DoubleValue();
          auto r = forge::butter::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("order_N",        Napi::Number::New(env2, r.order_N));
          out.Set("cutoff_Hz",      Napi::Number::New(env2, r.cutoff_Hz));
          out.Set("analogueOmegaC", Napi::Number::New(env2, r.analogueOmegaC));
          out.Set("b0", Napi::Number::New(env2, r.b0));
          out.Set("b1", Napi::Number::New(env2, r.b1));
          out.Set("b2", Napi::Number::New(env2, r.b2));
          out.Set("a1", Napi::Number::New(env2, r.a1));
          out.Set("a2", Napi::Number::New(env2, r.a2));
          return out;
        });
      }));
    exports.Set("butter", bwNs);

    // ---- Forge-335e — Pedestrian bridge vibration --------------------------
    auto pvbNs2 = Napi::Object::New(env);
    pvbNs2.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::pedvib::Input in{};
          in.span_m                = o.Get("span_m").As<Napi::Number>().DoubleValue();
          in.EI_kNm2               = o.Get("EI_kNm2").As<Napi::Number>().DoubleValue();
          in.linearMass_kgM        = o.Get("linearMass_kgM").As<Napi::Number>().DoubleValue();
          in.pedestrianCountPerM2  = o.Get("pedestrianCountPerM2").As<Napi::Number>().DoubleValue();
          in.bridgeDeckWidth_m     = o.Get("bridgeDeckWidth_m").As<Napi::Number>().DoubleValue();
          auto r = forge::pedvib::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("firstFreq_Hz",              Napi::Number::New(env2, r.firstFreq_Hz));
          out.Set("resonantPedestrianCount",   Napi::Number::New(env2, r.resonantPedestrianCount));
          out.Set("peakAcceleration_mps2",     Napi::Number::New(env2, r.peakAcceleration_mps2));
          out.Set("inVerticalResonance",       Napi::Boolean::New(env2, r.inVerticalResonance));
          out.Set("meetsComfortLimit",         Napi::Boolean::New(env2, r.meetsComfortLimit));
          return out;
        });
      }));
    exports.Set("pedvib", pvbNs2);

    // ---- Forge-336a — Hardy Cross pipe network -----------------------------
    auto pnNs = Napi::Object::New(env);
    pnNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::pipenet::Input in{};
          in.loopCount       = o.Get("loopCount").As<Napi::Number>().Int32Value();
          in.tolerance_Lps   = o.Get("tolerance_Lps").As<Napi::Number>().DoubleValue();
          in.maxIterations   = o.Get("maxIterations").As<Napi::Number>().Int32Value();
          auto pipesJs = o.Get("pipes").As<Napi::Array>();
          for (uint32_t i = 0; i < pipesJs.Length(); ++i) {
              auto p = pipesJs.Get(i).As<Napi::Object>();
              forge::pipenet::Pipe pi{};
              pi.length_m          = p.Get("length_m").As<Napi::Number>().DoubleValue();
              pi.diameter_mm       = p.Get("diameter_mm").As<Napi::Number>().DoubleValue();
              pi.frictionFactor_f  = p.Get("frictionFactor_f").As<Napi::Number>().DoubleValue();
              pi.initialFlow_Lps   = p.Get("initialFlow_Lps").As<Napi::Number>().DoubleValue();
              pi.loopIndex         = p.Get("loopIndex").As<Napi::Number>().Int32Value();
              pi.loopSignCW        = p.Get("loopSignCW").As<Napi::Number>().Int32Value();
              in.pipes.push_back(pi);
          }
          auto r = forge::pipenet::analyse(in);
          auto out = Napi::Object::New(env2);
          auto fJs = Napi::Array::New(env2, r.finalFlows_Lps.size());
          auto hJs = Napi::Array::New(env2, r.headLosses_m.size());
          for (uint32_t i = 0; i < r.finalFlows_Lps.size(); ++i)
              fJs.Set(i, Napi::Number::New(env2, r.finalFlows_Lps[i]));
          for (uint32_t i = 0; i < r.headLosses_m.size(); ++i)
              hJs.Set(i, Napi::Number::New(env2, r.headLosses_m[i]));
          out.Set("finalFlows_Lps",     fJs);
          out.Set("headLosses_m",       hJs);
          out.Set("iterationsUsed",     Napi::Number::New(env2, r.iterationsUsed));
          out.Set("maxCorrection_Lps",  Napi::Number::New(env2, r.maxCorrection_Lps));
          out.Set("converged",          Napi::Boolean::New(env2, r.converged));
          return out;
        });
      }));
    exports.Set("pipenet", pnNs);

    // ---- Forge-336b — Holzer torsional vibration ---------------------------
    auto tvNs = Napi::Object::New(env);
    tvNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::torvib::Input in{};
          in.frequencyLowerBound_Hz = o.Get("frequencyLowerBound_Hz").As<Napi::Number>().DoubleValue();
          in.frequencyUpperBound_Hz = o.Get("frequencyUpperBound_Hz").As<Napi::Number>().DoubleValue();
          in.nModesSought           = o.Get("nModesSought").As<Napi::Number>().Int32Value();
          auto Jjs = o.Get("inertias_kgm2").As<Napi::Array>();
          auto Kjs = o.Get("stiffnesses_NmPerRad").As<Napi::Array>();
          for (uint32_t i = 0; i < Jjs.Length(); ++i)
              in.inertias_kgm2.push_back(Jjs.Get(i).As<Napi::Number>().DoubleValue());
          for (uint32_t i = 0; i < Kjs.Length(); ++i)
              in.stiffnesses_NmPerRad.push_back(Kjs.Get(i).As<Napi::Number>().DoubleValue());
          auto r = forge::torvib::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("iterationsTotal", Napi::Number::New(env2, r.iterationsTotal));
          auto mArr = Napi::Array::New(env2, r.modes.size());
          for (uint32_t i = 0; i < r.modes.size(); ++i) {
              auto m = Napi::Object::New(env2);
              m.Set("frequency_Hz", Napi::Number::New(env2, r.modes[i].frequency_Hz));
              auto sh = Napi::Array::New(env2, r.modes[i].shape.size());
              for (uint32_t j = 0; j < r.modes[i].shape.size(); ++j)
                  sh.Set(j, Napi::Number::New(env2, r.modes[i].shape[j]));
              m.Set("shape", sh);
              mArr.Set(i, m);
          }
          out.Set("modes", mArr);
          return out;
        });
      }));
    exports.Set("torvib", tvNs);

    // ---- Forge-336c — HEC-18 bridge pier scour -----------------------------
    auto psNs2 = Napi::Object::New(env);
    psNs2.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::pierscour::Input in{};
          in.approachVelocity_mps = o.Get("approachVelocity_mps").As<Napi::Number>().DoubleValue();
          in.approachDepth_m      = o.Get("approachDepth_m").As<Napi::Number>().DoubleValue();
          in.pierWidth_m          = o.Get("pierWidth_m").As<Napi::Number>().DoubleValue();
          in.pierLength_m         = o.Get("pierLength_m").As<Napi::Number>().DoubleValue();
          in.attackAngleDeg       = o.Get("attackAngleDeg").As<Napi::Number>().DoubleValue();
          in.pierShape            = o.Get("pierShape").As<Napi::Number>().Int32Value();
          in.bedCondition         = o.Get("bedCondition").As<Napi::Number>().Int32Value();
          in.K4_armoring          = o.Get("K4_armoring").As<Napi::Number>().DoubleValue();
          auto r = forge::pierscour::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("approachFroude_Fr1",  Napi::Number::New(env2, r.approachFroude_Fr1));
          out.Set("K1_shape",            Napi::Number::New(env2, r.K1_shape));
          out.Set("K2_angle",            Napi::Number::New(env2, r.K2_angle));
          out.Set("K3_bed",              Napi::Number::New(env2, r.K3_bed));
          out.Set("scourDepth_ys_m",     Napi::Number::New(env2, r.scourDepth_ys_m));
          out.Set("scourRatio_ysOverY1", Napi::Number::New(env2, r.scourRatio_ysOverY1));
          return out;
        });
      }));
    exports.Set("pierscour", psNs2);

    // ---- Forge-336d — Air-side economizer ----------------------------------
    auto ecNs = Napi::Object::New(env);
    ecNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::econ::Input in{};
          in.oaDryBulb_C         = o.Get("oaDryBulb_C").As<Napi::Number>().DoubleValue();
          in.oaWetBulb_C         = o.Get("oaWetBulb_C").As<Napi::Number>().DoubleValue();
          in.returnDryBulb_C     = o.Get("returnDryBulb_C").As<Napi::Number>().DoubleValue();
          in.returnWetBulb_C     = o.Get("returnWetBulb_C").As<Napi::Number>().DoubleValue();
          in.airMassFlow_kgPerS  = o.Get("airMassFlow_kgPerS").As<Napi::Number>().DoubleValue();
          in.minimumOAfraction   = o.Get("minimumOAfraction").As<Napi::Number>().DoubleValue();
          in.highLimitT_C        = o.Get("highLimitT_C").As<Napi::Number>().DoubleValue();
          in.highLimitH_kJperKg  = o.Get("highLimitH_kJperKg").As<Napi::Number>().DoubleValue();
          in.controlType         = o.Get("controlType").As<Napi::Number>().Int32Value();
          auto r = forge::econ::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("oaEnthalpy_kJperKg",     Napi::Number::New(env2, r.oaEnthalpy_kJperKg));
          out.Set("returnEnthalpy_kJperKg", Napi::Number::New(env2, r.returnEnthalpy_kJperKg));
          out.Set("recommendedOAfraction",  Napi::Number::New(env2, r.recommendedOAfraction));
          out.Set("mixedEnthalpy_kJperKg",  Napi::Number::New(env2, r.mixedEnthalpy_kJperKg));
          out.Set("freeCoolingCapacity_kW", Napi::Number::New(env2, r.freeCoolingCapacity_kW));
          out.Set("economizerActive",       Napi::Boolean::New(env2, r.economizerActive));
          return out;
        });
      }));
    exports.Set("econ", ecNs);

    // ---- Forge-336e — Optical fiber link budget ----------------------------
    auto flNs = Napi::Object::New(env);
    flNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::fiberlink::Input in{};
          in.txPower_dBm              = o.Get("txPower_dBm").As<Napi::Number>().DoubleValue();
          in.rxSensitivity_dBm        = o.Get("rxSensitivity_dBm").As<Napi::Number>().DoubleValue();
          in.systemMargin_dB          = o.Get("systemMargin_dB").As<Napi::Number>().DoubleValue();
          in.fiberAttenuation_dBperKm = o.Get("fiberAttenuation_dBperKm").As<Napi::Number>().DoubleValue();
          in.linkLength_km            = o.Get("linkLength_km").As<Napi::Number>().DoubleValue();
          in.spliceCount              = o.Get("spliceCount").As<Napi::Number>().Int32Value();
          in.connectorCount           = o.Get("connectorCount").As<Napi::Number>().Int32Value();
          in.spliceLoss_dB            = o.Get("spliceLoss_dB").As<Napi::Number>().DoubleValue();
          in.connectorLoss_dB         = o.Get("connectorLoss_dB").As<Napi::Number>().DoubleValue();
          auto r = forge::fiberlink::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("allowableBudget_dB",     Napi::Number::New(env2, r.allowableBudget_dB));
          out.Set("fiberLoss_dB",           Napi::Number::New(env2, r.fiberLoss_dB));
          out.Set("spliceLoss_dB_total",    Napi::Number::New(env2, r.spliceLoss_dB_total));
          out.Set("connectorLoss_dB_total", Napi::Number::New(env2, r.connectorLoss_dB_total));
          out.Set("totalLoss_dB",           Napi::Number::New(env2, r.totalLoss_dB));
          out.Set("remainingMargin_dB",     Napi::Number::New(env2, r.remainingMargin_dB));
          out.Set("maxReach_km",            Napi::Number::New(env2, r.maxReach_km));
          out.Set("linkOK",                 Napi::Boolean::New(env2, r.linkOK));
          return out;
        });
      }));
    exports.Set("fiberlink", flNs);

    // ---- Forge-337a — Biaxial rectangular footing --------------------------
    auto bfNs = Napi::Object::New(env);
    bfNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::biaxfoot::Input in{};
          in.axialLoad_P_kN       = o.Get("axialLoad_P_kN").As<Napi::Number>().DoubleValue();
          in.momentMx_kNm         = o.Get("momentMx_kNm").As<Napi::Number>().DoubleValue();
          in.momentMy_kNm         = o.Get("momentMy_kNm").As<Napi::Number>().DoubleValue();
          in.footingBx_m          = o.Get("footingBx_m").As<Napi::Number>().DoubleValue();
          in.footingBy_m          = o.Get("footingBy_m").As<Napi::Number>().DoubleValue();
          in.allowableBearing_kPa = o.Get("allowableBearing_kPa").As<Napi::Number>().DoubleValue();
          auto r = forge::biaxfoot::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("eccentricity_ex_m", Napi::Number::New(env2, r.eccentricity_ex_m));
          out.Set("eccentricity_ey_m", Napi::Number::New(env2, r.eccentricity_ey_m));
          auto cs = Napi::Array::New(env2, 4);
          for (uint32_t i = 0; i < 4; ++i) cs.Set(i, Napi::Number::New(env2, r.cornerStresses_kPa[i]));
          out.Set("cornerStresses_kPa",  cs);
          out.Set("sigmaMax_kPa",        Napi::Number::New(env2, r.sigmaMax_kPa));
          out.Set("sigmaMin_kPa",        Napi::Number::New(env2, r.sigmaMin_kPa));
          out.Set("upliftDetected",      Napi::Boolean::New(env2, r.upliftDetected));
          out.Set("stable",              Napi::Boolean::New(env2, r.stable));
          out.Set("meyerhofBx_m",        Napi::Number::New(env2, r.meyerhofBx_m));
          out.Set("meyerhofBy_m",        Napi::Number::New(env2, r.meyerhofBy_m));
          return out;
        });
      }));
    exports.Set("biaxfoot", bfNs);

    // ---- Forge-337b — Aluminum extrusion ADM 2020 --------------------------
    auto admNs = Napi::Object::New(env);
    admNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::adm::Input in{};
          in.alloy                  = o.Get("alloy").As<Napi::String>().Utf8Value();
          in.effectiveLength_mm     = o.Get("effectiveLength_mm").As<Napi::Number>().DoubleValue();
          in.radiusOfGyration_mm    = o.Get("radiusOfGyration_mm").As<Napi::Number>().DoubleValue();
          in.flatWidth_b_mm         = o.Get("flatWidth_b_mm").As<Napi::Number>().DoubleValue();
          in.flatThickness_t_mm     = o.Get("flatThickness_t_mm").As<Napi::Number>().DoubleValue();
          in.safetyFactor_Omega     = o.Get("safetyFactor_Omega").As<Napi::Number>().DoubleValue();
          auto r = forge::adm::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("yieldStrength_MPa",          Napi::Number::New(env2, r.yieldStrength_MPa));
          out.Set("ultimateStrength_MPa",       Napi::Number::New(env2, r.ultimateStrength_MPa));
          out.Set("modulus_MPa",                Napi::Number::New(env2, r.modulus_MPa));
          out.Set("slenderness",                Napi::Number::New(env2, r.slenderness));
          out.Set("allowableAxialStress_MPa",   Napi::Number::New(env2, r.allowableAxialStress_MPa));
          out.Set("btRatio",                    Napi::Number::New(env2, r.btRatio));
          out.Set("localBucklingControlled",    Napi::Boolean::New(env2, r.localBucklingControlled));
          return out;
        });
      }));
    exports.Set("adm", admNs);

    // ---- Forge-337c — Morison wave loading ---------------------------------
    auto morNs = Napi::Object::New(env);
    morNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::morison::Input in{};
          in.waveHeight_H_m       = o.Get("waveHeight_H_m").As<Napi::Number>().DoubleValue();
          in.wavePeriod_T_s       = o.Get("wavePeriod_T_s").As<Napi::Number>().DoubleValue();
          in.waterDepth_d_m       = o.Get("waterDepth_d_m").As<Napi::Number>().DoubleValue();
          in.cylinderDiameter_D_m = o.Get("cylinderDiameter_D_m").As<Napi::Number>().DoubleValue();
          in.waterDensity_kgM3    = o.Get("waterDensity_kgM3").As<Napi::Number>().DoubleValue();
          in.inertiaCoeff_CM      = o.Get("inertiaCoeff_CM").As<Napi::Number>().DoubleValue();
          in.dragCoeff_CD         = o.Get("dragCoeff_CD").As<Napi::Number>().DoubleValue();
          in.evaluationDepth_z_m  = o.Get("evaluationDepth_z_m").As<Napi::Number>().DoubleValue();
          auto r = forge::morison::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("waveNumber_k_perM",       Napi::Number::New(env2, r.waveNumber_k_perM));
          out.Set("maxParticleVelocity_mps", Napi::Number::New(env2, r.maxParticleVelocity_mps));
          out.Set("maxParticleAccel_mps2",   Napi::Number::New(env2, r.maxParticleAccel_mps2));
          out.Set("inertiaForcePerM_kN",     Napi::Number::New(env2, r.inertiaForcePerM_kN));
          out.Set("dragForcePerM_kN",        Napi::Number::New(env2, r.dragForcePerM_kN));
          out.Set("resultantPerM_kN",        Napi::Number::New(env2, r.resultantPerM_kN));
          return out;
        });
      }));
    exports.Set("morison", morNs);

    // ---- Forge-337d — Fourier semi-infinite heat ---------------------------
    auto fhNs = Napi::Object::New(env);
    fhNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::fourier::Input in{};
          in.surfaceTemperature_Ts_C   = o.Get("surfaceTemperature_Ts_C").As<Napi::Number>().DoubleValue();
          in.initialTemperature_Tinf_C = o.Get("initialTemperature_Tinf_C").As<Napi::Number>().DoubleValue();
          in.thermalConductivity_k_WmK = o.Get("thermalConductivity_k_WmK").As<Napi::Number>().DoubleValue();
          in.density_rho_kgM3          = o.Get("density_rho_kgM3").As<Napi::Number>().DoubleValue();
          in.specificHeat_cp_JkgK      = o.Get("specificHeat_cp_JkgK").As<Napi::Number>().DoubleValue();
          in.depth_x_m                 = o.Get("depth_x_m").As<Napi::Number>().DoubleValue();
          in.time_t_s                  = o.Get("time_t_s").As<Napi::Number>().DoubleValue();
          auto r = forge::fourier::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("thermalDiffusivity_alpha_m2pers", Napi::Number::New(env2, r.thermalDiffusivity_alpha_m2pers));
          out.Set("normalisedDepth_eta",             Napi::Number::New(env2, r.normalisedDepth_eta));
          out.Set("temperatureAtDepth_C",            Napi::Number::New(env2, r.temperatureAtDepth_C));
          out.Set("surfaceHeatFlux_Wm2",             Napi::Number::New(env2, r.surfaceHeatFlux_Wm2));
          out.Set("penetrationDepth_m",              Napi::Number::New(env2, r.penetrationDepth_m));
          return out;
        });
      }));
    exports.Set("fourier", fhNs);

    // ---- Forge-337e — Simulated annealing on Rosenbrock --------------------
    auto saNs = Napi::Object::New(env);
    saNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::sa::Input in{};
          in.xLower             = o.Get("xLower").As<Napi::Number>().DoubleValue();
          in.xUpper             = o.Get("xUpper").As<Napi::Number>().DoubleValue();
          in.yLower             = o.Get("yLower").As<Napi::Number>().DoubleValue();
          in.yUpper             = o.Get("yUpper").As<Napi::Number>().DoubleValue();
          in.initialTemperature = o.Get("initialTemperature").As<Napi::Number>().DoubleValue();
          in.coolingFactor      = o.Get("coolingFactor").As<Napi::Number>().DoubleValue();
          in.iterationsTotal    = o.Get("iterationsTotal").As<Napi::Number>().Int32Value();
          in.proposalStdDev     = o.Get("proposalStdDev").As<Napi::Number>().DoubleValue();
          in.randomSeed         = o.Get("randomSeed").As<Napi::Number>().Int32Value();
          auto r = forge::sa::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("bestX",            Napi::Number::New(env2, r.bestX));
          out.Set("bestY",            Napi::Number::New(env2, r.bestY));
          out.Set("bestValue",        Napi::Number::New(env2, r.bestValue));
          out.Set("acceptanceRatio",  Napi::Number::New(env2, r.acceptanceRatio));
          out.Set("iterationsRun",    Napi::Number::New(env2, r.iterationsRun));
          out.Set("finalTemperature", Napi::Number::New(env2, r.finalTemperature));
          return out;
        });
      }));
    exports.Set("sa", saNs);

    // ---- Forge-338a — Composite slab ANSI/SDI C-1 --------------------------
    auto csNs = Napi::Object::New(env);
    csNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::compslab::Input in{};
          in.slabConcreteStrength_fc_MPa = o.Get("slabConcreteStrength_fc_MPa").As<Napi::Number>().DoubleValue();
          in.slabThickness_mm            = o.Get("slabThickness_mm").As<Napi::Number>().DoubleValue();
          in.ribHeight_hr_mm             = o.Get("ribHeight_hr_mm").As<Napi::Number>().DoubleValue();
          in.effectiveWidth_b_mm         = o.Get("effectiveWidth_b_mm").As<Napi::Number>().DoubleValue();
          in.studCapacity_Qn_kN          = o.Get("studCapacity_Qn_kN").As<Napi::Number>().DoubleValue();
          in.studCount_perSpan           = o.Get("studCount_perSpan").As<Napi::Number>().Int32Value();
          in.steelArea_mm2               = o.Get("steelArea_mm2").As<Napi::Number>().DoubleValue();
          in.steelDepth_mm               = o.Get("steelDepth_mm").As<Napi::Number>().DoubleValue();
          in.steelYield_Fy_MPa           = o.Get("steelYield_Fy_MPa").As<Napi::Number>().DoubleValue();
          in.Es_GPa                      = o.Get("Es_GPa").As<Napi::Number>().DoubleValue();
          in.Ec_GPa                      = o.Get("Ec_GPa").As<Napi::Number>().DoubleValue();
          in.span_m                      = o.Get("span_m").As<Napi::Number>().DoubleValue();
          in.serviceLoad_w_kNm           = o.Get("serviceLoad_w_kNm").As<Napi::Number>().DoubleValue();
          in.steelI_mm4                  = o.Get("steelI_mm4").As<Napi::Number>().DoubleValue();
          auto r = forge::compslab::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("C_compression_kN",     Napi::Number::New(env2, r.C_compression_kN));
          out.Set("aDepth_mm",            Napi::Number::New(env2, r.aDepth_mm));
          out.Set("phiMn_kNm",            Napi::Number::New(env2, r.phiMn_kNm));
          out.Set("Itransformed_mm4",     Napi::Number::New(env2, r.Itransformed_mm4));
          out.Set("serviceDeflection_mm", Napi::Number::New(env2, r.serviceDeflection_mm));
          out.Set("partialComposite",     Napi::Boolean::New(env2, r.partialComposite));
          return out;
        });
      }));
    exports.Set("compslab", csNs);

    // ---- Forge-338b — Sabine reverberation T_60 ----------------------------
    auto rvNs = Napi::Object::New(env);
    rvNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::reverb::Input in{};
          in.roomVolume_m3 = o.Get("roomVolume_m3").As<Napi::Number>().DoubleValue();
          auto surfJs = o.Get("surfaces").As<Napi::Array>();
          for (uint32_t i = 0; i < surfJs.Length(); ++i) {
              auto s = surfJs.Get(i).As<Napi::Object>();
              forge::reverb::Surface su{};
              su.area_m2          = s.Get("area_m2").As<Napi::Number>().DoubleValue();
              su.absorption_alpha = s.Get("absorption_alpha").As<Napi::Number>().DoubleValue();
              in.surfaces.push_back(su);
          }
          auto r = forge::reverb::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("absorptionTotal_m2", Napi::Number::New(env2, r.absorptionTotal_m2));
          out.Set("T60_s",              Napi::Number::New(env2, r.T60_s));
          out.Set("STI_estimate",       Napi::Number::New(env2, r.STI_estimate));
          out.Set("intelligible",       Napi::Boolean::New(env2, r.intelligible));
          return out;
        });
      }));
    exports.Set("reverb", rvNs);

    // ---- Forge-338c — Adiabatic flame CH4/air ------------------------------
    auto flmNs = Napi::Object::New(env);
    flmNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::flame::Input in{};
          in.LHV_CH4_kJperKmol       = o.Get("LHV_CH4_kJperKmol").As<Napi::Number>().DoubleValue();
          in.equivalenceRatio_phi    = o.Get("equivalenceRatio_phi").As<Napi::Number>().DoubleValue();
          in.initialTemperature_C    = o.Get("initialTemperature_C").As<Napi::Number>().DoubleValue();
          auto r = forge::flame::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("airExcessFraction",      Napi::Number::New(env2, r.airExcessFraction));
          out.Set("productMoles_CO2",       Napi::Number::New(env2, r.productMoles_CO2));
          out.Set("productMoles_H2O",       Napi::Number::New(env2, r.productMoles_H2O));
          out.Set("productMoles_N2",        Napi::Number::New(env2, r.productMoles_N2));
          out.Set("productMoles_O2",        Napi::Number::New(env2, r.productMoles_O2));
          out.Set("adiabaticFlameTemp_K",   Napi::Number::New(env2, r.adiabaticFlameTemp_K));
          out.Set("adiabaticFlameTemp_C",   Napi::Number::New(env2, r.adiabaticFlameTemp_C));
          return out;
        });
      }));
    exports.Set("flame", flmNs);

    // ---- Forge-338d — MSE per-layer pullout FHWA-NHI-10-024 ----------------
    auto mspNs = Napi::Object::New(env);
    mspNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::msepull::Input in{};
          in.wallHeight_H_m              = o.Get("wallHeight_H_m").As<Napi::Number>().DoubleValue();
          in.depthBelowCrest_z_m         = o.Get("depthBelowCrest_z_m").As<Napi::Number>().DoubleValue();
          in.verticalSpacing_Sv_m        = o.Get("verticalSpacing_Sv_m").As<Napi::Number>().DoubleValue();
          in.soilFrictionAngleDeg_phi    = o.Get("soilFrictionAngleDeg_phi").As<Napi::Number>().DoubleValue();
          in.soilUnitWeight_gamma_kNm3   = o.Get("soilUnitWeight_gamma_kNm3").As<Napi::Number>().DoubleValue();
          in.surchargeQ_kNm2             = o.Get("surchargeQ_kNm2").As<Napi::Number>().DoubleValue();
          in.reinforcementCoverage_Rc    = o.Get("reinforcementCoverage_Rc").As<Napi::Number>().DoubleValue();
          in.pulloutResistanceFactor_F   = o.Get("pulloutResistanceFactor_F").As<Napi::Number>().DoubleValue();
          in.scaleEffectAlpha            = o.Get("scaleEffectAlpha").As<Napi::Number>().DoubleValue();
          in.safetyFactorSF              = o.Get("safetyFactorSF").As<Napi::Number>().DoubleValue();
          in.isInextensibleBar           = o.Get("isInextensibleBar").As<Napi::Boolean>().Value();
          auto r = forge::msepull::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("Ka",                                 Napi::Number::New(env2, r.Ka));
          out.Set("KrOverKa",                           Napi::Number::New(env2, r.KrOverKa));
          out.Set("Kr",                                 Napi::Number::New(env2, r.Kr));
          out.Set("verticalEffectiveStress_sigmaV_kPa", Napi::Number::New(env2, r.verticalEffectiveStress_sigmaV_kPa));
          out.Set("maxLayerTension_Tmax_kNperM",        Napi::Number::New(env2, r.maxLayerTension_Tmax_kNperM));
          out.Set("requiredEmbedmentLength_Le_m",       Napi::Number::New(env2, r.requiredEmbedmentLength_Le_m));
          out.Set("activeZoneLength_La_m",              Napi::Number::New(env2, r.activeZoneLength_La_m));
          out.Set("totalReinforcementLength_L_m",       Napi::Number::New(env2, r.totalReinforcementLength_L_m));
          return out;
        });
      }));
    exports.Set("msepull", mspNs);

    // ---- Forge-338e — Bayesian beta-binomial -------------------------------
    auto bayesNs = Napi::Object::New(env);
    bayesNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::bayes::Input in{};
          in.priorAlpha     = o.Get("priorAlpha").As<Napi::Number>().DoubleValue();
          in.priorBeta      = o.Get("priorBeta").As<Napi::Number>().DoubleValue();
          in.trials_n       = o.Get("trials_n").As<Napi::Number>().Int32Value();
          in.successes_k    = o.Get("successes_k").As<Napi::Number>().Int32Value();
          in.credibleLevel  = o.Get("credibleLevel").As<Napi::Number>().DoubleValue();
          auto r = forge::bayes::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("posteriorAlpha",          Napi::Number::New(env2, r.posteriorAlpha));
          out.Set("posteriorBeta",           Napi::Number::New(env2, r.posteriorBeta));
          out.Set("posteriorMean",           Napi::Number::New(env2, r.posteriorMean));
          out.Set("posteriorMode",           Napi::Number::New(env2, r.posteriorMode));
          out.Set("posteriorStdDev",         Napi::Number::New(env2, r.posteriorStdDev));
          out.Set("credibleIntervalLower",   Napi::Number::New(env2, r.credibleIntervalLower));
          out.Set("credibleIntervalUpper",   Napi::Number::New(env2, r.credibleIntervalUpper));
          out.Set("posteriorPredictiveProb", Napi::Number::New(env2, r.posteriorPredictiveProb));
          return out;
        });
      }));
    exports.Set("bayes", bayesNs);

    // ---- Forge-339a — NRCS TR-55 Curve-Number runoff -----------------------
    auto cnNs = Napi::Object::New(env);
    cnNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::cn::Input in{};
          in.curveNumber_CN          = o.Get("curveNumber_CN").As<Napi::Number>().DoubleValue();
          in.rainfall_P_mm           = o.Get("rainfall_P_mm").As<Napi::Number>().DoubleValue();
          in.drainageArea_km2        = o.Get("drainageArea_km2").As<Napi::Number>().DoubleValue();
          in.timeOfConcentration_Tc_h= o.Get("timeOfConcentration_Tc_h").As<Napi::Number>().DoubleValue();
          auto r = forge::cn::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("maxRetention_S_mm",        Napi::Number::New(env2, r.maxRetention_S_mm));
          out.Set("initialAbstraction_Ia_mm", Napi::Number::New(env2, r.initialAbstraction_Ia_mm));
          out.Set("runoffDepth_Q_mm",         Napi::Number::New(env2, r.runoffDepth_Q_mm));
          out.Set("runoffVolume_m3",          Napi::Number::New(env2, r.runoffVolume_m3));
          out.Set("peakFlow_qp_m3PerS",       Napi::Number::New(env2, r.peakFlow_qp_m3PerS));
          return out;
        });
      }));
    exports.Set("cn", cnNs);

    // ---- Forge-339b — Rectangular waveguide TE/TM modes --------------------
    auto wvgNs = Napi::Object::New(env);
    wvgNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::waveguide::Input in{};
          in.broadDim_a_mm        = o.Get("broadDim_a_mm").As<Napi::Number>().DoubleValue();
          in.narrowDim_b_mm       = o.Get("narrowDim_b_mm").As<Napi::Number>().DoubleValue();
          in.dielectric_eps_r     = o.Get("dielectric_eps_r").As<Napi::Number>().DoubleValue();
          in.operatingFreq_GHz    = o.Get("operatingFreq_GHz").As<Napi::Number>().DoubleValue();
          in.modeM                = o.Get("modeM").As<Napi::Number>().Int32Value();
          in.modeN                = o.Get("modeN").As<Napi::Number>().Int32Value();
          auto r = forge::waveguide::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("cutoffFreq_GHz",            Napi::Number::New(env2, r.cutoffFreq_GHz));
          out.Set("cutoffWavelength_mm",       Napi::Number::New(env2, r.cutoffWavelength_mm));
          out.Set("phaseConstant_beta_perM",   Napi::Number::New(env2, r.phaseConstant_beta_perM));
          out.Set("guidedWavelength_mm",       Napi::Number::New(env2, r.guidedWavelength_mm));
          out.Set("groupVelocity_mps",         Napi::Number::New(env2, r.groupVelocity_mps));
          out.Set("isPropagating",             Napi::Boolean::New(env2, r.isPropagating));
          return out;
        });
      }));
    exports.Set("waveguide", wvgNs);

    // ---- Forge-339c — Sluice gate underflow discharge ----------------------
    auto slcNs = Napi::Object::New(env);
    slcNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::sluice::Input in{};
          in.gateOpening_a_m     = o.Get("gateOpening_a_m").As<Napi::Number>().DoubleValue();
          in.upstreamHead_h_m    = o.Get("upstreamHead_h_m").As<Napi::Number>().DoubleValue();
          in.gateWidth_b_m       = o.Get("gateWidth_b_m").As<Napi::Number>().DoubleValue();
          in.tailwaterDepth_yt_m = o.Get("tailwaterDepth_yt_m").As<Napi::Number>().DoubleValue();
          in.useContractedCd     = o.Get("useContractedCd").As<Napi::Boolean>().Value();
          auto r = forge::sluice::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("dischargeCoefficient_Cd", Napi::Number::New(env2, r.dischargeCoefficient_Cd));
          out.Set("specificDischarge_qPerM", Napi::Number::New(env2, r.specificDischarge_qPerM));
          out.Set("totalDischarge_Q_m3s",    Napi::Number::New(env2, r.totalDischarge_Q_m3s));
          out.Set("venaContracta_y2_m",      Napi::Number::New(env2, r.venaContracta_y2_m));
          out.Set("isSubmerged",             Napi::Boolean::New(env2, r.isSubmerged));
          return out;
        });
      }));
    exports.Set("sluice", slcNs);

    // ---- Forge-339d — SI engine knock margin -------------------------------
    auto kncNs = Napi::Object::New(env);
    kncNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::knock::Input in{};
          in.compressionRatio            = o.Get("compressionRatio").As<Napi::Number>().DoubleValue();
          in.intakeTemp_T1_K             = o.Get("intakeTemp_T1_K").As<Napi::Number>().DoubleValue();
          in.intakePressure_p1_kPa       = o.Get("intakePressure_p1_kPa").As<Napi::Number>().DoubleValue();
          in.specificHeatRatio_gamma     = o.Get("specificHeatRatio_gamma").As<Napi::Number>().DoubleValue();
          in.octaneRON                   = o.Get("octaneRON").As<Napi::Number>().DoubleValue();
          in.octaneMON                   = o.Get("octaneMON").As<Napi::Number>().DoubleValue();
          in.criticalAutoignition_Ta_K   = o.Get("criticalAutoignition_Ta_K").As<Napi::Number>().DoubleValue();
          auto r = forge::knock::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("endGasTemp_T2_K",       Napi::Number::New(env2, r.endGasTemp_T2_K));
          out.Set("endGasPressure_p2_kPa", Napi::Number::New(env2, r.endGasPressure_p2_kPa));
          out.Set("knockLimitedCR",        Napi::Number::New(env2, r.knockLimitedCR));
          out.Set("antiKnockIndex",        Napi::Number::New(env2, r.antiKnockIndex));
          out.Set("octaneMargin",          Napi::Number::New(env2, r.octaneMargin));
          out.Set("willKnock",             Napi::Boolean::New(env2, r.willKnock));
          return out;
        });
      }));
    exports.Set("knock", kncNs);

    // ---- Forge-339e — Project NPV / IRR / LCOE -----------------------------
    auto npvNs = Napi::Object::New(env);
    npvNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::npv::Input in{};
          in.initialCapex_USD = o.Get("initialCapex_USD").As<Napi::Number>().DoubleValue();
          in.discountRate_pct = o.Get("discountRate_pct").As<Napi::Number>().DoubleValue();
          auto cf = o.Get("cashflows_USD").As<Napi::Array>();
          for (uint32_t i = 0; i < cf.Length(); ++i)
              in.cashflows_USD.push_back(cf.Get(i).As<Napi::Number>().DoubleValue());
          if (o.Has("annualEnergy_kWh")) {
              auto eg = o.Get("annualEnergy_kWh").As<Napi::Array>();
              for (uint32_t i = 0; i < eg.Length(); ++i)
                  in.annualEnergy_kWh.push_back(eg.Get(i).As<Napi::Number>().DoubleValue());
          }
          if (o.Has("annualOpex_USD")) {
              auto op = o.Get("annualOpex_USD").As<Napi::Array>();
              for (uint32_t i = 0; i < op.Length(); ++i)
                  in.annualOpex_USD.push_back(op.Get(i).As<Napi::Number>().DoubleValue());
          }
          auto r = forge::npv::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("NPV_USD",         Napi::Number::New(env2, r.NPV_USD));
          out.Set("IRR_pct",         Napi::Number::New(env2, r.IRR_pct));
          out.Set("paybackYears",    Napi::Number::New(env2, r.paybackYears));
          out.Set("LCOE_USDperKWh",  Napi::Number::New(env2, r.LCOE_USDperKWh));
          return out;
        });
      }));
    exports.Set("npv", npvNs);

    // ---- Forge-340a — CMU in-plane shear wall ------------------------------
    auto cmushNs = Napi::Object::New(env);
    cmushNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::cmushear::Input in{};
          in.Vu_kN                       = o.Get("Vu_kN").As<Napi::Number>().DoubleValue();
          in.Mu_kNm                      = o.Get("Mu_kNm").As<Napi::Number>().DoubleValue();
          in.netArea_An_mm2              = o.Get("netArea_An_mm2").As<Napi::Number>().DoubleValue();
          in.wallLength_dv_mm            = o.Get("wallLength_dv_mm").As<Napi::Number>().DoubleValue();
          in.primeMasonryStrength_fm_MPa = o.Get("primeMasonryStrength_fm_MPa").As<Napi::Number>().DoubleValue();
          in.horizReinfArea_Av_mm2       = o.Get("horizReinfArea_Av_mm2").As<Napi::Number>().DoubleValue();
          in.horizReinfSpacing_s_mm      = o.Get("horizReinfSpacing_s_mm").As<Napi::Number>().DoubleValue();
          in.horizReinfYield_fy_MPa      = o.Get("horizReinfYield_fy_MPa").As<Napi::Number>().DoubleValue();
          in.phi                         = o.Get("phi").As<Napi::Number>().DoubleValue();
          auto r = forge::cmushear::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("M_over_Vd",      Napi::Number::New(env2, r.M_over_Vd));
          out.Set("Vnm_kN",         Napi::Number::New(env2, r.Vnm_kN));
          out.Set("Vns_kN",         Napi::Number::New(env2, r.Vns_kN));
          out.Set("Vn_kN",          Napi::Number::New(env2, r.Vn_kN));
          out.Set("VnMax_kN",       Napi::Number::New(env2, r.VnMax_kN));
          out.Set("Vn_governed_kN", Napi::Number::New(env2, r.Vn_governed_kN));
          out.Set("phiVn_kN",       Napi::Number::New(env2, r.phiVn_kN));
          out.Set("meetsDemand",    Napi::Boolean::New(env2, r.meetsDemand));
          return out;
        });
      }));
    exports.Set("cmushear", cmushNs);

    // ---- Forge-340b — Slip-critical AISC §J3.8 -----------------------------
    auto scrtNs = Napi::Object::New(env);
    scrtNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::sccrit::Input in{};
          in.slipCoefficient_mu  = o.Get("slipCoefficient_mu").As<Napi::Number>().DoubleValue();
          in.fillerCount_hf      = o.Get("fillerCount_hf").As<Napi::Number>().Int32Value();
          in.pretension_Tb_kN    = o.Get("pretension_Tb_kN").As<Napi::Number>().DoubleValue();
          in.slipPlaneCount_ns   = o.Get("slipPlaneCount_ns").As<Napi::Number>().Int32Value();
          in.boltCount_nb        = o.Get("boltCount_nb").As<Napi::Number>().Int32Value();
          in.Tu_per_bolt_kN      = o.Get("Tu_per_bolt_kN").As<Napi::Number>().DoubleValue();
          in.phi_for_holeType    = o.Get("phi_for_holeType").As<Napi::Number>().DoubleValue();
          auto r = forge::sccrit::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("Du",              Napi::Number::New(env2, r.Du));
          out.Set("hf",              Napi::Number::New(env2, r.hf));
          out.Set("Ksc_reduction",   Napi::Number::New(env2, r.Ksc_reduction));
          out.Set("Rn_per_bolt_kN",  Napi::Number::New(env2, r.Rn_per_bolt_kN));
          out.Set("Rn_total_kN",     Napi::Number::New(env2, r.Rn_total_kN));
          out.Set("phiRn_total_kN",  Napi::Number::New(env2, r.phiRn_total_kN));
          return out;
        });
      }));
    exports.Set("sccrit", scrtNs);

    // ---- Forge-340c — Active chilled beam ----------------------------------
    auto chbNs = Napi::Object::New(env);
    chbNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::chbeam::Input in{};
          in.zoneTemp_C              = o.Get("zoneTemp_C").As<Napi::Number>().DoubleValue();
          in.primaryAirTemp_C        = o.Get("primaryAirTemp_C").As<Napi::Number>().DoubleValue();
          in.primaryAirFlow_LperS    = o.Get("primaryAirFlow_LperS").As<Napi::Number>().DoubleValue();
          in.chilledWaterFlow_LperMin= o.Get("chilledWaterFlow_LperMin").As<Napi::Number>().DoubleValue();
          in.chilledWaterIn_C        = o.Get("chilledWaterIn_C").As<Napi::Number>().DoubleValue();
          in.chilledWaterOut_C       = o.Get("chilledWaterOut_C").As<Napi::Number>().DoubleValue();
          in.inductionRatio_Ki       = o.Get("inductionRatio_Ki").As<Napi::Number>().DoubleValue();
          in.zoneArea_m2             = o.Get("zoneArea_m2").As<Napi::Number>().DoubleValue();
          in.occupantCount           = o.Get("occupantCount").As<Napi::Number>().Int32Value();
          auto r = forge::chbeam::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("primaryAirSensible_kW",    Napi::Number::New(env2, r.primaryAirSensible_kW));
          out.Set("coilSensible_kW",          Napi::Number::New(env2, r.coilSensible_kW));
          out.Set("totalCooling_kW",          Napi::Number::New(env2, r.totalCooling_kW));
          out.Set("requiredOutsideAir_LperS", Napi::Number::New(env2, r.requiredOutsideAir_LperS));
          out.Set("oaCompliance",             Napi::Number::New(env2, r.oaCompliance));
          out.Set("meetsOA",                  Napi::Boolean::New(env2, r.meetsOA));
          return out;
        });
      }));
    exports.Set("chbeam", chbNs);

    // ---- Forge-340d — AWS welding heat input -------------------------------
    auto whiNs = Napi::Object::New(env);
    whiNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::weldhi::Input in{};
          in.arcEfficiency_eta        = o.Get("arcEfficiency_eta").As<Napi::Number>().DoubleValue();
          in.voltage_V                = o.Get("voltage_V").As<Napi::Number>().DoubleValue();
          in.current_A                = o.Get("current_A").As<Napi::Number>().DoubleValue();
          in.travelSpeed_mmPerS       = o.Get("travelSpeed_mmPerS").As<Napi::Number>().DoubleValue();
          in.plateThickness_mm        = o.Get("plateThickness_mm").As<Napi::Number>().DoubleValue();
          in.preheatTemp_C            = o.Get("preheatTemp_C").As<Napi::Number>().DoubleValue();
          in.thermalConductivity_k_WmK= o.Get("thermalConductivity_k_WmK").As<Napi::Number>().DoubleValue();
          in.densityRho_kgM3          = o.Get("densityRho_kgM3").As<Napi::Number>().DoubleValue();
          in.specificHeat_cp_JkgK     = o.Get("specificHeat_cp_JkgK").As<Napi::Number>().DoubleValue();
          auto r = forge::weldhi::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("heatInput_kJperMm",      Napi::Number::New(env2, r.heatInput_kJperMm));
          out.Set("tEightFive_s",           Napi::Number::New(env2, r.tEightFive_s));
          out.Set("maxHAZWidthEstimate_mm", Napi::Number::New(env2, r.maxHAZWidthEstimate_mm));
          out.Set("thermalCycleSeverity",   Napi::Number::New(env2, r.thermalCycleSeverity));
          return out;
        });
      }));
    exports.Set("weldhi", whiNs);

    // ---- Forge-340e — Markov chain stationary ------------------------------
    auto mkNs = Napi::Object::New(env);
    mkNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::markov::Input in{};
          in.stateCount             = o.Get("stateCount").As<Napi::Number>().Int32Value();
          in.iterationCount         = o.Get("iterationCount").As<Napi::Number>().Int32Value();
          in.powerMethodMaxIter     = o.Get("powerMethodMaxIter").As<Napi::Number>().Int32Value();
          in.powerMethodTolerance   = o.Get("powerMethodTolerance").As<Napi::Number>().DoubleValue();
          auto P = o.Get("transitionMatrix").As<Napi::Array>();
          for (uint32_t i = 0; i < P.Length(); ++i)
              in.transitionMatrix.push_back(P.Get(i).As<Napi::Number>().DoubleValue());
          auto p0 = o.Get("initialDistribution").As<Napi::Array>();
          for (uint32_t i = 0; i < p0.Length(); ++i)
              in.initialDistribution.push_back(p0.Get(i).As<Napi::Number>().DoubleValue());
          auto r = forge::markov::analyse(in);
          auto out = Napi::Object::New(env2);
          auto pn = Napi::Array::New(env2, r.distributionAtN.size());
          for (uint32_t i = 0; i < r.distributionAtN.size(); ++i)
              pn.Set(i, Napi::Number::New(env2, r.distributionAtN[i]));
          auto st = Napi::Array::New(env2, r.stationary.size());
          for (uint32_t i = 0; i < r.stationary.size(); ++i)
              st.Set(i, Napi::Number::New(env2, r.stationary[i]));
          out.Set("distributionAtN",     pn);
          out.Set("stationary",          st);
          out.Set("stationaryConverged", Napi::Boolean::New(env2, r.stationaryConverged));
          out.Set("iterationsUsed",      Napi::Number::New(env2, r.iterationsUsed));
          return out;
        });
      }));
    exports.Set("markov", mkNs);

    // ---- Forge-341a — Soldier-pile wall FHWA -------------------------------
    auto spNs3 = Napi::Object::New(env);
    spNs3.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::soldierpile::Input in{};
          in.wallHeight_H_m            = o.Get("wallHeight_H_m").As<Napi::Number>().DoubleValue();
          in.soilFrictionAngleDeg_phi  = o.Get("soilFrictionAngleDeg_phi").As<Napi::Number>().DoubleValue();
          in.soilUnitWeight_kNm3       = o.Get("soilUnitWeight_kNm3").As<Napi::Number>().DoubleValue();
          in.surcharge_q_kNm2          = o.Get("surcharge_q_kNm2").As<Napi::Number>().DoubleValue();
          in.pileSpacing_S_m           = o.Get("pileSpacing_S_m").As<Napi::Number>().DoubleValue();
          in.soldierPileDepth_d_mm     = o.Get("soldierPileDepth_d_mm").As<Napi::Number>().DoubleValue();
          in.soldierPileFy_MPa         = o.Get("soldierPileFy_MPa").As<Napi::Number>().DoubleValue();
          auto r = forge::soldierpile::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("Ka",                          Napi::Number::New(env2, r.Ka));
          out.Set("Kp",                          Napi::Number::New(env2, r.Kp));
          out.Set("activePressureAtBase_kPa",    Napi::Number::New(env2, r.activePressureAtBase_kPa));
          out.Set("totalActiveForce_kNperM",     Napi::Number::New(env2, r.totalActiveForce_kNperM));
          out.Set("requiredEmbedment_m",         Napi::Number::New(env2, r.requiredEmbedment_m));
          out.Set("maxBendingMoment_kNm_perPile",Napi::Number::New(env2, r.maxBendingMoment_kNm_perPile));
          out.Set("maxFiberStress_MPa",          Napi::Number::New(env2, r.maxFiberStress_MPa));
          return out;
        });
      }));
    exports.Set("soldierpile", spNs3);

    // ---- Forge-341b — Round HSS bending AISC §F8 ---------------------------
    auto rhssNs = Napi::Object::New(env);
    rhssNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::roundhss::Input in{};
          in.outsideDiameter_D_mm = o.Get("outsideDiameter_D_mm").As<Napi::Number>().DoubleValue();
          in.wallThickness_t_mm   = o.Get("wallThickness_t_mm").As<Napi::Number>().DoubleValue();
          in.Fy_MPa               = o.Get("Fy_MPa").As<Napi::Number>().DoubleValue();
          in.E_GPa                = o.Get("E_GPa").As<Napi::Number>().DoubleValue();
          auto r = forge::roundhss::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("DoverT",                Napi::Number::New(env2, r.DoverT));
          out.Set("lambda_p",              Napi::Number::New(env2, r.lambda_p));
          out.Set("lambda_r",              Napi::Number::New(env2, r.lambda_r));
          out.Set("classification",        Napi::Number::New(env2, r.classification));
          out.Set("plasticModulus_Z_mm3",  Napi::Number::New(env2, r.plasticModulus_Z_mm3));
          out.Set("elasticModulus_S_mm3",  Napi::Number::New(env2, r.elasticModulus_S_mm3));
          out.Set("Mn_kNm",                Napi::Number::New(env2, r.Mn_kNm));
          out.Set("phiMn_kNm",             Napi::Number::New(env2, r.phiMn_kNm));
          return out;
        });
      }));
    exports.Set("roundhss", rhssNs);

    // ---- Forge-341c — Plate HX ε-NTU ---------------------------------------
    auto ehxNs = Napi::Object::New(env);
    ehxNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::ehx::Input in{};
          in.hotInletTemp_Th_in_C  = o.Get("hotInletTemp_Th_in_C").As<Napi::Number>().DoubleValue();
          in.coldInletTemp_Tc_in_C = o.Get("coldInletTemp_Tc_in_C").As<Napi::Number>().DoubleValue();
          in.hotMassFlow_kgPerS    = o.Get("hotMassFlow_kgPerS").As<Napi::Number>().DoubleValue();
          in.coldMassFlow_kgPerS   = o.Get("coldMassFlow_kgPerS").As<Napi::Number>().DoubleValue();
          in.hotCp_kJperKgK        = o.Get("hotCp_kJperKgK").As<Napi::Number>().DoubleValue();
          in.coldCp_kJperKgK       = o.Get("coldCp_kJperKgK").As<Napi::Number>().DoubleValue();
          in.UA_kWperK             = o.Get("UA_kWperK").As<Napi::Number>().DoubleValue();
          in.flowArrangement       = o.Get("flowArrangement").As<Napi::Number>().Int32Value();
          auto r = forge::ehx::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("Cmin_kWperK",     Napi::Number::New(env2, r.Cmin_kWperK));
          out.Set("Cmax_kWperK",     Napi::Number::New(env2, r.Cmax_kWperK));
          out.Set("Cr",              Napi::Number::New(env2, r.Cr));
          out.Set("NTU",             Napi::Number::New(env2, r.NTU));
          out.Set("effectiveness",   Napi::Number::New(env2, r.effectiveness));
          out.Set("heatTransfer_kW", Napi::Number::New(env2, r.heatTransfer_kW));
          out.Set("hotOutletTemp_C", Napi::Number::New(env2, r.hotOutletTemp_C));
          out.Set("coldOutletTemp_C",Napi::Number::New(env2, r.coldOutletTemp_C));
          return out;
        });
      }));
    exports.Set("ehx", ehxNs);

    // ---- Forge-341d — FOSM reliability β -----------------------------------
    auto fosmNs = Napi::Object::New(env);
    fosmNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::fosm::Input in{};
          in.meanR             = o.Get("meanR").As<Napi::Number>().DoubleValue();
          in.sigmaR            = o.Get("sigmaR").As<Napi::Number>().DoubleValue();
          in.meanS             = o.Get("meanS").As<Napi::Number>().DoubleValue();
          in.sigmaS            = o.Get("sigmaS").As<Napi::Number>().DoubleValue();
          in.correlation_rho   = o.Get("correlation_rho").As<Napi::Number>().DoubleValue();
          auto r = forge::fosm::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("mean_g",                Napi::Number::New(env2, r.mean_g));
          out.Set("sigma_g",               Napi::Number::New(env2, r.sigma_g));
          out.Set("beta",                  Napi::Number::New(env2, r.beta));
          out.Set("probabilityOfFailure",  Napi::Number::New(env2, r.probabilityOfFailure));
          out.Set("safetyMarginCV",        Napi::Number::New(env2, r.safetyMarginCV));
          return out;
        });
      }));
    exports.Set("fosm", fosmNs);

    // ---- Forge-341e — Bridge deck flutter (Selberg) ------------------------
    auto flutNs = Napi::Object::New(env);
    flutNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto o = info[0].As<Napi::Object>();
          forge::flutter::Input in{};
          in.deckWidth_B_m              = o.Get("deckWidth_B_m").As<Napi::Number>().DoubleValue();
          in.linearMass_kgPerM          = o.Get("linearMass_kgPerM").As<Napi::Number>().DoubleValue();
          in.torsionalFreq_falpha_Hz    = o.Get("torsionalFreq_falpha_Hz").As<Napi::Number>().DoubleValue();
          in.heaveFreq_fh_Hz            = o.Get("heaveFreq_fh_Hz").As<Napi::Number>().DoubleValue();
          in.airDensity_kgM3            = o.Get("airDensity_kgM3").As<Napi::Number>().DoubleValue();
          in.designWindSpeed_Vd_mps     = o.Get("designWindSpeed_Vd_mps").As<Napi::Number>().DoubleValue();
          auto r = forge::flutter::analyse(in);
          auto out = Napi::Object::New(env2);
          out.Set("halfWidth_b_m",            Napi::Number::New(env2, r.halfWidth_b_m));
          out.Set("massRatio_mu",             Napi::Number::New(env2, r.massRatio_mu));
          out.Set("criticalWindSpeed_Ucr_mps",Napi::Number::New(env2, r.criticalWindSpeed_Ucr_mps));
          out.Set("reducedVelocity_atVd",     Napi::Number::New(env2, r.reducedVelocity_atVd));
          out.Set("safetyFactorUcrOverVd",    Napi::Number::New(env2, r.safetyFactorUcrOverVd));
          out.Set("stable",                   Napi::Boolean::New(env2, r.stable));
          return out;
        });
      }));
    exports.Set("flutter", flutNs);


    // ---- PUSH-07 — Class-A surfacing (zebra, combs, G0-G3, K/H, stitchG2,
    //                guided sweep) layered on top of forge.surfacing ----
    auto clsaNs = Napi::Object::New(env);

    clsaNs.Set("zebraStripes", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto h = requireHandle(info, 0);
          std::uint32_t stripeCount = info[1].As<Napi::Number>().Uint32Value();
          if (!info[2].IsArray() && !info[2].IsTypedArray()) {
            throw Napi::TypeError::New(env2,
              "forge.classa.zebraStripes: lightDir must be [x,y,z]");
          }
          double lx = 0, ly = 0, lz = 1;
          if (info[2].IsTypedArray()) {
            auto ta = info[2].As<Napi::Float64Array>();
            if (ta.ElementLength() < 3) {
              throw Napi::TypeError::New(env2,
                "forge.classa.zebraStripes: lightDir must have 3 elements");
            }
            lx = ta.Data()[0]; ly = ta.Data()[1]; lz = ta.Data()[2];
          } else {
            auto a = info[2].As<Napi::Array>();
            if (a.Length() < 3) {
              throw Napi::TypeError::New(env2,
                "forge.classa.zebraStripes: lightDir must have 3 elements");
            }
            lx = a.Get(uint32_t{0}).As<Napi::Number>().DoubleValue();
            ly = a.Get(uint32_t{1}).As<Napi::Number>().DoubleValue();
            lz = a.Get(uint32_t{2}).As<Napi::Number>().DoubleValue();
          }
          std::uint32_t uS = (info.Length() > 3 && info[3].IsNumber())
            ? info[3].As<Napi::Number>().Uint32Value() : 32u;
          std::uint32_t vS = (info.Length() > 4 && info[4].IsNumber())
            ? info[4].As<Napi::Number>().Uint32Value() : 32u;
          auto rows = forge::classa::zebraStripes(h, stripeCount, lx, ly, lz, uS, vS);
          auto arr = Napi::Array::New(env2, rows.size());
          for (std::size_t i = 0; i < rows.size(); ++i) {
            auto o = Napi::Object::New(env2);
            o.Set("u",            Napi::Number::New(env2, rows[i].u));
            o.Set("v",            Napi::Number::New(env2, rows[i].v));
            o.Set("stripeIndex",  Napi::Number::New(env2,
              static_cast<double>(rows[i].stripeIndex)));
            o.Set("normalAngle",  Napi::Number::New(env2, rows[i].normalAngle));
            arr.Set(static_cast<uint32_t>(i), o);
          }
          return arr;
        });
      }));

    clsaNs.Set("curvatureComb", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto h = requireHandle(info, 0);
          std::uint32_t samples = info[1].As<Napi::Number>().Uint32Value();
          double scale = info[2].As<Napi::Number>().DoubleValue();
          auto rows = forge::classa::curvatureComb(h, samples, scale);
          auto arr = Napi::Array::New(env2, rows.size());
          for (std::size_t i = 0; i < rows.size(); ++i) {
            auto o = Napi::Object::New(env2);
            o.Set("u", Napi::Number::New(env2, rows[i].u));
            auto p = Napi::Array::New(env2, 3);
            p.Set(uint32_t{0}, rows[i].position3d[0]);
            p.Set(uint32_t{1}, rows[i].position3d[1]);
            p.Set(uint32_t{2}, rows[i].position3d[2]);
            o.Set("position3d", p);
            auto t = Napi::Array::New(env2, 3);
            t.Set(uint32_t{0}, rows[i].combTip3d[0]);
            t.Set(uint32_t{1}, rows[i].combTip3d[1]);
            t.Set(uint32_t{2}, rows[i].combTip3d[2]);
            o.Set("combTip3d", t);
            o.Set("curvature", Napi::Number::New(env2, rows[i].curvature));
            arr.Set(static_cast<uint32_t>(i), o);
          }
          return arr;
        });
      }));

    clsaNs.Set("continuityCheck", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto fA = requireHandle(info, 0);
          auto fB = requireHandle(info, 1);
          auto eS = requireHandle(info, 2);
          std::uint32_t samples = (info.Length() > 3 && info[3].IsNumber())
            ? info[3].As<Napi::Number>().Uint32Value() : 32u;
          auto r = forge::classa::continuityCheck(fA, fB, eS, samples);
          auto o = Napi::Object::New(env2);
          o.Set("g0_max_mm",     Napi::Number::New(env2, r.g0_max_mm));
          o.Set("g1_max_deg",    Napi::Number::New(env2, r.g1_max_deg));
          o.Set("g2_max_pct",    Napi::Number::New(env2, r.g2_max_pct));
          o.Set("g3_max_pct",    Napi::Number::New(env2, r.g3_max_pct));
          o.Set("g3_continuity", Napi::Boolean::New(env2, r.g3_continuity));
          o.Set("samples",       Napi::Number::New(env2,
            static_cast<double>(r.samples)));
          return o;
        });
      }));

    clsaNs.Set("gaussianAndMeanCurvature", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto h = requireHandle(info, 0);
          std::uint32_t uS = (info.Length() > 1 && info[1].IsNumber())
            ? info[1].As<Napi::Number>().Uint32Value() : 16u;
          std::uint32_t vS = (info.Length() > 2 && info[2].IsNumber())
            ? info[2].As<Napi::Number>().Uint32Value() : 16u;
          auto rows = forge::classa::gaussianAndMeanCurvature(h, uS, vS);
          auto arr = Napi::Array::New(env2, rows.size());
          for (std::size_t i = 0; i < rows.size(); ++i) {
            auto o = Napi::Object::New(env2);
            o.Set("u",          Napi::Number::New(env2, rows[i].u));
            o.Set("v",          Napi::Number::New(env2, rows[i].v));
            o.Set("K_gaussian", Napi::Number::New(env2, rows[i].K_gaussian));
            o.Set("H_mean",     Napi::Number::New(env2, rows[i].H_mean));
            o.Set("kappaMax",   Napi::Number::New(env2, rows[i].kappaMax));
            o.Set("kappaMin",   Napi::Number::New(env2, rows[i].kappaMin));
            arr.Set(static_cast<uint32_t>(i), o);
          }
          return arr;
        });
      }));

    clsaNs.Set("stitchG2", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (!info[0].IsArray()) {
            throw Napi::TypeError::New(env2,
              "forge.classa.stitchG2: expected handle array");
          }
          auto a = info[0].As<Napi::Array>();
          std::vector<forge::ShapeHandle> handles;
          handles.reserve(a.Length());
          for (uint32_t i = 0; i < a.Length(); ++i) {
            handles.push_back(a.Get(i).As<Napi::Number>().Uint32Value());
          }
          double tol = (info.Length() > 1 && info[1].IsNumber())
            ? info[1].As<Napi::Number>().DoubleValue() : 1e-3;
          bool reportCont = (info.Length() > 2 && info[2].IsBoolean())
            ? info[2].As<Napi::Boolean>().Value() : true;
          auto r = forge::classa::stitchG2(handles, tol, reportCont);
          auto o = Napi::Object::New(env2);
          o.Set("handle",    Napi::Number::New(env2,
            static_cast<double>(r.handle)));
          o.Set("edgeCount", Napi::Number::New(env2,
            static_cast<double>(r.edgeCount)));
          auto rep = Napi::Array::New(env2, r.reports.size());
          for (std::size_t i = 0; i < r.reports.size(); ++i) {
            auto rr = Napi::Object::New(env2);
            rr.Set("g0_max_mm",     Napi::Number::New(env2,
              r.reports[i].g0_max_mm));
            rr.Set("g1_max_deg",    Napi::Number::New(env2,
              r.reports[i].g1_max_deg));
            rr.Set("g2_max_pct",    Napi::Number::New(env2,
              r.reports[i].g2_max_pct));
            rr.Set("g3_max_pct",    Napi::Number::New(env2,
              r.reports[i].g3_max_pct));
            rr.Set("g3_continuity", Napi::Boolean::New(env2,
              r.reports[i].g3_continuity));
            rr.Set("samples",       Napi::Number::New(env2,
              static_cast<double>(r.reports[i].samples)));
            rep.Set(static_cast<uint32_t>(i), rr);
          }
          o.Set("reports", rep);
          return o;
        });
      }));

    clsaNs.Set("sweepWithGuides", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto profile = requireHandle(info, 0);
          auto spine   = requireHandle(info, 1);
          std::vector<forge::ShapeHandle> guides;
          if (info.Length() > 2 && info[2].IsArray()) {
            auto a = info[2].As<Napi::Array>();
            guides.reserve(a.Length());
            for (uint32_t i = 0; i < a.Length(); ++i) {
              guides.push_back(a.Get(i).As<Napi::Number>().Uint32Value());
            }
          }
          bool isFrenet = (info.Length() > 3 && info[3].IsBoolean())
            ? info[3].As<Napi::Boolean>().Value() : false;
          bool isSolid  = (info.Length() > 4 && info[4].IsBoolean())
            ? info[4].As<Napi::Boolean>().Value() : false;
          return Napi::Number::New(env2,
            forge::classa::sweepWithGuides(profile, spine, guides, isFrenet, isSolid));
        });
      }));

    exports.Set("classa", clsaNs);

    // ---- PUSH-06 — Sheet metal extended (gauge / BA / unfold / DXF / cost) -
    auto sxNs = Napi::Object::New(env);

    sxNs.Set("gaugeProperties", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
            throw Napi::TypeError::New(env2,
              "forge.sheetextend.gaugeProperties(material:string, gauge:int)");
          }
          std::string mat = info[0].As<Napi::String>().Utf8Value();
          int gauge       = info[1].As<Napi::Number>().Int32Value();
          auto g = forge::sheetextend::gaugeProperties(mat, gauge);
          auto out = Napi::Object::New(env2);
          out.Set("thickness_mm",      Napi::Number::New(env2, g.thickness_mm));
          out.Set("density_kgPerM3",   Napi::Number::New(env2, g.density_kgPerM3));
          out.Set("kFactor_default",   Napi::Number::New(env2, g.kFactor_default));
          out.Set("yieldStrength_MPa", Napi::Number::New(env2, g.yieldStrength_MPa));
          return out;
        });
      }));

    sxNs.Set("bendAllowance", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 4) {
            throw Napi::TypeError::New(env2,
              "forge.sheetextend.bendAllowance(angleDeg, R, t, K)");
          }
          double angle = info[0].As<Napi::Number>().DoubleValue();
          double R     = info[1].As<Napi::Number>().DoubleValue();
          double t     = info[2].As<Napi::Number>().DoubleValue();
          double K     = info[3].As<Napi::Number>().DoubleValue();
          auto b = forge::sheetextend::bendAllowance(angle, R, t, K);
          auto out = Napi::Object::New(env2);
          out.Set("bendAllowance_mm",  Napi::Number::New(env2, b.bendAllowance_mm));
          out.Set("bendDeduction_mm",  Napi::Number::New(env2, b.bendDeduction_mm));
          out.Set("neutralRadius_mm",  Napi::Number::New(env2, b.neutralRadius_mm));
          out.Set("outsideSetback_mm", Napi::Number::New(env2, b.outsideSetback_mm));
          return out;
        });
      }));

    sxNs.Set("flatten", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsArray() ||
              !info[2].IsNumber()) {
            throw Napi::TypeError::New(env2,
              "forge.sheetextend.flatten(solidPart:handle, bends:Array, thickness_mm)");
          }
          uint32_t h = info[0].As<Napi::Number>().Uint32Value();
          auto arr   = info[1].As<Napi::Array>();
          double t   = info[2].As<Napi::Number>().DoubleValue();
          std::vector<forge::sheetextend::BendDef> defs;
          defs.reserve(arr.Length());
          for (uint32_t i = 0; i < arr.Length(); ++i) {
            auto o = arr.Get(i).As<Napi::Object>();
            forge::sheetextend::BendDef d{};
            d.bendLineEdgeIndex = o.Get("bendLineEdgeIndex").As<Napi::Number>().Uint32Value();
            d.angleDeg          = o.Get("angleDeg").As<Napi::Number>().DoubleValue();
            d.innerRadius_mm    = o.Get("innerRadius_mm").As<Napi::Number>().DoubleValue();
            d.kFactor           = o.Get("kFactor").As<Napi::Number>().DoubleValue();
            defs.push_back(d);
          }
          uint32_t newH = forge::sheetextend::flatten(h, defs, t);
          return Napi::Number::New(env2, newH);
        });
      }));

    sxNs.Set("exportDxf", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
            throw Napi::TypeError::New(env2,
              "forge.sheetextend.exportDxf(flatShape:handle, path:string, bends?:Array)");
          }
          uint32_t h         = info[0].As<Napi::Number>().Uint32Value();
          std::string path   = info[1].As<Napi::String>().Utf8Value();
          std::vector<forge::sheetextend::BendDef> defs;
          if (info.Length() >= 3 && info[2].IsArray()) {
            auto arr = info[2].As<Napi::Array>();
            defs.reserve(arr.Length());
            for (uint32_t i = 0; i < arr.Length(); ++i) {
              auto o = arr.Get(i).As<Napi::Object>();
              forge::sheetextend::BendDef d{};
              d.bendLineEdgeIndex = o.Get("bendLineEdgeIndex").As<Napi::Number>().Uint32Value();
              d.angleDeg          = o.Has("angleDeg")       ? o.Get("angleDeg").As<Napi::Number>().DoubleValue()       : 90.0;
              d.innerRadius_mm    = o.Has("innerRadius_mm") ? o.Get("innerRadius_mm").As<Napi::Number>().DoubleValue() : 1.0;
              d.kFactor           = o.Has("kFactor")        ? o.Get("kFactor").As<Napi::Number>().DoubleValue()        : 0.42;
              defs.push_back(d);
            }
          }
          std::size_t bytes = forge::sheetextend::exportDxf(h, path, defs);
          return Napi::Number::New(env2, static_cast<double>(bytes));
        });
      }));

    sxNs.Set("cornerRelief", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 4 || !info[0].IsNumber()) {
            throw Napi::TypeError::New(env2,
              "forge.sheetextend.cornerRelief(bentPart, w, d, type:string)");
          }
          uint32_t h      = info[0].As<Napi::Number>().Uint32Value();
          double w        = info[1].As<Napi::Number>().DoubleValue();
          double d        = info[2].As<Napi::Number>().DoubleValue();
          std::string ts  = info[3].As<Napi::String>().Utf8Value();
          forge::sheetextend::ReliefType type = forge::sheetextend::ReliefType::Round;
          if      (ts == "round")       type = forge::sheetextend::ReliefType::Round;
          else if (ts == "rectangular") type = forge::sheetextend::ReliefType::Rectangular;
          else if (ts == "tear")        type = forge::sheetextend::ReliefType::Tear;
          else throw Napi::TypeError::New(env2,
              "forge.sheetextend.cornerRelief: type must be round|rectangular|tear");
          uint32_t newH = forge::sheetextend::cornerRelief(h, w, d, type);
          return Napi::Number::New(env2, newH);
        });
      }));

    sxNs.Set("cost", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 5) {
            throw Napi::TypeError::New(env2,
              "forge.sheetextend.cost(flatPart, density_kgPerM3, pricePerKgUSD, "
              "laserCutSpeedMmPerS, pierceCount)");
          }
          uint32_t h    = info[0].As<Napi::Number>().Uint32Value();
          double rho    = info[1].As<Napi::Number>().DoubleValue();
          double price  = info[2].As<Napi::Number>().DoubleValue();
          double speed  = info[3].As<Napi::Number>().DoubleValue();
          double pierce = info[4].As<Napi::Number>().DoubleValue();
          auto c = forge::sheetextend::cost(h, rho, price, speed, pierce);
          auto out = Napi::Object::New(env2);
          out.Set("mass_kg",     Napi::Number::New(env2, c.mass_kg));
          out.Set("cutTime_s",   Napi::Number::New(env2, c.cutTime_s));
          out.Set("materialUSD", Napi::Number::New(env2, c.materialUSD));
          out.Set("cutUSD",      Napi::Number::New(env2, c.cutUSD));
          out.Set("totalUSD",    Napi::Number::New(env2, c.totalUSD));
          return out;
        });
      }));

    exports.Set("sheetextend", sxNs);

    // ===================================================================
    // PUSH-18 — Tolerant fuzzy booleans (forge::booleantol)
    // ===================================================================
    auto bfNs2 = Napi::Object::New(env);
    bfNs2.Set("fuse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          const auto a = requireHandle(info, 0);
          const auto b = requireHandle(info, 1);
          const double fuzz = requireNumber(info, 2, "fuzz");
          return Napi::Number::New(info.Env(),
              forge::booleantol::fuse(a, b, fuzz));
        });
      }));
    bfNs2.Set("cut", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          const auto a = requireHandle(info, 0);
          const auto b = requireHandle(info, 1);
          const double fuzz = requireNumber(info, 2, "fuzz");
          return Napi::Number::New(info.Env(),
              forge::booleantol::cut(a, b, fuzz));
        });
      }));
    bfNs2.Set("common", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          const auto a = requireHandle(info, 0);
          const auto b = requireHandle(info, 1);
          const double fuzz = requireNumber(info, 2, "fuzz");
          return Napi::Number::New(info.Env(),
              forge::booleantol::common(a, b, fuzz));
        });
      }));
    exports.Set("booleantol", bfNs2);

    // ===================================================================
    // PUSH-18 — Shape validation (forge::shapecheck)
    // ===================================================================
    auto chkNs = Napi::Object::New(env);
    chkNs.Set("analyse", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          const auto h = requireHandle(info, 0);
          auto rep = forge::shapecheck::analyse(h);
          auto out = Napi::Object::New(env2);
          out.Set("valid",        Napi::Boolean::New(env2, rep.valid));
          out.Set("faultyCount",  Napi::Number::New(env2, rep.faultyCount));
          auto faults = Napi::Array::New(env2, rep.faultStrings.size());
          for (std::size_t i = 0; i < rep.faultStrings.size(); ++i) {
            faults.Set(static_cast<uint32_t>(i),
                       Napi::String::New(env2, rep.faultStrings[i]));
          }
          out.Set("faultStrings", faults);
          return out;
        });
      }));
    exports.Set("shapecheck", chkNs);

    // ===================================================================
    // PUSH-18 — ShapeFix_Shape repair (forge::shapefix)
    // ===================================================================
    auto fixNs = Napi::Object::New(env);
    fixNs.Set("repair", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          const auto h = requireHandle(info, 0);
          const double prec = info.Length() > 1 && info[1].IsNumber()
              ? info[1].As<Napi::Number>().DoubleValue() : 0.0;
          const double minT = info.Length() > 2 && info[2].IsNumber()
              ? info[2].As<Napi::Number>().DoubleValue() : 0.0;
          const double maxT = info.Length() > 3 && info[3].IsNumber()
              ? info[3].As<Napi::Number>().DoubleValue() : 0.0;
          auto r = forge::shapefix::repair(h, prec, minT, maxT);
          auto out = Napi::Object::New(env2);
          out.Set("handle", Napi::Number::New(env2, r.handle));
          auto log = Napi::Array::New(env2, r.log.size());
          for (std::size_t i = 0; i < r.log.size(); ++i) {
            log.Set(static_cast<uint32_t>(i),
                    Napi::String::New(env2, r.log[i]));
          }
          out.Set("log", log);
          return out;
        });
      }));
    exports.Set("shapefix", fixNs);

    // ===================================================================
    // PUSH-18 — Multi-shape sewing (forge::sewing)
    // ===================================================================
    auto sewNs = Napi::Object::New(env);
    sewNs.Set("sew", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 1 || !info[0].IsArray()) {
            throw Napi::TypeError::New(env2,
                "sewing.sew(shapes[], tolerance): first arg must be array of handles");
          }
          auto arr = info[0].As<Napi::Array>();
          std::vector<ShapeHandle> shapes;
          shapes.reserve(arr.Length());
          for (uint32_t i = 0; i < arr.Length(); ++i) {
            auto v = arr.Get(i);
            if (!v.IsNumber()) {
              throw Napi::TypeError::New(env2,
                  "sewing.sew: shape array entries must all be numbers");
            }
            shapes.push_back(v.As<Napi::Number>().Uint32Value());
          }
          const double tol = info.Length() > 1 && info[1].IsNumber()
              ? info[1].As<Napi::Number>().DoubleValue() : 1.0e-3;
          auto r = forge::sewing::sew(shapes, tol);
          auto out = Napi::Object::New(env2);
          out.Set("handle", Napi::Number::New(env2, r.handle));
          auto rep = Napi::Object::New(env2);
          rep.Set("inputShapeCount",   Napi::Number::New(env2, static_cast<double>(r.report.inputShapeCount)));
          rep.Set("freeEdges",         Napi::Number::New(env2, static_cast<double>(r.report.freeEdges)));
          rep.Set("multipleEdges",     Napi::Number::New(env2, static_cast<double>(r.report.multipleEdges)));
          rep.Set("contiguousEdges",   Napi::Number::New(env2, static_cast<double>(r.report.contiguousEdges)));
          rep.Set("degeneratedShapes", Napi::Number::New(env2, static_cast<double>(r.report.degeneratedShapes)));
          out.Set("report", rep);
          return out;
        });
      }));
    exports.Set("sewing", sewNs);

    // ===================================================================
    // PUSH-18 — Variable-radius fillet via Law_Function (forge::varfillet)
    // ===================================================================
    auto vfNs = Napi::Object::New(env);
    vfNs.Set("fillet", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          const auto solidH = requireHandle(info, 0);
          if (info.Length() < 2 || !info[1].IsArray()) {
            throw Napi::TypeError::New(env2,
                "varfillet.fillet(solid, specs[], smooth?): specs must be array");
          }
          auto specsArr = info[1].As<Napi::Array>();
          std::vector<forge::varfillet::EdgeSpec> specs;
          specs.reserve(specsArr.Length());
          for (uint32_t i = 0; i < specsArr.Length(); ++i) {
            auto v = specsArr.Get(i);
            if (!v.IsObject()) {
              throw Napi::TypeError::New(env2,
                  "varfillet.fillet: each spec entry must be an object");
            }
            auto obj = v.As<Napi::Object>();
            forge::varfillet::EdgeSpec sp{};
            sp.edgeIndex   = obj.Get("edgeIndex").As<Napi::Number>().Uint32Value();
            sp.radiusStart = obj.Get("radiusStart").As<Napi::Number>().DoubleValue();
            sp.radiusEnd   = obj.Get("radiusEnd").As<Napi::Number>().DoubleValue();
            specs.push_back(sp);
          }
          const bool smooth = info.Length() > 2 && info[2].IsBoolean()
              ? info[2].As<Napi::Boolean>().Value() : false;
          ShapeHandle h = forge::varfillet::fillet(solidH, specs, smooth);
          return Napi::Number::New(env2, h);
        });
      }));
    exports.Set("varfillet", vfNs);

    // ===================================================================
    // PUSH-18 — Guided loft via BRepOffsetAPI_ThruSections (forge::loftguide)
    // ===================================================================
    auto lgNs = Napi::Object::New(env);
    lgNs.Set("loft", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 1 || !info[0].IsArray()) {
            throw Napi::TypeError::New(env2,
                "loftguide.loft(profileWires[], guideEdges[], solid, ruled?): "
                "profileWires must be array");
          }
          auto profArr = info[0].As<Napi::Array>();
          std::vector<ShapeHandle> profiles;
          profiles.reserve(profArr.Length());
          for (uint32_t i = 0; i < profArr.Length(); ++i) {
            profiles.push_back(profArr.Get(i).As<Napi::Number>().Uint32Value());
          }
          std::vector<ShapeHandle> guides;
          if (info.Length() > 1 && info[1].IsArray()) {
            auto gArr = info[1].As<Napi::Array>();
            guides.reserve(gArr.Length());
            for (uint32_t i = 0; i < gArr.Length(); ++i) {
              guides.push_back(gArr.Get(i).As<Napi::Number>().Uint32Value());
            }
          }
          const bool solid = info.Length() > 2 && info[2].IsBoolean()
              ? info[2].As<Napi::Boolean>().Value() : true;
          const bool ruled = info.Length() > 3 && info[3].IsBoolean()
              ? info[3].As<Napi::Boolean>().Value() : false;
          ShapeHandle h = forge::loftguide::loft(profiles, guides, solid, ruled);
          return Napi::Number::New(env2, h);
        });
      }));
    exports.Set("loftguide", lgNs);

    // ===================================================================
    // PUSH-04 — Assembly mate solver (forge::matelib). 12 SW-equivalent
    // mate kinds; damped Gauss-Seidel; returns converged poses + log.
    // ===================================================================
    auto mlNs = Napi::Object::New(env);
    mlNs.Set("solve", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 2 || !info[0].IsArray() || !info[1].IsArray()) {
            throw Napi::TypeError::New(env2,
                "matelib.solve(poses[], mates[], maxIter?, tol?): "
                "poses and mates must be arrays");
          }
          auto posArr  = info[0].As<Napi::Array>();
          auto mateArr = info[1].As<Napi::Array>();
          int    maxIter = (info.Length() > 2 && info[2].IsNumber())
              ? info[2].As<Napi::Number>().Int32Value() : 200;
          double tol     = (info.Length() > 3 && info[3].IsNumber())
              ? info[3].As<Napi::Number>().DoubleValue() : 1e-6;

          std::vector<forge::matelib::ComponentPose> poses;
          poses.reserve(posArr.Length());
          for (uint32_t i = 0; i < posArr.Length(); ++i) {
            auto o = posArr.Get(i).As<Napi::Object>();
            forge::matelib::ComponentPose p{};
            p.id = o.Get("id").As<Napi::Number>().Int32Value();
            auto tA = o.Get("t").As<Napi::Array>();
            auto qA = o.Get("q").As<Napi::Array>();
            for (int j = 0; j < 3; ++j) p.t[j] = tA.Get(j).As<Napi::Number>().DoubleValue();
            for (int j = 0; j < 4; ++j) p.q[j] = qA.Get(j).As<Napi::Number>().DoubleValue();
            p.fixed = o.Has("fixed")
                ? o.Get("fixed").As<Napi::Number>().Int32Value() : 0;
            poses.push_back(p);
          }

          auto readRef = [](const Napi::Object& obj) -> forge::matelib::MateRef {
            forge::matelib::MateRef r{};
            r.component_id = obj.Get("component_id").As<Napi::Number>().Int32Value();
            auto pA = obj.Get("point").As<Napi::Array>();
            auto aA = obj.Get("axis").As<Napi::Array>();
            for (int j = 0; j < 3; ++j) r.point[j] = pA.Get(j).As<Napi::Number>().DoubleValue();
            for (int j = 0; j < 3; ++j) r.axis[j]  = aA.Get(j).As<Napi::Number>().DoubleValue();
            r.extra = obj.Has("extra")
                ? obj.Get("extra").As<Napi::Number>().DoubleValue() : 0.0;
            return r;
          };

          std::vector<forge::matelib::Mate> mates;
          mates.reserve(mateArr.Length());
          for (uint32_t i = 0; i < mateArr.Length(); ++i) {
            auto o = mateArr.Get(i).As<Napi::Object>();
            forge::matelib::Mate m{};
            m.kind  = o.Get("kind").As<Napi::String>().Utf8Value();
            m.A     = readRef(o.Get("A").As<Napi::Object>());
            m.B     = readRef(o.Get("B").As<Napi::Object>());
            m.value = o.Has("value")
                ? o.Get("value").As<Napi::Number>().DoubleValue() : 0.0;
            mates.push_back(m);
          }

          auto rs = forge::matelib::solve(poses, mates, maxIter, tol);

          auto outPoses = Napi::Array::New(env2, rs.poses.size());
          for (uint32_t i = 0; i < rs.poses.size(); ++i) {
            const auto& p = rs.poses[i];
            auto o = Napi::Object::New(env2);
            o.Set("id", Napi::Number::New(env2, p.id));
            auto tA = Napi::Array::New(env2, 3);
            auto qA = Napi::Array::New(env2, 4);
            for (uint32_t j = 0; j < 3; ++j) tA.Set(j, Napi::Number::New(env2, p.t[j]));
            for (uint32_t j = 0; j < 4; ++j) qA.Set(j, Napi::Number::New(env2, p.q[j]));
            o.Set("t", tA);
            o.Set("q", qA);
            o.Set("fixed", Napi::Number::New(env2, p.fixed));
            outPoses.Set(i, o);
          }

          auto logArr = Napi::Array::New(env2, rs.log.size());
          for (uint32_t i = 0; i < rs.log.size(); ++i) {
            logArr.Set(i, Napi::String::New(env2, rs.log[i]));
          }

          auto result = Napi::Object::New(env2);
          result.Set("poses",      outPoses);
          result.Set("converged",  Napi::Boolean::New(env2, rs.converged));
          result.Set("iterations", Napi::Number::New(env2, rs.iterations));
          result.Set("residual",   Napi::Number::New(env2, rs.residual));
          result.Set("log",        logArr);
          return result;
        });
      }));
    exports.Set("matelib", mlNs);

    // ===================================================================
    // PUSH-10 — Extended CAM (forge::camx)
    //   listTools / pocketToolpath / contourToolpath / drillToolpath /
    //   postProcess / estimateCycleTime
    // ===================================================================
    auto camxNs = Napi::Object::New(env);

    // Helper lambdas (file-scope-local in the Init body).
    auto readPt2Array = [](Napi::Env e2, Napi::Value v, const char* what)
        -> std::vector<forge::camx::Pt2> {
        if (!v.IsArray()) {
            throw Napi::TypeError::New(e2,
                std::string("forge.camx: ") + what + " must be an array");
        }
        auto arr = v.As<Napi::Array>();
        std::vector<forge::camx::Pt2> out;
        out.reserve(arr.Length());
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            auto entry = arr.Get(i);
            if (!entry.IsObject()) {
                throw Napi::TypeError::New(e2,
                    std::string("forge.camx: ") + what + "[i] must be an object {x,y}");
            }
            auto obj = entry.As<Napi::Object>();
            forge::camx::Pt2 p{};
            p.x = obj.Get("x").As<Napi::Number>().DoubleValue();
            p.y = obj.Get("y").As<Napi::Number>().DoubleValue();
            out.push_back(p);
        }
        return out;
    };

    auto readBoundary = [&readPt2Array](Napi::Env e2, Napi::Value v)
        -> forge::camx::Boundary {
        if (!v.IsArray()) {
            throw Napi::TypeError::New(e2,
                "forge.camx: boundary must be vector<vector<{x,y}>>");
        }
        auto outer = v.As<Napi::Array>();
        forge::camx::Boundary b;
        b.reserve(outer.Length());
        for (uint32_t i = 0; i < outer.Length(); ++i) {
            b.push_back(readPt2Array(e2, outer.Get(i), "boundary[i]"));
        }
        return b;
    };

    auto packPolyline3 = [](Napi::Env e2,
                            const forge::camx::Polyline3& pl) -> Napi::Array {
        auto arr = Napi::Array::New(e2, pl.size());
        for (size_t i = 0; i < pl.size(); ++i) {
            auto o = Napi::Object::New(e2);
            o.Set("x", Napi::Number::New(e2, pl[i].x));
            o.Set("y", Napi::Number::New(e2, pl[i].y));
            o.Set("z", Napi::Number::New(e2, pl[i].z));
            arr.Set(static_cast<uint32_t>(i), o);
        }
        return arr;
    };

    auto packPolylineList = [&packPolyline3](
        Napi::Env e2, const std::vector<forge::camx::Polyline3>& pls)
        -> Napi::Array {
        auto arr = Napi::Array::New(e2, pls.size());
        for (size_t i = 0; i < pls.size(); ++i) {
            arr.Set(static_cast<uint32_t>(i), packPolyline3(e2, pls[i]));
        }
        return arr;
    };

    auto readPolylineList = [&readPt2Array](Napi::Env e2, Napi::Value v)
        -> std::vector<forge::camx::Polyline3> {
        if (!v.IsArray()) {
            throw Napi::TypeError::New(e2,
                "forge.camx: segments must be an array of polylines");
        }
        auto arr = v.As<Napi::Array>();
        std::vector<forge::camx::Polyline3> out;
        out.reserve(arr.Length());
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            auto poly = arr.Get(i);
            if (!poly.IsArray()) {
                throw Napi::TypeError::New(e2,
                    "forge.camx: each segment must be an array of {x,y,z}");
            }
            auto pa = poly.As<Napi::Array>();
            forge::camx::Polyline3 pl;
            pl.reserve(pa.Length());
            for (uint32_t j = 0; j < pa.Length(); ++j) {
                auto pe = pa.Get(j);
                if (!pe.IsObject()) {
                    throw Napi::TypeError::New(e2,
                        "forge.camx: segment point must be an object {x,y,z}");
                }
                auto obj = pe.As<Napi::Object>();
                forge::camx::Pt3 p3{};
                p3.x = obj.Get("x").As<Napi::Number>().DoubleValue();
                p3.y = obj.Get("y").As<Napi::Number>().DoubleValue();
                p3.z = obj.Get("z").As<Napi::Number>().DoubleValue();
                pl.push_back(p3);
            }
            out.push_back(std::move(pl));
        }
        (void)readPt2Array; // silence unused-warning if not exercised
        return out;
    };

    camxNs.Set("listTools", Napi::Function::New(env,
      [](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          auto tools = forge::camx::listTools();
          auto arr = Napi::Array::New(env2, tools.size());
          for (size_t i = 0; i < tools.size(); ++i) {
            auto o = Napi::Object::New(env2);
            o.Set("id",           Napi::Number::New(env2, tools[i].id));
            o.Set("type",         Napi::Number::New(env2, static_cast<int>(tools[i].type)));
            o.Set("diameter",     Napi::Number::New(env2, tools[i].diameter));
            o.Set("fluteLength",  Napi::Number::New(env2, tools[i].fluteLength));
            o.Set("totalLength",  Napi::Number::New(env2, tools[i].totalLength));
            o.Set("flutes",       Napi::Number::New(env2, tools[i].flutes));
            o.Set("material",     Napi::String::New(env2, tools[i].material));
            o.Set("maxRPM",       Napi::Number::New(env2, tools[i].maxRPM));
            o.Set("feedPerTooth", Napi::Number::New(env2, tools[i].feedPerTooth));
            arr.Set(static_cast<uint32_t>(i), o);
          }
          return arr;
        });
      }));

    camxNs.Set("pocketToolpath", Napi::Function::New(env,
      [readBoundary, packPolylineList](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 3) {
            throw Napi::TypeError::New(env2,
                "forge.camx.pocketToolpath(boundary, toolId, params)");
          }
          auto boundary = readBoundary(env2, info[0]);
          std::uint32_t toolId = info[1].As<Napi::Number>().Uint32Value();
          auto po = info[2].As<Napi::Object>();
          forge::camx::PocketParams pp{};
          pp.depth    = po.Get("depth").As<Napi::Number>().DoubleValue();
          pp.stepdown = po.Get("stepdown").As<Napi::Number>().DoubleValue();
          pp.stepover = po.Get("stepover").As<Napi::Number>().DoubleValue();
          auto dirVal = po.Get("direction");
          if (dirVal.IsString()) {
            std::string s = dirVal.As<Napi::String>().Utf8Value();
            pp.climb = (s == "climb");
          } else {
            pp.climb = true;
          }
          auto result = forge::camx::pocketToolpath(boundary, toolId, pp);
          return packPolylineList(env2, result);
        });
      }));

    camxNs.Set("contourToolpath", Napi::Function::New(env,
      [packPolylineList](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 4) {
            throw Napi::TypeError::New(env2,
                "forge.camx.contourToolpath(polyline, toolId, side, params)");
          }
          if (!info[0].IsArray()) {
            throw Napi::TypeError::New(env2,
                "forge.camx.contourToolpath: polyline must be array of {x,y}");
          }
          auto pa = info[0].As<Napi::Array>();
          forge::camx::Polygon poly;
          poly.reserve(pa.Length());
          for (uint32_t i = 0; i < pa.Length(); ++i) {
            auto obj = pa.Get(i).As<Napi::Object>();
            forge::camx::Pt2 p{};
            p.x = obj.Get("x").As<Napi::Number>().DoubleValue();
            p.y = obj.Get("y").As<Napi::Number>().DoubleValue();
            poly.push_back(p);
          }
          std::uint32_t toolId = info[1].As<Napi::Number>().Uint32Value();
          forge::camx::ContourSide side = forge::camx::ContourSide_On;
          if (info[2].IsString()) {
            std::string s = info[2].As<Napi::String>().Utf8Value();
            if (s == "inside")       side = forge::camx::ContourSide_Inside;
            else if (s == "outside") side = forge::camx::ContourSide_Outside;
            else if (s == "on")      side = forge::camx::ContourSide_On;
            else throw Napi::TypeError::New(env2,
                "forge.camx.contourToolpath: side must be 'inside'|'outside'|'on'");
          } else if (info[2].IsNumber()) {
            side = static_cast<forge::camx::ContourSide>(
                info[2].As<Napi::Number>().Int32Value());
          }
          auto po = info[3].As<Napi::Object>();
          forge::camx::ContourParams cp{};
          cp.depth    = po.Get("depth").As<Napi::Number>().DoubleValue();
          cp.stepdown = po.Get("stepdown").As<Napi::Number>().DoubleValue();
          auto dirVal = po.Get("direction");
          if (dirVal.IsString()) {
            cp.climb = (dirVal.As<Napi::String>().Utf8Value() == "climb");
          } else {
            cp.climb = true;
          }
          auto result = forge::camx::contourToolpath(poly, toolId, side, cp);
          return packPolylineList(env2, result);
        });
      }));

    camxNs.Set("drillToolpath", Napi::Function::New(env,
      [packPolylineList](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 4) {
            throw Napi::TypeError::New(env2,
                "forge.camx.drillToolpath(holes, toolId, cycle, params)");
          }
          if (!info[0].IsArray()) {
            throw Napi::TypeError::New(env2,
                "forge.camx.drillToolpath: holes must be array of {x,y}");
          }
          auto ha = info[0].As<Napi::Array>();
          std::vector<forge::camx::Pt2> holes;
          holes.reserve(ha.Length());
          for (uint32_t i = 0; i < ha.Length(); ++i) {
            auto obj = ha.Get(i).As<Napi::Object>();
            forge::camx::Pt2 p{};
            p.x = obj.Get("x").As<Napi::Number>().DoubleValue();
            p.y = obj.Get("y").As<Napi::Number>().DoubleValue();
            holes.push_back(p);
          }
          std::uint32_t toolId = info[1].As<Napi::Number>().Uint32Value();
          forge::camx::DrillCycle cy = forge::camx::DrillCycle_G81;
          if (info[2].IsString()) {
            std::string s = info[2].As<Napi::String>().Utf8Value();
            if      (s == "G81") cy = forge::camx::DrillCycle_G81;
            else if (s == "G83") cy = forge::camx::DrillCycle_G83;
            else throw Napi::TypeError::New(env2,
                "forge.camx.drillToolpath: cycle must be 'G81' or 'G83'");
          } else if (info[2].IsNumber()) {
            cy = static_cast<forge::camx::DrillCycle>(
                info[2].As<Napi::Number>().Int32Value());
          }
          auto po = info[3].As<Napi::Object>();
          forge::camx::DrillParams dp{};
          dp.depth   = po.Get("depth").As<Napi::Number>().DoubleValue();
          dp.retract = po.Get("retract").As<Napi::Number>().DoubleValue();
          auto pv = po.Get("peck");
          dp.peck = pv.IsNumber() ? pv.As<Napi::Number>().DoubleValue() : 0.0;
          auto result = forge::camx::drillToolpath(holes, toolId, cy, dp);
          return packPolylineList(env2, result);
        });
      }));

    camxNs.Set("postProcess", Napi::Function::New(env,
      [readPolylineList](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 3) {
            throw Napi::TypeError::New(env2,
                "forge.camx.postProcess(segments, post, params)");
          }
          auto segs = readPolylineList(env2, info[0]);
          forge::camx::PostFlavour pf = forge::camx::Post_Fanuc;
          if (info[1].IsString()) {
            std::string s = info[1].As<Napi::String>().Utf8Value();
            if      (s == "fanuc")      pf = forge::camx::Post_Fanuc;
            else if (s == "heidenhain") pf = forge::camx::Post_Heidenhain;
            else if (s == "siemens")    pf = forge::camx::Post_Siemens;
            else throw Napi::TypeError::New(env2,
                "forge.camx.postProcess: post must be 'fanuc'|'heidenhain'|'siemens'");
          } else if (info[1].IsNumber()) {
            pf = static_cast<forge::camx::PostFlavour>(
                info[1].As<Napi::Number>().Int32Value());
          }
          auto po = info[2].As<Napi::Object>();
          forge::camx::PostParams pp{};
          pp.spindleRPM = po.Get("spindleRPM").As<Napi::Number>().DoubleValue();
          pp.feed       = po.Get("feed").As<Napi::Number>().DoubleValue();
          pp.safeZ      = po.Get("safeZ").As<Napi::Number>().DoubleValue();
          pp.toolId     = po.Get("toolId").As<Napi::Number>().Uint32Value();
          auto out = forge::camx::postProcess(segs, pf, pp);
          return Napi::String::New(env2, out);
        });
      }));

    camxNs.Set("estimateCycleTime", Napi::Function::New(env,
      [readPolylineList](const Napi::CallbackInfo& info) -> Napi::Value {
        return safe(info, [&]() -> Napi::Value {
          auto env2 = info.Env();
          if (info.Length() < 2) {
            throw Napi::TypeError::New(env2,
                "forge.camx.estimateCycleTime(segments, feedMmMin)");
          }
          auto segs = readPolylineList(env2, info[0]);
          double feed = info[1].As<Napi::Number>().DoubleValue();
          auto r = forge::camx::estimateCycleTime(segs, feed);
          auto o = Napi::Object::New(env2);
          o.Set("totalLengthMm", Napi::Number::New(env2, r.totalLengthMm));
          o.Set("timeSec",       Napi::Number::New(env2, r.timeSec));
          return o;
        });
      }));

    exports.Set("camx", camxNs);

    // ====================================================================
    // forge::native — in-house pure-C++20 unified-kernel ops (no OCCT/WASM).
    //
    // A representative set of the VALIDATED native increments
    // (KERNEL_INHOUSE_ROADMAP), now callable in-platform. The robust
    // predicates return an exact sign (-1/0/+1); the mesh boolean returns
    // its HONEST {ok, reason} — ok=false on a boundary-crossing / coplanar
    // case it cannot close, NEVER a fake. Bible §0/§9.
    // ====================================================================
    {
      auto nativeNs = Napi::Object::New(env);

      // -- helpers (Init-body-local) -------------------------------------
      // Read a flat numeric sequence (Float64Array or plain Array) -> doubles.
      auto readDoubleVec = [](Napi::Env e2, Napi::Value v, const char* what)
          -> std::vector<double> {
        std::vector<double> out;
        if (v.IsTypedArray() && v.As<Napi::TypedArray>().TypedArrayType()
                                  == napi_float64_array) {
          auto a = v.As<Napi::Float64Array>();
          out.assign(a.Data(), a.Data() + a.ElementLength());
          return out;
        }
        if (v.IsArray()) {
          auto a = v.As<Napi::Array>();
          out.reserve(a.Length());
          for (uint32_t i = 0; i < a.Length(); ++i)
            out.push_back(a.Get(i).As<Napi::Number>().DoubleValue());
          return out;
        }
        throw Napi::TypeError::New(e2,
            std::string("forge.native: ") + what +
            " must be a Float64Array or number[]");
      };
      // Read a flat index sequence (Uint32Array / Float64Array / Array) -> u32.
      auto readU32Vec = [](Napi::Env e2, Napi::Value v, const char* what)
          -> std::vector<std::uint32_t> {
        std::vector<std::uint32_t> out;
        if (v.IsTypedArray() && v.As<Napi::TypedArray>().TypedArrayType()
                                  == napi_uint32_array) {
          auto a = v.As<Napi::Uint32Array>();
          out.assign(a.Data(), a.Data() + a.ElementLength());
          return out;
        }
        if (v.IsArray()) {
          auto a = v.As<Napi::Array>();
          out.reserve(a.Length());
          for (uint32_t i = 0; i < a.Length(); ++i)
            out.push_back(a.Get(i).As<Napi::Number>().Uint32Value());
          return out;
        }
        throw Napi::TypeError::New(e2,
            std::string("forge.native: ") + what +
            " must be a Uint32Array or number[]");
      };

      // -- robust predicates (exact sign -1/0/+1) ------------------------
      nativeNs.Set("orient2d", Napi::Function::New(env,
        [](const Napi::CallbackInfo& info) -> Napi::Value {
          return safe(info, [&]() -> Napi::Value {
            auto e2 = info.Env();
            if (info.Length() < 6)
              throw Napi::TypeError::New(e2,
                  "forge.native.orient2d(ax,ay,bx,by,cx,cy)");
            auto s = forge::native::orient2d(
                requireNumber(info,0,"ax"), requireNumber(info,1,"ay"),
                requireNumber(info,2,"bx"), requireNumber(info,3,"by"),
                requireNumber(info,4,"cx"), requireNumber(info,5,"cy"));
            return Napi::Number::New(e2, forge::native::signValue(s));
          });
        }));

      nativeNs.Set("orient3d", Napi::Function::New(env,
        [](const Napi::CallbackInfo& info) -> Napi::Value {
          return safe(info, [&]() -> Napi::Value {
            auto e2 = info.Env();
            if (info.Length() < 12)
              throw Napi::TypeError::New(e2,
                  "forge.native.orient3d(ax,ay,az,bx,by,bz,cx,cy,cz,dx,dy,dz)");
            auto s = forge::native::orient3d(
                requireNumber(info,0,"ax"), requireNumber(info,1,"ay"), requireNumber(info,2,"az"),
                requireNumber(info,3,"bx"), requireNumber(info,4,"by"), requireNumber(info,5,"bz"),
                requireNumber(info,6,"cx"), requireNumber(info,7,"cy"), requireNumber(info,8,"cz"),
                requireNumber(info,9,"dx"), requireNumber(info,10,"dy"), requireNumber(info,11,"dz"));
            return Napi::Number::New(e2, forge::native::signValue(s));
          });
        }));

      nativeNs.Set("incircle", Napi::Function::New(env,
        [](const Napi::CallbackInfo& info) -> Napi::Value {
          return safe(info, [&]() -> Napi::Value {
            auto e2 = info.Env();
            if (info.Length() < 8)
              throw Napi::TypeError::New(e2,
                  "forge.native.incircle(ax,ay,bx,by,cx,cy,dx,dy)");
            auto s = forge::native::incircle(
                requireNumber(info,0,"ax"), requireNumber(info,1,"ay"),
                requireNumber(info,2,"bx"), requireNumber(info,3,"by"),
                requireNumber(info,4,"cx"), requireNumber(info,5,"cy"),
                requireNumber(info,6,"dx"), requireNumber(info,7,"dy"));
            return Napi::Number::New(e2, forge::native::signValue(s));
          });
        }));

      // -- robust computational geometry ---------------------------------
      // convexHull2D(points: number[] flat xy pairs) -> Float64Array (CCW xy).
      nativeNs.Set("convexHull2D", Napi::Function::New(env,
        [readDoubleVec](const Napi::CallbackInfo& info) -> Napi::Value {
          return safe(info, [&]() -> Napi::Value {
            auto e2 = info.Env();
            if (info.Length() < 1)
              throw Napi::TypeError::New(e2,
                  "forge.native.convexHull2D(flatXY: number[])");
            auto flat = readDoubleVec(e2, info[0], "points");
            if (flat.size() % 2 != 0)
              throw Napi::TypeError::New(e2,
                  "forge.native.convexHull2D: points length must be a multiple of 2");
            std::vector<forge::native::geom::Point2> pts;
            pts.reserve(flat.size() / 2);
            for (std::size_t i = 0; i + 1 < flat.size(); i += 2)
              pts.push_back({flat[i], flat[i + 1]});
            auto hull = forge::native::geom::convexHull2D(pts);
            auto out = Napi::Float64Array::New(e2, hull.size() * 2);
            for (std::size_t i = 0; i < hull.size(); ++i) {
              out[2 * i]     = hull[i].x;
              out[2 * i + 1] = hull[i].y;
            }
            return out;
          });
        }));

      // convexHull3D(points: number[] flat xyz triples)
      //   -> { ok, reason, faces: Uint32Array (CCW-outward index triples) }.
      nativeNs.Set("convexHull3D", Napi::Function::New(env,
        [readDoubleVec](const Napi::CallbackInfo& info) -> Napi::Value {
          return safe(info, [&]() -> Napi::Value {
            auto e2 = info.Env();
            if (info.Length() < 1)
              throw Napi::TypeError::New(e2,
                  "forge.native.convexHull3D(flatXYZ: number[])");
            auto flat = readDoubleVec(e2, info[0], "points");
            if (flat.size() % 3 != 0)
              throw Napi::TypeError::New(e2,
                  "forge.native.convexHull3D: points length must be a multiple of 3");
            std::vector<forge::native::geom::Point3> pts;
            pts.reserve(flat.size() / 3);
            for (std::size_t i = 0; i + 2 < flat.size(); i += 3)
              pts.push_back({flat[i], flat[i + 1], flat[i + 2]});
            auto hull = forge::native::geom::convexHull3D(pts);
            auto o = Napi::Object::New(e2);
            o.Set("ok", Napi::Boolean::New(e2, hull.ok));
            o.Set("reason", Napi::String::New(e2, hull.reason ? hull.reason : ""));
            auto faces = Napi::Uint32Array::New(e2, hull.faces.size() * 3);
            for (std::size_t i = 0; i < hull.faces.size(); ++i) {
              faces[3 * i]     = static_cast<std::uint32_t>(hull.faces[i][0]);
              faces[3 * i + 1] = static_cast<std::uint32_t>(hull.faces[i][1]);
              faces[3 * i + 2] = static_cast<std::uint32_t>(hull.faces[i][2]);
            }
            o.Set("faces", faces);
            o.Set("faceCount", Napi::Number::New(e2,
                static_cast<double>(hull.faces.size())));
            return o;
          });
        }));

      // -- implicit / SDF ------------------------------------------------
      // sdfSphereVolume(radius, n) -> marching-cubes meshed volume of a sphere
      //   SDF on an n^3 grid; converges to 4/3·π·r³. (Validated convergence.)
      nativeNs.Set("sdfSphereVolume", Napi::Function::New(env,
        [](const Napi::CallbackInfo& info) -> Napi::Value {
          return safe(info, [&]() -> Napi::Value {
            auto e2 = info.Env();
            double r = requireNumber(info, 0, "radius");
            int n = info.Length() > 1 && info[1].IsNumber()
                      ? info[1].As<Napi::Number>().Int32Value() : 48;
            if (r <= 0.0)
              throw Napi::TypeError::New(e2,
                  "forge.native.sdfSphereVolume: radius must be > 0");
            if (n < 2) n = 2;
            namespace impl = forge::native::implicit;
            impl::Sdf s = impl::sphere(impl::Vec3{0, 0, 0}, r);
            double b = r * 1.25;  // bbox padding so the surface is interior
            impl::Mesh m = impl::IsoMesher::marchCubic(
                s, impl::Vec3{-b, -b, -b}, impl::Vec3{b, b, b}, n);
            return Napi::Number::New(e2, m.volume());
          });
        }));

      // -- GD&T (geometric, ASME Y14.5 math) -----------------------------
      // gdtTruePosition(actualX,actualY, trueX,trueY, actualSize,
      //                 materialLimit, positionTolDia, mc, ft)
      //   mc : "RFS"|"MMC"|"LMC"  ft : "HOLE"|"PIN"
      //   -> { deviation, bonus, allowedZoneDia, pass }.
      nativeNs.Set("gdtTruePosition", Napi::Function::New(env,
        [](const Napi::CallbackInfo& info) -> Napi::Value {
          return safe(info, [&]() -> Napi::Value {
            auto e2 = info.Env();
            if (info.Length() < 7)
              throw Napi::TypeError::New(e2,
                  "forge.native.gdtTruePosition(ax,ay,tx,ty,actualSize,"
                  "materialLimit,positionTolDia[,mc='RFS'][,ft='HOLE'])");
            using namespace forge::native::gdt;
            Point2D actual{requireNumber(info,0,"actualX"), requireNumber(info,1,"actualY")};
            Point2D trueLoc{requireNumber(info,2,"trueX"),  requireNumber(info,3,"trueY")};
            double actualSize    = requireNumber(info,4,"actualSize");
            double materialLimit = requireNumber(info,5,"materialLimit");
            double posTolDia     = requireNumber(info,6,"positionTolDia");
            MaterialCondition mc = MaterialCondition::RFS;
            if (info.Length() > 7 && info[7].IsString()) {
              std::string s = info[7].As<Napi::String>().Utf8Value();
              if      (s == "RFS") mc = MaterialCondition::RFS;
              else if (s == "MMC") mc = MaterialCondition::MMC;
              else if (s == "LMC") mc = MaterialCondition::LMC;
              else throw Napi::TypeError::New(e2,
                  "forge.native.gdtTruePosition: mc must be 'RFS'|'MMC'|'LMC'");
            }
            FeatureType ft = FeatureType::HOLE;
            if (info.Length() > 8 && info[8].IsString()) {
              std::string s = info[8].As<Napi::String>().Utf8Value();
              if      (s == "HOLE") ft = FeatureType::HOLE;
              else if (s == "PIN")  ft = FeatureType::PIN;
              else throw Napi::TypeError::New(e2,
                  "forge.native.gdtTruePosition: ft must be 'HOLE'|'PIN'");
            }
            TruePositionResult r = evaluateTruePosition(
                actual, trueLoc, actualSize, materialLimit, posTolDia, mc, ft);
            auto o = Napi::Object::New(e2);
            o.Set("deviation",      Napi::Number::New(e2, r.deviation));
            o.Set("bonus",          Napi::Number::New(e2, r.bonus));
            o.Set("allowedZoneDia", Napi::Number::New(e2, r.allowedZoneDia));
            o.Set("pass",           Napi::Boolean::New(e2, r.pass));
            return o;
          });
        }));

      // gdtFlatness(points: number[] flat xyz triples, tol)
      //   -> { ok, reason, flatness, maxAbsDeviation, pass }.
      nativeNs.Set("gdtFlatness", Napi::Function::New(env,
        [readDoubleVec](const Napi::CallbackInfo& info) -> Napi::Value {
          return safe(info, [&]() -> Napi::Value {
            auto e2 = info.Env();
            if (info.Length() < 2)
              throw Napi::TypeError::New(e2,
                  "forge.native.gdtFlatness(flatXYZ: number[], tol)");
            auto flat = readDoubleVec(e2, info[0], "points");
            if (flat.size() % 3 != 0)
              throw Napi::TypeError::New(e2,
                  "forge.native.gdtFlatness: points length must be a multiple of 3");
            double tol = requireNumber(info, 1, "tol");
            std::vector<forge::native::gdt::Vec3> pts;
            pts.reserve(flat.size() / 3);
            for (std::size_t i = 0; i + 2 < flat.size(); i += 3)
              pts.push_back({flat[i], flat[i + 1], flat[i + 2]});
            auto r = forge::native::gdt::evaluateFlatness(pts, tol);
            auto o = Napi::Object::New(e2);
            o.Set("ok",              Napi::Boolean::New(e2, r.ok));
            o.Set("reason",          Napi::String::New(e2, r.reason ? r.reason : ""));
            o.Set("flatness",        Napi::Number::New(e2, r.flatness));
            o.Set("maxAbsDeviation", Napi::Number::New(e2, r.maxAbsDeviation));
            o.Set("pass",            Napi::Boolean::New(e2, r.pass));
            return o;
          });
        }));

      // -- canonical general mesh boolean (meshBooleanNative) -------------
      // meshBoolean(aPos, aIdx, bPos, bIdx, op)
      //   op : "union"|"intersection"|"difference".
      //   -> { ok, reason, volume, area, vertexCount, faceCount,
      //        positions: Float64Array, indices: Uint32Array }.
      //   When ok=false (measure-zero degeneracy / non-manifold) the honest
      //   reason is returned and NO geometry — never a fake result.
      nativeNs.Set("meshBoolean", Napi::Function::New(env,
        [readDoubleVec, readU32Vec](const Napi::CallbackInfo& info) -> Napi::Value {
          return safe(info, [&]() -> Napi::Value {
            auto e2 = info.Env();
            if (info.Length() < 5)
              throw Napi::TypeError::New(e2,
                  "forge.native.meshBoolean(aPos, aIdx, bPos, bIdx, op)");
            auto aPos = readDoubleVec(e2, info[0], "aPos");
            auto aIdx = readU32Vec(e2, info[1], "aIdx");
            auto bPos = readDoubleVec(e2, info[2], "bPos");
            auto bIdx = readU32Vec(e2, info[3], "bIdx");
            using namespace forge::native::mesh;
            BoolOpN op = BoolOpN::UNION;
            if (info[4].IsString()) {
              std::string s = info[4].As<Napi::String>().Utf8Value();
              if      (s == "union")        op = BoolOpN::UNION;
              else if (s == "intersection") op = BoolOpN::INTERSECTION;
              else if (s == "difference")   op = BoolOpN::DIFFERENCE;
              else throw Napi::TypeError::New(e2,
                  "forge.native.meshBoolean: op must be "
                  "'union'|'intersection'|'difference'");
            } else {
              throw Napi::TypeError::New(e2,
                  "forge.native.meshBoolean: op must be a string");
            }

            BoolResultN r = meshBooleanNative(aPos, aIdx, bPos, bIdx, op);
            auto o = Napi::Object::New(e2);
            o.Set("ok",     Napi::Boolean::New(e2, r.ok));
            o.Set("reason", Napi::String::New(e2, r.reason ? r.reason : ""));
            if (r.ok) {
              // 0-fakes guard: NEVER report ok=true on a non-2-manifold result.
              ValidityReport v = r.mesh.validate();
              if (!v.isValid()) {
                o.Set("ok", Napi::Boolean::New(e2, false));
                o.Set("reason", Napi::String::New(e2,
                    "internal: ok=true but result is not a closed 2-manifold "
                    "(refused as a fake)"));
                return o;
              }
              std::vector<double> pos;
              std::vector<std::uint32_t> idx;
              r.mesh.toSoup(pos, idx);
              o.Set("volume",      Napi::Number::New(e2, r.mesh.signedVolume()));
              o.Set("area",        Napi::Number::New(e2, r.mesh.surfaceArea()));
              o.Set("vertexCount", Napi::Number::New(e2,
                  static_cast<double>(r.mesh.vertexCount())));
              o.Set("faceCount",   Napi::Number::New(e2,
                  static_cast<double>(r.mesh.faceCount())));
              auto posArr = Napi::Float64Array::New(e2, pos.size());
              std::copy(pos.begin(), pos.end(), posArr.Data());
              o.Set("positions", posArr);
              auto idxArr = Napi::Uint32Array::New(e2, idx.size());
              std::copy(idx.begin(), idx.end(), idxArr.Data());
              o.Set("indices", idxArr);
            }
            return o;
          });
        }));

      // ==================================================================
      // Task #46 — bind the remaining VALIDATED forge::native engines so
      // Archie can call them via CUA. Each wrapper calls the REAL native
      // entry point and marshals its struct result to a JS object faithfully
      // (the gdt template above: safe()/requireNumber()/readDoubleVec).
      // 0-fakes: an honest {ok:false, reason} is returned where the engine
      // itself reports one — never a fabricated success.
      // ==================================================================

      // -- materials enum parsers (shared by materials / am / composites) --
      auto parseMaterial = [](Napi::Env e2, Napi::Value v)
          -> forge::native::materials::Material {
        using forge::native::materials::Material;
        std::string s = v.IsString() ? v.As<Napi::String>().Utf8Value() : "ABS";
        if (s == "ABS")          return Material::ABS;
        if (s == "PLA")          return Material::PLA;
        if (s == "CFRP_UD_T700") return Material::CFRP_UD_T700;
        if (s == "Ti6Al4V")      return Material::Ti6Al4V;
        throw Napi::TypeError::New(e2,
            "material must be 'ABS'|'PLA'|'CFRP_UD_T700'|'Ti6Al4V'");
      };
      auto parseProcess = [](Napi::Env e2, Napi::Value v)
          -> forge::native::materials::Process {
        using forge::native::materials::Process;
        std::string s = v.IsString() ? v.As<Napi::String>().Utf8Value() : "FDM_FFF";
        if (s == "FDM_FFF")           return Process::FDM_FFF;
        if (s == "LPBF")              return Process::LPBF;
        if (s == "WROUGHT")           return Process::WROUGHT;
        if (s == "PREPREG_AUTOCLAVE") return Process::PREPREG_AUTOCLAVE;
        throw Napi::TypeError::New(e2,
            "process must be 'FDM_FFF'|'LPBF'|'WROUGHT'|'PREPREG_AUTOCLAVE'");
      };
      auto parseOrient = [](Napi::Env e2, Napi::Value v)
          -> forge::native::materials::BuildOrient {
        using forge::native::materials::BuildOrient;
        std::string s = v.IsString() ? v.As<Napi::String>().Utf8Value() : "XY_INPLANE";
        if (s == "XY_INPLANE") return BuildOrient::XY_INPLANE;
        if (s == "Z_BUILD")    return BuildOrient::Z_BUILD;
        if (s == "ANGLE_45")   return BuildOrient::ANGLE_45;
        if (s == "NA")         return BuildOrient::NA;
        throw Napi::TypeError::New(e2,
            "buildOrient must be 'XY_INPLANE'|'Z_BUILD'|'ANGLE_45'|'NA'");
      };
      auto parsePost = [](Napi::Env e2, Napi::Value v)
          -> forge::native::materials::PostProcess {
        using forge::native::materials::PostProcess;
        std::string s = v.IsString() ? v.As<Napi::String>().Utf8Value() : "AS_BUILT";
        if (s == "NONE")     return PostProcess::NONE;
        if (s == "AS_BUILT") return PostProcess::AS_BUILT;
        if (s == "HIP")      return PostProcess::HIP;
        if (s == "ANNEAL")   return PostProcess::ANNEAL;
        if (s == "NA")       return PostProcess::NA;
        throw Napi::TypeError::New(e2,
            "postProcess must be 'NONE'|'AS_BUILT'|'HIP'|'ANNEAL'|'NA'");
      };
      auto getProp = [](Napi::Object o, const char* k, double dflt) -> double {
        return (o.Has(k) && o.Get(k).IsNumber())
                   ? o.Get(k).As<Napi::Number>().DoubleValue() : dflt;
      };

      // -- tolstack: forge.native.tolstackAnalyze(spec) ------------------
      //   spec = { contributors:[{nominal,plusTol,minusTol,sensitivity,
      //            dist:'NORMAL'|'UNIFORM'|'TRIANGULAR'}], LSL, USL, k?,
      //            mcSamples?, mcSeed?, cltMinContributors? }
      //   -> { wcNominal,wcMin,wcMax,wcTol, rssMean,rssSigma,rssMin,rssMax,
      //        rssYield,cp,cpk, mcMean,mcSigma,mcYield,mcP01,mcP99,
      //        rssValid,authoritativeMc,rssWarning, contributors:[{name,
      //        varianceShare,sigmaContribution}] }.
      nativeNs.Set("tolstackAnalyze", Napi::Function::New(env,
        [getProp](const Napi::CallbackInfo& info) -> Napi::Value {
          return safe(info, [&]() -> Napi::Value {
            auto e2 = info.Env();
            if (info.Length() < 1 || !info[0].IsObject())
              throw Napi::TypeError::New(e2,
                  "forge.native.tolstackAnalyze(spec{contributors[],LSL,USL,...})");
            using namespace forge::native::tolstack;
            auto js = info[0].As<Napi::Object>();
            StackSpec spec;
            if (!js.Has("contributors") || !js.Get("contributors").IsArray())
              throw Napi::TypeError::New(e2,
                  "tolstackAnalyze: spec.contributors must be an array");
            auto arr = js.Get("contributors").As<Napi::Array>();
            spec.contributors.reserve(arr.Length());
            for (uint32_t i = 0; i < arr.Length(); ++i) {
              if (!arr.Get(i).IsObject())
                throw Napi::TypeError::New(e2,
                    "tolstackAnalyze: each contributor must be an object");
              auto c = arr.Get(i).As<Napi::Object>();
              Contributor con;
              con.nominal     = getProp(c, "nominal", 0.0);
              con.plusTol     = getProp(c, "plusTol", 0.0);
              con.minusTol    = getProp(c, "minusTol", 0.0);
              con.sensitivity = getProp(c, "sensitivity", 1.0);
              if (c.Has("dist") && c.Get("dist").IsString()) {
                std::string d = c.Get("dist").As<Napi::String>().Utf8Value();
                if      (d == "NORMAL")     con.dist = DistType::NORMAL;
                else if (d == "UNIFORM")    con.dist = DistType::UNIFORM;
                else if (d == "TRIANGULAR") con.dist = DistType::TRIANGULAR;
                else throw Napi::TypeError::New(e2,
                    "tolstackAnalyze: dist must be 'NORMAL'|'UNIFORM'|'TRIANGULAR'");
              }
              con.sigmaOverride = getProp(c, "sigmaOverride", 0.0);
              spec.contributors.push_back(con);
            }
            spec.LSL = getProp(js, "LSL", 0.0);
            spec.USL = getProp(js, "USL", 0.0);
            spec.k   = getProp(js, "k", 3.0);
            if (js.Has("mcSamples") && js.Get("mcSamples").IsNumber())
              spec.mcSamples = js.Get("mcSamples").As<Napi::Number>().Int32Value();
            if (js.Has("mcSeed") && js.Get("mcSeed").IsNumber())
              spec.mcSeed = js.Get("mcSeed").As<Napi::Number>().Uint32Value();
            if (js.Has("cltMinContributors") && js.Get("cltMinContributors").IsNumber())
              spec.cltMinContributors =
                  js.Get("cltMinContributors").As<Napi::Number>().Int32Value();

            StackResult r = analyzeStack(spec);
            auto o = Napi::Object::New(e2);
            o.Set("wcNominal", Napi::Number::New(e2, r.wcNominal));
            o.Set("wcMin",     Napi::Number::New(e2, r.wcMin));
            o.Set("wcMax",     Napi::Number::New(e2, r.wcMax));
            o.Set("wcTol",     Napi::Number::New(e2, r.wcTol));
            o.Set("rssMean",   Napi::Number::New(e2, r.rssMean));
            o.Set("rssSigma",  Napi::Number::New(e2, r.rssSigma));
            o.Set("rssMin",    Napi::Number::New(e2, r.rssMin));
            o.Set("rssMax",    Napi::Number::New(e2, r.rssMax));
            o.Set("rssYield",  Napi::Number::New(e2, r.rssYield));
            o.Set("cp",        Napi::Number::New(e2, r.cp));
            o.Set("cpk",       Napi::Number::New(e2, r.cpk));
            o.Set("mcMean",    Napi::Number::New(e2, r.mcMean));
            o.Set("mcSigma",   Napi::Number::New(e2, r.mcSigma));
            o.Set("mcYield",   Napi::Number::New(e2, r.mcYield));
            o.Set("mcP01",     Napi::Number::New(e2, r.mcP01));
            o.Set("mcP99",     Napi::Number::New(e2, r.mcP99));
            o.Set("rssValid",        Napi::Boolean::New(e2, r.rssValid));
            o.Set("authoritativeMc", Napi::Boolean::New(e2, r.authoritativeMc));
            o.Set("rssWarning", Napi::String::New(e2,
                r.rssWarning ? r.rssWarning : ""));
            auto carr = Napi::Array::New(e2, r.contributors.size());
            for (std::size_t i = 0; i < r.contributors.size(); ++i) {
              auto co = Napi::Object::New(e2);
              co.Set("name", Napi::String::New(e2,
                  r.contributors[i].name ? r.contributors[i].name : ""));
              co.Set("varianceShare",
                  Napi::Number::New(e2, r.contributors[i].varianceShare));
              co.Set("sigmaContribution",
                  Napi::Number::New(e2, r.contributors[i].sigmaContribution));
              carr.Set(i, co);
            }
            o.Set("contributors", carr);
            return o;
          });
        }));

      // -- vvuq: forge.native.vvuqConvergence(levels) --------------------
      //   levels = [{h, value}, ...] (>=3, finest last)
      //   -> { cls:'CONVERGING'|'DIVERGING_SINGULAR'|'OSCILLATORY'|
      //        'INSUFFICIENT', converging, convergedValue, orderP, gci,
      //        divergenceExponent, monotone, reason }.
      nativeNs.Set("vvuqConvergence", Napi::Function::New(env,
        [getProp](const Napi::CallbackInfo& info) -> Napi::Value {
          return safe(info, [&]() -> Napi::Value {
            auto e2 = info.Env();
            if (info.Length() < 1 || !info[0].IsArray())
              throw Napi::TypeError::New(e2,
                  "forge.native.vvuqConvergence(levels:[{h,value},...][, Fs])");
            using namespace forge::native::vvuq;
            auto arr = info[0].As<Napi::Array>();
            std::vector<ConvergenceLevel> levels;
            levels.reserve(arr.Length());
            for (uint32_t i = 0; i < arr.Length(); ++i) {
              if (!arr.Get(i).IsObject())
                throw Napi::TypeError::New(e2,
                    "vvuqConvergence: each level must be {h, value}");
              auto l = arr.Get(i).As<Napi::Object>();
              levels.push_back({ getProp(l, "h", 0.0), getProp(l, "value", 0.0) });
            }
            double Fs = (info.Length() > 1 && info[1].IsNumber())
                            ? info[1].As<Napi::Number>().DoubleValue() : 1.25;
            ConvergenceResult r = classifyConvergence(levels, Fs);
            const char* clsStr = "INSUFFICIENT";
            switch (r.cls) {
              case ConvergenceClass::CONVERGING:         clsStr = "CONVERGING"; break;
              case ConvergenceClass::DIVERGING_SINGULAR: clsStr = "DIVERGING_SINGULAR"; break;
              case ConvergenceClass::OSCILLATORY:        clsStr = "OSCILLATORY"; break;
              case ConvergenceClass::INSUFFICIENT:       clsStr = "INSUFFICIENT"; break;
            }
            auto o = Napi::Object::New(e2);
            o.Set("cls",               Napi::String::New(e2, clsStr));
            o.Set("converging",        Napi::Boolean::New(e2, r.converging));
            o.Set("convergedValue",    Napi::Number::New(e2, r.convergedValue));
            o.Set("orderP",            Napi::Number::New(e2, r.orderP));
            o.Set("gci",               Napi::Number::New(e2, r.gci));
            o.Set("divergenceExponent",Napi::Number::New(e2, r.divergenceExponent));
            o.Set("monotone",          Napi::Boolean::New(e2, r.monotone));
            o.Set("reason", Napi::String::New(e2, r.reason ? r.reason : ""));
            return o;
          });
        }));

      // -- vvuq: forge.native.vvuqEnergyAudit(input) ---------------------
      //   input = { internalEnergy, hourglassEnergy, kineticEnergy?,
      //             contactStabEnergy?, quasiStatic? }
      //   -> { hourglassPct, keIeRatio, contactStabPct, level:'GREEN'|
      //        'AMBER'|'RED', reasons:[string] }.
      nativeNs.Set("vvuqEnergyAudit", Napi::Function::New(env,
        [getProp](const Napi::CallbackInfo& info) -> Napi::Value {
          return safe(info, [&]() -> Napi::Value {
            auto e2 = info.Env();
            if (info.Length() < 1 || !info[0].IsObject())
              throw Napi::TypeError::New(e2,
                  "forge.native.vvuqEnergyAudit({internalEnergy,hourglassEnergy,...})");
            using namespace forge::native::vvuq;
            auto js = info[0].As<Napi::Object>();
            EnergyInput in;
            in.internalEnergy    = getProp(js, "internalEnergy", 0.0);
            in.hourglassEnergy   = getProp(js, "hourglassEnergy", 0.0);
            in.kineticEnergy     = getProp(js, "kineticEnergy", 0.0);
            in.contactStabEnergy = getProp(js, "contactStabEnergy", 0.0);
            if (js.Has("quasiStatic") && js.Get("quasiStatic").IsBoolean())
              in.quasiStatic = js.Get("quasiStatic").As<Napi::Boolean>().Value();
            EnergyAudit r = auditEnergy(in);
            const char* lvl = (r.level == Level::RED) ? "RED"
                            : (r.level == Level::AMBER) ? "AMBER" : "GREEN";
            auto o = Napi::Object::New(e2);
            o.Set("hourglassPct",   Napi::Number::New(e2, r.hourglassPct));
            o.Set("keIeRatio",      Napi::Number::New(e2, r.keIeRatio));
            o.Set("contactStabPct", Napi::Number::New(e2, r.contactStabPct));
            o.Set("level",          Napi::String::New(e2, lvl));
            auto rs = Napi::Array::New(e2, r.reasons.size());
            for (std::size_t i = 0; i < r.reasons.size(); ++i)
              rs.Set(i, Napi::String::New(e2, r.reasons[i] ? r.reasons[i] : ""));
            o.Set("reasons", rs);
            return o;
          });
        }));

      // -- materials: forge.native.materialsQuery(key) -------------------
      //   key = { material, process, buildOrient?, postProcess?,
      //           loadDir:[x,y,z], k? }
      //   -> { E_eff,G_eff,nu_eff,strength_eff, band_lo,band_hi,k,
      //        confidence:'HIGH'|'MEDIUM'|'LOW', reason,
      //        couponTestRecommended, ok }.
      nativeNs.Set("materialsQuery", Napi::Function::New(env,
        [parseMaterial, parseProcess, parseOrient, parsePost, getProp]
        (const Napi::CallbackInfo& info) -> Napi::Value {
          return safe(info, [&]() -> Napi::Value {
            auto e2 = info.Env();
            if (info.Length() < 1 || !info[0].IsObject())
              throw Napi::TypeError::New(e2,
                  "forge.native.materialsQuery({material,process,buildOrient,"
                  "postProcess,loadDir:[x,y,z],k})");
            using namespace forge::native::materials;
            auto js = info[0].As<Napi::Object>();
            MatKey key;
            key.m = parseMaterial(e2, js.Get("material"));
            key.p = parseProcess(e2, js.Get("process"));
            key.o = js.Has("buildOrient") ? parseOrient(e2, js.Get("buildOrient"))
                                          : BuildOrient::NA;
            key.post = js.Has("postProcess") ? parsePost(e2, js.Get("postProcess"))
                                             : PostProcess::AS_BUILT;
            Vec3 loadDir{1, 0, 0};
            if (js.Has("loadDir") && js.Get("loadDir").IsArray()) {
              auto la = js.Get("loadDir").As<Napi::Array>();
              if (la.Length() >= 3) {
                loadDir.x = la.Get(0u).As<Napi::Number>().DoubleValue();
                loadDir.y = la.Get(1u).As<Napi::Number>().DoubleValue();
                loadDir.z = la.Get(2u).As<Napi::Number>().DoubleValue();
              }
            }
            double k = getProp(js, "k", 2.0);
            MaterialDB db;
            PropertyQuery r = db.getProperties(key, loadDir, k);
            const char* conf = (r.confidence == Confidence::HIGH) ? "HIGH"
                             : (r.confidence == Confidence::MEDIUM) ? "MEDIUM" : "LOW";
            auto o = Napi::Object::New(e2);
            o.Set("E_eff",        Napi::Number::New(e2, r.E_eff));
            o.Set("G_eff",        Napi::Number::New(e2, r.G_eff));
            o.Set("nu_eff",       Napi::Number::New(e2, r.nu_eff));
            o.Set("strength_eff", Napi::Number::New(e2, r.strength_eff));
            o.Set("band_lo",      Napi::Number::New(e2, r.band_lo));
            o.Set("band_hi",      Napi::Number::New(e2, r.band_hi));
            o.Set("k",            Napi::Number::New(e2, r.k));
            o.Set("confidence",   Napi::String::New(e2, conf));
            o.Set("reason",       Napi::String::New(e2, r.reason));
            o.Set("couponTestRecommended",
                Napi::Boolean::New(e2, r.couponTestRecommended));
            o.Set("ok",           Napi::Boolean::New(e2, r.ok));
            return o;
          });
        }));

      // -- am: forge.native.amWarp(spec) ---------------------------------
      //   spec = { nodes:[x,y,z,...] flat, tets:[i,j,k,l,...] flat,
      //            material:{material,process,buildOrient?,postProcess?},
      //            inherent:{exx,eyy,ezz,eyz?,exz?,exy?,calibrated?},
      //            orientation?:[9], plateZ? }
      //   -> { ok, calibrated, maxWarp, rmsWarp, maxVonMises, cgIters,
      //        cgResidual, note, nodeDisp:Float64Array(3*nNodes) }.
      nativeNs.Set("amWarp", Napi::Function::New(env,
        [parseMaterial, parseProcess, parseOrient, parsePost, getProp, readDoubleVec, readU32Vec]
        (const Napi::CallbackInfo& info) -> Napi::Value {
          return safe(info, [&]() -> Napi::Value {
            auto e2 = info.Env();
            if (info.Length() < 1 || !info[0].IsObject())
              throw Napi::TypeError::New(e2,
                  "forge.native.amWarp({nodes[],tets[],material,inherent,...})");
            using namespace forge::native::am;
            auto js = info[0].As<Napi::Object>();
            if (!js.Has("nodes") || !js.Has("tets"))
              throw Napi::TypeError::New(e2,
                  "amWarp: spec must have flat nodes[] and tets[]");
            auto nodesF = readDoubleVec(e2, js.Get("nodes"), "nodes");
            auto tetsI  = readU32Vec(e2, js.Get("tets"), "tets");
            if (nodesF.size() % 3 != 0)
              throw Napi::TypeError::New(e2, "amWarp: nodes length must be %3");
            if (tetsI.size() % 4 != 0)
              throw Napi::TypeError::New(e2, "amWarp: tets length must be %4");
            TetMesh mesh;
            mesh.nodes.reserve(nodesF.size() / 3);
            for (std::size_t i = 0; i + 2 < nodesF.size(); i += 3)
              mesh.nodes.push_back({ nodesF[i], nodesF[i+1], nodesF[i+2] });
            mesh.tets.reserve(tetsI.size() / 4);
            for (std::size_t i = 0; i + 3 < tetsI.size(); i += 4)
              mesh.tets.push_back({ (int)tetsI[i], (int)tetsI[i+1],
                                    (int)tetsI[i+2], (int)tetsI[i+3] });
            BuildSpec spec;
            if (js.Has("material") && js.Get("material").IsObject()) {
              auto mk = js.Get("material").As<Napi::Object>();
              spec.material.m = parseMaterial(e2, mk.Get("material"));
              spec.material.p = parseProcess(e2, mk.Get("process"));
              spec.material.o = mk.Has("buildOrient")
                  ? parseOrient(e2, mk.Get("buildOrient"))
                  : forge::native::materials::BuildOrient::NA;
              spec.material.post = mk.Has("postProcess")
                  ? parsePost(e2, mk.Get("postProcess"))
                  : forge::native::materials::PostProcess::HIP;
            }
            if (js.Has("orientation") && js.Get("orientation").IsArray()) {
              auto oa = js.Get("orientation").As<Napi::Array>();
              for (uint32_t i = 0; i < 9 && i < oa.Length(); ++i)
                spec.orientation[i] = oa.Get(i).As<Napi::Number>().DoubleValue();
            }
            if (js.Has("inherent") && js.Get("inherent").IsObject()) {
              auto ih = js.Get("inherent").As<Napi::Object>();
              spec.inherent.exx = getProp(ih, "exx", 0.0);
              spec.inherent.eyy = getProp(ih, "eyy", 0.0);
              spec.inherent.ezz = getProp(ih, "ezz", 0.0);
              spec.inherent.eyz = getProp(ih, "eyz", 0.0);
              spec.inherent.exz = getProp(ih, "exz", 0.0);
              spec.inherent.exy = getProp(ih, "exy", 0.0);
              if (ih.Has("calibrated") && ih.Get("calibrated").IsBoolean())
                spec.inherent.calibrated =
                    ih.Get("calibrated").As<Napi::Boolean>().Value();
            }
            spec.plateZ = getProp(js, "plateZ", 0.0);
            forge::native::materials::MaterialDB db;
            WarpField w = predictInherentStrainWarp(mesh, spec, db);
            auto o = Napi::Object::New(e2);
            o.Set("ok",          Napi::Boolean::New(e2, w.ok));
            o.Set("calibrated",  Napi::Boolean::New(e2, w.calibrated));
            o.Set("maxWarp",     Napi::Number::New(e2, w.maxWarp));
            o.Set("rmsWarp",     Napi::Number::New(e2, w.rmsWarp));
            o.Set("maxVonMises", Napi::Number::New(e2, w.maxVonMises));
            o.Set("cgIters",     Napi::Number::New(e2, (double)w.cgIters));
            o.Set("cgResidual",  Napi::Number::New(e2, w.cgResidual));
            o.Set("note", Napi::String::New(e2, w.note ? w.note : ""));
            auto disp = Napi::Float64Array::New(e2, w.nodeDisp.size() * 3);
            for (std::size_t i = 0; i < w.nodeDisp.size(); ++i) {
              disp[i*3+0] = w.nodeDisp[i].x;
              disp[i*3+1] = w.nodeDisp[i].y;
              disp[i*3+2] = w.nodeDisp[i].z;
            }
            o.Set("nodeDisp", disp);
            return o;
          });
        }));

      // -- composites: forge.native.compositesClt(laminate) --------------
      //   laminate = { plies:[{E1,E2,G12,nu12,thickness,angleDeg}] }
      //   (angle in DEGREES for ergonomics; converted to rad internally)
      //   -> { ok, symmetric, balanced, Ex,Ey,Gxy,nuxy, Bmax,
      //        A:[9], B:[9], D:[9] }.
      nativeNs.Set("compositesClt", Napi::Function::New(env,
        [getProp](const Napi::CallbackInfo& info) -> Napi::Value {
          return safe(info, [&]() -> Napi::Value {
            auto e2 = info.Env();
            if (info.Length() < 1 || !info[0].IsObject())
              throw Napi::TypeError::New(e2,
                  "forge.native.compositesClt({plies:[{E1,E2,G12,nu12,"
                  "thickness,angleDeg}]})");
            using namespace forge::native::composites;
            auto js = info[0].As<Napi::Object>();
            if (!js.Has("plies") || !js.Get("plies").IsArray())
              throw Napi::TypeError::New(e2,
                  "compositesClt: laminate.plies must be an array");
            auto arr = js.Get("plies").As<Napi::Array>();
            Laminate lam;
            lam.plies.reserve(arr.Length());
            for (uint32_t i = 0; i < arr.Length(); ++i) {
              if (!arr.Get(i).IsObject())
                throw Napi::TypeError::New(e2,
                    "compositesClt: each ply must be an object");
              auto p = arr.Get(i).As<Napi::Object>();
              Ply ply;
              // Each ply carries its own orthotropic lamina constants (mean
              // values). Off-axis terms default to the in-plane lamina form.
              ply.material.E1.mean   = getProp(p, "E1", 0.0);
              ply.material.E2.mean   = getProp(p, "E2", 0.0);
              ply.material.E3.mean   = getProp(p, "E3", getProp(p, "E2", 0.0));
              ply.material.G12.mean  = getProp(p, "G12", 0.0);
              ply.material.G13.mean  = getProp(p, "G13", getProp(p, "G12", 0.0));
              ply.material.G23.mean  = getProp(p, "G23", getProp(p, "G12", 0.0));
              ply.material.nu12.mean = getProp(p, "nu12", 0.0);
              ply.material.nu13.mean = getProp(p, "nu13", getProp(p, "nu12", 0.0));
              ply.material.nu23.mean = getProp(p, "nu23", getProp(p, "nu12", 0.0));
              ply.thickness = getProp(p, "thickness", 0.0);
              ply.angle     = getProp(p, "angleDeg", 0.0) * 3.14159265358979323846 / 180.0;
              ply.materialName = "ply";
              lam.plies.push_back(ply);
            }
            CltResult r = buildClt(lam);
            double Bmax = 0.0;
            for (int i = 0; i < 9; ++i)
              Bmax = std::max(Bmax, std::fabs(r.B.a[i]));
            auto o = Napi::Object::New(e2);
            o.Set("ok",        Napi::Boolean::New(e2, r.ok));
            o.Set("symmetric", Napi::Boolean::New(e2, r.symmetric));
            o.Set("balanced",  Napi::Boolean::New(e2, r.balanced));
            o.Set("Ex",   Napi::Number::New(e2, r.Ex));
            o.Set("Ey",   Napi::Number::New(e2, r.Ey));
            o.Set("Gxy",  Napi::Number::New(e2, r.Gxy));
            o.Set("nuxy", Napi::Number::New(e2, r.nuxy));
            o.Set("Bmax", Napi::Number::New(e2, Bmax));
            auto mat3 = [&](const Mat3& m) {
              auto a = Napi::Float64Array::New(e2, 9);
              for (int i = 0; i < 9; ++i) a[i] = m.a[i];
              return a;
            };
            o.Set("A", mat3(r.A));
            o.Set("B", mat3(r.B));
            o.Set("D", mat3(r.D));
            return o;
          });
        }));

      // -- surfit: forge.native.surfitFit(points[, opts]) ----------------
      //   points = flat [x,y,z,...]; opts = { degreeU?,degreeV?,nU?,nV?,
      //            maxIters?,tol?,lambda? }
      //   -> { ok, reason, chamfer, rms, maxDist, iters, degreeU, degreeV,
      //        nU, nV } (the editable control net is summarised; the full
      //        surface stays in-kernel — its dims are reported).
      nativeNs.Set("surfitFit", Napi::Function::New(env,
        [getProp, readDoubleVec](const Napi::CallbackInfo& info) -> Napi::Value {
          return safe(info, [&]() -> Napi::Value {
            auto e2 = info.Env();
            if (info.Length() < 1)
              throw Napi::TypeError::New(e2,
                  "forge.native.surfitFit(pointsXYZ:number[][, opts])");
            auto flat = readDoubleVec(e2, info[0], "points");
            if (flat.size() % 3 != 0)
              throw Napi::TypeError::New(e2,
                  "surfitFit: points length must be a multiple of 3");
            using namespace forge::native::surfit;
            std::vector<Vec3> pts;
            pts.reserve(flat.size() / 3);
            for (std::size_t i = 0; i + 2 < flat.size(); i += 3)
              pts.push_back({ flat[i], flat[i+1], flat[i+2] });
            FitOptions opt;
            if (info.Length() > 1 && info[1].IsObject()) {
              auto js = info[1].As<Napi::Object>();
              opt.degreeU  = (std::size_t)getProp(js, "degreeU", (double)opt.degreeU);
              opt.degreeV  = (std::size_t)getProp(js, "degreeV", (double)opt.degreeV);
              opt.nU       = (std::size_t)getProp(js, "nU", (double)opt.nU);
              opt.nV       = (std::size_t)getProp(js, "nV", (double)opt.nV);
              opt.maxIters = (std::size_t)getProp(js, "maxIters", (double)opt.maxIters);
              opt.tol      = getProp(js, "tol", opt.tol);
              opt.lambda   = getProp(js, "lambda", opt.lambda);
            }
            FitResult r = fitNurbsSurface(pts, opt);
            auto o = Napi::Object::New(e2);
            o.Set("ok",      Napi::Boolean::New(e2, r.ok));
            o.Set("reason",  Napi::String::New(e2, r.reason ? r.reason : ""));
            o.Set("chamfer", Napi::Number::New(e2, r.chamfer));
            o.Set("rms",     Napi::Number::New(e2, r.rms));
            o.Set("maxDist", Napi::Number::New(e2, r.maxDist));
            o.Set("iters",   Napi::Number::New(e2, (double)r.iters));
            o.Set("degreeU", Napi::Number::New(e2, (double)r.surface.degreeU));
            o.Set("degreeV", Napi::Number::New(e2, (double)r.surface.degreeV));
            o.Set("nU", Napi::Number::New(e2,
                (double)(r.surface.control.empty() ? 0 : r.surface.control.size())));
            o.Set("nV", Napi::Number::New(e2,
                (double)(r.surface.control.empty() ? 0 : r.surface.control[0].size())));
            return o;
          });
        }));

      // -- cam: forge.native.camRemoveMaterial(args) ---------------------
      //   (named to avoid the OCCT forge.cam collision)
      //   args = { stock:{lo:[x,y,z],hi:[x,y,z]},
      //            tool:{radius,length?,cornerRadius?},
      //            path:[{p:[x,y,z],rapid?}], spacing }
      //   -> { ok, reason, removedVolume, stockVolume0, voxelResolution }.
      //   (the in-process VoxelGrid stays in-kernel; the validated measures
      //    are returned.)
      nativeNs.Set("camRemoveMaterial", Napi::Function::New(env,
        [getProp](const Napi::CallbackInfo& info) -> Napi::Value {
          return safe(info, [&]() -> Napi::Value {
            auto e2 = info.Env();
            if (info.Length() < 1 || !info[0].IsObject())
              throw Napi::TypeError::New(e2,
                  "forge.native.camRemoveMaterial({stock,tool,path,spacing})");
            using namespace forge::native::cam;
            auto js = info[0].As<Napi::Object>();
            auto readVec3 = [&](Napi::Value v, double dx, double dy, double dz) -> Vec3 {
              Vec3 out{dx, dy, dz};
              if (v.IsArray()) {
                auto a = v.As<Napi::Array>();
                if (a.Length() >= 3) {
                  out.x = a.Get(0u).As<Napi::Number>().DoubleValue();
                  out.y = a.Get(1u).As<Napi::Number>().DoubleValue();
                  out.z = a.Get(2u).As<Napi::Number>().DoubleValue();
                }
              }
              return out;
            };
            Stock stock;
            if (js.Has("stock") && js.Get("stock").IsObject()) {
              auto s = js.Get("stock").As<Napi::Object>();
              stock.lo = readVec3(s.Get("lo"), 0, 0, 0);
              stock.hi = readVec3(s.Get("hi"), 0, 0, 0);
            }
            Tool tool;
            if (js.Has("tool") && js.Get("tool").IsObject()) {
              auto t = js.Get("tool").As<Napi::Object>();
              tool.radius       = getProp(t, "radius", 1.0);
              tool.length       = getProp(t, "length", 10.0);
              tool.cornerRadius = getProp(t, "cornerRadius", 0.0);
            }
            Toolpath path;
            if (js.Has("path") && js.Get("path").IsArray()) {
              auto pa = js.Get("path").As<Napi::Array>();
              path.reserve(pa.Length());
              for (uint32_t i = 0; i < pa.Length(); ++i) {
                if (!pa.Get(i).IsObject()) continue;
                auto pp = pa.Get(i).As<Napi::Object>();
                PathPoint point;
                point.p = readVec3(pp.Get("p"), 0, 0, 0);
                if (pp.Has("rapid") && pp.Get("rapid").IsBoolean())
                  point.rapid = pp.Get("rapid").As<Napi::Boolean>().Value();
                path.push_back(point);
              }
            }
            double spacing = getProp(js, "spacing", 0.5);
            RemovalResult r = removeMaterial(stock, tool, path, spacing);
            auto o = Napi::Object::New(e2);
            o.Set("ok",     Napi::Boolean::New(e2, r.ok));
            o.Set("reason", Napi::String::New(e2, r.reason ? r.reason : ""));
            o.Set("removedVolume",   Napi::Number::New(e2, r.removedVolume));
            o.Set("stockVolume0",    Napi::Number::New(e2, r.stockVolume0));
            o.Set("voxelResolution", Napi::Number::New(e2, r.voxelResolution));
            return o;
          });
        }));

      exports.Set("native", nativeNs);
    }

    // Wave-0 dark-engine harvest (geom predicates / implicit-voxel-frep field stack /
    // PlaneGCS constraint diagnostics) — now reachable by Archie as forge.geom.*,
    // forge.implicit.*/lattice.*/tpms.*, forge.sketch.diagnose.*.
    forge::bind::InitGeom(env, exports);
    forge::bind::InitField(env, exports);
    forge::bind::InitSketchdiag(env, exports);

    return exports;
}

NODE_API_MODULE(forge_kernel, Init)
