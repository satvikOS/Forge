/**
 * ArchDisc Foundation — true display colour by material.
 *
 * A part should look like what it is: a steel gear grey, a brass wheel
 * golden, a sapphire crystal pale blue. This maps a material name to a
 * representative true colour; an unknown / unspecified material falls
 * back to neutral metal so nothing is forced into a single accent.
 */

const PALETTE = [
  ['stainless', 0xb6bcc4],
  ['steel', 0x8f96a0],
  ['aluminium', 0xcdd2d8], ['aluminum', 0xcdd2d8],
  ['brass', 0xc8a93f],
  ['bronze', 0xb0894e],
  ['copper', 0xb5703a],
  ['gold', 0xd6b53c],
  ['titanium', 0x8b8d96],
  ['inconel', 0x9a9ba6], ['nickel', 0xb3b4ba], ['cmsx', 0x9a9ba6],
  ['sapphire', 0xaecbe8], ['crystal', 0xc2d8ec], ['glass', 0xc2d8ec],
  ['ruby', 0xb83b46], ['jewel', 0xb83b46],
  ['carbon', 0x2c2f35], ['composite', 0x33363c],
  ['plastic', 0x3a3f47], ['nylon', 0x4a4f57], ['abs', 0x3a3f47],
  ['rubber', 0x24262b],
];

const NEUTRAL = 0x9aa3ad;

/** Map a material name (substring-matched) to a true display colour. */
export function materialColor(name) {
  if (name == null) return NEUTRAL;
  const q = String(name).toLowerCase();
  for (const [key, col] of PALETTE) {
    if (q.includes(key)) return col;
  }
  return NEUTRAL;
}

export { NEUTRAL as neutralColor };
