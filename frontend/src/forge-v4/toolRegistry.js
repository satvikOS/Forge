// Forge-233 — Hierarchical tool registry.
//
// The Forge platform has grown to 30+ engineering calculators on top
// of the core modelling workbenches. Per feedback-forge-ui-hierarchy,
// dumping all 30+ entries into a flat workbench rail is wrong — the
// user can't navigate it. This registry groups every tool into a
// proper category → sub-category → tool tree that drives:
//
//   * the slim workbench rail (CORE_WORKBENCH_IDS)
//   * the hierarchical Tools menu (CALCULATOR_TREE)
//
// Every entry maps to a `tools.<id>` event that ForgeShellV4 already
// routes — adding hierarchy here doesn't break any existing workbench
// open API.

// The small set of identity-modal workbenches that earn a rail slot.
// Everything else lives in the Tools menu.
export const CORE_WORKBENCH_IDS = [
  'mech',       // Part / solid modelling
  'draft',      // 2D sketcher
  'drawing',    // Drawings
  'sheet',      // Sheet metal
  'weld',       // Weldments
  'mold',       // Mold tooling
  'sim',        // Simulation (FEA generic)
  'mfg',        // Manufacturing (CAM)
  'arch',       // Arch / BIM
  'mesh',       // Polygon mesh
  'robot',      // 6-axis industrial robot
];

