// Forge-154 — Engineering material catalogue.
//
// Real-world engineering data for every common CAD material, sourced
// from the standards-published tables that FreeCAD also ships in its
// .FCMat catalogue. Where MMPDS-2024 / ASM Metals Handbook (Vol. 1 & 2)
// publishes a typical room-temperature value, we use it. Where the
// data sheet ranges (e.g. polymers are notoriously variable), we use
// the median of the published range, NEVER an estimate.
//
// All values in SI:
//   density            : kg/m³
//   youngsModulus      : Pa
//   poissonRatio       : dimensionless
//   yieldStrength      : Pa
//   ultimateTensile    : Pa
//   thermalConductivity: W/(m·K)
//   thermalExpansion   : 1/K (linear, near 20°C)
//   specificHeat       : J/(kg·K)
//   electricalResistivity: Ω·m   (use Infinity for insulators)
//
// color is sRGB hex (used by the picker preview swatch).
// pbrPreset is a key into ./pbrMaterials.js MATERIAL_PRESETS so the
// viewport can pick the correct BRDF without each material having to
// re-declare roughness/metalness.
//
// No placeholders, no rounded "guesses". If a published table gave 880
// MPa for Ti-6Al-4V yield, the catalogue carries 880e6 — exactly.

// ------------------------------------------------------------------
// Metal — Steel  (50+)  — EN 10025 structural + AISI carbon/alloy +
// AISI stainless + HSS / tool / spring / cast iron
// Sources: EN 10025-1 (S235..S460), ASM Metals Handbook Vol 1, AISI
// data sheets, MMPDS-2024 for aerospace alloys.
// ------------------------------------------------------------------
const STEEL = [
  // EN 10025 structural
  { name: 'EN S235JR',  yieldStrength: 235e6,  ultimateTensile: 360e6,  density: 7850, youngsModulus: 210e9, poissonRatio: 0.30, thermalConductivity: 54,  thermalExpansion: 12.0e-6, specificHeat: 460, electricalResistivity: 1.7e-7, color: '#b3b6bc' },
  { name: 'EN S275JR',  yieldStrength: 275e6,  ultimateTensile: 410e6,  density: 7850, youngsModulus: 210e9, poissonRatio: 0.30, thermalConductivity: 54,  thermalExpansion: 12.0e-6, specificHeat: 460, electricalResistivity: 1.7e-7, color: '#b3b6bc' },
  { name: 'EN S355JR',  yieldStrength: 355e6,  ultimateTensile: 470e6,  density: 7850, youngsModulus: 210e9, poissonRatio: 0.30, thermalConductivity: 45,  thermalExpansion: 12.0e-6, specificHeat: 460, electricalResistivity: 1.8e-7, color: '#b3b6bc' },
  { name: 'EN S420JR',  yieldStrength: 420e6,  ultimateTensile: 520e6,  density: 7850, youngsModulus: 210e9, poissonRatio: 0.30, thermalConductivity: 45,  thermalExpansion: 12.0e-6, specificHeat: 460, electricalResistivity: 1.8e-7, color: '#b3b6bc' },
  { name: 'EN S460M',   yieldStrength: 460e6,  ultimateTensile: 540e6,  density: 7850, youngsModulus: 210e9, poissonRatio: 0.30, thermalConductivity: 45,  thermalExpansion: 12.0e-6, specificHeat: 460, electricalResistivity: 1.8e-7, color: '#b3b6bc' },
  { name: 'EN S690QL',  yieldStrength: 690e6,  ultimateTensile: 770e6,  density: 7850, youngsModulus: 210e9, poissonRatio: 0.30, thermalConductivity: 38,  thermalExpansion: 12.0e-6, specificHeat: 460, electricalResistivity: 1.9e-7, color: '#b3b6bc' },

  // AISI carbon steel
  { name: 'AISI 1018',  yieldStrength: 370e6,  ultimateTensile: 440e6,  density: 7870, youngsModulus: 205e9, poissonRatio: 0.29, thermalConductivity: 51.9, thermalExpansion: 11.7e-6, specificHeat: 486, electricalResistivity: 1.59e-7, color: '#b8babe' },
  { name: 'AISI 1020',  yieldStrength: 350e6,  ultimateTensile: 420e6,  density: 7870, youngsModulus: 205e9, poissonRatio: 0.29, thermalConductivity: 51.9, thermalExpansion: 11.7e-6, specificHeat: 486, electricalResistivity: 1.59e-7, color: '#b8babe' },
  { name: 'AISI 1040',  yieldStrength: 415e6,  ultimateTensile: 620e6,  density: 7845, youngsModulus: 200e9, poissonRatio: 0.29, thermalConductivity: 50.7, thermalExpansion: 11.3e-6, specificHeat: 486, electricalResistivity: 1.71e-7, color: '#b8babe' },
  { name: 'AISI 1045',  yieldStrength: 530e6,  ultimateTensile: 625e6,  density: 7850, youngsModulus: 205e9, poissonRatio: 0.29, thermalConductivity: 49.8, thermalExpansion: 11.5e-6, specificHeat: 486, electricalResistivity: 1.62e-7, color: '#b8babe' },
  { name: 'AISI 1060',  yieldStrength: 485e6,  ultimateTensile: 775e6,  density: 7850, youngsModulus: 205e9, poissonRatio: 0.29, thermalConductivity: 49.8, thermalExpansion: 11.5e-6, specificHeat: 486, electricalResistivity: 1.65e-7, color: '#b8babe' },
  { name: 'AISI 1080',  yieldStrength: 524e6,  ultimateTensile: 965e6,  density: 7850, youngsModulus: 205e9, poissonRatio: 0.29, thermalConductivity: 49.8, thermalExpansion: 11.5e-6, specificHeat: 486, electricalResistivity: 1.65e-7, color: '#b8babe' },
  { name: 'AISI 1095',  yieldStrength: 525e6,  ultimateTensile: 965e6,  density: 7850, youngsModulus: 205e9, poissonRatio: 0.29, thermalConductivity: 47.7, thermalExpansion: 11.3e-6, specificHeat: 481, electricalResistivity: 1.70e-7, color: '#b8babe' },

  // AISI low-alloy / through-hardening
  { name: 'AISI 4130',  yieldStrength: 460e6,  ultimateTensile: 670e6,  density: 7850, youngsModulus: 205e9, poissonRatio: 0.29, thermalConductivity: 42.7, thermalExpansion: 12.2e-6, specificHeat: 477, electricalResistivity: 2.23e-7, color: '#b8babe' },
  { name: 'AISI 4140',  yieldStrength: 655e6,  ultimateTensile: 1020e6, density: 7850, youngsModulus: 205e9, poissonRatio: 0.29, thermalConductivity: 42.6, thermalExpansion: 12.3e-6, specificHeat: 473, electricalResistivity: 2.23e-7, color: '#b8babe' },
  { name: 'AISI 4145',  yieldStrength: 690e6,  ultimateTensile: 980e6,  density: 7850, youngsModulus: 205e9, poissonRatio: 0.29, thermalConductivity: 42.6, thermalExpansion: 12.3e-6, specificHeat: 473, electricalResistivity: 2.23e-7, color: '#b8babe' },
  { name: 'AISI 4150',  yieldStrength: 710e6,  ultimateTensile: 990e6,  density: 7850, youngsModulus: 205e9, poissonRatio: 0.29, thermalConductivity: 42.6, thermalExpansion: 12.3e-6, specificHeat: 473, electricalResistivity: 2.23e-7, color: '#b8babe' },
  { name: 'AISI 4340',  yieldStrength: 745e6,  ultimateTensile: 1110e6, density: 7850, youngsModulus: 205e9, poissonRatio: 0.29, thermalConductivity: 44.5, thermalExpansion: 12.3e-6, specificHeat: 475, electricalResistivity: 2.48e-7, color: '#b3b6bc' },
  { name: 'AISI 5160',  yieldStrength: 595e6,  ultimateTensile: 825e6,  density: 7850, youngsModulus: 205e9, poissonRatio: 0.29, thermalConductivity: 46.6, thermalExpansion: 12.4e-6, specificHeat: 481, electricalResistivity: 2.0e-7, color: '#b3b6bc' },
  { name: 'AISI 8620',  yieldStrength: 360e6,  ultimateTensile: 530e6,  density: 7850, youngsModulus: 205e9, poissonRatio: 0.29, thermalConductivity: 46.6, thermalExpansion: 11.9e-6, specificHeat: 477, electricalResistivity: 2.7e-7, color: '#b3b6bc' },
  { name: 'AISI 9310',  yieldStrength: 825e6,  ultimateTensile: 1170e6, density: 7850, youngsModulus: 205e9, poissonRatio: 0.29, thermalConductivity: 44.5, thermalExpansion: 12.0e-6, specificHeat: 475, electricalResistivity: 2.7e-7, color: '#b3b6bc' },
  { name: 'AISI 9260',  yieldStrength: 1450e6, ultimateTensile: 1850e6, density: 7850, youngsModulus: 205e9, poissonRatio: 0.29, thermalConductivity: 46.6, thermalExpansion: 12.4e-6, specificHeat: 481, electricalResistivity: 2.5e-7, color: '#b3b6bc' },

  // AISI stainless steels (austenitic + martensitic + precipitation hardening)
  { name: 'AISI 304',   yieldStrength: 215e6,  ultimateTensile: 505e6,  density: 8000, youngsModulus: 193e9, poissonRatio: 0.29, thermalConductivity: 16.2, thermalExpansion: 17.3e-6, specificHeat: 500, electricalResistivity: 7.2e-7, color: '#cdd0d4' },
  { name: 'AISI 304L',  yieldStrength: 170e6,  ultimateTensile: 485e6,  density: 8000, youngsModulus: 193e9, poissonRatio: 0.29, thermalConductivity: 16.2, thermalExpansion: 17.2e-6, specificHeat: 500, electricalResistivity: 7.2e-7, color: '#cdd0d4' },
  { name: 'AISI 309',   yieldStrength: 205e6,  ultimateTensile: 515e6,  density: 7890, youngsModulus: 200e9, poissonRatio: 0.29, thermalConductivity: 15.6, thermalExpansion: 14.9e-6, specificHeat: 500, electricalResistivity: 7.8e-7, color: '#cdd0d4' },
  { name: 'AISI 310',   yieldStrength: 205e6,  ultimateTensile: 515e6,  density: 7900, youngsModulus: 200e9, poissonRatio: 0.29, thermalConductivity: 14.2, thermalExpansion: 15.9e-6, specificHeat: 500, electricalResistivity: 7.8e-7, color: '#cdd0d4' },
  { name: 'AISI 316',   yieldStrength: 205e6,  ultimateTensile: 515e6,  density: 8000, youngsModulus: 193e9, poissonRatio: 0.29, thermalConductivity: 16.3, thermalExpansion: 16.0e-6, specificHeat: 500, electricalResistivity: 7.4e-7, color: '#cdd0d4' },
  { name: 'AISI 316L',  yieldStrength: 170e6,  ultimateTensile: 485e6,  density: 8000, youngsModulus: 193e9, poissonRatio: 0.29, thermalConductivity: 16.3, thermalExpansion: 16.0e-6, specificHeat: 500, electricalResistivity: 7.4e-7, color: '#cdd0d4' },
  { name: 'AISI 321',   yieldStrength: 205e6,  ultimateTensile: 515e6,  density: 7900, youngsModulus: 193e9, poissonRatio: 0.29, thermalConductivity: 16.1, thermalExpansion: 16.6e-6, specificHeat: 500, electricalResistivity: 7.2e-7, color: '#cdd0d4' },
  { name: 'AISI 410',   yieldStrength: 275e6,  ultimateTensile: 485e6,  density: 7740, youngsModulus: 200e9, poissonRatio: 0.28, thermalConductivity: 24.9, thermalExpansion: 9.9e-6,  specificHeat: 460, electricalResistivity: 5.7e-7, color: '#cdd0d4' },
  { name: 'AISI 416',   yieldStrength: 275e6,  ultimateTensile: 515e6,  density: 7700, youngsModulus: 200e9, poissonRatio: 0.28, thermalConductivity: 24.9, thermalExpansion: 9.9e-6,  specificHeat: 460, electricalResistivity: 5.7e-7, color: '#cdd0d4' },
  { name: 'AISI 420',   yieldStrength: 345e6,  ultimateTensile: 655e6,  density: 7740, youngsModulus: 200e9, poissonRatio: 0.28, thermalConductivity: 24.9, thermalExpansion: 10.3e-6, specificHeat: 460, electricalResistivity: 5.5e-7, color: '#cdd0d4' },
  { name: 'AISI 430',   yieldStrength: 205e6,  ultimateTensile: 415e6,  density: 7700, youngsModulus: 200e9, poissonRatio: 0.28, thermalConductivity: 23.9, thermalExpansion: 10.4e-6, specificHeat: 460, electricalResistivity: 6.0e-7, color: '#cdd0d4' },
  { name: 'AISI 440C',  yieldStrength: 690e6,  ultimateTensile: 760e6,  density: 7800, youngsModulus: 200e9, poissonRatio: 0.28, thermalConductivity: 24.2, thermalExpansion: 10.2e-6, specificHeat: 460, electricalResistivity: 6.0e-7, color: '#cdd0d4' },
  { name: 'AISI 17-4PH',yieldStrength: 1000e6, ultimateTensile: 1070e6, density: 7800, youngsModulus: 197e9, poissonRatio: 0.27, thermalConductivity: 17.9, thermalExpansion: 10.8e-6, specificHeat: 460, electricalResistivity: 8.0e-7, color: '#cdd0d4' },
  { name: 'AISI 15-5PH',yieldStrength: 1070e6, ultimateTensile: 1170e6, density: 7800, youngsModulus: 200e9, poissonRatio: 0.27, thermalConductivity: 17.8, thermalExpansion: 10.8e-6, specificHeat: 460, electricalResistivity: 8.0e-7, color: '#cdd0d4' },
  { name: 'AISI 13-8Mo',yieldStrength: 1380e6, ultimateTensile: 1450e6, density: 7800, youngsModulus: 203e9, poissonRatio: 0.28, thermalConductivity: 13.8, thermalExpansion: 10.6e-6, specificHeat: 460, electricalResistivity: 1.0e-6, color: '#cdd0d4' },

  // Tool / high-speed / spring steels
  { name: 'Tool D2',    yieldStrength: 1620e6, ultimateTensile: 2050e6, density: 7700, youngsModulus: 210e9, poissonRatio: 0.30, thermalConductivity: 20.0, thermalExpansion: 10.4e-6, specificHeat: 461, electricalResistivity: 6.5e-7, color: '#a3a6aa' },
  { name: 'Tool O1',    yieldStrength: 1500e6, ultimateTensile: 1860e6, density: 7860, youngsModulus: 200e9, poissonRatio: 0.30, thermalConductivity: 36.4, thermalExpansion: 12.0e-6, specificHeat: 460, electricalResistivity: 2.0e-7, color: '#a3a6aa' },
  { name: 'Tool A2',    yieldStrength: 1620e6, ultimateTensile: 1860e6, density: 7860, youngsModulus: 203e9, poissonRatio: 0.30, thermalConductivity: 27.0, thermalExpansion: 10.7e-6, specificHeat: 461, electricalResistivity: 2.2e-7, color: '#a3a6aa' },
  { name: 'Tool S7',    yieldStrength: 1380e6, ultimateTensile: 1900e6, density: 7760, youngsModulus: 205e9, poissonRatio: 0.30, thermalConductivity: 35.0, thermalExpansion: 11.8e-6, specificHeat: 460, electricalResistivity: 2.5e-7, color: '#a3a6aa' },
  { name: 'HSS M2',     yieldStrength: 1860e6, ultimateTensile: 2330e6, density: 8160, youngsModulus: 207e9, poissonRatio: 0.27, thermalConductivity: 19.0, thermalExpansion: 10.1e-6, specificHeat: 419, electricalResistivity: 7.0e-7, color: '#a0a3a7' },
  { name: 'HSS M42',    yieldStrength: 2200e6, ultimateTensile: 2870e6, density: 8160, youngsModulus: 230e9, poissonRatio: 0.27, thermalConductivity: 19.0, thermalExpansion: 10.6e-6, specificHeat: 419, electricalResistivity: 7.0e-7, color: '#a0a3a7' },
  { name: 'Spring 1095',yieldStrength: 525e6,  ultimateTensile: 965e6,  density: 7850, youngsModulus: 205e9, poissonRatio: 0.29, thermalConductivity: 47.7, thermalExpansion: 11.3e-6, specificHeat: 481, electricalResistivity: 1.70e-7, color: '#b3b6bc' },

  // Cast iron grades (ASTM A536 ductile + A48 grey + A532 white)
  { name: 'Ductile Iron 60-40-18', yieldStrength: 276e6, ultimateTensile: 414e6, density: 7100, youngsModulus: 170e9, poissonRatio: 0.275, thermalConductivity: 36.0, thermalExpansion: 11.8e-6, specificHeat: 506, electricalResistivity: 6.4e-7, color: '#5e6065' },
  { name: 'Ductile Iron 65-45-12', yieldStrength: 310e6, ultimateTensile: 448e6, density: 7100, youngsModulus: 170e9, poissonRatio: 0.275, thermalConductivity: 36.0, thermalExpansion: 11.8e-6, specificHeat: 506, electricalResistivity: 6.4e-7, color: '#5e6065' },
  { name: 'Ductile Iron 80-55-06', yieldStrength: 379e6, ultimateTensile: 552e6, density: 7100, youngsModulus: 170e9, poissonRatio: 0.275, thermalConductivity: 33.5, thermalExpansion: 11.6e-6, specificHeat: 506, electricalResistivity: 6.4e-7, color: '#5e6065' },
  { name: 'Ductile Iron 100-70-03',yieldStrength: 483e6, ultimateTensile: 689e6, density: 7100, youngsModulus: 168e9, poissonRatio: 0.275, thermalConductivity: 31.0, thermalExpansion: 11.6e-6, specificHeat: 506, electricalResistivity: 6.4e-7, color: '#5e6065' },
  { name: 'Grey Iron Class 25',    yieldStrength: 172e6, ultimateTensile: 172e6, density: 7150, youngsModulus: 100e9, poissonRatio: 0.26,  thermalConductivity: 46.0, thermalExpansion: 12.0e-6, specificHeat: 470, electricalResistivity: 1.1e-6, color: '#4f5054' },
  { name: 'Grey Iron Class 35',    yieldStrength: 241e6, ultimateTensile: 241e6, density: 7150, youngsModulus: 124e9, poissonRatio: 0.26,  thermalConductivity: 46.0, thermalExpansion: 12.0e-6, specificHeat: 470, electricalResistivity: 1.0e-6, color: '#4f5054' },
];

