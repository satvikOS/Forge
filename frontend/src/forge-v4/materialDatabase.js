// Forge-219 — material properties database.
//
// SI units throughout: E [Pa], ν [—], ρ [kg/m³], σ_y, σ_u [Pa],
// α [1/K], k [W/(m·K)], Cp [J/(kg·K)].
//
// Properties are nominal "typical-of-class" values from Shigley,
// MMPDS-14, ASM Handbook Vol. 1-2, manufacturers' datasheets. Real
// engineering work should cite + reduce by knock-down factors against
// part-specific test data.

export const MATERIALS = [
  // ----- ferrous -----
  { id: 'steel-1018',     name: '1018 mild steel',        category: 'steel',
    E: 200e9, nu: 0.29, density: 7870, yield: 370e6,  ultimate: 440e6,
    alpha: 11.7e-6, k: 51.9, Cp: 486 },
  { id: 'steel-1045',     name: '1045 medium carbon',     category: 'steel',
    E: 205e9, nu: 0.29, density: 7860, yield: 530e6,  ultimate: 625e6,
    alpha: 11.6e-6, k: 49.8, Cp: 486 },
  { id: 'steel-4140',     name: '4140 alloy steel',       category: 'steel',
    E: 205e9, nu: 0.29, density: 7850, yield: 655e6,  ultimate: 950e6,
    alpha: 12.3e-6, k: 42.6, Cp: 473 },
  { id: 'steel-4340',     name: '4340 alloy steel',       category: 'steel',
    E: 205e9, nu: 0.29, density: 7850, yield: 855e6,  ultimate: 965e6,
    alpha: 12.3e-6, k: 42.7, Cp: 475 },
  { id: 'steel-304ss',    name: '304 stainless',          category: 'steel',
    E: 193e9, nu: 0.29, density: 8000, yield: 215e6,  ultimate: 505e6,
    alpha: 17.3e-6, k: 16.2, Cp: 500 },
  { id: 'steel-316ss',    name: '316 stainless',          category: 'steel',
    E: 193e9, nu: 0.29, density: 8000, yield: 290e6,  ultimate: 580e6,
    alpha: 16.0e-6, k: 16.3, Cp: 500 },
  // ----- non-ferrous -----
  { id: 'al-6061-t6',     name: '6061-T6 aluminium',      category: 'aluminium',
    E: 68.9e9, nu: 0.33, density: 2700, yield: 276e6, ultimate: 310e6,
    alpha: 23.6e-6, k: 167, Cp: 896 },
  { id: 'al-7075-t6',     name: '7075-T6 aluminium',      category: 'aluminium',
    E: 71.7e9, nu: 0.33, density: 2810, yield: 503e6, ultimate: 572e6,
    alpha: 23.4e-6, k: 130, Cp: 960 },
  { id: 'al-2024-t3',     name: '2024-T3 aluminium',      category: 'aluminium',
    E: 73.1e9, nu: 0.33, density: 2780, yield: 345e6, ultimate: 483e6,
    alpha: 23.2e-6, k: 121, Cp: 875 },
  { id: 'ti-6al4v',       name: 'Ti-6Al-4V (Grade 5)',    category: 'titanium',
    E: 113.8e9, nu: 0.342, density: 4430, yield: 880e6, ultimate: 950e6,
    alpha: 8.6e-6, k: 6.7, Cp: 526 },
  { id: 'cu-c10100',      name: 'Copper C10100',          category: 'copper',
    E: 117e9, nu: 0.34, density: 8940, yield: 70e6,  ultimate: 220e6,
    alpha: 17.0e-6, k: 391, Cp: 385 },
  { id: 'brass-c26000',   name: 'Brass C26000 (cartridge)', category: 'copper',
    E: 110e9, nu: 0.33, density: 8530, yield: 124e6, ultimate: 303e6,
    alpha: 19.9e-6, k: 120, Cp: 375 },
  // ----- polymers -----
  { id: 'abs',            name: 'ABS',                    category: 'polymer',
    E: 2.3e9, nu: 0.35, density: 1050, yield: 41e6, ultimate: 45e6,
    alpha: 75e-6, k: 0.17, Cp: 1390 },
  { id: 'pla',            name: 'PLA (3D-print)',         category: 'polymer',
    E: 3.5e9, nu: 0.36, density: 1240, yield: 50e6, ultimate: 53e6,
    alpha: 68e-6, k: 0.13, Cp: 1800 },
  { id: 'nylon-66',       name: 'Nylon 6/6',              category: 'polymer',
    E: 2.7e9, nu: 0.39, density: 1140, yield: 70e6, ultimate: 82e6,
    alpha: 80e-6, k: 0.25, Cp: 1700 },
  { id: 'peek',           name: 'PEEK',                   category: 'polymer',
    E: 3.6e9, nu: 0.39, density: 1320, yield: 100e6, ultimate: 110e6,
    alpha: 47e-6, k: 0.25, Cp: 1340 },
  // ----- ceramics -----
  { id: 'alumina',        name: 'Alumina (Al₂O₃)',         category: 'ceramic',
    E: 370e9, nu: 0.22, density: 3950, yield: 300e6, ultimate: 300e6,
    alpha: 8.1e-6, k: 30, Cp: 880 },
  { id: 'zirconia',       name: 'Zirconia (ZrO₂)',         category: 'ceramic',
    E: 200e9, nu: 0.30, density: 6080, yield: 1000e6, ultimate: 1000e6,
    alpha: 10.3e-6, k: 2.7, Cp: 460 },
];

export const CATEGORIES = Array.from(new Set(MATERIALS.map((m) => m.category))).sort();

export function lookup(id) {
  return MATERIALS.find((m) => m.id === id) ?? null;
}

export function search(query) {
  if (!query) return MATERIALS;
  const q = String(query).toLowerCase();
  return MATERIALS.filter((m) =>
    m.id.includes(q) || m.name.toLowerCase().includes(q) || m.category.includes(q));
}

export function fmtPa(v) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} GPa`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)} MPa`;
  return `${v.toFixed(0)} Pa`;
}

export function fmtAlpha(v) {
  return `${(v * 1e6).toFixed(1)} µε/K`;
}
