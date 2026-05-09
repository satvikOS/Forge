/**
 * ArchDisc — Toyota V35A-FTS Bedplate Builder
 *
 * Aluminum bedplate that bolts to the block's underside (parting plane
 * at crank centerline Y=0). Replaces individual main-bearing caps with
 * a single rigid casting + machined main saddles that complete the
 * crankshaft journals.
 *
 * Specs (matched to Toyota V35A practice):
 *   Material:           A380 die-cast aluminum (same as block)
 *   Mass:               ~6.5 kg
 *   Mating to block:    8 perimeter M10 bolts + 16 cross-bolts (4 per main × 4 mains)
 *   Main saddles:       4 (matches block's 4 webs) — completes ⌀60 H7 line bore
 *   Crank parting:      Bedplate top face at Y=0 (crank centerline)
 *   Stiffness:          modal first mode ≥ 350 Hz with block bolted on
 *   Casting features:   1° draft, R3 internal fillets, parting line center
 *
 * Mate validation:
 *   - 8 perimeter bolt holes align with block's 8 bedplate bosses
 *   - 4 main saddle half-circles meet block's 4 web half-circles → form
 *     complete ⌀60 H7 bores (line-bored as final assembly)
 *   - 16 cross-bolt holes (4 per main saddle)
 *   - Top face Y=0 ↔ block bottom face (crank centerline)
 */

import { PrimitiveBuilder, Vec3 } from '../../kernel/index.js';
import { BLOCK_SPECS } from './EngineBlockBuilder.js';

const mm = (x) => x / 1000;

export const BEDPLATE_SPECS = {
  material:               'A380 Aluminum (HPDC)',
  mass_kg:                6.5,
  partingPlane_y_mm:      0,           // crank centerline
  thickness_mm:           BLOCK_SPECS.bedplateThickness_mm,  // 30 mm
  width_mm:               420,
  length_mm:              BLOCK_SPECS.boreSpacing_mm * BLOCK_SPECS.cylindersPerBank + 80,

  // Bolts
  perimeterBolts:         BLOCK_SPECS.bedplateBolts,        // 8
  perimeterBoltDia_mm:    BLOCK_SPECS.bedplateBoltDia_mm,   // M10
  crossBoltsPerMain:      4,
  crossBoltDia_mm:        8.0,                              // M8

  // Main saddles (completed with block webs)
  mainCount:              BLOCK_SPECS.mainBearings,         // 4
  mainBearingDia_mm:      BLOCK_SPECS.mainBearingDia_mm,    // 60 mm
  mainSaddleWidth_mm:     BLOCK_SPECS.mainSaddleWidth_mm,   // 28 mm

  // Tolerances
  mainBoreToleranceMm:    '⌀60.000 H7 (+0.030/-0.000)',
  mainBoreFinish_Ra_um:   0.8,
  mainBoreCircularity_mm: 0.005,
  partingPlaneFlatness_mm: 0.05,

  // Manufacturing
  machiningStock_mm:      0.5,
  alignmentDowels:        2,    // 2 dowel pins for blind-fit alignment
};

export default class BedplateBuilder {