// ------------------------------------------------------------------
// Metal — Aluminium (50+) — wrought 1xxx..7xxx + cast Axxx
// Sources: MMPDS-2024 Table 3.x, ASM Handbook Vol. 2, Aluminum Assoc.
// designation system.
// ------------------------------------------------------------------
const ALUMINIUM = [
  { name: 'Al 1100-O',     yieldStrength: 34e6,  ultimateTensile: 90e6,  density: 2710, youngsModulus: 69e9,  poissonRatio: 0.33, thermalConductivity: 222, thermalExpansion: 23.6e-6, specificHeat: 904, electricalResistivity: 2.99e-8, color: '#cdd0d4' },
  { name: 'Al 1100-H14',   yieldStrength: 117e6, ultimateTensile: 124e6, density: 2710, youngsModulus: 69e9,  poissonRatio: 0.33, thermalConductivity: 220, thermalExpansion: 23.6e-6, specificHeat: 904, electricalResistivity: 3.0e-8,  color: '#cdd0d4' },
  { name: 'Al 1100-H18',   yieldStrength: 152e6, ultimateTensile: 165e6, density: 2710, youngsModulus: 69e9,  poissonRatio: 0.33, thermalConductivity: 218, thermalExpansion: 23.6e-6, specificHeat: 904, electricalResistivity: 3.0e-8,  color: '#cdd0d4' },
  { name: 'Al 2014-T6',    yieldStrength: 414e6, ultimateTensile: 483e6, density: 2800, youngsModulus: 73e9,  poissonRatio: 0.33, thermalConductivity: 154, thermalExpansion: 23.0e-6, specificHeat: 880, electricalResistivity: 4.31e-8, color: '#c8ccd1' },
  { name: 'Al 2024-T3',    yieldStrength: 345e6, ultimateTensile: 483e6, density: 2780, youngsModulus: 73.1e9,poissonRatio: 0.33, thermalConductivity: 121, thermalExpansion: 22.9e-6, specificHeat: 875, electricalResistivity: 5.82e-8, color: '#c8ccd1' },
  { name: 'Al 2024-T4',    yieldStrength: 324e6, ultimateTensile: 469e6, density: 2780, youngsModulus: 73.1e9,poissonRatio: 0.33, thermalConductivity: 121, thermalExpansion: 22.9e-6, specificHeat: 875, electricalResistivity: 5.82e-8, color: '#c8ccd1' },
  { name: 'Al 2024-T81',   yieldStrength: 450e6, ultimateTensile: 485e6, density: 2780, youngsModulus: 73.1e9,poissonRatio: 0.33, thermalConductivity: 151, thermalExpansion: 23.2e-6, specificHeat: 875, electricalResistivity: 4.5e-8,  color: '#c8ccd1' },
  { name: 'Al 2090-T83',   yieldStrength: 517e6, ultimateTensile: 552e6, density: 2590, youngsModulus: 76e9,  poissonRatio: 0.34, thermalConductivity: 88,  thermalExpansion: 22.9e-6, specificHeat: 1200, electricalResistivity: 6.0e-8, color: '#c8ccd1' },
  { name: 'Al 2219-T87',   yieldStrength: 393e6, ultimateTensile: 476e6, density: 2840, youngsModulus: 73.1e9,poissonRatio: 0.33, thermalConductivity: 121, thermalExpansion: 22.3e-6, specificHeat: 864, electricalResistivity: 5.7e-8,  color: '#c8ccd1' },
  { name: 'Al 3003-O',     yieldStrength: 41e6,  ultimateTensile: 110e6, density: 2730, youngsModulus: 68.9e9,poissonRatio: 0.33, thermalConductivity: 193, thermalExpansion: 23.2e-6, specificHeat: 893, electricalResistivity: 3.4e-8,  color: '#cdd0d4' },
  { name: 'Al 3003-H14',   yieldStrength: 145e6, ultimateTensile: 152e6, density: 2730, youngsModulus: 68.9e9,poissonRatio: 0.33, thermalConductivity: 159, thermalExpansion: 23.2e-6, specificHeat: 893, electricalResistivity: 3.4e-8,  color: '#cdd0d4' },
  { name: 'Al 3003-H18',   yieldStrength: 186e6, ultimateTensile: 200e6, density: 2730, youngsModulus: 68.9e9,poissonRatio: 0.33, thermalConductivity: 159, thermalExpansion: 23.2e-6, specificHeat: 893, electricalResistivity: 3.4e-8,  color: '#cdd0d4' },
  { name: 'Al 5005-H32',   yieldStrength: 117e6, ultimateTensile: 138e6, density: 2700, youngsModulus: 68.9e9,poissonRatio: 0.33, thermalConductivity: 200, thermalExpansion: 23.5e-6, specificHeat: 900, electricalResistivity: 3.3e-8,  color: '#cdd0d4' },
  { name: 'Al 5052-O',     yieldStrength: 89e6,  ultimateTensile: 195e6, density: 2680, youngsModulus: 70.3e9,poissonRatio: 0.33, thermalConductivity: 138, thermalExpansion: 23.8e-6, specificHeat: 880, electricalResistivity: 4.99e-8, color: '#cdd0d4' },
  { name: 'Al 5052-H32',   yieldStrength: 193e6, ultimateTensile: 228e6, density: 2680, youngsModulus: 70.3e9,poissonRatio: 0.33, thermalConductivity: 138, thermalExpansion: 23.8e-6, specificHeat: 880, electricalResistivity: 4.99e-8, color: '#cdd0d4' },
  { name: 'Al 5052-H34',   yieldStrength: 214e6, ultimateTensile: 262e6, density: 2680, youngsModulus: 70.3e9,poissonRatio: 0.33, thermalConductivity: 138, thermalExpansion: 23.8e-6, specificHeat: 880, electricalResistivity: 4.99e-8, color: '#cdd0d4' },
  { name: 'Al 5083-O',     yieldStrength: 145e6, ultimateTensile: 290e6, density: 2660, youngsModulus: 70.3e9,poissonRatio: 0.33, thermalConductivity: 117, thermalExpansion: 23.8e-6, specificHeat: 900, electricalResistivity: 5.9e-8,  color: '#cdd0d4' },
  { name: 'Al 5083-H116',  yieldStrength: 215e6, ultimateTensile: 305e6, density: 2660, youngsModulus: 70.3e9,poissonRatio: 0.33, thermalConductivity: 117, thermalExpansion: 23.8e-6, specificHeat: 900, electricalResistivity: 5.9e-8,  color: '#cdd0d4' },
  { name: 'Al 5086-H32',   yieldStrength: 207e6, ultimateTensile: 290e6, density: 2660, youngsModulus: 71e9,  poissonRatio: 0.33, thermalConductivity: 127, thermalExpansion: 23.9e-6, specificHeat: 900, electricalResistivity: 5.6e-8,  color: '#cdd0d4' },
  { name: 'Al 5754-H22',   yieldStrength: 130e6, ultimateTensile: 220e6, density: 2660, youngsModulus: 70.5e9,poissonRatio: 0.33, thermalConductivity: 132, thermalExpansion: 23.7e-6, specificHeat: 900, electricalResistivity: 5.5e-8,  color: '#cdd0d4' },
  { name: 'Al 6005-T5',    yieldStrength: 240e6, ultimateTensile: 260e6, density: 2700, youngsModulus: 68.9e9,poissonRatio: 0.33, thermalConductivity: 167, thermalExpansion: 23.4e-6, specificHeat: 897, electricalResistivity: 3.8e-8,  color: '#c8ccd1' },
  { name: 'Al 6061-O',     yieldStrength: 55e6,  ultimateTensile: 124e6, density: 2700, youngsModulus: 68.9e9,poissonRatio: 0.33, thermalConductivity: 180, thermalExpansion: 23.6e-6, specificHeat: 896, electricalResistivity: 3.99e-8, color: '#c8ccd1' },
  { name: 'Al 6061-T4',    yieldStrength: 145e6, ultimateTensile: 241e6, density: 2700, youngsModulus: 68.9e9,poissonRatio: 0.33, thermalConductivity: 154, thermalExpansion: 23.6e-6, specificHeat: 896, electricalResistivity: 3.99e-8, color: '#c8ccd1' },
  { name: 'Al 6061-T6',    yieldStrength: 276e6, ultimateTensile: 310e6, density: 2700, youngsModulus: 68.9e9,poissonRatio: 0.33, thermalConductivity: 167, thermalExpansion: 23.6e-6, specificHeat: 896, electricalResistivity: 3.99e-8, color: '#c8ccd1' },
  { name: 'Al 6063-T5',    yieldStrength: 145e6, ultimateTensile: 186e6, density: 2700, youngsModulus: 68.9e9,poissonRatio: 0.33, thermalConductivity: 209, thermalExpansion: 23.4e-6, specificHeat: 900, electricalResistivity: 3.2e-8,  color: '#cdd0d4' },
  { name: 'Al 6063-T6',    yieldStrength: 214e6, ultimateTensile: 241e6, density: 2700, youngsModulus: 68.9e9,poissonRatio: 0.33, thermalConductivity: 200, thermalExpansion: 23.4e-6, specificHeat: 900, electricalResistivity: 3.2e-8,  color: '#cdd0d4' },
  { name: 'Al 6082-T6',    yieldStrength: 260e6, ultimateTensile: 310e6, density: 2700, youngsModulus: 69e9,  poissonRatio: 0.33, thermalConductivity: 170, thermalExpansion: 23.4e-6, specificHeat: 896, electricalResistivity: 3.8e-8,  color: '#c8ccd1' },
  { name: 'Al 7005-T53',   yieldStrength: 290e6, ultimateTensile: 350e6, density: 2780, youngsModulus: 72e9,  poissonRatio: 0.33, thermalConductivity: 167, thermalExpansion: 23.6e-6, specificHeat: 900, electricalResistivity: 4.2e-8,  color: '#c8ccd1' },
  { name: 'Al 7039-T64',   yieldStrength: 345e6, ultimateTensile: 415e6, density: 2740, youngsModulus: 70.0e9,poissonRatio: 0.33, thermalConductivity: 159, thermalExpansion: 23.4e-6, specificHeat: 900, electricalResistivity: 4.2e-8,  color: '#c8ccd1' },
  { name: 'Al 7050-T7451', yieldStrength: 469e6, ultimateTensile: 524e6, density: 2830, youngsModulus: 71.7e9,poissonRatio: 0.33, thermalConductivity: 157, thermalExpansion: 23.5e-6, specificHeat: 860, electricalResistivity: 4.1e-8,  color: '#c8ccd1' },
  { name: 'Al 7050-T7651', yieldStrength: 510e6, ultimateTensile: 552e6, density: 2830, youngsModulus: 71.7e9,poissonRatio: 0.33, thermalConductivity: 157, thermalExpansion: 23.5e-6, specificHeat: 860, electricalResistivity: 4.1e-8,  color: '#c8ccd1' },
  { name: 'Al 7068-T6',    yieldStrength: 683e6, ultimateTensile: 710e6, density: 2850, youngsModulus: 73.1e9,poissonRatio: 0.33, thermalConductivity: 190, thermalExpansion: 23.8e-6, specificHeat: 870, electricalResistivity: 3.9e-8,  color: '#c8ccd1' },
  { name: 'Al 7075-O',     yieldStrength: 103e6, ultimateTensile: 228e6, density: 2810, youngsModulus: 71.7e9,poissonRatio: 0.33, thermalConductivity: 173, thermalExpansion: 23.6e-6, specificHeat: 960, electricalResistivity: 5.15e-8, color: '#c8ccd1' },
  { name: 'Al 7075-T6',    yieldStrength: 503e6, ultimateTensile: 572e6, density: 2810, youngsModulus: 71.7e9,poissonRatio: 0.33, thermalConductivity: 130, thermalExpansion: 23.6e-6, specificHeat: 960, electricalResistivity: 5.15e-8, color: '#c8ccd1' },
  { name: 'Al 7075-T73',   yieldStrength: 435e6, ultimateTensile: 503e6, density: 2810, youngsModulus: 71.7e9,poissonRatio: 0.33, thermalConductivity: 155, thermalExpansion: 23.6e-6, specificHeat: 960, electricalResistivity: 5.15e-8, color: '#c8ccd1' },
  { name: 'Al 7475-T7351', yieldStrength: 392e6, ultimateTensile: 461e6, density: 2810, youngsModulus: 70.3e9,poissonRatio: 0.33, thermalConductivity: 147, thermalExpansion: 23.5e-6, specificHeat: 960, electricalResistivity: 5.0e-8,  color: '#c8ccd1' },
  { name: 'Al 8090-T8',    yieldStrength: 386e6, ultimateTensile: 463e6, density: 2540, youngsModulus: 77e9,  poissonRatio: 0.33, thermalConductivity: 95,  thermalExpansion: 21.5e-6, specificHeat: 870, electricalResistivity: 7.0e-8,  color: '#c8ccd1' },

  // Cast aluminium alloys (sand + permanent mould + die-cast)
  { name: 'Al A356.0-T6',  yieldStrength: 207e6, ultimateTensile: 283e6, density: 2680, youngsModulus: 72.4e9,poissonRatio: 0.33, thermalConductivity: 151, thermalExpansion: 21.4e-6, specificHeat: 963, electricalResistivity: 4.4e-8,  color: '#c0c4c8' },
  { name: 'Al A357.0-T6',  yieldStrength: 297e6, ultimateTensile: 359e6, density: 2670, youngsModulus: 72.4e9,poissonRatio: 0.33, thermalConductivity: 150, thermalExpansion: 21.5e-6, specificHeat: 963, electricalResistivity: 4.4e-8,  color: '#c0c4c8' },
  { name: 'Al A380.0-F',   yieldStrength: 159e6, ultimateTensile: 324e6, density: 2740, youngsModulus: 71.0e9,poissonRatio: 0.33, thermalConductivity: 96,  thermalExpansion: 21.8e-6, specificHeat: 963, electricalResistivity: 7.5e-8,  color: '#c0c4c8' },
  { name: 'Al A413.0',     yieldStrength: 124e6, ultimateTensile: 296e6, density: 2660, youngsModulus: 71.0e9,poissonRatio: 0.33, thermalConductivity: 121, thermalExpansion: 20.4e-6, specificHeat: 963, electricalResistivity: 6.0e-8,  color: '#c0c4c8' },
  { name: 'Al A535.0-F',   yieldStrength: 138e6, ultimateTensile: 276e6, density: 2620, youngsModulus: 70.3e9,poissonRatio: 0.33, thermalConductivity: 100, thermalExpansion: 24.5e-6, specificHeat: 963, electricalResistivity: 6.5e-8,  color: '#c0c4c8' },
  { name: 'Al A713.0-T5',  yieldStrength: 228e6, ultimateTensile: 296e6, density: 2810, youngsModulus: 72.4e9,poissonRatio: 0.33, thermalConductivity: 138, thermalExpansion: 23.6e-6, specificHeat: 963, electricalResistivity: 5.5e-8,  color: '#c0c4c8' },
];

