/**
 * RiggingSystem - IMAX/AAA Quality Rigging & Bone System
 * Armature creation, bone editing, weight painting, IK/FK
 */

import * as THREE from 'three';

export class Bone {
    constructor(name, position = new THREE.Vector3()) {
        this.name = name;
        this.position = position.clone();
        this.rotation = new THREE.Euler();
        this.scale = new THREE.Vector3(1, 1, 1);
        this.length = 1.0;

        this.parent = null;
        this.children = [];

        // Bone constraints
        this.constraints = {
            ik: null, // Inverse Kinematics target
            limitRotation: false,
            rotationMin: new THREE.Euler(-Math.PI, -Math.PI, -Math.PI),
            rotationMax: new THREE.Euler(Math.PI, Math.PI, Math.PI),
        };
    }

    /**
     * Add child bone
     */
    addChild(bone) {
        bone.parent = this;
        this.children.push(bone);
    }

    /**
     * Get world position
     */
    getWorldPosition() {
        let worldPos = this.position.clone();
        let parent = this.parent;

        while (parent) {
            worldPos.add(parent.position);
            parent = parent.parent;
        }

        return worldPos;
    }

    /**
     * Get bone matrix
     */
    getMatrix() {
        const matrix = new THREE.Matrix4();
        matrix.compose(this.position, new THREE.Quaternion().setFromEuler(this.rotation), this.scale);
        return matrix;
    }
}

export class Armature {
    constructor(name) {
        this.name = name;
        this.bones = new Map(); // boneName -> Bone
        this.rootBones = []; // Bones with no parent
    }

    /**
     * Add bone to armature
     */
    addBone(bone, parentBoneName = null) {
        this.bones.set(bone.name, bone);

        if (parentBoneName) {
            const parentBone = this.bones.get(parentBoneName);
            if (parentBone) {
                parentBone.addChild(bone);
            }
        } else {
            this.rootBones.push(bone);
        }
    }

    /**
     * Get bone by name
     */
    getBone(name) {
        return this.bones.get(name);
    }

    /**
     * Remove bone
     */
    removeBone(name) {
        const bone = this.bones.get(name);
        if (!bone) return;

        // Reparent children to bone's parent
        bone.children.forEach(child => {
            child.parent = bone.parent;
            if (bone.parent) {
                bone.parent.children.push(child);
            } else {
                this.rootBones.push(child);
            }
        });

        // Remove from parent's children
        if (bone.parent) {
            const index = bone.parent.children.indexOf(bone);
            if (index !== -1) {
                bone.parent.children.splice(index, 1);
            }
        } else {
            const rootIndex = this.rootBones.indexOf(bone);
            if (rootIndex !== -1) {
                this.rootBones.splice(rootIndex, 1);
            }
        }

        this.bones.delete(name);
    }
}

export class VertexWeight {
    constructor(vertexIndex, boneIndex, weight) {
        this.vertexIndex = vertexIndex;
        this.boneIndex = boneIndex;
        this.weight = weight; // 0.0 to 1.0
    }
}

export class RiggingSystem {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;

        // Armatures
        this.armatures = new Map(); // armatureId -> Armature

        // Mesh skinning data
        this.skinData = new Map(); // meshId -> { armatureId, weights: VertexWeight[] }

