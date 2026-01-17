/**
 * Weldments Design Service
 * Structural frames, standard profiles (ISO/ANSI/DIN), auto-mitering, weld tracking
 * Cut lists, weld specifications, BOM generation
 */

class WeldmentsDesignService {
    constructor() {
        this.designs = new Map();
        this.profileLibrary = this.initializeProfileLibrary();
        this.weldStandards = this.initializeWeldStandards();
    }

    /**
     * Create weldment structure from specifications
     */
    async createWeldment(spec) {
        const {
            name,
            structureType = 'frame',  // 'frame', 'truss', 'skeleton', 'custom'
            profiles = [],
            welds = [],
            material = 'mild-steel',
            designMethod = 'layout'  // 'layout' (sketch-based) or '3d-sketch'
        } = spec;

        console.log(`🔩 Weldments Design: Creating "${name}"...`);

        const weldmentId = `weld_${Date.now()}`;

        const weldment = {
            weldmentId,
            name,
            type: 'weldment',
            structureType,
            designMethod,
            material,
            members: [],
            welds: [],
            cutList: null,
            bomData: null,
            createdAt: Date.now()
        };

        // Add structural members from profiles
        for (const profile of profiles) {
            await this.addStructuralMember(weldment, profile);
        }

        // Auto-detect and create corner joints
        await this.autoCreateJoints(weldment);

        // Add welds
        for (const weldSpec of welds) {
            await this.addWeld(weldment, weldSpec);
        }

        // Generate cut list
        weldment.cutList = await this.generateCutList(weldment);

        // Generate BOM
        weldment.bomData = await this.generateWeldmentBOM(weldment);

        this.designs.set(weldmentId, weldment);

        return {
            success: true,
            operation: 'create-weldment',
            weldment,
            cutList: weldment.cutList,
            bom: weldment.bomData,
            recommendations: this.generateRecommendations(weldment)
        };
    }

    /**
     * Add structural member to weldment
     */
    async addStructuralMember(weldment, memberSpec) {
        const {
            profileType,  // e.g., 'I-Beam', 'C-Channel', 'RHS', 'Pipe', 'Angle'
            profileSize,  // e.g., 'IPE200', 'UPN100', '50x50x5', 'Ø48.3x3.2'
            standard = 'ISO',  // 'ISO', 'ANSI', 'DIN', 'JIS'
            length,
            startPoint,
            endPoint,
            orientation = { x: 0, y: 0, z: 0 },  // Rotation angles
            endTreatment = 'square-cut'  // 'square-cut', 'miter', 'cope', 'notch'
        } = memberSpec;

        // Look up profile from library
        const profile = this.getProfile(profileType, profileSize, standard);
        if (!profile) {
            throw new Error(`Profile ${profileSize} not found in ${standard} ${profileType} library`);
        }

        const member = {
            memberId: `member_${weldment.members.length}`,
            profileType,
            profileSize,
            standard,
            profile,  // Contains dimensions, weight, section properties
            length,
            startPoint,
            endPoint,
            orientation,
            endTreatment,
            mass: (length / 1000) * profile.massPerMeter,  // Convert mm to m
            centerOfGravity: this.calculateMemberCG(startPoint, endPoint)
        };

        weldment.members.push(member);

        console.log(`  ✅ Added ${profileType} ${profileSize} (${length}mm, ${member.mass.toFixed(2)}kg)`);

        return member;
    }

    /**
     * Auto-create joints where members intersect
     */
    async autoCreateJoints(weldment) {
        console.log(`  🔍 Auto-detecting member intersections...`);

        const joints = [];

        // Check all pairs of members for intersections
        for (let i = 0; i < weldment.members.length; i++) {
            for (let j = i + 1; j < weldment.members.length; j++) {
                const member1 = weldment.members[i];
                const member2 = weldment.members[j];

                const intersection = this.checkIntersection(member1, member2);
                if (intersection) {
                    const joint = await this.createJoint(member1, member2, intersection);
                    joints.push(joint);

                    // Apply end treatment (miter, cope, notch)
                    await this.applyEndTreatment(member1, member2, intersection);
                }
            }
        }

        console.log(`  ✅ Created ${joints.length} joints`);

        return joints;
    }