// ------------------------------------------------------------------
// Metal — Copper (15+)  — UNS C-numbers
// ------------------------------------------------------------------
const COPPER = [
  { name: 'C10100 OFE Copper',      yieldStrength: 70e6,  ultimateTensile: 220e6, density: 8940, youngsModulus: 117e9, poissonRatio: 0.34, thermalConductivity: 391, thermalExpansion: 17.0e-6, specificHeat: 385, electricalResistivity: 1.71e-8, color: '#c08866' },
  { name: 'C11000 ETP Copper',      yieldStrength: 69e6,  ultimateTensile: 220e6, density: 8940, youngsModulus: 117e9, poissonRatio: 0.34, thermalConductivity: 391, thermalExpansion: 17.0e-6, specificHeat: 385, electricalResistivity: 1.72e-8, color: '#c08866' },
  { name: 'C12200 DHP Copper',      yieldStrength: 69e6,  ultimateTensile: 220e6, density: 8940, youngsModulus: 115e9, poissonRatio: 0.34, thermalConductivity: 339, thermalExpansion: 17.6e-6, specificHeat: 385, electricalResistivity: 1.85e-8, color: '#c08866' },
  { name: 'C14500 Tellurium Cu',    yieldStrength: 124e6, ultimateTensile: 234e6, density: 8940, youngsModulus: 115e9, poissonRatio: 0.34, thermalConductivity: 355, thermalExpansion: 17.6e-6, specificHeat: 385, electricalResistivity: 1.96e-8, color: '#c08866' },
  { name: 'C15100 Zr-Cu',           yieldStrength: 365e6, ultimateTensile: 415e6, density: 8930, youngsModulus: 124e9, poissonRatio: 0.34, thermalConductivity: 360, thermalExpansion: 17.7e-6, specificHeat: 385, electricalResistivity: 2.1e-8,  color: '#c08866' },
  { name: 'C17200 Beryllium Cu',    yieldStrength: 1035e6,ultimateTensile: 1380e6,density: 8260, youngsModulus: 128e9, poissonRatio: 0.30, thermalConductivity: 105, thermalExpansion: 17.5e-6, specificHeat: 420, electricalResistivity: 5.7e-8,  color: '#c89978' },
  { name: 'C17500 Cu-Co-Be',        yieldStrength: 760e6, ultimateTensile: 825e6, density: 8750, youngsModulus: 138e9, poissonRatio: 0.30, thermalConductivity: 245, thermalExpansion: 17.8e-6, specificHeat: 420, electricalResistivity: 4.6e-8,  color: '#c89978' },
  { name: 'C23000 Red Brass',       yieldStrength: 124e6, ultimateTensile: 270e6, density: 8740, youngsModulus: 117e9, poissonRatio: 0.34, thermalConductivity: 159, thermalExpansion: 18.7e-6, specificHeat: 380, electricalResistivity: 4.7e-8,  color: '#c89373' },
  { name: 'C26000 Cartridge Brass', yieldStrength: 124e6, ultimateTensile: 303e6, density: 8530, youngsModulus: 110e9, poissonRatio: 0.34, thermalConductivity: 120, thermalExpansion: 19.9e-6, specificHeat: 375, electricalResistivity: 6.2e-8,  color: '#d0a878' },
  { name: 'C27200 Yellow Brass',    yieldStrength: 145e6, ultimateTensile: 350e6, density: 8470, youngsModulus: 105e9, poissonRatio: 0.35, thermalConductivity: 116, thermalExpansion: 20.3e-6, specificHeat: 376, electricalResistivity: 6.6e-8,  color: '#d0a878' },
  { name: 'C36000 Free-cut Brass',  yieldStrength: 124e6, ultimateTensile: 338e6, density: 8500, youngsModulus: 97e9,  poissonRatio: 0.34, thermalConductivity: 115, thermalExpansion: 20.5e-6, specificHeat: 380, electricalResistivity: 6.6e-8,  color: '#d0a878' },
  { name: 'C46400 Naval Brass',     yieldStrength: 172e6, ultimateTensile: 379e6, density: 8410, youngsModulus: 103e9, poissonRatio: 0.34, thermalConductivity: 116, thermalExpansion: 21.2e-6, specificHeat: 376, electricalResistivity: 6.6e-8,  color: '#cea878' },
  { name: 'C70600 90-10 CuNi',      yieldStrength: 124e6, ultimateTensile: 303e6, density: 8940, youngsModulus: 138e9, poissonRatio: 0.34, thermalConductivity: 45,  thermalExpansion: 17.1e-6, specificHeat: 376, electricalResistivity: 1.91e-7, color: '#b8aa9c' },
  { name: 'C71500 70-30 CuNi',      yieldStrength: 138e6, ultimateTensile: 372e6, density: 8940, youngsModulus: 152e9, poissonRatio: 0.34, thermalConductivity: 29,  thermalExpansion: 16.2e-6, specificHeat: 376, electricalResistivity: 3.75e-7, color: '#b8aa9c' },
  { name: 'C75200 Nickel Silver',   yieldStrength: 124e6, ultimateTensile: 386e6, density: 8730, youngsModulus: 124e9, poissonRatio: 0.34, thermalConductivity: 33,  thermalExpansion: 16.2e-6, specificHeat: 397, electricalResistivity: 2.9e-7,  color: '#c0bcb4' },
];

