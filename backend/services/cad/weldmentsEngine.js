/**
 * Weldments Engine - Structural Frame Design with Welding
 * Handles standard profiles, mitering, cut lists, and weld specifications
 */

class WeldmentsEngine {
    constructor() {
        this.profileLibrary = this.initializeProfiles();
        this.weldSymbols = this.initializeWeldSymbols();
    }

    /**
     * Initialize standard profile library (ISO, ANSI, DIN)
     */
    initializeProfiles() {
        return {
            // Square tube profiles
            square: {
                'ISO_40x40x2': { width: 40, height: 40, thickness: 2, standard: 'ISO' },
                'ISO_50x50x3': { width: 50, height: 50, thickness: 3, standard: 'ISO' },
                'ANSI_2x2x0.125': { width: 50.8, height: 50.8, thickness: 3.175, standard: 'ANSI' }
            },
            // Rectangular tube
            rectangular: {
                'ISO_60x40x3': { width: 60, height: 40, thickness: 3, standard: 'ISO' },
                'ANSI_3x2x0.125': { width: 76.2, height: 50.8, thickness: 3.175, standard: 'ANSI' }
            },
            // Round tube
            round: {
                'ISO_42.4x2.6': { diameter: 42.4, thickness: 2.6, standard: 'ISO' },
                'ANSI_2_SCH40': { diameter: 60.3, thickness: 3.9, standard: 'ANSI' }
            },
            // I-Beam
            ibeam: {
                'ISO_HEA_100': { height: 96, width: 100, webThickness: 5, flangeThickness: 8, standard: 'ISO' },
                'ANSI_W8x10': { height: 203, width: 101, webThickness: 5.8, flangeThickness: 8.0, standard: 'ANSI' }
            },
            // C-Channel
            channel: {
                'ISO_UPN_80': { height: 80, width: 45, webThickness: 6, flangeThickness: 8, standard: 'ISO' },
                'ANSI_C6x8.2': { height: 152, width: 51, webThickness: 6.1, flangeThickness: 8.7, standard: 'ANSI' }
            },
            // Angle (L-profile)
            angle: {
                'ISO_L_50x50x5': { leg1: 50, leg2: 50, thickness: 5, standard: 'ISO' },
                'ANSI_L_2x2x0.25': { leg1: 50.8, leg2: 50.8, thickness: 6.35, standard: 'ANSI' }
            }
        };
    }

    /**
     * Initialize weld symbol library
     */
    initializeWeldSymbols() {
        return {
            fillet: { symbol: '△', description: 'Fillet weld' },
            groove: { symbol: '∨', description: 'V-groove weld' },
            slot: { symbol: '□', description: 'Slot weld' },
            plug: { symbol: '○', description: 'Plug weld' },
            spot: { symbol: '●', description: 'Spot weld' },
            seam: { symbol: '◐', description: 'Seam weld' },
            backing: { symbol: '▭', description: 'Backing weld' }
        };
    }

    /**
     * Create structural frame from 3D sketch path
     */
    createStructuralFrame(sketchPath, profileType, profileSize) {
        const frame = {
            id: `weldment_${Date.now()}`,
            type: 'structural_frame',
            path: sketchPath,
            profile: this.getProfile(profileType, profileSize),
            segments: [],
            joints: [],
            cutList: null,
            totalLength: 0,
            totalWeight: 0
        };

        // Process sketch path into segments
        frame.segments = this.generateSegments(sketchPath, frame.profile);

        // Auto-detect and create joints
        frame.joints = this.detectJoints(frame.segments);

        // Auto-miter corners
        frame.joints = frame.joints.map(joint => this.autoMiter(joint, frame.profile));

        // Calculate totals
        frame.totalLength = this.calculateTotalLength(frame.segments);
        frame.totalWeight = this.calculateWeight(frame.totalLength, frame.profile);

        return frame;
    }

    /**
     * Get profile from library
     */
    getProfile(type, size) {
        if (!this.profileLibrary[type] || !this.profileLibrary[type][size]) {
            throw new Error(`Profile ${type}/${size} not found in library`);
        }

        return {
            type: type,
            size: size,
            ...this.profileLibrary[type][size]
        };
    }