// Hierarchical menu tree. Each leaf has:
//   id    — the kebab-case workbench id (matches the `tools.<id>` event)
//   label — display string
//   slice — which Forge-N slice introduced it (for traceability)
//   testid optional — slug used for the e2e selector
export const CALCULATOR_TREE = [
  {
    label: 'Structural',
    icon: 'wb.sim',
    sections: [
      {
        label: 'Loads & code',
        items: [
          { id: 'windload',  label: 'Wind load (ASCE 7)…',  slice: 'Forge-223' },
          { id: 'snowload',  label: 'Snow load (ASCE 7)…',  slice: 'Forge-225' },
          { id: 'seismic',   label: 'Seismic load (ASCE 7 §12.8 ELF)…', slice: 'Forge-234' },
          { id: 'catenary',  label: 'Catenary cable sag-tension (power/suspension)…', slice: 'Forge-299' },
        ],
      },
      {
        label: 'Steel members',
        items: [
          { id: 'steelcol',  label: 'Steel column (AISC 360 §E3)…', slice: 'Forge-232' },
          { id: 'steelbeam', label: 'Steel beam LTB (AISC 360 §F2)…', slice: 'Forge-270' },
          { id: 'webshear',  label: 'Steel beam web shear (AISC 360 §G2)…', slice: 'Forge-302' },
          { id: 'sectclass', label: 'Section classification (AISC B4.1b)…', slice: 'Forge-311' },
        ],
      },
      {
        label: 'Wood members',
        items: [
          { id: 'woodbeam',     label: 'Wood beam bending (NDS 2018 §3.3)…', slice: 'Forge-272' },
          { id: 'woodcolumn',   label: 'Wood column buckling (NDS 2018 §3.7)…', slice: 'Forge-274' },
          { id: 'woodshear',    label: 'Wood shear wall (NDS + SDPWS-21 §4)…', slice: 'Forge-292' },
        ],
      },
      {
        label: 'Stress & buckling',
        items: [
          { id: 'mohr',      label: "Mohr's circle / principal stress…", slice: 'Forge-220' },
          { id: 'polysec',   label: 'Polygon section properties…', slice: 'Forge-224' },
          { id: 'buckling',  label: 'Column buckling (Euler + Johnson)…', slice: 'Forge-215' },
          { id: 'beam',      label: 'Beam deflection (5 configs)…', slice: 'Forge-216' },
          { id: 'hertzpoint',label: 'Hertz point contact (Shigley §3-19)…', slice: 'Forge-305' },
        ],
      },
      {
        label: 'FEA',
        items: [
          { id: 'frame',     label: 'Truss / frame linear FEA…', slice: 'Forge-205' },
          { id: 'modal',     label: 'Modal / vibration analysis…', slice: 'Forge-210' },
          { id: 'thermal',   label: 'Thermal network FEA…', slice: 'Forge-211' },
          { id: 'fatigue',   label: 'Fatigue life (Basquin + Miner)…', slice: 'Forge-212' },
        ],
      },
      {
        label: 'Connections',
        items: [
          { id: 'boltconn',   label: 'Bolted connection (AISC J3 / EC3 §3.6)…', slice: 'Forge-236' },
          { id: 'filletweld', label: 'Fillet weld (AISC J2 + AWS D1.1)…', slice: 'Forge-237' },
          { id: 'anchorbolt',  label: 'Anchor bolt tension (ACI 318-19 Ch.17)…', slice: 'Forge-268' },
          { id: 'anchorshear', label: 'Anchor bolt shear (ACI 318-19 §17.7)…',  slice: 'Forge-271' },
          { id: 'headedstud',  label: 'Headed shear stud (AISC 360-22 §I8)…',   slice: 'Forge-296' },
          { id: 'blockshear',  label: 'Block-shear rupture (AISC 360-22 §J4.3)…', slice: 'Forge-310' },
        ],
      },
      {
        label: 'Concrete',
        items: [
          { id: 'rcbeam',     label: 'RC beam flexure (ACI 318-19 §22.2)…', slice: 'Forge-238' },
          { id: 'rccolumn',   label: 'RC column (ACI 318-19 §22.4 axial + interaction)…', slice: 'Forge-257' },
          { id: 'rcpunching', label: 'RC slab punching shear (ACI 318-19 §22.6.5)…', slice: 'Forge-267' },
          { id: 'rcshear',    label: 'RC one-way shear (ACI 318-19 §22.5)…', slice: 'Forge-307' },
        ],
      },
    ],
  },
  {
    label: 'Machine design',
    icon: 'wb.part',
    sections: [
      {
        label: 'Fasteners & joints',
        items: [
          { id: 'boltjoint',  label: 'Bolt joint (Shigley + ISO 898)…', slice: 'Forge-214' },
          { id: 'stdparts',   label: 'Standard parts library…', slice: 'Forge-204' },
          { id: 'powerscrew', label: 'Power screw torque & η (Shigley §8-2)…', slice: 'Forge-269' },
        ],
      },
      {
        label: 'Power transmission',
        items: [
          { id: 'gearpair',  label: 'Spur gear pair (Lewis + Hertz)…', slice: 'Forge-221' },
          { id: 'vbelt',     label: 'V-belt drive…', slice: 'Forge-227' },
          { id: 'bearing',   label: 'Bearing L10 / Lna (ISO 281)…', slice: 'Forge-226' },
          { id: 'spring',    label: 'Compression spring (Shigley)…', slice: 'Forge-217' },
          { id: 'discbrake', label: 'Disc clutch / brake (Shigley §16-2)…', slice: 'Forge-281' },
          { id: 'drumbrake', label: 'Drum brake short-shoe (Shigley §16-3)…', slice: 'Forge-300' },
          { id: 'chain',     label: 'Roller chain drive (ANSI B29.1)…', slice: 'Forge-283' },
          { id: 'wormgear',  label: 'Worm gear drive (Shigley §13 / AGMA)…', slice: 'Forge-290' },
        ],
      },
      {
        label: 'Lifting & rigging',
        items: [
          { id: 'sling',     label: 'Wire rope sling (ASME B30.9 / OSHA)…', slice: 'Forge-280' },
          { id: 'capstan',   label: 'Capstan / bollard friction (Eytelwein)…', slice: 'Forge-286' },
          { id: 'hook',      label: 'Crane hook (DIN 15400 / ASME B30.10)…', slice: 'Forge-293' },
          { id: 'wirerope',  label: 'Wire rope FOS + bending fatigue (Shigley §17-7)…', slice: 'Forge-301' },
        ],
      },
      {
        label: 'Shafts & axles',
        items: [
          { id: 'shaft',     label: 'Shaft (bending + torsion, ASME B106 / Shigley)…', slice: 'Forge-235' },
        ],
      },
      {
        label: 'Actuators & vessels',
        items: [
          { id: 'hydcyl',    label: 'Hydraulic cylinder…', slice: 'Forge-222' },
          { id: 'pvessel',   label: 'Pressure vessel (ASME VIII Div 1)…', slice: 'Forge-228' },
        ],
      },
      {
        label: 'Dynamics',
        items: [
          { id: 'vibiso',    label: 'Vibration isolation (TR + isolator k)…', slice: 'Forge-260' },
          { id: 'tmd',       label: 'Tuned mass damper (Den Hartog)…', slice: 'Forge-265' },
        ],
      },
    ],
  },
  {
    label: 'Fluids & HVAC',
    icon: 'wb.sim',
    sections: [
      {
        label: 'Pipe & duct flow',
        items: [
          { id: 'pumphead',  label: 'Pump head / pipe flow…', slice: 'Forge-229' },
          { id: 'pumpnpsh',  label: 'Pump NPSH available (HI 9.6)…', slice: 'Forge-273' },
          { id: 'duct',      label: 'HVAC ductwork sizing…', slice: 'Forge-186' },
          { id: 'piperoute', label: 'Pipe routing (A* axis-aligned)…', slice: 'Forge-206' },
          { id: 'orifice',   label: 'Orifice plate (ISO 5167-2 flow meter)…', slice: 'Forge-266' },
          { id: 'pitot',     label: 'Pitot tube velocity (incompressible)…', slice: 'Forge-288' },
          { id: 'hazenwilliams', label: 'Hazen-Williams friction (NFPA 13 / AWWA)…', slice: 'Forge-303' },
        ],
      },
      {
        label: 'Air & climate',
        items: [
          { id: 'fan',         label: 'Fan / blower + affinity laws…', slice: 'Forge-231' },
          { id: 'refrig',      label: 'Refrigeration / heat-pump COP…', slice: 'Forge-230' },
          { id: 'psychro',     label: 'Psychrometric chart…', slice: 'Forge-192' },
          { id: 'hxc',         label: 'Heat exchanger LMTD…', slice: 'Forge-218' },
          { id: 'compressor',  label: 'Reciprocating compressor (polytropic + η_v)…', slice: 'Forge-282' },
          { id: 'airfilter',   label: 'Air filter Δp + fan energy (ASHRAE 52.2)…', slice: 'Forge-294' },
          { id: 'coolingload', label: 'HVAC coil load (sensible + latent + SHR)…', slice: 'Forge-306' },
          { id: 'coolingtower',label: 'Cooling tower (range/approach/makeup)…', slice: 'Forge-308' },
        ],
      },
      {
        label: 'Open channel',
        items: [
          { id: 'openchan',  label: 'Open channel (Manning + critical depth)…', slice: 'Forge-242' },
          { id: 'weir',      label: 'Weir / V-notch / orifice…', slice: 'Forge-243' },
        ],
      },
      {
        label: 'Combustion',
        items: [
          { id: 'combustion', label: 'Combustion (stoichiometric AFR + flue gas)…', slice: 'Forge-259' },
          { id: 'boilereff',  label: 'Boiler efficiency (direct + indirect)…', slice: 'Forge-262' },
          { id: 'otto',       label: 'Otto cycle (air-standard SI engine)…', slice: 'Forge-276' },
          { id: 'diesel',     label: 'Diesel cycle (air-standard CI engine)…', slice: 'Forge-277' },
          { id: 'brayton',    label: 'Brayton cycle (gas turbine with η_c/η_t)…', slice: 'Forge-278' },
        ],
      },
      {
        label: 'Heat transfer',
        items: [
          { id: 'fin',        label: 'Fin efficiency (rectangular + pin)…', slice: 'Forge-261' },
          { id: 'finarray',   label: 'Heat sink fin array (Incropera Ch.3)…', slice: 'Forge-295' },
        ],
      },
      {
        label: 'Acoustics',
        items: [
          { id: 'soundtl',    label: 'Sound transmission loss (mass law + composite)…', slice: 'Forge-263' },
        ],
      },
    ],
  },
  {
    label: 'CAD utilities',
    icon: 'wb.sketch',
    sections: [
      {
        label: 'Mesh & scan',
        items: [
          { id: 'meshrepair',          label: 'Mesh repair toolkit…', slice: 'Forge-200' },
          { id: 'pointcloud',          label: 'Point cloud utilities…', slice: 'Forge-202' },
          { id: 'sheetmetal-unfold',   label: 'Sheet-metal flat pattern…', slice: 'Forge-201' },
          { id: 'nurbsfit',            label: 'NURBS surface fit…', slice: 'Forge-194' },
        ],
      },
      {
        label: 'Sketch & section',
        items: [
          { id: 'sketchdof', label: 'Sketch DOF audit…', slice: 'Forge-208' },
        ],
      },
      {
        label: 'Materials & data',
        items: [
          { id: 'materialdb', label: 'Material properties database…', slice: 'Forge-219' },
          { id: 'dxf',        label: 'DXF round-trip…', slice: 'Forge-207' },
          { id: 'tolerance',  label: 'Tolerance stack-up…', slice: 'Forge-185' },
        ],
      },
    ],
  },
  {
    label: 'Publish & document',
    icon: 'wb.drawing',
    sections: [
      {
        label: 'Rendering & export',
        items: [
          { id: 'pathtrace',    label: 'Photorealistic render…', slice: 'Forge-203' },
          { id: 'gltf-publish', label: 'Streaming glTF publish…', slice: 'Forge-198' },
          { id: 'animation',    label: 'Animation timeline…', slice: 'Forge-209' },
        ],
      },
      {
        label: 'Cost & lifecycle',
        items: [
          { id: 'cost',    label: 'Cost estimation…', slice: 'Forge-179' },
          { id: 'carbon',  label: 'Carbon footprint (LCA)…', slice: 'Forge-180' },
        ],
      },
    ],
  },
  {
    label: 'Site & civil',
    icon: 'wb.arch',
    sections: [
      {
        label: 'Site analysis',
        items: [
          { id: 'sunpath',  label: 'Sun-path / daylight…', slice: 'Forge-181' },
          { id: 'terrain',  label: 'Civil terrain (Delaunay)…', slice: 'Forge-191' },
          { id: 'geotech',  label: 'Slope stability (Bishop)…', slice: 'Forge-176' },
        ],
      },
      {
        label: 'Foundations',
        items: [
          { id: 'bearingcap',  label: 'Bearing capacity (Terzaghi + Meyerhof)…', slice: 'Forge-239' },
          { id: 'retwall',     label: 'Retaining wall (Rankine + stability)…', slice: 'Forge-240' },
          { id: 'pilecap',     label: 'Pile capacity (α-method + Meyerhof tip)…', slice: 'Forge-241' },
          { id: 'silopressure', label: 'Silo wall pressure (Janssen 1895)…', slice: 'Forge-275' },
          { id: 'consol',       label: '1D consolidation settlement (Terzaghi)…', slice: 'Forge-297' },
          { id: 'mokabe',       label: 'Mononobe-Okabe seismic earth pressure…', slice: 'Forge-309' },
        ],
      },
      {
        label: 'Transportation',
        items: [
          { id: 'ssd',    label: 'Stopping sight distance (AASHTO Green Book)…', slice: 'Forge-284' },
          { id: 'aashto',   label: 'Pavement design SN (AASHTO 93)…', slice: 'Forge-285' },
          { id: 'vehbrake', label: 'Vehicle braking energy (KE → heat)…', slice: 'Forge-298' },
        ],
      },
      {
        label: 'Earthworks',
        items: [
          { id: 'prismoidal', label: 'Prismoidal earthwork volume (Simpson 1/3)…', slice: 'Forge-287' },
        ],
      },
      {
        label: 'Hydrology',
        items: [
          { id: 'hydro',     label: 'Hydrology (rational + Kirpich + IDF)…', slice: 'Forge-256' },
          { id: 'circpipe',  label: 'Storm sewer / circular pipe Manning…', slice: 'Forge-289' },
        ],
      },
    ],
  },
  {
    label: 'Electrical',
    icon: 'wb.sim',
    sections: [
      {
        label: 'Circuit',
        items: [
          { id: 'circuit',  label: 'Schematic + MNA DC/AC…', slice: 'Forge-190' },
        ],
      },
      {
        label: 'Cable',
        items: [
          { id: 'cable',       label: 'Cable sizing (NEC 310 + IEC 60364)…', slice: 'Forge-252' },
          { id: 'voltagedrop', label: 'Voltage drop (NEC 215.2)…', slice: 'Forge-304' },
        ],
      },
      {
        label: 'Lighting',
        items: [
          { id: 'lighting', label: 'Lighting design (IES lumen method)…', slice: 'Forge-253' },
        ],
      },
      {
        label: 'Battery',
        items: [
          { id: 'battery',  label: 'Battery sizing (Peukert + CC-CV + SoC)…', slice: 'Forge-254' },
        ],
      },
      {
        label: 'Solar PV',
        items: [
          { id: 'solar',    label: 'Solar PV sizing (array + bank + inverter)…', slice: 'Forge-255' },
        ],
      },
      {
        label: 'Three-phase',
        items: [
          { id: 'threephase', label: 'Three-phase power + PF correction + p.u.…', slice: 'Forge-244' },
          { id: 'xformer',    label: 'Transformer (OC + SC + regulation + η)…', slice: 'Forge-245' },
          { id: 'imotor',     label: 'Induction motor (Thevenin + T-s curve)…', slice: 'Forge-246' },
          { id: 'symcomp',    label: 'Symmetrical components + fault analysis…', slice: 'Forge-247' },
          { id: 'tline',      label: 'Transmission line (ABCD short / π / long)…', slice: 'Forge-248' },
          { id: 'syncm',      label: 'Synchronous machine (E_f, δ, P_max)…', slice: 'Forge-249' },
          { id: 'pflow',      label: 'Power flow (Newton-Raphson N-bus)…', slice: 'Forge-250' },
          { id: 'scstudy',    label: 'Short-circuit study (Z_bus fault MVA)…', slice: 'Forge-251' },
        ],
      },
      {
        label: 'DC machines',
        items: [
          { id: 'dcmotor',    label: 'DC shunt motor (T-n + η + speed reg)…', slice: 'Forge-279' },
        ],
      },
    ],
  },
  {
    label: 'Manufacturing',
    icon: 'wb.mfg',
    sections: [
      {
        label: 'Machining',
        items: [
          { id: 'machining', label: 'Machining feeds + speeds + power…', slice: 'Forge-258' },
        ],
      },
    ],
  },
  {
    label: 'Operations',
    icon: 'misc.settings',
    sections: [
      {
        label: 'Connectivity',
        items: [
          { id: 'webhook',   label: 'Webhook receiver…',     slice: 'Forge-197' },
          { id: 'tsviewer',  label: 'Time-series log viewer…', slice: 'Forge-193' },
        ],
      },
      {
        label: 'Control',
        items: [
          { id: 'pidtune',   label: 'PID tuning (Ziegler-Nichols + Cohen-Coon)…', slice: 'Forge-264' },
        ],
      },
      {
        label: 'Accessibility & QA',
        items: [
          { id: 'a11y',      label: 'A11y audit…', slice: 'Forge-196' },
          { id: 'variants',  label: 'Generative variant explorer…', slice: 'Forge-187' },
        ],
      },
    ],
  },
];

// Flatten the tree to (id → {label, slice, breadcrumb}) for the
// command palette + search.
export function flattenTree() {
  const flat = [];
  for (const cat of CALCULATOR_TREE) {
    for (const sec of cat.sections) {
      for (const item of sec.items) {
        flat.push({
          ...item,
          category: cat.label,
          section: sec.label,
          breadcrumb: `${cat.label} → ${sec.label} → ${item.label}`,
        });
      }
    }
  }
  return flat;
}

// Total count for the e2e sanity check.
export const TOTAL_CALCULATOR_COUNT = flattenTree().length;