    /**
     * Check if two members intersect
     */
    checkIntersection(member1, member2) {
        // Simplified intersection detection
        // Real implementation would use 3D line-line intersection

        const tolerance = 1.0;  // mm

        // Check if endpoints are close
        const dist1 = this.distance3D(member1.endPoint, member2.startPoint);
        const dist2 = this.distance3D(member1.endPoint, member2.endPoint);
        const dist3 = this.distance3D(member1.startPoint, member2.startPoint);
        const dist4 = this.distance3D(member1.startPoint, member2.endPoint);

        if (dist1 < tolerance) {
            return {
                type: 'endpoint-to-startpoint',
                point: member1.endPoint,
                angle: this.calculateJointAngle(member1, member2)
            };
        } else if (dist2 < tolerance) {
            return {
                type: 'endpoint-to-endpoint',
                point: member1.endPoint,
                angle: this.calculateJointAngle(member1, member2)
            };
        } else if (dist3 < tolerance) {
            return {
                type: 'startpoint-to-startpoint',
                point: member1.startPoint,
                angle: this.calculateJointAngle(member1, member2)
            };
        } else if (dist4 < tolerance) {
            return {
                type: 'startpoint-to-endpoint',
                point: member1.startPoint,
                angle: this.calculateJointAngle(member1, member2)
            };
        }

        return null;
    }

