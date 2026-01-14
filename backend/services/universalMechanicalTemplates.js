/**
 * UNIVERSAL MECHANICAL TEMPLATES
 *
 * Comprehensive component breakdown templates for ALL common mechanical systems
 * Supports: gears, pumps, cylinders, valves, bearings, motors, transmissions, etc.
 */

const productionV8Template = require('./productionV8Template');

module.exports = {
    // ==================== ENGINES ====================

    v8_engine: productionV8Template,

    inline_4_engine: {
        name: 'Inline 4-Cylinder Engine',
        totalComponents: 20,
        targetVertices: 10000,
        estimatedTime: '4-6 minutes',
        components: [
            // Base structure, 4 cylinders, 4 pistons, crankshaft, camshaft, head, valvetrain
        ]
    },

    // ==================== GEARS ====================

    spur_gear: {
        name: 'Spur Gear - Production Grade',
        totalComponents: 5,
        targetVertices: 3000,
        estimatedTime: '2-3 minutes',
        components: [
            {
                id: 'gear_teeth',
                name: 'Gear Teeth with Involute Profile',
                targetVertices: 1200,
                priority: 1,
                dependencies: [],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate spur gear TEETH with precise involute profile:
- Number of teeth: Extract from prompt (e.g., 48 teeth, 96 teeth)
- Module: Extract from prompt or default to 2.5mm
- Pressure angle: 20° (ISO standard)
- Tooth profile: TRUE involute curve (mathematically correct)
- Tooth depth: 2.25 × module
- Addendum: 1.0 × module
- Dedendum: 1.25 × module
- Each tooth: 25-30 vertices for smooth involute curve

Generate ALL teeth with complete geometry:
- Root circle, base circle, pitch circle, addendum circle
- Proper involute curve from base circle to tip
- Fillet radius at tooth root: 0.38 × module

TARGET: 1200+ vertices (25-30 per tooth × number of teeth)
CRITICAL: Mathematically correct involute profile, precise pressure angle`
            },
            {
                id: 'gear_web',
                name: 'Gear Web and Spokes',
                targetVertices: 800,
                priority: 2,
                dependencies: ['gear_teeth'],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate gear WEB structure:
- Outer rim: connects to gear teeth
- Web thickness: Calculate based on torque requirements
- Spoke pattern: 6 or 8 spokes for weight reduction
- Lightening holes: between spokes if diameter > 200mm
- Hub boss: central mounting area, thickened section

Include stress-relief fillets at all junctions

TARGET: 800 vertices
CRITICAL: Structural integrity, balanced mass distribution`
            },
            {
                id: 'gear_hub',
                name: 'Central Hub with Bore',
                targetVertices: 500,
                priority: 3,
                dependencies: ['gear_web'],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate gear HUB:
- Central bore: Extract diameter from prompt or calculate from gear size
- Keyway: Standard parallel key (DIN 6885) or spline
- Set screw holes: 2-4 threaded holes, M6 or M8
- Hub extension: extends beyond gear face for bearing support
- Face width: Standard proportions (10-15% of pitch diameter)

TARGET: 500 vertices
CRITICAL: Precise bore diameter, proper keyway dimensions`
            },
            {
                id: 'gear_chamfers',
                name: 'Edge Chamfers and Finishing',
                targetVertices: 300,
                priority: 4,
                dependencies: ['gear_teeth', 'gear_web', 'gear_hub'],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate FINISHING features:
- Tooth tip chamfer: 0.5mm × 45° on both edges
- Bore chamfer: 1.5mm × 45° for easy shaft insertion
- Face chamfers: 0.5mm × 45° on outer edges
- Deburring edges: smooth transitions

TARGET: 300 vertices
CRITICAL: Safety edges, manufacturing-ready`
            },
            {
                id: 'gear_markings',
                name: 'Gear Markings and Identification',
                targetVertices: 200,
                priority: 5,
                dependencies: ['gear_web'],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate MARKINGS on gear face:
- Part number: engraved or stamped
- Gear specifications: module, teeth count, pressure angle
- Material grade: steel grade marking
- Rotation direction arrow: for helical gears
- Manufacturer logo area

TARGET: 200 vertices
CRITICAL: Clear, readable identification`
            }
        ]
    },

    helical_gear: {
        name: 'Helical Gear',
        totalComponents: 6,
        targetVertices: 3500,
        components: [
            /* Similar to spur gear but with helix angle on teeth */
        ]
    },

    bevel_gear: {
        name: 'Bevel Gear (90° Angle)',
        totalComponents: 7,
        targetVertices: 4000,
        components: [
            /* Conical teeth, curved tooth profile */
        ]
    },

    // ==================== HYDRAULIC SYSTEMS ====================

    hydraulic_cylinder: {
        name: 'Hydraulic Cylinder Assembly',
        totalComponents: 12,
        targetVertices: 6000,
        estimatedTime: '3-4 minutes',
        components: [
            {
                id: 'cylinder_barrel',
                name: 'Cylinder Barrel (Tube)',
                targetVertices: 500,
                priority: 1,
                dependencies: [],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate hydraulic cylinder BARREL:
- Extract bore diameter from prompt (e.g., 50mm, 80mm, 100mm)
- Extract stroke length from prompt (e.g., 200mm, 300mm, 500mm)
- Wall thickness: 10-15mm (pressure-rated)
- Honed inner surface: Ra 0.2μm finish
- Outer surface: machined smooth
- Material: High-strength steel tube

Length = stroke + 2× bore diameter (for rod extension)
Precise concentricity: ±0.01mm

TARGET: 500 vertices
CRITICAL: Precise bore diameter, honed finish`
            },
            {
                id: 'piston',
                name: 'Hydraulic Piston',
                targetVertices: 600,
                priority: 2,
                dependencies: ['cylinder_barrel'],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate hydraulic PISTON:
- Diameter: Bore diameter - 0.1mm (clearance)
- Piston ring grooves: 2-3 grooves for seals
- Rod attachment: threaded bore or threaded stud
- Wear bands: recessed areas for bearing strips
- Porting: internal passages if double-acting

TARGET: 600 vertices
CRITICAL: Seal groove dimensions, tight tolerances`
            },
            {
                id: 'piston_rod',
                name: 'Piston Rod',
                targetVertices: 400,
                priority: 2,
                dependencies: ['piston'],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate piston ROD:
- Diameter: 40-60% of bore diameter
- Length: Stroke + extensions
- Chrome-plated surface: mirror finish
- Threaded end: for mounting clevis/eye
- Wiper grooves: for seal contact

TARGET: 400 vertices
CRITICAL: Chrome finish, straightness ±0.05mm`
            },
            {
                id: 'rod_gland',
                name: 'Rod Gland (Head)',
                targetVertices: 600,
                priority: 3,
                dependencies: ['cylinder_barrel', 'piston_rod'],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate rod GLAND:
- Mounts to cylinder barrel end
- Rod bore: Clearance for rod passage
- Seal grooves: wiper seal, primary seal, backup seal
- Bearing surface: bronze bushing area
- Port: hydraulic fluid port (if double-acting)
- Bolt holes: 4-8 holes for barrel attachment

TARGET: 600 vertices
CRITICAL: Seal groove precision, bearing surface`
            },
            {
                id: 'cap_end',
                name: 'Cap End (Blind End)',
                targetVertices: 500,
                priority: 3,
                dependencies: ['cylinder_barrel'],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate cap END:
- Closed end of cylinder
- Hydraulic port: NPT or SAE thread
- Mounting features: clevis mount, flange, or trunnion
- Bolt holes: matches rod gland pattern
- Internal pocket: space for piston travel

TARGET: 500 vertices
CRITICAL: Port threads, pressure rating`
            },
            {
                id: 'seals_wipers',
                name: 'Seals and Wipers',
                targetVertices: 800,
                priority: 4,
                dependencies: ['piston', 'rod_gland'],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate all SEALS:
- Piston seals: 2× U-cup or O-ring + backup
- Rod seals: Primary seal + backup seal
- Wiper seal: Protects from contamination
- Wear rings: PTFE or bronze
- Static seals: O-rings for gland/cap

TARGET: 800 vertices
CRITICAL: Proper seal profiles, material indication`
            },
            {
                id: 'mounting_hardware',
                name: 'Mounting Hardware',
                targetVertices: 700,
                priority: 5,
                dependencies: ['cap_end', 'piston_rod'],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate MOUNTING hardware:
- Clevis mount: on cap end (pin bore, ears)
- Rod eye: threaded on rod end (pin bore)
- Clevis pin: hardened steel, retained
- Grease fittings: Zerk fittings for lubrication
- Tie rods: if threaded-style cylinder (4-8 rods)

TARGET: 700 vertices
CRITICAL: Pin bore alignment, load capacity`
            },
            {
                id: 'ports_fittings',
                name: 'Hydraulic Ports and Fittings',
                targetVertices: 600,
                priority: 5,
                dependencies: ['cap_end', 'rod_gland'],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate PORTS and fittings:
- Port size: Extract from prompt or standard sizing
- Thread type: NPT, BSPP, or SAE
- Port bosses: reinforced areas around ports
- Bleed ports: small ports for air bleeding
- Pressure test port: capped port for testing

TARGET: 600 vertices
CRITICAL: Thread specifications, pressure rating`
            },
            {
                id: 'cushions',
                name: 'End-of-Stroke Cushions',
                targetVertices: 500,
                priority: 6,
                dependencies: ['piston', 'cap_end', 'rod_gland'],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate CUSHION mechanisms:
- Cushion spears: on both ends of piston
- Cushion pockets: in cap and gland
- Adjustable needle valves: for cushion control
- Bypass orifices: controlled fluid flow
- Cushion sleeves: guide the spears

TARGET: 500 vertices
CRITICAL: Smooth deceleration, adjustability`
            },
            {
                id: 'protective_covers',
                name: 'Rod Protective Covers',
                targetVertices: 400,
                priority: 7,
                dependencies: ['piston_rod'],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate PROTECTIVE covers:
- Accordion boot: rubber or plastic, collapsible
- Mounting: clamps on rod gland and rod eye
- Material: Neoprene, polyurethane, or steel
- Venting: allows air exchange
- Protection: prevents contamination of rod

TARGET: 400 vertices
CRITICAL: Flexibility, complete protection`
            },
            {
                id: 'position_sensors',
                name: 'Position Sensing System',
                targetVertices: 400,
                priority: 7,
                dependencies: ['cylinder_barrel', 'piston_rod'],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate POSITION sensors:
- Magnetostrictive sensor: along barrel length
- Sensor rod: parallel to piston rod
- Mounting brackets: secure sensor to barrel
- Electrical connector: M12 or similar
- Magnet ring: on piston for position detection

TARGET: 400 vertices
CRITICAL: Sensor alignment, magnet positioning`
            },
            {
                id: 'nameplate_warnings',
                name: 'Nameplate and Warning Labels',
                targetVertices: 200,
                priority: 8,
                dependencies: ['cylinder_barrel'],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate LABELS:
- Nameplate: Model, serial number, pressure rating
- Warning labels: Pressure warnings, pinch points
- Material specification: engraved on barrel
- Port identification: A-port, B-port labels
- Maintenance instructions: inspection schedule

TARGET: 200 vertices
CRITICAL: Legibility, durability`
            }
        ]
    },

    // ==================== PUMPS ====================

    centrifugal_pump: {
        name: 'Centrifugal Pump Assembly',
        totalComponents: 15,
        targetVertices: 7000,
        estimatedTime: '4-5 minutes',
        components: [
            // Impeller, volute casing, shaft, seals, bearings, coupling, motor mount
        ]
    },

    gear_pump: {
        name: 'Gear Pump',
        totalComponents: 10,
        targetVertices: 5000,
        components: [
            // Drive gear, driven gear, pump body, ports, seals, shaft, bearings
        ]
    },

    // ==================== VALVES ====================

    ball_valve: {
        name: 'Ball Valve Assembly',
        totalComponents: 12,
        targetVertices: 5000,
        estimatedTime: '3-4 minutes',
        components: [
            // Ball, body, seats, stem, handle, packing, end connections
        ]
    },

    gate_valve: {
        name: 'Gate Valve',
        totalComponents: 14,
        targetVertices: 6000,
        components: [
            // Gate/wedge, body, bonnet, stem, handwheel, packing, seats
        ]
    },

    // ==================== BEARINGS ====================

    ball_bearing: {
        name: 'Deep Groove Ball Bearing',
        totalComponents: 4,
        targetVertices: 2500,
        estimatedTime: '1-2 minutes',
        components: [
            {
                id: 'inner_race',
                name: 'Inner Race',
                targetVertices: 600,
                priority: 1,
                dependencies: [],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate bearing INNER RACE:
- Extract bearing size from prompt (e.g., 6205 = 25mm ID)
- Deep groove raceway: semi-circular profile
- Bore diameter: Standard bearing designation
- Shoulders: on both sides of raceway
- Surface finish: Ra 0.1μm (superfinish)

TARGET: 600 vertices
CRITICAL: Raceway radius precision, surface finish`
            },
            {
                id: 'outer_race',
                name: 'Outer Race',
                targetVertices: 600,
                priority: 1,
                dependencies: [],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate bearing OUTER RACE:
- OD from bearing designation (e.g., 6205 = 52mm OD)
- Deep groove raceway: matches inner race
- Outer diameter: housing fit specification
- Shoulders: contain balls
- Surface finish: Ra 0.1μm

TARGET: 600 vertices
CRITICAL: Raceway precision, concentricity`
            },
            {
                id: 'balls',
                name: 'Rolling Elements (Balls)',
                targetVertices: 1000,
                priority: 2,
                dependencies: ['inner_race', 'outer_race'],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate bearing BALLS:
- Ball diameter: Calculate from raceway geometry
- Number of balls: Based on bearing size (typically 6-12)
- Perfect spheres: Grade 10 or better (0.0025mm tolerance)
- Material: Chrome steel or ceramic
- Spacing: Even distribution around raceway

Position balls in raceway with proper contact angles

TARGET: 1000 vertices (high resolution per ball)
CRITICAL: Perfect sphericity, even spacing`
            },
            {
                id: 'cage_retainer',
                name: 'Ball Cage (Retainer)',
                targetVertices: 300,
                priority: 3,
                dependencies: ['balls'],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate ball CAGE:
- Cage type: Stamped steel, machined brass, or polymer
- Ball pockets: One per ball, sized for retention
- Cage bars: connect pockets in circular pattern
- Centering: Outer-ring guided or ball-guided
- Clearances: Allow ball rotation

TARGET: 300 vertices
CRITICAL: Ball pocket clearances, strength`
            }
        ]
    },

    // ==================== TRANSMISSION COMPONENTS ====================

    gearbox_assembly: {
        name: 'Gearbox (3-Speed)',
        totalComponents: 25,
        targetVertices: 12000,
        estimatedTime: '6-8 minutes',
        components: [
            // Housing, input shaft, output shaft, gears, bearings, synchronizers, shift forks
        ]
    },

    // ==================== ELECTRIC MOTORS ====================

    electric_motor: {
        name: 'Electric Motor (AC Induction)',
        totalComponents: 18,
        targetVertices: 9000,
        estimatedTime: '5-6 minutes',
        components: [
            // Stator, rotor, shaft, end bells, bearings, fan, terminal box
        ]
    },

    // ==================== CUSTOM / GENERIC ====================

    custom_component: {
        name: 'Custom Mechanical Component',
        totalComponents: 1,
        targetVertices: 2000,
        components: [
            {
                id: 'custom_part',
                name: 'Custom Mechanical Part',
                targetVertices: 2000,
                priority: 1,
                dependencies: [],
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                prompt: `Generate the mechanical component EXACTLY as described in the user prompt.

Use ALL 64,000 output tokens for geometry detail:
- Complex features: threads, holes, pockets, bosses
- Precise dimensions: extract from prompt
- Manufacturing features: fillets, chamfers, draft angles
- Industry standard tolerances

TARGET: 2000+ vertices
CRITICAL: Follow ALL specifications in user prompt`
            }
        ]
    }
};