        // Pose mode
        this.poseMode = false;
        this.selectedBone = null;
    }

    /**
     * Create new armature
     */
    createArmature(name) {
        const id = `armature_${Date.now()}`;
        const armature = new Armature(name);
        this.armatures.set(id, armature);

        console.log(`🦴 Created armature: ${name}`);
        return { id, armature };
    }

    /**
     * Add bone to armature
     */
    addBone(armatureId, boneName, position, parentBoneName = null) {
        const armature = this.armatures.get(armatureId);
        if (!armature) {
            console.error('Armature not found:', armatureId);
            return null;
        }

        const bone = new Bone(boneName, position);
        armature.addBone(bone, parentBoneName);

        console.log(`🦴 Added bone: ${boneName} to ${armature.name}`);
        return bone;
    }

    /**
     * Parent mesh to armature (skinning)
     */
    parentMeshToArmature(meshId, armatureId) {
        const armature = this.armatures.get(armatureId);
        if (!armature) {
            console.error('Armature not found:', armatureId);
            return;
        }

        // Initialize skin data
        this.skinData.set(meshId, {
            armatureId: armatureId,
            weights: [],
            automaticWeights: true,
        });

        console.log(`🔗 Parented mesh ${meshId} to armature ${armature.name}`);
    }

    /**
     * Set vertex weight for bone
     */
    setVertexWeight(meshId, vertexIndex, boneName, weight) {
        const skinData = this.skinData.get(meshId);
        if (!skinData) {
            console.error('Mesh not rigged:', meshId);
            return;
        }

        const armature = this.armatures.get(skinData.armatureId);
        const boneIndex = Array.from(armature.bones.keys()).indexOf(boneName);

        if (boneIndex === -1) {
            console.error('Bone not found:', boneName);
            return;
        }

        // Find existing weight or create new
        const existing = skinData.weights.find(
            w => w.vertexIndex === vertexIndex && w.boneIndex === boneIndex
        );

        if (existing) {
            existing.weight = weight;
        } else {
            skinData.weights.push(new VertexWeight(vertexIndex, boneIndex, weight));
        }
    }

    /**
     * Automatic weight painting (distance-based)
     */
    automaticWeights(meshId, mesh) {
        const skinData = this.skinData.get(meshId);
        if (!skinData) return;

        const armature = this.armatures.get(skinData.armatureId);
        const positions = mesh.geometry.attributes.position.array;

        // For each vertex, calculate distance to each bone
        for (let i = 0; i < positions.length; i += 3) {
            const vertex = new THREE.Vector3(
                positions[i],
                positions[i + 1],
                positions[i + 2]
            );

            const vertexIndex = i / 3;
            const boneWeights = [];

            // Calculate distances to all bones
            armature.bones.forEach((bone, boneName) => {
                const bonePos = bone.getWorldPosition();
                const distance = vertex.distanceTo(bonePos);
                boneWeights.push({ boneName, distance });
            });

            // Sort by distance and assign weights
            boneWeights.sort((a, b) => a.distance - b.distance);

            // Take closest 4 bones (typical for skinning)
            const maxInfluences = 4;
            const influences = boneWeights.slice(0, maxInfluences);

            // Normalize weights
            const totalInvDist = influences.reduce((sum, inf) => sum + 1 / (inf.distance + 0.01), 0);

            influences.forEach(inf => {
                const weight = (1 / (inf.distance + 0.01)) / totalInvDist;
                this.setVertexWeight(meshId, vertexIndex, inf.boneName, weight);
            });
        }

        console.log(`🎨 Automatic weights calculated for mesh ${meshId}`);
    }

    /**
     * Enter pose mode
     */
    enterPoseMode() {
        this.poseMode = true;
        console.log('🤸 Entered Pose Mode');
    }

    /**
     * Exit pose mode
     */
    exitPoseMode() {
        this.poseMode = false;
        this.selectedBone = null;
        console.log('✅ Exited Pose Mode');
    }

    /**
     * Set bone pose (rotation)
     */
    setBonePose(armatureId, boneName, rotation) {
        const armature = this.armatures.get(armatureId);
        if (!armature) return;

        const bone = armature.getBone(boneName);
        if (bone) {
            bone.rotation.copy(rotation);
        }
    }

    /**
     * Apply IK constraint to bone
     */
    applyIK(armatureId, boneName, targetPosition, chainLength = 2) {
        const armature = this.armatures.get(armatureId);
        if (!armature) return;

        const bone = armature.getBone(boneName);
        if (!bone) return;

        // Simple 2-bone IK solver
        if (chainLength === 2 && bone.parent) {
            const endBone = bone;
            const midBone = bone.parent;

            // Calculate angles to reach target
            // (Simplified IK - full implementation would use FABRIK or CCD)
            const chain = [midBone, endBone];
            const iterations = 10;

            for (let iter = 0; iter < iterations; iter++) {
                for (let i = chain.length - 1; i >= 0; i--) {
                    const currentBone = chain[i];
                    const currentPos = currentBone.getWorldPosition();
                    const endPos = endBone.getWorldPosition();

                    const toTarget = new THREE.Vector3().subVectors(targetPosition, currentPos);
                    const toEnd = new THREE.Vector3().subVectors(endPos, currentPos);

                    const angle = toTarget.angleTo(toEnd);
                    const axis = new THREE.Vector3().crossVectors(toEnd, toTarget).normalize();

                    // Apply rotation
                    const rotation = new THREE.Quaternion().setFromAxisAngle(axis, angle * 0.1);
                    const euler = new THREE.Euler().setFromQuaternion(rotation);
                    currentBone.rotation.x += euler.x;
                    currentBone.rotation.y += euler.y;
                    currentBone.rotation.z += euler.z;
                }
            }

            console.log(`🎯 IK applied to ${boneName}`);
        }
    }

    /**
     * Apply FK (Forward Kinematics) - standard bone rotation
     */
    applyFK(armatureId, boneName, rotation) {
        this.setBonePose(armatureId, boneName, rotation);
        console.log(`➡️ FK applied to ${boneName}`);
    }

    /**
     * Get armature hierarchy as tree
     */
    getArmatureHierarchy(armatureId) {
        const armature = this.armatures.get(armatureId);
        if (!armature) return null;

        const buildTree = (bone) => {
            return {
                name: bone.name,
                position: bone.position.toArray(),
                rotation: [bone.rotation.x, bone.rotation.y, bone.rotation.z],
                children: bone.children.map(child => buildTree(child)),
            };
        };

        return {
            name: armature.name,
            roots: armature.rootBones.map(root => buildTree(root)),
        };
    }
}