    /**
     * Generate frame segments from sketch path
     */
    generateSegments(sketchPath, profile) {
        const segments = [];

        for (let i = 0; i < sketchPath.lines.length; i++) {
            const line = sketchPath.lines[i];

            segments.push({
                id: `segment_${i}`,
                start: line.start,
                end: line.end,
                length: this.calculateLength(line.start, line.end),
                profile: profile,
                cutAngleStart: 90, // Default square cut, will be updated by mitering
                cutAngleEnd: 90,
                rotation: 0 // Profile rotation along path
            });
        }

        return segments;
    }

    /**
     * Detect joints between segments
     */
    detectJoints(segments) {
        const joints = [];
        const tolerance = 0.001; // mm

        for (let i = 0; i < segments.length; i++) {
            for (let j = i + 1; j < segments.length; j++) {
                const seg1 = segments[i];
                const seg2 = segments[j];

                // Check if segments share a point (joint)
                if (this.pointsEqual(seg1.end, seg2.start, tolerance)) {
                    joints.push({
                        id: `joint_${joints.length}`,
                        type: 'end_to_end',
                        segment1: seg1.id,
                        segment2: seg2.id,
                        position: seg1.end,
                        angle: this.calculateAngle(seg1, seg2),
                        miterType: null, // Will be set by auto-miter
                        welds: []
                    });
                }
                // Check T-joint (end touches middle)
                else if (this.pointOnLine(seg2.start, seg1.start, seg1.end, tolerance) ||
                    this.pointOnLine(seg2.end, seg1.start, seg1.end, tolerance)) {
                    joints.push({
                        id: `joint_${joints.length}`,
                        type: 't_joint',
                        segment1: seg1.id,
                        segment2: seg2.id,
                        position: seg2.start,
                        angle: 90, // T-joints are typically 90 degrees
                        miterType: 'cope',
                        welds: []
                    });
                }
            }
        }

        return joints;
    }

    /**
     * Auto-miter joint based on angle
     */
    autoMiter(joint, profile) {
        const angle = joint.angle;

        if (angle >= 170 && angle <= 190) {
            // Near 180 degrees - butt joint
            joint.miterType = 'butt';
        } else if (angle >= 85 && angle <= 95) {
            // Near 90 degrees - miter
            joint.miterType = 'miter_45';
        } else if (angle < 85) {
            // Acute angle - custom miter
            joint.miterType = 'custom_miter';
            joint.miterAngle = angle / 2;
        } else {
            // Obtuse angle
            joint.miterType = 'custom_miter';
            joint.miterAngle = (180 - angle) / 2;
        }

        // Calculate cut angles for segments
        if (joint.miterType.includes('miter')) {
            const cutAngle = 90 - (joint.miterAngle || 45);
            // Update segment cut angles at this joint
            // (would update actual segment objects in full implementation)
        }

        return joint;
    }

    /**
     * Add weld to joint
     */
    addWeld(frame, jointId, weldType, options = {}) {
        const joint = frame.joints.find(j => j.id === jointId);
        if (!joint) {
            throw new Error(`Joint ${jointId} not found`);
        }

        const weld = {
            id: `weld_${Date.now()}`,
            type: weldType, // fillet, groove, spot, etc.
            symbol: this.weldSymbols[weldType]?.symbol || '?',
            size: options.size || 5, // Weld size in mm
            length: options.length || null, // Intermittent weld length
            pitch: options.pitch || null, // Intermittent weld spacing
            allAround: options.allAround || false,
            fieldWeld: options.fieldWeld || false,
            contour: options.contour || 'flat' // flat, convex, concave
        };

        joint.welds.push(weld);

        return weld;
    }

    /**
     * Generate cut list for manufacturing
     */
    generateCutList(frame) {
        const cutList = {
            id: `cutlist_${frame.id}`,
            frameId: frame.id,
            items: [],
            summary: {
                totalParts: 0,
                totalLength: 0,
                totalWeight: 0,
                profileBreakdown: {}
            }
        };

        // Group segments by profile type
        const profileGroups = {};

        for (const segment of frame.segments) {
            const key = `${segment.profile.type}_${segment.profile.size}`;

            if (!profileGroups[key]) {
                profileGroups[key] = {
                    profile: segment.profile,
                    items: []
                };
            }

            profileGroups[key].items.push({
                segmentId: segment.id,
                length: segment.length,
                cutAngleStart: segment.cutAngleStart,
                cutAngleEnd: segment.cutAngleEnd,
                quantity: 1
            });
        }

        // Create cut list items
        for (const [key, group] of Object.entries(profileGroups)) {
            for (const item of group.items) {
                cutList.items.push({
                    itemNumber: cutList.items.length + 1,
                    profile: group.profile,
                    length: item.length,
                    cutAngleStart: item.cutAngleStart,
                    cutAngleEnd: item.cutAngleEnd,
                    quantity: item.quantity,
                    weight: this.calculateWeight(item.length, group.profile),
                    notes: this.generateCutNotes(item)
                });

                cutList.summary.totalLength += item.length;
            }

            // Update profile breakdown
            const profileKey = `${group.profile.type} ${group.profile.size}`;
            cutList.summary.profileBreakdown[profileKey] = {
                count: group.items.length,
                totalLength: group.items.reduce((sum, item) => sum + item.length, 0)
            };
        }

        cutList.summary.totalParts = cutList.items.length;
        cutList.summary.totalWeight = this.calculateWeight(cutList.summary.totalLength, frame.profile);

        return cutList;
    }