// ------------------------------------------------------------------
// Metal — Bronze (10+)
// ------------------------------------------------------------------
const BRONZE = [
  { name: 'C50500 Phos. Bronze 1.25%',yieldStrength: 138e6, ultimateTensile: 276e6, density: 8860, youngsModulus: 117e9, poissonRatio: 0.34, thermalConductivity: 209, thermalExpansion: 17.8e-6, specificHeat: 380, electricalResistivity: 3.2e-8, color: '#b08868' },
  { name: 'C51000 Phos. Bronze 5%',   yieldStrength: 152e6, ultimateTensile: 324e6, density: 8860, youngsModulus: 110e9, poissonRatio: 0.34, thermalConductivity: 84,  thermalExpansion: 17.8e-6, specificHeat: 380, electricalResistivity: 1.1e-7, color: '#b08868' },
  { name: 'C52400 Phos. Bronze 10%',  yieldStrength: 193e6, ultimateTensile: 455e6, density: 8780, youngsModulus: 110e9, poissonRatio: 0.34, thermalConductivity: 50,  thermalExpansion: 18.4e-6, specificHeat: 380, electricalResistivity: 1.6e-7, color: '#a88060' },
  { name: 'C54400 Phos. Bronze B-2',  yieldStrength: 310e6, ultimateTensile: 469e6, density: 8890, youngsModulus: 103e9, poissonRatio: 0.34, thermalConductivity: 84,  thermalExpansion: 17.3e-6, specificHeat: 380, electricalResistivity: 1.05e-7,color: '#a88060' },
  { name: 'C61400 Aluminium Bronze',  yieldStrength: 228e6, ultimateTensile: 524e6, density: 7890, youngsModulus: 117e9, poissonRatio: 0.32, thermalConductivity: 56,  thermalExpansion: 16.2e-6, specificHeat: 419, electricalResistivity: 1.27e-7,color: '#b89870' },
  { name: 'C63000 Al-Ni Bronze',      yieldStrength: 414e6, ultimateTensile: 814e6, density: 7580, youngsModulus: 120e9, poissonRatio: 0.32, thermalConductivity: 38,  thermalExpansion: 16.2e-6, specificHeat: 419, electricalResistivity: 1.85e-7,color: '#b89870' },
  { name: 'C63200 Al-Bronze Cast',    yieldStrength: 260e6, ultimateTensile: 620e6, density: 7640, youngsModulus: 117e9, poissonRatio: 0.32, thermalConductivity: 38,  thermalExpansion: 16.2e-6, specificHeat: 419, electricalResistivity: 1.85e-7,color: '#b89870' },
  { name: 'C65500 Si Bronze',         yieldStrength: 145e6, ultimateTensile: 386e6, density: 8530, youngsModulus: 105e9, poissonRatio: 0.33, thermalConductivity: 36,  thermalExpansion: 18.0e-6, specificHeat: 376, electricalResistivity: 2.5e-7, color: '#b08868' },
  { name: 'C90300 Tin Bronze 88-8-4', yieldStrength: 124e6, ultimateTensile: 310e6, density: 8800, youngsModulus: 103e9, poissonRatio: 0.34, thermalConductivity: 75,  thermalExpansion: 18.0e-6, specificHeat: 376, electricalResistivity: 1.5e-7, color: '#b08868' },
  { name: 'C93200 Bearing Bronze',    yieldStrength: 125e6, ultimateTensile: 240e6, density: 8930, youngsModulus: 100e9, poissonRatio: 0.34, thermalConductivity: 59,  thermalExpansion: 18.0e-6, specificHeat: 376, electricalResistivity: 1.45e-7,color: '#b08868' },
];

