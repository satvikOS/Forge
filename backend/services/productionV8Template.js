/**
 * PRODUCTION V8 ENGINE TEMPLATE
 *
 * 30+ component breakdown with precise positioning for production-ready detail
 * Targeting 15,000+ vertices total (30 × 500 avg)
 *
 * Coordinate System:
 * - Origin: Crankshaft centerline at main bearing #3 (center)
 * - X-axis: Left (-) to Right (+)
 * - Y-axis: Rear (-) to Front (+)
 * - Z-axis: Bottom (-) to Top (+)
 * - Units: millimeters
 */

module.exports = {
    name: 'V8 Engine Block - Production Grade',
    totalComponents: 32,
    targetVertices: 15000,
    estimatedTime: '5-8 minutes',

    // V8 Engine Specifications
    specifications: {
        bore: 88.0,          // mm
        stroke: 92.0,        // mm
        vAngle: 90,          // degrees
        displacement: 4479,  // cc (4.5L)
        bankOffset: 37.5,    // mm from centerline
        cylinderSpacing: 110 // mm center-to-center
    },

    components: [
        // ==================== WAVE 1: BASE STRUCTURE ====================
        {
            id: 'block_base_lower',
            name: 'Engine Block Base - Lower Half',
            description: 'Bottom section with main bearing caps and oil pan rail',
            targetVertices: 600,
            priority: 1,
            dependencies: [],
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate the LOWER HALF of V8 engine block base:
- Outer dimensions: 600mm (L) × 300mm (W) × 120mm (H) from bottom
- 5 main bearing saddles: 65mm diameter, spaced 110mm apart
- Main bearing caps (separate pieces): 80mm × 60mm × 40mm each
- Structural webbing between bearing saddles (12mm thick)
- Oil pan mounting rail: continuous flange, 8mm thick, 15mm wide
- Sump cavity depression: 80mm × 400mm × 40mm deep
- M8 bolt holes on oil pan rail: 30 holes, evenly spaced
- Drain plug boss: M14 thread, bottom center

Position in coordinate system:
- Center main bearing (bearing #3) at origin
- Extends from Z = -60mm (bottom) to Z = 60mm (mid-plane)

TARGET: 600 vertices
CRITICAL: Precise bearing saddle diameter (65.00mm ±0.01mm)`
        },

        {
            id: 'block_base_upper',
            name: 'Engine Block Base - Upper Half',
            description: 'Upper section with deck surface and lifter valley',
            targetVertices: 600,
            priority: 1,
            dependencies: [],
            position: { x: 0, y: 0, z: 60 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate the UPPER HALF of V8 engine block base:
- Outer dimensions: 600mm (L) × 300mm (W) × 140mm (H) from mid-plane
- Deck surface: machined flat, 0.001mm tolerance
- Lifter valley: 80mm wide × 500mm long × 40mm deep (V-shape)
- Timing chain cavity (front): 120mm × 100mm × 60mm deep
- Bellhousing flange (rear): 200mm diameter, 8× M12 bolt holes
- Pushrод tunnels: 16 holes, 15mm diameter
- Head bolt bosses: 32 total (4 per cylinder), M12 threads
- Deck coolant passages: 16 holes, 8mm diameter

Position in coordinate system:
- Base at Z = 60mm (mid-plane)
- Extends to Z = 200mm (deck surface)

TARGET: 600 vertices
CRITICAL: Deck surface flatness (0.001mm), head bolt positioning`
        },

        {
            id: 'crankshaft_main_journals',
            name: 'Crankshaft - Main Bearing Journals',
            description: '5 main journals with oil passages',
            targetVertices: 500,
            priority: 1,
            dependencies: [],
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 90, z: 0 },  // Aligned with Y-axis (front-rear)
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate crankshaft MAIN BEARING JOURNALS only:
- 5 journals: 60mm diameter × 28mm width each
- Spacing: 110mm center-to-center along crankshaft axis
- Surface finish: mirror polish (Ra 0.2μm)
- Oil passage holes: 8mm diameter through each journal
- Journal fillets: 3mm radius where journals meet webs

Positioning:
- Journal #3 (center) at origin
- Journals #1,2 at Y = -110mm, -220mm (rear)
- Journals #4,5 at Y = +110mm, +220mm (front)
- All journals concentric on Y-axis

TARGET: 500 vertices (100 per journal)
CRITICAL: 60.00mm diameter (±0.005mm), concentric alignment`
        },

        {
            id: 'crankshaft_rod_journals',
            name: 'Crankshaft - Connecting Rod Journals',
            description: '8 rod journals offset for 90° V-angle',
            targetVertices: 600,
            priority: 1,
            dependencies: [],
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 90, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate crankshaft CONNECTING ROD JOURNALS:
- 8 journals: 52mm diameter × 24mm width each
- Offset from crankshaft centerline: 46mm (stroke/2 = 92/2)
- Journal pairs at 90° intervals (flat-plane crank)
- Firing order positions: 1-8-7-2-6-5-4-3

Journal positions (Y-axis along crank):
- Cylinders 1&2: Y = -220mm, crank angles 0° and 180°
- Cylinders 7&8: Y = -110mm, crank angles 90° and 270°
- Cylinders 6&5: Y = +110mm, crank angles 270° and 90°
- Cylinders 4&3: Y = +220mm, crank angles 180° and 0°

Each journal offset 46mm from centerline in X-Z plane

TARGET: 600 vertices (75 per journal)
CRITICAL: 52.00mm diameter (±0.005mm), 46mm stroke radius`
        },

        {
            id: 'crankshaft_counterweights',
            name: 'Crankshaft - Counterweights',
            description: '8 counterweights for dynamic balance',
            targetVertices: 500,
            priority: 1,
            dependencies: [],
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 90, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate crankshaft COUNTERWEIGHTS:
- 8 counterweights total (one per rod journal)
- Aerodynamic teardrop profile: 120mm × 80mm × 25mm thick
- Mass balance: calculated for 600g piston assembly
- Material removal pockets: for fine balance adjustment
- Smooth surfaces for reduced windage losses

Position opposite to rod journals for balance
Typical counterweight is 180° opposite from rod journal

TARGET: 500 vertices
CRITICAL: Balanced mass distribution`
        },

        // ==================== WAVE 2: CYLINDER BANKS ====================
        {
            id: 'left_bank_cylinder_1',
            name: 'Left Bank - Cylinder #1',
            description: 'Cylinder bore #1 with cooling jacket',
            targetVertices: 450,
            priority: 2,
            dependencies: ['block_base_upper'],
            position: { x: -37.5, y: -165, z: 60 },  // Left bank offset, rear position
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate SINGLE CYLINDER BORE #1 (left bank, rear):
- Bore diameter: 88.00mm (±0.01mm)
- Bore depth: 92mm (stroke depth)
- Bore surface: cross-hatch pattern (45° angle, Ra 0.8μm)
- Cooling water jacket: 4mm thick, surrounds 270° of bore
- Water jacket passages: connect to adjacent cylinder
- Head gasket surface: 2mm wide flat land around bore top
- Head bolt holes: 4× M12 threads, positioned at 45° intervals
- Oil drain-back passage: 12mm diameter, bottom of bore

Cylinder geometry:
- Main bore: 32 vertices (16 top ring + 16 bottom ring)
- Cooling jacket: 32 vertices (16 inner + 16 outer)
- Total vertices: 64 for bore + additional for features

TARGET: 450 vertices
CRITICAL: 88.00mm bore diameter, proper cooling jacket`
        },

        {
            id: 'left_bank_cylinder_2',
            name: 'Left Bank - Cylinder #2',
            description: 'Cylinder bore #2 with cooling jacket',
            targetVertices: 450,
            priority: 2,
            dependencies: ['block_base_upper'],
            position: { x: -37.5, y: -55, z: 60 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate SINGLE CYLINDER BORE #2 (left bank):
[Same specifications as Cylinder #1]

Position: 110mm forward of cylinder #1 (Y = -55mm)

TARGET: 450 vertices
CRITICAL: 88.00mm bore diameter, cooling jacket connects to #1`
        },

        {
            id: 'left_bank_cylinder_3',
            name: 'Left Bank - Cylinder #3',
            description: 'Cylinder bore #3 with cooling jacket',
            targetVertices: 450,
            priority: 2,
            dependencies: ['block_base_upper'],
            position: { x: -37.5, y: 55, z: 60 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate SINGLE CYLINDER BORE #3 (left bank):
[Same specifications as Cylinder #1]

Position: 110mm forward of cylinder #2 (Y = 55mm)

TARGET: 450 vertices
CRITICAL: 88.00mm bore diameter, cooling jacket connects to #2`
        },

        {
            id: 'left_bank_cylinder_4',
            name: 'Left Bank - Cylinder #4',
            description: 'Cylinder bore #4 with cooling jacket',
            targetVertices: 450,
            priority: 2,
            dependencies: ['block_base_upper'],
            position: { x: -37.5, y: 165, z: 60 },  // Front position
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate SINGLE CYLINDER BORE #4 (left bank, front):
[Same specifications as Cylinder #1]

Position: 110mm forward of cylinder #3 (Y = 165mm)

TARGET: 450 vertices
CRITICAL: 88.00mm bore diameter, cooling jacket connects to #3`
        },

        {
            id: 'right_bank_cylinder_5',
            name: 'Right Bank - Cylinder #5',
            description: 'Cylinder bore #5 with cooling jacket',
            targetVertices: 450,
            priority: 2,
            dependencies: ['block_base_upper'],
            position: { x: 37.5, y: -165, z: 60 },  // Right bank, rear
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate SINGLE CYLINDER BORE #5 (right bank, rear):
[Same specifications as Cylinder #1, mirrored to right bank]

TARGET: 450 vertices
CRITICAL: 88.00mm bore diameter`
        },

        {
            id: 'right_bank_cylinder_6',
            name: 'Right Bank - Cylinder #6',
            description: 'Cylinder bore #6 with cooling jacket',
            targetVertices: 450,
            priority: 2,
            dependencies: ['block_base_upper'],
            position: { x: 37.5, y: -55, z: 60 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate SINGLE CYLINDER BORE #6 (right bank):
[Same specifications as Cylinder #1]

TARGET: 450 vertices`
        },

        {
            id: 'right_bank_cylinder_7',
            name: 'Right Bank - Cylinder #7',
            description: 'Cylinder bore #7 with cooling jacket',
            targetVertices: 450,
            priority: 2,
            dependencies: ['block_base_upper'],
            position: { x: 37.5, y: 55, z: 60 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate SINGLE CYLINDER BORE #7 (right bank):
[Same specifications as Cylinder #1]

TARGET: 450 vertices`
        },

        {
            id: 'right_bank_cylinder_8',
            name: 'Right Bank - Cylinder #8',
            description: 'Cylinder bore #8 with cooling jacket',
            targetVertices: 450,
            priority: 2,
            dependencies: ['block_base_upper'],
            position: { x: 37.5, y: 165, z: 60 },  // Front
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate SINGLE CYLINDER BORE #8 (right bank, front):
[Same specifications as Cylinder #1]

TARGET: 450 vertices`
        },

        // ==================== WAVE 3: PISTONS ====================
        // [Continue with 8 individual pistons with detailed specifications...]
        // Each piston: crown, ring lands, skirt, wrist pin bosses
        // 500 vertices each × 8 = 4000 vertices

        {
            id: 'piston_1',
            name: 'Piston #1 Assembly',
            description: 'Piston with rings and wrist pin for cylinder #1',
            targetVertices: 500,
            priority: 3,
            dependencies: ['left_bank_cylinder_1', 'crankshaft_rod_journals'],
            position: { x: -37.5, y: -165, z: 106 },  // Mid-stroke position
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate COMPLETE PISTON #1:
- Piston diameter: 87.95mm (0.05mm clearance from 88mm bore)
- Crown: domed top, 10:1 compression ratio, valve reliefs
- Ring lands: 3 grooves (2 compression + 1 oil ring)
  * Top ring groove: 1.5mm wide × 1.8mm deep
  * Second ring groove: 1.5mm wide × 1.8mm deep
  * Oil ring groove: 3.0mm wide × 3.2mm deep
- Skirt: 60mm length, cam-ground oval profile (87.90mm × 87.85mm)
- Wrist pin bosses: 2× internal bosses, 23mm diameter bores
- Wrist pin: 23mm diameter × 70mm length, through both bosses

Piston rings (include all 3):
- Top compression ring: 1.5mm thick, chrome-faced
- Second compression ring: 1.5mm thick, taper-faced
- Oil control ring: 3mm thick, 3-piece design

TARGET: 500 vertices
CRITICAL: 87.95mm diameter (0.05mm piston-to-bore clearance)`
        },

        // ... Continue for pistons 2-8 (similar structure, different positions)

        {
            id: 'piston_2',
            name: 'Piston #2 Assembly',
            description: 'Piston for cylinder #2',
            targetVertices: 500,
            priority: 3,
            dependencies: ['left_bank_cylinder_2'],
            position: { x: -37.5, y: -55, z: 106 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `[Same as Piston #1 specifications]
TARGET: 500 vertices`
        },

        {
            id: 'piston_3',
            name: 'Piston #3 Assembly',
            targetVertices: 500,
            priority: 3,
            dependencies: ['left_bank_cylinder_3'],
            position: { x: -37.5, y: 55, z: 106 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `[Same as Piston #1 specifications]
TARGET: 500 vertices`
        },

        {
            id: 'piston_4',
            name: 'Piston #4 Assembly',
            targetVertices: 500,
            priority: 3,
            dependencies: ['left_bank_cylinder_4'],
            position: { x: -37.5, y: 165, z: 106 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `[Same as Piston #1 specifications]
TARGET: 500 vertices`
        },

        {
            id: 'piston_5',
            name: 'Piston #5 Assembly',
            targetVertices: 500,
            priority: 3,
            dependencies: ['right_bank_cylinder_5'],
            position: { x: 37.5, y: -165, z: 106 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `[Same as Piston #1 specifications]
TARGET: 500 vertices`
        },

        {
            id: 'piston_6',
            name: 'Piston #6 Assembly',
            targetVertices: 500,
            priority: 3,
            dependencies: ['right_bank_cylinder_6'],
            position: { x: 37.5, y: -55, z: 106 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `[Same as Piston #1 specifications]
TARGET: 500 vertices`
        },

        {
            id: 'piston_7',
            name: 'Piston #7 Assembly',
            targetVertices: 500,
            priority: 3,
            dependencies: ['right_bank_cylinder_7'],
            position: { x: 37.5, y: 55, z: 106 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `[Same as Piston #1 specifications]
TARGET: 500 vertices`
        },

        {
            id: 'piston_8',
            name: 'Piston #8 Assembly',
            targetVertices: 500,
            priority: 3,
            dependencies: ['right_bank_cylinder_8'],
            position: { x: 37.5, y: 165, z: 106 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `[Same as Piston #1 specifications]
TARGET: 500 vertices`
        },

        // ==================== WAVE 4: CONNECTING RODS ====================

        {
            id: 'connecting_rods_1_to_4',
            name: 'Connecting Rods #1-4 (Left Bank)',
            description: '4 connecting rods for left cylinder bank',
            targetVertices: 800,
            priority: 4,
            dependencies: ['piston_1', 'piston_2', 'piston_3', 'piston_4'],
            position: { x: -37.5, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate 4 CONNECTING RODS for left bank cylinders:
Each rod specifications:
- Center-to-center length: 150mm
- Big end bearing diameter: 52mm (matches rod journal)
- Small end bearing diameter: 23mm (matches wrist pin)
- Rod material: forged steel I-beam cross-section
- Big end: split design with cap, 2× M10 bolts
- Rod bolts: tensile strength marked
- Oil squirt hole: 2mm diameter, aimed at piston underside

Position 4 rods at Y positions: -165, -55, 55, 165mm
All rods identical, mirrored positioning

TARGET: 800 vertices (200 per rod)
CRITICAL: 150mm center-to-center length, 52mm/23mm bearing bores`
        },

        {
            id: 'connecting_rods_5_to_8',
            name: 'Connecting Rods #5-8 (Right Bank)',
            description: '4 connecting rods for right cylinder bank',
            targetVertices: 800,
            priority: 4,
            dependencies: ['piston_5', 'piston_6', 'piston_7', 'piston_8'],
            position: { x: 37.5, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `[Same as connecting rods 1-4, mirrored to right bank]
TARGET: 800 vertices`
        },

        // ==================== WAVE 5: CYLINDER HEADS & VALVETRAIN ====================

        {
            id: 'left_cylinder_head',
            name: 'Left Cylinder Head',
            description: 'Complete cylinder head for left bank',
            targetVertices: 1000,
            priority: 5,
            dependencies: ['left_bank_cylinder_1', 'left_bank_cylinder_2', 'left_bank_cylinder_3', 'left_bank_cylinder_4'],
            position: { x: -37.5, y: 0, z: 152 },  // Above cylinders
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate LEFT CYLINDER HEAD (4 cylinders):
- Combustion chambers: 4× chambers, 60cc volume each
- Intake ports: 8 total (2 per cylinder), 38mm diameter
- Exhaust ports: 8 total (2 per cylinder), 35mm diameter
- Valve seats: 16 total, hardened steel inserts
  * Intake valve seats: 38mm outer diameter
  * Exhaust valve seats: 33mm outer diameter
- Valve guides: 16× bronze guides, 8mm ID × 12mm OD
- Head bolt holes: 16× through-holes, M12 clearance
- Coolant passages: interconnected between cylinders
- Spark plug holes: 4× M14 threads, centered in chambers
- Deck surface: precision ground, 0.001mm flatness

TARGET: 1000 vertices
CRITICAL: Valve seat angles (45° intake, 45° exhaust), port flow`
        },

        {
            id: 'right_cylinder_head',
            name: 'Right Cylinder Head',
            description: 'Complete cylinder head for right bank',
            targetVertices: 1000,
            priority: 5,
            dependencies: ['right_bank_cylinder_5', 'right_bank_cylinder_6', 'right_bank_cylinder_7', 'right_bank_cylinder_8'],
            position: { x: 37.5, y: 0, z: 152 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `[Same as left cylinder head, mirrored]
TARGET: 1000 vertices`
        },

        {
            id: 'intake_valves',
            name: 'Intake Valves (All 16)',
            description: '16 intake valves',
            targetVertices: 600,
            priority: 6,
            dependencies: ['left_cylinder_head', 'right_cylinder_head'],
            position: { x: 0, y: 0, z: 145 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate 16 INTAKE VALVES:
Each valve:
- Head diameter: 38mm, tulip-shaped
- Stem diameter: 8mm, 110mm length
- Face angle: 45°
- Margin: 1.5mm thick
- Stem grooves: 3 grooves for keeper locks
- Material: stainless steel (polished head)

Valve positioning: 2 per cylinder × 8 cylinders = 16 valves
Positioned within cylinder heads at proper angles

TARGET: 600 vertices (37.5 per valve)
CRITICAL: 38mm head diameter, 45° seat angle`
        },

        {
            id: 'exhaust_valves',
            name: 'Exhaust Valves (All 16)',
            description: '16 exhaust valves',
            targetVertices: 600,
            priority: 6,
            dependencies: ['left_cylinder_head', 'right_cylinder_head'],
            position: { x: 0, y: 0, z: 145 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate 16 EXHAUST VALVES:
Each valve:
- Head diameter: 33mm (smaller than intake)
- Stem diameter: 8mm, 110mm length
- Face angle: 45°
- Margin: 2mm thick (thicker for heat)
- Stem grooves: 3 grooves for keeper locks
- Material: Inconel (heat-resistant alloy)

TARGET: 600 vertices
CRITICAL: 33mm head diameter, heat-resistant design`
        },

        {
            id: 'camshafts_left_intake',
            name: 'Left Bank Intake Camshaft',
            description: 'Intake camshaft for left bank',
            targetVertices: 400,
            priority: 6,
            dependencies: ['left_cylinder_head'],
            position: { x: -52, y: 0, z: 180 },  // Above left head
            rotation: { x: 0, y: 90, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate LEFT INTAKE CAMSHAFT:
- 4 cam lobes (one per cylinder)
- Lobe profile: 10mm lift, 260° duration, 108° lobe separation
- Base circle diameter: 30mm
- Lobe peak diameter: 40mm (10mm lift)
- Bearing journals: 5× journals, 28mm diameter
- Cam gear mounting: front end, 40-tooth gear
- Oil passages: through hollow camshaft core

TARGET: 400 vertices
CRITICAL: 10mm valve lift, 260° duration`
        },

        {
            id: 'camshafts_left_exhaust',
            name: 'Left Bank Exhaust Camshaft',
            description: 'Exhaust camshaft for left bank',
            targetVertices: 400,
            priority: 6,
            dependencies: ['left_cylinder_head'],
            position: { x: -23, y: 0, z: 180 },
            rotation: { x: 0, y: 90, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `[Same as left intake camshaft]
TARGET: 400 vertices`
        },

        {
            id: 'camshafts_right_intake',
            name: 'Right Bank Intake Camshaft',
            description: 'Intake camshaft for right bank',
            targetVertices: 400,
            priority: 6,
            dependencies: ['right_cylinder_head'],
            position: { x: 52, y: 0, z: 180 },
            rotation: { x: 0, y: 90, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `[Same as left intake camshaft, mirrored]
TARGET: 400 vertices`
        },

        {
            id: 'camshafts_right_exhaust',
            name: 'Right Bank Exhaust Camshaft',
            description: 'Exhaust camshaft for right bank',
            targetVertices: 400,
            priority: 6,
            dependencies: ['right_cylinder_head'],
            position: { x: 23, y: 0, z: 180 },
            rotation: { x: 0, y: 90, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `[Same as left intake camshaft, mirrored]
TARGET: 400 vertices`
        },

        // ==================== WAVE 6: OIL & COOLING SYSTEMS ====================

        {
            id: 'oil_pump',
            name: 'Oil Pump Assembly',
            description: 'Gerotor-style oil pump',
            targetVertices: 400,
            priority: 6,
            dependencies: ['block_base_lower', 'crankshaft_main_journals'],
            position: { x: 0, y: -250, z: -40 },  // Front bottom
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate OIL PUMP ASSEMBLY:
- Pump type: Gerotor (inner/outer rotor)
- Inner rotor: 7 lobes, 40mm diameter
- Outer rotor: 8 lobes, 50mm diameter
- Pump body: 80mm × 60mm × 40mm deep
- Pickup tube: 15mm diameter × 100mm length
- Pressure relief valve: 15mm diameter piston
- Drive gear: 30-tooth, driven by crankshaft

TARGET: 400 vertices
CRITICAL: Gerotor lobe geometry, proper engagement`
        },

        {
            id: 'water_pump',
            name: 'Water Pump Assembly',
            description: 'Centrifugal water pump',
            targetVertices: 400,
            priority: 6,
            dependencies: ['block_base_upper'],
            position: { x: 0, y: 270, z: 80 },  // Front of block
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate WATER PUMP:
- Impeller: 8 vanes, 60mm diameter
- Pump housing: 100mm diameter × 40mm deep
- Inlet port: 50mm diameter
- Outlet port: 40mm diameter
- Bearing boss: 30mm diameter
- Pulley mount: front face, 6-bolt pattern
- Weep hole: 3mm diameter (bottom, for bearing protection)

TARGET: 400 vertices
CRITICAL: Impeller vane geometry for flow`
        },

        {
            id: 'timing_chain_assembly',
            name: 'Timing Chain and Gears',
            description: 'Complete timing system',
            targetVertices: 500,
            priority: 7,
            dependencies: ['crankshaft_main_journals', 'camshafts_left_intake'],
            position: { x: 0, y: 260, z: 80 },  // Front
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            prompt: `Generate TIMING SYSTEM:
- Crankshaft sprocket: 24 teeth, 120mm diameter
- Camshaft sprockets: 4× sprockets, 48 teeth each, 240mm diameter
- Timing chain: double-row roller chain, 100 links
- Chain guides: 2× plastic guides
- Chain tensioner: hydraulic tensioner, spring-loaded
- Timing cover bolt pattern: 12× M8 bolts

TARGET: 500 vertices
CRITICAL: 2:1 ratio (crank:cam), proper tooth engagement`
        }

        // Total: 32 components
        // Estimated total vertices: ~15,200
        // Wave 1 (5 components): 2800 vertices - base structure
        // Wave 2 (8 components): 3600 vertices - cylinder bores
        // Wave 3 (8 components): 4000 vertices - pistons
        // Wave 4 (2 components): 1600 vertices - connecting rods
        // Wave 5 (6 components): 3800 vertices - heads and valvetrain
        // Wave 6 (3 components): 1300 vertices - oil/cooling/timing
    ]
};
