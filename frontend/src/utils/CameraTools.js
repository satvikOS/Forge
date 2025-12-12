/**
 * Camera Tools - Utilities for camera positioning and auto-fitting
 * Handles bounding box calculations and camera framing
 */

import * as THREE from 'three';

/**
 * Calculate the world-space bounding box of all scene objects
 * @param {Array} sceneObjects - Array of scene objects with position and geometry
 * @returns {THREE.Box3} Bounding box encompassing all objects
 */
export function calculateBoundingBox(sceneObjects) {
    const box = new THREE.Box3();

    sceneObjects.forEach(obj => {
        const pos = obj.position || { x: 0, y: 0, z: 0 };
        const geom = obj.userData?.geometry;

        // Get half-dimensions
        const halfWidth = Math.abs((geom?.width || 1) / 2);
        const halfHeight = Math.abs((geom?.height || 1) / 2);
        const halfDepth = Math.abs((geom?.depth || 1) / 2);

        // Expand box to include this object
        box.expandByPoint(new THREE.Vector3(
            pos.x - halfWidth,
            pos.y - halfHeight,
            pos.z - halfDepth
        ));
        box.expandByPoint(new THREE.Vector3(
            pos.x + halfWidth,
            pos.y + halfHeight,
            pos.z + halfDepth
        ));
    });

    return box;
}

/**
 * Get bounding sphere from bounding box
 * @param {THREE.Box3} boundingBox - The bounding box
 * @returns {Object} Object with center and radius
 */
export function getBoundingSphere(boundingBox) {
    const center = new THREE.Vector3();
    boundingBox.getCenter(center);

    const size = new THREE.Vector3();
    boundingBox.getSize(size);

    // Radius is half the diagonal of the bounding box
    const radius = size.length() / 2;

    return { center, radius };
}

/**
 * Fit camera to view entire scene with padding
 * @param {THREE.Camera} camera - The Three.js camera
 * @param {Object} controls - Camera controls (CameraControls or OrbitControls)
 * @param {Array} sceneObjects - Array of scene objects
 * @param {Number} paddingFactor - Padding multiplier (default 1.2 = 20% padding)
 */
export function fitCameraToScene(camera, controls, sceneObjects, paddingFactor = 1.2) {
    if (!sceneObjects || sceneObjects.length === 0) {
        console.warn('⚠️ No objects to fit camera to');
        return;
    }

    const box = calculateBoundingBox(sceneObjects);
    const { center, radius } = getBoundingSphere(box);

    // Calculate camera distance based on field of view
    const fov = camera.fov * (Math.PI / 180); // Convert to radians
    const distance = (radius * paddingFactor) / Math.tan(fov / 2);

    console.log(`📷 Camera auto-fit: center=${center.x.toFixed(1)},${center.y.toFixed(1)},${center.z.toFixed(1)}, radius=${radius.toFixed(1)}, distance=${distance.toFixed(1)}`);

    // If using CameraControls (drei)
    if (controls && typeof controls.fitToBox === 'function') {
        controls.fitToBox(box, true, {
            paddingLeft: paddingFactor,
            paddingRight: paddingFactor,
            paddingBottom: paddingFactor,
            paddingTop: paddingFactor
        });
    } else if (controls && typeof controls.target !== 'undefined') {
        // Fallback for OrbitControls
        controls.target.copy(center);
        camera.position.set(
            center.x + distance,
            center.y + distance,
            center.z + distance
        );
        controls.update();
    } else {
        // No controls, just position camera
        camera.position.set(
            center.x + distance,
            center.y + distance,
            center.z + distance
        );
        camera.lookAt(center);
    }
}

/**
 * Normalize asset geometry to prevent scaling issues
 * @param {Object} asset - Asset object with dimensions and position
 * @param {String} unit - Expected unit ('mm', 'm', 'cm')
 * @returns {Object} Normalized asset with consistent meter-based dimensions
 */
export function normalizeAsset(asset, unit = 'mm') {
    // Conversion factors to meters
    const conversionFactors = {
        'mm': 0.001,
        'cm': 0.01,
        'm': 1,
        'meters': 1,
        'millimeters': 0.001,
        'centimeters': 0.01
    };

    const scale = conversionFactors[unit] || 0.001; // Default to mm

    const normalized = {
        ...asset,
        dimensions: {
            width: (asset.dimensions?.width || asset.dimensions?.x || 1) * scale,
            height: (asset.dimensions?.height || asset.dimensions?.y || 1) * scale,
            depth: (asset.dimensions?.depth || asset.dimensions?.z || 1) * scale
        },
        position: {
            x: (asset.position?.x || 0) * scale,
            y: (asset.position?.y || 0) * scale,
            z: (asset.position?.z || 0) * scale
        },
        scale: { x: 1, y: 1, z: 1 }, // Always reset scale to 1
        radius: asset.radius ? asset.radius * scale : undefined,
        radiusTop: asset.radiusTop ? asset.radiusTop * scale : undefined,
        radiusBottom: asset.radiusBottom ? asset.radiusBottom * scale : undefined
    };

    console.log(`🔧 Normalized asset from ${unit}:`, {
        original: asset.dimensions,
        normalized: normalized.dimensions
    });

    return normalized;
}

/**
 * Calculate the scale factor needed to fit content within max dimensions
 * @param {THREE.Box3} boundingBox - The bounding box of content
 * @param {Number} maxSize - Maximum allowed size in any dimension
 * @returns {Number} Scale factor to apply (≤ 1.0)
 */
export function calculateAutoScaleFactor(boundingBox, maxSize = 200) {
    const size = new THREE.Vector3();
    boundingBox.getSize(size);

    const maxDimension = Math.max(size.x, size.y, size.z);

    if (maxDimension <= maxSize) {
        return 1.0; // No scaling needed
    }

    const scaleFactor = maxSize / maxDimension;
    console.log(`📏 Auto-scale factor: ${scaleFactor.toFixed(3)} (max dimension: ${maxDimension.toFixed(1)} → ${maxSize})`);

    return scaleFactor;
}