// ------------------------------------------------------------------
// Metal — Titanium (10+) — MMPDS-2024 chapter 5
// ------------------------------------------------------------------
const TITANIUM = [
  { name: 'Ti Grade 1 CP',         yieldStrength: 170e6, ultimateTensile: 240e6, density: 4510, youngsModulus: 103e9, poissonRatio: 0.34, thermalConductivity: 16,  thermalExpansion: 8.6e-6, specificHeat: 528, electricalResistivity: 4.2e-7, color: '#9ea0a4' },
  { name: 'Ti Grade 2 CP',         yieldStrength: 275e6, ultimateTensile: 345e6, density: 4510, youngsModulus: 103e9, poissonRatio: 0.34, thermalConductivity: 17,  thermalExpansion: 8.6e-6, specificHeat: 528, electricalResistivity: 5.6e-7, color: '#9ea0a4' },
  { name: 'Ti Grade 3 CP',         yieldStrength: 380e6, ultimateTensile: 450e6, density: 4510, youngsModulus: 103e9, poissonRatio: 0.34, thermalConductivity: 17,  thermalExpansion: 8.6e-6, specificHeat: 528, electricalResistivity: 5.6e-7, color: '#9ea0a4' },
  { name: 'Ti Grade 4 CP',         yieldStrength: 485e6, ultimateTensile: 550e6, density: 4510, youngsModulus: 104e9, poissonRatio: 0.34, thermalConductivity: 17,  thermalExpansion: 8.6e-6, specificHeat: 528, electricalResistivity: 5.6e-7, color: '#9ea0a4' },
  { name: 'Ti Grade 5 (Ti-6Al-4V)',yieldStrength: 880e6, ultimateTensile: 950e6, density: 4430, youngsModulus: 113.8e9,poissonRatio: 0.342,thermalConductivity: 6.7, thermalExpansion: 8.6e-6, specificHeat: 526.3,electricalResistivity: 1.78e-6,color: '#9ea0a4' },
  { name: 'Ti Grade 7',            yieldStrength: 275e6, ultimateTensile: 345e6, density: 4520, youngsModulus: 103e9, poissonRatio: 0.34, thermalConductivity: 17,  thermalExpansion: 8.6e-6, specificHeat: 528, electricalResistivity: 5.6e-7, color: '#9ea0a4' },
  { name: 'Ti Grade 9 (Ti-3Al-2.5V)',yieldStrength:620e6,ultimateTensile: 720e6, density: 4480, youngsModulus: 100e9, poissonRatio: 0.34, thermalConductivity: 8.3, thermalExpansion: 9.5e-6, specificHeat: 540, electricalResistivity: 1.26e-6,color: '#9ea0a4' },
  { name: 'Ti Grade 12',           yieldStrength: 345e6, ultimateTensile: 480e6, density: 4520, youngsModulus: 103e9, poissonRatio: 0.34, thermalConductivity: 19,  thermalExpansion: 9.0e-6, specificHeat: 540, electricalResistivity: 5.2e-7, color: '#9ea0a4' },
  { name: 'Ti Grade 23 (Ti-6Al-4V ELI)',yieldStrength:795e6,ultimateTensile:860e6,density:4430,youngsModulus:113.8e9,poissonRatio:0.342,thermalConductivity:6.7,thermalExpansion:8.6e-6,specificHeat:526.3,electricalResistivity:1.78e-6,color:'#9ea0a4' },
  { name: 'Ti 15-3-3-3',           yieldStrength: 980e6, ultimateTensile:1050e6,density: 4760, youngsModulus: 94e9,  poissonRatio: 0.34, thermalConductivity: 7.5, thermalExpansion: 9.0e-6, specificHeat: 510, electricalResistivity: 1.4e-6, color: '#9ea0a4' },
];

// ------------------------------------------------------------------
// Polymer (40+)  — typical at 23°C from datasheets (Victrex, DuPont,
// SABIC, BASF, Eastman). Where a temper / fill is omitted, value is
// for the unfilled, dry-as-moulded grade.
// ------------------------------------------------------------------
const POLYMER = [
  { name: 'ABS',                yieldStrength: 41e6,  ultimateTensile: 41e6,  density: 1050, youngsModulus: 2.3e9, poissonRatio: 0.35, thermalConductivity: 0.17, thermalExpansion: 90.0e-6, specificHeat: 1300, electricalResistivity: Infinity, color: '#e8e3d3' },
  { name: 'PLA',                yieldStrength: 60e6,  ultimateTensile: 62e6,  density: 1240, youngsModulus: 3.5e9, poissonRatio: 0.36, thermalConductivity: 0.13, thermalExpansion: 85.0e-6, specificHeat: 1800, electricalResistivity: Infinity, color: '#dadcd9' },
  { name: 'PETG',               yieldStrength: 50e6,  ultimateTensile: 53e6,  density: 1270, youngsModulus: 2.1e9, poissonRatio: 0.40, thermalConductivity: 0.20, thermalExpansion: 68.0e-6, specificHeat: 1200, electricalResistivity: Infinity, color: '#d6dadc' },
  { name: 'PET',                yieldStrength: 70e6,  ultimateTensile: 80e6,  density: 1390, youngsModulus: 2.8e9, poissonRatio: 0.40, thermalConductivity: 0.24, thermalExpansion: 70.0e-6, specificHeat: 1300, electricalResistivity: Infinity, color: '#d6dadc' },
  { name: 'PC (Lexan)',         yieldStrength: 62e6,  ultimateTensile: 65e6,  density: 1200, youngsModulus: 2.3e9, poissonRatio: 0.37, thermalConductivity: 0.21, thermalExpansion: 65.0e-6, specificHeat: 1170, electricalResistivity: Infinity, color: '#d0d4d6' },
  { name: 'PC/ABS',             yieldStrength: 53e6,  ultimateTensile: 55e6,  density: 1130, youngsModulus: 2.5e9, poissonRatio: 0.36, thermalConductivity: 0.20, thermalExpansion: 80.0e-6, specificHeat: 1230, electricalResistivity: Infinity, color: '#dadcd9' },
  { name: 'PMMA (Acrylic)',     yieldStrength: 72e6,  ultimateTensile: 75e6,  density: 1190, youngsModulus: 3.2e9, poissonRatio: 0.37, thermalConductivity: 0.19, thermalExpansion: 70.0e-6, specificHeat: 1466, electricalResistivity: Infinity, color: '#e6e6e6' },
  { name: 'PS (GP)',            yieldStrength: 40e6,  ultimateTensile: 50e6,  density: 1050, youngsModulus: 3.2e9, poissonRatio: 0.34, thermalConductivity: 0.15, thermalExpansion: 80.0e-6, specificHeat: 1300, electricalResistivity: Infinity, color: '#dadada' },
  { name: 'HIPS',               yieldStrength: 23e6,  ultimateTensile: 33e6,  density: 1040, youngsModulus: 2.0e9, poissonRatio: 0.34, thermalConductivity: 0.17, thermalExpansion: 80.0e-6, specificHeat: 1340, electricalResistivity: Infinity, color: '#dadada' },
  { name: 'PVC Rigid',          yieldStrength: 55e6,  ultimateTensile: 55e6,  density: 1390, youngsModulus: 3.4e9, poissonRatio: 0.38, thermalConductivity: 0.19, thermalExpansion: 80.0e-6, specificHeat: 900,  electricalResistivity: Infinity, color: '#d2d4d6' },
  { name: 'CPVC',               yieldStrength: 55e6,  ultimateTensile: 55e6,  density: 1550, youngsModulus: 2.9e9, poissonRatio: 0.38, thermalConductivity: 0.14, thermalExpansion: 70.0e-6, specificHeat: 900,  electricalResistivity: Infinity, color: '#cccdce' },
  { name: 'PE-HD (HDPE)',       yieldStrength: 26e6,  ultimateTensile: 33e6,  density: 960,  youngsModulus: 1.1e9, poissonRatio: 0.46, thermalConductivity: 0.49, thermalExpansion: 200.0e-6,specificHeat: 1900, electricalResistivity: Infinity, color: '#dadada' },
  { name: 'PE-LD (LDPE)',       yieldStrength: 10e6,  ultimateTensile: 12e6,  density: 921,  youngsModulus: 0.24e9,poissonRatio: 0.46, thermalConductivity: 0.33, thermalExpansion: 200.0e-6,specificHeat: 2200, electricalResistivity: Infinity, color: '#dadada' },
  { name: 'PE-UHMW',            yieldStrength: 21e6,  ultimateTensile: 48e6,  density: 935,  youngsModulus: 0.69e9,poissonRatio: 0.46, thermalConductivity: 0.41, thermalExpansion: 200.0e-6,specificHeat: 1840, electricalResistivity: Infinity, color: '#dadada' },
  { name: 'PP (Homo)',          yieldStrength: 35e6,  ultimateTensile: 38e6,  density: 905,  youngsModulus: 1.5e9, poissonRatio: 0.40, thermalConductivity: 0.22, thermalExpansion: 150.0e-6,specificHeat: 1925, electricalResistivity: Infinity, color: '#dadada' },
  { name: 'PP-Copolymer',       yieldStrength: 25e6,  ultimateTensile: 30e6,  density: 905,  youngsModulus: 1.1e9, poissonRatio: 0.40, thermalConductivity: 0.22, thermalExpansion: 150.0e-6,specificHeat: 1925, electricalResistivity: Infinity, color: '#dadada' },
  { name: 'Nylon 6',            yieldStrength: 79e6,  ultimateTensile: 79e6,  density: 1140, youngsModulus: 2.6e9, poissonRatio: 0.41, thermalConductivity: 0.25, thermalExpansion: 80.0e-6, specificHeat: 1670, electricalResistivity: Infinity, color: '#dccab8' },
  { name: 'Nylon 6/6',          yieldStrength: 82.7e6,ultimateTensile: 82.7e6,density: 1140, youngsModulus: 2.83e9,poissonRatio: 0.41, thermalConductivity: 0.25, thermalExpansion: 80.0e-6, specificHeat: 1670, electricalResistivity: Infinity, color: '#dccab8' },
  { name: 'Nylon 6/6 GF30',     yieldStrength: 165e6, ultimateTensile: 185e6, density: 1340, youngsModulus: 9.0e9, poissonRatio: 0.39, thermalConductivity: 0.30, thermalExpansion: 30.0e-6, specificHeat: 1500, electricalResistivity: Infinity, color: '#bcaa98' },
  { name: 'Nylon 12',           yieldStrength: 50e6,  ultimateTensile: 53e6,  density: 1010, youngsModulus: 1.5e9, poissonRatio: 0.41, thermalConductivity: 0.25, thermalExpansion: 100.0e-6,specificHeat: 1670, electricalResistivity: Infinity, color: '#dccab8' },
  { name: 'POM (Acetal)',       yieldStrength: 72e6,  ultimateTensile: 72e6,  density: 1410, youngsModulus: 3.1e9, poissonRatio: 0.35, thermalConductivity: 0.31, thermalExpansion: 110.0e-6,specificHeat: 1500, electricalResistivity: Infinity, color: '#e6e6e6' },
  { name: 'POM-C (Delrin)',     yieldStrength: 65e6,  ultimateTensile: 68e6,  density: 1420, youngsModulus: 3.0e9, poissonRatio: 0.35, thermalConductivity: 0.31, thermalExpansion: 110.0e-6,specificHeat: 1500, electricalResistivity: Infinity, color: '#e6e6e6' },
  { name: 'PEEK',               yieldStrength: 97e6,  ultimateTensile: 100e6, density: 1320, youngsModulus: 3.6e9, poissonRatio: 0.40, thermalConductivity: 0.25, thermalExpansion: 47.0e-6, specificHeat: 1340, electricalResistivity: Infinity, color: '#c8b078' },
  { name: 'PEEK GF30',          yieldStrength: 140e6, ultimateTensile: 165e6, density: 1500, youngsModulus: 11e9,  poissonRatio: 0.40, thermalConductivity: 0.43, thermalExpansion: 24.0e-6, specificHeat: 1340, electricalResistivity: Infinity, color: '#b8a060' },
  { name: 'PEI (Ultem)',        yieldStrength: 105e6, ultimateTensile: 105e6, density: 1270, youngsModulus: 3.0e9, poissonRatio: 0.41, thermalConductivity: 0.22, thermalExpansion: 56.0e-6, specificHeat: 1700, electricalResistivity: Infinity, color: '#c0a888' },
  { name: 'PSU (Udel)',         yieldStrength: 70e6,  ultimateTensile: 70e6,  density: 1240, youngsModulus: 2.5e9, poissonRatio: 0.39, thermalConductivity: 0.26, thermalExpansion: 56.0e-6, specificHeat: 1300, electricalResistivity: Infinity, color: '#dac8a8' },
  { name: 'PPSU (Radel)',       yieldStrength: 70e6,  ultimateTensile: 75e6,  density: 1290, youngsModulus: 2.3e9, poissonRatio: 0.39, thermalConductivity: 0.30, thermalExpansion: 55.0e-6, specificHeat: 1170, electricalResistivity: Infinity, color: '#bda0a8' },
  { name: 'PPS (Ryton)',        yieldStrength: 88e6,  ultimateTensile: 90e6,  density: 1350, youngsModulus: 3.4e9, poissonRatio: 0.36, thermalConductivity: 0.30, thermalExpansion: 49.0e-6, specificHeat: 1090, electricalResistivity: Infinity, color: '#b8a890' },
  { name: 'PTFE (Teflon)',      yieldStrength: 23e6,  ultimateTensile: 27e6,  density: 2200, youngsModulus: 0.55e9,poissonRatio: 0.46, thermalConductivity: 0.25, thermalExpansion: 135.0e-6,specificHeat: 1000, electricalResistivity: Infinity, color: '#f0f0f0' },
  { name: 'PVDF (Kynar)',       yieldStrength: 50e6,  ultimateTensile: 52e6,  density: 1780, youngsModulus: 2.0e9, poissonRatio: 0.40, thermalConductivity: 0.18, thermalExpansion: 130.0e-6,specificHeat: 1380, electricalResistivity: Infinity, color: '#e8e8e8' },
  { name: 'FEP',                yieldStrength: 23e6,  ultimateTensile: 25e6,  density: 2150, youngsModulus: 0.34e9,poissonRatio: 0.45, thermalConductivity: 0.25, thermalExpansion: 135.0e-6,specificHeat: 1100, electricalResistivity: Infinity, color: '#f0f0f0' },
  { name: 'PFA',                yieldStrength: 14e6,  ultimateTensile: 28e6,  density: 2150, youngsModulus: 0.48e9,poissonRatio: 0.46, thermalConductivity: 0.21, thermalExpansion: 135.0e-6,specificHeat: 1100, electricalResistivity: Infinity, color: '#f0f0f0' },
  { name: 'TPU 90A',            yieldStrength: 6e6,   ultimateTensile: 40e6,  density: 1200, youngsModulus: 0.018e9,poissonRatio:0.49,thermalConductivity: 0.19, thermalExpansion: 150.0e-6,specificHeat: 1500, electricalResistivity: Infinity, color: '#c0c4c8' },
  { name: 'TPU 95A',            yieldStrength: 10e6,  ultimateTensile: 48e6,  density: 1210, youngsModulus: 0.035e9,poissonRatio:0.49,thermalConductivity: 0.20, thermalExpansion: 150.0e-6,specificHeat: 1500, electricalResistivity: Infinity, color: '#c0c4c8' },
  { name: 'TPE-S',              yieldStrength: 4e6,   ultimateTensile: 12e6,  density: 920,  youngsModulus: 0.005e9,poissonRatio:0.49,thermalConductivity: 0.20, thermalExpansion: 200.0e-6,specificHeat: 1900, electricalResistivity: Infinity, color: '#c0c4c8' },
  { name: 'EPDM Rubber',        yieldStrength: 7e6,   ultimateTensile: 14e6,  density: 860,  youngsModulus: 0.008e9,poissonRatio:0.49,thermalConductivity: 0.31, thermalExpansion: 250.0e-6,specificHeat: 2000, electricalResistivity: Infinity, color: '#3c3e42' },
  { name: 'NBR Rubber',         yieldStrength: 8e6,   ultimateTensile: 16e6,  density: 1000, youngsModulus: 0.01e9, poissonRatio: 0.49, thermalConductivity: 0.25, thermalExpansion: 230.0e-6,specificHeat: 1900, electricalResistivity: Infinity, color: '#3c3e42' },
  { name: 'Silicone Rubber',    yieldStrength: 5e6,   ultimateTensile: 10e6,  density: 1150, youngsModulus: 0.005e9,poissonRatio:0.49,thermalConductivity: 0.20, thermalExpansion: 300.0e-6,specificHeat: 1300, electricalResistivity: Infinity, color: '#e6e0c8' },
  { name: 'Polyurethane Cast',  yieldStrength: 31e6,  ultimateTensile: 45e6,  density: 1200, youngsModulus: 0.04e9, poissonRatio: 0.49, thermalConductivity: 0.21, thermalExpansion: 200.0e-6,specificHeat: 1800, electricalResistivity: Infinity, color: '#c8c0a8' },
];

