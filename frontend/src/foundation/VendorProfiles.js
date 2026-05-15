/**
 * ArchDisc Foundation — Vendor profiles.
 *
 * A small catalogue of representative rate cards customers use
 * when bidding the same design to multiple shops. Each profile
 * overrides the AssemblyCost / VendorPackage defaults so a user
 * gets comparable quotes for one geometry in one click.
 *
 * Rates are illustrative — drawn from 2024 industry benchmarks
 * for small-batch (≤ 50 parts) machined aluminium. Production
 * users should override per their actual vendor quotes; this
 * module is the API surface, not the price book.
 *
 * Shape:
 *   {
 *     id, name, location, currency,
 *     materialDefault,
 *     materialRate_per_kg, cncRate_per_hr,
 *     setupPerPart, finishPerPart, margin,
 *     leadTimeDays, notes,
 *   }
 */

export const VENDOR_PROFILES = [
  {
    id: 'archdisc-default',
    name: 'ArchDisc Default',
    location: '—',
    currency: 'USD',
    materialDefault: 'Aluminum 6061-T6',
    materialRate_per_kg: 4.5,
    cncRate_per_hr: 90,
    setupPerPart: 30,
    finishPerPart: 5,
    margin: 0.25,
    leadTimeDays: 14,
    notes: 'House defaults — Western mid-tier benchmark.',
  },
  {
    id: 'bangalore-cnc',
    name: 'Bangalore CNC (low-rate)',
    location: 'Bangalore, IN',
    currency: 'USD',
    materialDefault: 'Aluminum 6061-T6',
    materialRate_per_kg: 4.0,
    cncRate_per_hr: 35,
    setupPerPart: 20,
    finishPerPart: 3,
    margin: 0.20,
    leadTimeDays: 21,
    notes: 'Indian sub-contractor; cheaper rates, longer lead time + freight.',
  },
  {
    id: 'mexico-city-tier1',
    name: 'Mexico City Tier-1',
    location: 'Mexico City, MX',
    currency: 'USD',
    materialDefault: 'Aluminum 6061-T6',
    materialRate_per_kg: 4.5,
    cncRate_per_hr: 65,
    setupPerPart: 25,
    finishPerPart: 4,
    margin: 0.22,
    leadTimeDays: 10,
    notes: 'NAFTA-region, shorter lead time, USMCA origin certification.',
  },
  {
    id: 'usa-premium-cmm',
    name: 'USA Premium (CMM-inspected)',
    location: 'Ohio, US',
    currency: 'USD',
    materialDefault: 'Aluminum 7075-T651',
    materialRate_per_kg: 9.0,
    cncRate_per_hr: 165,
    setupPerPart: 60,
    finishPerPart: 12,
    margin: 0.30,
    leadTimeDays: 7,
    notes: 'ITAR-eligible, CMM inspection included, ISO 9001 + AS9100.',
  },
  {
    id: 'shenzhen-prototyping',
    name: 'Shenzhen Prototyping (fast turn)',
    location: 'Shenzhen, CN',
    currency: 'USD',
    materialDefault: 'Aluminum 6061-T6',
    materialRate_per_kg: 4.2,
    cncRate_per_hr: 45,
    setupPerPart: 22,
    finishPerPart: 3,
    margin: 0.18,
    leadTimeDays: 5,
    notes: '5-day turn, 1-5 units. Ideal for early prototypes.',
  },
];

/** O(1) lookup by id. */
export const PROFILE_BY_ID = Object.fromEntries(VENDOR_PROFILES.map(p => [p.id, p]));

/** Find a profile by id; returns the default if missing. */
export function findVendorProfile(id) {
  return PROFILE_BY_ID[id] ?? VENDOR_PROFILES[0];
}

/**
 * Convert a vendor profile into the opts object that
 * rollupAssemblyCost accepts. Keeps the cost rollup module
 * profile-agnostic.
 */
export function profileToCostOpts(profile) {
  return {
    materialRate_per_kg: profile.materialRate_per_kg,
    cncRate_per_hr:      profile.cncRate_per_hr,
    setupPerPart:        profile.setupPerPart,
    finishPerPart:       profile.finishPerPart,
    margin:              profile.margin,
  };
}