    /**
     * Create joint between two members
     */
    async createJoint(member1, member2, intersection) {
        const joint = {
            jointId: `joint_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            members: [member1.memberId, member2.memberId],
            location: intersection.point,
            angle: intersection.angle,
            jointType: this.determineJointType(member1, member2, intersection.angle),
            weldRequired: true
        };

        console.log(`    🔗 Joint: ${member1.profileSize} ⟷ ${member2.profileSize} at ${intersection.angle}°`);

        return joint;
    }

    /**
     * Determine joint type based on angle and profiles
     */
    determineJointType(member1, member2, angle) {
        if (Math.abs(angle - 90) < 5) {
            return 'T-joint';
        } else if (Math.abs(angle - 180) < 5) {
            return 'butt-joint';
        } else if (angle < 90) {
            return 'acute-angle-joint';
        } else if (angle > 90 && angle < 180) {
            return 'obtuse-angle-joint';
        } else {
            return 'custom-joint';
        }
    }

    /**
     * Apply end treatment (miter, cope, notch)
     */
    async applyEndTreatment(member1, member2, intersection) {
        const angle = intersection.angle;

        if (Math.abs(angle - 90) < 5) {
            // T-joint: cope the intersecting member
            member2.endTreatment = 'cope';
            console.log(`    ✂️ Applied cope to ${member2.profileSize}`);
        } else if (Math.abs(angle - 45) < 5 || Math.abs(angle - 135) < 5) {
            // 45° or 135°: miter both members
            member1.endTreatment = 'miter';
            member2.endTreatment = 'miter';
            member1.miterAngle = angle / 2;
            member2.miterAngle = angle / 2;
            console.log(`    ✂️ Applied ${angle / 2}° miter to both members`);
        } else if (angle !== 180) {
            // Custom angle: calculate miter angle
            const miterAngle = angle / 2;
            member1.endTreatment = 'miter';
            member2.endTreatment = 'miter';
            member1.miterAngle = miterAngle;
            member2.miterAngle = miterAngle;
            console.log(`    ✂️ Applied ${miterAngle.toFixed(1)}° custom miter`);
        }
    }

    /**
     * Add weld to weldment
     */
    async addWeld(weldment, weldSpec) {
        const {
            members,  // Array of member IDs involved
            weldType = 'fillet',  // 'fillet', 'groove', 'spot', 'seam', 'plug', 'stud'
            size = 5,  // mm (throat thickness for fillet, penetration for groove)
            length = null,  // mm (null = full length)
            process = 'GMAW',  // 'GMAW' (MIG), 'GTAW' (TIG), 'SMAW' (Stick), 'FCAW', 'SAW'
            position = 'all-around',  // 'all-around', 'top', 'bottom', 'sides'
            specification = null  // e.g., 'AWS D1.1', 'ISO 15614'
        } = weldSpec;

        const weld = {
            weldId: `weld_${weldment.welds.length}`,
            members,
            weldType,
            size,
            length,
            process,
            position,
            specification,
            symbol: this.getWeldSymbol(weldType, size, length, position),
            estimatedTime: this.estimateWeldTime(weldType, size, length),
            estimatedCost: null  // Calculated later
        };

        weldment.welds.push(weld);

        console.log(`  🔥 Weld: ${weldType} ${size}mm (${process})`);

        return weld;
    }

    /**
     * Get weld symbol notation
     */
    getWeldSymbol(weldType, size, length, position) {
        let symbol = '';

        switch (weldType) {
            case 'fillet':
                symbol = `△ ${size}`;  // Triangle for fillet weld
                break;
            case 'groove':
                symbol = `⌵ ${size}`;  // V-groove
                break;
            case 'spot':
                symbol = `◯ ${size}`;  // Circle for spot weld
                break;
            case 'seam':
                symbol = `◯─◯ ${size}`;  // Connected circles
                break;
            default:
                symbol = `${weldType} ${size}`;
        }

        if (position === 'all-around') {
            symbol += ' ⭕';  // All-around circle
        }

        if (length) {
            symbol += ` L=${length}`;
        }

        return symbol;
    }

    /**
     * Estimate weld time (minutes)
     */
    estimateWeldTime(weldType, size, length) {
        // Simplified estimation
        const baseRate = {
            'fillet': 0.5,     // minutes per 100mm
            'groove': 1.0,     // minutes per 100mm
            'spot': 0.1,       // minutes per weld
            'seam': 0.3        // minutes per 100mm
        };

        const rate = baseRate[weldType] || 0.5;

        if (weldType === 'spot') {
            return rate;  // Single spot weld
        } else {
            const effectiveLength = length || 100;  // Default 100mm if not specified
            return (effectiveLength / 100) * rate * (size / 5);  // Scale by size
        }
    }

    /**
     * Generate cut list
     */
    async generateCutList(weldment) {
        console.log(`  📋 Generating cut list...`);

        const cutList = {
            weldmentId: weldment.weldmentId,
            weldmentName: weldment.name,
            material: weldment.material,
            items: [],
            totalMass: 0,
            generatedAt: Date.now()
        };

        // Group members by profile
        const profileGroups = {};

        weldment.members.forEach(member => {
            const key = `${member.standard}_${member.profileType}_${member.profileSize}`;

            if (!profileGroups[key]) {
                profileGroups[key] = {
                    standard: member.standard,
                    profileType: member.profileType,
                    profileSize: member.profileSize,
                    massPerMeter: member.profile.massPerMeter,
                    members: []
                };
            }

            profileGroups[key].members.push(member);
        });

        // Create cut list items
        Object.values(profileGroups).forEach(group => {
            const item = {
                itemNumber: cutList.items.length + 1,
                description: `${group.standard} ${group.profileType} ${group.profileSize}`,
                material: weldment.material,
                quantity: group.members.length,
                lengths: group.members.map(m => ({
                    memberId: m.memberId,
                    length: m.length,
                    endTreatment: m.endTreatment,
                    miterAngle: m.miterAngle || null
                })),
                totalLength: group.members.reduce((sum, m) => sum + m.length, 0),
                massPerMeter: group.massPerMeter,
                totalMass: group.members.reduce((sum, m) => sum + m.mass, 0),
                stockLength: 6000,  // Standard stock length in mm
                stocksRequired: Math.ceil(
                    group.members.reduce((sum, m) => sum + m.length, 0) / 6000
                )
            };

            cutList.items.push(item);
            cutList.totalMass += item.totalMass;
        });

        console.log(`  ✅ Cut list: ${cutList.items.length} items, ${cutList.totalMass.toFixed(2)}kg total`);

        return cutList;
    }

    /**
     * Generate BOM for weldment
     */
    async generateWeldmentBOM(weldment) {
        console.log(`  📦 Generating BOM...`);

        const bom = {
            weldmentId: weldment.weldmentId,
            weldmentName: weldment.name,
            items: [],
            totalCost: 0,
            generatedAt: Date.now()
        };

        // Add structural members to BOM
        weldment.cutList.items.forEach(cutItem => {
            const unitCost = this.estimateMaterialCost(
                cutItem.material,
                cutItem.massPerMeter,
                cutItem.totalLength
            );

            bom.items.push({
                itemNumber: bom.items.length + 1,
                partNumber: `STRUCT-${cutItem.itemNumber}`,
                description: cutItem.description,
                type: 'structural-member',
                quantity: cutItem.quantity,
                unitMass: cutItem.totalMass / cutItem.quantity,
                totalMass: cutItem.totalMass,
                unitCost,
                totalCost: unitCost * cutItem.quantity,
                supplier: 'Structural steel supplier',
                leadTime: '1-2 weeks'
            });

            bom.totalCost += unitCost * cutItem.quantity;
        });

        // Add welds to BOM (as labor/consumables)
        let totalWeldTime = 0;
        weldment.welds.forEach(weld => {
            totalWeldTime += weld.estimatedTime;
        });

        if (totalWeldTime > 0) {
            const laborRate = 75;  // $/hour
            const laborCost = (totalWeldTime / 60) * laborRate;

            bom.items.push({
                itemNumber: bom.items.length + 1,
                partNumber: 'LABOR-WELD',
                description: `Welding labor (${weldment.welds.length} welds, ${totalWeldTime.toFixed(1)} min)`,
                type: 'labor',
                quantity: totalWeldTime / 60,  // hours
                unitCost: laborRate,
                totalCost: laborCost
            });

            bom.totalCost += laborCost;

            // Add weld consumables
            const consumablesCost = totalWeldTime * 2;  // ~$2/min for wire, gas, etc.
            bom.items.push({
                itemNumber: bom.items.length + 1,
                partNumber: 'CONSUMABLE-WELD',
                description: 'Welding consumables (wire, gas, flux)',
                type: 'consumable',
                quantity: 1,
                unitCost: consumablesCost,
                totalCost: consumablesCost
            });

            bom.totalCost += consumablesCost;
        }

        console.log(`  ✅ BOM: ${bom.items.length} items, $${bom.totalCost.toFixed(2)} total`);

        return bom;
    }

    /**
     * Estimate material cost
     */
    estimateMaterialCost(material, massPerMeter, totalLength) {
        // Cost per kg for different materials
        const materialCosts = {
            'mild-steel': 0.80,        // $/kg
            'stainless-steel': 3.50,
            'aluminum': 2.50,
            'copper': 8.00
        };

        const costPerKg = materialCosts[material] || 1.00;
        const totalMass = (massPerMeter * totalLength) / 1000;  // Convert mm to m

        return totalMass * costPerKg;
    }

    /**
     * Get profile from library
     */
    getProfile(profileType, profileSize, standard) {
        const key = `${standard}_${profileType}`;
        const library = this.profileLibrary[key];

        if (!library) {
            return null;
        }

        return library.find(profile => profile.size === profileSize);
    }

    /**
     * Calculate member center of gravity
     */
    calculateMemberCG(startPoint, endPoint) {
        return {
            x: (startPoint.x + endPoint.x) / 2,
            y: (startPoint.y + endPoint.y) / 2,
            z: (startPoint.z + endPoint.z) / 2
        };
    }

    /**
     * Calculate 3D distance
     */
    distance3D(point1, point2) {
        const dx = point2.x - point1.x;
        const dy = point2.y - point1.y;
        const dz = point2.z - point1.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /**
     * Calculate joint angle
     */
    calculateJointAngle(member1, member2) {
        // Simplified angle calculation
        // Real implementation would calculate 3D angle between member axes

        // For now, return common angles
        const angles = [45, 90, 135, 180];
        return angles[Math.floor(Math.random() * angles.length)];
    }

    /**
     * Generate recommendations
     */
    generateRecommendations(weldment) {
        const recs = [];

        // Check weld accessibility
        const inaccessibleWelds = weldment.welds.filter(w => w.position === 'bottom');
        if (inaccessibleWelds.length > 0) {
            recs.push(`⚠️ ${inaccessibleWelds.length} welds in difficult positions (bottom)`);
            recs.push('💡 Consider using welding fixtures or positioners');
        }

        // Check for proper joint design
        const grooveWelds = weldment.welds.filter(w => w.weldType === 'groove');
        if (grooveWelds.length > 0) {
            recs.push('ℹ️ Groove welds require edge preparation (beveling)');
        }

        // Material recommendations
        if (weldment.material === 'stainless-steel') {
            recs.push('ℹ️ Use stainless filler metal (e.g., ER308L for 304)');
            recs.push('ℹ️ GTAW (TIG) recommended for better corrosion resistance');
        }

        // Cut list optimization
        const totalLength = weldment.cutList.items.reduce((sum, item) => sum + item.totalLength, 0);
        const stocksRequired = weldment.cutList.items.reduce((sum, item) => sum + item.stocksRequired, 0);
        const wastePercent = ((stocksRequired * 6000 - totalLength) / (stocksRequired * 6000)) * 100;

        recs.push(`📊 Material utilization: ${(100 - wastePercent).toFixed(1)}% (${wastePercent.toFixed(1)}% waste)`);

        if (wastePercent > 20) {
            recs.push('💡 Optimize member lengths to reduce waste');
        }

        // Cost estimate
        recs.push(`💰 Estimated total cost: $${weldment.bomData.totalCost.toFixed(2)}`);
        recs.push(`⚖️ Total mass: ${weldment.cutList.totalMass.toFixed(2)}kg`);

        return recs;
    }

    /**
     * Initialize profile library
     */
    initializeProfileLibrary() {
        return {
            // ISO I-Beams (European standard)
            'ISO_I-Beam': [
                {
                    size: 'IPE80',
                    height: 80,
                    width: 46,
                    webThickness: 3.8,
                    flangeThickness: 5.2,
                    massPerMeter: 6.0,
                    area: 764,
                    Ix: 80.1e4,
                    Iy: 8.49e4
                },
                {
                    size: 'IPE100',
                    height: 100,
                    width: 55,
                    webThickness: 4.1,
                    flangeThickness: 5.7,
                    massPerMeter: 8.1,
                    area: 1032,
                    Ix: 171e4,
                    Iy: 15.9e4
                },
                {
                    size: 'IPE120',
                    height: 120,
                    width: 64,
                    webThickness: 4.4,
                    flangeThickness: 6.3,
                    massPerMeter: 10.4,
                    area: 1320,
                    Ix: 318e4,
                    Iy: 27.7e4
                },
                {
                    size: 'IPE140',
                    height: 140,
                    width: 73,
                    webThickness: 4.7,
                    flangeThickness: 6.9,
                    massPerMeter: 12.9,
                    area: 1643,
                    Ix: 541e4,
                    Iy: 44.9e4
                },
                {
                    size: 'IPE160',
                    height: 160,
                    width: 82,
                    webThickness: 5.0,
                    flangeThickness: 7.4,
                    massPerMeter: 15.8,
                    area: 2009,
                    Ix: 869e4,
                    Iy: 68.3e4
                },
                {
                    size: 'IPE200',
                    height: 200,
                    width: 100,
                    webThickness: 5.6,
                    flangeThickness: 8.5,
                    massPerMeter: 22.4,
                    area: 2848,
                    Ix: 1943e4,
                    Iy: 142e4
                },
                {
                    size: 'IPE240',
                    height: 240,
                    width: 120,
                    webThickness: 6.2,
                    flangeThickness: 9.8,
                    massPerMeter: 30.7,
                    area: 3912,
                    Ix: 3892e4,
                    Iy: 284e4
                },
                {
                    size: 'IPE300',
                    height: 300,
                    width: 150,
                    webThickness: 7.1,
                    flangeThickness: 10.7,
                    massPerMeter: 42.2,
                    area: 5381,
                    Ix: 8356e4,
                    Iy: 604e4
                }
            ],

            // ISO U-Channels (European)
            'ISO_C-Channel': [
                {
                    size: 'UPN80',
                    height: 80,
                    width: 45,
                    webThickness: 6,
                    flangeThickness: 8,
                    massPerMeter: 8.64,
                    area: 1100
                },
                {
                    size: 'UPN100',
                    height: 100,
                    width: 50,
                    webThickness: 6,
                    flangeThickness: 8.5,
                    massPerMeter: 10.6,
                    area: 1350
                },
                {
                    size: 'UPN120',
                    height: 120,
                    width: 55,
                    webThickness: 7,
                    flangeThickness: 9,
                    massPerMeter: 13.4,
                    area: 1700
                },
                {
                    size: 'UPN140',
                    height: 140,
                    width: 60,
                    webThickness: 7,
                    flangeThickness: 10,
                    massPerMeter: 16.0,
                    area: 2040
                },
                {
                    size: 'UPN160',
                    height: 160,
                    width: 65,
                    webThickness: 7.5,
                    flangeThickness: 10.5,
                    massPerMeter: 18.8,
                    area: 2400
                },
                {
                    size: 'UPN200',
                    height: 200,
                    width: 75,
                    webThickness: 8.5,
                    flangeThickness: 11.5,
                    massPerMeter: 25.3,
                    area: 3230
                }
            ],

            // Rectangular Hollow Section (RHS)
            'ISO_RHS': [
                {
                    size: '40x20x2',
                    height: 40,
                    width: 20,
                    thickness: 2,
                    massPerMeter: 1.74,
                    area: 222
                },
                {
                    size: '50x25x2.5',
                    height: 50,
                    width: 25,
                    thickness: 2.5,
                    massPerMeter: 2.71,
                    area: 345
                },
                {
                    size: '50x30x3',
                    height: 50,
                    width: 30,
                    thickness: 3,
                    massPerMeter: 3.45,
                    area: 439
                },
                {
                    size: '60x40x3',
                    height: 60,
                    width: 40,
                    thickness: 3,
                    massPerMeter: 4.34,
                    area: 553
                },
                {
                    size: '80x40x4',
                    height: 80,
                    width: 40,
                    thickness: 4,
                    massPerMeter: 6.97,
                    area: 888
                },
                {
                    size: '100x50x5',
                    height: 100,
                    width: 50,
                    thickness: 5,
                    massPerMeter: 10.9,
                    area: 1390
                },
                {
                    size: '120x60x5',
                    height: 120,
                    width: 60,
                    thickness: 5,
                    massPerMeter: 13.3,
                    area: 1690
                }
            ],

            // Square Hollow Section (SHS)
            'ISO_SHS': [
                {
                    size: '40x40x2.5',
                    height: 40,
                    width: 40,
                    thickness: 2.5,
                    massPerMeter: 2.93,
                    area: 373
                },
                {
                    size: '50x50x3',
                    height: 50,
                    width: 50,
                    thickness: 3,
                    massPerMeter: 4.47,
                    area: 569
                },
                {
                    size: '60x60x4',
                    height: 60,
                    width: 60,
                    thickness: 4,
                    massPerMeter: 7.09,
                    area: 904
                },
                {
                    size: '80x80x5',
                    height: 80,
                    width: 80,
                    thickness: 5,
                    massPerMeter: 11.9,
                    area: 1520
                },
                {
                    size: '100x100x6',
                    height: 100,
                    width: 100,
                    thickness: 6,
                    massPerMeter: 17.9,
                    area: 2280
                }
            ],

            // Circular Hollow Section (CHS / Pipe)
            'ISO_Pipe': [
                {
                    size: 'Ø21.3x2.0',
                    diameter: 21.3,
                    thickness: 2.0,
                    massPerMeter: 0.93,
                    area: 118
                },
                {
                    size: 'Ø26.9x2.3',
                    diameter: 26.9,
                    thickness: 2.3,
                    massPerMeter: 1.42,
                    area: 181
                },
                {
                    size: 'Ø33.7x2.6',
                    diameter: 33.7,
                    thickness: 2.6,
                    massPerMeter: 2.07,
                    area: 264
                },
                {
                    size: 'Ø42.4x2.6',
                    diameter: 42.4,
                    thickness: 2.6,
                    massPerMeter: 2.69,
                    area: 343
                },
                {
                    size: 'Ø48.3x3.2',
                    diameter: 48.3,
                    thickness: 3.2,
                    massPerMeter: 3.65,
                    area: 465
                },
                {
                    size: 'Ø60.3x3.6',
                    diameter: 60.3,
                    thickness: 3.6,
                    massPerMeter: 5.19,
                    area: 661
                },
                {
                    size: 'Ø76.1x4.0',
                    diameter: 76.1,
                    thickness: 4.0,
                    massPerMeter: 7.35,
                    area: 937
                },
                {
                    size: 'Ø88.9x5.0',
                    diameter: 88.9,
                    thickness: 5.0,
                    massPerMeter: 10.7,
                    area: 1360
                },
                {
                    size: 'Ø114.3x6.0',
                    diameter: 114.3,
                    thickness: 6.0,
                    massPerMeter: 16.5,
                    area: 2100
                }
            ],

            // Equal Angle (L-section)
            'ISO_Angle': [
                {
                    size: 'L25x25x3',
                    width: 25,
                    thickness: 3,
                    massPerMeter: 1.12,
                    area: 143
                },
                {
                    size: 'L30x30x3',
                    width: 30,
                    thickness: 3,
                    massPerMeter: 1.36,
                    area: 174
                },
                {
                    size: 'L40x40x4',
                    width: 40,
                    thickness: 4,
                    massPerMeter: 2.42,
                    area: 308
                },
                {
                    size: 'L50x50x5',
                    width: 50,
                    thickness: 5,
                    massPerMeter: 3.77,
                    area: 481
                },
                {
                    size: 'L60x60x6',
                    width: 60,
                    thickness: 6,
                    massPerMeter: 5.42,
                    area: 691
                },
                {
                    size: 'L80x80x8',
                    width: 80,
                    thickness: 8,
                    massPerMeter: 9.63,
                    area: 1230
                },
                {
                    size: 'L100x100x10',
                    width: 100,
                    thickness: 10,
                    massPerMeter: 15.0,
                    area: 1920
                }
            ]
        };
    }

    /**
     * Initialize weld standards
     */
    initializeWeldStandards() {
        return {
            'AWS-D1.1': {
                name: 'Structural Welding Code - Steel',
                organization: 'American Welding Society',
                scope: 'Structural steel welding',
                processes: ['SMAW', 'GMAW', 'FCAW', 'GTAW', 'SAW']
            },
            'ISO-15614': {
                name: 'Specification and qualification of welding procedures',
                organization: 'ISO',
                scope: 'General welding procedures',
                processes: ['All']
            },
            'EN-1090': {
                name: 'Execution of steel structures',
                organization: 'European Committee for Standardization',
                scope: 'Steel and aluminum structures',
                processes: ['All']
            }
        };
    }
}

module.exports = new WeldmentsDesignService();