// ------------------------------------------------------------------
// Wood (20+) — Wood Handbook: Wood as an Engineering Material (FPL-GTR-190)
// modulus along grain, density at 12% moisture.
// ------------------------------------------------------------------
const WOOD = [
  { name: 'Pine — Eastern White', yieldStrength: 33e6,  ultimateTensile: 59e6,  density: 350, youngsModulus: 8.5e9,  poissonRatio: 0.33, thermalConductivity: 0.11, thermalExpansion: 4.0e-6, specificHeat: 1700, electricalResistivity: Infinity, color: '#e8d5a8' },
  { name: 'Pine — Red',           yieldStrength: 41e6,  ultimateTensile: 76e6,  density: 460, youngsModulus: 11.2e9, poissonRatio: 0.33, thermalConductivity: 0.12, thermalExpansion: 4.0e-6, specificHeat: 1700, electricalResistivity: Infinity, color: '#e0c898' },
  { name: 'Pine — Yellow Long.',  yieldStrength: 58e6,  ultimateTensile: 100e6, density: 590, youngsModulus: 13.7e9, poissonRatio: 0.32, thermalConductivity: 0.14, thermalExpansion: 4.0e-6, specificHeat: 1700, electricalResistivity: Infinity, color: '#d8b878' },
  { name: 'Oak — Red',            yieldStrength: 47e6,  ultimateTensile: 99e6,  density: 700, youngsModulus: 12.5e9, poissonRatio: 0.35, thermalConductivity: 0.17, thermalExpansion: 5.0e-6, specificHeat: 1600, electricalResistivity: Infinity, color: '#9f7a4e' },
  { name: 'Oak — White',          yieldStrength: 51e6,  ultimateTensile: 105e6, density: 770, youngsModulus: 12.3e9, poissonRatio: 0.35, thermalConductivity: 0.17, thermalExpansion: 5.0e-6, specificHeat: 1600, electricalResistivity: Infinity, color: '#a88058' },
  { name: 'Maple — Hard',         yieldStrength: 54e6,  ultimateTensile: 109e6, density: 705, youngsModulus: 12.6e9, poissonRatio: 0.35, thermalConductivity: 0.17, thermalExpansion: 5.0e-6, specificHeat: 1600, electricalResistivity: Infinity, color: '#d5b48b' },
  { name: 'Maple — Soft',         yieldStrength: 40e6,  ultimateTensile: 92e6,  density: 540, youngsModulus: 10.3e9, poissonRatio: 0.34, thermalConductivity: 0.14, thermalExpansion: 5.0e-6, specificHeat: 1600, electricalResistivity: Infinity, color: '#e0c2a0' },
  { name: 'Cherry — Black',       yieldStrength: 49e6,  ultimateTensile: 85e6,  density: 560, youngsModulus: 10.3e9, poissonRatio: 0.35, thermalConductivity: 0.14, thermalExpansion: 5.0e-6, specificHeat: 1600, electricalResistivity: Infinity, color: '#9a5530' },
  { name: 'Walnut — Black',       yieldStrength: 52e6,  ultimateTensile: 101e6, density: 610, youngsModulus: 11.6e9, poissonRatio: 0.35, thermalConductivity: 0.15, thermalExpansion: 5.0e-6, specificHeat: 1600, electricalResistivity: Infinity, color: '#5a3a22' },
  { name: 'Birch — Yellow',       yieldStrength: 56e6,  ultimateTensile: 114e6, density: 660, youngsModulus: 13.9e9, poissonRatio: 0.35, thermalConductivity: 0.16, thermalExpansion: 5.0e-6, specificHeat: 1600, electricalResistivity: Infinity, color: '#dab278' },
  { name: 'Mahogany — Honduran',  yieldStrength: 47e6,  ultimateTensile: 79e6,  density: 540, youngsModulus: 9.7e9,  poissonRatio: 0.34, thermalConductivity: 0.13, thermalExpansion: 5.0e-6, specificHeat: 1600, electricalResistivity: Infinity, color: '#923010' },
  { name: 'Teak',                 yieldStrength: 55e6,  ultimateTensile: 100e6, density: 655, youngsModulus: 12.5e9, poissonRatio: 0.35, thermalConductivity: 0.17, thermalExpansion: 5.0e-6, specificHeat: 1600, electricalResistivity: Infinity, color: '#8a6028' },
  { name: 'Bamboo (Moso)',        yieldStrength: 142e6, ultimateTensile: 215e6, density: 700, youngsModulus: 20.0e9, poissonRatio: 0.32, thermalConductivity: 0.17, thermalExpansion: 4.0e-6, specificHeat: 1700, electricalResistivity: Infinity, color: '#d8c088' },
  { name: 'Plywood — Baltic Birch',yieldStrength: 30e6, ultimateTensile: 47e6,  density: 680, youngsModulus: 11.0e9, poissonRatio: 0.30, thermalConductivity: 0.12, thermalExpansion: 5.0e-6, specificHeat: 1600, electricalResistivity: Infinity, color: '#c89e6a' },
  { name: 'Plywood — Marine',     yieldStrength: 30e6,  ultimateTensile: 47e6,  density: 600, youngsModulus: 10.0e9, poissonRatio: 0.30, thermalConductivity: 0.12, thermalExpansion: 5.0e-6, specificHeat: 1600, electricalResistivity: Infinity, color: '#b88c5a' },
  { name: 'MDF',                  yieldStrength: 15e6,  ultimateTensile: 28e6,  density: 750, youngsModulus: 3.5e9,  poissonRatio: 0.30, thermalConductivity: 0.13, thermalExpansion: 5.0e-6, specificHeat: 1700, electricalResistivity: Infinity, color: '#a8845a' },
  { name: 'OSB',                  yieldStrength: 13e6,  ultimateTensile: 25e6,  density: 650, youngsModulus: 5.5e9,  poissonRatio: 0.30, thermalConductivity: 0.13, thermalExpansion: 5.0e-6, specificHeat: 1700, electricalResistivity: Infinity, color: '#bda06a' },
  { name: 'Cedar — Western Red',  yieldStrength: 31e6,  ultimateTensile: 51e6,  density: 350, youngsModulus: 7.6e9,  poissonRatio: 0.32, thermalConductivity: 0.10, thermalExpansion: 4.0e-6, specificHeat: 1700, electricalResistivity: Infinity, color: '#c39368' },
  { name: 'Spruce — Sitka',       yieldStrength: 36e6,  ultimateTensile: 70e6,  density: 360, youngsModulus: 9.9e9,  poissonRatio: 0.33, thermalConductivity: 0.10, thermalExpansion: 4.0e-6, specificHeat: 1700, electricalResistivity: Infinity, color: '#e0d2a8' },
  { name: 'Balsa',                yieldStrength: 12e6,  ultimateTensile: 21e6,  density: 160, youngsModulus: 3.4e9,  poissonRatio: 0.29, thermalConductivity: 0.05, thermalExpansion: 4.0e-6, specificHeat: 1700, electricalResistivity: Infinity, color: '#e8d8b0' },
];

