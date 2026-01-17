/**
 * CRYOGENIC HYDROGEN STORAGE TANK TEMPLATE
 *
 * Production-ready template for aviation-grade cryogenic hydrogen storage systems.
 * Handles extreme thermal cycling (-253°C to ambient), minimizes boil-off, lightweight composite construction.
 *
 * Key features:
 * - Multi-layer vacuum insulation (MLI)
 * - Type IV composite overwrap pressure vessel
 * - Thermal break supports
 * - Integrated pressure relief and venting
 * - Aviation-grade attachment points
 */

module.exports = {
    name: 'Cryogenic Hydrogen Storage Tank - Aviation Grade',
    totalComponents: 16,
    targetVertices: 12000,
    estimatedTime: '6-8 minutes',
    materials: {
        innerLiner: {
            name: 'Aluminum Alloy 2219-T87',
            color: [200, 200, 210], // Light gray-blue
            properties: {
                density: '2840 kg/m³',
                tensileStrength: '455 MPa',
                cryogenicRating: '-253°C',
                thermalConductivity: '120 W/(m·K)'
            }
        },
        compositeShell: {
            name: 'Carbon Fiber/Epoxy T700',
            color: [30, 30, 30], // Dark carbon black
            properties: {
                density: '1600 kg/m³',
                tensileStrength: '4900 MPa',
                modulusElasticity: '230 GPa',
                fiberOrientation: '±55° helical wrap'
            }
        },
        insulation: {
            name: 'MLI (Multi-Layer Insulation)',
            color: [220, 180, 100], // Gold/aluminized Mylar
            properties: {
                layers: '40-60 layers',
                material: 'Aluminized Mylar + Dacron spacer',
                effectiveConductivity: '0.1 mW/(m·K)',
                vacuumPressure: '<10^-5 torr'
            }
        },
        supportStruts: {
            name: 'G-10 Fiberglass Composite',
            color: [150, 200, 150], // Light green
            properties: {
                density: '1800 kg/m³',
                thermalConductivity: '0.3 W/(m·K)',
                tensileStrength: '310 MPa',
                purpose: 'Thermal break supports'
            }
        },
        stainlessSteel: {
            name: 'Stainless Steel 316L',
            color: [180, 180, 190], // Silvery steel
            properties: {
                density: '8000 kg/m³',
                tensileStrength: '485 MPa',
                cryogenicRating: '-253°C',
                corrosionResistance: 'Excellent'
            }
        },
        valveBody: {
            name: 'Brass C36000',
            color: [200, 170, 100], // Brass gold
            properties: {
                density: '8500 kg/m³',
                tensileStrength: '340 MPa',
                machinability: '90%'
            }
        }
    },
    components: [
        {
            id: 'inner_tank_shell',
            name: 'Inner Tank Shell - Aluminum Liner',
            targetVertices: 1200,
            priority: 1,
            dependencies: [],
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            material: 'innerLiner',
            prompt: `Generate the INNER ALUMINUM LINER for cryogenic hydrogen storage:

GEOMETRY:
- Cylindrical shell: 1000mm length, 400mm diameter
- Wall thickness: 3mm (minimum for hydrogen permeability prevention)
- Hemispherical end caps: 2:1 elliptical heads for optimal strength/weight
- Seamless construction (no longitudinal welds for hydrogen compatibility)

FEATURES:
- Smooth inner surface: Ra < 1.6µm (prevents nucleation sites for boiling)
- End cap transition: Smooth tangent to cylinder (stress concentration < 1.5)
- Material: Aluminum 2219-T87 (cryogenic-rated, -253°C capable)

MANUFACTURING:
- Spin forming or deep drawing for seamless shells
- TIG welding for circumferential joints (if required)
- Post-weld heat treatment to restore T87 properties

TARGET: 1200+ vertices (60 segments × 20 axial divisions)
CRITICAL: Hydrogen-tight construction, cryogenic thermal contraction compatibility`
        },
        {
            id: 'composite_overwrap',
            name: 'Carbon Fiber Composite Overwrap',
            targetVertices: 1000,
            priority: 2,
            dependencies: ['inner_tank_shell'],
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            material: 'compositeShell',
            prompt: `Generate the CARBON FIBER COMPOSITE OVERWRAP (Type IV pressure vessel):

GEOMETRY:
- Overwrap thickness: 15mm (tapered from 20mm at ends to 12mm at mid-cylinder)
- Outer diameter: 430mm (400mm liner + 15mm × 2 overwrap)
- Length: 1000mm matching liner
- End boss reinforcement: Extra 10mm thickness at pole openings

FIBER ARCHITECTURE:
- Helical wrap: ±55° (hoop stress optimization)
- Axial reinforcement: 0° layers at cylinder (10% of total)
- Polar reinforcement: Near-axial layers at end bosses (30mm thick)

LAYUP SEQUENCE:
- Inner: ±55° helical (70% of thickness)
- Middle: 0° axial (10% of thickness)
- Outer: ±55° helical (20% of thickness)
- Total: ~25 layers of T700 carbon fiber/epoxy

TARGET: 1000+ vertices
CRITICAL: Accurate fiber angle representation, end boss thickening, lightweight structure`
        },
        {
            id: 'vacuum_jacket',
            name: 'Outer Vacuum Jacket Shell',
            targetVertices: 900,
            priority: 3,
            dependencies: ['composite_overwrap'],
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            material: 'compositeShell',
            prompt: `Generate the OUTER VACUUM JACKET for insulation vacuum space:

GEOMETRY:
- Cylindrical shell: 1020mm length, 500mm diameter
- Wall thickness: 2mm (lightweight composite shell)
- 50mm vacuum gap between composite tank and jacket
- Hemispherical end caps matching inner geometry

FEATURES:
- Vacuum port: 25mm diameter flange (for evacuation to <10^-5 torr)
- Getter material pockets: 4 locations around shell (maintain vacuum)
- Support strut pass-throughs: 8 locations (thermal breaks)
- Inspection ports: 2× 50mm diameter access points with vacuum seals

MATERIAL:
- Lightweight composite laminate (similar to overwrap but thinner)
- Outer gelcoat for environmental protection

TARGET: 900+ vertices
CRITICAL: Vacuum-tight construction, support for MLI layers, thermal isolation`
        },
        {
            id: 'mli_insulation_inner',
            name: 'Multi-Layer Insulation (Inner 20 Layers)',
            targetVertices: 600,
            priority: 4,
            dependencies: ['composite_overwrap'],
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            material: 'insulation',
            prompt: `Generate the INNER MLI BLANKET (first 20 layers of 40-layer system):

GEOMETRY:
- Conformal wrap around composite overwrap
- Each layer: 0.025mm aluminized Mylar + 0.1mm Dacron spacer net
- Total thickness: ~2.5mm for 20 layers
- Overlapping seams: 25mm overlap, staggered by layer

FEATURES:
- Layer separation: Dacron netting prevents contact (critical for vacuum insulation)
- Aluminized side: Faces inward (each layer) for radiation reflection
- Edge sealing: Perimeter taping to prevent layer slumping
- Cut-outs: Around support strut penetrations (minimize thermal bridges)

EFFECTIVE PERFORMANCE:
- Each layer reflects ~95% of incident thermal radiation
- 20 layers: Effective emissivity ~0.001
- Reduces radiative heat transfer by ~99.9%

TARGET: 600+ vertices (simplified representation of multi-layer structure)
CRITICAL: Show layered structure, conformal fit, reflective properties`
        },
        {
            id: 'mli_insulation_outer',
            name: 'Multi-Layer Insulation (Outer 20 Layers)',
            targetVertices: 600,
            priority: 5,
            dependencies: ['mli_insulation_inner'],
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            material: 'insulation',
            prompt: `Generate the OUTER MLI BLANKET (layers 21-40 of 40-layer system):

GEOMETRY:
- Second MLI blanket wrapped over inner 20 layers
- Total thickness: Additional 2.5mm (cumulative 5mm for all 40 layers)
- Seam offset: Rotated 90° from inner blanket seams (thermal bridge mitigation)

FEATURES:
- Same layer construction: Aluminized Mylar + Dacron spacer
- Compression prevention: Spacer nets maintain layer separation under vacuum
- Attachment: Minimal contact points to vacuum jacket (avoid thermal shorts)

COMBINED SYSTEM PERFORMANCE:
- 40 total layers
- Effective thermal conductivity: <0.1 mW/(m·K) at 10^-5 torr vacuum
- Boil-off rate: <1% per day for 100kg LH2 at -253°C

TARGET: 600+ vertices
CRITICAL: Layered appearance, thermal efficiency representation`
        },
        {
            id: 'support_struts',
            name: 'G-10 Fiberglass Thermal Break Supports (8 units)',
            targetVertices: 800,
            priority: 6,
            dependencies: ['composite_overwrap', 'vacuum_jacket'],
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            material: 'supportStruts',
            prompt: `Generate 8 THERMAL BREAK SUPPORT STRUTS connecting inner tank to outer jacket:

GEOMETRY PER STRUT:
- Length: 50mm (spans vacuum gap)
- Cross-section: 20mm × 10mm rectangular
- End attachments: 30mm diameter pads with 4× M6 bolt holes each end
- Material: G-10 fiberglass composite (low thermal conductivity: 0.3 W/(m·K))

POSITIONING:
- 8 struts arranged circumferentially around tank mid-section
- 45° spacing (every 45° around circumference)
- Radial orientation: Struts perpendicular to tank axis
- Offset from ends: 500mm from each end (mid-tank support)

FEATURES:
- Minimized contact area: <1% of total tank surface
- High compressive strength: Supports tank weight + 5g load factor (aviation)
- Electrical isolation: G-10 is non-conductive (prevents galvanic corrosion)

THERMAL ANALYSIS:
- Each strut conducts: ~0.3W heat load at 10K/cm gradient
- 8 struts total: ~2.4W parasitic heat load (acceptable for boil-off <1%/day)

TARGET: 800+ vertices total (100 vertices per strut × 8 struts)
CRITICAL: Low thermal conductivity material, minimized contact area, structural adequacy`
        },
        {
            id: 'fill_drain_pipe',
            name: 'Fill/Drain Pipe with Vacuum Jacketing',
            targetVertices: 500,
            priority: 7,
            dependencies: ['inner_tank_shell'],
            position: { x: 0, y: 0, z: -520 }, // Bottom end of tank
            rotation: { x: 90, y: 0, z: 0 },
            material: 'stainlessSteel',
            prompt: `Generate FILL/DRAIN PIPE with vacuum jacketing for cryogenic service:

INNER PIPE:
- Diameter: 25mm (1 inch nominal)
- Wall thickness: 1.5mm
- Length: 150mm (extends from tank bottom to outer jacket)
- Material: Stainless steel 316L (cryogenic-rated)
- End connection: Flange mount to tank (8× M8 bolts)

OUTER VACUUM JACKET:
- Diameter: 40mm (surrounds inner pipe with 7.5mm vacuum gap)
- Wall thickness: 1mm
- MLI wrapping: 10 layers inside vacuum gap
- Vacuum seal: Bellows at warm end (allows differential contraction)

FEATURES:
- Flow capacity: 50 kg/min LH2 (refueling time <10 min for 500kg tank)
- Thermal intercept: Copper braid at 77K (LN2) reduces heat load to inner pipe
- Burst pressure: 3× working pressure (45 bar burst for 15 bar working)

TARGET: 500+ vertices
CRITICAL: Vacuum-jacketed thermal isolation, cryogenic material compatibility`
        },
        {
            id: 'vent_pipe',
            name: 'Boil-off Gas Vent Pipe',
            targetVertices: 400,
            priority: 8,
            dependencies: ['inner_tank_shell'],
            position: { x: 0, y: 0, z: 520 }, // Top end of tank
            rotation: { x: 90, y: 0, z: 0 },
            material: 'stainlessSteel',
            prompt: `Generate BOIL-OFF GAS VENT PIPE for pressure relief and vapor management:

INNER PIPE:
- Diameter: 15mm (smaller than fill pipe, for gas only)
- Wall thickness: 1mm
- Length: 150mm
- Material: Stainless steel 316L

OUTER VACUUM JACKET:
- Diameter: 30mm
- MLI wrapping: 10 layers in vacuum gap
- Vacuum seal: Bellows joint

FEATURES:
- Dip tube: Extends 100mm into tank vapor space (captures warmest gas)
- Flow capacity: 2 g/s hydrogen gas (handles 1.5% boil-off rate)
- Connection: To pressure relief valve and catalytic recombiner (if equipped)

TARGET: 400+ vertices
CRITICAL: Prevent outside air ingress, manage pressure buildup, thermal isolation`
        },
        {
            id: 'pressure_relief_valve',
            name: 'Pressure Relief Valve (PRV)',
            targetVertices: 600,
            priority: 9,
            dependencies: ['vent_pipe'],
            position: { x: 0, y: 80, z: 600 },
            rotation: { x: 0, y: 0, z: 0 },
            material: 'valveBody',
            prompt: `Generate PRESSURE RELIEF VALVE for cryogenic hydrogen safety:

VALVE BODY:
- Type: Spring-loaded PRV (ASME Section VIII certified)
- Inlet: 15mm diameter (connects to vent pipe)
- Outlet: 25mm diameter (atmospheric discharge)
- Set pressure: 12 bar (overpressure protection at 10 bar working + 20% margin)
- Material: Brass body with stainless steel internals

GEOMETRY:
- Body: 60mm × 60mm × 80mm rectangular housing
- Spring chamber: 40mm diameter × 60mm height (encloses compression spring)
- Poppet valve: 15mm diameter sealing disc
- Adjustment screw: Top-mounted, M12 × 1.5 thread

FEATURES:
- Reseat pressure: 10.5 bar (reseals after pressure drops below set point)
- Flow capacity: 5 g/s H2 (prevents over-pressure during rapid boil-off)
- Freeze protection: Electric heater trace (prevents ice formation at valve seat)

TARGET: 600+ vertices
CRITICAL: Safety-critical component, accurate pressure rating, cryogenic-compatible materials`
        },
        {
            id: 'liquid_level_sensor',
            name: 'Capacitive Liquid Level Sensor',
            targetVertices: 350,
            priority: 10,
            dependencies: ['inner_tank_shell'],
            position: { x: 0, y: 0, z: 0 }, // Internal to tank, along centerline
            rotation: { x: 0, y: 0, z: 90 },
            material: 'stainlessSteel',
            prompt: `Generate CAPACITIVE LIQUID LEVEL SENSOR for continuous level monitoring:

SENSOR PROBE:
- Type: Coaxial capacitive sensor (differential capacitance)
- Length: 950mm (spans nearly full tank length)
- Outer electrode: 10mm diameter tube (stainless steel 316L)
- Inner electrode: 6mm diameter rod (insulated with PTFE)
- Mounting: Centered on tank axis, penetrates through top end boss

PRINCIPLE:
- Liquid hydrogen (ε_r = 1.25) vs vapor (ε_r = 1.0) changes capacitance
- Capacitance measured along probe length: determines liquid level to ±1%
- Cryogenic-rated electronics: -253°C to +85°C

FEATURES:
- Electrical feedthrough: Hermetic seal at top boss (prevents helium leaks)
- Signal conditioning: 4-20mA output (proportional to level 0-100%)
- Resolution: 10mm level accuracy over 1000mm range

TARGET: 350+ vertices
CRITICAL: Cryogenic electrical feedthrough, accurate geometry along centerline`
        },
        {
            id: 'mounting_brackets_forward',
            name: 'Forward Mounting Brackets (Aviation Interface)',
            targetVertices: 800,
            priority: 11,
            dependencies: ['vacuum_jacket'],
            position: { x: 0, y: 0, z: -510 },
            rotation: { x: 0, y: 0, z: 0 },
            material: 'compositeShell',
            prompt: `Generate FORWARD MOUNTING BRACKETS for aircraft attachment:

GEOMETRY:
- Type: Cradle-style supports (wraps 180° around tank bottom)
- Material: Carbon fiber composite (matches tank structure)
- Width: 100mm (distributes load over large area)
- Thickness: 8mm composite laminate

ATTACHMENT POINTS:
- 4× aircraft hardpoints: M12 bolts, 100mm spacing
- Load rating: 10g ultimate load factor (10× tank weight in any direction)
- Shear keys: Prevents tank rotation under lateral loads

FEATURES:
- Elastomeric pads: 5mm thick silicone rubber (isolates tank from airframe vibration)
- Thermal break: G-10 fiberglass shims (minimize heat conduction from airframe)
- Quick-release: Optional QD pins for tank removal (maintenance access)

LOAD CASES:
- Vertical: 10g down, 6g up (aerobatic maneuvers)
- Lateral: 8g side load (hard turning)
- Longitudinal: 10g fore/aft (crash deceleration)

TARGET: 800+ vertices
CRITICAL: High load capacity, vibration isolation, thermal break, aviation-certified`
        },
        {
            id: 'mounting_brackets_aft',
            name: 'Aft Mounting Brackets (Aviation Interface)',
            targetVertices: 800,
            priority: 12,
            dependencies: ['vacuum_jacket'],
            position: { x: 0, y: 0, z: 510 },
            rotation: { x: 0, y: 0, z: 0 },
            material: 'compositeShell',
            prompt: `Generate AFT MOUNTING BRACKETS for aircraft attachment:

GEOMETRY:
- Type: Cradle-style supports (matches forward brackets)
- Material: Carbon fiber composite
- Width: 100mm
- Thickness: 8mm composite laminate
- Allows thermal expansion: Sliding joint (tank contracts 3mm at -253°C)

ATTACHMENT POINTS:
- 4× aircraft hardpoints: M12 bolts
- Sliding mechanism: 10mm fore/aft travel (accommodates thermal contraction)
- Load rating: Same as forward brackets (10g ultimate)

FEATURES:
- Slot-style mount: Allows tank to contract without binding
- PTFE sliding pads: Low friction (μ < 0.1) for thermal movement
- Anti-rotation: Vertical key prevents rotation while allowing axial slide

DIFFERENTIAL EXPANSION ANALYSIS:
- Aluminum liner: Contracts 4mm over 1000mm at ΔT=280K (α=23 ppm/K)
- Composite overwrap: Contracts 0.3mm (α_axial=1 ppm/K for 0° fibers)
- Sliding joint: Accommodates 5mm total movement (safety factor 1.25)

TARGET: 800+ vertices
CRITICAL: Sliding thermal expansion joint, load capacity, vibration isolation`
        },
        {
            id: 'pressure_transducer',
            name: 'Cryogenic Pressure Transducer',
            targetVertices: 300,
            priority: 13,
            dependencies: ['inner_tank_shell'],
            position: { x: 150, y: 0, z: 400 }, // Side-mounted near top
            rotation: { x: 0, y: 90, z: 0 },
            material: 'stainlessSteel',
            prompt: `Generate CRYOGENIC PRESSURE TRANSDUCER for tank pressure monitoring:

SENSOR BODY:
- Type: Flush-diaphragm strain gauge transducer
- Mounting: 1/4" NPT threaded boss (penetrates vacuum jacket only, not inner tank)
- Sensing element: Measures vapor space pressure through stainless steel diaphragm
- Range: 0-20 bar absolute (covers working pressure 10 bar + overpressure margin)

GEOMETRY:
- Hexagonal body: 22mm across flats, 50mm length
- Diaphragm: 10mm diameter, 0.5mm thick (flexible for pressure sensing)
- Electrical connector: 4-pin M12 circular connector (IP68 rated)

CRYOGENIC RATING:
- Operating temperature: -270°C to +125°C
- Accuracy: ±0.1% full scale (±0.02 bar)
- Response time: <10ms (fast enough for pressure surge detection)

FEATURES:
- Temperature compensation: Internal RTD measures sensor temperature
- Hermetic seal: Prevents helium permeation into electronics
- Explosion-proof: ATEX-rated for hydrogen gas environment

TARGET: 300+ vertices
CRITICAL: Accurate pressure measurement, cryogenic compatibility, intrinsic safety`
        },
        {
            id: 'temperature_sensors',
            name: 'Cryogenic Temperature Sensors (4 units)',
            targetVertices: 200,
            priority: 14,
            dependencies: ['inner_tank_shell'],
            position: { x: 0, y: 0, z: 0 }, // Multiple positions (distributed)
            rotation: { x: 0, y: 0, z: 0 },
            material: 'stainlessSteel',
            prompt: `Generate 4 CRYOGENIC TEMPERATURE SENSORS at strategic locations:

SENSOR TYPE:
- Silicon diode temperature sensors (DT-670 or equivalent)
- Range: 1.4K to 500K (-271.75°C to +226.85°C)
- Accuracy: ±0.1K below 30K (critical for LH2 at 20K)

LOCATIONS:
1. Bottom liquid: Measures bulk liquid temperature
2. Mid-tank liquid: Monitors stratification
3. Top vapor: Measures ullage (vapor space) temperature
4. Tank wall: Monitors structural temperature (thermal stress)

GEOMETRY PER SENSOR:
- Probe: 6mm diameter × 50mm length stainless steel sheath
- Sensing tip: Silicon diode chip at probe end
- Mounting: 1/8" compression fitting (Swagelok-style)
- Wiring: 4-wire connection (eliminates lead resistance errors)

FEATURES:
- Fast response: <1 second time constant (detects boil-off transients)
- Low self-heating: <1µW power dissipation (doesn't disturb measurement)
- Interchangeable: Calibrated curves for ±0.1K accuracy without individual cal

TARGET: 200+ vertices total (50 per sensor × 4 sensors)
CRITICAL: Accurate cryogenic temperature measurement, strategic positioning`
        },
        {
            id: 'electrical_feedthrough',
            name: 'Hermetic Electrical Feedthrough',
            targetVertices: 250,
            priority: 15,
            dependencies: ['vacuum_jacket'],
            position: { x: 200, y: 0, z: 0 }, // Side of vacuum jacket
            rotation: { x: 0, y: 90, z: 0 },
            material: 'stainlessSteel',
            prompt: `Generate HERMETIC ELECTRICAL FEEDTHROUGH for sensors and heaters:

FEEDTHROUGH ASSEMBLY:
- Type: Glass-to-metal seal (GTMS) feedthrough
- Pins: 16× conductors (supports multiple sensors + heater control)
- Voltage rating: 500V DC (isolation between pins >10^9 Ω)
- Current rating: 5A per pin (heater circuits)

GEOMETRY:
- Flange: 80mm diameter × 10mm thick (CF flange compatible)
- Glass seal: 60mm diameter ceramic insulator
- Pins: 2mm diameter, 50mm length (8mm exposed inside, 42mm outside)
- Spacing: 10mm pin-to-pin (prevents arcing in vacuum)

FEATURES:
- Helium leak rate: <10^-9 std cm³/s (maintains vacuum jacket integrity)
- Cryogenic cycling: Rated for 1000+ cycles from 20K to 300K
- Radiation resistant: Tolerates space environment (if used in aerospace)

WIRING CONNECTIONS:
- Inside: Connects to level sensor, temperature sensors, pressure transducer
- Outside: M12 circular connectors (standardized interface)

TARGET: 250+ vertices
CRITICAL: Vacuum seal integrity, cryogenic thermal cycling, electrical isolation`
        },
        {
            id: 'nameplate_labels',
            name: 'Nameplate and Safety Labels',
            targetVertices: 150,
            priority: 16,
            dependencies: ['vacuum_jacket'],
            position: { x: -200, y: 0, z: 0 }, // Side of tank
            rotation: { x: 0, y: -90, z: 0 },
            material: 'stainlessSteel',
            prompt: `Generate NAMEPLATE and SAFETY LABELS for regulatory compliance:

NAMEPLATE DATA:
- Manufacturer name and address
- Serial number: Unique identifier for traceability
- Manufacture date: ISO 8601 format
- Design pressure: 10 bar working, 15 bar test, 45 bar burst
- Design temperature: -253°C to +65°C
- Capacity: 500 kg LH2 (or specify from prompt)
- Material specifications: ASME Section VIII Division 1 or EN 13445

SAFETY LABELS:
- "CRYOGENIC FLUID - EXTREMELY COLD"
- "FLAMMABLE GAS - NO SMOKING - NO OPEN FLAMES"
- "PRESSURE VESSEL - DO NOT MODIFY"
- "VENT GAS BEFORE MAINTENANCE"
- Pictograms: ISO 7010 cold hazard + flammable gas symbols

GEOMETRY:
- Main nameplate: 150mm × 100mm × 2mm stainless steel plate
- Safety labels: 100mm × 50mm each, 4 labels around tank circumference
- Mounting: Riveted or adhesive bonded (no welding to pressure boundary)
- Engraving: Laser-etched or stamped (permanent marking)

TARGET: 150+ vertices
CRITICAL: Regulatory compliance, readability, permanent marking`
        }
    ]
};