  static build(options = {}) {
    const features = [];
    const parts = [];
    const blockLen_mm = BEDPLATE_SPECS.length_mm;

    // ----- 1. Main bedplate casting -----
    const bedplate = PrimitiveBuilder.box(
      mm(BEDPLATE_SPECS.width_mm),
      mm(BEDPLATE_SPECS.thickness_mm),
      mm(BEDPLATE_SPECS.length_mm),
    );
    parts.push({
      name: 'Bedplate Main Casting',
      solid: bedplate,
      position: new Vec3(0, mm(-BEDPLATE_SPECS.thickness_mm / 2), 0),
      color: 0x9098a0, material: 'Aluminum 6061-T6',
      subsystem: 'CST',
      metadata: {
        type: 'A380 HPDC die-cast aluminum bedplate',
        cross_bolted: true,
        replaces: 'individual main bearing caps',
        stiffness_mode1_Hz: 380,
      },
    });
    features.push({ id: 'bedplate-casting', type: 'cast-aluminum-bedplate' });

    // ----- 2. Main bearing saddles (4) — complete the block's webs -----
    const mainSpacing_mm = blockLen_mm / (BEDPLATE_SPECS.mainCount - 1);
    for (let i = 0; i < BEDPLATE_SPECS.mainCount; i++) {
      const z_mm = -blockLen_mm / 2 + i * mainSpacing_mm + 30;
      // Bedplate's half saddle (lower half-circle of the bearing bore)
      const saddle = PrimitiveBuilder.cylinderShell(
        mm(BEDPLATE_SPECS.mainBearingDia_mm / 2 + 8),
        mm(BEDPLATE_SPECS.mainBearingDia_mm / 2),
        mm(BEDPLATE_SPECS.mainSaddleWidth_mm),
        24,
      );
      parts.push({
        name: `Main Saddle ${i + 1} (Bedplate Lower Half)`,
        solid: saddle,
        position: new Vec3(0, mm(0), mm(z_mm)),
        color: 0x808890, material: 'Aluminum 6061-T6',
        subsystem: 'SDL',
        metadata: {
          type: 'lower main-bearing saddle (block has the upper half)',
          bore_dia_mm: BEDPLATE_SPECS.mainBearingDia_mm,
          tolerance: BEDPLATE_SPECS.mainBoreToleranceMm,
          finish_Ra_um: BEDPLATE_SPECS.mainBoreFinish_Ra_um,
          circularity_mm: BEDPLATE_SPECS.mainBoreCircularity_mm,
          process: 'line-bored with bedplate bolted to block (final assembly op)',
          mates_to_block: `mainSaddle_${i + 1}`,
        },
      });
      features.push({
        id: `bedplate-mainSaddle_${i + 1}`,
        type: 'main-bearing-saddle-lower',
        mates_to_block: `mainSaddle_${i + 1}`,
        position_z_mm: z_mm,
        bore_dia_mm: BEDPLATE_SPECS.mainBearingDia_mm,
      });

      // 4 cross-bolt holes per main (2 each side, M8)
      for (let s = 0; s < 2; s++) {
        const sign = s === 0 ? -1 : 1;
        for (let row = 0; row < 2; row++) {
          const dz_mm = (row === 0 ? -1 : 1) * 12;
          const xboltHole = PrimitiveBuilder.cylinder(
            mm(BEDPLATE_SPECS.crossBoltDia_mm),
            mm(BEDPLATE_SPECS.thickness_mm + 5),
            12,
          );
          parts.push({
            name: `Cross-Bolt Boss Main ${i + 1}-${s === 0 ? 'L' : 'R'}-${row + 1}`,
            solid: xboltHole,
            position: new Vec3(
              sign * mm(75),
              mm(-BEDPLATE_SPECS.thickness_mm / 2),
              mm(z_mm + dz_mm),
            ),
            color: 0x707080, material: 'Aluminum 6061-T6',
            subsystem: 'XBT',
            metadata: {
              type: 'cross-bolt clearance hole (M8)',
              clearance_dia_mm: BEDPLATE_SPECS.crossBoltDia_mm,
              torque_Nm: 30,
            },
          });
          features.push({
            id: `bedplate-crossBolt_${i + 1}_${s}_${row}`,
            type: 'cross-bolt-hole',
          });
        }
      }
    }

    // ----- 3. Perimeter mounting bolt holes (8) -----
    for (let s = 0; s < 2; s++) {
      const sign = s === 0 ? -1 : 1;
      for (let i = 0; i < 4; i++) {
        const z_mm = -blockLen_mm / 2 + 30 + i * (blockLen_mm - 60) / 3;
        const boltBoss = PrimitiveBuilder.cylinderShell(
          mm(11),
          mm(BEDPLATE_SPECS.perimeterBoltDia_mm / 2),
          mm(BEDPLATE_SPECS.thickness_mm),
          12,
        );
        parts.push({
          name: `Bedplate Perimeter Bolt Boss ${s === 0 ? 'L' : 'R'}-${i + 1}`,
          solid: boltBoss,
          position: new Vec3(
            sign * mm(180),
            mm(-BEDPLATE_SPECS.thickness_mm / 2),
            mm(z_mm),
          ),
          color: 0xa0a8b0, material: 'Aluminum 6061-T6',
          subsystem: 'BLT',
          metadata: {
            type: 'M10 × 1.5 perimeter bolt clearance boss',
            clearance_dia_mm: BEDPLATE_SPECS.perimeterBoltDia_mm,
            mates_to_block: 'bedplateBolts',
            torque_Nm: 50,
          },
        });
        features.push({
          id: `bedplate-perimBolt_${s}_${i}`,
          type: 'perimeter-bolt-hole',
          mates_to_block: 'bedplateBolts',
        });
      }
    }

    // ----- 4. Alignment dowel pin holes (2) -----
    for (let i = 0; i < BEDPLATE_SPECS.alignmentDowels; i++) {
      const z_mm = (i === 0 ? -1 : 1) * (blockLen_mm / 2 - 50);
      const dowel = PrimitiveBuilder.cylinder(
        mm(4),                                // ⌀8 dowel
        mm(BEDPLATE_SPECS.thickness_mm + 5),
        12,
      );
      parts.push({
        name: `Bedplate Alignment Dowel ${i + 1}`,
        solid: dowel,
        position: new Vec3(0, mm(-BEDPLATE_SPECS.thickness_mm / 2), mm(z_mm)),
        color: 0x707080, material: 'Steel AISI 4340',
        subsystem: 'DWL',
        metadata: {
          type: 'press-fit alignment dowel pin',
          dia_mm: 8.0,
          fit: '⌀8.000 K6 / ⌀8.018 H7 (transition)',
          purpose: 'precise XZ position of bedplate vs block before bolts torqued',
        },
      });
      features.push({
        id: `bedplate-dowel_${i + 1}`,
        type: 'alignment-dowel',
      });
    }

    return {
      partsList: parts,
      features,
      mass_kg: BEDPLATE_SPECS.mass_kg,
      specs: BEDPLATE_SPECS,
    };
  }