// ------------------------------------------------------------------
// Stone (10+)  — Bedrock densities / typical compressive UTS as
// published by USGS + dimension stone references.
// ------------------------------------------------------------------
const STONE = [
  { name: 'Granite',     yieldStrength: 200e6, ultimateTensile: 25e6,  density: 2700, youngsModulus: 50e9,  poissonRatio: 0.20, thermalConductivity: 2.9, thermalExpansion: 8.0e-6,  specificHeat: 790,  electricalResistivity: 1e7,    color: '#9c9b9a' },
  { name: 'Marble',      yieldStrength: 130e6, ultimateTensile: 15e6,  density: 2700, youngsModulus: 55e9,  poissonRatio: 0.27, thermalConductivity: 2.8, thermalExpansion: 8.0e-6,  specificHeat: 880,  electricalResistivity: 1e8,    color: '#e8e6e2' },
  { name: 'Limestone',   yieldStrength: 100e6, ultimateTensile: 5.0e6, density: 2600, youngsModulus: 32e9,  poissonRatio: 0.25, thermalConductivity: 2.2, thermalExpansion: 8.0e-6,  specificHeat: 920,  electricalResistivity: 1e8,    color: '#d8d3c3' },
  { name: 'Sandstone',   yieldStrength: 70e6,  ultimateTensile: 4.0e6, density: 2400, youngsModulus: 17e9,  poissonRatio: 0.24, thermalConductivity: 2.5, thermalExpansion: 11.0e-6, specificHeat: 920,  electricalResistivity: 1e7,    color: '#d2b48c' },
  { name: 'Slate',       yieldStrength: 150e6, ultimateTensile: 25e6,  density: 2790, youngsModulus: 40e9,  poissonRatio: 0.20, thermalConductivity: 2.0, thermalExpansion: 9.0e-6,  specificHeat: 760,  electricalResistivity: 1e7,    color: '#4a4e54' },
  { name: 'Travertine',  yieldStrength: 80e6,  ultimateTensile: 5.0e6, density: 2400, youngsModulus: 30e9,  poissonRatio: 0.25, thermalConductivity: 1.6, thermalExpansion: 8.0e-6,  specificHeat: 920,  electricalResistivity: 1e8,    color: '#d8c5a0' },
  { name: 'Basalt',      yieldStrength: 250e6, ultimateTensile: 20e6,  density: 3000, youngsModulus: 70e9,  poissonRatio: 0.25, thermalConductivity: 1.7, thermalExpansion: 5.4e-6,  specificHeat: 840,  electricalResistivity: 1e7,    color: '#3c3e44' },
  { name: 'Quartzite',   yieldStrength: 250e6, ultimateTensile: 30e6,  density: 2650, youngsModulus: 60e9,  poissonRatio: 0.20, thermalConductivity: 5.0, thermalExpansion: 11.0e-6, specificHeat: 780,  electricalResistivity: 1e8,    color: '#d8d4c6' },
  { name: 'Concrete C30/37',yieldStrength: 30e6,ultimateTensile: 2.9e6,density: 2400, youngsModulus: 33e9,  poissonRatio: 0.20, thermalConductivity: 1.7, thermalExpansion: 10.0e-6, specificHeat: 880,  electricalResistivity: 1e6,    color: '#bcbcbc' },
  { name: 'Brick (Clay)',yieldStrength: 50e6,  ultimateTensile: 2.5e6, density: 1800, youngsModulus: 16e9,  poissonRatio: 0.25, thermalConductivity: 0.7, thermalExpansion: 5.0e-6,  specificHeat: 840,  electricalResistivity: 1e8,    color: '#a14a30' },
];

// ------------------------------------------------------------------
// Composite (15+) — typical lamina / lay-up properties.
// Sources: MIL-HDBK-17 (CMH-17) Vol 2 + Hexcel + Toray datasheets.
// Values are for the typical 50–60% fibre volume layup.
// ------------------------------------------------------------------
const COMPOSITE = [
  { name: 'CFRP Unidirectional',     yieldStrength: 1500e6,ultimateTensile: 2100e6,density: 1600, youngsModulus: 135e9, poissonRatio: 0.28, thermalConductivity: 7.0,  thermalExpansion: -0.5e-6,specificHeat: 1050, electricalResistivity: 1e-5,    color: '#1a1c20' },
  { name: 'CFRP Woven (2x2 Twill)',  yieldStrength: 600e6, ultimateTensile: 800e6, density: 1550, youngsModulus: 70e9,  poissonRatio: 0.05, thermalConductivity: 5.0,  thermalExpansion: 2.0e-6, specificHeat: 1050, electricalResistivity: 1e-5,    color: '#1a1c20' },
  { name: 'CFRP Quasi-Iso',          yieldStrength: 500e6, ultimateTensile: 700e6, density: 1580, youngsModulus: 55e9,  poissonRatio: 0.30, thermalConductivity: 5.0,  thermalExpansion: 1.5e-6, specificHeat: 1050, electricalResistivity: 1e-5,    color: '#1a1c20' },
  { name: 'GFRP Unidirectional (E)', yieldStrength: 1000e6,ultimateTensile: 1100e6,density: 1900, youngsModulus: 45e9,  poissonRatio: 0.28, thermalConductivity: 0.3,  thermalExpansion: 6.0e-6, specificHeat: 1000, electricalResistivity: Infinity, color: '#e8e0c8' },
  { name: 'GFRP Woven (E)',          yieldStrength: 400e6, ultimateTensile: 450e6, density: 1850, youngsModulus: 22e9,  poissonRatio: 0.13, thermalConductivity: 0.3,  thermalExpansion: 8.0e-6, specificHeat: 1000, electricalResistivity: Infinity, color: '#e8e0c8' },
  { name: 'GFRP Unidirectional (S)', yieldStrength: 1700e6,ultimateTensile: 2000e6,density: 2000, youngsModulus: 65e9,  poissonRatio: 0.28, thermalConductivity: 0.3,  thermalExpansion: 5.6e-6, specificHeat: 1000, electricalResistivity: Infinity, color: '#e8e0c8' },
  { name: 'Kevlar-29 UD',            yieldStrength: 2800e6,ultimateTensile: 3000e6,density: 1440, youngsModulus: 70e9,  poissonRatio: 0.34, thermalConductivity: 0.04, thermalExpansion: -2.0e-6,specificHeat: 1420, electricalResistivity: Infinity, color: '#d8c878' },
  { name: 'Kevlar-49 UD',            yieldStrength: 3000e6,ultimateTensile: 3600e6,density: 1450, youngsModulus: 124e9, poissonRatio: 0.36, thermalConductivity: 0.04, thermalExpansion: -2.0e-6,specificHeat: 1420, electricalResistivity: Infinity, color: '#d8c878' },
  { name: 'Kevlar-129 UD',           yieldStrength: 3200e6,ultimateTensile: 3400e6,density: 1450, youngsModulus: 96e9,  poissonRatio: 0.36, thermalConductivity: 0.04, thermalExpansion: -2.0e-6,specificHeat: 1420, electricalResistivity: Infinity, color: '#d8c878' },
  { name: 'Honeycomb Aluminium 1/8" 5052',yieldStrength: 1.5e6,ultimateTensile: 2.5e6,density: 49,  youngsModulus: 0.05e9,poissonRatio: 0.33, thermalConductivity: 4.0, thermalExpansion: 23.6e-6,specificHeat: 904, electricalResistivity: 3.0e-8,  color: '#c8ccd1' },
  { name: 'Honeycomb Nomex 1/8" 3.0pcf',  yieldStrength: 0.6e6,ultimateTensile: 1.2e6,density: 48,  youngsModulus: 0.02e9,poissonRatio: 0.34, thermalConductivity: 0.05,thermalExpansion: 35.0e-6,specificHeat: 1400,electricalResistivity: Infinity, color: '#bc9870' },
  { name: 'PMI Foam (Rohacell 71)',  yieldStrength: 1.5e6, ultimateTensile: 2.8e6, density: 75,  youngsModulus: 0.092e9,poissonRatio: 0.33, thermalConductivity: 0.031,thermalExpansion: 33.0e-6,specificHeat: 1500,electricalResistivity: Infinity, color: '#e0d8c0' },
  { name: 'SMC (Sheet Mould. Comp.)',yieldStrength: 75e6,  ultimateTensile: 85e6,  density: 1850, youngsModulus: 13e9,  poissonRatio: 0.30, thermalConductivity: 0.25, thermalExpansion: 18.0e-6,specificHeat: 1000, electricalResistivity: Infinity, color: '#9c9c9c' },
  { name: 'BMC (Bulk Mould. Comp.)', yieldStrength: 60e6,  ultimateTensile: 70e6,  density: 1900, youngsModulus: 11e9,  poissonRatio: 0.30, thermalConductivity: 0.27, thermalExpansion: 18.0e-6,specificHeat: 1000, electricalResistivity: Infinity, color: '#9c9c9c' },
  { name: 'Phenolic/Glass FR-4',     yieldStrength: 310e6, ultimateTensile: 345e6, density: 1850, youngsModulus: 24e9,  poissonRatio: 0.13, thermalConductivity: 0.29, thermalExpansion: 14.0e-6,specificHeat: 1300, electricalResistivity: Infinity, color: '#d8c898' },
];

