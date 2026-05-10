%
( ArchDisc Foundation CAM — Drilled-plate test )
( generated 2026-05-10T08:53:36 )
G21 ( mm )
G17 ( XY plane )
G90 ( absolute )
G94 ( feed per min )
G54 ( WCS 1 )
G40 ( cancel cutter comp )
G49 ( cancel tool length offset )
M5  ( spindle off )

( --- DRILL 4 holes, Ø4.98 HSS drill --- )
T1 M6 ( load tool 1: Ø4.98 HSS drill )
S1500 M3
G0 Z11.00
G0 X15.000 Y15.000
G81 X15.000 Y15.000 Z-6.000 R2.00 F100
G0 X85.000 Y15.000
G81 X85.000 Y15.000 Z-6.000 R2.00 F100
G0 X85.000 Y45.000
G81 X85.000 Y45.000 Z-6.000 R2.00 F100
G0 X15.000 Y45.000
G81 X15.000 Y45.000 Z-6.000 R2.00 F100
G80
M5

( --- CONTOUR mill outer profile, 5 pts, 3 passes, Ø6 carbide end-mill --- )
T2 M6 ( load tool 2: Ø6 carbide end-mill )
S3000 M3
G0 Z11.00
G0 X0.000 Y0.000
( --- pass 1, z = -2.00 mm --- )
G1 Z-2.000 F150
G1 X100.000 Y0.000 F600
G1 X100.000 Y60.000 F600
G1 X0.000 Y60.000 F600
G1 X0.000 Y0.000 F600
G1 X0.000 Y0.000 F600
( --- pass 2, z = -4.00 mm --- )
G1 Z-4.000 F150
G1 X100.000 Y0.000 F600
G1 X100.000 Y60.000 F600
G1 X0.000 Y60.000 F600
G1 X0.000 Y0.000 F600
G1 X0.000 Y0.000 F600
( --- pass 3, z = -6.00 mm --- )
G1 Z-6.000 F150
G1 X100.000 Y0.000 F600
G1 X100.000 Y60.000 F600
G1 X0.000 Y60.000 F600
G1 X0.000 Y0.000 F600
G1 X0.000 Y0.000 F600
G0 Z11.00
M5

G0 Z25 ( safe retract )
M5
M30 ( program end )
%