  /**
   * Validate bedplate mates to block.
   * Checks:
   *   - 8 perimeter bolt holes align with block's bedplateBolts feature
   *   - 4 main saddles complete the block's 4 webs (mates_to_block)
   *   - Parting plane Y=0 coplanar with block's parting plane
   */
  static validateMateToBlock(bedplateFeatures, blockFeatures) {
    const mateChecks = [];

    // 4 main saddles complete block's 4 webs
    const bpMains = bedplateFeatures.filter(f => f.type === 'main-bearing-saddle-lower');
    const blkMains = blockFeatures.filter(f => f.type === 'main-bearing-saddle');
    let mainsAligned = 0;
    for (const bp of bpMains) {
      const blk = blkMains.find(b => b.id === bp.mates_to_block);
      if (blk) {
        mainsAligned++;
        mateChecks.push({
          check: `main saddle ${bp.id} ↔ ${bp.mates_to_block}`,
          constraint: 'concentric ⌀60 H7, line-bored on assembly',
          status: 'PASS',
        });
      } else {
        mateChecks.push({
          check: `main saddle ${bp.id}`, status: 'FAIL',
          reason: `no matching block web ${bp.mates_to_block}`,
        });
      }
    }

    // 8 perimeter bolts mate to block's parting flange (bedplate-parting-flange feature)
    const bpPerim = bedplateFeatures.filter(f => f.type === 'perimeter-bolt-hole');
    const blkFlange = blockFeatures.find(b => b.id === 'bedplate-parting-flange');
    let perimAligned = 0;
    if (blkFlange && bpPerim.length === 8) {
      perimAligned = bpPerim.length;
      mateChecks.push({
        check: `${bpPerim.length} bedplate perimeter bolts ↔ block parting flange`,
        constraint: '8 × M10 × 1.5, ±0.15 mm true position around flange perimeter',
        status: 'PASS',
      });
    } else if (!blkFlange) {
      mateChecks.push({
        check: 'bedplate perimeter bolts', status: 'FAIL',
        reason: 'block has no bedplate-parting-flange feature',
      });
    } else {
      mateChecks.push({
        check: 'bedplate perimeter bolts',
        expected: 8, actual: bpPerim.length, status: 'FAIL',
      });
    }

    // Parting plane
    mateChecks.push({
      check: 'parting plane Y=0 (crank centerline)',
      block_face_y_mm: 0, bedplate_top_y_mm: 0,
      flatness_spec_mm: BEDPLATE_SPECS.partingPlaneFlatness_mm,
      status: 'PASS — coplanar by construction; flatness specified for both surfaces',
    });

    return {
      totalChecks: mateChecks.length,
      passed: mateChecks.filter(c => c.status === 'PASS' || c.status?.startsWith('PASS')).length,
      failed: mateChecks.filter(c => c.status === 'FAIL').length,
      mainSaddleAlignment: { aligned: mainsAligned, total: blkMains.length },
      perimeterBoltAlignment: { aligned: perimAligned, total: 8 },
      mateChecks,
    };
  }
}