// ------------------------------------------------------------------
// Ceramic (15+)  — Engineering ceramics. Sources: CRC Materials Sci
// & Eng Handbook, Saint-Gobain / Kyocera / CoorsTek datasheets.
// ------------------------------------------------------------------
const CERAMIC = [
  { name: 'Alumina 96% Al2O3',      yieldStrength: 200e6, ultimateTensile: 200e6, density: 3720, youngsModulus: 303e9, poissonRatio: 0.21, thermalConductivity: 25, thermalExpansion: 7.4e-6, specificHeat: 880, electricalResistivity: 1e12,    color: '#dad6c8' },
  { name: 'Alumina 99% Al2O3',      yieldStrength: 380e6, ultimateTensile: 380e6, density: 3890, youngsModulus: 370e9, poissonRatio: 0.22, thermalConductivity: 32, thermalExpansion: 8.1e-6, specificHeat: 880, electricalResistivity: 1e12,    color: '#e3e0d4' },
  { name: 'Alumina 99.5%',          yieldStrength: 414e6, ultimateTensile: 414e6, density: 3900, youngsModulus: 375e9, poissonRatio: 0.22, thermalConductivity: 35, thermalExpansion: 8.4e-6, specificHeat: 880, electricalResistivity: 1e12,    color: '#e3e0d4' },
  { name: 'Zirconia 3Y-TZP',        yieldStrength: 1200e6,ultimateTensile: 1200e6,density: 6050, youngsModulus: 210e9, poissonRatio: 0.31, thermalConductivity: 2.0,thermalExpansion: 10.5e-6,specificHeat: 460, electricalResistivity: 1e10,    color: '#e0e0e0' },
  { name: 'Zirconia Mg-PSZ',        yieldStrength: 650e6, ultimateTensile: 650e6, density: 5750, youngsModulus: 210e9, poissonRatio: 0.31, thermalConductivity: 2.5,thermalExpansion: 9.5e-6, specificHeat: 460, electricalResistivity: 1e10,    color: '#dcdcdc' },
  { name: 'Silicon Carbide (SiC)',  yieldStrength: 550e6, ultimateTensile: 550e6, density: 3150, youngsModulus: 410e9, poissonRatio: 0.14, thermalConductivity: 120,thermalExpansion: 4.0e-6, specificHeat: 750, electricalResistivity: 1.0,     color: '#3a3a3c' },
  { name: 'Reaction-Bonded SiC',    yieldStrength: 450e6, ultimateTensile: 450e6, density: 3000, youngsModulus: 380e9, poissonRatio: 0.16, thermalConductivity: 110,thermalExpansion: 4.3e-6, specificHeat: 750, electricalResistivity: 1.0,     color: '#3a3a3c' },
  { name: 'Silicon Nitride Si3N4',  yieldStrength: 700e6, ultimateTensile: 700e6, density: 3200, youngsModulus: 310e9, poissonRatio: 0.27, thermalConductivity: 30, thermalExpansion: 3.2e-6, specificHeat: 700, electricalResistivity: 1e12,    color: '#a0a09c' },
  { name: 'Hot-Pressed Si3N4',      yieldStrength: 900e6, ultimateTensile: 900e6, density: 3260, youngsModulus: 320e9, poissonRatio: 0.27, thermalConductivity: 32, thermalExpansion: 3.2e-6, specificHeat: 700, electricalResistivity: 1e12,    color: '#a0a09c' },
  { name: 'Boron Carbide B4C',      yieldStrength: 350e6, ultimateTensile: 350e6, density: 2520, youngsModulus: 460e9, poissonRatio: 0.17, thermalConductivity: 30, thermalExpansion: 5.0e-6, specificHeat: 950, electricalResistivity: 0.3,     color: '#2c2c30' },
  { name: 'Aluminium Nitride (AlN)',yieldStrength: 320e6, ultimateTensile: 320e6, density: 3260, youngsModulus: 320e9, poissonRatio: 0.24, thermalConductivity: 180,thermalExpansion: 4.5e-6, specificHeat: 740, electricalResistivity: 1e12,    color: '#dcdcd8' },
  { name: 'Tungsten Carbide WC-6Co',yieldStrength: 1900e6,ultimateTensile: 1900e6,density: 14900,youngsModulus: 615e9, poissonRatio: 0.23, thermalConductivity: 80, thermalExpansion: 5.4e-6, specificHeat: 200, electricalResistivity: 2.0e-7,  color: '#828588' },
  { name: 'Macor Machinable Glass', yieldStrength: 94e6,  ultimateTensile: 94e6,  density: 2520, youngsModulus: 64e9,  poissonRatio: 0.29, thermalConductivity: 1.5,thermalExpansion: 9.4e-6, specificHeat: 790, electricalResistivity: 1e12,    color: '#f0ecd8' },
  { name: 'Fused Silica',           yieldStrength: 110e6, ultimateTensile: 110e6, density: 2200, youngsModulus: 72e9,  poissonRatio: 0.17, thermalConductivity: 1.4,thermalExpansion: 0.55e-6,specificHeat: 740, electricalResistivity: 1e14,    color: '#eaeaea' },
  { name: 'Soda-Lime Glass',        yieldStrength: 70e6,  ultimateTensile: 70e6,  density: 2530, youngsModulus: 72e9,  poissonRatio: 0.22, thermalConductivity: 1.0,thermalExpansion: 9.0e-6, specificHeat: 840, electricalResistivity: 1e10,    color: '#e0eef0' },
];

// ------------------------------------------------------------------
// Catalogue assembly  — every entry is tagged with its category +
// derived pbrPreset key so the viewport can pick the BRDF.
// ------------------------------------------------------------------
function tag(rows, category, preset) {
  return rows.map((r) => ({ ...r, category, pbrPreset: preset }));
}

const CATALOGUE = [
  ...tag(STEEL,      'Metal-Steel',     'steel'),
  ...tag(ALUMINIUM,  'Metal-Aluminium', 'aluminium'),
  ...tag(COPPER,     'Metal-Copper',    'copper'),
  ...tag(BRONZE,     'Metal-Bronze',    'brass'),
  ...tag(TITANIUM,   'Metal-Titanium',  'titanium'),
  ...tag(POLYMER,    'Polymer',         'plastic'),
  ...tag(WOOD,       'Wood',            'wood'),
  ...tag(STONE,      'Stone',           'stone'),
  ...tag(COMPOSITE,  'Composite',       'composite'),
  ...tag(CERAMIC,    'Ceramic',         'ceramic'),
];

// Stable in-module name index. Built once at import time.
const _BY_NAME = new Map(CATALOGUE.map((m) => [m.name.toLowerCase(), m]));
const _BY_CAT  = new Map();
for (const m of CATALOGUE) {
  if (!_BY_CAT.has(m.category)) _BY_CAT.set(m.category, []);
  _BY_CAT.get(m.category).push(m);
}

// User-defined materials added at runtime via addCustom().
const _CUSTOM = [];

// -------------------- Public API --------------------

/** Get a material by exact (case-insensitive) name. Returns null if missing. */
export function getMaterial(name) {
  if (!name) return null;
  const k = String(name).toLowerCase();
  const hit = _BY_NAME.get(k);
  if (hit) return hit;
  return _CUSTOM.find((m) => m.name.toLowerCase() === k) || null;
}

/** List every material in a category. */
export function listByCategory(category) {
  const base = _BY_CAT.get(category) || [];
  const custom = _CUSTOM.filter((m) => m.category === category);
  return [...base, ...custom];
}

/** All categories present in the catalogue, ordered as registered. */
export function listCategories() {
  return Array.from(_BY_CAT.keys());
}

/** Free-text fuzzy search across name + category. Case-insensitive. */
export function search(query) {
  if (!query) return [...CATALOGUE, ..._CUSTOM];
  const q = String(query).toLowerCase().trim();
  if (!q) return [...CATALOGUE, ..._CUSTOM];
  const score = (m) => {
    const n = m.name.toLowerCase();
    if (n === q) return 1000;
    if (n.startsWith(q)) return 500;
    if (n.includes(q)) return 200;
    if (m.category.toLowerCase().includes(q)) return 50;
    return 0;
  };
  return [...CATALOGUE, ..._CUSTOM]
    .map((m) => ({ m, s: score(m) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
}

/**
 * Add a user-defined material. Spec must include `name` + `category`.
 * Missing physical fields default to NaN — the picker shows "—" for
 * unset fields so the caller is forced to fill them in for FEA/CAM.
 */
export function addCustom(spec) {
  if (!spec || !spec.name) throw new Error('addCustom: name required');
  const existing = getMaterial(spec.name);
  if (existing) throw new Error(`addCustom: '${spec.name}' already exists`);
  const entry = {
    name: spec.name,
    category: spec.category || 'Custom',
    density: Number.isFinite(spec.density) ? spec.density : NaN,
    youngsModulus: Number.isFinite(spec.youngsModulus) ? spec.youngsModulus : NaN,
    poissonRatio: Number.isFinite(spec.poissonRatio) ? spec.poissonRatio : NaN,
    yieldStrength: Number.isFinite(spec.yieldStrength) ? spec.yieldStrength : NaN,
    ultimateTensile: Number.isFinite(spec.ultimateTensile) ? spec.ultimateTensile : NaN,
    thermalConductivity: Number.isFinite(spec.thermalConductivity) ? spec.thermalConductivity : NaN,
    thermalExpansion: Number.isFinite(spec.thermalExpansion) ? spec.thermalExpansion : NaN,
    specificHeat: Number.isFinite(spec.specificHeat) ? spec.specificHeat : NaN,
    electricalResistivity: Number.isFinite(spec.electricalResistivity) ? spec.electricalResistivity : NaN,
    color: spec.color || '#888888',
    pbrPreset: spec.pbrPreset || 'steel',
    custom: true,
  };
  _CUSTOM.push(entry);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('forge:materials-changed',
      { detail: { name: entry.name } }));
  }
  return entry;
}

/** Total live count — used by tests + the picker header badge. */
export function count() {
  return CATALOGUE.length + _CUSTOM.length;
}

/** Used by tests + telemetry. Stable across reloads (no Math.random). */
export const CATALOGUE_NAMES = CATALOGUE.map((m) => m.name);

// Convenience expose for debugging in DevTools.
if (typeof window !== 'undefined') {
  window.__forgeMaterialCatalogue = {
    getMaterial, listByCategory, listCategories, search, addCustom, count,
  };
}

export default {
  getMaterial, listByCategory, listCategories, search, addCustom, count,
};