    /**
     * Generate cutting notes for item
     */
    generateCutNotes(item) {
        const notes = [];

        if (item.cutAngleStart !== 90) {
            notes.push(`Start: ${item.cutAngleStart}° miter`);
        }

        if (item.cutAngleEnd !== 90) {
            notes.push(`End: ${item.cutAngleEnd}° miter`);
        }

        if (notes.length === 0) {
            notes.push('Square cut both ends');
        }

        return notes.join('; ');
    }

    /**
     * Create end cap
     */
    createEndCap(frame, segmentId, capType = 'flat') {
        const segment = frame.segments.find(s => s.id === segmentId);
        if (!segment) {
            throw new Error(`Segment ${segmentId} not found`);
        }

        const endCap = {
            id: `endcap_${Date.now()}`,
            segmentId: segmentId,
            type: capType, // flat, domed, threaded
            position: 'end', // start or end
            thickness: 3 // mm
        };

        return endCap;
    }

    /**
     * Create gusset plate at joint
     */
    createGusset(frame, jointId, options = {}) {
        const joint = frame.joints.find(j => j.id === jointId);
        if (!joint) {
            throw new Error(`Joint ${jointId} not found`);
        }

        const gusset = {
            id: `gusset_${Date.now()}`,
            jointId: jointId,
            shape: options.shape || 'triangular', // triangular, rectangular, custom
            thickness: options.thickness || 5, // mm
            material: options.material || 'steel_mild',
            dimensions: options.dimensions || { width: 50, height: 50 }
        };

        return gusset;
    }

    /**
     * Helper: Calculate length between two points
     */
    calculateLength(p1, p2) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dz = p2.z - p1.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /**
     * Helper: Calculate total frame length
     */
    calculateTotalLength(segments) {
        return segments.reduce((sum, seg) => sum + seg.length, 0);
    }

    /**
     * Helper: Calculate weight from length and profile
     */
    calculateWeight(length, profile) {
        // Simplified - would use actual profile cross-sectional area and material density
        const steelDensity = 7850; // kg/m³
        const area = 100; // mm² (placeholder)
        const volume = (area / 1000000) * (length / 1000); // m³
        return volume * steelDensity; // kg
    }

    /**
     * Helper: Calculate angle between two segments
     */
    calculateAngle(seg1, seg2) {
        // Vector from seg1
        const v1 = {
            x: seg1.end.x - seg1.start.x,
            y: seg1.end.y - seg1.start.y,
            z: seg1.end.z - seg1.start.z
        };

        // Vector from seg2
        const v2 = {
            x: seg2.end.x - seg2.start.x,
            y: seg2.end.y - seg2.start.y,
            z: seg2.end.z - seg2.start.z
        };

        // Dot product and magnitudes
        const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
        const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
        const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);

        const angle = Math.acos(dot / (mag1 * mag2)) * (180 / Math.PI);
        return angle;
    }

    /**
     * Helper: Check if points are equal within tolerance
     */
    pointsEqual(p1, p2, tolerance) {
        return Math.abs(p1.x - p2.x) < tolerance &&
            Math.abs(p1.y - p2.y) < tolerance &&
            Math.abs(p1.z - p2.z) < tolerance;
    }

    /**
     * Helper: Check if point is on line
     */
    pointOnLine(point, lineStart, lineEnd, tolerance) {
        // Simplified check - would use proper point-to-line distance
        const d1 = this.calculateLength(lineStart, point);
        const d2 = this.calculateLength(point, lineEnd);
        const lineLength = this.calculateLength(lineStart, lineEnd);

        return Math.abs((d1 + d2) - lineLength) < tolerance;
    }
}

module.exports = WeldmentsEngine;
