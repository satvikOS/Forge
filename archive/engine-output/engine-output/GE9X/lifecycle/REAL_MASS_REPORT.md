# GE9X Real Mass Audit (from B-Rep geometry)

Generated: 2026-05-09T19:14:10.674Z

## Summary

| Metric | Value |
|--------|-------|
| Components with valid solids | 29,693 / 29,693 |
| **Computed total mass** | **9,898 kg** |
| Published GE9X dry mass | 10,012 kg |
| Ratio | 0.989× spec |
| Total volume | 3.494 m³ |

This number comes from `solid.massProperties(material_density).mass` for
every registered component, summed. Replaces the previous hardcoded
per-category mass estimates.

## By category

| Category | Count | Mass (kg) | Volume (m³) |
|----------|-------|-----------|-------------|
| NAC | 25 | 2,851.1 | 1.7584 |
| FAN | 143 | 1,894.4 | 0.689 |
| LPT | 1489 | 988.6 | 0.1207 |
| HPC | 1677 | 631.6 | 0.0953 |
| MNT | 211 | 626.5 | 0.2136 |
| TRV | 16 | 572.9 | 0.1259 |
| SHFT | 6 | 366.8 | 0.0467 |
| HPT | 10989 | 262.1 | 0.0307 |
| LPC | 394 | 251.1 | 0.0567 |
| FIRE | 62 | 197.8 | 0.0252 |
| COMB | 12066 | 166.4 | 0.0386 |
| INLE | 18 | 162.4 | 0.1014 |
| EXH | 14 | 154.3 | 0.0188 |
| ELEC | 404 | 137.8 | 0.0191 |
| OIL | 27 | 125.9 | 0.0441 |
| AGB | 32 | 97.5 | 0.0236 |
| FUEL | 38 | 86 | 0.0294 |
| AIR | 20 | 83 | 0.0101 |
| BRG | 126 | 73.8 | 0.0094 |
| FADE | 110 | 42.6 | 0.0103 |
| STR | 130 | 42.1 | 0.0156 |
| HYD | 36 | 32.6 | 0.0041 |
| PIP | 320 | 27.6 | 0.0035 |
| FAS | 1296 | 11 | 0.0014 |
| IGN | 4 | 7.3 | 0.0018 |
| DRN | 40 | 4.9 | 0.001 |

## By material

| Material | Count | Mass (kg) |
|----------|-------|-----------|
| Composite Carbon-Epoxy | 99 | 3,744 |
| Titanium Ti-6Al-4V | 1653 | 2,599.3 |
| Inconel 718 | 2026 | 1,851.1 |
| Steel AISI 4340 | 1499 | 783.3 |
| Aluminum 6061-T6 | 558 | 412.1 |
| Single-Crystal Nickel CMSX-4 | 182 | 186.2 |
| Copper C11000 | 226 | 127.2 |
| Stainless Steel 316 | 598 | 107.8 |
| CMC SiC/SiC | 119 | 73.7 |
| ABS Plastic | 1 | 13.4 |
| Air | 22600 | 0 |
| Single-Crystal Nickel CMSX-4 (TBC-coated) | 120 | 0 |
| Carbon Fiber Composite | 12 | 0 |

## Top 20 heaviest single components

| Part ID | Name | Mass (kg) | Material |
|---------|------|-----------|----------|
| GE9X-FAN-DSK-0001 | Fan Disk | 827.3 | Titanium Ti-6Al-4V |
| GE9X-FAN-CSG-0001 | Fan Case (Composite) | 516.5 | Composite Carbon-Epoxy |
| GE9X-LPT-CSG-0001 | LPT Casing | 252.6 | Inconel 718 |
| GE9X-NAC-FCW-0001 | Fan Cowl Segment 1 | 202.2 | Composite Carbon-Epoxy |
| GE9X-NAC-FCW-0002 | Fan Cowl Segment 2 | 199.3 | Composite Carbon-Epoxy |
| GE9X-NAC-FCW-0003 | Fan Cowl Segment 3 | 196.5 | Composite Carbon-Epoxy |
| GE9X-NAC-FCW-0004 | Fan Cowl Segment 4 | 193.7 | Composite Carbon-Epoxy |
| GE9X-MNT-PYL-0001 | Pylon Stub Fairing | 192 | Composite Carbon-Epoxy |
| GE9X-NAC-FCW-0005 | Fan Cowl Segment 5 | 190.9 | Composite Carbon-Epoxy |
| GE9X-NAC-FCW-0006 | Fan Cowl Segment 6 | 188 | Composite Carbon-Epoxy |
| GE9X-NAC-FCW-0007 | Fan Cowl Segment 7 | 185.2 | Composite Carbon-Epoxy |
| GE9X-NAC-FCW-0008 | Fan Cowl Segment 8 | 182.4 | Composite Carbon-Epoxy |
| GE9X-NAC-FCW-0009 | Fan Cowl Segment 9 | 179.5 | Composite Carbon-Epoxy |
| GE9X-NAC-FCW-0010 | Fan Cowl Segment 10 | 176.7 | Composite Carbon-Epoxy |
| GE9X-MNT-AFT-0001 | Aft Engine Mount | 174.4 | Titanium Ti-6Al-4V |
| GE9X-NAC-FCW-0011 | Fan Cowl Segment 11 | 173.9 | Composite Carbon-Epoxy |
| GE9X-LPT-DSK-0006 | LPT S6 Disk | 173.4 | Inconel 718 |
| GE9X-SHFT-LP-0001 | LP Shaft | 172.6 | Steel AISI 4340 |
| GE9X-NAC-FCW-0012 | Fan Cowl Segment 12 | 171.1 | Composite Carbon-Epoxy |
| GE9X-INLE-SPN-0001 | Fan Spinner Cone | 162.3 | Composite Carbon-Epoxy |
